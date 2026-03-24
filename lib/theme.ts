export const T = {
  bg: "#0f1117",
  surface: "#181c27",
  card: "#1e2333",
  border: "#2a3050",
  accent: "#4f8ef7",
  accentDim: "#1e3a6e",
  green: "#34c97a",
  greenDim: "#0e3d24",
  amber: "#f5a623",
  amberDim: "#3d2a08",
  red: "#f05353",
  redDim: "#3d1212",
  purple: "#a78bfa",
  purpleDim: "#2d1f5e",
  text: "#e8eaf2",
  muted: "#7a82a0",
  faint: "#3a4060",
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
