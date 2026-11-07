// THE lookup from an item to its costing entry (costing_data.costProds).
//
// By id first. By name only for a legacy entry whose id belongs to NO current
// item (old costProds were keyed by name). Two items can share a name: on
// HPD-2611-005 there were two "Duffle"s and two "Gun Bag I-90"s. A plain name
// fallback let them share ONE costing entry, so a decoration edit on one
// rewrote the other's, and the PO PDF left an item out (Nov 2026).
//
// No imports: the job page (client) and server routes both use it.

type CostProd = { id?: string | null; name?: string | null };
type ItemRef = { id: string; name?: string | null };

const key = (s: string | null | undefined) => (s || "").trim().toLowerCase();

export function findCostProdIndex(costProds: CostProd[], item: ItemRef, itemIds: Iterable<string>): number {
  const i = costProds.findIndex(c => c?.id === item.id);
  if (i >= 0) return i;
  const k = key(item.name);
  if (!k) return -1;
  const live = new Set(itemIds);
  return costProds.findIndex(c => !(c?.id && live.has(c.id)) && key(c?.name) === k);
}

export function findCostProd<T extends CostProd>(costProds: T[], item: ItemRef, itemIds: Iterable<string>): T | undefined {
  const i = findCostProdIndex(costProds, item, itemIds);
  return i >= 0 ? costProds[i] : undefined;
}
