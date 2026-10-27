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
  // A row inserted mid-read shifts a page boundary and can come back twice;
  // drop repeats by id (rows without an id pass through untouched).
  const seen = new Set<unknown>();
  return out.filter((r: any) => r?.id == null || (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

// An .in() list rides in the URL. Past ~390 uuids the request fails outright
// (/staging2: 395 items, Oct 6 2026), so every id-list read goes in chunks,
// each chunk paged through allRows. Rows for one id never straddle chunks, so
// per-id ordering (e.g. newest mockup first) holds.
const IN_CHUNK = 150;
export async function allRowsIn<T = any>(
  ids: string[],
  build: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    out.push(...await allRows<T>((f, t) => build(chunk, f, t)));
  }
  return out;
}
