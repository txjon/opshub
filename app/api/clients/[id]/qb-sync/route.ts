import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { applyQbSync } from "@/lib/qb-customer-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST — after staff edit a client (Edit client, Locations), copy the result
// to the QuickBooks customer (lib/qb-customer-sync: non-blank fields only).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: cl } = await sb.from("clients").select("id").eq("id", params.id).maybeSingle();   // RLS: their company's client
  if (!cl) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try { return NextResponse.json({ ok: true, ...(await applyQbSync(db, params.id, { by: user.id, source: "client_edit" })) }); }
  catch (e: any) { return NextResponse.json({ error: e?.message || "QuickBooks update failed" }, { status: 502 }); }
}
