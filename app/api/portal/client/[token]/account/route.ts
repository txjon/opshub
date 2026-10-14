import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hubClientLookup, infoFormEditable, INFO_UPDATE_EMAIL } from "@/lib/hub-client";
import { loadClientInfo, applyClientInfo, US_STATES } from "@/lib/client-info";
import { applyQbSync } from "@/lib/qb-customer-sync";
import { sendInternalMail } from "@/lib/internal-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;   // certificate files are copied into Drive on submit

// GET/POST /api/portal/client/[token]/account — the client info page
// (lib/client-info). Token-scoped like every hub route (hubClientLookup).
// View-only unless an info request is open (lib/hub-client infoFormEditable):
// POST refuses otherwise, so a forwarded link can't change anything.
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await hubClientLookup(db, params.token, "id");
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const id = (client as any).id;
    // a lookup hiccup shows the view (fails closed); ?view=1 = staff seeing what the client sees
    const asClient = req.nextUrl.searchParams.get("view") === "1";
    const [info, editable] = await Promise.all([loadClientInfo(db, id), asClient ? Promise.resolve(false) : infoFormEditable(db, id).catch(() => false)]);
    return NextResponse.json({ ...info, states: US_STATES, editable, updateEmail: INFO_UPDATE_EMAIL });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Couldn't load" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await hubClientLookup(db, params.token, "id, name");
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (!(await infoFormEditable(db, (client as any).id))) return NextResponse.json({ error: `This page is view-only. To change your info, email ${INFO_UPDATE_EMAIL}.` }, { status: 403 });
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Nothing was sent" }, { status: 400 });
    const r = await applyClientInfo(db, (client as any).id, body);
    // copy the confirmed info to the QuickBooks customer (staff-only note; a
    // QB hiccup never fails the client's submission)
    let qbLine: string | null = null;
    try {
      // capped at 20s so a slow Intuit can never time out the client's submission
      const q = await Promise.race([
        applyQbSync(db, (client as any).id, { source: "info_form" }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("QuickBooks was slow to answer")), 20000)),
      ]);
      if (q.changed.length) qbLine = `QuickBooks customer updated: ${q.changed.join(", ")}`;
      if (q.skipped?.length) qbLine = `${qbLine ? qbLine + ". " : ""}QuickBooks refused the website, fix it in Edit client`;
    } catch (e: any) { qbLine = `QuickBooks customer NOT updated (${e?.message || "error"}). Run the QuickBooks sync from the Clients page.`; }
    try {
      await sendInternalMail({ kind: "client_info_updated", client: (client as any).name, clientId: (client as any).id, signer: String(body?.signer?.name || ""), applied: qbLine ? [...r.applied, qbLine] : r.applied, certsPending: r.certsPending });
    } catch {}
    return NextResponse.json({ ok: true, applied: r.applied, certsPending: r.certsPending });
  } catch (e: any) {
    const msg = e?.message || "Couldn't save";
    return NextResponse.json({ error: msg }, { status: /Please|upload it again/.test(msg) ? 400 : 500 });
  }
}
