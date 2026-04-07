export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendClientNotification } from "@/lib/auto-email";

/**
 * Trigger an auto-email notification to client.
 * Used by client-side components that can't call sendClientNotification directly.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId, type, trackingNumber, carrier } = await req.json();
    if (!jobId || !type) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    // For shipping notifications, only send if the shipping route matches
    if (type === "order_shipped_dropship") {
      const { createClient: createAdmin } = await import("@supabase/supabase-js");
      const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: job } = await sb.from("jobs").select("shipping_route").eq("id", jobId).single();
      if (job?.shipping_route !== "drop_ship") return NextResponse.json({ success: true, skipped: true });
    }

    await sendClientNotification({ jobId, type, trackingNumber, carrier });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
