import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId, invoiceNumber } = await req.json();
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

    const { data: job } = await supabase.from("jobs").select("qb_invoice_number").eq("id", jobId).single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const prevNumber = (job as any).qb_invoice_number || null;
    const { error: wErr } = await supabase.from("jobs").update({ qb_invoice_number: invoiceNumber || null }).eq("id", jobId);
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });

    // Log activity (only if the number changed)
    if (prevNumber !== (invoiceNumber || null)) {
      const message = invoiceNumber
        ? (prevNumber ? `Invoice number updated: #${prevNumber} → #${invoiceNumber}` : `Invoice number set: #${invoiceNumber}`)
        : `Invoice number cleared (was #${prevNumber})`;
      await (supabase as any).from("job_activity").insert({
        job_id: jobId, user_id: user.id, type: "auto", message,
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
