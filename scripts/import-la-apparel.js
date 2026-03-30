#!/usr/bin/env node
/**
 * Parse LA Apparel price list PDF and import to Supabase.
 * Usage: node scripts/import-la-apparel.js [path-to-pdf]
 * Default: /Users/jonburrow/Desktop/Wholesale-Price-List-2.24.2026.pdf
 */

const { execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pdfPath = process.argv[2] || "/Users/jonburrow/Desktop/Wholesale-Price-List-2.24.2026.pdf";

async function main() {
  console.log("Extracting text from PDF...");
  const raw = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: "utf8" });
  const lines = raw.split("\n");

  let currentCategory = "Men / Unisex";
  const rows = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect category headers
    if (/^(Men \/ Unisex|Womens|Kids - Youth|Kids - Toddler|Kids - Infant|Accessories)\s*$/.test(trimmed)) {
      currentCategory = trimmed;
      continue;
    }

    // Skip header lines
    if (trimmed.startsWith("Style") || trimmed.startsWith("Price in USD") || trimmed.startsWith("Wholesale") || trimmed.startsWith("While every") || trimmed.startsWith("subject to")) continue;

    // Parse data rows: style_code  color_type  description  case_pack  sizes  ($ case) ($ dozen) ($ piece)
    const match = line.match(/^\s*([A-Z0-9]+\d+[A-Z]*)\s+(White|Colors|[A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(.+?)\s+(\d+)\s+([\w\-\/,\s]+?)\s+[\($-]+\s*([\d.]+)\)?/);
    if (match) {
      const [, styleCode, colorType, description, casePack, sizes, casePrice] = match;
      rows.push({
        category: currentCategory,
        style_code: styleCode.trim(),
        color_type: colorType.trim(),
        description: description.trim(),
        case_pack: parseInt(casePack),
        sizes: sizes.trim(),
        case_price: parseFloat(casePrice),
      });
    }
  }

  console.log(`Parsed ${rows.length} rows`);
  if (rows.length === 0) { console.log("No rows parsed — check PDF format"); return; }

  // Show sample
  console.log("\nSample rows:");
  rows.slice(0, 5).forEach(r => console.log(`  ${r.style_code} | ${r.color_type} | ${r.description} | ${r.sizes} | $${r.case_price} | ${r.category}`));

  // Clear existing and insert
  console.log("\nClearing existing la_apparel_catalog...");
  await supabase.from("la_apparel_catalog").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // Insert in batches
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("la_apparel_catalog").insert(batch);
    if (error) { console.error("Insert error:", error.message); return; }
    console.log(`  Inserted ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }

  // Summary
  const styles = [...new Set(rows.map(r => r.style_code))];
  const cats = [...new Set(rows.map(r => r.category))];
  console.log(`\nDone! ${styles.length} styles across ${cats.length} categories`);
  cats.forEach(c => {
    const count = [...new Set(rows.filter(r => r.category === c).map(r => r.style_code))].length;
    console.log(`  ${c}: ${count} styles`);
  });
}

main().catch(e => console.error(e));
