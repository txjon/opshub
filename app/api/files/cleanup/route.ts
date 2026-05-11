export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { renameItemFolder, deleteItemFolder, deleteProjectFolder } from "@/lib/drive-cleanup";
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
      // Delete Drive folder (goes to Drive trash — 30 day recovery)
      const driveSuccess = await deleteItemFolder(clientName, projectTitle, itemName);

      // Delete item files from DB
      await admin.from("item_files").delete().eq("item_id", itemId);

      return NextResponse.json({ success: true, driveDeleted: driveSuccess, action: "archive-item" });
    }

    // ── Delete project folder + mark cancelled ──
    if (action === "archive-project") {
      if (!jobId) {
        return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
      }

      // Prefer the stashed Drive folder id — survives renames. Fall back
      // to the legacy path-based lookup only when the row never had any
      // uploads (id is null).
      let driveSuccess = false;
      const { data: job } = await admin
        .from("jobs")
        .select("drive_folder_id, title, clients:client_id(name)")
        .eq("id", jobId)
        .maybeSingle();
      const stashedId = (job as any)?.drive_folder_id;
      if (stashedId) {
        driveSuccess = await trashDriveFolder(stashedId);
      } else if ((job as any)?.title && (job as any)?.clients?.name) {
        // Legacy fallback when the project predates the stash migration.
        driveSuccess = await deleteProjectFolder((job as any).clients.name, (job as any).title);
      } else if (clientName && projectTitle) {
        driveSuccess = await deleteProjectFolder(clientName, projectTitle);
      }

      // Mark job as cancelled
      await admin.from("jobs").update({ phase: "cancelled" }).eq("id", jobId);

      // Log activity
      await admin.from("job_activity").insert({
        job_id: jobId, user_id: user.id, type: "auto",
        message: "Project deleted — files removed from Drive",
      });

      return NextResponse.json({ success: true, driveDeleted: driveSuccess, action: "archive-project" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("[Drive Cleanup Error]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
