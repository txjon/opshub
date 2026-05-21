"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { logJobActivity } from "@/components/JobActivityPanel";
import { DriveThumb } from "@/components/DriveThumb";
import { parsePsd } from "./ProcessingTab";
import MoveItemDialog from "@/components/MoveItemDialog";
import { DriveFileLink } from "@/components/DriveFileLink";
import { useIsMobile } from "@/lib/useIsMobile";
import { MobileBlankPicker } from "./MobileBlankPicker";
// ItemArtSection from ArtTab is no longer rendered — removed after workflow merge
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
 */
export function ProductBuilder({ project, items, contacts, onItemsChanged, onRegisterSave, onSaveStatus, onSaved, onUpdateItem, selectedItemId }) {
  const isMobile = useIsMobile();
  // Mobile uses an iOS-style list → push-to-detail pattern since there's
  // no sidebar on mobile. mobileSelectedId mirrors desktop's
  // selectedItemId prop but is owned by this component. When set, the
  // detail view of that item fills the screen with a back chevron at
  // the top. When null, the compact list view shows all items.
  const [mobileSelectedId, setMobileSelectedId] = useState(null);
  // Single id that drives "which item is the work surface". Desktop
  // takes it from the sidebar (prop), mobile from local state.
  const activeItemId = isMobile ? mobileSelectedId : selectedItemId;
  // ═══════════════════════════════════════════════════════════════
  // BUY SHEET SAVE INFRASTRUCTURE — copied verbatim from BuySheetTab
  // ═══════════════════════════════════════════════════════════════
  const costingLocked = !!project?.type_meta?.costing_locked;
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

  // Sort-order sync — when the parent's items prop reorders (e.g.
  // user dragged a row in the sidebar), reshuffle localItems to
  // match without dropping any in-flight edits. Function updater
  // is used so this reads the LATEST localItems even when the
  // effect closure was captured during a previous render — without
  // it, rapid back-to-back drags would compute against a stale
  // localItems and the second drag's reorder would never persist.
  useEffect(() => {
    setLocalItems(prev => {
      if (prev === null) return prev;
      const propIds = (items || []).map(it => it.id);
      const localIds = prev.map(it => it.id);
      if (propIds.length !== localIds.length) return prev;
      const sameSet = propIds.every(id => localIds.includes(id));
      if (!sameSet) return prev;
      const sameOrder = propIds.every((id, i) => id === localIds[i]);
      if (sameOrder) return prev;
      const byId = Object.fromEntries(prev.map(it => [it.id, it]));
      const reordered = propIds.map(id => byId[id]);
      // Bump savedSnapshot too so auto-save doesn't immediately fire
      // and try to re-persist what the sidebar already saved.
      setSavedSnapshot(JSON.stringify(reordered));
      return reordered;
    });
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
  }, []);

  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    const handler = (e) => { if (isDirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => { window.removeEventListener("beforeunload", handler); if (onSaveRef.current) onSaveRef.current(); };
  }, []);

  // Save function — diffs against DB (guarded against concurrent execution)
  const saveInFlight = useRef(false);
  const doSave = async () => {
    if (saveInFlight.current) return; // Skip if already saving
    saveInFlight.current = true;
    // Flush any pending qty inputs before saving (user may not have blurred)
    const pending = localQtysRef.current;
    let current = workingItems;
    if (pending && Object.keys(pending).length > 0) {
      current = (current || []).map(it => {
        let newQtys = { ...(it.qtys || {}) };
        let modified = false;
        (it.sizes || []).forEach(sz => {
          const key = it.id + "_" + sz;
          if (pending[key] !== undefined) { newQtys[sz] = parseInt(pending[key]) || 0; modified = true; }
        });
        return modified ? { ...it, qtys: newQtys, totalQty: Object.values(newQtys).reduce((a, v) => a + v, 0) } : it;
      });
      localQtysRef.current = {};
      setLocalQtys({});
      setLocalItems(current);
    }
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
        const nameChanged = item.name !== prev?.name;
        if (nameChanged) dbUpdates.name = item.name;
        if (item.garment_type !== prev?.garment_type) dbUpdates.garment_type = item.garment_type || null;
        if (item.cost_per_unit !== prev?.cost_per_unit) dbUpdates.cost_per_unit = item.cost_per_unit || null;
        if (JSON.stringify(item.blankCosts) !== JSON.stringify(prev?.blankCosts)) dbUpdates.blank_costs = item.blankCosts || null;
        if (item.blank_vendor) dbUpdates.blank_vendor = item.blank_vendor;
        if (item.blank_sku) dbUpdates.blank_sku = item.blank_sku;
        if (item.is_fleece !== prev?.is_fleece) dbUpdates.is_fleece = !!item.is_fleece;
        dbUpdates.sort_order = current.indexOf(item);
        await supabase.from("items").update(dbUpdates).eq("id", item.id);
        // If the item's name changed and it already has a Drive folder,
        // rename it in place — otherwise the next upload would create a
        // sibling folder under the new name and split print files /
        // proofs across two locations.
        if (nameChanged && typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id)) {
          fetch("/api/drive/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity: "item", id: item.id, name: item.name }),
          }).catch(() => { /* non-fatal */ });
        }
        if (JSON.stringify(item.qtys) !== JSON.stringify(prev?.qtys) || JSON.stringify(item.sizes) !== JSON.stringify(prev?.sizes)) {
          // Prune stale sizes — when a one-size item gets reassigned to
          // per-size (or vice versa), the old rows would otherwise hang
          // around in buy_sheet_lines and double-count into the item
          // total. Delete rows whose size no longer appears on the item,
          // then upsert the current set. We use targeted deletes (not
          // "delete all + reinsert") so ship / receive counters on
          // already-tracked sizes aren't wiped.
          const currentSizes = new Set(Object.keys(item.qtys || {}));
          const { data: existing } = await supabase.from("buy_sheet_lines").select("size").eq("item_id", item.id);
          const staleSizes = (existing || []).map(r => r.size).filter(s => !currentSizes.has(s));
          if (staleSizes.length > 0) {
            await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id).in("size", staleSizes);
          }
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
    } finally {
      saveInFlight.current = false;
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
  const addItem = (item) => { if (costingLocked) return; updateLocal([...(workingItems || []), item]); };
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [expandedId, setExpandedId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const BULK_SIZES = ["XS","S","M","L","XL","2XL","3XL","4XL","5XL"];
  const bulkEmptyRow = () => ({ name: "", vendor: "", style: "", color: "", type: "tee", xs:0,s:0,m:0,l:0,xl:0,"2xl":0,"3xl":0,"4xl":0,"5xl":0 });
  const [bulkRows, setBulkRows] = useState([bulkEmptyRow(), bulkEmptyRow(), bulkEmptyRow(), bulkEmptyRow(), bulkEmptyRow()]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const bulkGridRef = useRef(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showASColour, setShowASColour] = useState(false);
  const [showLAApparel, setShowLAApparel] = useState(false);
  const [showOtherPicker, setShowOtherPicker] = useState(false);
  const [showCCPicker, setShowCCPicker] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showAddType, setShowAddType] = useState(null);
  const [assignBlankTo, setAssignBlankTo] = useState(null);
  const [moveItemTarget, setMoveItemTarget] = useState(null); // { id, name } — opens MoveItemDialog
  const [copyItemTarget, setCopyItemTarget] = useState(null); // { id, name } — opens MoveItemDialog in copy mode
  const [favorites, setFavorites] = useState([]);
  // Mobile picker — one search-driven sheet that replaces the desktop
  // source-selection + per-supplier catalog modals on mobile. MVP
  // scope: S&S + favorites. Tapping + Add item or "click to change"
  // on a blank opens this instead of the desktop flow.
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);
  const [fileSummary, setFileSummary] = useState({}); // { itemId: { printReady: bool, fileCount: number, hasProof: bool } }
  const [mockupMap, setMockupMap] = useState({}); // { itemId: drive_file_id } — preloaded so thumbnail renders instantly on switch
  const [psdProcessing, setPsdProcessing] = useState(null);
  const [distRow, setDistRow] = useState(null);
  const [distTotal, setDistTotal] = useState("");
  // EditSizesModal — opens from the size grid's "Edit sizes" button.
  // Lets the user add / remove sizes and set qtys without going back
  // through the full blank picker (supplier → brand → style → color →
  // sizes). Holds the item id; null = closed.
  const [editSizesItemId, setEditSizesItemId] = useState(null);
  // Accessories
  const [accType, setAccType] = useState("");
  const [accName, setAccName] = useState("");
  const [accQty, setAccQty] = useState("");
  const [accCatalog, setAccCatalog] = useState([]);
  // Mirrors NON_GARMENT in lib/pricing.ts / lib/lifecycle.ts —
  // every non-apparel garment_type the codebase recognizes, with
  // friendly display labels. Patch + Pin get common variants
  // expanded since those are the most-typed sub-types.
  const SEED_ACC_TYPES = [
    "Balloons",
    "Bandana",
    "Banner",
    "Custom",
    "Custom Bag",
    "Flag",
    "Keychain",
    "Koozie",
    "Lighter",
    "Napkins",
    "Patch",
    "Patch - Embroidered",
    "Patch - Leather",
    "Patch - PVC",
    "Patch - Woven",
    "Pens",
    "Pillow",
    "Pin",
    "Pin - Enamel",
    "Pin - Lapel",
    "Poster",
    "Rug",
    "Samples",
    "Socks",
    "Stencils",
    "Sticker",
    "Tote Bag",
    "Towel",
    "Water Bottle",
    "Woven Labels",
  ];
  const [accTypes, setAccTypes] = useState(SEED_ACC_TYPES);

  useEffect(() => {
    createClient().from("favorites").select("*").order("style_name").then(({ data }) => setFavorites(data || []));
    createClient().from("items").select("name, blank_vendor").eq("garment_type", "accessory").then(({ data }) => {
      setAccCatalog([...new Set((data || []).map(d => d.name).filter(Boolean))].sort());
      setAccTypes([...new Set([...SEED_ACC_TYPES, ...(data || []).map(d => d.blank_vendor).filter(Boolean)])].sort());
    });
  }, []);

  // Load file summary for collapsed pills
  const [fileSummaryKey, setFileSummaryKey] = useState(0);
  const refreshFileSummary = useCallback(() => setFileSummaryKey(k => k + 1), []);
  useEffect(() => {
    const ids = (items || []).map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
    if (ids.length === 0) return;
    createClient().from("item_files").select("item_id, stage, drive_file_id, file_name").in("item_id", ids).is("superseded_at", null).then(({ data }) => {
      const summary = {};
      const mockups = {};
      const filenameFallback = {};
      for (const f of (data || [])) {
        if (!summary[f.item_id]) summary[f.item_id] = { printReady: false, fileCount: 0, hasProof: false, hasMockup: false };
        summary[f.item_id].fileCount++;
        if (f.stage === "print_ready") summary[f.item_id].printReady = true;
        if (f.stage === "proof") summary[f.item_id].hasProof = true;
        if (f.stage === "mockup") {
          summary[f.item_id].hasMockup = true;
          if (!mockups[f.item_id]) mockups[f.item_id] = f.drive_file_id;
        } else if (!filenameFallback[f.item_id] && (f.file_name || "").toLowerCase().includes("mockup") && /\.(png|jpg|jpeg)$/i.test(f.file_name || "")) {
          filenameFallback[f.item_id] = f.drive_file_id;
        }
      }
      // Prefer stage=mockup, fall back to filename heuristic (matches ExpandedItemBody logic)
      for (const itemId of Object.keys(filenameFallback)) {
        if (!mockups[itemId]) mockups[itemId] = filenameFallback[itemId];
      }
      setFileSummary(summary);
      setMockupMap(mockups);
    });
  }, [items, fileSummaryKey]);

  const isFav = (supplier, styleCode) => favorites.some(f => f.supplier === supplier && f.style_code === styleCode);
  const toggleFav = async (supplier, styleCode, styleName, sourceCategory) => {
    const supabase = createClient();
    if (isFav(supplier, styleCode)) {
      await supabase.from("favorites").delete().eq("supplier", supplier).eq("style_code", styleCode);
      setFavorites(prev => prev.filter(f => !(f.supplier === supplier && f.style_code === styleCode)));
    } else {
      const { data } = await supabase.from("favorites").insert({ supplier, style_code: styleCode, style_name: styleName, category: sourceCategory || "Other" }).select().single();
      if (data) setFavorites(prev => [...prev, data].sort((a, b) => a.style_name.localeCompare(b.style_name)));
    }
  };

  const addAccessory = () => {
    if (!accName.trim()) return;
    addItem({
      id: Date.now() + Math.random(), name: accName.trim(), blank_vendor: accType.trim(), blank_sku: "",
      garment_type: detectGarmentType("", accName.trim() + " " + accType.trim()),
      sizes: ["OS"], qtys: { OS: parseInt(accQty) || 0 }, curve: DEFAULT_CURVE,
      totalQty: parseInt(accQty) || 0, blankCosts: {}, cost_per_unit: 0,
    });
    setAccType(""); setAccName(""); setAccQty("");
  };

  // Drag reorder — saves sort_order to DB immediately (not debounced)
  const onDragEnd = async (result) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const newItems = [...(workingItems || [])];
    const [moved] = newItems.splice(result.source.index, 1);
    newItems.splice(result.destination.index, 0, moved);
    updateLocal(newItems);
    setSavedSnapshot(prev => {
      const parsed = JSON.parse(prev);
      const idOrder = newItems.map(it => it.id);
      parsed.sort((a, b) => idOrder.indexOf(a.id) - idOrder.indexOf(b.id));
      return JSON.stringify(parsed);
    });
    // Update parent items immediately so sidebar + other consumers see new order
    if (onSaved) onSaved(newItems);
    // Persist sort_order to DB
    const supabase = createClient();
    for (let i = 0; i < newItems.length; i++) {
      const id = newItems[i].id;
      if (typeof id === "string" && id.length > 20) {
        await supabase.from("items").update({ sort_order: i }).eq("id", id);
      }
    }
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
  const projectTitle = project?.title || project?.job_number || "Untitled Project";

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
    setPsdProcessing({ status: `Processing ${groupList.length} item${groupList.length !== 1 ? "s" : ""}...`, fileName: "", done: 0, total: groupList.length });

    const supabase = createClient();
    let created = 0;

    for (let g = 0; g < groupList.length; g++) {
      const group = groupList[g];
      const itemName = group.displayName;
      setPsdProcessing({ status: `${g + 1}/${groupList.length} — ${itemName}`, fileName: group.psd?.name || group.mockup?.name || "", done: g, total: groupList.length });

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
          const fileCount = (group.psd ? 1 : 0) + (group.mockup ? 1 : 0);
          let filesDone = 0;
          if (group.psd) {
            const driveFile = await uploadToDrive({ blob: group.psd, fileName: group.psd.name, mimeType: "application/octet-stream", itemId: newItem.id, clientName, projectTitle, itemName,
              onProgress: (pct) => setPsdProcessing(prev => ({ ...prev, uploadPct: Math.round((filesDone / fileCount) * 100 + pct / fileCount) }))
            });
            await registerFileInDb({ ...driveFile, itemId: newItem.id, stage: "print_ready", notes: JSON.stringify({ psd_locations: locations, psd_has_tag: hasTag }) });
            filesDone++;
          }

          // Upload mockup image
          if (group.mockup) {
            const driveFile = await uploadToDrive({ blob: group.mockup, fileName: group.mockup.name, mimeType: group.mockup.type || "image/png", itemId: newItem.id, clientName, projectTitle, itemName,
              onProgress: (pct) => setPsdProcessing(prev => ({ ...prev, uploadPct: Math.round((filesDone / fileCount) * 100 + pct / fileCount) }))
            });
            await registerFileInDb({ ...driveFile, itemId: newItem.id, stage: "mockup" });
            filesDone++;
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
    // Force-save any pending edits before reloading, so sizes/qtys aren't lost
    if (isDirtyRef.current) await onSaveRef.current?.();
    // Clear local state so fresh items prop takes over
    setLocalItems(null);
    setSavedSnapshot("");
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

      {costingLocked && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, letterSpacing: "0.06em", textTransform: "uppercase" }}>Costing locked</span>
          <span style={{ fontSize: 11, color: T.muted }}>Unlock pricing in the Costing tab to edit items, quantities, or blanks</span>
        </div>
      )}

      {/* ══ Picker modals (same as BuySheetTab) ══ */}
      {(showPicker || showASColour || showLAApparel || showFavorites || showOtherPicker || showCCPicker || showAddType === "accessory") && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => { setShowPicker(false); setShowASColour(false); setShowLAApparel(false); setShowFavorites(false); setShowOtherPicker(false); setShowCCPicker(false); setShowAddType(null); setAssignBlankTo(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "95vw", maxWidth: showAddType === "accessory" ? 700 : 1000, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => { setShowPicker(false); setShowASColour(false); setShowLAApparel(false); setShowFavorites(false); setShowOtherPicker(false); setShowCCPicker(false); setShowAddType(null); if (!assignBlankTo) setShowAddModal(true); setAssignBlankTo(null); }}
                style={{ background: T.text, border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: "pointer", fontFamily: font }}>
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
            {showAddType === "accessory" && (() => {
              const assignItem = assignBlankTo ? (workingItems||[]).find(it => it.id === assignBlankTo) : null;
              if (assignItem && !accName) setAccName(assignItem.name || "");
              const q = accType.trim().toLowerCase();
              const filteredTypes = q ? accTypes.filter(t => t.toLowerCase().includes(q)) : accTypes;
              const canAdd = !!(assignItem || accName.trim());
              const doAdd = () => {
                if (!canAdd) return;
                if (assignItem) {
                  const detectedType = detectGarmentType("", (assignItem.name || "") + " " + (accType || ""));
                  const qty = parseInt(accQty) || 0;
                  const updates = { garment_type: detectedType, blank_vendor: accType || "Custom" };
                  assignBlank({ ...updates, blank_sku: "", style: accType || "", color: "", sizes: qty > 0 ? ["OSFA"] : assignItem.sizes || [], qtys: qty > 0 ? { OSFA: qty } : assignItem.qtys || {}, totalQty: qty || assignItem.totalQty || 0, blankCosts: {} });
                } else {
                  addAccessory();
                }
                setShowAddType(null);
              };
              const onEnter = e => { if (e.key === "Enter") doAdd(); };
              return (
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8, display: "flex", flexDirection: "column", maxHeight: "80vh" }}>
                  {/* Header row — same pattern as other pickers, plus Name + Qty inline */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font, whiteSpace: "nowrap" }}>{assignItem ? "Assign as Accessory" : "Custom Accessory"}</span>
                    <input value={accType} onChange={e => setAccType(e.target.value)} onKeyDown={onEnter} placeholder="Type or search..." autoFocus
                      style={{ flex: 1, fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none" }} />
                    {!assignItem && <>
                      <input value={accName} onChange={e => setAccName(e.target.value)} onKeyDown={onEnter} list="pb-acc-names" placeholder="Item name"
                        style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 150 }} />
                      <datalist id="pb-acc-names">{accCatalog.map(n => <option key={n} value={n} />)}</datalist>
                    </>}
                    <input value={accQty} onChange={e => setAccQty(e.target.value)} onKeyDown={onEnter} type="text" inputMode="numeric" placeholder="Qty"
                      style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 80, textAlign: "center" }} />
                    <button onClick={doAdd} disabled={!canAdd}
                      style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#fff" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default", whiteSpace: "nowrap" }}>
                      {assignItem ? "Assign →" : "Add →"}
                    </button>
                    <button onClick={() => { setShowAddType(null); setAssignBlankTo(null); }}
                      style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
                  </div>

                  {/* Type list — single column, search-filtered */}
                  <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <div style={{ padding: "5px 11px", background: T.surface, borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: font }}>Type</div>
                    <div style={{ flex: 1, overflowY: "auto", maxHeight: 360 }}>
                      {filteredTypes.length === 0 ? (
                        <div style={{ padding: "12px 11px", fontSize: 11, color: T.faint, fontStyle: "italic", fontFamily: font }}>
                          No matches{q ? ` — "${accType}" will be saved as a new type.` : "."}
                        </div>
                      ) : filteredTypes.map(t => {
                        const active = accType.trim().toLowerCase() === t.toLowerCase();
                        return (
                          <div key={t} onClick={() => setAccType(t)}
                            style={{ padding: "8px 11px", cursor: "pointer", fontSize: 12, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#fff" : T.text, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
                            onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
                            onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                            {t}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
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


      {/* ══ Bulk Create Modal ══ */}
      {showBulkCreate && (()=>{
        const updateRow = (idx, field, val) => setBulkRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));

        const doSave = async () => {
          const validRows = bulkRows.filter(r => r.name.trim());
          if (validRows.length === 0) return;
          setBulkSaving(true);
          const supabase = createClient();
          for (let ri = 0; ri < validRows.length; ri++) {
            const r = validRows[ri];
            const sizes = BULK_SIZES.filter(sz => (r[sz.toLowerCase()] || 0) > 0);
            const qtys = {};
            sizes.forEach(sz => { qtys[sz] = r[sz.toLowerCase()] || 0; });
            const totalQty = Object.values(qtys).reduce((a, v) => a + v, 0);
            const sortOrder = (items || []).length + ri;
            const garmentType = detectGarmentType("", r.name + " " + r.vendor + " " + r.type) || r.type || "tee";
            await supabase.from("items").insert({
              job_id: project.id, name: r.name.trim(), blank_vendor: r.vendor.trim() || null, blank_sku: r.color.trim() || null,
              status: "tbd", artwork_status: "not_started", sort_order: sortOrder,
              garment_type: garmentType,
            }).select("id").single().then(async ({ data: newItem }) => {
              if (newItem && sizes.length > 0) {
                await supabase.from("buy_sheet_lines").insert(
                  sizes.map(sz => ({ item_id: newItem.id, size: sz, qty_ordered: qtys[sz] || 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }))
                );
              }
            });
          }
          setBulkSaving(false);
          setShowBulkCreate(false);
          if (onItemsChanged) onItemsChanged();
        };

        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setShowBulkCreate(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, width: "95vw", maxWidth: 1200, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Bulk Create Items</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Tab between cells. Enter on last row adds a new row.</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setBulkRows(prev => [...prev, bulkEmptyRow()])}
                  style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Row</button>
                <button onClick={doSave} disabled={bulkSaving || !bulkRows.some(r => r.name.trim())}
                  style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: (bulkSaving || !bulkRows.some(r => r.name.trim())) ? 0.5 : 1 }}>
                  {bulkSaving ? "Creating..." : `Create ${bulkRows.filter(r => r.name.trim()).length} Items`}
                </button>
                <button onClick={() => setShowBulkCreate(false)}
                  style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer" }}>×</button>
              </div>
            </div>

            {/* Grid */}
            <div ref={bulkGridRef} style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: T.surface, position: "sticky", top: 0, zIndex: 1 }}>
                    <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}`, width: 30 }}>#</th>
                    <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}`, minWidth: 180 }}>Item Name</th>
                    <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}`, minWidth: 120 }}>Vendor / Style</th>
                    <th style={{ padding: "8px 6px", textAlign: "left", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}`, minWidth: 100 }}>Color</th>
                    {BULK_SIZES.map(sz => (
                      <th key={sz} style={{ padding: "8px 4px", textAlign: "center", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", borderBottom: `1px solid ${T.border}`, width: 50 }}>{sz}</th>
                    ))}
                    <th style={{ padding: "8px 6px", textAlign: "right", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", borderBottom: `1px solid ${T.border}`, width: 50 }}>Total</th>
                    <th style={{ width: 30, borderBottom: `1px solid ${T.border}` }} />
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.map((row, ri) => {
                    const total = BULK_SIZES.reduce((a, sz) => a + (row[sz.toLowerCase()] || 0), 0);
                    return (
                      <tr key={ri} style={{ borderBottom: `1px solid ${T.border}22` }}>
                        <td style={{ padding: "4px 6px", color: T.faint, fontSize: 10, fontFamily: mono }}>{ri + 1}</td>
                        <td style={{ padding: "2px 2px" }}>
                          <input value={row.name} onChange={e => updateRow(ri, "name", e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && ri === bulkRows.length - 1) setBulkRows(prev => [...prev, bulkEmptyRow()]); }}
                            placeholder="Item name" autoFocus={ri === 0}
                            style={{ width: "100%", padding: "6px 8px", border: "none", outline: "none", background: "transparent", color: T.text, fontSize: 12, fontWeight: 600 }} />
                        </td>
                        <td style={{ padding: "2px 2px" }}>
                          <input value={row.vendor} onChange={e => updateRow(ri, "vendor", e.target.value)}
                            placeholder="S&S 1717, AS 5026..."
                            style={{ width: "100%", padding: "6px 8px", border: "none", outline: "none", background: "transparent", color: T.text, fontSize: 12 }} />
                        </td>
                        <td style={{ padding: "2px 2px" }}>
                          <input value={row.color} onChange={e => updateRow(ri, "color", e.target.value)}
                            placeholder="Black, Navy..."
                            style={{ width: "100%", padding: "6px 8px", border: "none", outline: "none", background: "transparent", color: T.text, fontSize: 12 }} />
                        </td>
                        {BULK_SIZES.map(sz => (
                          <td key={sz} style={{ padding: "2px 1px" }}>
                            <input type="text" inputMode="numeric" value={row[sz.toLowerCase()] || ""}
                              onChange={e => updateRow(ri, sz.toLowerCase(), parseInt(e.target.value) || 0)}
                              onFocus={e => e.target.select()}
                              placeholder="0"
                              style={{ width: "100%", padding: "6px 2px", border: "none", outline: "none", background: "transparent", color: T.text, fontSize: 12, fontFamily: mono, textAlign: "center" }} />
                          </td>
                        ))}
                        <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: mono, fontWeight: 700, color: total > 0 ? T.text : T.faint, fontSize: 12 }}>{total || "—"}</td>
                        <td style={{ padding: "2px" }}>
                          {bulkRows.length > 1 && <button onClick={() => setBulkRows(prev => prev.filter((_, i) => i !== ri))}
                            style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11 }}
                            onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>×</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ══ Above-the-list region ══
          Three rendering modes:
          - Desktop, no item selected: home state (paired CTAs + drop
            zone + project-at-a-glance summary). The items list is
            owned by the sidebar in this layout, so the right side is
            an action surface, not a duplicate list.
          - Mobile, no item selected: compact toolbar (Add + drop)
            above the full list — mobile has no sidebar, the list IS
            the navigator.
          - Item selected (either viewport): nothing here. The
            selected item's edit card fills the surface below. */}
      {!activeItemId && !costingLocked && !isMobile && (() => {
        const itemsNeedingBlanks = safeItems.filter(it => !it.blank_vendor).length;
        const itemsNeedingArt = safeItems.filter(it => !fileSummary[it.id]?.printReady).length;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Action row — primary Add Item, Bulk Create stub for
                when it ships, both tight and refined. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button onClick={() => { if (!psdProcessing) setShowAddModal(true); }}
                style={{
                  background: T.text, color: "#fff", border: "none",
                  padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: font, textAlign: "left",
                  display: "flex", alignItems: "center", gap: 10,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#333"; }}
                onMouseLeave={e => { e.currentTarget.style.background = T.text; }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span>
                <span style={{ flex: 1 }}>Add an item</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", fontWeight: 500 }}>Pick a blank</span>
              </button>
              <button disabled title="Bulk create — coming soon"
                style={{
                  background: T.surface, color: T.muted, border: `1px solid ${T.border}`,
                  padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                  cursor: "default", fontFamily: font, textAlign: "left",
                  display: "flex", alignItems: "center", gap: 10, opacity: 0.85,
                }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>⊞</span>
                <span style={{ flex: 1 }}>Bulk create</span>
                <span style={{ fontSize: 10, color: T.faint, fontWeight: 500 }}>Soon</span>
              </button>
            </div>

            {/* Drop zone — bigger when it's the focus of the surface */}
            <div
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accentDim; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surface; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surface; const files = Array.from(e.dataTransfer.files); const hasCreatableFiles = files.some(f => f.name.toLowerCase().endsWith(".psd") || /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name)); if (hasCreatableFiles) { processFileDrop(files); } else { setShowAddModal(true); } }}
              style={{ border: `2px dashed ${T.border}`, borderRadius: 12, padding: "28px 20px", textAlign: "center", background: T.surface, transition: "all 0.15s" }}
            >
              {psdProcessing ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.accent, marginBottom: 8 }}>{psdProcessing.status}</div>
                  {psdProcessing.total > 0 && (() => {
                    const overallPct = Math.round((psdProcessing.done / psdProcessing.total) * 100 + (psdProcessing.uploadPct || 0) / psdProcessing.total);
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 320, margin: "0 auto" }}>
                        <div style={{ flex: 1, height: 8, background: T.card, borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${overallPct}%`, background: T.accent, borderRadius: 4, transition: "width 0.15s" }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>{overallPct}%</span>
                      </div>
                    );
                  })()}
                  {psdProcessing.fileName && <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>{psdProcessing.fileName}</div>}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 22, marginBottom: 6, color: T.faint }}>↓</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>
                    Drop PSDs or mockup files
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    We'll auto-create items and detect print locations from PSD layers.
                  </div>
                </>
              )}
            </div>

            {/* Project at a glance — quick stats so the right side
                isn't empty when no item is open. */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 18px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Project at a glance
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Items</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: T.text, fontFamily: mono, marginTop: 2 }}>{safeItems.length}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Units</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: T.text, fontFamily: mono, marginTop: 2 }}>{grandTotal.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Need blank</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: itemsNeedingBlanks > 0 ? T.amber : T.muted, fontFamily: mono, marginTop: 2 }}>{itemsNeedingBlanks}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Need art</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: itemsNeedingArt > 0 ? T.amber : T.muted, fontFamily: mono, marginTop: 2 }}>{itemsNeedingArt}</div>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: T.faint, textAlign: "center", marginTop: 4 }}>
              Pick an item from the left to configure it.
            </div>
          </div>
        );
      })()}

      {/* Mobile toolbar — Add + compact drop zone, only when no item
          is open and editing isn't locked. */}
      {!activeItemId && !costingLocked && isMobile && (
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <button onClick={() => { if (!psdProcessing) setMobilePickerOpen(true); }}
          style={{
            padding: "10px 16px", borderRadius: 8,
            border: "none", background: T.text, color: "#fff",
            cursor: "pointer", fontSize: 13, fontWeight: 700,
            flexShrink: 0, fontFamily: font, display: "inline-flex", alignItems: "center", gap: 6,
            minHeight: 44,
          }}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>＋</span>
          Add item
        </button>

        <div
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accentDim; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = "transparent"; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = "transparent"; const files = Array.from(e.dataTransfer.files); const hasCreatableFiles = files.some(f => f.name.toLowerCase().endsWith(".psd") || /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name)); if (hasCreatableFiles) { processFileDrop(files); } else { setShowAddModal(true); } }}
          style={{ flex: 1, border: `2px dashed ${T.border}`, borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", minHeight: 44 }}
        >
          {psdProcessing ? (
            <div style={{ width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.accent, marginBottom: 4 }}>{psdProcessing.status}</div>
              {psdProcessing.total > 0 && (()=>{
                const overallPct = Math.round((psdProcessing.done / psdProcessing.total) * 100 + (psdProcessing.uploadPct || 0) / psdProcessing.total);
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: T.surface, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${overallPct}%`, background: T.accent, borderRadius: 3, transition: "width 0.15s" }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>{overallPct}%</span>
                  </div>
                );
              })()}
              {psdProcessing.fileName && <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{psdProcessing.fileName}</div>}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: T.faint }}>Drop PSD + mockup files</span>
          )}
        </div>
      </div>
      )}

      {/* Mobile list view — iOS-style compact rows, tap to push to
          detail. Lives entirely on the mobile path; desktop's list
          stays in the sidebar. Detail view (mobile + activeItemId)
          falls through to the shared item-card rendering below with a
          sticky back chevron prepended. */}
      {isMobile && !activeItemId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {safeItems.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, padding: "0 2px" }}>
              {grandTotal.toLocaleString()} units · {safeItems.length} item{safeItems.length !== 1 ? "s" : ""}
            </div>
          )}
          {safeItems.map((item, idx) => {
            const okB = !!item.blank_vendor;
            const okA = !!fileSummary[item.id]?.printReady;
            const okQ = (item.totalQty || 0) > 0;
            return (
              <button key={item.id}
                onClick={() => setMobileSelectedId(item.id)}
                style={{
                  width: "100%", textAlign: "left",
                  padding: "14px 14px", display: "flex", alignItems: "center", gap: 12,
                  background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
                  cursor: "pointer", fontFamily: font, color: T.text, minHeight: 64,
                }}>
                <span style={{
                  width: 38, height: 38, borderRadius: 8, background: T.accentDim,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 15, fontWeight: 800, color: T.accent, fontFamily: mono, flexShrink: 0,
                }}>{String.fromCharCode(65 + idx)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name || "Untitled"}
                  </div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ") || "No blank"}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontFamily: mono, color: T.text }}>
                      {item.totalQty > 0 ? `${item.totalQty} units` : "—"}
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: okB ? T.green : T.border }} />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: okA ? T.green : T.border }} />
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: okQ ? T.green : T.border }} />
                    </span>
                  </div>
                </div>
                <span style={{ fontSize: 22, color: T.faint, flexShrink: 0 }}>›</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Mobile detail header — sticky back chevron when an item is
          focused on mobile. The detail card itself renders in the
          shared block below. */}
      {isMobile && activeItemId && (
        <div style={{
          position: "sticky", top: 0, zIndex: 5,
          background: "rgba(244,244,246,0.92)", backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          padding: "10px 0", marginLeft: -12, marginRight: -12, paddingLeft: 12, paddingRight: 12,
          borderBottom: `1px solid ${T.border}`,
        }}>
          <button onClick={() => setMobileSelectedId(null)}
            style={{
              background: "transparent", border: "none", color: T.accent,
              fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: font,
              padding: "8px 4px", minHeight: 44, display: "flex", alignItems: "center", gap: 4,
            }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span> Items
          </button>
        </div>
      )}

      {/* Grand total + Item list — only when an item is selected
          (work-surface mode showing that one item) OR on desktop with
          a selection. The mobile list view above handles the
          no-selection mobile case. */}
      {activeItemId && safeItems.length > 0 && !isMobile && (
        <div style={{ fontSize: 12, fontWeight: 600, color: T.accent, fontFamily: mono, padding: "2px 0" }}>
          {grandTotal.toLocaleString()} units · {safeItems.length} item{safeItems.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* ══ Item list (work-surface view: full edit card) ══ */}
      {activeItemId && (
      mounted ? (
      <DragDropContext onDragEnd={result => {
        if (!result.destination || result.source.index === result.destination.index) return;
        // Map filtered indices back to full array indices when sidebar is filtering
        if (activeItemId) return; // Can't reorder when viewing single item
        onDragEnd(result);
      }}>
        <Droppable droppableId="product-builder-items">
          {(droppableProvided) => (
            <div ref={droppableProvided.innerRef} {...droppableProvided.droppableProps}>
      {safeItems.map((item, idx) => {
        if (activeItemId && item.id !== activeItemId) return null;
        const isExpanded = activeItemId ? true : expandedId === item.id;
        const hasBlank = !!item.blank_vendor;

        return (
          <Draggable key={String(item.id)} draggableId={String(item.id)} index={idx} isDragDisabled={isExpanded || costingLocked}>
            {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            id={`item-${item.id}`}
            style={{
              ...provided.draggableProps.style,
              background: snapshot.isDragging ? T.surface : T.card,
              border: `1px solid ${snapshot.isDragging ? T.accent : isExpanded ? T.accent + "44" : T.border}`,
              borderRadius: isExpanded ? 12 : 10, overflow: "hidden",
              boxShadow: snapshot.isDragging ? "0 8px 24px rgba(0,0,0,0.15)" : "none",
              marginBottom: 6,
            }}
          >
            {/* ── Header (always visible) ──
                Mobile detail view treats this row as a UINavigationBar-
                style title: bigger letter, larger name, redundant blank
                info hidden (it appears in the body below). Desktop keeps
                the tight inline layout. */}
            <div
              {...(!isExpanded ? provided.dragHandleProps : {})}
              onClick={() => { if (!snapshot.isDragging) setExpandedId(isExpanded ? null : item.id); }}
              style={{ padding: isMobile && isExpanded ? "14px 16px" : "10px 16px", display: "flex", alignItems: "center", gap: isMobile && isExpanded ? 12 : 10, cursor: isExpanded ? "pointer" : "grab", borderBottom: isExpanded ? `1px solid ${T.border}44` : "none" }}
            >
              <span style={isMobile && isExpanded
                ? { width: 36, height: 36, borderRadius: 8, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: T.accent, fontFamily: mono, flexShrink: 0 }
                : { width: 22, height: 22, borderRadius: 5, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>
                {String.fromCharCode(65 + idx)}
              </span>
              <style dangerouslySetInnerHTML={{ __html: `
                .pb-name-wrap:hover .pb-rename-btn { opacity: 1 !important; }
                .pb-rename-btn:hover { color: ${T.accent} !important; background: ${T.accentDim} !important; }
              ` }} />
              <div
                className="pb-name-wrap"
                style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}
              >
                <span style={isMobile && isExpanded
                  ? { fontSize: 17, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }
                  : { fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name || "Untitled"}</span>
                {/* Hover-only rename button. Clicking it swaps the text
                    for an input (visibility toggled via a sibling data
                    attribute) without bubbling the click to the row —
                    so the row doesn't expand/collapse on rename. */}
                <button
                  type="button"
                  className="pb-rename-btn"
                  title="Rename item"
                  onClick={e => {
                    e.stopPropagation();
                    const wrap = e.currentTarget.parentElement;
                    if (!wrap) return;
                    const span = wrap.querySelector("span");
                    const input = wrap.querySelector("input");
                    if (span) span.style.display = "none";
                    if (input) { input.style.display = "block"; input.focus(); input.select(); }
                  }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: T.faint, padding: "2px 4px", fontSize: 12, lineHeight: 1, borderRadius: 4, opacity: 0, transition: "opacity 0.12s" }}
                >
                  ✎
                </button>
                <input
                  value={item.name || ""}
                  onChange={e => {
                    e.stopPropagation();
                    const next = e.target.value;
                    // Route through updateLocal so ProductBuilder's autosave
                    // picks up the name change. Calling onUpdateItem alone
                    // only mutates parent page state, which resets
                    // savedSnapshot and skips the DB write.
                    updateLocal((workingItems || []).map(it => it.id === item.id ? { ...it, name: next } : it));
                    if (onUpdateItem) onUpdateItem(item.id, { name: next });
                  }}
                  onClick={e => e.stopPropagation()}
                  onFocus={e => e.target.select()}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter" || e.key === "Escape") e.target.blur();
                  }}
                  onBlur={e => {
                    e.target.style.display = "none";
                    const wrap = e.target.parentElement;
                    const span = wrap?.querySelector("span");
                    if (span) span.style.display = "";
                  }}
                  style={{ display: "none", flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: T.text, background: T.surface, border: `1px solid ${T.accent}`, outline: "none", padding: "2px 6px", borderRadius: 4 }}
                />
              </div>
              {/* Blank summary + qty + status indicators — hidden on
                  mobile detail view to avoid duplicating what the body
                  already shows large. Desktop keeps the row of inline
                  metadata. */}
              {!(isMobile && isExpanded) && (
                <>
                  {hasBlank && <span style={{ fontSize: 11, color: T.muted, flexShrink: 0, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.blank_vendor}{(item.color || item.blank_sku) ? ` · ${item.color || item.blank_sku}` : ""}</span>}
                  {!hasBlank && item.garment_type !== "accessory" && <span style={{ fontSize: 11, color: T.amber, flexShrink: 0 }}>No blank</span>}
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, flexShrink: 0, minWidth: 50, textAlign: "right", color: item.totalQty > 0 ? T.text : T.faint }}>{item.totalQty > 0 ? item.totalQty : "—"}</span>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {fileSummary[item.id]?.printReady && <span style={{ fontSize: 9, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase" }}>Print-ready</span>}
                    {fileSummary[item.id]?.hasProof && <span style={{ fontSize: 9, fontWeight: 700, color: T.purple, letterSpacing: "0.06em", textTransform: "uppercase" }}>Proof</span>}
                    {fileSummary[item.id]?.fileCount > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>{fileSummary[item.id].fileCount} files</span>}
                  </div>
                </>
              )}
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
                setEditSizesItemId={setEditSizesItemId}
                setShowAddModal={setShowAddModal} setMobilePickerOpen={setMobilePickerOpen} onItemsChanged={onItemsChanged}
                requestMove={(it) => setMoveItemTarget({ id: it.id, name: it.name || "" })}
                requestCopy={(it) => setCopyItemTarget({ id: it.id, name: it.name || "" })}
                onUpdateItem={(id, updates) => { updateLocal(workingItems.map(it => it.id === id ? {...it, ...updates} : it)); onUpdateItem(id, updates); }}
                onFilesChanged={refreshFileSummary}
                preloadedMockupId={mockupMap[item.id] || null}
                ic={ic} costingLocked={costingLocked}
              />
            )}
          </div>
            )}
          </Draggable>
        );
      })}
      {droppableProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      ) : (
        /* Pre-mount: render items without drag (avoids SSR hydration issues) */
        <div>{safeItems.map((item, idx) => {
          if (activeItemId && item.id !== activeItemId) return null;
          return <div key={item.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 16px", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>{item.name || "Untitled"}</div>;
        })}</div>
      )
      )}

      {/* Empty state — only when the list is showing (mobile or item
          selected). Desktop home-state lives above and already shows a
          friendly empty surface when there are no items. */}
      {(isMobile || activeItemId) && isEmpty && !psdProcessing && (
        <div style={{ padding: "20px 0", textAlign: "center" }}>
          <div style={{ color: T.faint, fontSize: 13, marginBottom: 16 }}>No items yet — drop a PSD or add from catalog.</div>
        </div>
      )}

      {/* Mobile blank picker — search-first MVP. Opens on mobile when
          + Add item is tapped or when an item's blank is being
          re-assigned ("click to change"). Bypasses the desktop
          source-selection + supplier-catalog modals entirely. */}
      <MobileBlankPicker
        open={mobilePickerOpen}
        onClose={() => { setMobilePickerOpen(false); setAssignBlankTo(null); }}
        favorites={favorites}
        toggleFav={toggleFav}
        isFav={isFav}
        assignMode={!!assignBlankTo}
        defaultItemName={assignBlankTo ? ((workingItems || []).find(it => it.id === assignBlankTo)?.name || "") : ""}
        existingQtys={assignBlankTo ? ((workingItems || []).find(it => it.id === assignBlankTo)?.qtys || null) : null}
        onAdd={item => {
          if (assignBlankTo) {
            assignBlank(item);
          } else {
            addItem(item);
          }
        }}
      />

      {moveItemTarget && (
        <MoveItemDialog
          itemId={moveItemTarget.id}
          itemName={moveItemTarget.name}
          open={true}
          onClose={() => setMoveItemTarget(null)}
          onMoved={(result) => {
            // Remove the item from local state — server already updated
            // items.job_id + costing_data on both jobs. Parent will
            // re-query on refresh.
            updateLocal(workingItems.filter(it => it.id !== moveItemTarget.id));
            try { onItemsChanged?.(); } catch {}
            try { onSaved?.(); } catch {}
            // Navigate to the destination so the user sees the item land.
            if (result?.to?.id && typeof window !== "undefined") {
              window.location.href = `/jobs/${result.to.id}`;
            }
          }}
        />
      )}

      {copyItemTarget && (
        <MoveItemDialog
          mode="copy"
          itemId={copyItemTarget.id}
          itemName={copyItemTarget.name}
          open={true}
          onClose={() => setCopyItemTarget(null)}
          onMoved={(result) => {
            // Source item stays put — nothing to remove from local state.
            // Just navigate to the destination so user sees the copy.
            if (result?.to?.id && typeof window !== "undefined") {
              window.location.href = `/jobs/${result.to.id}`;
            }
          }}
        />
      )}

      {editSizesItemId && (() => {
        const target = (workingItems || []).find(it => it.id === editSizesItemId);
        if (!target) return null;
        return (
          <EditSizesModal
            item={target}
            onClose={() => setEditSizesItemId(null)}
            onSave={(nextSizes, nextQtys) => {
              const totalQty = Object.values(nextQtys).reduce((a, v) => a + (Number(v) || 0), 0);
              updateLocal((workingItems || []).map(it =>
                it.id === editSizesItemId
                  ? { ...it, sizes: nextSizes, qtys: nextQtys, totalQty }
                  : it
              ));
              setEditSizesItemId(null);
            }}
          />
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EditSizesModal — add/remove sizes + set qtys on an item without
// going back through the blank picker. Toggle row picks which sizes
// are active; qty grid for active sizes; Distribute helper fills by
// the item's curve (or default S/M/L/XL ladder).
// ═══════════════════════════════════════════════════════════════
function EditSizesModal({ item, onClose, onSave }) {
  // Working copy of sizes + qtys — committed via onSave on save.
  const [sizes, setSizes] = useState(() => [...(item.sizes || [])]);
  const [qtys, setQtys] = useState(() => ({ ...(item.qtys || {}) }));
  const [distTotal, setDistTotal] = useState("");

  // Esc closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Adult + youth sizes from the canonical SIZE_ORDER. OS / OSFA are
  // one-size variants — clicked individually they swap the item to
  // single-size mode (any other adult/youth size toggling them off).
  const ADULT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const YOUTH_SIZES = ["YXS", "YS", "YM", "YL", "YXL"];
  const ONE_SIZE = ["OSFA", "OS"];

  const toggleSize = (sz) => {
    const isOneSize = ONE_SIZE.includes(sz);
    const next = new Set(sizes);
    if (next.has(sz)) {
      next.delete(sz);
      const q = { ...qtys }; delete q[sz];
      setQtys(q);
    } else {
      // Toggling a one-size variant clears the sized list and vice
      // versa — an item is either "OSFA · qty" or a size run.
      if (isOneSize) {
        setQtys({ [sz]: qtys[sz] || 0 });
        setSizes([sz]);
        return;
      } else {
        for (const o of ONE_SIZE) next.delete(o);
      }
      next.add(sz);
    }
    setSizes(sortSizesLocal([...next]));
  };

  const setQty = (sz, val) => {
    const n = parseInt(val, 10);
    setQtys({ ...qtys, [sz]: Number.isFinite(n) && n >= 0 ? n : 0 });
  };

  const doDist = () => {
    const total = parseInt(distTotal, 10);
    if (!Number.isFinite(total) || total <= 0 || sizes.length === 0) return;
    const next = distribute(total, sizes, item.curve || DEFAULT_CURVE);
    setQtys(next);
    setDistTotal("");
  };

  const total = Object.values(qtys).reduce((a, v) => a + (Number(v) || 0), 0);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 32px)", fontFamily: font }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.card, borderRadius: 12, width: "min(640px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", border: `1px solid ${T.border}` }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Edit sizes & qtys</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name || "Item"}</div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Size toggle row — adult sizes, youth sizes, one-size. */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Sizes</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {ADULT_SIZES.map(sz => {
                const on = sizes.includes(sz);
                return (
                  <button key={sz} onClick={() => toggleSize(sz)}
                    style={{ minWidth: 42, padding: "6px 10px", fontSize: 12, fontFamily: mono, fontWeight: 700,
                      background: on ? T.accent : T.card, color: on ? "#fff" : T.muted,
                      border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer" }}>
                    {sz}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {YOUTH_SIZES.map(sz => {
                const on = sizes.includes(sz);
                return (
                  <button key={sz} onClick={() => toggleSize(sz)}
                    style={{ minWidth: 42, padding: "6px 10px", fontSize: 12, fontFamily: mono, fontWeight: 700,
                      background: on ? T.accent : T.card, color: on ? "#fff" : T.muted,
                      border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer" }}>
                    {sz}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ONE_SIZE.map(sz => {
                const on = sizes.includes(sz);
                return (
                  <button key={sz} onClick={() => toggleSize(sz)}
                    style={{ minWidth: 64, padding: "6px 10px", fontSize: 12, fontFamily: mono, fontWeight: 700,
                      background: on ? T.accent : T.card, color: on ? "#fff" : T.muted,
                      border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer" }}
                    title="One-size — replaces any sized run">
                    {sz}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Qty grid for active sizes */}
          {sizes.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Quantities</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {sizes.map(sz => (
                  <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: T.faint, fontFamily: mono }}>{sz}</span>
                    <input type="text" inputMode="numeric" value={qtys[sz] ?? 0}
                      onChange={e => setQty(sz, e.target.value)}
                      onFocus={e => e.target.select()}
                      style={{ width: 56, height: 36, textAlign: "center", fontSize: 14, fontWeight: 600,
                        border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text,
                        fontFamily: font, outline: "none" }} />
                  </div>
                ))}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, marginLeft: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: T.faint }}>TOTAL</span>
                  <span style={{ fontSize: 20, fontWeight: 800, fontFamily: mono, color: T.text }}>{total}</span>
                </div>
              </div>
            </div>
          )}

          {/* Distribute helper — fills sizes by curve */}
          {sizes.length > 0 && !ONE_SIZE.includes(sizes[0]) && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Distribute total</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="text" inputMode="numeric" value={distTotal}
                  onChange={e => setDistTotal(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doDist()}
                  placeholder="Total qty"
                  style={{ width: 110, height: 36, padding: "0 10px", fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontFamily: font, outline: "none" }} />
                <button onClick={doDist}
                  style={{ fontSize: 12, color: "#fff", background: T.accent, border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontFamily: font }}>
                  Fill
                </button>
                <span style={{ fontSize: 11, color: T.faint }}>Spreads total across active sizes using the item's curve.</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "8px 18px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
            Cancel
          </button>
          <button onClick={() => onSave(sizes, qtys)}
            style={{ padding: "8px 22px", background: T.accent, color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Local size sorter — mirrors lib/theme sortSizes but available
// inside this file without importing.
function sortSizesLocal(arr) {
  const order = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
  return [...arr].sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// ═══════════════════════════════════════════════════════════════
// Expanded item body — manages its own file state per item
// ═══════════════════════════════════════════════════════════════
function ExpandedItemBody({ item, idx, clientName, projectTitle, contacts, project, hasBlank, getLocalQty, setLocalQty, commitQty, scheduleCommit, inputRefs, distRow, setDistRow, distTotal, setDistTotal, handleDist, removeItem, setAssignBlankTo, setEditSizesItemId, setShowAddModal, setMobilePickerOpen, onItemsChanged, onUpdateItem, onFilesChanged, preloadedMockupId, ic, costingLocked, requestMove, requestCopy }) {
  const isMobile = useIsMobile();
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
  const nonMockupFiles = files.filter(f => f !== mockupFile);
  // Prefer parent-preloaded mockup id so the thumbnail renders instantly on expand
  // before this component's own loadFiles() fetch resolves.
  const thumbDriveId = preloadedMockupId || mockupFile?.drive_file_id || null;

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
        const driveFile = await uploadToDrive({ blob: allFiles[i], fileName: allFiles[i].name, mimeType: allFiles[i].type || "application/octet-stream", itemId: item.id, clientName, projectTitle, itemName: item.name });
        await registerFileInDb({ ...driveFile, itemId: item.id, stage });
      } catch (err) { console.error("Upload error:", err); }
    }
    setUploading(false); setUploadProgress(null);
    loadFiles();
    if (onFilesChanged) onFilesChanged();
    logJobActivity(project.id, `${allFiles.length} file${allFiles.length > 1 ? "s" : ""} uploaded for ${item.name}`);
  }

  async function deleteFile(file) {
    if (!window.confirm(`Delete "${file.file_name}"?`)) return;
    await fetch("/api/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: file.id, driveFileId: file.drive_file_id }) });
    loadFiles();
    if (onFilesChanged) onFilesChanged();
  }

  // Mobile sizes the thumbnail to span the full panel width with a
  // soft 1:1 cap; desktop keeps the 160px fixed slot next to the info
  // column. The flex-direction also flips on mobile so blank/sizes
  // stack underneath the image rather than fighting for 50% width.
  const thumbSize = isMobile ? "min(78vw, 320px)" : 160;
  return (
    <div style={{ padding: isMobile ? "16px 14px" : "24px", position: "relative" }}>
      {/* Row 1: Thumbnail + Info — stacks vertically on mobile */}
      <div style={{ display: "flex", gap: isMobile ? 16 : 24, marginBottom: 20, flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "flex-start" }}>
        {/* Thumbnail — full-width centered block on mobile, fixed 160px on desktop. */}
        {thumbDriveId ? (
          <div style={{ flexShrink: 0, alignSelf: isMobile ? "center" : "auto" }}>
            <DriveThumb
              driveFileId={thumbDriveId}
              enlargeable
              title={`${item.name} — mockup`}
              driveLink={mockupFile?.drive_link || null}
              style={{ width: thumbSize, height: thumbSize, objectFit: "contain", borderRadius: 10, border: `1px solid ${T.border}`, background: T.surface, display: "block" }}
              fallback={
                <div style={{ width: thumbSize, height: thumbSize, borderRadius: 10, border: `1px solid ${T.border}`, background: T.surface, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 11, color: T.faint }}>No preview</span>
                </div>
              }
            />
          </div>
        ) : (
          <div style={{ width: thumbSize, height: thumbSize, borderRadius: 10, border: `2px dashed ${T.border}`, background: T.surface, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", alignSelf: isMobile ? "center" : "auto" }}>
            <span style={{ fontSize: 11, color: T.faint }}>No mockup</span>
          </div>
        )}

        {/* Info stack */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Blank — clickable to change. On mobile, the contents wrap
              so a long vendor/sku doesn't truncate; type selector
              drops to its own line, "click to change" hint is hidden
              (the whole row is already the affordance). */}
          <div onClick={e => { e.stopPropagation(); if (costingLocked) return; setAssignBlankTo(item.id); if (isMobile) { setMobilePickerOpen(true); } else { setShowAddModal(true); } }}
            style={{ cursor: costingLocked ? "default" : "pointer", padding: "12px 16px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, transition: "border-color 0.15s", flexWrap: isMobile ? "wrap" : "nowrap" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
            {hasBlank ? (
              <>
                <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: T.text, wordBreak: isMobile ? "break-word" : "normal" }}>{item.blank_vendor}</span>
                {(item.color || item.blank_sku) && <span style={{ fontSize: isMobile ? 13 : 14, color: T.muted }}>{item.color || item.blank_sku}</span>}
                <select value={item.garment_type || ""} onClick={e => e.stopPropagation()}
                  onChange={e => { e.stopPropagation(); onUpdateItem(item.id, { garment_type: e.target.value || null }); }}
                  style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: T.card, color: T.muted, border: `1px solid ${T.border}`, cursor: "pointer", outline: "none", appearance: "none", WebkitAppearance: "none", paddingRight: 18, backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23a0a0ad' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}>
                  <option value="">type</option>
                  {["bandana","banner","beanie","crewneck","custom","flag","hat","hoodie","jacket","koozie","lighter","longsleeve","pants","patch","pin","poster","samples","shorts","socks","sticker","tee","tote","towel","water_bottle"].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {/* Fleece flag — drives the decorator's "Fleece Upcharge"
                    per print location and switches packaging to the
                    Fleece variant. Lives here because fleece-ness is a
                    property of the garment, not the costing run. */}
                <button onClick={e => { e.stopPropagation(); if (costingLocked) return; onUpdateItem(item.id, { is_fleece: !item.is_fleece }); }}
                  title="Mark this blank as fleece (applies decorator fleece upcharge per print)"
                  style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 6, border: `1px solid ${item.is_fleece ? T.accent : T.border}`, background: item.is_fleece ? T.accent : T.card, color: item.is_fleece ? "#fff" : T.muted, cursor: costingLocked ? "default" : "pointer", letterSpacing: "0.04em", textTransform: "uppercase", opacity: costingLocked ? 0.5 : 1 }}>
                  {item.is_fleece ? "Fleece" : "Fleece?"}
                </button>
                {!isMobile && <span style={{ fontSize: 10, color: T.faint, marginLeft: "auto" }}>click to change</span>}
              </>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 700, color: T.accent }}>Assign Blank →</span>
            )}
          </div>

          {/* Simple qty for non-sized items (patches, stickers, etc.) */}
          {(item.sizes.length === 0 || (item.sizes.length === 1 && item.sizes[0] === "OSFA")) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Qty</span>
              <input type="text" inputMode="numeric" value={item.totalQty || ""} disabled={costingLocked}
                onChange={e => {
                  if (costingLocked) return;
                  const q = parseInt(e.target.value) || 0;
                  onUpdateItem(item.id, { totalQty: q, sizes: q > 0 ? ["OSFA"] : [], qtys: q > 0 ? { OSFA: q } : {} });
                }}
                onFocus={e => e.target.select()}
                placeholder="0"
                style={{ ...ic, width: 70, height: 36, textAlign: "center", fontSize: 16, fontWeight: 700, opacity: costingLocked ? 0.5 : 1 }} />
              <span style={{ fontSize: 12, color: T.muted }}>units</span>
            </div>
          )}

          {/* Sizes & Quantities — labels on top, bigger inputs. On
              mobile the row is horizontally scrollable so 5-10 sizes
              all stay reachable; the total + Dist/Edit buttons wrap
              below instead of fighting for the same line. */}
          {item.sizes.length > 0 && item.sizes[0] !== "OSFA" && (
            <div>
              <div style={{
                display: "flex", alignItems: "flex-end", gap: 8,
                overflowX: isMobile ? "auto" : "visible",
                WebkitOverflowScrolling: "touch",
                paddingBottom: isMobile ? 4 : 0,
                flexWrap: isMobile ? "nowrap" : "wrap",
              }}>
                {item.sizes.map((sz, ci) => {
                  const localVal = getLocalQty(item.id, sz);
                  const displayVal = localVal !== null ? localVal : (item.qtys[sz] || 0);
                  return (
                    <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: T.faint, fontFamily: mono }}>{sz}</span>
                      <input
                        ref={el => { inputRefs.current[`${idx}_${ci}`] = el; }}
                        type="text" inputMode="numeric" value={displayVal} disabled={costingLocked}
                        onChange={e => { if (costingLocked) return; setLocalQty(item.id, sz, e.target.value); scheduleCommit(idx, item.id, sz); }}
                        onFocus={e => e.target.select()}
                        onBlur={() => commitQty(idx, item.id, sz)}
                        onKeyDown={e => {
                          if (costingLocked) return;
                          if (e.key === "Enter" || e.key === "ArrowDown") { commitQty(idx, item.id, sz); const next = inputRefs.current[`${idx + 1}_${ci}`]; if (next) next.focus(); }
                          else if (e.key === "ArrowUp") { commitQty(idx, item.id, sz); const prev = inputRefs.current[`${idx - 1}_${ci}`]; if (prev) prev.focus(); }
                          else if (e.key === "Tab" || e.key === "ArrowRight") { if (!e.shiftKey) { e.preventDefault(); commitQty(idx, item.id, sz); const next = inputRefs.current[`${idx}_${ci + 1}`] || inputRefs.current[`${idx + 1}_0`]; if (next) next.focus(); } }
                          else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); commitQty(idx, item.id, sz); const prev = inputRefs.current[`${idx}_${ci - 1}`] || inputRefs.current[`${idx - 1}_${item.sizes.length - 1}`]; if (prev) prev.focus(); }
                        }}
                        style={{ ...ic, width: 48, height: 36, textAlign: "center", fontSize: 14, fontWeight: 600, padding: "4px", opacity: costingLocked ? 0.5 : 1 }}
                      />
                  </div>
                );
              })}
              {/* Total + Dist/Edit — desktop keeps these inline next
                  to the sizes (separator pip first). Mobile drops them
                  to a second row below so the sizes scroller can start
                  flush-left with all sizes reachable. */}
              {!isMobile && <>
                <span style={{ width: 1, height: 28, background: T.border, margin: "0 6px" }} />
                <div style={{ textAlign: "center" }}>
                  <span style={{ fontSize: 20, fontWeight: 800, fontFamily: mono }}>{item.totalQty}</span>
                  <div style={{ fontSize: 9, color: T.muted }}>units</div>
                </div>
                {!costingLocked && <button onClick={() => { setDistRow(idx); setDistTotal(""); }} style={{ fontSize: 10, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 10px", cursor: "pointer", marginLeft: 4 }}>Dist</button>}
                {!costingLocked && <button onClick={() => setEditSizesItemId(item.id)} style={{ fontSize: 10, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 10px", cursor: "pointer", marginLeft: 4 }}
                  title="Add or remove sizes without changing the blank">
                  Edit sizes
                </button>}
              </>}
            </div>
            {isMobile && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 18, fontWeight: 800, fontFamily: mono, color: T.text }}>{item.totalQty}</span>
                <span style={{ fontSize: 11, color: T.muted }}>units</span>
                <span style={{ flex: 1 }} />
                {!costingLocked && <button onClick={() => { setDistRow(idx); setDistTotal(""); }} style={{ fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontFamily: font, minHeight: 36 }}>Distribute</button>}
                {!costingLocked && <button onClick={() => setEditSizesItemId(item.id)} style={{ fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontFamily: font, minHeight: 36 }}
                  title="Add or remove sizes without changing the blank">
                  Edit sizes
                </button>}
              </div>
            )}
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
              <div style={{ flex: 1, height: 6, background: T.surface, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round((uploadProgress.done / uploadProgress.total) * 100)}%`, background: T.accent, borderRadius: 3, transition: "width 0.3s" }} />
              </div>
              <span style={{ fontSize: 10, color: T.accent, flexShrink: 0, fontFamily: mono, fontWeight: 600 }}>{Math.round((uploadProgress.done / uploadProgress.total) * 100)}%</span>
              <span style={{ fontSize: 10, color: T.muted, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{uploadProgress.current}</span>
            </div>
          )}
          {nonMockupFiles.length > 0 && nonMockupFiles.map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", borderRadius: 4 }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surface}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0, color: STAGE_COLORS[f.stage] || T.muted }}>{STAGE_LABELS[f.stage] || f.stage}</span>
                  <DriveFileLink driveFileId={f.drive_file_id} fileName={f.file_name} mimeType={f.mime_type}
                    style={{ fontSize: 11, color: T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{f.file_name}</DriveFileLink>
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
      {/* Move + Delete + Duplicate + Copy — absolute bottom-right on
          desktop. On mobile, drop the absolute positioning and let
          them flow as a wrapped row at the foot of the card so they
          don't crash into the files block. */}
      <div style={isMobile
        ? { display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "12px 0 4px", borderTop: `1px solid ${T.border}`, marginTop: 14 }
        : { position: "absolute", bottom: 14, right: 16, display: "flex", gap: 14, alignItems: "center" }}>
        {typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id) && (
          <button onClick={async e => {
              e.stopPropagation();
              if (!window.confirm(`Duplicate "${item.name || "(unnamed)"}" within this job?`)) return;
              try {
                const res = await fetch(`/api/items/${item.id}/duplicate`, { method: "POST" });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || "Duplicate failed");
                if (onItemsChanged) onItemsChanged();
              } catch (err) {
                alert(err.message || "Duplicate failed");
              }
            }}
            title="Make a copy of this item in this same job. Files are shared assets, blank assignment + decoration carry over, pipeline state resets."
            style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = T.accent} onMouseLeave={e => e.currentTarget.style.color = T.faint}>
            Duplicate
          </button>
        )}
        {typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id) && requestCopy && (
          <button onClick={e => { e.stopPropagation(); requestCopy(item); }}
            title="Copy this item into another job (same client). The original stays."
            style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = T.accent} onMouseLeave={e => e.currentTarget.style.color = T.faint}>
            Copy to another job
          </button>
        )}
        {typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id) && requestMove && (
          <button onClick={e => { e.stopPropagation(); requestMove(item); }}
            title="Move this item to another job for the same client"
            style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = T.accent} onMouseLeave={e => e.currentTarget.style.color = T.faint}>
            Move to another job
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); if (window.confirm(`Remove "${item.name}"?`)) removeItem(item.id); }}
          style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>
          Delete item
        </button>
      </div>
    </div>
  );
}
