import { NextRequest, NextResponse } from "next/server";

const LAA_ID = process.env.LAA_API_ID || "";
const LAA_PW = process.env.LAA_API_PASSWORD || "";
const PRODUCT_URL = "https://promo.losangelesapparel.net/promoStandards/productData.php";
const INVENTORY_URL = "https://promo.losangelesapparel.net/promoStandards/inventory.php";
const PRICING_URL = "https://promo.losangelesapparel.net/promoStandards/productPricingAndConfig.php";

// In-memory cache for product list (refreshes every 30 min)
let productCache: { data: any[]; ts: number } | null = null;
const CACHE_TTL = 30 * 60 * 1000;

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");

  if (!LAA_ID || !LAA_PW) {
    return NextResponse.json({ error: "LA Apparel API credentials not configured" }, { status: 500 });
  }

  // Product list — returns style codes with names and categories
  if (endpoint === "products") {
    try {
      if (productCache && Date.now() - productCache.ts < CACHE_TTL) {
        return NextResponse.json(productCache.data);
      }

      // Get product IDs (fast — single API call)
      const productIds = await fetchProductList();

      // Try to enrich from Supabase cache first
      let dbProducts: Record<string, any> = {};
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { data: catalog } = await supabase.from("la_apparel_catalog").select("style_code, description, category").order("style_code");
        if (catalog) {
          for (const row of catalog) {
            if (!dbProducts[row.style_code]) dbProducts[row.style_code] = { name: row.description, category: row.category };
          }
        }
      } catch {}

      // Build product list — use DB names if available, otherwise just show style code
      const products = productIds.map(id => ({
        styleCode: id,
        name: dbProducts[id]?.name || "",
        category: dbProducts[id]?.category || "",
        colors: [],
      }));

      // Background: fetch details for products without names (first 20 only, don't block)
      const missing = products.filter(p => !p.name).slice(0, 20);
      if (missing.length > 0) {
        Promise.all(missing.map(p => fetchProduct(p.styleCode).then(r => {
          const idx = products.findIndex(x => x.styleCode === p.styleCode);
          if (idx >= 0 && r?.name) {
            products[idx].name = r.name;
            products[idx].category = r.categories?.find((c: string) => ["Tees","Hoodies","Crewnecks","Jackets","Long Sleeve","Hats","Pants","Shorts"].includes(c)) || r.categories?.[0] || "";
          }
        }).catch(() => {}))).then(() => {
          productCache = { data: products, ts: Date.now() };
        });
      }

      productCache = { data: products, ts: Date.now() };
      return NextResponse.json(products);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Failed to fetch products" }, { status: 500 });
    }
  }

  // Variants for a specific product — colors, sizes, prices, inventory
  if (endpoint === "variants") {
    const styleCode = searchParams.get("styleCode");
    if (!styleCode) return NextResponse.json({ error: "Missing styleCode" }, { status: 400 });

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

      return NextResponse.json(variants);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Failed to fetch variants" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
}
