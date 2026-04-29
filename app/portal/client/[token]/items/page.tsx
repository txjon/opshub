"use client";
import { useEffect, useState } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate } from "../_shared/theme";

type ClientItemStatus = "draft" | "in_production" | "shipping" | "delivered" | "paused" | "cancelled";

type Item = {
  id: string;
  name: string;
  garment_type: string | null;
  mockup_color: string | null;
  qty: number;
  status: ClientItemStatus;
  thumb_id: string | null;
  created_at: string;
  job: {
    id: string;
    job_number: string | null;
    title: string | null;
    phase: string | null;
    target_ship_date: string | null;
  };
  brief: { id: string; title: string | null; state: string } | null;
  design_id: string | null;
};

const STATUS_META: Record<ClientItemStatus, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: C.muted, bg: C.surface },
  in_production: { label: "In Production", color: C.blue, bg: C.blueBg },
  shipping: { label: "Shipping", color: C.amber, bg: C.amberBg },
  delivered: { label: "Delivered", color: C.green, bg: C.greenBg },
  paused: { label: "Paused", color: C.muted, bg: C.surface },
  cancelled: { label: "Cancelled", color: C.red, bg: C.redBg },
};

const FILTERS: Array<{ key: string; label: string; matches: (s: ClientItemStatus) => boolean }> = [
  { key: "active", label: "Active", matches: s => s !== "delivered" && s !== "cancelled" && s !== "paused" },
  { key: "all", label: "All", matches: () => true },
  { key: "in_production", label: "In Production", matches: s => s === "in_production" },
  { key: "shipping", label: "Shipping", matches: s => s === "shipping" },
  { key: "delivered", label: "Delivered", matches: s => s === "delivered" },
  { key: "draft", label: "Draft", matches: s => s === "draft" },
];

export default function ItemsPage() {
  const { token } = useClientPortal();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [detail, setDetail] = useState<Item | null>(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/client/${token}/items`);
      const body = await res.json();
      if (res.ok) setItems(body.items || []);
    } catch {}
    setLoading(false);
  }

  const active = FILTERS.find(f => f.key === filter) || FILTERS[0];
  const q = query.trim().toLowerCase();
  const filtered = (items || []).filter(it => {
    if (!active.matches(it.status)) return false;
    if (!q) return true;
    return (
      it.name.toLowerCase().includes(q) ||
      (it.garment_type || "").toLowerCase().includes(q) ||
      (it.job.title || "").toLowerCase().includes(q) ||
      (it.job.job_number || "").toLowerCase().includes(q)
    );
  });

  const counts: Record<string, number> = { all: items?.length || 0 };
  for (const f of FILTERS) counts[f.key] = (items || []).filter(it => f.matches(it.status)).length;

  return (
    <div>
      {/* Search + filters */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search your items by name, garment, or project…"
          style={{
            width: "100%", padding: "12px 14px", fontSize: 14,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, outline: "none",
            fontFamily: C.font, boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
          {FILTERS.map(f => {
            const isActive = filter === f.key;
            const n = counts[f.key] || 0;
            return (
              <button key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: "8px 0", minHeight: 40,
                  background: "transparent",
                  color: isActive ? C.text : C.muted,
                  border: "none",
                  borderBottom: isActive ? `2px solid ${C.text}` : "2px solid transparent",
                  fontSize: 13, fontWeight: isActive ? 800 : 600, cursor: "pointer",
                  fontFamily: C.font, marginBottom: -7,
                }}>
                {f.label} {n > 0 && <span style={{ opacity: 0.7 }}>· {n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: "center", color: C.muted }}>
          Loading items…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 50, textAlign: "center", color: C.muted, fontSize: 13 }}>
          {(items || []).length === 0
            ? "No items yet. Once a design turns into an order, it'll land here."
            : q ? "No items match that search." : "Nothing in this filter."}
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))",
          gap: 14,
        }}>
          {filtered.map(it => (
            <ItemCard key={it.id} item={it} onOpen={() => setDetail(it)} />
          ))}
        </div>
      )}

      {detail && <ItemDetail item={detail} token={token} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ItemCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const status = STATUS_META[item.status];
  return (
    <button onClick={onOpen}
      style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 12, overflow: "hidden",
        display: "flex", flexDirection: "column",
        cursor: "pointer", textAlign: "left",
        fontFamily: C.font, padding: 0,
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ aspectRatio: "1", background: "#f4f4f7", overflow: "hidden", position: "relative" }}>
        {item.thumb_id ? (
          <img src={`/api/files/thumbnail?id=${item.thumb_id}&thumb=1`}
            alt="" referrerPolicy="no-referrer" loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e: any) => { e.target.style.display = "none"; }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 11 }}>
            No preview
          </div>
        )}
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {item.garment_type && <span>{item.garment_type}</span>}
          {item.qty > 0 && <><span style={{ color: C.faint }}>·</span><span>{item.qty} pcs</span></>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <span style={{
            color: status.color,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            {status.label}
          </span>
          {item.job.job_number && (
            <span style={{ fontSize: 10, color: C.faint, fontFamily: C.mono }}>
              {item.job.job_number}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ItemDetail({ item, token, onClose }: { item: Item; token: string; onClose: () => void }) {
  const [reordering, setReordering] = useState(false);
  const [reorderResult, setReorderResult] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function reorder() {
    setReordering(true);
    setReorderResult(null);
    try {
      const res = await fetch(`/api/portal/client/${token}/items/${item.id}/reorder`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setReorderResult("Re-order request created — HPD will be in touch.");
      } else {
        setReorderResult(data.error || "Couldn't start re-order");
      }
    } catch {
      setReorderResult("Couldn't start re-order");
    }
    setReordering(false);
  }

  const status = STATUS_META[item.status];

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "clamp(12px, 3vw, 32px)", fontFamily: C.font,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 14,
          width: "min(720px, 100%)", maxHeight: "94vh", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.name}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {[item.garment_type, item.mockup_color].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
          <style>{`
            @media (min-width: 640px) {
              .item-detail-body { grid-template-columns: 240px 1fr !important; }
            }
          `}</style>
          <div className="item-detail-body" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
            {/* Thumb */}
            <div style={{
              aspectRatio: "1", background: "#f4f4f7", borderRadius: 10,
              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {item.thumb_id ? (
                <img src={`/api/files/thumbnail?id=${item.thumb_id}&thumb=1`}
                  alt="" referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e: any) => { e.target.style.display = "none"; }} />
              ) : (
                <span style={{ color: C.faint, fontSize: 12 }}>No preview</span>
              )}
            </div>

            {/* Meta */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Status</div>
                <span style={{
                  color: status.color,
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  {status.label}
                </span>
              </div>
              <Meta label="Quantity" value={item.qty ? `${item.qty} pcs` : "—"} />
              <Meta label="Project" value={item.job.title || "—"}
                sub={item.job.job_number ? `${item.job.job_number}${item.job.target_ship_date ? ` · ships ${fmtDate(item.job.target_ship_date)}` : ""}` : undefined}
              />
              {item.brief && (
                <Meta label="Design" value={item.brief.title || "—"} sub={item.brief.state?.replace(/_/g, " ")} />
              )}
            </div>
          </div>

          {reorderResult && (
            <div style={{
              padding: "10px 14px",
              background: reorderResult.startsWith("Re-order request") ? C.greenBg : C.redBg,
              border: `1px solid ${reorderResult.startsWith("Re-order request") ? C.greenBorder : C.redBorder}`,
              borderRadius: 8,
              color: reorderResult.startsWith("Re-order request") ? C.green : C.red,
              fontSize: 12, fontWeight: 600,
            }}>
              {reorderResult}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "10px 16px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
            Close
          </button>
          <button onClick={reorder} disabled={reordering}
            style={{
              padding: "10px 20px",
              background: reordering ? C.border : C.text,
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700,
              cursor: reordering ? "wait" : "pointer", fontFamily: C.font,
            }}>
            {reordering ? "Requesting…" : "Re-order this item"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
