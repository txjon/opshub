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
      // Fetch product pricing for this customer
      const res = await fetch(`${CC_BASE}/getProductPriceByCustomer/${CC_CUSTOMER_ID}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `CC API error: ${res.status}`, detail: text.slice(0, 500) }, { status: 500 });
      }

      const csv = await res.text();
      const rows = parseCSV(csv);

      // Group by style (product) → colors → sizes with pricing
      const styles: Record<string, any> = {};
      for (const row of rows) {
        const sku = row.SKU || row.sku || row.Sku || "";
        const styleName = row.ProductTitle || row.product_title || row.Title || row.title || row.Style || row.style || sku;
        const color = row.Color || row.color || row.Colour || row.colour || row.VariantTitle || row.variant_title || "";
        const size = row.Size || row.size || "";
        const price = parseFloat(row.Price || row.price || row.CustomerPrice || row.customer_price || "0") || 0;

        const styleKey = styleName.replace(/\s*-\s*$/, "").trim();
        if (!styleKey) continue;

        if (!styles[styleKey]) {
          styles[styleKey] = { name: styleKey, sku: sku.split("-")[0] || sku, colors: {} };
        }

        const colorKey = color || "Default";
        if (!styles[styleKey].colors[colorKey]) {
          styles[styleKey].colors[colorKey] = { sizes: [], prices: {} };
        }
        if (size && !styles[styleKey].colors[colorKey].sizes.includes(size)) {
          styles[styleKey].colors[colorKey].sizes.push(size);
        }
        if (size) {
          styles[styleKey].colors[colorKey].prices[size] = price;
        }
      }

      // Convert to array
      const products = Object.values(styles).map((s: any) => ({
        name: s.name,
        sku: s.sku,
        colors: Object.entries(s.colors).map(([color, data]: [string, any]) => ({
          color,
          sizes: data.sizes,
          prices: data.prices,
        })),
      }));

      return NextResponse.json({ products, raw_count: rows.length });
    }

    if (action === "inventory") {
      const sku = req.nextUrl.searchParams.get("sku") || "";
      const url = sku
        ? `${CC_BASE}/getvariantinventory/${CC_CUSTOMER_ID}/${sku}`
        : `${CC_BASE}/getvariantinventory/${CC_CUSTOMER_ID}`;

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
