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
        CRW: "Crewnecks", HOD: "Hoodies", ZIP: "Hoodies",
        CRP: "Crops", PNT: "Bottoms", SHR: "Bottoms",
        VLY: "Tanks", THL: "Thermals", SSK: "Socks", RW: "Raw",
      };
      const PREFIX_LABELS: Record<string, string> = {
        SST: "Short Sleeve Tee", LST: "Long Sleeve Tee", MST: "Muscle Tee", DRP: "Drop Shoulder Tee",
        CRW: "Crewneck", HOD: "Hoodie", ZIP: "Zip Hoodie",
        CRP: "Crop", PNT: "Pants", SHR: "Shorts",
        VLY: "Tank", THL: "Thermal", SSK: "Socks", RW: "Raw",
      };

      const products = Object.values(styles).map((s: any) => {
        // Extract prefix: strip "CC" then grab letters before numbers
        const prefix = s.sku.replace(/^CC/, "").replace(/[0-9].*/, "");
        return {
          name: s.name,
          sku: s.sku,
          category: CATEGORY_MAP[prefix] || "Other",
          typeLabel: PREFIX_LABELS[prefix] || prefix,
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
