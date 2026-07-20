import { NextRequest, NextResponse } from "next/server";
import { proxyDriveFile } from "@/lib/drive-proxy";

// Streams a Google Drive file (or its thumbnail) through the service account.
// Core proxy logic lives in lib/drive-proxy.ts (shared with the token-scoped
// art-request download route). This endpoint serves any fileId — it's used by
// internal, already-authed surfaces (Product Builder, Costing, portal).
export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("id");
  if (!fileId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    return await proxyDriveFile(fileId, {
      thumb: req.nextUrl.searchParams.get("thumb") === "1",
      download: req.nextUrl.searchParams.get("dl") === "1",
      size: parseInt(req.nextUrl.searchParams.get("size") || "0", 10) || 0,
    });
  } catch (err: any) {
    console.error("[thumbnail] failed for", fileId, err?.message || err);
    return new NextResponse("Failed", { status: 500 });
  }
}
