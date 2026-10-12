import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";
import { createReorderJob, addItemsToJob } from "@/lib/reorder-cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/clients/[id]/reorder — the INTERNAL reorder cart (client space
// catalog). Same engine as the hub cart; team session required.
// Body: { items: [{itemId, sizes}], note?, to_job_id? }. With to_job_id the
// cart's pieces go INTO that open job (lib/reorder-cart addItemsToJob)
// instead of minting a new intake job — internal only; the client hub cart
// always starts a new job.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const body = await req.json().catch(() => ({}));
    const note: string = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (body.to_job_id) {
      const { data: dest } = await db.from("jobs").select("client_id").eq("id", body.to_job_id).single();
      if (!dest || (dest as any).client_id !== params.id) return NextResponse.json({ error: "That job isn't this client's" }, { status: 400 });
      const items = (Array.isArray(body.items) ? body.items : []).map((l: any) => ({ itemId: l.itemId, sizes: l.sizes }));
      const a = await addItemsToJob(db, { jobId: body.to_job_id, items });
      try {
        const names = a.added.map(x => `${x.name}${x.fromJob ? ` (from ${x.fromJob})` : ""}`).join(", ");
        await logJobActivityServer(a.job.id, `${a.added.length} item${a.added.length === 1 ? "" : "s"} added from the client catalog: ${names}${note ? ` — note: "${note.slice(0, 200)}"` : ""}`);
      } catch {}
      return NextResponse.json({ success: true, jobId: a.job.id, jobNumber: a.job.job_number, itemCount: a.added.length, fileErrors: a.fileErrors });
    }
    const r = await createReorderJob(db, { clientId: params.id, cart: Array.isArray(body.items) ? body.items : [], note, source: "internal_cart" });
    try {
      await logJobActivityServer(r.jobId,
        `Reorder started by the team from the client space (${r.itemCount} item${r.itemCount === 1 ? "" : "s"})${note ? ` — note: "${note.slice(0, 200)}"` : ""}`);
    } catch {}
    return NextResponse.json({ success: true, jobId: r.jobId, jobNumber: r.jobNumber, itemCount: r.itemCount });
  } catch (e: any) {
    const msg = e?.message || "Failed";
    const code = /empty|No valid|not found|Invalid|Nothing to add|same client|already quoted|already on this job/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
