export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { getPdfBranding } from "@/lib/branding";
import { renderDropValuationHTML } from "@/lib/pdf/drop-valuation-html";
import { DropValuationData } from "@/lib/pdf/drop-valuation-types";
import { buildValuation } from "@/lib/pdf/drop-valuation-build";
import { parseShopifyProductCsv } from "@/lib/shopify-csv/parse";

// Products at or under this many units (across all variants) leave the main
// table and roll up into the low-stock block (Jon, Sep 14 2026: the report
// was 27 pages, most of it zero-stock rows + a flag per zero-stock row).
const LOW_STOCK_MAX = 9;

function formatReportDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" , timeZone: "America/Los_Angeles" });
}

function formatReportRef(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `INV-${y}${m}${day}`;
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

    const v = buildValuation(parsed, LOW_STOCK_MAX);
    if (v.totalProducts === 0) {
      return NextResponse.json(
        { error: "Every product in the CSV has zero inventory" },
        { status: 400 }
      );
    }

    const now = new Date();
    const reportRef = formatReportRef(now);
    const reportDate = formatReportDate(now);

    const branding = await getPdfBranding();

    const data: DropValuationData = {
      ...v,
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
    const filename = `${tenantPrefix}-Inventory-Valuation-${reportRef}.pdf`;

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
