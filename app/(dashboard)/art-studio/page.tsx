"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";

const STATE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: T.muted, bg: T.surface },
  sent: { label: "Sent", color: T.accent, bg: T.accentDim },
  in_progress: { label: "In Progress", color: T.accent, bg: T.accentDim },
  wip_review: { label: "WIP Review", color: T.amber, bg: T.amberDim },
  client_review: { label: "Client Review", color: T.purple, bg: T.purpleDim },
  revisions: { label: "Revisions", color: T.red, bg: T.redDim },
  final_approved: { label: "Final Approved", color: T.green, bg: T.greenDim },
  delivered: { label: "Delivered", color: T.green, bg: T.greenDim },
};

const STATE_ORDER = ["draft", "sent", "in_progress", "wip_review", "client_review", "revisions", "final_approved", "delivered"];

type Brief = {
  id: string;
  title: string | null;
  concept: string | null;
  state: string;
  deadline: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  version_count: number;
  item_id: string | null;
  job_id: string | null;
  client_id: string | null;
  items?: { name: string } | null;
  jobs?: { title: string; job_number: string } | null;
  clients?: { name: string } | null;
};

type Client = { id: string; name: string };

export default function ArtStudioPage() {
  const supabase = createClient();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);
  const [newBrief, setNewBrief] = useState({ title: "", client_id: "", concept: "", deadline: "" });
  const [creating, setCreating] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<Brief | null>(null);

  useEffect(() => { loadBriefs(); loadClients(); }, []);

  async function loadBriefs() {
    setLoading(true);
    const res = await fetch("/api/art-briefs");
    const data = await res.json();
    setBriefs(data.briefs || []);
    setLoading(false);
  }

  async function loadClients() {
    const { data } = await supabase.from("clients").select("id, name").order("name");
    setClients(data || []);
  }

  async function createBrief() {
    if (!newBrief.title.trim()) return;
    setCreating(true);
    const res = await fetch("/api/art-briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newBrief.title.trim(),
        client_id: newBrief.client_id || null,
        concept: newBrief.concept.trim() || null,
        deadline: newBrief.deadline || null,
        state: "draft",
      }),
    });
    const data = await res.json();
    setCreating(false);
    if (data.brief) {
      setShowNew(false);
      setNewBrief({ title: "", client_id: "", concept: "", deadline: "" });
      setBriefs(p => [data.brief, ...p]);
      setSelectedBrief(data.brief);
    }
  }

  const filtered = stateFilter === "all" ? briefs : briefs.filter(b => b.state === stateFilter);

  // Count by state for filter chips
  const stateCounts: Record<string, number> = {};
  briefs.forEach(b => { stateCounts[b.state] = (stateCounts[b.state] || 0) + 1; });

  const ic = { padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" as const };
  const label = { fontSize: 10, fontWeight: 600 as const, color: T.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4, display: "block" };

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Art Studio</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Design team briefs and creative workflow</p>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
          + New Brief
        </button>
      </div>

      {/* State filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => setStateFilter("all")}
          style={{ padding: "5px 12px", borderRadius: 99, border: `1px solid ${stateFilter === "all" ? T.accent : T.border}`, background: stateFilter === "all" ? T.accentDim : "transparent", color: stateFilter === "all" ? T.accent : T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
          All ({briefs.length})
        </button>
        {STATE_ORDER.map(s => {
          const c = stateCounts[s] || 0;
          if (c === 0) return null;
          const st = STATE_LABELS[s];
          const active = stateFilter === s;
          return (
            <button key={s} onClick={() => setStateFilter(s)}
              style={{ padding: "5px 12px", borderRadius: 99, border: `1px solid ${active ? st.color : T.border}`, background: active ? st.bg : "transparent", color: active ? st.color : T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
              {st.label} ({c})
            </button>
          );
        })}
      </div>

      {/* Brief list */}
      {loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 40, textAlign: "center", fontSize: 13, color: T.faint }}>
          {briefs.length === 0 ? "No briefs yet. Click + New Brief to get started." : "No briefs in this state."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(b => {
            const st = STATE_LABELS[b.state] || STATE_LABELS.draft;
            const context = b.clients?.name || b.jobs?.title || "Unlinked";
            return (
              <div key={b.id} onClick={() => setSelectedBrief(b)}
                style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16, transition: "border-color 0.1s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = T.accent)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = T.border)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{b.title || "Untitled Brief"}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    {context}{b.items?.name ? ` · ${b.items.name}` : ""}
                    {b.deadline && ` · Due ${new Date(b.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                    {b.version_count > 0 && ` · v${b.version_count}`}
                    {b.assigned_to && ` · ${b.assigned_to}`}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "4px 12px", borderRadius: 99, background: st.bg, color: st.color }}>
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* New Brief Modal */}
      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 480, maxWidth: "90vw" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: font, marginBottom: 16 }}>New Art Brief</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={label}>Title *</label>
                <input value={newBrief.title} onChange={e => setNewBrief(p => ({ ...p, title: e.target.value }))} style={{ ...ic, width: "100%" }} placeholder="e.g. Summer tour merch concepts" autoFocus />
              </div>
              <div>
                <label style={label}>Client (optional)</label>
                <select value={newBrief.client_id} onChange={e => setNewBrief(p => ({ ...p, client_id: e.target.value }))} style={{ ...ic, width: "100%", cursor: "pointer" }}>
                  <option value="">— unlinked —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Concept (optional)</label>
                <textarea rows={3} value={newBrief.concept} onChange={e => setNewBrief(p => ({ ...p, concept: e.target.value }))} style={{ ...ic, width: "100%", resize: "vertical" }} placeholder="Brief description of what you need..." />
              </div>
              <div>
                <label style={label}>Deadline (optional)</label>
                <input type="date" value={newBrief.deadline} onChange={e => setNewBrief(p => ({ ...p, deadline: e.target.value }))} style={{ ...ic, width: "100%" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setShowNew(false)} style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 13, cursor: "pointer", fontFamily: font }}>Cancel</button>
              <button onClick={createBrief} disabled={creating || !newBrief.title.trim()} style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: (creating || !newBrief.title.trim()) ? 0.5 : 1 }}>
                {creating ? "Creating..." : "Create Brief"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brief detail modal — reuse ArtBriefPanel via direct import */}
      {selectedBrief && (
        <BriefDetailModal brief={selectedBrief} onClose={(updated) => {
          setSelectedBrief(null);
          if (updated) loadBriefs();
        }} />
      )}
    </div>
  );
}

function BriefDetailModal({ brief, onClose }: { brief: Brief; onClose: (updated?: boolean) => void }) {
  const [form, setForm] = useState({
    title: brief.title || "",
    concept: brief.concept || "",
    placement: (brief as any).placement || "",
    colors: (brief as any).colors || "",
    deadline: brief.deadline || "",
    internal_notes: (brief as any).internal_notes || "",
    state: brief.state || "draft",
    assigned_to: brief.assigned_to || "",
  });
  const [saving, setSaving] = useState(false);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [changed, setChanged] = useState(false);

  async function save(updates: any) {
    setSaving(true);
    await fetch("/api/art-briefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: brief.id, ...updates }),
    });
    setSaving(false);
    setSavedIndicator(true);
    setChanged(true);
    setTimeout(() => setSavedIndicator(false), 1200);
  }

  function handleBlur(field: string) {
    if ((form as any)[field] !== (brief as any)[field]) save({ [field]: (form as any)[field] });
  }

  async function handleDelete() {
    if (!window.confirm("Delete this brief permanently?")) return;
    await fetch(`/api/art-briefs?id=${brief.id}`, { method: "DELETE" });
    onClose(true);
  }

  const ic = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" as const };
  const label = { fontSize: 10, fontWeight: 600 as const, color: T.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4, display: "block" };

  const context = brief.clients?.name || brief.jobs?.title || "Unlinked brief";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(changed); }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, width: "90vw", maxWidth: 800, maxHeight: "90vh", overflow: "auto", fontFamily: font }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{form.title || "Untitled Brief"}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{context}{brief.items?.name ? ` · ${brief.items.name}` : ""}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {savedIndicator && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>Saved</span>}
            {saving && <span style={{ fontSize: 10, color: T.muted }}>Saving...</span>}
            <button onClick={handleDelete} style={{ background: "none", border: `1px solid ${T.border}`, color: T.red, fontSize: 10, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontFamily: font }}>Delete</button>
            <button onClick={() => onClose(changed)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18, padding: "0 4px" }}>×</button>
          </div>
        </div>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={label}>Title</label>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} onBlur={() => handleBlur("title")} style={ic} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>State</label>
              <select value={form.state} onChange={e => { const v = e.target.value; setForm(p => ({ ...p, state: v })); save({ state: v }); }} style={{ ...ic, cursor: "pointer" }}>
                {Object.entries(STATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Deadline</label>
              <input type="date" value={form.deadline || ""} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} onBlur={() => handleBlur("deadline")} style={ic} />
            </div>
            <div>
              <label style={label}>Assigned Designer</label>
              <input value={form.assigned_to} onChange={e => setForm(p => ({ ...p, assigned_to: e.target.value }))} onBlur={() => handleBlur("assigned_to")} style={ic} placeholder="Name or email" />
            </div>
          </div>
          <div>
            <label style={label}>Concept / Brief</label>
            <textarea rows={4} value={form.concept} onChange={e => setForm(p => ({ ...p, concept: e.target.value }))} onBlur={() => handleBlur("concept")} style={{ ...ic, resize: "vertical", lineHeight: 1.4 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Placement</label>
              <input value={form.placement} onChange={e => setForm(p => ({ ...p, placement: e.target.value }))} onBlur={() => handleBlur("placement")} style={ic} placeholder="e.g. Full back, 12x14" />
            </div>
            <div>
              <label style={label}>Colors</label>
              <input value={form.colors} onChange={e => setForm(p => ({ ...p, colors: e.target.value }))} onBlur={() => handleBlur("colors")} style={ic} placeholder="e.g. 2 colors - white, red" />
            </div>
          </div>
          <div>
            <label style={{ ...label, color: T.amber }}>Internal Notes (HPD only)</label>
            <textarea rows={2} value={form.internal_notes} onChange={e => setForm(p => ({ ...p, internal_notes: e.target.value }))} onBlur={() => handleBlur("internal_notes")} style={{ ...ic, resize: "vertical", lineHeight: 1.4, borderColor: T.amber + "44" }} placeholder="Not visible to designer..." />
          </div>
          <div style={{ marginTop: 8, padding: 12, background: T.surface, borderRadius: 6, border: `1px dashed ${T.border}` }}>
            <div style={{ fontSize: 11, color: T.muted, textAlign: "center" }}>
              File uploads, designer chat, and version history — Phase 2
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
