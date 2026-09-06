import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveSlugFromHost } from "@/lib/tenants";
import { canAccessPath, firstGrantedHref } from "@/lib/access";
import { V2_WRITES_LIVE } from "@/lib/v2-flags";

// v2 cutover: once live, legacy warehouse URLs bounce to their v2 surface. Closes
// the drift hole (a legacy page writes the old fields, NOT the ledger) and catches
// stale bookmarks. Flag off (rollback) → no redirect, legacy reachable again.
const V2_LEGACY_REDIRECT: Record<string, string> = {
  "/production": "/production2",
  "/receiving": "/receiving2",
  "/shipping": "/shipping2",
  "/fulfillment": "/staging2",
  // Projects board v2 (exact match only — /jobs/[id] job details stay put).
  "/jobs": "/projects",
};

export async function updateSession(request: NextRequest) {
  // Clone the request headers so we can add x-company-slug. The slug is
  // available to every downstream handler (page, API route, server
  // component) via next/headers headers().get("x-company-slug").
  // Host→slug map lives in lib/tenants.ts (single source of truth).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-company-slug", resolveSlugFromHost(request.headers.get("host")));

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/set-password") || pathname.startsWith("/auth/callback");
  // API routes run through middleware ONLY to refresh the auth token (so a
  // POST fired after the access token lapsed doesn't 401). They must never
  // be redirected to /login — each route does its own auth (session check,
  // x-internal-key, webhook signature, or portal token). Without this,
  // server-to-server internal calls (PDF/Excel/email) would get an HTML
  // login redirect instead of running.
  const isApiRoute = pathname.startsWith("/api");
  // Token-gated public surfaces.
  const isTokenPublic = pathname.startsWith("/portal")
    || pathname.startsWith("/staging/share")
    || pathname.startsWith("/design/")
    || pathname.startsWith("/art-request/")
    || pathname.startsWith("/designer/")     // the designer door (mig 165) — per-work-order magic links
    || pathname.startsWith("/lab");   // the design-studio sandbox — open, name-pick + client tokens
  // Public marketing site — exact-match paths so we don't accidentally
  // open the dashboard's /jobs or similar. Add new marketing pages here
  // when each phase ships (Services, Work, Start, Client Portal).
  const isMarketingPublic = MARKETING_PUBLIC_PATHS.includes(pathname)
    // /shop/[handle] — product detail pages, sub-paths of /shop
    || pathname.startsWith("/shop/");
  // The legacy /onboard intake form stays publicly reachable.
  const isLegacyPublic = pathname.startsWith("/onboard");
  // Client-facing documents share via MAGIC LINKS only (/d/[token] → doc_links,
  // mig 153). The raw public/ filenames stay login-walled on purpose — Jon:
  // "I don't want it to be this easy to find."
  const isDocLink = pathname.startsWith("/d/");

  const isPublicRoute = isTokenPublic || isMarketingPublic || isLegacyPublic || isDocLink;

  if (!user && !isAuthRoute && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated users hitting /login etc. used to redirect to /. With
  // the marketing site living at /, that's no longer the dashboard —
  // route them to /house explicitly so the login flow lands them
  // where they actually work (team, Jul 28: the House is the daily
  // driver; /dashboard KPIs are not a workspace).
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/house";
    return NextResponse.redirect(url);
  }

  // ── Page-level access guard ──
  // Enforce per-user page_access on authenticated app routes. Fail-OPEN:
  // uncatalogued paths, god users, missing/empty page_access (legacy role
  // fallback handled in canAccessPath), or any profile-read error all pass
  // through — we never hard-lock someone out on a transient hiccup.
  // Legacy warehouse URL → v2 surface (only while the cutover is live).
  if (user && V2_WRITES_LIVE && V2_LEGACY_REDIRECT[pathname]) {
    const url = request.nextUrl.clone();
    url.pathname = V2_LEGACY_REDIRECT[pathname];
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && !isApiRoute && !isPublicRoute && !isAuthRoute) {
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("role, is_god, page_access")
        .eq("id", user.id)
        .single();
      const accessUser = { role: prof?.role, isGod: prof?.is_god === true, pageAccess: prof?.page_access };
      if (!canAccessPath(pathname, accessUser)) {
        const url = request.nextUrl.clone();
        url.pathname = firstGrantedHref(accessUser) || "/login";
        url.search = "";
        return NextResponse.redirect(url);
      }
    } catch {
      // fail-open: a profile-read hiccup must not lock anyone out
    }
  }

  return supabaseResponse;
}

// Public marketing routes. Each phase appends to this list:
//   Phase 1 — "/" (home)
//   Phase 2 — "/services", "/work", "/client-portal"
//   Phase 3 — "/start"
//   Phase 4 — "/shop" + product detail pages (headless Shopify)
//   Phase 5 — "/contact" (native contact form, replaces AWIO)
const MARKETING_PUBLIC_PATHS = [
  "/",
  "/services",
  "/work",
  "/start",
  "/client-portal",
  "/shop",
  "/contact",
];
