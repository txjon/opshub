import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { labDb } from "@/lib/lab";
import { bridgeOrderRequest } from "@/lib/lab-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { requestId } — Start the job: run the bridge on an order request.
// Auth-gated (writes real clients/briefs/products/jobs/Drive) even though the
// lab sandbox itself is open — the team is signed in on the app domain.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in to start jobs" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
    const byName = (profile as any)?.full_name || user.email || "HPD";

    const b = await req.json().catch(() => ({}));
    if (!b.requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });

    const out = await bridgeOrderRequest(labDb(), { requestId: String(b.requestId), byName });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Bridge failed" }, { status: 400 });
  }
}
