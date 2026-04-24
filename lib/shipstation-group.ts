// Auto-group ShipStation line items by product, collapsing size variants
// into a single row. Used by the report's unit-cost entry UI and the PDF.
//
// A "group" is a set of rows with the same SKU root + description root,
// differing only in trailing size token. Rows without a recognized size
// token stand alone (single-variant "groups").

// Canonical size tokens we'll recognize at the tail of a SKU or the last
// " - X" segment of a description. Covers apparel + one-size items.
// Adding new tokens here is the easiest way to pick up new size patterns.
const SIZE_TOKENS = new Set([
  // Apparel
  "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL",
  "XXL", "XXXL", "XXXXL",
  // Abbreviated
  "SM", "MD", "LG", "XLG",
  // One-size / youth
  "OS", "OSFA", "ONE", "YS", "YM", "YL", "YXL",
]);

export type RawLine = {
  sku: string;
  description: string;
  qty_sold: number;
  product_sales: number;
  unit_cost: number;
  /** Stable per-row identifier so callers can map back to the source
   *  row even when SKU is blank or duplicated. Optional — grouping
   *  works without it. */
  idx?: number;
};

export type Variant = {
  sku: string;
  size: string | null; // null if this SKU had no detected size token
  qty_sold: number;
  product_sales: number;
  unit_cost: number;
  idx?: number;
};

export type Group = {
  // Stable key built from the roots. Use for React keys and UI state.
  key: string;
  root_sku: string;
  root_description: string;
  qty_sold: number;       // sum across variants
  product_sales: number;  // sum across variants
  // Representative unit cost. When variants share the same cost (Jon's
  // default workflow), this is that value. When they differ, we still
  // keep the primary "first non-zero" and the UI can surface the mix.
  unit_cost: number;
  unit_costs_differ: boolean;
  variants: Variant[];
};

export function stripSizeFromSku(sku: string): { root: string; size: string | null } {
  if (!sku) return { root: "", size: null };
  const idx = sku.lastIndexOf("-");
  if (idx < 0) return { root: sku, size: null };
  const last = sku.slice(idx + 1).toUpperCase();
  if (SIZE_TOKENS.has(last)) return { root: sku.slice(0, idx), size: last };
  return { root: sku, size: null };
}

export function stripSizeFromDescription(desc: string): { root: string; size: string | null } {
  if (!desc) return { root: "", size: null };
  // Trailing " - X" where X is one or two tokens. We only split on the LAST " - ".
  const lastSep = desc.lastIndexOf(" - ");
  if (lastSep < 0) return { root: desc.trim(), size: null };
  const tail = desc.slice(lastSep + 3).trim().toUpperCase();
  if (SIZE_TOKENS.has(tail)) return { root: desc.slice(0, lastSep).trim(), size: tail };
  return { root: desc.trim(), size: null };
}

// Groups rows where BOTH SKU and description roots match AND both had a
// size token detected. Rows without a detected size stand alone as
// single-variant groups so the rendering code can treat everything
// uniformly.
export function groupLineItems(items: RawLine[]): Group[] {
  const groups = new Map<string, Group>();
  let standaloneCounter = 0;

  for (const item of items) {
    const { root: skuRoot, size: skuSize } = stripSizeFromSku(item.sku);
    const { root: descRoot, size: descSize } = stripSizeFromDescription(item.description);

    // Only merge when BOTH signals agree on the size token. A color code
    // in the description that happens to equal a size token (very rare)
    // won't accidentally collapse unrelated items.
    const canGroup = !!skuSize && !!descSize && skuSize === descSize;
    const key = canGroup ? `group:${skuRoot}|${descRoot}` : `solo:${item.sku || "nosku"}:${standaloneCounter++}`;
    const rootSku = canGroup ? skuRoot : item.sku;
    const rootDesc = canGroup ? descRoot : item.description;

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        root_sku: rootSku,
        root_description: rootDesc,
        qty_sold: 0,
        product_sales: 0,
        unit_cost: 0,
        unit_costs_differ: false,
        variants: [],
      };
      groups.set(key, g);
    }

    const variant: Variant = {
      sku: item.sku,
      size: canGroup ? skuSize : null,
      qty_sold: item.qty_sold,
      product_sales: item.product_sales,
      unit_cost: item.unit_cost,
      idx: item.idx,
    };
    g.variants.push(variant);
    g.qty_sold += item.qty_sold;
    g.product_sales += item.product_sales;

    if (item.unit_cost > 0) {
      if (g.unit_cost === 0) g.unit_cost = item.unit_cost;
      else if (Math.abs(g.unit_cost - item.unit_cost) > 0.001) g.unit_costs_differ = true;
    }
  }

  // Sort variants within a group by size for stable display.
  const sizeOrder = ["XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","XXL","XXXL","XXXXL","SM","MD","LG","XLG","OS","OSFA","ONE","YS","YM","YL","YXL"];
  for (const g of groups.values()) {
    g.variants.sort((a, b) => {
      const ai = a.size ? sizeOrder.indexOf(a.size) : -1;
      const bi = b.size ? sizeOrder.indexOf(b.size) : -1;
      if (ai === bi) return (a.sku || "").localeCompare(b.sku || "");
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  return Array.from(groups.values());
}
