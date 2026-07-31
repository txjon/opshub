// QB → history_sales sync (extracted from scripts/import-history-qb.ts,
// Jul 31 2026, for the NIGHTLY cron — the archive was a one-time Jul-21
// snapshot and fell ~10 days behind QB the moment it landed).
//
// Full re-pull every run, delete+reinsert of source_file='qb_api' rows —
// idempotent, and revised invoices stay accurate because their doc gets
// rebuilt from QB truth. Hand product-group assignments come from the
// history_assignments table (mig 154 — moved off Jon's laptop so Vercel can
// apply them); manual truth beats keyword resolution. Every row is stamped
// opshub_job_id by matching doc_num ↔ jobs.type_meta.qb_invoice_number, which
// is what keeps god-mode's archive/+OpsHub-era scopes double-count-free.
import { getAccessToken } from "./quickbooks";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parse = require("../scripts/history-parse.cjs");

const QB = "https://quickbooks.api.intuit.com";
type Db = any;

async function qbQuery(db: Db, query: string): Promise<any> {
  const token = await getAccessToken();
  const { data: tok } = await db.from("qb_tokens").select("realm_id").limit(1).single();
  const realmId = (tok as any)?.realm_id || process.env.QB_REALM_ID;
  const res = await fetch(`${QB}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QB ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function pageEntity(db: Db, entity: string): Promise<any[]> {
  const out: any[] = [];
  for (let start = 1; ; start += 1000) {
    const body = await qbQuery(db, `select * from ${entity} startposition ${start} maxresults 1000`);
    const batch = body?.QueryResponse?.[entity] || [];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

export async function runQbHistorySync(db: Db): Promise<{ lines: number; gross: number; stamped: number; assignments: number }> {
  const rows: any[] = [];
  // CreditMemo amounts stored positive in QB — gross integrity needs them negative.
  for (const entity of ["Invoice", "SalesReceipt", "CreditMemo"]) {
    const sign = entity === "CreditMemo" ? -1 : 1;
    const docs = await pageEntity(db, entity);
    for (const d of docs) {
      const customer = d.CustomerRef?.name || null;
      for (const ln of d.Line || []) {
        const det = ln.SalesItemLineDetail;
        if (!det) continue;   // subtotal/discount/etc.
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
          ...((): any => {
            const parent = (det.ItemRef?.name || "").includes(":") ? parse.cleanGroup(String(det.ItemRef.name).split(":")[0]) : null;
            const leaf = parse.cleanGroup(String(det.ItemRef?.name || "").split(":").pop());
            const res = parse.resolveCustom(leaf, ln.Description || "");
            return { product_parent: res.parent || parent, product_group: res.group };
          })(),
          ...p,
          size_qtys: sign === -1 ? null : p.size_qtys,  // refunds don't feed curves
          source_file: "qb_api",
        });
      }
    }
  }
  parse.unifyCustomers(rows);

  // Hand assignments from the DB (manual truth beats keyword resolution).
  const APPAREL = new Set(["Tees", "Hoodies", "Crewneck", "Shorts", "Pants", "Jacket", "Jersey", "Socks"]);
  const { data: assignRows } = await db.from("history_assignments").select("key, product_group");
  const assigns: Record<string, string> = Object.fromEntries((assignRows || []).map((r: any) => [r.key, r.product_group]));
  let applied = 0;
  for (const r of rows) {
    const t = assigns[`${String(r.doc_num || "").trim()}|${String(r.description || "").trim()}`];
    if (!t) continue;
    r.product_group = t;
    r.product_parent = APPAREL.has(t) ? "Apparel" : ["Raw Material", "Trims", "One Off"].includes(t) ? null : "Accessories";
    applied++;
  }

  // Sanity gate: a QB hiccup returning few rows must never wipe the archive.
  if (rows.length < 5000) throw new Error(`sync aborted — only ${rows.length} lines from QB (expected 10k+)`);

  await db.from("history_sales").delete().eq("source_file", "qb_api");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("history_sales").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  // Overlap stamp — doc_num ↔ the OpsHub job that pushed that invoice.
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
  for (const n of Array.from(new Set(rows.map(r => String(r.doc_num || "").trim()).filter(Boolean)))) {
    if (!jobMap.has(n)) continue;
    const { count } = await db.from("history_sales")
      .update({ opshub_job_id: jobMap.get(n) }, { count: "exact" })
      .eq("source_file", "qb_api").eq("doc_num", n);
    stamped += count || 0;
  }

  const gross = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  return { lines: rows.length, gross: Math.round(gross), stamped, assignments: applied };
}
