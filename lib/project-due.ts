// Project due-date + close-date logic shared by the /projects strips and the
// client-profile action feed (single source — was inlined in projects/page.tsx).

// An item has finished its lifecycle when its ROUTE says so (item route
// overrides job route — mig 076): drop_ship = shipped from vendor,
// ship_through = forwarded to client, stage = entered in the webstore.
export function itemLifecycleDone(it: any, jobRoute: string): boolean {
  const route = it.shipping_route || jobRoute || "ship_through";
  if (route === "drop_ship") return it.pipeline_stage === "shipped";
  if (route === "stage") return !!it.webstore_entered_at;
  return !!it.forwarded_at;
}

// Final fallback for the countdown: the earliest agreed/live vendor ship-by
// from the PO tab's vendor chips (type_meta.po_ship_live / po_ship_dates) —
// most jobs carry their dates THERE, not on target_ship_date.
export function vendorShipFallback(job: any, liveVendors: Set<string> | null): string | null {
  const tm = job.type_meta || {};
  const dates: string[] = [];
  for (const src of [tm.po_ship_live, tm.po_ship_dates]) {
    for (const [vendor, v] of Object.entries(src || {})) {
      // NEXT item due (Jon, Jul 28): a vendor whose items are ALL finished
      // must stop contributing dates — stale May ship-bys were pinning
      // months-old jobs to the top of the board "for no reason". When we
      // can't resolve vendors (no assignments loaded), count everything.
      if (liveVendors && !liveVendors.has(vendor)) continue;
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) dates.push(v.slice(0, 10));
    }
  }
  return dates.length ? dates.sort()[0] : null;
}

// The board countdown target: the EARLIEST expected date among items still in
// flight. Internal proxy = the per-item production/receiving date (ship_est ▸
// legacy expected_arrival); the chain-resolved CLIENT ETA lives on the customer
// surfaces. client_eta is retired.
export function firstItemDue(job: any): string | null {
  const liveItems = ((job.items || []) as any[]).filter(it => !itemLifecycleDone(it, job.shipping_route));
  const dates = liveItems.map(it => it.ship_est || it.expected_arrival || null).filter(Boolean) as string[];
  if (dates.length) return dates.sort()[0];
  const liveVendors = new Set<string>();
  let anyResolved = false;
  for (const it of liveItems) {
    const dec = (it.decorator_assignments || [])[0]?.decorators;
    if (dec) { anyResolved = true; if (dec.name) liveVendors.add(dec.name); if (dec.short_code) liveVendors.add(dec.short_code); }
  }
  return vendorShipFallback(job, anyResolved ? liveVendors : null);
}

// When a completed job actually closed: the lifecycle stamp, else last touch.
export function closedAt(job: any): string | null {
  return (job.phase_timestamps as any)?.complete || job.updated_at || null;
}
