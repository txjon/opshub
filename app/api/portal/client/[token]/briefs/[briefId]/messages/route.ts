import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { notifyTeamServer, logJobActivityServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

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

// POST /api/portal/client/[token]/briefs/[briefId]/messages
// Client posts a message to the brief thread. Visible to HPD + designer.
export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { message } = await req.json();
  if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });

  const { data, error } = await ctx.db.from("art_brief_messages").insert({
    brief_id: params.briefId,
    sender_role: "client",
    sender_name: ctx.client.name,
    message: message.trim(),
    visibility: "all",
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify HPD team
  try {
    await notifyTeamServer(`Client note on "${ctx.brief.title || 'brief'}": ${message.slice(0, 80)}`, "mention", params.briefId, "art_brief");
    if (ctx.brief.job_id) await logJobActivityServer(ctx.brief.job_id, `Client posted note on ${ctx.brief.title || "brief"}`);
  } catch {}

  return NextResponse.json({ message: data });
}
