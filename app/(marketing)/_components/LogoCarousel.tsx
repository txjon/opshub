// Premium-blanks strip. Static section, three rows of brand SVG logos
// laid out to fit the page width on desktop. Stacks tighter on tablet
// and mobile. Sits over a print-shop background photo with a dark
// gradient overlay for legibility.

type Brand = { label: string; svg: string };
const BLANK_BRANDS: Brand[] = [
  { label: "'47 Brand",           svg: "/marketing/logos/47-brand.svg" },
  { label: "American Apparel",    svg: "/marketing/logos/american-apparel.svg" },
  { label: "AS Colour",           svg: "/marketing/logos/as-colour.svg" },
  { label: "Bella Canvas",        svg: "/marketing/logos/bella-canvas.svg" },
  { label: "Champion",            svg: "/marketing/logos/champion.svg" },
  { label: "Colortone",           svg: "/marketing/logos/colortone.svg" },
  { label: "Comfort Colors",      svg: "/marketing/logos/comfort-colors.svg" },
  { label: "Cotton Collective",   svg: "/marketing/logos/cotton-collective.svg" },
  { label: "Flexfit",             svg: "/marketing/logos/flexfit.svg" },
  { label: "Gildan",              svg: "/marketing/logos/gildan.svg" },
  { label: "Independent",         svg: "/marketing/logos/independent.svg" },
  { label: "LA Apparel",          svg: "/marketing/logos/la-apparel.svg" },
  { label: "New Era",             svg: "/marketing/logos/new-era.svg" },
  { label: "Next Level Apparel",  svg: "/marketing/logos/next-level-apparel.svg" },
  { label: "Otto Cap",            svg: "/marketing/logos/otto-cap.svg" },
  { label: "Richardson",          svg: "/marketing/logos/richardson.svg" },
  { label: "Shaka Wear",          svg: "/marketing/logos/shaka-wear.svg" },
  { label: "YP Classics",         svg: "/marketing/logos/yp-classics.svg" },
];

export function LogoCarousel() {
  return (
    <section
      className="hpd-blanks"
      style={{ position: "relative", background: "#0a0a0c", overflow: "hidden" }}
    >
      <img
        src="/marketing/blanks-bg.jpg"
        alt=""
        aria-hidden
        className="hpd-blanks-bg-img"
      />
      <div className="hpd-blanks-bg-overlay" />

      <div className="hpd-blanks-content">
        <div className="hpd-blanks-eyebrow">Premium blanks from</div>
        <div className="hpd-blanks-grid">
          {BLANK_BRANDS.map(b => (
            <div key={b.label} className="hpd-blanks-tile">
              <img src={b.svg} alt={b.label} className="hpd-blanks-logo" />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .hpd-blanks {
          padding: 120px 48px 140px;
        }
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
        .hpd-blanks-content {
          position: relative;
          z-index: 2;
          max-width: 1400px;
          margin: 0 auto;
        }
        .hpd-blanks-eyebrow {
          font-size: clamp(28px, 3.6vw, 56px);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: -0.01em;
          line-height: 1.05;
          color: #fff;
          text-align: center;
          margin-bottom: 64px;
        }
        /* Desktop: 6 columns, 3 rows. */
        .hpd-blanks-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 48px 32px;
          align-items: center;
        }
        .hpd-blanks-tile {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 80px;
        }
        .hpd-blanks-logo {
          max-width: 100%;
          max-height: 64px;
          width: auto;
          height: auto;
          object-fit: contain;
          filter: brightness(0) invert(1);
          display: block;
        }

        /* Tablet — 4 columns, 3 rows */
        @media (max-width: 1100px) {
          .hpd-blanks-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 40px 24px;
          }
        }
        /* Mobile — 3 columns, 4 rows */
        @media (max-width: 640px) {
          .hpd-blanks {
            padding: 80px 24px 100px;
          }
          .hpd-blanks-eyebrow {
            margin-bottom: 40px;
          }
          .hpd-blanks-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 32px 16px;
          }
          .hpd-blanks-logo {
            max-height: 48px;
          }
        }
      `}</style>
    </section>
  );
}
