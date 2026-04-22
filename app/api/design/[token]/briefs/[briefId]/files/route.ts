import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getDriveToken, getReceivingFolderId } from "@/lib/drive-token";
import { notifyTeamServer, logJobActivityServer } from "@/lib/notify-server";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: designer } = await db.from("designers").select("id, active, name").eq("portal_token", token).single();
  if (!designer || !designer.active) return null;
  const { data: brief } = await db.from("art_briefs").select("id, title, assigned_designer_id, state, item_id, job_id").eq("id", briefId).single();
  if (!brief || brief.assigned_designer_id !== designer.id) return null;
  return { db, designer, brief };
}

// POST — designer uploads a WIP or final
export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  // wip → 1st_draft → revision → final  (four-stage designer flow)
  const kind = (formData.get("kind") as string) || "wip";
  // Optional note attached at upload time — lands as the uploader's
  // annotation on the new file (the per-image "caption" for this role).
  const note = ((formData.get("note") as string) || "").trim() || null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!["wip", "first_draft", "revision", "final"].includes(kind)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });

  // Upload to Drive
  const token = await getDriveToken();
  const folderId = await getReceivingFolderId(token, `Art Brief Work/${ctx.brief.title || ctx.brief.id}`);

  const buffer = Buffer.from(await file.arrayBuffer());
  const boundary = "design_" + Date.now();
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(metaPart + filePart), buffer, Buffer.from(closing)]);

  const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const driveFile = await uploadRes.json();
  if (!driveFile.id) return NextResponse.json({ error: "Drive upload failed" }, { status: 500 });

  await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  // Determine version for this kind
  const { count } = await ctx.db.from("art_brief_files").select("id", { count: "exact", head: true })
    .eq("brief_id", ctx.brief.id).eq("kind", kind);
  const version = (count || 0) + 1;

  const { data, error } = await ctx.db.from("art_brief_files").insert({
    brief_id: ctx.brief.id,
    file_name: file.name,
    drive_file_id: driveFile.id,
    drive_link: driveFile.webViewLink,
    mime_type: file.type,
    file_size: file.size,
    kind,
    version,
    uploader_role: "designer",
    designer_annotation: note,
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto state transition — maps upload kind to brief state:
  //   wip → wip_review (HPD sanity-checks before client sees it)
  //   first_draft → client_review (client formally reviews)
  //   revision → client_review (updated version, client reviews again)
  //   final → pending_prep (HPD prepares production file before products spawn)
  const now = new Date().toISOString();
  let newState = ctx.brief.state;
  if (kind === "wip") newState = "wip_review";
  if (kind === "first_draft") newState = "client_review";
  if (kind === "revision") newState = "client_review";
  if (kind === "final") newState = "pending_prep";

  await ctx.db.from("art_briefs").update({
    state: newState,
    version_count: version,
    updated_at: now,
  }).eq("id", ctx.brief.id);

  // NOTE: no more auto-promote to print_ready on final. Under the Client Hub flow,
  // designer final → pending_prep → HPD cleanup (CMYK, separations, Drive upload)
  // → production_ready is the moment print_ready gets written. A future HPD action
  // handles that transition.

  const kindLabel: Record<string, string> = {
    wip: "WIP", first_draft: "1st Draft", revision: "Revision", final: "FINAL",
  };
  const activityMsg = `Designer uploaded ${kindLabel[kind] || kind.toUpperCase()} v${version} for "${ctx.brief.title || "brief"}"`;

  await notifyTeamServer(activityMsg, kind === "final" ? "approval" : "production", ctx.brief.id, "art_brief");
  if (ctx.brief.job_id) await logJobActivityServer(ctx.brief.job_id, activityMsg);

  return NextResponse.json({ file: data, state: newState });
}

// PATCH — designer updates their per-image annotation. Only designer_annotation
// is mutable from this surface; client + HPD annotations are edited on their
// own surfaces. File must belong to this brief.
export async function PATCH(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { fileId, designer_annotation } = await req.json();
  if (!fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });

  const { data: file } = await ctx.db.from("art_brief_files").select("id, brief_id").eq("id", fileId).single();
  if (!file || file.brief_id !== ctx.brief.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await ctx.db.from("art_brief_files")
    .update({
      designer_annotation: designer_annotation?.trim() || null,
      annotation_updated_at: new Date().toISOString(),
    })
    .eq("id", fileId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE — designer removes their own upload
export async function DELETE(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const fileId = req.nextUrl.searchParams.get("fileId");
  if (!fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });

  // Only allow deleting designer's own uploads
  const { data: file } = await ctx.db.from("art_brief_files").select("id, uploader_role, drive_file_id").eq("id", fileId).eq("brief_id", ctx.brief.id).single();
  if (!file || file.uploader_role !== "designer") return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  if (file.drive_file_id) {
    try {
      const token = await getDriveToken();
      await fetch(`https://www.googleapis.com/drive/v3/files/${file.drive_file_id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }

  await ctx.db.from("art_brief_files").delete().eq("id", fileId);
  return NextResponse.json({ success: true });
}
