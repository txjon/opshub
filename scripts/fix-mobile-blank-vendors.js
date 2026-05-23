#!/usr/bin/env node
/**
 * Items whose blank_vendor is just a bare style code ("1717") instead
 * of the canonical "{Brand} {Style}" shape ("Comfort Colors 1717").
 * Caused by a bug in MobileBlankPicker that wrote picked.styleName as
 * blank_vendor instead of brandName + styleName (fixed forward).
 *
 * This script:
 *  1) Finds items where blank_vendor matches /^\d/ (starts with a
 *     digit — real brands all start with letters).
 *  2) Calls S&S /styles?search={style} to fetch brand metadata.
 *  3) Updates blank_vendor (and `style` field if present) to the
 *     canonical "{brand} {style}" string.
 *
 * Usage:
 *   node scripts/fix-mobile-blank-vendors.js          # dry run
 *   node scripts/fix-mobile-blank-vendors.js --apply  # commit
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SS_BASE = "https://api.ssactivewear.com/v2";
const ssAuth = "Basic " + Buffer.from(`${process.env.SS_USERNAME}:${process.env.SS_PASSWORD}`).toString("base64");

const BARE_STYLE = /^[A-Za-z]?\d{2,6}[A-Za-z0-9]*$/; // 1717, 3001CVC, G500, etc.

async function lookupBrand(styleCode) {
  const res = await fetch(`${SS_BASE}/styles?search=${encodeURIComponent(styleCode)}`, {
    headers: { Authorization: ssAuth, "Content-Type": "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  // Prefer an exact styleName match — search returns fuzzy hits.
  const exact = data.find(s => (s.styleName || "").toLowerCase() === styleCode.toLowerCase());
  return exact || data[0];
}

(async () => {
  const { data: items, error } = await sb
    .from("items")
    .select("id, name, blank_vendor, blank_sku, job_id, jobs(job_number)")
    .not("blank_vendor", "is", null);
  if (error) { console.error("query failed:", error); process.exit(1); }

  const candidates = (items || []).filter(it => {
    const v = (it.blank_vendor || "").trim();
    return v && BARE_STYLE.test(v) && !v.includes(" ");
  });

  console.log(`${candidates.length} candidate item${candidates.length === 1 ? "" : "s"} with bare-style blank_vendor.\n`);
  if (candidates.length === 0) return;

  // Cache S&S lookups by style — re-using "Comfort Colors 1717" across
  // every 1717 item is the common case.
  const brandCache = new Map();
  let fixed = 0, missing = 0, skipped = 0;

  for (const it of candidates) {
    const style = it.blank_vendor.trim();
    let match = brandCache.get(style);
    if (match === undefined) {
      match = await lookupBrand(style);
      brandCache.set(style, match);
      // S&S API politeness — 100ms between lookups for fresh keys.
      await new Promise(r => setTimeout(r, 100));
    }
    if (!match || !match.brandName) {
      console.log(`  · MISS  item=${it.id.slice(0, 8)} job=${it.jobs?.job_number || "?"} "${it.name}" — no S&S match for "${style}"`);
      missing++;
      continue;
    }
    const newVendor = `${match.brandName} ${match.styleName || style}`.trim();
    if (newVendor === it.blank_vendor) { skipped++; continue; }
    console.log(`  ${APPLY ? "FIX " : "WOULD"}  ${it.jobs?.job_number || "?"} / ${it.name.padEnd(28).slice(0, 28)}  "${it.blank_vendor}" → "${newVendor}"`);
    if (APPLY) {
      const { error: upErr } = await sb.from("items").update({ blank_vendor: newVendor }).eq("id", it.id);
      if (upErr) console.error("    UPDATE FAILED:", upErr.message);
      else fixed++;
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${APPLY ? fixed : candidates.length - missing - skipped}    Missing brand: ${missing}    Skipped: ${skipped}`);
  if (!APPLY) console.log("\nRe-run with --apply to commit.");
})();
