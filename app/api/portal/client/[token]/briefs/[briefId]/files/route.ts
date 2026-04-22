import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getDriveToken, getReceivingFolderId } from "@/lib/drive-token";
import { notifyTeamServer, logJobActivityServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", token).single();
  if (!client) return null;
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, client_id, job_id")
    .eq("id", briefId)
    .single();
  if (!brief || brief.client_id !== client.id) return null;
  return { db, client, brief };
}

// POST — client uploads a reference image or supporting file.
// Always kind='reference', uploader_role='client'. No state changes — this is
// informational input to HPD + designer, not a state-advancing event.
export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  // Upload to Drive
  const token = await getDriveToken();
  const folderId = await getReceivingFolderId(token, `Art Brief Work/${ctx.brief.title || ctx.brief.id}`);

  const buffer = Buffer.from(await file.arrayBuffer());
  const boundary = "client_" + Date.now();
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

  const { data, error } = await ctx.db.from("art_brief_files").insert({
    brief_id: ctx.brief.id,
    file_name: file.name,
    drive_file_id: driveFile.id,
    drive_link: driveFile.webViewLink,
    mime_type: file.type,
    file_size: file.size,
    kind: "reference",
    version: 1,
    uploader_role: "client",
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify HPD + log
  try {
    await notifyTeamServer(`Client added reference to "${ctx.brief.title || 'brief'}"`, "mention", ctx.brief.id, "art_brief");
    if (ctx.brief.job_id) await logJobActivityServer(ctx.brief.job_id, `Client uploaded reference on ${ctx.brief.title || "brief"}`);
  } catch {}

  return NextResponse.json({ file: data });
}
