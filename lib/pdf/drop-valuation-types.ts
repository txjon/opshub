export interface ValuationProductRow {
  title: string;
  variantCount: number;
  units: number;
  retailValue: number;
  pctOfDrop: number;
}

export interface OversoldRow {
  title: string;
  /** e.g. "S −117 · M −503" */
  variantsLabel: string;
  unitsOversold: number;   // positive number of units below zero
  retailCommitted: number; // positive: units × price
}

export interface DropValuationData {
  /** Main table: products with more than `lowStockMax` units. */
  products: ValuationProductRow[];
  /** Products with 1..lowStockMax units, summarized in a compact block. */
  lowStock: ValuationProductRow[];
  lowStockMax: number;
  /** Products with zero units across all variants — excluded from the report. */
  zeroStockCount: number;
  /** Variants below zero in Shopify (pre-orders sold past stock, oversells).
   *  Valued at zero on hand; listed here as the open obligation. */
  oversold: OversoldRow[];
  totalValue: number;
  totalUnits: number;
  totalProducts: number;
  totalVariants: number;
  avgRetailPerUnit: number;
  flags: string[];
  reportRef: string;
  reportDate: string;
  companyName: string;
  companyLogoSvg: string;
}
