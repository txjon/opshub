"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { EmailThread } from "@/components/EmailThread";
import { ComposeEmail } from "@/components/ComposeEmail";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);

type ProdItem = {
  id: string; name: string; job_id: string;
  pipeline_stage: string | null; ship_tracking: string | null;
  pipeline_timestamps: Record<string, string> | null;
  blank_vendor: string | null; blank_sku: string | null;
  decorator_name: string | null; decorator_short_code: string | null;
  decorator_id: string | null; decorator_assignment_id: string | null;
  target_ship_date: string | null; total_units: number;
  sizes: string[]; qtys: Record<string, number>;
  ship_qtys: Record<string, number>; ship_notes: string;
};

type ProjectGroup = {
  jobId: string; jobNumber: string; invoiceNumber: string | null; jobTitle: string; clientName: string;
  shipDate: string | null; phase: string;
  decoratorGroups: DecoratorGroup[];
  totalItems: number; totalUnits: number;
};

type DecoratorGroup = {
  decoratorId: string | null; decoratorName: string; shortCode: string;
  items: ProdItem[];
  inProduction: number; shipped: number; totalUnits: number;
  contacts: { name: string; email: string | null }[];
};

export default function ProductionPage() {
  const supabase = createClient();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterDecorator, setFilterDecorator] = useState("");
  const [filterStalled, setFilterStalled] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCompose, setShowCompose] = useState<{ jobId: string; decoratorId: string; contacts: any[]; defaultSubject: string } | null>(null);
  const saveTimers = useRef<Record<string, any>>({});
  const now = new Date();

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, job_number, target_ship_date, phase, type_meta, clients(name)")
      .in("phase", ["production", "receiving", "fulfillment"]);

    if (!jobs?.length) { setProjects([]); setLoading(false); return; }

    const jobIds = jobs.map(j => j.id);
    const jobMap: Record<string, any> = {};
    jobs.forEach(j => { jobMap[j.id] = j; });

    const { data: allItems } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered), decorator_assignments(id, pipeline_stage, decoration_type, decorator_id, decorators(id, name, short_code, contacts_list))")
      .in("job_id", jobIds)
      .order("sort_order");

    // Group items by job, then by decorator within each job
    const projectMap: Record<string, ProjectGroup> = {};

    for (const it of (allItems || [])) {
      const job = jobMap[it.job_id];
      if (!job) continue;

      const assignment = it.decorator_assignments?.[0];
      const decName = assignment?.decorators?.name || "Unassigned";
      const decId = assignment?.decorator_id || assignment?.decorators?.id || null;
      const shortCode = assignment?.decorators?.short_code || "";
      const contacts = assignment?.decorators?.contacts_list || [];
      const lines = it.buy_sheet_lines || [];
      const sizes = sortSizes(lines.map((l: any) => l.size));
      const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
      const totalUnits = lines.reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0);

      const prodItem: ProdItem = {
        id: it.id, name: it.name, job_id: it.job_id,
        pipeline_stage: it.pipeline_stage === "shipped" ? "shipped" : "in_production",
        ship_tracking: it.ship_tracking,
        pipeline_timestamps: it.pipeline_timestamps || {},
        blank_vendor: it.blank_vendor, blank_sku: it.blank_sku,
        decorator_name: decName, decorator_short_code: shortCode,
        decorator_id: decId,
        decorator_assignment_id: assignment?.id || null,
        target_ship_date: job.target_ship_date,
        total_units: totalUnits, sizes, qtys,
        ship_qtys: it.ship_qtys || {}, ship_notes: it.ship_notes || "",
      };

      if (!projectMap[it.job_id]) {
        projectMap[it.job_id] = {
          jobId: job.id, jobNumber: job.job_number,
          invoiceNumber: (job as any).type_meta?.qb_invoice_number || null,
          jobTitle: job.title,
          clientName: job.clients?.name || "", shipDate: job.target_ship_date,
          phase: job.phase, decoratorGroups: [], totalItems: 0, totalUnits: 0,
        };
      }
      projectMap[it.job_id].totalItems++;
      projectMap[it.job_id].totalUnits += totalUnits;

      // Find or create decorator group
      const decKey = decId || decName;
      let decGroup = projectMap[it.job_id].decoratorGroups.find(
        g => (g.decoratorId || g.decoratorName) === decKey
      );
      if (!decGroup) {
        decGroup = {
          decoratorId: decId, decoratorName: decName, shortCode,
          items: [], inProduction: 0, shipped: 0, totalUnits: 0,
          contacts: (contacts || []).map((c: any) => ({ name: c.name, email: c.email })),
        };
        projectMap[it.job_id].decoratorGroups.push(decGroup);
      }
      decGroup.items.push(prodItem);
      decGroup.totalUnits += totalUnits;
      if (prodItem.pipeline_stage === "shipped") decGroup.shipped++;
      else decGroup.inProduction++;
    }

    // Sort projects by ship date
    const sorted = Object.values(projectMap).sort((a, b) => {
      if (!a.shipDate) return 1;
      if (!b.shipDate) return -1;
      return new Date(a.shipDate).getTime() - new Date(b.shipDate).getTime();
    });

    setProjects(sorted);
    setLoading(false);
  }

  // ── Item actions ──
  async function markShipped(item: ProdItem) {
    const ts = new Date().toISOString();
    const timestamps = { ...(item.pipeline_timestamps || {}), shipped: ts };
    await supabase.from("items").update({
      pipeline_stage: "shipped", pipeline_timestamps: timestamps,
      ship_notes: item.ship_notes || null, ship_tracking: item.ship_tracking || null,
      received_at_hpd: false, received_at_hpd_at: null,
    }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: "shipped" }).eq("id", item.decorator_assignment_id);
    }
    logJobActivity(item.job_id, `${item.name} shipped from decorator${item.ship_tracking ? ` — tracking: ${item.ship_tracking}` : ""}`);
    notifyTeam(`Item shipped from decorator — ${item.name} incoming to warehouse`, "production", item.job_id, "job");
    // Auto-email client for drop-ship orders (fire-and-forget)
    fetch("/api/email/notify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: item.job_id, type: "order_shipped_dropship", trackingNumber: item.ship_tracking || undefined }),
    }).catch(() => {});
    loadAll();
  }

  async function undoShipped(item: ProdItem) {
    const timestamps = { ...(item.pipeline_timestamps || {}) };
    delete timestamps.shipped;
    await supabase.from("items").update({
      pipeline_stage: "in_production", pipeline_timestamps: timestamps,
      received_at_hpd: false, received_at_hpd_at: null,
    }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("id", item.decorator_assignment_id);
    }
    loadAll();
  }

  function updateField(itemId: string, field: string, value: string) {
    setProjects(prev => prev.map(p => ({
      ...p, decoratorGroups: p.decoratorGroups.map(dg => ({
        ...dg, items: dg.items.map(it => it.id === itemId ? { ...it, [field]: value } : it)
      }))
    })));
    if (saveTimers.current[`${field}_${itemId}`]) clearTimeout(saveTimers.current[`${field}_${itemId}`]);
    saveTimers.current[`${field}_${itemId}`] = setTimeout(() => {
      supabase.from("items").update({ [field]: value || null }).eq("id", itemId);
    }, 800);
  }

  // ── Stats ──
  const allItems = projects.flatMap(p => p.decoratorGroups.flatMap(dg => dg.items));
  const atDecorator = allItems.filter(it => it.pipeline_stage === "in_production").length;
  const stalled = allItems.filter(it => {
    const ts = it.pipeline_timestamps?.[it.pipeline_stage || ""];
    if (!ts) return false;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) >= 7;
  }).length;
  const shippingThisWeek = allItems.filter(it => {
    if (!it.target_ship_date) return false;
    const diff = Math.ceil((new Date(it.target_ship_date).getTime() - now.getTime()) / 86400000);
    return diff >= 0 && diff <= 7;
  }).length;
  const decorators = useMemo(() => [...new Set(allItems.map(it => it.decorator_name).filter(Boolean))].sort(), [projects]);

  // ── Filter ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return projects.filter(p => {
      if (q && !(p.clientName.toLowerCase().includes(q) || p.jobTitle.toLowerCase().includes(q) || p.jobNumber.toLowerCase().includes(q) || (p.invoiceNumber || "").toLowerCase().includes(q) ||
        p.decoratorGroups.some(dg => dg.decoratorName.toLowerCase().includes(q) || dg.items.some(it => it.name.toLowerCase().includes(q))))) return false;
      if (filterDecorator && !p.decoratorGroups.some(dg => dg.decoratorName === filterDecorator)) return false;
      return true;
    });
  }, [projects, search, filterDecorator]);

  const getDaysToShip = (d: string | null) => {
    if (!d) return null;
    return Math.ceil((new Date(d).getTime() - now.getTime()) / 86400000);
  };

  const getDaysInStage = (item: ProdItem) => {
    const ts = item.pipeline_timestamps?.[item.pipeline_stage || ""];
    if (!ts) return null;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  };

  const shipDatePill = (d: string | null) => {
    const days = getDaysToShip(d);
    if (days === null) return null;
    const color = days < 0 ? T.red : days <= 3 ? T.amber : T.green;
    const bg = days < 0 ? T.redDim : days <= 3 ? T.amberDim : T.greenDim;
    const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`;
    return { color, bg, label, dateStr: new Date(d!).toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
  };

  const ic: React.CSSProperties = { padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 11, fontFamily: mono, outline: "none", width: "100%" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading production...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Production</h1>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{allItems.length} items across {projects.length} projects</div>
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
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, clients, decorators..."
          style={{ flex: 1, maxWidth: 320, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
        <select value={filterDecorator} onChange={e => setFilterDecorator(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: filterDecorator ? T.text : T.muted, fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">All decorators</option>
          {decorators.map(d => <option key={d} value={d!}>{d}</option>)}
        </select>
      </div>

      {/* Project rows */}
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>No active production</div>
      )}

      {filtered.map(project => {
        const isExpanded = expanded.has(project.jobId);
        const ship = shipDatePill(project.shipDate);
        const allShipped = project.decoratorGroups.every(dg => dg.items.every(it => it.pipeline_stage === "shipped"));

        return (
          <div key={project.jobId} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden",
          }}>
            {/* ── Collapsed row ── */}
            <div
              onClick={() => setExpanded(prev => {
                const next = new Set(prev);
                next.has(project.jobId) ? next.delete(project.jobId) : next.add(project.jobId);
                return next;
              })}
              style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                borderBottom: isExpanded ? `1px solid ${T.border}` : "none",
              }}
            >
              <div style={{ flex: 1 }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{project.invoiceNumber || project.jobNumber}</span>
                  {project.invoiceNumber && <span style={{ fontSize: 10, color: T.faint }}>{project.jobNumber}</span>}
                  <span style={{ fontSize: 13, color: T.muted }}>{project.clientName}</span>
                  {allShipped && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>All Shipped</span>}
                </div>

                {/* Per-decorator mini breakdown */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {project.decoratorGroups.map(dg => (
                    <div key={dg.decoratorId || dg.decoratorName} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "4px 10px", borderRadius: 6, background: T.surface,
                      fontSize: 11,
                    }}>
                      <span style={{ fontWeight: 600, color: T.text }}>{dg.shortCode || dg.decoratorName}</span>
                      <span style={{ color: T.muted }}>{dg.items.length} item{dg.items.length !== 1 ? "s" : ""}</span>
                      <span style={{ color: T.faint }}>·</span>
                      {dg.inProduction > 0 && <span style={{ color: T.accent }}>{dg.inProduction} active</span>}
                      {dg.shipped > 0 && <span style={{ color: T.green }}>{dg.shipped} shipped</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right side: ship date + expand arrow */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: 12 }}>
                {ship && (
                  <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: ship.bg, color: ship.color }}>
                    {ship.dateStr} · {ship.label}
                  </div>
                )}
                <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {project.totalUnits.toLocaleString()} units
                </span>
                <span style={{ fontSize: 18, color: T.faint, transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "none" }}>▾</span>
              </div>
            </div>

            {/* ── Expanded: decorator groups ── */}
            {isExpanded && (
              <div style={{ padding: "0 18px 18px" }}>
                {project.decoratorGroups.map(dg => (
                  <div key={dg.decoratorId || dg.decoratorName} style={{
                    marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden",
                  }}>
                    {/* Decorator header */}
                    <div style={{
                      padding: "10px 14px", background: T.surface,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      borderBottom: `1px solid ${T.border}`,
                    }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{dg.decoratorName}</span>
                        <span style={{ fontSize: 11, color: T.muted, marginLeft: 8 }}>
                          {dg.items.length} item{dg.items.length !== 1 ? "s" : ""} · {dg.totalUnits.toLocaleString()} units
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {dg.inProduction > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.accentDim, color: T.accent }}>{dg.inProduction} in production</span>}
                        {dg.shipped > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>{dg.shipped} shipped</span>}
                        {dg.inProduction > 1 && (
                          <button onClick={async (e) => {
                            e.stopPropagation();
                            // Copy tracking from first item that has one to all others
                            const src = dg.items.find(it => it.ship_tracking && it.pipeline_stage !== "shipped");
                            if (src) {
                              for (const it of dg.items.filter(it2 => it2.pipeline_stage !== "shipped" && it2.id !== src.id)) {
                                await supabase.from("items").update({ ship_tracking: src.ship_tracking, ship_notes: src.ship_notes || null }).eq("id", it.id);
                              }
                            }
                            // Ship all unshipped items
                            for (const it of dg.items.filter(it2 => it2.pipeline_stage !== "shipped")) {
                              await markShipped(it);
                            }
                          }} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: T.green, color: "#fff", border: "none", cursor: "pointer" }}>
                            Ship All
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Items */}
                    <div style={{ padding: "10px 14px" }}>
                      {dg.items.map(item => {
                        const days = getDaysInStage(item);
                        const isShipped = item.pipeline_stage === "shipped";
                        return (
                          <div key={item.id} style={{
                            padding: "8px 10px", borderRadius: 6, marginBottom: 6,
                            background: isShipped ? T.greenDim + "44" : "transparent",
                            border: `1px solid ${isShipped ? T.green + "33" : T.border}`,
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{item.name}</span>
                                <span style={{ fontSize: 10, color: T.muted, marginLeft: 8 }}>
                                  {item.blank_vendor} · {item.total_units} units
                                </span>
                                {days !== null && days >= 7 && (
                                  <span style={{ fontSize: 10, fontWeight: 600, color: T.red, marginLeft: 8 }}>{days}d in stage</span>
                                )}
                                {days !== null && days >= 3 && days < 7 && (
                                  <span style={{ fontSize: 10, fontWeight: 600, color: T.amber, marginLeft: 8 }}>{days}d in stage</span>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {isShipped ? (
                                  <>
                                    <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>
                                      {item.ship_tracking || "Shipped"}
                                    </span>
                                    <button onClick={(e) => { e.stopPropagation(); undoShipped(item); }}
                                      style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                                      Undo
                                    </button>
                                  </>
                                ) : (
                                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                    <input value={item.ship_tracking || ""} placeholder="Tracking #"
                                      onChange={e => updateField(item.id, "ship_tracking", e.target.value)}
                                      onClick={e => e.stopPropagation()}
                                      style={{ ...ic, width: 160 }} />
                                    <input value={item.ship_notes || ""} placeholder="Notes"
                                      onChange={e => updateField(item.id, "ship_notes", e.target.value)}
                                      onClick={e => e.stopPropagation()}
                                      style={{ ...ic, width: 120 }} />
                                    <button onClick={(e) => { e.stopPropagation(); markShipped(item); }}
                                      style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: T.green, color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                                      Ship
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Per-size ship qty (collapsed, expand on click) */}
                            {!isShipped && item.sizes.length > 0 && (
                              <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                                {item.sizes.map(sz => {
                                  const ordered = item.qtys[sz] || 0;
                                  const shipped = (item.ship_qtys || {})[sz] || ordered;
                                  return (
                                    <div key={sz} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10 }}>
                                      <span style={{ color: T.faint, width: 24 }}>{sz}</span>
                                      <input
                                        type="text" inputMode="numeric" value={shipped}
                                        onClick={e => { e.stopPropagation(); (e.target as HTMLInputElement).select(); }}
                                        onChange={e => {
                                          const val = parseInt(e.target.value) || 0;
                                          const newQtys = { ...(item.ship_qtys || {}), [sz]: val };
                                          setProjects(prev => prev.map(p => ({
                                            ...p, decoratorGroups: p.decoratorGroups.map(dg2 => ({
                                              ...dg2, items: dg2.items.map(it => it.id === item.id ? { ...it, ship_qtys: newQtys } : it)
                                            }))
                                          })));
                                          if (saveTimers.current[`sqty_${item.id}`]) clearTimeout(saveTimers.current[`sqty_${item.id}`]);
                                          saveTimers.current[`sqty_${item.id}`] = setTimeout(() => {
                                            supabase.from("items").update({ ship_qtys: newQtys }).eq("id", item.id);
                                          }, 800);
                                        }}
                                        style={{ ...ic, width: 32, padding: "2px 4px", textAlign: "center", fontSize: 10, fontFamily: mono }}
                                      />
                                      <span style={{ color: T.faint }}>/{ordered}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Decorator email thread */}
                    <div style={{ padding: "0 14px 14px" }}>
                      <EmailThread
                        jobId={project.jobId}
                        channel="production"
                        decoratorId={dg.decoratorId || undefined}
                        onCompose={() => setShowCompose({
                          jobId: project.jobId,
                          decoratorId: dg.decoratorId || "",
                          contacts: dg.contacts,
                          defaultSubject: `Re: HPD PO# ${project.invoiceNumber || project.jobNumber} — House Party Distro`,
                        })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Compose modal for production emails */}
      {showCompose && (
        <ComposeEmail
          jobId={showCompose.jobId}
          contacts={[]}
          decoratorContacts={showCompose.contacts}
          channel="production"
          decoratorId={showCompose.decoratorId}
          defaultSubject={showCompose.defaultSubject}
          onClose={() => setShowCompose(null)}
          onSent={() => loadAll()}
        />
      )}
    </div>
  );
}
