import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/company";
import { loadInbox } from "@/lib/inbox";
import { loadHouseCounts } from "@/lib/house-counts";

export const dynamic = "force-dynamic";

// GET  /api/inbox → { count, items, sections, total }
//      items/count = the inbox (external words); sections = per-page "your
//      move" counts under The House (lib/house-counts); total = their sum,
//      the number on The House badge.
// POST /api/inbox { key, note } → clears one item as handled (proof revisions;
//      vendor flags resolve on the assignment, briefs on hpd_last_seen_at)
export async function GET() {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ count: 0, items: [], sections: null, total: 0 });
    const company = await getActiveCompany();
    const items = await loadInbox(sb, company.id);
    const { total, ...sections } = await loadHouseCounts(sb, company.id, company.slug, items);
    return NextResponse.json({ count: items.length, items, sections, total });
  } catch (e: any) {
    console.error("[inbox]", e?.message || e);
    return NextResponse.json({ count: 0, items: [], sections: null, total: 0 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const key = String(body.key || "");
    if (!/^proof:[0-9a-f-]{36}$/.test(key)) return NextResponse.json({ error: "Only proof revisions clear here" }, { status: 400 });
    const company = await getActiveCompany();
    const { error } = await sb.from("inbox_cleared").upsert(
      { company_id: company.id, key, cleared_by: user.email || null, note: body.note ? String(body.note).slice(0, 500) : null, cleared_at: new Date().toISOString() },
      { onConflict: "company_id,key" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
