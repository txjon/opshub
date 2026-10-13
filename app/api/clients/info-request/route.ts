import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { sendInfoRequest } from "@/lib/client-info";
import { appBaseUrl } from "@/lib/public-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { clientIds: string[], to?: string[] } — email each client a link to their prefilled
// info form. Owner/manager only: it emails clients. Sequential + per-client
// results so one bad address never hides the rest.
export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: me } = await sb.from("profiles").select("role, is_god").eq("id", user.id).single();
  if (!(me as any)?.is_god && !["owner", "manager"].includes((me as any)?.role)) return NextResponse.json({ error: "Only an owner or manager can email clients" }, { status: 403 });
  const { clientIds, to } = await req.json().catch(() => ({}));
  if (!Array.isArray(clientIds) || !clientIds.length) return NextResponse.json({ error: "clientIds required" }, { status: 400 });
  // `to` = staff picked who gets it (client page). One client only.
  if (to !== undefined && (!Array.isArray(to) || !to.length || clientIds.length !== 1)) return NextResponse.json({ error: "Pick at least one contact (one client at a time)" }, { status: 400 });
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const base = await appBaseUrl();
  const results: { clientId: string; ok: boolean; to?: string[]; error?: string }[] = [];
  for (const id of clientIds.slice(0, 200)) {
    try { const r = await sendInfoRequest(db, id, base, to); results.push({ clientId: id, ok: true, to: r.to }); }
    catch (e: any) { results.push({ clientId: id, ok: false, error: e?.message || "failed" }); }
  }
  return NextResponse.json({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok), results });
}
