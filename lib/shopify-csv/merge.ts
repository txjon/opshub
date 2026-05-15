import { ParsedProduct } from "./parse";
import { InventoryRow, normalizeSku, partitionLocations } from "./parse-inventory";

export interface MergedVariant {
  sku: string;
  title: string;
  status: string;
  price: number;
  variantLabel: string;
  /** location name -> qty. Only non-null, non-zero entries. */
  perLocation: Record<string, number>;
  /** Sum of qty across included locations (nulls excluded; 0s and negatives included). */
  totalOnHand: number;
}

export interface MergeResult {
  variants: MergedVariant[];
  allLocations: string[];
  podLocations: string[];
  physicalLocations: string[];
  /** Unique inventory SKUs that had no matching product row. */
  unmatched: number;
}

export function mergeProductsAndInventory(
  products: ParsedProduct[],
  inventory: InventoryRow[] | null,
  options: { includedLocations: string[] }
): MergeResult {
  // Single-file fallback — treat each product variant's qty as one virtual location.
  if (!inventory) {
    const variants: MergedVariant[] = [];
    for (const p of products) {
      for (const v of p.variants) {
        const qty = v.qty;
        const perLocation: Record<string, number> = {};
        if (qty !== 0) perLocation["Default"] = qty;
        variants.push({
          sku: normalizeSku(v.sku),
          title: p.title,
          status: p.status,
          price: v.price,
          variantLabel: v.variantLabel,
          perLocation,
          totalOnHand: qty,
        });
      }
    }
    return {
      variants,
      allLocations: ["Default"],
      podLocations: [],
      physicalLocations: ["Default"],
      unmatched: 0,
    };
  }

  // Build SKU -> inventory rows map (preserving first-seen order of locations)
  const invBySku = new Map<string, InventoryRow[]>();
  const locationsSeen: string[] = [];
  const locationsSet = new Set<string>();
  for (const row of inventory) {
    if (!locationsSet.has(row.location)) {
      locationsSet.add(row.location);
      locationsSeen.push(row.location);
    }
    let list = invBySku.get(row.sku);
    if (!list) {
      list = [];
      invBySku.set(row.sku, list);
    }
    list.push(row);
  }

  const { allLocations, podLocations, physicalLocations } = partitionLocations(locationsSeen);

  // Default: all physical locations when caller didn't restrict
  const included = options.includedLocations.length
    ? options.includedLocations.filter((l) => locationsSet.has(l))
    : physicalLocations.slice();
  const includedSet = new Set(included);

  const matchedSkus = new Set<string>();
  const variants: MergedVariant[] = [];

  for (const p of products) {
    for (const v of p.variants) {
      const sku = normalizeSku(v.sku);
      if (!sku) continue;
      const invRows = invBySku.get(sku) || [];
      matchedSkus.add(sku);
      const perLocation: Record<string, number> = {};
      let total = 0;
      for (const ir of invRows) {
        if (!includedSet.has(ir.location)) continue;
        if (ir.onHand === null) continue;
        total += ir.onHand;
        if (ir.onHand !== 0) perLocation[ir.location] = ir.onHand;
      }
      variants.push({
        sku,
        title: p.title,
        status: p.status,
        price: v.price,
        variantLabel: v.variantLabel,
        perLocation,
        totalOnHand: total,
      });
    }
  }

  // Count inventory SKUs that never matched a product (unique)
  const invSkuSet = new Set<string>();
  for (const r of inventory) invSkuSet.add(r.sku);
  let unmatched = 0;
  invSkuSet.forEach((s) => {
    if (!matchedSkus.has(s)) unmatched++;
  });

  return { variants, allLocations, podLocations, physicalLocations, unmatched };
}
