// "Looks like an existing client" — the duplicate guard for client creation
// (Aug 27 2026: Illicit Provisions existed twice, created from the new-job
// picker on Jul 7 instead of picked). A WARNING, not a block: a DBA and its
// parent, or two shops with similar names, are legitimate. Client-safe.

const NOISE = /\b(the|inc|llc|ltd|co|corp|corporation|company|group|studio|studios|apparel|clothing|brand|brands)\b/g;
export function normalizeClientName(s: string): string {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]+/g, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export type ClientLike = { id: string; name: string };
// Existing clients that look like `name`: exact after normalizing, one
// contains the other (≥4 chars), or within a small edit distance.
export function similarClients<T extends ClientLike>(name: string, clients: T[], excludeId?: string | null): T[] {
  const q = normalizeClientName(name);
  if (q.length < 3) return [];
  const out: T[] = [];
  for (const c of clients) {
    if (excludeId && c.id === excludeId) continue;
    const n = normalizeClientName(c.name);
    if (!n) continue;
    const hit = n === q
      || (q.length >= 4 && n.includes(q)) || (n.length >= 4 && q.includes(n))
      || editDistance(n, q) <= Math.max(1, Math.floor(Math.min(n.length, q.length) / 5));
    if (hit) out.push(c);
  }
  return out;
}
