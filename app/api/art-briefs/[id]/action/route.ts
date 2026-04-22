import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { notifyTeamServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

// POST /api/art-briefs/[id]/action
// Body: { action: "send_to_client" | "mark_production_ready" | "mark_delivered" }
// Single endpoint for the Art Studio v2 primary-action buttons. Each action
// performs the correct state transition and fires notifications. No other
// route should duplicate these transitions — all HPD-initiated moves go here.

type ActionKind = "send_to_client" | "mark_production_ready" | "mark_delivered" | "repurpose" | "archive" | "recall";

const TRANSITIONS: Record<Exclude<ActionKind, "repurpose">, {
  from: string[];
  to: string;
  notifyMsg: (title: string, client: string) => string;
  notifyType: "mention" | "approval" | "production";
}> = {
  send_to_client: {
    // WIP goes to client for review. Also allow draft→client_review for cases
    // where HPD uploaded a first draft directly (rare but possible).
    from: ["wip_review", "draft", "revisions"],
    to: "client_review",
    notifyMsg: (title, client) => `${client} — ${title || "brief"} sent to client for review`,
    notifyType: "approval",
  },
  mark_production_ready: {
    from: ["final_approved", "pending_prep"],
    to: "production_ready",
    notifyMsg: (title, client) => `${client} — ${title || "brief"} marked production-ready`,
    notifyType: "production",
  },
  mark_delivered: {
    // Delivered can be reached from anywhere as a manual override (one-offs,
    // promotional art, etc). System also auto-flips on product spawn.
    from: ["production_ready", "final_approved", "pending_prep", "client_review", "wip_review"],
    to: "delivered",
    notifyMsg: (title, client) => `${client} — ${title || "brief"} delivered`,
    notifyType: "production",
  },
};

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { action } = await req.json() as { action: ActionKind };
    const db = admin();
    const { data: brief, error: loadErr } = await db
      .from("art_briefs")
      .select("id, state, title, client_id, job_id, client_aborted_at, sent_to_designer_at, assigned_designer_id, clients(name)")
      .eq("id", params.id)
      .single();
    if (loadErr || !brief) return NextResponse.json({ error: loadErr?.message || "Not found" }, { status: 404 });

    // Recall: pull the brief back from the designer. Reverts to draft.
    // Blocked if designer has already uploaded work (protects their effort).
    if (action === "recall") {
      if (!brief.sent_to_designer_at) {
        return NextResponse.json({ error: "Brief hasn't been sent to a designer" }, { status: 409 });
      }
      const { count: designerUploads } = await db
        .from("art_brief_files")
        .select("id", { count: "exact", head: true })
        .eq("brief_id", params.id)
        .eq("uploader_role", "designer");
      if ((designerUploads || 0) > 0) {
        return NextResponse.json({
          error: "Designer has already uploaded work on this brief. Recall blocked to protect their files.",
        }, { status: 409 });
      }
      const { data: updated, error: updErr } = await db
        .from("art_briefs")
        .update({
          state: "draft",
          sent_to_designer_at: null,
          assigned_designer_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.id)
        .select("*")
        .single();
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      return NextResponse.json({ brief: updated, action });
    }

    // Repurpose: restore an archived brief (client-aborted OR hpd-archived).
    // Clears both the timestamp and the archived_by role.
    if (action === "repurpose") {
      if (!brief.client_aborted_at) {
        return NextResponse.json({ error: "Not archived" }, { status: 409 });
      }
      const { data: updated, error: updErr } = await db
        .from("art_briefs")
        .update({ client_aborted_at: null, archived_by: null, updated_at: new Date().toISOString() })
        .eq("id", params.id)
        .select("*")
        .single();
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      const clientName = (brief as any).clients?.name || "Client";
      try {
        await notifyTeamServer(`${clientName} — ${brief.title || "brief"} repurposed by HPD`, "production", brief.id, "art_brief");
      } catch {}
      return NextResponse.json({ brief: updated, action });
    }

    // Archive: HPD's soft-delete. Same underlying flag as client abort but
    // tagged archived_by='hpd' so downstream readers know who killed it.
    // 60-day repurpose window still applies (art-briefs GET filter).
    if (action === "archive") {
      const { data: updated, error: updErr } = await db
        .from("art_briefs")
        .update({
          client_aborted_at: new Date().toISOString(),
          archived_by: "hpd",
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.id)
        .select("*")
        .single();
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      const clientName = (brief as any).clients?.name || "Client";
      try {
        await notifyTeamServer(`${clientName} — ${brief.title || "brief"} archived by HPD`, "production", brief.id, "art_brief");
      } catch {}
      return NextResponse.json({ brief: updated, action });
    }

    const tx = TRANSITIONS[action as Exclude<ActionKind, "repurpose">];
    if (!tx) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    if (!tx.from.includes(brief.state)) {
      return NextResponse.json({
        error: `Can't ${action} from state '${brief.state}'`,
        currentState: brief.state,
      }, { status: 409 });
    }

    const { data: updated, error: updErr } = await db
      .from("art_briefs")
      .update({ state: tx.to, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .select("*")
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    const clientName = (brief as any).clients?.name || "Client";
    try {
      await notifyTeamServer(
        tx.notifyMsg(brief.title || "", clientName),
        tx.notifyType,
        brief.id,
        "art_brief"
      );
    } catch {}

    return NextResponse.json({ brief: updated, action, from: brief.state, to: tx.to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
