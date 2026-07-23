// Assert the locked scenario matrix against lib/date-chain (build-plan artifact,
// 2026-07-15). Run: npx tsx scripts/verify-date-chain.ts
import { deriveDateChain, poSendAllowed, transitDaysFor } from "../lib/date-chain";

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  if (!ok) fails++;
};

const SCORP = { lead: 90, transitDefaults: { ground: 2, freight: 2, ocean: 40 } };

// Happy path — Scorpion freight, stage route
let r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL", poSentDate: "2026-07-15", shipByAgreed: "2026-10-13" });
eq("happy: suggested = PO+90", r.suggestedShipBy, "2026-10-13");
eq("happy: arrival = ship-by+2", r.arrival, "2026-10-15");
eq("happy: eta = arrival+3 (stage)", r.clientEta, "2026-10-18");
eq("happy: no flags", r.flags, []);

// Vendor slips 4d (production2 in-line edit) — plan kept, downstream re-derives
r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL", shipByAgreed: "2026-10-13", shipByLive: "2026-10-17" });
eq("slip: agreed kept", r.shipByAgreed, "2026-10-13");
eq("slip: live wins", r.shipBy, "2026-10-17");
eq("slip: slippedDays", r.slippedDays, 4);
eq("slip: arrival re-derived", r.arrival, "2026-10-19");
eq("slip: flagged", r.flags.length >= 1, true);

// Box delayed (receiving2 edit) — arrival override, upstream untouched
r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL", shipByAgreed: "2026-10-13", arrivalOverride: "2026-10-20" });
eq("box: ship-by untouched", r.shipBy, "2026-10-13");
eq("box: arrival = override", r.arrival, "2026-10-20");
eq("box: eta from override", r.clientEta, "2026-10-23");
eq("box: arrivalSource", r.arrivalSource, "override");

// ASAP pending → TBD everywhere; then a date lands in-line
r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL", shipByAgreed: "ASAP" });
eq("asap: pending", r.asap, true);
eq("asap: shipBy TBD", r.shipBy, null);
eq("asap: eta TBD", r.clientEta, null);
r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL", shipByAgreed: "ASAP", shipByLive: "2026-08-01" });
eq("asap landed: derives forward", r.clientEta, "2026-08-06");
eq("asap landed: no longer pending", r.asap, false);

// Drop-ship — no HPD leg, no buffer
r = deriveDateChain({ route: "drop_ship", ...SCORP, shipMethod: "UPS Ground", shipByAgreed: "2026-08-01" });
eq("drop: no arrival node", r.arrival, null);
eq("drop: eta = ship-by + ground 2", r.clientEta, "2026-08-03");

// Local pickup — 0 transit regardless of vendor defaults
eq("pickup transit = 0", transitDaysFor(SCORP.transitDefaults, "Pick Up"), 0);
r = deriveDateChain({ route: "ship_through", ...SCORP, shipMethod: "Pick Up", shipByAgreed: "2026-08-01" });
eq("pickup: arrival = ship-by", r.arrival, "2026-08-01");
eq("pickup: eta = +1 (ship_through)", r.clientEta, "2026-08-02");

// Per-item ship/exit-factory override (production tab) tops the ship leg and
// re-derives arrival + client ETA WITH transit added (the ocean-safe path — the
// old model treated the production edit as an arrival and skipped transit).
r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL", shipByAgreed: "2026-10-13", shipByLive: "2026-10-17", shipByItemOverride: "2026-09-10" });
eq("ship_est: tops ship leg over live+agreed", r.shipBy, "2026-09-10");
eq("ship_est: arrival = ship+2 transit", r.arrival, "2026-09-12");
eq("ship_est: eta = arrival+3 (stage)", r.clientEta, "2026-09-15");
eq("ship_est: pulled-in slip not flagged", r.flags.some(f => f.includes("slipped")), false);

// Receiving land-date override still wins the arrival leg over a ship_est
r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL", shipByItemOverride: "2026-09-10", arrivalOverride: "2026-09-20" });
eq("land override wins arrival", r.arrival, "2026-09-20");
eq("land override: eta = +3", r.clientEta, "2026-09-23");

// In-hands set + chain misses it
r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL", shipByAgreed: "2026-10-13", inHands: "2026-10-15" });
eq("in-hands: miss flagged", r.flags.some(f => f.includes("after the requested in-hands")), true);

// Pre-cutover job, no ship-by — TBD, never a guess
r = deriveDateChain({ route: "stage", ...SCORP, shipMethod: "Freight / LTL" });
eq("no ship-by: all TBD", [r.shipBy, r.arrival, r.clientEta], [null, null, null]);

// Vendor with no ocean default asked to ship ocean → TBD (no invented number)
r = deriveDateChain({ route: "stage", lead: 21, transitDefaults: { ground: 3, freight: 3 }, shipMethod: "Ocean", shipByAgreed: "2026-08-01" });
eq("missing ocean default: arrival TBD", r.arrival, null);

// The gate
eq("gate: blank blocked", poSendAllowed(null), false);
eq("gate: date passes", poSendAllowed("2026-08-01"), true);
eq("gate: ASAP passes", poSendAllowed("ASAP"), true);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
