import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hubClientLookup } from "@/lib/hub-client";
import { loadClientInfo, applyClientInfo, US_STATES } from "@/lib/client-info";
import { sendInternalMail } from "@/lib/internal-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;   // certificate files are copied into Drive on submit

// GET/POST /api/portal/client/[token]/company — the client info form
// (lib/client-info). Token-scoped like every hub route (hubClientLookup).
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await hubClientLookup(db, params.token, "id");
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    return NextResponse.json({ ...(await loadClientInfo(db, (client as any).id)), states: US_STATES });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Couldn't load" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await hubClientLookup(db, params.token, "id, name");
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Nothing was sent" }, { status: 400 });
    const r = await applyClientInfo(db, (client as any).id, body);
    try {
      await sendInternalMail({ kind: "client_info_updated", client: (client as any).name, clientId: (client as any).id, signer: String(body?.signer?.name || ""), applied: r.applied, certsPending: r.certsPending });
    } catch {}
    return NextResponse.json({ ok: true, applied: r.applied, certsPending: r.certsPending });
  } catch (e: any) {
    const msg = e?.message || "Couldn't save";
    return NextResponse.json({ error: msg }, { status: /Please|upload it again/.test(msg) ? 400 : 500 });
  }
}
