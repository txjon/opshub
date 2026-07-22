// PRODUCTS — birth + assignment machinery (Jul 22 2026, server-side only).
//
// Doctrine: a PRODUCT is born at the client-approval fork in the Studio and
// lives on the client forever; an ITEM is one production run of it inside one
// job. Both fork doors call birthProductsFromBrief (idempotent — unique
// brief_id+line_id upsert); the "Order now" door then calls
// assignProductsToJob, which is the Cut's machinery generalized: births ONE
// job (intake) + one item per product, buy_sheet_lines from the client's
// qtys, the idea's newest client-visible image carried as the item mockup
// (same drive id — files are ref-counted, never copied).
//
// Callers pass a service-role client; auth/ownership gates live in routes.

type Db = any;

export type BornProduct = {
  id: string; title: string; format: string | null; retail: number | null;
  model: string | null; line_id: string | null; brief_id: string | null; notes?: string | null;
};

// One product per build-out line (or one product for the whole idea when the
// client never split it into lines). Re-running never duplicates — existing
// rows for a line are returned as-is, with retail/model/notes refreshed only
// if the product hasn't diverged (spec untouched → safe to sync).
export async function birthProductsFromBrief(db: Db, briefId: string): Promise<BornProduct[]> {
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, client_id, product_spec").eq("id", briefId).single();
  if (!brief) throw new Error("Idea not found");

  const spec = (brief as any).product_spec || {};
  const lines: any[] = Array.isArray(spec.products) && spec.products.length
    ? spec.products
    : [{ id: "whole", format: spec.format || null, retail: spec.retail ?? null, model: spec.model || null, notes: null }];

  const out: BornProduct[] = [];
  for (const ln of lines) {
    const title = `${(brief as any).title || "Design"} ${ln.format || ""}`.trim().slice(0, 140) || "Product";
    const { data: existing } = await db.from("products")
      .select("id, title, format, retail, model, line_id, brief_id, notes")
      .eq("brief_id", briefId).eq("line_id", String(ln.id)).maybeSingle();
    if (existing) { out.push(existing as any); continue; }
    const { data: created, error } = await db.from("products").insert({
      client_id: (brief as any).client_id,
      brief_id: briefId,
      line_id: String(ln.id),
      // flip lineage: a brief born via Flip It carries flip_of in its spec;
      // every product greenlit from it is a child of that parent product
      parent_product_id: spec.flip_of || null,
      title,
      format: ln.format || null,
      retail: ln.retail ?? null,
      model: ["preorder", "stock", "not_sure"].includes(ln.model) ? ln.model : null,
      notes: ln.notes || null,
    }).select("id, title, format, retail, model, line_id, brief_id, notes").single();
    if (error) throw new Error(error.message);
    out.push(created as any);
  }
  return out;
}

// The generalized Cut: products → one new job + one item per product.
// qtysByProduct maps product.id → per-size quantities ({} allowed — sizes can
// be settled in the Product Builder after birth).
export async function assignProductsToJob(db: Db, args: {
  clientId: string;
  title: string;
  products: BornProduct[];
  qtysByProduct: Record<string, Record<string, number>>;
  source: string;               // type_meta.source stamp (e.g. "studio_greenlight")
  sourceMeta?: Record<string, any>;
}): Promise<{ jobId: string; jobNumber: string; itemCount: number }> {
  const { data: client } = await db.from("clients")
    .select("id, default_terms, client_type").eq("id", args.clientId).single();
  const { data: lastJob } = await db.from("jobs")
    .select("job_type, payment_terms, shipping_route")
    .eq("client_id", args.clientId)
    .order("created_at", { ascending: false }).limit(1);
  // job_type is NOT NULL — first-ever job for a client falls back to their
  // client_type (the "job type defaults from client type" convention), then
  // brand. (The cut route dodges this only because drops clients have jobs.)
  const JOB_TYPES = ["tour", "webstore", "corporate", "brand", "drop_ship", "artist"];
  const fallbackType = JOB_TYPES.includes((client as any)?.client_type) ? (client as any).client_type : "brand";

  const { data: newJob, error: jobErr } = await db.from("jobs").insert({
    title: args.title.slice(0, 140),
    job_type: (lastJob as any)?.[0]?.job_type || fallbackType,
    phase: "intake",
    payment_terms: (lastJob as any)?.[0]?.payment_terms || (client as any)?.default_terms || null,
    shipping_route: (lastJob as any)?.[0]?.shipping_route || null,
    client_id: args.clientId,
    job_number: "", // trigger assigns
    type_meta: { source: args.source, ...(args.sourceMeta || {}) },
    quote_approved: false,
  }).select("id, job_number").single();
  if (jobErr || !newJob) throw new Error(jobErr?.message || "Couldn't create job");
  const jobId = (newJob as any).id;

  // studio data lands where it needs to (Jon, Jul 22): the product's format
  // guesses the garment_type (drives QB product mapping + costing layout),
  // retail rides into client_retail_per_unit, notes ride into item notes
  const GARMENT_GUESS: [RegExp, string][] = [
    [/long\s*sleeve|\bls\b/i, "longsleeve"], [/hoodie|zip/i, "hoodie"],
    [/crewneck|crew/i, "crewneck"], [/tee|t-?shirt|tank/i, "tee"],
    [/jacket|windbreaker|coach/i, "jacket"], [/pant|jogger/i, "pants"],
    [/short/i, "shorts"], [/beanie/i, "beanie"], [/hat|cap|snapback|trucker/i, "hat"],
    [/sock/i, "socks"], [/patch/i, "patch"], [/sticker/i, "sticker"],
    [/tote/i, "tote"], [/bag/i, "custom_bag"], [/flag/i, "flag"], [/poster/i, "poster"],
  ];
  const guessGarment = (format: string | null) => {
    for (const [rx, g] of GARMENT_GUESS) if (format && rx.test(format)) return g;
    return null;
  };

  let itemCount = 0;
  for (let i = 0; i < args.products.length; i++) {
    const p = args.products[i];
    const fullProduct: any = p;
    const { data: item, error: itemErr } = await db.from("items").insert({
      job_id: jobId,
      name: p.title.slice(0, 120),
      status: "tbd",
      artwork_status: "approved",   // the fork's gate — client greenlit the design
      sort_order: i,
      pipeline_stage: null,
      product_id: p.id,
      design_id: p.brief_id,        // legacy readers key on the brief
      garment_type: guessGarment(p.format),
      client_retail_per_unit: p.retail ?? null,
      notes: fullProduct.notes || null,
    }).select("id").single();
    if (itemErr || !item) continue;
    itemCount++;

    const sizes = Object.entries(args.qtysByProduct[p.id] || {})
      .map(([size, qty]) => ({ size: String(size), qty: Math.round(Number(qty) || 0) }))
      .filter(x => x.qty > 0);
    if (sizes.length) {
      await db.from("buy_sheet_lines").insert(sizes.map(x => ({
        item_id: (item as any).id, size: x.size, qty_ordered: x.qty,
        qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0,
      })));
    }

    if (p.brief_id) {
      const { data: bf } = await db.from("art_brief_files")
        .select("file_name, drive_file_id, preview_drive_file_id, drive_link, mime_type, file_size, uploader_role, shared_with_client_at")
        .eq("brief_id", p.brief_id).order("created_at", { ascending: false }).limit(10);
      const pick = (bf || []).find((f: any) => (f.shared_with_client_at || f.uploader_role === "client")
        && (f.preview_drive_file_id || f.drive_file_id) && !/pdf/i.test(f.mime_type || ""));
      if (pick) {
        const driveId = (pick as any).preview_drive_file_id || (pick as any).drive_file_id;
        await db.from("item_files").insert({
          item_id: (item as any).id,
          file_name: (pick as any).file_name || "mockup",
          stage: "mockup",
          drive_file_id: driveId,
          drive_link: (pick as any).drive_link || `https://drive.google.com/file/d/${driveId}/view`,
          mime_type: (pick as any).mime_type || null,
          file_size: (pick as any).file_size || null,
          approval: "none",
        });
      }
    }
  }
  return { jobId, jobNumber: (newJob as any).job_number, itemCount };
}
