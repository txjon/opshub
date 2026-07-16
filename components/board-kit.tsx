"use client";
// The shared board UI kit. Production is the visual standard — every v2 surface
// (production2, receiving2, shipping2, fulfillment2) renders from THESE components
// so they are the same app by construction, not by copy-paste. Change it here and
// every surface changes together.
import { type ReactNode, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { DriveThumb } from "@/components/DriveThumb";

// ── overflow "⋯" row menu — collapses occasional row actions behind one control.
// Portaled to <body> at fixed coords so a card's overflow:hidden can't clip it;
// closes on outside-click or scroll. Touch-safe (no hover). Shared by all surfaces.
export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };
export function RowMenu({ busy, items }: { busy?: boolean; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  function toggle() {
    if (open) return setOpen(false);
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 5, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  }
  return (
    <>
      <button ref={btnRef} onClick={toggle} aria-label="More actions"
        style={{ width: 30, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, lineHeight: 1, color: T.muted, background: open ? T.surface : "none", border: `1px solid ${T.border}`, borderRadius: 7, cursor: "pointer" }}>
        {busy ? "…" : "⋯"}
      </button>
      {open && pos && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1000 }} />
          <div style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 1001, background: T.card, border: `1px solid ${T.border}`, borderRadius: 9, boxShadow: "0 10px 30px rgba(0,0,0,0.14)", minWidth: 190, overflow: "hidden" }}>
            {items.map((it, i) => (
              <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 13px", fontSize: 12.5, fontWeight: 600, background: "none", border: "none", borderTop: i ? `1px solid ${T.border}` : "none", color: it.disabled ? T.faint : it.danger ? T.red : T.text, cursor: it.disabled ? "default" : "pointer" }}>
                {it.label}
              </button>
            ))}
          </div>
        </>, document.body)}
    </>
  );
}

// ── page frame: dev header + kpi hover CSS + max-width container ────────────
export function BoardFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ fontFamily: font, background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: 90 }}>
      <style>{`.kpi-tile{transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease}.kpi-tile:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,0.09);border-color:#c4c4cc}.kpi-tile:active{transform:translateY(0)}`}</style>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>{title}</h1>
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
// Per-variant qty as light inline text (no filled boxes) — "M 8  L 21  XL 20".
// max: cap the chips shown on dense variant matrices (FOG pants carry 15+
// width/inseam combos and turned board rows into walls). Click the "+N more"
// to expand in place; collapse again from the "less" affordance.
export function VariantChips({ qtys, sizes, max }: { qtys: Record<string, number>; sizes?: string[]; min?: number; max?: number }) {
  const [expanded, setExpanded] = useState(false);
  const list = sizes || sortSizes(Object.keys(qtys));
  const capped = max != null && !expanded && list.length > max;
  const shown = capped ? list.slice(0, max) : list;
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
      {shown.map(sz => (
        <span key={sz} style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: 0.3 }}>{sz}</span>
          <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{qtys[sz] ?? 0}</span>
        </span>
      ))}
      {capped && (
        <span onClick={e => { e.stopPropagation(); setExpanded(true); }}
          style={{ fontSize: 10.5, fontWeight: 800, color: T.blue, cursor: "pointer", whiteSpace: "nowrap" }}>+{list.length - max!} more</span>
      )}
      {max != null && expanded && list.length > max && (
        <span onClick={e => { e.stopPropagation(); setExpanded(false); }}
          style={{ fontSize: 10.5, fontWeight: 800, color: T.faint, cursor: "pointer" }}>less</span>
      )}
    </div>
  );
}

// ── shared box card leaves (receiving + production Shipped both render these) ─
// One physical shipment = one box. Header bar, plain-text meta line, client/group
// label, and the aligned-column item row all live here so the two surfaces can't
// drift. Callers supply the surface-specific bits (status/route tag, per-row/box
// action) as props/nodes; the layout is identical everywhere.
export function BoxHead({ vendor, tag, tagColor, method, slips, when, meta, action }: {
  vendor: string; tag: string; tagColor?: string; method: string;
  slips?: { name: string; url: string }[]; when?: string | null; meta?: { text: string; tone?: string }[]; action?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{vendor}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: tagColor || T.blue, textTransform: "uppercase", letterSpacing: 0.5 }}>{tag}</span>
      <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{method}</span>
      {(slips || []).map((s, i) => s.url
        ? <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.blue, textDecoration: "none" }}>📎 slip</a>
        : <span key={i} style={{ fontSize: 11, color: T.muted }}>📎 slip</span>)}
      <div style={{ flex: 1 }} />
      {when && <span style={{ fontSize: 12, color: T.faint }}>{when}</span>}
      {meta && meta.length > 0 && (
        <span style={{ display: "inline-flex", alignItems: "baseline", flexWrap: "wrap", fontSize: 11.5, fontWeight: 600 }}>
          {meta.map((s, i) => <span key={i}>{i > 0 && <span style={{ color: T.faint, margin: "0 6px" }}>·</span>}<span style={{ color: s.tone || T.muted }}>{s.text}</span></span>)}
        </span>
      )}
      {action}
    </div>
  );
}

// Plain-text meta line under the header (no pills) — kept for note/warning rows.
export function BoxMeta({ segments }: { segments: { text: string; tone?: string }[] }) {
  if (!segments.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "8px 16px 2px", fontSize: 11.5, fontWeight: 600 }}>
      {segments.map((s, i) => <span key={i}>{i > 0 && <span style={{ color: T.faint, margin: "0 6px" }}>·</span>}<span style={{ color: s.tone || T.muted }}>{s.text}</span></span>)}
    </div>
  );
}

// Client / group sub-header inside a card.
export function GroupLabel({ label, sub }: { label: string; sub?: string | null }) {
  return (
    <div style={{ padding: "8px 16px 6px", borderTop: `1px solid ${T.border}`, fontSize: 12, fontWeight: 600, color: T.muted }}>
      {label}{sub ? <span style={{ fontFamily: mono, color: T.faint, fontWeight: 500 }}> · {sub}</span> : null}
    </div>
  );
}

// Aligned-column item row: thumb · name(+sub) · route · per-variant · qty · actions.
// The fixed grid is the single source of column rhythm across every surface.
export const ITEM_ROW_COLS = "34px minmax(190px, 1.4fr) 108px minmax(130px, 1.3fr) 46px auto";
export function ItemRow({ fileId, name, lead, sub, route, variant, qty, actions }: {
  fileId: string | null; name: string; lead?: string | null; sub?: ReactNode; route?: string; variant?: ReactNode; qty?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: ITEM_ROW_COLS, alignItems: "center", columnGap: 14 }}>
      <ItemThumb fileId={fileId} name={name} size={34} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          {lead ? <span style={{ fontSize: 11, fontWeight: 600, color: T.muted, whiteSpace: "nowrap", flexShrink: 0, maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis" }}>{lead}</span> : null}
          <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        </div>
        {sub}
      </div>
      {route ? <RouteTag route={route} /> : <span />}
      <div style={{ minWidth: 0 }}>{variant}</div>
      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, textAlign: "right" }}>{qty ?? ""}</span>
      <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: 10 }}>{actions}</div>
    </div>
  );
}

// ── route label (plain text, no pills) ──────────────────────────────────────
// signal table (amended 2026-07-16): routes colored by warehouse involvement —
// stage lands & stays (green), ship_through passes through (blue movement),
// drop_ship never touches HPD (muted — ignorable at the dock).
const ROUTE_FG: Record<string, string> = { drop_ship: T.muted, ship_through: T.blue, stage: T.green };
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
