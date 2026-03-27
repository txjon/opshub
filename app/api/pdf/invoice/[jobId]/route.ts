export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";

const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
const sortSizes = (sizes: string[]) => [...sizes].sort((a, b) => {
  const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1; if (bi === -1) return -1;
  return ai - bi;
});

const HPD_LOGO_SVG = `<svg style="height:28px;display:block" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227.14 28.53"><g><path fill="#000000" d="M15.48,14.1v8.5c0,.13-.11.24-.24.24h-4.51c-.13,0-.24-.11-.24-.24v-8.27c0-.56-.03-1.2-.27-1.72-.11-.22-.25-.4-.42-.54-.28-.22-.65-.33-1.12-.33-.87,0-1.54.3-1.76.78-.24.52-.24,1.24-.24,1.81v8.27c0,.13-.11.24-.24.24H1.93c-.13,0-.24-.11-.24-.24V3.21c0-.13.11-.24.24-.24h4.22c.13,0,.24.11.24.24v5.17c0,.1.11.15.19.1,3.4-2.34,6.72.26,6.75.29.12.09.24.2.34.3h0c1.54,1.55,1.8,2.81,1.8,5.03Z"/><path fill="#000000" d="M31.55,15.4c0,4.36-3.6,7.91-8.02,7.91s-8.02-3.55-8.02-7.91,3.6-7.91,8.02-7.91,8.02,3.55,8.02,7.91ZM27.02,15.4c0-1.9-1.57-3.45-3.5-3.45s-3.5,1.55-3.5,3.45,1.57,3.45,3.5,3.45,3.5-1.55,3.5-3.45Z"/><path fill="#000000" d="M225.19,14.8c0,4.74-3.91,8.6-8.72,8.6s-8.72-3.86-8.72-8.6,3.91-8.6,8.72-8.6,8.72,3.86,8.72,8.6ZM220.27,14.8c0-2.07-1.71-3.75-3.8-3.75s-3.8,1.68-3.8,3.75,1.71,3.75,3.8,3.75,3.8-1.68,3.8-3.75Z"/></g></svg>`;

function renderInvoiceHTML(data: any): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;
  const mono = `ui-monospace, monospace`;

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Build item rows
  const itemRows = data.items.map((item: any, i: number) => {
    const sizes = sortSizes(Object.keys(item.qtys).filter((sz: string) => (item.qtys[sz] || 0) > 0));
    const sizeStr = sizes.map((sz: string) => `${sz} ${item.qtys[sz]}`).join("  ·  ");
    return `
      <tr style="border-bottom:0.5px solid #e8e8e8">
        <td style="padding:8px 10px;font-weight:600">${String.fromCharCode(65 + i)}</td>
        <td style="padding:8px 10px">
          <div style="font-weight:600">${item.name}</div>
          <div style="font-size:9px;color:#888;margin-top:2px">${[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ")}</div>
          ${sizeStr ? `<div style="font-size:8.5px;color:#999;margin-top:3px">${sizeStr}</div>` : ""}
        </td>
        <td style="padding:8px 10px;text-align:center;font-family:${mono}">${item.totalQty.toLocaleString()}</td>
        <td style="padding:8px 10px;text-align:right;font-family:${mono}">${fmtD(item.sellPerUnit)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;font-family:${mono}">${fmtD(item.lineTotal)}</td>
      </tr>`;
  }).join("");

  // Payment history
  const paymentRows = data.payments.length > 0 ? `
    <div style="margin-top:20px">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:8px">Payment History</div>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead>
          <tr style="border-bottom:0.5px solid #ccc">
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600">Type</th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600">Invoice</th>
            <th style="text-align:right;padding:4px 8px;color:#888;font-weight:600">Amount</th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600">Status</th>
            <th style="text-align:left;padding:4px 8px;color:#888;font-weight:600">Due</th>
          </tr>
        </thead>
        <tbody>
          ${data.payments.map((p: any) => `
            <tr style="border-bottom:0.5px solid #eee">
              <td style="padding:4px 8px;text-transform:capitalize">${p.type.replace(/_/g, " ")}</td>
              <td style="padding:4px 8px;font-family:${mono};color:#888">${p.invoice_number || "—"}</td>
              <td style="padding:4px 8px;text-align:right;font-family:${mono};font-weight:600">${fmtD(p.amount)}</td>
              <td style="padding:4px 8px;text-transform:capitalize;color:${p.status === "paid" ? "#27500A" : p.status === "overdue" ? "#791F1F" : "#633806"}">${p.status}</td>
              <td style="padding:4px 8px;color:#888">${p.due_date ? new Date(p.due_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:780px;margin:0 auto">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #1a1a1a;margin-bottom:18px">
    <div>
      ${HPD_LOGO_SVG}
      <div style="font-size:11px;color:#666;line-height:1.7;margin-top:8px">
        3945 W Reno Ave, Ste A · Las Vegas, NV 89118<br/>jon@housepartydistro.com
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a">INVOICE</div>
      <div style="font-size:10px;color:#888;margin-top:4px">${data.job_number || ""}</div>
    </div>
  </div>

  <div style="display:flex;gap:0;border:0.5px solid #ccc;margin-bottom:16px">
    ${[
      ["Date", today],
      ["Terms", data.payment_terms || "—"],
      ["Ship Date", data.target_ship_date ? new Date(data.target_ship_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"],
      ["Project", data.job_title || "—"],
    ].map(([k, v], i, arr) => `<div style="flex:1;padding:5px 8px;${i < arr.length - 1 ? "border-right:0.5px solid #ccc" : ""}"><div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:2px">${k}</div><div style="font-size:10px;font-weight:600;color:#1a1a1a">${v}</div></div>`).join("")}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;font-size:10px">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">From</div>
      <div style="line-height:1.7">House Party Distro<br/>3945 W Reno Ave, Ste A<br/>Las Vegas, NV 89118<br/>jon@housepartydistro.com</div>
    </div>
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">Bill To</div>
      <div style="line-height:1.7">
        ${data.client_name}
        ${data.client_contact ? `<br/>${data.client_contact}` : ""}
        ${data.client_email ? `<br/>${data.client_email}` : ""}
      </div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:4px">
    <thead>
      <tr style="background:#222;color:#fff">
        <th style="padding:6px 10px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:0.05em;width:30px"></th>
        <th style="padding:6px 10px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:0.05em">Item</th>
        <th style="padding:6px 10px;text-align:center;font-size:8.5px;text-transform:uppercase;letter-spacing:0.05em;width:60px">Qty</th>
        <th style="padding:6px 10px;text-align:right;font-size:8.5px;text-transform:uppercase;letter-spacing:0.05em;width:80px">Unit Price</th>
        <th style="padding:6px 10px;text-align:right;font-size:8.5px;text-transform:uppercase;letter-spacing:0.05em;width:90px">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div style="display:flex;justify-content:flex-end;margin-bottom:20px">
    <div style="width:240px">
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid #eee">
        <span style="color:#888;font-size:10px">Subtotal</span>
        <span style="font-family:${mono};font-weight:600">${fmtD(data.subtotal)}</span>
      </div>
      ${data.totalPaid > 0 ? `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid #eee">
        <span style="color:#27500A;font-size:10px">Paid</span>
        <span style="font-family:${mono};font-weight:600;color:#27500A">-${fmtD(data.totalPaid)}</span>
      </div>` : ""}
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #1a1a1a;margin-top:4px">
        <span style="font-weight:800;font-size:11px">${data.balanceDue > 0 ? "Balance Due" : "Total"}</span>
        <span style="font-family:${mono};font-weight:800;font-size:14px">${fmtD(data.balanceDue > 0 ? data.balanceDue : data.subtotal)}</span>
      </div>
    </div>
  </div>

  ${paymentRows}

  <div style="border-top:0.5px solid #ddd;padding-top:10px;margin-top:24px;font-size:7.5px;color:#aaa;line-height:1.6">
    <strong style="font-size:8px;font-weight:700;color:#888;display:block;margin-bottom:3px">Payment Information</strong>
    Please make payments to House Party Distro. For questions regarding this invoice, contact jon@housepartydistro.com.
  </div>

</div>
</body></html>`;
}

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  // Auth check
  const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!internal) {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const { jobId } = params;

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*, clients(name, default_terms)")
      .eq("id", jobId)
      .single();

    if (jobError || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const { data: items } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered)")
      .eq("job_id", jobId)
      .order("sort_order");

    const { data: payments } = await supabase
      .from("payment_records")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at");

    const { data: contacts } = await supabase
      .from("job_contacts")
      .select("*, contacts(*)")
      .eq("job_id", jobId);

    const primaryContact = contacts?.find((jc: any) => jc.role_on_job === "primary")?.contacts;

    const costingData = job.costing_data || {};
    const costProds = costingData.costProds || [];

    const mappedItems = (items || []).map((it: any) => {
      const qtys: Record<string, number> = {};
      for (const l of (it.buy_sheet_lines || [])) { qtys[l.size] = l.qty_ordered || 0; }
      const totalQty = Object.values(qtys).reduce((a: number, v: any) => a + v, 0);
      const cp = costProds.find((p: any) => p.id === it.id);
      const sellPerUnit = cp?._sellPerUnit || it.sell_per_unit || 0;
      return {
        name: it.name,
        blank_vendor: it.blank_vendor,
        blank_sku: it.blank_sku,
        qtys,
        totalQty,
        sellPerUnit,
        lineTotal: sellPerUnit * totalQty,
      };
    }).filter((it: any) => it.totalQty > 0);

    const subtotal = mappedItems.reduce((a: number, it: any) => a + it.lineTotal, 0);
    const totalPaid = (payments || []).filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + p.amount, 0);

    const invoiceData = {
      job_number: job.job_number,
      job_title: job.title,
      client_name: (job.clients as any)?.name || "—",
      client_contact: primaryContact?.name || "",
      client_email: primaryContact?.email || "",
      payment_terms: (job.payment_terms || "").replace(/_/g, " "),
      target_ship_date: job.target_ship_date,
      items: mappedItems,
      payments: payments || [],
      subtotal,
      totalPaid,
      balanceDue: subtotal - totalPaid,
    };

    const html = renderInvoiceHTML(invoiceData);
    const pdfBuffer = await generatePDF(html);

    const slug = (job.title || jobId).replace(/\s+/g, "-");
    const filename = `HPD-Invoice-${job.job_number}-${slug}.pdf`;

    const isDownload = req.nextUrl.searchParams.get("download");
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[PDF Invoice Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}
