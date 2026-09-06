// Seed menu_rates from job history + live items. Run: npx tsx scripts/seed-menu-rates.ts
//
// The script PROPOSES — it writes seeded_lo/seeded_hi (+ seed_meta) on every
// run, and copies them into the live price_lo/price_hi ONLY while a row has
// never been hand-edited (edited_at is null). Jon's edits always win.
//
// Sources, blended per style × qty band:
//   history_sales lines (blank_style match; 2025+ lines weighted 2×, live-item
//   prices weighted 3× — most current wins) and live items (blank_vendor
//   match, sell_per_unit, qty = summed buy_sheet_lines).
// A band with fewer than 3 lines or 150 units falls back to the style's
// overall average scaled by the global qty-curve ratio for its product group.
// A style with no usable data is left null + flagged for Jon to fill by hand.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const sb = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type StyleDef = {
  code: string;
  name: string;
  group: "tee" | "hoodie";
  lane: "la_apparel" | "as_colour" | "popular";
  sort: number;
  hist: RegExp;   // matches history_sales.blank_style (normalized codes)
  live: RegExp;   // matches items.blank_vendor (clean brand+style strings)
};

const STYLES: StyleDef[] = [
  { code: "1801GD",  name: "LA Apparel 1801GD",   group: "tee",    lane: "la_apparel", sort: 10, hist: /1801GD/i,            live: /LA Apparel 1801GD/i },
  { code: "1801MW",  name: "LA Apparel 1801MW",   group: "tee",    lane: "la_apparel", sort: 11, hist: /1801MW/i,            live: /LA Apparel 1801MW/i },
  { code: "5001",    name: "AS Colour 5001",      group: "tee",    lane: "as_colour",  sort: 20, hist: /^(AS|ASCOLOUR)5001/i, live: /AS Colour 5001/i },
  { code: "5026",    name: "AS Colour 5026",      group: "tee",    lane: "as_colour",  sort: 21, hist: /^(AS|ASCOLOUR)5026/i, live: /AS Colour 5026/i },
  { code: "5082",    name: "AS Colour 5082",      group: "tee",    lane: "as_colour",  sort: 22, hist: /^(AS|ASCOLOUR)5082/i, live: /AS Colour 5082/i },
  { code: "NL6210",  name: "Next Level 6210",     group: "tee",    lane: "popular",    sort: 30, hist: /^(NL|NEXTLEVEL)6210/i, live: /Next Level 6210/i },
  { code: "NL3600",  name: "Next Level 3600",     group: "tee",    lane: "popular",    sort: 31, hist: /^(NL|NEXTLEVEL)3600/i, live: /Next Level 3600/i },
  { code: "CC1717",  name: "Comfort Colors 1717", group: "tee",    lane: "popular",    sort: 32, hist: /^(CC|COMFORTCOLORS)1717/i, live: /Comfort Colors 1717/i },
  { code: "HF-09",   name: "LA Apparel HF-09",    group: "hoodie", lane: "la_apparel", sort: 40, hist: /HF.?09/i,            live: /LA Apparel HF.?09/i },
  { code: "5101",    name: "AS Colour 5101",      group: "hoodie", lane: "as_colour",  sort: 41, hist: /^(AS|ASCOLOUR)5101/i, live: /AS Colour 5101/i },
  { code: "IND4000", name: "Independent IND4000", group: "hoodie", lane: "popular",    sort: 42, hist: /IND4000/i,           live: /IND4000/i },
];

const BANDS = [48, 100, 250, 500];
const HIST_GROUP: Record<string, string> = { tee: "Tees", hoodie: "Hoodies" };

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
  for (const l of sorted) {
    cum += l.qty * l.weight;
    if (cum >= total * q) return l.price;
  }
  return sorted.length ? sorted[sorted.length - 1].price : null;
}

const round25 = (n: number) => Math.round(n * 4) / 4;

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

async function main() {
  const dry = process.argv.includes("--dry");

  const hist = await all<{ blank_style: string | null; product_group: string | null; qty: number | null; unit_price: number | null; txn_date: string | null }>(
    (a, b) => sb.from("history_sales").select("blank_style,product_group,qty,unit_price,txn_date").range(a, b)
  );
  const items = await all<{ id: string; blank_vendor: string | null; sell_per_unit: number | null; cost_per_unit: number | null }>(
    (a, b) => sb.from("items").select("id,blank_vendor,sell_per_unit,cost_per_unit").range(a, b)
  );
  const bsl = await all<{ item_id: string | null; qty_ordered: number | null }>(
    (a, b) => sb.from("buy_sheet_lines").select("item_id,qty_ordered").range(a, b)
  );
  const qtyByItem = new Map<string, number>();
  for (const l of bsl) {
    if (!l.item_id) continue;
    qtyByItem.set(l.item_id, (qtyByItem.get(l.item_id) || 0) + (l.qty_ordered || 0));
  }

  // Global qty-curve ratios per product group (fallback scaler).
  const curveRatio: Record<string, Record<number, number>> = {};
  for (const group of ["tee", "hoodie"] as const) {
    const lines: Line[] = [];
    for (const h of hist) {
      if (h.product_group !== HIST_GROUP[group]) continue;
      const qty = h.qty || 0, price = h.unit_price || 0;
      if (qty < 1 || price <= 0) continue;
      const band = bandFor(qty);
      if (band === null) continue;
      lines.push({ qty, price, weight: (h.txn_date || "") >= "2025-01-01" ? 2 : 1 });
    }
    const overall = weightedMean(lines)!;
    curveRatio[group] = {};
    for (const band of BANDS) {
      const bandLines = lines.filter((l) => bandFor(l.qty) === band);
      const m = weightedMean(bandLines);
      curveRatio[group][band] = m ? m / overall : 1;
    }
  }
  console.log("curve ratios:", JSON.stringify(curveRatio));

  for (const st of STYLES) {
    const lines: Line[] = [];
    let histLines = 0, liveLines = 0;

    for (const h of hist) {
      const bs = h.blank_style?.trim();
      if (!bs || !st.hist.test(bs)) continue;
      const qty = h.qty || 0, price = h.unit_price || 0;
      if (qty < 1 || price <= 0) continue;
      lines.push({ qty, price, weight: (h.txn_date || "") >= "2025-01-01" ? 2 : 1 });
      histLines++;
    }
    const costSamples: number[] = [];
    for (const it of items) {
      const bv = it.blank_vendor?.trim();
      if (!bv || !st.live.test(bv)) continue;
      if (it.cost_per_unit && it.cost_per_unit > 0) costSamples.push(it.cost_per_unit);
      const qty = qtyByItem.get(it.id) || 0;
      const price = it.sell_per_unit || 0;
      if (qty < 1 || price <= 0) continue;
      lines.push({ qty, price, weight: 3 });
      liveLines++;
    }
    const costBasis = costSamples.length
      ? costSamples.reduce((s, c) => s + c, 0) / costSamples.length
      : null;
    const overall = weightedMean(lines.filter((l) => bandFor(l.qty) !== null));

    console.log(`\n${st.name} — ${histLines} history lines, ${liveLines} live items, cost basis ${costBasis ? "$" + costBasis.toFixed(2) : "n/a"}`);

    // Compute every band first, then enforce monotonicity (a larger qty may
    // never price above a smaller one — walk from 500 down, pulling smaller
    // bands UP; low-qty bands collect junk cheap lines and a menu showing
    // "48 costs less than 100" reads broken).
    const computed: { band: number; lo: number | null; hi: number | null; source: string; bandLines: Line[]; units: number }[] = [];
    for (const band of BANDS) {
      const bandLines = lines.filter((l) => bandFor(l.qty) === band);
      const units = bandLines.reduce((s, l) => s + l.qty, 0);
      let lo: number | null = null, hi: number | null = null, source = "";

      if (bandLines.length >= 3 && units >= 150) {
        lo = weightedQuantile(bandLines, 0.3);
        hi = weightedQuantile(bandLines, 0.7);
        source = "direct";
      } else if (overall !== null) {
        const scaled = overall * curveRatio[st.group][band];
        lo = scaled * 0.94;
        hi = scaled * 1.06;
        source = "curve-fallback";
      } else {
        source = "no-data";
      }
      if (lo !== null && hi !== null && hi < lo) [lo, hi] = [hi, lo];
      computed.push({ band, lo, hi, source, bandLines, units });
    }
    for (let i = computed.length - 2; i >= 0; i--) {
      const larger = computed[i + 1], cur = computed[i];
      if (larger.lo !== null && cur.lo !== null && cur.lo < larger.lo) cur.lo = larger.lo;
      if (larger.hi !== null && cur.hi !== null && cur.hi < larger.hi) cur.hi = larger.hi;
    }

    for (const c of computed) {
      const { band, source, bandLines, units } = c;
      const lo = c.lo !== null ? round25(c.lo) : null;
      const hi = c.hi !== null ? round25(c.hi) : null;

      const flagged =
        source === "no-data" ||
        histLines + liveLines < 8 ||
        (costBasis !== null && lo !== null && lo < costBasis * 1.4);

      const meta = {
        source,
        lines: bandLines.length,
        units,
        hist_lines: histLines,
        live_items: liveLines,
        cost_basis: costBasis ? Number(costBasis.toFixed(2)) : null,
        flagged,
        seeded_at: new Date().toISOString(),
      };

      console.log(`   ${String(band).padStart(3)}+  ${lo !== null ? `$${lo.toFixed(2)}–$${hi!.toFixed(2)}` : "— no data —"}  (${source}, ${bandLines.length} lines / ${units}u${flagged ? " ⚑" : ""})`);
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
  console.log(dry ? "\nDRY RUN — nothing written." : "\nmenu_rates seeded.");
}

main().catch((e) => { console.error(e); process.exit(1); });
