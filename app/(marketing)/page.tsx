import { Hero } from "./_components/Hero";
import { ServiceGrid } from "./_components/ServiceGrid";
import { ProcessFlow } from "./_components/ProcessFlow";
import { MissionStrip } from "./_components/MissionStrip";
import { LogoCarousel } from "./_components/LogoCarousel";
import { PortfolioGrid } from "./_components/PortfolioGrid";

// HPD home page. Section order follows the killermerch.com flow with our
// content + the 4-step process keeping our differentiator.
//
//   Hero  →  Services  →  Process  →  Mission  →  Logos  →  Portfolio
//
// All section content is hardcoded for v1. Imagery placeholders (CSS
// gradients) sit in for real photography until Jon delivers assets.

export const metadata = {
  title: "House Party Distro — Custom Apparel, Decoration & Fulfillment",
  description: "Custom apparel from concept to delivery. Art production, blank sourcing, screen printing, warehousing, and fulfillment for brands, tours, and corporate clients.",
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <ServiceGrid />
      <ProcessFlow />
      <MissionStrip />
      <LogoCarousel />
      <PortfolioGrid />
    </>
  );
}
