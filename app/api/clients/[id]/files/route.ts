export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadFile, deleteFile } from "@/lib/google-drive";
import { getDriveToken, getOrCreateNestedFolder } from "@/lib/drive-token";

// POST — upload a tax-exempt / W9 / MSA / other client-level document.
// Body: multipart form with `file`, optional `kind` (default
// "tax_exempt") and optional `notes`.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: client } = await supabase.from("clients").select("id, name").eq("id", params.id).single();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const kindRaw = (formData.get("kind") as string) || "tax_exempt";
    const notes = ((formData.get("notes") as string) || "").trim() || null;
    const kind = ["tax_exempt", "w9", "msa", "other"].includes(kindRaw) ? kindRaw : "tax_exempt";

    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    // Drive folder layout: OpsHub Files / Clients / {Client Name} / Tax Documents /
    const token = await getDriveToken();
    const folderName = kind === "tax_exempt" ? "Tax Documents"
      : kind === "w9" ? "W9"
      : kind === "msa" ? "MSAs"
      : "Other";
    const folderId = await getOrCreateNestedFolder(token, ["Clients", (client as any).name || "Unknown", folderName]);

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadFile(folderId, file.name, file.type || "application/octet-stream", buffer);

    const { data, error } = await supabase.from("client_files").insert({
      client_id: params.id,
      file_name: file.name,
      drive_file_id: result.fileId,
      drive_link: result.webViewLink,
      mime_type: file.type || null,
      file_size: file.size || null,
      kind,
      notes,
      uploaded_by: user.id,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ file: data });
  } catch (e: any) {
    console.error("[client-files POST]", e);
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: 500 });
  }
}

// GET — list all files on the client. Returns newest first.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("client_files")
    .select("id, file_name, drive_file_id, drive_link, mime_type, file_size, kind, notes, created_at")
    .eq("client_id", params.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ files: data || [] });
}

// DELETE — remove a single file by id (?fileId=...). Cleans up Drive
// best-effort; DB row goes either way.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const fileId = req.nextUrl.searchParams.get("fileId");
  if (!fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });

  const { data: row } = await supabase
    .from("client_files")
    .select("id, client_id, drive_file_id")
    .eq("id", fileId)
    .single();
  if (!row || (row as any).client_id !== params.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if ((row as any).drive_file_id) {
    try { await deleteFile((row as any).drive_file_id); } catch {}
  }

  const { error } = await supabase.from("client_files").delete().eq("id", fileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
