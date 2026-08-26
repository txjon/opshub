// Account statement (Aug 25 2026) — the "who owes us what, on one page"
// client-facing document. Numbers come from lib/ar (the ONE AR module) so
// the statement can never disagree with /invoices; this file only shapes
// them for the page and renders the PDF HTML (design locked from the
// hand-built Silencer Co statement Jon approved 2026-06-23).
import { buildAr, type InvoiceRow } from "@/lib/ar";
import type { PdfBranding } from "@/lib/branding";

export type StatementLine = {
  date: string;           // invoice date (ISO)
  invoiceNumber: string;
  customerPo: string;
  daysLate: number;       // >0 = past due (vs due date, else terms-derived expected)
  billed: number;
  balance: number;
};

export type StatementData = {
  clientName: string;
  attn: string;
  addressHtml: string;    // billing address with <br/> breaks
  contactEmail: string;   // shown under the address block
  terms: string;
  statementDate: string;  // "June 23, 2026"
  lines: StatementLine[];
  totalDue: number;
  pastDue: number;
  aging: { current: number; d30: number; d60: number; d90: number; d90plus: number };
};

const TERMS_LABELS: Record<string, string> = {
  prepaid: "Prepaid", deposit_balance: "50% Deposit / Balance",
  net_15: "Net 15", net_30: "Net 30", net_60: "Net 60", due_on_receipt: "Due on Receipt",
};

export const statementDaysLate = (r: InvoiceRow, now: Date) => {
  const anchor = r.dueDate || r.expectedDate;
  if (!anchor) return 0;
  return Math.floor((now.getTime() - new Date(anchor).getTime()) / 86400000);
};

/** Pull everything statement-worthy for one client. `db` must be a
 *  service-role client (routes are already auth-gated). */
export async function buildStatementData(db: any, clientId: string, now = new Date()): Promise<StatementData | { error: string }> {
  const [clientRes, jobsRes, paysRes, ssRes, contactsRes] = await Promise.all([
    db.from("clients").select("id, name, default_terms, billing_address, shipping_address").eq("id", clientId).single(),
    db.from("jobs").select("id, job_number, title, phase, client_id, payment_terms, target_ship_date, costing_summary, costing_data, type_meta, created_at, shipping_route, fulfillment_status, is_inventory, is_test, financial_closed_at").eq("client_id", clientId),
    db.from("payment_records").select("id, job_id, amount, status, due_date"),
    db.from("shipstation_reports").select("id, client_id, report_type, period_label, totals, postage_totals, qb_invoice_number, qb_total_with_tax, paid_at, paid_amount, sent_at, created_at").eq("client_id", clientId),
    db.from("contacts").select("name, email, role_label, is_primary").eq("client_id", clientId),
  ]);
  if (clientRes.error || !clientRes.data) return { error: clientRes.error?.message || "Client not found" };
  const client = clientRes.data as any;
  const jobs = (jobsRes.data || []) as any[];

  // Items only matter to buildAr for fully-shipped derivation (close-out),
  // which the statement doesn't surface — skip the fetch, pass empty maps.
  const jobIds = new Set(jobs.map(j => j.id));
  const paymentsByJob: Record<string, any[]> = {};
  for (const p of (paysRes.data || []) as any[]) if (jobIds.has(p.job_id)) (paymentsByJob[p.job_id] ||= []).push(p);

  const ar = buildAr({
    jobs, itemsByJob: {}, paymentsByJob,
    clients: [client], ssReports: ssRes.data || [], now,
  });
  const poByJob: Record<string, string> = {};
  for (const j of jobs) poByJob[j.id] = String((j.type_meta as any)?.client_po_number || "");

  const open = ar.rows.filter(r => r.clientId === clientId && r.balance > 0.01);
  const lines: StatementLine[] = open.map(r => ({
    date: r.date,
    invoiceNumber: r.invoiceNumber || r.jobNumber || "—",
    customerPo: r.stream === "job" ? poByJob[r.id] || "" : "",
    daysLate: statementDaysLate(r, now),
    billed: r.billed,
    balance: r.balance,
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const totalDue = lines.reduce((a, l) => a + l.balance, 0);
  const pastDue = lines.filter(l => l.daysLate > 0).reduce((a, l) => a + l.balance, 0);
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  for (const l of lines) {
    if (l.daysLate <= 0) aging.current += l.balance;
    else if (l.daysLate <= 30) aging.d30 += l.balance;
    else if (l.daysLate <= 60) aging.d60 += l.balance;
    else if (l.daysLate <= 90) aging.d90 += l.balance;
    else aging.d90plus += l.balance;
  }

  const contacts = (contactsRes.data || []) as any[];
  const billingContact = contacts.find(c => /bill|account|a\/?p/i.test(c.role_label || "")) || contacts.find(c => c.is_primary) || contacts[0];
  const addr = client.billing_address || client.shipping_address || "";
  const addressHtml = String(addr).split(/\n+/).map((s: string) => s.trim()).filter(Boolean).join("<br/>");

  return {
    clientName: client.name,
    attn: "Attn: Accounts Payable",
    addressHtml,
    contactEmail: billingContact?.email || "",
    terms: TERMS_LABELS[client.default_terms as string] || client.default_terms || "—",
    statementDate: now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }),
    lines, totalDue, pastDue, aging,
  };
}

const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
};

export function renderStatementHTML(data: StatementData, branding: PdfBranding): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;
  const monoFont = `'Courier New', monospace`;

  const rows = data.lines.map(l => `
    <tr>
      <td style="padding:11px 8px 11px 0;font-family:${monoFont};font-size:11px;color:#444;border-bottom:1px solid #eee">${fmtDate(l.date)}</td>
      <td style="padding:11px 8px;font-family:${monoFont};font-size:11px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #eee">${l.invoiceNumber}</td>
      <td style="padding:11px 8px;font-family:${monoFont};font-size:11px;color:#444;border-bottom:1px solid #eee">${l.customerPo || "—"}</td>
      <td style="padding:11px 8px;font-size:10.5px;font-weight:700;color:${l.daysLate > 0 ? "#c0392b" : "#888"};border-bottom:1px solid #eee">${l.daysLate > 0 ? `${l.daysLate} days` : "Current"}</td>
      <td style="padding:11px 8px;text-align:right;font-family:${monoFont};font-size:11px;color:#444;border-bottom:1px solid #eee">${fmtD(l.billed)}</td>
      <td style="padding:11px 0 11px 8px;text-align:right;font-family:${monoFont};font-size:11px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #eee">${fmtD(l.balance)}</td>
    </tr>`).join("");

  const agingCell = (label: string, amt: number, hot: boolean) => `
    <td style="width:20%;text-align:center;padding:12px 6px;border-right:1px solid #eee">
      <div style="font-size:8px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#999;margin-bottom:5px">${label}</div>
      <div style="font-family:${monoFont};font-size:12px;font-weight:700;color:${amt > 0.01 ? (hot ? "#c0392b" : "#1a1a1a") : "#ccc"}">${amt > 0.01 ? fmtD(amt) : "—"}</div>
    </td>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>@page{margin:0}</style></head>
  <body style="margin:0;padding:48px 56px;font-family:${font};color:#1a1a1a;max-width:780px;margin:0 auto">
    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="vertical-align:top">
        ${branding.logoSvg}
        <div style="font-size:10px;color:#666;line-height:1.7">${branding.headerAddressHtml}${branding.fromEmailBilling ? `<br/>${branding.fromEmailBilling}` : ""}</div>
      </td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:26px;font-weight:800;letter-spacing:0.12em;color:#1a1a1a">STATEMENT</div>
        <table style="margin-left:auto;margin-top:10px;border-collapse:collapse;font-size:10.5px">
          <tr><td style="color:#999;padding:2px 10px 2px 0;text-align:right">Statement Date</td><td style="font-weight:700;text-align:right">${data.statementDate}</td></tr>
          <tr><td style="color:#999;padding:2px 10px 2px 0;text-align:right">Account</td><td style="font-weight:700;text-align:right">${data.clientName}</td></tr>
          <tr><td style="color:#999;padding:2px 10px 2px 0;text-align:right">Terms</td><td style="font-weight:700;text-align:right">${data.terms}</td></tr>
        </table>
      </td>
    </tr></table>

    <div style="border-top:3px solid #1a1a1a;margin:22px 0 26px"></div>

    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="vertical-align:top;width:55%">
        <div style="font-size:8.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#999;margin-bottom:8px">Statement For</div>
        <div style="font-size:14px;font-weight:700">${data.clientName}</div>
        <div style="font-size:11px;color:#555;line-height:1.7;margin-top:3px">${data.attn}${data.addressHtml ? `<br/>${data.addressHtml}` : ""}</div>
        ${data.contactEmail ? `<div style="font-size:10.5px;color:#aaa;margin-top:4px">${data.contactEmail}</div>` : ""}
      </td>
      <td style="vertical-align:top">
        <div style="border:1.5px solid #1a1a1a;border-radius:10px;padding:18px 22px;text-align:center">
          <div style="font-size:8.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#999;margin-bottom:6px">Total Amount Due</div>
          <div style="font-family:${monoFont};font-size:30px;font-weight:800;letter-spacing:-0.02em">${fmtD(data.totalDue)}</div>
          <div style="font-size:10px;color:#666;margin-top:6px">${data.lines.length} open invoice${data.lines.length === 1 ? "" : "s"}${data.pastDue > 0.01 ? ` · <span style="color:#c0392b;font-weight:700">${fmtD(data.pastDue)} past due</span>` : ""}</div>
        </div>
      </td>
    </tr></table>

    <table style="width:100%;border-collapse:collapse;margin-top:30px">
      <thead><tr>
        ${["Date", "Invoice", "Customer PO", "Status", "Amount", "Balance Due"].map((h, i) => `<th style="font-size:8px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#999;text-align:${i >= 4 ? "right" : "left"};padding:0 8px 8px ${i === 0 ? "0" : "8px"};border-bottom:2px solid #1a1a1a">${h}</th>`).join("")}
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="4"></td>
        <td style="padding:14px 8px;text-align:right;font-size:11px;font-weight:800;letter-spacing:0.06em">TOTAL DUE</td>
        <td style="padding:14px 0 14px 8px;text-align:right;font-family:${monoFont};font-size:14px;font-weight:800">${fmtD(data.totalDue)}</td>
      </tr></tfoot>
    </table>

    <div style="margin-top:26px">
      <div style="font-size:8.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#999;margin-bottom:8px">Aging Summary</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px"><tr>
        ${agingCell("Current", data.aging.current, false)}
        ${agingCell("1–30 Days", data.aging.d30, true)}
        ${agingCell("31–60 Days", data.aging.d60, true)}
        ${agingCell("61–90 Days", data.aging.d90, true)}
        ${agingCell("90+ Days", data.aging.d90plus, true).replace('border-right:1px solid #eee', 'border-right:none')}
      </tr></table>
    </div>

    <div style="border-top:1px solid #eee;margin-top:38px;padding-top:18px;text-align:center">
      <div style="font-size:11.5px;font-weight:700;margin-bottom:8px">Thank you for your business.</div>
      <div style="font-size:9.5px;color:#999;line-height:1.9">Remit to ${branding.name} · ${branding.headerAddressHtml.replace(/<br\/>/g, ", ")}<br/>Please reference your invoice number with payment${branding.fromEmailBilling ? ` · Questions? ${branding.fromEmailBilling}` : ""}</div>
    </div>
  </body></html>`;
}
