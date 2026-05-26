"use client";
import Link from "next/link";
import { useState } from "react";

// Public marketing nav — distinct from the dashboard's AppShell. Sticky
// header with logo on the left, links in the middle, and a primary CTA
// on the right. Visual direction borrowed from killermerch.com — clean
// white background, hairline border, generous spacing.

const NAV_LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "Services", href: "/services" },
  { label: "Start a Project", href: "/start" },
  { label: "Shop ↗", href: "https://shop.housepartydistro.com", external: true },
];

export function MarketingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 100,
      background: "#fff", borderBottom: "1px solid #e0e0e4",
    }}>
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 32px",
      }}>
        <Link href="/" style={{
          fontSize: 18, fontWeight: 900, letterSpacing: "-0.02em",
          color: "#1a1a1a", textDecoration: "none",
        }}>
          house party distro
        </Link>

        {/* Desktop nav */}
        <nav className="hpd-nav-desktop" style={{
          display: "flex", gap: 32,
          fontSize: 13, fontWeight: 500,
        }}>
          {NAV_LINKS.map(link => (
            link.external ? (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                style={{ color: "#6b6b78", textDecoration: "none" }}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href}
                style={{ color: "#6b6b78", textDecoration: "none" }}>
                {link.label}
              </Link>
            )
          ))}
        </nav>

        {/* Right cluster — login icon + CTA + (mobile) hamburger.
            Wrapped so the parent's justify-content: space-between
            treats them as a single right-aligned group. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Client login icon — familiar "person silhouette" treatment,
              links to the email-magic-link entry page at /client-portal.
              Visible on every breakpoint so it's always one tap away. */}
          <Link
            href="/client-portal"
            title="Client login"
            aria-label="Client login"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 38, height: 38, borderRadius: 8,
              color: "#6b6b78", textDecoration: "none",
              transition: "color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#1a1a1a"; e.currentTarget.style.background = "#f3f3f5"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#6b6b78"; e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </Link>

          <Link href="/start" className="hpd-nav-cta" style={{
            background: "#1a1a1a", color: "#fff",
            padding: "10px 22px", borderRadius: 8,
            fontSize: 13, fontWeight: 700,
            textDecoration: "none",
          }}>
            Start a Project
          </Link>

          {/* Mobile hamburger */}
          <button
            className="hpd-nav-burger"
            onClick={() => setMobileOpen(o => !o)}
            aria-label="Toggle menu"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              padding: 4, color: "#1a1a1a",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? (
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" />
                  <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
                  <line x1="3" y1="18" x2="21" y2="18" strokeLinecap="round" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <nav style={{
          borderTop: "1px solid #e0e0e4",
          padding: "12px 32px 20px",
          display: "flex", flexDirection: "column", gap: 0,
        }}>
          {NAV_LINKS.map(link => (
            link.external ? (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                onClick={() => setMobileOpen(false)}
                style={{
                  padding: "14px 0", color: "#1a1a1a", textDecoration: "none",
                  fontSize: 15, fontWeight: 600, borderBottom: "1px solid #f0f0f2",
                }}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href}
                onClick={() => setMobileOpen(false)}
                style={{
                  padding: "14px 0", color: "#1a1a1a", textDecoration: "none",
                  fontSize: 15, fontWeight: 600, borderBottom: "1px solid #f0f0f2",
                }}>
                {link.label}
              </Link>
            )
          ))}
        </nav>
      )}

      {/* Responsive show/hide via class-based media query.
          Inline styles can't do media queries so this <style> handles
          the desktop ↔ mobile swap. */}
      <style>{`
        @media (max-width: 768px) {
          .hpd-nav-desktop { display: none !important; }
          .hpd-nav-cta { display: none !important; }
        }
        @media (min-width: 769px) {
          .hpd-nav-burger { display: none !important; }
        }
      `}</style>
    </header>
  );
}
