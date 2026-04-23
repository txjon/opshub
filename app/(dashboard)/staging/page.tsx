"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { appBaseUrl } from "@/lib/public-url";

export default function StagingBoardsPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", client_name: "", password: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadBoards(); }, []);

  async function loadBoards() {
    const res = await fetch("/api/staging/boards");
    const data = await res.json();
    setBoards(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function createBoard() {
    if (!newForm.name.trim() || !newForm.client_name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/staging/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newForm),
    });
    const board = await res.json();
    setSaving(false);
    if (board.id) {
      setShowNew(false);
      setNewForm({ name: "", client_name: "", password: "" });
      router.push(`/staging/${board.id}`);
    }
  }

  function copyShareLink(token: string) {
    const url = `${appBaseUrl()}/staging/share/${token}`;
    navigator.clipboard.writeText(url);
  }

  const ic = { width: "100%", padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box" as const };

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Staging Boards</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Product ideation and client working sheets</p>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
          + New Board
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Loading...</div>
      ) : boards.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 32, textAlign: "center", fontSize: 13, color: T.faint }}>
          No staging boards yet. Create one to get started.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {boards.map(board => (
            <div key={board.id} onClick={() => router.push(`/staging/${board.id}`)}
              style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16, transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
              onMouseLeave={e => (e.currentTarget.style.background = T.card)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{board.name}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{board.client_name} · {board.item_count} item{board.item_count !== 1 ? "s" : ""}</div>
              </div>
              <div style={{ fontSize: 10, color: T.faint }}>{new Date(board.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              <button onClick={e => { e.stopPropagation(); copyShareLink(board.share_token); }}
                style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 10, padding: "4px 10px", cursor: "pointer", fontFamily: font }}
                onMouseEnter={e => (e.currentTarget.style.color = T.accent)}
                onMouseLeave={e => (e.currentTarget.style.color = T.muted)}>
                Copy Link
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New Board Modal */}
      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 420, maxWidth: "90vw" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: font, marginBottom: 16 }}>New Staging Board</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>Board Name</label>
                <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} style={ic} autoFocus />
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>Client Name</label>
                <input value={newForm.client_name} onChange={e => setNewForm(f => ({ ...f, client_name: e.target.value }))} style={ic} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>Share Password</label>
                <input type="password" value={newForm.password} onChange={e => setNewForm(f => ({ ...f, password: e.target.value }))} style={ic} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setShowNew(false)}
                style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 13, cursor: "pointer", fontFamily: font }}>
                Cancel
              </button>
              <button onClick={createBoard} disabled={saving || !newForm.name.trim() || !newForm.client_name.trim()}
                style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: saving ? 0.5 : 1 }}>
                {saving ? "Creating..." : "Create Board"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
