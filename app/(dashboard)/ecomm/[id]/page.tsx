"use client";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import SizeGrid from "@/components/SizeGrid";
import { T, font, mono, canonicalSize } from "@/lib/theme";

// Pre-order detail page. Shows the full lifecycle workflow:
//   planning → building → open → closed → producing → fulfilling → complete
// Different sections light up at different phases — Taylor lives in
// Products, Abigail lives in Shopify build, Drake lives in Push-to-
// production. Each has a clear action for their role.
//
// Legacy fulfillment_inventory paths are intentionally absent — the
// page is rebuilt around the pre-order workflow we defined in
// migration 079.

type PreorderStatus = "planning" | "building" | "open" | "closed" | "producing" | "fulfilling" | "complete";

type Preorder = {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string;
  mode: "preorder" | "drop" | "always_on";
  preorder_status: PreorderStatus | null;
  platform: string | null;
  store_account: string | null;
  open_date: string | null;
  close_date: string | null;
  target_ship_date: string | null;
  buffer_pct: number | null;
  source_job_id: string | null;
  notes: string | null;
  created_at: string;
};

type PreorderProduct = {
  id: string;
  preorder_id: string;
  name: string;
  blank_vendor: string | null;
  blank_sku: string | null;
  sizes: string[];
  retail_price: number | null;
  mockup_drive_file_id: string | null;
  shopify_product_url: string | null;
  image_url: string | null;
  sort_order: number;
  is_built_in_shopify: boolean;
  built_in_shopify_at: string | null;
  notes: string | null;
};

const STATUS_LABELS: Record<PreorderStatus, string> = {
  planning: "Planning",
  building: "Building in Shopify",
  open: "Open · live",
  closed: "Closed · pending push",
  producing: "Producing",
  fulfilling: "Fulfilling",
  complete: "Complete",
};

const STATUS_OWNERS: Record<PreorderStatus, string> = {
  planning: "Taylor — scope products + dates",
  building: "Abigail — build products in Shopify",
  open: "Live · customers ordering",
  closed: "Drake — push to production with Shopify report",
  producing: "Labs — items at decorator",
  fulfilling: "ShipStation — daily orders",
  complete: "Done",
};

// Strip a "pre-order" marker from a product name when it becomes a Labs item.
// Handles the variants Shopify gives us — Pre-Order, Preorder, Pre Order,
// PreOrder — plus a wrapping separator/parens, anywhere in the string. The
// e-comm product keeps its name; only the pushed Labs item is cleaned.
function stripPreorderName(name: string): string {
  const cleaned = String(name || "")
    .replace(/\s*[(\[]?\s*pre[\s_-]*order\s*[)\]]?\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[\s_–—-]+$/g, "")
    .replace(/^[\s_–—-]+/g, "")
    .trim();
  // Degenerate case (name was only "Pre-Order") → keep the original.
  return cleaned || String(name || "").trim();
}

function toneFor(s: PreorderStatus | null) {
  if (!s) return T.border;
  const map: Record<PreorderStatus, string> = {
    planning: T.muted,
    building: T.accent,
    open: T.green,
    closed: T.amber,
    producing: T.accent,
    fulfilling: T.purple,
    complete: T.faint,
  };
  return map[s];
}

export default function PreorderDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const preorderId = params.id;

  const [preorder, setPreorder] = useState<Preorder | null>(null);
  const [products, setProducts] = useState<PreorderProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", blank_vendor: "", blank_sku: "", sizes: "", retail_price: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  // Push-to-production wizard. Opens when Abigail has the Shopify
  // sold-qty report and is ready to spawn the Labs job. Keyed by
  // (productId, size) → string for free typing; parsed to int on save.
  const [pushOpen, setPushOpen] = useState(false);
  const [soldQtys, setSoldQtys] = useState<Record<string, Record<string, string>>>({});
  const [pushBuffer, setPushBuffer] = useState<string>("");
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string>("");
  // Build #1: sold-report import (twin of the product import) + samples column.
  const [sampleQtys, setSampleQtys] = useState<Record<string, Record<string, string>>>({});
  const [bufferQtys, setBufferQtys] = useState<Record<string, Record<string, string>>>({});
  const [soldImporting, setSoldImporting] = useState(false);
  const [soldImportResult, setSoldImportResult] = useState<string>("");
  const soldCsvInputRef = useRef<HTMLInputElement>(null);
  // Delete a pre-order (incl. stale/test entries). preorder_products
  // cascade via FK (mig 079). The .select() after delete returns the
  // removed rows — an empty array means nothing deleted (RLS / already
  // gone), so it can't fail silently the way "no button" did.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>("");
  // Undo a push — returns the pre-order to "closed" and unlinks the Labs
  // job so sold qtys can be re-imported and re-pushed. The Labs job itself
  // is NOT touched (Jon may have cancelled it deliberately). Without this
  // the producing state is a one-way dead end (NextActionButton only
  // advances), which strands the pre-order if a push is cancelled.
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [reverting, setReverting] = useState(false);
  // Import products from a Shopify product-export CSV (the standard
  // first step — products are built in Shopify, then announced here).
  // Maps Title→name, combined Option values→sizes, Variant Price→retail,
  // Handle→storefront URL. Blanks / garment_type / color / decoration
  // are NOT pulled — they live in the Labs job / stay in the name.
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [preorderId]);

  async function load() {
    setLoading(true);
    const [pRes, prodRes] = await Promise.all([
      supabase.from("fulfillment_projects").select("*, clients(name)").eq("id", preorderId).single(),
      supabase.from("preorder_products").select("*").eq("preorder_id", preorderId).order("sort_order"),
    ]);
    if (pRes.data) {
      const p: any = pRes.data;
      setPreorder({
        id: p.id, name: p.name,
        client_id: p.client_id, client_name: p.clients?.name || "—",
        mode: p.mode, preorder_status: p.preorder_status || (p.mode === "preorder" ? "planning" : null),
        platform: p.platform, store_account: p.store_account,
        open_date: p.open_date, close_date: p.close_date, target_ship_date: p.target_ship_date,
        buffer_pct: p.buffer_pct, source_job_id: p.source_job_id,
        notes: p.notes, created_at: p.created_at,
      });
    }
    setProducts(((prodRes.data || []) as any[]).map(r => ({
      ...r,
      sizes: Array.isArray(r.sizes) ? r.sizes : [],
    })));
    setLoading(false);
  }

  async function advanceStatus(next: PreorderStatus) {
    if (!preorder) return;
    await supabase.from("fulfillment_projects").update({ preorder_status: next }).eq("id", preorderId);
    setPreorder(p => p ? { ...p, preorder_status: next } : p);
  }

  async function deletePreorder() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    const { data, error } = await supabase
      .from("fulfillment_projects").delete().eq("id", preorderId).select();
    if (error) { setDeleteError(error.message); setDeleting(false); setConfirmDelete(false); return; }
    if (!data || data.length === 0) {
      setDeleteError("Nothing was deleted — you may not have permission, or it's already gone.");
      setDeleting(false); setConfirmDelete(false); return;
    }
    router.push("/ecomm");
  }

  async function revertPush() {
    if (!preorder || reverting) return;
    setReverting(true);
    await (supabase.from("fulfillment_projects") as any)
      .update({ preorder_status: "closed", source_job_id: null })
      .eq("id", preorderId);
    setPreorder(p => p ? { ...p, preorder_status: "closed", source_job_id: null } : p);
    setReverting(false);
    setConfirmRevert(false);
  }

  async function updateField(field: keyof Preorder, value: any) {
    if (!preorder) return;
    setPreorder(p => p ? { ...p, [field]: value } as Preorder : p);
    await supabase.from("fulfillment_projects").update({ [field]: value }).eq("id", preorderId);
  }

  async function importFromCsv(file: File) {
    if (importing) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      // papaparse handles quoted multi-line fields (the Body HTML) that
      // would wreck a naive line split.
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      const rows = parsed.data || [];

      // Shopify repeats the Handle across a product's variant rows; the
      // product-level fields (Title) sit on the first row only.
      const byHandle: Record<string, Record<string, string>[]> = {};
      for (const r of rows) {
        const handle = (r["Handle"] || "").trim();
        if (!handle) continue;
        (byHandle[handle] ||= []).push(r);
      }

      const existingByName = new Map(products.map(p => [p.name.toLowerCase().trim(), p]));
      const domain = (preorder?.store_account || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const toInsert: any[] = [];
      // Re-importing the same CSV is how images get back-filled onto products
      // that were imported before image capture existed: if an existing product
      // is missing its image_url and the export has one, enrich it rather than
      // skip silently (otherwise the push has no mockup to upload).
      const imageUpdates: { id: string; image_url: string }[] = [];
      let order = products.length;
      let skipped = 0;

      for (const [handle, group] of Object.entries(byHandle)) {
        const name = (group.find(r => (r["Title"] || "").trim())?.["Title"] || "").trim();
        if (!name) { continue; }
        // Product image — first non-empty "Image Src" across the variant rows
        // (Shopify puts the primary product image on the first row). Public CDN
        // URL; on push it's auto-uploaded to Drive as the item mockup.
        const imageUrl = (group.find(r => (r["Image Src"] || "").trim())?.["Image Src"] || "").trim() || null;
        const already = existingByName.get(name.toLowerCase());
        if (already) {
          // Back-fill a missing image; otherwise leave the existing product be.
          if (imageUrl && !already.image_url) imageUpdates.push({ id: already.id, image_url: imageUrl });
          skipped++;
          continue;
        }
        const priceRow = group.find(r => (r["Variant Price"] || "").trim());
        const retail = priceRow ? parseFloat(priceRow["Variant Price"]) : NaN;
        // Combine each variant's option values into one label — handles
        // pants (Waist × Inseam → "28 / 30 (Short)"), tees (Size), and
        // single-variant items. "Default Title" = Shopify's no-variant
        // placeholder, dropped.
        const sizes: string[] = [];
        for (const r of group) {
          // canonicalSize uppercases recognized size tokens (s→S, 2xl→2XL);
          // multi-part pants labels ("Relaxed / 32 / 34") pass through untouched.
          const combo = canonicalSize([r["Option1 Value"], r["Option2 Value"], r["Option3 Value"]]
            .map(v => (v || "").trim())
            .filter(v => v && v !== "Default Title")
            .join(" / "));
          if (combo && !sizes.includes(combo)) sizes.push(combo);
        }
        // Single-variant item (only Shopify's "Default Title") → one "One Size" line.
        if (sizes.length === 0) sizes.push("One Size");
        toInsert.push({
          preorder_id: preorderId,
          name,
          sizes,
          retail_price: isNaN(retail) ? null : retail,
          image_url: imageUrl,
          shopify_product_url: domain ? `https://${domain}/products/${handle}` : null,
          sort_order: order++,
          // Came from a Shopify export → it's built in Shopify by
          // definition. Mark it so the "building" gate reflects reality
          // and Abigail isn't re-checking boxes for what Shopify proved.
          is_built_in_shopify: true,
          built_in_shopify_at: new Date().toISOString(),
        });
      }

      // Back-fill missing images on existing products (e.g. re-importing after
      // the image feature shipped) so the next push has mockups to upload.
      let enriched = 0;
      if (imageUpdates.length > 0) {
        for (const u of imageUpdates) {
          const { error: upErr } = await (supabase.from("preorder_products") as any)
            .update({ image_url: u.image_url }).eq("id", u.id);
          if (!upErr) enriched++;
        }
        const enrichedMap = new Map(imageUpdates.map(u => [u.id, u.image_url]));
        setProducts(prev => prev.map(p => enrichedMap.has(p.id) ? { ...p, image_url: enrichedMap.get(p.id)! } : p));
      }

      if (toInsert.length === 0) {
        const parts: string[] = [];
        if (enriched > 0) parts.push(`back-filled ${enriched} image${enriched === 1 ? "" : "s"}`);
        if (skipped > 0) parts.push(`${skipped} already present`);
        setImportResult(parts.length ? `Nothing new — ${parts.join(" · ")}.` : "No products found in that CSV.");
        setImporting(false);
        return;
      }
      const { data: inserted, error } = await (supabase.from("preorder_products") as any).insert(toInsert).select();
      if (error) throw error;
      setProducts(prev => [...prev, ...((inserted || []) as any[]).map(r => ({ ...r, sizes: r.sizes || [] }))]);
      const n = (inserted as any[])?.length ?? toInsert.length;
      const tail: string[] = [];
      if (enriched > 0) tail.push(`back-filled ${enriched} image${enriched === 1 ? "" : "s"}`);
      if (skipped > 0) tail.push(`skipped ${skipped} already present`);
      setImportResult(`Imported ${n} product${n === 1 ? "" : "s"}${tail.length ? ` · ${tail.join(" · ")}` : ""}.`);
    } catch (e: any) {
      setImportResult("Import failed: " + (e?.message || String(e)));
    } finally {
      setImporting(false);
    }
  }

  // Sold-report import. Reads sold quantities from EITHER Shopify export:
  //  • products export — "Variant Inventory Qty" (continue-selling pre-order → NEGATIVE = sold)
  //  • inventory export — "Committed" (units in open orders = sold). Multi-location stores
  //    OMIT the qty column from the products export, so the inventory export is the reliable
  //    cross-store source. Either way: match rows to the imported products by Title→name and
  //    the combined Option label→size (case-insensitive — inventory uppercases sizes), then
  //    fill the push grid. A full-catalogue export is fine; non-pre-order rows are ignored.
  async function importSoldFromCsv(files: File[]) {
    if (soldImporting) return;
    setSoldImporting(true);
    setSoldImportResult("");
    try {
      // Read every selected file and concatenate the rows. Multi-location stores
      // export one location at a time (no "All locations" option), so select all the
      // per-location exports at once — rows for the same variant are summed below.
      let rows: Record<string, string>[] = [];
      let fields: string[] = [];
      for (const file of files) {
        const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: true });
        rows = rows.concat(parsed.data || []);
        if (!fields.length) fields = parsed.meta?.fields || [];
      }
      // Sold-quantity source — auto-detect which export this is:
      const hasProdQty = fields.includes("Variant Inventory Qty");      // products export
      const committedCol = fields.find(f => /^committed/i.test(f));      // inventory export (preferred)
      const availableCol = fields.find(f => /^available/i.test(f));      // inventory export (fallback)
      // The products export also carries the product image (Image Src). The
      // inventory export does not. When it's present, opportunistically
      // back-fill image_url on matched products that lack one, so the push that
      // follows this same import has a mockup to upload — no separate product
      // re-import needed. (Keyed by product id below; applied after the loop.)
      const hasImageSrc = fields.includes("Image Src");
      const imageUpdates = new Map<string, string>();
      const soldFromRow = (r: Record<string, string>): number => {
        if (hasProdQty) { const q = parseInt(r["Variant Inventory Qty"] || "0", 10) || 0; return q < 0 ? -q : 0; }
        if (committedCol) { const c = parseInt(r[committedCol] || "0", 10) || 0; return c > 0 ? c : 0; } // "not stocked" → NaN → 0
        if (availableCol) { const a = parseInt(r[availableCol] || "0", 10) || 0; return a < 0 ? -a : 0; }
        return 0;
      };
      const byName: Record<string, PreorderProduct> = {};
      for (const p of products) byName[p.name.toLowerCase().trim()] = p;
      const byHandle: Record<string, Record<string, string>[]> = {};
      for (const r of rows) { const h = (r["Handle"] || "").trim(); if (h) (byHandle[h] ||= []).push(r); }

      const next: Record<string, Record<string, string>> = {};
      let matched = 0, unmatchedVariants = 0, soldTotal = 0;
      const unmatchedProducts = new Set<string>();
      for (const group of Object.values(byHandle)) {
        const name = (group.find(r => (r["Title"] || "").trim())?.["Title"] || "").trim();
        const p = byName[name.toLowerCase()];
        if (!p) { if (name) unmatchedProducts.add(name); continue; }
        if (hasImageSrc && !p.image_url) {
          const img = (group.find(r => (r["Image Src"] || "").trim())?.["Image Src"] || "").trim();
          if (img) imageUpdates.set(p.id, img);
        }
        next[p.id] ||= {};
        for (const r of group) {
          // Normalize the sold row's size the SAME way the product import does
          // (canonicalSize: "2X Large" → 2XL, "Small" → S) so it matches the
          // product's stored canonical sizes — otherwise every verbose-sized row
          // (Small/…/4X Large) fails to match and its sold qty is dropped.
          const combo = canonicalSize([r["Option1 Value"], r["Option2 Value"], r["Option3 Value"]]
            .map(v => (v || "").trim()).filter(v => v && v !== "Default Title").join(" / "));
          const sizeKey = combo || "One Size"; // single-variant row (Default Title) → the "One Size" line
          // Case-insensitive size match — the inventory export uppercases sizes (S/M/L)
          // while the products import may have stored them lowercase. Key the fill by the
          // product's OWN label so the push grid lines up.
          const matchSize = sizesFor(p).find(s => s.toLowerCase() === sizeKey.toLowerCase());
          if (!matchSize) { unmatchedVariants++; continue; }
          const sold = soldFromRow(r);
          // SUM across rows for the same variant — a multi-location inventory export
          // has one row per location, so the variant's true sold is the total across
          // all of them (overwriting would only keep the last location).
          if (next[p.id][matchSize] === undefined) matched++;
          next[p.id][matchSize] = String((parseInt(next[p.id][matchSize] || "0", 10) || 0) + sold);
          soldTotal += sold;
        }
      }

      const merged: Record<string, Record<string, string>> = {};
      for (const p of products) {
        merged[p.id] = { ...(soldQtys[p.id] || {}) };
        for (const sz of sizesFor(p)) {
          if (next[p.id]?.[sz] !== undefined) merged[p.id][sz] = next[p.id][sz];
        }
      }
      setSoldQtys(merged);
      // Pre-fill the editable Buffer column from the freshly imported sold × %.
      setBufferQtys(seedBuffers(merged, parseFloat(pushBuffer) || 0));

      // Back-fill any images captured from a products export so the push picks
      // them up (push reads image_url off products state). Persist + reflect.
      let enriched = 0;
      if (imageUpdates.size > 0) {
        for (const [id, url] of Array.from(imageUpdates.entries())) {
          const { error: upErr } = await (supabase.from("preorder_products") as any)
            .update({ image_url: url }).eq("id", id);
          if (!upErr) enriched++;
        }
        setProducts(prev => prev.map(p => imageUpdates.has(p.id) ? { ...p, image_url: imageUpdates.get(p.id)! } : p));
      }

      const parts = [`Filled ${matched} variant${matched === 1 ? "" : "s"} (${soldTotal.toLocaleString()} unit${soldTotal === 1 ? "" : "s"} sold) from ${files.length} file${files.length === 1 ? "" : "s"}`];
      if (enriched > 0) parts.push(`captured ${enriched} product image${enriched === 1 ? "" : "s"}`);
      if (unmatchedProducts.size) parts.push(`${unmatchedProducts.size} CSV product(s) not in this pre-order`);
      if (unmatchedVariants) parts.push(`${unmatchedVariants} variant row(s) didn't match a size`);
      setSoldImportResult(parts.join(" · ") + ".");
    } catch (e: any) {
      setSoldImportResult("Sold import failed: " + (e?.message || String(e)));
    } finally {
      setSoldImporting(false);
    }
  }

  async function addProduct() {
    if (!newProduct.name.trim()) return;
    const sizesArr = newProduct.sizes.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const retail = newProduct.retail_price ? parseFloat(newProduct.retail_price) : null;
    const { data } = await (supabase.from("preorder_products") as any).insert({
      preorder_id: preorderId,
      name: newProduct.name.trim(),
      blank_vendor: newProduct.blank_vendor.trim() || null,
      blank_sku: newProduct.blank_sku.trim() || null,
      sizes: sizesArr,
      retail_price: retail,
      sort_order: products.length,
    }).select().single();
    if (data) setProducts(prev => [...prev, { ...(data as any), sizes: (data as any).sizes || [] }]);
    setNewProduct({ name: "", blank_vendor: "", blank_sku: "", sizes: "", retail_price: "" });
    setShowAddProduct(false);
  }

  async function deleteProduct(id: string) {
    await supabase.from("preorder_products").delete().eq("id", id);
    setProducts(prev => prev.filter(p => p.id !== id));
  }

  async function toggleBuilt(p: PreorderProduct) {
    const next = !p.is_built_in_shopify;
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_built_in_shopify: next, built_in_shopify_at: next ? new Date().toISOString() : null } : x));
    await supabase.from("preorder_products").update({
      is_built_in_shopify: next,
      built_in_shopify_at: next ? new Date().toISOString() : null,
    }).eq("id", p.id);
  }

  async function updateProduct(id: string, patch: Partial<PreorderProduct>) {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...patch } as PreorderProduct : p));
    await supabase.from("preorder_products").update(patch).eq("id", id);
  }

  function openPushModal() {
    // Seed sold qtys with zeros so the inputs are controlled. Buffer
    // defaults to the pre-order's stored buffer_pct (typically 5-7).
    const seed: Record<string, Record<string, string>> = {};
    for (const p of products) {
      seed[p.id] = {};
      for (const sz of sizesFor(p)) seed[p.id][sz] = "";
    }
    setSoldQtys(seed);
    const seedSamples: Record<string, Record<string, string>> = {};
    for (const p of products) { seedSamples[p.id] = {}; for (const sz of sizesFor(p)) seedSamples[p.id][sz] = ""; }
    setSampleQtys(seedSamples);
    setBufferQtys(seedBuffers(seed, parseFloat(pushBuffer) || 0));
    setSoldImportResult("");
    setPushBuffer(String(preorder?.buffer_pct ?? 5));
    setPushError("");
    setPushOpen(true);
  }

  // Single-variant Shopify items (only "Default Title") import with no sizes.
  // Treat any size-less product as one "One Size" line everywhere sizes are read,
  // so the hat tallies like everything else — no re-import or backfill needed.
  const sizesFor = (p: any): string[] => (p?.sizes?.length ? p.sizes : ["One Size"]);

  // Default buffer UNITS the % adds on top of sold (the pre-fill for the editable
  // Buffer column). Rounds up so a 5% buffer on a small run still yields ≥1.
  const bufferFor = (sold: number, pct: number): number =>
    sold > 0 && pct > 0 ? Math.ceil(sold * (1 + pct / 100)) - sold : 0;

  // Re-seed every Buffer cell from current sold × pct (used on sold-import and on
  // % change). Overwrites prior values — the % is the master rate; per-cell edits
  // are overrides that live until the next re-seed.
  const seedBuffers = (soldState: Record<string, Record<string, string>>, pct: number) => {
    const seeded: Record<string, Record<string, string>> = {};
    for (const p of products) {
      seeded[p.id] = {};
      for (const sz of sizesFor(p)) {
        const s = parseInt(soldState[p.id]?.[sz] || "0", 10) || 0;
        const b = bufferFor(s, pct);
        seeded[p.id][sz] = b > 0 ? String(b) : "";
      }
    }
    return seeded;
  };

  function pushSummary() {
    const bufferPct = parseFloat(pushBuffer) || 0;
    const rows: { product: PreorderProduct; sizes: { size: string; sold: number; total: number }[]; totalUnits: number }[] = [];
    let grand = 0;
    for (const p of products) {
      const sizeRows = sizesFor(p).map(sz => {
        const sold = parseInt(soldQtys[p.id]?.[sz] || "0", 10) || 0;
        const samples = parseInt(sampleQtys[p.id]?.[sz] || "0", 10) || 0;
        const buffer = parseInt(bufferQtys[p.id]?.[sz] || "0", 10) || 0;
        const total = sold + buffer + samples;
        grand += total;
        return { size: sz, sold, total };
      });
      const totalUnits = sizeRows.reduce((a, r) => a + r.total, 0);
      rows.push({ product: p, sizes: sizeRows, totalUnits });
    }
    return { rows, grandTotal: grand, bufferPct };
  }

  async function executePush() {
    if (!preorder) return;
    setPushing(true);
    setPushError("");
    try {
      const { rows, bufferPct } = pushSummary();
      // Skip products with zero qty across all sizes — they didn't sell;
      // no need to spawn an item for them.
      const productsToCreate = rows.filter(r => r.totalUnits > 0);
      if (productsToCreate.length === 0) {
        setPushError("Enter sold quantities for at least one product before pushing.");
        setPushing(false);
        return;
      }

      // 1. Create the Labs job. shipping_route="stage" so it follows
      //    the same stage pipeline (decorator → HPD → Shopify entry).
      //    job_number is auto-assigned by the DB trigger.
      const { data: newJob, error: jobErr } = await (supabase.from("jobs") as any).insert({
        title: preorder.name,
        job_type: "tour",
        phase: "intake",
        priority: "normal",
        shipping_route: "stage",
        client_id: preorder.client_id,
        job_number: "", // trigger fills HPD-YYMM-NNN
        target_ship_date: preorder.target_ship_date,
        type_meta: {
          source: "preorder_push",
          preorder_id: preorder.id,
          buffer_pct: bufferPct,
        },
      }).select("id").single();
      if (jobErr || !newJob) throw new Error(jobErr?.message || "Failed to create Labs job");
      const newJobId = (newJob as any).id;

      // 2. For each product with units, create an items row + buy_sheet_lines.
      // Collect {itemId, name, imageUrl} so we can auto-import Shopify product
      // images as Drive mockups once all items exist (step 4).
      const mockupTargets: { itemId: string; name: string; imageUrl: string }[] = [];
      for (let i = 0; i < productsToCreate.length; i++) {
        const r = productsToCreate[i];
        // Drop the "pre-order" marker — the Labs item is just the product.
        const itemName = stripPreorderName(r.product.name);
        const { data: newItem, error: itemErr } = await (supabase.from("items") as any).insert({
          job_id: newJobId,
          name: itemName,
          blank_vendor: r.product.blank_vendor,
          blank_sku: r.product.blank_sku,
          status: "tbd",
          artwork_status: "not_started",
          sort_order: i,
        }).select("id").single();
        if (itemErr || !newItem) throw new Error(itemErr?.message || "Failed to create item");
        const itemId = (newItem as any).id;
        // Use the cleaned name so the Drive folder + "{name} mockup" file match the item.
        if (r.product.image_url) mockupTargets.push({ itemId, name: itemName, imageUrl: r.product.image_url });

        const lines = r.sizes
          .filter(s => s.total > 0)
          .map(s => ({
            item_id: itemId,
            size: s.size,
            qty_ordered: s.total,
            qty_shipped_from_vendor: 0,
            qty_received_at_hpd: 0,
            qty_shipped_to_customer: 0,
          }));
        if (lines.length > 0) {
          await (supabase.from("buy_sheet_lines") as any).insert(lines);
        }
      }

      // 3. Link the pre-order to the new Labs job + advance status.
      await supabase.from("fulfillment_projects").update({
        source_job_id: newJobId,
        preorder_status: "producing",
        buffer_pct: bufferPct,
      }).eq("id", preorderId);

      setPreorder(p => p ? { ...p, source_job_id: newJobId, preorder_status: "producing", buffer_pct: bufferPct } : p);
      setPushOpen(false);
      // Open the new Labs job in a new tab so Drake can review. Done BEFORE the
      // mockup import so the popup fires inside the click gesture (a long import
      // first would get the tab blocked).
      window.open(`/jobs/${newJobId}`, "_blank");

      // 4. Auto-import Shopify product images as Drive mockups. Best-effort:
      //    the job is already created and open — a mockup hiccup must never
      //    look like a failed push. Items without an image are simply skipped.
      if (mockupTargets.length > 0) {
        try {
          await fetch("/api/ecomm/import-mockups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientName: preorder.client_name,
              projectTitle: preorder.name,
              items: mockupTargets,
            }),
          });
        } catch { /* mockups are a convenience; never block the push */ }
      }
    } catch (e: any) {
      setPushError(e?.message || "Push failed");
    } finally {
      setPushing(false);
    }
  }

  const productCount = products.length;
  const builtCount = products.filter(p => p.is_built_in_shopify).length;

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading pre-order…</div>;
  if (!preorder) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Pre-order not found.</div>;

  const tone = toneFor(preorder.preorder_status);

  // Phase-aware next-action button. Each transition has an explicit
  // owner so the page reads like a workflow board.
  function NextActionButton() {
    if (!preorder) return null;
    const s = preorder.preorder_status;
    if (s === "planning") {
      const ready = productCount > 0 && !!preorder.open_date && !!preorder.close_date;
      return (
        <button onClick={() => advanceStatus("building")} disabled={!ready}
          title={ready ? "Hand off to Abigail to build in Shopify" : "Add at least one product and set open/close dates first"}
          style={{ background: ready ? T.accent : T.surface, border: "none", borderRadius: 8, color: ready ? "#fff" : T.faint, fontSize: 12, fontWeight: 700, padding: "8px 18px", cursor: ready ? "pointer" : "not-allowed", fontFamily: font }}>
          → Hand off to Abigail (Build in Shopify)
        </button>
      );
    }
    if (s === "building") {
      const ready = productCount > 0 && builtCount === productCount;
      return (
        <button onClick={() => advanceStatus("open")} disabled={!ready}
          title={ready ? "All products built — mark pre-order open" : `${productCount - builtCount} product(s) still need to be built in Shopify`}
          style={{ background: ready ? T.green : T.surface, border: "none", borderRadius: 8, color: ready ? "#fff" : T.faint, fontSize: 12, fontWeight: 700, padding: "8px 18px", cursor: ready ? "pointer" : "not-allowed", fontFamily: font }}>
          → Mark pre-order open
        </button>
      );
    }
    if (s === "open") {
      return (
        <button onClick={() => advanceStatus("closed")}
          style={{ background: T.amber, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 18px", cursor: "pointer", fontFamily: font }}>
          → Close pre-order
        </button>
      );
    }
    if (s === "closed") {
      const ready = products.length > 0;
      return (
        <button onClick={openPushModal} disabled={!ready}
          title={ready ? "Import Shopify sold qtys + buffer → spawn Labs job" : "Add products first"}
          style={{ background: ready ? T.accent : T.surface, border: "none", borderRadius: 8, color: ready ? "#fff" : T.faint, fontSize: 12, fontWeight: 700, padding: "8px 18px", cursor: ready ? "pointer" : "not-allowed", fontFamily: font }}>
          → Push to production
        </button>
      );
    }
    if (s === "producing") {
      return (
        <>
          <button onClick={() => advanceStatus("fulfilling")}
            style={{ background: T.purple, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 18px", cursor: "pointer", fontFamily: font }}>
            → Fulfilling (received + in Shopify)
          </button>
          <button onClick={() => setConfirmRevert(true)}
            title="Undo the push — unlink the Labs job and return to Closed so you can re-import sold qtys and re-push"
            style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, color: T.muted, fontSize: 12, fontWeight: 600, padding: "8px 16px", cursor: "pointer", fontFamily: font }}>
            ↩ Undo push
          </button>
        </>
      );
    }
    if (s === "fulfilling") {
      return (
        <button onClick={() => advanceStatus("complete")}
          style={{ background: T.text, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 18px", cursor: "pointer", fontFamily: font }}>
          → Mark complete
        </button>
      );
    }
    return null;
  }

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14, maxWidth: 1000, margin: "0 auto", paddingBottom: "3rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <button onClick={() => router.push("/ecomm")}
          style={{ background: "none", border: "none", color: T.muted, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: font }}>
          ← Back to E-Commerce
        </button>
        <button onClick={() => { setDeleteError(""); setConfirmDelete(true); }}
          title="Delete this pre-order"
          style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 11, fontWeight: 600, padding: "5px 12px", cursor: "pointer", fontFamily: font }}
          onMouseEnter={e => { e.currentTarget.style.color = T.red; e.currentTarget.style.borderColor = T.red; }}
          onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
          Delete pre-order
        </button>
      </div>
      {deleteError && (
        <div style={{ fontSize: 12, color: T.red, background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 6, padding: "8px 12px" }}>
          {deleteError}
        </div>
      )}

      {/* Header */}
      <div style={{ ...card, padding: "16px 20px", borderLeft: `3px solid ${tone}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{preorder.name}</h1>
          {preorder.preorder_status && (
            <span style={{ fontSize: 11, fontWeight: 800, color: tone, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {STATUS_LABELS[preorder.preorder_status]}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>{preorder.client_name}</span>
          {preorder.platform && <span>· {preorder.platform}</span>}
          {preorder.store_account && (
            <a href={preorder.store_account.startsWith("http") ? preorder.store_account : `https://${preorder.store_account}`}
              target="_blank" rel="noopener noreferrer"
              style={{ color: T.accent, textDecoration: "none" }}>
              · {preorder.store_account} ↗
            </a>
          )}
        </div>
        {preorder.preorder_status && (
          <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>
            <strong style={{ color: T.muted }}>{STATUS_OWNERS[preorder.preorder_status]}</strong>
          </div>
        )}
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <NextActionButton />
        </div>
      </div>

      {/* Lifecycle dates + buffer — editable */}
      <div style={{ ...card, padding: "14px 18px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Lifecycle</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Opens <span style={{ color: T.faint }}>(PT)</span></label>
            <input type="datetime-local" style={ic} value={(preorder.open_date || "").slice(0, 16)} onChange={e => updateField("open_date", e.target.value || null)} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Closes <span style={{ color: T.faint }}>(PT)</span></label>
            <input type="datetime-local" style={ic} value={(preorder.close_date || "").slice(0, 16)} onChange={e => updateField("close_date", e.target.value || null)} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Target ship date</label>
            <input type="date" style={ic} value={preorder.target_ship_date || ""} onChange={e => updateField("target_ship_date", e.target.value || null)} />
            <div style={{ fontSize: 9, color: T.faint, marginTop: 3, fontStyle: "italic", lineHeight: 1.3 }}>
              The date you're promising customers their order will ship by. Shown to them; the answer Abigail gives until production sets per-item ETAs.
            </div>
            {/* Quick-set offsets from the close date — standard
                pre-order promise window is 4-5 weeks. Falls back to
                today when close isn't set yet so Taylor can still
                stamp a date during scoping. */}
            {(() => {
              // slice(0,10) → the date part whether close_date is a date or a full timestamp
              const baseIso = preorder.close_date ? preorder.close_date.slice(0, 10) : new Date().toISOString().slice(0, 10);
              const baseLabel = preorder.close_date ? "from close" : "from today";
              const offsets = [3, 4, 5, 6];
              return (
                <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                  {offsets.map(weeks => {
                    const base = new Date(baseIso + "T12:00:00");
                    base.setDate(base.getDate() + weeks * 7);
                    const iso = base.toISOString().slice(0, 10);
                    const short = base.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    return (
                      <button key={weeks} onClick={() => updateField("target_ship_date", iso)}
                        title={`${weeks} weeks ${baseLabel} → ${short}`}
                        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 5, color: T.muted, fontFamily: font, fontSize: 10, fontWeight: 600, padding: "3px 8px", cursor: "pointer" }}>
                        +{weeks}w
                      </button>
                    );
                  })}
                  <span style={{ fontSize: 9, color: T.faint, alignSelf: "center" }}>{baseLabel}</span>
                </div>
              );
            })()}
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Buffer % per variant</label>
            <input type="number" step="0.5" min="0" style={ic} value={preorder.buffer_pct ?? ""} onChange={e => updateField("buffer_pct", e.target.value ? parseFloat(e.target.value) : null)} placeholder="5" />
          </div>
        </div>
      </div>

      {/* Products — Taylor scopes here, Abigail marks built */}
      <div style={{ ...card, padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Products</div>
          <span style={{ fontSize: 11, color: T.muted }}>
            {productCount > 0 ? `Shopify build: ${builtCount}/${productCount}` : "—"}
          </span>
          <span style={{ flex: 1 }} />
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) importFromCsv(f); e.target.value = ""; }} />
          <button onClick={() => csvInputRef.current?.click()} disabled={importing}
            title="Import products from a Shopify product-export CSV"
            style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, cursor: importing ? "default" : "pointer", fontFamily: font }}>
            {importing ? "Importing…" : "Import Shopify CSV"}
          </button>
          <button onClick={() => setShowAddProduct(v => !v)}
            style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", cursor: "pointer", fontFamily: font }}>
            {showAddProduct ? "Cancel" : "+ Add product"}
          </button>
        </div>
        {importResult && (
          <div style={{ fontSize: 11, color: importResult.startsWith("Imported") ? T.green : T.amber, marginBottom: 8 }}>{importResult}</div>
        )}

        {showAddProduct && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, marginBottom: 12, display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 80px", gap: 8, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Product name *</label>
              <input style={ic} value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="Coat of Arms Tee" />
            </div>
            <div>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Blank vendor</label>
              <input style={ic} value={newProduct.blank_vendor} onChange={e => setNewProduct(p => ({ ...p, blank_vendor: e.target.value }))} placeholder="Comfort Colors 1717" />
            </div>
            <div>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Sizes (comma-sep)</label>
              <input style={ic} value={newProduct.sizes} onChange={e => setNewProduct(p => ({ ...p, sizes: e.target.value }))} placeholder="S, M, L, XL, 2XL" />
            </div>
            <div>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Retail $</label>
              <input style={ic} type="number" step="0.01" value={newProduct.retail_price} onChange={e => setNewProduct(p => ({ ...p, retail_price: e.target.value }))} placeholder="32.00" />
            </div>
            <button onClick={addProduct} disabled={!newProduct.name.trim()}
              style={{ padding: "7px 0", borderRadius: 6, border: "none", background: newProduct.name.trim() ? T.green : T.surface, color: newProduct.name.trim() ? "#fff" : T.faint, fontSize: 12, fontWeight: 700, cursor: newProduct.name.trim() ? "pointer" : "not-allowed", fontFamily: font }}>
              Add
            </button>
          </div>
        )}

        {products.length === 0 ? (
          <div style={{ fontSize: 12, color: T.faint, padding: "16px 0", textAlign: "center" }}>
            No products yet. Add the items this pre-order will sell.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {products.map(p => (
              <div key={p.id} style={{
                padding: "10px 12px", borderRadius: 8,
                background: p.is_built_in_shopify ? T.greenDim + "33" : T.surface,
                border: `1px solid ${p.is_built_in_shopify ? T.green + "33" : T.border}`,
                display: "flex", alignItems: "flex-start", gap: 12,
              }}>
                <input type="checkbox" checked={p.is_built_in_shopify} onChange={() => toggleBuilt(p)}
                  title="Mark as built in Shopify"
                  style={{ width: 16, height: 16, cursor: "pointer", accentColor: T.green, marginTop: 4, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === p.id ? (
                    <input style={{ ...ic, fontSize: 13, fontWeight: 600 }} value={p.name}
                      onChange={e => updateProduct(p.id, { name: e.target.value })}
                      onBlur={() => setEditingId(null)} autoFocus />
                  ) : (
                    <div onClick={() => setEditingId(p.id)} style={{ fontSize: 13, fontWeight: 600, color: T.text, cursor: "text" }}>{p.name}</div>
                  )}
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {p.blank_vendor && <span>{p.blank_vendor}</span>}
                    {p.blank_sku && <span style={{ fontFamily: mono }}>{p.blank_sku}</span>}
                    {p.retail_price != null && <span style={{ color: T.text, fontWeight: 600 }}>${p.retail_price.toFixed(2)}</span>}
                  </div>
                  {sizesFor(p).length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <SizeGrid labels={sizesFor(p)} palette={{ text: T.text, muted: T.muted, faint: T.faint, border: T.border, surface: T.surface, accent: T.green }} mono={mono} />
                    </div>
                  )}
                  {p.is_built_in_shopify && p.built_in_shopify_at && (
                    <div style={{ fontSize: 10, color: T.green, marginTop: 4, fontWeight: 600 }}>
                      ✓ Built in Shopify · {new Date(p.built_in_shopify_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  )}
                </div>
                <button onClick={() => deleteProduct(p.id)}
                  title="Remove product"
                  style={{ background: "none", border: "none", color: T.faint, fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div style={{ ...card, padding: "14px 18px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Notes</div>
        <textarea style={{ ...ic, minHeight: 60, resize: "vertical" }}
          value={preorder.notes || ""}
          onChange={e => updateField("notes", e.target.value)}
          placeholder="Anything specific about this drop — design constraints, packaging notes, client requests…" />
      </div>

      {/* Linked Labs job — appears once push-to-production happens */}
      {preorder.source_job_id && (
        <div style={{ ...card, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Linked Labs job</div>
          <Link href={`/jobs/${preorder.source_job_id}`}
            style={{ fontSize: 13, color: T.accent, textDecoration: "none" }}>
            View production project →
          </Link>
        </div>
      )}

      {/* Push-to-production wizard — paste Shopify sold qtys per
          variant, apply buffer, spawn the Labs job + items. Opens
          from the "Push to production" action on closed pre-orders. */}
      {pushOpen && (() => {
        const summary = pushSummary();
        return (
          <div onClick={() => !pushing && setPushOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 32px)" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.card, borderRadius: 14, width: "min(860px, 100%)", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${T.border}` }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Push to production</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                    {preorder.name} · {preorder.client_name}
                  </div>
                </div>
                <button onClick={() => !pushing && setPushOpen(false)}
                  style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: pushing ? "not-allowed" : "pointer", padding: "0 6px", lineHeight: 1, opacity: pushing ? 0.4 : 1 }}>×</button>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                  Import a Shopify export to auto-fill sold qtys. Single-location stores can use the products export
                  (pre-order inventory goes negative as orders land). Multi-location stores use the inventory export
                  (Committed column = sold); export each location and select them all here, they're summed per variant.
                  A full-catalogue export is fine; only this pre-order's items get filled. Buffer % and samples add on
                  top; totals round up. A new Labs project is created with these qtys, the buy sheet pre-filled, and the
                  pre-order linked to the Labs job.
                </div>

                {/* Sold-report import — reads sold from the products export
                    (Variant Inventory Qty, negative) or the inventory export
                    (Committed). Auto-detected in importSoldFromCsv. */}
                <input ref={soldCsvInputRef} type="file" accept=".csv,text/csv" multiple style={{ display: "none" }}
                  onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) importSoldFromCsv(fs); (e.currentTarget as HTMLInputElement).value = ""; }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={() => soldCsvInputRef.current?.click()} disabled={soldImporting || products.length === 0}
                    style={{ padding: "7px 14px", background: T.accent, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: soldImporting ? "default" : "pointer", fontFamily: font, opacity: soldImporting ? 0.6 : 1 }}>
                    {soldImporting ? "Reading…" : "Import sold report (one or more CSVs)"}
                  </button>
                  {soldImportResult && <span style={{ fontSize: 11.5, color: T.muted }}>{soldImportResult}</span>}
                </div>

                {/* Buffer */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "10px 12px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Buffer %</span>
                  <input type="number" step="0.5" min="0" value={pushBuffer}
                    onChange={e => { const val = e.target.value; setPushBuffer(val); setBufferQtys(seedBuffers(soldQtys, parseFloat(val) || 0)); }}
                    style={{ ...ic, width: 80, padding: "4px 8px" }} />
                  <span style={{ fontSize: 11, color: T.muted }}>pre-fills the Buffer column · total = sold + buffer + samples · edit any cell</span>
                </div>

                {/* Spreadsheet — one row per variant. Product name shows on the
                    first size of each group; sold + samples are inline cells. */}
                {(() => {
                  const th: React.CSSProperties = { position: "sticky", top: 0, background: T.surface, fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", zIndex: 1, borderBottom: `1px solid ${T.border}` };
                  const cellInput: React.CSSProperties = { ...ic, width: "100%", padding: "4px 6px", textAlign: "center", fontFamily: mono, fontWeight: 600, boxSizing: "border-box" };
                  const subNum: React.CSSProperties = { padding: "6px 6px", textAlign: "center", fontFamily: mono, fontWeight: 700 };
                  const subRow: React.CSSProperties = { borderTop: `1px solid ${T.border}`, background: T.surface };
                  // Grand-total pre-pass across every variant (sums each column).
                  const g = { sold: 0, buffer: 0, samples: 0, total: 0 };
                  for (const p of products) for (const sz of sizesFor(p)) {
                    g.sold += parseInt(soldQtys[p.id]?.[sz] || "0", 10) || 0;
                    g.buffer += parseInt(bufferQtys[p.id]?.[sz] || "0", 10) || 0;
                    g.samples += parseInt(sampleQtys[p.id]?.[sz] || "0", 10) || 0;
                  }
                  g.total = g.sold + g.buffer + g.samples;
                  return (
                    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={th}>Product</th>
                            <th style={th}>Size</th>
                            <th style={{ ...th, textAlign: "center", width: 74 }}>Sold</th>
                            <th style={{ ...th, textAlign: "center", width: 62 }}>Buffer</th>
                            <th style={{ ...th, textAlign: "center", width: 74, color: T.amber }}>Samples</th>
                            <th style={{ ...th, textAlign: "right", width: 62 }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.flatMap(p => {
                            const sub = { sold: 0, buffer: 0, samples: 0, total: 0 };
                            const rows = sizesFor(p).map((sz, si) => {
                              const sold = parseInt(soldQtys[p.id]?.[sz] || "0", 10) || 0;
                              const samples = parseInt(sampleQtys[p.id]?.[sz] || "0", 10) || 0;
                              const bufferUnits = parseInt(bufferQtys[p.id]?.[sz] || "0", 10) || 0;
                              const total = sold + bufferUnits + samples;
                              sub.sold += sold; sub.buffer += bufferUnits; sub.samples += samples; sub.total += total;
                              return (
                                <tr key={p.id + "_" + sz} style={{ borderTop: `1px solid ${si === 0 ? T.border : T.surface}` }}>
                                  <td style={{ padding: "4px 10px", fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>{si === 0 ? p.name : ""}</td>
                                  <td style={{ padding: "4px 10px", fontFamily: mono, color: T.muted, whiteSpace: "nowrap" }}>{sz}</td>
                                  <td style={{ padding: "3px 6px" }}>
                                    <input type="text" inputMode="numeric" title="Sold"
                                      value={soldQtys[p.id]?.[sz] || ""}
                                      onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); setSoldQtys(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [sz]: v } })); }}
                                      onFocus={e => (e.target as HTMLInputElement).select()}
                                      placeholder="0" style={cellInput} />
                                  </td>
                                  <td style={{ padding: "3px 6px" }}>
                                    <input type="text" inputMode="numeric" title="Buffer units — pre-filled from the %, edit any cell"
                                      value={bufferQtys[p.id]?.[sz] || ""}
                                      onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); setBufferQtys(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [sz]: v } })); }}
                                      onFocus={e => (e.target as HTMLInputElement).select()}
                                      placeholder="0" style={{ ...cellInput, color: T.muted }} />
                                  </td>
                                  <td style={{ padding: "3px 6px" }}>
                                    <input type="text" inputMode="numeric" title="Samples — added on top of sold + buffer"
                                      value={sampleQtys[p.id]?.[sz] || ""}
                                      onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); setSampleQtys(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [sz]: v } })); }}
                                      onFocus={e => (e.target as HTMLInputElement).select()}
                                      placeholder="0" style={{ ...cellInput, fontSize: 11, color: T.amber }} />
                                  </td>
                                  <td style={{ padding: "4px 10px", textAlign: "right", fontFamily: mono, fontWeight: 600, color: total > sold ? T.green : T.faint }}>{total}</td>
                                </tr>
                              );
                            });
                            // Per-item subtotal — only when the item has >1 size (a 1-size
                            // item's row already IS its total, so don't echo it).
                            if (sizesFor(p).length > 1) {
                              rows.push(
                                <tr key={p.id + "_sub"} style={subRow}>
                                  <td style={{ padding: "6px 10px" }} />
                                  <td style={{ padding: "6px 10px", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Subtotal</td>
                                  <td style={{ ...subNum, color: T.text }}>{sub.sold}</td>
                                  <td style={{ ...subNum, color: T.muted }}>{sub.buffer}</td>
                                  <td style={{ ...subNum, color: T.amber }}>{sub.samples}</td>
                                  <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: mono, fontWeight: 700, color: sub.total > 0 ? T.green : T.faint }}>{sub.total}</td>
                                </tr>
                              );
                            }
                            return rows;
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: `2px solid ${T.border}`, background: T.surface }}>
                            <td colSpan={2} style={{ padding: "9px 10px", fontSize: 11, fontWeight: 800, color: T.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>Grand total</td>
                            <td style={{ ...subNum, fontWeight: 800, fontSize: 13, color: T.text }}>{g.sold}</td>
                            <td style={{ ...subNum, fontWeight: 800, fontSize: 13, color: T.muted }}>{g.buffer}</td>
                            <td style={{ ...subNum, fontWeight: 800, fontSize: 13, color: T.amber }}>{g.samples}</td>
                            <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: mono, fontWeight: 800, fontSize: 15, color: T.green }}>{g.total}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })()}

                {/* Summary */}
                <div style={{ padding: "10px 14px", borderRadius: 8, background: T.accentDim, border: `1px solid ${T.accent}44`, fontSize: 13, color: T.text }}>
                  <strong>{summary.grandTotal.toLocaleString()}</strong> total units to produce across{" "}
                  <strong>{summary.rows.filter(r => r.totalUnits > 0).length}</strong> item{summary.rows.filter(r => r.totalUnits > 0).length === 1 ? "" : "s"}
                  {summary.bufferPct > 0 && (
                    <span style={{ color: T.muted }}> · buffer pre-filled at {summary.bufferPct}%</span>
                  )}
                </div>

                {pushError && (
                  <div style={{ fontSize: 12, color: T.red, fontWeight: 600, padding: "8px 12px", background: T.redDim, borderRadius: 6 }}>
                    {pushError}
                  </div>
                )}
              </div>

              <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setPushOpen(false)} disabled={pushing}
                  style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, color: T.muted, fontSize: 12, fontWeight: 600, cursor: pushing ? "not-allowed" : "pointer", fontFamily: font }}>
                  Cancel
                </button>
                <button onClick={executePush} disabled={pushing || summary.grandTotal === 0}
                  style={{
                    padding: "8px 18px",
                    background: pushing || summary.grandTotal === 0 ? T.surface : T.green,
                    color: pushing || summary.grandTotal === 0 ? T.faint : "#fff",
                    borderRadius: 8, fontSize: 12, fontWeight: 700,
                    cursor: pushing || summary.grandTotal === 0 ? "not-allowed" : "pointer",
                    border: "none", fontFamily: font,
                  }}>
                  {pushing ? "Creating Labs job…" : `Create Labs job · ${summary.grandTotal.toLocaleString()} units`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this pre-order?"
        message={preorder.source_job_id
          ? `"${preorder.name}" was pushed to production — the linked Labs job stays, but the pre-order record and its product list are permanently removed. This can't be undone.`
          : `"${preorder.name}" and its product list will be permanently deleted. This can't be undone.`}
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        onConfirm={deletePreorder}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmRevert}
        title="Undo push?"
        message={`This returns "${preorder.name}" to Closed and unlinks the Labs job so you can re-import sold qtys and push again. The Labs job itself is not deleted. Sold/buffer/sample quantities aren't stored on the pre-order, so nothing else is lost.`}
        confirmLabel={reverting ? "Reverting…" : "Undo push"}
        onConfirm={revertPush}
        onCancel={() => setConfirmRevert(false)}
      />
    </div>
  );
}
