// "‹ Back" for pages entered from many places. AppShell records the previous
// in-app path in sessionStorage on every navigation; a page reads it to label
// the link and to decide between history.back() (keeps the origin's scroll and
// state) and a fallback destination when there is no in-app origin.

const LABELS: [RegExp, string][] = [
  [/^\/projects/, "Projects"],
  [/^\/house/, "The House"],
  [/^\/intake/, "Intake"],
  [/^\/studio/, "The Studio"],
  [/^\/production/, "Production"],
  [/^\/receiving/, "Receiving"],
  [/^\/shipping/, "Shipping"],
  [/^\/staging/, "Staging"],
  [/^\/the-distro/, "The Distro"],
  [/^\/clients\//, "Client"],
  [/^\/clients/, "Clients"],
  [/^\/invoices/, "Invoices"],
  [/^\/billing/, "Bills"],
  [/^\/god-mode/, "God Mode"],
  [/^\/drops/, "Releases"],
  [/^\/ecomm/, "The Shop"],
];

export function backOrigin(fallbackHref: string, fallbackLabel: string, opts: { exclude?: RegExp } = {}): { label: string; go: () => void } {
  let prev: string | null = null;
  try { prev = sessionStorage.getItem("opshub:prevPath"); } catch {}
  if (!prev || (opts.exclude && opts.exclude.test(prev))) {
    return { label: fallbackLabel, go: () => { window.location.href = fallbackHref; } };
  }
  const label = LABELS.find(([re]) => re.test(prev!))?.[1] || "Back";
  return { label, go: () => { window.history.back(); } };
}
