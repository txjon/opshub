import { Hero } from "./_components/Hero";
import { ServiceGrid } from "./_components/ServiceGrid";
import { MissionStrip } from "./_components/MissionStrip";
import { LogoCarousel } from "./_components/LogoCarousel";

// HPD home page. Current flow:
//
//   Hero  →  Services (scroll-jacked)  →  Mission  →  Blanks marquee
//
// Hidden for now (components kept in the codebase, just not mounted):
//   - ProcessFlow / "How it works" — temporarily hidden
//   - PortfolioGrid / "Recent work" — hidden until we have NDA-cleared
//     work to showcase

export const metadata = {
  title: "House Party Distro | Custom Apparel, Printing & Fulfillment",
  description: "Custom apparel from concept to delivery. Art production, blank sourcing, screen printing, warehousing, and fulfillment for brands, tours, and corporate clients.",
};

export default function HomePage() {
  return (
    <div style={{ background: "#0a0a0c", color: "#fff" }}>
      <Hero />
      <ServiceGrid />
      <MissionStrip />
      <LogoCarousel />
    </div>
  );
}
