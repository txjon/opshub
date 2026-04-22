import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/drive-auth";

export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("id");
  // thumb=1: return Drive's pre-generated thumbnail image (small, fast)
  // default: return full file (for previews, downloads)
  const useThumbnail = req.nextUrl.searchParams.get("thumb") === "1";
  if (!fileId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const token = await getAccessToken();

    // Ask Drive for metadata including thumbnailLink (short-lived CDN URL)
    const fields = useThumbnail ? "name,mimeType,thumbnailLink" : "name,mimeType";
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${fields}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = metaRes.ok ? await metaRes.json() : null;
    const fileName = meta?.name || "file";
    const mimeType = meta?.mimeType || "image/jpeg";

    // Thumbnail path — much faster than streaming the full file
    if (useThumbnail && meta?.thumbnailLink) {
      const thumbRes = await fetch(meta.thumbnailLink);
      if (thumbRes.ok) {
        const buf = Buffer.from(await thumbRes.arrayBuffer());
        return new NextResponse(buf, {
          headers: {
            "Content-Type": thumbRes.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
          },
        });
      }
      // Fall through to full-file path if thumbnail fetch fails
    }

    // Full file (unchanged behavior for existing callers)
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      return new NextResponse("Not found", { status: 404 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || mimeType;

    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch {
    return new NextResponse("Failed", { status: 500 });
  }
}
