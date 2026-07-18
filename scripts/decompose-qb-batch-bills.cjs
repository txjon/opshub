#!/usr/bin/env node
/**
 * Batch-bill decomposition (Jon, 2026-07-17): vendors like Icon invoice
 * per-job in OpsHub but get paid via BATCH bills in QB. For each unclaimed
 * QB bill, find a subset of un-pushed OpsHub bill groups that sums EXACTLY
 * (to the cent) to the bill total — exact multi-invoice decomposition is
 * overwhelming evidence, unlike tolerance matching. Stamps qb_bill_id +
 * qb_paid_at (real BillPayment date) on every member.
 *
 * TIME FENCE: candidate bills restricted to TxnDate >= 2026-01-01 — the
 * unfenced run matched 2021-2023 bills to 2026 invoices via coincidental
 * exact sums (subset-sum against 1000+ bills WILL false-positive without a
 * chronology constraint).
 *
 * Dry-run by default. Usage: npx -y tsx scripts/decompose-qb-batch-bills.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const REALM = process.env.QB_REALM_ID;
const QB_BASE = "https://quickbooks.api.intuit.com";

function subsetExact(targetCents, items) {
  // DP over cents; first exact hit wins. Items = [{c, ...}]
  const dp = new Map([[0, []]]);
  for (const it of items) {
    for (const [sum, combo] of Array.from(dp.entries())) {
      const ns = sum + it.c;
      if (ns <= targetCents && !dp.has(ns)) dp.set(ns, [...combo, it]);
    }
    if (dp.has(targetCents)) break;
  }
  return dp.get(targetCents) || null;
}

async function main() {
  const { getAccessToken } = await import("../lib/quickbooks.ts");
  const token = await getAccessToken();
  const qbGet = async (path) => {
    const r = await fetch(`${QB_BASE}/v3/company/${REALM}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`QB ${r.status}`);
    return r.json();
  };
  const qbQuery = async (q) => (await qbGet(`/query?query=${encodeURIComponent(q)}`))?.QueryResponse || {};

  const [{ data: entries }, { data: vendors }] = await Promise.all([
    sb.from("cost_entries").select("id, vendor_id, vendor_invoice_number, amount, bill_group_id").is("qb_bill_id", null).eq("source", "decorator_invoice"),
    sb.from("ap_vendors").select("id, name, qb_vendor_id").not("qb_vendor_id", "is", null),
  ]);
  // groups per vendor
  const byVendor = new Map();
  for (const e of entries || []) {
    const v = (vendors || []).find(x => x.id === e.vendor_id);
    if (!v) continue;
    if (!byVendor.has(v.id)) byVendor.set(v.id, { v, groups: new Map() });
    const gm = byVendor.get(v.id).groups;
    const k = e.bill_group_id || ("inv::" + (e.vendor_invoice_number || e.id));
    if (!gm.has(k)) gm.set(k, { k, inv: e.vendor_invoice_number, ids: [], total: 0 });
    const g = gm.get(k); g.ids.push(e.id); g.total += Number(e.amount) || 0;
  }
  const { data: claimedRows } = await sb.from("cost_entries").select("qb_bill_id").not("qb_bill_id", "is", null);
  const claimed = new Set((claimedRows || []).map(c => c.qb_bill_id));

  let totalLinked = 0, totalAmt = 0;
  for (const { v, groups } of byVendor.values()) {
    let pool = Array.from(groups.values()).map(g => ({ ...g, c: Math.round(g.total * 100) })).filter(g => g.c > 0);
    if (!pool.length) continue;
    // paginate this vendor's bills
    let bills = [], start = 1;
    while (true) {
      const res = (await qbQuery(`select Id, DocNumber, TotalAmt, Balance, TxnDate from Bill where VendorRef = '${v.qb_vendor_id}' and TxnDate >= '2026-01-01' STARTPOSITION ${start} MAXRESULTS 1000`))?.Bill || [];
      bills.push(...res); if (res.length < 1000) break; start += 1000;
    }
    const open = bills.filter(b => !claimed.has(b.Id) && Number(b.TotalAmt) > 0);
    const hits = [];
    for (const b of open.sort((x, y) => Number(y.TotalAmt) - Number(x.TotalAmt))) {
      const t = Math.round(Number(b.TotalAmt) * 100);
      const combo = subsetExact(t, pool);
      // single-group "combos" were already handled by the exact linker; require 2+
      // for new information, but accept 1 too (it's still exact).
      if (combo && combo.length > 0) { hits.push({ b, combo }); pool = pool.filter(g => !combo.includes(g)); }
    }
    if (!hits.length) continue;
    console.log(`\n=== ${v.name}: ${hits.length} decompositions (pool left: ${pool.length})`);
    for (const h of hits) {
      const amt = h.combo.reduce((a, g) => a + g.total, 0);
      totalLinked += h.combo.length; totalAmt += amt;
      console.log(`  QB ${h.b.Id} (${h.b.TxnDate}, $${h.b.TotalAmt}, ${Number(h.b.Balance) === 0 ? "PAID" : "OPEN $" + h.b.Balance}) = ${h.combo.length} invoice(s): ${h.combo.map(g => g.inv || g.k.slice(0, 12)).join(" + ")}`);
      if (APPLY) {
        let paidAt = null;
        if (Number(h.b.Balance) === 0) {
          try {
            const bill = (await qbGet(`/bill/${h.b.Id}`))?.Bill;
            const bp = (bill?.LinkedTxn || []).find(l => /billpayment/i.test(l.TxnType || ""));
            if (bp?.TxnId) { const d = await qbGet(`/billpayment/${bp.TxnId}`); paidAt = d?.BillPayment?.TxnDate ? new Date(d.BillPayment.TxnDate + "T12:00:00Z").toISOString() : null; }
          } catch {}
          if (!paidAt) paidAt = new Date(h.b.TxnDate + "T12:00:00Z").toISOString();
        }
        const ids = h.combo.flatMap(g => g.ids);
        const { error } = await sb.from("cost_entries").update({ qb_bill_id: h.b.Id, ...(paidAt ? { qb_paid_at: paidAt } : {}) }).in("id", ids);
        console.log(`    stamped ${ids.length} entries${paidAt ? " (paid " + paidAt.slice(0, 10) + ")" : ""}${error ? " ERR " + error.message : ""}`);
      }
    }
  }
  console.log(`\nTOTAL: ${totalLinked} invoice groups · $${totalAmt.toLocaleString()} ${APPLY ? "LINKED" : "linkable (dry run — --apply to stamp)"}`);
}
main().catch(e => { console.error("ABORT:", e.message); process.exit(1); });
