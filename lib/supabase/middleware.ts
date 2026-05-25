import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Multi-tenant routing — map a request Host to a company slug. Used by
// middleware to stamp the active company onto request headers, which
// server components + API routes read via headers().get("x-company-slug").
// Default = HPD so the existing Vercel URL + any unmatched host keeps
// the single-tenant past behavior. Add new tenants here.
function resolveCompanySlug(host: string | null): string {
  if (!host) return "hpd";
  const h = host.toLowerCase().split(":")[0];
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

export async function updateSession(request: NextRequest) {
  // Clone the request headers so we can add x-company-slug. The slug is
  // available to every downstream handler (page, API route, server
  // component) via next/headers headers().get("x-company-slug").
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-company-slug", resolveCompanySlug(request.headers.get("host")));

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
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
  // Token-gated public surfaces.
  const isTokenPublic = pathname.startsWith("/portal")
    || pathname.startsWith("/staging/share")
    || pathname.startsWith("/design/");
  // Public marketing site — exact-match paths so we don't accidentally
  // open the dashboard's /jobs or similar. Add new marketing pages here
  // when each phase ships (Services, Work, Start, Client Portal).
  const isMarketingPublic = MARKETING_PUBLIC_PATHS.includes(pathname);
  // The legacy /onboard intake form stays publicly reachable.
  const isLegacyPublic = pathname.startsWith("/onboard");

  const isPublicRoute = isTokenPublic || isMarketingPublic || isLegacyPublic;

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated users hitting /login etc. used to redirect to /. With
  // the marketing site living at /, that's no longer the dashboard —
  // route them to /dashboard explicitly so the login flow lands them
  // where they actually work.
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

// Public marketing routes. Each phase appends to this list:
//   Phase 1 — "/" (home)
//   Phase 2 — "/services", "/work", "/client-portal"
//   Phase 3 — "/start"
const MARKETING_PUBLIC_PATHS = [
  "/",
  "/services",
  "/work",
  "/start",
  "/client-portal",
];
