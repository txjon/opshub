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
  // Directive voice (Jon: "here's what's coming is nice — here's what to do
  // with it is better"): every email = what happened, DO THIS (numbered,
  // with the exact link), DONE WHEN (the completion condition).
  const APP = "https://app.housepartydistro.com";
  switch (e.kind) {
    case "cart_reorder":
      return {
        to: [DEPT.labs],
        subject: `Client reorder — ${e.jobNumber} (${e.client}) — cost & quote it`,
        text: `${e.client} built a reorder in their hub: ${e.itemCount} item${e.itemCount === 1 ? "" : "s"}, sizes prefilled from their last run.${e.note ? `\nTheir note: "${e.note}"` : ""}

DO THIS:
1. Open the job: ${APP}/jobs/${e.jobId} (it's in Intake, tagged CLIENT)
2. Check blanks + pricing in Costing — their art carried over, artwork is already approved
3. Send the quote — approval opens in their hub automatically

DONE WHEN: the quote is sent. The client is actively waiting on this one.`,
      };
    case "pull_request":
      return {
        to: [DEPT.distro],
        subject: `Pull — ${e.units} pcs of ${e.itemName} (${e.client})`,
        text: `${e.client} requested a pull from their hub.

Item: ${e.itemName}${e.jobNumber ? ` (${e.jobNumber})` : ""}
Pull: ${e.breakdown}
${e.reason}

DO THIS:
1. Open the pulls queue: ${APP}/warehouse — it's pending against this item
2. Goods on hand? Pull it now. Still inbound? It's queued against the landing — pull at receive
3. Log the pulled quantities to mark it fulfilled

DONE WHEN: fulfilled quantities are logged. The client sees "requested" until then.`,
      };
    case "new_idea":
      return {
        to: [DEPT.labs],
        subject: `New idea — "${e.title}" (${e.client}) — answer it`,
        text: `${e.client} dropped an idea in their Studio.

"${e.title}"${e.notes ? `\n${e.notes}` : ""}

DO THIS:
1. Open the Studio: ${APP}/studio2 — it's sitting in "Your move"
2. Read the idea + their build-out lines (formats, retails, notes per item)
3. Reply in the thread (Client-visible) — even a quick "love it, sketching soon" keeps the ping-pong alive. Send to a designer when it's ready to sketch

DONE WHEN: you've answered or it's with a designer. Silence is the only wrong move.`,
      };
    case "client_approved":
      return {
        to: [DEPT.labs],
        subject: `APPROVED — ${e.jobNumber} (${e.client}) — next gate is yours`,
        text: `${e.client} approved the full package (quote + proofs) in their hub. The phase has already advanced on its own.

DO THIS:
1. Open the job: ${APP}/jobs/${e.jobId}
2. Run the next gate: order blanks + send POs (the Blanks tab shows the 3-gate checklist)
3. If the invoice hasn't gone out, send it from the Proofs & Invoice tab

DONE WHEN: blanks are ordered and POs are out. This is a green light — treat it same-day.`,
      };
    case "client_changes":
      return {
        to: [DEPT.labs],
        subject: `Changes requested — ${e.jobNumber} (${e.client})`,
        text: `${e.client} requested changes in their hub.
Their note: ${e.note || "(none — check the thread)"}

DO THIS:
1. Open the job: ${APP}/jobs/${e.jobId}
2. Revise the flagged proofs (tagged items flipped back to revision automatically)
3. Re-send — their approval re-opens in the hub on its own

DONE WHEN: revised proofs are back in front of them. Their clock is running on us now.`,
      };
    case "drop_ready": {
      const launchOnly = e.newLines === 0;
      const prodOnly = e.pipeLines === 0;
      const to = launchOnly ? [DEPT.ecomm, DEPT.distro]
        : prodOnly ? [DEPT.labs]
        : [DEPT.labs, DEPT.ecomm, DEPT.distro];
      const head = `${e.client} handed over a drop: "${e.title}"${e.targetLive ? ` — target live ${e.targetLive}` : ""}.`;
      const body = launchOnly
        ? `All ${e.pipeLines} lines are ALREADY IN THE PIPELINE — no new production. This is a launch.

ECOMM — DO THIS:
1. Open the drops board: ${APP}/drops — the sheet shows every line with art, retail, and landing state
2. Build the Shopify listings from the lineup (art + retail are on each line)
3. Watch the landed counter on the sheet — launch prep finishes when it reads all-landed
4. Launch day: flip the products live, then hit "Mark launched" on the board

WAREHOUSE — DO THIS:
Receive the landings as normal — this release sells from those goods. The drops sheet shows which lines are still inbound.

DONE WHEN: products are live and the board says Launched.`
        : prodOnly
        ? `All ${e.newLines} lines are NEW — this drop brings in production.

DO THIS:
1. Open the drops board: ${APP}/drops — the lineup shows every line with the client's retail + notes
2. Cost each line and get the quote back to them
3. When production numbers are in: ✂ Cut the drop — it births the job with their quantities

DONE WHEN: the drop is cut and the job is in the pipeline.`
        : `${e.pipeLines} lines are in the pipeline (launch work) + ${e.newLines} NEW lines (production work). Two lanes, one drop:

LABS — cost the ${e.newLines} new line${e.newLines === 1 ? "" : "s"}; cutting births their job: ${APP}/drops
ECOMM — build listings for the pipeline lines; watch landings; Mark launched when live
WAREHOUSE — receive the landings as normal

DONE WHEN: new lines are cut AND the pipeline lines are launched.`;
      return {
        to: Array.from(new Set(to)),
        subject: launchOnly
          ? `Drop ready to LAUNCH — "${e.title}" (${e.client}) — no new production`
          : prodOnly
          ? `Drop ready to COST — "${e.title}" (${e.client}) — ${e.newLines} new lines`
          : `Drop ready — "${e.title}" (${e.client}) — launch + production`,
        text: `${head}

${body}`,
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
