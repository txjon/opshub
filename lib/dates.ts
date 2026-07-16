// THE date library — parsing, formatting, counting, business days.
// All date-only values are ISO strings (YYYY-MM-DD).
//
// THE RULE: never call `new Date("YYYY-MM-DD")` directly. JS parses a bare
// date-only string as UTC midnight, which is 5 PM the PREVIOUS day in Las
// Vegas — every surface that did this showed the day before. Use parseDay
// (date-only) or new Date(iso) ONLY for full timestamps.
//
// Counting policy (locked 2026-07-15): countdowns to a date = pure CALENDAR
// day difference (daysUntilDay — no clock math, no rounding choice). Elapsed
// "time in stage" = floor of elapsed ms (unchanged, lib/item-state.ts).

/** Parse a date-only string as a LOCAL date (split-parse — no UTC shift).
 *  Accepts a leading YYYY-MM-DD in longer strings (timestamps → their local day
 *  is NOT what you want here; pass timestamps to new Date() instead). */
export function parseDay(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Today as a local YYYY-MM-DD (never UTC — an evening in Vegas is still today). */
export function todayStr(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** "Jul 15" from a date-only string. */
export function fmtDay(iso: string | null | undefined): string {
  const d = iso ? parseDay(iso) : null;
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}

/** "Jul 15, 2026" from a date-only string. */
export function fmtDayYear(iso: string | null | undefined): string {
  const d = iso ? parseDay(iso) : null;
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

/** "Jul 15 · 2:04 PM" from a FULL timestamp (renders in the viewer's zone). */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** Calendar days from today to a date-only string. 0 = today, negative = past.
 *  Pure calendar diff — timezone can't enter the equation. */
export function daysUntilDay(iso: string | null | undefined): number | null {
  const target = iso ? parseDay(iso) : null;
  if (!target) return null;
  const today = parseDay(todayStr())!;
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Subtract N business days from a date */
export function subtractBusinessDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00"); // noon to avoid timezone issues
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    if (!isWeekend(d)) remaining--;
  }
  return d.toISOString().split("T")[0];
}

/** Count business days between two dates (positive = future, negative = past) */
export function businessDaysBetween(fromStr: string, toStr: string): number {
  const from = new Date(fromStr + "T12:00:00");
  const to = new Date(toStr + "T12:00:00");
  const forward = to >= from;
  let start = forward ? from : to;
  let end = forward ? to : from;
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    if (!isWeekend(cursor)) count++;
  }
  return forward ? count : -count;
}

/** Calculate all milestone dates from in-hands date */
export function calculateMilestones(inHandsDate: string) {
  const shipFromWarehouse = subtractBusinessDays(inHandsDate, 3);
  const arriveAtWarehouse = subtractBusinessDays(shipFromWarehouse, 1);
  const decoratorShips = subtractBusinessDays(arriveAtWarehouse, 1);
  const decoratorOrderDeadline = subtractBusinessDays(decoratorShips, 11);

  return {
    inHandsDate,
    shipFromWarehouse,
    arriveAtWarehouse,
    decoratorShips,
    decoratorOrderDeadline,
  };
}

/** Auto-calculate priority based on business days from today to ship date */
export function calculatePriority(shipDate: string): "normal" | "rush" | "hot" {
  const today = todayStr();
  const bizDays = businessDaysBetween(today, shipDate);

  if (bizDays < 5) return "hot";
  if (bizDays < 10) return "rush";
  return "normal";
}

/** Add N business days to a date */
export function addBusinessDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) remaining--;
  }
  return d.toISOString().split("T")[0];
}

/** Business days from today to a target date */
export function businessDaysFromNow(targetDate: string): number {
  const today = todayStr();
  return businessDaysBetween(today, targetDate);
}
