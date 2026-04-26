import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { computeFileOrdinals } from "@/lib/art-activity-text";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Verify the portal token belongs to a client, AND the brief belongs to that client.
async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", token).single();
  if (!client) return null;
  const { data: brief } = await db
    .from("art_briefs")
    .select("id, title, concept, state, deadline, client_id, job_id, assigned_designer_id")
    .eq("id", briefId)
    .single();
  if (!brief || brief.client_id !== client.id) return null;
  return { db, client, brief };
}

// GET /api/portal/client/[token]/briefs/[briefId]
// Full detail: brief + all files + all messages
export async function GET(_req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Mark-as-read on every detail open. Listing rollup factors this
  // into clientAt so unread ribbons clear after first open.
  ctx.db.from("art_briefs")
    .update({ client_last_seen_at: new Date().toISOString() })
    .eq("id", ctx.brief.id)
    .then(() => {});

  const [filesRes, msgsRes] = await Promise.all([
    ctx.db.from("art_brief_files").select("*").eq("brief_id", params.briefId).order("created_at"),
    ctx.db.from("art_brief_messages").select("*").eq("brief_id", params.briefId)
      .neq("visibility", "hpd_only")  // hide internal HPD notes from client
      .order("created_at"),
  ]);

  // Client visibility rules (mirror /api/portal/client/[token]/route.ts):
  // - print_ready hidden — HPD's internal CMYK/separations file
  // - wip hidden — designer↔HPD working files, unless HPD has explicitly
  //   surfaced one via shared_with_client_at (future "share WIP" toggle)
  const visibleFiles = (filesRes.data || []).filter((f: any) => {
    if (f.kind === "print_ready") return false;
    if (f.kind === "wip" && !f.shared_with_client_at) return false;
    return true;
  });

  const fileIds = visibleFiles.map((f: any) => f.id);
  const { data: commentsRaw } = fileIds.length > 0
    ? await ctx.db.from("art_brief_file_comments")
        .select("id, file_id, sender_role, body, created_at")
        .in("file_id", fileIds)
        .order("created_at")
    : { data: [] as any[] };
  const commentsByFile: Record<string, any[]> = {};
  for (const c of (commentsRaw || [])) (commentsByFile[c.file_id] ||= []).push(c);

  // Per-kind 1-based ordinal so the file badge can render "REF 3" /
  // "2nd Draft" instead of just "REF" / "REV".
  const ordinals = computeFileOrdinals(visibleFiles);
  const filesWithOrd = visibleFiles.map((f: any) => ({
    ...f,
    kind_ordinal: ordinals[f.id] || null,
    comments: commentsByFile[f.id] || [],
  }));

  return NextResponse.json({
    brief: ctx.brief,
    client: { name: ctx.client.name },
    files: filesWithOrd,
    messages: msgsRes.data || [],
  });
}
