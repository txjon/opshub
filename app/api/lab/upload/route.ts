import { NextRequest, NextResponse } from "next/server";
import { labDb, LAB_BUCKET } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { filename, contentType } → a signed upload URL the browser PUTs the raw
// file to (bypasses Vercel's 4.5MB body limit), plus the public URL to show it.
// The bucket is public, so the design renders straight from publicUrl.
export async function POST(req: NextRequest) {
  const { filename, contentType } = await req.json().catch(() => ({}));
  if (!filename) return NextResponse.json({ error: "filename required" }, { status: 400 });
  const sb = labDb();
  const safe = String(filename).replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const session = Math.random().toString(36).slice(2, 10);
  const path = `${session}/${Date.now()}-${safe}`;
  const { data, error } = await sb.storage.from(LAB_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Upload init failed" }, { status: 500 });
  const { data: pub } = sb.storage.from(LAB_BUCKET).getPublicUrl(path);
  return NextResponse.json({ uploadUrl: data.signedUrl, path, publicUrl: pub.publicUrl, contentType: contentType || "application/octet-stream" });
}
