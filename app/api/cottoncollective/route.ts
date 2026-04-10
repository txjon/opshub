export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const CC_BASE = "https://api.cottoncollective.org/api";
const CC_SECRET_ID = process.env.CC_SECRET_ID || "";
const CC_SECRET_KEY = process.env.CC_SECRET_KEY || "";
const CC_CUSTOMER_ID = process.env.CC_CUSTOMER_ID || "";

let cachedToken: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(`${CC_BASE}/generate-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_id: CC_SECRET_ID, secret_key: CC_SECRET_KEY }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CC token error: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = { token: data.token || data.access_token || data.Token, expires: Date.now() + 3500 * 1000 };
  return cachedToken.token;
}

function parseCSV(csv: string): any[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    // Handle quoted CSV fields
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += char;
    }
    values.push(current.trim());
    const obj: any = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ""; });
    return obj;
  });
}

export async function GET(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const action = req.nextUrl.searchParams.get("action") || "products";
    const token = await getToken();

    if (action === "products") {
      // Fetch product pricing — external_id as query param
      const res = await fetch(`${CC_BASE}/getProductPriceByCustomer?external_id=${CC_CUSTOMER_ID}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `CC API error: ${res.status}`, detail: text.slice(0, 500) }, { status: 500 });
      }

      const csv = await res.text();
      const rows = parseCSV(csv);

      // SKU format: CC2FK250SLD-BLKWH-2XL → style-color-size
      // Multiple rows per SKU for qty tiers (min_qty: 1, 200, etc.)
      // Use min_qty=1 as base price
      const styles: Record<string, any> = {};
      for (const row of rows) {
        const fullSku = row.sku || "";
        const minQty = parseInt(row.min_qty || "0") || 0;
        const price = parseFloat(row.price || "0") || 0;

        // Only use base price (min_qty = 1)
        if (minQty > 1) continue;

        // Parse SKU: everything up to second-to-last dash is style, last part is size, middle is color
        const parts = fullSku.split("-");
        if (parts.length < 3) continue;

        const size = parts[parts.length - 1]; // Last part = size
        const color = parts[parts.length - 2]; // Second to last = color
        const styleCode = parts.slice(0, parts.length - 2).join("-"); // Rest = style

        if (!styleCode || !color || !size) continue;

        if (!styles[styleCode]) {
          styles[styleCode] = { name: styleCode, sku: styleCode, colors: {} };
        }

        if (!styles[styleCode].colors[color]) {
          styles[styleCode].colors[color] = { sizes: [], prices: {} };
        }
        if (!styles[styleCode].colors[color].sizes.includes(size)) {
          styles[styleCode].colors[color].sizes.push(size);
        }
        styles[styleCode].colors[color].prices[size] = price;
      }

      // Sort sizes within each color
      const SIZE_ORDER = ["XS","S","M","L","XL","2XL","3XL","4XL","5XL"];
      const sortSz = (sizes: string[]) => sizes.sort((a, b) => {
        const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

      // Category mapping from SKU prefix
      const CATEGORY_MAP: Record<string, string> = {
        SST: "Tees", LST: "Tees", MST: "Tees", DRP: "Tees",
        "2FT": "Tees", "2FK": "Kids",
        CRW: "Crewnecks", HOD: "Hoodies", ZIP: "Hoodies",
        CRP: "Crops", PNT: "Bottoms", SHR: "Bottoms",
        VLY: "Shorts", THL: "Thermals", SSK: "Socks", RW: "Raw",
      };

      // Full product name mapping: SKU code → real product name from cottoncollective.org
      const PRODUCT_NAMES: Record<string, string> = {
        // Tees
        "CCSST200SPR": "Tour S/S Tee 6.0 oz — Spiral",
        "CCSST200CLD": "Tour S/S Tee 6.0 oz — Cloud",
        "CCSST200CRY": "Tour S/S Tee 6.0 oz — Crystal",
        "CCSST200MNR": "Tour S/S Tee 6.0 oz — Mineral",
        "CCSST220SLD": "Daily S/S Tee 6.5 oz — Solid",
        "CCSST220SNW": "Daily S/S Tee 6.5 oz — Snow Wash",
        "CCSST220HTR": "Daily S/S Tee 6.5 oz — Heather",
        "CCSST250SLD": "Oversized Box S/S Tee 7.5 oz — Solid",
        "CCSST250SNW": "Oversized Box S/S Tee 7.5 oz — Snow Wash",
        "CCSST250HTR": "Oversized Box S/S Tee 7.5 oz — Heather",
        "CCSST250PGM": "Oversized Box S/S Tee 7.5 oz — Pigment",
        "CCSST250PFD": "Oversized Box S/S Tee 7.5 oz — PFD",
        "CCSST250OIL": "Oversized Box S/S Tee 7.5 oz — Oil Wash",
        "CCSST250ORG": "Oversized Box S/S Tee 7.5 oz — Organic",
        "CCSST250PTS": "Oversized Box S/S Tee 7.5 oz — Paint Splatter",
        "CCSST250SN": "Oversized Box S/S Tee 7.5 oz — Snow",
        "CCSST305SLD": "Heavy Box S/S Tee 9 oz — Solid",
        "CCSST305SNW": "Heavy Box S/S Tee 9 oz — Snow Wash",
        // Long Sleeve
        "CCLST250SLD": "Oversized Box L/S Tee 7.5 oz — Solid",
        "CCLST250SNW": "Oversized Box L/S Tee 7.5 oz — Snow Wash",
        "CCLST250CUT": "Oversized Box L/S Tee 7.5 oz — Cut",
        // Drop Crop
        "CCDRP235SLD": "Drop Crop S/S Tee 7.0 oz — Solid",
        "CCDRP235SNW": "Drop Crop S/S Tee 7.0 oz — Snow Wash",
        "CCDRP235HTR": "Drop Crop S/S Tee 7.0 oz — Heather",
        // Muscle
        "CCMST250SLD": "Muscle Tee 7.5 oz — Solid",
        "CCMST250SNW": "Muscle Tee 7.5 oz — Snow Wash",
        // Crops
        "CCCRP250SLD": "Oversized Crop S/S Tee 7.5 oz — Solid",
        "CCCRP250SNW": "Oversized Crop S/S Tee 7.5 oz — Snow Wash",
        // Crewnecks
        "CCCRW510SLD": "Heavy Crew 15 oz — Solid",
        "CCCRW510SNW": "Heavy Crew 15 oz — Snow Wash",
        "CCCRW510PGM": "Heavy Crew 15 oz — Pigment",
        "CCCRW510CRY": "Heavy Crew 15 oz — Crystal",
        "CCCRW520SLD": "Heavy Crew 15 oz — Solid",
        // Hoodies
        "CCHOD376SLD": "Standard Hoodie 11 oz — Solid",
        "CCHOD376SNW": "Standard Hoodie 11 oz — Snow Wash",
        "CCHOD475SLD": "Special Hoodie 14 oz — Solid",
        "CCHOD475SNW": "Special Hoodie 14 oz — Snow Wash",
        "CCHOD475PGM": "Special Hoodie 14 oz — Pigment",
        "CCHOD475HTR": "Special Hoodie 14 oz — Heather",
        "CCHOD475CRY": "Special Hoodie 14 oz — Crystal",
        "CCHOD475PNT": "Special Hoodie 14 oz — Paint",
        "CCHOD475PTS": "Special Hoodie 14 oz — Paint Splatter",
        "CCHOD510SLD": "Heavy Hoodie 15 oz — Solid",
        "CCHOD510PGM": "Heavy Hoodie 15 oz — Pigment",
        "CCHOD510PFD": "Heavy Hoodie 15 oz — PFD",
        // Zip Hoodies
        "CCZIP376SLD": "Standard Zip Hoodie 11 oz — Solid",
        "CCZIP376SNW": "Standard Zip Hoodie 11 oz — Snow Wash",
        "CCZIP475SNW": "Special Zip Hoodie 14 oz — Snow Wash",
        "CCZIP475PTS": "Special Zip Hoodie 14 oz — Paint Splatter",
        // Bottoms
        "CCPNT405SLD": "Special Pant 12.5 oz — Solid",
        "CCPNT405SNW": "Special Pant 12.5 oz — Snow Wash",
        "CCPNT405PGM": "Baggy Pant 12 oz — Pigment",
        "CCPNT405HTR": "Special Pant 12.5 oz — Heather",
        "CCPNT420SNW": "Baggy Pant 12 oz — Snow Wash",
        "CCSHR390PGM": "Dunk Short 11.5 oz — Pigment",
        "CCSHR390SNW": "Dunk Short 11.5 oz — Snow Wash",
        // Shorts/Tanks
        "CCVLY420SNW": "Volley Short 12.5 oz — Snow Wash",
        // Thermals
        "CCTHL240SLD": "Waffle L/S Tee 7.0 oz — Solid",
        "CCTHL240SNW": "Waffle L/S Tee 7.0 oz — Snow Wash",
        "CCTHL240HTR": "Waffle L/S Tee 7.0 oz — Heather",
        // Socks
        "CCSSK250SLD": "Socks — Solid",
        "CCSSK250SNW": "Socks — Snow Wash",
        // Kids
        "CC2FT250SLD": "Oversized Kids 2fer L/S Tee 7.5 oz — Solid",
        "CC2FT250SNW": "Oversized Kids 2fer L/S Tee 7.5 oz — Snow Wash",
        "CC2FK250SLD": "Oversized Kids S/S Tee 7.5 oz — Solid",
        "CC2FK250SNW": "Oversized Kids S/S Tee 7.5 oz — Snow Wash",
        // Raw
        "CCRW510PFD": "Prepared For Dye (PFD)",
      };

      const products = Object.values(styles).map((s: any) => {
        // Extract prefix: strip "CC" then grab letters before numbers
        const rawPrefix = s.sku.replace(/^CC/, "");
        const prefix = rawPrefix.replace(/[0-9].*/, "");
        const productName = PRODUCT_NAMES[s.sku] || null;
        return {
          name: productName || s.sku,
          sku: s.sku,
          category: CATEGORY_MAP[prefix] || "Other",
          typeLabel: productName || s.sku,
          colors: Object.entries(s.colors).map(([color, data]: [string, any]) => ({
            color,
            sizes: sortSz(data.sizes),
            prices: data.prices,
          })),
        };
      });

      // Build category summary
      const categories: Record<string, number> = {};
      for (const p of products) {
        categories[p.category] = (categories[p.category] || 0) + 1;
      }

      return NextResponse.json({ products, categories, raw_count: rows.length });
    }

    if (action === "inventory") {
      const sku = req.nextUrl.searchParams.get("sku") || "";
      const params = new URLSearchParams({ customer_id: CC_CUSTOMER_ID });
      if (sku) params.set("sku", sku);
      const url = `${CC_BASE}/getvariantinventory?${params}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        return NextResponse.json({ error: `CC inventory error: ${res.status}` }, { status: 500 });
      }

      const csv = await res.text();
      const rows = parseCSV(csv);
      return NextResponse.json({ inventory: rows });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
