"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";

const STAGES = [
  { id: "in_production", label: "In Production" },
  { id: "shipped", label: "Shipped" },
];

type ProdItem = {
  id: string;
  name: string;
  job_id: string;
  pipeline_stage: string | null;
  ship_tracking: string | null;
  pipeline_timestamps: Record<string, string> | null;
  sort_order: number;
  blank_vendor: string | null;
  blank_sku: string | null;
  job_title: string;
  job_number: string;
  client_name: string;
  decorator_name: string | null;
  decorator_short_code: string | null;
  decorator_assignment_id: string | null;
  target_ship_date: string | null;
  total_units: number;
  proof_status: "none" | "pending" | "approved";
  decoration_type: string | null;
  sizes: string[];
  qtys: Record<string, number>;
  ship_qtys: Record<string, number>;
  ship_notes: string;
};

export default function ProductionPage() {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<ProdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterDecorator, setFilterDecorator] = useState("");
  const [filterStalled, setFilterStalled] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [bulkTracking, setBulkTracking] = useState("");
  const [bulkNotes, setBulkNotes] = useState("");
  const [sortState, setSortState] = useState<Record<string, { col: string; dir: "asc" | "desc" }>>({
    in_production: { col: "client", dir: "asc" },
    shipped: { col: "client", dir: "asc" },
  });
  const saveTimers = useRef<Record<string, any>>({});
  const now = new Date();

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, job_number, target_ship_date, phase, type_meta, clients(name)")
      .in("phase", ["production", "receiving", "fulfillment"]);

    if (!jobs?.length) { setItems([]); setLoading(false); return; }

    const jobIds = jobs.map(j => j.id);
    const jobMap: Record<string, any> = {};
    jobs.forEach(j => { jobMap[j.id] = j; });

    const { data: allItems } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered), decorator_assignments(id, pipeline_stage, decoration_type, decorators(name, short_code))")
      .in("job_id", jobIds)
      .order("sort_order");

    const itemIds = (allItems || []).map(it => it.id);
    const { data: files } = itemIds.length > 0
      ? await supabase.from("item_files").select("item_id, stage, approval").in("item_id", itemIds)
      : { data: [] };

    const proofMap: Record<string, "none" | "pending" | "approved"> = {};
    for (const it of (allItems || [])) {
      const proofs = (files || []).filter(f => f.item_id === it.id && f.stage === "proof");
      if (proofs.length === 0) proofMap[it.id] = "none";
      else if (proofs.every(f => f.approval === "approved")) proofMap[it.id] = "approved";
      else proofMap[it.id] = "pending";
    }

    const mapped: ProdItem[] = (allItems || []).map(it => {
      const job = jobMap[it.job_id];
      const assignment = it.decorator_assignments?.[0];
      const lines = it.buy_sheet_lines || [];
      const sizes = sortSizes(lines.map((l: any) => l.size));
      const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
      return {
        id: it.id, name: it.name, job_id: it.job_id,
        pipeline_stage: it.pipeline_stage === "shipped" ? "shipped" : "in_production",
        ship_tracking: it.ship_tracking,
        pipeline_timestamps: it.pipeline_timestamps || {},
        sort_order: it.sort_order || 0,
        blank_vendor: it.blank_vendor, blank_sku: it.blank_sku,
        job_title: job?.title || "", job_number: job?.job_number || "",
        client_name: job?.clients?.name || "",
        decorator_name: assignment?.decorators?.name || null,
        decorator_short_code: assignment?.decorators?.short_code || null,
        decorator_assignment_id: assignment?.id || null,
        target_ship_date: job?.target_ship_date || null,
        total_units: lines.reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0),
        proof_status: proofMap[it.id] || "none",
        decoration_type: assignment?.decoration_type || null,
        sizes, qtys,
        ship_qtys: it.ship_qtys || {},
        ship_notes: it.ship_notes || job?.type_meta?.shipping_notes || "",
      };
    });

    setItems(mapped);
    setLoading(false);
  }

  function updateTrackingLocal(itemId: string, value: string) {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, ship_tracking: value } : it));
    if (saveTimers.current[`trk_${itemId}`]) clearTimeout(saveTimers.current[`trk_${itemId}`]);
    saveTimers.current[`trk_${itemId}`] = setTimeout(() => {
      supabase.from("items").update({ ship_tracking: value }).eq("id", itemId);
    }, 800);
  }

  function updateShipQty(itemId: string, size: string, qty: number) {
    setItems(prev => prev.map(it => {
      if (it.id !== itemId) return it;
      const updated = { ...it.ship_qtys, [size]: qty };
      return { ...it, ship_qtys: updated };
    }));
    if (saveTimers.current[`sq_${itemId}`]) clearTimeout(saveTimers.current[`sq_${itemId}`]);
    saveTimers.current[`sq_${itemId}`] = setTimeout(() => {
      const item = items.find(it => it.id === itemId);
      if (!item) return;
      const updated = { ...item.ship_qtys, [size]: qty };
      supabase.from("items").update({ ship_qtys: updated }).eq("id", itemId);
    }, 800);
  }

  function handleSelect(itemId: string, e: React.MouseEvent, stageItems: ProdItem[]) {
    const isShift = e.shiftKey;
    setSelected(prev => {
      const next = new Set(prev);
      if (isShift && lastClicked) {
        const ids = stageItems.map(it => it.id);
        const from = ids.indexOf(lastClicked);
        const to = ids.indexOf(itemId);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let i = start; i <= end; i++) next.add(ids[i]);
        }
      } else {
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
      }
      return next;
    });
    setLastClicked(itemId);
  }

  async function bulkShip() {
    const selectedItems = items.filter(it => selected.has(it.id) && it.pipeline_stage === "in_production");
    if (selectedItems.length === 0) return;

    const ts = new Date().toISOString();
    for (const item of selectedItems) {
      const timestamps = { ...(item.pipeline_timestamps || {}), shipped: ts };
      await supabase.from("items").update({
        pipeline_stage: "shipped",
        pipeline_timestamps: timestamps,
        ship_tracking: bulkTracking || item.ship_tracking || null,
        ship_notes: bulkNotes || item.ship_notes || null,
      }).eq("id", item.id);
      if (item.decorator_assignment_id) {
        await supabase.from("decorator_assignments").update({ pipeline_stage: "shipped" }).eq("id", item.decorator_assignment_id);
      }
      logJobActivity(item.job_id, `${item.name} shipped from decorator${bulkTracking ? ` — tracking: ${bulkTracking}` : ""}`);
    }
    // One team notification for the batch
    const jobIds = [...new Set(selectedItems.map(it => it.job_id))];
    for (const jid of jobIds) {
      const jobItems = selectedItems.filter(it => it.job_id === jid);
      notifyTeam(`${jobItems.length} items shipped from decorator — incoming to warehouse`, "production", jid, "job");
    }

    setItems(prev => prev.map(it => {
      if (!selected.has(it.id)) return it;
      return { ...it, pipeline_stage: "shipped", pipeline_timestamps: { ...(it.pipeline_timestamps || {}), shipped: ts }, ship_tracking: bulkTracking || it.ship_tracking, ship_notes: bulkNotes || it.ship_notes };
    }));
    setSelected(new Set());
    setShowBulkPanel(false);
    setBulkTracking("");
    setBulkNotes("");
  }

  function updateNotesLocal(itemId: string, value: string) {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, ship_notes: value } : it));
    if (saveTimers.current[`sn_${itemId}`]) clearTimeout(saveTimers.current[`sn_${itemId}`]);
    saveTimers.current[`sn_${itemId}`] = setTimeout(() => {
      supabase.from("items").update({ ship_notes: value }).eq("id", itemId);
    }, 800);
  }

  async function markShipped(item: ProdItem) {
    const timestamps = { ...(item.pipeline_timestamps || {}), shipped: new Date().toISOString() };
    await supabase.from("items").update({ pipeline_stage: "shipped", pipeline_timestamps: timestamps, ship_notes: item.ship_notes || null }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: "shipped" }).eq("id", item.decorator_assignment_id);
    }
    logJobActivity(item.job_id, `${item.name} shipped from decorator${item.ship_tracking ? ` — tracking: ${item.ship_tracking}` : ""}`);
    notifyTeam(`Item shipped from decorator — ${item.name} incoming to warehouse`, "production", item.job_id, "job");
    setItems(prev => prev.map(it => it.id === item.id ? { ...it, pipeline_stage: "shipped", pipeline_timestamps: timestamps } : it));
    setExpandedItem(null);
  }

  async function undoShipped(item: ProdItem) {
    const timestamps = { ...(item.pipeline_timestamps || {}) };
    delete timestamps.shipped;
    await supabase.from("items").update({ pipeline_stage: "in_production", pipeline_timestamps: timestamps }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("id", item.decorator_assignment_id);
    }
    setItems(prev => prev.map(it => it.id === item.id ? { ...it, pipeline_stage: "in_production", pipeline_timestamps: timestamps } : it));
  }

  const decorators = useMemo(() => [...new Set(items.map(it => it.decorator_name).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return items.filter(it => {
      if (q && !(it.name.toLowerCase().includes(q) || it.client_name.toLowerCase().includes(q) || it.job_title.toLowerCase().includes(q) || (it.decorator_name || "").toLowerCase().includes(q))) return false;
      if (filterDecorator && it.decorator_name !== filterDecorator) return false;
      if (filterStalled) {
        const ts = it.pipeline_timestamps?.[it.pipeline_stage || ""];
        if (!ts) return true;
        return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) >= 7;
      }
      return true;
    });
  }, [items, search, filterDecorator, filterStalled]);

  const atDecorator = items.filter(it => it.pipeline_stage === "in_production").length;
  const stalled = items.filter(it => {
    const ts = it.pipeline_timestamps?.[it.pipeline_stage || ""];
    if (!ts) return false;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) >= 7;
  }).length;
  const shippingThisWeek = items.filter(it => {
    if (!it.target_ship_date) return false;
    const diff = Math.ceil((new Date(it.target_ship_date).getTime() - now.getTime()) / 86400000);
    return diff >= 0 && diff <= 7;
  }).length;

  const getDaysInStage = (item: ProdItem) => {
    const ts = item.pipeline_timestamps?.[item.pipeline_stage || ""];
    if (!ts) return null;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  };

  const getDaysToShip = (item: ProdItem) => {
    if (!item.target_ship_date) return null;
    return Math.ceil((new Date(item.target_ship_date).getTime() - now.getTime()) / 86400000);
  };

  const toggleSort = (stageId: string, col: string) => {
    setSortState(prev => {
      const cur = prev[stageId] || { col: "client", dir: "asc" };
      if (cur.col === col) return { ...prev, [stageId]: { col, dir: cur.dir === "asc" ? "desc" : "asc" } };
      return { ...prev, [stageId]: { col, dir: "asc" } };
    });
  };

  const sortItems = (list: ProdItem[], stageId: string) => {
    const { col, dir } = sortState[stageId] || { col: "client", dir: "asc" };
    const d = dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (col) {
        case "units": return (a.total_units - b.total_units) * d;
        case "shipdate": return ((getDaysToShip(a) ?? 999) - (getDaysToShip(b) ?? 999)) * d;
        case "instage": return ((getDaysInStage(a) ?? 0) - (getDaysInStage(b) ?? 0)) * d;
        default: {
          const av = col === "client" ? a.client_name : col === "project" ? a.job_title : col === "item" ? a.name : (a.decorator_short_code || a.decorator_name || "");
          const bv = col === "client" ? b.client_name : col === "project" ? b.job_title : col === "item" ? b.name : (b.decorator_short_code || b.decorator_name || "");
          return (av || "").localeCompare(bv || "") * d;
        }
      }
    });
  };

  const ic: React.CSSProperties = { padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 11, fontFamily: mono, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading production...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Production</h1>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{items.length} items across {new Set(items.map(it => it.job_id)).size} projects</div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "At decorator", count: atDecorator, color: T.accent },
          { label: "Stalled 7+ days", count: stalled, color: stalled > 0 ? T.red : T.faint },
          { label: "Shipping this week", count: shippingThisWeek, color: T.accent },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.count > 0 ? s.color : T.faint, fontFamily: mono }}>{s.count}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items, clients, projects..."
          style={{ flex: 1, maxWidth: 320, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
        <select value={filterDecorator} onChange={e => setFilterDecorator(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: filterDecorator ? T.text : T.muted, fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">All decorators</option>
          {decorators.map(d => <option key={d} value={d!}>{d}</option>)}
        </select>
        <button onClick={() => setFilterStalled(!filterStalled)}
          style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${filterStalled ? T.red : T.border}`, background: filterStalled ? T.redDim : T.surface, color: filterStalled ? T.red : T.muted, fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
          Stalled only
        </button>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div style={{ background: T.accent + "22", border: `1px solid ${T.accent}44`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.accent }}>{selected.size} selected</span>
          <button onClick={() => setShowBulkPanel(!showBulkPanel)}
            style={{ padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600 }}>
            Bulk Ship
          </button>
          <button onClick={() => { setSelected(new Set()); setShowBulkPanel(false); }}
            style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 12 }}>
            Clear
          </button>
        </div>
      )}

      {/* Bulk ship panel */}
      {showBulkPanel && selected.size > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Ship {selected.size} items as one batch</div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ width: 200 }}>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Tracking # (all items)</label>
              <input style={{ ...ic, width: "100%" }} value={bulkTracking} placeholder="Enter tracking"
                onChange={e => setBulkTracking(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes (carries to receiving)</label>
              <input style={{ ...ic, width: "100%" }} value={bulkNotes} placeholder="e.g. 2 boxes, fragile, check qty on Box B"
                onChange={e => setBulkNotes(e.target.value)} />
            </div>
            <button onClick={bulkShip}
              style={{ padding: "8px 24px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
              Ship All
            </button>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
            {items.filter(it => selected.has(it.id)).map(it => (
              <span key={it.id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: T.surface, color: T.muted }}>
                {it.client_name} · {it.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Stage sections */}
      {STAGES.map(stage => {
        const stageItems = sortItems(filtered.filter(it => it.pipeline_stage === stage.id), stage.id);
        if (stageItems.length === 0 && search) return null;

        const cols = stage.id === "in_production"
          ? "28px 1.2fr 1.2fr 1.5fr 1fr 60px 70px 60px 80px"
          : "1.2fr 1.2fr 1.5fr 1fr 60px 100px 60px 80px";

        return (
          <div key={stage.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{stage.label}</span>
              <span style={{ fontSize: 11, fontFamily: mono, color: T.accent, fontWeight: 600 }}>{stageItems.length}</span>
            </div>

            {stageItems.length === 0 ? (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "16px", textAlign: "center", fontSize: 12, color: T.faint }}>
                No items
              </div>
            ) : (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                {/* Header */}
                <div style={{ display: "grid", gridTemplateColumns: cols, padding: "6px 14px", background: T.surface, borderBottom: `1px solid ${T.border}`, alignItems: "center" }}>
                  {stage.id === "in_production" && (
                    <input type="checkbox"
                      checked={stageItems.length > 0 && stageItems.every(it => selected.has(it.id))}
                      onChange={e => {
                        setSelected(prev => {
                          const next = new Set(prev);
                          stageItems.forEach(it => e.target.checked ? next.add(it.id) : next.delete(it.id));
                          return next;
                        });
                      }}
                      style={{ width: 14, height: 14, cursor: "pointer", accentColor: T.accent }} />
                  )}
                  {[
                    { label: "Client", key: "client" },
                    { label: "Project", key: "project" },
                    { label: "Item", key: "item" },
                    { label: "Decorator", key: "decorator" },
                    { label: "Units", key: "units" },
                    { label: stage.id === "shipped" ? "Tracking" : "Ship date", key: "shipdate" },
                    { label: "In stage", key: "instage" },
                    { label: "", key: "" },
                  ].map(h => {
                    const ss = sortState[stage.id] || { col: "client", dir: "asc" };
                    return (
                      <div key={h.label || "actions"} onClick={() => h.key && toggleSort(stage.id, h.key)}
                        style={{ fontSize: 9, fontWeight: 700, color: ss.col === h.key ? T.accent : T.muted, textTransform: "uppercase", letterSpacing: "0.07em", cursor: h.key ? "pointer" : "default", userSelect: "none" }}>
                        {h.label}{ss.col === h.key ? (ss.dir === "asc" ? " ↑" : " ↓") : ""}
                      </div>
                    );
                  })}
                </div>

                {stageItems.map((item, i) => {
                  const days = getDaysInStage(item);
                  const daysToShip = getDaysToShip(item);
                  const isExpanded = expandedItem === item.id;

                  return (
                    <div key={item.id} style={{ borderBottom: i < stageItems.length - 1 ? `1px solid ${T.border}` : "none" }}>
                      {/* Main row */}
                      <div style={{
                        display: "grid", gridTemplateColumns: cols, padding: "8px 14px", alignItems: "center",
                        cursor: stage.id === "in_production" ? "pointer" : "default",
                        background: isExpanded ? T.surface + "66" : selected.has(item.id) ? T.accent + "11" : "transparent",
                      }}
                        onClick={() => stage.id === "in_production" && setExpandedItem(isExpanded ? null : item.id)}
                      >
                        {stage.id === "in_production" && (
                          <input type="checkbox" checked={selected.has(item.id)}
                            onClick={e => { e.stopPropagation(); handleSelect(item.id, e as any, stageItems); }}
                            onChange={() => {}}
                            style={{ width: 14, height: 14, cursor: "pointer", accentColor: T.accent }} />
                        )}
                        <div style={{ fontSize: 12, color: T.text }}>{item.client_name}</div>
                        <div style={{ fontSize: 12, color: T.muted, cursor: "pointer" }} onClick={e => { e.stopPropagation(); router.push(`/jobs/${item.job_id}`); }}>{item.job_title}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                          <div style={{ fontSize: 10, color: T.faint }}>{[item.blank_vendor, item.decoration_type].filter(Boolean).join(" · ")}</div>
                        </div>
                        <div style={{ fontSize: 11, color: item.decorator_short_code || item.decorator_name ? T.accent : T.faint }}>{item.decorator_short_code || item.decorator_name || "—"}</div>
                        <div style={{ fontSize: 12, fontFamily: mono, fontWeight: 600 }}>{item.total_units.toLocaleString()}</div>
                        <div>
                          {stage.id === "in_production" && (
                            daysToShip !== null ? (
                              <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 600, color: daysToShip < 0 ? T.red : daysToShip <= 3 ? T.amber : T.muted }}>
                                {daysToShip < 0 ? `${Math.abs(daysToShip)}d over` : daysToShip === 0 ? "today" : `${daysToShip}d`}
                              </span>
                            ) : <span style={{ fontSize: 10, color: T.faint }}>—</span>
                          )}
                          {stage.id === "shipped" && (
                            <span style={{ fontSize: 10, fontFamily: mono, color: item.ship_tracking ? T.green : T.faint }}>
                              {item.ship_tracking || "—"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: mono, fontWeight: 600, color: days === null ? T.faint : days >= 7 ? T.red : days >= 3 ? T.amber : T.muted }}>
                          {days === null ? "—" : `${days}d`}
                        </div>
                        <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                          {stage.id === "in_production" && (
                            <span style={{ fontSize: 10, color: T.faint }}>{isExpanded ? "▾" : "Ship ›"}</span>
                          )}
                          {stage.id === "shipped" && (
                            <button onClick={() => undoShipped(item)}
                              style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                              Undo
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded: tracking + shipped qtys */}
                      {isExpanded && stage.id === "in_production" && (
                        <div style={{ padding: "10px 14px 14px", background: T.surface + "44", borderTop: `1px solid ${T.border}44`, display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                            <div style={{ width: 180 }}>
                              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Tracking #</label>
                              <input style={{ ...ic, width: "100%" }} value={item.ship_tracking || ""} placeholder="Enter tracking"
                                onChange={e => updateTrackingLocal(item.id, e.target.value)}
                                onClick={e => e.stopPropagation()} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes (carries to receiving)</label>
                              <input style={{ ...ic, width: "100%" }} value={item.ship_notes || ""} placeholder="e.g. 2 boxes, check qty, fragile"
                                onChange={e => updateNotesLocal(item.id, e.target.value)}
                                onClick={e => e.stopPropagation()} />
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Shipped qty per size</label>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {item.sizes.map(sz => (
                                  <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                    <span style={{ fontSize: 8, color: T.faint, fontFamily: mono }}>{sz}</span>
                                    <input type="number" min="0" value={item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0}
                                      onChange={e => updateShipQty(item.id, sz, parseInt(e.target.value) || 0)}
                                      onFocus={e => e.target.select()}
                                      onClick={e => e.stopPropagation()}
                                      style={{ width: 36, textAlign: "center", padding: "2px", border: `1px solid ${T.border}`, borderRadius: 3, background: T.surface, color: T.text, fontSize: 10, fontFamily: mono, outline: "none" }} />
                                  </div>
                                ))}
                              </div>
                            </div>
                            <button onClick={e => { e.stopPropagation(); markShipped(item); }}
                              style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                              Mark Shipped
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
