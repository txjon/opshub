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

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login") || request.nextUrl.pathname.startsWith("/set-password") || request.nextUrl.pathname.startsWith("/auth/callback");
  const isPublicRoute = request.nextUrl.pathname.startsWith("/portal")
    || request.nextUrl.pathname.startsWith("/staging/share")
    || request.nextUrl.pathname.startsWith("/design/");

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
