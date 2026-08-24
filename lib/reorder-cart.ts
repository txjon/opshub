// Reorder-cart engine — extracted from the client hub's cart route (Aug 3
// 2026) so the INTERNAL client-space cart mints byte-identical intake jobs.
// Copy shapes mirror /api/jobs/[id]/duplicate: identity+costs carried,
// lifecycle reset, buy_sheet_lines = REQUESTED qtys, item_files same
// drive_file_id (deletion is reference-counted), contacts from the latest
// source job. Nothing priced or committed — lands in intake for Drake.
import { getItemFolderId, createShortcut } from "@/lib/google-drive";
import { scaleCurve, aggregateCurve, groupCurve, formatGroup } from "@/lib/size-curves";

type Db = any;
// Phase 3 (Aug 24 2026): clients type ONE total — the curve is seeded from
// their history (lib/size-curves) and adjusted at quoting. `sizes` stays
// accepted for legacy carts in flight; `note` rides per line.
export type CartLine = { itemId?: string; productId?: string; sizes?: Record<string, number>; total?: number; note?: string };

// THE copy shape for "run this item again" — identity + costs carried,
// lifecycle reset, buy_sheet_lines = requested qtys, files re-referenced by
// drive_file_id (deletion is reference-counted). Shared by the reorder cart
// and the release cut's re-run lane; change it in one place only.
export async function copyItemIntoJob(db: Db, src: any, jobId: string, opts: {
  sizes: { size: string; qty: number }[]; sortOrder: number;
  // When set, best-effort pre-create the NEW project's Drive item folder with a
  // shortcut per carried file (mirrors /api/jobs/[id]/duplicate). Without this,
  // the first upload to a copied item creates a near-EMPTY folder and
  // /api/drive/register repoints items.drive_link at it — the vendor then sees
  // one lone file instead of the art. projectTitle must equal the new job's
  // title EXACTLY (uploads resolve their folder from the job title).
  drive?: { clientName: string; projectTitle: string };
}): Promise<string | null> {
  const { data: ni, error: itemErr } = await db.from("items").insert({
    job_id: jobId, name: src.name, blank_vendor: src.blank_vendor, blank_sku: src.blank_sku,
    cost_per_unit: src.cost_per_unit, sell_per_unit: src.sell_per_unit, blank_costs: src.blank_costs || null,
    garment_type: src.garment_type || null, drive_link: src.drive_link || null, is_fleece: !!src.is_fleece,
    status: "tbd", artwork_status: src.artwork_status === "approved" ? "approved" : "not_started",
    sort_order: opts.sortOrder, pipeline_stage: null, blanks_order_number: null, ship_tracking: null,
    design_id: src.design_id || null,
    // Proof document carries whole (spec is job/qty-free by design); proof_sent_at
    // stays null — the new item reads "Draft, ready, not sent" until someone sends.
    proof_spec: src.proof_spec || null,
  }).select("id").single();
  if (itemErr || !ni) return null;

  if (opts.sizes.length) {
    await db.from("buy_sheet_lines").insert(opts.sizes.map(s => ({
      item_id: ni.id, size: s.size, qty_ordered: s.qty,
      qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0,
    })));
  }

  const { data: srcFiles } = await db.from("item_files")
    .select("file_name, stage, drive_file_id, drive_link, mime_type, file_size, approval, approved_at, notes")
    .eq("item_id", src.id).is("superseded_at", null);
  if ((srcFiles || []).length) {
    await db.from("item_files").insert((srcFiles || []).map((f: any) => ({
      item_id: ni.id, file_name: f.file_name, stage: f.stage, drive_file_id: f.drive_file_id,
      drive_link: f.drive_link || `https://drive.google.com/file/d/${f.drive_file_id}/view`,
      mime_type: f.mime_type || null, file_size: f.file_size || null,
      approval: f.approval || "none", approved_at: f.approved_at || null, notes: f.notes || null,
    })));
    // Best-effort Drive shortcuts — DB rows above are the source of truth; a
    // Drive failure (network blip, permission edge) logs and moves on.
    if (opts.drive?.clientName && opts.drive?.projectTitle) {
      try {
        const folderId = await getItemFolderId(opts.drive.clientName, opts.drive.projectTitle, src.name || "Item");
        for (const f of (srcFiles || []) as any[]) {
          if (!f.drive_file_id) continue;
          try { await createShortcut(f.drive_file_id, f.file_name || "file", folderId); }
          catch (e: any) { console.error("[reorder copy] shortcut failed:", e?.message || e); }
        }
      } catch (e: any) { console.error("[reorder copy] folder ensure failed:", e?.message || e); }
    }
  }
  return ni.id as string;
}

export async function createReorderJob(db: Db, opts: {
  clientId: string; cart: CartLine[]; note?: string; source: "client_portal_cart" | "internal_cart";
}): Promise<{ jobId: string; jobNumber: string | null; itemCount: number }> {
  const cart = (opts.cart || []).slice(0, 40);
  const note = (opts.note || "").trim().slice(0, 2000);
  if (!cart.length) throw new Error("Cart is empty");

  const { data: client } = await db.from("clients").select("id, name, default_terms").eq("id", opts.clientId).single();
  if (!client) throw new Error("Client not found");

  const ids = Array.from(new Set(cart.map(c => c.itemId).filter(Boolean))) as string[];
  // Mockup lines (Phase 3): un-produced catalog products — first runs.
  const productIds = Array.from(new Set(cart.map(c => c.productId).filter(Boolean))) as string[];
  let products: any[] = [];
  if (productIds.length) {
    const { data } = await db.from("products").select("id, client_id, brief_id, title, format, spec").in("id", productIds);
    products = (data || []).filter((p: any) => p.client_id === opts.clientId);
    if (products.length !== productIds.length) throw new Error("Item not found");
  }
  const { data: srcItems } = await db
    .from("items")
    .select("*, buy_sheet_lines(size, qty_ordered), jobs!inner(id, client_id, job_number, title, job_type, payment_terms, shipping_route, created_at)")
    .in("id", ids);
  const owned = (srcItems || []).filter((it: any) => it.jobs?.client_id === client.id);
  if (owned.length !== ids.length) throw new Error("Item not found");
  if (!owned.length && !products.length) throw new Error("Cart is empty");

  let latestJob = owned
    .map((it: any) => it.jobs)
    .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  if (!latestJob) {
    // All-mockup cart: defaults from the client's most recent job of any kind.
    const { data: lj } = await db.from("jobs").select("job_type, payment_terms, shipping_route")
      .eq("client_id", client.id).order("created_at", { ascending: false }).limit(1);
    latestJob = (lj as any)?.[0] || null;
  }

  const lineCount = owned.length + products.length;
  const firstName = (owned.find((it: any) => it.id === cart[0].itemId) as any)?.name
    || (products.find((p: any) => p.id === cart[0].productId) as any)?.title
    || (owned[0] as any)?.name || (products[0] as any)?.title || "Order";
  const prefix = products.length ? "Order" : "Reorder";
  const rawTitle = lineCount === 1 ? `${prefix}: ${firstName}` : `${prefix}: ${firstName} + ${lineCount - 1} more`;
  const title = rawTitle.slice(0, 120); // job title AND the Drive folder name — keep identical

  const { data: newJob, error: newJobErr } = await db.from("jobs").insert({
    title,
    job_type: latestJob?.job_type || null,
    phase: "intake",
    payment_terms: latestJob?.payment_terms || client.default_terms || null,
    shipping_route: latestJob?.shipping_route || null,
    target_ship_date: null,
    client_id: client.id,
    job_number: "",
    type_meta: { source: opts.source, client_note: note || null, reorder_item_ids: ids },
    quote_approved: false,
  }).select("id, job_number").single();
  if (newJobErr || !newJob) throw new Error(newJobErr?.message || "Couldn't create order");
  const newJobId = newJob.id as string;

  let itemCount = 0;
  for (let i = 0; i < cart.length; i++) {
    const line = cart[i];

    // ── Mockup line: first run of an un-produced catalog product ──
    if (line.productId) {
      const prod: any = products.find((x: any) => x.id === line.productId);
      if (!prod) continue;
      const reqTotal = Math.max(0, Math.min(100000, Math.round(Number(line.total) || 0)));
      if (!reqTotal) continue;
      // No history to scale — seed from the client's aggregate curve for the
      // garment group, then the house curve; else a single provisional line.
      const group = formatGroup(prod.format) || null;
      const seeded = group ? await groupCurve(db, client.id, group) : { curve: [], source: null };
      let sizes = scaleCurve(seeded.curve, reqTotal);
      if (!sizes.length) sizes = [{ size: "One Size", qty: reqTotal }];
      const provenance = seeded.source ? `curve seeded from ${seeded.source} (${group})` : "no size history — single line";
      const { data: ni, error: itemErr } = await db.from("items").insert({
        job_id: newJobId,
        name: prod.title,
        status: "tbd",
        artwork_status: "approved",
        sort_order: i,
        pipeline_stage: null,
        design_id: prod.brief_id || null,
        product_id: prod.id,
        notes: `First run — client asked ${reqTotal} pcs; ${provenance}; adjust at quoting.`
          + (line.note?.trim() ? ` Client note: "${String(line.note).trim().slice(0, 300)}"` : ""),
      }).select("id").single();
      if (itemErr || !ni) continue;
      await db.from("buy_sheet_lines").insert(sizes.map(x => ({
        item_id: (ni as any).id, size: x.size, qty_ordered: x.qty,
        qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0,
      })));
      const mockId = prod.spec?.mockup_drive_file_id;
      if (mockId) {
        await db.from("item_files").insert({
          item_id: (ni as any).id, file_name: `${prod.title} mockup`, stage: "mockup",
          drive_file_id: mockId, drive_link: `https://drive.google.com/file/d/${mockId}/view`,
          approval: "none",
        });
      }
      itemCount++;
      continue;
    }

    const src: any = owned.find((it: any) => it.id === line.itemId);
    if (!src) continue;
    let sizes: { size: string; qty: number }[];
    let seedNote: string | null = null;
    const reqTotal = Math.max(0, Math.min(100000, Math.round(Number(line.total) || 0)));
    if (reqTotal > 0) {
      // Total-based line: scale the item's own last-run curve to the ask.
      const lastRun = aggregateCurve(src.buy_sheet_lines || []);
      sizes = scaleCurve(lastRun, reqTotal);
      if (!sizes.length) sizes = [{ size: "One Size", qty: reqTotal }];
      seedNote = `Client asked ${reqTotal} pcs — curve auto-seeded from last run; adjust at quoting.`
        + (line.note?.trim() ? ` Client note: "${String(line.note).trim().slice(0, 300)}"` : "");
    } else {
      sizes = Object.entries(line.sizes || {})
        .map(([size, qty]) => ({ size: String(size).slice(0, 20), qty: Math.max(0, Math.min(100000, Math.round(Number(qty) || 0))) }))
        .filter(s => s.qty > 0);
    }
    if (!sizes.length) continue;

    const newId = await copyItemIntoJob(db, src, newJobId, { sizes, sortOrder: i, drive: { clientName: client.name, projectTitle: title } });
    if (!newId) continue;
    if (seedNote) await db.from("items").update({ notes: seedNote }).eq("id", newId);
    itemCount++;
  }

  if (!itemCount) { await db.from("jobs").delete().eq("id", newJobId); throw new Error("No valid items in cart"); }

  if (latestJob?.id) {
    const { data: srcContacts } = await db.from("job_contacts").select("contact_id, role_on_job").eq("job_id", latestJob.id);
    if ((srcContacts || []).length) {
      await db.from("job_contacts").insert((srcContacts || []).map((c: any) => ({
        job_id: newJobId, contact_id: c.contact_id, role_on_job: c.role_on_job,
      })));
    }
  }

  return { jobId: newJobId, jobNumber: newJob.job_number || null, itemCount };
}
