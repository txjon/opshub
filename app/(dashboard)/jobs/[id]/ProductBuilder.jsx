"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { logJobActivity } from "@/components/JobActivityPanel";
import { parsePsd } from "./ProcessingTab";
import { ItemArtSection } from "./ArtTab";
import {
  detectGarmentType, handleSizeToggle, distribute, DEFAULT_CURVE,
  SSPicker, ASColourPicker, LAApparelPicker, FavoritesPicker, OtherPicker,
} from "./BuySheetTab";

/**
 * Product Builder — unified tab: PSD drop + blank assignment + sizes/qty + art files
 * Layout: collapsed items by default, expand one to work on it.
 * Expanded: mockup left, blank → sizes → locations → files right.
 *
 * ALL save logic is identical to BuySheetTab (1500ms debounce, 3-state qty, temp ID swap).
 * ALL file management delegated to ItemArtSection from ArtTab.
 */
export function ProductBuilder({ project, items, contacts, onItemsChanged, onRegisterSave, onSaveStatus, onSaved, onUpdateItem }) {
  // ═══════════════════════════════════════════════════════════════
  // BUY SHEET SAVE INFRASTRUCTURE — copied verbatim from BuySheetTab
  // ═══════════════════════════════════════════════════════════════
  const [localItems, setLocalItems] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify(items || []));
  const onSaveRef = useRef(null);

  const workingItems = localItems !== null ? localItems : (items || []);
  const currentSnapshot = JSON.stringify(workingItems);
  const isDirty = currentSnapshot !== savedSnapshot;
  const updateLocal = (newItems) => setLocalItems(newItems);

  useEffect(() => {
    if (localItems === null) setSavedSnapshot(JSON.stringify(items || []));
  }, [items]);

  // Auto-save: 1500ms debounce
  useEffect(() => {
    if (!isDirty) return;
    const t = setTimeout(async () => { await onSaveRef.current?.(); }, 1500);
    return () => clearTimeout(t);
  }, [currentSnapshot]);

  useEffect(() => {
    if (typeof onRegisterSave === "function") {
      onRegisterSave(async () => { await onSaveRef.current?.(); });
    }
  }, [currentSnapshot]);

  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    const handler = (e) => { if (isDirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => { window.removeEventListener("beforeunload", handler); if (onSaveRef.current) onSaveRef.current(); };
  }, []);

  // Save function — diffs against DB
  const doSave = async () => {
    const current = workingItems;
    const saved = JSON.parse(savedSnapshot);
    const supabase = createClient();
    try {
      const deleted = saved.filter(s => !current.find(c => c.id === s.id));
      for (const item of deleted) {
        if (typeof item.id === "string" && item.id.length > 20) {
          await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id);
          await supabase.from("items").delete().eq("id", item.id);
        }
      }
      const idMap = {};
      const added = current.filter(c => !saved.find(s => s.id === c.id));
      for (const item of added) {
        const { data } = await supabase.from("items").insert({
          job_id: project.id, name: item.name,
          blank_vendor: item.blank_vendor || null, blank_sku: item.blank_sku || null,
          cost_per_unit: item.cost_per_unit || null,
          blank_costs: item.blankCosts && Object.keys(item.blankCosts).length > 0 ? item.blankCosts : null,
          garment_type: item.garment_type || null,
          status: "tbd", artwork_status: "not_started", sort_order: current.indexOf(item),
        }).select("id").single();
        if (data) {
          idMap[item.id] = data.id;
          if (item.sizes?.length > 0) {
            await supabase.from("buy_sheet_lines").insert(
              item.sizes.map(sz => ({ item_id: data.id, size: sz, qty_ordered: item.qtys?.[sz] || 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }))
            );
          }
        }
      }
      const updated = current.filter(c => saved.find(s => s.id === c.id));
      for (const item of updated) {
        const prev = saved.find(s => s.id === item.id);
        const dbUpdates = {};
        if (item.name !== prev?.name) dbUpdates.name = item.name;
        if (item.garment_type !== prev?.garment_type) dbUpdates.garment_type = item.garment_type || null;
        if (item.cost_per_unit !== prev?.cost_per_unit) dbUpdates.cost_per_unit = item.cost_per_unit || null;
        if (JSON.stringify(item.blankCosts) !== JSON.stringify(prev?.blankCosts)) dbUpdates.blank_costs = item.blankCosts || null;
        if (item.blank_vendor) dbUpdates.blank_vendor = item.blank_vendor;
        if (item.blank_sku) dbUpdates.blank_sku = item.blank_sku;
        dbUpdates.sort_order = current.indexOf(item);
        await supabase.from("items").update(dbUpdates).eq("id", item.id);
        if (JSON.stringify(item.qtys) !== JSON.stringify(prev?.qtys)) {
          for (const [size, qty] of Object.entries(item.qtys || {})) {
            await supabase.from("buy_sheet_lines").upsert({ item_id: item.id, size, qty_ordered: qty }, { onConflict: "item_id,size" });
          }
        }
      }
      const hasNewIds = Object.keys(idMap).length > 0;
      if (hasNewIds) setLocalItems(prev => prev ? prev.map(it => idMap[it.id] ? { ...it, id: idMap[it.id] } : it) : prev);
      const resolvedCurrent = current.map(it => idMap[it.id] ? { ...it, id: idMap[it.id] } : it);
      setSavedSnapshot(JSON.stringify(resolvedCurrent));
      if (onSaved) onSaved(resolvedCurrent);
      if (onSaveStatus) onSaveStatus("saved");
    } catch (e) {
      console.error("Product builder save failed", e);
      if (onSaveStatus) onSaveStatus("error");
    }
  };
  onSaveRef.current = doSave;

  // ═══════════════════════════════════════════════════════════════
  // QTY SYSTEM — copied verbatim from BuySheetTab
  // ═══════════════════════════════════════════════════════════════
  const [localQtys, setLocalQtys] = useState({});
  const localQtysRef = useRef({});
  localQtysRef.current = localQtys;
  const workingItemsRef = useRef(workingItems);
  workingItemsRef.current = workingItems;
  const inputRefs = useRef({});
  const commitTimers = useRef({});

  useEffect(() => {
    return () => {
      const pending = localQtysRef.current;
      if (!pending || Object.keys(pending).length === 0) return;
      const items = workingItemsRef.current || [];
      const updated = items.map(it => {
        let newQtys = { ...(it.qtys || {}) };
        let modified = false;
        (it.sizes || []).forEach(sz => {
          const key = it.id + "_" + sz;
          if (pending[key] !== undefined) { newQtys[sz] = parseInt(pending[key]) || 0; modified = true; }
        });
        return modified ? { ...it, qtys: newQtys, totalQty: Object.values(newQtys).reduce((a, v) => a + v, 0) } : it;
      });
      setLocalItems(updated);
    };
  }, []);

  const getLocalQty = (itemId, sz) => { const key = itemId + "_" + sz; return localQtys[key] !== undefined ? localQtys[key] : null; };
  const setLocalQty = (itemId, sz, val) => { setLocalQtys(p => ({ ...p, [itemId + "_" + sz]: val })); };
  const commitQty = (rowIdx, itemId, sz) => {
    const key = itemId + "_" + sz;
    if (commitTimers.current[key]) { clearTimeout(commitTimers.current[key]); delete commitTimers.current[key]; }
    const val = localQtysRef.current[key];
    if (val === undefined) return;
    const parsed = parseInt(val) || 0;
    setLocalQtys(p => { const n = { ...p }; delete n[key]; return n; });
    setLocalItems(prev => {
      const items = prev || workingItemsRef.current || [];
      return items.map(it => {
        if (it.id !== itemId) return it;
        const newQtys = { ...(it.qtys || {}), [sz]: parsed };
        return { ...it, qtys: newQtys, totalQty: Object.values(newQtys).reduce((a, v) => a + v, 0) };
      });
    });
  };
  const scheduleCommit = (rowIdx, itemId, sz) => {
    const key = itemId + "_" + sz;
    if (commitTimers.current[key]) clearTimeout(commitTimers.current[key]);
    commitTimers.current[key] = setTimeout(() => commitQty(rowIdx, itemId, sz), 500);
  };

  // ═══════════════════════════════════════════════════════════════
  // ITEM MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  const safeItems = (workingItems || []).map(it => ({
    ...it, sizes: it.sizes || [], qtys: it.qtys || {},
    totalQty: it.totalQty || Object.values(it.qtys || {}).reduce((a, v) => a + v, 0),
  }));
  const grandTotal = safeItems.reduce((a, it) => a + (it.totalQty || 0), 0);
  const removeItem = (id) => updateLocal((workingItems || []).filter(x => x.id !== id));
  const addItem = (item) => updateLocal([...(workingItems || []), item]);
  const assignBlank = (blankData) => {
    if (!assignBlankTo) return;
    const targetIds = Array.isArray(assignBlankTo) ? assignBlankTo : [assignBlankTo];
    updateLocal((workingItems || []).map(it => {
      if (!targetIds.includes(it.id)) return it;
      return {
        ...it, blank_vendor: blankData.blank_vendor, blank_sku: blankData.blank_sku,
        style: blankData.style, color: blankData.color, sizes: blankData.sizes,
        qtys: blankData.qtys || Object.fromEntries((blankData.sizes || []).map(sz => [sz, it.qtys?.[sz] || 0])),
        blankCosts: blankData.blankCosts || {},
        garment_type: blankData.garment_type || detectGarmentType("", (it.name || "") + " " + (blankData.blank_vendor || "")) || it.garment_type,
        totalQty: blankData.totalQty || Object.values(blankData.qtys || {}).reduce((a, v) => a + v, 0),
        curve: blankData.curve || it.curve || DEFAULT_CURVE,
      };
    }));
    setAssignBlankTo(null);
  };

  // ═══════════════════════════════════════════════════════════════
  // UI STATE
  // ═══════════════════════════════════════════════════════════════
  const [expandedId, setExpandedId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showASColour, setShowASColour] = useState(false);
  const [showLAApparel, setShowLAApparel] = useState(false);
  const [showOtherPicker, setShowOtherPicker] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showAddType, setShowAddType] = useState(null);
  const [assignBlankTo, setAssignBlankTo] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [psdProcessing, setPsdProcessing] = useState(null);
  const [distRow, setDistRow] = useState(null);
  const [distTotal, setDistTotal] = useState("");
  // Accessories
  const [accType, setAccType] = useState("");
  const [accName, setAccName] = useState("");
  const [accQty, setAccQty] = useState("");
  const [accCatalog, setAccCatalog] = useState([]);
  const SEED_ACC_TYPES = ["Patch - PVC", "Patch - Embroidered", "Flag", "Keychain"];
  const [accTypes, setAccTypes] = useState(SEED_ACC_TYPES);

  useEffect(() => {
    createClient().from("favorites").select("*").order("style_name").then(({ data }) => setFavorites(data || []));
    createClient().from("items").select("name, blank_vendor").eq("garment_type", "accessory").then(({ data }) => {
      setAccCatalog([...new Set((data || []).map(d => d.name).filter(Boolean))].sort());
      setAccTypes([...new Set([...SEED_ACC_TYPES, ...(data || []).map(d => d.blank_vendor).filter(Boolean)])].sort());
    });
  }, []);

  const isFav = (supplier, styleCode) => favorites.some(f => f.supplier === supplier && f.style_code === styleCode);
  const toggleFav = async (supplier, styleCode, styleName, sourceCategory) => {
    const supabase = createClient();
    if (isFav(supplier, styleCode)) {
      await supabase.from("favorites").delete().eq("supplier", supplier).eq("style_code", styleCode);
      setFavorites(prev => prev.filter(f => !(f.supplier === supplier && f.style_code === styleCode)));
    } else {
      const { data } = await supabase.from("favorites").insert({ supplier, style_code: styleCode, style_name: styleName, category: "Other" }).select().single();
      if (data) setFavorites(prev => [...prev, data].sort((a, b) => a.style_name.localeCompare(b.style_name)));
    }
  };

  const addAccessory = () => {
    if (!accName.trim()) return;
    addItem({
      id: Date.now() + Math.random(), name: accName.trim(), blank_vendor: accType.trim(), blank_sku: "",
      garment_type: detectGarmentType("", accName.trim() + " " + accType.trim()) || "accessory",
      sizes: ["OS"], qtys: { OS: parseInt(accQty) || 0 }, curve: DEFAULT_CURVE,
      totalQty: parseInt(accQty) || 0, blankCosts: {}, cost_per_unit: 0,
    });
    setAccType(""); setAccName(""); setAccQty("");
  };

  // Drag reorder
  const handleDrop = (idx) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const newItems = [...(workingItems || [])];
    const [moved] = newItems.splice(dragIdx, 1);
    newItems.splice(idx, 0, moved);
    updateLocal(newItems);
    setDragIdx(null); setDragOverIdx(null);
  };

  // Distribute
  const handleDist = (rowIdx) => {
    const total = parseInt(distTotal); if (!total || total <= 0) return;
    const item = safeItems[rowIdx];
    const dist = distribute(total, item.sizes, item.curve || DEFAULT_CURVE);
    updateLocal((workingItems || []).map((it, i) => i !== rowIdx ? it : { ...it, qtys: dist, totalQty: Object.values(dist).reduce((a, v) => a + v, 0) }));
    setDistRow(null); setDistTotal("");
  };

  // ═══════════════════════════════════════════════════════════════
  // PSD DROP — creates item + saves as print-ready
  // ═══════════════════════════════════════════════════════════════
  const clientName = project?.clients?.name || "Unknown Client";
  const projectTitle = project?.title || "";

  async function processPsd(file) {
    if (!file || !file.name.toLowerCase().endsWith(".psd")) return;
    const itemName = file.name.replace(/\.psd$/i, "").trim();
    setPsdProcessing({ status: "Reading PSD...", fileName: file.name });
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { locations, hasTag } = await parsePsd(arrayBuffer);
      setPsdProcessing({ status: "Creating item...", fileName: file.name });
      const supabase = createClient();
      const sortOrder = (items || []).length + safeItems.filter(s => !items?.find(it => it.id === s.id)).length;
      const { data: newItem } = await supabase.from("items").insert({
        job_id: project.id, name: itemName, status: "tbd", artwork_status: "not_started", sort_order: sortOrder,
      }).select("id").single();
      if (newItem) {
        setPsdProcessing({ status: "Uploading to Drive...", fileName: file.name });
        const driveFile = await uploadToDrive({ blob: file, fileName: file.name, mimeType: "application/octet-stream", clientName, projectTitle, itemName });
        await registerFileInDb({ ...driveFile, itemId: newItem.id, stage: "print_ready", notes: JSON.stringify({ psd_locations: locations, psd_has_tag: hasTag }) });
        logJobActivity(project.id, `Item "${itemName}" created from PSD: ${locations.length} location${locations.length !== 1 ? "s" : ""}${hasTag ? " + tag" : ""}`);
      }
      if (onItemsChanged) onItemsChanged();
    } catch (err) { console.error("PSD processing error:", err); }
    finally { setPsdProcessing(null); }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  const isEmpty = safeItems.length === 0;
  const ic = { padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 12, fontFamily: mono, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 6 }}>

      {/* ══ Picker modals (same as BuySheetTab) ══ */}
      {(showPicker || showASColour || showLAApparel || showFavorites || showOtherPicker) && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => { setShowPicker(false); setShowASColour(false); setShowLAApparel(false); setShowFavorites(false); setShowOtherPicker(false); }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "95vw", maxWidth: 1000, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => { setShowPicker(false); setShowASColour(false); setShowLAApparel(false); setShowFavorites(false); setShowOtherPicker(false); if (!assignBlankTo) setShowAddModal(true); setAssignBlankTo(null); }}
                style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 11, fontWeight: 600, padding: "4px 12px", cursor: "pointer" }}>
                ← {assignBlankTo ? "Cancel" : "Sources"}
              </button>
              {assignBlankTo && <span style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>{Array.isArray(assignBlankTo) ? `Assigning blank to ${assignBlankTo.length} items` : `Assigning blank`}</span>}
            </div>
            {showPicker && <SSPicker onAdd={item => { if (assignBlankTo) assignBlank(item); else addItem(item); }} onClose={() => { setShowPicker(false); setAssignBlankTo(null); }} isFav={isFav} toggleFav={toggleFav} />}
            {showASColour && <ASColourPicker onAdd={item => { if (assignBlankTo) assignBlank(item); else addItem(item); setShowASColour(false); }} onClose={() => { setShowASColour(false); setAssignBlankTo(null); }} isFav={isFav} toggleFav={toggleFav} />}
            {showLAApparel && <LAApparelPicker onAdd={item => { if (assignBlankTo) assignBlank(item); else addItem(item); }} onClose={() => { setShowLAApparel(false); setAssignBlankTo(null); }} isFav={isFav} toggleFav={toggleFav} />}
            {showFavorites && <FavoritesPicker favorites={favorites} setFavorites={setFavorites} onAdd={item => { if (assignBlankTo) assignBlank(item); else addItem(item); }} onClose={() => { setShowFavorites(false); setAssignBlankTo(null); }} toggleFav={toggleFav} />}
            {showOtherPicker && <OtherPicker onAdd={item => { if (assignBlankTo) assignBlank(item); else addItem(item); }} onClose={() => { setShowOtherPicker(false); setAssignBlankTo(null); }} />}
          </div>
        </div>
      )}

      {/* Add item modal */}
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => { setShowAddModal(false); setAssignBlankTo(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 420, maxWidth: "90vw" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{assignBlankTo ? "Assign Blank" : "Add Item"}</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>{assignBlankTo ? "Select a blank source" : "Choose a source"}</div>
            <button onClick={() => { setShowAddModal(false); setShowFavorites(true); }} style={{ width: "100%", padding: 12, borderRadius: 8, border: "none", background: "#5795b2", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}>
              House Party Favorites {favorites.length > 0 && <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>{favorites.length}</span>}
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "S&S Activewear", bg: "#b65722", color: "#fff", action: () => { setShowAddModal(false); setShowPicker(true); } },
                { label: "AS Colour", bg: "#000", color: "#fff", action: () => { setShowAddModal(false); setShowASColour(true); } },
                { label: "LA Apparel", bg: "#fff", color: "#000", border: true, action: () => { setShowAddModal(false); setShowLAApparel(true); } },
                { label: "Custom Accessory", bg: T.surface, color: T.text, border: true, action: () => { setShowAddModal(false); setShowAddType("accessory"); } },
                { label: "Other", bg: T.surface, color: T.text, border: true, action: () => { setShowAddModal(false); setShowOtherPicker(true); } },
              ].map(opt => (
                <button key={opt.label} onClick={opt.action} style={{ padding: "10px 14px", borderRadius: 8, border: opt.border ? `1px solid ${T.border}` : "none", background: opt.bg, cursor: "pointer", fontSize: 12, fontWeight: 600, color: opt.color }}>{opt.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Accessory modal */}
      {showAddType === "accessory" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowAddType(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 400, maxWidth: "90vw" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Custom Accessory</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label style={{ fontSize: 10, color: T.muted, display: "block", marginBottom: 3 }}>Type</label><input value={accType} onChange={e => setAccType(e.target.value)} onKeyDown={e => e.key === "Enter" && addAccessory()} list="pb-acc-types" placeholder="Patch - PVC, Sticker..." autoFocus style={{ ...ic, width: "100%", padding: "8px 10px", fontSize: 13, fontFamily: font }} /><datalist id="pb-acc-types">{accTypes.map(t => <option key={t} value={t} />)}</datalist></div>
              <div><label style={{ fontSize: 10, color: T.muted, display: "block", marginBottom: 3 }}>Name</label><input value={accName} onChange={e => setAccName(e.target.value)} onKeyDown={e => e.key === "Enter" && addAccessory()} list="pb-acc-names" placeholder="Item name..." style={{ ...ic, width: "100%", padding: "8px 10px", fontSize: 13, fontFamily: font }} /><datalist id="pb-acc-names">{accCatalog.map(n => <option key={n} value={n} />)}</datalist></div>
              <div><label style={{ fontSize: 10, color: T.muted, display: "block", marginBottom: 3 }}>Qty</label><input value={accQty} onChange={e => setAccQty(e.target.value)} onKeyDown={e => e.key === "Enter" && addAccessory()} type="text" inputMode="numeric" placeholder="0" style={{ ...ic, width: 100, padding: "8px 10px", fontSize: 13, textAlign: "center" }} /></div>
              <button onClick={() => { addAccessory(); setShowAddType(null); }} disabled={!accName.trim()} style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600, cursor: accName.trim() ? "pointer" : "default", background: accName.trim() ? T.accent : T.surface, color: accName.trim() ? "#fff" : T.faint }}>Add Item</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Add zone — PSD drop + catalog trigger ══ */}
      <div
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accentDim; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = "transparent"; }}
        onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = "transparent"; const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".psd")); if (files.length > 0) { for (const f of files) processPsd(f); } else { setShowAddModal(true); } }}
        onClick={() => { if (!psdProcessing) setShowAddModal(true); }}
        style={{ border: `2px dashed ${T.border}`, borderRadius: 10, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 16, cursor: "pointer", transition: "all 0.15s" }}
      >
        {psdProcessing ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.accent }}>{psdProcessing.status}</div>
            <div style={{ fontSize: 10, color: T.muted }}>{psdProcessing.fileName}</div>
          </div>
        ) : (
          <>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.accent }}>+ Drop PSD or click to add item</span>
            <span style={{ width: 1, height: 24, background: T.border }} />
            <span style={{ fontSize: 11, color: T.muted }}>Favorites · S&S · AS Colour · LA Apparel · Other</span>
          </>
        )}
      </div>

      {/* Grand total */}
      {safeItems.length > 0 && (
        <div style={{ fontSize: 12, fontWeight: 600, color: T.accent, fontFamily: mono, padding: "2px 0" }}>
          {grandTotal.toLocaleString()} units · {safeItems.length} item{safeItems.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* ══ Item list ══ */}
      {safeItems.map((item, idx) => {
        const isExpanded = expandedId === item.id;
        const hasBlank = !!item.blank_vendor;
        const fileCount = 0; // Will be populated by ItemArtSection internally

        return (
          <div key={item.id}
            draggable={!isExpanded}
            onDragStart={() => setDragIdx(idx)}
            onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
            onDragLeave={() => setDragOverIdx(null)}
            onDrop={() => handleDrop(idx)}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
            style={{
              background: T.card, border: `1px solid ${isExpanded ? T.accent + "44" : dragOverIdx === idx ? T.accent : T.border}`,
              borderRadius: isExpanded ? 12 : 10, overflow: "hidden",
              opacity: dragIdx === idx ? 0.5 : 1, transition: "border-color 0.15s",
            }}
          >
            {/* ── Header (always visible) ── */}
            <div
              onClick={() => setExpandedId(isExpanded ? null : item.id)}
              style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderBottom: isExpanded ? `1px solid ${T.border}44` : "none" }}
            >
              <span style={{ color: T.faint, fontSize: 12, cursor: "grab", userSelect: "none" }}>⠿</span>
              <span style={{ width: 22, height: 22, borderRadius: 5, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>
                {String.fromCharCode(65 + idx)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name || "Untitled"}</span>
              {hasBlank && <span style={{ fontSize: 11, color: T.muted, flexShrink: 0, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.blank_vendor}{item.color ? ` · ${item.color}` : ""}</span>}
              {!hasBlank && item.garment_type !== "accessory" && <span style={{ fontSize: 11, color: T.amber, flexShrink: 0 }}>No blank</span>}
              <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, flexShrink: 0, minWidth: 50, textAlign: "right", color: item.totalQty > 0 ? T.text : T.faint }}>{item.totalQty > 0 ? item.totalQty : "—"}</span>
              <span style={{ fontSize: 10, color: T.faint, flexShrink: 0 }}>{isExpanded ? "▴" : "▾"}</span>
            </div>

            {/* ── Expanded body ── */}
            {isExpanded && (
              <ExpandedItemBody
                item={item} idx={idx} clientName={clientName} projectTitle={projectTitle}
                contacts={contacts} project={project} hasBlank={hasBlank}
                getLocalQty={getLocalQty} setLocalQty={setLocalQty} commitQty={commitQty}
                scheduleCommit={scheduleCommit} inputRefs={inputRefs} distRow={distRow}
                setDistRow={setDistRow} distTotal={distTotal} setDistTotal={setDistTotal}
                handleDist={handleDist} removeItem={removeItem} setAssignBlankTo={setAssignBlankTo}
                setShowAddModal={setShowAddModal} onItemsChanged={onItemsChanged} onUpdateItem={onUpdateItem}
                ic={ic}
              />
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {isEmpty && !psdProcessing && (
        <div style={{ padding: "20px 0", textAlign: "center" }}>
          <div style={{ color: T.faint, fontSize: 13, marginBottom: 16 }}>No items yet — drop a PSD or add from catalog.</div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Expanded item body — manages its own file state per item
// ═══════════════════════════════════════════════════════════════
function ExpandedItemBody({ item, idx, clientName, projectTitle, contacts, project, hasBlank, getLocalQty, setLocalQty, commitQty, scheduleCommit, inputRefs, distRow, setDistRow, distTotal, setDistTotal, handleDist, removeItem, setAssignBlankTo, setShowAddModal, onItemsChanged, onUpdateItem, ic }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadFiles(); }, [item.id]);

  async function loadFiles() {
    try {
      const res = await fetch(`/api/files?itemId=${item.id}`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch {}
  }

  const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup") && /\.(png|jpg|jpeg)$/i.test(f.file_name));
  const mockupThumb = mockupFile ? `/api/files/thumbnail?id=${mockupFile.drive_file_id}` : null;
  const nonMockupFiles = files.filter(f => f !== mockupFile);

  const STAGE_COLORS = { client_art: T.muted, vector: T.accent, mockup: T.amber, proof: T.purple, print_ready: T.green };
  const STAGE_LABELS = { client_art: "CLIENT ART", vector: "VECTOR", mockup: "MOCKUP", proof: "PROOF", print_ready: "PRINT-READY" };

  function detectStage(fileName) {
    const f = (fileName || "").toLowerCase();
    if (f.endsWith(".psd")) return "print_ready";
    if (f.endsWith(".ai") || f.endsWith(".eps") || (f.endsWith(".pdf") && !f.includes("proof"))) return "vector";
    if (f.endsWith(".pdf") && f.includes("proof")) return "proof";
    if (/\.(png|jpg|jpeg)$/i.test(f) && f.includes("mockup")) return "mockup";
    if (/\.(png|jpg|jpeg)$/i.test(f) && f.includes("proof")) return "proof";
    return "client_art";
  }

  async function handleFileDrop(fileList) {
    const allFiles = Array.from(fileList);
    if (allFiles.length === 0) return;
    setUploading(true);
    for (let i = 0; i < allFiles.length; i++) {
      setUploadProgress({ total: allFiles.length, done: i, current: allFiles[i].name });
      const stage = detectStage(allFiles[i].name);
      try {
        const driveFile = await uploadToDrive({ blob: allFiles[i], fileName: allFiles[i].name, mimeType: allFiles[i].type || "application/octet-stream", clientName, projectTitle, itemName: item.name });
        await registerFileInDb({ ...driveFile, itemId: item.id, stage });
      } catch (err) { console.error("Upload error:", err); }
    }
    setUploading(false); setUploadProgress(null);
    loadFiles();
    logJobActivity(project.id, `${allFiles.length} file${allFiles.length > 1 ? "s" : ""} uploaded for ${item.name}`);
    if (onItemsChanged) onItemsChanged();
  }

  async function deleteFile(file) {
    if (!window.confirm(`Delete "${file.file_name}"?`)) return;
    await fetch("/api/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: file.id, driveFileId: file.drive_file_id }) });
    loadFiles();
  }

  return (
    <div style={{ padding: "14px 16px", display: "flex", gap: 16 }}>
      {/* Left: Mockup thumbnail (tall, clean) */}
      <div style={{ width: 160, flexShrink: 0 }}>
        {mockupThumb ? (
          <a href={mockupFile.drive_link} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
            <img src={mockupThumb} alt="Mockup" style={{ width: 160, maxHeight: 240, objectFit: "contain", borderRadius: 10, border: `1px solid ${T.border}`, display: "block", background: T.surface }} onError={e => { e.target.style.display = "none"; }} />
          </a>
        ) : (
          <div style={{ width: 160, height: 200, borderRadius: 10, border: `1px dashed ${T.border}`, background: T.surface, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.accent }}>Build Mockup</div>
              <div style={{ fontSize: 9, color: T.faint, marginTop: 2 }}>from print file</div>
            </div>
          </div>
        )}
      </div>

      {/* Right: Blank → Sizes → Locations → Files */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Blank */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Blank</div>
          {hasBlank ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: T.muted, padding: "5px 12px", background: T.surface, borderRadius: 6, border: `1px solid ${T.border}` }}>
                <strong style={{ color: T.text, fontWeight: 600 }}>{item.blank_vendor}</strong>{item.color ? ` · ${item.color}` : ""}
              </span>
              {item.garment_type && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 99, background: T.surface, color: T.muted, border: `1px solid ${T.border}` }}>{item.garment_type}</span>}
              <button onClick={e => { e.stopPropagation(); setAssignBlankTo(item.id); setShowAddModal(true); }} style={{ fontSize: 10, color: T.accent, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>Change</button>
              <button onClick={e => { e.stopPropagation(); if (window.confirm(`Remove "${item.name}"?`)) removeItem(item.id); }} style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer", marginLeft: "auto" }} onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>Delete item</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={e => { e.stopPropagation(); setAssignBlankTo(item.id); setShowAddModal(true); }} style={{ fontSize: 12, fontWeight: 600, color: T.accent, cursor: "pointer", padding: "6px 16px", border: `1px dashed ${T.accent}44`, borderRadius: 6, background: "none" }}>Assign Blank →</button>
              <button onClick={e => { e.stopPropagation(); if (window.confirm(`Remove "${item.name}"?`)) removeItem(item.id); }} style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer", marginLeft: "auto" }} onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>Delete item</button>
            </div>
          )}
        </div>

        {/* Sizes & Quantities */}
        {item.sizes.length > 0 && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Sizes & Quantities</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {item.sizes.map((sz, ci) => {
                  const localVal = getLocalQty(item.id, sz);
                  const displayVal = localVal !== null ? localVal : (item.qtys[sz] || 0);
                  return (
                    <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontSize: 9, color: T.faint, fontFamily: mono }}>{sz}</span>
                      <input
                        ref={el => { inputRefs.current[`${idx}_${ci}`] = el; }}
                        type="text" inputMode="numeric" value={displayVal}
                        onChange={e => { setLocalQty(item.id, sz, e.target.value); scheduleCommit(idx, item.id, sz); }}
                        onFocus={e => e.target.select()}
                        onBlur={() => commitQty(idx, item.id, sz)}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === "ArrowDown") { commitQty(idx, item.id, sz); const next = inputRefs.current[`${idx + 1}_${ci}`]; if (next) next.focus(); }
                          else if (e.key === "ArrowUp") { commitQty(idx, item.id, sz); const prev = inputRefs.current[`${idx - 1}_${ci}`]; if (prev) prev.focus(); }
                          else if (e.key === "Tab" || e.key === "ArrowRight") { if (!e.shiftKey) { e.preventDefault(); commitQty(idx, item.id, sz); const next = inputRefs.current[`${idx}_${ci + 1}`] || inputRefs.current[`${idx + 1}_0`]; if (next) next.focus(); } }
                          else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); commitQty(idx, item.id, sz); const prev = inputRefs.current[`${idx}_${ci - 1}`] || inputRefs.current[`${idx - 1}_${item.sizes.length - 1}`]; if (prev) prev.focus(); }
                        }}
                        style={{ ...ic, width: 44, textAlign: "center" }}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: mono }}>{item.totalQty}</div>
                <div style={{ fontSize: 9, color: T.muted }}>units</div>
              </div>
              <button onClick={() => { setDistRow(idx); setDistTotal(""); }} style={{ fontSize: 10, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>⟳ Dist</button>
            </div>
            {distRow === idx && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                <input type="text" inputMode="numeric" value={distTotal} onChange={e => setDistTotal(e.target.value)} onKeyDown={e => e.key === "Enter" && handleDist(idx)} placeholder="Total qty" autoFocus style={{ ...ic, width: 80, textAlign: "center" }} />
                <button onClick={() => handleDist(idx)} style={{ fontSize: 10, color: "#fff", background: T.accent, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>Fill</button>
                <button onClick={() => setDistRow(null)} style={{ fontSize: 10, color: T.muted, background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
              </div>
            )}
          </div>
        )}
        {!hasBlank && item.sizes.length === 0 && item.garment_type !== "accessory" && (
          <div style={{ fontSize: 11, color: T.faint }}>Assign a blank to set available sizes</div>
        )}

        {/* Print Locations */}
        {item.psdLocations && item.psdLocations.length > 0 && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Print Locations</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {item.psdLocations.map((loc, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: T.surface, fontSize: 10, border: `1px solid ${T.border}44` }}>
                  <span style={{ fontWeight: 600, color: T.text }}>{loc.placement}</span>
                  <span style={{ color: T.muted, fontFamily: mono }}>{loc.colorCount}c</span>
                </span>
              ))}
              {item.psdHasTag && <span style={{ padding: "3px 8px", borderRadius: 6, background: T.amberDim, fontSize: 10, fontWeight: 600, color: T.amber }}>Tag</span>}
            </div>
          </div>
        )}

        {/* Files */}
        <div style={{ borderTop: `1px solid ${T.border}33`, paddingTop: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Files</div>
          {uploading && uploadProgress && (
            <div style={{ fontSize: 10, color: T.accent, marginBottom: 4 }}>Uploading {uploadProgress.done + 1}/{uploadProgress.total}: {uploadProgress.current}</div>
          )}
          {nonMockupFiles.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 6 }}>
              {nonMockupFiles.map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderRadius: 4 }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surface}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", width: 62, flexShrink: 0, color: STAGE_COLORS[f.stage] || T.muted }}>{STAGE_LABELS[f.stage] || f.stage}</span>
                  <a href={f.drive_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: T.text, textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</a>
                  <span style={{ fontSize: 9, color: T.faint, flexShrink: 0 }}>{new Date(f.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <button onClick={() => deleteFile(f)} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 10, flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>×</button>
                </div>
              ))}
            </div>
          )}
          <div
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderColor = T.accent; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderColor = T.border; handleFileDrop(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            style={{ border: `1px dashed ${T.border}`, borderRadius: 6, padding: 6, textAlign: "center", cursor: "pointer", transition: "border-color 0.15s" }}
          >
            <span style={{ fontSize: 10, color: T.accent, fontWeight: 600 }}>+ Drop files to add</span>
          </div>
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={e => { handleFileDrop(e.target.files); e.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}
