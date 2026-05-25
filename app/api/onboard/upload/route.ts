export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/onboard/upload
//
// Public file upload endpoint for the /start intake form. Takes multipart
// FormData with a single "file" field, writes to Supabase Storage in the
// "intake-uploads" bucket, and returns a signed URL the form can stash
// in the final /api/onboard submission.
//
// Bucket is private — files only accessible via signed URLs. Auto-creates
// the bucket on first call so deployment doesn't require a manual setup
// step.

const BUCKET = "intake-uploads";
const MAX_BYTES = 25 * 1024 * 1024;     // 25MB per file
// Long-lived signed URL so the team can access the file weeks after
// the lead lands. If a lead goes cold and gets revisited later, a stale
// URL doesn't block them — but a long-running admin tool can always
// regenerate a fresh one from the saved storage path.
const SIGNED_URL_TTL = 60 * 60 * 24 * 30; // 30 days

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Ensure the bucket exists. Idempotent — returns quickly when it does,
// creates it (private) when it doesn't.
async function ensureBucket(sb: ReturnType<typeof admin>) {
  const { data: list } = await sb.storage.listBuckets();
  if ((list || []).some(b => b.name === BUCKET)) return;
  await sb.storage.createBucket(BUCKET, { public: false });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 25MB)" }, { status: 400 });
    }

    const sb = admin();
    await ensureBucket(sb);

    // Random session prefix prevents one submission from clashing with
    // another, and lets us group all files from a single intake later.
    const session = form.get("session")?.toString() || `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100);
    const path = `${session}/${Date.now()}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    const { data: url } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);

    return NextResponse.json({
      ok: true,
      path,
      url: url?.signedUrl || null,
      filename: file.name,
      size: file.size,
      session,
    });
  } catch (e: any) {
    console.error("[onboard/upload]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 });
  }
}
