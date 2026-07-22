// Internal notification mail — ONE router (Jul 21 2026, Jon: "all emails
// need to land in the right place and be tailored for every combination").
//
// Every internal event goes through sendInternalMail(): the event picks its
// department inbox(es) and builds tailored copy from its payload. Adding a
// department = one env var; adding an event = one case here — call sites
// never hand-roll subjects or recipients again.
//
// Department addresses (env-overridable; everything falls back to
// production@ until the real inboxes exist):
//   EMAIL_LABS   — production / costing / studio   (default production@)
//   EMAIL_DISTRO — warehouse / receiving / pulls   (default production@)
//   EMAIL_ECOMM  — webstore / launches             (default production@)
import { Resend } from "resend";

const FALLBACK = "production@housepartydistro.com";
const DEPT = {
  labs: process.env.EMAIL_LABS || FALLBACK,
  distro: process.env.EMAIL_DISTRO || FALLBACK,
  ecomm: process.env.EMAIL_ECOMM || FALLBACK,
};

export type InternalEvent =
  | { kind: "cart_reorder"; client: string; jobNumber: string; title: string; itemCount: number; note?: string | null; jobId: string }
  | { kind: "pull_request"; client: string; itemName: string; jobNumber?: string | null; units: number; breakdown: string; reason: string }
  | { kind: "new_idea"; client: string; title: string; notes?: string | null }
  | { kind: "client_approved"; client: string; jobNumber: string; jobId: string }
  | { kind: "client_changes"; client: string; jobNumber: string; jobId: string; note?: string | null }
  | { kind: "drop_ready"; client: string; title: string; targetLive?: string | null; newLines: number; pipeLines: number };

function build(e: InternalEvent): { to: string[]; subject: string; text: string } {
  switch (e.kind) {
    case "cart_reorder":
      return {
        to: [DEPT.labs],
        subject: `Client reorder request — ${e.jobNumber} (${e.client})`,
        text: `${e.client} submitted a reorder from the client hub.\n\nJob: ${e.jobNumber} — ${e.title}\nItems: ${e.itemCount}\n${e.note ? `Note: ${e.note}\n` : ""}\nIt's in Intake wearing a CLIENT tag — cost it and quote it.\nReview: https://app.housepartydistro.com/jobs/${e.jobId}`,
      };
    case "pull_request":
      return {
        to: [DEPT.distro],
        subject: `Pull request — ${e.itemName} (${e.client})`,
        text: `${e.client} requested a pull from the client hub.\n\nItem: ${e.itemName}${e.jobNumber ? ` (${e.jobNumber})` : ""}\nQty: ${e.units} pcs — ${e.breakdown}\n${e.reason}\n\nIt's pending in the warehouse pulls queue — fulfill when the goods allow.`,
      };
    case "new_idea":
      return {
        to: [DEPT.labs],
        subject: `New idea — "${e.title}" (${e.client})`,
        text: `${e.client} dropped a new idea in the Studio.\n\n"${e.title}"\n${e.notes ? `\n${e.notes}\n` : ""}\nIt's a draft on the studio board — answer it.`,
      };
    case "client_approved":
      return {
        to: [DEPT.labs],
        subject: `Client approved — ${e.jobNumber} (${e.client})`,
        text: `${e.client} approved the order package (quote + proofs) from the client hub.\n\nJob: ${e.jobNumber}\nThe phase has already advanced — next lifecycle step is yours.\nReview: https://app.housepartydistro.com/jobs/${e.jobId}`,
      };
    case "client_changes":
      return {
        to: [DEPT.labs],
        subject: `Client requested changes — ${e.jobNumber} (${e.client})`,
        text: `${e.client} requested changes from the client hub.\n\nNote: ${e.note || "(none)"}\nJob: ${e.jobNumber}\nRevise and re-send — approval re-opens for them automatically.\nReview: https://app.housepartydistro.com/jobs/${e.jobId}`,
      };
    case "drop_ready": {
      // Composition decides the department(s) AND the task.
      const launchOnly = e.newLines === 0;
      const prodOnly = e.pipeLines === 0;
      const to = launchOnly ? [DEPT.ecomm, DEPT.distro]
        : prodOnly ? [DEPT.labs]
        : [DEPT.labs, DEPT.ecomm, DEPT.distro];
      const task = launchOnly
        ? `All ${e.pipeLines} lines are already in the pipeline — NO new production. Launch prep: watch the landings, build the listings, mark it launched.`
        : prodOnly
        ? `All ${e.newLines} lines are new — cost it, quote it, and cutting births the job.`
        : `${e.pipeLines} lines are in the pipeline (launch prep — ecomm/distro) + ${e.newLines} new lines (production enters at cut — labs).`;
      return {
        to: Array.from(new Set(to)),
        subject: `Drop ready — "${e.title}" (${e.client})`,
        text: `${e.client} submitted a drop from the hub.\n\n"${e.title}"${e.targetLive ? `\nTarget live: ${e.targetLive}` : ""}\n${task}\n\nIt's on the drops board.`,
      };
    }
  }
}

export async function sendInternalMail(e: InternalEvent): Promise<void> {
  try {
    const { to, subject, text } = build(e);
    const resend = new Resend(process.env.RESEND_API_KEY!);
    await resend.emails.send({ from: "OpsHub <production@housepartydistro.com>", to, subject, text });
  } catch {
    // notification failure must never sink the action it announces
  }
}
