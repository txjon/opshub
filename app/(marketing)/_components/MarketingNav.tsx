"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

// Public marketing nav, Killer Merch style.
//
// Two visual modes driven by scroll position:
//   - Top (scrollY < THRESHOLD): transparent over the hero, large
//     centered logo, left-aligned nav links, right-aligned icons.
//   - Scrolled (scrollY >= THRESHOLD): solid dark bar, smaller logo,
//     hamburger replaces the inline links.
//
// Header is position: fixed so the hero sits underneath at top:0.
// Hero / PageHero have been set to 100vh / paddingTop accordingly.

const NAV_LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "Services", href: "/services" },
  { label: "Blog", href: "https://thehouse.blog/", external: true },
  { label: "Start a Project", href: "/start" },
  { label: "Shop", href: "https://shop.housepartydistro.com", external: true },
];

const SCROLL_THRESHOLD = 60;

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY >= SCROLL_THRESHOLD);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
          background: scrolled ? "rgba(10,10,12,0.95)" : "transparent",
          backdropFilter: scrolled ? "blur(8px)" : "none",
          WebkitBackdropFilter: scrolled ? "blur(8px)" : "none",
          borderBottom: scrolled ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
          transition: "background 0.25s ease, border-color 0.25s ease, height 0.25s ease",
          height: scrolled ? 64 : 96,
        }}
      >
        <div style={{
          height: "100%",
          position: "relative",
          display: "flex", alignItems: "center",
          padding: "0 32px",
        }}>
          {/* LEFT — nav links at top, hamburger when scrolled */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 28 }}>
            {scrolled ? (
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  padding: 4, color: "#fff",
                  display: "flex", alignItems: "center",
                }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="7" x2="21" y2="7" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="17" x2="21" y2="17" />
                </svg>
              </button>
            ) : (
              <nav className="hpd-nav-links" style={{
                display: "flex", flexDirection: "column", gap: 8,
                fontSize: 12, fontWeight: 700,
                letterSpacing: "0.14em", textTransform: "uppercase",
                lineHeight: 1.4,
              }}>
                {NAV_LINKS.map(link => link.external ? (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                    style={{ color: "#fff", textDecoration: "none" }}>
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.href} href={link.href}
                    style={{ color: "#fff", textDecoration: "none" }}>
                    {link.label}
                  </Link>
                ))}
              </nav>
            )}
            {/* Mobile hamburger always shows on small screens regardless
                of scroll state — the inline links don't fit. */}
            <button
              type="button"
              className="hpd-nav-burger-mobile"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                padding: 4, color: "#fff",
                display: "none",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="7" x2="21" y2="7" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="17" x2="21" y2="17" />
              </svg>
            </button>
          </div>

          {/* CENTER — logo, absolutely centered regardless of side widths */}
          <Link
            href="/"
            style={{
              position: "absolute", left: "50%", top: "50%",
              transform: "translate(-50%, -50%)",
              color: "#fff", textDecoration: "none",
              fontWeight: 900,
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
              fontSize: scrolled ? 18 : 28,
              lineHeight: 1,
              transition: "font-size 0.25s ease",
              whiteSpace: "nowrap",
            }}
          >
            House Party Distro
          </Link>

          {/* RIGHT — login icon */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
            <Link
              href="/client-portal"
              title="Client login"
              aria-label="Client login"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 40, height: 40, borderRadius: 8,
                color: "#fff", textDecoration: "none",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </Link>
          </div>
        </div>

        <style>{`
          @media (max-width: 768px) {
            .hpd-nav-links { display: none !important; }
            .hpd-nav-burger-mobile { display: flex !important; }
          }
        `}</style>
      </header>

      {/* Side menu — opens on hamburger click in either mode */}
      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Main menu"
          onClick={() => setMenuOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "absolute", top: 0, left: 0, bottom: 0,
              width: "min(360px, 85vw)",
              background: "#0a0a0c",
              borderRight: "1px solid rgba(255,255,255,0.08)",
              padding: "28px 32px",
              display: "flex", flexDirection: "column", gap: 8,
              boxShadow: "0 0 60px rgba(0,0,0,0.5)",
            }}
          >
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                padding: 4, color: "#fff",
                alignSelf: "flex-end",
                marginBottom: 12,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            {NAV_LINKS.map(link => link.external ? (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                style={{
                  padding: "16px 0", color: "#fff", textDecoration: "none",
                  fontSize: 22, fontWeight: 900,
                  letterSpacing: "-0.01em",
                  textTransform: "uppercase",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href}
                onClick={() => setMenuOpen(false)}
                style={{
                  padding: "16px 0", color: "#fff", textDecoration: "none",
                  fontSize: 22, fontWeight: 900,
                  letterSpacing: "-0.01em",
                  textTransform: "uppercase",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}>
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
