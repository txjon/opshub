import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveTokens } from "@/lib/quickbooks";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  const realmId = req.nextUrl.searchParams.get("realmId");

  if (error || !code) {
    return NextResponse.redirect(new URL("/settings?qb=error", req.url));
  }

  try {
    const tokens = await exchangeCode(code);
    await saveTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in, realmId || undefined);
    return NextResponse.redirect(new URL("/settings?qb=connected", req.url));
  } catch (err: any) {
    console.error("[QB Callback] Error:", err.message);
    return NextResponse.redirect(new URL("/settings?qb=error", req.url));
  }
}
