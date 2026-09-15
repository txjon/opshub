import type { ParsedProduct } from "@/lib/shopify-csv/parse";
import type { DropValuationData, ValuationProductRow } from "./drop-valuation-types";

export type ValuationNumbers = Pick<
  DropValuationData,
  "products" | "lowStock" | "lowStockMax" | "zeroStockCount" | "totalValue" | "totalUnits" | "totalProducts" | "totalVariants" | "avgRetailPerUnit" | "flags"
>;

// One aggregation for the single-location valuation report (Sep 14 2026):
//   zero-stock products  → dropped, counted in zeroStockCount
//   1..lowStockMax units → lowStock (compact block), still in every total
//   more than that       → products (the main table)
export function buildValuation(parsed: ParsedProduct[], lowStockMax: number): ValuationNumbers {
  const all: ValuationProductRow[] = parsed.map((p) => ({
    title: p.title,
    variantCount: p.variants.length,
    units: p.variants.reduce((s, v) => s + v.qty, 0),
    retailValue: p.variants.reduce((s, v) => s + v.qty * v.price, 0),
    pctOfDrop: 0,
  }));

  const zeroStockCount = all.filter((p) => p.units <= 0).length;
  const inStock = all.filter((p) => p.units > 0);

  const totalValue = inStock.reduce((s, p) => s + p.retailValue, 0);
  const totalUnits = inStock.reduce((s, p) => s + p.units, 0);
  const totalVariants = inStock.reduce((s, p) => s + p.variantCount, 0);
  const avgRetailPerUnit = totalUnits > 0 ? totalValue / totalUnits : 0;
  for (const p of inStock) p.pctOfDrop = totalValue > 0 ? (p.retailValue / totalValue) * 100 : 0;
  inStock.sort((a, b) => b.retailValue - a.retailValue);

  const flags = inStock
    .filter((p) => p.title.toLowerCase().includes("need updated count"))
    .map((p) => `"${p.title}" listed with title marker indicating count is pending`);

  return {
    products: inStock.filter((p) => p.units > lowStockMax),
    lowStock: inStock.filter((p) => p.units <= lowStockMax),
    lowStockMax,
    zeroStockCount,
    totalValue,
    totalUnits,
    totalProducts: inStock.length,
    totalVariants,
    avgRetailPerUnit,
    flags,
  };
}
