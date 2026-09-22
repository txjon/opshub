// Contractor hours math — the one copy shared by /hours, the submit email,
// week-status and the QB push. Hours are COMPUTED from punches, never stored.

export type Punch = { id?: string; work_date?: string; time_in: string | null; time_out: string | null; break_minutes: number | null };

export const toMin = (t: string | null) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// (out − in) − break. Open shifts (no out) count 0; tolerates an overnight shift.
export function entryHours(e: Punch): number {
  const a = toMin(e.time_in), b = toMin(e.time_out);
  if (a == null || b == null) return 0;
  let mins = b - a; if (mins < 0) mins += 24 * 60;
  mins -= Number(e.break_minutes || 0);
  return Math.max(0, mins) / 60;
}

export const fmtHours = (h: number) => (Math.round(h * 100) / 100).toString();

export function fmtTime(t: string | null) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "a" : "p"; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ap}`;
}

// Canonical fingerprint of a week's punches. Stored on hours_submissions at
// submit; the page recomputes it to flag any add/edit/delete since.
export function weekSnapshot(entries: Punch[]): string {
  return entries
    .map(e => `${e.id}|${e.work_date}|${e.time_in ?? ""}|${e.time_out ?? ""}|${e.break_minutes ?? 0}`)
    .sort()
    .join(";");
}
