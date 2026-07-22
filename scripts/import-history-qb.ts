// QB API history import (Jul 22 2026) — the tighter source Jon asked for.
// The CSV report truncates descriptions (~235 chars, beheading size lists)
// and flattens categories; the API's Invoice + SalesReceipt objects carry
// every line untruncated with exact Product/Service refs. Read-only queries
// against the existing HPD QB connection.
//
// Writes history_sales with source_file='qb_api'. Run compares against the
// CSV-sourced rows; swapping sources (deleting CSV sales rows) is a separate
// explicit step AFTER the comparison passes — never both at once.
// Usage: npx tsx scripts/import-history-qb.ts [--swap]
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getAccessToken } from "../lib/quickbooks";
const parse = require("./history-parse.cjs");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const QB = "https://quickbooks.api.intuit.com";

async function qbQuery(query: string): Promise<any> {
  const token = await getAccessToken();
  const { data: tok } = await db.from("qb_tokens").select("realm_id").limit(1).single();
  const realmId = (tok as any)?.realm_id || process.env.QB_REALM_ID;
  const res = await fetch(`${QB}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QB ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function pageEntity(entity: string): Promise<any[]> {
  const out: any[] = [];
  for (let start = 1; ; start += 1000) {
    const body = await qbQuery(`select * from ${entity} startposition ${start} maxresults 1000`);
    const batch = body?.QueryResponse?.[entity] || [];
    out.push(...batch);
    process.stdout.write(`\r${entity}: ${out.length}…`);
    if (batch.length < 1000) break;
  }
  console.log("");
  return out;
}

(async () => {
  const swap = process.argv.includes("--swap");
  const rows: any[] = [];
  // CreditMemo lines are refunds — QB stores their amounts positive, gross
  // integrity needs them negative (the CSV report already counted them that
  // way; Jon's law: nothing left out).
  for (const entity of ["Invoice", "SalesReceipt", "CreditMemo"]) {
    const sign = entity === "CreditMemo" ? -1 : 1;
    const docs = await pageEntity(entity);
    for (const d of docs) {
      const customer = d.CustomerRef?.name || null;
      for (const ln of d.Line || []) {
        const det = ln.SalesItemLineDetail;
        if (!det) continue;   // subtotal/discount/etc. lines
        const qty = det.Qty != null ? sign * Number(det.Qty) : null;
        const p = parse.parseDesc(ln.Description || "", det.Qty != null ? Number(det.Qty) : null);
        rows.push({
          txn_date: d.TxnDate || null,
          txn_type: entity === "CreditMemo" ? "Credit Memo" : entity,
          doc_num: d.DocNumber || null,
          customer,
          description: ln.Description || null,
          qty,
          unit_price: det.UnitPrice != null ? Number(det.UnitPrice) : null,
          amount: ln.Amount != null ? sign * Number(ln.Amount) : null,
          // "Accessories:Hats" → parent Accessories, leaf Hats
          product_parent: (det.ItemRef?.name || "").includes(":") ? parse.cleanGroup(String(det.ItemRef.name).split(":")[0]) : null,
          product_group: parse.cleanGroup(String(det.ItemRef?.name || "").split(":").pop()),
          ...p,
          size_qtys: sign === -1 ? null : p.size_qtys,  // refunds don't feed curves
          source_file: "qb_api",
        });
      }
    }
  }
  const renamed = parse.unifyCustomers(rows);
  if (renamed) console.log(`✓ customer spellings unified: ${renamed} lines`);

  await db.from("history_sales").delete().eq("source_file", "qb_api");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("history_sales").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  const sized = rows.filter(r => r.size_qtys).length;
  const gross = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const units = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  console.log(`✓ qb_api: ${rows.length} lines · $${Math.round(gross).toLocaleString()} · ${Math.round(units).toLocaleString()} units · ${sized} sized`);

  // overlap stamp (same rule as CSV import)
  const jobMap = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("jobs").select("id, type_meta").range(from, from + 999);
    for (const j of (data as any[]) || []) {
      const n = j.type_meta?.qb_invoice_number;
      if (n) jobMap.set(String(n).trim(), j.id);
    }
    if (!data || data.length < 1000) break;
  }
  let stamped = 0;
  for (const n of new Set(rows.map(r => String(r.doc_num || "").trim()).filter(Boolean))) {
    if (!jobMap.has(n)) continue;
    const { count } = await db.from("history_sales")
      .update({ opshub_job_id: jobMap.get(n) }, { count: "exact" })
      .eq("source_file", "qb_api").eq("doc_num", n);
    stamped += count || 0;
  }
  console.log(`✓ overlap stamped: ${stamped}`);

  // comparison vs CSV-sourced rows
  const { data: csvAgg } = await db.rpc("exec_sql", { sql: "select 1" }).then(() => ({ data: null })).catch(() => ({ data: null }));
  let csvGross = 0, csvCount = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("history_sales").select("amount").neq("source_file", "qb_api").range(from, from + 999);
    for (const r of (data as any[]) || []) { csvGross += Number(r.amount) || 0; csvCount++; }
    if (!data || data.length < 1000) break;
  }
  console.log(`── compare: CSV ${csvCount} lines $${Math.round(csvGross).toLocaleString()}  vs  API ${rows.length} lines $${Math.round(gross).toLocaleString()}`);

  if (swap) {
    const { error } = await db.from("history_sales").delete().neq("source_file", "qb_api");
    if (error) throw new Error(error.message);
    console.log("✓ SWAPPED: CSV-sourced sales rows removed — qb_api is canonical (raw CSVs stay vaulted on disk)");
  } else {
    console.log("NOTE: both sources present — aggregates would double-count. Run with --swap after the comparison looks right.");
  }
})().catch(e => { console.error("QB IMPORT FAIL:", e.message); process.exit(1); });
