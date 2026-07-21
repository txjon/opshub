// Per-user page-level access — single source of truth.
//
// Access model (decided 2026-06-29, see opshub-permissions-plan.md):
//   - Each user has profiles.page_access: string[] of page keys (= hrefs) they may reach.
//   - is_god → everything.
//   - If page_access is set (non-empty) → membership in that list IS the grant (enforced).
//   - If page_access is NULL/empty → FALL BACK to the legacy role→group rule, so users who
//     haven't been seeded yet keep working (fail-safe rollout). Once everyone is seeded the
//     fallback is vestigial.
// The middleware enforces this server-side (the real lock); AppShell uses it to render nav.

import { V2_WRITES_LIVE } from "./v2-flags";

export type PageGroup = "owner" | "labs" | "distro" | "ecomm" | "contacts" | "settings" | "billing" | "side";

export type CatalogPage = {
  key: string;       // stable id stored in page_access — equals href
  href: string;
  label: string;
  group: PageGroup;  // sidebar grouping (department) — "side" = always-available utilities
  sensitive?: boolean; // financial / admin surfaces (the real lock targets)
};

// The grantable pages. Add a row here to make a new page grantable.
// NOTE: order doesn't matter; pathToPageKey sorts by href length for prefix matching.
export const PAGE_CATALOG: CatalogPage[] = [
  // Owner / financial
  { key: "/god-mode", href: "/god-mode", label: "Overview", group: "owner", sensitive: true },
  { key: "/reports", href: "/reports", label: "Reports", group: "owner", sensitive: true },
  { key: "/reconciliation", href: "/reconciliation", label: "Reconciliation", group: "owner", sensitive: true },
  { key: "/integrations", href: "/integrations", label: "Integrations", group: "owner", sensitive: true },
  // Labs / production
  { key: "/dashboard", href: "/dashboard", label: "Dashboard", group: "labs" },
  { key: "/jobs", href: "/jobs", label: "Projects", group: "labs" },
  { key: "/projects", href: "/projects", label: "Projects V2", group: "labs" },
  { key: "/art-studio", href: "/art-studio", label: "Art Studio", group: "labs" },
  { key: "/studio2", href: "/studio2", label: "Studio v2", group: "labs" },
  { key: "/drops", href: "/drops", label: "Drops", group: "labs" },
  { key: "/production", href: "/production", label: "Production", group: "labs" },
  { key: "/production2", href: "/production2", label: "Production v2", group: "labs" },
  // Distro / warehouse
  { key: "/distro", href: "/distro", label: "Dashboard", group: "distro" },
  { key: "/receiving", href: "/receiving", label: "Receiving", group: "distro" },
  { key: "/receiving2", href: "/receiving2", label: "Receiving v2", group: "distro" },
  { key: "/shipping", href: "/shipping", label: "Shipping", group: "distro" },
  { key: "/shipping2", href: "/shipping2", label: "Shipping v2", group: "distro" },
  { key: "/fulfillment", href: "/fulfillment", label: "Fulfillment", group: "distro" },
  { key: "/staging2", href: "/staging2", label: "Staging v2", group: "distro" },
  { key: "/warehouse", href: "/warehouse", label: "Warehouse (retired → Receiving)", group: "distro" },
  { key: "/hours", href: "/hours", label: "Log Hours", group: "distro" },
  // Ecomm
  { key: "/ecomm", href: "/ecomm", label: "Dashboard", group: "ecomm" },
  { key: "/ecomm/staging", href: "/ecomm/staging", label: "Staging", group: "ecomm" },
  // Contacts
  { key: "/intake", href: "/intake", label: "Intake", group: "contacts" },
  { key: "/clients", href: "/clients", label: "Clients", group: "contacts" },
  { key: "/decorators", href: "/decorators", label: "Decorators", group: "contacts" },
  { key: "/settings/designers", href: "/settings/designers", label: "Designers", group: "contacts" },
  // Billing (bookkeeper surface — bill entry + inline variance + QB push)
  { key: "/billing", href: "/billing", label: "Billing", group: "billing", sensitive: true },
  // Admin
  { key: "/settings", href: "/settings", label: "Team", group: "settings", sensitive: true },
  // Parked/mockup pages — catalogued so they can't fail open (uncatalogued
  // paths are allowed by canAccessPath). Owner-sensitive: god/grant only.
  // (/templates deleted 2026-07-17 per Jon — superseded by the planned team
  // Resources page, see roadmap.)
  { key: "/command-center-v2", href: "/command-center-v2", label: "Command Center mockup", group: "owner", sensitive: true },
  // Always-available utilities
  { key: "/toolkit", href: "/toolkit", label: "Toolkit", group: "side" },
  { key: "/references", href: "/references", label: "References", group: "side" },
];

const CATALOG_BY_KEY: Record<string, CatalogPage> = Object.fromEntries(PAGE_CATALOG.map(p => [p.key, p]));
// Longest href first so /settings/designers wins over /settings, /jobs/[id] maps to /jobs, etc.
const CATALOG_BY_LENGTH = [...PAGE_CATALOG].sort((a, b) => b.href.length - a.href.length);

// Legacy role → which groups that role could reach. Used ONLY for the fallback
// when a user has no explicit page_access yet. Mirrors layout.tsx / api/team.
const ROLE_GROUPS: Record<string, PageGroup[]> = {
  owner: ["owner", "labs", "distro", "ecomm", "contacts", "settings", "side"],
  manager: ["labs", "distro", "ecomm", "contacts", "settings", "side"],
  ops: ["labs", "distro", "ecomm", "contacts", "side"],
  staff: ["labs", "distro", "ecomm", "contacts", "side"],
  viewer: ["labs", "distro", "ecomm", "contacts", "side"],
  warehouse: ["distro", "side"],
};

export type AccessUser = {
  role?: string | null;
  isGod?: boolean | null;
  pageAccess?: string[] | null;
};

// ── v2 warehouse cutover twins ─────────────────────────────────────────────
// Each v2 surface and its legacy twin. When V2_WRITES_LIVE, a grant of EITHER
// covers BOTH — so the flip needs no re-seeding of page_access, and rollback
// (flag off) keeps legacy grants working exactly as before. See lib/v2-flags.
const V2_TWIN_PAIRS: [string, string][] = [
  ["/production2", "/production"],
  ["/receiving2", "/receiving"],
  ["/shipping2", "/shipping"],
  ["/staging2", "/fulfillment"],
  // Projects board v2 replaces the /jobs list (cutover 2026-07-20). /jobs stays
  // catalogued — job DETAIL pages (/jobs/[id]) resolve access through it.
  ["/projects", "/jobs"],
];
const V2_TWIN_OF: Record<string, string> = {};
for (const [v2, legacy] of V2_TWIN_PAIRS) { V2_TWIN_OF[v2] = legacy; V2_TWIN_OF[legacy] = v2; }

/** Map a request pathname to the catalog page key it belongs to, or null if uncatalogued. */
export function pathToPageKey(pathname: string): string | null {
  const clean = pathname.split("?")[0];
  for (const p of CATALOG_BY_LENGTH) {
    if (clean === p.href || clean.startsWith(p.href + "/")) return p.key;
  }
  return null;
}

function hasExplicit(user: AccessUser): boolean {
  return Array.isArray(user.pageAccess) && user.pageAccess.length > 0;
}

/** Can this user reach this page key? (is_god → yes; explicit grants → membership; else role fallback.) */
export function canAccessKey(key: string, user: AccessUser): boolean {
  if (user.isGod) return true;
  const cat = CATALOG_BY_KEY[key];
  if (!cat) return true; // uncatalogued → don't block (fail-open)
  if (hasExplicit(user)) {
    if (user.pageAccess!.includes(key)) return true;
    // When the v2 cutover is live, a grant of a page's twin covers it too.
    if (V2_WRITES_LIVE && V2_TWIN_OF[key] && user.pageAccess!.includes(V2_TWIN_OF[key])) return true;
    return false;
  }
  // Fallback: legacy role→group rule
  const groups = ROLE_GROUPS[user.role || "viewer"] || [];
  return groups.includes(cat.group);
}

/** Guard decision for a request pathname. Uncatalogued paths are allowed (fail-open). */
export function canAccessPath(pathname: string, user: AccessUser): boolean {
  const key = pathToPageKey(pathname);
  if (!key) return true;
  return canAccessKey(key, user);
}

/** The catalog group a request pathname belongs to (for nav active-dept), or null. */
export function pathToGroup(pathname: string): PageGroup | null {
  const key = pathToPageKey(pathname);
  return key ? (CATALOG_BY_KEY[key]?.group ?? null) : null;
}

/** The catalog pages this user may see — drives the sidebar. */
export function grantedPages(user: AccessUser): CatalogPage[] {
  if (user.isGod) return PAGE_CATALOG;
  if (hasExplicit(user)) {
    const set = new Set(user.pageAccess!);
    // When live, surface the v2 twin of any granted legacy page (and vice versa)
    // so the swapped nav has the v2 entries to show. AppShell then hides legacy.
    if (V2_WRITES_LIVE) for (const k of user.pageAccess!) if (V2_TWIN_OF[k]) set.add(V2_TWIN_OF[k]);
    return PAGE_CATALOG.filter(p => set.has(p.key));
  }
  const groups = ROLE_GROUPS[user.role || "viewer"] || [];
  return PAGE_CATALOG.filter(p => groups.includes(p.group));
}

/** Where to send a user who hit a page they lack — their first granted non-side page, else null. */
export function firstGrantedHref(user: AccessUser): string | null {
  const pages = grantedPages(user);
  const main = pages.find(p => p.group !== "side");
  return (main || pages[0])?.href || null;
}
