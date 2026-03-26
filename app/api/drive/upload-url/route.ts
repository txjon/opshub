import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getItemFolderId, uploadFile } from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 60;

// Accepts small base64 files, uploads to Google Drive, returns file records
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientName, projectTitle, itemName, files } = await req.json();
    // files: [{ fileName, mimeType, base64, stage }]

    if (!clientName || !projectTitle || !itemName || !files?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const folderId = await getItemFolderId(clientName, projectTitle, itemName);

    const results = [];
    for (const f of files) {
      const buffer = Buffer.from(f.base64, "base64");
      const driveFile = await uploadFile(folderId, f.fileName, f.mimeType, buffer);

      const { data, error } = await supabase.from("item_files").insert({
        item_id: f.itemId,
        file_name: f.fileName,
        stage: f.stage,
        drive_file_id: driveFile.fileId,
        drive_link: driveFile.webViewLink,
        mime_type: f.mimeType,
        file_size: buffer.length,
        approval: f.stage === "proof" ? "pending" : "none",
        uploaded_by: user.id,
      }).select("*").single();

      if (error) throw new Error(error.message);
      results.push(data);
    }

    return NextResponse.json({ success: true, files: results });
  } catch (e: any) {
    console.error("Drive upload error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
