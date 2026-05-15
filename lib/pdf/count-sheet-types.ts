export interface CountSheetVariant {
  sku: string;
  variantLabel: string;
  systemQty: number;
}

export interface CountSheetProduct {
  title: string;
  variants: CountSheetVariant[];
}

export interface CountSheetData {
  products: CountSheetProduct[];
  reportRef: string;
  reportDate: string;
  totalProducts: number;
  totalVariants: number;
  companyName: string;
  companyLogoSvg: string;
}
