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

export const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR","AA","AE","AP"];   // + military (APO/FPO)

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
  if (a.country != null && !t(a.country)) return "Country is missing";
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
  // undefined/null = US; "" = "Outside the US" ticked, country not typed yet (addrProblem flags it)
  const raw = a.country == null ? "US" : t(a.country);
  const country = /^(us|usa|united states)$/i.test(raw) ? "US" : raw;
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
  // "Person / Company" name lines go on their own lines (QB has five)
  const street = [t(a.line1), t(a.line2)].filter(Boolean);
  const names = t(a.name).split(/\s+\/\s+/).map(t).filter(Boolean);
  // QB has five lines: street always fits; extra name parts fold into the last name line
  const room = 5 - street.length;
  const nameLines = names.length > room ? [...names.slice(0, room - 1), names.slice(room - 1).join(" / ")] : names;
  const lines = [...nameLines.filter(Boolean), ...street];
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
    // keep room for the ATTN line: fold name parts into one line when needed
    const q = toQbAddr(a && [...t(parts.name).split(/\s+\/\s+/).filter(Boolean), t(parts.line1), t(parts.line2)].filter(Boolean).length >= 5 ? { ...parts, name: t(parts.name).replace(/\s+\/\s+/g, ", ") } : parts);
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
  const ls = [q.Line1, q.Line2, q.Line3, q.Line4, q.Line5].map(t).filter(Boolean);
  const streetAt = ls.findIndex(l => /^\d/.test(l));
  const name = streetAt > 0 ? ls.slice(0, streetAt).join(" / ") : "";
  const street = streetAt > 0 ? ls.slice(streetAt) : ls;
  const c = t(q.Country);
  return cleanAddr({ name, line1: street[0] || "", line2: street.slice(1).join(", "), city: t(q.City), state: t(q.CountrySubDivisionCode), zip: t(q.PostalCode), country: !c || /^(us|usa|united states)/i.test(c) ? "US" : c });
}

// ── reading old one-line text (mig 200 backfill + the hub form for rows not
// split yet). Confident or nothing: returns ok:false rather than guess. ──
const ST = new Set(US_STATES);
const FULL: Record<string, string> = { alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",colorado:"CO",connecticut:"CT",delaware:"DE",florida:"FL",georgia:"GA",hawaii:"HI",idaho:"ID",illinois:"IL",indiana:"IN",iowa:"IA",kansas:"KS",kentucky:"KY",louisiana:"LA",maine:"ME",maryland:"MD",massachusetts:"MA",michigan:"MI",minnesota:"MN",mississippi:"MS",missouri:"MO",montana:"MT",nebraska:"NE",nevada:"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND",ohio:"OH",oklahoma:"OK",oregon:"OR",pennsylvania:"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",tennessee:"TN",texas:"TX",utah:"UT",vermont:"VT",virginia:"VA",washington:"WA","west virginia":"WV",wisconsin:"WI",wyoming:"WY" };
const isStreet = (l: string) => /^\s*\d/.test(l) || /\b(p\.?\s?o\.?\s*box|suite|ste\.?|unit|apt\.?|bldg|building|floor)\b/i.test(l) || /#\s*\d/.test(l);

function cityLine(l: string): { city: string; state: string; zip: string } | null {
  const s = l.trim().replace(/\s+/g, " ").replace(/[.,]+$/, "").replace(/,?\s*(usa|us|united states)$/i, "");
  const z = s.match(/[\s,]+(\d{5})(-\d{4})?$/); if (!z) return null;
  const rest = s.slice(0, z.index).replace(/[,.]+$/, "").trim();
  let st = "", city = "";
  for (const [name, code] of Object.entries(FULL)) { const re = new RegExp(`[\\s,]+${name}$`, "i"); if (re.test(rest)) { st = code; city = rest.replace(re, ""); break; } }
  if (!st) { const m = rest.match(/[\s,]+([A-Za-z]{2})\.?$/); if (m && ST.has(m[1].toUpperCase())) { st = m[1].toUpperCase(); city = rest.slice(0, m.index); } }
  if (!st || !city.replace(/,+$/, "").trim()) return null;
  return { city: city.replace(/,+$/, "").trim(), state: st, zip: z[1] + (z[2] || "") };
}

export function parseAddressText(raw: string): { ok: true; a: Addr } | { ok: false; why: string } {
  const txt = String(raw || "").trim();
  if (!txt) return { ok: false, why: "empty" };
  let lines = txt.split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (/^(usa|us|united states( of america)?)$/i.test(lines[lines.length - 1])) lines.pop();
  // ZIP alone on the last line → join it to the line above
  if (lines.length > 1 && /^\d{5}(-\d{4})?\.?$/.test(lines[lines.length - 1])) { const z = lines.pop()!; lines[lines.length - 1] += " " + z; }
  // last line holds several comma parts ("139 N Dobson Rd, Apt #403, Phoenix, AZ, 85201")
  let c = cityLine(lines[lines.length - 1] || "");
  // "5920 W Cougar Ave, Las Vegas, NV 89139": street parts rode along in the city
  if (c && c.city.includes(",")) {
    const parts = c.city.split(",").map(s => s.trim()).filter(Boolean);
    c = { ...c, city: parts.pop()! };
    lines = [...lines.slice(0, -1), ...parts, "__CITY__"];
  }
  if (!c) {
    const segs = (lines[lines.length - 1] || "").split(",").map(s => s.trim()).filter(Boolean);
    for (const k of [3, 2]) {
      if (segs.length <= k) continue;
      const cc = cityLine(segs.slice(-k).join(", "));
      if (cc) { c = cc; lines = [...lines.slice(0, -1), ...segs.slice(0, -k), "__CITY__"]; break; }
    }
  }
  if (!c) return { ok: false, why: /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i.test(txt) ? "Outside the US — enter it by hand" : "No city / state / ZIP line" };
  const above = lines.slice(0, -1);
  const first = above.findIndex(isStreet);
  if (first < 0) return { ok: false, why: "Can't tell the street from the name" };
  const names = above.slice(0, first), street = above.slice(first);
  if (street.length > 2) return { ok: false, why: "More than two street lines" };
  if (names.length > 2) return { ok: false, why: "More than two name lines" };
  const a = cleanAddr({ name: names.join(" / "), line1: street[0], line2: street[1] || "", ...c, country: "US" });
  if (addrProblem(a)) return { ok: false, why: addrProblem(a) };
  return { ok: true, a };
}
