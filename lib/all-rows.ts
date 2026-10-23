// Supabase caps un-ranged selects at 1,000 rows and silently truncates.
// That put ENTERED items back on /staging2 (Sep 8 2026): the board's
// movement set hit 1,222 rows, 222 got dropped in arbitrary order, and
// whenever an item's entered movements fell in the tail the ledger math
// saw it as un-entered. The Bills page lost its oldest bills and ~80 random
// items the same way (Oct 23 2026: 1,076 bills, 1,080 items). Every multi-row
// read that can pass 1,000 pages through this. Callers must include a stable
// .order() in the builder (end with a unique column, e.g. id).
export async function allRows<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    // A failed read must never look like "no rows": that's how /staging2 went
    // blank (Oct 6 2026) — every item read as never staged, never entered.
    if (error) throw new Error(`Read failed: ${error.message || error}`);
    out.push(...((data as T[]) || []));
    if (!data || (data as T[]).length < 1000) break;
  }
  return out;
}
