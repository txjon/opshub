// Billable-qty derivation (Financial V2 Phase 1e rider, Aug 24 2026 — the
// opshub-invoice-reconcile-pull-gap fix). ONE function for "what do we bill
// the client per size", used by the variance-review modal AND the QB invoice
// variance push so the review and the push can never disagree.
//
// The old rule billed warehouse arrivals: ship_through/stage preferred
// received_qtys — what landed at HPD — not what actually went OUT to the
// client. The movement ledger's `forward` movements are the client-delivered
// truth for warehouse routes; drop-ship items bill decorator-shipped as
// before. Chain, per item route:
//   ship_through/stage : forwarded (ledger) → received → shipped → ordered
//   drop_ship          : shipped → received → ordered
// Missing sizes fall through to ordered (matches packing-slip logic; an
// explicit 0 in a higher source is respected).

export type SizeMap = Record<string, number>;

export function sumForwarded(movements: { type: string; qtys: SizeMap | null }[]): SizeMap {
  const out: SizeMap = {};
  for (const m of movements || []) {
    if (m.type !== "forward") continue;
    for (const [sz, q] of Object.entries(m.qtys || {})) {
      const n = Number(q) || 0;
      if (n) out[sz] = (out[sz] || 0) + n;
    }
  }
  // negative reversals can net a size to ≤0 — drop those
  for (const sz of Object.keys(out)) if (out[sz] <= 0) delete out[sz];
  return out;
}

export function billableQtysForItem(opts: {
  item: { shipping_route?: string | null; received_qtys?: SizeMap | null; ship_qtys?: SizeMap | null; buy_sheet_lines?: { size: string; qty_ordered: number | null }[] | null };
  jobRoute?: string | null;
  forwardedMap?: SizeMap | null; // Σ ledger forward movements for this item
}): { perSize: SizeMap; source: "forwarded" | "received" | "shipped" | "ordered" } {
  const { item } = opts;
  const ordered: SizeMap = {};
  for (const l of item.buy_sheet_lines || []) ordered[l.size] = Number(l.qty_ordered) || 0;
  const received = (item.received_qtys || {}) as SizeMap;
  const shipped = (item.ship_qtys || {}) as SizeMap;
  const forwarded = (opts.forwardedMap || {}) as SizeMap;

  const itemRoute = item.shipping_route || opts.jobRoute;
  const warehouse = itemRoute === "ship_through" || itemRoute === "stage";
  const chain: { map: SizeMap; name: "forwarded" | "received" | "shipped" }[] = warehouse
    ? [{ map: forwarded, name: "forwarded" }, { map: received, name: "received" }, { map: shipped, name: "shipped" }]
    : [{ map: shipped, name: "shipped" }, { map: received, name: "received" }];

  const perSize: SizeMap = {};
  let topSource: "forwarded" | "received" | "shipped" | "ordered" = "ordered";
  for (const c of chain) {
    if (Object.keys(c.map).length > 0) { topSource = c.name; break; }
  }
  for (const sz of Object.keys(ordered)) {
    let v: number | undefined;
    for (const c of chain) {
      if (c.map[sz] !== undefined) { v = c.map[sz]; break; }
    }
    perSize[sz] = v !== undefined ? v : ordered[sz];
  }
  return { perSize, source: topSource };
}
