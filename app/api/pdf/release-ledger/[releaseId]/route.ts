export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { contentDisposition } from "@/lib/pdf/filename";
import { isRerunLineId } from "@/lib/release-lanes";

// Pre-order ledger PDF (Continuum Phase 4, Aug 23 2026) — per product:
// sold per size, every buy job with its curve + landed, bought roll-up
// with coverage vs sold. Same derivations as the /drops ledger panel.

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ORDER = ["OSFA", "OS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const sum = (m: Record<string, unknown> | null | undefined) =>
  Object.values(m || {}).reduce((a: number, b) => a + (Number(b) || 0), 0);
const fmt = (n: number) => (n ? n.toLocaleString("en-US") : "·");
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

export async function GET(req: NextRequest, { params }: { params: { releaseId: string } }) {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = admin();
  const { data: release } = await db.from("releases")
    .select("id, title, window_close_date, target_live_date, clients(name)")
    .eq("id", params.releaseId).single();
  if (!release) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: slots } = await db.from("release_slots")
    .select("id, format, item_id, line_id, sold_qtys, overage_pct, sort_order, items!release_slots_item_id_fkey(name)")
    .eq("release_id", (release as any).id).order("sort_order");

  const lines: any[] = [];
  for (const s of (slots || []) as any[]) {
    const { data: buys } = await db.from("items")
      .select("id, received_qtys, buy_sheet_lines(size, qty_ordered), jobs!inner(job_number, phase, created_at)")
      .eq("release_slot_id", s.id);
    let runs = [...(buys || [])] as any[];
    const isPipe = s.item_id && !isRerunLineId(s.line_id);
    if (isPipe && !runs.some(b => b.id === s.item_id)) {
      const { data: it } = await db.from("items")
        .select("id, received_qtys, buy_sheet_lines(size, qty_ordered), jobs!inner(job_number, phase, created_at)")
        .eq("id", s.item_id).single();
      if (it) runs.push(it as any);
    }
    runs.sort((a, b) => String(a.jobs.created_at).localeCompare(String(b.jobs.created_at)));
    lines.push({
      name: s.format || s.items?.name || "Line",
      sold: s.sold_qtys || {},
      runs: runs.map(r => ({
        job: r.jobs.job_number,
        phase: String(r.jobs.phase || "").replace(/_/g, " "),
        ordered: Object.fromEntries((r.buy_sheet_lines || []).map((l: any) => [l.size, Number(l.qty_ordered) || 0])),
        landed: r.received_qtys || {},
      })),
    });
  }

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  let body = "";
  for (const line of lines) {
    const set = new Set<string>(Object.keys(line.sold));
    for (const r of line.runs) { Object.keys(r.ordered).forEach(x => set.add(x)); Object.keys(r.landed).forEach(x => set.add(x)); }
    const sizes = ORDER.filter(x => set.has(x)).concat(Array.from(set).filter(x => !ORDER.includes(x)));
    if (!sizes.length && !line.runs.length) continue;
    const bought: Record<string, number> = {}; const landed: Record<string, number> = {};
    for (const r of line.runs) {
      for (const [sz, v] of Object.entries(r.ordered)) bought[sz] = (bought[sz] || 0) + Number(v);
      for (const [sz, v] of Object.entries(r.landed)) landed[sz] = (landed[sz] || 0) + (Number(v) || 0);
    }
    const cells = (m: Record<string, number>) => sizes.map(sz => `<td class="n">${fmt(m[sz] || 0)}</td>`).join("");
    const runRows = line.runs.map((r: any, i: number) => `
      <tr class="run"><td>Buy ${i + 1} · <b>${esc(r.job)}</b> <span class="ph">${esc(r.phase)}</span></td>${cells(r.ordered)}<td class="n t">${fmt(sum(r.ordered))}</td><td class="n dim">${fmt(sum(r.landed))} landed</td></tr>`).join("");
    const cover = sum(bought) - sum(line.sold);
    body += `
    <section>
      <h2>${esc(line.name)}</h2>
      <table>
        <tr class="head"><th></th>${sizes.map(sz => `<th>${esc(sz)}</th>`).join("")}<th>TOTAL</th><th></th></tr>
        <tr class="sold"><td>Sold</td>${cells(line.sold)}<td class="n t">${fmt(sum(line.sold))}</td><td></td></tr>
        ${runRows}
        <tr class="tot"><td>Bought (all buys)</td>${cells(bought)}<td class="n t">${fmt(sum(bought))}</td><td class="n ${cover >= 0 ? "ok" : "bad"}">${cover >= 0 ? "+" : ""}${cover.toLocaleString()} vs sold</td></tr>
        <tr class="land"><td>Landed to date</td>${cells(landed)}<td class="n t">${fmt(sum(landed))}</td><td></td></tr>
      </table>
    </section>`;
  }
  const totalSold = lines.reduce((a, l) => a + sum(l.sold), 0);
  const totalBought = lines.reduce((a, l) => a + l.runs.reduce((x: number, r: any) => x + sum(r.ordered), 0), 0);

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: letter; margin: 0.55in 0.6in; }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #14161c; font-size: 10.5px; line-height: 1.45; }
    header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2.5px solid #14161c; padding-bottom: 10px; margin-bottom: 6px; }
    h1 { font-size: 21px; letter-spacing: -0.01em; text-transform: uppercase; }
    .meta { text-align: right; font-size: 9.5px; color: #5a6172; }
    .strip { display: flex; gap: 26px; padding: 9px 0 4px; font-size: 10px; color: #5a6172; }
    .strip b { color: #14161c; font-size: 13px; display: block; }
    section { margin-top: 16px; page-break-inside: avoid; }
    h2 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 5px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 4.5px 7px; text-align: left; }
    th { font-size: 8px; letter-spacing: 0.1em; color: #8a90a0; border-bottom: 1px solid #d6d9e0; }
    .n { text-align: right; font-variant-numeric: tabular-nums; font-family: 'SF Mono', Menlo, monospace; font-size: 10px; }
    .t { font-weight: 700; }
    tr.sold td { background: #f2f4f8; font-weight: 600; }
    tr.run td { border-bottom: 1px dotted #e2e5ec; color: #3c4250; }
    tr.run .ph { font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a90a0; margin-left: 4px; }
    tr.tot td { border-top: 1.5px solid #14161c; font-weight: 700; }
    tr.land td { color: #5a6172; }
    .dim { color: #8a90a0; }
    .ok { color: #1a7a2e; font-weight: 700; } .bad { color: #b3262e; font-weight: 700; }
    footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d6d9e0; font-size: 8.5px; color: #8a90a0; }
  </style></head><body>
  <header>
    <div><div style="font-size:9px;letter-spacing:0.14em;color:#8a90a0;text-transform:uppercase">House Party Distro · ${esc((release as any).clients?.name || "")}</div>
    <h1>${esc((release as any).title)} — Pre-Order Ledger</h1></div>
    <div class="meta">${(release as any).window_close_date ? `Window closes ${(release as any).window_close_date}<br>` : ""}Report generated ${today}</div>
  </header>
  <div class="strip">
    <div><b>${totalSold.toLocaleString()}</b>units sold</div>
    <div><b>${totalBought.toLocaleString()}</b>units bought</div>
    <div><b>${lines.length}</b>products</div>
  </div>
  ${body}
  <footer>Sold = Shopify sales by product variant, window-scoped. Bought = production quantities across all buy jobs. Landed = received at HPD. Generated from the OpsHub pre-order ledger.</footer>
  </body></html>`;

  const pdf = await generatePDF(html);
  return new NextResponse(pdf as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(`${(release as any).title} — Ledger.pdf`, req.nextUrl.searchParams.get("download")),
    },
  });
}
