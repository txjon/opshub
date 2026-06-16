export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/intake/sign
//
// Mints fresh signed download URLs for intake file storage paths. The
// /intake inbox is a client component and the `intake-uploads` bucket is
// private, so the browser can't sign URLs directly — and stored URLs can
// expire on cold leads. The inbox sends the durable `path`s here on open
// and gets back short-lived URLs to render previews from.
//
// Auth-gated: only signed-in team members can resolve URLs.

const BUCKET = "intake-uploads";
const TTL = 60 * 60 * 6; // 6 hours — fresh each viewing session

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const paths: string[] = Array.isArray(body?.paths)
      ? body.paths.filter((p: any) => typeof p === "string")
      : [];
    if (!paths.length) return NextResponse.json({ urls: {} });

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const urls: Record<string, string> = {};
    await Promise.all(paths.map(async (p) => {
      // Constrain to the intake bucket; reject traversal / absolute paths.
      if (p.includes("..") || p.startsWith("/")) return;
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(p, TTL);
      if (data?.signedUrl) urls[p] = data.signedUrl;
    }));

    return NextResponse.json({ urls });
  } catch (e: any) {
    console.error("[intake/sign]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Sign failed" }, { status: 500 });
  }
}
