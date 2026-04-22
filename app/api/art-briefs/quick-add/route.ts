import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveToken, getReceivingFolderId } from "@/lib/drive-token";

// POST /api/art-briefs/quick-add
// Multipart: client_id (required), job_id (optional), item_id (optional), file (one per request)
// Creates a draft brief with title derived from filename, uploads the file to
// Drive as a reference, returns the brief + file. Call once per file — client
// loops through selected files.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const clientId = (formData.get("client_id") as string) || null;
    const jobId = (formData.get("job_id") as string) || null;
    const itemId = (formData.get("item_id") as string) || null;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!clientId) return NextResponse.json({ error: "client_id is required" }, { status: 400 });

    // Title from filename: strip extension, replace separators with spaces
    const rawName = file.name;
    const noExt = rawName.replace(/\.[^.]+$/, "");
    const title = noExt.replace(/[._-]+/g, " ").trim() || rawName;

    // Look up client name for folder organization
    const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).single();
    const clientName = (client as any)?.name || "Unknown";

    // Default designer: pre-assign to sole active designer for convenience.
    // Doesn't auto-send — HPD clicks "Send to Designer" when brief is ready.
    let finalDesignerId: string | null = null;
    const { data: activeDesigners } = await supabase.from("designers").select("id").eq("active", true);
    if (activeDesigners && activeDesigners.length === 1) {
      finalDesignerId = activeDesigners[0].id;
    }

    // Create draft brief first
    const { data: brief, error: briefErr } = await supabase.from("art_briefs").insert({
      client_id: clientId,
      job_id: jobId,
      item_id: itemId,
      title,
      state: "draft",
      assigned_designer_id: finalDesignerId,
      created_by: user.id,
    }).select("*").single();

    if (briefErr || !brief) return NextResponse.json({ error: briefErr?.message || "Brief create failed" }, { status: 500 });

    // Upload to Drive under a per-client quick-add folder
    const token = await getDriveToken();
    const folderId = await getReceivingFolderId(token, `Art Brief References/${clientName}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const boundary = "qa_" + Date.now() + "_" + Math.random().toString(36).slice(2);
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
    if (!driveFile.id) {
      // Roll back the brief if Drive failed
      await supabase.from("art_briefs").delete().eq("id", (brief as any).id);
      return NextResponse.json({ error: "Drive upload failed" }, { status: 500 });
    }

    await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });

    const { data: fileRow, error: fileErr } = await supabase.from("art_brief_files").insert({
      brief_id: (brief as any).id,
      file_name: file.name,
      drive_file_id: driveFile.id,
      drive_link: driveFile.webViewLink,
      mime_type: file.type,
      file_size: file.size,
      kind: "reference",
      uploader_role: "hpd",
      uploaded_by: user.id,
    }).select("*").single();

    if (fileErr) {
      return NextResponse.json({ error: fileErr.message, brief }, { status: 500 });
    }

    return NextResponse.json({ brief, file: fileRow });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
