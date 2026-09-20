export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { renameItemFolder, findItemFolder, findProjectFolder, trashFolderSafely } from "@/lib/drive-cleanup";
import { getDriveToken } from "@/lib/drive-token";

// Trash a Drive folder by id (sends to Drive trash — 30-day recovery).
async function trashDriveFolder(folderId: string): Promise<boolean> {
  try {
    const token = await getDriveToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    return res.ok;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { action, clientName, projectTitle, itemName, newName, jobId, itemId } = await req.json();
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // ── Rename item folder ──
    if (action === "rename-item") {
      if (!clientName || !projectTitle || !itemName || !newName) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      }
      const success = await renameItemFolder(clientName, projectTitle, itemName, newName);
      return NextResponse.json({ success, action: "rename-item" });
    }

    // ── Delete item folder + DB records ──
    if (action === "archive-item") {
      if (!clientName || !projectTitle || !itemName || !itemId) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      }
      // Prefer the stashed folder id (survives renames); fall back to the
      // legacy name path. Trash is REFERENCE-SAFE: a file a duplicate or
      // re-order still uses is left in place instead of going with the
      // folder (Phase 0, Sep 2026).
      const { data: itemRow } = await admin.from("items").select("drive_folder_id").eq("id", itemId).maybeSingle();
      let folderId: string | null = (itemRow as any)?.drive_folder_id || null;
      if (!folderId) folderId = await findItemFolder(clientName, projectTitle, itemName);
      let result = { trashedFiles: 0, keptFiles: 0, folderTrashed: false };
      if (folderId) result = await trashFolderSafely(folderId, { excludeItemIds: [itemId] });

      // Delete item files from DB
      await admin.from("item_files").delete().eq("item_id", itemId);

      return NextResponse.json({ success: true, driveDeleted: !!folderId, action: "archive-item", ...result });
    }

    // ── Delete project folder + mark cancelled ──
    if (action === "archive-project") {
      if (!jobId) {
        return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
      }

      // Prefer the stashed Drive folder id — survives renames. Fall back
      // to the legacy path-based lookup only when the row never had any
      // uploads (id is null).
      const { data: job } = await admin
        .from("jobs")
        .select("drive_folder_id, title, clients:client_id(name)")
        .eq("id", jobId)
        .maybeSingle();
      let folderId: string | null = (job as any)?.drive_folder_id || null;
      if (!folderId) {
        const cn = (job as any)?.clients?.name || clientName;
        const pt = (job as any)?.title || projectTitle;
        if (cn && pt) folderId = (await findProjectFolder(cn, pt))?.projectFolderId || null;
      }
      // Reference-safe: files this project's items share with re-orders or
      // duplicates in other projects stay put (Phase 0, Sep 2026).
      const { data: jobItems } = await admin.from("items").select("id").eq("job_id", jobId);
      const excludeItemIds = (jobItems || []).map((r: any) => r.id);
      let result = { trashedFiles: 0, keptFiles: 0, folderTrashed: false };
      if (folderId) result = await trashFolderSafely(folderId, { excludeItemIds });
      const driveSuccess = !!folderId;

      // Mark job as cancelled
      await admin.from("jobs").update({ phase: "cancelled" }).eq("id", jobId);

      // Log activity
      await admin.from("job_activity").insert({
        job_id: jobId, user_id: user.id, type: "auto",
        message: `Project deleted — ${result.trashedFiles} file${result.trashedFiles === 1 ? "" : "s"} moved to Drive trash${result.keptFiles ? `, ${result.keptFiles} kept (still used by another project)` : ""}`,
      });

      return NextResponse.json({ success: true, driveDeleted: driveSuccess, action: "archive-project", ...result });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("[Drive Cleanup Error]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
