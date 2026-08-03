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

type ActionKind = "send_to_client" | "forward_to_client" | "approve_wip" | "request_revision" | "mark_production_ready" | "mark_delivered" | "repurpose" | "archive" | "recall";

const TRANSITIONS: Record<Exclude<ActionKind, "repurpose" | "recall" | "archive">, {
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
  // Forward designer's WIP to the client for a direction check.
  // Use sparingly — most WIPs should never reach the client. The
  // canonical path is approve_wip → designer uploads first_draft →
  // client_review.
  forward_to_client: {
    from: ["wip_review", "revisions"],
    to: "client_review",
    notifyMsg: (title, client) => `${client} — ${title || "brief"} forwarded to client by HPD`,
    notifyType: "approval",
  },
  // HPD greenlights the WIP without showing the client. Brief returns
  // to in_progress so the designer can keep working toward the first
  // draft — which auto-flips to client_review on upload.
  approve_wip: {
    from: ["wip_review"],
    to: "in_progress",
    notifyMsg: (title) => `HPD approved WIP on "${title || "brief"}" — designer to continue with first draft`,
    notifyType: "production",
  },
  // HPD bounces the designer's submission back without going to the
  // client. Lands the brief in `revisions` so the designer's banner
  // tells them changes were requested.
  request_revision: {
    from: ["wip_review"],
    to: "revisions",
    notifyMsg: (title, client) => `HPD requested changes from designer on "${title || "brief"}"`,
    notifyType: "mention",
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

    const { action, confirmApproved } = await req.json() as { action: ActionKind; confirmApproved?: boolean };
    const db = admin();
    const { data: brief, error: loadErr } = await db
      .from("art_briefs")
      .select("id, state, title, client_id, job_id, client_aborted_at, sent_to_designer_at, assigned_designer_id, clients(name, portal_token, companies:company_id(slug))")
      .eq("id", params.id)
      .single();
    if (loadErr || !brief) return NextResponse.json({ error: loadErr?.message || "Not found" }, { status: 404 });

    // Recall: pull the brief back from the designer. Reverts to draft.
    // Allowed even after the designer has uploaded work — designers are paid
    // monthly (not per design), so uploaded art doesn't gate a recall.
    if (action === "recall") {
      if (!brief.sent_to_designer_at) {
        return NextResponse.json({ error: "Brief hasn't been sent to a designer" }, { status: 409 });
      }
      // Guard: recalling a brief the client already APPROVED silently
      // resets it to draft and erases the approval state. Make it a
      // deliberate, confirmed act — not a one-click accident.
      const APPROVED_STATES = ["final_approved", "pending_prep", "production_ready", "delivered"];
      const wasApproved = APPROVED_STATES.includes(brief.state);
      if (wasApproved && !confirmApproved) {
        return NextResponse.json({
          error: `This brief is "${brief.state.replace(/_/g, " ")}" — the client already approved it. Recalling resets it to draft and removes that approval.`,
          needsApprovalConfirm: true,
          approvedState: brief.state,
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
      // Durable trail — log the recall and the state it came from so an
      // approval can never be silently erased again. (The client's
      // "✓ Approved" marker also survives, so the history shows both.)
      try {
        await db.from("art_brief_messages").insert({
          brief_id: params.id,
          sender_role: "hpd",
          sender_name: "HPD",
          message: wasApproved
            ? `Recalled by HPD from "${brief.state.replace(/_/g, " ")}" — client approval reset`
            : `Recalled by HPD from "${brief.state.replace(/_/g, " ")}"`,
          visibility: "hpd_designer",
        });
      } catch {}
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

    const tx = TRANSITIONS[action as keyof typeof TRANSITIONS];
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

    // Forward / send to client = the moment a designer's WIP becomes
    // visible to the client. Two side-effects fire here, both gated to
    // transitions that originate from wip_review:
    //   1) Mark every WIP on this brief as shared_with_client_at = now.
    //      Portal file filters honor this column, so the WIP shows up
    //      in the client's brief modal. Existing share timestamps are
    //      preserved so a second forward doesn't overwrite the first.
    //   2) Send a branded portal-link email to the client's contacts
    //      (renderBrandedEmail + Resend, same pattern as the other
    //      transactional sends in OpsHub).
    if ((action === "forward_to_client" || action === "send_to_client") && brief.state === "wip_review") {
      try {
        await db.from("art_brief_files")
          .update({ shared_with_client_at: new Date().toISOString() })
          .eq("brief_id", brief.id)
          .eq("kind", "wip")
          .is("shared_with_client_at", null);
      } catch (e) {
        console.error("[art-brief action] failed to flip shared_with_client_at:", e);
      }

      // Client "design update" email RETIRED (Jon, Aug 3 email audit) — the
      // hub's studio feed (NEW markers) is the update surface; the forward
      // action itself still shares WIPs + flips visibility above. Full email
      // body in git history if it ever comes back.
    }

    return NextResponse.json({ brief: updated, action, from: brief.state, to: tx.to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
