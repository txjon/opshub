export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getPdfBranding } from "@/lib/branding";
import { generatePDF } from "@/lib/pdf/browser";
import { renderBrandedEmail } from "@/lib/email-template";
import { resendForSlug } from "@/lib/resend-client";

const font = "'Helvetica Neue', Arial, sans-serif";
const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type RemitInvoice = { number: string; pos: string; amount: number };

// Remittance-advice PDF — mirrors the invoice PDF house style (header w/ logo,
// meta strip, line table, big total, footer). Lists each vendor invoice the
// payment covers.
function renderRemittanceHTML(b: any, vendorName: string, invoices: RemitInvoice[], total: number, today: string) {
  const rows = invoices.map(iv => `
    <tr style="border-bottom:0.5px solid #eeeeee">
      <td style="padding:12px 0 12px 0;font-size:12px;color:#1a1a1a;font-weight:600;vertical-align:top">${iv.number || "—"}</td>
      <td style="padding:12px 8px;font-size:11px;color:#666;font-family:monospace;vertical-align:top">${iv.pos}</td>
      <td style="padding:12px 0 12px 8px;text-align:right;font-family:monospace;font-size:12px;font-weight:700;color:#1a1a1a;vertical-align:top">${fmtD(iv.amount)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:780px;margin:0 auto">

  <!-- Header -->
  <div style="padding:32px 36px 24px;border-bottom:3px solid #111">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        ${b.logoSvg}
        <div style="font-size:11px;color:#666;line-height:1.7;font-family:${font}">
          ${b.headerAddressHtml}${b.fromEmailBilling ? `<br/>${b.fromEmailBilling}` : ""}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;font-family:${font};margin-bottom:8px">REMITTANCE ADVICE</div>
        <div style="font-size:11px;color:#666;line-height:1.8;font-family:${font}">
          <div><span style="font-weight:600">Date:</span> ${today}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Meta strip -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:0.5px solid #e5e7eb;font-family:${font}">
    ${[
      ["Paid to", vendorName || "—"],
      ["Payment date", today],
      ["Invoices", String(invoices.length)],
    ].map(([k, v], i, arr) =>
      `<div style="padding:8px 12px;${i < arr.length - 1 ? "border-right:0.5px solid #e5e7eb" : ""}">
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:2px">${k}</div>
        <div style="font-size:11px;font-weight:600;color:#1a1a1a">${v}</div>
      </div>`).join("")}
  </div>

  <!-- Invoices table -->
  <div style="padding:24px 36px">
    <table style="width:100%;border-collapse:collapse;font-family:${font}">
      <thead>
        <tr style="border-bottom:1.5px solid #1a1a1a">
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:left;padding:6px 0 10px;width:30%">Invoice #</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:left;padding:6px 8px 10px">PO(s)</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:right;padding:6px 0 10px;width:120px">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <!-- Total -->
    <div style="display:flex;justify-content:flex-end;padding-top:14px;border-top:1.5px solid #1a1a1a;margin-top:4px">
      <div style="text-align:right">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#27500A;margin-bottom:4px;font-family:${font}">Total payment processed</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.03em;font-family:${font};color:#1a1a1a">${fmtD(total)}</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="padding:20px 36px;border-top:0.5px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">${b.name}</div>
      <div style="font-size:10px;color:#666;line-height:1.8">${b.fromEmailBilling ? `${b.fromEmailBilling}<br/>` : ""}${b.headerAddressHtml}</div>
    </div>
    <div style="font-size:9px;color:#aaa">Thank you for your partnership.</div>
  </div>

</div>
</body></html>`;
}

export async function POST(req: NextRequest) {
  try {
    const internalKey = req.headers.get("x-internal-key");
    if (internalKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { entryIds, testRecipient, recipientEmail } = await req.json();
    if (!Array.isArray(entryIds) || !entryIds.length) {
      return NextResponse.json({ error: "Missing entryIds" }, { status: 400 });
    }

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: entries } = await admin.from("cost_entries")
      .select("id, vendor_id, vendor_name, vendor_invoice_number, po_ref, amount")
      .in("id", entryIds);
    if (!entries?.length) return NextResponse.json({ error: "No cost entries found" }, { status: 404 });

    // Vendor + email (from the linked decorator's contacts_list)
    const vendorId = entries[0].vendor_id;
    const { data: ven } = vendorId
      ? await admin.from("ap_vendors").select("id, name, decorator_id").eq("id", vendorId).single()
      : { data: null };
    const vendorName = ven?.name || entries[0].vendor_name || "Vendor";
    // recipientEmail: a specific vendor contact chosen in the UI picker.
    // testRecipient: internal preview (no CC). Either overrides the auto-resolve.
    let vendorEmail: string | null = (testRecipient || recipientEmail || "").trim() || null;
    if (!vendorEmail && ven?.decorator_id) {
      const { data: dec } = await admin.from("decorators").select("contacts_list").eq("id", ven.decorator_id).single();
      const contacts: any[] = (dec?.contacts_list as any[]) || [];
      // Prefer a billing/accounting contact — matched on role OR name (short, safe to
      // substring) OR the email's local part. \bap\b is word-bounded so it doesn't
      // false-match domains like "teelandAPparel.com".
      const roleName = /bill|account|finance|payable|remit|\bap\b/i;
      const emailLocal = /^(bill|account|finance|ap|payable|remit|invoice)/i;
      const billing = contacts.find(c => c.email && (roleName.test(c.role || "") || roleName.test(c.name || "") || emailLocal.test(String(c.email).split("@")[0])));
      vendorEmail = (billing?.email || contacts.find(c => c.email)?.email || "").trim() || null;
    }
    if (!vendorEmail) {
      return NextResponse.json({ error: `No email on file for ${vendorName}. Add a contact with an email on the decorator record, then notify.` }, { status: 422 });
    }

    // Group lines into invoices (by vendor_invoice_number)
    const byInv: Record<string, { number: string; pos: string[]; amount: number }> = {};
    for (const e of entries) {
      const num = e.vendor_invoice_number || "(no #)";
      (byInv[num] = byInv[num] || { number: e.vendor_invoice_number || "—", pos: [], amount: 0 });
      if (e.po_ref) byInv[num].pos.push(e.po_ref);
      byInv[num].amount += Number(e.amount || 0);
    }
    const invoices: RemitInvoice[] = Object.values(byInv).map(v => ({ number: v.number, pos: v.pos.join(", "), amount: Math.round(v.amount * 100) / 100 }));
    const total = Math.round(invoices.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const b = await getPdfBranding();
    const pdf = await generatePDF(renderRemittanceHTML(b, vendorName, invoices, total, today));

    const html = renderBrandedEmail({
      eyebrow: b.name,
      heading: "Payment Processed",
      greeting: `Hi ${vendorName},`,
      bodyHtml: `Payment of <strong>${fmtD(total)}</strong> has been processed for the ${invoices.length} invoice${invoices.length !== 1 ? "s" : ""} listed in the attached remittance advice.<br/><br/>Thank you for your partnership — please reach out if anything doesn't match your records.`,
      closing: b.name, // AP remittance — sign with the company name, not the casual greeting
    });

    const fromEmail = b.fromEmailBilling || b.fromEmailProduction || b.fromEmailQuotes;
    const resend = resendForSlug(b.slug);
    const { data: sent, error } = await resend.emails.send({
      from: `${b.name} <${fromEmail}>`,
      to: vendorEmail,
      cc: testRecipient ? undefined : ["jon@housepartydistro.com"],
      subject: `Payment processed — ${b.name}`,
      html,
      attachments: [{ filename: `${b.name.replace(/\s+/g, "-")}-Remittance-${today.replace(/\s|,/g, "")}.pdf`, content: pdf.toString("base64") }],
    });
    if (error) return NextResponse.json({ error: error.message || "Email send failed" }, { status: 500 });

    return NextResponse.json({ ok: true, sentTo: vendorEmail, invoices: invoices.length, total, messageId: (sent as any)?.id });
  } catch (e: any) {
    console.error("[qb/bill/notify] error", e?.message);
    return NextResponse.json({ error: e?.message || "Notify failed" }, { status: 500 });
  }
}
