import Link from "next/link";
import { HERO_IMAGE } from "./_placeholder-images";

// Full-viewport hero, Killer Merch style — centered uppercase headline
// dominating the frame, sparse supporting copy, no loud CTA buttons.
// Photographic background with dark overlay for text legibility.

export function Hero() {
  return (
    <section style={{
      position: "relative",
      minHeight: "100vh",  // nav is now fixed-overlay, hero fills full viewport
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      textAlign: "center",
    }}>
      {/* Background photo. Stock placeholder from Unsplash; swap to
          /marketing/hero.jpg when the real shoot lands. */}
      <img
        src={HERO_IMAGE}
        alt=""
        aria-hidden
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%", objectFit: "cover",
        }}
      />
      {/* Dark overlay for text legibility */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.7) 100%)",
      }} />

      {/* Centered content */}
      <div className="hpd-hero-content" style={{
        position: "relative", zIndex: 1,
        maxWidth: 1100, padding: "0 32px",
        marginTop: 30,
      }}>
        <h1 style={{
          fontSize: "clamp(36px, 6.5vw, 84px)",
          fontWeight: 900,
          lineHeight: 1.02,
          letterSpacing: "-0.02em",
          color: "#fff",
          textTransform: "uppercase",
          marginBottom: 28,
        }}>
          Custom apparel from<br />
          concept to delivery.
        </h1>
        <p style={{
          fontSize: "clamp(16px, 1.5vw, 19px)",
          lineHeight: 1.55,
          color: "rgba(255,255,255,0.85)",
          maxWidth: 760, margin: "0 auto 32px",
        }}>
          House Party Distro is a single-source production house for premium branded apparel and accessories. Design, manufacturing, and distribution under one roof.
        </p>
        <Link href="/start" style={{
          display: "inline-block",
          color: "#fff",
          fontSize: 13, fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          textDecoration: "none",
          borderBottom: "2px solid #fff",
          paddingBottom: 4,
        }}>
          Start a Project
        </Link>
      </div>

      {/* Mobile-only: hamburger collapses the left-side nav stack, so
          we don't need to push the hero content down to balance it. */}
      <style>{`
        @media (max-width: 768px) {
          .hpd-hero-content { margin-top: -40px !important; }
        }
      `}</style>
    </section>
  );
}
