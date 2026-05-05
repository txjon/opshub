import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createResumableUploadSession } from "@/lib/drive-resumable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// POST /api/portal/client/[token]/proposals/upload-session
// Body: { file_name: string, mime_type?: string }
//
// Returns a Drive resumable upload URL so the browser can PUT the bytes
// directly (bypasses Vercel's body-size limit). The client then calls
// POST /proposals to finalize the record with the returned drive_file_id.
//
// Folder layout: OpsHub Files / Client Proposals / {Client Name}
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await db
      .from("clients")
      .select("id, name")
      .eq("portal_token", params.token)
      .single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { file_name, mime_type } = await req.json();
    if (!file_name) return NextResponse.json({ error: "file_name required" }, { status: 400 });

    const clientName = (client as any).name || "Unknown Client";
    const { uploadUrl, folderId } = await createResumableUploadSession({
      folderSegments: ["Client Proposals", clientName],
      fileName: file_name,
      mimeType: mime_type || "application/octet-stream",
    });

    return NextResponse.json({ uploadUrl, folderId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
