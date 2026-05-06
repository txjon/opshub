import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // Supabase recovery + signup verify links append type=recovery / type=signup
  // / type=invite to the redirect target. Treat any of those as "user just
  // verified via email and almost certainly has no password set" — force
  // them to /set-password regardless of what `next` was passed.
  const verifyType = searchParams.get("type");
  const next = searchParams.get("next") || "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const recoveryFlow = verifyType === "recovery" || verifyType === "invite" || verifyType === "signup";
        // app_metadata.invited stays set after the initial click; !confirmed_at
        // covers the very-first invite click. Either signal → set-password.
        const looksInvited = user.app_metadata?.invited === true || !user.confirmed_at;
        if (recoveryFlow || looksInvited || next.includes("set-password")) {
          return NextResponse.redirect(new URL("/set-password", request.url));
        }
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login", request.url));
}
