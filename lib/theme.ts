export const T = {
  bg: "#f4f4f6",
  surface: "#eaeaee",
  card: "#ffffff",
  border: "#dcdce0",
  accent: "#1a1a1a",
  accentDim: "#e8e8ec",
  green: "#1a8c5c",
  greenDim: "#e6f5ee",
  amber: "#b45309",
  amberDim: "#fef3e0",
  red: "#c43030",
  redDim: "#fce8e8",
  purple: "#7c3aed",
  purpleDim: "#ede9fe",
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
