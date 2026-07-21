import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Internal drops board — status transitions.
// PATCH { action: 'live' | 'closed' | 'shelved' | 'building' }
//   ready → live → closed (the sale lifecycle); shelved from anywhere
//   pre-cut; building reopens a shelved/ready drop for the client.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const ALLOWED: Record<string, string[]> = {
  live: ["ready"],
  closed: ["live"],
  shelved: ["building", "ready", "live", "closed"],
  building: ["ready", "shelved"],
};

export async function PATCH(req: NextRequest, { params }: { params: { releaseId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();
    const { action } = await req.json().catch(() => ({}));
    if (!ALLOWED[action]) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const { data: release } = await db.from("releases").select("id, status, status_timestamps").eq("id", params.releaseId).single();
    if (!release) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!ALLOWED[action].includes((release as any).status)) {
      return NextResponse.json({ error: `Can't go ${action} from ${(release as any).status}` }, { status: 409 });
    }
    const { error } = await db.from("releases").update({
      status: action,
      status_timestamps: { ...((release as any).status_timestamps || {}), [action]: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }).eq("id", params.releaseId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
