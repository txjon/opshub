import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/drive-auth";

// URL: /api/files/view/My-Proof-File.pdf?id=driveFileId[&download=1]
// The filename is in the URL path so browsers use it for Save As.
// download=1 flips the disposition to attachment — a one-click direct save
// (lands wherever the browser's download location points).
//
// This is how printers pull production files (vendor portal + PO PDF), and
// print PSDs run past 500MB. Built so big files never fail (Sep 18 2026):
//   - STREAMED, never buffered (buffering capped downloads at Vercel's 4.5MB
//     response limit — the Aug 26 designer-page 500).
//   - maxDuration pinned to the plan maximum: the stream stays open as long as
//     the vendor's connection takes. Measured on prod: 564MB at 1MB/s = 9.4min.
//   - RESUMABLE: Range requests pass through to Drive (206 + Content-Range),
//     with a strong ETag (Drive md5) + Last-Modified so a browser can resume a
//     dropped download instead of restarting from zero. If-Range with a stale
//     validator gets the full file, never a mismatched slice.
//   - private caching only: the CDN must never cache a 206 slice and hand it
//     to someone asking for the whole file.
export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return serve(req, params, false);
}

export async function HEAD(req: NextRequest, { params }: { params: { path: string[] } }) {
  return serve(req, params, true);
}

async function serve(req: NextRequest, params: { path: string[] }, headOnly: boolean): Promise<Response> {
  const fileId = req.nextUrl.searchParams.get("id");
  if (!fileId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const fileName = decodeURIComponent(params.path.join("/")) || "file";

  try {
    const token = await getAccessToken();
    const auth = { Authorization: `Bearer ${token}` };

    // Metadata first: size + validators for resume, and a clean 404 before
    // any bytes move.
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=size,md5Checksum,modifiedTime,mimeType&supportsAllDrives=true`,
      { headers: auth, cache: "no-store" }
    );
    if (!metaRes.ok) return new NextResponse("Not found", { status: 404 });
    const meta: any = await metaRes.json();
    const size = meta.size ? Number(meta.size) : null;
    const etag = meta.md5Checksum ? `"${meta.md5Checksum}"` : null;
    const lastModified = meta.modifiedTime ? new Date(meta.modifiedTime).toUTCString() : null;

    // Honor Range only when it's a single byte range and (if the client sent
    // If-Range) the validator still matches — otherwise serve the whole file.
    let range = req.headers.get("range");
    const ifRange = req.headers.get("if-range");
    if (range && ifRange && ifRange !== etag && ifRange !== lastModified) range = null;
    if (range && (!/^bytes=\d*-\d*$/.test(range.trim()) || size == null)) range = null;

    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");
    const headers: Record<string, string> = {
      "Content-Type": meta.mimeType || "application/octet-stream",
      "Content-Disposition": `${req.nextUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
    };
    if (etag) headers["ETag"] = etag;
    if (lastModified) headers["Last-Modified"] = lastModified;

    if (headOnly) {
      if (size != null) headers["Content-Length"] = String(size);
      return new Response(null, { status: 200, headers });
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: range ? { ...auth, Range: range } : auth, cache: "no-store" }
    );

    if (res.status === 416) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size ?? "*"}` } });
    }
    if (!res.ok || !res.body) return new NextResponse("Not found", { status: 404 });

    // Drive answers 206 for an honored range, 200 if it chose to send it all.
    const partial = res.status === 206;
    const cr = res.headers.get("content-range");
    if (partial && cr) headers["Content-Range"] = cr;
    const len = res.headers.get("content-length");
    if (len) headers["Content-Length"] = len;
    else if (!partial && size != null) headers["Content-Length"] = String(size);

    return new Response(res.body, { status: partial ? 206 : 200, headers });
  } catch {
    return new NextResponse("Failed", { status: 500 });
  }
}
