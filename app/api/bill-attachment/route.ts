export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getActiveCompanyId } from "@/lib/company";

const BUCKET = "bill-invoices";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}
async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// POST — upload a vendor-invoice file to a bill (multipart: file + billGroupId)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const billGroupId = String(form.get("billGroupId") || "");
    if (!file || !billGroupId) return NextResponse.json({ error: "Missing file or billGroupId" }, { status: 400 });

    const sb = admin();
    const safeName = (file.name || "invoice.pdf").replace(/[^\w.\-]+/g, "_");
    const path = `${billGroupId}/${crypto.randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    let companyId: string | null = null;
    try { companyId = await getActiveCompanyId(); } catch { /* internal/no host */ }

    const { data: row, error: insErr } = await sb.from("bill_attachments").insert({
      bill_group_id: billGroupId, company_id: companyId, file_name: file.name || safeName,
      mime_type: file.type || null, size_bytes: buffer.byteLength, storage_path: path, created_by: user.email || user.id,
    }).select("id, file_name, mime_type, size_bytes, storage_path, created_at").single();
    if (insErr) { await sb.storage.from(BUCKET).remove([path]); return NextResponse.json({ error: insErr.message }, { status: 500 }); }

    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    return NextResponse.json({ ok: true, attachment: { ...row, url: signed?.signedUrl || null } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 });
  }
}

// GET ?billGroupId=… — list a bill's attachments with fresh signed URLs
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const billGroupId = req.nextUrl.searchParams.get("billGroupId");
    if (!billGroupId) return NextResponse.json({ error: "Missing billGroupId" }, { status: 400 });

    const sb = admin();
    const { data: rows } = await sb.from("bill_attachments")
      .select("id, file_name, mime_type, size_bytes, storage_path, created_at")
      .eq("bill_group_id", billGroupId).order("created_at");
    const attachments = await Promise.all((rows || []).map(async (r: any) => {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
      return { ...r, url: signed?.signedUrl || null };
    }));
    return NextResponse.json({ attachments });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "List failed" }, { status: 500 });
  }
}

// DELETE ?id=… — remove an attachment (storage + row)
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const sb = admin();
    const { data: row } = await sb.from("bill_attachments").select("storage_path").eq("id", id).single();
    if (row?.storage_path) await sb.storage.from(BUCKET).remove([row.storage_path]);
    await sb.from("bill_attachments").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
