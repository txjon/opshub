import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST   → add a line from one of their ideas { briefId, lineId } — snapshots
//          format/retail/model/notes from the brief's product_spec at slot time.
// DELETE → ?slotId= remove while the drop is building.
// PATCH  → { slotId, qtys } client-entered per-size production numbers
//          (allowed while status is 'closed' — Corey's step 5).

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function owned(token: string, releaseId: string) {
  const db = admin();
  const { data: client } = await db.from("clients")
    .select("id, portal_features").eq("portal_token", token).single();
  if (!client) return null;
  if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("studio")) return null;
  const { data: release } = await db.from("releases").select("id, client_id, status, company_id").eq("id", releaseId).single();
  if (!release || (release as any).client_id !== client.id) return null;
  return { db, client, release };
}

export async function POST(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { db, client, release } = ctx;
    if ((release as any).status !== "building") return NextResponse.json({ error: "Drop is locked" }, { status: 409 });

    const { briefId, lineId, itemId } = await req.json().catch(() => ({}));
    const { count } = await db.from("release_slots").select("id", { count: "exact", head: true }).eq("release_id", (release as any).id);

    let insert: Record<string, any>;
    if (itemId) {
      // In-production item joining the release — the run already exists.
      const { data: item } = await db.from("items")
        .select("id, name, client_retail_per_unit, jobs!inner(client_id), buy_sheet_lines(size, qty_ordered)")
        .eq("id", String(itemId)).single();
      if (!item || (item as any).jobs?.client_id !== (client as any).id) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
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
        line_id: `item:${(item as any).id}`,
        item_id: (item as any).id,
        format: (item as any).name,
        retail: (item as any).client_retail_per_unit ?? null,
        model: null,
        qtys, // the run's real numbers ride along
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
      if (/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: "Already on this drop" }, { status: 409 });
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
    if ((ctx.release as any).status !== "building") return NextResponse.json({ error: "Drop is locked" }, { status: 409 });
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
    if ((release as any).status !== "closed") return NextResponse.json({ error: "Numbers open after the sale closes" }, { status: 409 });
    const { slotId, qtys } = await req.json().catch(() => ({}));
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
