import { MarketingNav } from "./_components/MarketingNav";
import { MarketingFooter } from "./_components/MarketingFooter";
import { CartDrawer } from "./_components/CartDrawer";
import { CartProvider } from "@/lib/cart-context";

// Marketing layout — public-facing chrome distinct from /dashboard's
// AppShell. White background, no auth gates (middleware allowlist
// includes /, /services, /work, /start, /client-portal, /shop).
//
// Wraps every page in app/(marketing)/. The route group parens mean
// "(marketing)" doesn't show up in URLs — these pages live at /, /services,
// /work, etc.
//
// CartProvider wraps everything so the cart drawer can be opened from
// any page (e.g., the nav's cart icon, or post-add-to-bag on /shop).

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div style={{
        background: "#fff",
        color: "#1a1a1a",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
      }}>
        <MarketingNav />
        <main style={{ flex: 1, background: "#fff" }}>{children}</main>
        <MarketingFooter />
        <CartDrawer />
      </div>
    </CartProvider>
  );
}
