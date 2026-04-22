import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

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

  const [filesRes, msgsRes] = await Promise.all([
    ctx.db.from("art_brief_files").select("*").eq("brief_id", params.briefId).order("created_at"),
    ctx.db.from("art_brief_messages").select("*").eq("brief_id", params.briefId)
      .neq("visibility", "hpd_only")  // hide internal HPD notes from client
      .order("created_at"),
  ]);

  // Client sees everything the designer + HPD produce EXCEPT print-ready.
  // Print-ready is HPD's internal production file (CMYK, separations) —
  // client's view ends at Final.
  const visibleFiles = (filesRes.data || []).filter((f: any) => f.kind !== "print_ready");

  return NextResponse.json({
    brief: ctx.brief,
    client: { name: ctx.client.name },
    files: visibleFiles,
    messages: msgsRes.data || [],
  });
}
