"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { deductSamples } from "@/lib/qty";

type InventoryLine = {
  id: string;
  source_type: "labs_item" | "outside_shipment" | "preexisting";
  source_item_id: string | null;
  source_shipment_id: string | null;
  description: string | null;
  qtys: Record<string, number>;
  notes: string | null;
  webstore_entered_at: string | null;
  sort_order: number;
  // hydrated client-side
  display_name: string;
  display_meta: string | null;
  effective_qtys: Record<string, number>;
  sizes: string[];
  total: number;
  source_job_id: string | null;
  // Labs-only: pipeline state of the underlying item
  item_status: "at_decorator" | "in_transit" | "received" | "unknown" | null;
  qty_is_expected: boolean;
};

type FulfillmentProject = {
  id: string;
  client_id: string | null;
  name: string;
  store_name: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  client_name: string;
  logs: DailyLog[];
  lines: InventoryLine[];
};

type DailyLog = {
  id: string;
  log_date: string;
  starting_orders: number;
  orders_shipped: number;
  remaining_orders: number;
  notes: string | null;
};

type AvailableItem = {
  id: string;
  name: string;
  job_id: string;
  job_title: string;
  client_id: string | null;
  client_name: string;
  total: number;
  status: "at_decorator" | "in_transit" | "received" | "unknown";
  qty_is_expected: boolean;
};

type AvailableShipment = {
  id: string;
  description: string | null;
  sender: string | null;
  carrier: string | null;
  tracking: string | null;
  received_at: string;
};

type PickerState = {
  projectId: string;
  mode: "labs" | "outside" | "preexisting";
};

export default function FulfillmentPage() {
  const supabase = createClient();
  const [projects, setProjects] = useState<FulfillmentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", store_name: "", client_id: "", notes: "" });
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [outsideShipments, setOutsideShipments] = useState<any[]>([]);
  const [logForm, setLogForm] = useState<Record<string, { starting: string; shipped: string; remaining: string; notes: string }>>({});
  const [tab, setTab] = useState<"active" | "complete">("active");
  // Inventory picker state — only one open at a time
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [availableItems, setAvailableItems] = useState<AvailableItem[]>([]);
  const [availableShipments, setAvailableShipments] = useState<AvailableShipment[]>([]);
  const [preForm, setPreForm] = useState({ description: "", qtys: "", notes: "" });
  const [shipQtyInput, setShipQtyInput] = useState<Record<string, string>>({});
  const [pickerFilter, setPickerFilter] = useState({ search: "", clientId: "", jobId: "" });
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  useEffect(() => { loadAll(); }, []);

  function hydrateLine(row: any): InventoryLine {
    let display_name = "";
    let display_meta: string | null = null;
    let effective_qtys: Record<string, number> = {};
    let sizes: string[] = [];
    let source_job_id: string | null = null;
    let item_status: InventoryLine["item_status"] = null;
    let qty_is_expected = false;

    if (row.source_type === "labs_item" && row.items) {
      source_job_id = row.items.job_id || null;
      const item = row.items;
      display_name = item.name;
      const bsl = item.buy_sheet_lines || [];
      const orderedSizes = bsl.map((l: any) => l.size);
      const rq = item.received_qtys || {};
      const hasReceivedQtys = Object.keys(rq).length > 0;
      // Item state drives status badge + whether qty is "expected" or actual.
      if (item.received_at_hpd) item_status = "received";
      else if (item.pipeline_stage === "shipped") item_status = "in_transit";
      else if (item.pipeline_stage === "in_production") item_status = "at_decorator";
      else item_status = "unknown";
      qty_is_expected = !hasReceivedQtys;
      // Use received qtys when available, fall back to ordered qty otherwise
      const delivered: Record<string, number> = {};
      for (const l of bsl) {
        delivered[l.size] = rq[l.size] ?? l.qty_ordered ?? 0;
      }
      effective_qtys = deductSamples(delivered, item.sample_qtys);
      sizes = sortSizes(orderedSizes);
    } else if (row.source_type === "outside_shipment" && row.outside_shipments) {
      const sh = row.outside_shipments;
      display_name = sh.description || sh.sender || "Outside shipment";
      display_meta = [sh.sender, sh.carrier, sh.tracking].filter(Boolean).join(" · ") || null;
      effective_qtys = row.qtys || {};
      sizes = sortSizes(Object.keys(effective_qtys));
    } else if (row.source_type === "preexisting") {
      display_name = row.description || "Pre-existing inventory";
      display_meta = row.notes;
      effective_qtys = row.qtys || {};
      sizes = sortSizes(Object.keys(effective_qtys));
    } else {
      // Source row missing (item/shipment deleted) — show stub.
      display_name = row.description || "(source unavailable)";
      effective_qtys = row.qtys || {};
      sizes = sortSizes(Object.keys(effective_qtys));
    }

    const total = Object.values(effective_qtys).reduce((a, v) => a + (Number(v) || 0), 0);
    return {
      id: row.id,
      source_type: row.source_type,
      source_item_id: row.source_item_id,
      source_shipment_id: row.source_shipment_id,
      description: row.description,
      qtys: row.qtys || {},
      notes: row.notes,
      webstore_entered_at: row.webstore_entered_at,
      sort_order: row.sort_order || 0,
      display_name, display_meta, effective_qtys, sizes, total, source_job_id,
      item_status, qty_is_expected,
    };
  }

  async function loadAll() {
    setLoading(true);

    const [projRes, clientRes, invRes] = await Promise.all([
      // Ecomm-mode projects live at /ecomm; this page shows manual/legacy fulfillment only.
      supabase.from("fulfillment_projects")
        .select("*, clients(name), fulfillment_daily_logs(*)")
        .is("mode", null)
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("fulfillment_inventory")
        .select("*, items:source_item_id(id, name, job_id, sort_order, pipeline_stage, received_at_hpd, received_qtys, sample_qtys, buy_sheet_lines(size, qty_ordered)), outside_shipments:source_shipment_id(id, description, sender, carrier, tracking)")
        .order("sort_order"),
    ]);

    const linesByProject: Record<string, InventoryLine[]> = {};
    for (const row of (invRes.data || [])) {
      const line = hydrateLine(row);
      if (!linesByProject[row.project_id]) linesByProject[row.project_id] = [];
      linesByProject[row.project_id].push(line);
    }

    const mapped = (projRes.data || []).map((p: any) => ({
      ...p,
      client_name: p.clients?.name || "Unknown",
      logs: (p.fulfillment_daily_logs || []).sort((a: any, b: any) => b.log_date.localeCompare(a.log_date)),
      lines: linesByProject[p.id] || [],
    }));
    setProjects(mapped);
    setClients(clientRes.data || []);

    // Outside shipments routed to staging — exclude any already linked to a project
    const linkedShipmentIds = new Set((invRes.data || []).filter(r => r.source_shipment_id).map(r => r.source_shipment_id));
    const { data: outsideData } = await supabase.from("outside_shipments").select("*").eq("route", "stage").order("received_at", { ascending: false });
    setOutsideShipments((outsideData || []).filter((s: any) => !linkedShipmentIds.has(s.id)));

    setLoading(false);
  }

  async function createProject() {
    if (!newForm.name.trim()) return;
    await supabase.from("fulfillment_projects").insert({
      name: newForm.name.trim(),
      store_name: newForm.store_name.trim() || null,
      client_id: newForm.client_id || null,
      notes: newForm.notes.trim() || null,
    });
    setNewForm({ name: "", store_name: "", client_id: "", notes: "" });
    setShowNew(false);
    loadAll();
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from("fulfillment_projects").update({ status }).eq("id", id);
    setProjects(prev => prev.map(p => p.id === id ? { ...p, status } : p));
  }

  async function submitLog(projectId: string) {
    const f = logForm[projectId];
    if (!f) return;
    const today = new Date().toISOString().split("T")[0];
    const starting = parseInt(f.starting) || 0;
    const remaining = parseInt(f.remaining) || 0;
    await supabase.from("fulfillment_daily_logs").upsert({
      project_id: projectId,
      log_date: today,
      starting_orders: starting,
      orders_shipped: Math.max(0, starting - remaining),
      remaining_orders: remaining,
      notes: f.notes?.trim() || null,
    }, { onConflict: "project_id,log_date" });
    setLogForm(prev => ({ ...prev, [projectId]: { starting: "", shipped: "", remaining: "", notes: "" } }));
    loadAll();
  }

  // Parse "S:24, M:32, L:18" into { S: 24, M: 32, L: 18 }
  function parseQtys(input: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const chunk of input.split(/[,\n]/)) {
      const m = chunk.trim().match(/^([A-Za-z0-9.]+)\s*[:=]\s*(\d+)/);
      if (m) out[m[1].toUpperCase()] = parseInt(m[2]);
    }
    return out;
  }

  async function openPicker(projectId: string, mode: PickerState["mode"]) {
    setPicker({ projectId, mode });
    setPreForm({ description: "", qtys: "", notes: "" });
    setShipQtyInput({});

    // Default filters: when the fulfillment project has a client set, pre-narrow
    // the picker to that client. User can clear/override via the filter row.
    const proj = projects.find(p => p.id === projectId);
    setPickerFilter({ search: "", clientId: proj?.client_id || "", jobId: "" });
    setSelectedItemIds(new Set());

    if (mode === "labs") {
      const linkedItemIds = new Set((proj?.lines || []).filter(l => l.source_item_id).map(l => l.source_item_id));
      // Pull any item from a non-cancelled job — Labs FOH may want to attach
      // items at quote time before they exist physically.
      const { data } = await supabase
        .from("items")
        .select("id, name, job_id, pipeline_stage, received_at_hpd, received_qtys, sample_qtys, buy_sheet_lines(qty_ordered, size), jobs!inner(id, title, phase, client_id, clients(id, name))")
        .not("jobs.phase", "in", '("cancelled")');
      const hydrated: AvailableItem[] = (data || [])
        .filter((it: any) => !linkedItemIds.has(it.id))
        .map((it: any) => {
          const lines = it.buy_sheet_lines || [];
          const rq = it.received_qtys || {};
          const hasReceivedQtys = Object.keys(rq).length > 0;
          const delivered: Record<string, number> = {};
          for (const l of lines) {
            delivered[l.size] = rq[l.size] ?? l.qty_ordered ?? 0;
          }
          const continuing = deductSamples(delivered, it.sample_qtys);
          const total = Object.values(continuing).reduce((a, v) => a + v, 0);
          let status: AvailableItem["status"] = "unknown";
          if (it.received_at_hpd) status = "received";
          else if (it.pipeline_stage === "shipped") status = "in_transit";
          else if (it.pipeline_stage === "in_production") status = "at_decorator";
          return {
            id: it.id, name: it.name, job_id: it.job_id,
            job_title: it.jobs?.title || "",
            client_id: it.jobs?.client_id || null,
            client_name: it.jobs?.clients?.name || "",
            total,
            status,
            qty_is_expected: !hasReceivedQtys,
          };
        });
      setAvailableItems(hydrated);
    } else if (mode === "outside") {
      const linkedShipmentIds = new Set(projects.flatMap(p => p.lines.filter(l => l.source_shipment_id).map(l => l.source_shipment_id)));
      const { data } = await supabase
        .from("outside_shipments")
        .select("id, description, sender, carrier, tracking, received_at")
        .eq("route", "stage")
        .order("received_at", { ascending: false });
      setAvailableShipments((data || []).filter((s: any) => !linkedShipmentIds.has(s.id)));
    }
  }

  function toggleItemSelected(itemId: string) {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function addSelectedLabsItems() {
    if (!picker || selectedItemIds.size === 0) return;
    const rows = Array.from(selectedItemIds).map((itemId, idx) => ({
      project_id: picker.projectId,
      source_type: "labs_item",
      source_item_id: itemId,
      qtys: {},
      sort_order: idx,
    }));
    await supabase.from("fulfillment_inventory").insert(rows);
    setPicker(null);
    setSelectedItemIds(new Set());
    loadAll();
  }

  async function addOutsideShipment(shipmentId: string) {
    if (!picker) return;
    const qtys = parseQtys(shipQtyInput[shipmentId] || "");
    await supabase.from("fulfillment_inventory").insert({
      project_id: picker.projectId,
      source_type: "outside_shipment",
      source_shipment_id: shipmentId,
      qtys,
    });
    setPicker(null);
    setShipQtyInput({});
    loadAll();
  }

  async function addPreexisting() {
    if (!picker) return;
    if (!preForm.description.trim()) return;
    const qtys = parseQtys(preForm.qtys);
    await supabase.from("fulfillment_inventory").insert({
      project_id: picker.projectId,
      source_type: "preexisting",
      description: preForm.description.trim(),
      qtys,
      notes: preForm.notes.trim() || null,
    });
    setPicker(null);
    setPreForm({ description: "", qtys: "", notes: "" });
    loadAll();
  }

  async function removeLine(lineId: string) {
    if (!confirm("Remove this inventory line?")) return;
    await supabase.from("fulfillment_inventory").delete().eq("id", lineId);
    loadAll();
  }

  async function toggleWebstoreReady(line: InventoryLine) {
    const newValue = line.webstore_entered_at ? null : new Date().toISOString();
    await supabase.from("fulfillment_inventory")
      .update({ webstore_entered_at: newValue })
      .eq("id", line.id);
    loadAll();
  }

  const activeProjects = projects.filter(p => p.status === "staging" || p.status === "active");
  const completedProjects = projects.filter(p => p.status === "complete");
  const totalRemaining = activeProjects.reduce((a, p) => {
    const latest = p.logs[0];
    return a + (latest?.remaining_orders || 0);
  }, 0);
  const totalUnitsInProjects = activeProjects.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.total, 0), 0);
  const unlinkedOutsideCount = outsideShipments.length;

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Fulfillment</h1>

      {/* Stats — fulfillment is about what's in the building, not what's coming.
          Items in production live on /production, items in transit on /receiving. */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "Active projects", value: activeProjects.length, color: T.accent },
          { label: "Orders remaining", value: totalRemaining, color: totalRemaining > 0 ? T.amber : T.faint },
          { label: "Units staged", value: totalUnitsInProjects, color: totalUnitsInProjects > 0 ? T.green : T.faint },
          { label: "Outside · unlinked", value: unlinkedOutsideCount, color: unlinkedOutsideCount > 0 ? T.amber : T.faint },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.value > 0 ? s.color : T.faint, fontFamily: mono }}>{s.value}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: 4, background: T.surface, borderRadius: 8 }}>
        {([
          { id: "active" as const, label: "Active", count: activeProjects.length },
          { id: "complete" as const, label: "Completed", count: completedProjects.length },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: tab === t.id ? T.accent : "transparent", color: tab === t.id ? "#fff" : T.muted }}>
            {t.label}
            {t.count > 0 && <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, padding: "1px 6px", borderRadius: 99, background: tab === t.id ? "rgba(255,255,255,0.2)" : T.card, color: tab === t.id ? "#fff" : T.accent }}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── ACTIVE PROJECTS ── */}
      {tab === "active" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={() => setShowNew(!showNew)}
            style={{ alignSelf: "flex-start", padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: font }}>
            + New Fulfillment Project
          </button>

          {showNew && (
            <div style={{ ...card, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>New Project</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Project name *</label>
                  <input style={ic} value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Nike Summer Drop" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Client</label>
                  <select style={ic} value={newForm.client_id} onChange={e => setNewForm(f => ({ ...f, client_id: e.target.value }))}>
                    <option value="">— select —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Shopify store</label>
                  <input style={ic} value={newForm.store_name} onChange={e => setNewForm(f => ({ ...f, store_name: e.target.value }))} placeholder="e.g. nike-merch.myshopify.com" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
                  <input style={ic} value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any details" />
                </div>
              </div>
              <div style={{ fontSize: 10, color: T.faint, marginBottom: 10, fontStyle: "italic" }}>
                Inventory is added line-by-line after the project is created — pull from a Labs job, attach an outside shipment, or enter pre-existing stock.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={createProject} disabled={!newForm.name.trim()}
                  style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600, opacity: newForm.name.trim() ? 1 : 0.5 }}>
                  Create
                </button>
                <button onClick={() => setShowNew(false)}
                  style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 12 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {activeProjects.length === 0 && !showNew && (
            <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
              No active fulfillment projects. Create one to start tracking.
            </div>
          )}

          {activeProjects.map(proj => {
            const isExpanded = expandedProject === proj.id;
            const latestLog = proj.logs[0];
            const todayStr = new Date().toISOString().split("T")[0];
            const hasLogToday = latestLog?.log_date === todayStr;
            const lf = logForm[proj.id] || { starting: "", shipped: "", remaining: "", notes: "" };
            const totalShipped = proj.logs.reduce((a, l) => a + l.orders_shipped, 0);
            const totalUnits = proj.lines.reduce((a, l) => a + l.total, 0);
            const readyUnits = proj.lines.filter(l => l.webstore_entered_at).reduce((a, l) => a + l.total, 0);

            return (
              <div key={proj.id} style={card}>
                {/* Header */}
                <div onClick={() => setExpandedProject(isExpanded ? null : proj.id)}
                  style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{proj.name}</span>
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: proj.status === "active" ? T.greenDim : T.amberDim, color: proj.status === "active" ? T.green : T.amber, fontWeight: 600 }}>
                        {proj.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {proj.client_name}{proj.store_name ? ` · ${proj.store_name}` : ""}
                    </div>
                  </div>
                  {/* Quick stats */}
                  <div style={{ display: "flex", gap: 16, flexShrink: 0, alignItems: "center" }}>
                    {totalUnits > 0 && (
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: mono, color: T.text }}>{totalUnits.toLocaleString()}</div>
                        <div style={{ fontSize: 8, color: T.faint }}>{readyUnits === totalUnits ? "units ready" : `${readyUnits.toLocaleString()} / ${totalUnits.toLocaleString()} ready`}</div>
                      </div>
                    )}
                    {latestLog && (
                      <>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: mono, color: latestLog.remaining_orders > 0 ? T.amber : T.green }}>{latestLog.remaining_orders}</div>
                          <div style={{ fontSize: 8, color: T.faint }}>remaining</div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: mono, color: T.green }}>{totalShipped}</div>
                          <div style={{ fontSize: 8, color: T.faint }}>total shipped</div>
                        </div>
                      </>
                    )}
                    {!hasLogToday && proj.status === "active" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: T.redDim, color: T.red, fontWeight: 600 }}>No log today</span>}
                    <span style={{ fontSize: 10, color: T.faint }}>{isExpanded ? "▾" : "›"}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${T.border}`, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                    {/* Status buttons */}
                    <div style={{ display: "flex", gap: 6 }}>
                      {["staging", "active", "complete"].map(s => (
                        <button key={s} onClick={() => updateStatus(proj.id, s)}
                          style={{ padding: "4px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${proj.status === s ? T.accent : T.border}`, background: proj.status === s ? T.accentDim : "transparent", color: proj.status === s ? T.accent : T.muted, textTransform: "capitalize" }}>
                          {s}
                        </button>
                      ))}
                      <div style={{ flex: 1 }} />
                      <button onClick={async () => {
                        if (!confirm("Delete this fulfillment project?")) return;
                        await supabase.from("fulfillment_projects").delete().eq("id", proj.id);
                        setProjects(prev => prev.filter(p => p.id !== proj.id));
                      }} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${T.border}`, background: "transparent", color: T.faint }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.red; e.currentTarget.style.borderColor = T.red; }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.faint; e.currentTarget.style.borderColor = T.border; }}>
                        Delete
                      </button>
                    </div>

                    {proj.notes && <div style={{ fontSize: 11, color: T.muted, padding: "6px 10px", background: T.surface, borderRadius: 6 }}>{proj.notes}</div>}

                    {/* Inventory section */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          Inventory
                          {totalUnits > 0 && <span style={{ marginLeft: 8, color: T.text, fontWeight: 700, fontFamily: mono }}>{totalUnits.toLocaleString()} units</span>}
                          {totalUnits > 0 && readyUnits < totalUnits && <span style={{ marginLeft: 6, color: T.amber, fontFamily: mono }}>· {(totalUnits - readyUnits).toLocaleString()} not in webstore</span>}
                          {totalUnits > 0 && readyUnits === totalUnits && <span style={{ marginLeft: 6, color: T.green }}>· all in webstore</span>}
                        </div>
                        <button onClick={() => openPicker(proj.id, "labs")}
                          style={{ fontSize: 10, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.muted, cursor: "pointer" }}>
                          + Add inventory
                        </button>
                      </div>

                      {proj.lines.length === 0 ? (
                        <div style={{ padding: "12px 10px", background: T.surface, borderRadius: 6, fontSize: 11, color: T.faint, textAlign: "center" }}>
                          No inventory yet. Add a Labs item, an outside shipment, or pre-existing stock.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {proj.lines.map(line => {
                            const sourceBadge =
                              line.source_type === "labs_item" ? { label: "Labs", color: T.accent, bg: T.accentDim } :
                              line.source_type === "outside_shipment" ? { label: "Outside", color: T.purple, bg: "rgba(160,90,200,0.15)" } :
                              { label: "Stock", color: T.amber, bg: T.amberDim };
                            const statusBadge = line.source_type === "labs_item" ? (
                              line.item_status === "received" ? { label: "Received", color: T.green, bg: T.greenDim } :
                              line.item_status === "in_transit" ? { label: "In transit", color: T.purple, bg: "rgba(160,90,200,0.15)" } :
                              line.item_status === "at_decorator" ? { label: "At decorator", color: T.accent, bg: T.accentDim } :
                              { label: "Setup", color: T.faint, bg: T.card }
                            ) : null;
                            const ready = !!line.webstore_entered_at;
                            return (
                              <div key={line.id} style={{ display: "flex", alignItems: "center", padding: "6px 8px", background: T.surface, borderRadius: 6, gap: 8 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: sourceBadge.bg, color: sourceBadge.color, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
                                  {sourceBadge.label}
                                </span>
                                {statusBadge && (
                                  <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: statusBadge.bg, color: statusBadge.color, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
                                    {statusBadge.label}
                                  </span>
                                )}
                                {line.source_type === "labs_item" && line.source_job_id ? (
                                  <Link href={`/jobs/${line.source_job_id}`} style={{ fontSize: 12, fontWeight: 500, color: T.text, textDecoration: "none", flexShrink: 0 }}>
                                    {line.display_name}
                                  </Link>
                                ) : (
                                  <span style={{ fontSize: 12, fontWeight: 500, color: T.text, flexShrink: 0 }}>{line.display_name}</span>
                                )}
                                {line.display_meta && <span style={{ fontSize: 10, color: T.faint, flex: 1 }}>{line.display_meta}</span>}
                                {!line.display_meta && <div style={{ flex: 1 }} />}
                                <div style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
                                  {line.sizes.map(sz => (
                                    <span key={sz} style={{ fontSize: 9, fontFamily: mono, color: T.muted, padding: "1px 5px", background: T.card, borderRadius: 3 }}>
                                      {sz}:{line.effective_qtys[sz] || 0}
                                    </span>
                                  ))}
                                  {line.sizes.length === 0 && line.total > 0 && (
                                    <span style={{ fontSize: 9, fontFamily: mono, color: T.faint, fontStyle: "italic" }}>no sizes</span>
                                  )}
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: mono, color: T.text, minWidth: 40, textAlign: "right" }} title={line.qty_is_expected ? "Expected qty — item not yet received" : undefined}>
                                  {line.total}{line.qty_is_expected && <span style={{ color: T.faint, marginLeft: 1 }}>*</span>}
                                </span>
                                <button onClick={() => toggleWebstoreReady(line)}
                                  style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4, border: `1px solid ${ready ? T.green : T.border}`, background: ready ? T.greenDim : "transparent", color: ready ? T.green : T.muted, cursor: "pointer", flexShrink: 0 }}
                                  title={ready ? `Marked ${new Date(line.webstore_entered_at!).toLocaleString()}` : "Mark as entered into webstore"}>
                                  {ready ? "✓ In webstore" : "Mark in webstore"}
                                </button>
                                <button onClick={() => removeLine(line.id)}
                                  style={{ fontSize: 12, padding: "0 6px", borderRadius: 4, border: "none", background: "transparent", color: T.faint, cursor: "pointer", flexShrink: 0 }}
                                  onMouseEnter={e => { e.currentTarget.style.color = T.red; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = T.faint; }}
                                  title="Remove">
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Inline picker */}
                      {picker?.projectId === proj.id && (
                        <div style={{ marginTop: 8, padding: 12, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6 }}>
                          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                            {([
                              { id: "labs", label: "Labs item" },
                              { id: "outside", label: "Outside shipment" },
                              { id: "preexisting", label: "Pre-existing" },
                            ] as const).map(m => (
                              <button key={m.id} onClick={() => openPicker(proj.id, m.id)}
                                style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${picker.mode === m.id ? T.accent : T.border}`, background: picker.mode === m.id ? T.accentDim : "transparent", color: picker.mode === m.id ? T.accent : T.muted }}>
                                {m.label}
                              </button>
                            ))}
                            <div style={{ flex: 1 }} />
                            <button onClick={() => setPicker(null)}
                              style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, border: "none", background: "transparent", color: T.faint, cursor: "pointer" }}>
                              Cancel
                            </button>
                          </div>

                          {picker.mode === "labs" && (() => {
                            // Apply filters
                            const search = pickerFilter.search.trim().toLowerCase();
                            const filteredItems = availableItems.filter(it => {
                              if (pickerFilter.clientId && it.client_id !== pickerFilter.clientId) return false;
                              if (pickerFilter.jobId && it.job_id !== pickerFilter.jobId) return false;
                              if (search && !it.name.toLowerCase().includes(search) && !it.job_title.toLowerCase().includes(search)) return false;
                              return true;
                            });
                            // Build dropdown options from the unfiltered set (so user can switch clients)
                            const clientOptions = Array.from(
                              new Map(availableItems.filter(it => it.client_id).map(it => [it.client_id!, it.client_name])).entries()
                            ).sort((a, b) => a[1].localeCompare(b[1]));
                            const jobOptions = Array.from(
                              new Map(availableItems.filter(it => !pickerFilter.clientId || it.client_id === pickerFilter.clientId).map(it => [it.job_id, it.job_title])).entries()
                            ).sort((a, b) => a[1].localeCompare(b[1]));
                            const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(it => selectedItemIds.has(it.id));
                            const toggleSelectAll = () => {
                              setSelectedItemIds(prev => {
                                const next = new Set(prev);
                                if (allFilteredSelected) {
                                  filteredItems.forEach(it => next.delete(it.id));
                                } else {
                                  filteredItems.forEach(it => next.add(it.id));
                                }
                                return next;
                              });
                            };
                            return (
                              <div>
                                {/* Filter row */}
                                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                                  <input style={{ ...ic, flex: 1 }} placeholder="Search item or project name…"
                                    value={pickerFilter.search}
                                    onChange={e => setPickerFilter(f => ({ ...f, search: e.target.value }))} />
                                  <select style={{ ...ic, width: 160, flexShrink: 0 }} value={pickerFilter.clientId}
                                    onChange={e => setPickerFilter(f => ({ ...f, clientId: e.target.value, jobId: "" }))}>
                                    <option value="">All clients</option>
                                    {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                                  </select>
                                  <select style={{ ...ic, width: 180, flexShrink: 0 }} value={pickerFilter.jobId}
                                    onChange={e => setPickerFilter(f => ({ ...f, jobId: e.target.value }))}>
                                    <option value="">All projects</option>
                                    {jobOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
                                  </select>
                                </div>

                                {/* Select-all / count row */}
                                {filteredItems.length > 0 && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "0 4px" }}>
                                    <button onClick={toggleSelectAll}
                                      style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, cursor: "pointer" }}>
                                      {allFilteredSelected ? "Clear visible" : `Select all visible (${filteredItems.length})`}
                                    </button>
                                    {selectedItemIds.size > 0 && (
                                      <span style={{ fontSize: 10, color: T.muted }}>
                                        {selectedItemIds.size} selected
                                      </span>
                                    )}
                                  </div>
                                )}

                                {filteredItems.length === 0 ? (
                                  <div style={{ padding: "20px 10px", textAlign: "center", fontSize: 11, color: T.faint }}>
                                    {availableItems.length === 0
                                      ? "No Labs items available to link. Add items on a project's Buy Sheet first."
                                      : "No items match the current filter."}
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
                                    {filteredItems.map(it => {
                                      const statusBadge =
                                        it.status === "received" ? { label: "Received", color: T.green, bg: T.greenDim } :
                                        it.status === "in_transit" ? { label: "In transit", color: T.purple, bg: "rgba(160,90,200,0.15)" } :
                                        it.status === "at_decorator" ? { label: "At decorator", color: T.accent, bg: T.accentDim } :
                                        { label: "Setup", color: T.faint, bg: T.surface };
                                      const checked = selectedItemIds.has(it.id);
                                      return (
                                        <div key={it.id} onClick={() => toggleItemSelected(it.id)}
                                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: checked ? T.accentDim : T.card, border: `1px solid ${checked ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer", fontFamily: font, userSelect: "none" }}
                                          onMouseEnter={e => { if (!checked) e.currentTarget.style.borderColor = T.accent; }}
                                          onMouseLeave={e => { if (!checked) e.currentTarget.style.borderColor = T.border; }}>
                                          <input type="checkbox" checked={checked} readOnly tabIndex={-1}
                                            style={{ flexShrink: 0, accentColor: T.accent, pointerEvents: "none" }} />
                                          <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: statusBadge.bg, color: statusBadge.color, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, minWidth: 80, textAlign: "center" }}>
                                            {statusBadge.label}
                                          </span>
                                          <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{it.name}</div>
                                            <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{it.client_name} · {it.job_title}</div>
                                          </div>
                                          <div style={{ textAlign: "right" }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: mono, color: T.text }}>{it.total}</div>
                                            <div style={{ fontSize: 9, color: T.faint, fontStyle: it.qty_is_expected ? "italic" : "normal" }}>
                                              {it.qty_is_expected ? "expected" : "received"}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Commit footer */}
                                <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                                  <button onClick={addSelectedLabsItems} disabled={selectedItemIds.size === 0}
                                    style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 11, fontWeight: 600, cursor: selectedItemIds.size === 0 ? "not-allowed" : "pointer", opacity: selectedItemIds.size === 0 ? 0.5 : 1 }}>
                                    Add {selectedItemIds.size > 0 ? `${selectedItemIds.size} ` : ""}selected
                                  </button>
                                  {selectedItemIds.size > 0 && (
                                    <button onClick={() => setSelectedItemIds(new Set())}
                                      style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 11, cursor: "pointer" }}>
                                      Clear
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {picker.mode === "outside" && (
                            <div>
                              {availableShipments.length === 0 ? (
                                <div style={{ padding: "20px 10px", textAlign: "center", fontSize: 11, color: T.faint }}>
                                  No staged outside shipments to link. Mark a shipment as routed to staging on the Receiving page.
                                </div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                                  {availableShipments.map(s => (
                                    <div key={s.id} style={{ padding: "8px 10px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 6 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                        <div style={{ flex: 1 }}>
                                          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{s.description || "Outside shipment"}</div>
                                          <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                                            {[s.sender, s.carrier, s.tracking].filter(Boolean).join(" · ") || "—"}
                                          </div>
                                        </div>
                                      </div>
                                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        <input
                                          style={{ ...ic, fontSize: 11, fontFamily: mono }}
                                          placeholder="Qtys, e.g. S:24, M:32, L:18 — or total:100"
                                          value={shipQtyInput[s.id] || ""}
                                          onChange={e => setShipQtyInput(prev => ({ ...prev, [s.id]: e.target.value }))}
                                        />
                                        <button onClick={() => addOutsideShipment(s.id)}
                                          style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                                          Add
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {picker.mode === "preexisting" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              <div>
                                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Description *</label>
                                <input style={ic} value={preForm.description} onChange={e => setPreForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. 2024 Tour Tee — black" />
                              </div>
                              <div>
                                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Qtys</label>
                                <input style={{ ...ic, fontFamily: mono }} value={preForm.qtys} onChange={e => setPreForm(f => ({ ...f, qtys: e.target.value }))} placeholder="S:24, M:32, L:18, XL:10 — or total:100" />
                              </div>
                              <div>
                                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
                                <input style={ic} value={preForm.notes} onChange={e => setPreForm(f => ({ ...f, notes: e.target.value }))} placeholder="Pulled from existing warehouse stock" />
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={addPreexisting} disabled={!preForm.description.trim()}
                                  style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: preForm.description.trim() ? 1 : 0.5 }}>
                                  Add to inventory
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Daily log entry */}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                        Daily Log — {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                        <div>
                          <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 2 }}>Starting</label>
                          <input type="number" style={{ ...ic, width: 80, fontFamily: mono, textAlign: "center" }} value={lf.starting} placeholder="0"
                            onChange={e => setLogForm(prev => ({ ...prev, [proj.id]: { ...lf, starting: e.target.value } }))} onFocus={e => e.target.select()} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 2 }}>Remaining</label>
                          <input type="number" style={{ ...ic, width: 80, fontFamily: mono, textAlign: "center" }} value={lf.remaining} placeholder="0"
                            onChange={e => setLogForm(prev => ({ ...prev, [proj.id]: { ...lf, remaining: e.target.value } }))} onFocus={e => e.target.select()} />
                        </div>
                        {(parseInt(lf.starting) || 0) > 0 && (parseInt(lf.remaining) || 0) >= 0 && (
                          <div style={{ padding: "6px 0" }}>
                            <div style={{ fontSize: 9, color: T.faint, marginBottom: 2 }}>Shipped</div>
                            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: T.green }}>{Math.max(0, (parseInt(lf.starting) || 0) - (parseInt(lf.remaining) || 0))}</div>
                          </div>
                        )}
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 2 }}>Notes</label>
                          <input style={ic} value={lf.notes} placeholder="Issues, delays, etc."
                            onChange={e => setLogForm(prev => ({ ...prev, [proj.id]: { ...lf, notes: e.target.value } }))} />
                        </div>
                        <button onClick={() => submitLog(proj.id)}
                          style={{ padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                          Log
                        </button>
                      </div>
                    </div>

                    {/* Log history */}
                    {proj.logs.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>History</div>
                        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                              {["Date", "Starting", "Shipped", "Remaining", "Notes"].map(h =>
                                <th key={h} style={{ padding: "4px 8px", textAlign: h === "Notes" ? "left" : "center", fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase" }}>{h}</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {proj.logs.slice(0, 14).map((log, i) => (
                              <tr key={log.id} style={{ borderBottom: i < proj.logs.length - 1 ? `1px solid ${T.border}22` : "none" }}>
                                <td style={{ padding: "6px 8px", textAlign: "center", color: T.muted }}>{new Date(log.log_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                                <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: mono, color: T.text }}>{log.starting_orders}</td>
                                <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: mono, color: T.green, fontWeight: 600 }}>{log.orders_shipped}</td>
                                <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: mono, color: log.remaining_orders > 0 ? T.amber : T.green, fontWeight: 600 }}>{log.remaining_orders}</td>
                                <td style={{ padding: "6px 8px", color: T.muted }}>{log.notes || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── COMPLETED ── */}
      {tab === "complete" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {completedProjects.length === 0 ? (
            <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>No completed projects yet.</div>
          ) : completedProjects.map(proj => {
            const totalShipped = proj.logs.reduce((a, l) => a + l.orders_shipped, 0);
            const days = proj.logs.length;
            return (
              <div key={proj.id} style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{proj.name}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>{proj.client_name}{proj.store_name ? ` · ${proj.store_name}` : ""}</div>
                </div>
                <div style={{ fontSize: 12, fontFamily: mono, color: T.green, fontWeight: 600 }}>{totalShipped} shipped</div>
                <div style={{ fontSize: 11, color: T.muted }}>{days} day{days !== 1 ? "s" : ""}</div>
                <button onClick={() => updateStatus(proj.id, "active")}
                  style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, cursor: "pointer" }}>
                  Reopen
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Outside shipments routed to staging — not yet linked to any project */}
      {outsideShipments.length > 0 && tab === "active" && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 8 }}>Outside Shipments — Unlinked</div>
          <div style={{ fontSize: 10, color: T.faint, marginTop: -4 }}>Attach these to a fulfillment project via "+ Add inventory → Outside shipment", or mark fulfilled if no longer needed.</div>
          {outsideShipments.map(s => (
            <div key={s.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.description}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    {[s.sender, s.carrier, s.tracking].filter(Boolean).join(" · ")}
                    {s.condition && s.condition !== "good" && <span style={{ marginLeft: 8, color: T.amber }}>{s.condition}</span>}
                  </div>
                </div>
                <button onClick={async () => {
                  await supabase.from("outside_shipments").update({ route: "fulfilled" }).eq("id", s.id);
                  setOutsideShipments(prev => prev.filter(x => x.id !== s.id));
                }}
                  style={{ fontSize: 10, fontWeight: 600, padding: "5px 14px", borderRadius: 6, border: "none", background: T.green, color: "#fff", cursor: "pointer" }}>
                  Mark Fulfilled
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
