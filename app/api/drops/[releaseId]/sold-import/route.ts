import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { parseSalesCsv, matchSalesToSlots } from "@/lib/shopify-sales-import";
import { isPipelineSlot } from "@/lib/release-lanes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sold import (Continuum Phase 4) — Shopify's "Sales by product variant"
// CSV, date-scoped by the operator to the sell window. Matches rows to
// release lines by FINAL PRODUCT NAME + size (the naming gate's join key)
// and REPLACES each matched line's sold_qtys — the report is authoritative
// for the window. Unmatched rows are returned, never silently dropped.
// Never inventory-derived.
//
// Two modes (the board previews client-side with the same lib, then sends
// only the operator-confirmed lines):
//   POST { csv }                              → parse+match+apply all
//   POST { apply: { [slotId]: { size: n } } } → apply the confirmed subset
// Both → { applied: [{ slotId, name, total }], unmatched: [...] }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { releaseId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();
    const { data: release } = await db.from("releases").select("id, status").eq("id", params.releaseId).single();
    if (!release) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((release as any).status === "cut") return NextResponse.json({ error: "This release is already cut" }, { status: 409 });

    const body = await req.json().catch(() => ({}));

    // FK hint required — items↔release_slots has two relationships (mig 162).
    const { data: slots } = await db.from("release_slots")
      .select("id, line_id, item_id, format, items!release_slots_item_id_fkey(name)").eq("release_id", (release as any).id);
    // A line's join name = final name (format, stamped at the naming gate),
    // falling back to the linked item's name for pipeline lines.
    const named = (slots || []).map((s: any) => ({
      id: s.id,
      name: String(s.format || s.items?.name || "").trim(),
      pipeline: isPipelineSlot(s),
    })).filter(s => s.name);

    let bySlot: Record<string, Record<string, number>>;
    let unmatched: unknown[] = [];
    if (body.apply && typeof body.apply === "object") {
      // Confirmed subset from the board's preview — clean, restrict to
      // this release's slots.
      const slotIds = new Set(named.map(s => s.id));
      bySlot = {};
      for (const [slotId, qtys] of Object.entries(body.apply as Record<string, Record<string, unknown>>)) {
        if (!slotIds.has(slotId)) continue;
        const clean = Object.fromEntries(Object.entries(qtys || {})
          .map(([s, v]) => [String(s).slice(0, 20), Math.max(0, Math.min(1000000, Math.round(Number(v) || 0)))])
          .filter(([, v]) => (v as number) > 0));
        if (Object.keys(clean).length) bySlot[slotId] = clean as Record<string, number>;
      }
    } else {
      const parsed = parseSalesCsv(String(body.csv || ""));
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const m = matchSalesToSlots(parsed.rows, named);
      bySlot = m.bySlot;
      unmatched = m.unmatched;
    }
    const now = new Date().toISOString();
    const applied: { slotId: string; name: string; total: number }[] = [];
    for (const [slotId, qtys] of Object.entries(bySlot)) {
      const total = Object.values(qtys).reduce((a, b) => a + b, 0);
      const { error } = await db.from("release_slots")
        .update({ sold_qtys: qtys, sold_units: total, sold_updated_at: now })
        .eq("id", slotId).eq("release_id", (release as any).id);
      if (!error) applied.push({ slotId, name: named.find(s => s.id === slotId)?.name || "", total });
    }
    return NextResponse.json({ applied, unmatched });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
