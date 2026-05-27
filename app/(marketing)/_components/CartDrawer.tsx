"use client";
import Link from "next/link";
import { useCart } from "@/lib/cart-context";
import { formatMoney, parseProductTitle } from "@/lib/shopify";

// Slide-out cart drawer. Right-side panel, dark theme, line items
// with qty stepper + remove, totals at the bottom, "Checkout" button
// that redirects to Shopify's hosted secure checkout.

export function CartDrawer() {
  const { cart, isOpen, loading, close, updateLine, removeLine } = useCart();

  if (!isOpen) return null;

  const isEmpty = !cart || cart.lines.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Shopping cart"
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 250,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0,
          width: "min(440px, 100vw)",
          background: "#0a0a0c",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          display: "flex", flexDirection: "column",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.16em",
            color: "rgba(255,255,255,0.5)",
          }}>
            Cart {cart && cart.totalQuantity > 0 ? `(${cart.totalQuantity})` : ""}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close cart"
            style={{
              background: "transparent", border: "none", color: "#fff",
              cursor: "pointer", padding: 4, fontSize: 22, lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {isEmpty && (
            <div style={{
              padding: "60px 0", textAlign: "center",
              color: "rgba(255,255,255,0.55)", fontSize: 14,
            }}>
              Your cart is empty.
              <div style={{ marginTop: 18 }}>
                <Link href="/shop" onClick={close} style={{
                  color: "#fff", textDecoration: "underline",
                  fontSize: 12, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.12em",
                }}>
                  Continue shopping
                </Link>
              </div>
            </div>
          )}

          {!isEmpty && cart!.lines.map(line => {
            const { name: cleanName } = parseProductTitle(line.merchandise.product.title);
            const variantTitle = line.merchandise.title !== "Default Title"
              ? line.merchandise.selectedOptions.map(o => o.value).join(" · ")
              : "";
            return (
              <div key={line.id} style={{
                display: "grid",
                gridTemplateColumns: "72px 1fr",
                gap: 14,
                paddingBottom: 16,
                marginBottom: 16,
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}>
                {/* Thumb */}
                <Link href={`/shop/${line.merchandise.product.handle}`} onClick={close} style={{
                  background: "#fff",
                  aspectRatio: "1 / 1",
                  display: "block",
                  overflow: "hidden",
                  padding: 6,
                }}>
                  {line.merchandise.product.featuredImage && (
                    <img
                      src={line.merchandise.product.featuredImage.url}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    />
                  )}
                </Link>
                {/* Info */}
                <div>
                  <Link href={`/shop/${line.merchandise.product.handle}`} onClick={close} style={{
                    color: "#fff", textDecoration: "none",
                    fontSize: 13, fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.02em",
                    lineHeight: 1.3, display: "block", marginBottom: 4,
                  }}>
                    {cleanName}
                  </Link>
                  {variantTitle && (
                    <div style={{
                      fontSize: 11, color: "rgba(255,255,255,0.55)",
                      marginBottom: 8,
                    }}>{variantTitle}</div>
                  )}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 10,
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center",
                      border: "1px solid rgba(255,255,255,0.2)",
                    }}>
                      <button
                        type="button"
                        onClick={() => line.quantity > 1
                          ? updateLine(line.id, line.quantity - 1)
                          : removeLine(line.id)
                        }
                        disabled={loading}
                        aria-label="Decrease quantity"
                        style={qtyBtn}
                      >−</button>
                      <span style={{
                        minWidth: 28, textAlign: "center",
                        fontSize: 13, fontWeight: 700, color: "#fff",
                      }}>{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateLine(line.id, line.quantity + 1)}
                        disabled={loading}
                        aria-label="Increase quantity"
                        style={qtyBtn}
                      >+</button>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                      {formatMoney({
                        amount: (parseFloat(line.merchandise.price.amount) * line.quantity).toFixed(2),
                        currencyCode: line.merchandise.price.currencyCode,
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    disabled={loading}
                    style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      color: "rgba(255,255,255,0.5)",
                      fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.12em",
                      padding: "8px 0 0", fontFamily: "inherit",
                    }}
                  >Remove</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {!isEmpty && cart && (
          <div style={{
            padding: "20px 24px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            background: "#0a0a0c",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              fontSize: 14, fontWeight: 700, color: "#fff",
              marginBottom: 4,
            }}>
              <span>Subtotal</span>
              <span>{formatMoney(cart.cost.subtotalAmount)}</span>
            </div>
            <div style={{
              fontSize: 11, color: "rgba(255,255,255,0.5)",
              marginBottom: 16, lineHeight: 1.5,
            }}>
              Shipping &amp; taxes calculated at checkout.
            </div>
            <a
              href={cart.checkoutUrl}
              style={{
                display: "block", textAlign: "center",
                background: "#fff", color: "#0a0a0c",
                padding: "16px 24px",
                fontSize: 13, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.14em",
                textDecoration: "none",
              }}
            >
              Checkout
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const qtyBtn: React.CSSProperties = {
  background: "transparent", color: "#fff", border: "none",
  padding: "6px 10px", fontSize: 14, cursor: "pointer",
  fontFamily: "inherit",
};
