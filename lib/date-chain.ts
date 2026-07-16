// The date chain — one pure derivation for every date surface (locked with
// Jon 2026-07-15, flow artifact "Date flow v2").
//
//   PO sent ──lead──▶ vendor ships (ship-by) ──transit──▶ arrives at HPD
//            ──route buffer──▶ client has it (ETA)
//
// THE RULES (R1–R5):
//   R1 One gate: a PO needs a ship-by date or a deliberate ASAP. Nothing
//      else blocks.
//   R2 Derive downstream: arrival = ship-by + transit(vendor, method);
//      client ETA = arrival + buffer(route).
//   R3 Edit where you work: ship-by slips in-line on production2 (stored in
//      type_meta.po_ship_live[vendor], the AGREED po_ship_dates is never
//      rewritten); arrival edits in-line in receiving2 (shipments.
//      expected_arrival). An edit re-derives everything AFTER it; nothing
//      BEFORE it moves.
//   R4 ASAP = chain pending: downstream is TBD (null) until a real date
//      lands, then derives forward from it.
//   R5 Never guess: a surface shows a chain date or TBD — never a fabricated
//      one. In-hands (jobs.target_ship_date) is an optional internal note:
//      PO-tab banner + quote-PDF est-ship (only when set) — it feeds flags
//      here, never dates.
//
// Lead + transit are CALENDAR days (vendors quote "6 weeks" / "35 on the
// water"), seeded per vendor in decorators.lead_time_days +
// decorators.transit_defaults {ground, freight, ocean} (migration 123).

import { addDays, daysUntilDay } from "./dates";

export type TransitMethod = "ground" | "freight" | "ocean";
export type ChainRoute = "drop_ship" | "ship_through" | "stage";

// D2 (confirmed): HPD processing buffer per route — arrival → client-has-it.
// drop_ship never touches HPD so it has no buffer leg.
export const ROUTE_BUFFER_DAYS: Record<ChainRoute, number> = {
  ship_through: 1,
  stage: 3,
  drop_ship: 0,
};

export const ASAP = "ASAP";

// PO-tab SHIP_METHODS → which transit default applies.
// "Pick Up" is HPD collecting locally = 0 transit days, regardless of vendor.
// "Vendor's Choice" falls back to ground (the common case).
export function transitMethodFor(shipMethod: string | null | undefined): TransitMethod | "pickup" {
  const m = (shipMethod || "").toLowerCase();
  if (m.includes("pick")) return "pickup";
  if (m.includes("ocean")) return "ocean";
  if (m.includes("freight") || m.includes("ltl")) return "freight";
  return "ground";
}

export function transitDaysFor(
  transitDefaults: Partial<Record<TransitMethod, number>> | null | undefined,
  shipMethod: string | null | undefined,
): number | null {
  const method = transitMethodFor(shipMethod);
  if (method === "pickup") return 0;
  const v = transitDefaults?.[method];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type ChainInput = {
  route: ChainRoute;
  // vendor defaults (decorators row)
  lead?: number | null;
  transitDefaults?: Partial<Record<TransitMethod, number>> | null;
  shipMethod?: string | null;          // type_meta.po_ship_methods[vendor]
  // the chain's stored values
  poSentDate?: string | null;          // type_meta.po_sent_dates[vendor] (ISO ts or date-only)
  shipByAgreed?: string | null;        // type_meta.po_ship_dates[vendor] — date or "ASAP"
  shipByLive?: string | null;          // type_meta.po_ship_live[vendor]?.date — mid-flight slips
  arrivalOverride?: string | null;     // shipments.expected_arrival (box) ?? items.expected_arrival
  clientEtaOverride?: string | null;   // items.client_eta — always wins for the client
  inHands?: string | null;             // jobs.target_ship_date — flags only
};

export type ChainResult = {
  // pre-send suggestion for the PO tab: PO date (or today) + vendor lead
  suggestedShipBy: string | null;
  asap: boolean;
  shipByAgreed: string | null;         // what the PO says — render on PO tab/PDF/vendor hub
  shipBy: string | null;               // the LIVE date the chain runs on (null while ASAP-pending)
  slippedDays: number;                 // live vs agreed (0 = on plan)
  arrival: string | null;              // null = TBD
  arrivalSource: "override" | "derived" | null;
  clientEta: string | null;            // null = TBD (surfaces render "TBD", never a guess)
  etaSource: "override" | "derived" | null;
  flags: string[];                     // human-readable warnings, render as-is
};

const isDay = (s: string | null | undefined): s is string => !!s && s !== ASAP;

export function deriveDateChain(input: ChainInput): ChainResult {
  const flags: string[] = [];

  // ship-by: live wins over agreed; ASAP means "no date yet"
  const agreed = input.shipByAgreed || null;
  const asap = agreed === ASAP && !isDay(input.shipByLive);
  const shipBy = isDay(input.shipByLive) ? input.shipByLive : isDay(agreed) ? agreed : null;

  const slippedDays = isDay(input.shipByLive) && isDay(agreed)
    ? Math.round((new Date(input.shipByLive + "T12:00:00").getTime() - new Date(agreed + "T12:00:00").getTime()) / 86400000)
    : 0;
  if (slippedDays > 0) flags.push(`ship-by slipped ${slippedDays}d vs the PO plan`);

  // suggestion (pre-send): PO sent date (or today) + lead
  const poDay = input.poSentDate ? input.poSentDate.slice(0, 10) : null;
  const lead = typeof input.lead === "number" && Number.isFinite(input.lead) ? input.lead : null;
  const suggestedShipBy = lead != null
    ? addDays(poDay || new Date().toISOString().slice(0, 10), lead)
    : null;

  // arrival: box/item override wins; else ship-by + transit
  const transit = transitDaysFor(input.transitDefaults, input.shipMethod);
  let arrival: string | null = null;
  let arrivalSource: ChainResult["arrivalSource"] = null;
  if (input.route !== "drop_ship") {
    if (isDay(input.arrivalOverride)) { arrival = input.arrivalOverride; arrivalSource = "override"; }
    else if (shipBy && transit != null) { arrival = addDays(shipBy, transit); arrivalSource = "derived"; }
  }

  // client ETA: manual override always wins; else arrival + buffer
  // (drop_ship: ship-by + transit straight to the client)
  let clientEta: string | null = null;
  let etaSource: ChainResult["etaSource"] = null;
  if (isDay(input.clientEtaOverride)) {
    clientEta = input.clientEtaOverride; etaSource = "override";
    if (arrival && clientEta < arrival) flags.push("client ETA is before the goods arrive at HPD");
  } else if (input.route === "drop_ship") {
    if (shipBy && transit != null) { clientEta = addDays(shipBy, transit); etaSource = "derived"; }
  } else if (arrival) {
    clientEta = addDays(arrival, ROUTE_BUFFER_DAYS[input.route]); etaSource = "derived";
  }

  // in-hands is a note, not a date source — it only fires this flag
  if (isDay(input.inHands) && clientEta && clientEta > input.inHands) {
    const miss = Math.round((new Date(clientEta + "T12:00:00").getTime() - new Date(input.inHands + "T12:00:00").getTime()) / 86400000);
    flags.push(`chain lands ${miss}d after the requested in-hands date`);
  }

  return { suggestedShipBy, asap, shipByAgreed: agreed, shipBy, slippedDays, arrival, arrivalSource, clientEta, etaSource, flags };
}

// R1 — the one gate: can this vendor's PO be sent?
export function poSendAllowed(shipByAgreed: string | null | undefined): boolean {
  return shipByAgreed === ASAP || isDay(shipByAgreed || null);
}

// Countdown convenience for chain dates (calendar-day policy).
export const chainDaysUntil = daysUntilDay;
