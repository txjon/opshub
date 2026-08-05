// THE BRIDGE (Aug 4 2026) — a Lab order request becomes a real job.
//
// One translation write + the existing machinery: the lab thread is promoted
// to an art brief (client_id shared, ask in concept, blank/qty on the spec
// line), files carry to Drive as art_brief_files, then the SAME fork that
// powers the hub greenlight runs — birthProductsFromBrief + assignProductsToJob
// (mig 137) — product + job in intake, contacts and the ask riding along.
// Sizes stay a build-the-job step (the ask is one number; run_size lands in
// the item notes as the target).
//
// Callers pass a service-role client; auth lives in the route.

import { getItemFolderId, uploadFile } from "@/lib/google-drive";
import { birthProductsFromBrief, assignProductsToJob } from "@/lib/products-server";

type Db = any;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf",
  psd: "image/vnd.adobe.photoshop", ai: "application/postscript", eps: "application/postscript",
};
function nameAndMime(url: string, fallbackName: string): { name: string; mime: string } {
  let name = fallbackName;
  try { name = decodeURIComponent(new URL(url).pathname.split("/").pop() || fallbackName); } catch {}
  const ext = (name.split(".").pop() || "").toLowerCase();
  return { name, mime: MIME_BY_EXT[ext] || "image/png" };
}

// Pull the bytes of a lab-storage public URL into Drive, under
// OpsHub Files / {Client} / Lab Studio / {Design}.
async function carryToDrive(folderId: string, url: string, fallbackName: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read the design file (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const { name, mime } = nameAndMime(url, fallbackName);
  const up = await uploadFile(folderId, name, mime, buffer);
  return { ...up, name, mime, size: buffer.length };
}

// The brief-native path: request → the existing fork, nothing else. Ask rides
// as overrides; the pinned (banked) file is the explicit face so the matcher
// stands down; the request stamps job_id; an internal marker lands on the brief.
async function bridgeBriefRequest(db: Db, req: any, byName: string): Promise<{ jobId: string; jobNumber: string; briefId: string | null }> {
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, state, client_id, approved_file_id, clients(name)").eq("id", req.brief_id).single();
  if (!brief) throw new Error("The design is gone");
  const title = ((brief as any).title || "Design").slice(0, 140);

  const products = await birthProductsFromBrief(db, (brief as any).id, {
    whole: { format: req.blank || null, notes: req.note || null },
  });

  let artByProduct: Record<string, { face?: any }> | undefined;
  if ((brief as any).approved_file_id) {
    const { data: pin } = await db.from("art_brief_files")
      .select("file_name, drive_file_id, preview_drive_file_id, drive_link, mime_type, file_size")
      .eq("id", (brief as any).approved_file_id).maybeSingle();
    if (pin) artByProduct = Object.fromEntries(products.map((p) => [p.id, { face: pin }]));
  }

  const job = await assignProductsToJob(db, {
    clientId: (brief as any).client_id,
    title,
    products,
    qtysByProduct: Object.fromEntries(products.map((p) => [p.id, {}])),
    source: "studio_order_request",
    sourceMeta: { brief_id: (brief as any).id, request_id: req.id, bridged_by: byName },
    artByProduct,
  });

  // The ask lands on the job + item notes (sizes stay a build-the-job step).
  const askBits = [req.blank || null, req.qty ? `${req.qty} pieces` : null].filter(Boolean).join(" × ");
  const ask = `Studio order request${askBits ? `: ${askBits}` : ""}.${req.note ? ` Client note: "${req.note}"` : ""}`;
  await db.from("jobs").update({ notes: ask } as never).eq("id", job.jobId);
  const { data: items } = await db.from("items").select("id, notes").eq("job_id", job.jobId);
  for (const it of (items || []) as any[]) {
    const merged = [ask, (it.notes || "").trim() || null].filter(Boolean).join("\n");
    await db.from("items").update({ notes: merged } as never).eq("id", it.id);
  }

  await db.from("lab_order_requests").update({ job_id: job.jobId, handled_at: new Date().toISOString() } as never).eq("id", req.id);
  await db.from("art_brief_messages").insert({
    brief_id: (brief as any).id, sender_role: "hpd", sender_name: byName,
    message: `✓ Started the job ${job.jobNumber}. The ask is in the real pipeline.`,
    visibility: "internal",
  } as never);
  return { jobId: job.jobId, jobNumber: job.jobNumber, briefId: (brief as any).id };
}

export async function bridgeOrderRequest(db: Db, args: { requestId: string; byName: string }): Promise<{ jobId: string; jobNumber: string; briefId: string | null; already?: boolean }> {
  const { data: req } = await db.from("lab_order_requests")
    .select("*, lab_threads(id, title, state, approved_file_url, client_id), lab_clients(id, name, client_id)")
    .eq("id", args.requestId).maybeSingle();
  if (!req) throw new Error("Request not found");

  // Idempotent: a second tap returns the job the first one made.
  if ((req as any).job_id) {
    const { data: j } = await db.from("jobs").select("id, job_number").eq("id", (req as any).job_id).single();
    return { jobId: (j as any).id, jobNumber: (j as any).job_number, briefId: null, already: true };
  }

  // Brief-native ask (Phase 3): the brief already exists and its art already
  // lives in Drive — no promotion, no carry. The fork runs with the ask as
  // line overrides and the PINNED design as the item's face.
  if ((req as any).brief_id) return bridgeBriefRequest(db, req, args.byName);

  const thread = (req as any).lab_threads;
  const labClient = (req as any).lab_clients;
  if (!thread) throw new Error("The design thread is gone");
  const realClientId = labClient?.client_id;
  if (!realClientId) throw new Error("Link the real client first — open Clients & links in the studio");
  const { data: realClient } = await db.from("clients").select("id, name").eq("id", realClientId).single();
  if (!realClient) throw new Error("The linked client no longer exists");

  const title = (thread.title || "Lab design").slice(0, 140);
  const askBits = [(req as any).blank || null, (req as any).qty ? `${(req as any).qty} pieces` : null].filter(Boolean).join(" × ");
  const concept = [
    `Lab order request${askBits ? `: ${askBits}` : ""}.`,
    (req as any).note ? `Client note: "${(req as any).note}"` : null,
  ].filter(Boolean).join("\n");

  // ── Hop 2: promote the thread to a real art brief ──
  const { data: brief, error: briefErr } = await db.from("art_briefs").insert({
    client_id: realClientId,
    title,
    concept,
    state: "working",
    source: "hpd",
    internal_only: true,
    product_spec: {
      products: [{
        id: "lab",
        format: (req as any).blank || null,
        retail: null,
        model: null,
        notes: (req as any).note || null,
        run_size: (req as any).qty || null,
      }],
    },
  }).select("id").single();
  if (briefErr || !brief) throw new Error(briefErr?.message || "Couldn't promote the design");
  const briefId = (brief as any).id;

  // ── Hop 3: carry the locked design (and any accepted print file) to Drive ──
  const designUrl = (req as any).design_file_url || thread.approved_file_url;
  if (!designUrl) throw new Error("No locked design on this thread");
  const folderId = await getItemFolderId((realClient as any).name, "Lab Studio", title);
  const art = await carryToDrive(folderId, designUrl, `${title}.png`);
  await db.from("art_brief_files").insert({
    brief_id: briefId,
    file_name: art.name,
    drive_file_id: art.fileId,
    drive_link: art.webViewLink,
    mime_type: art.mime,
    file_size: art.size,
    kind: "final",
    uploader_role: "hpd",
    shared_with_client_at: new Date().toISOString(),   // client approved it — the fork carries it as the face
  });

  const { data: wo } = await db.from("lab_work_orders")
    .select("accepted_file_url").eq("thread_id", thread.id).not("accepted_file_url", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  // ── Hop 4: the existing fork runs ──
  const products = await birthProductsFromBrief(db, briefId);
  const job = await assignProductsToJob(db, {
    clientId: realClientId,
    title,
    products,
    qtysByProduct: Object.fromEntries(products.map((p) => [p.id, {}])),
    source: "lab_bridge",
    sourceMeta: { lab_thread_id: thread.id, lab_request_id: args.requestId, bridged_by: args.byName },
  });

  // Late leg: an accepted Room 2 print file lands on the item, print-ready.
  if ((wo as any)?.accepted_file_url) {
    const { data: items } = await db.from("items").select("id").eq("job_id", job.jobId);
    if ((items || []).length) {
      const pr = await carryToDrive(folderId, (wo as any).accepted_file_url, `${title}-print.png`);
      await db.from("item_files").insert({
        item_id: (items as any)[0].id,
        file_name: pr.name,
        stage: "print_ready",
        drive_file_id: pr.fileId,
        drive_link: pr.webViewLink,
        mime_type: pr.mime,
        file_size: pr.size,
        approval: "none",
      });
    }
  }

  await db.from("art_briefs").update({ state: "approved", updated_at: new Date().toISOString() }).eq("id", briefId);
  await db.from("lab_order_requests").update({ job_id: job.jobId, handled_at: new Date().toISOString() }).eq("id", args.requestId);
  await db.from("lab_messages").insert({
    thread_id: thread.id, sender_role: "hpd", sender_name: args.byName,
    body: `✓ Started the job ${job.jobNumber}. The ask is in the real pipeline.`,
    visibility: "internal", kind: "order",
  });

  return { jobId: job.jobId, jobNumber: job.jobNumber, briefId };
}
