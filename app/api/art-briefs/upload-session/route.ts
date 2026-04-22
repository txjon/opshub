import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createResumableUploadSession } from "@/lib/drive-resumable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_KINDS = ["reference", "wip", "final", "client_intake", "print_ready"];

// POST — HPD creates a resumable upload session for a brief file.
// Returns a Drive upload URL; client PUTs the bytes directly (bypasses
// Vercel's body size limit). Register completion via upload-session/complete.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id, file_name, mime_type, kind } = await req.json();
    if (!brief_id) return NextResponse.json({ error: "brief_id required" }, { status: 400 });
    if (!file_name) return NextResponse.json({ error: "file_name required" }, { status: 400 });
    const k = (kind || "reference").toLowerCase();
    if (!ALLOWED_KINDS.includes(k)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });

    const { data: brief } = await supabase
      .from("art_briefs")
      .select("id, title, clients(name)")
      .eq("id", brief_id)
      .single();
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    const clientName = (brief as any).clients?.name || "Unassigned";
    const title = (brief as any).title || (brief as any).id;

    // Nested: OpsHub Files / Art Studio / {Client} / {Brief}
    const { uploadUrl, folderId } = await createResumableUploadSession({
      folderSegments: ["Art Studio", clientName, title],
      fileName: file_name,
      mimeType: mime_type || "application/octet-stream",
    });

    return NextResponse.json({ uploadUrl, folderId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
