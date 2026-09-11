// Read-merge-write for jobs.type_meta from the browser. type_meta is one jsonb
// blob holding the invoice link, PO-sent record, approval snapshot, cost
// snapshots — everything a job IS after intake. A whole-blob update built on a
// FAILED read wipes all of it: Sep 11 2026, a ship-by edit on HPD-2608-032
// rewrote type_meta to {po_ship_live} alone and invoice #4454 vanished from
// the job (freight stopped matching, hub lost the approval). The read errored
// once, transiently; the writer didn't check. This helper is the only sanctioned
// way to patch type_meta client-side: refuse to write unless the read returned
// a real row.
export async function patchJobTypeMeta(
  sb: any,
  jobId: string,
  patch: (tm: Record<string, any>) => Record<string, any>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await sb.from("jobs").select("id, type_meta").eq("id", jobId).maybeSingle();
  if (error) return { ok: false, error: `Could not read the job (${error.message}) — nothing saved.` };
  if (!data) return { ok: false, error: "Could not read the job — nothing saved." };
  const current = (data.type_meta && typeof data.type_meta === "object") ? data.type_meta : {};
  const next = patch({ ...current });
  const { error: wErr } = await sb.from("jobs").update({ type_meta: next }).eq("id", jobId);
  if (wErr) return { ok: false, error: wErr.message };
  return { ok: true };
}
