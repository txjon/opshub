"use client";
import { useEffect, useState } from "react";
import { T, font } from "@/lib/theme";

type Candidate = {
  id: string;
  job_number: string | null;
  title: string | null;
  phase: string;
  target_ship_date: string | null;
  qb_invoice_number: string | null;
};

// MoveItemDialog — picker for moving a single item between jobs of the
// SAME client. Fetches candidates from /api/items/[id]/move-candidates
// (server-filtered: same client, not the current job, active only).
//
// Called from BuySheetTab row. On success, invokes onMoved(result) so the
// caller can refresh / navigate / toast.

export default function MoveItemDialog({
  itemId,
  itemName,
  open,
  onClose,
  onMoved,
  mode = "move",
}: {
  itemId: string;
  itemName: string;
  open: boolean;
  onClose: () => void;
  onMoved: (result: { from: any; to: any; costing_migrated: boolean }) => void;
  /** "move" = item changes job_id; "copy" = original stays, duplicate on dest. */
  mode?: "move" | "copy";
}) {
  const verb = mode === "copy" ? "Copy" : "Move";
  const endpointPath = mode === "copy" ? "copy" : "move";
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [err, setErr] = useState<string>("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!open) {
      setCandidates(null);
      setQuery("");
      setSelectedId(null);
      setErr("");
      return;
    }
    setLoading(true);
    fetch(`/api/items/${itemId}/move-candidates`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setErr(data.error);
        else setCandidates(data.jobs || []);
      })
      .catch(() => setErr("Couldn't load jobs"))
      .finally(() => setLoading(false));
  }, [open, itemId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !moving) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, moving]);

  if (!open) return null;

  const filtered = (candidates || []).filter(c => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (c.title || "").toLowerCase().includes(q)
      || (c.job_number || "").toLowerCase().includes(q)
      || (c.qb_invoice_number || "").toLowerCase().includes(q);
  });

  async function doMove() {
    if (!selectedId) return;
    setMoving(true);
    setErr("");
    try {
      const res = await fetch(`/api/items/${itemId}/${endpointPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_job_id: selectedId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Move failed");
        setMoving(false);
        return;
      }
      onMoved(data);
      setMoving(false);
      onClose();
    } catch (e: any) {
      setErr(e.message || "Move failed");
      setMoving(false);
    }
  }

  return (
    <div onClick={() => !moving && onClose()}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1200,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
          width: "min(520px, 95vw)", maxHeight: "80vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          fontFamily: font,
        }}>
        <div style={{
          padding: "14px 18px", borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "baseline", gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{verb} item</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
              <span style={{ color: T.text }}>{itemName || "(unnamed)"}</span> — pick a destination job (same client only)
            </div>
          </div>
          <button onClick={onClose} disabled={moving}
            style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: moving ? "not-allowed" : "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "10px 18px", borderBottom: `1px solid ${T.border}` }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by title, job #, or invoice #"
            autoFocus
            style={{
              width: "100%", padding: "9px 12px", fontSize: 13,
              background: T.surface, border: `1px solid ${T.border}`,
              color: T.text, borderRadius: 6, outline: "none", fontFamily: font,
              boxSizing: "border-box",
            }} />
        </div>

        {/* Error banner — non-blocking so user can retry after a failed move */}
        {err && (
          <div style={{
            padding: "10px 18px", fontSize: 12, color: T.red,
            background: "#fdf2f2", borderBottom: `1px solid ${T.border}`,
          }}>
            {err}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
          {loading && (
            <div style={{ padding: "20px 18px", fontSize: 12, color: T.muted, textAlign: "center" }}>Loading…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: "20px 18px", fontSize: 12, color: T.muted, textAlign: "center" }}>
              {candidates?.length === 0
                ? "No other active jobs for this client. Create one first."
                : "No jobs match that search."}
            </div>
          )}
          {!loading && filtered.map(c => {
            const selected = selectedId === c.id;
            return (
              <button key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "12px 18px",
                  background: selected ? T.accentDim : "transparent",
                  border: "none", borderLeft: `3px solid ${selected ? T.accent : "transparent"}`,
                  cursor: "pointer", fontFamily: font,
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { if (!selected) e.currentTarget.style.background = T.surface; }}
                onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{
                  fontSize: 13, fontWeight: 600, color: T.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {c.title || "(untitled)"}
                </div>
                <div style={{
                  fontSize: 11, color: T.muted, marginTop: 3,
                  display: "flex", gap: 10, flexWrap: "wrap",
                  fontFamily: "SF Mono, monospace",
                }}>
                  {c.job_number && <span>{c.job_number}</span>}
                  {c.qb_invoice_number && (
                    <>
                      <span style={{ color: T.faint }}>·</span>
                      <span>Invoice #{c.qb_invoice_number}</span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{
          padding: "12px 18px", borderTop: `1px solid ${T.border}`,
          display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center",
        }}>
          {moving && <span style={{ fontSize: 11, color: T.muted, marginRight: "auto" }}>{verb === "Copy" ? "Copying…" : "Moving…"}</span>}
          <button onClick={onClose} disabled={moving}
            style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 12, fontWeight: 600, cursor: moving ? "not-allowed" : "pointer", fontFamily: font }}>
            Cancel
          </button>
          <button onClick={doMove} disabled={!selectedId || moving}
            style={{
              padding: "8px 16px", background: selectedId && !moving ? T.accent : T.border,
              border: "none", borderRadius: 6, color: "#fff",
              fontSize: 12, fontWeight: 700,
              cursor: selectedId && !moving ? "pointer" : "not-allowed",
              fontFamily: font,
              opacity: selectedId ? 1 : 0.6,
            }}>
            {verb} item →
          </button>
        </div>
      </div>
    </div>
  );
}
