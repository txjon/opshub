"use client";
import { useMemo, useState } from "react";
import { Product, ProductVariant, formatMoney, parseProductTitle } from "@/lib/shopify";
import { useCart } from "@/lib/cart-context";

// Product detail client component. Owns the image gallery, variant
// selection, quantity stepper, and add-to-cart action. The cart
// itself is managed by a separate <CartProvider> + slide-out drawer
// that lives at the app shell level (added in a later step).

export function ProductDetailClient({ product }: { product: Product }) {
  // Pick the first available variant by default; if all are sold out,
  // fall back to the first one.
  const initialVariant =
    product.variants.find(v => v.availableForSale) || product.variants[0] || null;
  const [variant, setVariant] = useState<ProductVariant | null>(initialVariant);
  const [activeImage, setActiveImage] = useState<number>(0);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const { name: cleanName, tags } = parseProductTitle(product.title);
  const { addItem } = useCart();

  // Map of option-name → option-value for the currently selected variant.
  const selectedOptions = useMemo(() => {
    const m: Record<string, string> = {};
    if (variant) variant.selectedOptions.forEach(o => { m[o.name] = o.value; });
    return m;
  }, [variant]);

  function pickOption(optionName: string, value: string) {
    const next = { ...selectedOptions, [optionName]: value };
    // Find variant matching the new combination
    const found = product.variants.find(v =>
      v.selectedOptions.every(o => next[o.name] === o.value)
    );
    if (found) setVariant(found);
  }

  async function handleAddToCart() {
    if (!variant) return;
    setAdding(true);
    setAddError(null);
    try {
      await addItem(variant.id, qty);
    } catch (e: any) {
      setAddError(e?.message || "Could not add to cart");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 32px 120px" }}>
      <div className="hpd-product-grid" style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 56,
        alignItems: "flex-start",
      }}>
        {/* ── Image gallery ── */}
        <div>
          <div style={{
            aspectRatio: "1 / 1",
            background: "#fff",
            border: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
            padding: 24,
          }}>
            {product.images[activeImage] && (
              <img
                src={product.images[activeImage].url}
                alt={product.images[activeImage].altText || product.title}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              />
            )}
          </div>
          {product.images.length > 1 && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
              gap: 8,
              marginTop: 12,
            }}>
              {product.images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveImage(i)}
                  style={{
                    aspectRatio: "1 / 1",
                    background: "#fff",
                    border: i === activeImage ? "1px solid #fff" : "1px solid rgba(255,255,255,0.06)",
                    cursor: "pointer",
                    padding: 6,
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={img.url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Detail ── */}
        <div>
          {tags.length > 0 && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: "4px 14px",
              marginBottom: 10,
            }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 11, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.16em",
                  color: tagColor(tag),
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          <h1 style={{
            fontSize: "clamp(28px, 3.8vw, 44px)",
            fontWeight: 900,
            letterSpacing: "-0.02em",
            textTransform: "uppercase",
            lineHeight: 1.1,
            marginBottom: 12,
          }}>
            {cleanName}
          </h1>
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            color: "rgba(255,255,255,0.85)",
            marginBottom: 28,
          }}>
            {variant ? formatMoney(variant.price) : "—"}
            {variant?.compareAtPrice && (
              <span style={{
                marginLeft: 12,
                color: "rgba(255,255,255,0.5)",
                textDecoration: "line-through",
                fontWeight: 500,
              }}>
                {formatMoney(variant.compareAtPrice)}
              </span>
            )}
          </div>

          {/* Variant pickers */}
          {product.options.filter(o => o.values.length > 1).map(option => (
            <div key={option.id} style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 10, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.14em",
                color: "rgba(255,255,255,0.5)", marginBottom: 10,
              }}>
                {option.name}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {option.values.map(value => {
                  const isActive = selectedOptions[option.name] === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => pickOption(option.name, value)}
                      style={{
                        padding: "10px 18px",
                        minWidth: 64,
                        background: isActive ? "#fff" : "transparent",
                        color: isActive ? "#0a0a0c" : "#fff",
                        border: isActive ? "1px solid #fff" : "1px solid rgba(255,255,255,0.2)",
                        fontSize: 13, fontWeight: 700,
                        letterSpacing: "0.04em",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >{value}</button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Quantity + add to cart */}
          <div style={{ display: "flex", gap: 12, alignItems: "stretch", marginTop: 28, marginBottom: 32 }}>
            <div style={{
              display: "flex", alignItems: "center",
              border: "1px solid rgba(255,255,255,0.2)",
            }}>
              <button
                type="button"
                onClick={() => setQty(q => Math.max(1, q - 1))}
                style={qtyBtnStyle}
                aria-label="Decrease quantity"
              >−</button>
              <span style={{ minWidth: 40, textAlign: "center", fontWeight: 700, fontSize: 14 }}>{qty}</span>
              <button
                type="button"
                onClick={() => setQty(q => q + 1)}
                style={qtyBtnStyle}
                aria-label="Increase quantity"
              >+</button>
            </div>
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!variant?.availableForSale || adding}
              style={{
                flex: 1,
                background: variant?.availableForSale ? "#fff" : "rgba(255,255,255,0.2)",
                color: variant?.availableForSale ? "#0a0a0c" : "rgba(255,255,255,0.5)",
                border: "none",
                padding: "14px 28px",
                fontSize: 13, fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                cursor: variant?.availableForSale && !adding ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                opacity: adding ? 0.6 : 1,
              }}
            >
              {adding ? "Adding..." : variant?.availableForSale ? "Add to Bag" : "Sold Out"}
            </button>
          </div>
          {addError && (
            <div style={{
              fontSize: 12, color: "#ff9aa0",
              marginTop: -16, marginBottom: 24,
            }}>{addError}</div>
          )}

          {/* Description */}
          {product.descriptionHtml && (
            <div
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
              style={{
                fontSize: 14, lineHeight: 1.7,
                color: "rgba(255,255,255,0.72)",
              }}
            />
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .hpd-product-grid {
            grid-template-columns: 1fr !important;
            gap: 32px !important;
          }
        }
      `}</style>
    </div>
  );
}

const qtyBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#fff",
  border: "none",
  padding: "12px 16px",
  fontSize: 16,
  cursor: "pointer",
  fontFamily: "inherit",
};

function tagColor(tag: string): string {
  const t = tag.toUpperCase();
  if (t === "IN STOCK") return "#73B6C9";
  if (t === "PRE ORDER" || t === "PRE-ORDER") return "#E0A26A";
  if (t === "SOLD OUT") return "rgba(255,255,255,0.4)";
  return "rgba(255,255,255,0.65)";
}
