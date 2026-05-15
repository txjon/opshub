export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { getPdfBranding } from "@/lib/branding";
import { renderDropValuationHTML } from "@/lib/pdf/drop-valuation-html";
import { DropValuationData, ValuationProductRow } from "@/lib/pdf/drop-valuation-types";
import { parseShopifyProductCsv } from "@/lib/shopify-csv/parse";

function formatReportDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatReportRef(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `DROP-${y}${m}${day}`;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const statusFilter = (url.searchParams.get("status") || "all").toLowerCase();

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const text = await (file as File).text();
    const parsed = parseShopifyProductCsv(text, { statusFilter });

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "No products with inventory found in CSV" },
        { status: 400 }
      );
    }

    const products: ValuationProductRow[] = parsed.map((p) => {
      const units = p.variants.reduce((s, v) => s + v.qty, 0);
      const retailValue = p.variants.reduce((s, v) => s + v.qty * v.price, 0);
      return {
        title: p.title,
        variantCount: p.variants.length,
        units,
        retailValue,
        pctOfDrop: 0,
      };
    });

    const totalValue = products.reduce((s, p) => s + p.retailValue, 0);
    const totalUnits = products.reduce((s, p) => s + p.units, 0);
    const totalVariants = products.reduce((s, p) => s + p.variantCount, 0);
    const totalProducts = products.length;
    const avgRetailPerUnit = totalUnits > 0 ? totalValue / totalUnits : 0;

    for (const p of products) {
      p.pctOfDrop = totalValue > 0 ? (p.retailValue / totalValue) * 100 : 0;
    }

    products.sort((a, b) => b.retailValue - a.retailValue);

    const flags: string[] = [];
    for (const p of products) {
      if (p.title.toLowerCase().includes("need updated count")) {
        flags.push(`"${p.title}" listed with title marker indicating count is pending`);
      }
      if (p.units === 0) {
        flags.push(`"${p.title}" has zero units across all variants`);
      }
    }

    const now = new Date();
    const reportRef = formatReportRef(now);
    const reportDate = formatReportDate(now);

    const branding = await getPdfBranding();

    const data: DropValuationData = {
      products,
      totalValue,
      totalUnits,
      totalProducts,
      totalVariants,
      avgRetailPerUnit,
      flags,
      reportRef,
      reportDate,
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
    console.error("[drop-valuation] error:", e);
    return NextResponse.json({ error: e.message || "Failed to generate drop valuation" }, { status: 500 });
  }
}
