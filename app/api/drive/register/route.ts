import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteDriveFileIfUnreferenced } from "@/lib/google-drive-refs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fileId, webViewLink, folderLink, fileName, mimeType, fileSize, itemId, stage, notes, preserveApproval } = await req.json();

    if (!fileId || !itemId || !stage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Overwrite behavior differs by stage:
    // - proof: mark superseded_at (preserve DB row for history + counters) and
    //   delete the old Drive file. Project folder is the physical archive.
    // - mockup: delete DB row + Drive file (no history needed).
    let replacedRevision = false;
    // preserveApproval (proof only): the caller re-baked an UNCHANGED proof
    // purely because the PDF renderer version bumped — the client approved
    // this exact content, so the new row inherits the old approval instead
    // of resetting to pending (which would silently re-close lifecycle gates
    // on mid-flight jobs).
    let carriedApproval: string | null = null;
    let carriedApprovedAt: string | null = null;
    if (stage === "proof") {
      const { data: existing } = await supabase
        .from("item_files")
        .select("id, drive_file_id, approval, approved_at")
        .eq("item_id", itemId)
        .eq("stage", "proof")
        .is("superseded_at", null);
      const now = new Date().toISOString();
      for (const old of (existing || []) as any[]) {
        if (old.approval === "revision_requested") replacedRevision = true;
        if (preserveApproval && old.approval && !carriedApproval) {
          carriedApproval = old.approval;
          carriedApprovedAt = old.approved_at || null;
        }
        // Mark superseded FIRST so the ref-count below doesn't count this row,
        // then delete the Drive file ONLY if no OTHER item still shares it
        // (duplicated / re-ordered items share drive_file_ids).
        await supabase.from("item_files").update({ superseded_at: now }).eq("id", old.id);
        if (old.drive_file_id) await deleteDriveFileIfUnreferenced(old.drive_file_id, old.id);
      }
    } else if (stage === "mockup") {
      const { data: existing } = await supabase.from("item_files").select("id, drive_file_id").eq("item_id", itemId).eq("stage", "mockup");
      for (const old of (existing || [])) {
        // Delete the Drive file only if no other item shares it — otherwise a
        // new mockup on a DUPLICATE would wipe the original's mockup.
        if (old.drive_file_id) await deleteDriveFileIfUnreferenced(old.drive_file_id, old.id);
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
      approval: stage === "proof" ? (carriedApproval || "pending") : "none",
      approved_at: carriedApprovedAt,
      // A carried-forward proof has no NEW content — nothing to re-send.
      revision_pending_send: carriedApproval ? false : replacedRevision,
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
