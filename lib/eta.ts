// Shared ETA formatting helpers (etaCountdown / daysUntil) + a deprecated
// resolver shim.
//
// DEPRECATED — resolveEta preferred items.client_eta, which is RETIRED
// (date model 2026-07-23). The client ETA now derives from the chain
// (lib/date-chain.ts → /api/item-etas): PO ship-by ▸ per-item ship_est ▸
// receiving land date, + transit + processing. Do not wire client_eta back
// through here; this shim resolves only target_ship_date as a last-ditch hint.

import { daysUntilDay } from "./dates";

export type EtaSource = "manual" | "job_ship";

export interface EtaInput {
  client_eta: string | null | undefined;
  job_target_ship_date: string | null | undefined;
}

export interface ResolvedEta {
  date: string;
  source: EtaSource;
}

export function resolveEta(input: EtaInput): ResolvedEta | null {
  // client_eta is retired — intentionally ignored. Only the job ship date remains.
  if (input.job_target_ship_date) return { date: input.job_target_ship_date, source: "job_ship" };
  return null;
}

// Days until an ISO date string. Negative = past. Null = no date.
// Pure calendar-day difference via lib/dates parseDay — the old version
// parsed date-only strings as UTC midnight and leaned on Math.ceil to mask
// the shift (Pacific-only luck). Now the timezone can't enter the math.
export function daysUntil(iso: string | null | undefined): number | null {
  return daysUntilDay(iso);
}

// Render the countdown text + a semantic color band for callers to map
// onto their own palette. Color is a band, not a hex, so internal (T
// palette) and portal (C palette) can each pick the matching token.
export type EtaColorBand = "red" | "amber" | "muted" | "green";

export function etaCountdown(iso: string | null | undefined): { text: string; band: EtaColorBand } | null {
  const d = daysUntil(iso);
  if (d === null) return null;
  if (d < 0) return { text: `${Math.abs(d)}d overdue`, band: "red" };
  if (d === 0) return { text: "today", band: "red" };
  if (d <= 3) return { text: `${d}d`, band: "amber" };
  if (d <= 14) return { text: `${d}d`, band: "muted" };
  return { text: `${d}d`, band: "green" };
}
