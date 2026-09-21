// A proof is DATA, not a file.
//
// The old model baked a PDF into Drive and let the item be edited around it, so
// the document a client approved and a printer printed drifted from what the
// editor showed. Detecting that drift took three attempts; removing it takes
// this: the proof is a VERSION — the spec, the mockup and the item's facts at
// that moment. Editing makes a new draft. Sending freezes it. Approval stamps
// it. An edit after approval starts a new draft, so an approved version can
// never change.
//
// The PDF is rendered ON DEMAND from the version. The first time an APPROVED
// version is downloaded, that file is kept and reused forever — the artifact
// exists once somebody needs it, and is immutable from then on.

import { createClient as createAdmin } from "@supabase/supabase-js";

export type ProofState = "draft" | "sent" | "approved" | "superseded";

export type ProofVersion = {
  id: string;
  item_id: string;
  version: number;
  state: ProofState;
  spec: any;
  item_snapshot: any;
  mockup_drive_file_id: string | null;
  renderer_version: number | null;
  pdf_drive_file_id: string | null;
  pdf_created_at: string | null;
  created_at: string;
  sent_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approval_source: string | null;
  superseded_at: string | null;
};

const admin = () =>
  createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** The version that counts right now: the approved one, else the latest sent, else the latest draft. */
export async function currentVersion(db: any, itemId: string): Promise<ProofVersion | null> {
  const { data } = await db.from("proof_versions")
    .select("*").eq("item_id", itemId).is("superseded_at", null)
    .order("version", { ascending: false });
  const rows = (data || []) as ProofVersion[];
  return rows.find(r => r.state === "approved") || rows.find(r => r.state === "sent") || rows[0] || null;
}

/** The approved version, if there is one. This is the chain-of-custody record. */
export async function approvedVersion(db: any, itemId: string): Promise<ProofVersion | null> {
  const { data } = await db.from("proof_versions")
    .select("*").eq("item_id", itemId).eq("state", "approved")
    .order("version", { ascending: false }).limit(1);
  return ((data || [])[0] as ProofVersion) || null;
}

/**
 * Freeze the current art as a new version. Called when a proof is SENT (and by
 * the editor when art changes after a send), never on every keystroke.
 *
 * An approved version is never touched: a new draft is created above it, which
 * is what reopens the approval gate.
 */
export async function freezeVersion(db: any, opts: {
  itemId: string;
  spec: any;
  itemSnapshot?: any;
  mockupDriveFileId?: string | null;
  rendererVersion?: number | null;
  createdBy?: string | null;
  state?: Extract<ProofState, "draft" | "sent">;
  note?: string | null;
}): Promise<{ ok: true; version: ProofVersion } | { ok: false; error: string }> {
  const { data: last } = await db.from("proof_versions")
    .select("version, spec, state, id").eq("item_id", opts.itemId)
    .order("version", { ascending: false }).limit(1);
  const prev = (last || [])[0];

  // Identical art, still open for approval: keep the version we have rather
  // than pile up duplicates. Keys are sorted first — jsonb hands back a
  // different key order than the editor emits, so a plain stringify never
  // matched and every close made a new version.
  const canon = (v: any): any => Array.isArray(v) ? v.map(canon)
    : (v && typeof v === "object") ? Object.keys(v).sort().reduce((o: any, k) => { o[k] = canon(v[k]); return o; }, {})
    : v;
  // Identical art NEVER makes a new version — including over an approved one.
  // Opening an approved proof and closing it must change nothing, or the item
  // silently leaves approved and the ordering gate shuts (caught in review
  // before it shipped, Sep 2026).
  if (prev && JSON.stringify(canon(prev.spec)) === JSON.stringify(canon(opts.spec))) {
    const { data: unchanged } = await db.from("proof_versions").select("*").eq("id", prev.id).single();
    return { ok: true, version: unchanged as ProofVersion };
  }

  const version = (prev?.version || 0) + 1;
  const { data, error } = await db.from("proof_versions").insert({
    item_id: opts.itemId,
    version,
    state: opts.state || "draft",
    spec: opts.spec,
    item_snapshot: opts.itemSnapshot || null,
    mockup_drive_file_id: opts.mockupDriveFileId || null,
    renderer_version: opts.rendererVersion ?? null,
    created_by: opts.createdBy || null,
    sent_at: opts.state === "sent" ? new Date().toISOString() : null,
    note: opts.note || null,
  }).select("*").single();
  if (error) return { ok: false, error: error.message };

  // Earlier DRAFTS are retired — an approved version is left alone, it is the
  // record of what the client agreed to.
  if (prev && prev.state !== "approved") {
    await db.from("proof_versions").update({ state: "superseded", superseded_at: new Date().toISOString() })
      .eq("item_id", opts.itemId).lt("version", version).neq("state", "approved");
  }
  return { ok: true, version: data as ProofVersion };
}

/**
 * A version is SENT only when we actually sent it, and never before it existed.
 * Guessing a send date from the item's history put "sent Sep 16" on a version
 * created days later (Jon spotted it, Sep 2026).
 */
export async function markVersionSent(db: any, itemId: string): Promise<ProofVersion | null> {
  const { data } = await db.from("proof_versions").select("*")
    .eq("item_id", itemId).is("superseded_at", null)
    .order("version", { ascending: false }).limit(1);
  const v = ((data || [])[0] as ProofVersion) || null;
  if (!v || v.state === "approved" || v.sent_at) return v;
  const { data: updated } = await db.from("proof_versions")
    .update({ state: "sent", sent_at: new Date().toISOString() }).eq("id", v.id).select("*").single();
  return (updated as ProofVersion) || v;
}

/** Stamp approval on the version the client actually looked at. */
export async function approveVersion(db: any, opts: {
  itemId: string; versionId?: string | null; approvedBy?: string | null; source?: string;
}): Promise<{ ok: boolean; version?: ProofVersion; error?: string }> {
  let target: ProofVersion | null = null;
  if (opts.versionId) {
    const { data } = await db.from("proof_versions").select("*").eq("id", opts.versionId).maybeSingle();
    target = (data as ProofVersion) || null;
  } else {
    // The version the client actually saw: the newest SENT one. Only if
    // nothing has been sent does the newest draft stand in — otherwise an edit
    // made after a send would get blessed by an approval meant for the
    // document that went out.
    const { data } = await db.from("proof_versions").select("*")
      .eq("item_id", opts.itemId).is("superseded_at", null)
      .order("version", { ascending: false });
    const rows = (data || []) as ProofVersion[];
    target = rows.find(r => r.state === "sent" || r.sent_at) || rows[0] || null;
  }
  if (!target) return { ok: false, error: "no proof version to approve" };
  if (target.state === "approved") return { ok: true, version: target };

  const now = new Date().toISOString();
  const { data, error } = await db.from("proof_versions").update({
    state: "approved", approved_at: now,
    approved_by: opts.approvedBy || null, approval_source: opts.source || "client",
  }).eq("id", target.id).select("*").single();
  if (error) return { ok: false, error: error.message };

  // Only one approved version stands: older ones become history.
  await db.from("proof_versions").update({ state: "superseded", superseded_at: now })
    .eq("item_id", opts.itemId).lt("version", target.version).eq("state", "approved");
  return { ok: true, version: data as ProofVersion };
}

/**
 * The PDF for a version. Rendered on demand; an APPROVED version's file is kept
 * on first render and reused forever after (write-once evidence). Drafts are
 * never stored — there is nothing to go stale.
 */
export async function renderVersionPdf(versionId: string): Promise<{ ok: true; pdf: Buffer; fileName: string; cached: boolean } | { ok: false; error: string; status: number }> {
  const db = admin();
  const { data: v } = await db.from("proof_versions").select("*").eq("id", versionId).maybeSingle();
  if (!v) return { ok: false, error: "Not found", status: 404 };
  const version = v as ProofVersion;

  const { data: item } = await db.from("items")
    .select("id, name, jobs(job_number, title, qb_invoice_number, clients(name))")
    .eq("id", version.item_id).maybeSingle();
  const jobNumber = (item as any)?.jobs?.qb_invoice_number || (item as any)?.jobs?.job_number || "";
  const itemName = (version.item_snapshot?.name) || (item as any)?.name || "Item";
  const fileName = `${jobNumber ? jobNumber + " " : ""}${itemName} - Proof v${version.version}.pdf`;

  const { getAccessToken } = await import("./drive-auth");

  // Already rendered once and kept: serve that, byte for byte.
  if (version.pdf_drive_file_id) {
    try {
      const token = await getAccessToken();
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${version.pdf_drive_file_id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return { ok: true, pdf: Buffer.from(await res.arrayBuffer()), fileName, cached: true };
    } catch { /* fall through and render again */ }
  }

  // Render from the frozen data.
  const { renderProofHtml } = await import("./proof-html");
  const { generatePDF } = await import("./pdf/browser");
  const { getPdfBranding } = await import("./branding");
  const branding: any = await getPdfBranding().catch(() => ({ name: "House Party Distro", logoSvg: "" }));

  let mockupUrl: string | null = null;
  if (version.mockup_drive_file_id) {
    try {
      const token = await getAccessToken();
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${version.mockup_drive_file_id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const type = res.headers.get("content-type") || "image/png";
        mockupUrl = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
      }
    } catch { /* a proof without its mockup still renders */ }
  }

  let pdf: Buffer;
  try {
    const html = await renderProofHtml({
      spec: version.spec,
      itemName,
      clientName: (item as any)?.jobs?.clients?.name || "",
      brandName: branding.name || "House Party Distro",
      logoSvg: branding.logoSvg || "",
      mockupUrl,
    });
    pdf = (await generatePDF(html)) as Buffer;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not render the proof", status: 500 };
  }

  // An APPROVED version's PDF is kept the first time it is made. That file is
  // the evidence of the sign-off, so it is written once and never rewritten.
  if (version.state === "approved" && !version.pdf_drive_file_id) {
    try {
      const { getItemFolderId, uploadFile } = await import("./google-drive");
      const clientName = (item as any)?.jobs?.clients?.name || "Unknown Client";
      const projectTitle = (item as any)?.jobs?.title || jobNumber || "Untitled Project";
      const folderId = await getItemFolderId(clientName, projectTitle, itemName);
      const up = await uploadFile(folderId, fileName, "application/pdf", pdf);
      await db.from("proof_versions").update({ pdf_drive_file_id: up.fileId, pdf_created_at: new Date().toISOString() })
        .eq("id", version.id).is("pdf_drive_file_id", null);
    } catch (e: any) { console.error("[proof-versions] keeping the approved PDF failed:", e?.message || e); }
  }

  return { ok: true, pdf, fileName, cached: false };
}

/**
 * What the CLIENT is allowed to see, per item.
 *
 * A draft never reaches a client: the newest version that has actually been
 * sent (or approved) is the document they review. Serving `items.proof_spec`
 * instead would show them art nobody sent — the same drift this model exists
 * to remove, re-entering through the portal door.
 *
 * Newest wins, so a revision sent over an approved version correctly reopens
 * the gate in the hub.
 */
export async function clientVisibleVersions(db: any, itemIds: string[]): Promise<{ visible: Map<string, ProofVersion>; hasAny: Set<string> }> {
  const visible = new Map<string, ProofVersion>();
  const hasAny = new Set<string>();
  if (!itemIds.length) return { visible, hasAny };
  // Chunked + ranged: an un-ranged select is silently capped at 1000 rows.
  for (let i = 0; i < itemIds.length; i += 200) {
    const slice = itemIds.slice(i, i + 200);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("proof_versions")
        .select("*").in("item_id", slice)
        .order("version", { ascending: false }).range(from, from + 999);
      if (error) break;
      for (const v of (data || []) as ProofVersion[]) {
        hasAny.add(v.item_id);
        if (v.state !== "sent" && v.state !== "approved") continue;
        const held = visible.get(v.item_id);
        if (!held || held.version < v.version) visible.set(v.item_id, v);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return { visible, hasAny };
}

/**
 * The synthesized proof entry the portal surfaces consume. Keeps the shape the
 * hub already reads (stage/approval/driveFileId), so the version model reaches
 * the client without rewriting every consumer.
 *
 * `revisionRequested` comes from the job's change request — that note IS the
 * record of a client asking for a revision; there is no file row to flag any
 * more.
 */
export function portalProofEntry(v: ProofVersion, opts: { revisionRequested?: boolean } = {}) {
  return {
    id: v.id,
    versionId: v.id,
    version: v.version,
    fileName: `Proof v${v.version}`,
    stage: "proof" as const,
    approval: v.state === "approved" ? "approved" : (opts.revisionRequested ? "revision_requested" : "pending"),
    approvedAt: v.approved_at,
    sentAt: v.sent_at,
    driveFileId: v.mockup_drive_file_id,
    driveLink: `/api/proof/${v.id}/pdf`,
    downloadUrl: `/api/proof/${v.id}/pdf`,
    createdAt: v.created_at,
  };
}
