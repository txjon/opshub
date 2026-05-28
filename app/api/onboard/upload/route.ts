export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/onboard/upload
//
// Issues a signed upload URL so the browser can PUT the file directly to
// Supabase Storage — bypassing Vercel's 4.5MB serverless body limit.
//
// Flow:
//   1. Client POSTs { filename, contentType, session } here
//   2. We generate a signed upload URL + a signed download URL for the
//      same path (download URL works once the upload completes)
//   3. Client PUTs the raw file body to uploadUrl
//   4. Final intake submission references downloadUrl
//
// Bucket is private, auto-created on first call.

const BUCKET = "intake-uploads";
// Long-lived signed download URL so the team can access the file weeks
// after the lead lands. If a lead goes cold and gets revisited later, a
// stale URL doesn't block them.
const DOWNLOAD_TTL = 60 * 60 * 24 * 30; // 30 days

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Ensure the bucket exists. Idempotent.
async function ensureBucket(sb: ReturnType<typeof admin>) {
  const { data: list } = await sb.storage.listBuckets();
  if ((list || []).some(b => b.name === BUCKET)) return;
  await sb.storage.createBucket(BUCKET, { public: false });
}

// DELETE /api/onboard/upload — removes a single uploaded object from
// the intake-uploads bucket. Called when the user clicks × on an
// already-uploaded file in the intake form. Best-effort: a failure
// just means the orphan sits there until the nightly sweeper hits it.
//
// The body contains the storage path that was returned from the
// signed-upload response, so the caller is implicitly authenticated
// by knowing the random session prefix. We still constrain to the
// intake-uploads bucket so this can't be used to nuke other storage.
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const path = (body?.path || "").toString();
    if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });
    // Hard-stop on anything weird so nobody can ../escape into other
    // buckets or root. Paths are always "<sessionId>/<timestamped-name>".
    if (path.includes("..") || path.startsWith("/")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const sb = admin();
    const { error } = await sb.storage.from(BUCKET).remove([path]);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[onboard/upload DELETE]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const filename = (body?.filename || "").toString();
    const session = (body?.session || "").toString();

    if (!filename) {
      return NextResponse.json({ error: "Missing filename" }, { status: 400 });
    }

    const sb = admin();
    await ensureBucket(sb);

    // Random session prefix groups all files from a single intake.
    const sessionId = session || `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100);
    const path = `${sessionId}/${Date.now()}-${safeName}`;

    // Signed URL the browser will PUT to.
    const { data: uploadData, error: uploadErr } = await sb.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (uploadErr || !uploadData) {
      return NextResponse.json({ error: uploadErr?.message || "Upload URL failed" }, { status: 500 });
    }

    // Signed download URL — valid for 30 days, returns 404 until the
    // PUT lands, then starts working automatically.
    const { data: downloadData } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(path, DOWNLOAD_TTL);

    return NextResponse.json({
      ok: true,
      uploadUrl: uploadData.signedUrl,
      token: uploadData.token,
      path,
      downloadUrl: downloadData?.signedUrl || null,
      session: sessionId,
    });
  } catch (e: any) {
    console.error("[onboard/upload]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 });
  }
}
