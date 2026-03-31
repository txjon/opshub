// Business day date calculations
// All dates are ISO strings (YYYY-MM-DD)

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
  const today = new Date().toISOString().split("T")[0];
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
  const today = new Date().toISOString().split("T")[0];
  return businessDaysBetween(today, targetDate);
}
