import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";
import { createReorderJob } from "@/lib/reorder-cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/clients/[id]/reorder — the INTERNAL reorder cart (client space
// catalog). Same engine as the hub cart; team session required.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const body = await req.json().catch(() => ({}));
    const note: string = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    const r = await createReorderJob(db, { clientId: params.id, cart: Array.isArray(body.items) ? body.items : [], note, source: "internal_cart" });
    try {
      await logJobActivityServer(r.jobId,
        `Reorder started by the team from the client space (${r.itemCount} item${r.itemCount === 1 ? "" : "s"})${note ? ` — note: "${note.slice(0, 200)}"` : ""}`);
    } catch {}
    return NextResponse.json({ success: true, jobId: r.jobId, jobNumber: r.jobNumber, itemCount: r.itemCount });
  } catch (e: any) {
    const msg = e?.message || "Failed";
    const code = /empty|No valid|not found|Invalid/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
