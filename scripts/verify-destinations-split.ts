// Split-shipment allocation harness — proves lib/destinations allocateForward
// (fill order R7, readiness/done H6, legacy unlocated forwards). Pure, no DB.
//   run:  npx tsx scripts/verify-destinations-split.ts
import { allocateForward, type ItemDestination } from "../lib/destinations";
let pass = 0, fail = 0;
const ok = (c: boolean, l: string) => { if (c) pass++; else { fail++; console.log("  ✗ " + l); } };
const loc = (id: string, label: string): ItemDestination["shipTo"] => ({ locationId: id, label, address: label + "\n1 St", contactName: null, contactPhone: null });
const A = loc("a", "Main"), B = loc("b", "Marketing");
const dests = (aQ: any, bQ: any): ItemDestination[] => [{ shipTo: A, qtys: aQ, sortOrder: 0 }, { shipTo: B, qtys: bQ, sortOrder: 1 }];
const none = new Map<string, any>();

console.log("▸ 1 nothing on hand, more coming");
{ const r = allocateForward({ dests: dests({ S: 60, M: 40 }, { S: 20, M: 30 }), availableToForward: {}, forwardedByLoc: none, unlocatedForwarded: {}, stillComing: true });
  ok(r[0].availableTotal === 0 && r[0].comingTotal === 100 && !r[0].ready && !r[0].done, "Main waiting on 100");
  ok(r[1].comingTotal === 50 && !r[1].ready && !r[1].done, "Marketing waiting on 50"); }

console.log("▸ 2 fill order: first destination takes first");
{ const r = allocateForward({ dests: dests({ S: 60, M: 40 }, { S: 20, M: 30 }), availableToForward: { S: 70, M: 40 }, forwardedByLoc: none, unlocatedForwarded: {}, stillComing: true });
  ok(r[0].availableTotal === 100 && r[0].ready, "Main fully covered → ready");
  ok(r[1].available.S === 10 && r[1].available.M === undefined && r[1].availableTotal === 10 && r[1].comingTotal === 40 && !r[1].ready, "Marketing gets the leftover 10 S, waits on 40");
  ok(r[0].availableTotal + r[1].availableTotal === 110, "pool never double-counted"); }

console.log("▸ 3 after forwarding Main, Marketing owns the pool");
{ const fwd = new Map([["a", { S: 60, M: 40 }]]);
  const r = allocateForward({ dests: dests({ S: 60, M: 40 }, { S: 20, M: 30 }), availableToForward: { S: 20, M: 30 }, forwardedByLoc: fwd, unlocatedForwarded: {}, stillComing: false });
  ok(r[0].remainingTotal === 0 && r[0].done, "Main done");
  ok(r[1].availableTotal === 50 && r[1].ready && !r[1].done, "Marketing ready with all 50"); }

console.log("▸ 4 H6: vendor shipped short and closed — last destination must not hang");
{ const fwd = new Map([["a", { S: 60, M: 40 }]]);
  const r = allocateForward({ dests: dests({ S: 60, M: 40 }, { S: 20, M: 30 }), availableToForward: { S: 5 }, forwardedByLoc: fwd, unlocatedForwarded: {}, stillComing: false });
  ok(r[1].availableTotal === 5 && r[1].shortTotal === 45 && r[1].comingTotal === 0 && r[1].ready, "Marketing: 5 on hand, 45 short, still READY (forward what's there)");
  const r2 = allocateForward({ dests: dests({ S: 60, M: 40 }, { S: 20, M: 30 }), availableToForward: {}, forwardedByLoc: fwd, unlocatedForwarded: {}, stillComing: false });
  ok(r2[1].availableTotal === 0 && r2[1].shortTotal === 50 && r2[1].done, "Marketing: nothing on hand, nothing coming → DONE (not stuck)"); }

console.log("▸ 5 legacy forwards with no box location count toward the first destination");
{ const r = allocateForward({ dests: dests({ S: 60, M: 40 }, { S: 20, M: 30 }), availableToForward: { S: 20, M: 30 }, forwardedByLoc: none, unlocatedForwarded: { S: 60, M: 40 }, stillComing: false });
  ok(r[0].sentTotal === 100 && r[0].done, "Main satisfied by the unlocated forward");
  ok(r[1].sentTotal === 0 && r[1].availableTotal === 50 && r[1].ready, "Marketing untouched, ready"); }

console.log("▸ 6 unsplit item = one destination, plain forward-once");
{ const one: ItemDestination[] = [{ shipTo: A, qtys: { S: 10 }, sortOrder: 0 }];
  const r = allocateForward({ dests: one, availableToForward: { S: 4 }, forwardedByLoc: none, unlocatedForwarded: {}, stillComing: true });
  ok(r.length === 1 && r[0].availableTotal === 4 && r[0].comingTotal === 6 && !r[0].ready, "partial in, holds");
  const r2 = allocateForward({ dests: one, availableToForward: { S: 10 }, forwardedByLoc: none, unlocatedForwarded: {}, stillComing: true });
  ok(r2[0].ready && !r2[0].done, "all in → ready"); }

console.log("▸ 7 partial forward to a destination keeps it open with the rest owed");
{ const fwd = new Map([["b", { S: 20 }]]);
  const r = allocateForward({ dests: dests({ S: 60, M: 40 }, { S: 20, M: 30 }), availableToForward: { M: 30 }, forwardedByLoc: fwd, unlocatedForwarded: {}, stillComing: true });
  ok(r[1].remainingTotal === 30 && r[0].availableTotal === 30 && r[1].availableTotal === 0, "Main takes the 30 M first (fill order), Marketing still owed its 30 M"); }

console.log("▸ 8 over-receipt: bonus units ride with the last destination, never stranded");
{ const r = allocateForward({ dests: dests({ S: 60, M: 40 }, { S: 20, M: 30 }), availableToForward: { S: 85, M: 70 }, forwardedByLoc: none, unlocatedForwarded: {}, stillComing: false });
  ok(r[0].availableTotal === 100 && r[0].ready, "Main exactly its share");
  ok(r[1].availableTotal === 55 && r[1].available.S === 25 && r[1].remainingTotal === 55 && r[1].ready, "Marketing gets its 50 + the 5 bonus S");
  const one: ItemDestination[] = [{ shipTo: A, qtys: { S: 10 }, sortOrder: 0 }];
  const r2 = allocateForward({ dests: one, availableToForward: { S: 12 }, forwardedByLoc: none, unlocatedForwarded: {}, stillComing: false });
  ok(r2[0].availableTotal === 12 && r2[0].ready, "unsplit over-receipt: all 12 forwardable (parity with the old board)"); }

console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
