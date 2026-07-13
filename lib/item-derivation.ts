// Item order-state derivation — the single source of truth for an ITEM (the
// order line for one job) in the three-object model (Shipment / Item / Job).
//
// EVERYTHING is derived from the append-only movement ledger — nothing is
// stored-and-mutated. Given an item's ordered qty, its route, its final-shipment
// flag, and its movements, this computes the complete state every surface reads:
// shipped / received / forwarded / entered / pulled / owed / shortage / variance
// / what's available downstream — all per size.
//
// The key thing the old code lacked: the FINAL-SHIPMENT signal. "Is more coming?"
// is ONE piece of truth (`shipFinal`, set by production when the last wave ships,
// or implied once fully shipped). It's what separates OWED (still coming, keep
// waiting) from SHORTAGE (closed short, proceed). Without it, a short-final item
// waits forever for units that will never arrive — the recurring hang.

export type SizeQtys = Record<string, number>;
export type Route = "drop_ship" | "ship_through" | "stage";
// Movement types (align with the DB `movements.type` constraint). `stage` IS the
// "enter into Shopify" movement — internal name kept from migration 119 (has
// data); the UI labels it "Enter into Shopify". `pull` is new (pulls in the ledger).
export type MovementType = "ship" | "receive" | "forward" | "stage" | "pull" | "adjust";

export type Movement = {
  type: MovementType;
  qtys: SizeQtys;              // per-size; a reversal carries negatives
  shipmentId?: string | null;  // the box this movement rode in (ship/receive/forward)
  reversesId?: string | null;
  id?: string | null;
};

export type ItemInput = {
  ordered: SizeQtys;
  route: Route;
  shipFinal?: boolean;         // "no more shipping coming" — set at the final wave
  movements: Movement[];
};

export type ItemState = {
  route: Route;
  ordered: SizeQtys; orderedTotal: number;
  shipped: SizeQtys; shippedTotal: number;
  received: SizeQtys; receivedTotal: number;
  forwarded: SizeQtys; forwardedTotal: number;
  entered: SizeQtys; enteredTotal: number;
  pulled: SizeQtys; pulledTotal: number;

  fullyShipped: boolean;       // shipped ≥ ordered on every size
  closed: boolean;             // no more shipping coming (final flag OR fully shipped)
  owed: SizeQtys; owedTotal: number;           // still to be shipped (only while NOT closed)
  shortage: SizeQtys; shortageTotal: number;   // ordered − shipped, but only once CLOSED (a real short)
  overShipped: SizeQtys;       // shipped − ordered per size (accepted positive variance)

  receiveVariance: SizeQtys;   // received − shipped, signed per size
  overReceived: SizeQtys;      // received > shipped
  underReceived: SizeQtys;     // received < shipped
  sizeMismatchFlag: boolean;   // closed AND over on one size AND under on another → flag production
  fullyReceived: boolean;      // received ≥ shipped (caught up to what shipped)

  availableToForward: SizeQtys; availableToForwardTotal: number; // ship_through: received − pulled − forwarded
  availableToEnter: SizeQtys; availableToEnterTotal: number;     // stage: received − pulled − entered
  onHand: SizeQtys; onHandTotal: number;       // received − pulled − forwarded − entered

  readyDownstream: boolean;    // closed AND fully received → ready to forward/enter (the "forward once" gate)
  status: ItemStatus;
  done: boolean;               // reached its route's endpoint — see routeDone()
};

// An item is DONE when it reaches the endpoint of ITS route:
//   drop_ship  → shipped (closed); it never touches HPD, so shipping = done
//   ship_through → forwarded to the client
//   stage        → entered into Shopify (end of OpsHub's road)
function routeDone(route: Route, status: ItemStatus, closed: boolean): boolean {
  if (route === "drop_ship") return closed;
  if (route === "ship_through") return status === "forwarded";
  return status === "entered"; // stage
}

export type ItemStatus =
  | "in_production"      // nothing shipped yet
  | "partially_shipped" // some shipped, more coming (NOT closed)
  | "shipped"           // closed (fully shipped or short-final), not yet received
  | "receiving"         // shipped + partially received
  | "received"          // closed + fully received, not yet sent downstream
  | "forwarded"         // ship_through: sent to client
  | "entered";          // stage: keyed into Shopify (end of road)

// ── per-size helpers ───────────────────────────────────────────────────
const sum = (q: SizeQtys | null | undefined): number =>
  Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

const sizesOf = (...maps: (SizeQtys | null | undefined)[]): string[] =>
  Array.from(new Set(maps.flatMap(m => Object.keys(m || {}))));

// net per-size sum of one movement type (reversals net out; drop ≤0)
function netType(movements: Movement[], type: MovementType): SizeQtys {
  const out: SizeQtys = {};
  for (const m of movements || []) {
    if (m.type !== type) continue;
    for (const [s, n] of Object.entries(m.qtys || {})) out[s] = (out[s] || 0) + (Number(n) || 0);
  }
  for (const k of Object.keys(out)) if (out[k] <= 0) delete out[k];
  return out;
}

// a − b, clamped ≥0, zeros dropped
function subClamp(a: SizeQtys, b: SizeQtys): SizeQtys {
  const out: SizeQtys = {};
  for (const s of sizesOf(a, b)) { const v = (Number(a[s]) || 0) - (Number(b[s]) || 0); if (v > 0) out[s] = v; }
  return out;
}
// a − b, signed, zeros dropped
function signed(a: SizeQtys, b: SizeQtys): SizeQtys {
  const out: SizeQtys = {};
  for (const s of sizesOf(a, b)) { const v = (Number(a[s]) || 0) - (Number(b[s]) || 0); if (v !== 0) out[s] = v; }
  return out;
}
const clean = (q: SizeQtys | null | undefined): SizeQtys => {
  const out: SizeQtys = {};
  for (const [s, n] of Object.entries(q || {})) { const v = Number(n) || 0; if (v !== 0) out[s] = v; }
  return out;
};

// ── the derivation ─────────────────────────────────────────────────────
export function deriveItem(input: ItemInput): ItemState {
  const ordered = clean(input.ordered);
  const M = input.movements || [];

  const shipped = netType(M, "ship");
  const received = netType(M, "receive");
  const forwarded = netType(M, "forward");
  const entered = netType(M, "stage");   // "stage" movement = entered into Shopify
  const pulled = netType(M, "pull");   // production + receiving pulls STACK (all sum here)

  const orderedTotal = sum(ordered), shippedTotal = sum(shipped);

  // shortage-if-closed vs owed-if-open both start from what's un-shipped per size.
  const unshipped = subClamp(ordered, shipped);         // ordered − shipped (≥0)
  const overShipped = subClamp(shipped, ordered);       // shipped − ordered (accepted positive variance)
  const fullyShipped = shippedTotal > 0 && Object.keys(unshipped).length === 0;
  const closed = !!input.shipFinal || fullyShipped;     // THE "nothing more coming" signal

  const owed = closed ? {} : unshipped;                 // still coming — only while open
  const shortage = closed ? unshipped : {};             // a real short — only once closed

  const receiveVariance = signed(received, shipped);
  const overReceived: SizeQtys = {}, underReceived: SizeQtys = {};
  for (const [s, v] of Object.entries(receiveVariance)) { if (v > 0) overReceived[s] = v; else underReceived[s] = -v; }
  // H6: a short on one size AND an over on another (once closed) — vendor got the
  // split wrong; production must resolve it with the vendor.
  const sizeMismatchFlag = closed && Object.keys(overReceived).length > 0 && Object.keys(underReceived).length > 0;

  const fullyReceived = shippedTotal > 0 && sum(received) >= shippedTotal;

  // downstream availability = received − pulled − already-sent
  const afterPull = subClamp(received, pulled);
  const availableToForward = subClamp(afterPull, forwarded);
  const availableToEnter = subClamp(afterPull, entered);
  const onHand = subClamp(subClamp(afterPull, forwarded), entered);

  // The forward-once gate (fixes the hang): once CLOSED and everything that
  // shipped is received, the item is ready to go downstream — a short-final item
  // proceeds with what arrived instead of waiting on units that aren't coming.
  const readyDownstream = closed && fullyReceived;

  const forwardedTotal = sum(forwarded), enteredTotal = sum(entered);
  let status: ItemStatus;
  if (input.route === "stage" && enteredTotal > 0 && sum(onHand) === 0 && closed) status = "entered";
  else if (input.route === "ship_through" && forwardedTotal > 0 && sum(availableToForward) === 0 && closed) status = "forwarded";
  else if (readyDownstream) status = "received";
  else if (sum(received) > 0) status = "receiving";
  else if (closed) status = "shipped";
  else if (shippedTotal > 0) status = "partially_shipped";
  else status = "in_production";

  return {
    done: routeDone(input.route, status, closed),
    route: input.route,
    ordered, orderedTotal,
    shipped, shippedTotal,
    received, receivedTotal: sum(received),
    forwarded, forwardedTotal,
    entered, enteredTotal,
    pulled, pulledTotal: sum(pulled),
    fullyShipped, closed,
    owed, owedTotal: sum(owed),
    shortage, shortageTotal: sum(shortage),
    overShipped,
    receiveVariance, overReceived, underReceived, sizeMismatchFlag, fullyReceived,
    availableToForward, availableToForwardTotal: sum(availableToForward),
    availableToEnter, availableToEnterTotal: sum(availableToEnter),
    onHand, onHandTotal: sum(onHand),
    readyDownstream, status,
  };
}
