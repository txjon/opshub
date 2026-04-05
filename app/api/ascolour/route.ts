import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const AC_BASE = "https://api.ascolour.com/v1";
const getSubKey = () => process.env.ASCOLOUR_SUBSCRIPTION_KEY || "";
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Token cache (OK in-memory — only used during active refresh)
let cachedToken: string | null = null;
let tokenExpiry = 0;

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

async function getCached(key: string): Promise<{ data: any; fresh: boolean } | null> {
  const sb = admin();
  const { data } = await sb.from("api_cache").select("data, updated_at").eq("key", key).single();
  if (!data) return null;
  const age = Date.now() - new Date(data.updated_at).getTime();
  return { data: data.data, fresh: age < CACHE_TTL };
}

async function setCache(key: string, value: any) {
  const sb = admin();
  await sb.from("api_cache").upsert({ key, data: value, updated_at: new Date().toISOString() });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const styleCode = searchParams.get("styleCode") || "";
  const q = searchParams.get("q") || "";

  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  try {
    if (endpoint === "products") {
      const cached = await getCached("ascolour_products");
      if (cached) {
        // Return cached data immediately, refresh in background if stale
        if (!cached.fresh) {
          paginate(`${AC_BASE}/catalog/products`, hdrs()).then(data => setCache("ascolour_products", data)).catch(() => {});
        }
        return NextResponse.json(cached.data);
      }
      const data = await paginate(`${AC_BASE}/catalog/products`, hdrs());
      await setCache("ascolour_products", data);
      return NextResponse.json(data);

    } else if (endpoint === "variants") {
      if (!styleCode) return NextResponse.json({ error: "Missing styleCode" }, { status: 400 });
      return NextResponse.json(await paginate(`${AC_BASE}/catalog/products/${styleCode}/variants`, hdrs()));

    } else if (endpoint === "inventory") {
      const url = q ? `${AC_BASE}/inventory/items?skuFilter=${encodeURIComponent(q)}` : `${AC_BASE}/inventory/items`;
      return NextResponse.json(await paginate(url, hdrs()));

    } else if (endpoint === "pricing") {
      const cached = await getCached("ascolour_pricing");
      if (cached) {
        if (!cached.fresh) {
          authHdrs().then(h => paginate(`${AC_BASE}/catalog/pricelist`, h)).then(data => setCache("ascolour_pricing", data)).catch(() => {});
        }
        return NextResponse.json(cached.data);
      }
      const data = await paginate(`${AC_BASE}/catalog/pricelist`, await authHdrs());
      await setCache("ascolour_pricing", data);
      return NextResponse.json(data);

    } else {
      return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
    }
  } catch (err) {
    // If fetch fails, try returning stale cache
    const fallbackKey = endpoint === "products" ? "ascolour_products" : endpoint === "pricing" ? "ascolour_pricing" : null;
    if (fallbackKey) {
      const stale = await getCached(fallbackKey);
      if (stale) return NextResponse.json(stale.data);
    }
    return NextResponse.json({ error: "Failed to fetch", detail: String(err) }, { status: 500 });
  }
}
