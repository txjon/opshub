#!/usr/bin/env node
/**
 * Link existing QB Bills to OpsHub cost-entry bill groups (Jon, 2026-07-17):
 * legacy bills entered in QB directly show "Push to QB" in /billing even
 * though they already exist in the books. Query QB per vendor, match groups
 * by DocNumber == vendor invoice # (primary) or exact total (only when
 * UNAMBIGUOUS), stamp qb_bill_id — and qb_paid_at when QB shows Balance 0
 * (paid date from the linked BillPayment when fetchable).
 *
 * Dry-run by default. Usage: npx -y tsx scripts/link-qb-bills.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const REALM = process.env.QB_REALM_ID;
const QB_BASE = "https://quickbooks.api.intuit.com";

async function main() {
  const { getAccessToken } = await import("../lib/quickbooks.ts");
  const token = await getAccessToken();
  const qbGet = async (path) => {
    const r = await fetch(`${QB_BASE}/v3/company/${REALM}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`QB ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };

  const [{ data: entries }, { data: vendors }] = await Promise.all([
    sb.from("cost_entries").select("id, vendor_id, vendor_name, vendor_invoice_number, amount, bill_group_id, hpd_bill_number, qb_bill_id, source").is("qb_bill_id", null).eq("source", "decorator_invoice"),
    sb.from("ap_vendors").select("id, name, qb_vendor_id"),
  ]);
  const vById = new Map((vendors || []).map(v => [v.id, v]));

  // group exactly like the UI: bill_group_id, else vendor+invoice
  const groups = new Map();
  for (const e of entries || []) {
    const key = e.bill_group_id || `${e.vendor_id}::${e.vendor_invoice_number || "noinv"}`;
    if (!groups.has(key)) groups.set(key, { key, vendor_id: e.vendor_id, invoice: e.vendor_invoice_number, hpd: e.hpd_bill_number, lines: [] });
    groups.get(key).lines.push(e);
  }
  const glist = Array.from(groups.values()).map(g => ({ ...g, total: Math.round(g.lines.reduce((a, l) => a + (Number(l.amount) || 0), 0) * 100) / 100 }));
  console.log(`${glist.length} un-pushed bill groups across ${new Set(glist.map(g => g.vendor_id)).size} vendors`);

  // fetch QB bills per distinct qb vendor
  const billsByVendor = new Map();
  for (const vid of new Set(glist.map(g => g.vendor_id))) {
    const v = vById.get(vid);
    if (!v?.qb_vendor_id) { console.log(`  (no qb_vendor_id for ${v?.name || vid} — skipping its groups)`); continue; }
    const q = encodeURIComponent(`select * from Bill where VendorRef = '${v.qb_vendor_id}' maxresults 1000`);
    const data = await qbGet(`/query?query=${q}`);
    billsByVendor.set(vid, (data?.QueryResponse?.Bill || []).map(b => ({ id: b.Id, doc: (b.DocNumber || "").trim(), total: Number(b.TotalAmt) || 0, balance: Number(b.Balance) || 0, date: b.TxnDate, linked: (b.LinkedTxn || []) , claimed: false })));
  }

  const matches = [], unmatched = [];
  for (const g of glist) {
    const pool = billsByVendor.get(g.vendor_id) || [];
    let hit = null, how = "";
    const inv = (g.invoice || "").trim().toLowerCase();
    if (inv) {
      const byDoc = pool.filter(b => !b.claimed && b.doc.toLowerCase() === inv);
      if (byDoc.length === 1) { hit = byDoc[0]; how = "DocNumber"; }
    }
    if (!hit) {
      const byAmt = pool.filter(b => !b.claimed && Math.abs(b.total - g.total) < 0.011);
      if (byAmt.length === 1) { hit = byAmt[0]; how = "exact amount (unambiguous)"; }
      else if (byAmt.length > 1) { unmatched.push({ g, why: `ambiguous — ${byAmt.length} QB bills at $${g.total}` }); continue; }
    }
    if (!hit) { unmatched.push({ g, why: "no QB bill matches invoice # or total" }); continue; }
    hit.claimed = true;
    matches.push({ g, b: hit, how });
  }

  console.log(`\nMATCHES (${matches.length}):`);
  for (const m of matches) {
    const v = vById.get(m.g.vendor_id);
    console.log(`  ${v?.name} · ${m.g.hpd || m.g.invoice || m.g.key} · $${m.g.total} → QB Bill ${m.b.id} (doc ${m.b.doc || "—"}, $${m.b.total}, ${m.b.balance === 0 ? "PAID" : `balance $${m.b.balance}`}) via ${m.how}`);
  }
  console.log(`\nUNMATCHED (${unmatched.length}):`);
  for (const u of unmatched) {
    const v = vById.get(u.g.vendor_id);
    console.log(`  ${v?.name} · ${u.g.hpd || u.g.invoice || u.g.key} · $${u.g.total} — ${u.why}`);
  }
  if (!APPLY) { console.log("\nDry run — --apply to stamp qb_bill_id (+qb_paid_at where QB balance is 0)."); return; }

  for (const m of matches) {
    let paidAt = null;
    if (m.b.balance === 0) {
      const bp = m.b.linked.find(l => /billpayment/i.test(l.TxnType || ""));
      if (bp?.TxnId) {
        try { const d = await qbGet(`/billpayment/${bp.TxnId}`); paidAt = d?.BillPayment?.TxnDate ? new Date(d.BillPayment.TxnDate + "T12:00:00Z").toISOString() : null; } catch {}
      }
      if (!paidAt) paidAt = m.b.date ? new Date(m.b.date + "T12:00:00Z").toISOString() : new Date().toISOString();
    }
    const { error } = await sb.from("cost_entries")
      .update({ qb_bill_id: m.b.id, ...(paidAt ? { qb_paid_at: paidAt } : {}) })
      .in("id", m.g.lines.map(l => l.id));
    console.log(`  stamped ${m.g.lines.length} lines → QB ${m.b.id}${paidAt ? " (paid " + paidAt.slice(0, 10) + ")" : ""}${error ? " ERR " + error.message : ""}`);
  }
}
main().catch(e => { console.error("ABORT:", e.message); process.exit(1); });
