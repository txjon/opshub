import { Hero } from "./_components/Hero";
import { MissionStrip } from "./_components/MissionStrip";

// HPD home page. Current flow:
//
//   Hero  →  Mission
//
// Services + the premium-blanks strip live on /services (Oct 2026 slim-down).
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
      <MissionStrip />
    </div>
  );
}
