import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getDriveToken, getReceivingFolderId } from "@/lib/drive-token";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// POST — client uploads a reference image
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: brief } = await db.from("art_briefs").select("id, title").eq("client_intake_token", params.token).single();
    if (!brief) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const annotation = formData.get("annotation") as string | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    // Upload to Drive in a references subfolder (use Receiving-style helper for now)
    const token = await getDriveToken();
    const folderId = await getReceivingFolderId(token, `Art Brief References/${brief.title || brief.id}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const boundary = "intake_" + Date.now();
    const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
    const filePart = `--${boundary}\r\nContent-Type: ${file.type || "image/jpeg"}\r\n\r\n`;
    const closing = `\r\n--${boundary}--`;
    const body = Buffer.concat([Buffer.from(metaPart + filePart), buffer, Buffer.from(closing)]);

    const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    const driveFile = await uploadRes.json();
    if (!driveFile.id) return NextResponse.json({ error: "Drive upload failed" }, { status: 500 });

    // Public link
    await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });

    const { data, error } = await db.from("art_brief_files").insert({
      brief_id: brief.id,
      file_name: file.name,
      drive_file_id: driveFile.id,
      drive_link: driveFile.webViewLink,
      mime_type: file.type,
      file_size: file.size,
      kind: "reference",
      uploader_role: "client",
      client_annotation: annotation || null,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ file: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// DELETE — client removes a reference they uploaded
export async function DELETE(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const fileId = req.nextUrl.searchParams.get("fileId");
    if (!fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });

    const { data: brief } = await db.from("art_briefs").select("id").eq("client_intake_token", params.token).single();
    if (!brief) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { error } = await db.from("art_brief_files").delete().eq("id", fileId).eq("brief_id", brief.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
