import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteFile } from "@/lib/google-drive";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fileId, webViewLink, folderLink, fileName, mimeType, fileSize, itemId, stage, notes } = await req.json();

    if (!fileId || !itemId || !stage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Overwrite: delete existing files of the same stage for this item (proof, mockup)
    if (stage === "proof" || stage === "mockup") {
      const { data: existing } = await supabase.from("item_files").select("id, drive_file_id").eq("item_id", itemId).eq("stage", stage);
      for (const old of (existing || [])) {
        if (old.drive_file_id) { try { await deleteFile(old.drive_file_id); } catch {} }
        await supabase.from("item_files").delete().eq("id", old.id);
      }
    }

    const { data, error } = await supabase.from("item_files").insert({
      item_id: itemId,
      file_name: fileName,
      stage,
      drive_file_id: fileId,
      drive_link: webViewLink,
      mime_type: mimeType,
      file_size: fileSize,
      approval: stage === "proof" ? "pending" : "none",
      notes: notes || null,
      uploaded_by: user.id,
    }).select("*").single();

    if (error) throw new Error(error.message);

    // Auto-set item's drive_link to folder (used by PO PDF — printer needs all files)
    if (folderLink) {
      await supabase.from("items").update({ drive_link: folderLink }).eq("id", itemId);
    }

    return NextResponse.json({ success: true, file: data });
  } catch (e: any) {
    console.error("Register error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// Update item's drive_link (folder URL)
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { itemId, driveLink } = await req.json();
    if (!itemId || !driveLink) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    await supabase.from("items").update({ drive_link: driveLink }).eq("id", itemId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
