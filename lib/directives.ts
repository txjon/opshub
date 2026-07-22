// THE DIRECTIVE VOCABULARY — one voice for directing staff, shared by the
// internal surfaces (The House, boards) and internal mail. Same grammar the
// client hub uses on clients, pointed at the production flow:
//   verb     — the headline order (what kind of move this is)
//   order    — the one-line instruction (do this)
//   done     — the finish line (done when), doubling as the definition of
//              complete so nobody debates it later.
export type Directive = { verb: string; order: string; done: string };

export const JOB_DIRECTIVES: Record<string, Directive> = {
  intake: {
    verb: "Cost & quote it",
    order: "Open Costing, price it, send the quote",
    done: "quote sent — approval opens in their hub",
  },
  pending: {
    verb: "With the client",
    order: "They're reviewing — nudge if it sits more than a couple days",
    done: "they approve or ask for changes",
  },
  ready: {
    verb: "Order blanks · send POs",
    order: "Blanks tab gates are green — order, then fire the POs",
    done: "blanks ordered + POs out",
  },
  production: {
    verb: "At the presses",
    order: "Nothing to do — watch for vendor word",
    done: "tracking entered",
  },
  shipping: {
    verb: "Shipping",
    order: "In transit — receiving preps from Landing",
    done: "boxes at the dock",
  },
  receiving: {
    verb: "Landing — receive it",
    order: "Confirm quantities per size as boxes land",
    done: "all items received (variances flagged)",
  },
  fulfillment: {
    verb: "Key it into Shopify",
    order: "Items landed — enter the counts on the staging board; Shopify + ShipStation own them from there",
    done: "every item entered — the job completes itself",
  },
};

export const DROP_DIRECTIVES = {
  ready_launch: {
    verb: "Launch prep",
    order: "Build the listings, watch the landings",
    done: "products live + Mark launched",
  },
  ready_cost: {
    verb: "Cost & schedule",
    order: "Price each line, quote it back",
    done: "quoted — sale opens next",
  },
  window_ended: {
    verb: "Close the sale",
    order: "The window passed — close it so numbers can come in",
    done: "closed — client enters production numbers",
  },
  closed: {
    verb: "Numbers → cut",
    order: "Numbers in? ✂ Cut births the job. Waiting? Nudge the client",
    done: "cut — the job is in the pipeline",
  },
} as const;

export const DISTRO_DIRECTIVES: Record<string, Directive> = {
  receive: {
    verb: "Receive it",
    order: "Confirm quantities per size as the boxes land — variances flag themselves",
    done: "every line received",
  },
  pull: {
    verb: "Pull it",
    order: "Goods on hand? Pull the sizes now. Inbound? It's queued against the landing",
    done: "pulled quantities logged — the client sees it fulfilled",
  },
  variance: {
    verb: "Count is off",
    order: "Received doesn't match shipped — recount, then flag the vendor thread",
    done: "variance confirmed + vendor notified",
  },
  ship_through: {
    verb: "Send it on",
    order: "It landed for a ship-through — enter outbound tracking and mark shipped",
    done: "tracking entered — the job completes itself",
  },
  fulfill: {
    verb: "Key it in",
    order: "Goods are on the shelf — enter the counts into Shopify; Shopify + ShipStation own the web orders and labels from there",
    done: "every item entered — the job completes itself",
  },
};

export const HOUSE_EXTRA_DIRECTIVES: Record<string, Directive> = {
  vendor_late: {
    verb: "Vendor is late",
    order: "Their ship-by passed and nothing's moving — call, get a real date, log it on the PO chip",
    done: "tracking entered or a new ship-by logged",
  },
  vendor_confirm: {
    verb: "Confirm it ships",
    order: "Ship-by is days out — ping the vendor for confirmation before it slips",
    done: "vendor confirms (or tracking enters)",
  },
  overdue_payment: {
    verb: "Collect it",
    order: "Invoice is past due — resend the pay link or make the call",
    done: "payment recorded",
  },
  closing_soon: {
    verb: "Window closing",
    order: "The sale window ends soon — prep to close and collect numbers",
    done: "window closed on time",
  },
  landing_late: {
    verb: "Where is it",
    order: "Expected date passed and it hasn't landed — chase the tracking, get a real ETA from the vendor",
    done: "boxes at the dock or a new arrival date on the shipment",
  },
};

export const STUDIO_DIRECTIVE: Directive = {
  verb: "Answer it",
  order: "Read the idea, reply in the thread — even a 'sketching soon'",
  done: "answered or with a designer",
};
