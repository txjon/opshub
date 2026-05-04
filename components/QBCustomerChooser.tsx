"use client";
import { useEffect, useRef, useState } from "react";
import { T, font, mono } from "@/lib/theme";

export type QBCandidate = {
  id: string;
  displayName: string;
  email?: string | null;
  active?: boolean;
};

export type QBCurrent = {
  id: string;
  displayName: string | null;
  active?: boolean;
} | null;

export type QBChooserAction =
  | { type: "select"; qbCustomerId: string; displayName: string }
  | { type: "create_new" }
  | { type: "unlink" };

// Reusable QuickBooks customer chooser. Two entry modes:
//   "push" — opened after a /api/qb/*-invoice push returned 409 with
//            candidates. The action callback re-runs the push with the
//            picked id (or forceCreate=true).
//   "link" — opened from /clients/[id] for manual relink. The parent
//            persists via /api/qb/link-customer.
//
// Always shows: current cached customer (if any), the searched name,
// candidates from QB, free-text re-search, and a "Create new in QB"
// fallback. Picking a candidate yields a "select" action with that id.

export function QBCustomerChooser({
  open,
  mode,
  clientId,
  searchedName,
  candidates: initialCandidates,
  current: initialCurrent,
  busy = false,
  onAction,
  onClose,
}: {
  open: boolean;
  mode: "push" | "link";
  clientId: string;
  searchedName: string;
  candidates?: QBCandidate[];
  current?: QBCurrent;
  busy?: boolean;
  onAction: (a: QBChooserAction) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<QBCandidate[]>(initialCandidates || []);
  const [current, setCurrent] = useState<QBCurrent>(initialCurrent ?? null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state on open. Keeps stale data from a previous client out
  // of the dialog.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setCandidates(initialCandidates || []);
    setCurrent(initialCurrent ?? null);
    setError(null);
    // If we don't have any seed data, load from the API once.
    if ((!initialCandidates || initialCandidates.length === 0) || initialCurrent === undefined) {
      void runSearch("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function runSearch(q: string) {
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ clientId });
      if (q) params.set("search", q);
      const res = await fetch(`/api/qb/link-customer?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Search failed");
      setCandidates(data.candidates || []);
      // Only hydrate current on the initial load — subsequent text
      // searches shouldn't overwrite the cached pointer display.
      if (initialCurrent === undefined) setCurrent(data.current ?? null);
    } catch (e: any) {
      setError(e.message || "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runSearch(value); }, 300);
  }

  if (!open) return null;

  const primaryActionLabel = mode === "push" ? "Link & push to this one" : "Link to this customer";
  const createLabel = mode === "push" ? "Skip — create new in QB" : "Create new QB customer";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
          padding: 20, width: 520, maxWidth: "92vw", maxHeight: "82vh",
          fontFamily: font, color: T.text, display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          Link to QuickBooks customer
        </div>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 14, lineHeight: 1.5 }}>
          {mode === "push"
            ? <>Searching <span style={{ fontFamily: mono, color: T.text }}>{searchedName}</span> in QuickBooks turned up similar customers. Pick the right one or create a new one.</>
            : <>Pick the QuickBooks customer that matches <span style={{ fontFamily: mono, color: T.text }}>{searchedName}</span>.</>}
        </div>

        {current && (
          <div style={{
            border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 12px",
            marginBottom: 12, background: T.surface,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Currently linked
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {current.displayName || <span style={{ color: T.muted, fontStyle: "italic" }}>QB id {current.id} (not found)</span>}
              </div>
            </div>
            <button
              disabled={busy}
              onClick={() => onAction({ type: "unlink" })}
              style={{
                background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6,
                color: T.muted, fontSize: 11, fontFamily: font, fontWeight: 600,
                padding: "5px 10px", cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
              title="Clear the cached QB customer for this OpsHub client"
            >
              Unlink
            </button>
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={`Search QuickBooks customers (default: "${searchedName}")`}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "8px 10px", borderRadius: 7, border: `1px solid ${T.border}`,
              background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none",
            }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 120, maxHeight: 320, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
          {searching && (
            <div style={{ padding: 14, color: T.muted, fontSize: 12 }}>Searching…</div>
          )}
          {!searching && error && (
            <div style={{ padding: 14, color: T.red, fontSize: 12 }}>{error}</div>
          )}
          {!searching && !error && candidates.length === 0 && (
            <div style={{ padding: 14, color: T.muted, fontSize: 12 }}>
              No similar customers found in QuickBooks.
            </div>
          )}
          {!searching && !error && candidates.map(c => {
            const isCurrent = current?.id === c.id;
            return (
              <div
                key={c.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "10px 12px", borderBottom: `1px solid ${T.border}`,
                  background: isCurrent ? T.accentDim : "transparent",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.displayName}
                    {!c.active && <span style={{ marginLeft: 6, fontSize: 10, color: T.muted }}>(inactive)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, fontFamily: mono, marginTop: 2 }}>
                    QB id {c.id}{c.email ? ` · ${c.email}` : ""}
                  </div>
                </div>
                <button
                  disabled={busy || isCurrent}
                  onClick={() => onAction({ type: "select", qbCustomerId: c.id, displayName: c.displayName })}
                  style={{
                    background: isCurrent ? T.surface : T.accent,
                    border: isCurrent ? `1px solid ${T.border}` : "none",
                    borderRadius: 6,
                    color: isCurrent ? T.muted : "#fff",
                    fontSize: 11, fontFamily: font, fontWeight: 600,
                    padding: "6px 12px",
                    cursor: (busy || isCurrent) ? "default" : "pointer",
                    opacity: busy ? 0.5 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isCurrent ? "Linked" : primaryActionLabel}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 8 }}>
          <button
            disabled={busy}
            onClick={() => onAction({ type: "create_new" })}
            style={{
              background: "transparent", border: `1px solid ${T.border}`, borderRadius: 7,
              color: T.muted, fontSize: 12, fontFamily: font, fontWeight: 600,
              padding: "7px 12px", cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {createLabel}
          </button>
          <button
            disabled={busy}
            onClick={onClose}
            style={{
              background: "transparent", border: `1px solid ${T.border}`, borderRadius: 7,
              color: T.muted, fontSize: 12, fontFamily: font, fontWeight: 600,
              padding: "7px 16px", cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
