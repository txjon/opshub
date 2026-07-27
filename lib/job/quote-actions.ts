// Quote + proofs SEND — the combined client-facing send for the Quote+Proofs
// surface. ONE email: the portal link shows quote + proofs together and the
// hub's blanket approval covers both, so the quote email alone carries the
// whole review (Jon, Jul 26 — the separate proof-ready notice doubled up).
// The proof-ready notice now goes out ONLY on proofs-only sends (quote
// already approved — the client needs a nudge specifically for proofs).
// Thin over the existing email routes. See [[jon-clean-architecture-standard]].

// Send quote + proofs to the client. `to` = the primary recipient (billing →
// primary contact); `cc` = the rest.
export async function sendQuoteAndProofs(job: any, opts: { to: string; cc?: string[]; includeProofs?: boolean; proofsOnly?: boolean }): Promise<void> {
  const { to, cc = [], includeProofs = true, proofsOnly = false } = opts;

  // Quote email — link-only; the route sets type_meta.quote_sent_at + logs
  // activity. The portal link inside covers the proofs too — no second email.
  if (!proofsOnly) {
    const q = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "quote", jobId: job.id, recipientEmail: to, ccEmails: cc }),
    });
    if (!q.ok) throw new Error((await q.json().catch(() => ({}))).error || "Quote email failed");
    return;
  }

  // Proofs-only (quote already approved): the proof-ready notice IS the send.
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
