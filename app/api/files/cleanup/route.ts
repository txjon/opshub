export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { renameItemFolder, archiveItemFolder, archiveProjectFolder } from "@/lib/drive-cleanup";

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

    // ── Archive item folder + soft delete ──
    if (action === "archive-item") {
      if (!clientName || !projectTitle || !itemName || !itemId) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      }
      // Archive Drive folder
      const driveSuccess = await archiveItemFolder(clientName, projectTitle, itemName);

      // Soft delete: mark item as deleted (keep record)
      await admin.from("items").update({ status: "deleted", pipeline_stage: "deleted" }).eq("id", itemId);

      // Mark all item_files as deleted
      await admin.from("item_files").update({ stage: "archived" }).eq("item_id", itemId);

      return NextResponse.json({ success: true, driveArchived: driveSuccess, action: "archive-item" });
    }

    // ── Archive project folder + soft delete ──
    if (action === "archive-project") {
      if (!clientName || !projectTitle || !jobId) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      }
      // Archive Drive folder
      const driveSuccess = await archiveProjectFolder(clientName, projectTitle);

      // Soft delete: mark job as cancelled
      await admin.from("jobs").update({ phase: "cancelled" }).eq("id", jobId);

      // Log activity
      await admin.from("job_activity").insert({
        job_id: jobId, user_id: user.id, type: "auto",
        message: "Project archived — files moved to Drive _Archive folder",
      });

      return NextResponse.json({ success: true, driveArchived: driveSuccess, action: "archive-project" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    console.error("[Drive Cleanup Error]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
