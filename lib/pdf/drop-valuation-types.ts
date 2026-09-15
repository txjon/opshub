export interface ValuationProductRow {
  title: string;
  variantCount: number;
  units: number;
  retailValue: number;
  pctOfDrop: number;
}

export interface DropValuationData {
  /** Main table: products with more than `lowStockMax` units. */
  products: ValuationProductRow[];
  /** Products with 1..lowStockMax units, summarized in a compact block. */
  lowStock: ValuationProductRow[];
  lowStockMax: number;
  /** Products with zero units across all variants — excluded from the report. */
  zeroStockCount: number;
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
