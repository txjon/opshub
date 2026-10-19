// OpsHub → QuickBooks customer profile sync (Oct 14 2026).
//
// OpsHub holds the more current client records (the client info form keeps
// them fresh); QuickBooks' customer record should match. ONE WAY, a short list
// of fields, and these rules:
//   - a blank in OpsHub never overwrites QB (no wiping)
//   - DisplayName is never touched (it's HPD's handle and must be unique in QB)
//   - sales tax is never touched here (only an approved certificate changes it)
//   - email isn't synced: QB never emails clients (OpsHub does; invoices carry
//     hello@ as BillEmail on purpose)
//   - every write re-reads the customer and re-diffs, and is logged
//     (qb_customer_sync_log) with before/after
// Read failures throw before anything is written (Sep 1 lesson).

import { getCustomersFull, updateCustomerProfile } from "./quickbooks";
import { BILL_ADDR_COLS, LOC_ADDR_COLS, billAddr, locAddr, toQbAddr, type Addr } from "./address";

type Db = any;
export type SyncField = "CompanyName" | "BillAddr" | "ShipAddr" | "PrimaryPhone" | "WebAddr";
export type FieldDiff = { field: SyncField; label: string; qb: string; opshub: string };
export type ClientDiff = { clientId: string; name: string; qbId: string; qbName: string; diffs: FieldDiff[] };

const LABEL: Record<SyncField, string> = { CompanyName: "Company name", BillAddr: "Billing address", ShipAddr: "Ship-to address", PrimaryPhone: "Phone", WebAddr: "Website" };
const lc = (s: any) => String(s ?? "").toLowerCase();
const alnum = (s: any) => lc(s).replace(/[^a-z0-9]/g, "");

// QB address ↔ text, in QB's own field order
const qbAddrLines = (q: any) => !q ? [] : [q.Line1, q.Line2, q.Line3, q.Line4, q.Line5, [[q.City, q.CountrySubDivisionCode].filter(Boolean).join(", "), q.PostalCode].filter(Boolean).join(" "), q.Country && !/^(us|usa|united states)/i.test(q.Country) ? q.Country : ""].map(x => String(x ?? "").trim()).filter(Boolean);
const showQb = (q: any) => qbAddrLines(q).join("\n");
// same address = same value IN EACH FIELD (letters and digits only). Comparing
// the joined text missed QB-side scrambles where the right words sat in the
// wrong fields (Concordia, Oct 16: street in City, ZIP in Country) — the text
// read the same, so the preview said "matches".
const addrFields = (q: any) => !q ? null : {
  lines: [q.Line1, q.Line2, q.Line3, q.Line4, q.Line5].map(alnum).filter(Boolean).join("|"),
  city: alnum(q.City), state: alnum(q.CountrySubDivisionCode), zip: alnum(q.PostalCode),
  country: /^(|us|usa|unitedstates|unitedstatesofamerica)$/.test(alnum(q.Country)) ? "us" : alnum(q.Country),
};
const sameAddr = (q: any, ours: any) => { const x = addrFields(q), y = addrFields(ours); return !!x && !!y && x.lines === y.lines && x.city === y.city && x.state === y.state && x.zip === y.zip && x.country === y.country; };
// QB keeps old lines unless told otherwise: send all five, blanks included
const fullQbAddr = (a: Addr) => { const q = toQbAddr(a)!; for (let i = 1; i <= 5; i++) if (!(`Line${i}` in q)) q[`Line${i}`] = ""; return q; };
const webNorm = (u: string) => lc(u).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
const webUri = (u: string) => /^https?:\/\//i.test(u) ? u.trim() : `https://${u.trim()}`;
const digits = (s: any) => String(s ?? "").replace(/\D/g, "");
const formatAddressKey = (l: any) => alnum([l.addr_line1, l.addr_line2, l.addr_zip].join(" "));

type Ours = { CompanyName?: string; BillAddr?: Addr; ShipAddr?: Addr; PrimaryPhone?: string; WebAddr?: string };

// The connected QuickBooks company is HPD's (qb_tokens holds one realm) — only
// HPD's clients may ever be compared or written (a qb_customer_id from another
// tenant would hit an unrelated HPD customer).
async function hpdCompanyId(db: Db): Promise<string> {
  const { data, error } = await db.from("companies").select("id").eq("slug", "hpd").single();
  if (error || !data) throw new Error("HPD company not found");
  return data.id;
}

async function loadOurs(db: Db, clientIds?: string[]) {
  const companyId = await hpdCompanyId(db);
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("clients").select(`id, name, company_id, qb_customer_id, legal_name, website, is_internal, ${BILL_ADDR_COLS}`).not("qb_customer_id", "is", null).eq("company_id", companyId);
    if (clientIds?.length) q = q.in("id", clientIds);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw new Error(`clients: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const clients = rows.filter(c => !c.is_internal);
  const ids = clients.map(c => c.id);
  const ship = new Map<string, any>(), phone = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: locs, error: lErr } = await db.from("client_locations").select(`client_id, ${LOC_ADDR_COLS}`).in("client_id", chunk).is("job_id", null).eq("active", true).eq("is_default", true);
    if (lErr) throw new Error(`locations: ${lErr.message}`);
    const seenShip = new Set<string>();
    for (const l of locs || []) {
      if (!l.addr_line1) continue;
      if (seenShip.has(l.client_id) && ship.get(l.client_id) && formatAddressKey(ship.get(l.client_id)) !== formatAddressKey(l)) ship.set(l.client_id, null);   // two different defaults: skip, don't flip-flop
      else if (!seenShip.has(l.client_id)) ship.set(l.client_id, l);
      seenShip.add(l.client_id);
    }
    const { data: cts, error: cErr } = await db.from("contacts").select("client_id, phone, is_primary").in("client_id", chunk).eq("is_primary", true);
    if (cErr) throw new Error(`contacts: ${cErr.message}`);
    const seenPhone = new Set<string>();
    for (const c of cts || []) {
      if (digits(c.phone).length < 7) continue;
      if (seenPhone.has(c.client_id) && digits(phone.get(c.client_id)) !== digits(c.phone)) phone.set(c.client_id, "");   // two main contacts, different phones: skip
      else if (!seenPhone.has(c.client_id)) phone.set(c.client_id, String(c.phone).trim());
      seenPhone.add(c.client_id);
    }
  }
  return clients.map(c => {
    const o: Ours = {};
    if ((c.legal_name || "").trim()) o.CompanyName = c.legal_name.trim().slice(0, 100);   // QB CompanyName limit
    // billing: QB prints the customer's name above it already — drop a name line that's just the company
    if (c.bill_line1) { const b = billAddr(c); if ([c.name, c.legal_name].some(n => n && alnum(n) === alnum(b.name))) b.name = ""; o.BillAddr = b; }
    if (ship.get(c.id)) o.ShipAddr = locAddr(ship.get(c.id));
    if (phone.get(c.id)) o.PrimaryPhone = phone.get(c.id)!.slice(0, 30);   // QB FreeFormNumber limit
    if ((c.website || "").trim()) o.WebAddr = c.website.trim();
    return { client: c, ours: o };
  });
}

// What would change, field by field (only non-blank OpsHub values that differ)
function diffOne(cur: any, o: Ours): { diffs: FieldDiff[]; patch: Record<string, any> } {
  const diffs: FieldDiff[] = []; const patch: Record<string, any> = {};
  const add = (f: SyncField, qb: string, ours: string, val: any) => { diffs.push({ field: f, label: LABEL[f], qb, opshub: ours }); patch[f] = val; };
  if (o.CompanyName && lc(o.CompanyName).trim() !== lc(cur.CompanyName).trim()) add("CompanyName", cur.CompanyName || "", o.CompanyName, o.CompanyName);
  for (const f of ["BillAddr", "ShipAddr"] as const) {
    const a = o[f]; if (!a) continue;
    const q = fullQbAddr(a);
    if (!sameAddr(cur[f], q)) add(f, showQb(cur[f]), showQb(q), q);
  }
  if (o.PrimaryPhone && digits(o.PrimaryPhone) !== digits(cur.PrimaryPhone?.FreeFormNumber)) add("PrimaryPhone", cur.PrimaryPhone?.FreeFormNumber || "", o.PrimaryPhone, { FreeFormNumber: o.PrimaryPhone });
  if (o.WebAddr && webNorm(o.WebAddr) !== webNorm(cur.WebAddr?.URI || "")) add("WebAddr", cur.WebAddr?.URI || "", o.WebAddr, { URI: webUri(o.WebAddr) });
  return { diffs, patch };
}

export async function previewQbSync(db: Db, clientIds?: string[]): Promise<{ clients: ClientDiff[]; checked: number; missing: string[] }> {
  const ours = await loadOurs(db, clientIds);
  const qb = await getCustomersFull(ours.map(x => String(x.client.qb_customer_id)));   // throws on any failure
  const out: ClientDiff[] = []; const missing: string[] = [];
  for (const { client, ours: o } of ours) {
    const cur = qb.get(String(client.qb_customer_id));
    if (!cur) { missing.push(client.name); continue; }
    const { diffs } = diffOne(cur, o);
    if (diffs.length) out.push({ clientId: client.id, name: client.name, qbId: String(cur.Id), qbName: cur.DisplayName || "", diffs });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { clients: out, checked: ours.length, missing };
}

// Write one client's differing fields (optionally only `fields`). Re-reads QB
// and re-diffs at write time, so a stale preview can't push old values.
export async function applyQbSync(db: Db, clientId: string, opts?: { fields?: SyncField[]; by?: string | null; source?: string }): Promise<{ changed: SyncField[]; skipped?: SyncField[] }> {
  const [x] = await loadOurs(db, [clientId]);
  if (!x) return { changed: [] };   // internal or not linked to QB
  const write = (skip: SyncField[]) => updateCustomerProfile(String(x.client.qb_customer_id), cur => {
    const { patch } = diffOne(cur, x.ours);
    for (const k of Object.keys(patch)) if ((opts?.fields && !opts.fields.includes(k as SyncField)) || skip.includes(k as SyncField)) delete patch[k];
    return Object.keys(patch).length ? patch : null;
  });
  // QB validates a website's format; a website it refuses must not block the address/name/phone update
  let skipped: SyncField[] = [];
  let r;
  try { r = await write([]); }
  catch (e: any) {
    if (!/WebAddr|Web Site/i.test(String(e?.message || ""))) throw e;
    skipped = ["WebAddr"]; r = await write(skipped);
  }
  if (!r.sent) return { changed: [], skipped };
  const changed = Object.keys(r.sent) as SyncField[];
  const before: any = {}, after: any = {};
  for (const k of changed) { before[k] = r.before[k] ?? null; after[k] = r.after[k] ?? r.sent[k]; }
  const { error: logErr } = await db.from("qb_customer_sync_log").insert({ client_id: clientId, company_id: x.client.company_id || null, qb_customer_id: String(x.client.qb_customer_id), fields: changed, before, after, source: opts?.source || "manual", synced_by: opts?.by || null });
  if (logErr) console.error("[qb-customer-sync] log insert failed (QB WAS updated)", clientId, changed, logErr.message);
  return { changed, skipped };
}
