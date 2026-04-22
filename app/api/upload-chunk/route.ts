import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/upload-chunk
//
// Streams one chunk of a file to a Google Drive resumable upload session.
// Used as a fallback when direct-from-browser PUT to Drive fails due to
// CORS (which happens with service-account-impersonated session URLs).
//
// Headers required:
//   X-Upload-URL     — the Drive session URL returned by upload-session
//   X-Chunk-Start    — byte offset of this chunk in the overall file
//   X-Chunk-Total    — total file size in bytes
//   Content-Type     — the file's actual mime type
// Body: raw binary chunk
//
// Each chunk must be ≤ 4MB so it fits inside Vercel's serverless body
// limit. Drive requires chunks be multiples of 256KB except the last one.
//
// Security: we only forward to Google's upload endpoint. No open proxy.

const ALLOWED_HOST_PREFIX = "https://www.googleapis.com/upload/drive/v3/";

export async function POST(req: NextRequest) {
  const uploadUrl = req.headers.get("x-upload-url");
  const startRaw = req.headers.get("x-chunk-start");
  const totalRaw = req.headers.get("x-chunk-total");
  const contentType = req.headers.get("content-type") || "application/octet-stream";

  if (!uploadUrl || !uploadUrl.startsWith(ALLOWED_HOST_PREFIX)) {
    return NextResponse.json({ error: "Invalid upload URL" }, { status: 400 });
  }
  const start = Number(startRaw);
  const total = Number(totalRaw);
  if (!Number.isFinite(start) || !Number.isFinite(total) || start < 0 || total <= 0) {
    return NextResponse.json({ error: "Invalid chunk metadata" }, { status: 400 });
  }

  const body = await req.arrayBuffer();
  const end = start + body.byteLength - 1;

  try {
    const driveRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Type": contentType,
      },
      body,
    });

    // 308 = more chunks expected (normal); 200/201 = finalized
    const status = driveRes.status;
    if (status === 308) {
      const range = driveRes.headers.get("range"); // e.g. "bytes=0-524287"
      return NextResponse.json({ done: false, status, range });
    }
    if (status === 200 || status === 201) {
      const data = await driveRes.json();
      return NextResponse.json({ done: true, status, file: data });
    }
    const text = await driveRes.text().catch(() => "");
    return NextResponse.json({ error: `Drive ${status}: ${text}` }, { status: 502 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Upload forwarding failed" }, { status: 500 });
  }
}
