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
  const { data: designer } = await db.from("designers").select("id, active, name").eq("portal_token", token).single();
  if (!designer || !designer.active) return null;
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, assigned_designer_id, client_id, clients(name)")
    .eq("id", briefId)
    .single();
  if (!brief || brief.assigned_designer_id !== designer.id) return null;
  return { db, designer, brief };
}

const DESIGNER_KINDS = ["wip", "first_draft", "revision", "final"];

export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  try {
    const ctx = await verifyAccess(params.token, params.briefId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { file_name, mime_type, kind } = await req.json();
    if (!file_name) return NextResponse.json({ error: "file_name required" }, { status: 400 });
    const k = (kind || "wip").toLowerCase();
    if (!DESIGNER_KINDS.includes(k)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });

    const clientName = (ctx.brief as any).clients?.name || "Unassigned";
    const title = (ctx.brief as any).title || params.briefId;

    // Nested: OpsHub Files / Art Studio / {Client} / {Brief}
    const { uploadUrl, folderId } = await createResumableUploadSession({
      folderSegments: ["Art Studio", clientName, title],
      fileName: file_name,
      mimeType: mime_type || "application/octet-stream",
    });

    return NextResponse.json({ uploadUrl, folderId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
