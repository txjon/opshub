// Client-side Drive upload helper.
//
// Strategy: try a direct browser → Drive PUT first (single round-trip, fast).
// If that fails for any reason (usually CORS on service-account sessions),
// fall back to chunked uploads via /api/upload-chunk which streams each
// chunk through our server.
//
// Either path ends with the drive_file_id being passed to the surface's
// upload-session/complete endpoint to register metadata.

export type UploadResult = { drive_file_id: string; web_view_link?: string | null };

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB — under Vercel's body limit

export async function uploadFileToDriveSession(
  uploadUrl: string,
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<UploadResult> {
  const mime = file.type || "application/octet-stream";

  // Try direct PUT first — fastest path when CORS works
  try {
    const direct = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: file,
    });
    if (direct.ok) {
      const data = await direct.json();
      if (onProgress) onProgress(file.size, file.size);
      return { drive_file_id: data.id, web_view_link: data.webViewLink || null };
    }
    // fall through to chunked proxy
  } catch {
    // Most likely CORS or network. Fall through to proxy.
  }

  // Chunked fallback via /api/upload-chunk
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
