// Recompute an art-brief state after a file delete. Only ladders DOWN
// from designer-upload-driven states (wip_review, client_review,
// pending_prep). Other states (draft, sent, final_approved,
// production_ready, delivered, revisions, in_progress) aren't recomputed
// — those reflect explicit human decisions (HPD approval, client
// approve, archive, etc.) that shouldn't be overridden by file inventory.
//
// Ladder of designer deliverables, highest first:
//   final → pending_prep
//   first_draft / revision → client_review
//   wip → wip_review
//   none → in_progress (designer still working)

type FileKindRow = { kind: string };

const RECOMPUTABLE_STATES = ["wip_review", "client_review", "pending_prep"] as const;

export function recomputeBriefState(
  currentState: string,
  remainingFiles: FileKindRow[],
): string | null {
  if (!RECOMPUTABLE_STATES.includes(currentState as any)) return null;

  const has = (k: string) => remainingFiles.some(f => f.kind === k);
  const hasFinal = has("final");
  const hasDraft = has("first_draft") || has("revision");
  const hasWip = has("wip");

  // Current state still has its supporting file — no demotion needed.
  if (currentState === "pending_prep" && hasFinal) return null;
  if (currentState === "client_review" && hasDraft) return null;
  if (currentState === "wip_review" && hasWip) return null;

  // Demote to the next-highest deliverable that does exist.
  if (hasFinal) return "pending_prep";
  if (hasDraft) return "client_review";
  if (hasWip) return "wip_review";
  return "in_progress";
}
