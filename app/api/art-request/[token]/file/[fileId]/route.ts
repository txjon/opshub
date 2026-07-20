export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { proxyDriveFile } from "@/lib/drive-proxy";

// Token-scoped file proxy for the public art gallery. The URL carries the
// art_requests token + the item_files.id (NOT the Drive id — that never
// reaches the browser). We verify the file is in this request's shared set
// before serving, so a designer can only ever pull the files they were sent.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; fileId: string }> }
) {
  const { token, fileId } = await params;
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: reqRow } = await admin
    .from("art_requests")
    .select("file_ids")
    .eq("token", token)
    .single();
  if (!reqRow) return new NextResponse("Not found", { status: 404 });

  // Authorization: the requested file must be in this request's shared set.
  const shared: string[] = (reqRow as any).file_ids || [];
  if (!shared.includes(fileId)) return new NextResponse("Not found", { status: 404 });

  const { data: file } = await admin
    .from("item_files")
    .select("drive_file_id, item_id, stage, superseded_at")
    .eq("id", fileId)
    .single();
  if (!file) return new NextResponse("Not found", { status: 404 });

  // A proof shared BEFORE a re-bake points at a superseded row whose Drive
  // file was deleted — serve the item's LIVE file of the same stage instead,
  // so old request links keep working after proofs refresh.
  let driveId = (file as any).drive_file_id as string | null;
  if ((file as any).superseded_at) {
    const { data: live } = await admin
      .from("item_files")
      .select("drive_file_id")
      .eq("item_id", (file as any).item_id)
      .eq("stage", (file as any).stage)
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (live?.[0]?.drive_file_id) driveId = live[0].drive_file_id;
  }
  if (!driveId) return new NextResponse("Not found", { status: 404 });

  try {
    return await proxyDriveFile(driveId, {
      thumb: req.nextUrl.searchParams.get("thumb") === "1",
      download: req.nextUrl.searchParams.get("dl") === "1",
      size: parseInt(req.nextUrl.searchParams.get("size") || "0", 10) || 0,
    });
  } catch (err: any) {
    console.error("[art-request/file] failed for", fileId, err?.message || err);
    return new NextResponse("Failed", { status: 500 });
  }
}
