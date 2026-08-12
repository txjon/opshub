import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hasRun } from "@/lib/run-gate";
import { hubClientLookup } from "@/lib/hub-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST   → add a line. Three lanes (lib/release-lanes):
//            { briefId, lineId }        — studio idea line (spec snapshot)
//            { itemId }                 — pipeline item (in flight/in stock)
//            { itemId, rerun: true }    — catalog re-run (past piece, fresh
//              run at cut; requires the item to have actually RUN — run-gate)
// DELETE → ?slotId= remove while the release is building.
// PATCH  → { slotId, qtys } client-entered per-size production numbers
//          (allowed while status is 'closed' — Corey's step 5).

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function owned(token: string, releaseId: string) {
  const db = admin();
  const { data: client } = await hubClientLookup(db, token, "id, portal_features");
  if (!client) return null;
  if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("releases")) return null;
  const { data: release } = await db.from("releases").select("id, client_id, status, company_id").eq("id", releaseId).single();
  if (!release || (release as any).client_id !== client.id) return null;
  return { db, client, release };
}

export async function POST(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { db, client, release } = ctx;
    if ((release as any).status !== "building") return NextResponse.json({ error: "This release is locked" }, { status: 409 });

    const { briefId, lineId, itemId, rerun } = await req.json().catch(() => ({}));
    const { count } = await db.from("release_slots").select("id", { count: "exact", head: true }).eq("release_id", (release as any).id);

    let insert: Record<string, any>;
    if (itemId) {
      // Item-sourced line — either a pipeline item riding along (the run
      // already exists) or a catalog RE-RUN (past piece, cut births a new run).
      const { data: item } = await db.from("items")
        .select("id, name, client_retail_per_unit, pipeline_stage, jobs!inner(client_id, phase), buy_sheet_lines(size, qty_ordered)")
        .eq("id", String(itemId)).single();
      if (!item || (item as any).jobs?.client_id !== (client as any).id) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      if (rerun && !hasRun((item as any).jobs?.phase, (item as any).pipeline_stage)) {
        return NextResponse.json({ error: "That piece hasn't been produced yet" }, { status: 400 });
      }
      const qtys: Record<string, number> = {};
      for (const l of ((item as any).buy_sheet_lines || [])) {
        const n = Number(l.qty_ordered) || 0;
        if (n > 0) qtys[l.size] = n;
      }
      insert = {
        company_id: (release as any).company_id || null,
        release_id: (release as any).id,
        brief_id: null,
        line_id: rerun ? `rerun:${(item as any).id}` : `item:${(item as any).id}`,
        item_id: (item as any).id,
        format: (item as any).name,
        retail: (item as any).client_retail_per_unit ?? null,
        model: null,
        // pipeline: the run's real numbers ride along; re-run: last run
        // prefills, the client's closing numbers overwrite
        qtys,
        sort_order: (count || 0),
      };
    } else if (briefId && !lineId) {
      // Direct studio pull — a design needs no product spec to be planned.
      // Guarded against double-birth: one committed lane per design (an
      // open release slot, an open studio order, or a born item all block).
      const { data: brief } = await db.from("art_briefs")
        .select("id, client_id, state, internal_only").eq("id", String(briefId)).single();
      if (!brief || (brief as any).client_id !== (client as any).id || (brief as any).internal_only) {
        return NextResponse.json({ error: "Design not found" }, { status: 404 });
      }
      if (!["working", "with_client", "approved"].includes((brief as any).state)) {
        return NextResponse.json({ error: "That design left the studio" }, { status: 409 });
      }
      const { data: openSlots } = await db.from("release_slots")
        .select("id, releases!inner(status)").eq("brief_id", (brief as any).id).neq("releases.status", "cut");
      if ((openSlots || []).length) return NextResponse.json({ error: "Already on a release" }, { status: 409 });
      const { data: openReq } = await db.from("lab_order_requests")
        .select("id").eq("brief_id", (brief as any).id).is("handled_at", null).limit(1);
      if ((openReq || []).length) return NextResponse.json({ error: "Already ordered from the studio" }, { status: 409 });
      const { count: born } = await db.from("items")
        .select("id", { count: "exact", head: true }).eq("design_id", (brief as any).id);
      if (born) return NextResponse.json({ error: "Already in production" }, { status: 409 });
      insert = {
        company_id: (release as any).company_id || null,
        release_id: (release as any).id,
        brief_id: (brief as any).id,
        line_id: `design:${(brief as any).id}`, // direct studio pull (no spec line)
        format: null,
        retail: null,
        model: null,
        sort_order: (count || 0),
      };
    } else {
      const { data: brief } = await db.from("art_briefs")
        .select("id, client_id, product_spec, internal_only").eq("id", String(briefId || "")).single();
      if (!brief || (brief as any).client_id !== (client as any).id || (brief as any).internal_only) return NextResponse.json({ error: "Idea not found" }, { status: 404 });
      const line = (Array.isArray((brief as any).product_spec?.products) ? (brief as any).product_spec.products : []).find((x: any) => x.id === lineId);
      if (!line) return NextResponse.json({ error: "Line not found on that idea" }, { status: 404 });
      insert = {
        company_id: (release as any).company_id || null,
        release_id: (release as any).id,
        brief_id: (brief as any).id,
        line_id: String(lineId),
        format: line.format || null,
        retail: line.retail ?? null,
        model: line.model || null,
        line_notes: line.notes || null,
        sort_order: (count || 0),
      };
    }
    const { data, error } = await db.from("release_slots").insert(insert).select("id").single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: "Already on this release" }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, slotId: (data as any).id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((ctx.release as any).status !== "building") return NextResponse.json({ error: "This release is locked" }, { status: 409 });
    const slotId = req.nextUrl.searchParams.get("slotId") || "";
    await ctx.db.from("release_slots").delete().eq("id", slotId).eq("release_id", (ctx.release as any).id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { db, release } = ctx;
    const { slotId, qtys, format, retail } = await req.json().catch(() => ({}));
    // Slot spec (format / retail) is editable in place while BUILDING —
    // planning the drop is where those decisions belong.
    if (format !== undefined || retail !== undefined) {
      if (!slotId) return NextResponse.json({ error: "Missing slot" }, { status: 400 });
      if ((release as any).status !== "building") return NextResponse.json({ error: "This release is locked" }, { status: 409 });
      const patch: Record<string, any> = {};
      if (format !== undefined) patch.format = String(format || "").trim().slice(0, 60) || null;
      if (retail !== undefined) patch.retail = retail === null || retail === "" ? null : Math.max(0, Math.round(Number(retail) * 100) / 100 || 0);
      const { error } = await db.from("release_slots").update(patch)
        .eq("id", String(slotId || "")).eq("release_id", (release as any).id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }
    if ((release as any).status !== "closed") return NextResponse.json({ error: "Numbers open after the sale closes" }, { status: 409 });
    const clean = Object.fromEntries(Object.entries(qtys || {})
      .map(([s, n]) => [String(s).slice(0, 20), Math.max(0, Math.min(1000000, Math.round(Number(n) || 0)))])
      .filter(([, n]) => (n as number) > 0));
    const { error } = await db.from("release_slots")
      .update({ qtys: clean, qtys_confirmed_at: null })
      .eq("id", String(slotId || "")).eq("release_id", (release as any).id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
