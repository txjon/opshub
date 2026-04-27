// One-line description of an activity event on a brief — "HPD uploaded
// REF 3", "Designer uploaded 2nd Draft", "Client added a note on 1st
// Draft", etc. Used by both portal APIs (designer + client) so all three
// surfaces show identical wording.
//
// The DB stores kinds as: reference, wip, first_draft, revision, final,
// print_ready. Per-kind ordinals are computed by the caller (1-based,
// by upload order within a brief).

export type ActivityRole = "client" | "designer" | "hpd";
export type ActivityType = "upload" | "note" | "message";
export type FileKind =
  | "reference"
  | "wip"
  | "first_draft"
  | "revision"
  | "final"
  | "print_ready"
  | (string & {});

export type ActivityEvent = {
  role: ActivityRole;
  type: ActivityType;
  kind?: FileKind | null;
  /** 1-based index within (brief, kind). Required for `reference` (REF 1
   *  / REF 2…), `wip` (when >1), and `revision` (1 → "2nd Draft"). */
  ordinal?: number | null;
  /** First ~40 chars of the message body — only for type="message". */
  messageBody?: string | null;
};

const WHO_LABEL: Record<ActivityRole, string> = {
  client: "Client",
  designer: "Designer",
  hpd: "HPD",
};

const NTH = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
function ordinalWord(n: number): string {
  if (n >= 1 && n <= NTH.length) return NTH[n - 1];
  // 11th, 12th, 13th, then 21st/22nd/23rd, 31st…
  const mod10 = n % 10, mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** Label the file artifact itself — "REF 3", "1st Draft", "3rd Draft". */
export function formatFileLabel(kind: FileKind | null | undefined, ordinal?: number | null): string {
  const k = (kind || "").toLowerCase();
  const ord = Number.isFinite(ordinal as number) && (ordinal as number) > 0 ? (ordinal as number) : null;

  if (k === "reference") return ord ? `REF ${ord}` : "REF";
  if (k === "wip") return ord && ord > 1 ? `WIP ${ord}` : "WIP";
  if (k === "first_draft") return "1st Draft";
  if (k === "revision") {
    // revision #1 = "2nd Draft" (the 1st Draft was the first_draft kind).
    // revision #2 = "3rd Draft", and so on.
    if (!ord) return "Revision";
    return `${ordinalWord(ord + 1)} Draft`;
  }
  if (k === "final") return "Final";
  if (k === "print_ready") return "Print File";
  return "a file";
}

/** Build the unread preview line for a brief tile.
 *
 *  Examples:
 *    HPD uploaded REF 3
 *    Designer uploaded 2nd Draft
 *    Client added a note on 1st Draft
 *    Designer: "love it but the type feels…"
 */
export function formatActivityText(ev: ActivityEvent): string {
  const who = WHO_LABEL[ev.role];

  if (ev.type === "upload") {
    return `${who} uploaded ${formatFileLabel(ev.kind, ev.ordinal)}`;
  }
  if (ev.type === "note") {
    return `${who} added a note on ${formatFileLabel(ev.kind, ev.ordinal)}`;
  }
  // message
  if (ev.messageBody) {
    const trimmed = ev.messageBody.trim().replace(/\s+/g, " ");
    const max = 60;
    const preview = trimmed.length > max ? trimmed.slice(0, max).trimEnd() + "…" : trimmed;
    return `${who}: "${preview}"`;
  }
  return `${who} posted`;
}

/** Compute per-kind 1-based ordinal for each file, sorted by created_at
 *  ascending so the oldest gets ordinal 1.
 *
 *  Returns a map: file.id → ordinal-within-its-kind. */
export function computeFileOrdinals<F extends { id: string; kind: string; created_at: string | null }>(
  files: F[]
): Record<string, number> {
  // Group by kind
  const byKind: Record<string, F[]> = {};
  for (const f of files) {
    const k = (f.kind || "").toLowerCase();
    (byKind[k] ||= []).push(f);
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(byKind)) {
    const sorted = [...byKind[k]].sort((a, b) =>
      (a.created_at || "").localeCompare(b.created_at || "")
    );
    sorted.forEach((f, i) => { out[f.id] = i + 1; });
  }
  return out;
}

// Kind → unread highlight color. Mirrors KIND_ACCENT in
// components/ArtReferencesGrid so a tile's border + ribbon match the
// header bar of whichever file triggered the unread state. Uses
// OpsHub's T palette tokens directly so portal C and dashboard T both
// resolve to the same hex.
export function unreadHighlightFor(kind: string | null | undefined): string {
  if (!kind) return "#73b6c9"; // T.blue — default for messages / no file
  if (kind === "wip") return "#f4b22b";          // T.amber
  if (kind === "first_draft") return "#73b6c9";  // T.blue
  if (kind === "revision") return "#fd3aa3";     // T.purple (pink)
  if (kind === "final") return "#4ddb88";        // T.green
  if (kind === "print_ready") return "#4ddb88";  // T.green
  return "#1a1a1a"; // T.text — reference / intake / unknown
}

// Identify high-signal client events so HPD + designer can render them
// as milestones rather than generic "NEW" notifications. State + role
// is enough — no server-side classification needed.
//
// Returns null when the unread is just regular activity (uploads, chat,
// references). Caller picks color and label from the returned tag.
export type UnreadEvent =
  | { kind: "approval"; label: string; color: string }
  | { kind: "revisions"; label: string; color: string };

export function unreadEventFor(
  state: string,
  unreadByRole: string | null | undefined,
  viewerRole: "hpd" | "designer" | "client",
  previewLine?: string | null,
): UnreadEvent | null {
  if (!unreadByRole) return null;
  // Client triggered these — show to HPD + designer as a milestone.
  if (viewerRole === "client") return null;

  // Preview-line check first — survives state transitions. After the
  // client approves, the designer might upload Final and bump state to
  // pending_prep before HPD has read the approval. The unread is still
  // the approval, so detect it from the message text rather than relying
  // on state being final_approved at read time. Same for revisions.
  if (unreadByRole === "client" && previewLine) {
    if (/✓\s*Approved/i.test(previewLine)) {
      return { kind: "approval", label: "APPROVED", color: "#4ddb88" };
    }
    if (/Requested changes/i.test(previewLine)) {
      return { kind: "revisions", label: "REVISIONS", color: "#fd3aa3" };
    }
  }

  // Fallback — state + role for cases where preview wasn't captured.
  if (state === "final_approved" && unreadByRole === "client") {
    return { kind: "approval", label: "APPROVED", color: "#4ddb88" };
  }
  if (state === "revisions" && unreadByRole === "client") {
    return { kind: "revisions", label: "REVISIONS", color: "#fd3aa3" };
  }
  return null;
}
