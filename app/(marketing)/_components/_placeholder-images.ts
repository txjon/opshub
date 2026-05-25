// Local marketing photography served from /public/marketing/.
//
// Files were sorted, renamed, and placed by Claude after Jon dropped
// his Instagram backlog into /public/marketing/incoming/. To swap a
// photo: drop the new file into /public/marketing/ and update its
// reference below. To add more portfolio shots: append to the array.

// Hero — full-bleed home page background. Lifestyle / brand-in-the-wild.
export const HERO_IMAGE = "/marketing/hero-motorcycle.png";

// Service grid — 7 services. The home grid shows 6 of these; /services
// uses all 7 (DTG/Sub added there). Keyed by service label.
export const SERVICE_IMAGES: Record<string, string> = {
  "Design & Art":     "/marketing/service-design.png",
  "Screen Printing":  "/marketing/service-screen-print.png",
  "Embroidery":       "/marketing/service-embroidery.png",
  "DTG":              "/marketing/service-dtg.png",
  "Blank Sourcing":   "/marketing/service-blanks.png",
  "Warehousing":      "/marketing/service-warehousing.png",
  "Fulfillment":      "/marketing/service-fulfillment.png",
};

// Home portfolio teaser — first 6 of the full work grid.
export const PORTFOLIO_IMAGES: string[] = [
  "/marketing/portfolio-01-lowrider.png",
  "/marketing/portfolio-02-backpack.png",
  "/marketing/portfolio-03-snowboard.png",
  "/marketing/portfolio-04-skateboard.png",
  "/marketing/portfolio-05-warehouse.png",
  "/marketing/portfolio-06-polybag.png",
];

// Extended portfolio for /work — full 12 items.
export const WORK_IMAGES: string[] = [
  "/marketing/portfolio-01-lowrider.png",
  "/marketing/portfolio-02-backpack.png",
  "/marketing/portfolio-03-snowboard.png",
  "/marketing/portfolio-04-skateboard.png",
  "/marketing/portfolio-05-warehouse.png",
  "/marketing/portfolio-06-polybag.png",
  "/marketing/portfolio-07-packing.png",
  "/marketing/portfolio-08-sorting.png",
  "/marketing/portfolio-09-truck.png",
  "/marketing/portfolio-10-van.png",
  "/marketing/portfolio-11-hockey.png",
  "/marketing/portfolio-12-cases.png",
];
