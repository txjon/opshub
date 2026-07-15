#!/usr/bin/env node
// READ-ONLY audit: find items whose legacy done-flags (webstore_entered_at,
// forwarded_at) are NOT backed by the movement ledger. These are the items a
// v2 recompute would "un-enter"/"un-forward" after cutover. No writes.
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const sumQ = (q) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

(async () => {
  // pull entered / forwarded items
  const { data: items, error } = await sb
    .from("items")
    .select("id, name, job_id, webstore_entered_at, forwarded_at, forward_tracking, shipping_route, buy_sheet_lines(size, qty_ordered)");
  if (error) { console.error(error); process.exit(1); }

  const flagged = (items || []).filter(it => it.webstore_entered_at || it.forwarded_at);
  console.log(`Items with a legacy done-flag: ${flagged.length}\n`);

  // net movement totals per item, per type
  let enteredRisk = 0, forwardRisk = 0;
  for (const it of flagged) {
    const ordered = sumQ(Object.fromEntries((it.buy_sheet_lines || []).map(l => [l.size, Number(l.qty_ordered) || 0])));
    const { data: mv } = await sb.from("movements").select("type, qtys").eq("item_id", it.id);
    const net = (type) => {
      const m = {};
      for (const r of (mv || [])) { if (r.type !== type) continue; for (const [s, n] of Object.entries(r.qtys || {})) m[s] = (m[s] || 0) + (Number(n) || 0); }
      return sumQ(m);
    };
    const staged = net("stage"), forwarded = net("forward");
    if (it.webstore_entered_at) {
      const backed = ordered > 0 && staged >= ordered;
      if (!backed) { enteredRisk++; console.log(`  ENTERED-RISK  ${it.name.slice(0,34).padEnd(34)}  ordered=${ordered} staged=${staged}`); }
    }
    if (it.forwarded_at) {
      const backed = ordered > 0 && forwarded >= ordered;
      if (!backed) { forwardRisk++; console.log(`  FORWARD-RISK  ${it.name.slice(0,34).padEnd(34)}  ordered=${ordered} forwarded=${forwarded}`); }
    }
  }
  console.log(`\nEntered flags NOT backed by ledger: ${enteredRisk}`);
  console.log(`Forwarded flags NOT backed by ledger: ${forwardRisk}`);
  console.log(`(these would be cleared by a v2 recompute after cutover unless movements are backfilled)`);
})();
