"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { SERVICE_IMAGES } from "./_placeholder-images";

// Horizontal scroll-jacked service showcase. On desktop, the section
// pins to the viewport and translates a 7-tile track horizontally as
// the user continues scrolling vertically — same pattern as Apple
// product pages and Killer Merch's galleries. On mobile (or any
// touch device), falls back to native horizontal swipe with scroll
// snap, which feels right on a phone.
//
// Math: track is 7 × 60vw = 420vw wide. To move it from 0 → -320vw
// (so the last tile aligns with the right edge of the viewport), the
// parent section is tall enough to give the user 320vw of vertical
// scroll while the sticky child stays pinned — height: calc(100vh + 320vw).

const SERVICES: { label: string; href: string; image: string }[] = [
  { label: "Screen Printing",              href: "/services#screen",     image: SERVICE_IMAGES["Screen Printing"] },
  { label: "Embroidery",                   href: "/services#embroidery", image: SERVICE_IMAGES["Embroidery"] },
  { label: "Product Sourcing",             href: "/services#sourcing",   image: SERVICE_IMAGES["Product Sourcing"] },
  { label: "Design & Product Development", href: "/services#design",     image: SERVICE_IMAGES["Design"] },
  { label: "Warehousing",                  href: "/services#warehouse",  image: SERVICE_IMAGES["Warehousing"] },
  { label: "Fulfillment",                  href: "/services#fulfillment",image: SERVICE_IMAGES["Fulfillment"] },
  { label: "E-Commerce Management",        href: "/services#ecommerce",  image: SERVICE_IMAGES["E-Commerce"] },
];

export function ServiceGrid() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Run the scroll-jack for any device with a fine pointer (mouse or
    // trackpad) — width doesn't matter. Touch-only devices fall through
    // to native horizontal scroll via CSS. This means shrinking a
    // desktop window still gives you the pinned-scroll effect, which
    // matters because that's how everyone tests responsive design.
    const mq = window.matchMedia("(pointer: fine)");
    let raf = 0;
    let active = mq.matches;

    function update() {
      raf = 0;
      const section = sectionRef.current;
      const track = trackRef.current;
      if (!section || !track) return;

      if (!active) {
        track.style.transform = "";
        return;
      }

      const rect = section.getBoundingClientRect();
      const totalScroll = section.offsetHeight - window.innerHeight;
      // How far we've scrolled into this section (0 → totalScroll)
      const scrolled = Math.max(0, Math.min(totalScroll, -rect.top));
      const progress = totalScroll > 0 ? scrolled / totalScroll : 0;
      const maxX = track.scrollWidth - window.innerWidth;
      track.style.transform = `translate3d(${-progress * maxX}px, 0, 0)`;
    }
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(update);
    }
    function onMq(e: MediaQueryListEvent | MediaQueryList) {
      active = e.matches;
      // Snap back to start when switching to mobile mode.
      if (!active && trackRef.current) trackRef.current.style.transform = "";
      update();
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    mq.addEventListener("change", onMq);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mq.removeEventListener("change", onMq);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="hpd-svc-jack"
      style={{ position: "relative", background: "#0a0a0c" }}
    >
      {/* Sticky stage — pins to the viewport while the user scrolls
          through the parent's extra height. On mobile this becomes
          a normal in-flow box with native horizontal swipe. */}
      <div className="hpd-svc-stage">
        <div
          ref={trackRef}
          className="hpd-svc-track"
        >
          {SERVICES.map(svc => (
            <Link
              key={svc.label}
              href={svc.href}
              className="hpd-svc-tile"
            >
              <img src={svc.image} alt="" aria-hidden className="hpd-svc-img" />
              <div className="hpd-svc-overlay" />
              <div className="hpd-svc-label">
                <div className="hpd-svc-label-main">{svc.label}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        /* Mouse/trackpad: scroll-jacked. Pinned section, tall parent.
           Tiles fill the full pinned viewport — no padding above or below. */
        @media (pointer: fine) {
          .hpd-svc-jack {
            height: calc(100vh + 320vw);
          }
          .hpd-svc-stage {
            position: sticky;
            top: 0;
            height: 100vh;
            overflow: hidden;
            display: flex;
            align-items: stretch;
          }
          .hpd-svc-track {
            display: flex;
            gap: 0;
            height: 100%;
            will-change: transform;
          }
          .hpd-svc-tile {
            flex: 0 0 60vw;
            height: 100%;
            position: relative;
            overflow: hidden;
            display: block;
            text-decoration: none;
            color: inherit;
            border-right: 1px solid rgba(255,255,255,0.06);
          }
        }

        /* Touch devices: native horizontal scroll with snap. */
        @media (pointer: coarse) {
          .hpd-svc-stage {
            overflow-x: auto;
            overflow-y: hidden;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
          }
          .hpd-svc-track {
            display: flex;
            gap: 0;
            transform: none !important;
            will-change: auto;
          }
          .hpd-svc-tile {
            flex: 0 0 85vw;
            height: 70vh;
            scroll-snap-align: start;
            position: relative;
            overflow: hidden;
            display: block;
            text-decoration: none;
            color: inherit;
          }
        }

        /* Shared tile internals */
        .hpd-svc-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.6s ease;
        }
        .hpd-svc-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.35) 100%);
        }
        .hpd-svc-label {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
          color: #fff;
          text-align: center;
        }
        .hpd-svc-label-main {
          font-size: clamp(28px, 3.2vw, 48px);
          font-weight: 900;
          line-height: 1.05;
          letter-spacing: -0.01em;
          text-transform: uppercase;
        }
        .hpd-svc-tile:hover .hpd-svc-img {
          transform: scale(1.03);
        }

        /* Reduced-motion users get a static stack instead of scroll-jacking. */
        @media (prefers-reduced-motion: reduce) {
          .hpd-svc-jack { height: auto; }
          .hpd-svc-stage {
            position: static;
            height: auto;
            overflow: visible;
            display: block;
          }
          .hpd-svc-track {
            display: grid;
            grid-template-columns: 1fr 1fr;
            transform: none !important;
            height: auto;
          }
          .hpd-svc-tile {
            flex: none;
            aspect-ratio: 3 / 2;
            height: auto;
          }
        }
      `}</style>
    </section>
  );
}
