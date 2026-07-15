// Phase 0 verification harness — proves lib/item-derivation.ts against every
// hard scenario from the agreed spec + the ten answered holes. Pure, no DB.
//   run:  npx tsx scripts/verify-item-derivation.ts
import { deriveItem, type Movement, type SizeQtys, type ItemInput } from "../lib/item-derivation";
import { shipmentGroupKey } from "../lib/shipment-grouping";

let pass = 0, fail = 0;
const fails: string[] = [];
function ok(cond: boolean, label: string) {
  if (cond) { pass++; } else { fail++; fails.push(label); console.log("  ✗ " + label); }
}
const sum = (q: SizeQtys) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);
const eqMap = (got: SizeQtys, want: SizeQtys, label: string) => ok(JSON.stringify(sortK(got)) === JSON.stringify(sortK(want)), `${label}  (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);
const eqN = (got: number, want: number, label: string) => ok(got === want, `${label}  (got ${got} want ${want})`);
const isT = (got: boolean, label: string) => ok(got === true, label);
const isF = (got: boolean, label: string) => ok(got === false, label);
function sortK(o: SizeQtys) { const out: SizeQtys = {}; for (const k of Object.keys(o || {}).sort()) out[k] = o[k]; return out; }
const mv = (type: Movement["type"], qtys: SizeQtys, extra: Partial<Movement> = {}): Movement => ({ type, qtys, ...extra });

function scenario(name: string, input: ItemInput, checks: (s: ReturnType<typeof deriveItem>) => void) {
  console.log("\n▸ " + name);
  checks(deriveItem(input));
}

// A — in production, nothing shipped
scenario("A · in production (nothing shipped)",
  { ordered: { OSFA: 100 }, route: "ship_through", movements: [] },
  s => { eqN(s.shippedTotal, 0, "shipped 0"); eqN(s.owedTotal, 100, "owed 100"); eqN(s.shortageTotal, 0, "shortage 0"); isF(s.closed, "not closed"); ok(s.status === "in_production", "status in_production"); });

// B — partial wave, more coming
scenario("B · partial wave (more coming)",
  { ordered: { S: 300, M: 400, L: 300 }, route: "ship_through", movements: [mv("ship", { S: 300, M: 200 })] },
  s => { eqN(s.shippedTotal, 500, "shipped 500"); isF(s.closed, "not closed"); eqMap(s.owed, { M: 200, L: 300 }, "owed M200 L300"); eqN(s.shortageTotal, 0, "shortage 0"); ok(s.status === "partially_shipped", "status partially_shipped"); });

// C — final wave completes fully
scenario("C · final wave completes the order",
  { ordered: { S: 300, M: 400, L: 300 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { S: 300, M: 200 }), mv("ship", { M: 200, L: 300 })] },
  s => { eqN(s.shippedTotal, 1000, "shipped 1000"); isT(s.fullyShipped, "fully shipped"); isT(s.closed, "closed"); eqN(s.owedTotal, 0, "owed 0"); eqN(s.shortageTotal, 0, "shortage 0"); ok(s.status === "shipped", "status shipped"); });

// D — FINAL-SHORT (H4): shipped less than ordered, marked final → shortage, not owed
scenario("D · short-final → shortage not owed (H4)",
  { ordered: { OSFA: 1000 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 500 }), mv("ship", { OSFA: 495 })] },
  s => { eqN(s.shippedTotal, 995, "shipped 995"); isT(s.closed, "closed"); eqN(s.owedTotal, 0, "owed 0 (nothing more coming)"); eqMap(s.shortage, { OSFA: 5 }, "shortage 5"); ok(s.status === "shipped", "status shipped"); });

// E — stacked pulls (H8): production + receiving pulls both come out
scenario("E · stacked pulls (H8)",
  { ordered: { OSFA: 100 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 100 }), mv("receive", { OSFA: 100 }), mv("pull", { OSFA: 10 }), mv("pull", { OSFA: 5 })] },
  s => { eqN(s.pulledTotal, 15, "pulled 15 (stacked)"); eqN(s.availableToForwardTotal, 85, "available 85"); eqN(s.onHandTotal, 85, "onHand 85"); });

// F — over one size, under another (H6) → mismatch flag
scenario("F · over-one / under-another receive → flag (H6)",
  { ordered: { M: 100, L: 100 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { M: 100, L: 100 }), mv("receive", { M: 105, L: 95 })] },
  s => { eqMap(s.overReceived, { M: 5 }, "over M5"); eqMap(s.underReceived, { L: 5 }, "under L5"); isT(s.sizeMismatchFlag, "size-mismatch flag"); isT(s.fullyReceived, "fully received (200≥200)"); });

// G — reversal nets to zero
scenario("G · reversal backs out a wave",
  { ordered: { OSFA: 100 }, route: "ship_through", movements: [mv("ship", { OSFA: 100 }), mv("ship", { OSFA: -100 }, { reversesId: "x" })] },
  s => { eqN(s.shippedTotal, 0, "shipped 0 after reversal"); ok(s.status === "in_production", "status in_production"); });

// H — over-ship is an accepted positive variance
scenario("H · over-ship (positive variance)",
  { ordered: { OSFA: 100 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 105 })] },
  s => { eqN(s.shippedTotal, 105, "shipped 105"); isT(s.fullyShipped, "fully shipped"); eqN(s.shortageTotal, 0, "no shortage"); eqMap(s.overShipped, { OSFA: 5 }, "overShipped 5"); });

// I — stage: enter into Shopify = end of road
scenario("I · stage → entered into Shopify",
  { ordered: { OSFA: 50 }, route: "stage", shipFinal: true, movements: [mv("ship", { OSFA: 50 }), mv("receive", { OSFA: 50 }), mv("stage", { OSFA: 50 })] },
  s => { eqN(s.enteredTotal, 50, "entered 50"); eqN(s.availableToEnterTotal, 0, "avail-to-enter 0"); eqN(s.onHandTotal, 0, "onHand 0"); ok(s.status === "entered", "status entered"); });

// J — the forward-once gate does NOT hang on a short-final item
scenario("J · short-final, fully received → ready downstream (no hang)",
  { ordered: { OSFA: 1000 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 500 }), mv("ship", { OSFA: 495 }), mv("receive", { OSFA: 995 })] },
  s => { isT(s.closed, "closed"); isT(s.fullyReceived, "fully received (995≥995)"); isT(s.readyDownstream, "READY downstream — proceeds with 995, doesn't wait on the 5"); eqN(s.availableToForwardTotal, 995, "available 995"); });

// K — mid-receive: not ready, but partial available to forward
scenario("K · mid-receive (partial in)",
  { ordered: { OSFA: 100 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 100 }), mv("receive", { OSFA: 60 })] },
  s => { isF(s.fullyReceived, "not fully received (60<100)"); isF(s.readyDownstream, "not ready (still receiving)"); ok(s.status === "receiving", "status receiving"); eqN(s.availableToForwardTotal, 60, "60 available to forward now"); });

// L — forwarded fully → done
scenario("L · forwarded to client",
  { ordered: { OSFA: 100 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 100 }), mv("receive", { OSFA: 100 }), mv("forward", { OSFA: 100 })] },
  s => { eqN(s.forwardedTotal, 100, "forwarded 100"); eqN(s.availableToForwardTotal, 0, "nothing left to forward"); eqN(s.onHandTotal, 0, "onHand 0"); ok(s.status === "forwarded", "status forwarded"); });

// M — multi-job box: two items sharing a shipmentId derive independently
scenario("M · multi-job box — item 1 (job A)",
  { ordered: { OSFA: 25 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 25 }, { shipmentId: "BOX1" }), mv("receive", { OSFA: 25 }, { shipmentId: "BOX1" })] },
  s => { eqN(s.receivedTotal, 25, "item1 received 25"); isT(s.readyDownstream, "item1 ready"); });
scenario("M · multi-job box — item 2 (job B, partial in same box)",
  { ordered: { OSFA: 13 }, route: "stage", shipFinal: true, movements: [mv("ship", { OSFA: 13 }, { shipmentId: "BOX1" }), mv("receive", { OSFA: 13 }, { shipmentId: "BOX1" })] },
  s => { eqN(s.receivedTotal, 13, "item2 received 13"); isT(s.readyDownstream, "item2 ready"); ok(s.route === "stage", "item2 route stage — independent of item1"); });

// N — route-aware DONE
scenario("N · drop_ship done when shipped (never touches HPD)",
  { ordered: { OSFA: 100 }, route: "drop_ship", shipFinal: true, movements: [mv("ship", { OSFA: 100 })] },
  s => { isT(s.done, "drop_ship + closed → done"); });
scenario("N · ship_through NOT done until forwarded",
  { ordered: { OSFA: 100 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 100 }), mv("receive", { OSFA: 100 })] },
  s => { isF(s.done, "received but not forwarded → not done"); });
scenario("N · ship_through done when forwarded",
  { ordered: { OSFA: 100 }, route: "ship_through", shipFinal: true, movements: [mv("ship", { OSFA: 100 }), mv("receive", { OSFA: 100 }), mv("forward", { OSFA: 100 })] },
  s => { isT(s.done, "forwarded → done"); });
scenario("N · stage done when entered",
  { ordered: { OSFA: 100 }, route: "stage", shipFinal: true, movements: [mv("ship", { OSFA: 100 }), mv("receive", { OSFA: 100 }), mv("stage", { OSFA: 100 })] },
  s => { isT(s.done, "entered → done"); });

// O — shipment grouping (a box spans jobs; keyed by how it left the vendor)
console.log("\n▸ O · shipment grouping");
const gTrk = (t: string, v = "vendorA") => shipmentGroupKey({ vendorKey: v, method: "tracking", tracking: t });
ok(gTrk("1Z999") === gTrk("1z999 "), "tracking normalizes case/space → same box");
ok(gTrk("1Z999", "vA") !== gTrk("1Z999", "vB"), "different vendor → different box");
const bol = (b: string) => shipmentGroupKey({ vendorKey: "vA", method: "bol", bol: b });
ok(bol("BOL-7") === bol("bol-7"), "BOL normalizes → one box (spans jobs)");
const pk = (d: string, v = "vA") => shipmentGroupKey({ vendorKey: v, method: "pickup", shipDate: d });
ok(pk("2026-07-12T09:00:00Z") === pk("2026-07-12T17:30:00Z"), "same vendor same DAY pickup → one box");
ok(pk("2026-07-12") !== pk("2026-07-13"), "different day → different pickup box");
ok(pk("2026-07-12", "vA") !== pk("2026-07-12", "vB"), "different vendor same day → different box");

console.log(`\n${"─".repeat(48)}\n  ${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
if (fail) { console.log("  failed:\n" + fails.map(f => "   · " + f).join("\n")); process.exit(1); }
