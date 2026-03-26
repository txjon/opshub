import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { finalizeUpload } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { files } = await req.json();

    if (!files?.length) {
      return NextResponse.json({ error: "No files to register" }, { status: 400 });
    }

    const results = [];
    for (const f of files) {
      const { webViewLink } = await finalizeUpload(f.driveFileId);

      const { data, error } = await supabase.from("item_files").insert({
        item_id: f.itemId,
        file_name: f.fileName,
        stage: f.stage,
        drive_file_id: f.driveFileId,
        drive_link: webViewLink,
        mime_type: f.mimeType,
        file_size: f.fileSize,
        approval: f.stage === "proof" ? "pending" : "none",
        uploaded_by: user.id,
      }).select("*").single();

      if (error) throw new Error(error.message);
      results.push(data);
    }

    return NextResponse.json({ success: true, files: results });
  } catch (e: any) {
    console.error("Register error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
