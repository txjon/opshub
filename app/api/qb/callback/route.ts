import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveTokens } from "@/lib/quickbooks";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // Debug: show all params
  if (!code) {
    return NextResponse.json({
      debug: "No code received",
      params: Object.fromEntries(req.nextUrl.searchParams.entries()),
      error,
      state,
    });
  }

  // Step 1: Exchange code
  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err: any) {
    return NextResponse.json({ step: "exchangeCode", error: err.message });
  }

  // Step 2: Save tokens
  try {
    await saveTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
  } catch (err: any) {
    return NextResponse.json({ step: "saveTokens", error: err.message });
  }

  // Success
  return NextResponse.redirect(new URL("/settings?qb=connected", req.url));
}
