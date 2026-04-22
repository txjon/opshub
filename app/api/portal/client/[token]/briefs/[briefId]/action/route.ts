import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { notifyTeamServer, logJobActivityServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// POST /api/portal/client/[token]/briefs/[briefId]/action
// Body: { action: "approve" | "request_changes" | "abort", note? }
//
// Client-triggered transitions. Each auto-posts a message to the thread
// so HPD + designer see the decision in the same place as chat. Scoping:
//   approve          → final_approved (from client_review only)
//   request_changes  → revisions      (from client_review only, note optional)
//   abort            → state unchanged but sets client_aborted_at so the
//                      brief disappears from client view; HPD still sees it
//                      for 60 days with a "Repurpose" option.

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", token).single();
  if (!client) return null;
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, state, client_id, job_id")
    .eq("id", briefId)
    .single();
  if (!brief || brief.client_id !== client.id) return null;
  return { db, client, brief };
}

export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { action, note, fileId } = await req.json() as { action: string; note?: string; fileId?: string };
  const brief = ctx.brief as any;
  const clientName = (ctx.client as any).name || "Client";
  const briefLabel = brief.title || "brief";

  // Invisible system message for unread-flag tracking (the thread UI is
  // gone — this row just moves the role's "last activity" timestamp).
  async function postSystemMarker(message: string) {
    await ctx.db.from("art_brief_messages").insert({
      brief_id: brief.id,
      sender_role: "client",
      sender_name: clientName,
      message,
      visibility: "hpd_designer",
    });
  }

  if (action === "approve") {
    if (brief.state !== "client_review") {
      return NextResponse.json({ error: `Cannot approve from state '${brief.state}'` }, { status: 409 });
    }
    await ctx.db.from("art_briefs").update({
      state: "final_approved",
      updated_at: new Date().toISOString(),
    }).eq("id", brief.id);
    await postSystemMarker("✓ Approved");
    try {
      await notifyTeamServer(`${clientName} approved ${briefLabel}`, "approval", brief.id, "art_brief");
      if (brief.job_id) await logJobActivityServer(brief.job_id, `Client approved ${briefLabel}`);
    } catch {}
    return NextResponse.json({ success: true, to: "final_approved" });
  }

  if (action === "request_changes") {
    if (brief.state !== "client_review") {
      return NextResponse.json({ error: `Cannot request changes from state '${brief.state}'` }, { status: 409 });
    }
    const cleaned = (note || "").trim();
    // Route the note straight onto the file the client was reviewing.
    // Communication happens on the artifact, not in a separate thread.
    if (fileId && cleaned) {
      await ctx.db.from("art_brief_files")
        .update({ client_annotation: cleaned })
        .eq("id", fileId)
        .eq("brief_id", brief.id);
    }
    await ctx.db.from("art_briefs").update({
      state: "revisions",
      updated_at: new Date().toISOString(),
    }).eq("id", brief.id);
    await postSystemMarker("Requested changes");
    try {
      await notifyTeamServer(`${clientName} requested revisions on ${briefLabel}`, "mention", brief.id, "art_brief");
      if (brief.job_id) await logJobActivityServer(brief.job_id, `Client requested revisions on ${briefLabel}`);
    } catch {}
    return NextResponse.json({ success: true, to: "revisions" });
  }

  if (action === "abort") {
    await ctx.db.from("art_briefs").update({
      client_aborted_at: new Date().toISOString(),
      archived_by: "client",
      updated_at: new Date().toISOString(),
    }).eq("id", brief.id);
    await postSystemMarker("Aborted");
    try {
      await notifyTeamServer(`${clientName} aborted ${briefLabel}`, "alert", brief.id, "art_brief");
      if (brief.job_id) await logJobActivityServer(brief.job_id, `Client aborted ${briefLabel}`);
    } catch {}
    return NextResponse.json({ success: true, aborted: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
