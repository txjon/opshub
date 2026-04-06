"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";

type ReceivedItem = {
  name: string;
  sizes: string[];
  received_qtys: Record<string, number>;
  total: number;
};

type FulfillmentProject = {
  id: string;
  client_id: string | null;
  name: string;
  store_name: string | null;
  status: string;
  notes: string | null;
  total_units: number;
  source_job_id: string | null;
  created_at: string;
  client_name: string;
  logs: DailyLog[];
  received_items: ReceivedItem[];
};

type DailyLog = {
  id: string;
  log_date: string;
  starting_orders: number;
  orders_shipped: number;
  remaining_orders: number;
  notes: string | null;
};

type IncomingItem = {
  id: string;
  name: string;
  job_title: string;
  client_name: string;
  decorator: string;
  total_units: number;
  pipeline_stage: string;
  ship_tracking: string | null;
  ship_date: string | null;
};

export default function FulfillmentPage() {
  const supabase = createClient();
  const [projects, setProjects] = useState<FulfillmentProject[]>([]);
  const [incoming, setIncoming] = useState<IncomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", store_name: "", client_id: "", notes: "", source_job_id: "" });
  const [labsJobs, setLabsJobs] = useState<{ id: string; title: string; client_name: string }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [logForm, setLogForm] = useState<Record<string, { starting: string; shipped: string; remaining: string; notes: string }>>({});
  const [tab, setTab] = useState<"active" | "incoming" | "complete">("active");

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);

    const [projRes, clientRes, jobsRes] = await Promise.all([
      supabase.from("fulfillment_projects").select("*, clients(name), fulfillment_daily_logs(*)").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("jobs").select("id, title, clients(name)").not("phase", "in", '("complete","cancelled")').order("created_at", { ascending: false }).limit(50),
    ]);
    setLabsJobs((jobsRes.data || []).map((j: any) => ({ id: j.id, title: j.title, client_name: (j.clients as any)?.name || "" })));

    // Load received items for projects with source jobs
    const jobLinkedProjects = (projRes.data || []).filter((p: any) => p.source_job_id);
    const sourceJobIds = jobLinkedProjects.map((p: any) => p.source_job_id);
    let receivedByJob: Record<string, ReceivedItem[]> = {};

    if (sourceJobIds.length > 0) {
      const { data: receivedItems } = await supabase
        .from("items")
        .select("job_id, name, received_qtys, received_at_hpd, buy_sheet_lines(size, qty_ordered)")
        .in("job_id", sourceJobIds)
        .eq("received_at_hpd", true);

      for (const it of (receivedItems || [])) {
        if (!receivedByJob[it.job_id]) receivedByJob[it.job_id] = [];
        const lines = it.buy_sheet_lines || [];
        const sizes = lines.map((l: any) => l.size);
        const rq = it.received_qtys || {};
        // Fall back to ordered qty if no received qty recorded
        const received: Record<string, number> = {};
        for (const l of lines) {
          received[l.size] = rq[l.size] ?? l.qty_ordered ?? 0;
        }
        receivedByJob[it.job_id].push({
          name: it.name,
          sizes,
          received_qtys: received,
          total: Object.values(received).reduce((a, v) => a + v, 0),
        });
      }
    }

    const mapped = (projRes.data || []).map((p: any) => ({
      ...p,
      client_name: p.clients?.name || "Unknown",
      logs: (p.fulfillment_daily_logs || []).sort((a: any, b: any) => b.log_date.localeCompare(a.log_date)),
      received_items: p.source_job_id ? (receivedByJob[p.source_job_id] || []) : [],
    }));
    setProjects(mapped);
    setClients(clientRes.data || []);

    // Load incoming pipeline: items in production or shipped (not yet received)
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, target_ship_date, shipping_route, clients(name)")
      .in("phase", ["production", "receiving"])
      .eq("shipping_route", "stage");

    if (jobs?.length) {
      const jobIds = jobs.map(j => j.id);
      const jobMap: Record<string, any> = {};
      jobs.forEach(j => { jobMap[j.id] = j; });

      const { data: items } = await supabase
        .from("items")
        .select("id, name, job_id, pipeline_stage, ship_tracking, buy_sheet_lines(qty_ordered), decorator_assignments(decorators(name, short_code))")
        .in("job_id", jobIds)
        .in("pipeline_stage", ["in_production", "shipped"]);

      setIncoming((items || []).map((it: any) => {
        const job = jobMap[it.job_id];
        const dec = it.decorator_assignments?.[0]?.decorators;
        return {
          id: it.id, name: it.name,
          job_title: job?.title || "",
          client_name: (job?.clients as any)?.name || "",
          decorator: dec?.short_code || dec?.name || "—",
          total_units: (it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0),
          pipeline_stage: it.pipeline_stage,
          ship_tracking: it.ship_tracking,
          ship_date: job?.target_ship_date,
        };
      }));
    }

    setLoading(false);
  }

  async function createProject() {
    if (!newForm.name.trim()) return;
    await supabase.from("fulfillment_projects").insert({
      name: newForm.name.trim(),
      store_name: newForm.store_name.trim() || null,
      client_id: newForm.client_id || null,
      notes: newForm.notes.trim() || null,
      source_job_id: newForm.source_job_id || null,
    });
    setNewForm({ name: "", store_name: "", client_id: "", notes: "", source_job_id: "" });
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

  const activeProjects = projects.filter(p => p.status === "staging" || p.status === "active");
  const completedProjects = projects.filter(p => p.status === "complete");
  const inProductionCount = incoming.filter(i => i.pipeline_stage === "in_production").length;
  const inTransitCount = incoming.filter(i => i.pipeline_stage === "shipped").length;
  const totalRemaining = activeProjects.reduce((a, p) => {
    const latest = p.logs[0];
    return a + (latest?.remaining_orders || 0);
  }, 0);

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Fulfillment</h1>

      {/* Stats */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "Active projects", value: activeProjects.length, color: T.accent },
          { label: "Orders remaining", value: totalRemaining, color: totalRemaining > 0 ? T.amber : T.faint },
          { label: "In production", value: inProductionCount, color: T.accent },
          { label: "In transit", value: inTransitCount, color: inTransitCount > 0 ? T.green : T.faint },
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
          { id: "incoming" as const, label: "Incoming Pipeline", count: incoming.length },
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
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Link to Labs project (optional)</label>
                  <select style={ic} value={newForm.source_job_id} onChange={e => setNewForm(f => ({ ...f, source_job_id: e.target.value }))}>
                    <option value="">— none —</option>
                    {labsJobs.map(j => <option key={j.id} value={j.id}>{j.client_name} — {j.title}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
                <input style={ic} value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any details about this fulfillment project" />
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
                    {proj.received_items.length > 0 && (
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: mono, color: T.text }}>{proj.received_items.reduce((a, ri) => a + ri.total, 0).toLocaleString()}</div>
                        <div style={{ fontSize: 8, color: T.faint }}>units received</div>
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
                    {!hasLogToday && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: T.redDim, color: T.red, fontWeight: 600 }}>No log today</span>}
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
                    </div>

                    {proj.notes && <div style={{ fontSize: 11, color: T.muted, padding: "6px 10px", background: T.surface, borderRadius: 6 }}>{proj.notes}</div>}

                    {/* Received inventory breakdown */}
                    {proj.received_items.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                          Received Inventory — {proj.received_items.reduce((a, ri) => a + ri.total, 0).toLocaleString()} units
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {proj.received_items.map((ri, idx) => (
                            <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: T.surface, borderRadius: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{ri.name}</span>
                              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                {ri.sizes.map(sz => (
                                  <span key={sz} style={{ fontSize: 9, fontFamily: mono, color: T.muted, padding: "1px 4px", background: T.card, borderRadius: 3 }}>
                                    {sz}:{ri.received_qtys[sz] || 0}
                                  </span>
                                ))}
                                <span style={{ fontSize: 10, fontWeight: 600, fontFamily: mono, color: T.text, marginLeft: 4 }}>{ri.total}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

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

      {/* ── INCOMING PIPELINE ── */}
      {tab === "incoming" && (
        <div style={card}>
          {incoming.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>No items incoming. Items appear here when in production or shipped from decorator.</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.5fr 1fr 70px 80px 80px", padding: "6px 14px", background: T.surface, borderBottom: `1px solid ${T.border}` }}>
                {["Client", "Project", "Item", "Decorator", "Units", "Status", "Ship date"].map(h =>
                  <div key={h} style={{ fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
                )}
              </div>
              {incoming.map((item, i) => (
                <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.5fr 1fr 70px 80px 80px", padding: "8px 14px", alignItems: "center", borderBottom: i < incoming.length - 1 ? `1px solid ${T.border}` : "none" }}>
                  <div style={{ fontSize: 12, color: T.text }}>{item.client_name}</div>
                  <div style={{ fontSize: 12, color: T.muted }}>{item.job_title}</div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: T.accent }}>{item.decorator}</div>
                  <div style={{ fontSize: 12, fontFamily: mono, fontWeight: 600 }}>{item.total_units.toLocaleString()}</div>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: item.pipeline_stage === "shipped" ? T.greenDim : T.accentDim, color: item.pipeline_stage === "shipped" ? T.green : T.accent }}>
                      {item.pipeline_stage === "shipped" ? "In transit" : "At decorator"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: mono, color: T.muted }}>
                    {item.ship_date ? new Date(item.ship_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  </div>
                </div>
              ))}
            </>
          )}
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
    </div>
  );
}
