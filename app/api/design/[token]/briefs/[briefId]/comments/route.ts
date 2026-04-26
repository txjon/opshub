import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: designer } = await db.from("designers").select("id, active").eq("portal_token", token).single();
  if (!designer || !designer.active) return null;
  const { data: brief } = await db.from("art_briefs").select("id, assigned_designer_id").eq("id", briefId).single();
  if (!brief || brief.assigned_designer_id !== designer.id) return null;
  return { db, designer, brief };
}

// POST — designer posts a comment on a file. Body: { fileId, body }
export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { fileId, body } = await req.json();
  const text = (body || "").trim();
  if (!fileId || !text) return NextResponse.json({ error: "fileId and body required" }, { status: 400 });

  const { data: file } = await ctx.db.from("art_brief_files").select("id, brief_id").eq("id", fileId).single();
  if (!file || file.brief_id !== ctx.brief.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await ctx.db.from("art_brief_file_comments").insert({
    file_id: fileId,
    brief_id: ctx.brief.id,
    sender_role: "designer",
    body: text,
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}
