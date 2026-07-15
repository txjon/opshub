export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { contentDisposition } from "@/lib/pdf/filename";
import { getPdfBranding } from "@/lib/branding";

// Decorator price-sheet PDF — same house style as Quote/PO. Renders the
// decorator's pricing_data (screen-print matrix, tag, minimums, setup,
// specialty, finishing, packaging) under the company's branded header.
// Linked from a "Pricing PDF" button on each decorator profile (shown only
// when pricing_data is loaded).

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif`;
const fmtD = (n: any) => (n === null || n === undefined || isNaN(Number(n))) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sectionLabel = (t: string) => `<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin:16px 0 7px">${esc(t)}</div>`;

function matrixTable(qtys: any[], prices: any, tagPrices?: any): string {
  const colorCounts = Object.keys(prices || {}).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (!qtys.length || !colorCounts.length) return "";
  const head = `<tr><th style="text-align:left;padding:5px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#999;border-bottom:1px solid #e5e7eb">Colors</th>${qtys.map(q => `<th style="text-align:right;padding:5px 10px;font-size:11px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #e5e7eb;font-family:monospace">${Number(q).toLocaleString()}</th>`).join("")}</tr>`;
  const rows = colorCounts.map(cc => {
    const arr = Array.isArray(prices[cc]) ? prices[cc] : [];
    return `<tr><td style="padding:4px 10px;font-size:12px;color:#1a1a1a;border-bottom:0.5px solid #f0f0f0;white-space:nowrap">${cc} color${cc > 1 ? "s" : ""}</td>${qtys.map((_, i) => `<td style="padding:4px 10px;text-align:right;font-size:12px;font-family:monospace;color:#444;border-bottom:0.5px solid #f0f0f0">${fmtD(arr[i])}</td>`).join("")}</tr>`;
  }).join("");
  // Neck-label prints share the same quantity tiers — show as one more row
  // under the color rows (no repeated header), set off by a top border.
  const tagArr = Array.isArray(tagPrices) ? tagPrices : [];
  const tagLine = tagArr.length
    ? `<tr><td style="padding:4px 10px;font-size:12px;color:#1a1a1a;border-top:1px solid #d1d5db;border-bottom:0.5px solid #f0f0f0;white-space:nowrap">Neck Label</td>${qtys.map((_, i) => `<td style="padding:4px 10px;text-align:right;font-size:12px;font-family:monospace;color:#444;border-top:1px solid #d1d5db;border-bottom:0.5px solid #f0f0f0">${fmtD(tagArr[i])}</td>`).join("")}</tr>`
    : "";
  return `<table style="width:100%;border-collapse:collapse;font-family:${FONT}">${head}${rows}${tagLine}</table><div style="font-size:10px;color:#999;margin-top:5px;text-align:right">Per-print, by quantity tier. Columns are tier minimums.</div>`;
}

const kvRowHtml = (label: string, value: any) => `<tr><td style="padding:7px 10px;font-size:12px;color:#1a1a1a;border-bottom:0.5px solid #f0f0f0">${esc(label)}</td><td style="padding:7px 10px;text-align:right;font-size:12px;font-family:monospace;color:#444;border-bottom:0.5px solid #f0f0f0">${fmtD(value)}</td></tr>`;
const kvKeys = (obj: any): string[] => Object.keys(obj || {}).filter(k => obj[k] !== null && obj[k] !== undefined && obj[k] !== "");

function kvTable(obj: any, labels: Record<string, string> = {}): string {
  const keys = kvKeys(obj);
  if (!keys.length) return "";
  return `<table style="width:100%;border-collapse:collapse;font-family:${FONT}">${keys.map(k => kvRowHtml(labels[k] || k, obj[k])).join("")}</table>`;
}

// Same data, split into two side-by-side columns — for long sections (e.g.
// Specialty) so they don't run tall and break across pages. Falls back to a
// single column for short lists (< 4 rows).
function kvTableTwoCol(obj: any, labels: Record<string, string> = {}): string {
  const keys = kvKeys(obj);
  if (!keys.length) return "";
  if (keys.length < 4) return kvTable(obj, labels);
  const mid = Math.ceil(keys.length / 2);
  const col = (ks: string[]) => `<table style="width:100%;border-collapse:collapse;font-family:${FONT}">${ks.map(k => kvRowHtml(labels[k] || k, obj[k])).join("")}</table>`;
  // Left column slightly narrower so the wider right column fits longer labels
  // (e.g. "Fleece Upcharge") on one line.
  return `<div style="display:grid;grid-template-columns:0.8fr 1.2fr;gap:0 32px;align-items:start"><div>${col(keys.slice(0, mid))}</div><div>${col(keys.slice(mid))}</div></div>`;
}

function buildHtml(dec: any, pd: any, branding: any): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const qtys = Array.isArray(pd.qtys) ? pd.qtys : [];
  const prices = (pd.prices && typeof pd.prices === "object") ? pd.prices : {};

  // Friendly labels for technical pricing_data keys.
  const MIN_LABELS: Record<string, string> = { print: "Print", tagPrint: "Neck Label" };
  const SETUP_LABELS: Record<string, string> = { Seps: "Separations (per screen)", Screens: "Screens (every order)", "Tag Screens": "Neck Label Screens (one time - per size)" };

  const printTbl = matrixTable(qtys, prices, pd.tagPrices);
  const screenPrint = printTbl ? sectionLabel("Screen Print — per print") + printTbl : "";

  const minsTbl = kvTable(pd.minimums, MIN_LABELS);
  const minsSec = minsTbl ? sectionLabel("Less than minimum — flat rate per print location") + minsTbl : "";
  const setupTbl = kvTable(pd.setup, SETUP_LABELS);
  const setupSec = setupTbl ? sectionLabel("Setup Fees") + setupTbl : "";
  const finishingTbl = kvTable(pd.finishing);
  const finishingSec = finishingTbl ? sectionLabel("Finishing") + finishingTbl : "";
  const packagingTbl = kvTable(pd.packaging);
  const packagingSec = packagingTbl ? sectionLabel("Packaging") + packagingTbl : "";
  const specialtyTbl = kvTableTwoCol(pd.specialty);
  const specialtySec = specialtyTbl ? `<div style="break-inside:avoid;page-break-inside:avoid">${sectionLabel("Specialty Upcharges — per print")}${specialtyTbl}</div>` : "";

  // Below Screen Print + Neck Label: a 50/50 row, then a 3-up row.
  //   Row 1 — left: Setup Fees   ·   right: Less-than-minimum, Finishing
  //   Row 2 — Packaging (1 col) + Specialty Upcharges (spans the other 2, split)
  const leftCol = [setupSec].filter(Boolean).join("");
  const rightCol = [minsSec, finishingSec].filter(Boolean).join("");
  const twoCol = (leftCol || rightCol)
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 32px;align-items:start"><div>${leftCol}</div><div>${rightCol}</div></div>`
    : "";

  // Packaging (left half) + Specialty (right half) share one line. Specialty is
  // condensed into the right 50%, split into two narrow columns within it.
  const bottomRow = (packagingSec && specialtySec)
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 32px;align-items:start;break-inside:avoid;page-break-inside:avoid"><div>${packagingSec}</div><div>${specialtySec}</div></div>`
    : [packagingSec, specialtySec].filter(Boolean).join("");

  const body = [screenPrint, twoCol, bottomRow].filter(Boolean).join("")
    || `<div style="padding:40px 0;text-align:center;color:#999;font-size:13px">No pricing on file for this decorator.</div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: ${FONT}; font-size: 11px; color: #1a1a1a; background: white; margin: 0; }</style></head>
<body><div style="background:#fff;font-family:${FONT};color:#111;max-width:780px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:0.5px solid #e5e7eb">
    <div>
      ${branding.logoSvg || ""}
      <div style="font-size:11px;color:#666;line-height:1.7;margin-top:8px">${(branding.headerAddressHtml || "").replace(/<br\/>/g, " · ")}${branding.fromEmailProduction ? `<br/>${branding.fromEmailProduction}` : ""}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#aaa;margin-bottom:6px">Price Sheet</div>
      <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;margin-bottom:6px">${esc(dec.name)}</div>
      <div style="font-size:11px;color:#666;line-height:1.8">${today}</div>
    </div>
  </div>
  ${body}
  <div style="margin-top:22px;padding-top:14px;border-top:0.5px solid #e5e7eb;font-size:10px;color:#999;line-height:1.6">
    Internal decorator pricing — ${esc(branding.name || "House Party Distro")}. Generated ${today}.
  </div>
</div></body></html>`;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // Auth — internal server calls or a logged-in team member.
  const internal = _req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!internal) {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const { data: dec, error } = await supabase
      .from("decorators")
      .select("name, short_code, pricing_data")
      .eq("id", params.id)
      .single();
    if (error || !dec) return NextResponse.json({ error: "Decorator not found" }, { status: 404 });

    const branding = await getPdfBranding();
    const html = buildHtml(dec, (dec as any).pricing_data || {}, branding);
    const pdfBuffer = await generatePDF(html);

    const slug = ((dec as any).name || "decorator").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
    const filename = `${slug}-Price-Sheet.pdf`;
    const isDownload = _req.nextUrl.searchParams.get("download");

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(filename, isDownload),
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to generate price sheet" }, { status: 500 });
  }
}
