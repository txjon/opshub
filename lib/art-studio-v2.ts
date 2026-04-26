// Art Studio v2 resolver — maps a brief to its section, owner, activity
// line, and primary HPD action. Kills the 9-column kanban by folding the
// states into three sections + who-owns-next.
//
// States (DB column art_briefs.state, set by migration 029):
//   draft → sent (or in_progress) → wip_review → client_review → revisions
//   → final_approved → pending_prep → production_ready → delivered
//
// "Your move" = HPD needs to act. "In flight" = client or designer owns next.
// "Delivered" = closed loop.

export type Section = "your_move" | "in_flight" | "delivered";
export type Owner = "hpd" | "client" | "designer" | "done";

export type PrimaryActionKind =
  | "open" // just open detail modal, no endpoint call
  | "send_to_client" // wip_review → client_review (legacy)
  | "forward_to_client" // wip_review → client_review (HPD approves designer's draft)
  | "request_revision" // wip_review → revisions (HPD bounces it back)
  | "mark_production_ready" // pending_prep (or final_approved) → production_ready
  | "mark_delivered" // → delivered
  | "repurpose"; // client aborted → restore

export type Resolution = {
  section: Section;
  owner: Owner;
  activity: string;
  primary?: { label: string; action: PrimaryActionKind };
  urgency?: "normal" | "stale" | "action";
  /** Surfacing unanswered client input so tiles can show a "new" badge */
  hasUnreadClient?: boolean;
  /** Client aborted this brief — HPD can repurpose for 60 days */
  isAborted?: boolean;
};

export type RoleActivity = { at: string; type: "message" | "upload" | "note"; kind?: string } | null;

// Human-friendly kind labels for preview strings
const KIND_LABELS: Record<string, string> = {
  reference: "a reference",
  wip: "a WIP",
  first_draft: "a 1st Draft",
  revision: "a Revision",
  final: "the Final",
  print_ready: "Print-Ready",
  client_intake: "intake",
};
function describeActivity(who: string, act: NonNullable<RoleActivity>): string {
  if (act.type === "message") return `${who} posted`;
  const label = KIND_LABELS[act.kind || ""] || "a file";
  if (act.type === "upload") return `${who} uploaded ${label}`;
  return `${who} added a note on ${label}`;
}

export type ResolvableBrief = {
  state: string;
  source?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deadline?: string | null;
  sent_to_designer_at?: string | null;
  client_intake_token?: string | null;
  client_intake_submitted_at?: string | null;
  client_aborted_at?: string | null;
  designer_message_count?: number;
  last_client_activity?: RoleActivity;
  last_designer_activity?: RoleActivity;
  last_hpd_activity?: RoleActivity;
};

function daysSince(iso?: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function ago(iso?: string | null): string {
  if (!iso) return "—";
  const d = daysSince(iso);
  if (d === 0) {
    const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    if (hrs < 1) return "just now";
    if (hrs === 1) return "1h ago";
    return `${hrs}h ago`;
  }
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  const weeks = Math.floor(d / 7);
  return weeks === 1 ? "1w ago" : `${weeks}w ago`;
}

export function resolveBrief(b: ResolvableBrief): Resolution {
  const s = b.state || "draft";
  const sourceIsClient = b.source === "client";
  const hasIntakeToken = !!b.client_intake_token;
  const intakeSubmitted = !!b.client_intake_submitted_at;
  const awaitingIntake = hasIntakeToken && !intakeSubmitted;
  const lastActivity = b.updated_at || b.created_at;
  const dSince = daysSince(lastActivity);

  // Client aborted — lives in the Delivered section with a distinct flag.
  // HPD sees "Repurpose" to restore. 60-day window handled by API filter.
  if (b.client_aborted_at) {
    return {
      section: "delivered",
      owner: "done",
      activity: `Client aborted · ${ago(b.client_aborted_at)}`,
      primary: { label: "Repurpose", action: "repurpose" },
      urgency: "normal",
      isAborted: true,
    };
  }

  // Delivered = closed loop
  if (s === "delivered") {
    return {
      section: "delivered",
      owner: "done",
      activity: `Delivered ${ago(lastActivity)}`,
      urgency: "normal",
    };
  }

  // Unread-for-HPD override: if anyone else (client OR designer) acted more
  // recently than HPD, surface the tile as "Your move" with a preview of
  // what happened — same mental model as a group chat. Covers mid-flight
  // client references, client messages, and designer revisions that would
  // otherwise silently sit in an in-flight state.
  const clientAt = b.last_client_activity?.at || "";
  const designerAt = b.last_designer_activity?.at || "";
  const hpdAt = b.last_hpd_activity?.at || "";
  const latestOtherAt = clientAt > designerAt ? clientAt : designerAt;
  const latestOtherRole: "client" | "designer" = clientAt > designerAt ? "client" : "designer";
  const latestOtherActivity = latestOtherRole === "client" ? b.last_client_activity : b.last_designer_activity;
  const hpdUnread = !!latestOtherAt && latestOtherAt > hpdAt;
  if (hpdUnread && latestOtherActivity) {
    const who = latestOtherRole === "client" ? "Client" : "Designer";
    return {
      section: "your_move",
      owner: "hpd",
      activity: `${describeActivity(who, latestOtherActivity)} · ${ago(latestOtherAt)}`,
      primary: { label: "Open", action: "open" },
      urgency: "action",
      hasUnreadClient: true,
    };
  }

  // Draft — depends on source + intake state
  if (s === "draft") {
    if (intakeSubmitted) {
      return {
        section: "your_move",
        owner: "hpd",
        activity: `Intake submitted · ${ago(b.client_intake_submitted_at)}`,
        primary: { label: "Translate & send", action: "open" },
        urgency: "action",
      };
    }
    if (awaitingIntake) {
      return {
        section: "in_flight",
        owner: "client",
        activity: `Intake sent · ${ago(b.updated_at)}`,
        primary: { label: "Chat", action: "open" },
        urgency: dSince > 3 ? "stale" : "normal",
      };
    }
    if (sourceIsClient) {
      return {
        section: "your_move",
        owner: "hpd",
        activity: `New request from client · ${ago(b.created_at)}`,
        primary: { label: "Review & send", action: "open" },
        urgency: "action",
      };
    }
    // HPD-created draft still being filled in
    return {
      section: "your_move",
      owner: "hpd",
      activity: `Draft · ${ago(b.created_at)}`,
      primary: { label: "Open brief", action: "open" },
      urgency: dSince > 7 ? "stale" : "normal",
    };
  }

  // Sent to designer, not yet WIP
  if (s === "sent" || s === "in_progress") {
    const sent = b.sent_to_designer_at || b.updated_at;
    return {
      section: "in_flight",
      owner: "designer",
      activity: `With designer · sent ${ago(sent)}`,
      primary: { label: "Chat", action: "open" },
      urgency: daysSince(sent) > 4 ? "stale" : "normal",
    };
  }

  // Designer uploaded WIP for HPD pre-review. No state-advancing action —
  // designer's first_draft upload is the thing that moves to client_review.
  // HPD uses the modal to chat with designer or optionally share WIP with
  // client for a direction check.
  if (s === "wip_review") {
    return {
      section: "your_move",
      owner: "hpd",
      activity: `Designer uploaded WIP · ${ago(b.updated_at)}`,
      primary: { label: "Review WIP", action: "open" },
      urgency: "action",
    };
  }

  // Designer draft/revision is with client
  if (s === "client_review") {
    return {
      section: "in_flight",
      owner: "client",
      activity: `With client · ${ago(b.updated_at)}`,
      primary: { label: "Chat", action: "open" },
      urgency: dSince > 3 ? "stale" : "normal",
    };
  }

  // Client requested revisions — designer owns
  if (s === "revisions") {
    return {
      section: "in_flight",
      owner: "designer",
      activity: `Revisions requested · ${ago(b.updated_at)}`,
      primary: { label: "Chat", action: "open" },
      urgency: dSince > 4 ? "stale" : "normal",
    };
  }

  // Client approved final — HPD needs to prep production file
  if (s === "final_approved") {
    return {
      section: "your_move",
      owner: "hpd",
      activity: `Client approved Final · ${ago(b.updated_at)}`,
      primary: { label: "Prep production file", action: "open" },
      urgency: "action",
    };
  }

  // HPD has seen final, file prep in progress
  if (s === "pending_prep") {
    return {
      section: "your_move",
      owner: "hpd",
      activity: `File prep · ${ago(b.updated_at)}`,
      primary: { label: "Mark production-ready", action: "mark_production_ready" },
      urgency: "action",
    };
  }

  // Ready to spawn products — next step is delivered
  if (s === "production_ready") {
    return {
      section: "your_move",
      owner: "hpd",
      activity: `Production-ready · ${ago(b.updated_at)}`,
      primary: { label: "Mark delivered", action: "mark_delivered" },
      urgency: "action",
    };
  }

  // Fallback — unknown state treated as in-flight
  return {
    section: "in_flight",
    owner: "hpd",
    activity: `State: ${s}`,
    primary: { label: "Open", action: "open" },
  };
}

// Helper: latest activity timestamp across all three roles (files + messages).
// Falls back to updated_at/created_at if no roleed activity is attached yet.
function latestActivityAt<T extends ResolvableBrief>(b: T): string {
  const candidates = [
    b.last_client_activity?.at,
    b.last_designer_activity?.at,
    b.last_hpd_activity?.at,
    b.updated_at,
    b.created_at,
  ].filter((x): x is string => !!x);
  return candidates.sort().pop() || "";
}

// Sort by latest activity from anyone, newest first — iMessage-style. Same
// ordering for every section; whichever brief got touched last floats up.
export function sortYourMove<T extends ResolvableBrief>(briefs: T[]): T[] {
  return [...briefs].sort((a, b) => latestActivityAt(b).localeCompare(latestActivityAt(a)));
}
export function sortInFlight<T extends ResolvableBrief>(briefs: T[]): T[] {
  return [...briefs].sort((a, b) => latestActivityAt(b).localeCompare(latestActivityAt(a)));
}

// Filter-pill predicates
export type FilterKey = "all" | "your_move" | "with_client" | "with_designer" | "delivered";

export function matchesFilter(r: Resolution, filter: FilterKey): boolean {
  if (filter === "all") return r.section !== "delivered"; // "All" hides delivered by default
  if (filter === "your_move") return r.section === "your_move";
  if (filter === "with_client") return r.section === "in_flight" && r.owner === "client";
  if (filter === "with_designer") return r.section === "in_flight" && r.owner === "designer";
  if (filter === "delivered") return r.section === "delivered";
  return true;
}
