import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Check if user needs to set password (invited users)
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // If user was invited, they need to set a password
        const isInvited = user.app_metadata?.invited || !user.confirmed_at;
        if (isInvited || next.includes("set-password")) {
          return NextResponse.redirect(new URL("/set-password", request.url));
        }
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login", request.url));
}
