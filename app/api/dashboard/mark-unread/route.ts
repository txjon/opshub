import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /api/dashboard/mark-unread  { cardId }
// POST /api/dashboard/mark-read    { cardId } — same endpoint, different
// op via the `read` flag, kept as one route for symmetry.
//
// Adds or removes a card_id from the team-wide override list at
// companies.branding.dashboard_unread_overrides. Cards in the list
// render as unread regardless of the last_dashboard_seen_at timestamp
// — Jon's intended way to ping Drake / Taylor on specific cards.

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const cardId = typeof body.cardId === "string" ? body.cardId : "";
    if (!cardId) return NextResponse.json({ ok: false, error: "cardId required" }, { status: 400 });

    const { data: companies } = await supabase.from("companies").select("id, branding").limit(1);
    const company = (companies || [])[0] as any;
    if (!company) return NextResponse.json({ ok: false }, { status: 404 });

    const branding = company.branding || {};
    const current: string[] = Array.isArray(branding.dashboard_unread_overrides)
      ? branding.dashboard_unread_overrides : [];
    const next = current.includes(cardId) ? current : [...current, cardId];

    const newBranding = { ...branding, dashboard_unread_overrides: next };
    await (supabase.from("companies") as any).update({ branding: newBranding }).eq("id", company.id);
    return NextResponse.json({ ok: true, overrides: next });
  } catch (e: any) {
    console.error("[mark-unread]", e?.message || e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
