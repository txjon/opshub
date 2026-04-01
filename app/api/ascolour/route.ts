import { NextRequest, NextResponse } from "next/server";

const AC_BASE = "https://api.ascolour.com/v1";
const getSubKey = () => process.env.ASCOLOUR_SUBSCRIPTION_KEY || "";

// Token cache
let cachedToken: string | null = null;
let tokenExpiry = 0;

// Data caches (30 min TTL)
const CACHE_TTL = 30 * 60 * 1000;
let productCache: { data: any[]; ts: number } | null = null;
let pricingCache: { data: any[]; ts: number } | null = null;

async function getAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(`${AC_BASE}/api/authentication`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Subscription-Key": getSubKey() },
    body: JSON.stringify({ email: process.env.ASCOLOUR_EMAIL || "", password: process.env.ASCOLOUR_PASSWORD || "" }),
  });
  if (!res.ok) throw new Error(`AS Colour auth failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken!;
}

const hdrs = () => ({ "Accept": "application/json", "Content-Type": "application/json", "Subscription-Key": getSubKey() });
const authHdrs = async () => ({ ...hdrs(), "Authorization": `Bearer ${await getAuthToken()}` });

async function paginate(url: string, h: Record<string, string>): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetch(`${url}${sep}pageSize=250&pageNumber=${page}`, { headers: h, cache: "no-store" });
    if (!res.ok) break;
    const data = await res.json();
    const items = data.data || data;
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < 250) break;
    page++;
  }
  return all;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const styleCode = searchParams.get("styleCode") || "";
  const q = searchParams.get("q") || "";

  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  try {
    if (endpoint === "products") {
      if (productCache && Date.now() - productCache.ts < CACHE_TTL) return NextResponse.json(productCache.data);
      const data = await paginate(`${AC_BASE}/catalog/products`, hdrs());
      productCache = { data, ts: Date.now() };
      return NextResponse.json(data);

    } else if (endpoint === "variants") {
      if (!styleCode) return NextResponse.json({ error: "Missing styleCode" }, { status: 400 });
      return NextResponse.json(await paginate(`${AC_BASE}/catalog/products/${styleCode}/variants`, hdrs()));

    } else if (endpoint === "inventory") {
      const url = q ? `${AC_BASE}/inventory/items?skuFilter=${encodeURIComponent(q)}` : `${AC_BASE}/inventory/items`;
      return NextResponse.json(await paginate(url, hdrs()));

    } else if (endpoint === "pricing") {
      if (pricingCache && Date.now() - pricingCache.ts < CACHE_TTL) return NextResponse.json(pricingCache.data);
      const data = await paginate(`${AC_BASE}/catalog/pricelist`, await authHdrs());
      pricingCache = { data, ts: Date.now() };
      return NextResponse.json(data);

    } else {
      return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch", detail: String(err) }, { status: 500 });
  }
}
