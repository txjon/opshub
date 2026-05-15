export interface LocationSummary {
  location: string;
  skusStocked: number;
  units: number;
  retail: number;
  pctOfTotal: number;
}

export interface StatusSummary {
  status: string;
  units: number;
  retail: number;
  pctOfTotal: number;
}

export interface ProductRow {
  title: string;
  locations: string;
  units: number;
  retail: number;
  pctOfTotal: number;
}

export interface FlaggedRow {
  title: string;
  location: string;
  units: number;
  retailNegative: number;
}

export interface DropValuationData {
  isMultiLocation: boolean;
  locationSummaries: LocationSummary[];
  statusSummaries: StatusSummary[];
  products: ProductRow[];
  flagged: FlaggedRow[];
  totalValue: number;
  totalUnits: number;
  totalProducts: number;
  totalVariants: number;
  avgRetailPerUnit: number;
  oversoldCount: number;
  oversoldUnitsAbs: number;
  oversoldValueAbs: number;
  reportRef: string;
  reportDate: string;
  locationsSummaryStr: string;
  statusesSummaryStr: string;
  includedStatusFilter: "all" | "draft" | "active";
  footerNote: string;
  companyName: string;
  companyLogoSvg: string;
}
