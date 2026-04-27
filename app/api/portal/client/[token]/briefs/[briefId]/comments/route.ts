import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { notifyTeamServer, logJobActivityServer } from "@/lib/notify-server";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", token).single();
  if (!client) return null;
  const { data: brief } = await db.from("art_briefs").select("id, title, client_id, job_id").eq("id", briefId).single();
  if (!brief || brief.client_id !== client.id) return null;
  return { db, client, brief };
}

// POST — client posts a comment on a file. Body: { fileId, body }
export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { fileId, body } = await req.json();
  const text = (body || "").trim();
  if (!fileId || !text) return NextResponse.json({ error: "fileId and body required" }, { status: 400 });

  const { data: file } = await ctx.db.from("art_brief_files").select("id, brief_id, kind").eq("id", fileId).single();
  if (!file || file.brief_id !== ctx.brief.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Client can't post on print_ready (HPD-internal)
  if (file.kind === "print_ready") return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const { data, error } = await ctx.db.from("art_brief_file_comments").insert({
    file_id: fileId,
    brief_id: ctx.brief.id,
    sender_role: "client",
    body: text,
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify HPD + log to job activity. Mirrors the messages and
  // file-upload client routes so every client-originated write fans
  // out the same way; without this, HPD never sees per-file comments.
  try {
    const briefTitle = (ctx.brief as any).title || "brief";
    const clientName = (ctx.client as any).name || "Client";
    await notifyTeamServer(
      `${clientName} commented on "${briefTitle}": ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`,
      "mention",
      ctx.brief.id,
      "art_brief",
    );
    if ((ctx.brief as any).job_id) {
      await logJobActivityServer((ctx.brief as any).job_id, `Client commented on ${briefTitle}`);
    }
  } catch {}

  return NextResponse.json({ comment: data });
}
