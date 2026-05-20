import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/drive-auth";

// Mimes a browser can render directly via <img> / <iframe>. Anything
// outside this list (AI, PSD, EPS, TIFF, raw, etc.) gets served as
// Drive's pre-rendered thumbnail PNG instead of the raw bytes —
// otherwise the browser tries to render `application/postscript` as
// an image, fails, and the consumer sees "No preview" even though
// Drive DOES have a thumbnail for the file.
function isBrowserRenderable(mime: string): boolean {
  if (!mime) return false;
  if (mime.startsWith("image/")) {
    // Exclude raster formats browsers can't actually display.
    if (mime === "image/x-photoshop" || mime === "image/vnd.adobe.photoshop") return false;
    if (mime === "image/tiff" || mime === "image/x-tiff") return false;
    return true;
  }
  if (mime === "application/pdf") return true;
  return false;
}

export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("id");
  // thumb=1: return Drive's pre-generated thumbnail image (small, fast)
  // default: return full file (for previews, downloads) UNLESS the file
  // isn't browser-renderable, in which case we transparently fall back
  // to the thumbnail.
  const useThumbnail = req.nextUrl.searchParams.get("thumb") === "1";
  // Optional ?size=NNN — controls the Drive thumbnail size hint. Drive's
  // thumbnailLink URL ends with `=s220` by default; we can swap that
  // for larger sizes (up to ~1600) to get a sharper preview in the
  // lightbox. Ignored for the full-file path.
  const sizeHint = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("size") || "0", 10) || 0, 0), 1600);
  // dl=1: force a full-file download with Content-Disposition: attachment.
  // Bypasses the non-renderable-mime thumbnail fallback so PSD/AI etc.
  // come back as the original binary, not a PNG preview. Used by the
  // Download button in the file lightbox.
  const forceDownload = req.nextUrl.searchParams.get("dl") === "1";
  if (!fileId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const token = await getAccessToken();

    // Always pull thumbnailLink so we can fall back transparently for
    // non-renderable mimes. Cheap — it's one metadata fetch.
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,thumbnailLink,hasThumbnail`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = metaRes.ok ? await metaRes.json() : null;
    const fileName = meta?.name || "file";
    const mimeType = meta?.mimeType || "image/jpeg";

    // Decide whether to serve the thumbnail. Two triggers:
    //   1. The caller asked for it (?thumb=1)
    //   2. The file's mime can't be rendered in a browser <img>
    // Force-download bypasses both — the caller wants the raw bytes.
    const mustUseThumbnail = !isBrowserRenderable(mimeType);
    const shouldServeThumbnail = !forceDownload && (useThumbnail || mustUseThumbnail) && meta?.thumbnailLink;

    if (shouldServeThumbnail) {
      // Drive's thumbnailLink URL ends with `=sNNN` where NNN is the
      // pixel size of the longest edge. Bump it for higher-res previews
      // when the caller passes ?size=.
      let thumbUrl: string = meta.thumbnailLink;
      if (sizeHint > 0) {
        thumbUrl = thumbUrl.replace(/=s\d+(-c)?$/, `=s${sizeHint}`);
      }
      const thumbRes = await fetch(thumbUrl);
      if (thumbRes.ok) {
        const buf = Buffer.from(await thumbRes.arrayBuffer());
        return new NextResponse(buf, {
          headers: {
            "Content-Type": thumbRes.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
          },
        });
      }
      // Fall through to full-file path if thumbnail fetch fails — for
      // browser-renderable mimes that's fine. For non-renderable mimes
      // we'll end up with a broken <img>; the consumer's onError +
      // fallback covers that.
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

    // RFC 5987 filename encoding — Drive filenames coming from macOS
    // screenshots contain U+202F (narrow no-break space) and other
    // high-Unicode chars that break a naked `filename="..."` header.
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");
    const disposition = forceDownload ? "attachment" : "inline";
    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": forceDownload ? "no-store" : "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (err: any) {
    console.error("[thumbnail] failed for", fileId, err?.message || err);
    return new NextResponse("Failed", { status: 500 });
  }
}
