"use client";
import { useEffect, useRef } from "react";

// Premium-blanks strip. Mouse/trackpad: scroll-jacked — section pins to
// viewport and the logo track pans horizontally as the user scrolls
// vertically (Killer Merch pattern, same engine as ServiceGrid). Touch:
// native horizontal swipe.
//
// Logos render at their authored artboard size, so they all line up at
// uniform dimensions. CSS filter forces every SVG to a flat white
// silhouette regardless of internal fills.

type Brand = { label: string; svg: string };
const BLANK_BRANDS: Brand[] = [
  { label: "'47 Brand",           svg: "/marketing/logos/47-brand.svg" },
  { label: "American Apparel",    svg: "/marketing/logos/american-apparel.svg" },
  { label: "AS Colour",           svg: "/marketing/logos/as-colour.svg" },
  { label: "Bella Canvas",        svg: "/marketing/logos/bella-canvas.svg" },
  { label: "Comfort Colors",      svg: "/marketing/logos/comfort-colors.svg" },
  { label: "Flexfit",             svg: "/marketing/logos/flexfit.svg" },
  { label: "Independent",         svg: "/marketing/logos/independent.svg" },
  { label: "LA Apparel",          svg: "/marketing/logos/la-apparel.svg" },
  { label: "New Era",             svg: "/marketing/logos/new-era.svg" },
  { label: "Next Level Apparel",  svg: "/marketing/logos/next-level-apparel.svg" },
  { label: "Richardson",          svg: "/marketing/logos/richardson.svg" },
  { label: "YP Classics",         svg: "/marketing/logos/yp-classics.svg" },
];

export function LogoCarousel() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      className="hpd-blanks-jack"
      style={{ position: "relative", background: "#0a0a0c" }}
    >
      <div className="hpd-blanks-stage">
        <img
          src="/marketing/blanks-bg.jpg"
          alt=""
          aria-hidden
          className="hpd-blanks-bg-img"
        />
        <div className="hpd-blanks-bg-overlay" />

        <div className="hpd-blanks-eyebrow">Premium blanks from</div>
        <div className="hpd-blanks-rail">
          <div ref={trackRef} className="hpd-blanks-track">
            {BLANK_BRANDS.map(b => (
              <div key={b.label} className="hpd-blanks-tile">
                <img src={b.svg} alt={b.label} className="hpd-blanks-logo" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        .hpd-blanks-bg-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          z-index: 0;
        }
        .hpd-blanks-bg-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.78) 100%);
          pointer-events: none;
          z-index: 1;
        }
        .hpd-blanks-eyebrow,
        .hpd-blanks-rail {
          position: relative;
          z-index: 2;
        }
        .hpd-blanks-eyebrow {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: rgba(255,255,255,0.55);
          text-align: center;
          padding: 0 32px 56px;
        }

        /* Mouse/trackpad: scroll-jacked. Section is tall, stage sticks
           to the viewport, track translates horizontally with scroll.
           Tile width is fixed per logo so flex doesn't shrink anything. */
        @media (pointer: fine) {
          .hpd-blanks-jack {
            height: calc(100vh + 200vw);
          }
          .hpd-blanks-stage {
            position: sticky;
            top: 0;
            height: 100vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: stretch;
          }
          .hpd-blanks-rail {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            overflow: hidden;
            height: 320px;
          }
          .hpd-blanks-track {
            display: flex;
            gap: 0;
            will-change: transform;
            align-items: center;
            padding: 0 6vw;
          }
          .hpd-blanks-tile {
            flex: 0 0 auto;
            width: 22vw;
            height: 320px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 40px;
            border-right: 1px solid rgba(255,255,255,0.06);
          }
        }

        /* Touch: native horizontal swipe, no scroll-jack. */
        @media (pointer: coarse) {
          .hpd-blanks-stage {
            padding: 80px 0;
            position: relative;
            min-height: 360px;
          }
          .hpd-blanks-rail {
            overflow-x: auto;
            overflow-y: hidden;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
            height: auto;
          }
          .hpd-blanks-track {
            display: flex;
            gap: 0;
            transform: none !important;
            will-change: auto;
          }
          .hpd-blanks-tile {
            flex: 0 0 70vw;
            height: 200px;
            display: flex;
            align-items: center;
            justify-content: center;
            scroll-snap-align: center;
            padding: 0 28px;
          }
        }

        /* Logo render — fill its tile, contain to preserve aspect, force
           to white via filter. Each artboard is uniformly sized so logos
           visually align across tiles. */
        .hpd-blanks-logo {
          max-width: 100%;
          max-height: 80%;
          width: auto;
          height: auto;
          object-fit: contain;
          filter: brightness(0) invert(1);
          opacity: 0.72;
          transition: opacity 0.2s;
          display: block;
        }
        .hpd-blanks-tile:hover .hpd-blanks-logo {
          opacity: 1;
        }

        /* Reduced motion: static centered grid */
        @media (prefers-reduced-motion: reduce) {
          .hpd-blanks-jack { height: auto; }
          .hpd-blanks-stage {
            position: static;
            height: auto;
            padding: 80px 32px;
            display: block;
          }
          .hpd-blanks-rail {
            height: auto;
            overflow: visible;
          }
          .hpd-blanks-track {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 32px 56px;
            transform: none !important;
            padding: 0;
          }
          .hpd-blanks-tile {
            flex: 0 0 auto;
            width: auto;
            height: auto;
            padding: 0;
            border: none;
          }
          .hpd-blanks-logo {
            height: 64px;
            max-height: 64px;
          }
        }
      `}</style>
    </section>
  );
}
