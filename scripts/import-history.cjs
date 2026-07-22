#!/usr/bin/env node
/**
 * Import pre-OpsHub QB exports into history_sales / history_vendor_costs.
 * Source: ~/opshub-history/raw/ (raw files stay untouched).
 * Idempotent: wipes rows for each source_file before reloading it.
 *
 * Parses QB grouped-detail layout (title rows → header row → group rows with
 * only col A → detail rows with a date). Sales descriptions in the OpsHub
 * era carry "NAME / BLANK / COLOR ... S 7 • M 13" — parsed into columns,
 * raw description always kept.
 */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const os = require("os");
require("dotenv").config({ path: ".env.local" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RAW = path.join(os.homedir(), "opshub-history", "raw");

// Minimal CSV parser (quoted fields, embedded commas/newlines)
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const num = (s) => {
  const n = Number(String(s || "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && String(s || "").trim() !== "" ? n : null;
};
const usDate = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || "").trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};

// "NAME / BLANK / COLOR <tabs> S 7 • M 13 • L 3" → parts + size map
const SIZE_TOKEN = /(?:^|[\s•\t])((?:XS|S|M|L|XL|2XL|3XL|4XL|5XL|OSFA|OS|YS|YM|YL|YXL))\s+([\d,]+)(?=\s|•|$)/gi;
function parseDesc(desc) {
  const out = { product_name: null, blank_style: null, color: null, size_qtys: null };
  if (!desc) return out;
  const [head] = desc.split(/\t/); // sizes live after tab runs in the OpsHub format
  const parts = head.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) { out.product_name = parts[0]; out.blank_style = parts[1]; out.color = parts[2]; }
  else if (parts.length === 2) { out.product_name = parts[0]; out.blank_style = parts[1]; }
  const sizes = {};
  let m;
  while ((m = SIZE_TOKEN.exec(desc)) !== null) {
    const n = num(m[2]);
    if (n != null && n > 0) sizes[m[1].toUpperCase()] = (sizes[m[1].toUpperCase()] || 0) + n;
  }
  if (Object.keys(sizes).length) out.size_qtys = sizes;
  return out;
}

function walkGrouped(rows) {
  const hdr = rows.findIndex(r => r.length > 2 && r[1] === "Transaction date");
  const out = []; const stack = [];
  for (const r of rows.slice(hdr + 1)) {
    if (r.length < 10) continue;
    const a = (r[0] || "").trim();
    if (a && !(r[1] || "").trim()) {
      if (/^total/i.test(a)) { stack.pop(); continue; }
      stack.push(a);
    } else if ((r[1] || "").trim()) {
      out.push({ group: stack[stack.length - 1] || null, r });
    }
  }
  return out;
}

async function insertBatched(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

(async () => {
  // ── SALES ──
  const salesFile = fs.readdirSync(RAW).find(f => /Sales by Product/i.test(f));
  if (salesFile) {
    const details = walkGrouped(parseCsv(fs.readFileSync(path.join(RAW, salesFile), "utf8")));
    await db.from("history_sales").delete().eq("source_file", salesFile);
    const rows = details.map(({ group, r }) => {
      const p = parseDesc(r[5] || "");
      return {
        txn_date: usDate(r[1]), txn_type: r[2] || null, doc_num: r[3] || null,
        customer: (r[4] || "").trim() || null, description: r[5] || null,
        qty: num(r[6]), unit_price: num(r[7]), amount: num(r[8]),
        product_group: group, ...p, source_file: salesFile,
      };
    });
    await insertBatched("history_sales", rows);
    const parsed = rows.filter(x => x.blank_style).length, sized = rows.filter(x => x.size_qtys).length;
    console.log(`✓ history_sales: ${rows.length} lines (${parsed} with blank style, ${sized} with size curves)`);
  }

  // ── PURCHASES ──
  const purchFile = fs.readdirSync(RAW).find(f => /Purchases by Vendor/i.test(f));
  if (purchFile) {
    const details = walkGrouped(parseCsv(fs.readFileSync(path.join(RAW, purchFile), "utf8")));
    await db.from("history_vendor_costs").delete().eq("source_file", purchFile);
    const rows = details
      .filter(({ r }) => !/^bill payment/i.test(r[2] || ""))   // payments aren't costs
      .map(({ group, r }) => ({
        txn_date: usDate(r[1]), txn_type: r[2] || null, doc_num: r[3] || null,
        vendor: group, description: r[5] || null,
        qty: num(r[6]), rate: num(r[7]), amount: num(r[8]),
        source_file: purchFile,
      }));
    await insertBatched("history_vendor_costs", rows);
    console.log(`✓ history_vendor_costs: ${rows.length} lines across vendors`);
  }
})().catch(e => { console.error("IMPORT FAIL:", e.message); process.exit(1); });
