import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { parseSalesCsv, matchSalesToSlots } from "@/lib/shopify-sales-import";
import { isPipelineSlot } from "@/lib/release-lanes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sold import (Continuum Phase 4) — paste Shopify's "Sales by product
// variant" CSV, date-scoped by the operator to the sell window. Matches
// rows to release lines by FINAL PRODUCT NAME + size (the naming gate's
// join key) and REPLACES each matched line's sold_qtys — the report is
// authoritative for the window. Unmatched rows are returned, never
// silently dropped. Never inventory-derived.
//
// POST { csv } → { applied: [{ slotId, name, total }], unmatched: [...] }

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
    const parsed = parseSalesCsv(String(body.csv || ""));
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

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

    const { bySlot, unmatched } = matchSalesToSlots(parsed.rows, named);
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
