// Shared history-import parsing (one source — used by the CSV importer and
// the QB API importer). See import-history.cjs header for the rules' story.
const num = (s) => {
  const n = Number(String(s || "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && String(s || "").trim() !== "" ? n : null;
};
const usDate = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || "").trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};

// Size lists appear as "S 7 • M 13" AND "OS:70". Trusted only when they
// reconcile with the line qty (±5%) — truncated/pack-count maps would poison
// curves. Fitted hat sizes (7, 7 1/4 …) count too: "7 1/4: 12" or "7-1/4 12".
const SIZE_TOKEN = /(?:^|[\s•\t(])((?:XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|OSFA|OS|YS|YM|YL|YXL)|(?:[67](?:\s*[- ]\s*[1357]\/[248])?))[\s:]+([\d,]+)(?=\s|•|$|\))/gi;
const ONE_SIZE = /(?:^|[\s\/\-–])((?:XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|OS|OSFA))(?:\s*$|[\s).])/;
const normSize = (s) => {
  const t = String(s).toUpperCase().replace(/\s*[- ]\s*/g, " ").trim();
  // OSFA = OS (Jon: "these can merge")
  return { XXL: "2XL", XXXL: "3XL", OSFA: "OS" }[t] || t;
};
const cleanStyle = (s) => {
  const t = String(s || "").trim().replace(/[\s/"'•]+$/g, "");
  if (t.length < 3 || !/[A-Za-z0-9]{2}/.test(t) || /^["'/\-–•]+$/.test(t)) return null;
  const canon = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return canon.length >= 3 ? canon : null;
};
function parseDesc(desc, lineQty) {
  const out = { product_name: null, blank_style: null, color: null, size_qtys: null };
  if (!desc) return out;
  const [head] = String(desc).split(/\t/);
  const parts = head.split(/\s+\/\s+/).map(x => x.trim()).filter(p => p && p !== "/");
  if (parts.length >= 3) { out.product_name = parts[0]; out.blank_style = cleanStyle(parts[1]); out.color = parts[2]; }
  else if (parts.length === 2) { out.product_name = parts[0]; out.blank_style = cleanStyle(parts[1]); }
  const sizes = {};
  let m;
  const rx = new RegExp(SIZE_TOKEN.source, "gi");
  while ((m = rx.exec(String(desc))) !== null) {
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

const custKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(llc|inc|ltd)$/g, "");
// Fold spelling variants into the most frequent form, in place.
function unifyCustomers(rows) {
  const spellings = new Map();
  for (const r of rows) {
    if (!r.customer) continue;
    const k = custKey(r.customer);
    const m = spellings.get(k) || new Map();
    m.set(r.customer, (m.get(r.customer) || 0) + 1);
    spellings.set(k, m);
  }
  const canonical = new Map();
  for (const [k, m] of spellings) canonical.set(k, Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0]);
  let renamed = 0;
  for (const r of rows) {
    if (!r.customer) continue;
    const c = canonical.get(custKey(r.customer));
    if (c && c !== r.customer) { r.customer = c; renamed++; }
  }
  return renamed;
}
const cleanGroup = (g) => (String(g || "Uncategorized").replace(/\s*\(deleted\)\s*/i, "").trim() || "Uncategorized");

// "Custom" is a bucket, not a garment — the real type is USUALLY typed in the
// description (Jon, Jul 22: "jacket, hat, pant… we usually type some kind of
// descriptor"). First keyword wins; unresolved stays Custom.
const CUSTOM_RESOLVE = [
  [/wind\s*breaker|windbreaker/i, "Jacket"], [/jacket|coach/i, "Jacket"],
  [/\bpant|jogger|sweatpant/i, "Pants"], [/\bshort\b|shorts/i, "Shorts"],
  [/hoodie|hooded|zip[\s-]?up/i, "Hoodies"], [/crewneck|crew\s*neck/i, "Crewneck"],
  [/\btee\b|t[\s-]?shirt|\btank\b|long\s*sleeve|\bls\b/i, "Tees"],
  [/beanie/i, "Beanie"], [/\bhat\b|\bcap\b|snapback|trucker|visor/i, "Hats"],
  [/\bsock/i, "Socks"], [/jersey/i, "Jersey"],
  [/\bbag\b|duffle|backpack/i, "Custom Bag"], [/\btote\b/i, "Tote"],
  [/patch/i, "Patches"], [/sticker|decal/i, "Stickers"], [/\bflag\b/i, "Flags"],
];
const APPAREL_RESOLVED = new Set(["Jacket", "Pants", "Shorts", "Hoodies", "Crewneck", "Tees", "Socks", "Jersey"]);
function resolveCustom(group, desc) {
  if (group !== "Custom" || !desc) return { group, parent: null };
  for (const [rx, g] of CUSTOM_RESOLVE) {
    if (rx.test(desc)) return { group: g, parent: APPAREL_RESOLVED.has(g) ? "Apparel" : "Accessories" };
  }
  return { group, parent: null };
}

module.exports = { num, usDate, parseDesc, cleanStyle, unifyCustomers, cleanGroup, resolveCustom };
