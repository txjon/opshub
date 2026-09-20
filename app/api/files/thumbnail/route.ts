import { NextRequest, NextResponse } from "next/server";
import { proxyDriveFile } from "@/lib/drive-proxy";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { judgeFileRequest, PORTAL_COOKIE } from "@/lib/file-access";

// Streams a Google Drive file (or its thumbnail) through the service account.
// Core proxy logic lives in lib/drive-proxy.ts (shared with the token-scoped
// art-request download route). This endpoint serves any fileId — it's used by
// internal, already-authed surfaces (Product Builder, Costing, portal).
export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("id");
  if (!fileId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Judged in SHADOW mode (lib/file-access): the verdict is recorded, the image
  // is still served, until FILE_ACCESS_ENFORCE is switched on.
  let userId: string | null = null;
  try {
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    userId = user?.id || null;
  } catch { userId = null; }
  const verdict = await judgeFileRequest({
    driveFileId: fileId,
    token: req.nextUrl.searchParams.get("t") || req.cookies.get(PORTAL_COOKIE)?.value || null,
    userId,
    route: "thumbnail",
    path: req.nextUrl.pathname,
  });
  if (!verdict.serve) return new NextResponse("Not found", { status: 404 });

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
