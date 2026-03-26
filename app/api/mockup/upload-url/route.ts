import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getItemFolderId, createResumableUpload } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientName, projectTitle, itemName, files } = await req.json();

    if (!clientName || !projectTitle || !itemName || !files?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get or create the Drive folder
    const folderId = await getItemFolderId(clientName, projectTitle, itemName);

    // Create resumable upload URLs for each file
    const uploads = [];
    for (const f of files) {
      const uploadUrl = await createResumableUpload(folderId, f.fileName, f.mimeType);
      uploads.push({ key: f.key, uploadUrl, fileName: f.fileName, mimeType: f.mimeType });
    }

    return NextResponse.json({ uploads, folderId });
  } catch (e: any) {
    console.error("Upload URL error:", e);
    return NextResponse.json({ error: e.message || "Failed to create upload URLs" }, { status: 500 });
  }
}
