export interface ValuationProductRow {
  title: string;
  variantCount: number;
  units: number;
  retailValue: number;
  pctOfDrop: number;
}

export interface DropValuationData {
  products: ValuationProductRow[];
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
