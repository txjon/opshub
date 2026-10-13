// Structured addresses (mig 200, Oct 13 2026). The PARTS are the truth:
// client_locations.addr_* and clients.bill_*. The old text columns
// (client_locations.address, clients.billing_address) are a derived display
// copy rebuilt by DB trigger from these parts — formatAddress below is the
// twin of SQL public.format_address; keep them in lockstep.
//
// A row with parts empty but old text present = "needs review" (the backfill
// couldn't split it). Fix it in the UI and it joins the structured world.

export type Addr = { name: string; line1: string; line2: string; city: string; state: string; zip: string; country: string };

export const EMPTY_ADDR: Addr = { name: "", line1: "", line2: "", city: "", state: "", zip: "", country: "US" };

export const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR"];

const t = (s: any) => String(s ?? "").trim();

export function formatAddress(a: Partial<Addr> | null | undefined): string {
  if (!a) return "";
  const cityLine = [[t(a.city), t(a.state)].filter(Boolean).join(", "), t(a.zip)].filter(Boolean).join(" ");
  const country = t(a.country) || "US";
  return [t(a.name), t(a.line1), t(a.line2), cityLine, country !== "US" ? country : ""].filter(Boolean).join("\n");
}

// What's missing for a usable address ("" = complete).
export function addrProblem(a: Partial<Addr> | null | undefined): string {
  if (!a || !t(a.line1)) return "Street is missing";
  if (!t(a.city)) return "City is missing";
  const us = (t(a.country) || "US") === "US";
  if (us && !US_STATES.includes(t(a.state).toUpperCase())) return "State is missing";
  if (us && !/^\d{5}(-\d{4})?$/.test(t(a.zip))) return "ZIP is missing";
  if (!us && !t(a.zip)) return "Postal code is missing";
  return "";
}

// trims, drops trailing commas ("15090 Wild Horse Way,"), uppercases US states
export function cleanAddr(a: Partial<Addr>): Addr {
  const c = (s: any) => t(s).replace(/[\s,]+$/, "");
  const raw = t(a.country);
  const country = !raw || /^(us|usa|united states)$/i.test(raw) ? "US" : raw;
  return { name: c(a.name), line1: c(a.line1), line2: c(a.line2), city: c(a.city), state: country === "US" ? c(a.state).toUpperCase() : c(a.state), zip: c(a.zip), country };
}

// ── row mappers ──
export const LOC_ADDR_COLS = "addr_name, addr_line1, addr_line2, addr_city, addr_state, addr_zip, addr_country";
export const BILL_ADDR_COLS = "bill_name, bill_line1, bill_line2, bill_city, bill_state, bill_zip, bill_country";

export function locAddr(r: any): Addr {
  return { name: r?.addr_name || "", line1: r?.addr_line1 || "", line2: r?.addr_line2 || "", city: r?.addr_city || "", state: r?.addr_state || "", zip: r?.addr_zip || "", country: r?.addr_country || "US" };
}
export function locAddrCols(a: Partial<Addr>) {
  const c = cleanAddr(a);
  return { addr_name: c.name || null, addr_line1: c.line1 || null, addr_line2: c.line2 || null, addr_city: c.city || null, addr_state: c.state || null, addr_zip: c.zip || null, addr_country: c.country };
}
export function billAddr(r: any): Addr {
  return { name: r?.bill_name || "", line1: r?.bill_line1 || "", line2: r?.bill_line2 || "", city: r?.bill_city || "", state: r?.bill_state || "", zip: r?.bill_zip || "", country: r?.bill_country || "US" };
}
export function billAddrCols(a: Partial<Addr>) {
  const c = cleanAddr(a);
  return { bill_name: c.name || null, bill_line1: c.line1 || null, bill_line2: c.line2 || null, bill_city: c.city || null, bill_state: c.state || null, bill_zip: c.zip || null, bill_country: c.country };
}

// QuickBooks PhysicalAddress ← parts (name rides on Line1 like a label)
export function toQbAddr(a: Partial<Addr> | null | undefined): any | undefined {
  if (!a || !t(a.line1)) return undefined;
  const lines = [t(a.name), t(a.line1), t(a.line2)].filter(Boolean);
  const out: any = { City: t(a.city), CountrySubDivisionCode: t(a.state), PostalCode: t(a.zip), Country: (t(a.country) || "US") === "US" ? "USA" : t(a.country) };
  lines.forEach((l, i) => { out[`Line${i + 1}`] = l; });
  return out;
}
// The ship-to OpsHub pushes on a QuickBooks invoice. Split address → real
// street / city / state / ZIP (+ the job's ATTN as an extra line). A never-split
// address goes as plain lines (no guessing) — the old comma-split put the
// whole address in Line1 and "NV 89118" in City.
export function qbShipAddr(parts: Partial<Addr> | null | undefined, text: string | null | undefined, attn?: string | null): any | undefined {
  const a = attn && t(attn) ? `ATTN: ${t(attn)}` : "";
  if (parts && t(parts.line1)) {
    const q = toQbAddr(parts);
    const n = Object.keys(q).filter(k => /^Line\d$/.test(k)).length;
    if (a && n < 5) q[`Line${n + 1}`] = a;
    return q;
  }
  const lines = String(text || "").split(/\r?\n/).map(t).filter(Boolean).slice(0, 5);
  if (!lines.length) return undefined;
  const out: any = {};
  lines.forEach((l, i) => { out[`Line${i + 1}`] = l; });
  return out;
}

// parts ← QuickBooks PhysicalAddress (prefill only)
export function fromQbAddr(q: any): Addr | null {
  if (!q || !(q.Line1 || q.City)) return null;
  const ls = [q.Line1, q.Line2, q.Line3, q.Line4].map(t).filter(Boolean);
  const streetAt = ls.findIndex(l => /^\d/.test(l));
  const name = streetAt > 0 ? ls.slice(0, streetAt).join(" / ") : "";
  const street = streetAt > 0 ? ls.slice(streetAt) : ls;
  const c = t(q.Country);
  return cleanAddr({ name, line1: street[0] || "", line2: street.slice(1).join(", "), city: t(q.City), state: t(q.CountrySubDivisionCode), zip: t(q.PostalCode), country: !c || /^(us|usa|united states)/i.test(c) ? "US" : c });
}
