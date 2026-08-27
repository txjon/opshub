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
    // Fall through to the full file only when it's renderable — never hand a
    // browser a 78MB PSD because its thumbnail fetch hiccupped.
  }
  // A THUMBNAIL was asked for and Drive has none (layered PSD, huge TIFF): say
  // so, small. Serving the raw file here blew Vercel's 4.5MB response cap and
  // took the designer page's PDF/ZIP down with it (Aug 26).
  if ((useThumbnail || mustUseThumbnail) && !forceDownload) {
    return new Response("No preview", { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok || !res.body) return new Response("Not found", { status: 404 });

  // STREAM the bytes through — never buffer. Buffering capped every download
  // at Vercel's 4.5MB function-response limit (print PSDs are 50MB+).
  const contentType = res.headers.get("content-type") || mimeType;
  // RFC 5987 filename encoding — Drive filenames can contain high-Unicode
  // chars (macOS screenshots use U+202F) that break a naked filename header.
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");
  const disposition = forceDownload ? "attachment" : "inline";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": forceDownload ? "no-store" : "public, max-age=3600, s-maxage=3600",
  };
  const len = res.headers.get("content-length"); if (len) headers["Content-Length"] = len;
  return new Response(res.body, { headers });
}

// Metadata + a byte stream for one Drive file (the ZIP builder). Callers own
// authorization; this serves whatever id it's given.
export async function driveFileMeta(fileId: string): Promise<{ name: string; mimeType: string; size: number | null } | null> {
  const token = await getAccessToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const m = await r.json().catch(() => null);
  return m ? { name: m.name || fileId, mimeType: m.mimeType || "application/octet-stream", size: m.size ? Number(m.size) : null } : null;
}
export async function driveFileStream(fileId: string): Promise<ReadableStream<Uint8Array> | null> {
  const token = await getAccessToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  return r.ok && r.body ? r.body : null;
}
