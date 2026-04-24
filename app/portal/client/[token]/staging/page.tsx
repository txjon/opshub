"use client";
import { useEffect, useState, useMemo } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate } from "../_shared/theme";

// Staging tab — release planning. Reframed Apr 23: this is not a collab
// surface, it's where the client organizes items into release buckets
// ("April Drop", "Summer 2026"). No notes, no comments — just arranging
// what ships when.
//
// Data model (migration 038):
//   client_releases — one row per bucket (title, target_date, sort_order)
//   release_items   — UNIQUE(item_id) so each item lives in at most one
//                     release at a time. Moving an item just re-points it.

type ClientItemStatus = "draft" | "in_production" | "shipping" | "delivered" | "paused" | "cancelled";

type Item = {
  id: string;
  name: string;
  garment_type: string | null;
  mockup_color: string | null;
  qty: number;
  status: ClientItemStatus;
  thumb_id: string | null;
  job: { job_number: string | null; title: string | null };
};

type Release = {
  id: string;
  title: string;
  target_date: string | null;
  sort_order: number;
  item_ids: string[];
};

const STATUS_META: Record<ClientItemStatus, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: C.muted, bg: C.surface },
  in_production: { label: "In Production", color: C.blue, bg: C.blueBg },
  shipping: { label: "Shipping", color: C.amber, bg: C.amberBg },
  delivered: { label: "Delivered", color: C.green, bg: C.greenBg },
  paused: { label: "Paused", color: C.muted, bg: C.surface },
  cancelled: { label: "Cancelled", color: C.red, bg: C.redBg },
};

export default function StagingPage() {
  const { token } = useClientPortal();
  const [items, setItems] = useState<Item[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [assigning, setAssigning] = useState<Item | null>(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    try {
      const [itemsRes, relsRes] = await Promise.all([
        fetch(`/api/portal/client/${token}/items`).then(r => r.json()),
        fetch(`/api/portal/client/${token}/releases`).then(r => r.json()),
      ]);
      setItems(itemsRes.items || []);
      setReleases(relsRes.releases || []);
    } catch {}
    setLoading(false);
  }

  // Items not currently assigned to any release = the "pool"
  const assignedIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of releases) for (const id of r.item_ids) s.add(id);
    return s;
  }, [releases]);
  const pool = items.filter(it => !assignedIds.has(it.id));
  const itemById: Record<string, Item> = {};
  for (const it of items) itemById[it.id] = it;

  async function createRelease() {
    if (!newTitle.trim()) return;
    const res = await fetch(`/api/portal/client/${token}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim(), target_date: newDate || null }),
    });
    if (res.ok) {
      setNewTitle("");
      setNewDate("");
      setCreatingRelease(false);
      load();
    }
  }

  async function assignItem(itemId: string, releaseId: string) {
    setReleases(prev => prev.map(r => ({
      ...r,
      item_ids: r.id === releaseId
        ? [...r.item_ids.filter(id => id !== itemId), itemId]
        : r.item_ids.filter(id => id !== itemId),
    })));
    setAssigning(null);
    await fetch(`/api/portal/client/${token}/releases/${releaseId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId }),
    });
  }

  async function removeItem(itemId: string, releaseId: string) {
    setReleases(prev => prev.map(r => r.id === releaseId
      ? { ...r, item_ids: r.item_ids.filter(id => id !== itemId) }
      : r
    ));
    await fetch(`/api/portal/client/${token}/releases/${releaseId}/items?item_id=${itemId}`, {
      method: "DELETE",
    });
  }

  async function renameRelease(release: Release) {
    const next = window.prompt("Release name", release.title);
    if (!next || next === release.title) return;
    setReleases(prev => prev.map(r => r.id === release.id ? { ...r, title: next } : r));
    await fetch(`/api/portal/client/${token}/releases/${release.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
  }

  async function setReleaseDate(release: Release) {
    const current = release.target_date || "";
    const next = window.prompt("Target date (YYYY-MM-DD) — blank to clear", current);
    if (next === null) return;
    const clean = next.trim() || null;
    setReleases(prev => prev.map(r => r.id === release.id ? { ...r, target_date: clean } : r));
    await fetch(`/api/portal/client/${token}/releases/${release.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_date: clean }),
    });
  }

  async function deleteRelease(release: Release) {
    if (!window.confirm(`Delete "${release.title}"? Items in it will return to the pool.`)) return;
    setReleases(prev => prev.filter(r => r.id !== release.id));
    await fetch(`/api/portal/client/${token}/releases/${release.id}`, { method: "DELETE" });
  }

  if (loading) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: "center", color: C.muted }}>
        Loading…
      </div>
    );
  }

  return (
    <div>
      {/* Header + new release button */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Plan your releases</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Organize items into release buckets. Each item can live in one release at a time.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!creatingRelease ? (
          <button onClick={() => setCreatingRelease(true)}
            style={{
              padding: "10px 18px", minHeight: 44,
              background: C.text, color: "#fff",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
            }}>
            + New release
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: C.card, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}` }}>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createRelease()}
              autoFocus
              placeholder="Release name (e.g. April Drop)"
              style={{ padding: "8px 10px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, outline: "none", fontFamily: C.font, minWidth: 220 }}
            />
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              style={{ padding: "8px 10px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, outline: "none", fontFamily: C.font }}
            />
            <button onClick={createRelease} disabled={!newTitle.trim()}
              style={{ padding: "8px 14px", background: newTitle.trim() ? C.text : C.border, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: newTitle.trim() ? "pointer" : "default", fontFamily: C.font }}>
              Create
            </button>
            <button onClick={() => { setCreatingRelease(false); setNewTitle(""); setNewDate(""); }}
              style={{ padding: "8px 12px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.muted, cursor: "pointer", fontFamily: C.font }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Two-column layout: pool (left) + releases (right). Stacks on mobile. */}
      <div className="staging-layout" style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr" }}>
        <style>{`
          @media (min-width: 900px) {
            .staging-layout { grid-template-columns: 340px 1fr !important; }
          }
        `}</style>

        {/* Pool */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            Unassigned · {pool.length}
          </div>
          {pool.length === 0 ? (
            <div style={{ fontSize: 12, color: C.faint, fontStyle: "italic", padding: "8px 0" }}>
              All items are in a release.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pool.map(it => (
                <ItemChip key={it.id} item={it}
                  onAssign={releases.length > 0 ? () => setAssigning(it) : undefined}
                  assignDisabledReason={releases.length === 0 ? "Create a release first" : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* Releases */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {releases.length === 0 ? (
            <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 50, textAlign: "center", color: C.muted, fontSize: 13 }}>
              No releases yet. Create one above to start planning.
            </div>
          ) : (
            releases.map(r => (
              <ReleaseColumn key={r.id} release={r}
                items={r.item_ids.map(id => itemById[id]).filter(Boolean)}
                onRename={() => renameRelease(r)}
                onSetDate={() => setReleaseDate(r)}
                onDelete={() => deleteRelease(r)}
                onRemoveItem={(itemId) => removeItem(itemId, r.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Assign modal — pick which release to put an item in */}
      {assigning && (
        <AssignDialog
          item={assigning}
          releases={releases}
          onPick={(releaseId) => assignItem(assigning.id, releaseId)}
          onClose={() => setAssigning(null)}
        />
      )}
    </div>
  );
}

// ── Item chip used in both pool and release columns ─────────────────
function ItemChip({ item, onAssign, onRemove, assignDisabledReason }: {
  item: Item;
  onAssign?: () => void;
  onRemove?: () => void;
  assignDisabledReason?: string;
}) {
  const status = STATUS_META[item.status];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px",
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8,
    }}>
      <div style={{
        width: 44, height: 44, minWidth: 44,
        background: "#fff", borderRadius: 4, overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {item.thumb_id ? (
          <img src={`/api/files/thumbnail?id=${item.thumb_id}&thumb=1`}
            alt="" referrerPolicy="no-referrer" loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e: any) => { e.target.style.display = "none"; }} />
        ) : (
          <span style={{ fontSize: 8, color: C.faint }}>—</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <span style={{
            padding: "1px 6px", borderRadius: 99,
            background: status.bg, color: status.color,
            fontSize: 8, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            {status.label}
          </span>
          {item.qty > 0 && <span>{item.qty} pcs</span>}
        </div>
      </div>
      {onAssign && (
        <button onClick={onAssign}
          title={assignDisabledReason}
          style={{ padding: "5px 10px", fontSize: 10, fontWeight: 700, background: C.text, color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontFamily: C.font }}>
          Add to…
        </button>
      )}
      {onRemove && (
        <button onClick={onRemove}
          title="Remove from release"
          style={{ padding: "3px 7px", fontSize: 14, color: C.muted, background: "transparent", border: "none", cursor: "pointer", lineHeight: 1 }}>
          ×
        </button>
      )}
    </div>
  );
}

// ── Release column / card ───────────────────────────────────────────
function ReleaseColumn({ release, items, onRename, onSetDate, onDelete, onRemoveItem }: {
  release: Release;
  items: Item[];
  onRename: () => void;
  onSetDate: () => void;
  onDelete: () => void;
  onRemoveItem: (itemId: string) => void;
}) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{release.title}</div>
          {release.target_date ? (
            <button onClick={onSetDate}
              style={{ background: "none", border: "none", color: C.muted, fontSize: 11, padding: 0, cursor: "pointer", fontFamily: C.font, textDecoration: "underline dotted", textUnderlineOffset: 2 }}>
              Targets {fmtDate(release.target_date)}
            </button>
          ) : (
            <button onClick={onSetDate}
              style={{ background: "none", border: "none", color: C.faint, fontSize: 11, padding: 0, cursor: "pointer", fontFamily: C.font, fontStyle: "italic" }}>
              + target date
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{items.length} item{items.length === 1 ? "" : "s"}</div>
        <button onClick={onRename}
          style={{ padding: "4px 10px", fontSize: 10, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, cursor: "pointer", fontFamily: C.font }}>
          Rename
        </button>
        <button onClick={onDelete}
          style={{ padding: "4px 10px", fontSize: 10, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.red, cursor: "pointer", fontFamily: C.font }}>
          Delete
        </button>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: C.faint, fontStyle: "italic", padding: "8px 0" }}>
          Empty — add items from the pool using the "Add to…" button.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map(it => (
            <ItemChip key={it.id} item={it} onRemove={() => onRemoveItem(it.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Assign dialog — pick which release gets this item ────────────────
function AssignDialog({ item, releases, onPick, onClose }: {
  item: Item;
  releases: Release[];
  onPick: (releaseId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        fontFamily: C.font,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 12,
          width: "min(420px, 95vw)", maxHeight: "80vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Add to release</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.name}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {releases.map(r => (
            <button key={r.id}
              onClick={() => onPick(r.id)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "12px 18px", background: "transparent",
                border: "none", borderBottom: `1px solid ${C.border}`,
                cursor: "pointer", fontFamily: C.font,
              }}
              onMouseEnter={e => e.currentTarget.style.background = C.surface}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.title}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                {r.item_ids.length} item{r.item_ids.length === 1 ? "" : "s"}
                {r.target_date && ` · ships ${fmtDate(r.target_date)}`}
              </div>
            </button>
          ))}
        </div>
        <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, textAlign: "right" }}>
          <button onClick={onClose}
            style={{ padding: "8px 16px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
