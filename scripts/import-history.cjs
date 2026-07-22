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

// "NAME / BLANK / COLOR <tabs> S 7 • M 13 • L 3" → parts + size map.
// XXL/XXXL spellings normalize to 2XL/3XL. Lines that carry ONE size in the
// NAME ("… - 3XL") with the count in the qty column get a single-size curve.
// Size lists appear as "S 7 • M 13" AND "OS:70" (colon era). A parsed size
// map is TRUSTED only when it reconciles with the line qty (±5%) — QB
// truncates long descriptions mid-list and some lines count packs, so an
// unreconciled map would poison the curves. Untrusted → curve sits out;
// the line's qty still counts everywhere else.
const SIZE_TOKEN = /(?:^|[\s•\t(])((?:XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|OSFA|OS|YS|YM|YL|YXL))[\s:]+([\d,]+)(?=\s|•|$|\))/gi;
const ONE_SIZE = /(?:^|[\s\/\-–])((?:XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|OS|OSFA))(?:\s*$|[\s).])/;
const normSize = (s) => ({ XXL: "2XL", XXXL: "3XL" }[s.toUpperCase()] || s.toUpperCase());
// a real blank style has letters/digits and substance — "/", "-", "8", "YP"
// (severed fragments) are description artifacts, not styles. Canonical form
// is compact uppercase alnum ("NL 6210" = "NL6210" = "NL-6210" → NL6210) so
// spacing habits across six years of invoices can't split one style into
// three leaderboard rows.
const cleanStyle = (s) => {
  const t = String(s || "").trim().replace(/[\s/"'•]+$/g, "");
  if (t.length < 3 || !/[A-Za-z0-9]{2}/.test(t) || /^["'/\-–•]+$/.test(t)) return null;
  const canon = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return canon.length >= 3 ? canon : null;
};
function parseDesc(desc, lineQty) {
  const out = { product_name: null, blank_style: null, color: null, size_qtys: null };
  if (!desc) return out;
  const [head] = desc.split(/\t/); // sizes live after tab runs in the OpsHub format
  const parts = head.split(/\s+\/\s+/).map(s => s.trim()).filter(p => p && p !== "/");
  if (parts.length >= 3) { out.product_name = parts[0]; out.blank_style = cleanStyle(parts[1]); out.color = parts[2]; }
  else if (parts.length === 2) { out.product_name = parts[0]; out.blank_style = cleanStyle(parts[1]); }
  const sizes = {};
  let m;
  while ((m = SIZE_TOKEN.exec(desc)) !== null) {
    const n = num(m[2]);
    if (n != null && n > 0 && n <= 50000) sizes[normSize(m[1])] = (sizes[normSize(m[1])] || 0) + n;
  }
  if (!Object.keys(sizes).length && lineQty != null && lineQty > 0) {
    const one = ONE_SIZE.exec(head);
    if (one) sizes[normSize(one[1])] = lineQty;
  }
  if (Object.keys(sizes).length) {
    const sum = Object.values(sizes).reduce((a, n) => a + n, 0);
    const trusted = lineQty == null || lineQty <= 0 || Math.abs(sum - lineQty) <= Math.max(2, lineQty * 0.05);
    if (trusted) out.size_qtys = sizes;
  }
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
      const p = parseDesc(r[5] || "", num(r[6]));
      return {
        txn_date: usDate(r[1]), txn_type: r[2] || null, doc_num: r[3] || null,
        customer: (r[4] || "").trim() || null, description: r[5] || null,
        qty: num(r[6]), unit_price: num(r[7]), amount: num(r[8]),
        // category resolution (Jon: nothing dangles) — QB's "(deleted)" marks
        // a retired product/service DEFINITION; the sales are real and keep
        // their category. Group-less lines ($0 bookkeeping notes) get a home.
        product_group: (group || "Uncategorized").replace(/\s*\(deleted\)\s*/i, "").trim() || "Uncategorized",
        ...p, source_file: salesFile,
      };
    });

    // Customer spelling variants → one canonical name (most frequent spelling
    // wins). "Presample Depot" and "PreSampleDepot" are one relationship.
    const custKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(llc|inc|ltd)$/g, "");
    const spellings = new Map();
    for (const r of rows) {
      if (!r.customer) continue;
      const k = custKey(r.customer);
      const m = spellings.get(k) || new Map();
      m.set(r.customer, (m.get(r.customer) || 0) + 1);
      spellings.set(k, m);
    }
    const canonical = new Map();
    for (const [k, m] of spellings) {
      canonical.set(k, Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0]);
    }
    let renamed = 0;
    for (const r of rows) {
      if (!r.customer) continue;
      const c = canonical.get(custKey(r.customer));
      if (c && c !== r.customer) { r.customer = c; renamed++; }
    }
    if (renamed) console.log(`✓ customer spellings unified: ${renamed} lines folded into canonical names`);
    await insertBatched("history_sales", rows);
    const parsed = rows.filter(x => x.blank_style).length, sized = rows.filter(x => x.size_qtys).length;
    console.log(`✓ history_sales: ${rows.length} lines (${parsed} with blank style, ${sized} with size curves)`);

    // ── overlap stamp (Jon, Jul 22): the export runs through the OpsHub era.
    // Any line whose doc number matches a job's QB invoice number exists in
    // BOTH worlds — stamp it so aggregates read history OR live, never both.
    const jobMap = new Map();
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from("jobs").select("id, type_meta").range(from, from + 999);
      for (const j of data || []) {
        const n = j.type_meta && j.type_meta.qb_invoice_number;
        if (n) jobMap.set(String(n).trim(), j.id);
      }
      if (!data || data.length < 1000) break;
    }
    const nums = new Set(rows.map(r => String(r.doc_num || "").trim()).filter(Boolean));
    let stamped = 0;
    for (const n of nums) {
      if (!jobMap.has(n)) continue;
      const { count } = await db.from("history_sales")
        .update({ opshub_job_id: jobMap.get(n) }, { count: "exact" })
        .eq("source_file", salesFile).eq("doc_num", n);
      stamped += count || 0;
    }
    console.log(`✓ overlap stamped: ${stamped} lines match OpsHub jobs (excluded from aggregates)`);
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
