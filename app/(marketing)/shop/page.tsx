import Link from "next/link";
import { getAllProducts, formatMoney, parseProductTitle, Product } from "@/lib/shopify";

// /shop — collection grid. Lists every product from Shopify's
// Storefront API, sorted by most recently updated. Cached for 60s
// (matches lib/shopify default). Server component; renders static
// at build with revalidation, no client-side fetch loop needed.

export const metadata = {
  title: "Shop | House Party Distro",
  description: "Custom apparel, hats, and accessories from House Party Distro.",
};

export default async function ShopPage() {
  let products: Product[] = [];
  let error: string | null = null;
  try {
    products = await getAllProducts(60);
  } catch (e: any) {
    error = e?.message || "Could not load products";
  }

  return (
    <>
      {/* Hero band — matches the page-hero pattern on /services etc. */}
      <section style={{
        position: "relative",
        background: "#0a0a0c",
        color: "#fff",
        padding: "144px 32px 56px",
        textAlign: "center",
      }}>
        <h1 style={{
          fontSize: "clamp(32px, 5.5vw, 60px)",
          fontWeight: 900,
          letterSpacing: "-0.02em",
          textTransform: "uppercase",
          lineHeight: 1.05,
        }}>
          Shop.
        </h1>
      </section>

      <section style={{ background: "#0a0a0c", color: "#fff", padding: "20px 32px 120px" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          {error && (
            <div style={{
              background: "#2a1a1a", border: "1px solid #5a2a2a",
              color: "#ff9aa0", padding: 16, borderRadius: 8,
              fontSize: 13, marginBottom: 24,
            }}>
              {error} — confirm NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN and NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN are set.
            </div>
          )}
          {!error && products.length === 0 && (
            <div style={{ color: "rgba(255,255,255,0.5)", textAlign: "center", padding: "60px 0" }}>
              No products yet.
            </div>
          )}
          {products.length > 0 && (
            <div className="hpd-shop-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "32px 24px",
            }}>
              {products.map(p => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
        <style>{`
          @media (max-width: 1100px) {
            .hpd-shop-grid { grid-template-columns: repeat(3, 1fr) !important; }
          }
          @media (max-width: 768px) {
            .hpd-shop-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 24px 16px !important; }
          }
          @media (max-width: 480px) {
            .hpd-shop-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </section>
    </>
  );
}

function ProductCard({ product }: { product: Product }) {
  const price = formatMoney(product.priceRange.minVariantPrice);
  const hasRange = product.priceRange.minVariantPrice.amount !== product.priceRange.maxVariantPrice.amount;
  const { name, tags } = parseProductTitle(product.title);
  return (
    <Link
      href={`/shop/${product.handle}`}
      style={{
        display: "block",
        background: "#141417",
        border: "1px solid rgba(255,255,255,0.06)",
        textDecoration: "none",
        color: "#fff",
        overflow: "hidden",
      }}
    >
      <div style={{
        aspectRatio: "1 / 1",
        background: "#fff",
        overflow: "hidden",
        padding: 16,
      }}>
        {product.featuredImage && (
          <img
            src={product.featuredImage.url}
            alt={product.featuredImage.altText || name}
            style={{
              width: "100%", height: "100%", objectFit: "contain", display: "block",
            }}
          />
        )}
      </div>
      <div style={{ padding: "16px 18px 18px" }}>
        {tags.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: "4px 12px",
            marginBottom: 8,
          }}>
            {tags.map(tag => (
              <span key={tag} style={{
                fontSize: 10, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.14em",
                color: tagColor(tag),
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}
        <div style={{
          fontSize: 14, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.01em",
          lineHeight: 1.25, marginBottom: 6,
        }}>
          {name}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: "rgba(255,255,255,0.78)",
        }}>
          {hasRange ? `From ${price}` : price}
        </div>
      </div>
    </Link>
  );
}

function tagColor(tag: string): string {
  const t = tag.toUpperCase();
  if (t === "IN STOCK") return "#73B6C9";                      // teal — available
  if (t === "PRE ORDER" || t === "PRE-ORDER") return "#E0A26A"; // amber — coming
  if (t === "SOLD OUT") return "rgba(255,255,255,0.4)";        // muted
  return "rgba(255,255,255,0.65)";                              // generic neutral
}
