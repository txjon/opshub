// Shared ETA resolution + formatting. One function so internal pages,
// the client portal, and any API payload all derive the same ETA from
// the same precedence rules:
//
//   1. items.client_eta (manual override set by Drake on the Production
//      tab or the cross-project /production modal) — wins when set.
//   2. jobs.target_ship_date — fallback hint when no per-item override.
//   3. null — nothing to show.

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
  if (input.client_eta) return { date: input.client_eta, source: "manual" };
  if (input.job_target_ship_date) return { date: input.job_target_ship_date, source: "job_ship" };
  return null;
}

// Days until an ISO date string. Negative = past. Null = no date.
// Date-only inputs (YYYY-MM-DD) are interpreted at local midnight so
// the math matches what a human would say when looking at a calendar.
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / 86400000);
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
