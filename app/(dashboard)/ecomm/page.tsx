"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";

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

export default function EcommPage() {
  const supabase = createClient();
  const [projects, setProjects] = useState<EcommProject[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<EcommProject["mode"]>("preorder");
  const [showNew, setShowNew] = useState(false);
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
    const [projRes, clientRes, invCounts] = await Promise.all([
      supabase
        .from("fulfillment_projects")
        .select("*, clients(name)")
        .not("mode", "is", null)
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("fulfillment_inventory").select("project_id"),
    ]);

    const lineCountByProject: Record<string, number> = {};
    for (const row of (invCounts.data || [])) {
      lineCountByProject[(row as any).project_id] = (lineCountByProject[(row as any).project_id] || 0) + 1;
    }

    setProjects(((projRes.data || []) as any[]).map(p => ({
      ...p,
      client_name: p.clients?.name || "—",
      line_count: lineCountByProject[p.id] || 0,
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

  const tabProjects = projects.filter(p => p.mode === tab);
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

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: 4, background: T.surface, borderRadius: 8 }}>
        {([
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

      {/* + New */}
      <button onClick={() => setShowNew(!showNew)}
        style={{ alignSelf: "flex-start", padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: font }}>
        + New Ecomm Project
      </button>

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

      {/* Project list for active tab */}
      {tabProjects.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
          No {MODE_LABELS[tab].toLowerCase()} projects yet. Click "+ New Ecomm Project" to start.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tabProjects.map(proj => (
            <Link key={proj.id} href={`/ecomm/${proj.id}`} style={{ textDecoration: "none", color: T.text }}>
              <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{proj.name}</span>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: proj.status === "active" ? T.greenDim : T.amberDim, color: proj.status === "active" ? T.green : T.amber, fontWeight: 600, textTransform: "capitalize" }}>
                      {proj.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    {proj.client_name}
                    {proj.platform && ` · ${PLATFORM_LABELS[proj.platform] || proj.platform}`}
                    {proj.store_account && ` · ${proj.store_account}`}
                  </div>
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
                  <div>
                    <div style={{ color: T.faint, fontSize: 9 }}>Lines</div>
                    <div style={{ fontFamily: mono, color: T.text, fontWeight: 600 }}>{proj.line_count}</div>
                  </div>
                </div>
                <span style={{ fontSize: 14, color: T.faint }}>›</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Footer hint about what's coming */}
      <div style={{ marginTop: 12, padding: "12px 14px", background: T.surface, border: `1px dashed ${T.border}`, borderRadius: 8, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, color: T.text, marginBottom: 4 }}>Foundation in place — what's next:</div>
        Phase B will add Shopify polling for inventory + order velocity, replenishment alerts when SKUs run low, and the "Close pre-order" tally that auto-fills a Buy Sheet on the linked Labs job.
      </div>
    </div>
  );
}
