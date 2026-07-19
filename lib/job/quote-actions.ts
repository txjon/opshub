// Quote + proofs SEND — the combined client-facing send for the Quote+Proofs
// surface. One action fires BOTH the quote email (link-only → sets quote_sent_at
// server-side) and the proof-ready notice, so the client gets a single portal
// link to review + approve everything together. Thin over the existing email
// routes. See [[jon-clean-architecture-standard]].

// Send quote + proofs to the client. `to` = the primary recipient (billing →
// primary contact); `cc` = the rest. includeProofs=false sends the quote alone
// (a job with no proofs yet).
export async function sendQuoteAndProofs(job: any, opts: { to: string; cc?: string[]; includeProofs?: boolean; proofsOnly?: boolean }): Promise<void> {
  const { to, cc = [], includeProofs = true, proofsOnly = false } = opts;

  // 1. Quote email — link-only; the route sets type_meta.quote_sent_at + logs activity.
  //    Skipped when the quote is already approved (internally / via client PO):
  //    the client only needs to approve the PROOFS, so no quote goes out.
  if (!proofsOnly) {
    const q = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "quote", jobId: job.id, recipientEmail: to, ccEmails: cc }),
    });
    if (!q.ok) throw new Error((await q.json().catch(() => ({}))).error || "Quote email failed");
  }

  // 2. Proof-ready notice — portal link; the route handles recipients + logging.
  if (includeProofs) {
    const p = await fetch("/api/email/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, type: "proof_ready" }),
    });
    if (!p.ok) throw new Error((await p.json().catch(() => ({}))).error || "Proof email failed");
  }
}

// Default client recipient for the send: billing contact → primary → any with an email.
export function defaultRecipient(contacts: any[]): { to: string; cc: string[] } {
  const withEmail = (contacts || []).filter(c => c.email);
  const primary = withEmail.find(c => c.role_on_job === "billing") || withEmail.find(c => c.role_on_job === "primary") || withEmail[0];
  const to = primary?.email || "";
  const cc = withEmail.filter(c => c.email && c.email !== to).map(c => c.email);
  return { to, cc };
}
