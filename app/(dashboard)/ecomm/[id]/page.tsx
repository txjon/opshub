"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { deductSamples } from "@/lib/qty";

type EcommProject = {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string;
  store_name: string | null;
  store_account: string | null;
  status: string;
  mode: "preorder" | "drop" | "always_on";
  platform: string | null;
  open_date: string | null;
  close_date: string | null;
  target_ship_date: string | null;
  buffer_pct: number | null;
  listed_by: string | null;
  notes: string | null;
  created_at: string;
};

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
  display_name: string;
  display_meta: string | null;
  effective_qtys: Record<string, number>;
  sizes: string[];
  total: number;
  source_job_id: string | null;
  item_status: "at_decorator" | "in_transit" | "received" | "unknown" | null;
  qty_is_expected: boolean;
};

type LinkedJob = {
  id: string;
  title: string;
  job_number: string | null;
  phase: string;
  created_at: string;
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

const MODE_LABELS: Record<EcommProject["mode"], string> = {
  preorder: "Pre-order",
  drop: "In-stock drop",
  always_on: "Always-on",
};

const PLATFORM_LABELS: Record<string, string> = {
  shopify: "Shopify",
  bigcommerce: "BigCommerce",
  bigcartel: "BigCartel",
  other: "Other",
};

export default function EcommProjectDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const projectId = params.id;

  const [project, setProject] = useState<EcommProject | null>(null);
  const [lines, setLines] = useState<InventoryLine[]>([]);
  const [jobs, setJobs] = useState<LinkedJob[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Inline editing
  const [editForm, setEditForm] = useState<Partial<EcommProject>>({});
  const [editing, setEditing] = useState(false);

  // Inventory picker
  const [picker, setPicker] = useState<"labs" | "outside" | "preexisting" | null>(null);
  const [pickerFilter, setPickerFilter] = useState({ search: "", clientId: "", jobId: "" });
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [availableItems, setAvailableItems] = useState<AvailableItem[]>([]);
  const [preForm, setPreForm] = useState({ description: "", qtys: "", notes: "" });

  // Daily log entry
  const [logForm, setLogForm] = useState({ starting: "", remaining: "", notes: "" });

  useEffect(() => { if (projectId) loadAll(); }, [projectId]);

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
      if (item.received_at_hpd) item_status = "received";
      else if (item.pipeline_stage === "shipped") item_status = "in_transit";
      else if (item.pipeline_stage === "in_production") item_status = "at_decorator";
      else item_status = "unknown";
      qty_is_expected = !hasReceivedQtys;
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
    const [projRes, invRes, logRes] = await Promise.all([
      supabase.from("fulfillment_projects").select("*, clients(name)").eq("id", projectId).single(),
      supabase.from("fulfillment_inventory")
        .select("*, items:source_item_id(id, name, job_id, sort_order, pipeline_stage, received_at_hpd, received_qtys, sample_qtys, buy_sheet_lines(size, qty_ordered)), outside_shipments:source_shipment_id(id, description, sender, carrier, tracking)")
        .eq("project_id", projectId)
        .order("sort_order"),
      supabase.from("fulfillment_daily_logs").select("*").eq("project_id", projectId).order("log_date", { ascending: false }),
    ]);

    const p = projRes.data as any;
    if (p) {
      setProject({ ...p, client_name: p.clients?.name || "—" });
      setEditForm({
        name: p.name,
        store_account: p.store_account,
        platform: p.platform,
        open_date: p.open_date,
        close_date: p.close_date,
        target_ship_date: p.target_ship_date,
        buffer_pct: p.buffer_pct,
        listed_by: p.listed_by,
        notes: p.notes,
      });
    }

    const lineRows = (invRes.data || []).map(hydrateLine);
    setLines(lineRows);
    setLogs((logRes.data || []) as DailyLog[]);

    // Find linked Labs jobs by aggregating from inventory's labs_item lines
    // OR by jobs.type_meta.ecomm_project_id pointing at this project.
    const sourceJobIds: string[] = Array.from(new Set(lineRows.filter(l => l.source_job_id).map(l => l.source_job_id!)));
    const { data: jobsByMeta } = await supabase
      .from("jobs")
      .select("id, title, job_number, phase, created_at, type_meta")
      .filter("type_meta->>ecomm_project_id", "eq", projectId);
    const metaJobIds: string[] = (jobsByMeta || []).map((j: any) => j.id);
    const seen = new Set<string>();
    const allJobIds: string[] = [];
    for (const id of [...sourceJobIds, ...metaJobIds]) {
      if (!seen.has(id)) { seen.add(id); allJobIds.push(id); }
    }
    if (allJobIds.length > 0) {
      const { data: jobRows } = await supabase
        .from("jobs")
        .select("id, title, job_number, phase, created_at")
        .in("id", allJobIds)
        .order("created_at", { ascending: false });
      setJobs((jobRows || []) as LinkedJob[]);
    } else {
      setJobs([]);
    }

    setLoading(false);
  }

  async function saveHeader() {
    if (!project) return;
    setSaving(true);
    await supabase.from("fulfillment_projects").update({
      name: editForm.name?.trim() || project.name,
      store_account: editForm.store_account || null,
      platform: editForm.platform || null,
      open_date: editForm.open_date || null,
      close_date: editForm.close_date || null,
      target_ship_date: editForm.target_ship_date || null,
      buffer_pct: editForm.buffer_pct ?? 5,
      listed_by: editForm.listed_by || null,
      notes: editForm.notes || null,
    }).eq("id", project.id);
    setEditing(false);
    setSaving(false);
    loadAll();
  }

  async function updateStatus(status: string) {
    if (!project) return;
    await supabase.from("fulfillment_projects").update({ status }).eq("id", project.id);
    setProject(prev => prev ? { ...prev, status } : prev);
  }

  async function spawnLabsJob() {
    if (!project) return;
    setSaving(true);
    const insertPayload: any = {
      title: project.name,
      client_id: project.client_id,
      phase: "intake",
      shipping_route: "stage",
      type_meta: {
        ecomm_project_id: project.id,
        ecomm_mode: project.mode,
        store_account: project.store_account,
        platform: project.platform,
      },
    };
    const { data, error } = await supabase.from("jobs").insert(insertPayload).select("id").single();
    setSaving(false);
    if (error || !data) {
      alert("Failed to spawn Labs job: " + (error?.message || "unknown error"));
      return;
    }
    router.push(`/jobs/${(data as any).id}`);
  }

  async function toggleWebstoreReady(line: InventoryLine) {
    const newValue = line.webstore_entered_at ? null : new Date().toISOString();
    await supabase.from("fulfillment_inventory")
      .update({ webstore_entered_at: newValue })
      .eq("id", line.id);
    loadAll();
  }

  async function removeLine(lineId: string) {
    if (!confirm("Remove this inventory line?")) return;
    await supabase.from("fulfillment_inventory").delete().eq("id", lineId);
    loadAll();
  }

  function parseQtys(input: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const chunk of input.split(/[,\n]/)) {
      const m = chunk.trim().match(/^([A-Za-z0-9.]+)\s*[:=]\s*(\d+)/);
      if (m) out[m[1].toUpperCase()] = parseInt(m[2]);
    }
    return out;
  }

  async function openPicker(mode: "labs" | "outside" | "preexisting") {
    setPicker(mode);
    setPreForm({ description: "", qtys: "", notes: "" });
    setSelectedItemIds(new Set());
    setPickerFilter({ search: "", clientId: project?.client_id || "", jobId: "" });

    if (mode === "labs") {
      const linkedItemIds = new Set(lines.filter(l => l.source_item_id).map(l => l.source_item_id));
      const { data } = await supabase
        .from("items")
        .select("id, name, job_id, pipeline_stage, received_at_hpd, received_qtys, sample_qtys, buy_sheet_lines(qty_ordered, size), jobs!inner(id, title, phase, client_id, clients(id, name))")
        .not("jobs.phase", "in", '("cancelled")');
      const hydrated: AvailableItem[] = (data || [])
        .filter((it: any) => !linkedItemIds.has(it.id))
        .map((it: any) => {
          const lines2 = it.buy_sheet_lines || [];
          const rq = it.received_qtys || {};
          const hasReceivedQtys = Object.keys(rq).length > 0;
          const delivered: Record<string, number> = {};
          for (const l of lines2) {
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
    if (selectedItemIds.size === 0) return;
    const rows = Array.from(selectedItemIds).map((itemId, idx) => ({
      project_id: projectId,
      source_type: "labs_item",
      source_item_id: itemId,
      qtys: {},
      sort_order: lines.length + idx,
    }));
    await supabase.from("fulfillment_inventory").insert(rows);
    setPicker(null);
    setSelectedItemIds(new Set());
    loadAll();
  }

  async function addPreexisting() {
    if (!preForm.description.trim()) return;
    const qtys = parseQtys(preForm.qtys);
    await supabase.from("fulfillment_inventory").insert({
      project_id: projectId,
      source_type: "preexisting",
      description: preForm.description.trim(),
      qtys,
      notes: preForm.notes.trim() || null,
      sort_order: lines.length,
    });
    setPicker(null);
    setPreForm({ description: "", qtys: "", notes: "" });
    loadAll();
  }

  async function submitLog() {
    const today = new Date().toISOString().split("T")[0];
    const starting = parseInt(logForm.starting) || 0;
    const remaining = parseInt(logForm.remaining) || 0;
    await supabase.from("fulfillment_daily_logs").upsert({
      project_id: projectId,
      log_date: today,
      starting_orders: starting,
      orders_shipped: Math.max(0, starting - remaining),
      remaining_orders: remaining,
      notes: logForm.notes?.trim() || null,
    }, { onConflict: "project_id,log_date" });
    setLogForm({ starting: "", remaining: "", notes: "" });
    loadAll();
  }

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading…</div>;
  if (!project) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Project not found. <Link href="/ecomm" style={{ color: T.accent }}>← Back to Ecomm</Link></div>;

  const totalUnits = lines.reduce((a, l) => a + l.total, 0);
  const readyUnits = lines.filter(l => l.webstore_entered_at).reduce((a, l) => a + l.total, 0);
  const todayStr = new Date().toISOString().split("T")[0];
  const latestLog = logs[0];
  const hasLogToday = latestLog?.log_date === todayStr;
  const totalShipped = logs.reduce((a, l) => a + l.orders_shipped, 0);
  const daysUntilClose = project.close_date ? Math.ceil((new Date(project.close_date + "T12:00:00").getTime() - Date.now()) / 86400000) : null;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <Link href="/ecomm" style={{ fontSize: 11, color: T.muted, textDecoration: "none" }}>← All ecomm projects</Link>

      {/* Header */}
      <div style={{ ...card, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            {editing ? (
              <input style={{ ...ic, fontSize: 18, fontWeight: 700, padding: "4px 8px" }} value={editForm.name || ""} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{project.name}</h1>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: T.accentDim, color: T.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {MODE_LABELS[project.mode]}
                </span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: project.status === "active" ? T.greenDim : T.amberDim, color: project.status === "active" ? T.green : T.amber, fontWeight: 600, textTransform: "capitalize" }}>
                  {project.status}
                </span>
              </div>
            )}
            <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
              {project.client_name}
              {project.platform && ` · ${PLATFORM_LABELS[project.platform] || project.platform}`}
              {project.store_account && ` · ${project.store_account}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {editing ? (
              <>
                <button onClick={saveHeader} disabled={saving}
                  style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 11, fontWeight: 600 }}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => { setEditing(false); setEditForm({}); }}
                  style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 11 }}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 11 }}>
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Editable details */}
        {editing && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
            <div>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Platform</label>
              <select style={ic} value={editForm.platform || ""} onChange={e => setEditForm(f => ({ ...f, platform: e.target.value }))}>
                <option value="">—</option>
                <option value="shopify">Shopify</option>
                <option value="bigcommerce">BigCommerce</option>
                <option value="bigcartel">BigCartel</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Store URL</label>
              <input style={ic} value={editForm.store_account || ""} onChange={e => setEditForm(f => ({ ...f, store_account: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Listed by</label>
              <select style={ic} value={editForm.listed_by || ""} onChange={e => setEditForm(f => ({ ...f, listed_by: e.target.value }))}>
                <option value="">—</option>
                <option value="client">Client</option>
                <option value="hpd">HPD</option>
              </select>
            </div>
            {project.mode === "preorder" && (
              <>
                <div>
                  <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Open</label>
                  <input type="date" style={ic} value={editForm.open_date || ""} onChange={e => setEditForm(f => ({ ...f, open_date: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Close</label>
                  <input type="date" style={ic} value={editForm.close_date || ""} onChange={e => setEditForm(f => ({ ...f, close_date: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Buffer %</label>
                  <input type="number" style={ic} value={editForm.buffer_pct ?? 5} onChange={e => setEditForm(f => ({ ...f, buffer_pct: parseFloat(e.target.value) || 0 }))} />
                </div>
              </>
            )}
            <div>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Target ship</label>
              <input type="date" style={ic} value={editForm.target_ship_date || ""} onChange={e => setEditForm(f => ({ ...f, target_ship_date: e.target.value }))} />
            </div>
            <div style={{ gridColumn: "span 4" }}>
              <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
              <input style={ic} value={editForm.notes || ""} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
        )}

        {/* Read-only details strip when not editing */}
        {!editing && (
          <div style={{ display: "flex", gap: 24, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
            {project.mode === "preorder" && project.open_date && (
              <div>
                <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Opens</div>
                <div style={{ fontSize: 13, fontFamily: mono, color: T.text, fontWeight: 600, marginTop: 2 }}>{new Date(project.open_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              </div>
            )}
            {project.mode === "preorder" && project.close_date && (
              <div>
                <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Closes</div>
                <div style={{ fontSize: 13, fontFamily: mono, color: T.text, fontWeight: 600, marginTop: 2 }}>
                  {new Date(project.close_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {daysUntilClose !== null && daysUntilClose >= 0 && <span style={{ fontSize: 10, color: daysUntilClose < 2 ? T.amber : T.muted, marginLeft: 4 }}>({daysUntilClose}d)</span>}
                </div>
              </div>
            )}
            {project.target_ship_date && (
              <div>
                <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Target ship</div>
                <div style={{ fontSize: 13, fontFamily: mono, color: T.text, fontWeight: 600, marginTop: 2 }}>{new Date(project.target_ship_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              </div>
            )}
            {project.listed_by && (
              <div>
                <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Listed by</div>
                <div style={{ fontSize: 13, color: T.text, fontWeight: 600, marginTop: 2, textTransform: "capitalize" }}>{project.listed_by === "hpd" ? "HPD" : "Client"}</div>
              </div>
            )}
            {project.mode === "preorder" && (
              <div>
                <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Buffer</div>
                <div style={{ fontSize: 13, fontFamily: mono, color: T.text, fontWeight: 600, marginTop: 2 }}>{project.buffer_pct ?? 5}%</div>
              </div>
            )}
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 4 }}>
              {["staging", "active", "complete"].map(s => (
                <button key={s} onClick={() => updateStatus(s)}
                  style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: `1px solid ${project.status === s ? T.accent : T.border}`, background: project.status === s ? T.accentDim : "transparent", color: project.status === s ? T.accent : T.muted, textTransform: "capitalize" }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {project.notes && !editing && <div style={{ fontSize: 11, color: T.muted, padding: "8px 10px", background: T.surface, borderRadius: 6, marginTop: 12 }}>{project.notes}</div>}
      </div>

      {/* Production handoff: linked Labs jobs + spawn action */}
      <div style={{ ...card, padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Production</div>
            <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>
              Phase 2 of the SOP — spawn a Labs job for Drake/Taylor to cost. Items they create can be linked back to this project.
            </div>
          </div>
          <button onClick={spawnLabsJob} disabled={saving}
            style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {saving ? "Spawning…" : "+ Spawn Labs Job"}
          </button>
        </div>
        {jobs.length === 0 ? (
          <div style={{ padding: "14px 10px", background: T.surface, borderRadius: 6, fontSize: 11, color: T.faint, textAlign: "center" }}>
            No Labs jobs linked yet. Spawn one to start costing.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {jobs.map(j => (
              <Link key={j.id} href={`/jobs/${j.id}`} style={{ textDecoration: "none", color: T.text }}>
                <div style={{ display: "flex", alignItems: "center", padding: "8px 10px", background: T.surface, borderRadius: 6, gap: 10 }}>
                  <span style={{ fontSize: 10, fontFamily: mono, color: T.faint, minWidth: 90 }}>{j.job_number || j.id.slice(0, 8)}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text, flex: 1 }}>{j.title}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: T.card, color: T.muted, textTransform: "capitalize", letterSpacing: "0.03em" }}>{j.phase}</span>
                  <span style={{ fontSize: 14, color: T.faint }}>›</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Inventory */}
      <div style={{ ...card, padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Inventory</div>
            <div style={{ fontSize: 11, color: T.text, fontWeight: 600, marginTop: 2 }}>
              {totalUnits.toLocaleString()} units
              {totalUnits > 0 && readyUnits < totalUnits && <span style={{ color: T.amber, marginLeft: 6, fontWeight: 500 }}>· {(totalUnits - readyUnits).toLocaleString()} not in webstore</span>}
              {totalUnits > 0 && readyUnits === totalUnits && <span style={{ color: T.green, marginLeft: 6, fontWeight: 500 }}>· all in webstore</span>}
            </div>
          </div>
          <button onClick={() => openPicker("labs")}
            style={{ fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.muted, cursor: "pointer" }}>
            + Add inventory
          </button>
        </div>

        {lines.length === 0 ? (
          <div style={{ padding: "14px 10px", background: T.surface, borderRadius: 6, fontSize: 11, color: T.faint, textAlign: "center" }}>
            No inventory yet. Spawn a Labs job and cost items first, then come back to link them here.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {lines.map(line => {
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
                    title="Remove">
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline picker */}
        {picker && (
          <div style={{ marginTop: 10, padding: 12, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6 }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {([
                { id: "labs", label: "Labs item" },
                { id: "preexisting", label: "Pre-existing" },
              ] as const).map(m => (
                <button key={m.id} onClick={() => openPicker(m.id)}
                  style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${picker === m.id ? T.accent : T.border}`, background: picker === m.id ? T.accentDim : "transparent", color: picker === m.id ? T.accent : T.muted }}>
                  {m.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button onClick={() => setPicker(null)}
                style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, border: "none", background: "transparent", color: T.faint, cursor: "pointer" }}>
                Cancel
              </button>
            </div>

            {picker === "labs" && (() => {
              const search = pickerFilter.search.trim().toLowerCase();
              const filteredItems = availableItems.filter(it => {
                if (pickerFilter.clientId && it.client_id !== pickerFilter.clientId) return false;
                if (pickerFilter.jobId && it.job_id !== pickerFilter.jobId) return false;
                if (search && !it.name.toLowerCase().includes(search) && !it.job_title.toLowerCase().includes(search)) return false;
                return true;
              });
              const jobOptions = Array.from(
                new Map(availableItems.filter(it => !pickerFilter.clientId || it.client_id === pickerFilter.clientId).map(it => [it.job_id, it.job_title])).entries()
              ).sort((a, b) => a[1].localeCompare(b[1]));
              const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(it => selectedItemIds.has(it.id));
              const toggleSelectAll = () => {
                setSelectedItemIds(prev => {
                  const next = new Set(prev);
                  if (allFilteredSelected) filteredItems.forEach(it => next.delete(it.id));
                  else filteredItems.forEach(it => next.add(it.id));
                  return next;
                });
              };
              return (
                <div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <input style={{ ...ic, flex: 1 }} placeholder="Search item or project name…"
                      value={pickerFilter.search}
                      onChange={e => setPickerFilter(f => ({ ...f, search: e.target.value }))} />
                    <select style={{ ...ic, width: 220, flexShrink: 0 }} value={pickerFilter.jobId}
                      onChange={e => setPickerFilter(f => ({ ...f, jobId: e.target.value }))}>
                      <option value="">All projects</option>
                      {jobOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
                    </select>
                  </div>
                  {filteredItems.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <button onClick={toggleSelectAll}
                        style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, cursor: "pointer" }}>
                        {allFilteredSelected ? "Clear visible" : `Select all visible (${filteredItems.length})`}
                      </button>
                      {selectedItemIds.size > 0 && <span style={{ fontSize: 10, color: T.muted }}>{selectedItemIds.size} selected</span>}
                    </div>
                  )}
                  {filteredItems.length === 0 ? (
                    <div style={{ padding: "16px", textAlign: "center", fontSize: 11, color: T.faint }}>
                      {availableItems.length === 0 ? "No Labs items available — spawn a Labs job and add items first." : "No items match the current filter."}
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
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: checked ? T.accentDim : T.card, border: `1px solid ${checked ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer", userSelect: "none" }}>
                            <input type="checkbox" checked={checked} readOnly tabIndex={-1} style={{ accentColor: T.accent, pointerEvents: "none" }} />
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

            {picker === "preexisting" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Description *</label>
                  <input style={ic} value={preForm.description} onChange={e => setPreForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Existing tour tee — black" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Qtys</label>
                  <input style={{ ...ic, fontFamily: mono }} value={preForm.qtys} onChange={e => setPreForm(f => ({ ...f, qtys: e.target.value }))} placeholder="S:24, M:32, L:18, XL:10" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
                  <input style={ic} value={preForm.notes} onChange={e => setPreForm(f => ({ ...f, notes: e.target.value }))} />
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

      {/* Daily logs */}
      <div style={{ ...card, padding: "14px 16px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
          Daily Log — {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          {!hasLogToday && project.status === "active" && <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 4, background: T.redDim, color: T.red, fontWeight: 600 }}>No log today</span>}
          {totalShipped > 0 && <span style={{ marginLeft: 8, fontSize: 10, color: T.green, fontFamily: mono }}>· {totalShipped} total shipped</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 2 }}>Starting</label>
            <input type="number" style={{ ...ic, width: 80, fontFamily: mono, textAlign: "center" }} value={logForm.starting} placeholder="0"
              onChange={e => setLogForm(f => ({ ...f, starting: e.target.value }))} onFocus={e => e.target.select()} />
          </div>
          <div>
            <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 2 }}>Remaining</label>
            <input type="number" style={{ ...ic, width: 80, fontFamily: mono, textAlign: "center" }} value={logForm.remaining} placeholder="0"
              onChange={e => setLogForm(f => ({ ...f, remaining: e.target.value }))} onFocus={e => e.target.select()} />
          </div>
          {(parseInt(logForm.starting) || 0) > 0 && (parseInt(logForm.remaining) || 0) >= 0 && (
            <div style={{ padding: "6px 0" }}>
              <div style={{ fontSize: 9, color: T.faint, marginBottom: 2 }}>Shipped</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: T.green }}>{Math.max(0, (parseInt(logForm.starting) || 0) - (parseInt(logForm.remaining) || 0))}</div>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 9, color: T.faint, display: "block", marginBottom: 2 }}>Notes</label>
            <input style={ic} value={logForm.notes} placeholder="Issues, delays, etc."
              onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <button onClick={submitLog}
            style={{ padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
            Log
          </button>
        </div>

        {logs.length > 0 && (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {["Date", "Starting", "Shipped", "Remaining", "Notes"].map(h =>
                  <th key={h} style={{ padding: "4px 8px", textAlign: h === "Notes" ? "left" : "center", fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase" }}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 14).map((log, i) => (
                <tr key={log.id} style={{ borderBottom: i < logs.length - 1 ? `1px solid ${T.border}22` : "none" }}>
                  <td style={{ padding: "6px 8px", textAlign: "center", color: T.muted }}>{new Date(log.log_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: mono, color: T.text }}>{log.starting_orders}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: mono, color: T.green, fontWeight: 600 }}>{log.orders_shipped}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: mono, color: log.remaining_orders > 0 ? T.amber : T.green, fontWeight: 600 }}>{log.remaining_orders}</td>
                  <td style={{ padding: "6px 8px", color: T.muted }}>{log.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Phase actions placeholder — these light up in Phase B */}
      <div style={{ marginTop: 6, padding: "12px 14px", background: T.surface, border: `1px dashed ${T.border}`, borderRadius: 8, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, color: T.text, marginBottom: 4 }}>Coming in Phase B:</div>
        {project.mode === "preorder" && "“Close pre-order” auto-tally button — pulls Shopify variant deltas + buffer, auto-fills the linked Labs job's Buy Sheet."}
        {project.mode === "always_on" && "Velocity-driven replenishment alerts + “Send proposal to client” action with approve link."}
        {project.mode === "drop" && "“List on store” action that pushes inventory to Shopify once production receives."}
      </div>
    </div>
  );
}
