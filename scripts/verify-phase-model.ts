// Verify lib/phase-model against the locked scenarios from the sim.
//   run:  npx tsx scripts/verify-phase-model.ts
import { computePhase, type PhaseItem, type Route } from "../lib/phase-model";

const mk = (route: Route, o: Partial<PhaseItem> = {}): PhaseItem => ({
  route, poSent: false, shippedTotal: 0, receivedTotal: 0, forwardedTotal: 0, enteredTotal: 0, done: false, ...o,
});
// item stage constructors
const preProd = (r: Route) => mk(r, { poSent: false });
const inProd = (r: Route) => mk(r, { poSent: true });
const shipped = (r: Route) => mk(r, { poSent: true, shippedTotal: 10 });            // in transit to HPD
const atHpd = (r: Route) => mk(r, { poSent: true, shippedTotal: 10, receivedTotal: 10 });
const forwardedOut = () => mk("ship_through", { poSent: true, shippedTotal: 10, receivedTotal: 10, forwardedTotal: 10, done: true });
const enteredOut = () => mk("stage", { poSent: true, shippedTotal: 10, receivedTotal: 10, enteredTotal: 10, done: true });
const dropShipOut = () => mk("drop_ship", { poSent: true, shippedTotal: 10, done: true });

let pass = 0, fail = 0;
function check(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

console.log("PHASE MODEL — scenario checks\n");

// dynamic approval gate
check("Pending Client", computePhase({ gate: { quoteApproved: true, paymentReceived: false, proofsApproved: false }, items: [preProd("ship_through")] }).job.label, "Pending Client");
check("Pending Payment (proofs in, unpaid)", computePhase({ gate: { quoteApproved: true, paymentReceived: false, proofsApproved: true }, items: [preProd("ship_through")] }).job.label, "Pending Payment");
check("Pending Approval (paid, no proofs)", computePhase({ gate: { quoteApproved: true, paymentReceived: true, proofsApproved: false }, items: [preProd("ship_through")] }).job.label, "Pending Approval");
check("Intake (no quote)", computePhase({ gate: { quoteApproved: false, paymentReceived: false, proofsApproved: false }, items: [preProd("ship_through")] }).job.label, "Intake");

const met = { quoteApproved: true, paymentReceived: true, proofsApproved: true };

// cleared vs in production
check("Cleared for production (gate met, no PO)", computePhase({ gate: met, items: [preProd("ship_through"), preProd("stage")] }).job.label, "Cleared for production");
check("Cleared → client sees order received", computePhase({ gate: met, items: [preProd("ship_through")] }).client, "order_received");

// mixed in flight
const mixed = computePhase({ gate: met, items: [atHpd("ship_through"), shipped("ship_through"), inProd("stage"), inProd("drop_ship")] });
check("Mixed → job In production", mixed.job.label, "In production");
check("Mixed → client In production", mixed.client, "in_production");
check("Mixed → fulfillment 0/4", mixed.fulfillment, { out: 0, total: 4 });
check("Mixed → item stages", mixed.itemStages, ["at_hpd", "shipped", "in_production", "in_production"]);

// partial out to client (Gundam forwarded✓, Globe at HPD, Bait stage shipped, FOG drop-ship shipped✓)
const partItems = [forwardedOut(), atHpd("ship_through"), shipped("stage"), dropShipOut()];
const partialSent = computePhase({ gate: met, items: partItems, noticeSent: true });
check("Partial (notice sent) → Partially shipped", partialSent.client, "partially_shipped");
check("Partial → job still In production", partialSent.job.label, "In production");
check("Partial → fulfillment 2/4", partialSent.fulfillment, { out: 2, total: 4 });
const partialUnsent = computePhase({ gate: met, items: partItems, noticeSent: false });
check("Partial but NO notice → client stays In production (gated)", partialUnsent.client, "in_production");

// all done
const done = computePhase({ gate: met, items: [forwardedOut(), forwardedOut(), enteredOut(), dropShipOut()], noticeSent: true });
check("All done → job Complete", done.job.label, "Complete");
check("All done → client Shipped", done.client, "shipped");
check("All done → fulfillment 4/4", done.fulfillment, { out: 4, total: 4 });

// webstore-only order has no client status
check("Stage-only → client none", computePhase({ gate: met, items: [enteredOut(), inProd("stage")], noticeSent: true }).client, "none");

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
