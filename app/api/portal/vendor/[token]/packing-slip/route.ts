export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getDriveToken, getReceivingFolderId } from "@/lib/drive-token";

// POST /api/portal/vendor/[token]/packing-slip
// Multipart: { itemId, file }
// Decorator-uploaded packing slip. Authenticated via the decorator's portal
// token. Stores in item_files with stage='packing_slip' so HPD's receiving +
// production pages surface it automatically.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Validate decorator token
    const { data: decorator } = await sb
      .from("decorators")
      .select("id, name")
      .eq("external_token", params.token)
      .single();
    if (!decorator) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const itemId = (form.get("itemId") as string) || null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

    // Verify item is actually assigned to this decorator (don't trust the client)
    const { data: assignment } = await sb
      .from("decorator_assignments")
      .select("item_id")
      .eq("item_id", itemId)
      .eq("decorator_id", decorator.id)
      .maybeSingle();
    if (!assignment) return NextResponse.json({ error: "Item not assigned to you" }, { status: 403 });

    const { data: item } = await sb.from("items").select("id, name, job_id, jobs(title, job_number, clients(name))").eq("id", itemId).single();
    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    const clientName = (item as any)?.jobs?.clients?.name || "Unknown";
    const jobTitle = (item as any)?.jobs?.title || "Project";
    const jobNumber = (item as any)?.jobs?.job_number || "";
    const itemName = (item as any)?.name || "item";
    const folderPath = `Packing Slips/${clientName}/${jobNumber} — ${jobTitle}`;

    // Upload to Drive
    const token = await getDriveToken();
    const folderId = await getReceivingFolderId(token, folderPath);

    const buffer = Buffer.from(await file.arrayBuffer());
    const boundary = "ps_" + Date.now() + "_" + Math.random().toString(36).slice(2);
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

    const { data: fileRow, error: fileErr } = await sb.from("item_files").insert({
      item_id: itemId,
      file_name: file.name,
      stage: "packing_slip",
      drive_file_id: driveFile.id,
      drive_link: driveFile.webViewLink,
      mime_type: file.type,
      file_size: file.size,
      uploaded_by: null,
      notes: `From decorator (${decorator.name})`,
    }).select("*").single();

    if (fileErr) return NextResponse.json({ error: fileErr.message }, { status: 500 });

    await sb.from("job_activity").insert({
      job_id: (item as any).job_id,
      user_id: null,
      type: "auto",
      message: `${decorator.name} uploaded packing slip for ${itemName}`,
    });

    return NextResponse.json({ file: fileRow });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
