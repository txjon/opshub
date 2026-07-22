// DARK (Jul 21 2026): the internal app joins the hub's world — same inks
// as components/hub/theme H. accent flipped to WHITE (white pill, dark
// text — the brand button); accent-bg call sites with hardcoded white
// text were mechanically flipped in the same pass.
export const T = {
  bg: "#0a0a0a",
  surface: "#1e1e1e",
  card: "#131313",
  border: "rgba(255,255,255,0.13)",
  accent: "#ffffff",
  accentDim: "rgba(255,255,255,0.08)",
  blue: "#8fc7d8",
  blueDim: "rgba(143,199,216,0.12)",
  green: "#58c93c",
  greenDim: "rgba(88,201,60,0.10)",
  amber: "#f4b22b",
  amberDim: "rgba(244,178,43,0.10)",
  red: "#ff5a6e",
  redDim: "rgba(255,90,110,0.12)",
  purple: "#fd3aa3",
  purpleDim: "rgba(253,58,163,0.12)",
  text: "#ffffff",
  muted: "rgba(255,255,255,0.6)",
  faint: "rgba(255,255,255,0.38)",
};

export const font = "'IBM Plex Sans','Helvetica Neue',Arial,sans-serif";
export const mono = "'IBM Plex Mono','Courier New',monospace";

export const SIZE_ORDER = [
  "OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL",
  "YXS","YS","YM","YL","YXL",
];

// Verbose / alias spellings → canonical token, keyed by an alphanumeric-only
// uppercase form ("2X Large" → "2XLARGE", "X-Large" → "XLARGE") so spacing,
// hyphens, and case never matter. Lets stores that spell sizes out ("Small",
// "2X Large") land on our standard S/M/L/XL/2XL… convention on import.
const SIZE_ALIASES: Record<string, string> = {
  XSMALL: "XS", EXTRASMALL: "XS",
  SMALL: "S", SM: "S",
  MEDIUM: "M", MED: "M",
  LARGE: "L", LG: "L",
  XLARGE: "XL", EXTRALARGE: "XL",
  XXLARGE: "2XL", "2XLARGE": "2XL", XXL: "2XL", "2X": "2XL",
  XXXLARGE: "3XL", "3XLARGE": "3XL", XXXL: "3XL", "3X": "3XL",
  XXXXLARGE: "4XL", "4XLARGE": "4XL", XXXXL: "4XL", "4X": "4XL",
  "5XLARGE": "5XL", "5X": "5XL",
  "6XLARGE": "6XL", "6X": "6XL",
  YOUTHXSMALL: "YXS", YOUTHSMALL: "YS", YOUTHMEDIUM: "YM",
  YOUTHLARGE: "YL", YOUTHXLARGE: "YXL",
};

// Canonical display form for a size label: maps recognized simple size tokens and
// their verbose spellings to our standard convention (small→S, "2X Large"→2XL).
// Multi-dimensional / unknown labels (pants "Relaxed / 32 / 34", "One Size",
// numeric waists) pass through untouched.
export const canonicalSize = (s: string): string => {
  const up = String(s).trim().toUpperCase();
  if (SIZE_ORDER.includes(up)) return up;
  const key = up.replace(/[^A-Z0-9]/g, "");
  return SIZE_ALIASES[key] || s;
};

export const sortSizes = (sizes: string[]) =>
  [...sizes].sort((a, b) => {
    // Case-insensitive: Shopify gives lowercase sizes ("s","m","2xl"); SIZE_ORDER
    // is uppercase. Without this they miss the order and alpha-sort to a scramble.
    const ai = SIZE_ORDER.indexOf(String(a).toUpperCase()), bi = SIZE_ORDER.indexOf(String(b).toUpperCase());
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

// ── Mobile / responsive breakpoints ─────────────────────────────────────
export const BP = {
  mobile: 768,    // < 768 = phone
  tablet: 1024,   // 768–1023 = tablet
} as const;

export const MQ = {
  mobile: `(max-width: ${BP.mobile - 1}px)`,
  tablet: `(max-width: ${BP.tablet - 1}px)`,
} as const;
