// Server-side PSD preview generator. Drive auto-thumbnails small images
// fine but breaks on layered PSDs / very large files, leaving holes in
// the tile mosaic. We download the PSD, parse the merged composite with
// ag-psd (already in deps for the mockup generator), encode it to PNG
// with pngjs (pure JS — no native binaries, Vercel-safe), and upload
// the PNG back to the same Drive folder. Caller stores the preview's
// drive_file_id alongside the original on art_brief_files.
//
// Skip if the file isn't a PSD; AI/EPS/big TIFFs need different parsers
// and can land here in a follow-up.

import { readPsd, initializeCanvas } from "ag-psd";
import { PNG } from "pngjs";
import { getDriveToken } from "@/lib/drive-token";
import { setFilePublicReadable } from "@/lib/drive-resumable";

const MAX_PSD_BYTES = 200 * 1024 * 1024; // 200 MB cap — beyond that, skip
const PREVIEW_MAX_DIM = 1600; // downscale enormous files to this max edge

// Pure-JS canvas stub for ag-psd. Native `canvas` ships a binary that
// Vercel won't deploy, so we hand ag-psd a minimal HTMLCanvasElement-
// shaped object that just stores RGBA bytes. ag-psd uses it for
// putImageData/getImageData when it decodes the composite — no real
// rendering needed.
let canvasInitialized = false;
function ensureCanvasInitialized() {
  if (canvasInitialized) return;
  canvasInitialized = true;
  initializeCanvas((width: number, height: number) => {
    const data = new Uint8ClampedArray(width * height * 4);
    const ctx: any = {
      canvas: null as any,
      createImageData(w: number, h: number) {
        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      },
      putImageData(img: any, dx: number, dy: number) {
        const x = dx | 0, y = dy | 0;
        for (let row = 0; row < img.height; row++) {
          const ty = y + row;
          if (ty < 0 || ty >= height) continue;
          const srcStart = row * img.width * 4;
          const dstStart = (ty * width + x) * 4;
          const len = Math.min(img.width, width - x) * 4;
          if (len > 0) data.set(img.data.subarray(srcStart, srcStart + len), dstStart);
        }
      },
      getImageData(sx: number, sy: number, sw: number, sh: number) {
        const out = new Uint8ClampedArray(sw * sh * 4);
        for (let row = 0; row < sh; row++) {
          const ty = sy + row;
          if (ty < 0 || ty >= height) continue;
          const srcStart = (ty * width + sx) * 4;
          const dstStart = row * sw * 4;
          const len = Math.min(sw, width - sx) * 4;
          if (len > 0) out.set(data.subarray(srcStart, srcStart + len), dstStart);
        }
        return { width: sw, height: sh, data: out };
      },
      drawImage() { /* no-op — composite mode not used */ },
      fillRect() {}, fillStyle: "", globalCompositeOperation: "source-over",
      save() {}, restore() {}, translate() {}, transform() {}, setTransform() {}, resetTransform() {}, scale() {}, clip() {}, beginPath() {}, rect() {},
    };
    const canvas: any = {
      width, height,
      getContext: (t: string) => (t === "2d" ? ctx : null),
      toBuffer() { return Buffer.alloc(0); },
      _data: data,
    };
    ctx.canvas = canvas;
    return canvas;
  });
}

export function isPsdFile(fileName: string | null | undefined, mimeType: string | null | undefined): boolean {
  if (mimeType === "image/vnd.adobe.photoshop") return true;
  if (mimeType === "application/x-photoshop") return true;
  if (typeof fileName === "string" && /\.psd$/i.test(fileName)) return true;
  return false;
}

/**
 * Download a Drive file's bytes via the Drive API. Returns null if the
 * file is too big to safely process in a serverless function.
 */
async function downloadDriveFile(driveFileId: string, token: string): Promise<Uint8Array | null> {
  // First, peek at size so we don't pull a 1GB layered file into memory
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=size,parents`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  const size = parseInt(meta.size || "0", 10);
  if (size > MAX_PSD_BYTES) {
    console.warn(`[psd-preview] file ${driveFileId} too large (${size} bytes), skipping`);
    return null;
  }

  const dlRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!dlRes.ok) return null;
  const buf = await dlRes.arrayBuffer();
  return new Uint8Array(buf);
}

async function getDriveFileParents(driveFileId: string, token: string): Promise<string[]> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=parents`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.parents || [];
}

/**
 * Downscale RGBA pixels to fit within maxDim on the longest edge. Pure JS,
 * no canvas. Nearest-neighbor sample — quality is fine for tile thumbs.
 */
function downscaleRgba(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxDim: number,
): { data: Uint8Array; width: number; height: number } {
  if (width <= maxDim && height <= maxDim) {
    return { data: new Uint8Array(pixels), width, height };
  }
  const scale = maxDim / Math.max(width, height);
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(newW * newH * 4);
  for (let y = 0; y < newH; y++) {
    const srcY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(width - 1, Math.floor(x / scale));
      const si = (srcY * width + srcX) * 4;
      const di = (y * newW + x) * 4;
      out[di] = pixels[si];
      out[di + 1] = pixels[si + 1];
      out[di + 2] = pixels[si + 2];
      out[di + 3] = pixels[si + 3];
    }
  }
  return { data: out, width: newW, height: newH };
}

/**
 * Encode raw RGBA pixels to a PNG buffer using pngjs.
 */
function encodePng(pixels: Uint8Array, width: number, height: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const png = new PNG({ width, height });
    // pngjs expects the raw RGBA buffer in `png.data` (Buffer)
    png.data = Buffer.from(pixels);
    const chunks: Buffer[] = [];
    png.pack()
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
  });
}

/**
 * Upload a PNG buffer to Drive in the given folder via the multipart
 * upload endpoint. Returns the new file's id.
 */
async function uploadPngToDrive(
  pngBytes: Buffer,
  fileName: string,
  parentFolderId: string,
  token: string,
): Promise<string | null> {
  const boundary = "preview_" + Date.now();
  const metadata = JSON.stringify({
    name: fileName,
    parents: [parentFolderId],
    mimeType: "image/png",
  });
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
  );
  const filePart = Buffer.from(
    `--${boundary}\r\nContent-Type: image/png\r\n\r\n`,
  );
  const closing = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([metaPart, filePart, pngBytes, closing]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body as any,
    },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    console.error(`[psd-preview] upload failed: ${res.status} ${errText}`);
    return null;
  }
  const data = await res.json();
  return data.id || null;
}

/**
 * Generate a PNG preview for a PSD file in Drive and upload it to the
 * same parent folder. Returns the new preview's drive_file_id, or null
 * if anything along the way fails (caller falls back to whatever Drive
 * gives us).
 *
 * Idempotent enough for fire-and-forget — duplicates show up as separate
 * files in Drive, and the caller only stores the latest.
 */
export async function generatePsdPreview(
  driveFileId: string,
  originalFileName: string,
): Promise<string | null> {
  try {
    ensureCanvasInitialized();
    const token = await getDriveToken();

    const psdBytes = await downloadDriveFile(driveFileId, token);
    if (!psdBytes) return null;

    const psd = readPsd(psdBytes, {
      skipLayerImageData: true,
      skipThumbnail: false,
      useImageData: true, // raw RGBA, no canvas needed
    });

    // Prefer the embedded thumbnail when present — it's already a small
    // raster image and skips the composite render path entirely.
    let pixels: Uint8Array | Uint8ClampedArray | null = null;
    let width = 0;
    let height = 0;
    if (psd.imageData) {
      pixels = (psd.imageData as any).data || null;
      width = psd.imageData.width;
      height = psd.imageData.height;
    }
    if (!pixels && (psd as any).thumbnail) {
      const t = (psd as any).thumbnail;
      pixels = (t.data || t.image) ?? null;
      width = t.width;
      height = t.height;
    }
    if (!pixels || !width || !height) {
      console.warn(`[psd-preview] no composite data extracted from ${driveFileId}`);
      return null;
    }

    const scaled = downscaleRgba(pixels, width, height, PREVIEW_MAX_DIM);
    const pngBytes = await encodePng(scaled.data, scaled.width, scaled.height);

    const parents = await getDriveFileParents(driveFileId, token);
    const parentId = parents[0];
    if (!parentId) return null;

    const previewName = originalFileName.replace(/\.psd$/i, "") + "__preview.png";
    const previewId = await uploadPngToDrive(pngBytes, previewName, parentId, token);
    if (!previewId) return null;

    // Make publicly readable so the thumbnail URL works for portal viewers
    try { await setFilePublicReadable(previewId); } catch {}

    return previewId;
  } catch (e: any) {
    console.error(`[psd-preview] failed for ${driveFileId}:`, e?.message || e);
    return null;
  }
}
