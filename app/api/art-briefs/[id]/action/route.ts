import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { notifyTeamServer } from "@/lib/notify-server";
import { renderBrandedEmail } from "@/lib/email-template";
import { appBaseUrl } from "@/lib/public-url";

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

    const { action } = await req.json() as { action: ActionKind };
    const db = admin();
    const { data: brief, error: loadErr } = await db
      .from("art_briefs")
      .select("id, state, title, client_id, job_id, client_aborted_at, sent_to_designer_at, assigned_designer_id, clients(name, portal_token)")
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
    //   2) Send a branded portal-link email to the client's contacts.
    //      Modeled after the send-intake email.
    if ((action === "forward_to_client" || action === "send_to_client") && brief.state === "wip_review") {
      const portalToken = (brief as any).clients?.portal_token as string | null | undefined;
      try {
        await db.from("art_brief_files")
          .update({ shared_with_client_at: new Date().toISOString() })
          .eq("brief_id", brief.id)
          .eq("kind", "wip")
          .is("shared_with_client_at", null);
      } catch (e) {
        console.error("[art-brief action] failed to flip shared_with_client_at:", e);
      }

      if (portalToken && process.env.RESEND_API_KEY) {
        try {
          const { data: contacts } = await db
            .from("contacts")
            .select("email")
            .eq("client_id", (brief as any).client_id)
            .not("email", "is", null)
            .limit(5);
          const recipients = (contacts || []).map((c: any) => c.email).filter(Boolean);
          if (recipients.length > 0) {
            const title = brief.title || "your design";
            const portalUrl = `${appBaseUrl()}/portal/client/${portalToken}/designs?brief=${brief.id}`;
            const html = renderBrandedEmail({
              heading: "Your design team has something to show you",
              greeting: `Hi ${clientName},`,
              bodyHtml: `We just shared progress on <strong>${title}</strong>. Open the portal to see it and leave any feedback directly on the file.`,
              cta: { label: "Open the portal →", url: portalUrl, style: "dark" },
              hint: "Comments go straight to your design team. We'll loop back when there's a next version.",
              closing: "",
            });
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com",
                to: recipients,
                subject: `${title} — design ready for review`,
                html,
              }),
            });
          }
        } catch (e) {
          console.error("[art-brief action] forward email send failed:", e);
        }
      }
    }

    return NextResponse.json({ brief: updated, action, from: brief.state, to: tx.to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
