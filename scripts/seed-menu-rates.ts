// Seed menu_rates: SPEC-ANCHORED COST-PLUS (Sep 8 2026).
// Run: npx tsx scripts/seed-menu-rates.ts [--dry]
//
// THE PRICED SPEC: screen print, 1–2 locations, standard inks, blanks
// included, standard turnaround. Every cell decomposes as
//
//   cost = blank(style) + decoration(group, qty band)
//   price_lo = cost / 0.75   (25% gross margin — Jon's floor)
//   price_hi = cost / 0.65   (35% gross margin)
//
// BLANK per style: qty-weighted avg of live items' cost_per_unit (needs
// >= 3 costed items); thin styles fall back to the vendor's CURRENT price
// (S&S customerPrice / AS Colour pricelist, base sizes) × 1.06 size-mix
// bump. Both are stored so the grid can show drift between what we've
// been paying and what the vendor charges today.
//
// DECORATION curve per product group × band: qty-weighted avg of
// (all_in − blank) across the whole garment population, samples and
// specialty excluded (qty >= 24, decoration <= $12/u tees, <= $15/u
// fleece). This is what fixed the old basis: per-style historical all-in
// let one sample job (setup ÷ 3 units) poison a thin style's whole lane.
//
// History realized prices ride along per cell (seed_meta.hist_lo/hi) as
// the market reference; flags: no blank data, thin data, below history
// (leaving money), >15% above history hi.
//
// The script PROPOSES — seeded_lo/seeded_hi always refresh; live
// price_lo/price_hi update only while edited_at is null. Jon's edits win.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const sb = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MARGIN_LO = 0.25;
const MARGIN_HI = 0.35;
const SIZE_MIX_BUMP = 1.06; // vendor base price → blended size-mix price

type StyleDef = {
  code: string;
  name: string;
  group: "tee" | "hoodie";
  lane: "la_apparel" | "as_colour" | "popular";
  sort: number;
  hist: RegExp;
  live: RegExp;
  ssStyleId?: number;   // S&S styleID for current vendor price
  asCode?: string;      // AS Colour style code for the pricelist
};

const STYLES: StyleDef[] = [
  { code: "1801GD",  name: "LA Apparel 1801GD",   group: "tee",    lane: "la_apparel", sort: 10, hist: /1801GD/i,            live: /LA Apparel 1801GD/i },
  { code: "1801MW",  name: "LA Apparel 1801MW",   group: "tee",    lane: "la_apparel", sort: 11, hist: /1801MW/i,            live: /LA Apparel 1801MW/i },
  { code: "5001",    name: "AS Colour 5001",      group: "tee",    lane: "as_colour",  sort: 20, hist: /^(AS|ASCOLOUR)5001/i, live: /AS Colour 5001/i, asCode: "5001" },
  { code: "5026",    name: "AS Colour 5026",      group: "tee",    lane: "as_colour",  sort: 21, hist: /^(AS|ASCOLOUR)5026/i, live: /AS Colour 5026/i, asCode: "5026" },
  { code: "5082",    name: "AS Colour 5082",      group: "tee",    lane: "as_colour",  sort: 22, hist: /^(AS|ASCOLOUR)5082/i, live: /AS Colour 5082/i, asCode: "5082" },
  { code: "NL6210",  name: "Next Level 6210",     group: "tee",    lane: "popular",    sort: 30, hist: /^(NL|NEXTLEVEL)6210/i, live: /Next Level 6210/i, ssStyleId: 3227 },
  { code: "NL3600",  name: "Next Level 3600",     group: "tee",    lane: "popular",    sort: 31, hist: /^(NL|NEXTLEVEL)3600/i, live: /Next Level 3600/i },
  { code: "CC1717",  name: "Comfort Colors 1717", group: "tee",    lane: "popular",    sort: 32, hist: /^(CC|COMFORTCOLORS)1717/i, live: /Comfort Colors 1717/i },
  { code: "HF-09",   name: "LA Apparel HF-09",    group: "hoodie", lane: "la_apparel", sort: 40, hist: /HF.?09/i,            live: /LA Apparel HF.?09/i },
  { code: "5101",    name: "AS Colour 5101",      group: "hoodie", lane: "as_colour",  sort: 41, hist: /^(AS|ASCOLOUR)5101/i, live: /AS Colour 5101/i, asCode: "5101" },
  { code: "IND4000", name: "Independent IND4000", group: "hoodie", lane: "popular",    sort: 42, hist: /IND4000/i,           live: /IND4000/i },
];

// S&S styleIDs not hardcoded above get looked up by search at runtime.
const SS_SEARCH: Record<string, string> = { NL3600: "Next Level 3600", CC1717: "Comfort Colors 1717", IND4000: "IND4000" };

const BANDS = [48, 100, 250, 500];
const HIST_GROUP: Record<string, string> = { tee: "Tees", hoodie: "Hoodies" };
const DECO_GT: Record<string, string[]> = { tee: ["tee", "longsleeve"], hoodie: ["hoodie", "crewneck"] };
const DECO_CAP: Record<string, number> = { tee: 12, hoodie: 15 };

type Line = { qty: number; price: number; weight: number };

const bandFor = (qty: number) =>
  qty >= 500 ? 500 : qty >= 250 ? 250 : qty >= 100 ? 100 : qty >= 48 ? 48 : null;

function weightedMean(lines: Line[]) {
  let wq = 0, wp = 0;
  for (const l of lines) { wq += l.qty * l.weight; wp += l.qty * l.weight * l.price; }
  return wq > 0 ? wp / wq : null;
}
function weightedQuantile(lines: Line[], q: number) {
  const sorted = [...lines].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((s, l) => s + l.qty * l.weight, 0);
  let cum = 0;
  for (const l of sorted) { cum += l.qty * l.weight; if (cum >= total * q) return l.price; }
  return sorted.length ? sorted[sorted.length - 1].price : null;
}
const round25 = (n: number) => Math.round(n * 4) / 4;
const median = (ns: number[]) => { const s = [...ns].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// ─── Vendor current blank prices ────────────────────────────────

async function ssPrices(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const h = {
    Authorization: "Basic " + Buffer.from(`${process.env.SS_USERNAME}:${process.env.SS_PASSWORD}`).toString("base64"),
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    Accept: "application/json",
  };
  for (const st of STYLES) {
    if (!st.ssStyleId && !SS_SEARCH[st.code]) continue;
    try {
      let styleId = st.ssStyleId;
      if (!styleId) {
        const res = await fetch(`https://api.ssactivewear.com/v2/styles?search=${encodeURIComponent(SS_SEARCH[st.code])}`, { headers: h });
        const found = (await res.json()) as any[];
        styleId = found?.[0]?.styleID;
      }
      if (!styleId) continue;
      const pres = await fetch(`https://api.ssactivewear.com/v2/products?styleid=${styleId}`, { headers: h });
      const prods = (await pres.json()) as any[];
      // Base-size (S–XL) account price, median across colors.
      const prices = (prods || [])
        .filter((p) => ["S", "M", "L", "XL"].includes(p.sizeName) && p.customerPrice > 0)
        .map((p) => p.customerPrice as number);
      const m = median(prices);
      if (m) out[st.code] = m;
    } catch { /* fall back to history */ }
  }
  return out;
}

async function asPrices(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const codes = STYLES.filter((s) => s.asCode).map((s) => s.asCode!);
  try {
    const sub = process.env.ASCOLOUR_SUBSCRIPTION_KEY || "";
    const auth = await fetch("https://api.ascolour.com/v1/api/authentication", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Subscription-Key": sub },
      body: JSON.stringify({ email: process.env.ASCOLOUR_EMAIL, password: process.env.ASCOLOUR_PASSWORD }),
    });
    const { token } = await auth.json();
    const h = { Accept: "application/json", "Subscription-Key": sub, Authorization: `Bearer ${token}` };
    const byCode: Record<string, number[]> = {};
    for (let page = 1; page <= 60; page++) {
      const res = await fetch(`https://api.ascolour.com/v1/catalog/pricelist?pageSize=250&pageNumber=${page}`, { headers: h });
      if (!res.ok) break;
      const data = await res.json();
      const items = (data.data || data) as any[];
      if (!Array.isArray(items) || !items.length) break;
      for (const r of items) {
        const m = String(r.sku || "").match(/^(\d{4})-.*-(XS|S|M|L|XL)$/);
        if (m && codes.includes(m[1]) && r.price > 0) (byCode[m[1]] ||= []).push(r.price);
      }
      if (items.length < 250) break;
    }
    for (const c of codes) {
      const m = median(byCode[c] || []);
      if (m) out[c] = m;
    }
  } catch { /* fall back to history */ }
  return out;
}

async function main() {
  const dry = process.argv.includes("--dry");

  const hist = await all<{ blank_style: string | null; product_group: string | null; qty: number | null; unit_price: number | null; txn_date: string | null }>(
    (a, b) => sb.from("history_sales").select("blank_style,product_group,qty,unit_price,txn_date").range(a, b)
  );
  const items = await all<{ id: string; blank_vendor: string | null; garment_type: string | null; cost_per_unit: number | null; cost_per_unit_all_in: number | null }>(
    (a, b) => sb.from("items").select("id,blank_vendor,garment_type,cost_per_unit,cost_per_unit_all_in").range(a, b)
  );
  const bsl = await all<{ item_id: string | null; qty_ordered: number | null }>(
    (a, b) => sb.from("buy_sheet_lines").select("item_id,qty_ordered").range(a, b)
  );
  const qtyByItem = new Map<string, number>();
  for (const l of bsl) {
    if (!l.item_id) continue;
    qtyByItem.set(l.item_id, (qtyByItem.get(l.item_id) || 0) + (l.qty_ordered || 0));
  }

  console.log("fetching current vendor blank prices...");
  const [ss, as_] = await Promise.all([ssPrices(), asPrices()]);
  const vendorBlank: Record<string, number> = {};
  for (const st of STYLES) {
    const v = ss[st.code] ?? (st.asCode ? as_[st.asCode] : undefined);
    if (v) vendorBlank[st.code] = Number((v * SIZE_MIX_BUMP).toFixed(2));
  }
  console.log("vendor blanks (×1.06 size mix):", JSON.stringify(vendorBlank));

  // Decoration curve per group × band from the clean population.
  const decoCurve: Record<string, Record<number, number | null>> = {};
  for (const group of ["tee", "hoodie"] as const) {
    decoCurve[group] = {};
    const bands: Record<number, { wq: number; wd: number; n: number }> = { 48: { wq: 0, wd: 0, n: 0 }, 100: { wq: 0, wd: 0, n: 0 }, 250: { wq: 0, wd: 0, n: 0 }, 500: { wq: 0, wd: 0, n: 0 } };
    for (const i of items) {
      if (!DECO_GT[group].includes(i.garment_type || "")) continue;
      const q = qtyByItem.get(i.id) || 0;
      if (q < 24 || !i.cost_per_unit_all_in || !i.cost_per_unit) continue;
      const deco = i.cost_per_unit_all_in - i.cost_per_unit;
      if (deco <= 0 || deco > DECO_CAP[group]) continue;
      const b = bandFor(q);
      if (b === null) continue;
      bands[b].wq += q; bands[b].wd += q * deco; bands[b].n++;
    }
    for (const b of BANDS) decoCurve[group][b] = bands[b].wq >= 200 && bands[b].n >= 3 ? bands[b].wd / bands[b].wq : null;
  }
  // Hoodie gaps: tee curve + the observed hoodie premium (avg diff on
  // overlapping bands, default +$2.25).
  const diffs = BANDS.filter((b) => decoCurve.hoodie[b] !== null && decoCurve.tee[b] !== null).map((b) => decoCurve.hoodie[b]! - decoCurve.tee[b]!);
  const hoodiePremium = diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : 2.25;
  for (const b of BANDS) if (decoCurve.hoodie[b] === null && decoCurve.tee[b] !== null) decoCurve.hoodie[b] = decoCurve.tee[b]! + hoodiePremium;
  // Monotone non-increasing as qty grows.
  for (const g of ["tee", "hoodie"]) {
    for (let i = 1; i < BANDS.length; i++) {
      const prev = decoCurve[g][BANDS[i - 1]], cur = decoCurve[g][BANDS[i]];
      if (prev !== null && cur !== null && cur > prev) decoCurve[g][BANDS[i]] = prev;
    }
  }
  console.log("deco curves:", JSON.stringify(decoCurve));

  for (const st of STYLES) {
    // Blank basis: history first (>= 3 costed items), vendor fallback.
    const blanks: { qty: number; cost: number }[] = [];
    for (const it of items) {
      const bv = it.blank_vendor?.trim();
      if (!bv || !st.live.test(bv) || !it.cost_per_unit || it.cost_per_unit <= 0) continue;
      const q = qtyByItem.get(it.id) || 0;
      if (q < 1) continue;
      blanks.push({ qty: q, cost: it.cost_per_unit });
    }
    let histBlank: number | null = null;
    if (blanks.length >= 3) {
      let wq = 0, wc = 0;
      for (const b of blanks) { wq += b.qty; wc += b.qty * b.cost; }
      histBlank = wc / wq;
    }
    const vBlank = vendorBlank[st.code] ?? null;
    const blank = histBlank ?? vBlank;
    const blankSource = histBlank !== null ? "history" : vBlank !== null ? "vendor" : "none";
    const blankDrift = histBlank !== null && vBlank !== null ? histBlank / vBlank - 1 : null;

    // History realized-price reference.
    const histLines: Line[] = [];
    for (const h of hist) {
      const bs = h.blank_style?.trim();
      if (!bs || !st.hist.test(bs)) continue;
      const qty = h.qty || 0, price = h.unit_price || 0;
      if (qty < 1 || price <= 0) continue;
      histLines.push({ qty, price, weight: (h.txn_date || "") >= "2025-01-01" ? 2 : 1 });
    }
    const histOverall = weightedMean(histLines.filter((l) => bandFor(l.qty) !== null));

    console.log(`\n${st.name} — blank ${blank ? "$" + blank.toFixed(2) : "n/a"} (${blankSource}${blankDrift !== null ? `, ${(blankDrift * 100).toFixed(0)}% vs vendor` : ""}; ${blanks.length} items), ${histLines.length} history lines`);

    for (const band of BANDS) {
      const deco = decoCurve[st.group][band];
      const cost = blank !== null && deco !== null ? blank + deco : null;
      const lo = cost !== null ? round25(cost / (1 - MARGIN_LO)) : null;
      const hi = cost !== null ? round25(cost / (1 - MARGIN_HI)) : null;

      const bandHist = histLines.filter((l) => bandFor(l.qty) === band);
      const histUnits = bandHist.reduce((s, l) => s + l.qty, 0);
      let histLo: number | null = null, histHi: number | null = null;
      if (bandHist.length >= 3 && histUnits >= 150) {
        histLo = weightedQuantile(bandHist, 0.3);
        histHi = weightedQuantile(bandHist, 0.7);
      } else if (histOverall !== null) {
        histLo = histOverall * 0.94;
        histHi = histOverall * 1.06;
      }
      if (histLo !== null) histLo = round25(histLo);
      if (histHi !== null) histHi = round25(histHi);

      const reasons: string[] = [];
      if (blank === null) reasons.push("no blank cost");
      if (blankSource === "vendor") reasons.push("blank from vendor price (thin history)");
      if (blankDrift !== null && Math.abs(blankDrift) > 0.15) reasons.push(`paid blank ${blankDrift > 0 ? "above" : "below"} vendor price`);
      if (lo !== null && histLo !== null && lo < histLo) reasons.push("below history");
      if (lo !== null && histHi !== null && lo > histHi * 1.15) reasons.push("above history");
      const flagged = reasons.length > 0;

      const meta = {
        basis: "spec",
        spec: "screen print, 1-2 locations, standard inks",
        margin: `${MARGIN_LO * 100}-${MARGIN_HI * 100}% on sell`,
        blank: blank !== null ? Number(blank.toFixed(2)) : null,
        blank_source: blankSource,
        vendor_blank: vBlank,
        deco: deco !== null ? Number(deco.toFixed(2)) : null,
        cost_basis: cost !== null ? Number(cost.toFixed(2)) : null,
        cost_items: blanks.length,
        hist_lo: histLo,
        hist_hi: histHi,
        hist_lines: bandHist.length,
        flagged,
        flag_reasons: reasons,
        seeded_at: new Date().toISOString(),
      };

      console.log(`   ${String(band).padStart(3)}+  ${lo !== null ? `$${lo.toFixed(2)}–$${hi!.toFixed(2)}` : "— no data —"}  (blank ${blank !== null ? "$" + blank.toFixed(2) : "?"} + print ${deco !== null ? "$" + deco.toFixed(2) : "?"}; hist ${histLo !== null ? `$${histLo.toFixed(2)}–$${histHi!.toFixed(2)}` : "n/a"}${flagged ? " ⚑ " + reasons.join(", ") : ""})`);
      if (dry) continue;

      const { data: existing, error: exErr } = await sb
        .from("menu_rates")
        .select("id,edited_at")
        .eq("style_code", st.code)
        .eq("band_min", band)
        .maybeSingle();
      if (exErr) throw exErr;

      if (existing) {
        const patch: Record<string, unknown> = {
          seeded_lo: lo, seeded_hi: hi, seed_meta: meta,
          style_name: st.name, product_group: st.group, lane: st.lane, sort: st.sort,
          updated_at: new Date().toISOString(),
        };
        if (!existing.edited_at) { patch.price_lo = lo; patch.price_hi = hi; }
        const { error } = await sb.from("menu_rates").update(patch as never).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("menu_rates").insert({
          product_group: st.group, lane: st.lane, style_code: st.code,
          style_name: st.name, band_min: band,
          price_lo: lo, price_hi: hi, seeded_lo: lo, seeded_hi: hi,
          seed_meta: meta, sort: st.sort,
        } as never);
        if (error) throw error;
      }
    }
  }
  console.log(dry ? "\nDRY RUN — nothing written." : "\nmenu_rates seeded (spec-anchored cost-plus).");
}

main().catch((e) => { console.error(e); process.exit(1); });
