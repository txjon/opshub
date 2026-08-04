// Reorder-cart engine — extracted from the client hub's cart route (Aug 3
// 2026) so the INTERNAL client-space cart mints byte-identical intake jobs.
// Copy shapes mirror /api/jobs/[id]/duplicate: identity+costs carried,
// lifecycle reset, buy_sheet_lines = REQUESTED qtys, item_files same
// drive_file_id (deletion is reference-counted), contacts from the latest
// source job. Nothing priced or committed — lands in intake for Drake.
type Db = any;
export type CartLine = { itemId: string; sizes?: Record<string, number> };

export async function createReorderJob(db: Db, opts: {
  clientId: string; cart: CartLine[]; note?: string; source: "client_portal_cart" | "internal_cart";
}): Promise<{ jobId: string; jobNumber: string | null; itemCount: number }> {
  const cart = (opts.cart || []).slice(0, 40);
  const note = (opts.note || "").trim().slice(0, 2000);
  if (!cart.length) throw new Error("Cart is empty");

  const { data: client } = await db.from("clients").select("id, name, default_terms").eq("id", opts.clientId).single();
  if (!client) throw new Error("Client not found");

  const ids = Array.from(new Set(cart.map(c => c.itemId).filter(Boolean)));
  const { data: srcItems } = await db
    .from("items")
    .select("*, jobs!inner(id, client_id, job_number, title, job_type, payment_terms, shipping_route, created_at)")
    .in("id", ids);
  const owned = (srcItems || []).filter((it: any) => it.jobs?.client_id === client.id);
  if (owned.length !== ids.length) throw new Error("Item not found");

  const latestJob = owned
    .map((it: any) => it.jobs)
    .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];

  const firstName = (owned.find((it: any) => it.id === cart[0].itemId) as any)?.name || (owned[0] as any).name || "Reorder";
  const title = owned.length === 1 ? `Reorder: ${firstName}` : `Reorder: ${firstName} + ${owned.length - 1} more`;

  const { data: newJob, error: newJobErr } = await db.from("jobs").insert({
    title: title.slice(0, 120),
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
    const src: any = owned.find((it: any) => it.id === line.itemId);
    if (!src) continue;
    const sizes = Object.entries(line.sizes || {})
      .map(([size, qty]) => ({ size: String(size).slice(0, 20), qty: Math.max(0, Math.min(100000, Math.round(Number(qty) || 0))) }))
      .filter(s => s.qty > 0);
    if (!sizes.length) continue;

    const { data: ni, error: itemErr } = await db.from("items").insert({
      job_id: newJobId, name: src.name, blank_vendor: src.blank_vendor, blank_sku: src.blank_sku,
      cost_per_unit: src.cost_per_unit, sell_per_unit: src.sell_per_unit, blank_costs: src.blank_costs || null,
      garment_type: src.garment_type || null, drive_link: src.drive_link || null, is_fleece: !!src.is_fleece,
      status: "tbd", artwork_status: src.artwork_status === "approved" ? "approved" : "not_started",
      sort_order: i, pipeline_stage: null, blanks_order_number: null, ship_tracking: null,
      design_id: src.design_id || null,
    }).select("id").single();
    if (itemErr || !ni) continue;
    itemCount++;

    await db.from("buy_sheet_lines").insert(sizes.map(s => ({
      item_id: ni.id, size: s.size, qty_ordered: s.qty,
      qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0,
    })));

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
    }
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
