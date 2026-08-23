import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { addSlot, removeSlot, patchSlot, isSlotOpFail } from "@/lib/release-slot-ops";
import { hasRun } from "@/lib/run-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Internal slot ops — FULL OPS PARITY (Jon, Aug 20: "we need to be able to
// do everything our client can do"). Same lib/release-slot-ops core as the
// hub route, actor 'ops' → lineup + numbers editable on any PRE-CUT release.
//
// GET    → add-picker candidates for this release's client:
//          { briefs, pipeItems, rerunItems } (same lanes as the hub picker,
//          same committed-design exclusions as the hub releases GET).
// POST   → add a line (same three lanes as the hub).
// DELETE → ?slotId= remove a line.
// PATCH  → { slotId, qtys } or { slotId, format, retail }.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const ACTIVE_HIDDEN = ["complete", "archived", "cancelled", "on_hold"];

async function ctxOf(releaseId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const db = admin();
  const { data: release } = await db.from("releases").select("id, client_id, status, company_id").eq("id", releaseId).single();
  if (!release) return null;
  return { db, release: release as any };
}

export async function GET(_req: NextRequest, { params }: { params: { releaseId: string } }) {
  try {
    const ctx = await ctxOf(params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { db, release } = ctx;
    const clientId = release.client_id;

    // Slotted lines on THIS release (exclude from every lane).
    const { data: mySlots } = await db.from("release_slots")
      .select("brief_id, item_id").eq("release_id", release.id);
    const slottedBriefs = new Set((mySlots || []).map((s: any) => s.brief_id).filter(Boolean));
    const slottedItems = new Set((mySlots || []).map((s: any) => s.item_id).filter(Boolean));

    // Committed designs — same exclusions as the hub releases GET: an open
    // slot on any non-cut release, an open studio order, or a born item.
    const { data: briefs } = await db.from("art_briefs")
      .select("id, title, state").eq("client_id", clientId).eq("internal_only", false)
      .in("state", ["working", "with_client", "approved"]);
    const bids = (briefs || []).map((b: any) => b.id);
    const committed = new Set<string>();
    if (bids.length) {
      const { data: open } = await db.from("release_slots")
        .select("brief_id, releases!inner(status)").in("brief_id", bids).neq("releases.status", "cut");
      for (const s of (open || []) as any[]) if (s.brief_id) committed.add(s.brief_id);
      const { data: reqs } = await db.from("lab_order_requests").select("brief_id").in("brief_id", bids).is("handled_at", null);
      for (const r of (reqs || []) as any[]) if (r.brief_id) committed.add(r.brief_id);
      const { data: borns } = await db.from("items").select("design_id").in("design_id", bids);
      for (const b of (borns || []) as any[]) if (b.design_id) committed.add(b.design_id);
    }
    const briefCands = (briefs || []).filter((b: any) => !committed.has(b.id) && !slottedBriefs.has(b.id));

    // One representative image per candidate brief (board thumb rule).
    const thumbs: Record<string, string> = {};
    if (briefCands.length) {
      const { data: files } = await db.from("art_brief_files")
        .select("brief_id, drive_file_id, preview_drive_file_id, mime_type, created_at")
        .in("brief_id", briefCands.map((b: any) => b.id))
        .order("created_at", { ascending: false });
      for (const f of (files || []) as any[]) {
        if (thumbs[f.brief_id] || /pdf/i.test(f.mime_type || "")) continue;
        const id = f.preview_drive_file_id || f.drive_file_id;
        if (id) thumbs[f.brief_id] = id;
      }
    }

    // Items: pipeline (active jobs) vs catalog re-runs (has actually run;
    // name|sku dedupe, newest instance wins — the hub catalog rule).
    const { data: items } = await db.from("items")
      .select("id, name, blank_sku, pipeline_stage, created_at, jobs!inner(client_id, phase), buy_sheet_lines(size, qty_ordered)")
      .eq("jobs.client_id", clientId);
    const qtyOf = (it: any) => (it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0);
    const itemRows = (items || []) as any[];
    const pipeItems = itemRows
      .filter((it: any) => !ACTIVE_HIDDEN.includes(String(it.jobs?.phase || "")) && !slottedItems.has(it.id))
      .map((it: any) => ({ id: it.id, name: it.name, qty: qtyOf(it) }));
    const activeIds = new Set(pipeItems.map((it: any) => it.id));
    const byKey = new Map<string, any>();
    for (const it of [...itemRows].sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))) {
      if (activeIds.has(it.id) || slottedItems.has(it.id)) continue;
      if (!hasRun(it.jobs?.phase, it.pipeline_stage)) continue;
      const key = `${(it.name || "").trim().toLowerCase()}|${(it.blank_sku || "").trim().toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, { id: it.id, name: it.name, qty: qtyOf(it) });
    }
    return NextResponse.json({
      briefs: briefCands.map((b: any) => ({ id: b.id, title: b.title, state: b.state, thumbId: thumbs[b.id] || null })),
      pipeItems,
      rerunItems: Array.from(byKey.values()),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { releaseId: string } }) {
  try {
    const ctx = await ctxOf(params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const out = await addSlot(ctx.db, ctx.release, body, "ops");
    if (isSlotOpFail(out)) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ success: true, slotId: out.slotId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { releaseId: string } }) {
  try {
    const ctx = await ctxOf(params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const out = await removeSlot(ctx.db, ctx.release, req.nextUrl.searchParams.get("slotId") || "", "ops");
    if (isSlotOpFail(out)) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { releaseId: string } }) {
  try {
    const ctx = await ctxOf(params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { db, release } = ctx;
    const body = await req.json().catch(() => ({}));

    // ── Ledger ops (Phase 4, ops-only — sold counts, overage policy, and
    //    attaching/detaching existing runs to a line) ────────────────────
    if (body.soldQtys !== undefined || body.overagePct !== undefined) {
      if (!body.slotId) return NextResponse.json({ error: "Missing slot" }, { status: 400 });
      if (release.status === "cut") return NextResponse.json({ error: "This release is already cut" }, { status: 409 });
      const patch: Record<string, any> = {};
      if (body.soldQtys !== undefined) {
        const clean = Object.fromEntries(Object.entries(body.soldQtys || {})
          .map(([s, v]: [string, any]) => [String(s).slice(0, 20), Math.max(0, Math.min(1000000, Math.round(Number(v) || 0)))])
          .filter(([, v]) => (v as number) > 0));
        patch.sold_qtys = clean;
        patch.sold_units = Object.values(clean).reduce((a: number, b: any) => a + b, 0);
        patch.sold_updated_at = new Date().toISOString();
      }
      if (body.overagePct !== undefined) {
        patch.overage_pct = Math.max(0, Math.min(100, Number(body.overagePct) || 0));
      }
      const { error } = await db.from("release_slots").update(patch)
        .eq("id", String(body.slotId)).eq("release_id", release.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }
    if (body.attachItemId !== undefined || body.detachItemId !== undefined) {
      if (release.status === "cut") return NextResponse.json({ error: "This release is already cut" }, { status: 409 });
      if (body.detachItemId) {
        await db.from("items").update({ release_slot_id: null }).eq("id", String(body.detachItemId)).eq("release_slot_id", String(body.slotId || ""));
        return NextResponse.json({ success: true });
      }
      if (!body.slotId) return NextResponse.json({ error: "Missing slot" }, { status: 400 });
      const { data: item } = await db.from("items")
        .select("id, release_slot_id, job_id, jobs!inner(client_id, release_id)")
        .eq("id", String(body.attachItemId)).single();
      if (!item || (item as any).jobs?.client_id !== release.client_id) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      if ((item as any).release_slot_id && (item as any).release_slot_id !== body.slotId) {
        return NextResponse.json({ error: "That run is already attached to another line" }, { status: 409 });
      }
      const { error } = await db.from("items").update({ release_slot_id: String(body.slotId) }).eq("id", (item as any).id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!(item as any).jobs?.release_id) {
        await db.from("jobs").update({ release_id: release.id }).eq("id", (item as any).job_id).is("release_id", null);
      }
      return NextResponse.json({ success: true });
    }

    const out = await patchSlot(db, release, body, "ops");
    if (isSlotOpFail(out)) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
