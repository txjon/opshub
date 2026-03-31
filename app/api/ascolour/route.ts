import { NextRequest, NextResponse } from "next/server";

const AC_BASE = "https://api.ascolour.com/v1";
const getSubKey = () => process.env.ASCOLOUR_SUBSCRIPTION_KEY || "";

// Token cache
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${AC_BASE}/api/authentication`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Subscription-Key": getSubKey(),
    },
    body: JSON.stringify({
      email: process.env.ASCOLOUR_EMAIL || "",
      password: process.env.ASCOLOUR_PASSWORD || "",
    }),
  });

  if (!res.ok) throw new Error(`AS Colour auth failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23 hours
  return cachedToken!;
}

const headers = () => ({
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Subscription-Key": getSubKey(),
});

const authHeaders = async () => ({
  ...headers(),
  "Authorization": `Bearer ${await getAuthToken()}`,
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const styleCode = searchParams.get("styleCode") || "";
  const q = searchParams.get("q") || "";

  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  try {
    if (endpoint === "products") {
      // Paginate to get all products
      const hdrs = headers();
      const allProducts: any[] = [];
      let page = 1;
      while (true) {
        const res = await fetch(`${AC_BASE}/catalog/products?pageSize=250&pageNumber=${page}`, { headers: hdrs, cache: "no-store" });
        if (!res.ok) break;
        const data = await res.json();
        const items = data.data || data;
        if (!Array.isArray(items) || items.length === 0) break;
        allProducts.push(...items);
        if (items.length < 250) break;
        page++;
      }
      return NextResponse.json(allProducts);
    } else if (endpoint === "variants") {
      if (!styleCode) return NextResponse.json({ error: "Missing styleCode" }, { status: 400 });
      const hdrs = headers();
      const allVars: any[] = [];
      let page = 1;
      while (true) {
        const res = await fetch(`${AC_BASE}/catalog/products/${styleCode}/variants?pageSize=250&pageNumber=${page}`, { headers: hdrs, cache: "no-store" });
        if (!res.ok) break;
        const data = await res.json();
        const items = data.data || data;
        if (!Array.isArray(items) || items.length === 0) break;
        allVars.push(...items);
        if (items.length < 250) break;
        page++;
      }
      return NextResponse.json(allVars);
    } else if (endpoint === "inventory") {
      // Paginate inventory
      const hdrs = headers();
      const baseUrl = q
        ? `${AC_BASE}/inventory/items?skuFilter=${encodeURIComponent(q)}&pageSize=250`
        : `${AC_BASE}/inventory/items?pageSize=250`;
      const allInv: any[] = [];
      let page = 1;
      while (true) {
        const res = await fetch(`${baseUrl}&pageNumber=${page}`, { headers: hdrs, cache: "no-store" });
        if (!res.ok) break;
        const data = await res.json();
        const items = data.data || data;
        if (!Array.isArray(items) || items.length === 0) break;
        allInv.push(...items);
        if (items.length < 250) break;
        page++;
      }
      return NextResponse.json(allInv);
    } else if (endpoint === "pricing") {
      // Requires auth token
      const hdrs = await authHeaders();

      // Paginate to get all pricing
      const allPrices: any[] = [];
      let page = 1;
      while (true) {
        const pageUrl = `${AC_BASE}/catalog/pricelist?pageSize=250&pageNumber=${page}`;
        const res = await fetch(pageUrl, { headers: hdrs, cache: "no-store" });
        if (!res.ok) break;
        const data = await res.json();
        const items = data.data || data;
        if (!Array.isArray(items) || items.length === 0) break;
        allPrices.push(...items);
        if (items.length < 250) break;
        page++;
      }
      return NextResponse.json(allPrices);
    } else {
      return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch", detail: String(err) }, { status: 500 });
  }
}
