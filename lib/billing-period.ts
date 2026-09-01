// Billing-period label helpers — ONE source for the fulfillment wizard and
// the bulk import (extracted Sep 1 2026; previously inline in the wizard).
// Two label formats exist in the wild: "July 2026" and
// "7/1/2026 - 7/31/2026" (zero-padded or not). Anything else → null.

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const RANGE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
const MONTHLY_RE = /^([A-Za-z]+)\s+(\d{4})$/;

/** Given the last invoice's period label, suggest the next billing window in
 *  the SAME format. */
export function nextPeriodSuggestion(label: string | null | undefined): string | null {
  const t = (label || "").trim();
  const monthly = t.match(MONTHLY_RE);
  if (monthly) {
    const idx = MONTH_NAMES.findIndex(m => m.toLowerCase() === monthly[1].toLowerCase());
    if (idx < 0) return null;
    const y = Number(monthly[2]) + (idx === 11 ? 1 : 0);
    return `${MONTH_NAMES[(idx + 1) % 12]} ${y}`;
  }
  const range = t.match(RANGE_RE);
  if (range) {
    const padded = range[4].length === 2 && range[4][0] === "0";
    // Numeric Date construction (local) — never bare-parse a date string.
    const end = new Date(Number(range[6]), Number(range[4]) - 1, Number(range[5]));
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const p = (n: number) => (padded ? String(n).padStart(2, "0") : String(n));
    const f = (d: Date) => `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
    return `${f(start)} - ${f(last)}`;
  }
  return null;
}

/** Parse a period label into actual dates (for overlap / span checks). */
export function parsePeriodRange(label: string | null | undefined): { start: Date; end: Date } | null {
  const t = (label || "").trim();
  const monthly = t.match(MONTHLY_RE);
  if (monthly) {
    const idx = MONTH_NAMES.findIndex(m => m.toLowerCase() === monthly[1].toLowerCase());
    if (idx < 0) return null;
    const y = Number(monthly[2]);
    return { start: new Date(y, idx, 1), end: new Date(y, idx + 1, 0) };
  }
  const range = t.match(RANGE_RE);
  if (range) {
    return {
      start: new Date(Number(range[3]), Number(range[1]) - 1, Number(range[2])),
      end: new Date(Number(range[6]), Number(range[4]) - 1, Number(range[5])),
    };
  }
  return null;
}

/** Month-aligned zero-padded label covering [min, max]:
 *  Jul 13 → Aug 24 becomes "07/01/2026 - 08/31/2026". */
export function monthAlignedLabel(min: Date, max: Date): string {
  const start = new Date(min.getFullYear(), min.getMonth(), 1);
  const end = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  const f = (d: Date) => `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
  return `${f(start)} - ${f(end)}`;
}

/** Do two date ranges intersect (inclusive)? */
export function rangesOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start <= b.end && b.start <= a.end;
}
