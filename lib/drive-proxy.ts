// Shared Google Drive file proxy — streams a file's bytes (or its Drive
// thumbnail) through our own server using the service account, so the raw
// Drive link is never exposed. Used by /api/files/thumbnail (internal, authed
// surfaces) AND the token-scoped art-request download route (public gallery).
// One source of truth for the proxy behavior.
import { getAccessToken } from "@/lib/drive-auth";

// Mimes a browser can render directly via <img> / <iframe>. Anything outside
// this list (AI, PSD, EPS, TIFF, raw, etc.) gets served as Drive's
// pre-rendered thumbnail PNG instead of the raw bytes.
function isBrowserRenderable(mime: string): boolean {
  if (!mime) return false;
  if (mime.startsWith("image/")) {
    if (mime === "image/x-photoshop" || mime === "image/vnd.adobe.photoshop") return false;
    if (mime === "image/tiff" || mime === "image/x-tiff") return false;
    return true;
  }
  if (mime === "application/pdf") return true;
  return false;
}

export type DriveProxyOpts = {
  thumb?: boolean;   // return Drive's pre-generated thumbnail (small, fast)
  download?: boolean; // force full-file download (Content-Disposition: attachment)
  size?: number;      // thumbnail size hint (longest edge, capped 1600)
};

// Returns a Response streaming the requested Drive file. Callers own auth /
// authorization BEFORE calling this — it always serves whatever fileId it's
// given via the service account.
export async function proxyDriveFile(fileId: string, opts: DriveProxyOpts = {}): Promise<Response> {
  const useThumbnail = !!opts.thumb;
  const forceDownload = !!opts.download;
  const sizeHint = Math.min(Math.max(Math.floor(opts.size || 0) || 0, 0), 1600);

  const token = await getAccessToken();

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,thumbnailLink,hasThumbnail`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = metaRes.ok ? await metaRes.json() : null;
  const fileName = meta?.name || "file";
  const mimeType = meta?.mimeType || "image/jpeg";

  const mustUseThumbnail = !isBrowserRenderable(mimeType);
  const shouldServeThumbnail = !forceDownload && (useThumbnail || mustUseThumbnail) && meta?.thumbnailLink;

  if (shouldServeThumbnail) {
    let thumbUrl: string = meta.thumbnailLink;
    if (sizeHint > 0) {
      thumbUrl = thumbUrl.replace(/=s\d+(-c)?$/, `=s${sizeHint}`);
    }
    const thumbRes = await fetch(thumbUrl);
    if (thumbRes.ok) {
      const buf = Buffer.from(await thumbRes.arrayBuffer());
      return new Response(buf, {
        headers: {
          "Content-Type": thumbRes.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "public, max-age=86400, s-maxage=86400",
        },
      });
    }
    // Fall through to full-file path if the thumbnail fetch fails.
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return new Response("Not found", { status: 404 });

  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || mimeType;
  // RFC 5987 filename encoding — Drive filenames can contain high-Unicode
  // chars (macOS screenshots use U+202F) that break a naked filename header.
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");
  const disposition = forceDownload ? "attachment" : "inline";
  return new Response(buf, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": forceDownload ? "no-store" : "public, max-age=3600, s-maxage=3600",
    },
  });
}
