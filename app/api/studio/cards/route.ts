import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getActiveCompany } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Board cards by id, for release lineups (mig 217: a release line can be a
// card from the client's board). GET ?ids=a,b → { cards: { [id]: { name,
// itemNo, thumb, verdict } } }. line_sheet_items is service-role only (RLS
// with no policies), so the /drops board reads card faces through here.
// thumb = the picture the client has seen (a pending Replace's stand-in).
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  if (!(await studioUser(supabase))) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const ids = (req.nextUrl.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 500);
  if (!ids.length) return NextResponse.json({ cards: {} });
  const company = await getActiveCompany();
  const { data, error } = await admin().from("line_sheet_items")
    .select("id, name, item_no, images, client_verdict, line_sheets!inner(clients!inner(company_id))")
    .in("id", ids).eq("line_sheets.clients.company_id", company.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const cards: Record<string, any> = {};
  for (const c of (data || []) as any[]) {
    const img0 = (c.images || [])[0];
    cards[c.id] = { name: c.name, itemNo: c.item_no, thumb: img0?.replaces?.driveId || img0?.driveId || null, verdict: c.client_verdict || null };
  }
  return NextResponse.json({ cards });
}
