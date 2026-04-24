#!/usr/bin/env node
/**
 * Rewrite the stored `line_items[].provider` on saved postage reports so
 * the client-facing value shows the clean carrier name instead of the
 * ShipStation source string.
 *
 *   Stamps.com            → USPS
 *   UPS by ShipStation    → UPS
 *
 * Idempotent: running twice is safe (already-normalized values pass
 * through unchanged).
 *
 * Usage:
 *   node scripts/normalize-postage-providers.js               # dry run, all postage reports
 *   node scripts/normalize-postage-providers.js --apply       # write
 *   node scripts/normalize-postage-providers.js --id=<uuid>   # scope to one report
 *   node scripts/normalize-postage-providers.js --id=<uuid> --apply
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const idArg = process.argv.find(a => a.startsWith("--id="));
const targetId = idArg ? idArg.slice("--id=".length) : null;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalize(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower.startsWith("stamps.com") || lower === "stamps") return "USPS";
  if (lower.startsWith("ups by shipstation") || lower === "ups by ss") return "UPS";
  return s;
}

(async () => {
  let q = sb.from("shipstation_reports")
    .select("id, period_label, clients(name), line_items, report_type")
    .eq("report_type", "postage");
  if (targetId) q = q.eq("id", targetId);
  const { data: reports, error } = await q;
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  if (!reports || reports.length === 0) {
    console.log("No postage reports found.");
    return;
  }

  console.log(`Scanning ${reports.length} postage report(s)${APPLY ? " — APPLYING" : " — dry run"}\n`);

  let totalChanged = 0;
  let reportsChanged = 0;

  for (const r of reports) {
    const lines = Array.isArray(r.line_items) ? r.line_items : [];
    if (lines.length === 0) continue;

    let changed = 0;
    const updated = lines.map(line => {
      const before = line.provider || "";
      const after = normalize(before);
      if (after !== before) {
        changed++;
        return { ...line, provider: after };
      }
      return line;
    });

    if (changed > 0) {
      reportsChanged++;
      totalChanged += changed;
      const label = `${r.clients?.name || "—"} · ${r.period_label}`;
      console.log(`  [${changed}/${lines.length}]  ${label}  (${r.id})`);
      if (APPLY) {
        const { error: uerr } = await sb.from("shipstation_reports")
          .update({ line_items: updated })
          .eq("id", r.id);
        if (uerr) console.error(`    ✖ update failed: ${uerr.message}`);
        else console.log(`    ✓ written`);
      }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${totalChanged} row rewrite(s) across ${reportsChanged} report(s).`);
  if (!APPLY && totalChanged > 0) {
    console.log("Re-run with --apply to write.");
  }
})();
