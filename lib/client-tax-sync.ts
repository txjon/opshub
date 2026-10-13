// Clients mirror their QuickBooks sales-tax status (Oct 13 2026).
//
// QB's customer record is THE sales-tax switch: QB computes tax on every
// invoice from it (Taxable, resale #, exemption reason) — OpsHub's push never
// sends a tax code. clients.tax_exempt used to be a hand-set checkbox nothing
// enforced; 13 of 28 "exempt" clients were taxable in QB. Now OpsHub copies
// QB's answer, so what the team sees is what QB charges. A verified resale
// certificate (the client info form) will be the only way to change the
// switch itself.
//
// Read-only on QB. Any QB read failure throws BEFORE a single row is touched
// (Sep 1 lesson: a transport error must never read as "everyone is taxable").
// Customers QB didn't return (deleted / merged) are skipped, not guessed.
// Clients with no QB link keep their own value.

import { getCustomersTaxStatus } from "./quickbooks";

type Db = any;

export async function syncClientTaxFromQB(db: Db, opts?: { clientIds?: string[] }): Promise<{ checked: number; changed: { name: string; from: boolean; to: boolean }[]; missing: string[] }> {
  const clients: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("clients").select("id, name, qb_customer_id, tax_exempt, qb_resale_num").not("qb_customer_id", "is", null);
    if (opts?.clientIds?.length) q = q.in("id", opts.clientIds);   // one client (after an approval); else everyone
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new Error(`clients: ${error.message}`);
    clients.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const qb = await getCustomersTaxStatus(clients.map(c => c.qb_customer_id));   // throws on any failure

  const changed: { name: string; from: boolean; to: boolean }[] = [];
  const missing: string[] = [];
  const now = new Date().toISOString();
  for (const c of clients) {
    const s = qb.get(String(c.qb_customer_id));
    if (!s) { missing.push(c.name); continue; }
    const exempt = !s.taxable;
    const patch: any = { tax_synced_at: now };
    if (!!c.tax_exempt !== exempt) { patch.tax_exempt = exempt; changed.push({ name: c.name, from: !!c.tax_exempt, to: exempt }); }
    if ((c.qb_resale_num || null) !== (s.resaleNum || null)) patch.qb_resale_num = s.resaleNum || null;
    const { error } = await db.from("clients").update(patch).eq("id", c.id);
    if (error) throw new Error(`update ${c.name}: ${error.message}`);
  }
  return { checked: clients.length, changed, missing };
}
