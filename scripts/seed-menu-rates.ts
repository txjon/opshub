// Seed menu_rates: COST-PLUS pricing (Jon, Sep 6 2026) — 25–35% margin on
// sell over all-in cost. Run: npx tsx scripts/seed-menu-rates.ts [--dry]
//
// price_lo = all-in cost / 0.75   (25% gross margin)
// price_hi = all-in cost / 0.65   (35% gross margin)
//
// Cost basis per style × qty band = qty-weighted avg of live items'
// cost_per_unit_all_in (blank + decoration), band from summed
// buy_sheet_lines. Bands with <2 costed items are filled from the style's
// overall all-in cost scaled by the product group's cost-vs-qty curve.
// A style with no costed items at all is left null + flagged for hand entry.
//
// History realized prices (the old seed basis) are computed the same way as
// before and stored in seed_meta.hist_lo/hist_hi as a REFERENCE — the grid
// shows them so divergence from what the market actually paid is visible.
// Flags: no cost data · thin cost data (<3 items) · below history (leaving
// money) · >15% above history hi (uncompetitive vs anything ever paid).
//
// The script PROPOSES — it always rewrites seeded_lo/seeded_hi + seed_meta,
// but copies them into live price_lo/price_hi only while edited_at is null.
// Jon's edits always win.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const sb = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MARGIN_LO = 0.25; // price_lo = cost / (1 - MARGIN_LO)
const MARGIN_HI = 0.35;

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
type CostPoint = { qty: number; cost: number };

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
const qwAvg = (pts: CostPoint[]) => {
  let wq = 0, wc = 0;
  for (const p of pts) { wq += p.qty; wc += p.qty * p.cost; }
  return wq > 0 ? wc / wq : null;
};

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
  const items = await all<{ id: string; blank_vendor: string | null; sell_per_unit: number | null; cost_per_unit_all_in: number | null }>(
    (a, b) => sb.from("items").select("id,blank_vendor,sell_per_unit,cost_per_unit_all_in").range(a, b)
  );
  const bsl = await all<{ item_id: string | null; qty_ordered: number | null }>(
    (a, b) => sb.from("buy_sheet_lines").select("item_id,qty_ordered").range(a, b)
  );
  const qtyByItem = new Map<string, number>();
  for (const l of bsl) {
    if (!l.item_id) continue;
    qtyByItem.set(l.item_id, (qtyByItem.get(l.item_id) || 0) + (l.qty_ordered || 0));
  }

  // Per-style cost points from live items with all-in cost.
  const costPointsByStyle = new Map<string, CostPoint[]>();
  for (const st of STYLES) costPointsByStyle.set(st.code, []);
  for (const it of items) {
    const bv = it.blank_vendor?.trim();
    if (!bv || !it.cost_per_unit_all_in || it.cost_per_unit_all_in <= 0) continue;
    const qty = qtyByItem.get(it.id) || 0;
    if (qty < 1) continue;
    for (const st of STYLES) {
      if (st.live.test(bv)) {
        costPointsByStyle.get(st.code)!.push({ qty, cost: it.cost_per_unit_all_in });
        break;
      }
    }
  }

  // Group cost-vs-qty curve (all menu styles in the group pooled): how much
  // cheaper does a unit get as the run grows. Used to fill bands a style has
  // no costed items in.
  const costCurve: Record<string, Record<number, number>> = {};
  for (const group of ["tee", "hoodie"] as const) {
    const pts = STYLES.filter((s) => s.group === group).flatMap((s) => costPointsByStyle.get(s.code)!);
    // Normalize each point by its style's own overall cost so cheap and
    // expensive styles mix without bias.
    const overallByStyle = new Map<string, number>();
    for (const s of STYLES.filter((s) => s.group === group)) {
      const o = qwAvg(costPointsByStyle.get(s.code)!);
      if (o) overallByStyle.set(s.code, o);
    }
    const norm: { qty: number; ratio: number }[] = [];
    for (const s of STYLES.filter((s) => s.group === group)) {
      const o = overallByStyle.get(s.code);
      if (!o) continue;
      for (const p of costPointsByStyle.get(s.code)!) norm.push({ qty: p.qty, ratio: p.cost / o });
    }
    costCurve[group] = {};
    for (const band of BANDS) {
      const bandPts = norm.filter((p) => bandFor(p.qty) === band);
      let wq = 0, wr = 0;
      for (const p of bandPts) { wq += p.qty; wr += p.qty * p.ratio; }
      costCurve[group][band] = wq > 0 ? wr / wq : 1;
    }
    // Enforce monotone non-increasing cost as qty grows.
    for (let i = 1; i < BANDS.length; i++) {
      const prev = costCurve[group][BANDS[i - 1]], cur = costCurve[group][BANDS[i]];
      if (cur > prev) costCurve[group][BANDS[i]] = prev;
    }
    console.log(`${group} cost curve:`, BANDS.map((b) => `${b}:${costCurve[group][b].toFixed(3)}`).join(" "));
  }
  // A group with too few banded cost points collapses to a flat curve (the
  // hoodie shape today) — a menu with no qty discount reads broken. Borrow
  // the tee curve, which has the volume.
  for (const group of ["hoodie"] as const) {
    const vals = BANDS.map((b) => costCurve[group][b]);
    if (Math.max(...vals) - Math.min(...vals) < 0.05) {
      costCurve[group] = { ...costCurve.tee };
      console.log(`${group} curve degenerate — using tee curve`);
    }
  }

  for (const st of STYLES) {
    const pts = costPointsByStyle.get(st.code)!;
    const overallCost = qwAvg(pts);

    // History reference lines (same recipe as the old seed).
    const histLines: Line[] = [];
    for (const h of hist) {
      const bs = h.blank_style?.trim();
      if (!bs || !st.hist.test(bs)) continue;
      const qty = h.qty || 0, price = h.unit_price || 0;
      if (qty < 1 || price <= 0) continue;
      histLines.push({ qty, price, weight: (h.txn_date || "") >= "2025-01-01" ? 2 : 1 });
    }
    const histOverall = weightedMean(histLines.filter((l) => bandFor(l.qty) !== null));

    console.log(`\n${st.name} — ${pts.length} costed items, overall all-in ${overallCost ? "$" + overallCost.toFixed(2) : "n/a"}, ${histLines.length} history lines`);

    // Band costs first (direct or curve-filled), then monotone clamp.
    const bandCost: { band: number; cost: number | null; source: string; n: number; units: number }[] = [];
    for (const band of BANDS) {
      const bandPts = pts.filter((p) => bandFor(p.qty) === band);
      const units = bandPts.reduce((s, p) => s + p.qty, 0);
      if (bandPts.length >= 2) {
        bandCost.push({ band, cost: qwAvg(bandPts), source: "direct", n: bandPts.length, units });
      } else if (overallCost !== null) {
        bandCost.push({ band, cost: overallCost * costCurve[st.group][band], source: "cost-curve", n: bandPts.length, units });
      } else {
        bandCost.push({ band, cost: null, source: "no-data", n: 0, units: 0 });
      }
    }
    for (let i = 1; i < bandCost.length; i++) {
      const prev = bandCost[i - 1].cost, cur = bandCost[i].cost;
      if (prev !== null && cur !== null && cur > prev) bandCost[i].cost = prev;
    }

    for (const bc of bandCost) {
      const { band, cost, source } = bc;
      const lo = cost !== null ? round25(cost / (1 - MARGIN_LO)) : null;
      const hi = cost !== null ? round25(cost / (1 - MARGIN_HI)) : null;

      // History reference for this band.
      const bandHist = histLines.filter((l) => bandFor(l.qty) === band);
      const histUnits = bandHist.reduce((s, l) => s + l.qty, 0);
      let histLo: number | null = null, histHi: number | null = null;
      if (bandHist.length >= 3 && histUnits >= 150) {
        histLo = weightedQuantile(bandHist, 0.3);
        histHi = weightedQuantile(bandHist, 0.7);
      } else if (histOverall !== null) {
        // Light fallback: overall history avg (unscaled) — reference only.
        histLo = histOverall * 0.94;
        histHi = histOverall * 1.06;
      }
      if (histLo !== null) histLo = round25(histLo);
      if (histHi !== null) histHi = round25(histHi);

      const reasons: string[] = [];
      if (source === "no-data") reasons.push("no cost data");
      if (pts.length > 0 && pts.length < 3) reasons.push("thin cost data");
      if (lo !== null && histLo !== null && lo < histLo) reasons.push("below history");
      if (lo !== null && histHi !== null && lo > histHi * 1.15) reasons.push("above history");
      const flagged = reasons.length > 0;

      const meta = {
        source,
        basis: "cost-plus",
        margin: `${MARGIN_LO * 100}-${MARGIN_HI * 100}% on sell`,
        cost_basis: cost !== null ? Number(cost.toFixed(2)) : null,
        cost_items: bc.n,
        cost_units: bc.units,
        hist_lo: histLo,
        hist_hi: histHi,
        hist_lines: bandHist.length,
        flagged,
        flag_reasons: reasons,
        seeded_at: new Date().toISOString(),
      };

      console.log(`   ${String(band).padStart(3)}+  ${lo !== null ? `$${lo.toFixed(2)}–$${hi!.toFixed(2)}` : "— no data —"}  (cost ${cost !== null ? "$" + cost.toFixed(2) : "n/a"} ${source}; hist ${histLo !== null ? `$${histLo.toFixed(2)}–$${histHi!.toFixed(2)}` : "n/a"}${flagged ? " ⚑ " + reasons.join(", ") : ""})`);
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
  console.log(dry ? "\nDRY RUN — nothing written." : "\nmenu_rates seeded (cost-plus).");
}

main().catch((e) => { console.error(e); process.exit(1); });
