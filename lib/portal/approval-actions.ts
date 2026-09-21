// Blanket package approval — THE shared client-approval logic for both portal API
// routes (per-job `/api/portal/[token]` and Client-Hub
// `/api/portal/client/[token]/orders/[jobId]`). One source so the two can't drift.
//
// Model (no migration): the client approves the whole package in ONE action.
//   approvePackage → flips jobs.quote_approved (the phase gate the engine already
//   reads) + approves every active proof + freezes an accountability snapshot in
//   jobs.type_meta.approval_snapshot (quote total, terms, exact proof file IDs,
//   timestamp, channel) — invisible to the client, our record of what they agreed to.
//   requestChanges → records a job-level change note in type_meta.change_request,
//   no approval. Both log to job_activity (the notifications table is deprecated).
// See [[jon-clean-architecture-standard]].

import { recalcJobPhase } from "@/lib/job-phase-recalc";
import { mergeJobTypeMeta } from "@/lib/job-type-meta";

type Sb = any; // service-role supabase client (admin())

const money = (n: number | null) => (n != null ? ` ($${Math.round(n).toLocaleString()})` : "");

// The total the client saw on the quote = product revenue + additional charges.
// (Tax/QB total isn't known at quote-approval time — the invoice comes later.)
function quoteTotalOf(job: any): number | null {
  const tm = job?.type_meta || {};
  const grossRev = Number(job?.costing_summary?.grossRev) || 0;
  const extras = (Array.isArray(tm.invoice_extra_lines) ? tm.invoice_extra_lines : [])
    .reduce((a: number, l: any) => a + (Number(l?.amount) || 0), 0);
  const total = grossRev + extras;
  return total > 0 ? Math.round(total * 100) / 100 : null;
}

export type ApprovalSnapshot = {
  at: string;
  quoteTotal: number | null;
  terms: string | null;
  proofs: { itemId: string; itemName: string | null; driveFileId: string | null; fileName: string | null }[];
  via: string; // the token/channel the approval came through
  // Per-line pricing AS APPROVED. The hub quote renders live, so the moment
  // costing is revised the approved numbers are gone everywhere else — this is
  // the only durable record of what the client agreed to line-by-line
  // (HPD-2607-032, Jul 28 2026: total survived, the $/unit split didn't).
  lines?: { itemId: string; name: string | null; qty: number; sellPerUnit: number; lineTotal: number }[];
  extras?: { description: string; amount: number }[];
};

// Approve the whole package. Returns the frozen snapshot.
export async function approvePackage(sb: Sb, jobId: string, ctx: { via?: string } = {}): Promise<ApprovalSnapshot> {
  const now = new Date().toISOString();
  const { data: job } = await sb.from("jobs")
    .select("id, payment_terms, costing_summary, type_meta")
    .eq("id", jobId).single();
  const tm = job?.type_meta || {};

  // Gather items + their active proofs (for the snapshot AND to approve).
  // artwork_status is selected because n_a items are excluded from version
  // stamping below — without it every item looked like it needed a proof.
  const { data: items } = await sb.from("items").select("id, name, sell_per_unit, artwork_status").eq("job_id", jobId);
  const itemIds = (items || []).map((i: any) => i.id);
  const nameById: Record<string, string> = Object.fromEntries((items || []).map((i: any) => [i.id, i.name]));

  // Per-line pricing as approved — qty from buy_sheet_lines (the qty source of
  // truth), sell from items.sell_per_unit (what the hub quote showed).
  const qtyByItem: Record<string, number> = {};
  if (itemIds.length) {
    const { data: bsl } = await sb.from("buy_sheet_lines").select("item_id, qty_ordered").in("item_id", itemIds);
    for (const r of bsl || []) qtyByItem[r.item_id] = (qtyByItem[r.item_id] || 0) + (Number(r.qty_ordered) || 0);
  }
  const lines = (items || []).map((i: any) => {
    const qty = qtyByItem[i.id] || 0;
    const sell = Math.round((Number(i.sell_per_unit) || 0) * 100) / 100;
    return { itemId: i.id, name: i.name || null, qty, sellPerUnit: sell, lineTotal: Math.round(sell * qty * 100) / 100 };
  });
  const extras = (Array.isArray(tm.invoice_extra_lines) ? tm.invoice_extra_lines : [])
    .filter((l: any) => l && (Number(l.amount) || 0) !== 0)
    .map((l: any) => ({ description: String(l.description || ""), amount: Number(l.amount) || 0 }));

  let proofFiles: any[] = [];
  const approvedVersions: any[] = [];
  // Set once versions are stamped, so a later failure can put them back.
  let approveUndo: (() => Promise<boolean>) | null = null;
  if (itemIds.length) {
    const { data: files } = await sb.from("item_files")
      .select("id, item_id, file_name, drive_file_id")
      .in("item_id", itemIds).eq("stage", "proof").is("superseded_at", null);
    proofFiles = files || [];

    // The VERSION is the record of what the client signed off, so it is stamped
    // FIRST and the whole approval is all-or-nothing.
    //
    // This used to run last, inside a catch that logged and carried on. On
    // 2026-09-21 a hub approval flipped the job and the item to approved while
    // the version stayed 'sent': the client was told it worked, the team saw an
    // approved item, and nothing recorded what had been agreed to. An approval
    // that leaves no record is not an approval.
    //
    // Stamping exactly what the client was SHOWN (clientVisibleVersions) closes
    // the other half: iterating every item and taking whatever version was
    // newest could stamp a draft nobody ever sent, which the vendor portal then
    // serves to the printer as the approved proof.
    const { approveVersion, clientVisibleVersions } = await import("@/lib/proof-versions");
    const { visible } = await clientVisibleVersions(sb, itemIds);
    const noProofItems = new Set((items || []).filter((i: any) => i.artwork_status === "n_a").map((i: any) => i.id));
    const stamped: { id: string; state: string; approvedAt: string | null }[] = [];

    const undoStamps = async () => {
      // Put back everything this call changed, so a failure leaves the job
      // exactly as the client found it.
      let clean = true;
      for (const st of stamped) {
        const { error } = await sb.from("proof_versions")
          .update({ state: st.state, approved_at: st.approvedAt, approved_by: null, approval_source: null })
          .eq("id", st.id);
        if (error) { clean = false; console.error("[approval] could not undo a proof stamp:", st.id, error.message); }
      }
      return clean;
    };

    try {
      for (const [itemId, v] of visible) {
        if (noProofItems.has(itemId)) continue;   // nothing was ever put to the client here
        if (v.state === "approved") {
          approvedVersions.push({ itemId, itemName: nameById[itemId] || null, versionId: v.id, version: v.version, proofUrl: `/api/proof/${v.id}/pdf` });
          continue;
        }
        // Name the exact version, so what gets stamped is what was shown.
        let r = await approveVersion(sb, { itemId, versionId: v.id, approvedBy: ctx.via || "client", source: "client" });
        // One retry: the failure we saw was not reproducible, so a transient
        // hiccup is the likeliest cause and is worth absorbing.
        if (!r.ok) r = await approveVersion(sb, { itemId, versionId: v.id, approvedBy: ctx.via || "client", source: "client" });
        if (!r.ok || !r.version) throw new Error(`Could not record the approval for "${nameById[itemId] || "this item"}".`);
        stamped.push({ id: v.id, state: v.state, approvedAt: v.approved_at });
        approvedVersions.push({ itemId, itemName: nameById[itemId] || null, versionId: r.version.id, version: r.version.version, proofUrl: `/api/proof/${r.version.id}/pdf` });
      }
    } catch (e: any) {
      const clean = await undoStamps();
      throw new Error(clean
        ? `${e?.message || "The approval could not be recorded."} Nothing has been approved — please try again.`
        : `${e?.message || "The approval could not be recorded."} Please contact us before approving again.`);
    }

    // Derived state, only once the record exists. If either of these fails the
    // record is rolled back too — an approved proof under an unapproved job is
    // the split state this whole ordering exists to prevent.
    const failDerived = async (what: string, detail: string) => {
      console.error(`[approval] ${what} write failed:`, detail);
      const clean = await undoStamps();
      throw new Error(clean
        ? "Could not save the approval. Nothing has been approved — please try again."
        : "Could not save the approval. Please contact us before approving again.");
    };
    {
      const { error } = await sb.from("item_files")
        .update({ approval: "approved", approved_at: now })
        .in("item_id", itemIds).eq("stage", "proof").is("superseded_at", null);
      if (error) await failDerived("proof files", error.message);
    }
    {
      // n_a (no proof needed) stays n_a — the client never had a proof to approve on it.
      const { error } = await sb.from("items").update({ artwork_status: "approved" }).in("id", itemIds).neq("artwork_status", "n_a");
      if (error) await failDerived("item status", error.message);
    }
    approveUndo = undoStamps;
  }

  const snapshot: ApprovalSnapshot = {
    at: now,
    quoteTotal: quoteTotalOf(job),
    terms: job?.payment_terms || null,
    // The paper trail: what the client approved. A proof is a VERSION now, so
    // the snapshot records versions and falls back to any file rows that exist.
    proofs: (approvedVersions.length ? approvedVersions : proofFiles.map((f: any) => ({
      itemId: f.item_id, itemName: nameById[f.item_id] || null, driveFileId: f.drive_file_id, fileName: f.file_name,
    }))) as any,
    via: ctx.via || "portal",
    lines,
    extras,
  };

  // Flip the quote gate + freeze the snapshot + clear any prior change request.
  //
  // BOTH are checked. mergeJobTypeMeta returns {ok:false} rather than throwing,
  // and the mig-176 type_meta guard can refuse a write outright — so an
  // unchecked call here loses approval_snapshot, the only durable record of the
  // per-line pricing the client agreed to, while everything else reads
  // approved. See the type_meta silent-refusal rule.
  {
    const { error } = await sb.from("jobs")
      .update({ quote_approved: true, quote_approved_at: now, quote_rejection_notes: null }).eq("id", jobId);
    if (error) {
      if (approveUndo) await approveUndo();
      throw new Error("Could not save the approval. Nothing has been approved — please try again.");
    }
  }
  {
    const merged = await mergeJobTypeMeta(sb, jobId, { approval_snapshot: snapshot, change_request: null });
    if (!merged.ok) {
      // The gate is already open; rather than leave the money record missing in
      // silence, put everything back and make the client retry.
      await sb.from("jobs").update({ quote_approved: false, quote_approved_at: null }).eq("id", jobId);
      if (approveUndo) await approveUndo();
      await sb.from("items").update({ artwork_status: "not_started" }).in("id", itemIds).eq("artwork_status", "approved");
      throw new Error("Could not save the approval record. Nothing has been approved — please try again.");
    }
  }

  await sb.from("job_activity").insert({
    job_id: jobId, user_id: null, type: "auto",
    message: `Package approved by client via portal${money(snapshot.quoteTotal)} — ${proofFiles.length} proof${proofFiles.length === 1 ? "" : "s"}`,
  });

  // The approval changes the gates — recalc the stored phase NOW so every
  // board reflects the client's action immediately (it used to wait until
  // someone opened the job in OpsHub). Best-effort: an approval must never
  // fail because the recalc hiccuped.
  try { await recalcJobPhase(sb, jobId); } catch (e) { console.error("[approvePackage] phase recalc failed", (e as any)?.message); }

  try {
    const { data: j2 } = await sb.from("jobs").select("job_number, clients(name)").eq("id", jobId).single();
    const { sendInternalMail } = await import("@/lib/internal-mail");
    await sendInternalMail({ kind: "client_approved", client: (j2 as any)?.clients?.name || "Client", jobNumber: (j2 as any)?.job_number || jobId, jobId });
  } catch {}

  return snapshot;
}

// Record a package-level change request: one free-text note + OPTIONAL item tags
// (Jon 2026-07-20). Tagged items get their live proofs flipped to
// revision_requested (which drives the internal Revision states + the
// "Send revised proofs" nudge) and their blanket internal approval cleared so
// the lifecycle gate genuinely re-closes for them. Untagged = note applies to
// the whole order, nothing is flipped. Never approves anything.
export async function requestChanges(sb: Sb, jobId: string, note: string, itemIds?: string[]): Promise<void> {
  const now = new Date().toISOString();
  const { data: job } = await sb.from("jobs").select("id, type_meta").eq("id", jobId).single();
  const tm = job?.type_meta || {};

  let taggedIds: string[] = [];
  let taggedNames: string[] = [];
  const requested = (itemIds || []).filter(Boolean);
  if (requested.length) {
    // Only items that actually belong to this job — the token authorizes the
    // job, never arbitrary item ids.
    const { data: its } = await sb.from("items").select("id, name").eq("job_id", jobId).in("id", requested);
    taggedIds = (its || []).map((i: any) => i.id);
    taggedNames = (its || []).map((i: any) => i.name).filter(Boolean);
    if (taggedIds.length) {
      // The note rides on the proof file — that's where the team's revision
      // nudge + the ApprovalsTab revision note read from.
      await sb.from("item_files")
        .update({ approval: "revision_requested", notes: note || null })
        .in("item_id", taggedIds).eq("stage", "proof").is("superseded_at", null);
      // approvePackage blanket-set artwork_status=approved; a client revision
      // must reopen the gate for these items (other statuses untouched).
      await sb.from("items").update({ artwork_status: "not_started" })
        .in("id", taggedIds).eq("artwork_status", "approved");
      // The VERSION has to reopen too, or the proof keeps reading "approved"
      // everywhere while the client is waiting on a revision. It drops back to
      // SENT — it did go out, it simply isn't signed off any more.
      // ONLY the live version. Without the superseded filter this wiped
      // approved_at / approved_by off every PAST approval of the item too —
      // rows that are the signed record of earlier rounds, some with their
      // signed PDF still on file. A routine client action must not destroy
      // history.
      await sb.from("proof_versions")
        .update({ state: "sent", approved_at: null, approved_by: null, approval_source: null })
        .in("item_id", taggedIds).eq("state", "approved").is("superseded_at", null);
    }
  }

  await mergeJobTypeMeta(sb, jobId, { change_request: { note: note || "", at: now, itemIds: taggedIds, itemNames: taggedNames } });
  await sb.from("job_activity").insert({
    job_id: jobId, user_id: null, type: "auto",
    message: `Changes requested by client via portal${taggedNames.length ? ` on ${taggedNames.join(", ")}` : ""}${note ? `: "${note}"` : ""}`,
  });

  // Tagged revisions can re-close gates (proofs no longer all approved) —
  // reflect that on the boards immediately.
  try { await recalcJobPhase(sb, jobId); } catch (e) { console.error("[requestChanges] phase recalc failed", (e as any)?.message); }

  try {
    const { data: j2 } = await sb.from("jobs").select("job_number, clients(name)").eq("id", jobId).single();
    const { sendInternalMail } = await import("@/lib/internal-mail");
    await sendInternalMail({ kind: "client_changes", client: (j2 as any)?.clients?.name || "Client", jobNumber: (j2 as any)?.job_number || jobId, jobId, note });
  } catch {}
}
