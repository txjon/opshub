import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createResumableUploadSession } from "@/lib/drive-resumable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  try {
    const ctx = await verifyAccess(params.token, params.briefId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { file_name, mime_type } = await req.json();
    if (!file_name) return NextResponse.json({ error: "file_name required" }, { status: 400 });

    const title = (ctx.brief as any).title || params.briefId;
    const folderPath = `Art Brief Work/${title}`;

    const { uploadUrl, folderId } = await createResumableUploadSession({
      folderPath,
      fileName: file_name,
      mimeType: mime_type || "application/octet-stream",
    });

    return NextResponse.json({ uploadUrl, folderId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
