import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { previewQbSync, applyQbSync, type SyncField } from "@/lib/qb-customer-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// OpsHub → QuickBooks customer profile sync (lib/qb-customer-sync).
// GET  = preview: every linked client whose QB record differs, field by field.
// POST { items: [{ clientId, fields }] } = write those fields (re-checked
// against QB at write time). Owner / manager only: it changes QuickBooks.
async function gate() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: me } = await sb.from("profiles").select("role, is_god").eq("id", user.id).single();
  if (!(me as any)?.is_god && !["owner", "manager"].includes((me as any)?.role)) return { error: NextResponse.json({ error: "Only an owner or manager can change QuickBooks customers" }, { status: 403 }) };
  return { user };
}
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET() {
  const g = await gate(); if (g.error) return g.error;
  try { return NextResponse.json(await previewQbSync(admin())); }
  catch (e: any) { return NextResponse.json({ error: e?.message || "Couldn't read QuickBooks" }, { status: 502 }); }
}

export async function POST(req: NextRequest) {
  const g = await gate(); if (g.error) return g.error;
  const { items } = await req.json().catch(() => ({}));
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ error: "items required" }, { status: 400 });
  const db = admin();
  const results: { clientId: string; ok: boolean; changed?: SyncField[]; skipped?: SyncField[]; error?: string }[] = [];
  for (const it of items.slice(0, 200)) {
    if (!it?.clientId || !Array.isArray(it.fields) || !it.fields.length) continue;
    try { const r = await applyQbSync(db, it.clientId, { fields: it.fields, by: g.user!.id, source: "manual" }); results.push({ clientId: it.clientId, ok: true, changed: r.changed, skipped: r.skipped }); }
    catch (e: any) { results.push({ clientId: it.clientId, ok: false, error: e?.message || "failed" }); }
  }
  return NextResponse.json({ updated: results.filter(r => r.ok && r.changed?.length).length, failed: results.filter(r => !r.ok), websiteRefused: results.filter(r => r.skipped?.length).map(r => r.clientId), results });
}
