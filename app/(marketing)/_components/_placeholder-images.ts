// Stock photo placeholders from Unsplash for the marketing site until
// real HPD photography is delivered. Centralized here so swap-out is a
// single-file edit — replace each URL with `/marketing/<file>.jpg` after
// Jon's photoshoot lands and the images sit in /public/marketing/.
//
// All URLs use Unsplash's CDN query params (?w=NNNN&q=NN&auto=format&fit=crop)
// for sane sizes + WebP delivery. Each photo was picked to evoke the
// apparel / live-music / production world HPD operates in.

const u = (id: string, w = 2000) =>
  `https://images.unsplash.com/${id}?w=${w}&q=80&auto=format&fit=crop`;

// Hero — moody full-bleed image. Concert lights / backstage energy.
export const HERO_IMAGE = u("photo-1493225458791-58fdc4682e83", 2400);

// Service grid — 6 tiles, each evoking the service it represents.
export const SERVICE_IMAGES: Record<string, string> = {
  "Design & Art":     u("photo-1561070791-2526d30994b8"),
  "Screen Printing":  u("photo-1583744946564-b52ac1c389c8"),
  "Embroidery":       u("photo-1620799140408-edc6dcb6d633"),
  "Blank Sourcing":   u("photo-1483985988355-763728e1935b"),
  "Warehousing":      u("photo-1601598851547-4302969d0614"),
  "Fulfillment":      u("photo-1607082348824-0a96f2a4b9da"),
};

// Portfolio tiles — 6 generic apparel/merch shots until project-specific
// photography is gathered.
export const PORTFOLIO_IMAGES: string[] = [
  u("photo-1521572163474-6864f9cf17ab", 1200),  // folded t-shirts
  u("photo-1556905055-8f358a7a47b2",   1200),  // clothing stack
  u("photo-1503342217505-b0a15ec3261c", 1200),  // t-shirts hanging
  u("photo-1542272604-787c3835535d",   1200),  // hoodie
  u("photo-1576566588028-4147f3842f27", 1200),  // clothing rack
  u("photo-1620799139507-2a76f79a2f4d", 1200),  // merch tee
];

// Extended portfolio for /work — 12 items.
export const WORK_IMAGES: string[] = [
  u("photo-1521572163474-6864f9cf17ab", 1400),
  u("photo-1556905055-8f358a7a47b2",   1400),
  u("photo-1503342217505-b0a15ec3261c", 1400),
  u("photo-1542272604-787c3835535d",   1400),
  u("photo-1576566588028-4147f3842f27", 1400),
  u("photo-1620799139507-2a76f79a2f4d", 1400),
  u("photo-1591047139829-d91aecb6caea", 1400),
  u("photo-1602810318383-c0cdc4c4d6d4", 1400),
  u("photo-1556903454-2b9aa9f93f55", 1400),
  u("photo-1564859228273-274232fdb516", 1400),
  u("photo-1583744946564-b52ac1c389c8", 1400),
  u("photo-1620799140408-edc6dcb6d633", 1400),
];
