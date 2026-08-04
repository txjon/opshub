import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";
import { createReorderJob } from "@/lib/reorder-cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/portal/client/[token]/cart — Client Hub reorder cart.
// Engine lives in lib/reorder-cart (shared with the internal client-space
// cart); this wrapper owns token auth + client-facing notifications.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const body = await req.json().catch(() => ({}));
    const { data: client } = await db.from("clients").select("id, name").eq("portal_token", params.token).single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const note: string = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    const r = await createReorderJob(db, { clientId: client.id, cart: Array.isArray(body.items) ? body.items : [], note, source: "client_portal_cart" });

    try {
      const { sendInternalMail } = await import("@/lib/internal-mail");
      await sendInternalMail({ kind: "cart_reorder", client: client.name, jobNumber: r.jobNumber || "new job", title: "Reorder", itemCount: r.itemCount, note: note || null, jobId: r.jobId });
    } catch {}
    try {
      await logJobActivityServer(r.jobId,
        `Reorder request submitted from the client hub (${r.itemCount} item${r.itemCount === 1 ? "" : "s"})${note ? ` — note: "${note.slice(0, 200)}"` : ""}`);
    } catch {}

    return NextResponse.json({ success: true, jobId: r.jobId, jobNumber: r.jobNumber, itemCount: r.itemCount });
  } catch (e: any) {
    const msg = e?.message || "Failed";
    const code = /empty|No valid|not found|Invalid/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
