import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // NOTE: api/ is intentionally INCLUDED so the Supabase auth token gets
  // refreshed before API routes run — otherwise a POST fired after the
  // access token lapsed 401s (updateSession is the only token-refresh
  // point). updateSession skips the /login redirect for /api so internal
  // server-to-server calls and webhooks still pass through to their own auth.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};