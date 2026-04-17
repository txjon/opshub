import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveToken, getReceivingFolderId } from "@/lib/drive-token";

// POST /api/art-briefs/upload-reference
// Multipart: brief_id (required), file (required), kind (optional, default "reference"),
//            hpd_annotation (optional), client_annotation (optional)
// HPD-authenticated upload. Use this to add additional references to an
// existing brief after creation.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const briefId = formData.get("brief_id") as string | null;
    const kind = ((formData.get("kind") as string) || "reference").toLowerCase();
    const hpdAnnotation = (formData.get("hpd_annotation") as string) || null;
    const clientAnnotation = (formData.get("client_annotation") as string) || null;

    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!briefId) return NextResponse.json({ error: "brief_id required" }, { status: 400 });
    if (!["reference", "wip", "final", "client_intake"].includes(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }

    const { data: brief } = await supabase
      .from("art_briefs")
      .select("id, title, clients(name)")
      .eq("id", briefId)
      .single();
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    const clientName = (brief as any).clients?.name || "Unknown";
    const title = (brief as any).title || (brief as any).id;

    const token = await getDriveToken();
    const folderId = await getReceivingFolderId(token, `Art Brief References/${clientName}/${title}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const boundary = "hpdref_" + Date.now() + "_" + Math.random().toString(36).slice(2);
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

    // Version on WIP/final uploads
    let version = 1;
    if (kind === "wip" || kind === "final") {
      const { count } = await supabase.from("art_brief_files")
        .select("id", { count: "exact", head: true })
        .eq("brief_id", briefId)
        .eq("kind", kind);
      version = (count || 0) + 1;
    }

    const { data, error } = await supabase.from("art_brief_files").insert({
      brief_id: briefId,
      file_name: file.name,
      drive_file_id: driveFile.id,
      drive_link: driveFile.webViewLink,
      mime_type: file.type,
      file_size: file.size,
      kind,
      version,
      uploader_role: "hpd",
      uploaded_by: user.id,
      hpd_annotation: hpdAnnotation,
      client_annotation: clientAnnotation,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (kind === "wip" || kind === "final") {
      await supabase.from("art_briefs").update({
        version_count: version,
        updated_at: new Date().toISOString(),
      }).eq("id", briefId);
    }

    return NextResponse.json({ file: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
