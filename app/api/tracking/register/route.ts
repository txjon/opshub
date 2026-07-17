import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { ensureTracker } from "@/lib/inbound-tracking";

export const dynamic = "force-dynamic";

// POST { shipmentIds: string[] } — register EasyPost trackers for freshly
// shipped boxes. Called fire-and-forget by client-side ship paths
// (production2's ship modal); the vendor portal route calls ensureTracker
// directly server-side. Team session required; writes run service-role so
// the guard columns update regardless of RLS shape. ensureTracker's guards
// make repeat calls free — this endpoint can never double-bill.

export async function POST(req: NextRequest) {
  try {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { shipmentIds } = await req.json();
    if (!Array.isArray(shipmentIds) || !shipmentIds.length) {
      return NextResponse.json({ error: "shipmentIds required" }, { status: 400 });
    }
    const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const results: Record<string, string> = {};
    for (const id of shipmentIds.slice(0, 20)) {
      const r = await ensureTracker(sb, String(id)).catch(e => ({ ok: false, created: false, reason: e?.message }));
      results[id] = r.created ? "created" : (r.reason || "skipped");
    }
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
