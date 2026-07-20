"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { logJobActivity } from "@/components/JobActivityPanel";
import { DriveThumb } from "@/components/DriveThumb";
import SizeGridInput from "@/components/SizeGridInput";
import { parseSizeMatrix } from "@/lib/size-grid";
import { parsePsd } from "./ProcessingTab";
import MoveItemDialog from "@/components/MoveItemDialog";
import { DriveFileLink } from "@/components/DriveFileLink";
import { useIsMobile } from "@/lib/useIsMobile";
import { useClientBranding } from "@/lib/branding-client";
import { isCutSewOnly } from "@/lib/tenants";
import { isCostingLocked } from "@/lib/costing-lock";
import ArtRequestModal from "@/components/ArtRequestModal";
import { MobileBlankPicker } from "./MobileBlankPicker";
// ItemArtSection from ArtTab is no longer rendered — removed after workflow merge
import {
  detectGarmentType, handleSizeToggle, distribute, DEFAULT_CURVE, WAIST_INSEAM_CURVE,
  SSPicker, ASColourPicker, LAApparelPicker, FavoritesPicker, OtherPicker, CottonCollectivePicker,
} from "./BuySheetTab";

// Non-apparel garment types — no catalog blank, priced via custom-cost lines.
// Mirrors lib/pricing.ts / lib/lifecycle.ts. Used to suppress the "No blank"
// nag for cut-and-sew / accessory items (e.g. all DMD items, garment_type "custom").
const NON_GARMENT = ["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"];

// Fleece garment classes auto-flag is_fleece (drives the decorator's per-print
// fleece upcharge + fleece packaging in Costing). Applied at CREATE/ASSIGN as
// set-only — never clears a deliberate un-fleece; the garment-type dropdown
// handlers below own explicit set AND clear. (Jon, 2026-07-17 — HPD-2607-007
// hoodies silently missed the upcharge because only the dropdown auto-flagged.)
const FLEECE_GARMENTS = ["crewneck", "hoodie", "jacket"];
const fleeceFlag = (gt) => (gt && FLEECE_GARMENTS.includes(gt) ? { is_fleece: true } : {});

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
  // Effective lock = DERIVED from workflow (quote sent/approved) OR archived —
  // no manual "Lock In Pricing" flag anymore. See lib/costing-lock.ts.
  // Complete/cancelled jobs are historic records — the builder stays
  // viewable (nav unhidden in ProjectProgress) but force-locks so
  // history can't be edited. Same flag drives every gate below.
  const isArchivedJob = project?.phase === "complete" || project?.phase === "cancelled";
  const costingLocked = isCostingLocked(project);
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
    // Hard write-gate: archived jobs are read-only historic records.
    // Also covers the unmount/tab-switch force-save paths.
    if (isArchivedJob) return;
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
          size_subs: item.sizeSubs && Object.keys(item.sizeSubs).length > 0 ? item.sizeSubs : {},
          garment_type: item.garment_type || null,
          is_fleece: !!(item.is_fleece || fleeceFlag(item.garment_type).is_fleece),
          qb_item_type: item.qb_item_type || null,
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
        if (item.qb_item_type !== prev?.qb_item_type) dbUpdates.qb_item_type = item.qb_item_type || null;
        if (item.cost_per_unit !== prev?.cost_per_unit) dbUpdates.cost_per_unit = item.cost_per_unit || null;
        if (JSON.stringify(item.blankCosts) !== JSON.stringify(prev?.blankCosts)) dbUpdates.blank_costs = item.blankCosts || null;
        if (JSON.stringify(item.sizeSubs) !== JSON.stringify(prev?.sizeSubs)) dbUpdates.size_subs = item.sizeSubs || {};
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
      // Fire-and-forget: recompute costing_summary server-side so qty edits /
      // add-remove / blank swaps here can't leave dollar KPIs stale until the
      // next Costing-tab visit (Tier 2, the #1 KPI-trust hole).
      fetch(`/api/jobs/${project.id}/refresh-financials`, { method: "POST" }).catch(() => {});
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
      // Assigning a blank must NEVER delete quantities. The blank supplies
      // vendor / SKU / style / color / cost; sizes carry by exact label match.
      // When NOTHING matches but the item already has an order:
      //   - single-size blank → adopt its label and move the whole order onto it
      //     (fixes a one-size item going e.g. "One Size" → "Adjustable", which
      //      previously remapped to qty 0 and wiped the order)
      //   - multi-size blank → keep the item's own sizes + qtys, so a pre-order
      //     size breakdown can't be collapsed by a mismatched blank
      const blankSizes = blankData.sizes || [];
      const oldTotal = Object.values(it.qtys || {}).reduce((a, v) => a + (v || 0), 0);
      let sizes, qtys;
      // A blank only "carries" quantities when its qtys actually SUM to > 0. The
      // pickers seed a zero-filled qtys object ({S:0,M:0,…}) for the blank's sizes;
      // that must NOT be treated as authoritative or it overwrites the order with 0.
      const blankQtySum = blankData.qtys ? Object.values(blankData.qtys).reduce((a, v) => a + (v || 0), 0) : 0;
      if (blankQtySum > 0) {
        sizes = blankSizes; qtys = blankData.qtys;
      } else {
        const exact = Object.fromEntries(blankSizes.map(sz => [sz, it.qtys?.[sz] || 0]));
        const carried = Object.values(exact).reduce((a, v) => a + (v || 0), 0);
        if (carried > 0 || oldTotal === 0) {
          // Keep ordered sizes the blank DOESN'T carry (e.g. a 5001 maxes at 3XL but
          // the pre-order has 4XL) instead of dropping them — those units are real
          // orders. They stay on the card as substitution candidates (no blank cost
          // until a per-size substitute is set). This is the fix for silent size/unit
          // loss on assign; see size_subs.
          const uncovered = (it.sizes || []).filter(sz => !blankSizes.includes(sz) && (it.qtys?.[sz] || 0) > 0);
          sizes = [...blankSizes, ...uncovered];
          qtys = Object.fromEntries(sizes.map(sz => [sz, it.qtys?.[sz] || 0]));
        }
        else if (blankSizes.length === 1) { sizes = blankSizes; qtys = { [blankSizes[0]]: oldTotal }; }
        else { sizes = it.sizes || []; qtys = it.qtys || {}; }
      }
      // Normalize: qtys must hold EXACTLY the resolved sizes — strip any keys
      // left over from the old blank's size system (e.g. "Adjustable" lingering
      // after a swap to "OS"). Stray keys survive the save's buy_sheet_lines
      // prune (it keys on Object.keys(qtys)) and become orphan rows that
      // double-count and show a phantom size on the card. New sizes start at 0.
      qtys = Object.fromEntries(sizes.map(sz => [sz, qtys[sz] || 0]));
      const newTotal = Object.values(qtys).reduce((a, v) => a + (v || 0), 0);
      // A blank swap must re-derive cost_per_unit from the NEW blank's per-size
      // costs — otherwise the old blank's average lingers on the item row and
      // the Blanks tab keeps pricing off it (a $0/free blank would still show
      // the old cost). Same formula CostingTab uses on save (avg of the >0
      // per-size costs; all-zero/free → 0) so the two write paths agree.
      const newBlankCosts = blankData.blankCosts || {};
      const costVals = Object.values(newBlankCosts).map(Number).filter(v => v > 0);
      const newCostPerUnit = costVals.length
        ? Math.round(costVals.reduce((a, v) => a + v, 0) / costVals.length * 100) / 100
        : 0;
      return {
        ...it, blank_vendor: blankData.blank_vendor, blank_sku: blankData.blank_sku,
        style: blankData.style, color: blankData.color, sizes,
        qtys,
        blankCosts: newBlankCosts,
        cost_per_unit: newCostPerUnit,
        garment_type: blankData.garment_type || detectGarmentType("", (it.name || "") + " " + (blankData.blank_vendor || "")) || it.garment_type,
        ...fleeceFlag(blankData.garment_type || detectGarmentType("", (it.name || "") + " " + (blankData.blank_vendor || "")) || it.garment_type),
        totalQty: newTotal,
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
  // Bulk create = names only: a textarea of item names → N blank item cards
  // (blank / sizes / costing get filled in per card afterward). A modal.
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [bulkNames, setBulkNames] = useState("");
  // Bulk edit = the Quantities view: a page-swap (NOT a modal) that lays every
  // item out as a compact row for rapid qty entry, each with its own
  // blank-driven sizes. Reuses the detail card's qty commit + autosave path.
  const [qtyView, setQtyView] = useState(false);
  const [showArtReqModal, setShowArtReqModal] = useState(false);
  // Per-item draft for the Quantities view "total → curve" field, keyed by item id.
  const [qtyTotalDraft, setQtyTotalDraft] = useState({});
  const [showPicker, setShowPicker] = useState(false);
  const [showASColour, setShowASColour] = useState(false);
  const [showLAApparel, setShowLAApparel] = useState(false);
  const [showOtherPicker, setShowOtherPicker] = useState(false);
  const [showCCPicker, setShowCCPicker] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showAddType, setShowAddType] = useState(null);
  const [assignBlankTo, setAssignBlankTo] = useState(null);
  const [moveItemTarget, setMoveItemTarget] = useState(null); // { id, name } — opens MoveItemDialog
  // Cut-and-sew tenants (DMD): no blanks. The Add Item modal becomes a managed
  // item-type list (their QB categories) instead of blank-supplier pickers.
  const branding = useClientBranding();
  const cutSew = isCutSewOnly(branding.slug);
  const [itemTypes, setItemTypes] = useState([]);
  const [newItemType, setNewItemType] = useState("");
  const [savingType, setSavingType] = useState(false);
  useEffect(() => {
    if (!cutSew) return;
    // RLS narrows company_item_types to the active tenant.
    createClient().from("company_item_types").select("id, name, sort_order").order("sort_order").then(({ data }) => setItemTypes(data || []));
  }, [cutSew]);
  const [newItemName, setNewItemName] = useState("");
  const addItemOfType = (typeName) => {
    addItem({
      id: Date.now() + Math.random(), name: newItemName.trim(), blank_vendor: "", blank_sku: "",
      garment_type: "custom", qb_item_type: typeName,
      sizes: [], qtys: {}, curve: DEFAULT_CURVE, totalQty: 0, blankCosts: {}, cost_per_unit: 0,
    });
    setNewItemName("");
    setShowAddModal(false);
  };
  const addNewItemType = async () => {
    const name = newItemType.trim();
    if (!name || savingType) return;
    setSavingType(true);
    const { data } = await createClient().from("company_item_types")
      .insert({ name, sort_order: itemTypes.length }).select("id, name, sort_order").single();
    if (data) setItemTypes(prev => [...prev, data]);
    setNewItemType("");
    setSavingType(false);
  };
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
  // While an upload is in flight, warn on tab-close / refresh / back (the
  // blocking overlay stops in-app nav; this covers browser-level exits).
  useEffect(() => {
    if (!psdProcessing || psdProcessing.error) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [psdProcessing]);
  const [distRow, setDistRow] = useState(null);
  const [distTotal, setDistTotal] = useState("");
  // EditSizesModal — opens from the size grid's "Edit sizes" button.
  // Lets the user add / remove sizes and set qtys without going back
  // through the full blank picker (supplier → brand → style → color →
  // sizes). Holds the item id; null = closed.
  const [editSizesItemId, setEditSizesItemId] = useState(null);
  // Per-size blank substitution editor — { itemId, size } while open.
  const [subEditor, setSubEditor] = useState(null);
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
  // Quantities view: type a TOTAL for an item → auto-distribute across ITS OWN
  // sizes by the garment-appropriate curve (waist/inseam for bottoms, else the
  // standard curve). Reuses distribute(); writes via updateLocal so it autosaves
  // through the canonical path. Clears the item's pending per-size buffer so the
  // freshly distributed values render instead of stale keystrokes.
  const applyQtyCurve = (idx, item, totalStr) => {
    const total = parseInt(totalStr, 10);
    const sizes = item.sizes || [];
    if (!total || total <= 0 || sizes.length === 0) return;
    const curve = parseSizeMatrix(sizes, null) ? WAIST_INSEAM_CURVE : (item.curve || DEFAULT_CURVE);
    const dist = distribute(total, sizes, curve);
    updateLocal((workingItems || []).map((it, i) => i !== idx ? it : { ...it, qtys: dist, totalQty: Object.values(dist).reduce((a, v) => a + (v || 0), 0) }));
    setLocalQtys(prev => { const n = { ...prev }; sizes.forEach(sz => delete n[item.id + "_" + sz]); return n; });
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
    const failed = [];

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
      } catch (err) { console.error("File drop error:", err); failed.push(itemName); }
    }

    // Force-save any pending edits before reloading, so sizes/qtys aren't lost
    if (isDirtyRef.current) await onSaveRef.current?.();
    // Clear local state so fresh items prop takes over
    setLocalItems(null);
    setSavedSnapshot("");
    if (onItemsChanged) onItemsChanged();
    if (failed.length) {
      // Keep the overlay up with an error — a partial/aborted upload must NOT
      // look like success (the item + Drive folder are already created empty).
      setPsdProcessing({ error: `${failed.length} upload${failed.length !== 1 ? "s" : ""} didn't finish: ${failed.join(", ")}. Those items may have empty folders — delete and re-drop.`, status: "", fileName: "", done: 0, total: 0 });
    } else {
      setPsdProcessing(null);
    }
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

  // ══ Quantities view — bulk-edit qtys across every item ══
  // A page-swap (not a modal): each item is a compact row with its OWN
  // blank-driven sizes. Inputs reuse the detail card's commit/autosave
  // (getLocalQty/setLocalQty/commitQty), keyed by item INDEX so the arrow/Tab
  // nav walks the whole list. No new write path — same debounced save.
  if (qtyView) {
    return (
      <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Quantities</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Enter quantities, or type a total on the right to auto-fill by size curve. Arrow / Tab move between cells. Saves automatically.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: mono }}>{grandTotal.toLocaleString()}</div>
              <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>total units</div>
            </div>
            <button onClick={() => setQtyView(false)}
              style={{ background: T.text, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Done</button>
          </div>
        </div>

        {safeItems.length === 0 && <div style={{ padding: 30, textAlign: "center", color: T.faint, fontSize: 13 }}>No items yet.</div>}

        {safeItems.map((item, idx) => {
          const sizes = item.sizes || [];
          const hasBlank = !!item.blank_vendor;
          const spec = [item.blank_vendor, item.blank_sku, item.color].filter(Boolean).join(" · ");
          return (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 14, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ width: 210, flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name || "Untitled"}</div>
                <div style={{ fontSize: 11, color: hasBlank ? T.muted : T.amber, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hasBlank ? spec : "No blank yet"}</div>
              </div>
              {sizes.length === 0 ? (
                <div style={{ flex: 1, fontSize: 12, color: T.faint, fontStyle: "italic" }}>
                  {hasBlank ? "No size breakdown — set sizes on the item card" : "Assign a blank on the item card to set sizes"}
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  {sizes.map((sz, ci) => {
                    const lv = getLocalQty(item.id, sz);
                    const displayVal = lv !== null ? lv : (item.qtys?.[sz] || 0);
                    return (
                      <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, fontFamily: mono, color: T.faint }}>{sz}</span>
                        <input
                          ref={el => { inputRefs.current[`${idx}_${ci}`] = el; }}
                          type="text" inputMode="numeric" value={displayVal} disabled={costingLocked}
                          onChange={e => { if (costingLocked) return; setLocalQty(item.id, sz, e.target.value); scheduleCommit(idx, item.id, sz); }}
                          onFocus={e => e.target.select()}
                          onBlur={() => commitQty(idx, item.id, sz)}
                          onKeyDown={e => {
                            if (costingLocked) return;
                            if (e.key === "Enter" || e.key === "ArrowDown") { commitQty(idx, item.id, sz); const n = inputRefs.current[`${idx + 1}_${ci}`]; if (n) n.focus(); }
                            else if (e.key === "ArrowUp") { commitQty(idx, item.id, sz); const p = inputRefs.current[`${idx - 1}_${ci}`]; if (p) p.focus(); }
                            else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); commitQty(idx, item.id, sz); const n = inputRefs.current[`${idx}_${ci + 1}`] || inputRefs.current[`${idx + 1}_0`]; if (n) n.focus(); }
                            else if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); commitQty(idx, item.id, sz); const p = inputRefs.current[`${idx}_${ci - 1}`] || inputRefs.current[`${idx - 1}_0`]; if (p) p.focus(); }
                          }}
                          style={{ ...ic, width: 46, height: 34, textAlign: "center", fontSize: 14, fontWeight: 600, padding: "4px", opacity: costingLocked ? 0.5 : 1 }}
                        />
                      </div>
                    );
                  })}
                  <div style={{ marginLeft: "auto", textAlign: "right", minWidth: 72 }}>
                    <input
                      type="text" inputMode="numeric" disabled={costingLocked}
                      value={qtyTotalDraft[item.id] !== undefined ? qtyTotalDraft[item.id] : (item.totalQty || 0)}
                      onChange={e => { if (costingLocked) return; setQtyTotalDraft(p => ({ ...p, [item.id]: e.target.value })); }}
                      onFocus={e => e.target.select()}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyQtyCurve(idx, item, e.target.value); setQtyTotalDraft(p => { const n = { ...p }; delete n[item.id]; return n; }); } }}
                      onBlur={e => { if (qtyTotalDraft[item.id] !== undefined) { applyQtyCurve(idx, item, e.target.value); setQtyTotalDraft(p => { const n = { ...p }; delete n[item.id]; return n; }); } }}
                      title="Type a total → auto-fill across sizes by curve"
                      style={{ ...ic, width: 70, height: 32, textAlign: "right", fontSize: 15, fontWeight: 800, fontFamily: mono, padding: "2px 7px", opacity: costingLocked ? 0.5 : 1 }}
                    />
                    <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>total → curve</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Blocking upload overlay — covers the page so you can't navigate away
          mid-upload (the exact failure Jon hit). Autocloses when done; on
          failure it stays up with an error instead of looking like success. */}
      {psdProcessing && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(20,20,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "24px 26px", width: 440, maxWidth: "90vw", boxShadow: "0 12px 48px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: psdProcessing.error ? T.red : T.text }}>
              {psdProcessing.error ? "Upload didn’t finish" : "Uploading — don’t navigate away"}
            </div>
            {!psdProcessing.error && psdProcessing.status && <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>{psdProcessing.status}</div>}
            {!psdProcessing.error && psdProcessing.fileName && <div style={{ fontSize: 11, color: T.faint, marginTop: 2, fontFamily: mono, wordBreak: "break-all" }}>{psdProcessing.fileName}</div>}
            {!psdProcessing.error && psdProcessing.total > 0 && (() => {
              const pct = Math.min(100, Math.round((psdProcessing.done / psdProcessing.total) * 100 + (psdProcessing.uploadPct || 0) / psdProcessing.total));
              return (
                <div style={{ marginTop: 14 }}>
                  <div style={{ height: 8, background: T.surface, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: T.accent, borderRadius: 99, transition: "width 0.2s" }} />
                  </div>
                  <div style={{ fontSize: 11, color: T.faint, marginTop: 6, textAlign: "right", fontFamily: mono }}>{pct}%</div>
                </div>
              );
            })()}
            {psdProcessing.error && (
              <>
                <div style={{ fontSize: 12.5, color: T.text, background: T.redDim, borderRadius: 8, padding: "10px 12px", lineHeight: 1.45, marginTop: 10 }}>{psdProcessing.error}</div>
                <button onClick={() => setPsdProcessing(null)}
                  style={{ marginTop: 14, width: "100%", padding: "9px", borderRadius: 8, border: "none", background: T.text, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Dismiss</button>
              </>
            )}
          </div>
        </div>
      )}

      {costingLocked && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
          {isArchivedJob ? (
            <>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase" }}>Historic record</span>
              <span style={{ fontSize: 11, color: T.muted }}>This project is {project?.phase === "cancelled" ? "cancelled" : "complete"} — items are read-only</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, letterSpacing: "0.06em", textTransform: "uppercase" }}>Costing locked</span>
              <span style={{ fontSize: 11, color: T.muted }}>Unlock pricing in the Costing tab to edit items, quantities, or blanks</span>
            </>
          )}
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
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{(!cutSew && assignBlankTo) ? "Assign Blank" : "Add Item"}</div>
            {cutSew ? (
              // DMD-style: name the item + pick a managed type (QB category). No blanks.
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Item name</label>
                  <input value={newItemName} onChange={e => setNewItemName(e.target.value)} autoFocus
                    placeholder="e.g. Crocodile Ridgeline Pant"
                    style={{ width: "100%", padding: "10px 12px", border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box" }} />
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>Choose a type to add it</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                  {itemTypes.map(t => (
                    <button key={t.id} onClick={() => addItemOfType(t.name)}
                      style={{ width: "100%", textAlign: "left", padding: "12px 16px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {t.name}
                    </button>
                  ))}
                  {itemTypes.length === 0 && <div style={{ fontSize: 12, color: T.faint }}>No item types yet — add one below.</div>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
                  <input value={newItemType} onChange={e => setNewItemType(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addNewItemType(); }}
                    placeholder="New type (e.g. Hat)"
                    style={{ flex: 1, padding: "9px 12px", border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font }} />
                  <button onClick={addNewItemType} disabled={!newItemType.trim() || savingType}
                    style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: (!newItemType.trim() || savingType) ? "default" : "pointer", opacity: (!newItemType.trim() || savingType) ? 0.5 : 1 }}>
                    + Add
                  </button>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      )}


      {/* ══ Bulk Create modal — names only ══
          Fast entry: one item name per line (type or paste). Each becomes a
          blank item card; blank / sizes / costing are filled in per card after.
          New items route through the canonical debounced save (updateLocal →
          onSaveRef.doSave) — same path as "Add an item", no forked write. */}
      {showBulkCreate && (() => {
        const names = bulkNames.split("\n").map(n => n.trim()).filter(Boolean);
        const createNames = () => {
          if (names.length === 0) return;
          const base = workingItems || [];
          const newItems = names.map((nm, i) => {
            const gt = detectGarmentType("", nm) || "tee";
            return {
              id: Date.now() + Math.random() + i,
              name: nm, blank_vendor: "", blank_sku: "",
              garment_type: gt, ...fleeceFlag(gt),
              sizes: [], qtys: {}, totalQty: 0,
              curve: DEFAULT_CURVE, blankCosts: {}, cost_per_unit: 0,
            };
          });
          updateLocal([...base, ...newItems]);
          setBulkNames("");
          setShowBulkCreate(false);
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
            onClick={() => setShowBulkCreate(false)}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, width: "95vw", maxWidth: 520, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Bulk Create Items</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>One item name per line. Type or paste a list — each becomes a card.</div>
                </div>
                <button onClick={() => setShowBulkCreate(false)}
                  style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer" }}>×</button>
              </div>
              <div style={{ padding: 20 }}>
                <textarea value={bulkNames} onChange={e => setBulkNames(e.target.value)} autoFocus
                  placeholder={"Kill Em Vintage Tee\nTour Hoodie\nStaff Crewneck"}
                  rows={10}
                  style={{ width: "100%", resize: "vertical", padding: "12px 14px", border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, fontSize: 14, fontFamily: font, lineHeight: 1.6, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: T.muted }}>{names.length} item{names.length === 1 ? "" : "s"}</span>
                <button onClick={createNames} disabled={names.length === 0}
                  style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 700, cursor: names.length === 0 ? "default" : "pointer", opacity: names.length === 0 ? 0.5 : 1, fontFamily: font }}>
                  Create {names.length || ""} {names.length === 1 ? "item" : "items"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Art pricing request — outside-costing designer quote (email-back v1),
          scoped to selected files. Available pre-costing. */}
      <ArtRequestModal open={showArtReqModal} onClose={() => setShowArtReqModal(false)} project={project} />

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
              <button onClick={() => (safeItems.length > 0 ? setQtyView(true) : setShowBulkCreate(true))}
                title={safeItems.length > 0 ? "Edit quantities across every item" : "Create items from a list of names"}
                style={{
                  background: T.surface, color: T.text, border: `1px solid ${T.border}`,
                  padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: font, textAlign: "left",
                  display: "flex", alignItems: "center", gap: 10,
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.card; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surface; }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>⊞</span>
                <span style={{ flex: 1 }}>{safeItems.length > 0 ? "Bulk edit" : "Bulk create"}</span>
                <span style={{ fontSize: 10, color: T.faint, fontWeight: 500 }}>{safeItems.length > 0 ? "Quantities" : "Names"}</span>
              </button>
            </div>

            {/* Outside-costing art pricing — send a graphic artist a private
                gallery of SELECTED files to quote. Lives here so it can fire
                before costing exists (Jon, 2026-07-20). */}
            {safeItems.length > 0 && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -4 }}>
                <button onClick={() => setShowArtReqModal(true)}
                  style={{ background: "none", border: "none", color: T.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font, display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 4px" }}
                  onMouseEnter={e => { e.currentTarget.style.color = T.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.color = T.muted; }}
                  title="Send a graphic artist a private link to download selected art and quote the design">
                  Request art pricing →
                </button>
              </div>
            )}

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
                    {cutSew ? (item.qb_item_type || "—") : ([item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ") || "No blank")}
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
                    so the row doesn't expand/collapse on rename.
                    Hidden when locked — renames are item edits. */}
                {!costingLocked && <button
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
                </button>}
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
                  {cutSew
                    ? <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>{item.qb_item_type || "—"}</span>
                    : <>
                        {hasBlank && <span style={{ fontSize: 11, color: T.muted, flexShrink: 0, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.blank_vendor}{(item.color || item.blank_sku) ? ` · ${item.color || item.blank_sku}` : ""}</span>}
                        {!hasBlank && !NON_GARMENT.includes(item.garment_type) && <span style={{ fontSize: 11, color: T.amber, flexShrink: 0 }}>No blank</span>}
                      </>}
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
                setEditSizesItemId={setEditSizesItemId} setSubEditor={setSubEditor}
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
      {subEditor && (() => {
        const target = (workingItems || []).find(it => it.id === subEditor.itemId);
        if (!target) return null;
        return (
          <SizeSubModal
            item={target} size={subEditor.size}
            onClose={() => setSubEditor(null)}
            onSave={({ label, color, cost, note }) => {
              const size = subEditor.size;
              const sizeSubs = { ...(target.sizeSubs || {}) };
              const blankCosts = { ...(target.blankCosts || {}) };
              const hasSub = !!(label || color || note);
              if (hasSub) sizeSubs[size] = { ...(label ? { label } : {}), ...(color ? { color } : {}), ...(note ? { note } : {}) };
              else delete sizeSubs[size];
              if (cost !== "" && cost != null && !isNaN(Number(cost))) blankCosts[size] = Number(cost);
              else delete blankCosts[size];
              // Re-derive cost_per_unit (avg of the >0 per-size costs) so the item
              // rollup + Blanks tab agree — same formula as assignBlank / CostingTab.
              const costVals = Object.values(blankCosts).map(Number).filter(v => v > 0);
              const cpu = costVals.length ? Math.round(costVals.reduce((a, v) => a + v, 0) / costVals.length * 100) / 100 : 0;
              updateLocal((workingItems || []).map(it => it.id === subEditor.itemId ? { ...it, sizeSubs, blankCosts, cost_per_unit: cpu } : it));
              onUpdateItem(subEditor.itemId, { sizeSubs, blankCosts, cost_per_unit: cpu });
              setSubEditor(null);
            }}
          />
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SizeSubModal — per-size blank substitution. Same decoration, a
// different garment (brand/style/color) for ONE size: the assigned
// blank maxes out below a pre-ordered size, or a size/color/brand
// sells out and we pivot. Customer price is unchanged; only our cost
// moves. Cost → the item's per-size blank_costs (drives costing + PO
// margin); label/color/note → size_subs (drives the PO note + badge).
// ═══════════════════════════════════════════════════════════════
function SizeSubModal({ item, size, onClose, onSave }) {
  const cur = (item.sizeSubs || {})[size] || {};
  const curCost = (item.blankCosts || {})[size];
  const [label, setLabel] = useState(cur.label || "");
  const [color, setColor] = useState(cur.color || "");
  const [note, setNote] = useState(cur.note || "");
  const [cost, setCost] = useState(curCost != null ? String(curCost) : "");
  const qty = item.qtys?.[size] || 0;
  const baseBlank = [item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ");
  const hasExisting = !!(cur.label || cur.color || cur.note || curCost != null);
  const inp = { width: "100%", padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, boxSizing: "border-box", outline: "none" };
  const lbl = { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 12, width: 470, maxWidth: "94vw", padding: "18px 20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", fontFamily: font }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Substitute blank — {size}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.faint, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 14, lineHeight: 1.5 }}>
          {qty.toLocaleString()} unit{qty !== 1 ? "s" : ""} of {size}{baseBlank ? ` · default blank ${baseBlank}` : ""}. Set a different garment for just this size — same print. Customer price is unchanged; only your cost moves.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={lbl}>Substitute blank / style</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Gildan 2000" style={inp} autoFocus />
          </div>
          <div>
            <label style={lbl}>Color</label>
            <input value={color} onChange={e => setColor(e.target.value)} placeholder="e.g. Sand" style={inp} />
          </div>
          <div>
            <label style={lbl}>Cost / unit</label>
            <input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="0.00" style={{ ...inp, fontFamily: mono }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={lbl}>PO note <span style={{ color: T.faint, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— shown to the printer for this size</span></label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. 5001 maxes at 3XL — sub Gildan 2000 for 4XL" style={inp} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
          <button onClick={() => onSave({ label: label.trim(), color: color.trim(), cost: cost.trim(), note: note.trim() })}
            style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 7, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Save substitute</button>
          {hasExisting && (
            <button onClick={() => onSave({ label: "", color: "", cost: "", note: "" })}
              style={{ background: "transparent", color: T.red, border: `1px solid ${T.border}`, borderRadius: 7, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Remove</button>
          )}
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 7, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Cancel</button>
        </div>
      </div>
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
    // Dimensional (waist × inseam) sizes distribute on the real WxL sell-through
    // curve; letter sizes use the item's curve / the default tee curve.
    const curve = parseSizeMatrix(sizes, null) ? WAIST_INSEAM_CURVE : (item.curve || DEFAULT_CURVE);
    const next = distribute(total, sizes, curve);
    setQtys(next);
    setDistTotal("");
  };

  const total = Object.values(qtys).reduce((a, v) => a + (Number(v) || 0), 0);

  // Waist × Inseam (cut-and-sew pants) — pre-loaded with the Ridgeline ranges.
  // Selecting cells produces "{waist} / {inseam} ({name})" labels, the same
  // dimensional format the size grid pivots into a cut-ticket (waist rows ×
  // inseam cols) on the card + PDFs.
  const WI_WAISTS = [28, 30, 32, 34, 36, 38, 40, 42];
  const WI_INSEAMS = [{ num: 30, name: "Short" }, { num: 32, name: "Regular" }, { num: 34, name: "Long" }, { num: 36, name: "Tall" }];
  const wiLabel = (w, i) => `${w} / ${i.num} (${i.name})`;
  const [showWI, setShowWI] = useState(() => !!parseSizeMatrix(item.sizes || [], null));
  const setMany = (labels, on) => {
    const next = new Set(sizes);
    if (on) { for (const o of ONE_SIZE) next.delete(o); labels.forEach(l => next.add(l)); }
    else { labels.forEach(l => next.delete(l)); }
    setSizes(sortSizesLocal([...next]));
    if (!on) { const q = { ...qtys }; labels.forEach(l => delete q[l]); setQtys(q); }
  };
  const toggleWaistRow = (w) => { const ls = WI_INSEAMS.map(i => wiLabel(w, i)); setMany(ls, !ls.every(l => sizes.includes(l))); };
  const toggleInseamCol = (i) => { const ls = WI_WAISTS.map(w => wiLabel(w, i)); setMany(ls, !ls.every(l => sizes.includes(l))); };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 32px)", fontFamily: font }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.card, borderRadius: 12, width: "min(900px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", border: `1px solid ${T.border}` }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Edit sizes & qtys</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name || "Item"}</div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 22 }}>
          {/* SIZES — centered across the top */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, textAlign: "center" }}>Sizes</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, justifyContent: "center" }}>
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, justifyContent: "center" }}>
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
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

          {/* WAIST × INSEAM + QUANTITIES — side by side */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
          {/* Waist × Inseam (pants) — pre-loaded Ridgeline ranges; click cells to select. */}
          <div>
            <button onClick={() => setShowWI(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              Waist × Inseam (pants) <span style={{ fontSize: 9 }}>{showWI ? "▾" : "▸"}</span>
            </button>
            {showWI && (
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: 4, fontSize: 9, color: T.faint, fontWeight: 700 }}>W \ I</th>
                      {WI_INSEAMS.map(i => (
                        <th key={i.num} onClick={() => toggleInseamCol(i)} title="Toggle whole column"
                          style={{ padding: "4px 6px", fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.muted, cursor: "pointer", textAlign: "center" }}>
                          {i.num}<div style={{ fontSize: 8, fontWeight: 600, color: T.faint }}>{i.name}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WI_WAISTS.map(w => (
                      <tr key={w}>
                        <td onClick={() => toggleWaistRow(w)} title="Toggle whole row"
                          style={{ padding: "4px 8px", fontSize: 12, fontFamily: mono, fontWeight: 700, color: T.muted, cursor: "pointer", textAlign: "center" }}>{w}</td>
                        {WI_INSEAMS.map(i => {
                          const label = wiLabel(w, i); const on = sizes.includes(label);
                          return (
                            <td key={i.num} style={{ padding: 2 }}>
                              <button onClick={() => toggleSize(label)}
                                style={{ width: 38, height: 30, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, background: on ? T.accent : T.card, color: on ? "#fff" : T.faint, border: `1px solid ${on ? T.accent : T.border}` }}>
                                {on ? "✓" : ""}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 10, color: T.faint, marginTop: 8, maxWidth: 230, lineHeight: 1.4 }}>Click a cell to include that size. Click a W or I header to toggle a whole row / column.</div>
              </div>
            )}
          </div>

          {/* RIGHT — quantities + distribute */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Qty grid for active sizes */}
          {sizes.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Quantities</div>
              {parseSizeMatrix(sizes, null) ? (
                // Dimensional (waist × inseam) → pivoted cut-ticket grid w/ totals.
                <SizeGridInput
                  sizes={sizes}
                  getValue={sz => qtys[sz] ?? 0}
                  onChange={(sz, v) => setQty(sz, v)}
                  onCommit={() => {}}
                  disabled={false}
                  ic={{ border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontFamily: font, outline: "none" }}
                />
              ) : (
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
              )}
            </div>
          )}
          </div>{/* /RIGHT — qty only */}
          </div>{/* /side-by-side row */}

          {/* Distribute helper — full width below the grids */}
          {sizes.length > 0 && !ONE_SIZE.includes(sizes[0]) && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Distribute total</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
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
function ExpandedItemBody({ item, idx, clientName, projectTitle, contacts, project, hasBlank, getLocalQty, setLocalQty, commitQty, scheduleCommit, inputRefs, distRow, setDistRow, distTotal, setDistTotal, handleDist, removeItem, setAssignBlankTo, setEditSizesItemId, setSubEditor, setShowAddModal, setMobilePickerOpen, onItemsChanged, onUpdateItem, onFilesChanged, preloadedMockupId, ic, costingLocked, requestMove, requestCopy }) {
  // Per-size blank substitution state, derived from blank_costs + size_subs:
  //  · hasSub(sz)   — a substitute (brand/color/note) is configured for this size
  //  · needsSub(sz) — the size has orders but no blank cost while the blank clearly
  //                   covers other sizes → a coverage gap that wants a substitute
  const _subBlankCosts = item.blankCosts || {};
  const _hasRealCosts = Object.values(_subBlankCosts).some(v => Number(v) > 0);
  const _hasBlank = !!(item.blank_sku || item.blank_vendor);
  const subInfo = (sz) => (item.sizeSubs || {})[sz];
  const hasSub = (sz) => { const s = subInfo(sz); return !!(s && (s.label || s.color || s.note)); };
  const needsSub = (sz) => (item.qtys?.[sz] || 0) > 0 && _hasBlank && _hasRealCosts && !(Number(_subBlankCosts[sz]) > 0) && !hasSub(sz);
  const isMobile = useIsMobile();
  const cutSew = isCutSewOnly(useClientBranding().slug); // DMD: no blanks
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadFiles(); }, [item.id]);
  // Warn on tab-close / refresh while a file upload is in flight (the blocking
  // overlay stops in-app nav; this covers browser-level exits).
  useEffect(() => {
    if (!uploading) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [uploading]);

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
    setUploadError(null);
    setUploading(true);
    const failed = [];
    for (let i = 0; i < allFiles.length; i++) {
      setUploadProgress({ total: allFiles.length, done: i, current: allFiles[i].name });
      const stage = detectStage(allFiles[i].name);
      try {
        const driveFile = await uploadToDrive({ blob: allFiles[i], fileName: allFiles[i].name, mimeType: allFiles[i].type || "application/octet-stream", itemId: item.id, clientName, projectTitle, itemName: item.name });
        await registerFileInDb({ ...driveFile, itemId: item.id, stage });
      } catch (err) { console.error("Upload error:", err); failed.push(allFiles[i].name); }
    }
    setUploading(false); setUploadProgress(null);
    loadFiles();
    if (onFilesChanged) onFilesChanged();
    // Surface failures instead of hiding them (a folder can exist with no file).
    if (failed.length) setUploadError(`${failed.length} file${failed.length !== 1 ? "s" : ""} didn't upload: ${failed.join(", ")}. Re-drop to retry.`);
    else logJobActivity(project.id, `${allFiles.length} file${allFiles.length > 1 ? "s" : ""} uploaded for ${item.name}`);
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
      {/* Blocking upload overlay — covers the page so you can't navigate away
          mid-upload (that abort is what left an empty Drive folder). Autocloses
          on completion; stays with an error on failure instead of hiding it. */}
      {(uploading || uploadError) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(20,20,24,0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "24px 26px", width: 440, maxWidth: "90vw", boxShadow: "0 12px 48px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: uploadError ? T.red : T.text }}>
              {uploadError ? "Upload didn’t finish" : "Uploading — don’t navigate away"}
            </div>
            {!uploadError && uploadProgress && (
              <>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>{`File ${Math.min(uploadProgress.done + 1, uploadProgress.total)} of ${uploadProgress.total}`}</div>
                <div style={{ fontSize: 11, color: T.faint, marginTop: 2, fontFamily: mono, wordBreak: "break-all" }}>{uploadProgress.current}</div>
                <div style={{ height: 8, background: T.surface, borderRadius: 99, overflow: "hidden", marginTop: 14 }}>
                  <div style={{ height: "100%", width: `${Math.round((uploadProgress.done / uploadProgress.total) * 100)}%`, background: T.accent, borderRadius: 99, transition: "width 0.2s" }} />
                </div>
              </>
            )}
            {uploadError && (
              <>
                <div style={{ fontSize: 12.5, color: T.text, background: T.redDim, borderRadius: 8, padding: "10px 12px", lineHeight: 1.45, marginTop: 10 }}>{uploadError}</div>
                <button onClick={() => setUploadError(null)}
                  style={{ marginTop: 14, width: "100%", padding: "9px", borderRadius: 8, border: "none", background: T.text, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Dismiss</button>
              </>
            )}
          </div>
        </div>
      )}
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
          {cutSew ? (
            // DMD: no blanks. Show the item type (their QB category) read-only.
            <div style={{ padding: "12px 16px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Type</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: item.qb_item_type ? T.text : T.faint }}>{item.qb_item_type || "—"}</span>
            </div>
          ) : (
          <div onClick={e => { e.stopPropagation(); if (costingLocked) return; setAssignBlankTo(item.id); if (isMobile) { setMobilePickerOpen(true); } else { setShowAddModal(true); } }}
            style={{ cursor: costingLocked ? "default" : "pointer", padding: "12px 16px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, transition: "border-color 0.15s", flexWrap: isMobile ? "wrap" : "nowrap" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
            {hasBlank ? (
              <>
                <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: T.text, wordBreak: isMobile ? "break-word" : "normal" }}>{item.blank_vendor}</span>
                {(item.color || item.blank_sku) && <span style={{ fontSize: isMobile ? 13 : 14, color: T.muted }}>{item.color || item.blank_sku}</span>}
                <select value={item.garment_type || ""} disabled={costingLocked} onClick={e => e.stopPropagation()}
                  onChange={e => {
                    e.stopPropagation();
                    if (costingLocked) return;
                    const next = e.target.value || null;
                    // Fleece garments auto-flag is_fleece so the
                    // decorator's per-print fleece upcharge + fleece
                    // packaging variant kick in without a second click.
                    // Picking a non-fleece garment clears the flag.
                    const isFleeceType = next && FLEECE_GARMENTS.includes(next);
                    onUpdateItem(item.id, { garment_type: next, is_fleece: !!isFleeceType });
                  }}
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
                  style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 6, border: `1px solid ${item.is_fleece ? T.green : T.border}`, background: item.is_fleece ? T.green : T.card, color: item.is_fleece ? "#fff" : T.muted, cursor: costingLocked ? "default" : "pointer", letterSpacing: "0.04em", textTransform: "uppercase", opacity: costingLocked ? 0.5 : 1 }}>
                  {item.is_fleece ? "Fleece" : "Fleece?"}
                </button>
                {!isMobile && <span style={{ fontSize: 10, color: T.faint, marginLeft: "auto" }}>click to change</span>}
              </>
            ) : (
              <>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.accent }}>Assign Blank →</span>
                {/* Custom / cut-and-sew items have no catalog blank but still
                    need a QuickBooks Product/Service mapping for invoicing.
                    Expose the type selector here so a blank isn't required
                    just to set the QB category. */}
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>QB type</span>
                  <select value={item.garment_type || ""} disabled={costingLocked} onClick={e => e.stopPropagation()}
                    onChange={e => {
                      e.stopPropagation();
                      if (costingLocked) return;
                      const next = e.target.value || null;
                                            onUpdateItem(item.id, { garment_type: next, is_fleece: !!(next && FLEECE_GARMENTS.includes(next)) });
                    }}
                    style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: T.card, color: item.garment_type ? T.text : T.muted, border: `1px solid ${item.garment_type ? T.accent : T.border}`, cursor: "pointer", outline: "none", appearance: "none", WebkitAppearance: "none", paddingRight: 18, backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23a0a0ad' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}>
                    <option value="">set type</option>
                    {["bandana", "banner", "beanie", "crewneck", "custom", "flag", "hat", "hoodie", "jacket", "koozie", "lighter", "longsleeve", "pants", "patch", "pin", "poster", "samples", "shorts", "socks", "sticker", "tee", "tote", "towel", "water_bottle"].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </span>
              </>
            )}
          </div>
          )}

          {/* Simple qty for non-sized items (patches, stickers, etc.) */}
          {/* Cut-and-sew (DMD): no blanks, so a fresh item has no sizes. Surface
              the size editor directly (it handles multi-size runs + qtys) rather
              than the one-size "Qty units" shortcut. */}
          {cutSew && item.sizes.length === 0 && !costingLocked && (
            <button onClick={() => setEditSizesItemId(item.id)}
              style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: T.accent, border: "none", borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontFamily: font }}>
              + Set sizes &amp; quantities
            </button>
          )}
          {!cutSew && (item.sizes.length === 0 || (item.sizes.length === 1 && item.sizes[0] === "OSFA")) && (
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
              {(() => { const dimMatrix = parseSizeMatrix(item.sizes, null); return dimMatrix ? (
                <>
                  <SizeGridInput
                    sizes={item.sizes}
                    getValue={sz => { const lv = getLocalQty(item.id, sz); return lv !== null ? lv : (item.qtys[sz] || 0); }}
                    onChange={(sz, v) => { setLocalQty(item.id, sz, v); scheduleCommit(idx, item.id, sz); }}
                    onCommit={sz => commitQty(idx, item.id, sz)}
                    disabled={costingLocked} ic={ic}
                  />
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, fontFamily: mono, color: T.text }}>{(item.totalQty || 0).toLocaleString()}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>units</span>
                    </div>
                    {!costingLocked && <button onClick={() => setEditSizesItemId(item.id)} title="Edit sizes & quantities"
                      style={{ fontSize: 12, fontWeight: 600, color: T.muted, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontFamily: font }}>Edit sizes &amp; qty</button>}
                  </div>
                </>
              ) : (<>
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
                      <button type="button" onClick={() => !costingLocked && setSubEditor({ itemId: item.id, size: sz })} disabled={costingLocked}
                        title={hasSub(sz) ? `Substitute set for ${sz} — click to edit` : needsSub(sz) ? `No blank in ${sz} — click to set a substitute` : `Set a blank substitute for ${sz}`}
                        style={{ background: "transparent", border: "none", padding: "0 2px", lineHeight: 1.2, cursor: costingLocked ? "default" : "pointer", fontSize: 10, fontWeight: (needsSub(sz) || hasSub(sz)) ? 800 : 600, fontFamily: mono, color: needsSub(sz) ? T.amber : hasSub(sz) ? T.accent : T.faint }}>
                        {sz}{needsSub(sz) ? " ⚠" : hasSub(sz) ? " ↔" : ""}
                      </button>
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
              </>); })()}
            {distRow === idx && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                <input type="text" inputMode="numeric" value={distTotal} onChange={e => setDistTotal(e.target.value)} onKeyDown={e => e.key === "Enter" && handleDist(idx)} placeholder="Total qty" autoFocus style={{ ...ic, width: 80, textAlign: "center" }} />
                <button onClick={() => handleDist(idx)} style={{ fontSize: 10, color: "#fff", background: T.accent, border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>Fill</button>
                <button onClick={() => setDistRow(null)} style={{ fontSize: 10, color: T.muted, background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
              </div>
            )}
          </div>
        )}
        {!cutSew && !hasBlank && item.sizes.length === 0 && item.garment_type !== "accessory" && (
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
        {/* Duplicate / Move / Delete mutate this job — hidden when
            locked (incl. archived historic records). "Copy to another
            job" stays: it reads history without changing it, which is
            exactly the reorder-from-history flow. */}
        {!costingLocked && typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id) && (
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
        {!costingLocked && typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id) && requestMove && (
          <button onClick={e => { e.stopPropagation(); requestMove(item); }}
            title="Move this item to another job for the same client"
            style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = T.accent} onMouseLeave={e => e.currentTarget.style.color = T.faint}>
            Move to another job
          </button>
        )}
        {!costingLocked && (
          <button onClick={e => { e.stopPropagation(); if (window.confirm(`Remove "${item.name}"?`)) removeItem(item.id); }}
            style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.faint}>
            Delete item
          </button>
        )}
      </div>
    </div>
  );
}
