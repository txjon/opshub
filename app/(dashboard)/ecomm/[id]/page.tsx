"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { T, font, mono } from "@/lib/theme";

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
  // Delete a pre-order (incl. stale/test entries). preorder_products
  // cascade via FK (mig 079). The .select() after delete returns the
  // removed rows — an empty array means nothing deleted (RLS / already
  // gone), so it can't fail silently the way "no button" did.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>("");

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

  async function updateField(field: keyof Preorder, value: any) {
    if (!preorder) return;
    setPreorder(p => p ? { ...p, [field]: value } as Preorder : p);
    await supabase.from("fulfillment_projects").update({ [field]: value }).eq("id", preorderId);
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
      for (const sz of p.sizes) seed[p.id][sz] = "";
    }
    setSoldQtys(seed);
    setPushBuffer(String(preorder?.buffer_pct ?? 5));
    setPushError("");
    setPushOpen(true);
  }

  function calcTotal(sold: number, bufferPct: number): number {
    if (sold <= 0) return 0;
    return Math.ceil(sold * (1 + bufferPct / 100));
  }

  function pushSummary() {
    const bufferPct = parseFloat(pushBuffer) || 0;
    const rows: { product: PreorderProduct; sizes: { size: string; sold: number; total: number }[]; totalUnits: number }[] = [];
    let grand = 0;
    for (const p of products) {
      const sizeRows = p.sizes.map(sz => {
        const sold = parseInt(soldQtys[p.id]?.[sz] || "0", 10) || 0;
        const total = calcTotal(sold, bufferPct);
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
      for (let i = 0; i < productsToCreate.length; i++) {
        const r = productsToCreate[i];
        const { data: newItem, error: itemErr } = await (supabase.from("items") as any).insert({
          job_id: newJobId,
          name: r.product.name,
          blank_vendor: r.product.blank_vendor,
          blank_sku: r.product.blank_sku,
          status: "tbd",
          artwork_status: "not_started",
          sort_order: i,
        }).select("id").single();
        if (itemErr || !newItem) throw new Error(itemErr?.message || "Failed to create item");
        const itemId = (newItem as any).id;

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
      // Open the new Labs job in a new tab so Drake can review.
      window.open(`/jobs/${newJobId}`, "_blank");
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
        <button onClick={() => advanceStatus("fulfilling")}
          style={{ background: T.purple, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 18px", cursor: "pointer", fontFamily: font }}>
          → Fulfilling (received + in Shopify)
        </button>
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
          <button onClick={() => setShowAddProduct(v => !v)}
            style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", cursor: "pointer", fontFamily: font }}>
            {showAddProduct ? "Cancel" : "+ Add product"}
          </button>
        </div>

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
                    {p.sizes.length > 0 && <span style={{ fontFamily: mono }}>{p.sizes.join(" · ")}</span>}
                    {p.retail_price != null && <span style={{ color: T.text, fontWeight: 600 }}>${p.retail_price.toFixed(2)}</span>}
                  </div>
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

              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                  Paste sold quantities from the Shopify pre-order report per variant. Buffer % is applied to each row;
                  totals round up. A new Labs project is created with these qtys, the buy sheet is pre-filled, and the
                  pre-order is linked to the Labs job.
                </div>

                {/* Buffer */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "10px 12px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Buffer %</span>
                  <input type="number" step="0.5" min="0" value={pushBuffer}
                    onChange={e => setPushBuffer(e.target.value)}
                    style={{ ...ic, width: 80, padding: "4px 8px" }} />
                  <span style={{ fontSize: 11, color: T.muted }}>applied per variant; total = sold × (1 + buffer / 100), rounded up</span>
                </div>

                {/* Per-product size grids */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {products.map(p => (
                    <div key={p.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                        {p.blank_vendor || "—"}
                        {p.blank_sku && <span style={{ marginLeft: 8, fontFamily: mono }}>{p.blank_sku}</span>}
                      </div>
                      {p.sizes.length === 0 ? (
                        <div style={{ fontSize: 11, color: T.amber, marginTop: 8 }}>No sizes set on this product — skip or add sizes first.</div>
                      ) : (
                        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: `repeat(${p.sizes.length}, 1fr)`, gap: 6 }}>
                          {p.sizes.map(sz => {
                            const sold = parseInt(soldQtys[p.id]?.[sz] || "0", 10) || 0;
                            const bufferPct = parseFloat(pushBuffer) || 0;
                            const total = calcTotal(sold, bufferPct);
                            return (
                              <div key={sz} style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8, background: T.card, borderRadius: 6, border: `1px solid ${T.border}` }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, fontFamily: mono, textAlign: "center" }}>{sz}</div>
                                <input type="text" inputMode="numeric"
                                  value={soldQtys[p.id]?.[sz] || ""}
                                  onChange={e => {
                                    const v = e.target.value.replace(/[^0-9]/g, "");
                                    setSoldQtys(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [sz]: v } }));
                                  }}
                                  onFocus={e => (e.target as HTMLInputElement).select()}
                                  placeholder="0"
                                  style={{ ...ic, padding: "5px 6px", textAlign: "center", fontFamily: mono, fontWeight: 600 }} />
                                <div style={{ fontSize: 10, color: total > sold ? T.green : T.faint, fontFamily: mono, textAlign: "center", fontWeight: 600 }}>
                                  → {total}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Summary */}
                <div style={{ padding: "10px 14px", borderRadius: 8, background: T.accentDim, border: `1px solid ${T.accent}44`, fontSize: 13, color: T.text }}>
                  <strong>{summary.grandTotal.toLocaleString()}</strong> total units to produce across{" "}
                  <strong>{summary.rows.filter(r => r.totalUnits > 0).length}</strong> item{summary.rows.filter(r => r.totalUnits > 0).length === 1 ? "" : "s"}
                  {summary.bufferPct > 0 && (
                    <span style={{ color: T.muted }}> · includes {summary.bufferPct}% buffer</span>
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
    </div>
  );
}
