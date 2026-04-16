"use client";
import { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";

type Designer = {
  id: string;
  name: string;
  email: string | null;
  portal_token: string;
  active: boolean;
  notes: string | null;
  created_at: string;
  last_active_at: string | null;
};

export default function DesignersPage() {
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", email: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", notes: "" });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/designers");
    const data = await res.json();
    setDesigners(data.designers || []);
    setLoading(false);
  }

  async function createDesigner() {
    if (!newForm.name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/designers", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newForm),
    });
    const data = await res.json();
    setSaving(false);
    if (data.designer) {
      setDesigners(p => [data.designer, ...p]);
      setNewForm({ name: "", email: "", notes: "" });
      setShowNew(false);
    }
  }

  async function updateDesigner(id: string, updates: any) {
    await fetch("/api/designers", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }),
    });
    load();
  }

  async function regenerateToken(id: string) {
    if (!window.confirm("Regenerate token? The old link will stop working immediately.")) return;
    await updateDesigner(id, { regenerate_token: true });
  }

  async function deleteDesigner(id: string, name: string) {
    if (!window.confirm(`Delete designer "${name}"? Any assigned briefs will keep the reference but lose access.`)) return;
    await fetch(`/api/designers?id=${id}`, { method: "DELETE" });
    load();
  }

  function copyLink(d: Designer) {
    const url = `${window.location.origin}/design/${d.portal_token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(d.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function startEdit(d: Designer) {
    setEditingId(d.id);
    setEditForm({ name: d.name, email: d.email || "", notes: d.notes || "" });
  }

  async function saveEdit() {
    if (!editingId) return;
    await updateDesigner(editingId, editForm);
    setEditingId(null);
  }

  const ic = { padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box" as const };

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Designers</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>External design team members with portal access</p>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
          + Add Designer
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Loading...</div>
      ) : designers.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 32, textAlign: "center", fontSize: 13, color: T.faint }}>
          No designers yet. Add one to generate a portal link.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {designers.map(d => {
            const url = `${window.location.origin}/design/${d.portal_token}`;
            const editing = editingId === d.id;
            return (
              <div key={d.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, opacity: d.active ? 1 : 0.5 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    {editing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} placeholder="Name" style={ic} />
                        <input value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} placeholder="Email (for notifications)" style={ic} />
                        <input value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} placeholder="Notes" style={ic} />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={saveEdit} style={{ padding: "6px 14px", background: T.green, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
                          <button onClick={() => setEditingId(null)} style={{ padding: "6px 14px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{d.name}</div>
                        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                          {d.email || "No email"}{d.notes ? ` · ${d.notes}` : ""}
                          {!d.active && <span style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 99, background: T.redDim, color: T.red, fontSize: 10, fontWeight: 600 }}>INACTIVE</span>}
                        </div>
                        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontFamily: mono, fontSize: 11, color: T.faint }}>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</span>
                          <button onClick={() => copyLink(d)} style={{ padding: "3px 10px", background: T.accent, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                            {copiedId === d.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {!editing && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => startEdit(d)} style={{ padding: "5px 12px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font }}>Edit</button>
                      <button onClick={() => updateDesigner(d.id, { active: !d.active })} style={{ padding: "5px 12px", background: "transparent", color: d.active ? T.amber : T.green, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font }}>
                        {d.active ? "Deactivate" : "Reactivate"}
                      </button>
                      <button onClick={() => regenerateToken(d.id)} style={{ padding: "5px 12px", background: "transparent", color: T.amber, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font }}>Regen token</button>
                      <button onClick={() => deleteDesigner(d.id, d.name)} style={{ padding: "5px 12px", background: "transparent", color: T.red, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font }}>Delete</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 440, maxWidth: "90vw" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: font, marginBottom: 14 }}>Add Designer</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input autoFocus value={newForm.name} onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))} placeholder="Name or team name *" style={{ ...ic, width: "100%" }} />
              <input value={newForm.email} onChange={e => setNewForm(p => ({ ...p, email: e.target.value }))} placeholder="Email (for brief notifications)" style={{ ...ic, width: "100%" }} />
              <input value={newForm.notes} onChange={e => setNewForm(p => ({ ...p, notes: e.target.value }))} placeholder="Notes (e.g. specialty, availability)" style={{ ...ic, width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setShowNew(false)} style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 13, cursor: "pointer", fontFamily: font }}>Cancel</button>
              <button onClick={createDesigner} disabled={saving || !newForm.name.trim()} style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: (saving || !newForm.name.trim()) ? 0.5 : 1 }}>
                {saving ? "Creating..." : "Create & Generate Link"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
