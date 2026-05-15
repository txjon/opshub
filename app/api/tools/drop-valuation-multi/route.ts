export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { getPdfBranding } from "@/lib/branding";
import { parseShopifyProductCsv } from "@/lib/shopify-csv/parse";
import { parseShopifyInventoryCSV } from "@/lib/shopify-csv/parse-inventory";
import { mergeProductsAndInventory } from "@/lib/shopify-csv/merge";
import { renderDropValuationHTML } from "@/lib/pdf/drop-valuation-multi-html";
import {
  DropValuationData,
  LocationSummary,
  StatusSummary,
  ProductRow,
  FlaggedRow,
} from "@/lib/pdf/drop-valuation-multi-types";

function formatReportDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatReportRef(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `DROP-${y}${m}${day}`;
}

const titleCase = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

function humanStatus(filter: string, presentStatuses: string[]): string {
  if (filter === "draft") return "Drafts Only";
  if (filter === "active") return "Active Only";
  // "all" — list the statuses we actually saw so the reader knows what's in scope
  const labels = presentStatuses.map(titleCase).filter(Boolean);
  if (labels.length === 0) return "All Products";
  return `All (${labels.join(", ")})`;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const rawStatus = (url.searchParams.get("status") || "all").toLowerCase();
    const includedStatusFilter: "all" | "draft" | "active" =
      rawStatus === "draft" || rawStatus === "active" ? rawStatus : "all";

    const locationsParam = url.searchParams.get("locations") || "";
    const includedLocationsFromQuery = locationsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const form = await req.formData();
    const productsFile = form.get("productsFile");
    if (!productsFile || typeof productsFile === "string") {
      return NextResponse.json({ error: "Missing productsFile" }, { status: 400 });
    }
    const inventoryFile = form.get("inventoryFile");
    const hasInventory = Boolean(inventoryFile && typeof inventoryFile !== "string");

    const productsText = await (productsFile as File).text();
    const products = parseShopifyProductCsv(productsText, {
      statusFilter: includedStatusFilter,
      requireQty: !hasInventory,
    });

    if (products.length === 0) {
      return NextResponse.json(
        { error: "No products parsed from products CSV" },
        { status: 400 }
      );
    }

    const inventory = hasInventory
      ? parseShopifyInventoryCSV(await (inventoryFile as File).text())
      : null;

    const merged = mergeProductsAndInventory(products, inventory, {
      includedLocations: includedLocationsFromQuery,
    });

    const isMultiLocation = hasInventory && merged.physicalLocations.length > 1;
    const includedLocations = includedLocationsFromQuery.length
      ? includedLocationsFromQuery.filter((l) => merged.allLocations.includes(l))
      : merged.physicalLocations.slice();

    // Bucket each (variant, location) pair: positive qty feeds the totals;
    // negative qty feeds the flagged section. A "mixed" variant (e.g. +100
    // at A, -2 at B) contributes +100 to totals AND -2 to flagged — so the
    // top of the report stays clean and the oversold rows are reported
    // separately. This replaces an older approach that netted the qtys
    // per-variant first, which silently dropped the positive count.
    type VariantPositive = {
      title: string;
      sku: string;
      status: string;
      price: number;
      posUnits: number;
      posValue: number;
      posPerLoc: Record<string, number>;
    };

    const variantPositives: VariantPositive[] = [];
    const flagged: FlaggedRow[] = [];
    const oversoldVariantSet = new Set<string>(); // unique variant SKUs flagged
    let oversoldUnitsAbs = 0;
    let oversoldValueAbs = 0;

    for (const v of merged.variants) {
      let posUnits = 0;
      let posValue = 0;
      const posPerLoc: Record<string, number> = {};
      let hasNegHere = false;

      for (const [loc, qty] of Object.entries(v.perLocation)) {
        if (qty > 0) {
          posUnits += qty;
          posValue += qty * v.price;
          posPerLoc[loc] = qty;
        } else if (qty < 0) {
          hasNegHere = true;
          const negValue = qty * v.price;
          flagged.push({
            title: v.title,
            location: loc,
            units: qty,
            retailNegative: negValue,
          });
          oversoldUnitsAbs += Math.abs(qty);
          oversoldValueAbs += Math.abs(negValue);
        }
      }

      if (hasNegHere) oversoldVariantSet.add(v.sku || `${v.title}::${v.variantLabel}`);

      variantPositives.push({
        title: v.title,
        sku: v.sku,
        status: v.status,
        price: v.price,
        posUnits,
        posValue,
        posPerLoc,
      });
    }

    flagged.sort((a, b) => a.retailNegative - b.retailNegative);
    const oversoldCount = oversoldVariantSet.size;

    // Headline totals — positive only
    const totalValue = variantPositives.reduce((s, vp) => s + vp.posValue, 0);
    const totalUnits = variantPositives.reduce((s, vp) => s + vp.posUnits, 0);
    const titleSet = new Set<string>();
    let totalVariants = 0;
    for (const vp of variantPositives) {
      if (vp.posUnits > 0) {
        titleSet.add(vp.title);
        totalVariants++;
      }
    }
    const totalProducts = titleSet.size;
    const avgRetailPerUnit = totalUnits > 0 ? totalValue / totalUnits : 0;

    // Per-location breakdown (positive only), sorted by retail desc
    const locationSummaries: LocationSummary[] = includedLocations
      .map((loc) => {
        let units = 0;
        let retail = 0;
        const skuSet = new Set<string>();
        for (const vp of variantPositives) {
          const q = vp.posPerLoc[loc];
          if (q && q > 0) {
            units += q;
            retail += q * vp.price;
            skuSet.add(vp.sku);
          }
        }
        return {
          location: loc,
          skusStocked: skuSet.size,
          units,
          retail,
          pctOfTotal: totalValue > 0 ? (retail / totalValue) * 100 : 0,
        };
      })
      .sort((a, b) => b.retail - a.retail);

    // Per-status breakdown (positive only)
    const statusMap = new Map<string, { units: number; retail: number }>();
    for (const vp of variantPositives) {
      const key = (vp.status || "unknown").toLowerCase();
      let s = statusMap.get(key);
      if (!s) {
        s = { units: 0, retail: 0 };
        statusMap.set(key, s);
      }
      s.units += vp.posUnits;
      s.retail += vp.posValue;
    }
    const statusSummaries: StatusSummary[] = Array.from(statusMap.entries())
      .map(([status, s]) => ({
        status: titleCase(status),
        units: s.units,
        retail: s.retail,
        pctOfTotal: totalValue > 0 ? (s.retail / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.retail - a.retail);
    const presentStatusesLower = Array.from(statusMap.keys()).sort();

    // Product-level breakdown (positive only) — group variants of same title
    const productMap = new Map<
      string,
      { units: number; retail: number; locationSet: Set<string> }
    >();
    for (const vp of variantPositives) {
      if (vp.posUnits === 0) continue;
      let p = productMap.get(vp.title);
      if (!p) {
        p = { units: 0, retail: 0, locationSet: new Set() };
        productMap.set(vp.title, p);
      }
      p.units += vp.posUnits;
      p.retail += vp.posValue;
      for (const loc of Object.keys(vp.posPerLoc)) p.locationSet.add(loc);
    }
    const productsRows: ProductRow[] = Array.from(productMap.entries())
      .map(([title, p]) => ({
        title,
        locations: Array.from(p.locationSet).join(", "),
        units: p.units,
        retail: p.retail,
        pctOfTotal: totalValue > 0 ? (p.retail / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.retail - a.retail);

    const now = new Date();
    const reportRef = formatReportRef(now);
    const reportDate = formatReportDate(now);

    const locationsSummaryStr = isMultiLocation
      ? `${includedLocations.length} Physical Warehouse${includedLocations.length === 1 ? "" : "s"}`
      : "Default Location";
    const statusesSummaryStr = humanStatus(includedStatusFilter, presentStatusesLower);

    const podDetected = merged.podLocations;
    const footerNote = isMultiLocation
      ? `Valuation calculated from Shopify Inventory export merged with Products export on SKU. Retail value = On hand (current) × Variant Price for each location.${
          podDetected.length
            ? ` Print-on-demand locations (${podDetected.join(", ")}) are excluded as they represent virtual inventory.`
            : ""
        }`
      : "Valuation calculated from Shopify Products export. Retail value = Variant Inventory Qty × Variant Price across all products matching the selected status filter.";

    const branding = await getPdfBranding();

    const data: DropValuationData = {
      isMultiLocation,
      locationSummaries,
      statusSummaries,
      products: productsRows,
      flagged,
      totalValue,
      totalUnits,
      totalProducts,
      totalVariants,
      avgRetailPerUnit,
      oversoldCount,
      oversoldUnitsAbs,
      oversoldValueAbs,
      reportRef,
      reportDate,
      locationsSummaryStr,
      statusesSummaryStr,
      includedStatusFilter,
      footerNote,
      companyName: branding.name,
      companyLogoSvg: branding.logoSvg,
    };

    const html = renderDropValuationHTML(data);
    const pdf = await generatePDF(html);

    const tenantPrefix = (branding.name || "Drop")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    const filename = `${tenantPrefix}-Drop-Valuation-${reportRef}.pdf`;

    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error("[drop-valuation-multi] error:", e);
    return NextResponse.json(
      { error: e.message || "Failed to generate drop valuation" },
      { status: 500 }
    );
  }
}
