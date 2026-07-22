import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/portal/client/[token]/pulls
//
// Client-initiated pull request. Body:
//   { itemId, qtys: { [size]: n }, destination, neededBy?, note? }
//
// Lands as a pull_requests row (kind 'client', status pending) — the SAME
// table production uses (mig 117), so the warehouse's pending-pulls view
// picks it up with zero extra plumbing. Allowed at ANY item stage: clients
// usually ask before goods hit the dock; the team fulfills on arrival.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET — the client's open pull requests (pending/partial), newest first.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await db.from("clients").select("id, portal_features").eq("portal_token", params.token).single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("pipeline")) {
      return NextResponse.json({ pulls: [] });
    }
    const { data: jobs } = await db.from("jobs").select("id").eq("client_id", client.id);
    const jobIds = (jobs || []).map((j: any) => j.id);
    if (jobIds.length === 0) return NextResponse.json({ pulls: [] });
    const { data: pulls } = await db
      .from("pull_requests")
      .select("id, item_id, qtys, fulfilled_qtys, reason, status, created_at, items(name)")
      .in("job_id", jobIds)
      .in("status", ["pending", "partial"])
      .order("created_at", { ascending: false })
      .limit(30);
    return NextResponse.json({
      pulls: (pulls || []).map((p: any) => ({
        id: p.id,
        itemName: p.items?.name || "Item",
        units: Object.values(p.qtys || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0),
        qtys: p.qtys || {},
        reason: p.reason || "",
        status: p.status,
        createdAt: p.created_at,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const destination = String(body.destination || "").trim().slice(0, 300);
    const neededBy = String(body.neededBy || "").trim().slice(0, 20);
    const note = String(body.note || "").trim().slice(0, 1000);
    const qtys = Object.fromEntries(
      Object.entries(body.qtys || {})
        .map(([s, n]) => [String(s).slice(0, 20), Math.max(0, Math.min(100000, Math.round(Number(n) || 0)))])
        .filter(([, n]) => (n as number) > 0)
    ) as Record<string, number>;
    const units = Object.values(qtys).reduce((a, b) => a + b, 0);
    if (units === 0) return NextResponse.json({ error: "Enter at least one quantity" }, { status: 400 });
    if (!destination) return NextResponse.json({ error: "Where should it go?" }, { status: 400 });

    const { data: client } = await db
      .from("clients").select("id, name, portal_features").eq("portal_token", params.token).single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("pipeline")) {
      return NextResponse.json({ error: "Not available" }, { status: 403 });
    }

    const { data: item } = await db
      .from("items")
      .select("id, name, job_id, jobs!inner(id, client_id, company_id, job_number)")
      .eq("id", String(body.itemId || ""))
      .single();
    if (!item || (item as any).jobs?.client_id !== client.id) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const reason = [
      `To: ${destination}`,
      neededBy ? `Need by ${neededBy}` : null,
      note || null,
    ].filter(Boolean).join(" · ");

    const { data: pr, error } = await db
      .from("pull_requests")
      .insert({
        company_id: (item as any).jobs.company_id || null,
        job_id: (item as any).job_id,
        item_id: (item as any).id,
        kind: "client",
        qtys,
        reason,
        status: "pending",
        requested_by_name: `${client.name} (client hub)`,
      })
      .select("id")
      .single();
    if (error || !pr) return NextResponse.json({ error: error?.message || "Couldn't create request" }, { status: 500 });

    try {
      await logJobActivityServer((item as any).job_id,
        `Client requested a pull of "${(item as any).name}" (${units} pcs) via the hub — ${reason}`);
    } catch {}
    try {
      const { sendInternalMail } = await import("@/lib/internal-mail");
      await sendInternalMail({ kind: "pull_request", client: (client as any).name, itemName: (item as any).name, jobNumber: (item as any).jobs?.job_number || null, units, breakdown: Object.entries(qtys).map(([s, n]) => `${s} ${n}`).join(", "), reason });
    } catch {}

    return NextResponse.json({ success: true, pullId: (pr as any).id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
