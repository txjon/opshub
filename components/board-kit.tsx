"use client";
// The shared board UI kit. Production is the visual standard — every v2 surface
// (production2, receiving2, shipping2, fulfillment2) renders from THESE components
// so they are the same app by construction, not by copy-paste. Change it here and
// every surface changes together.
import { type ReactNode } from "react";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { DriveThumb } from "@/components/DriveThumb";

// ── page frame: dev header + kpi hover CSS + max-width container ────────────
export function BoardFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ fontFamily: font, background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: 90 }}>
      <style>{`.kpi-tile{transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease}.kpi-tile:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,0.09);border-color:#c4c4cc}.kpi-tile:active{transform:translateY(0)}`}</style>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>{title}</h1>
          <span style={{ fontSize: 12, color: T.faint }}>v2 · parallel dev</span>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── toggle pills + search — one row (always first, above the KPIs) ──────────
export function ToggleSearch<K extends string>({ options, value, onChange, query, setQuery, placeholder, right }: {
  options: [K, string][]; value: K; onChange: (v: K) => void; query: string; setQuery: (s: string) => void; placeholder: string; right?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "14px 0 2px", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 8 }}>
        {options.map(([k, label]) => (
          <button key={k} onClick={() => onChange(k)}
            style={{ fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 9, cursor: "pointer", border: `1px solid ${value === k ? T.text : T.border}`, background: value === k ? T.text : T.card, color: value === k ? "#fff" : T.muted }}>{label}</button>
        ))}
      </div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder}
        style={{ flex: 1, minWidth: 220, fontSize: 13, padding: "9px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.card, fontFamily: font, outline: "none" }} />
      {right}
    </div>
  );
}

// ── segmented control (connected buttons) — sort, 3-view slice, etc. ────────
export function SegmentControl<K extends string>({ options, value, onChange, label }: {
  options: [K, string][]; value: K; onChange: (v: K) => void; label?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label && <span style={{ fontSize: 12, color: T.faint }}>{label}</span>}
      <div style={{ display: "flex", border: `1px solid ${T.border}`, borderRadius: 9, overflow: "hidden" }}>
        {options.map(([k, l]) => (
          <button key={k} onClick={() => onChange(k)}
            style={{ fontSize: 12, fontWeight: 600, padding: "9px 14px", border: "none", cursor: "pointer", background: value === k ? T.text : T.card, color: value === k ? "#fff" : T.muted }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// ── row that holds the 3-view slice (left) + sort (right) — receiving/shipping ─
export function SliceSortRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>{children}</div>;
}

// ── KPI strip: clickable tiles with hover-lift ──────────────────────────────
export function KpiStrip<K extends string>({ metrics, get, onClick }: {
  metrics: { key: K; label: string }[]; get: (k: K) => number; onClick: (k: K) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 12, margin: "16px 0 18px" }}>
      {metrics.map(m => (
        <button key={m.key} onClick={() => onClick(m.key)} className="kpi-tile"
          style={{ flex: 1, textAlign: "left", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>{m.label}</div>
          <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 700, marginTop: 2 }}>{get(m.key).toLocaleString()}</div>
        </button>
      ))}
    </div>
  );
}

// ── modal backdrop + card ───────────────────────────────────────────────────
export function ModalShell({ children, onClose, maxWidth = 640, dismissable = true }: {
  children: ReactNode; onClose: () => void; maxWidth?: number; dismissable?: boolean;
}) {
  return (
    <div onClick={dismissable ? onClose : undefined} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 14, maxWidth, width: "100%", fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>{children}</div>
    </div>
  );
}

// ── KPI breakdown modal: one metric, N columns (by vendor / by client / …) ──
export function KpiBreakdownModal({ label, total, unit, cols, onClose }: {
  label: string; total: number; unit?: string; cols: { title: string; rows: { name: string; value: number }[] }[]; onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose} maxWidth={620}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{label}</span>
        <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: T.muted }}>{total.toLocaleString()}</span>
        {unit && <span style={{ fontSize: 12, color: T.faint }}>{unit}</span>}
      </div>
      <div style={{ padding: "18px 22px", display: "flex", gap: 28 }}>
        {cols.map((c, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{c.title}</div>
            {c.rows.map(r => (
              <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{r.value.toLocaleString()}</span>
              </div>
            ))}
            {!c.rows.length && <span style={{ fontSize: 12, color: T.faint }}>None</span>}
          </div>
        ))}
      </div>
      <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontSize: 13, background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 16px", cursor: "pointer", color: T.muted }}>Close</button>
      </div>
    </ModalShell>
  );
}

// ── list card + its surface-bg header row ───────────────────────────────────
export function Card({ children }: { children: ReactNode }) {
  return <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>{children}</div>;
}
export function CardHeader({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>{children}</div>;
}

// ── per-variant qty chips (used on every item everywhere) ────────────────────
export function VariantChips({ qtys, sizes, min = 34 }: { qtys: Record<string, number>; sizes?: string[]; min?: number }) {
  const list = sizes || sortSizes(Object.keys(qtys));
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {list.map(sz => (
        <span key={sz} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: min, padding: "3px 6px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, letterSpacing: 0.3 }}>{sz}</span>
          <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{qtys[sz] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}

// ── route label (plain text, no pills) ──────────────────────────────────────
const ROUTE_FG: Record<string, string> = { drop_ship: T.purple, ship_through: T.blue, stage: "#a87b00" };
const ROUTE_LABEL: Record<string, string> = { drop_ship: "Drop-ship", ship_through: "Ship-through", stage: "Stage" };
export function RouteTag({ route }: { route: string }) {
  return <span style={{ fontSize: 10, fontWeight: 700, color: ROUTE_FG[route] || T.blue, textTransform: "uppercase", letterSpacing: 0.5 }}>{ROUTE_LABEL[route] || "Ship-through"}</span>;
}

// ── item thumbnail (mockup + initial fallback, click to enlarge) ────────────
export function ItemThumb({ fileId, name, size = 40 }: { fileId: string | null; name: string; size?: number }) {
  const radius = size >= 40 ? 8 : 7;
  const fallback = <span style={{ width: size, height: size, borderRadius: radius, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size >= 40 ? 15 : 13, fontWeight: 700, color: T.faint }}>{(name || "?").charAt(0).toUpperCase()}</span>;
  if (!fileId) return fallback;
  return <DriveThumb driveFileId={fileId} alt="" maxRetries={0} enlargeable title={name}
    style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flexShrink: 0, border: `1px solid ${T.border}`, cursor: "zoom-in" }} fallback={fallback} />;
}
