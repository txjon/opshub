"use client";
import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, type WarehouseItem } from "@/lib/use-warehouse";
import { useShipments, type Shipment } from "@/lib/use-shipments";

type PreorderStatus = "planning" | "building" | "open" | "closed" | "producing" | "fulfilling" | "complete";

type EcommProject = {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string;
  store_name: string | null;
  status: string;
  mode: "preorder" | "drop" | "always_on";
  platform: string | null;
  store_account: string | null;
  open_date: string | null;
  close_date: string | null;
  target_ship_date: string | null;
  buffer_pct: number | null;
  listed_by: string | null;
  notes: string | null;
  created_at: string;
  line_count: number;
  // Pre-order-specific workflow status (migration 079). Null for non-
  // preorder modes; required for preorders.
  preorder_status: PreorderStatus | null;
  product_count: number;
  products_built: number;
  source_job_id: string | null;
};

const PREORDER_STATUS_LABELS: Record<PreorderStatus, string> = {
  planning: "Planning",
  building: "Building in Shopify",
  open: "Open · live",
  closed: "Closed · pending push",
  producing: "Producing",
  fulfilling: "Fulfilling",
  complete: "Complete",
};

const PREORDER_STATUS_COLORS: Record<PreorderStatus, string> = {
  planning: "var(--muted)",      // resolved below via T at render time
  building: "var(--accent)",
  open: "var(--green)",
  closed: "var(--amber)",
  producing: "var(--accent)",
  fulfilling: "var(--purple)",
  complete: "var(--faint)",
};

type Client = { id: string; name: string };

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

type EcommTab = "intake" | EcommProject["mode"];

export default function EcommPage() {
  const supabase = createClient();
  const { jobs: warehouseJobs, bulkMarkWebstoreEntered } = useWarehouse();
  const shipments = useShipments(warehouseJobs);
  const [projects, setProjects] = useState<EcommProject[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<EcommTab>("intake");
  const [showNew, setShowNew] = useState(false);
  // Intake modal — opens on row click; shows items awaiting Shopify
  // entry with bulk "Mark entered" action.
  const [intakeShipmentKey, setIntakeShipmentKey] = useState<string | null>(null);
  const [intakeSelected, setIntakeSelected] = useState<Set<string>>(new Set());

  // Intake queue — shipments on stage-route jobs that have received
  // items not yet keyed into Shopify. Front office's daily work surface.
  const intakeShipments = useMemo(() => {
    return shipments.filter(s => {
      const isStage = s.jobs.some(j => j.shipping_route === "stage");
      if (!isStage) return false;
      const receivedNotEntered = s.items.filter(it => it.received_at_hpd && !it.webstore_entered_at);
      return receivedNotEntered.length > 0;
    });
  }, [shipments]);

  const intakeShipment = useMemo(
    () => intakeShipmentKey ? intakeShipments.find(s => s.key === intakeShipmentKey) || shipments.find(s => s.key === intakeShipmentKey) || null : null,
    [intakeShipmentKey, intakeShipments, shipments],
  );

  // Reset selection on open + initialize to all-eligible
  useEffect(() => {
    if (intakeShipment) {
      const eligible = intakeShipment.items.filter(it => it.received_at_hpd && !it.webstore_entered_at);
      setIntakeSelected(new Set(eligible.map(it => it.id)));
    } else {
      setIntakeSelected(new Set());
    }
  }, [intakeShipmentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!intakeShipmentKey) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIntakeShipmentKey(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [intakeShipmentKey]);
  const [newForm, setNewForm] = useState({
    name: "",
    client_id: "",
    mode: "preorder" as EcommProject["mode"],
    platform: "shopify",
    store_account: "",
    open_date: "",
    close_date: "",
    target_ship_date: "",
    buffer_pct: "5",
    listed_by: "client",
    notes: "",
  });

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [projRes, clientRes, invCounts, productsRes] = await Promise.all([
      supabase
        .from("fulfillment_projects")
        .select("*, clients(name)")
        .not("mode", "is", null)
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("fulfillment_inventory").select("project_id"),
      // Preorder products — used to roll up Built-in-Shopify progress
      // per pre-order on the list view. Cheap join client-side.
      supabase.from("preorder_products").select("preorder_id, is_built_in_shopify"),
    ]);

    const lineCountByProject: Record<string, number> = {};
    for (const row of (invCounts.data || [])) {
      lineCountByProject[(row as any).project_id] = (lineCountByProject[(row as any).project_id] || 0) + 1;
    }
    const productCountByPreorder: Record<string, { total: number; built: number }> = {};
    for (const row of (productsRes.data || []) as any[]) {
      const k = row.preorder_id;
      if (!productCountByPreorder[k]) productCountByPreorder[k] = { total: 0, built: 0 };
      productCountByPreorder[k].total++;
      if (row.is_built_in_shopify) productCountByPreorder[k].built++;
    }

    setProjects(((projRes.data || []) as any[]).map(p => ({
      ...p,
      client_name: p.clients?.name || "—",
      line_count: lineCountByProject[p.id] || 0,
      product_count: productCountByPreorder[p.id]?.total || 0,
      products_built: productCountByPreorder[p.id]?.built || 0,
      preorder_status: p.preorder_status || (p.mode === "preorder" ? "planning" : null),
    })));
    setClients(clientRes.data || []);
    setLoading(false);
  }

  async function createProject() {
    if (!newForm.name.trim()) return;
    const insert: any = {
      name: newForm.name.trim(),
      client_id: newForm.client_id || null,
      mode: newForm.mode,
      platform: newForm.platform || null,
      store_account: newForm.store_account.trim() || null,
      store_name: newForm.store_account.trim() || null,
      open_date: newForm.open_date || null,
      close_date: newForm.close_date || null,
      target_ship_date: newForm.target_ship_date || null,
      buffer_pct: parseFloat(newForm.buffer_pct) || 5.0,
      listed_by: newForm.listed_by || null,
      notes: newForm.notes.trim() || null,
      status: "staging",
      // Pre-orders start in 'planning' so they show up on the new
      // workflow-aware list. Other modes (drop / always_on) skip this
      // field; they keep using the legacy fulfillment_projects flow.
      preorder_status: newForm.mode === "preorder" ? "planning" : null,
    };
    await supabase.from("fulfillment_projects").insert(insert);
    setNewForm({
      name: "", client_id: "", mode: "preorder",
      platform: "shopify", store_account: "",
      open_date: "", close_date: "", target_ship_date: "",
      buffer_pct: "5", listed_by: "client", notes: "",
    });
    setShowNew(false);
    loadAll();
  }

  const tabProjects = tab === "intake" ? [] : projects.filter(p => p.mode === tab);
  const counts = {
    preorder: projects.filter(p => p.mode === "preorder").length,
    drop: projects.filter(p => p.mode === "drop").length,
    always_on: projects.filter(p => p.mode === "always_on").length,
  };
  const openPreorders = projects.filter(p => p.mode === "preorder" && p.status !== "complete").length;
  const totalActive = projects.filter(p => p.status !== "complete").length;

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading…</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>E-Commerce</h1>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>Storefronts, pre-orders, drops, and always-on inventory across Shopify · BigCommerce · BigCartel</div>
      </div>

      {/* KPI strip — placeholders that fill in once polling/velocity lands (Phase B) */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "Active projects", value: totalActive, color: T.accent },
          { label: "Open pre-orders", value: openPreorders, color: openPreorders > 0 ? T.amber : T.faint },
          { label: "Replenishment risk", value: "—", hint: "Phase B (velocity)", color: T.faint },
          { label: "Shipping this week", value: "—", hint: "Phase B (orders feed)", color: T.faint },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: typeof s.value === "number" && s.value > 0 ? s.color : T.faint, fontFamily: mono }}>{s.value}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{s.label}</div>
            {s.hint && <div style={{ fontSize: 9, color: T.faint, marginTop: 1, fontStyle: "italic" }}>{s.hint}</div>}
          </div>
        ))}
      </div>

      {/* Tabs — Intake first (daily working list for front office),
          then the project-management tabs. */}
      <div style={{ display: "flex", gap: 4, padding: 4, background: T.surface, borderRadius: 8 }}>
        {([
          { id: "intake" as const, label: "Intake", count: intakeShipments.length },
          { id: "preorder" as const, label: "Pre-orders", count: counts.preorder },
          { id: "drop" as const, label: "In-stock drops", count: counts.drop },
          { id: "always_on" as const, label: "Always-on stores", count: counts.always_on },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: font, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: tab === t.id ? T.accent : "transparent", color: tab === t.id ? "#fff" : T.muted }}>
            {t.label}
            {t.count > 0 && <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, padding: "1px 6px", borderRadius: 4, background: tab === t.id ? "rgba(255,255,255,0.2)" : T.card, color: tab === t.id ? "#fff" : T.accent }}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ── INTAKE TAB — Shopify entry queue ── */}
      {tab === "intake" && (
        <>
          {intakeShipments.length === 0 ? (
            <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint, lineHeight: 1.6 }}>
              No items waiting for Shopify entry.<br />
              Stage-route shipments appear here once the warehouse marks them received.
            </div>
          ) : (
            intakeShipments.map(s => {
              const primary = s.jobs[0];
              const eligible = s.items.filter(it => it.received_at_hpd && !it.webstore_entered_at);
              const eligibleUnits = eligible.reduce((a, it) => {
                const r = it.received_qtys || {};
                const sq = it.ship_qtys || {};
                const o = it.qtys || {};
                let total = 0;
                for (const sz of it.sizes) total += (r as any)[sz] ?? (sq as any)[sz] ?? (o as any)[sz] ?? 0;
                return a + total;
              }, 0);
              const receivedDays = s.received_at ? Math.floor((Date.now() - new Date(s.received_at).getTime()) / 86400000) : 0;
              const isAged = receivedDays >= 3;
              return (
                <div key={s.key}
                  onClick={() => setIntakeShipmentKey(s.key)}
                  style={{
                    ...card, padding: "14px 18px", display: "flex", gap: 16,
                    alignItems: "flex-start", cursor: "pointer",
                    transition: "border-color 0.12s",
                    borderLeft: `3px solid ${isAged ? T.amber : T.accent}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                        {primary?.client_name || "No client"}
                      </span>
                      {primary && (
                        <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>{primary.display_number}</span>
                      )}
                    </div>
                    {primary?.title && (
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 2, wordBreak: "break-word" }}>{primary.title}</div>
                    )}
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>from <strong style={{ color: T.text, fontWeight: 600 }}>{s.short_code || s.decorator_name}</strong></span>
                      {s.received_at && (
                        <span style={{ color: isAged ? T.amber : T.faint }}>
                          received {new Date(s.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {receivedDays >= 1 && ` · ${receivedDays}d ago`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 110 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.amber, fontFamily: mono }}>
                      {eligible.length} item{eligible.length === 1 ? "" : "s"}
                    </div>
                    <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {eligibleUnits.toLocaleString()} units
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}

      {/* + New — only shown on project-management tabs */}
      {tab !== "intake" && (
      <button onClick={() => setShowNew(!showNew)}
        style={{ alignSelf: "flex-start", padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: font }}>
        + New Ecomm Project
      </button>
      )}

      {/* New project form */}
      {showNew && (
        <div style={{ ...card, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>New Ecomm Project</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Project name *</label>
              <input style={ic} value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Tour 2026 Pre-order" />
            </div>
            <div>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Client *</label>
              <select style={ic} value={newForm.client_id} onChange={e => setNewForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">— select —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Mode *</label>
              <select style={ic} value={newForm.mode} onChange={e => setNewForm(f => ({ ...f, mode: e.target.value as EcommProject["mode"] }))}>
                <option value="preorder">Pre-order</option>
                <option value="drop">In-stock drop</option>
                <option value="always_on">Always-on store</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Platform</label>
              <select style={ic} value={newForm.platform} onChange={e => setNewForm(f => ({ ...f, platform: e.target.value }))}>
                <option value="shopify">Shopify</option>
                <option value="bigcommerce">BigCommerce</option>
                <option value="bigcartel">BigCartel</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Store URL</label>
              <input style={ic} value={newForm.store_account} onChange={e => setNewForm(f => ({ ...f, store_account: e.target.value }))} placeholder="Public storefront URL (any URL works — admin access optional)" />
              <div style={{ fontSize: 9, color: T.faint, marginTop: 3, fontStyle: "italic" }}>
                Public URL is fine. Shopify admin domain only needed later for API polling.
              </div>
            </div>
            {newForm.mode === "preorder" && (
              <>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Open date</label>
                  <input type="date" style={ic} value={newForm.open_date} onChange={e => setNewForm(f => ({ ...f, open_date: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Close date</label>
                  <input type="date" style={ic} value={newForm.close_date} onChange={e => setNewForm(f => ({ ...f, close_date: e.target.value }))} />
                </div>
              </>
            )}
            <div>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Target ship date</label>
              <input type="date" style={ic} value={newForm.target_ship_date} onChange={e => setNewForm(f => ({ ...f, target_ship_date: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Listed by</label>
              <select style={ic} value={newForm.listed_by} onChange={e => setNewForm(f => ({ ...f, listed_by: e.target.value }))}>
                <option value="client">Client</option>
                <option value="hpd">HPD</option>
              </select>
            </div>
            {newForm.mode === "preorder" && (
              <div>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Buffer %</label>
                <input type="number" style={ic} value={newForm.buffer_pct} onChange={e => setNewForm(f => ({ ...f, buffer_pct: e.target.value }))} placeholder="5" />
              </div>
            )}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
            <input style={ic} value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Anything about this drop / store" />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={createProject} disabled={!newForm.name.trim() || !newForm.client_id}
              style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600, opacity: (newForm.name.trim() && newForm.client_id) ? 1 : 0.5 }}>
              Create
            </button>
            <button onClick={() => setShowNew(false)}
              style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 12 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Project list for active tab — only on project-management tabs */}
      {tab !== "intake" && tabProjects.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
          No {MODE_LABELS[tab as EcommProject["mode"]].toLowerCase()} projects yet. Click "+ New Ecomm Project" to start.
        </div>
      ) : tab === "intake" ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tabProjects.map(proj => {
            const isPreorder = proj.mode === "preorder";
            // Status-driven color tone for the left rail. Lets the list
            // read like a workflow board: planning is muted, open is
            // green, closed needs action (amber), etc.
            const statusToneFor = (s: PreorderStatus | null) => {
              if (!s) return T.border;
              const map: Record<PreorderStatus, string> = {
                planning: T.muted,
                building: T.accent,
                open: T.green,
                closed: T.amber,
                producing: T.accent,
                fulfilling: T.purple,
                complete: T.faint,
              };
              return map[s];
            };
            const tone = isPreorder ? statusToneFor(proj.preorder_status) : T.border;
            return (
              <Link key={proj.id} href={`/ecomm/${proj.id}`} style={{ textDecoration: "none", color: T.text }}>
                <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, borderLeft: `3px solid ${tone}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{proj.name}</span>
                      {isPreorder && proj.preorder_status && (
                        <span style={{ fontSize: 10, fontWeight: 800, color: tone, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {PREORDER_STATUS_LABELS[proj.preorder_status]}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {proj.client_name}
                      {proj.platform && ` · ${PLATFORM_LABELS[proj.platform] || proj.platform}`}
                      {proj.store_account && ` · ${proj.store_account}`}
                    </div>
                    {/* Product build progress — only shows when the
                        pre-order has products defined. Visible cue for
                        Abigail's Shopify-build task. */}
                    {isPreorder && proj.product_count > 0 && (
                      <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
                        Shopify build:&nbsp;
                        <strong style={{ color: proj.products_built === proj.product_count ? T.green : T.text, fontFamily: mono }}>
                          {proj.products_built}/{proj.product_count}
                        </strong>
                      </div>
                    )}
                  </div>
                  {/* Dates */}
                  <div style={{ display: "flex", gap: 14, fontSize: 10, color: T.muted, flexShrink: 0 }}>
                    {proj.mode === "preorder" && proj.open_date && (
                      <div>
                        <div style={{ color: T.faint, fontSize: 9 }}>Opens</div>
                        <div style={{ fontFamily: mono, color: T.text, fontWeight: 600 }}>{new Date(proj.open_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                      </div>
                    )}
                    {proj.mode === "preorder" && proj.close_date && (
                      <div>
                        <div style={{ color: T.faint, fontSize: 9 }}>Closes</div>
                        <div style={{ fontFamily: mono, color: T.text, fontWeight: 600 }}>{new Date(proj.close_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                      </div>
                    )}
                    {proj.target_ship_date && (
                      <div>
                        <div style={{ color: T.faint, fontSize: 9 }}>Ship</div>
                        <div style={{ fontFamily: mono, color: T.text, fontWeight: 600 }}>{new Date(proj.target_ship_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                      </div>
                    )}
                    {!isPreorder && (
                      <div>
                        <div style={{ color: T.faint, fontSize: 9 }}>Lines</div>
                        <div style={{ fontFamily: mono, color: T.text, fontWeight: 600 }}>{proj.line_count}</div>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 14, color: T.faint }}>›</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Footer hint about what's coming — hidden on intake tab to keep
          the working list uncluttered. */}
      {tab !== "intake" && (
        <div style={{ marginTop: 12, padding: "12px 14px", background: T.surface, border: `1px dashed ${T.border}`, borderRadius: 8, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, color: T.text, marginBottom: 4 }}>Foundation in place — what's next:</div>
          Phase B will add Shopify polling for inventory + order velocity, replenishment alerts when SKUs run low, and the "Close pre-order" tally that auto-fills a Buy Sheet on the linked Labs job.
        </div>
      )}

      {/* Intake modal — Shopify-entry workflow. Front office picks items
          they've keyed into Shopify and marks them entered. Items still
          pending get checkboxes + bulk action; already-entered items
          render greyed so the modal still works as an audit view if
          revisited later. */}
      {intakeShipment && (() => {
        const eligible = intakeShipment.items.filter(it => it.received_at_hpd && !it.webstore_entered_at);
        const alreadyEntered = intakeShipment.items.filter(it => !!it.webstore_entered_at);
        const selectedEligible = eligible.filter(it => intakeSelected.has(it.id));
        const allSelected = eligible.length > 0 && eligible.every(it => intakeSelected.has(it.id));
        const primary = intakeShipment.jobs[0];
        return (
          <div onClick={() => setIntakeShipmentKey(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 32px)" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.card, borderRadius: 14, width: "min(720px, 100%)", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${T.border}` }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{primary?.client_name || "No client"}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {primary?.title && <span>{primary.title}</span>}
                    <span style={{ fontFamily: mono, color: T.faint }}>{primary?.display_number || ""}</span>
                    <span style={{ color: T.faint }}>from {intakeShipment.short_code || intakeShipment.decorator_name}</span>
                  </div>
                </div>
                <button onClick={() => setIntakeShipmentKey(null)}
                  style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Selection header */}
                {eligible.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={() => {
                      setIntakeSelected(prev => {
                        const next = new Set(prev);
                        if (allSelected) for (const it of eligible) next.delete(it.id);
                        else for (const it of eligible) next.add(it.id);
                        return next;
                      });
                    }}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 6,
                        background: allSelected ? T.text : "transparent",
                        border: `1px solid ${allSelected ? T.text : T.border}`,
                        color: allSelected ? "#fff" : T.text,
                        cursor: "pointer", fontFamily: font,
                      }}>
                      {allSelected ? "Unselect all" : "Select all"}
                    </button>
                    <span style={{ fontSize: 11, color: T.muted }}>
                      {selectedEligible.length} of {eligible.length} selected
                    </span>
                  </div>
                )}

                {/* Eligible items — checkboxes for picking */}
                {eligible.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {eligible.map(it => {
                      const isSelected = intakeSelected.has(it.id);
                      const r = it.received_qtys || {};
                      const sq = it.ship_qtys || {};
                      const o = it.qtys || {};
                      let units = 0;
                      for (const sz of it.sizes) units += (r as any)[sz] ?? (sq as any)[sz] ?? (o as any)[sz] ?? 0;
                      return (
                        <label key={it.id}
                          style={{
                            padding: "10px 12px", borderRadius: 8,
                            background: isSelected ? T.card : T.surface,
                            border: `1px solid ${isSelected ? T.accent + "55" : T.border}`,
                            display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
                          }}>
                          <input type="checkbox" checked={isSelected}
                            onChange={() => {
                              setIntakeSelected(prev => {
                                const next = new Set(prev);
                                if (next.has(it.id)) next.delete(it.id);
                                else next.add(it.id);
                                return next;
                              });
                            }}
                            style={{ width: 16, height: 16, cursor: "pointer", accentColor: T.accent, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, fontWeight: 800, color: T.muted, fontFamily: mono, flexShrink: 0 }}>{it.letter}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{it.name}</div>
                            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                              {it.blank_vendor || "—"}
                              {it.blank_sku && <span style={{ marginLeft: 8 }}>{it.blank_sku}</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: T.muted, fontFamily: mono, whiteSpace: "nowrap" }}>
                            {units} units
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Already-entered items — muted, audit-only */}
                {alreadyEntered.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                      Already entered in Shopify ({alreadyEntered.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {alreadyEntered.map(it => (
                        <div key={it.id} style={{ padding: "6px 10px", fontSize: 12, color: T.faint, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span>
                            <span style={{ fontFamily: mono, marginRight: 6 }}>{it.letter}</span>
                            {it.name}
                          </span>
                          {it.webstore_entered_at && (
                            <span style={{ fontSize: 10, fontFamily: mono }}>
                              {new Date(it.webstore_entered_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer — bulk action */}
              <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setIntakeShipmentKey(null)}
                  style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, color: T.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  Cancel
                </button>
                <button onClick={async () => {
                  if (selectedEligible.length === 0) return;
                  await bulkMarkWebstoreEntered(selectedEligible);
                  setIntakeShipmentKey(null);
                }}
                  disabled={selectedEligible.length === 0}
                  style={{
                    padding: "8px 18px", background: selectedEligible.length === 0 ? T.surface : T.green,
                    color: selectedEligible.length === 0 ? T.faint : "#fff",
                    borderRadius: 8, fontSize: 12, fontWeight: 700,
                    cursor: selectedEligible.length === 0 ? "not-allowed" : "pointer",
                    border: "none", fontFamily: font,
                  }}>
                  Mark entered in Shopify · {selectedEligible.length}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
