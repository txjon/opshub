import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /api/dashboard/mark-read  { cardId }
// Removes a single cardId from companies.branding.dashboard_unread_overrides.
// Used to clear a manual "Mark Unread" ping after the team has acted
// on it.

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const cardId = typeof body.cardId === "string" ? body.cardId : "";
    if (!cardId) return NextResponse.json({ ok: false, error: "cardId required" }, { status: 400 });

    const { data: companies } = await supabase.from("companies").select("id").limit(1);
    const company = (companies || [])[0] as any;
    if (!company) return NextResponse.json({ ok: false }, { status: 404 });

    await (supabase as any).rpc("remove_dashboard_unread_override", {
      p_company_id: company.id,
      p_card_id: cardId,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[mark-read]", e?.message || e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
