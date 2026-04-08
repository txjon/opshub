import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId, invoiceNumber } = await req.json();
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

    // Get current type_meta to merge
    const { data: job } = await supabase.from("jobs").select("type_meta").eq("id", jobId).single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const typeMeta = { ...(job.type_meta || {}), qb_invoice_number: invoiceNumber || null };
    await supabase.from("jobs").update({ type_meta: typeMeta }).eq("id", jobId);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
