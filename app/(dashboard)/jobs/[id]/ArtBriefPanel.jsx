"use client";
import { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";
import { ArtBriefMessages } from "@/components/ArtBriefMessages";

const STATE_LABELS = {
  draft: { label: "Draft", color: T.muted, bg: T.surface },
  sent: { label: "Sent to Designer", color: T.accent, bg: T.accentDim },
  in_progress: { label: "In Progress", color: T.accent, bg: T.accentDim },
  wip_review: { label: "WIP Review", color: T.amber, bg: T.amberDim },
  client_review: { label: "Client Review", color: T.purple, bg: T.purpleDim },
  revisions: { label: "Revisions Needed", color: T.red, bg: T.redDim },
  final_approved: { label: "Final Approved", color: T.green, bg: T.greenDim },
  delivered: { label: "Delivered", color: T.green, bg: T.greenDim },
};

export function ArtBriefPanel({ itemId, jobId, onClose }) {
  const [briefs, setBriefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingBrief, setEditingBrief] = useState(null); // null = list view, object = editor
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadBriefs(); }, [itemId]);

  async function loadBriefs() {
    setLoading(true);
    const res = await fetch(`/api/art-briefs?itemId=${itemId}`);
    const data = await res.json();
    setBriefs(data.briefs || []);
    setLoading(false);
  }

  async function createBrief() {
    setCreating(true);
    const res = await fetch("/api/art-briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId, job_id: jobId, title: "New Brief", state: "draft" }),
    });
    const data = await res.json();
    setCreating(false);
    if (data.brief) {
      setBriefs(p => [data.brief, ...p]);
      setEditingBrief(data.brief);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, width: "90vw", maxWidth: 800, maxHeight: "90vh", overflow: "auto", fontFamily: font }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Art Studio Briefs</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Outside design team workflow</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {!editingBrief && <button onClick={createBrief} disabled={creating}
              style={{ padding: "6px 12px", background: T.accent, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: creating ? 0.5 : 1 }}>
              + New Brief
            </button>}
            <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18, padding: "0 4px" }}>×</button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: 18 }}>
          {loading ? (
            <div style={{ fontSize: 12, color: T.muted }}>Loading...</div>
          ) : editingBrief ? (
            <BriefEditor brief={editingBrief} onBack={() => { setEditingBrief(null); loadBriefs(); }} onUpdated={(updated) => setBriefs(p => p.map(b => b.id === updated.id ? updated : b))} />
          ) : briefs.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: T.faint }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>No briefs yet</div>
              <div style={{ fontSize: 11 }}>Click "+ New Brief" to create one for this item</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {briefs.map(b => {
                const st = STATE_LABELS[b.state] || STATE_LABELS.draft;
                const dCount = b.designer_message_count || 0;
                return (
                  <div key={b.id} onClick={() => setEditingBrief(b)}
                    style={{ padding: "10px 14px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
                    onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.title || "Untitled Brief"}</span>
                        {dCount > 0 && (
                          <span title={`${dCount} from designer`} style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: T.accentDim, color: T.accent }}>
                            💬 {dCount}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                        {b.deadline ? `Due ${new Date(b.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "No deadline"}
                        {b.version_count > 0 && ` · v${b.version_count}`}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 99, background: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefEditor({ brief, onBack, onUpdated }) {
  const [form, setForm] = useState({
    title: brief.title || "",
    concept: brief.concept || "",
    placement: brief.placement || "",
    colors: brief.colors || "",
    deadline: brief.deadline || "",
    internal_notes: brief.internal_notes || "",
    state: brief.state || "draft",
    assigned_to: brief.assigned_to || "",
  });
  const [saving, setSaving] = useState(false);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [wips, setWips] = useState([]);
  const [finals, setFinals] = useState([]);
  const [promoting, setPromoting] = useState(null);

  useEffect(() => {
    fetch(`/api/art-briefs?id=${brief.id}`).then(r => r.json()).then(data => {
      const files = data.files || [];
      setWips(files.filter(f => f.kind === "wip").sort((a, b) => b.version - a.version));
      setFinals(files.filter(f => f.kind === "final").sort((a, b) => b.version - a.version));
    });
  }, [brief.id]);

  async function promoteFinal(fileId) {
    setPromoting(fileId);
    await fetch("/api/art-briefs/promote-final", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_file_id: fileId, brief_id: brief.id }),
    });
    setPromoting(null);
  }

  async function save(updates) {
    setSaving(true);
    const res = await fetch("/api/art-briefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: brief.id, ...updates }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.brief) {
      onUpdated(data.brief);
      setSavedIndicator(true);
      setTimeout(() => setSavedIndicator(false), 1200);
    }
  }

  function handleBlur(field) {
    if (form[field] !== brief[field]) save({ [field]: form[field] });
  }

  async function handleDelete() {
    if (!window.confirm("Delete this brief? All messages and file links will be removed.")) return;
    setDeleting(true);
    await fetch(`/api/art-briefs?id=${brief.id}`, { method: "DELETE" });
    setDeleting(false);
    onBack();
  }

  const ic = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" };
  const label = { fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: font, padding: 0 }}>← All briefs</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {savedIndicator && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>Saved</span>}
          {saving && <span style={{ fontSize: 10, color: T.muted }}>Saving...</span>}
          <button onClick={handleDelete} disabled={deleting} style={{ background: "none", border: `1px solid ${T.border}`, color: T.red, fontSize: 10, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontFamily: font, opacity: deleting ? 0.5 : 1 }}>
            Delete brief
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Title */}
        <div>
          <label style={label}>Brief Title</label>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} onBlur={() => handleBlur("title")} style={ic} placeholder="e.g. Back print concept" />
        </div>

        {/* State + Deadline + Assigned */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <label style={label}>State</label>
            <select value={form.state} onChange={e => { const v = e.target.value; setForm(p => ({ ...p, state: v })); save({ state: v }); }} style={{ ...ic, cursor: "pointer" }}>
              {Object.entries(STATE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Deadline</label>
            <input type="date" value={form.deadline || ""} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} onBlur={() => handleBlur("deadline")} style={ic} />
          </div>
          <div>
            <label style={label}>Assigned Designer</label>
            <input value={form.assigned_to} onChange={e => setForm(p => ({ ...p, assigned_to: e.target.value }))} onBlur={() => handleBlur("assigned_to")} style={ic} placeholder="Designer name or email" />
          </div>
        </div>

        {/* Concept */}
        <div>
          <label style={label}>Concept / Brief</label>
          <textarea rows={4} value={form.concept} onChange={e => setForm(p => ({ ...p, concept: e.target.value }))} onBlur={() => handleBlur("concept")} style={{ ...ic, resize: "vertical", lineHeight: 1.4 }} placeholder="Describe what you want the designer to create..." />
        </div>

        {/* Placement + Colors */}
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

        {/* Internal notes — HPD only */}
        <div>
          <label style={{ ...label, color: T.amber }}>Internal Notes (HPD only, not visible to designer)</label>
          <textarea rows={2} value={form.internal_notes} onChange={e => setForm(p => ({ ...p, internal_notes: e.target.value }))} onBlur={() => handleBlur("internal_notes")} style={{ ...ic, resize: "vertical", lineHeight: 1.4, borderColor: T.amber + "44" }} placeholder="Notes only HPD team sees..." />
        </div>

        {/* Designer work files */}
        {(wips.length > 0 || finals.length > 0) && (
          <div style={{ padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, marginTop: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Designer Work</div>
            {finals.length > 0 && (
              <div style={{ marginBottom: wips.length ? 10 : 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.green, marginBottom: 6 }}>Final · {finals.length}</div>
                {finals.map(f => (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.greenDim, borderRadius: 6, fontSize: 11, marginBottom: 4 }}>
                    <span style={{ padding: "2px 6px", background: T.green, color: "#fff", borderRadius: 4, fontWeight: 700, fontSize: 9 }}>V{f.version}</span>
                    <a href={f.drive_link || "#"} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: T.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: font }}>{f.file_name}</a>
                    <button onClick={() => promoteFinal(f.id)} disabled={promoting === f.id}
                      style={{ padding: "3px 8px", background: T.accent, color: "#fff", border: "none", borderRadius: 4, fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: promoting === f.id ? 0.5 : 1 }}>
                      {promoting === f.id ? "..." : "→ Print-Ready"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {wips.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.blue, marginBottom: 6 }}>WIPs · {wips.length}</div>
                {wips.map(w => (
                  <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: T.surface, borderRadius: 6, fontSize: 11, marginBottom: 3 }}>
                    <span style={{ padding: "2px 6px", background: T.blueDim, color: T.blue, borderRadius: 4, fontWeight: 700, fontSize: 9 }}>V{w.version}</span>
                    <a href={w.drive_link || "#"} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: T.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: font }}>{w.file_name}</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div style={{ padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, marginTop: 4 }}>
          <ArtBriefMessages briefId={brief.id} compact />
        </div>
      </div>
    </div>
  );
}
