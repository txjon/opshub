"use client";
// Client Working Sheet — the back-office financial worksheet extracted from
// the classic client page (Jul 28 2026, Jon: "move that to the pipeline
// section of the new client page"). ONE component, two renderers:
//   - classic /clients/[id]/classic → variant="card" (summary card → modal)
//   - the client space /clients/[id] Pipeline section → variant="inline"
// Per-item cost/retail tracking, canonical status buckets, chain ETAs, notes —
// across every job for the client. Inline edits to sell_per_unit propagate to
// quote/invoice/portal (pricing source of truth); client_retail_per_unit is
// private to this view; client_eta is THE PROMISE the client hub shows.
//
// Data contract: `jobs` comes from the parent (each page already loads it) and
// the parent passes `onItemLocalChange` so its own copies of the items update
// optimistically — no stale sibling panels. Persistence (600ms debounce +
// save-error banners + activity log) lives HERE, one copy.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { logJobActivity } from "@/components/JobActivityPanel";
import { resolveItemStatus, STATE_LABELS, type ItemState } from "@/lib/item-status";
import { parseDay } from "@/lib/dates";

const asLocalD = (iso: string) => (iso.includes("T") ? new Date(iso) : (parseDay(iso) as Date));
const ic = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: "13px", fontFamily: font, boxSizing: "border-box" as const, outline: "none" };
const fmtMoney = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoneyShort = (n: number) => "$" + Math.round(n || 0).toLocaleString();

export const ITEM_STATE_COLORS: Record<ItemState, string> = {
  setup: T.muted,
  in_production: T.accent,
  shipped: T.purple,
  in_stock: "#14b8a6",
  complete: T.green,
  archived: T.faint,
  on_hold: T.amber,
  cancelled: T.red,
};

// Flatten a client's jobs into enriched worksheet items — shared with the
// classic page's Orders hover so both read the same shapes (one source).
export function flattenClientItems(jobs: any[]): any[] {
  return (jobs || []).flatMap((j: any) => {
    const tm = j.type_meta || {};
    const sentRaw: string[] = Array.isArray(tm.po_sent_vendors) ? tm.po_sent_vendors : [];
    const sentLower = new Set(sentRaw.map((s: string) => (s || "").toLowerCase().trim()).filter(Boolean));
    return (j.items || []).map((it: any) => {
      const assignment = it.decorator_assignments?.[0];
      const decoratorName: string | null = assignment?.decorators?.name || null;
      const decoratorShort: string | null = assignment?.decorators?.short_code || null;
      const poSent = !!(
        (decoratorName && sentLower.has(decoratorName.toLowerCase())) ||
        (decoratorShort && sentLower.has(decoratorShort.toLowerCase()))
      );
      return {
        ...it,
        jobId: j.id,
        jobTitle: j.title,
        jobNumber: tm.qb_invoice_number || j.job_number,
        jobDate: j.target_ship_date || j.created_at,
        jobPhase: j.phase,
        shippingRoute: j.shipping_route || null,
        itemShippingRoute: it.shipping_route || null,
        quoteApprovedAt: j.quote_approved_at || null,
        jobCompletedAt: (j.phase_timestamps || {}).complete || null,
        pipelineStage: it.pipeline_stage || null,
        archivedAt: it.archived_at || null,
        completedAt: it.completed_at || null,
        receivedAtHpd: !!it.received_at_hpd,
        forwardedAt: it.forwarded_at || null,
        blanksOrderCost: it.blanks_order_cost != null ? Number(it.blanks_order_cost) : null,
        decoratorName,
        poSent,
        totalQty: (it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0),
        sizes: (it.buy_sheet_lines || []).map((l: any) => l.size),
        qtys: Object.fromEntries((it.buy_sheet_lines || []).map((l: any) => [l.size, l.qty_ordered])),
      };
    });
  });
}

export function resolveWsState(it: any): ItemState {
  return resolveItemStatus({
    archived_at: it.archivedAt,
    completed_at: it.completedAt,
    pipeline_stage: it.pipelineStage,
    received_at_hpd: it.receivedAtHpd,
    sell_per_unit: it.sell_per_unit,
    blanks_order_cost: it.blanksOrderCost,
    po_sent: it.poSent,
    job_phase: it.jobPhase,
    job_shipping_route: it.shippingRoute,
    item_shipping_route: it.itemShippingRoute,
    job_completed_at: it.jobCompletedAt,
    forwarded_at: it.forwardedAt,
  }) as ItemState;
}

type TabKey = "setup" | "in_production" | "shipped" | "in_stock" | "archived";

type Props = {
  clientId: string;
  clientName: string;
  jobs: any[];
  onItemLocalChange: (itemId: string, field: string, value: any) => void;
  variant?: "card" | "inline";
};

export function ClientWorkingSheet({ clientId, clientName, jobs, onItemLocalChange, variant = "card" }: Props) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [workingTab, setWorkingTab] = useState<TabKey>("in_production");
  const [workingRowExpanded, setWorkingRowExpanded] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedWsIds, setSelectedWsIds] = useState<Set<string>>(new Set());
  const [bulkRetail, setBulkRetail] = useState<string>("");
  const [bulkBusy, setBulkBusy] = useState<null | "retail" | "archive">(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [itemThumbs, setItemThumbs] = useState<Record<string, string>>({});
  const [chainEtas, setChainEtas] = useState<Record<string, { eta: string | null; source: string | null }>>({});
  const itemSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const isOpen = variant === "inline" || open;

  // Chain-resolved ETAs — the INTERNAL CLOCK, reference only (rides under the
  // editable promise in the Client date column). Pure chain: never the promise.
  useEffect(() => {
    let dead = false;
    fetch(`/api/item-etas?clientId=${clientId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!dead && d?.etas) setChainEtas(d.etas); })
      .catch(() => {});
    return () => { dead = true; };
  }, [clientId]);

  // Item thumbnails — portal items API resolution order (mockup > proof >
  // print_ready, newest of each, non-superseded).
  useEffect(() => {
    const itemIds = (jobs || []).flatMap((j: any) => (j.items || []).map((it: any) => it.id));
    if (itemIds.length === 0) return;
    let dead = false;
    supabase.from("item_files")
      .select("item_id, stage, drive_file_id, created_at")
      .in("item_id", itemIds)
      .in("stage", ["mockup", "proof", "print_ready"])
      .is("superseded_at", null)
      .not("drive_file_id", "is", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (dead) return;
        const rank: Record<string, number> = { mockup: 3, proof: 2, print_ready: 1 };
        const bestRank: Record<string, number> = {};
        const best: Record<string, string> = {};
        for (const f of (data || []) as any[]) {
          const r = rank[f.stage] || 0;
          if (r > (bestRank[f.item_id] || 0)) { bestRank[f.item_id] = r; best[f.item_id] = f.drive_file_id; }
        }
        setItemThumbs(best);
      });
    return () => { dead = true; };
    // eslint-disable-next-line
  }, [jobs.length, clientId]);

  // Card-variant modal — Esc closes, body scroll locks while open.
  useEffect(() => {
    if (variant !== "card" || !open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [open, variant]);

  // Per-item editor — Esc closes.
  useEffect(() => {
    if (!workingRowExpanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setWorkingRowExpanded(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [workingRowExpanded]);

  // Drop the selection whenever the bucket changes or the sheet closes —
  // a selection from one bucket must not silently apply in another.
  useEffect(() => { setSelectedWsIds(new Set()); setBulkRetail(""); }, [workingTab, isOpen]);

  // Debounced auto-save. Optimistic via onItemLocalChange (parent state),
  // write after 600ms idle. Await + check error — silent failures here lost
  // retail values once; never again.
  async function persistItemField(itemId: string, field: string, value: any) {
    const dbValue = value === "" ? null : value;
    const { error } = await supabase.from("items").update({ [field]: dbValue }).eq("id", itemId);
    const key = `${itemId}_${field}`;
    if (error) {
      console.error(`[worksheet] failed to save ${field} on item ${itemId}:`, error);
      setSaveErrors(prev => ({ ...prev, [key]: error.message }));
    } else {
      setSaveErrors(prev => {
        if (!prev[key]) return prev;
        const next = { ...prev }; delete next[key]; return next;
      });
    }
  }
  function saveItemField(itemId: string, field: string, value: any) {
    onItemLocalChange(itemId, field, value);
    const key = `${itemId}_${field}`;
    if (itemSaveTimers.current[key]) clearTimeout(itemSaveTimers.current[key]);
    itemSaveTimers.current[key] = setTimeout(() => persistItemField(itemId, field, value), 600);
  }
  function flushItemField(itemId: string, field: string, value: any) {
    const key = `${itemId}_${field}`;
    if (itemSaveTimers.current[key]) { clearTimeout(itemSaveTimers.current[key]); delete itemSaveTimers.current[key]; }
    return persistItemField(itemId, field, value);
  }
  function logWorksheet(jobId: string, message: string) {
    if (!jobId) return;
    logJobActivity(jobId, `${message} (worksheet)`);
  }

  const wsItems = flattenClientItems(jobs).map((it: any) => ({ ...it, _ws: resolveWsState(it) }));
  const paidJobIds = new Set(
    (jobs || []).filter((j: any) => (j.payment_records || []).some((p: any) => p.status === "paid")).map((j: any) => j.id)
  );

  function selectedWorksheetItems(): { id: string; name: string; jobId: string }[] {
    if (selectedWsIds.size === 0) return [];
    return wsItems.filter((it: any) => selectedWsIds.has(it.id)).map((it: any) => ({ id: it.id, name: it.name, jobId: it.jobId }));
  }
  async function applyBulkRetail() {
    const raw = bulkRetail.trim();
    const v = raw === "" ? null : Number(raw.replace(/[^0-9.\-]/g, ""));
    if (v != null && (!Number.isFinite(v) || v < 0)) return;
    const targets = selectedWorksheetItems();
    if (targets.length === 0) return;
    setBulkBusy("retail");
    try {
      for (const t of targets) onItemLocalChange(t.id, "client_retail_per_unit", v);
      const label = v == null ? "—" : "$" + v.toFixed(2);
      await Promise.all(targets.map(t => persistItemField(t.id, "client_retail_per_unit", v)));
      const byJob = new Map<string, string[]>();
      for (const t of targets) { if (!byJob.has(t.jobId)) byJob.set(t.jobId, []); byJob.get(t.jobId)!.push(t.name); }
      for (const [jobId, names] of Array.from(byJob.entries())) {
        logWorksheet(jobId, `Retail set to ${label} on ${names.length} item${names.length === 1 ? "" : "s"} (${names.join(", ")}) (bulk)`);
      }
      setBulkRetail(""); setSelectedWsIds(new Set());
    } finally { setBulkBusy(null); }
  }
  async function applyBulkArchive(archive: boolean) {
    const targets = selectedWorksheetItems();
    if (targets.length === 0) return;
    setBulkBusy("archive");
    try {
      const v = archive ? new Date().toISOString() : null;
      for (const t of targets) onItemLocalChange(t.id, "archived_at", v);
      await Promise.all(targets.map(t => persistItemField(t.id, "archived_at", v)));
      const byJob = new Map<string, string[]>();
      for (const t of targets) { if (!byJob.has(t.jobId)) byJob.set(t.jobId, []); byJob.get(t.jobId)!.push(t.name); }
      for (const [jobId, names] of Array.from(byJob.entries())) {
        logWorksheet(jobId, `${archive ? "Archived" : "Unarchived"} ${names.length} item${names.length === 1 ? "" : "s"} (${names.join(", ")}) (bulk)`);
      }
      setSelectedWsIds(new Set());
    } finally { setBulkBusy(null); }
  }

  const rollup = (list: any[]) => {
    let count = 0, qty = 0, cost = 0, gross = 0;
    for (const it of list) {
      const c = Number(it.sell_per_unit) || 0;
      const r = Number(it.client_retail_per_unit) || 0;
      count++; qty += it.totalQty; cost += c * it.totalQty; gross += r * it.totalQty;
    }
    return { count, qty, cost, gross, profit: gross - cost };
  };
  const byStatus: Record<TabKey, any[]> = {
    setup: wsItems.filter((it: any) => it._ws === "setup"),
    in_production: wsItems.filter((it: any) => it._ws === "in_production"),
    shipped: wsItems.filter((it: any) => it._ws === "shipped"),
    in_stock: wsItems.filter((it: any) => it._ws === "in_stock"),
    archived: wsItems.filter((it: any) => it._ws === "complete" || it._ws === "archived" || it._ws === "cancelled"),
  };
  const activeWsItems = wsItems.filter((it: any) => it._ws !== "complete" && it._ws !== "archived" && it._ws !== "cancelled");
  const rollups = {
    setup: rollup(byStatus.setup), in_production: rollup(byStatus.in_production),
    shipped: rollup(byStatus.shipped), in_stock: rollup(byStatus.in_stock),
    archived: rollup(byStatus.archived), active_total: rollup(activeWsItems),
  };
  const currentItems = byStatus[workingTab];
  const STATUS_OPTS: { value: Exclude<TabKey, "archived">; label: string; color: string }[] = [
    { value: "setup", label: STATE_LABELS.setup, color: T.muted },
    { value: "in_production", label: STATE_LABELS.in_production, color: T.accent },
    { value: "shipped", label: STATE_LABELS.shipped, color: T.purple },
    { value: "in_stock", label: STATE_LABELS.in_stock, color: "#14b8a6" },
  ];

  const body = (
    <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* KPI rollup */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 580 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {["Phase", "Items", "Qty", "Cost", "Gross", "Profit"].map((h, i) => (
                <th key={h} style={{ padding: "6px 10px", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATUS_OPTS.map(opt => {
              const r = rollups[opt.value];
              return (
                <tr key={opt.value}>
                  <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: opt.color, textTransform: "uppercase", letterSpacing: "0.07em" }}>{opt.label}</td>
                  <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.muted, textAlign: "right" }}>{r.count}</td>
                  <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.text, textAlign: "right" }}>{r.qty.toLocaleString()}</td>
                  <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.text, textAlign: "right" }}>{fmtMoneyShort(r.cost)}</td>
                  <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.text, textAlign: "right" }}>{fmtMoneyShort(r.gross)}</td>
                  <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, fontWeight: 600, color: T.green, textAlign: "right" }}>{fmtMoneyShort(r.profit)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: `1px solid ${T.border}`, background: T.surface }}>
              <td style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: T.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>Total (active)</td>
              <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.text, textAlign: "right" }}>{rollups.active_total.count}</td>
              <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.text, textAlign: "right" }}>{rollups.active_total.qty.toLocaleString()}</td>
              <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.text, textAlign: "right" }}>{fmtMoneyShort(rollups.active_total.cost)}</td>
              <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.text, textAlign: "right" }}>{fmtMoneyShort(rollups.active_total.gross)}</td>
              <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: mono, fontWeight: 800, color: T.green, textAlign: "right" }}>{fmtMoneyShort(rollups.active_total.profit)}</td>
            </tr>
            {showArchived && byStatus.archived.length > 0 && (
              <tr style={{ background: T.surface, opacity: 0.7 }}>
                <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Archived</td>
                <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.muted, textAlign: "right" }}>{rollups.archived.count}</td>
                <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.muted, textAlign: "right" }}>{rollups.archived.qty.toLocaleString()}</td>
                <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.muted, textAlign: "right" }}>{fmtMoneyShort(rollups.archived.cost)}</td>
                <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.muted, textAlign: "right" }}>{fmtMoneyShort(rollups.archived.gross)}</td>
                <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: mono, color: T.muted, textAlign: "right" }}>{fmtMoneyShort(rollups.archived.profit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Tabs + archived toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2, background: T.surface, borderRadius: 6, padding: 2, width: "fit-content" }}>
          {STATUS_OPTS.map(opt => {
            const isActive = workingTab === opt.value;
            const count = byStatus[opt.value].length;
            return (
              <button key={opt.value} onClick={() => setWorkingTab(opt.value)}
                style={{ padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: isActive ? T.accent : "transparent", color: isActive ? "#0a0a0a" : T.muted, fontFamily: font }}>
                {opt.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{count}</span>
              </button>
            );
          })}
        </div>
        <button type="button"
          onClick={() => {
            const next = !showArchived;
            setShowArchived(next);
            if (next && byStatus.archived.length > 0) setWorkingTab("archived");
            else if (!next && workingTab === "archived") setWorkingTab("in_production");
          }}
          style={{ fontSize: 11, fontWeight: 600, color: showArchived ? T.text : T.muted, background: showArchived ? T.surface : "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontFamily: font }}
          title="Archived items (Complete > 30 days, manually archived, or cancelled)">
          {showArchived ? "Hide" : "Show"} archived ({byStatus.archived.length})
        </button>
      </div>

      {/* Bulk action bar */}
      {(() => {
        const selectedCount = Array.from(selectedWsIds).filter(id => currentItems.some((it: any) => it.id === id)).length;
        if (selectedCount === 0) return null;
        const allArchived = currentItems
          .filter((it: any) => selectedWsIds.has(it.id))
          .every((it: any) => it.archived_at != null || it._ws === "archived" || it._ws === "cancelled");
        return (
          <div style={{ position: "sticky", top: 0, zIndex: 5, background: T.card, border: `1px solid ${T.accent}`, borderRadius: 8, padding: "10px 14px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, boxShadow: "0 4px 14px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text, whiteSpace: "nowrap" }}>{selectedCount} selected</div>
            <button type="button" onClick={() => setSelectedWsIds(new Set())}
              style={{ fontSize: 10, color: T.muted, background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px", fontFamily: font, textDecoration: "underline" }}>
              Clear
            </button>
            <div style={{ flex: 1, minWidth: 8 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Retail $</span>
              <input type="text" inputMode="decimal" placeholder="0.00" value={bulkRetail}
                onChange={e => setBulkRetail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") applyBulkRetail(); }}
                style={{ ...ic, width: 80, padding: "5px 8px" }} />
              <button type="button" onClick={applyBulkRetail} disabled={bulkBusy != null || bulkRetail.trim() === ""}
                style={{ fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 5, background: bulkRetail.trim() === "" ? T.surface : T.accent, color: bulkRetail.trim() === "" ? T.faint : "#0a0a0a", border: "none", cursor: bulkBusy != null || bulkRetail.trim() === "" ? "not-allowed" : "pointer", fontFamily: font, opacity: bulkBusy === "retail" ? 0.6 : 1 }}>
                {bulkBusy === "retail" ? "..." : "Apply"}
              </button>
            </div>
            <button type="button" onClick={() => applyBulkArchive(!allArchived)} disabled={bulkBusy != null}
              style={{ fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 5, background: "transparent", color: T.muted, border: `1px solid ${T.border}`, cursor: bulkBusy != null ? "not-allowed" : "pointer", fontFamily: font, opacity: bulkBusy === "archive" ? 0.6 : 1 }}>
              {bulkBusy === "archive" ? "..." : (allArchived ? "Unarchive" : "Archive")}
            </button>
          </div>
        );
      })()}

      {/* Item list */}
      {currentItems.length === 0 ? (
        <div style={{ fontSize: 12, color: T.faint, padding: "20px", textAlign: "center", background: T.surface, borderRadius: 8 }}>
          No items in this bucket.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 60px 76px 76px 80px 96px 132px 44px", gap: 8, padding: "4px 10px", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", alignItems: "center" }}>
            {(() => {
              const visibleIds = currentItems.map((it: any) => it.id);
              const allChecked = visibleIds.length > 0 && visibleIds.every((id: string) => selectedWsIds.has(id));
              const someChecked = visibleIds.some((id: string) => selectedWsIds.has(id));
              return (
                <input type="checkbox" checked={allChecked}
                  ref={el => { if (el) el.indeterminate = !allChecked && someChecked; }}
                  onChange={() => {
                    setSelectedWsIds(prev => {
                      const next = new Set(prev);
                      if (allChecked) { for (const id of visibleIds) next.delete(id); }
                      else { for (const id of visibleIds) next.add(id); }
                      return next;
                    });
                  }}
                  aria-label="Select all visible items"
                  style={{ cursor: "pointer", width: 14, height: 14, accentColor: T.accent }} />
              );
            })()}
            <div>Item</div>
            <div style={{ textAlign: "right" }}>Qty</div>
            <div style={{ textAlign: "right" }}>Cost</div>
            <div style={{ textAlign: "right" }}>Retail</div>
            <div style={{ textAlign: "right" }}>Profit</div>
            <div>Status</div>
            <div>Client date</div>
            <div style={{ textAlign: "center" }}>Paid</div>
          </div>
          {currentItems.map((it: any) => {
            const cost = Number(it.sell_per_unit) || 0;
            const retail = Number(it.client_retail_per_unit) || 0;
            const profit = (retail - cost) * it.totalQty;
            const isPaid = paidJobIds.has(it.jobId);
            const stateLabel = STATE_LABELS[it._ws as ItemState] || "—";
            const stateColor = ITEM_STATE_COLORS[it._ws as ItemState] || T.muted;
            const isSelected = selectedWsIds.has(it.id);
            const toggle = () => {
              setSelectedWsIds(prev => {
                const next = new Set(prev);
                if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
                return next;
              });
            };
            return (
              <div key={it.id} style={{ background: isSelected ? T.accentDim : T.surface, borderRadius: 8, overflow: "hidden", outline: isSelected ? `1px solid ${T.accent}` : "none", outlineOffset: -1 }}>
                <div role="button" tabIndex={0}
                  onClick={() => setWorkingRowExpanded(it.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setWorkingRowExpanded(it.id); } }}
                  style={{ width: "100%", display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 60px 76px 76px 80px 96px 132px 44px", gap: 8, padding: "10px", alignItems: "center", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: font, color: T.text }}>
                  <div onClick={e => { e.stopPropagation(); toggle(); }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <input type="checkbox" checked={isSelected} onChange={toggle} onClick={e => e.stopPropagation()}
                      aria-label={`Select ${it.name}`} style={{ cursor: "pointer", width: 14, height: 14, accentColor: T.accent }} />
                  </div>
                  <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, flexShrink: 0, background: "#fff", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${T.border}` }}>
                      {itemThumbs[it.id] ? (
                        <img src={`/api/files/thumbnail?id=${itemThumbs[it.id]}&thumb=1`} alt="" referrerPolicy="no-referrer" loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                      ) : (<span style={{ color: T.faint, fontSize: 8 }}>—</span>)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2, overflow: "hidden", wordBreak: "break-word" }}>{it.name}</div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontFamily: mono }}>{it.jobNumber}</span>
                        {it.jobTitle && <> · {it.jobTitle}</>}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontFamily: mono, color: T.text, textAlign: "right" }}>{it.totalQty.toLocaleString()}</div>
                  <div style={{ fontSize: 12, fontFamily: mono, color: T.text, textAlign: "right" }}>{cost > 0 ? fmtMoney(cost) : "—"}</div>
                  <div style={{ fontSize: 12, fontFamily: mono, color: retail > 0 ? T.text : T.faint, textAlign: "right" }}>{retail > 0 ? fmtMoney(retail) : "—"}</div>
                  <div style={{ fontSize: 12, fontFamily: mono, fontWeight: 600, color: profit > 0 ? T.green : T.faint, textAlign: "right" }}>{profit !== 0 ? fmtMoneyShort(profit) : "—"}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: stateColor, textTransform: "uppercase", letterSpacing: "0.06em" }}>{stateLabel}</div>
                  {/* Client date = THE PROMISE, editable in place — this is what the
                      client's hub shows. The internal chain clock rides underneath as
                      reference only (Jon, Jul 28). Blank promise = chain rules. */}
                  <div onClick={e => e.stopPropagation()} style={{ minWidth: 0 }}>
                    <input type="date" value={it.client_eta || ""}
                      onChange={e => saveItemField(it.id, "client_eta", e.target.value || null)}
                      title="The date the client sees on their hub. Blank = the chain derives it."
                      style={{ width: "100%", padding: "4px 6px", border: `1px solid ${T.border}`, borderRadius: 5, background: T.surface, color: it.client_eta ? T.text : T.faint, fontSize: 11, fontFamily: mono, boxSizing: "border-box", outline: "none", colorScheme: "dark" }} />
                    <div style={{ fontSize: 8.5, fontFamily: mono, color: T.faint, marginTop: 2, whiteSpace: "nowrap" }}>
                      {(() => {
                        const ce = chainEtas[it.id];
                        return ce?.eta ? `chain ${asLocalD(ce.eta).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "chain TBD";
                      })()}
                    </div>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 14, color: isPaid ? T.green : T.faint }}>{isPaid ? "✓" : "—"}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Item editor modal */}
      {workingRowExpanded && (() => {
        const it = currentItems.find((x: any) => x.id === workingRowExpanded)
          || wsItems.find((x: any) => x.id === workingRowExpanded);
        if (!it) return null;
        const cost = Number(it.sell_per_unit) || 0;
        const retail = Number(it.client_retail_per_unit) || 0;
        const profit = (retail - cost) * it.totalQty;
        const stateLabel = STATE_LABELS[it._ws as ItemState] || "—";
        const stateColor = ITEM_STATE_COLORS[it._ws as ItemState] || T.muted;
        const isArchived = it.archivedAt != null || it._ws === "archived" || it._ws === "cancelled";
        const isPaid = paidJobIds.has(it.jobId);
        const close = () => setWorkingRowExpanded(null);
        return (
          <div onClick={close}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 32px)", fontFamily: font }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.card, borderRadius: 14, width: "min(440px, 100%)", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${T.border}` }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, height: 44, flexShrink: 0, background: "#fff", borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${T.border}` }}>
                  {itemThumbs[it.id] ? (
                    <img src={`/api/files/thumbnail?id=${itemThumbs[it.id]}&thumb=1`} alt="" referrerPolicy="no-referrer"
                      style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                  ) : (<span style={{ color: T.faint, fontSize: 10 }}>—</span>)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontFamily: mono }}>{it.jobNumber}</span>
                    {it.jobTitle && <> · {it.jobTitle}</>}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: stateColor, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{stateLabel}</span>
                <button onClick={close} style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
                {/* Stacked single column (Jon, Jul 28): the two CLIENT-facing levers
                    lead — suggested retail, then the promised date — money/status
                    reference below. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Suggested retail</label>
                    <input type="number" step="0.01" min="0" value={it.client_retail_per_unit ?? ""}
                      onChange={e => saveItemField(it.id, "client_retail_per_unit", e.target.value === "" ? null : Number(e.target.value))}
                      onBlur={e => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        flushItemField(it.id, "client_retail_per_unit", v);
                        if (v !== (Number(it.client_retail_per_unit) || null)) {
                          logWorksheet(it.jobId, `Retail set to ${v == null ? "—" : "$" + Number(v).toFixed(2)} — ${it.name}`);
                        }
                      }}
                      style={{ ...ic, fontFamily: mono }} />
                    {saveErrors[`${it.id}_client_retail_per_unit`] && (
                      <div style={{ fontSize: 9, color: T.red, marginTop: 4, lineHeight: 1.4, fontWeight: 600 }}>Save failed: {saveErrors[`${it.id}_client_retail_per_unit`]}</div>
                    )}
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Client facing date</label>
                    <input type="date" value={it.client_eta || ""}
                      onChange={e => saveItemField(it.id, "client_eta", e.target.value || null)}
                      style={{ ...ic, fontFamily: mono, colorScheme: "dark" }} />
                    <div style={{ fontSize: 9, color: T.faint, marginTop: 4, lineHeight: 1.4 }}>
                      The date the client sees on their hub. Blank lets the date chain derive it
                      (PO ship-by · transit · route buffer) automatically.
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Qty</label>
                      <input value={it.totalQty} disabled style={{ ...ic, background: T.surface, color: T.faint, fontFamily: mono }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Unit cost</label>
                      <input type="number" step="0.01" min="0" value={it.sell_per_unit ?? ""}
                        onChange={e => saveItemField(it.id, "sell_per_unit", e.target.value === "" ? null : Number(e.target.value))}
                        onBlur={e => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          flushItemField(it.id, "sell_per_unit", v);
                          if (v !== (Number(it.sell_per_unit) || null)) {
                            logWorksheet(it.jobId, `Unit cost set to ${v == null ? "—" : "$" + Number(v).toFixed(2)} — ${it.name}`);
                          }
                        }}
                        style={{ ...ic, fontFamily: mono }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Profit</label>
                      <div style={{ ...ic, color: profit > 0 ? T.green : T.faint, fontFamily: mono, display: "flex", alignItems: "center", fontWeight: 600 }}>
                        {profit !== 0 ? fmtMoneyShort(profit) : "—"}
                      </div>
                    </div>
                  </div>
                  {saveErrors[`${it.id}_sell_per_unit`] && (
                    <div style={{ fontSize: 9, color: T.red, lineHeight: 1.4, fontWeight: 600 }}>Save failed: {saveErrors[`${it.id}_sell_per_unit`]}</div>
                  )}
                  {it.quoteApprovedAt && (
                    <div style={{ fontSize: 9, color: T.amber, lineHeight: 1.4, marginTop: -6 }}>
                      Quote approved {new Date(it.quoteApprovedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Cost changes apply to future invoices only.
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</label>
                    <div style={{ padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: stateColor, textTransform: "uppercase", letterSpacing: "0.06em" }}>{stateLabel}</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {it._ws === "in_stock" && (
                          <button type="button"
                            onClick={() => { saveItemField(it.id, "completed_at", new Date().toISOString()); logWorksheet(it.jobId, `Marked Complete — ${it.name}`); }}
                            style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: T.green, border: "none", color: "#fff", cursor: "pointer", fontFamily: font }}
                            title="Manually move from In Stock to Complete (e.g., released to retail)">
                            ✓ Mark Complete
                          </button>
                        )}
                        {it.completedAt && it._ws === "complete" && (
                          <button type="button"
                            onClick={() => { saveItemField(it.id, "completed_at", null); logWorksheet(it.jobId, `Reopened (Complete → In Stock) — ${it.name}`); }}
                            style={{ fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 4, background: "transparent", border: `1px solid ${T.border}`, color: T.muted, cursor: "pointer", fontFamily: font }}
                            title="Clear the manual completion — item reverts to whatever the underlying data says">
                            ↻ Reopen
                          </button>
                        )}
                        <button type="button"
                          onClick={() => {
                            const next = isArchived ? null : new Date().toISOString();
                            saveItemField(it.id, "archived_at", next);
                            logWorksheet(it.jobId, isArchived ? `Unarchived — ${it.name}` : `Archived — ${it.name}`);
                          }}
                          style={{ fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 4, background: "transparent", border: `1px solid ${T.border}`, color: T.muted, cursor: "pointer", fontFamily: font }}
                          title="Archived items are hidden from active views">
                          {isArchived ? "Unarchive" : "Archive"}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: T.faint, marginTop: 4, lineHeight: 1.4 }}>
                      {it.completedAt ? "Manually completed. Reopen to fall back to underlying data." : "Derived from OpsHub. Mark Complete on In Stock items to release them manually."}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Notes</label>
                    <input value={it.notes || ""} onChange={e => saveItemField(it.id, "notes", e.target.value)} style={ic} />
                  </div>
                </div>
              </div>
              <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: T.faint, flex: 1, minWidth: 0 }}>
                  Cost reads from sell_per_unit (propagates to quote / invoice / portal). Retail is private to this view. {isPaid && <span style={{ color: T.green, fontWeight: 700 }}> · Paid</span>}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <Link href={`/jobs/${it.jobId}`} style={{ fontSize: 12, color: T.accent, textDecoration: "none", padding: "8px 14px", border: `1px solid ${T.border}`, borderRadius: 8, fontWeight: 600 }}>
                    Open project →
                  </Link>
                  <button onClick={close}
                    style={{ padding: "8px 16px", background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );

  if (variant === "inline") return <div style={{ fontFamily: font, color: T.text }}>{body}</div>;

  return (
    <>
      {/* Summary card — click to open the full-screen worksheet */}
      <button type="button" onClick={() => setOpen(true)}
        style={{ width: "100%", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer", textAlign: "left", fontFamily: font, color: T.text, transition: "border-color 0.15s, box-shadow 0.15s" }}
        onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
        onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Working Sheet</div>
          {wsItems.length > 0 ? (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
              <span><span style={{ color: T.muted }}>Active:</span> <strong style={{ color: T.text }}>{activeWsItems.length}</strong></span>
              <span style={{ color: T.faint }}>·</span>
              <span><span style={{ color: T.muted }}>Gross:</span> <strong style={{ color: T.text, fontFamily: mono }}>{fmtMoneyShort(rollups.active_total.gross)}</strong></span>
              <span style={{ color: T.faint }}>·</span>
              <span><span style={{ color: T.muted }}>Profit:</span> <strong style={{ color: T.green, fontFamily: mono }}>{fmtMoneyShort(rollups.active_total.profit)}</strong></span>
            </div>
          ) : (<div style={{ fontSize: 12, color: T.faint }}>No items yet.</div>)}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: "uppercase", letterSpacing: "0.07em", flexShrink: 0 }}>Open →</span>
      </button>

      {/* Full-page modal — reads like its own page (production-page pattern) */}
      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: T.bg, display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 28px", borderBottom: `1px solid ${T.border}`, background: T.card, flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Working Sheet</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.text, marginTop: 2, letterSpacing: "-0.015em" }}>{clientName}</div>
            </div>
            <button onClick={() => setOpen(false)}
              style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: "pointer", fontFamily: font }}
              title="Close (Esc)">Close ×</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 28px" }}>{body}</div>
        </div>
      )}
    </>
  );
}
