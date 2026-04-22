// Client-side Drive upload helper.
//
// Always uses the chunked proxy path via /api/upload-chunk. Direct browser
// → Drive PUT was tried first historically, but it always fails CORS on
// service-account-impersonated session URLs (even after preflight passes).
// Skipping it cleans up the console and saves a round trip.
//
// Each 4MB chunk streams through our server to Drive using Content-Range
// resumable semantics. Returns drive_file_id once Drive finalizes.

export type UploadResult = { drive_file_id: string; web_view_link?: string | null };

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB — under Vercel's body limit

export async function uploadFileToDriveSession(
  uploadUrl: string,
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<UploadResult> {
  const mime = file.type || "application/octet-stream";
  return await uploadChunked(uploadUrl, file, mime, onProgress);
}

async function uploadChunked(
  uploadUrl: string,
  file: File,
  mime: string,
  onProgress?: (done: number, total: number) => void
): Promise<UploadResult> {
  const total = file.size;
  let start = 0;
  while (start < total) {
    const end = Math.min(start + CHUNK_SIZE, total);
    const chunk = file.slice(start, end);
    const body = await chunk.arrayBuffer();

    const res = await fetch("/api/upload-chunk", {
      method: "POST",
      headers: {
        "Content-Type": mime,
        "X-Upload-URL": uploadUrl,
        "X-Chunk-Start": String(start),
        "X-Chunk-Total": String(total),
      },
      body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Chunk ${start}-${end} failed (${res.status})`);
    }
    const data = await res.json();
    if (onProgress) onProgress(end, total);
    if (data.done) {
      return { drive_file_id: data.file.id, web_view_link: data.file.webViewLink || null };
    }
    // 308 — continue with next chunk
    // Drive tells us what range it actually received; we advance from there.
    const ranged = data.range as string | undefined; // "bytes=0-N"
    if (ranged) {
      const m = ranged.match(/bytes=(\d+)-(\d+)/);
      if (m) {
        start = Number(m[2]) + 1;
        continue;
      }
    }
    start = end;
  }
  throw new Error("Upload loop exited without completion");
}
