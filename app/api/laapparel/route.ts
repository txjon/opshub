import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const LAA_ID = process.env.LAA_API_ID || "";
const LAA_PW = process.env.LAA_API_PASSWORD || "";
const PRODUCT_URL = "https://promo.losangelesapparel.net/promoStandards/productData.php";
const INVENTORY_URL = "https://promo.losangelesapparel.net/promoStandards/inventory.php";
const PRICING_URL = "https://promo.losangelesapparel.net/promoStandards/productPricingAndConfig.php";

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function getCached(key: string): Promise<{ data: any; fresh: boolean } | null> {
  const { data } = await admin().from("api_cache").select("data, updated_at").eq("key", key).single();
  if (!data) return null;
  return { data: data.data, fresh: Date.now() - new Date(data.updated_at).getTime() < CACHE_TTL };
}
async function setCache(key: string, value: any) {
  await admin().from("api_cache").upsert({ key, data: value, updated_at: new Date().toISOString() });
}

// Simple XML tag extractor (no dependencies)
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<(?:[^:]+:)?${tag}[^>]*>([^<]*)<\\/(?:[^:]+:)?${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}
function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[^:]+:)?${tag}[^>]*>([^<]*)<\\/(?:[^:]+:)?${tag}>`, "gi");
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}
function extractBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[^:]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:]+:)?${tag}>`, "gi");
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

async function soapCall(url: string, action: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action },
    body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">${body}</soapenv:Envelope>`,
  });
  return res.text();
}

// Get all sellable product IDs
async function fetchProductList(): Promise<string[]> {
  const xml = await soapCall(PRODUCT_URL, "getProductSellable",
    `<soapenv:Body><ns:GetProductSellableRequest xmlns:ns="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/" xmlns:shar="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/"><shar:wsVersion>2.0.0</shar:wsVersion><shar:id>${LAA_ID}</shar:id><shar:password>${LAA_PW}</shar:password><shar:isSellable>true</shar:isSellable></ns:GetProductSellableRequest></soapenv:Body>`
  );
  return extractAllTags(xml, "productId");
}

// Get product details (name, description, categories, parts with colors/sizes/prices)
async function fetchProduct(productId: string) {
  const xml = await soapCall(PRODUCT_URL, "getProduct",
    `<soapenv:Body><ns:GetProductRequest xmlns:ns="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/" xmlns:shar="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/"><shar:wsVersion>2.0.0</shar:wsVersion><shar:id>${LAA_ID}</shar:id><shar:password>${LAA_PW}</shar:password><shar:localizationCountry>US</shar:localizationCountry><shar:localizationLanguage>en</shar:localizationLanguage><shar:productId>${productId}</shar:productId></ns:GetProductRequest></soapenv:Body>`
  );

  const name = extractTag(xml, "productName");
  const description = extractTag(xml, "description");

  // Extract categories from marketing points
  const marketingBlocks = extractBlocks(xml, "ProductMarketingPoint");
  const categories = marketingBlocks.map(b => extractTag(b, "pointType")).filter(Boolean);

  // Extract product-level pricing (quantity tiers — use highest tier = best case price)
  const priceGroupBlocks = extractBlocks(xml, "ProductPriceGroup");
  let productPrice = 0;
  let bestMinQty = 0;
  for (const pg of priceGroupBlocks) {
    const priceEntries = extractBlocks(pg, "ProductPrice");
    for (const pe of priceEntries) {
      const p = parseFloat(extractTag(pe, "price"));
      const minQty = parseInt(extractTag(pe, "quantityMin")) || 0;
      if (p > 0 && (minQty > bestMinQty || productPrice === 0)) {
        productPrice = p;
        bestMinQty = minQty;
      }
    }
  }

  // Extract parts (each part = one color + size combo)
  const partBlocks = extractBlocks(xml, "ProductPart");
  const parts: { partId: string; color: string; size: string; price: number }[] = [];
  for (const block of partBlocks) {
    const partId = extractTag(block, "partId");
    const color = extractTag(block, "colorName");
    const size = extractTag(block, "labelSize");
    if (partId && (color || size)) {
      parts.push({ partId, color, size, price: productPrice });
    }
  }

  return { productId, name, description, categories, parts };
}

// Get per-part pricing from PricingAndConfiguration endpoint
async function fetchPartPricing(productId: string): Promise<Record<string, number>> {
  const xml = await soapCall(PRICING_URL, "getConfigurationAndPricing",
    `<soapenv:Body><ns:GetConfigurationAndPricingRequest xmlns:ns="http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/" xmlns:shar="http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/"><shar:wsVersion>1.0.0</shar:wsVersion><shar:id>${LAA_ID}</shar:id><shar:password>${LAA_PW}</shar:password><shar:productId>${productId}</shar:productId><shar:currency>USD</shar:currency><shar:fobId>LA</shar:fobId><shar:priceType>Net</shar:priceType><shar:configurationType>Blank</shar:configurationType></ns:GetConfigurationAndPricingRequest></soapenv:Body>`
  );
  const partBlocks = extractBlocks(xml, "Part");
  const prices: Record<string, number> = {};
  for (const block of partBlocks) {
    const partId = extractTag(block, "partId");
    // Get the best (highest qty tier) price for this part
    const priceEntries = extractBlocks(block, "PartPrice");
    let bestPrice = 0;
    let bestQty = 0;
    for (const pe of priceEntries) {
      const p = parseFloat(extractTag(pe, "price"));
      const minQty = parseInt(extractTag(pe, "minQuantity")) || 0;
      if (p > 0 && (minQty > bestQty || bestPrice === 0)) { bestPrice = p; bestQty = minQty; }
    }
    if (partId && bestPrice > 0) prices[partId] = bestPrice;
  }
  return prices;
}

// Get inventory for a product
async function fetchInventory(productId: string): Promise<Record<string, number>> {
  const xml = await soapCall(INVENTORY_URL, "getInventoryLevels",
    `<soapenv:Body><ns:Request xmlns:ns="http://www.promostandards.org/WSDL/InventoryService/1.0.0/"><ns:wsVersion>1.2.1</ns:wsVersion><ns:id>${LAA_ID}</ns:id><ns:password>${LAA_PW}</ns:password><ns:productID>${productId}</ns:productID><ns:productIDtype>Supplier</ns:productIDtype></ns:Request></soapenv:Body>`
  );
  const blocks = extractBlocks(xml, "ProductVariationInventory");
  const inv: Record<string, number> = {};
  for (const b of blocks) {
    const partId = extractTag(b, "partID");
    const qty = parseInt(extractTag(b, "quantityAvailable")) || 0;
    if (partId) inv[partId] = qty;
  }
  return inv;
}

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");

  if (!LAA_ID || !LAA_PW) {
    return NextResponse.json({ error: "LA Apparel API credentials not configured" }, { status: 500 });
  }

  // Product list — returns style codes with names and categories
  if (endpoint === "products") {
    try {
      // Check DB cache first
      const cached = await getCached("laapparel_products");
      if (cached) {
        // Return immediately, refresh in background if stale
        if (!cached.fresh) {
          fetchProductList().then(async ids => {
            let dbProducts: Record<string, any> = {};
            const { data: catalog } = await admin().from("la_apparel_catalog").select("style_code, description, category").order("style_code");
            if (catalog) for (const row of catalog) dbProducts[row.style_code] = { name: row.description, category: row.category };
            const products = ids.map(id => ({ styleCode: id, name: dbProducts[id]?.name || "", category: dbProducts[id]?.category || "", colors: [] }));
            await setCache("laapparel_products", products);
          }).catch(() => {});
        }
        return NextResponse.json(cached.data);
      }

      // Cold start — fetch from API with timeout protection
      let dbProducts: Record<string, any> = {};
      try {
        const { data: catalog } = await admin().from("la_apparel_catalog").select("style_code, description, category").order("style_code");
        if (catalog) for (const row of catalog) dbProducts[row.style_code] = { name: row.description, category: row.category };
      } catch {}

      // If we have catalog data, use it immediately
      if (Object.keys(dbProducts).length > 0) {
        const products = Object.entries(dbProducts).map(([id, info]) => ({
          styleCode: id, name: info.name || "", category: info.category || "", colors: [],
        }));
        await setCache("laapparel_products", products);
        // Background: fetch from API to get any new products
        fetchProductList().then(async ids => {
          const merged = ids.map(id => ({ styleCode: id, name: dbProducts[id]?.name || "", category: dbProducts[id]?.category || "", colors: [] }));
          await setCache("laapparel_products", merged);
        }).catch(() => {});
        return NextResponse.json(products);
      }

      // No catalog data — fetch from API with race against timeout
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("API timeout")), 25000));
      const productIds = await Promise.race([fetchProductList(), timeoutPromise]) as string[];
      const products = productIds.map(id => ({
        styleCode: id, name: "", category: "", colors: [],
      }));
      await setCache("laapparel_products", products);
      return NextResponse.json(products);
    } catch (e: any) {
      // Fallback to stale cache
      const stale = await getCached("laapparel_products");
      if (stale) return NextResponse.json(stale.data);
      return NextResponse.json({ error: e.message || "Failed to fetch products" }, { status: 500 });
    }
  }

  // Variants for a specific product — colors, sizes, prices, inventory
  if (endpoint === "variants") {
    const styleCode = searchParams.get("styleCode");
    if (!styleCode) return NextResponse.json({ error: "Missing styleCode" }, { status: 400 });

    // Check cache first
    const variantCacheKey = `laapparel_variants_${styleCode}`;
    const cachedVariants = await getCached(variantCacheKey);
    if (cachedVariants) {
      if (!cachedVariants.fresh) {
        // Refresh in background
        Promise.all([fetchProduct(styleCode), fetchInventory(styleCode), fetchPartPricing(styleCode)])
          .then(async ([product, inventory, partPrices]) => {
            const variants = product.parts.map((p: any) => ({ partId: p.partId, colour: p.color, sizeCode: p.size, price: partPrices[p.partId] || p.price || 0, sku: p.partId, stock: inventory[p.partId] || 0 }));
            await setCache(variantCacheKey, variants);
          }).catch(() => {});
      }
      return NextResponse.json(cachedVariants.data);
    }

    try {
      const [product, inventory, partPrices] = await Promise.all([
        fetchProduct(styleCode),
        fetchInventory(styleCode),
        fetchPartPricing(styleCode),
      ]);

      // Build variant rows: each unique color+size combo with per-part pricing
      const variants = product.parts.map(p => ({
        partId: p.partId,
        colour: p.color,
        sizeCode: p.size,
        price: partPrices[p.partId] || p.price || 0,
        sku: p.partId,
        stock: inventory[p.partId] || 0,
      }));

      await setCache(variantCacheKey, variants);
      return NextResponse.json(variants);
    } catch (e: any) {
      const staleVariants = await getCached(variantCacheKey);
      if (staleVariants) return NextResponse.json(staleVariants.data);
      return NextResponse.json({ error: e.message || "Failed to fetch variants" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
}
