export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getItemFolderId, uploadFile, deleteFile } from "@/lib/google-drive";

// Upload a file
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const itemId = formData.get("itemId") as string;
    const stage = formData.get("stage") as string;
    const clientName = formData.get("clientName") as string;
    const projectTitle = formData.get("projectTitle") as string;
    const itemName = formData.get("itemName") as string;
    const notes = formData.get("notes") as string | null;

    if (!file || !itemId || !stage || !clientName || !projectTitle || !itemName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get or create the Google Drive folder for this item
    const folderId = await getItemFolderId(clientName, projectTitle, itemName);

    // Upload to Google Drive
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadFile(folderId, file.name, file.type, buffer);

    // Save metadata to database
    const { data, error } = await supabase.from("item_files").insert({
      item_id: itemId,
      file_name: file.name,
      stage,
      drive_file_id: result.fileId,
      drive_link: result.webViewLink,
      mime_type: file.type,
      file_size: file.size,
      approval: stage === "proof" ? "pending" : "none",
      notes: notes || null,
      uploaded_by: user.id,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // If this is a print-ready file, auto-update the item's drive_link for PO
    if (stage === "print_ready") {
      await supabase.from("items").update({ drive_link: result.webViewLink }).eq("id", itemId);
    }

    return NextResponse.json({ success: true, file: data });
  } catch (e: any) {
    console.error("File upload error:", e);
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: 500 });
  }
}

// List files for an item
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const itemId = req.nextUrl.searchParams.get("itemId");
    if (!itemId) return NextResponse.json({ error: "Missing itemId" }, { status: 400 });

    const { data, error } = await supabase
      .from("item_files")
      .select("*")
      .eq("item_id", itemId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ files: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to load files" }, { status: 500 });
  }
}

// Delete a file
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fileId, driveFileId } = await req.json();
    if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });

    // Delete from Google Drive
    if (driveFileId) {
      try { await deleteFile(driveFileId); } catch (e) { /* file may already be gone */ }
    }

    // Delete from database
    await supabase.from("item_files").delete().eq("id", fileId);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Delete failed" }, { status: 500 });
  }
}

// Update approval status
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fileId, approval, notes } = await req.json();
    if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });

    const updates: any = {};
    if (approval) {
      updates.approval = approval;
      if (approval === "approved") updates.approved_at = new Date().toISOString();
    }
    if (notes !== undefined) updates.notes = notes;

    const { error } = await supabase.from("item_files").update(updates).eq("id", fileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Update failed" }, { status: 500 });
  }
}
