export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET /api/cron/sweep-orphan-uploads
//
// Nightly cleanup for the intake-uploads bucket. Every file the user
// uploads through /start lands in `intake-uploads/<sessionId>/<filename>`.
// If they never submit, or remove a file mid-flow without us catching
// the DELETE call, the bytes sit there forever.
//
// This sweeper:
//   1. Lists every session folder in the bucket
//   2. Pulls the set of paths still referenced by intake_submissions
//   3. Deletes any object that's (a) not referenced and (b) older
//      than 24 hours (so an in-flight intake isn't blown away)
//
// Protected by CRON_SECRET. Returns counts of inspected/deleted.

const BUCKET = "intake-uploads";
const GRACE_HOURS = 24;

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = admin();

    // 1. Gather every file path referenced by an intake submission so
    //    we never delete something a row is pointing at.
    const { data: submissions, error: subErr } = await (sb
      .from("intake_submissions") as any)
      .select("files");
    if (subErr) {
      return NextResponse.json({ error: subErr.message }, { status: 500 });
    }
    const referencedPaths = new Set<string>();
    for (const row of submissions || []) {
      for (const f of row.files || []) {
        if (f?.path) referencedPaths.add(f.path);
      }
    }

    // 2. List every session folder, then every file inside it.
    const { data: sessionFolders, error: listErr } = await sb.storage
      .from(BUCKET)
      .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 });
    }

    const cutoff = Date.now() - GRACE_HOURS * 60 * 60 * 1000;
    let inspected = 0;
    let deleted = 0;
    const toDelete: string[] = [];

    for (const folder of sessionFolders || []) {
      // Top-level entries are folders (sessionIds). Skip anything
      // that already looks like a file at the root.
      if (!folder?.name || folder.name.includes(".")) continue;
      const sessionPath = folder.name;

      const { data: files } = await sb.storage
        .from(BUCKET)
        .list(sessionPath, { limit: 1000 });
      for (const file of files || []) {
        if (!file?.name) continue;
        inspected++;
        const fullPath = `${sessionPath}/${file.name}`;
        if (referencedPaths.has(fullPath)) continue;
        // Supabase returns created_at as ISO string on storage objects.
        const createdAt = file.created_at ? Date.parse(file.created_at) : 0;
        if (!createdAt || createdAt > cutoff) continue;
        toDelete.push(fullPath);
      }
    }

    // 3. Batch remove (Supabase accepts up to 1000 paths at a time).
    while (toDelete.length) {
      const batch = toDelete.splice(0, 1000);
      const { error: delErr } = await sb.storage.from(BUCKET).remove(batch);
      if (delErr) {
        console.error("[sweep-orphan-uploads] remove failed:", delErr.message);
        break;
      }
      deleted += batch.length;
    }

    return NextResponse.json({
      ok: true,
      inspected,
      deleted,
      referenced: referencedPaths.size,
      graceHours: GRACE_HOURS,
    });
  } catch (e: any) {
    console.error("[sweep-orphan-uploads]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Sweep failed" }, { status: 500 });
  }
}
