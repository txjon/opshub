import Papa from "papaparse";

type ShopifyRow = Record<string, string>;

export interface ParsedVariant {
  sku: string;
  variantLabel: string;
  qty: number;
  price: number;
}

export interface ParsedProduct {
  title: string;
  handle: string;
  status: string;
  variants: ParsedVariant[];
}

export interface ParseOptions {
  /** "draft" | "active" | "all" | other Shopify status. Anything not
   *  "all" is matched case-insensitively against the row's Status. */
  statusFilter?: string;
}

function buildVariantLabel(row: ShopifyRow): string {
  const opts = [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]];
  const parts = opts
    .map((v) => (v || "").trim())
    .filter((v) => v && v.toLowerCase() !== "default title");
  return parts.length ? parts.join(" / ") : "—";
}

export function parseShopifyProductCsv(
  csvText: string,
  opts: ParseOptions = {}
): ParsedProduct[] {
  const statusFilter = (opts.statusFilter || "all").toLowerCase();

  const parsed = Papa.parse<ShopifyRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors?.length) {
    console.warn("[shopify-csv] parse warnings:", parsed.errors.slice(0, 3));
  }

  const rows = parsed.data || [];

  // Forward-fill Title, Handle, Status (Shopify exports leave them
  // blank on continuation rows for each variant after the first).
  let lastTitle = "";
  let lastHandle = "";
  let lastStatus = "";
  for (const r of rows) {
    if ((r["Title"] || "").trim()) lastTitle = r["Title"].trim();
    else r["Title"] = lastTitle;

    if ((r["Handle"] || "").trim()) lastHandle = r["Handle"].trim();
    else r["Handle"] = lastHandle;

    if ((r["Status"] || "").trim()) lastStatus = r["Status"].trim();
    else r["Status"] = lastStatus;
  }

  // Must have a valid Variant Inventory Qty (0 counts; blank/non-numeric drops)
  const qtyRows = rows.filter((r) => {
    const raw = (r["Variant Inventory Qty"] || "").trim();
    if (!raw) return false;
    const n = Number(raw);
    return Number.isFinite(n);
  });

  const statusFiltered = qtyRows.filter((r) => {
    if (statusFilter === "all") return true;
    return (r["Status"] || "").toLowerCase() === statusFilter;
  });

  // Group by Title, preserving CSV variant order
  const productMap = new Map<string, ParsedProduct>();
  for (const r of statusFiltered) {
    const title = (r["Title"] || "").trim();
    if (!title) continue;
    const qty = Number((r["Variant Inventory Qty"] || "0").trim()) || 0;
    const price = Number((r["Variant Price"] || "0").trim()) || 0;
    const variant: ParsedVariant = {
      sku: (r["Variant SKU"] || "").trim(),
      variantLabel: buildVariantLabel(r),
      qty,
      price,
    };
    let p = productMap.get(title);
    if (!p) {
      p = {
        title,
        handle: (r["Handle"] || "").trim(),
        status: (r["Status"] || "").trim(),
        variants: [],
      };
      productMap.set(title, p);
    }
    p.variants.push(variant);
  }

  return Array.from(productMap.values());
}
