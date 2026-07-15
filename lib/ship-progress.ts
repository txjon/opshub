// Wave/partial shipping — the single source for "ordered vs shipped vs
// remaining vs received" per item. Every surface (production board, ship modal,
// shipping, receiving) reads THIS so the numbers always agree.
//
// Model: an item is ordered in a fixed quantity (buy_sheet_lines), then shipped
// from the vendor in one or more WAVES. `shipped` accumulates across waves;
// `remaining` is what the vendor still owes; `received` accumulates as boxes
// land at HPD. Fully shipped = shipped >= ordered.

export type SizeQtys = Record<string, number>;

export type ShipProgress = {
  perSize: { size: string; ordered: number; shipped: number; remaining: number; received: number }[];
  ordered: number;
  shipped: number;
  remaining: number;      // ordered − shipped, clamped ≥ 0
  received: number;
  toReceive: number;      // shipped − received, clamped ≥ 0 (landed-but-unreceived)
  fullyShipped: boolean;  // shipped ≥ ordered (and ordered > 0)
  partiallyShipped: boolean; // 0 < shipped < ordered
  fullyReceived: boolean; // received ≥ shipped (and shipped > 0)
};

const sumQ = (q: SizeQtys | null | undefined): number =>
  Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

export function shipProgress(
  ordered: SizeQtys | null | undefined,
  shipped: SizeQtys | null | undefined,
  received?: SizeQtys | null | undefined,
): ShipProgress {
  const sizes = Array.from(new Set([
    ...Object.keys(ordered || {}),
    ...Object.keys(shipped || {}),
    ...Object.keys(received || {}),
  ]));
  const perSize = sizes.map(sz => {
    const o = Number(ordered?.[sz]) || 0;
    const s = Number(shipped?.[sz]) || 0;
    const r = Number(received?.[sz]) || 0;
    return { size: sz, ordered: o, shipped: s, remaining: Math.max(0, o - s), received: r };
  });
  const orderedT = sumQ(ordered);
  const shippedT = sumQ(shipped);
  const receivedT = sumQ(received);
  return {
    perSize,
    ordered: orderedT,
    shipped: shippedT,
    received: receivedT,
    remaining: Math.max(0, orderedT - shippedT),
    toReceive: Math.max(0, shippedT - receivedT),
    fullyShipped: orderedT > 0 && shippedT >= orderedT,
    partiallyShipped: shippedT > 0 && shippedT < orderedT,
    fullyReceived: shippedT > 0 && receivedT >= shippedT,
  };
}

// Per-size remaining-to-ship map (ordered − already-shipped), for pre-filling a
// "ship this wave" form to the outstanding balance.
export function remainingToShip(ordered: SizeQtys | null | undefined, shipped: SizeQtys | null | undefined): SizeQtys {
  const out: SizeQtys = {};
  for (const sz of Object.keys(ordered || {})) {
    const rem = (Number(ordered?.[sz]) || 0) - (Number(shipped?.[sz]) || 0);
    if (rem > 0) out[sz] = rem;
  }
  return out;
}

// Merge a wave's per-size qtys into an existing cumulative map (accumulate).
export function addQtys(base: SizeQtys | null | undefined, add: SizeQtys | null | undefined): SizeQtys {
  const out: SizeQtys = { ...(base || {}) };
  for (const [sz, n] of Object.entries(add || {})) {
    const v = Number(n) || 0;
    if (v !== 0) out[sz] = (Number(out[sz]) || 0) + v;
  }
  return out;
}

// Back a wave's qtys OUT of a cumulative map (for per-wave undo). Clamps at 0
// and drops sizes that reach 0.
export function subtractQtys(base: SizeQtys | null | undefined, sub: SizeQtys | null | undefined): SizeQtys {
  const out: SizeQtys = { ...(base || {}) };
  for (const [sz, n] of Object.entries(sub || {})) {
    const v = Number(n) || 0;
    if (v === 0) continue;
    const next = (Number(out[sz]) || 0) - v;
    if (next > 0) out[sz] = next; else delete out[sz];
  }
  return out;
}
