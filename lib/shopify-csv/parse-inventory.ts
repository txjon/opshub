import Papa from "papaparse";

export interface InventoryRow {
  sku: string;
  title: string;
  location: string;
  onHand: number | null;
}

type Row = Record<string, string>;

export function normalizeSku(s: string): string {
  return s.replace(/^'/, "").trim();
}

export function parseShopifyInventoryCSV(csvText: string): InventoryRow[] {
  const parsed = Papa.parse<Row>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors?.length) {
    console.warn("[shopify-csv inventory] parse warnings:", parsed.errors.slice(0, 3));
  }

  const rows = parsed.data || [];

  let lastTitle = "";
  let lastHandle = "";
  for (const r of rows) {
    if ((r["Title"] || "").trim()) lastTitle = r["Title"].trim();
    else r["Title"] = lastTitle;

    if ((r["Handle"] || "").trim()) lastHandle = r["Handle"].trim();
    else r["Handle"] = lastHandle;
  }

  const result: InventoryRow[] = [];
  for (const r of rows) {
    const sku = normalizeSku(r["SKU"] || "");
    if (!sku) continue;
    const location = (r["Location"] || "").trim();
    if (!location) continue;
    const raw = (r["On hand (current)"] || "").trim();
    let onHand: number | null = null;
    if (raw) {
      if (raw.toLowerCase() === "not stocked") {
        onHand = null;
      } else {
        const n = Number(raw);
        onHand = Number.isFinite(n) ? Math.trunc(n) : null;
      }
    }
    result.push({
      sku,
      title: (r["Title"] || "").trim(),
      location,
      onHand,
    });
  }

  return result;
}

const POD_TOKENS = [
  "printful",
  "printify",
  "odmpod",
  "print on demand",
  "pod",
  "dropship",
];

export function isPodLocation(name: string): boolean {
  const n = name.toLowerCase();
  return POD_TOKENS.some((t) => n.includes(t));
}

export function partitionLocations(allLocations: string[]): {
  allLocations: string[];
  podLocations: string[];
  physicalLocations: string[];
} {
  const pod: string[] = [];
  const physical: string[] = [];
  for (const loc of allLocations) {
    if (isPodLocation(loc)) pod.push(loc);
    else physical.push(loc);
  }
  return { allLocations: allLocations.slice(), podLocations: pod, physicalLocations: physical };
}
