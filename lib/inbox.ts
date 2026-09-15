// THE INBOX — external words that need a reply (Jon, Sep 15 2026: "unread
// until someone responds or clears the item as handled"). One rule, read by
// the sidebar badge (/api/inbox) and by The House (the surface). No "last
// seen" clock, no manual flagging: an item is open until it resolves on its
// own or a person clears it.
//
//   proof   — client asked for a proof revision (item_files.approval =
//             revision_requested). Resolves when a new proof supersedes the
//             file; clears via inbox_cleared (key proof:<fileId>).
//   vendor  — a decorator flagged an issue on an assignment. Resolves when
//             issue_resolved_at is set (the "Mark resolved" action).
//   brief   — client or designer words on a brief newer than our last look,
//             or a fresh idea from the hub (draft). Resolves when we reply or
//             open the brief (hpd_last_seen_at).
//
// Quote rejections used to be a fourth source; nothing writes
// quote_rejection_notes any more, so they're gone.
import { attachUnreadStatus } from "@/lib/art-brief-activity";
import { getActiveCompanyId } from "@/lib/company";

export type InboxItem = {
  kind: "proof" | "vendor" | "brief";
  key: string;
  client: string;
  title: string;      // job number / brief title
  subject: string;    // item name / what was said
  note: string | null;
  at: string | null;
  href: string;
  jobId?: string; itemId?: string; fileId?: string; decoratorId?: string; briefId?: string;
  who?: "client" | "designer";
};

export async function loadInbox(sb: any): Promise<InboxItem[]> {
  const companyId = await getActiveCompanyId();
  const [proofs, flags, briefs, cleared] = await Promise.all([
    sb.from("item_files")
      .select("id, notes, created_at, items(id, name, job_id, jobs(id, job_number, phase, clients(name)))")
      .eq("approval", "revision_requested").is("superseded_at", null)
      .then((r: any) => (r.data || []) as any[]),
    sb.from("decorator_assignments")
      .select("item_id, decorator_id, last_issue_note, last_issue_at, items(id, name, job_id, jobs(id, job_number, phase, clients(name))), decorators(name, short_code)")
      .not("last_issue_at", "is", null).is("issue_resolved_at", null)
      .then((r: any) => (r.data || []) as any[]),
    sb.from("art_briefs")
      .select("id, title, state, hpd_last_seen_at, updated_at, clients(name)")
      .eq("company_id", companyId)
      .is("client_aborted_at", null).is("deleted_at", null)
      .not("state", "in", "(killed,shelved)")
      .then((r: any) => (r.data || []) as any[]),
    sb.from("inbox_cleared").select("key").eq("company_id", companyId)
      .then((r: any) => new Set(((r.data || []) as any[]).map(x => x.key))),
  ]);

  const items: InboxItem[] = [];
  for (const f of proofs) {
    const job = f.items?.jobs;
    if (!job || ["complete", "cancelled"].includes(job.phase)) continue;
    const key = `proof:${f.id}`;
    if (cleared.has(key)) continue;
    items.push({
      kind: "proof", key, client: job.clients?.name || "", title: job.job_number,
      subject: f.items.name, note: f.notes || null, at: f.created_at,
      href: `/jobs/${job.id}`, jobId: job.id, itemId: f.items.id, fileId: f.id, who: "client",
    });
  }
  for (const d of flags) {
    const job = d.items?.jobs;
    if (!job || ["complete", "cancelled"].includes(job.phase)) continue;
    items.push({
      kind: "vendor", key: `vendor:${d.item_id}:${d.decorator_id}`,
      client: job.clients?.name || "", title: job.job_number,
      subject: `${d.decorators?.name || d.decorators?.short_code || "Vendor"} · ${d.items.name}`,
      note: d.last_issue_note || null, at: d.last_issue_at,
      href: `/jobs/${job.id}`, jobId: job.id, itemId: d.item_id, decoratorId: d.decorator_id,
    });
  }
  const scored = await attachUnreadStatus(briefs, sb);
  for (const b of scored as any[]) {
    if (!(b.has_unread_external || b.state === "draft")) continue;
    items.push({
      kind: "brief", key: `brief:${b.id}`, client: b.clients?.name || "", title: b.title || "New idea",
      subject: b.state === "draft" ? "new idea from the hub" : `${b.unread_by_role === "designer" ? "designer" : "client"} words waiting`,
      note: null, at: b.unread_at || b.updated_at,
      href: `/studio?brief=${b.id}`, briefId: b.id, who: b.unread_by_role || "client",
    });
  }
  items.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  return items;
}
