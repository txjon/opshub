import { MarketingNav } from "./_components/MarketingNav";
import { MarketingFooter } from "./_components/MarketingFooter";

// Marketing layout — public-facing chrome distinct from /dashboard's
// AppShell. White background, no auth gates (middleware allowlist
// includes /, /services, /work, /start, /client-portal).
//
// Wraps every page in app/(marketing)/. The route group parens mean
// "(marketing)" doesn't show up in URLs — these pages live at /, /services,
// /work, etc.

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
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
    </div>
  );
}
