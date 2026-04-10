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
  SSPicker, ASColourPicker, LAApparelPicker, FavoritesPicker, OtherPicker, CottonCollectivePicker,
} from "./BuySheetTab";

/**
 * Product Builder — unified tab: PSD drop + blank assignment + sizes/qty + art files
 * Layout: collapsed items by default, expand one to work on it.
 * Expanded: mockup left, blank → sizes → locations → files right.
 *
 * ALL save logic is identical to BuySheetTab (1500ms debounce, 3-state qty, temp ID swap).
 * ALL file management delegated to ItemArtSection from ArtTab.
 */
export function ProductBuilder({ project, items, contacts, onItemsChanged, onRegisterSave, onSaveStatus, onSaved, onUpdateItem, selectedItemId }) {
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
          // Archive Drive folder before deleting DB records
          try {
            await fetch("/api/files/cleanup", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "archive-item", clientName, projectTitle, itemName: item.name, itemId: item.id }),
            });
          } catch {} // Non-fatal — delete proceeds even if archive fails
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
  const [showCCPicker, setShowCCPicker] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showAddType, setShowAddType] = useState(null);
  const [assignBlankTo, setAssignBlankTo] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [fileSummary, setFileSummary] = useState({}); // { itemId: { printReady: bool, fileCount: number, hasProof: bool } }
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

  // Load file summary for collapsed pills
  useEffect(() => {
    const ids = (items || []).map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
    if (ids.length === 0) return;
    createClient().from("item_files").select("item_id, stage").in("item_id", ids).then(({ data }) => {
      const summary = {};
      for (const f of (data || [])) {
        if (!summary[f.item_id]) summary[f.item_id] = { printReady: false, fileCount: 0, hasProof: false, hasMockup: false };
        summary[f.item_id].fileCount++;
        if (f.stage === "print_ready") summary[f.item_id].printReady = true;
        if (f.stage === "proof") summary[f.item_id].hasProof = true;
        if (f.stage === "mockup") summary[f.item_id].hasMockup = true;
      }
      setFileSummary(summary);
    });
  }, [items]);

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
  // FILE DROP — creates items from PSDs + pairs mockup images
  // ═══════════════════════════════════════════════════════════════
  const clientName = project?.clients?.name || "Unknown Client";
  const projectTitle = project?.title || "";

  function getBaseName(fileName) {
    return fileName
      .replace(/\.psd$/i, "")
      .replace(/[-_ ]?mockup[-_ ]?/i, "")
      .replace(/[-_ ]?mock[-_ ]?/i, "")
      .replace(/\.(png|jpg|jpeg|gif|webp)$/i, "")
      .trim()
      .toLowerCase();
  }

  async function processFileDrop(fileList) {
    const allFiles = Array.from(fileList);
    if (allFiles.length === 0) return;

    const psds = allFiles.filter(f => f.name.toLowerCase().endsWith(".psd"));
    const images = allFiles.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name));

    // If no PSDs and no images, open the add modal
    if (psds.length === 0 && images.length === 0) { setShowAddModal(true); return; }

    // Group by base name
    const groups = {};
    for (const f of psds) {
      const base = getBaseName(f.name);
      if (!groups[base]) groups[base] = { psd: null, mockup: null, displayName: f.name.replace(/\.psd$/i, "").trim() };
      groups[base].psd = f;
    }
    for (const f of images) {
      const base = getBaseName(f.name);
      if (groups[base]) {
        groups[base].mockup = f;
      } else {
        // Image with no matching PSD — still create a group
        const displayName = f.name.replace(/[-_ ]?mockup[-_ ]?/i, "").replace(/\.(png|jpg|jpeg|gif|webp)$/i, "").trim();
        groups[base] = { psd: null, mockup: f, displayName: displayName || f.name };
      }
    }

    const groupList = Object.values(groups);
    setPsdProcessing({ status: `Processing ${groupList.length} item${groupList.length !== 1 ? "s" : ""}...`, fileName: "" });

    const supabase = createClient();
    let created = 0;

    for (let g = 0; g < groupList.length; g++) {
      const group = groupList[g];
      const itemName = group.displayName;
      setPsdProcessing({ status: `${g + 1}/${groupList.length} — ${itemName}`, fileName: group.psd?.name || group.mockup?.name || "" });

      try {
        let locations = [];
        let hasTag = false;

        // Parse PSD for print locations
        if (group.psd) {
          try {
            const arrayBuffer = await group.psd.arrayBuffer();
            const parsed = await parsePsd(arrayBuffer);
            locations = parsed.locations;
            hasTag = parsed.hasTag;
          } catch (e) { console.warn("PSD parse error:", e); }
        }

        // Create item
        const sortOrder = (items || []).length + safeItems.filter(s => !items?.find(it => it.id === s.id)).length + created;
        const { data: newItem } = await supabase.from("items").insert({
          job_id: project.id, name: itemName, status: "tbd", artwork_status: "not_started", sort_order: sortOrder,
        }).select("id").single();

        if (newItem) {
          // Upload PSD as print_ready
          if (group.psd) {
            const driveFile = await uploadToDrive({ blob: group.psd, fileName: group.psd.name, mimeType: "application/octet-stream", clientName, projectTitle, itemName });
            await registerFileInDb({ ...driveFile, itemId: newItem.id, stage: "print_ready", notes: JSON.stringify({ psd_locations: locations, psd_has_tag: hasTag }) });
          }

          // Upload mockup image
          if (group.mockup) {
            const driveFile = await uploadToDrive({ blob: group.mockup, fileName: group.mockup.name, mimeType: group.mockup.type || "image/png", clientName, projectTitle, itemName });
            await registerFileInDb({ ...driveFile, itemId: newItem.id, stage: "mockup" });
          }

          created++;
          const parts = [];
          if (group.psd) parts.push(`PSD: ${locations.length} location${locations.length !== 1 ? "s" : ""}${hasTag ? " + tag" : ""}`);
          if (group.mockup) parts.push("mockup");
          logJobActivity(project.id, `Item "${itemName}" created — ${parts.join(", ") || "no files"}`);
        }
      } catch (err) { console.error("File drop error:", err); }
    }

    setPsdProcessing(null);
    if (onItemsChanged) onItemsChanged();
  }

  // Legacy single PSD processor (for backwards compat)
  async function processPsd(file) {
    return processFileDrop([file]);
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  const isEmpty = safeItems.length === 0;
  const ic = { padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 12, fontFamily: mono, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 6 }}>

      {/* ══ Picker modals (same as BuySheetTab) ══ */}
      {(showPicker || showASColour || showLAApparel || showFavorites || showOtherPicker || showCCPicker) && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => { setShowPicker(false); setShowASColour(false); setShowLAApparel(false); setShowFavorites(false); setShowOtherPicker(false); }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "95vw", maxWidth: 1000, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => { setShowPicker(false); setShowASColour(false); setShowLAApparel(false); setShowFavorites(false); setShowOtherPicker(false); setShowCCPicker(false); if (!assignBlankTo) setShowAddModal(true); setAssignBlankTo(null); }}
                style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 11, fontWeight: 600, padding: "4px 12px", cursor: "pointer" }}>
                ← {assignBlankTo ? "Cancel" : "Sources"}
              </button>
              {assignBlankTo && <span style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>{Array.isArray(assignBlankTo) ? `Assigning blank to ${assignBlankTo.length} items` : `Assigning blank`}</span>}
            </div>
            {(()=>{ const assignName = assignBlankTo ? (workingItems||[]).find(it=>it.id===assignBlankTo)?.name || "" : ""; return <>
            {showPicker && <SSPicker onAdd={item => { if (assignBlankTo) { assignBlank(item); setShowPicker(false); } else addItem(item); }} onClose={() => { setShowPicker(false); setAssignBlankTo(null); }} isFav={isFav} toggleFav={toggleFav} assignMode={!!assignBlankTo} defaultItemName={assignName} />}
            {showASColour && <ASColourPicker onAdd={item => { if (assignBlankTo) { assignBlank(item); setShowASColour(false); } else addItem(item); setShowASColour(false); }} onClose={() => { setShowASColour(false); setAssignBlankTo(null); }} isFav={isFav} toggleFav={toggleFav} assignMode={!!assignBlankTo} defaultItemName={assignName} />}
            {showLAApparel && <LAApparelPicker onAdd={item => { if (assignBlankTo) { assignBlank(item); setShowLAApparel(false); } else addItem(item); }} onClose={() => { setShowLAApparel(false); setAssignBlankTo(null); }} isFav={isFav} toggleFav={toggleFav} assignMode={!!assignBlankTo} defaultItemName={assignName} />}
            {showFavorites && <FavoritesPicker favorites={favorites} setFavorites={setFavorites} onAdd={item => { if (assignBlankTo) { assignBlank(item); setShowFavorites(false); } else addItem(item); }} onClose={() => { setShowFavorites(false); setAssignBlankTo(null); }} toggleFav={toggleFav} assignMode={!!assignBlankTo} defaultItemName={assignName} />}
            {showOtherPicker && <OtherPicker onAdd={item => { if (assignBlankTo) { assignBlank(item); setShowOtherPicker(false); } else addItem(item); }} onClose={() => { setShowOtherPicker(false); setAssignBlankTo(null); }} assignMode={!!assignBlankTo} defaultItemName={assignName} />}
            {showCCPicker && <CottonCollectivePicker onAdd={item => { if (assignBlankTo) { assignBlank(item); setShowCCPicker(false); } else addItem(item); }} onClose={() => { setShowCCPicker(false); setAssignBlankTo(null); }} assignMode={!!assignBlankTo} defaultItemName={assignName} />}
            </>; })()}
          </div>
        </div>
      )}

      {/* Add item modal */}
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => { setShowAddModal(false); setAssignBlankTo(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 420, maxWidth: "90vw" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{assignBlankTo ? "Assign Blank" : "Add Item"}</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>{assignBlankTo ? (() => {
              const ids = Array.isArray(assignBlankTo) ? assignBlankTo : [assignBlankTo];
              const names = ids.map(id => (workingItems || []).find(it => it.id === id)?.name).filter(Boolean);
              return names.length > 0 ? names.join(", ") : "Select a blank source";
            })() : "Choose a source"}</div>
            <button onClick={() => { setShowAddModal(false); setShowFavorites(true); }} style={{ width: "100%", padding: 12, borderRadius: 8, border: "none", background: "#5795b2", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}>
              House Party Favorites {favorites.length > 0 && <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>{favorites.length}</span>}
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "S&S Activewear", bg: "#b65722", color: "#fff", action: () => { setShowAddModal(false); setShowPicker(true); } },
                { label: "AS Colour", bg: "#000", color: "#fff", action: () => { setShowAddModal(false); setShowASColour(true); } },
                { label: "LA Apparel", bg: "#fff", color: "#000", border: true, action: () => { setShowAddModal(false); setShowLAApparel(true); } },
                { label: "Cotton Collective", bg: "#2d6b4f", color: "#fff", action: () => { setShowAddModal(false); setShowCCPicker(true); } },
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

      {/* ══ Add item button + File drop zone ══ */}
      <div style={{ display: "flex", gap: 8 }}>
        {/* Add Item button */}
        <button onClick={() => { if (!psdProcessing) setShowAddModal(true); }}
          style={{ padding: "14px 24px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.card, cursor: "pointer", fontSize: 13, fontWeight: 700, color: T.text, flexShrink: 0, transition: "all 0.15s" }}
          onMouseEnter={e => { e.currentTarget.style.background = T.surface; }}
          onMouseLeave={e => { e.currentTarget.style.background = T.card; }}>
          + Add Item
        </button>

        {/* File drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accentDim; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = "transparent"; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = "transparent"; const files = Array.from(e.dataTransfer.files); const hasCreatableFiles = files.some(f => f.name.toLowerCase().endsWith(".psd") || /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name)); if (hasCreatableFiles) { processFileDrop(files); } else { setShowAddModal(true); } }}
          style={{ flex: 1, border: `2px dashed ${T.border}`, borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
        >
          {psdProcessing ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.accent }}>{psdProcessing.status}</div>
              <div style={{ fontSize: 10, color: T.muted }}>{psdProcessing.fileName}</div>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: T.faint }}>Drop PSD + mockup files to create items</span>
        )}
        </div>
      </div>

      {/* Grand total */}
      {safeItems.length > 0 && (
        <div style={{ fontSize: 12, fontWeight: 600, color: T.accent, fontFamily: mono, padding: "2px 0" }}>
          {grandTotal.toLocaleString()} units · {safeItems.length} item{safeItems.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* ══ Item list ══ */}
      {safeItems.map((item, idx) => {
        // If sidebar has a selected item, only render that one
        if (selectedItemId && item.id !== selectedItemId) return null;
        const isExpanded = selectedItemId ? true : expandedId === item.id;
        const hasBlank = !!item.blank_vendor;
        const fileCount = 0; // Will be populated by ItemArtSection internally

        return (
          <div key={item.id} id={`item-${item.id}`}
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
              <span style={{ width: 22, height: 22, borderRadius: 5, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>
                {String.fromCharCode(65 + idx)}
              </span>
              <input value={item.name || ""} onChange={e => { e.stopPropagation(); onUpdateItem(item.id, { name: e.target.value }); }}
                onClick={e => e.stopPropagation()} onFocus={e => e.target.select()}
                placeholder="Item name"
                style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: T.text, padding: "2px 4px", borderRadius: 4, cursor: "text" }}
                onMouseEnter={e => { e.target.style.background = T.surface; }} onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.background = "transparent"; }}
                onBlur={e => { e.target.style.background = "transparent"; }} />
              {hasBlank && <span style={{ fontSize: 11, color: T.muted, flexShrink: 0, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.blank_vendor}{(item.color || item.blank_sku) ? ` · ${item.color || item.blank_sku}` : ""}</span>}
              {!hasBlank && item.garment_type !== "accessory" && <span style={{ fontSize: 11, color: T.amber, flexShrink: 0 }}>No blank</span>}
              <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, flexShrink: 0, minWidth: 50, textAlign: "right", color: item.totalQty > 0 ? T.text : T.faint }}>{item.totalQty > 0 ? item.totalQty : "—"}</span>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {fileSummary[item.id]?.printReady && <span style={{ fontSize: 8, fontWeight: 600, padding: "2px 7px", borderRadius: 99, background: T.greenDim, color: T.green }}>Print-ready</span>}
                {fileSummary[item.id]?.hasProof && <span style={{ fontSize: 8, fontWeight: 600, padding: "2px 7px", borderRadius: 99, background: T.purpleDim, color: T.purple }}>Proof</span>}
                {fileSummary[item.id]?.fileCount > 0 && <span style={{ fontSize: 8, fontWeight: 600, padding: "2px 7px", borderRadius: 99, background: T.accentDim, color: T.accent }}>{fileSummary[item.id].fileCount} files</span>}
              </div>
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
                setShowAddModal={setShowAddModal} onItemsChanged={onItemsChanged}
                onUpdateItem={(id, updates) => { updateLocal(workingItems.map(it => it.id === id ? {...it, ...updates} : it)); onUpdateItem(id, updates); }}
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
    <div style={{ padding: "24px", position: "relative" }}>
      {/* Row 1: Thumbnail + Info */}
      <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
        {/* Thumbnail — bigger */}
        {mockupThumb ? (
          <a href={mockupFile.drive_link} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
            <img src={mockupThumb} alt="" style={{ width: 160, height: 160, objectFit: "cover", borderRadius: 10, border: `1px solid ${T.border}` }} onError={e => { e.target.style.display = "none"; }} />
          </a>
        ) : (
          <div style={{ width: 160, height: 160, borderRadius: 10, border: `2px dashed ${T.border}`, background: T.surface, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 11, color: T.faint }}>No mockup</span>
          </div>
        )}

        {/* Info stack */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Blank — clickable to change */}
          <div onClick={e => { e.stopPropagation(); setAssignBlankTo(item.id); setShowAddModal(true); }}
            style={{ cursor: "pointer", padding: "12px 16px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, transition: "border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
            {hasBlank ? (
              <>
                <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{item.blank_vendor}</span>
                {(item.color || item.blank_sku) && <span style={{ fontSize: 14, color: T.muted }}>{item.color || item.blank_sku}</span>}
                <select value={item.garment_type || ""} onClick={e => e.stopPropagation()}
                  onChange={e => { e.stopPropagation(); onUpdateItem(item.id, { garment_type: e.target.value || null }); }}
                  style={{ fontSize: 10, padding: "3px 8px", borderRadius: 99, background: T.card, color: T.muted, border: `1px solid ${T.border}`, cursor: "pointer", outline: "none", appearance: "none", WebkitAppearance: "none", paddingRight: 18, backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23a0a0ad' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}>
                  <option value="">type</option>
                  {["tee","longsleeve","hoodie","crewneck","jacket","pants","shorts","hat","beanie","tote","patch","poster","sticker","custom","socks","bandana","banner","flag","pin","koozie","lighter","towel","water_bottle","samples","accessory"].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <span style={{ fontSize: 10, color: T.faint, marginLeft: "auto" }}>click to change</span>
              </>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 700, color: T.accent }}>Assign Blank →</span>
            )}
          </div>

          {/* Sizes & Quantities — labels on top, bigger inputs */}
          {item.sizes.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                {item.sizes.map((sz, ci) => {
                  const localVal = getLocalQty(item.id, sz);
                  const displayVal = localVal !== null ? localVal : (item.qtys[sz] || 0);
                  return (
                    <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: T.faint, fontFamily: mono }}>{sz}</span>
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
                        style={{ ...ic, width: 48, height: 36, textAlign: "center", fontSize: 14, fontWeight: 600, padding: "4px" }}
                      />
                  </div>
                );
              })}
              <span style={{ width: 1, height: 28, background: T.border, margin: "0 6px" }} />
              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: 20, fontWeight: 800, fontFamily: mono }}>{item.totalQty}</span>
                <div style={{ fontSize: 9, color: T.muted }}>units</div>
              </div>
              <button onClick={() => { setDistRow(idx); setDistTotal(""); }} style={{ fontSize: 10, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 10px", cursor: "pointer", marginLeft: 4 }}>Dist</button>
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
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Locations</span>
              {item.psdLocations.map((loc, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 2, padding: "3px 8px", borderRadius: 4, background: T.surface, fontSize: 10, border: `1px solid ${T.border}44` }}>
                  <span style={{ fontWeight: 600, color: T.text }}>{loc.placement}</span>
                  <span style={{ color: T.muted, fontFamily: mono }}>{loc.colorCount}c</span>
                </span>
              ))}
              {item.psdHasTag && <span style={{ padding: "3px 8px", borderRadius: 4, background: T.amberDim, fontSize: 10, fontWeight: 600, color: T.amber }}>Tag</span>}
            </div>
          )}
        </div>{/* end info stack */}
      </div>{/* end row 1 */}

      {/* Row 2: Files */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", flexShrink: 0 }}>Files</span>
          {uploading && uploadProgress && (
            <span style={{ fontSize: 10, color: T.accent }}>Uploading {uploadProgress.done + 1}/{uploadProgress.total}: {uploadProgress.current}</span>
          )}
          {nonMockupFiles.length > 0 && nonMockupFiles.map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", borderRadius: 4 }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surface}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0, color: STAGE_COLORS[f.stage] || T.muted }}>{STAGE_LABELS[f.stage] || f.stage}</span>
                  <a href={f.drive_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: T.text, textDecoration: "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</a>
                  <span style={{ fontSize: 9, color: T.faint, flexShrink: 0 }}>{new Date(f.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <button onClick={() => deleteFile(f)} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 10, flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>×</button>
                </div>
          ))}
          <div
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderColor = T.accent; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderColor = T.border; handleFileDrop(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            style={{ border: `2px dashed ${T.border}`, borderRadius: 8, padding: "10px 20px", cursor: "pointer", transition: "border-color 0.15s", flexShrink: 0 }}
          >
            <span style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>+ Add files</span>
          </div>
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={e => { handleFileDrop(e.target.files); e.target.value = ""; }} />
      </div>
      {/* Delete — bottom right corner */}
      <button onClick={e => { e.stopPropagation(); if (window.confirm(`Remove "${item.name}"?`)) removeItem(item.id); }}
        style={{ position: "absolute", bottom: 14, right: 16, fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer" }}
        onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>
        Delete item
      </button>
    </div>
  );
}
