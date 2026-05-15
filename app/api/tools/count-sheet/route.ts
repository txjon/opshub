export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { getPdfBranding } from "@/lib/branding";
import { renderCountSheetHTML } from "@/lib/pdf/count-sheet-html";
import { CountSheetData, CountSheetProduct } from "@/lib/pdf/count-sheet-types";
import { parseShopifyProductCsv } from "@/lib/shopify-csv/parse";

function sortKey(title: string): string {
  return title.replace(/^[\*\s]+/, "").toLowerCase();
}

function formatReportDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatReportRef(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `COUNT-${y}${m}${day}`;
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

    const products: CountSheetProduct[] = parsed
      .slice()
      .sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)))
      .map((p) => ({
        title: p.title,
        variants: p.variants.map((v) => ({
          sku: v.sku,
          variantLabel: v.variantLabel,
          systemQty: v.qty,
        })),
      }));

    if (products.length === 0) {
      return NextResponse.json(
        { error: "No products with inventory found in CSV" },
        { status: 400 }
      );
    }

    const totalVariants = products.reduce((n, p) => n + p.variants.length, 0);
    const now = new Date();
    const reportRef = formatReportRef(now);
    const reportDate = formatReportDate(now);

    const branding = await getPdfBranding();

    const data: CountSheetData = {
      products,
      reportRef,
      reportDate,
      totalProducts: products.length,
      totalVariants,
      companyName: branding.name,
      companyLogoSvg: branding.logoSvg,
    };

    const html = renderCountSheetHTML(data);
    const pdf = await generatePDF(html);

    const tenantPrefix = (branding.name || "Inventory")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    const filename = `${tenantPrefix}-Count-Sheet-${reportRef}.pdf`;

    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error("[count-sheet] error:", e);
    return NextResponse.json({ error: e.message || "Failed to generate count sheet" }, { status: 500 });
  }
}
