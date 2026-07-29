export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getItemFolderId, uploadFile } from "@/lib/google-drive";
import { deleteDriveFileIfUnreferenced } from "@/lib/google-drive-refs";
import { reopenProofApproval } from "@/lib/proof-revision";

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

    // Proof overwrite: supersede active proofs for this item + delete their
    // Drive files (DB row kept for history + counter accuracy).
    // Did this upload replace a proof the client had requested changes on?
    // If so, flag the new proof "revision_pending_send" so the Approvals tab +
    // command center nudge staff to send the revised proof back to the client.
    let replacedRevision = false;
    if (stage === "proof") {
      const { data: existing } = await supabase
        .from("item_files")
        .select("id, drive_file_id, approval")
        .eq("item_id", itemId)
        .eq("stage", "proof")
        .is("superseded_at", null);
      const now = new Date().toISOString();
      for (const old of (existing || [])) {
        if (old.approval === "revision_requested") replacedRevision = true;
        // Supersede FIRST, then delete the Drive file only if no OTHER item
        // still references it (duplicated / re-ordered items share files).
        await supabase.from("item_files").update({ superseded_at: now }).eq("id", old.id);
        if (old.drive_file_id) await deleteDriveFileIfUnreferenced(old.drive_file_id, old.id);
      }
    }

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
      revision_pending_send: replacedRevision,
      notes: notes || null,
      uploaded_by: user.id,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-set item's drive_link to folder (printer needs all files: print file, mockup, proof)
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    await supabase.from("items").update({ drive_link: folderUrl }).eq("id", itemId);

    // A new proof over an approved one reopens the gate (no-op if not approved).
    if (stage === "proof") await reopenProofApproval(supabase, itemId);

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

    const files = data || [];
    if (files.length === 0) return NextResponse.json({ files: [] });

    // Verify files still exist in Drive — clean up orphans
    const driveIds = files.filter(f => f.drive_file_id).map(f => f.drive_file_id);
    if (driveIds.length > 0) {
      try {
        const { getDriveToken } = await import("@/lib/drive-token");
        const token = await getDriveToken();
        const checks = await Promise.all(driveIds.map(async (id) => {
          try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return { id, exists: false };
            const data = await res.json();
            return { id, exists: !data.trashed };
          } catch { return { id, exists: false }; }
        }));
        const gone = new Set(checks.filter(c => !c.exists).map(c => c.id));
        if (gone.size > 0) {
          // Hide files whose Drive object is missing from THIS response, but do
          // NOT delete the item_files rows. Auto-deleting on a Drive-existence
          // check is how a shared file's disappearance permanently erased the
          // record (and a transient Drive 404 / rate-limit could too). Keep the
          // row; a re-upload or admin restore can re-link it.
          return NextResponse.json({ files: files.filter(f => !gone.has(f.drive_file_id)) });
        }
      } catch { /* Drive check failed — return files as-is */ }
    }

    return NextResponse.json({ files });
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

    // Delete the Drive file only if no OTHER item_files row still references it
    // (duplicated / re-ordered items share drive_file_ids). Exclude this row so
    // its own reference doesn't block its deletion.
    if (driveFileId) {
      await deleteDriveFileIfUnreferenced(driveFileId, fileId);
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
