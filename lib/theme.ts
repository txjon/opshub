export const T = {
  bg: "#f4f4f6",
  surface: "#eaeaee",
  card: "#ffffff",
  border: "#dcdce0",
  accent: "#000000",
  accentDim: "#e8e8e8",
  blue: "#73b6c9",
  blueDim: "#e3f1f5",
  green: "#4ddb88",
  greenDim: "#e5f9ed",
  amber: "#f4b22b",
  amberDim: "#fef5e0",
  red: "#ff324d",
  redDim: "#ffe8ec",
  purple: "#fd3aa3",
  purpleDim: "#fee8f4",
  text: "#1a1a1a",
  muted: "#6b6b78",
  faint: "#a0a0ad",
};

export const font = "'IBM Plex Sans','Helvetica Neue',Arial,sans-serif";
export const mono = "'IBM Plex Mono','Courier New',monospace";

export const SIZE_ORDER = [
  "OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL",
  "YXS","YS","YM","YL","YXL",
];

export const sortSizes = (sizes: string[]) =>
  [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
