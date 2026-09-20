import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteDriveFileIfUnreferenced } from "@/lib/google-drive-refs";
import { supersedeSameNameFiles } from "@/lib/production-files";
import { reopenProofApproval } from "@/lib/proof-revision";

// Stages whose upload folder IS the item's art folder — the only uploads
// allowed to move items.drive_link (the PO's Production Files link).
const ART_STAGES = new Set(["mockup", "proof", "print_ready", "client_art", "vector"]);

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
        .select("id, drive_file_id, approval, approved_at, file_name")
        .eq("item_id", itemId)
        .eq("stage", "proof")
        .is("superseded_at", null);
      const now = new Date().toISOString();

      // AN APPROVED PROOF IS FROZEN (Sep 2026). It is the evidence of what the
      // client signed off, so it is never replaced and never deleted.
      // Measured before this rule: 22 approved proofs had been replaced, and in
      // 21 of those the approval carried onto the NEW file with the ORIGINAL
      // approval date — the record showed a document the client never saw.
      //
      // A re-bake (same content, newer renderer) is refused outright: the
      // freshly uploaded file is trashed and the approved one stands.
      const approved = (existing || []).find((f: any) => f.approval === "approved");
      if (approved && preserveApproval) {
        // Drop the orphan we were handed. If the trash fails, say so: a second
        // identically-named proof left in the folder is exactly the confusion
        // this whole effort exists to remove.
        const dropped = await deleteDriveFileIfUnreferenced(fileId);
        if (!dropped.deleted) console.error("[register] frozen proof: could not trash the rejected upload", fileId);
        return NextResponse.json({
          success: true, frozen: true,
          file: approved,
          message: "This proof is approved, so it was left as it is. A change to the art makes a new version.",
        });
      }

      for (const old of (existing || []) as any[]) {
        if (old.approval === "revision_requested") replacedRevision = true;
        if (preserveApproval && old.approval && !carriedApproval) {
          carriedApproval = old.approval;
          carriedApprovedAt = old.approved_at || null;
        }
        // Retire the old row. A proof that was APPROVED keeps its Drive file
        // forever — superseding it makes a new version, it does not erase the
        // one the client agreed to. Unapproved drafts still clean up.
        await supabase.from("item_files").update({ superseded_at: now }).eq("id", old.id);
        if (old.drive_file_id && old.approval !== "approved") {
          await deleteDriveFileIfUnreferenced(old.drive_file_id, old.id);
        }
      }
      // A new proof over an approved one starts unapproved, whatever the caller
      // asked for: the client has not seen this version.
      if (approved) { carriedApproval = null; carriedApprovedAt = null; }
    } else if (stage === "mockup") {
      const { data: existing } = await supabase.from("item_files").select("id, drive_file_id").eq("item_id", itemId).eq("stage", "mockup");
      for (const old of (existing || [])) {
        // Delete the Drive file only if no other item shares it — otherwise a
        // new mockup on a DUPLICATE would wipe the original's mockup.
        if (old.drive_file_id) await deleteDriveFileIfUnreferenced(old.drive_file_id, old.id);
        await supabase.from("item_files").delete().eq("id", old.id);
      }
    } else {
      // print_ready / client_art / vector: same file name = a new VERSION of
      // that file. Retire the old row so the vendor never sees two same-named
      // print files (HPD-2608-042 was printed from the stale one).
      await supersedeSameNameFiles(supabase, itemId, stage, fileName);
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

    // Auto-set item's drive_link to the folder the ART lives in (the PO's
    // "Production Files" button — the printer needs all files). ART stages
    // only: a packing-slip upload used to repoint every item at the job's
    // "Packing Slips" folder, and a later duplicate copied that pointer onto
    // a fresh PO (HPD-2609-002 → ICON: "no art files in the links", Sep 11).
    if (folderLink && ART_STAGES.has(stage)) {
      await supabase.from("items").update({ drive_link: folderLink }).eq("id", itemId);
    }

    // A genuine revision of an approved proof reopens the gate (no-op if not
    // approved). preserveApproval = unchanged re-bake → deliberately keep it.
    if (stage === "proof" && !preserveApproval) await reopenProofApproval(supabase, itemId);

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
