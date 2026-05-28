"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { SERVICE_IMAGES } from "./_placeholder-images";

// Horizontal scroll-jacked service showcase, same pattern Killer Merch
// uses. The section pins to the viewport and translates a 5-tile track
// horizontally as the user continues scrolling vertically. Works on
// desktop AND mobile — vertical swipe drives the horizontal pan.
//
// Math: track is 5 × 60vw = 300vw wide. To move it from 0 → -200vw
// (so the last tile aligns with the right edge of the viewport), the
// parent section is tall enough to give the user 200vw of vertical
// scroll while the sticky child stays pinned — height: calc(100vh + 200vw).
//
// Tile list mirrors /services exactly: 4 production services + a
// merged Warehousing & Fulfillment tile (no separate E-Commerce, no
// split warehouse/fulfillment).

const SERVICES: { label: string; href: string; image: string }[] = [
  { label: "Screen Printing",              href: "/services#screen",                    image: SERVICE_IMAGES["Screen Printing"] },
  { label: "Embroidery",                   href: "/services#embroidery",                image: SERVICE_IMAGES["Embroidery"] },
  { label: "Product Sourcing",             href: "/services#sourcing",                  image: SERVICE_IMAGES["Product Sourcing"] },
  { label: "Design & Product Development", href: "/services#design",                    image: SERVICE_IMAGES["Design"] },
  { label: "Warehousing & Fulfillment",    href: "/services#warehousing-fulfillment",   image: SERVICE_IMAGES["Fulfillment"] },
];

export function ServiceGrid() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;

    function update() {
      raf = 0;
      const section = sectionRef.current;
      const track = trackRef.current;
      if (!section || !track) return;

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

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="hpd-svc-jack"
      style={{ position: "relative", background: "#0a0a0c" }}
    >
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
        /* Scroll-jack runs everywhere now (desktop + mobile). Vertical
           scroll drives horizontal pan; no separate touch branch. */
        .hpd-svc-jack {
          height: calc(100vh + 200vw);
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
          font-size: clamp(24px, 3.2vw, 48px);
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
