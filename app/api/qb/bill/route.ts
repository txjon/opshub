export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getOrCreateVendor, getCogsAccountRef, createBill, type QBBillLine } from "@/lib/quickbooks";

// Push an OpsHub "bill" (a group of cost_entries sharing a vendor + invoice #)
// to QuickBooks as an AP Bill. The edge over entering it straight in QB: each
// line carries the job's client as CustomerRef (resolved from the cached
// clients.qb_customer_id the invoice push already populates), so the cost lands
// in QB already attributed to the customer for job-costing — which QB can't
// derive from a PO number on its own.
export async function POST(req: NextRequest) {
  try {
    // Auth: logged-in user OR internal service call
    const internalKey = req.headers.get("x-internal-key");
    if (internalKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { entryIds } = await req.json();
    if (!Array.isArray(entryIds) || !entryIds.length) {
      return NextResponse.json({ error: "Missing entryIds" }, { status: 400 });
    }

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: entries } = await admin.from("cost_entries")
      .select("id, vendor_id, vendor_name, vendor_invoice_number, po_ref, job_id, amount, qb_bill_id, hpd_bill_number, bill_method")
      .in("id", entryIds);
    if (!entries?.length) return NextResponse.json({ error: "No cost entries found" }, { status: 404 });

    // Card charges NEVER push as QB Bills — the charge already reaches QB
    // through the card/bank feed; a Bill on top would double-book the
    // expense. Card entries exist for OpsHub margin truth only.
    const cc = entries.find((e: any) => e.bill_method === "credit_card");
    if (cc) return NextResponse.json({ error: "Card charges don't push to QB — the expense arrives via the card feed. This entry is recorded for job costing only." }, { status: 400 });

    // Pre-OpsHub close-outs NEVER push — the money settled years ago,
    // before AP existed; the entry exists for margin truth only (Sep 4).
    const pre = entries.find((e: any) => e.source === "pre_opshub");
    if (pre) return NextResponse.json({ error: "This is a pre-OpsHub close-out (billed and paid before AP existed) — recorded for job costing only, never pushed to QB." }, { status: 400 });

    // Guard: refuse to double-push
    const already = entries.find((e: any) => e.qb_bill_id);
    if (already) return NextResponse.json({ error: `Already pushed to QB (bill #${already.qb_bill_id})` }, { status: 409 });

    // One vendor per QB Bill
    const vendorIds = [...new Set(entries.map((e: any) => e.vendor_id))];
    if (vendorIds.length !== 1 || !vendorIds[0]) {
      return NextResponse.json({ error: "All lines must share one vendor to push as a single bill" }, { status: 400 });
    }

    // Resolve QB vendor — use cached qb_vendor_id, else look up + cache it
    const { data: ven } = await admin.from("ap_vendors").select("id, name, qb_vendor_id").eq("id", vendorIds[0]).single();
    if (!ven) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    let qbVendorId = ven.qb_vendor_id as string | null;
    if (!qbVendorId) {
      const qv = await getOrCreateVendor(ven.name);
      qbVendorId = String(qv.Id);
      await admin.from("ap_vendors").update({ qb_vendor_id: qbVendorId }).eq("id", ven.id);
    }

    const acct = await getCogsAccountRef();

    // Resolve per-line customer via job → client.qb_customer_id (the job-costing link)
    const jobIds = [...new Set(entries.map((e: any) => e.job_id).filter(Boolean))] as string[];
    const { data: jobs } = jobIds.length
      ? await admin.from("jobs").select("id, job_number, type_meta, clients(name, qb_customer_id)").in("id", jobIds)
      : { data: [] as any[] };
    const jobById: Record<string, any> = Object.fromEntries((jobs || []).map((j: any) => [j.id, j]));

    // Line description = "{vendor invoice #} - {HPD PO#}". The client is carried
    // as CustomerRef (the Customer column) for job-costing — not repeated in the
    // description.
    const lines: QBBillLine[] = entries.map((e: any) => {
      const j = e.job_id ? jobById[e.job_id] : null;
      const ref = e.po_ref || j?.type_meta?.qb_invoice_number || j?.job_number || "";
      const inv = e.vendor_invoice_number ? `${e.vendor_invoice_number} - ` : "";
      return {
        amount: Number(e.amount || 0),
        description: `${inv}${ref}`.trim() || "Cost",
        customerId: j?.clients?.qb_customer_id || undefined,
      };
    });

    // Bill DocNumber = the HPD Bill Number (OpsHub's own sequential id). Each line
    // carries its vendor invoice # in the description; the bill itself is HPD's number.
    const docNumber = entries.find((e: any) => e.hpd_bill_number)?.hpd_bill_number || undefined;
    const jobRefs = [...new Set((jobs || []).map((j: any) => j.type_meta?.qb_invoice_number || j.job_number).filter(Boolean))].join(", ");

    const result = await createBill({
      vendorId: qbVendorId!,
      accountId: acct.id,
      lines,
      docNumber,
      privateNote: `OpsHub push${jobRefs ? ` · ${jobRefs}` : ""}`,
    });

    // Stamp the entries so the board shows pushed + we can't double-post
    await admin.from("cost_entries")
      .update({ qb_bill_id: result.billId, qb_pushed_at: new Date().toISOString() })
      .in("id", entryIds);

    return NextResponse.json({
      ok: true,
      billId: result.billId,
      total: result.total,
      lines: lines.length,
      customersLinked: lines.filter((l) => l.customerId).length,
    });
  } catch (e: any) {
    console.error("[qb/bill] error", e?.message);
    return NextResponse.json({ error: e?.message || "Push to QB failed" }, { status: 500 });
  }
}
