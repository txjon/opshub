import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { approvedMocksZipStream } from "@/lib/line-sheet-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET → every client-approved (thumbs-up) mockup on the sheet, full res, one ZIP.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const user = await studioUser(supabase);
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const z = await approvedMocksZipStream(db, params.id);
    if (!z) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!z.count) return NextResponse.json({ error: "Nothing approved yet" }, { status: 404 });
    return new Response(z.stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(z.name)}`, "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[line-sheet-zip] failed", e?.message || e);
    return NextResponse.json({ error: "Couldn't build the ZIP" }, { status: 500 });
  }
}
