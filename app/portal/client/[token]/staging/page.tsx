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

      {/* Pool on top (full-width visual grid) + releases stacked below. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            <ItemGrid>
              {pool.map(it => (
                <ItemCard key={it.id} item={it}
                  onAssign={releases.length > 0 ? () => setAssigning(it) : undefined}
                  assignDisabled={releases.length === 0}
                />
              ))}
            </ItemGrid>
          )}
        </div>

        {/* Releases */}
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

// ── Image-first grid of item tiles ──────────────────────────────────
// Wider rectangular tiles (4:3) so apparel/product photos that aren't
// strictly square don't get cropped. Auto-fill at 320px min lands at
// ~3 columns on typical desktop widths, more on wider screens, fewer
// on phones. Image-only with the name as a caption; no status / qty /
// metadata — Staging is an organizing surface, not a detail surface
// (that lives on the Items tab).
function ItemGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
      gap: 12,
    }}>
      {children}
    </div>
  );
}

function ItemCard({ item, onAssign, onRemove, assignDisabled }: {
  item: Item;
  onAssign?: () => void;
  onRemove?: () => void;
  assignDisabled?: boolean;
}) {
  // Pool card (onAssign): click anywhere = add. It's the only action, and
  // safe to undo (pick the wrong release → × to put it back).
  // Release card (onRemove): ONLY the × button removes — body click is
  // a no-op. Accidental removal feels bad; require the explicit target.
  const action = onAssign
    ? { label: "+", title: assignDisabled ? "Create a release first" : "Add to release", onClick: onAssign, bg: C.text, color: "#fff" }
    : onRemove
      ? { label: "×", title: "Remove from release", onClick: onRemove, bg: "rgba(0,0,0,0.7)", color: "#fff" }
      : null;
  const cardClick = onAssign ? onAssign : undefined;

  return (
    <div
      onClick={cardClick}
      style={{
        position: "relative",
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 8, overflow: "hidden",
        cursor: cardClick ? "pointer" : "default",
        display: "flex", flexDirection: "column",
        transition: "border-color 0.15s, transform 0.08s",
      }}
      onMouseEnter={e => { if (action) e.currentTarget.style.borderColor = C.text; }}
      onMouseLeave={e => { if (action) e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{
        height: 120, background: "#f4f4f7",
        overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {item.thumb_id ? (
          <img src={`/api/files/thumbnail?id=${item.thumb_id}&thumb=1`}
            alt="" referrerPolicy="no-referrer" loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={(e: any) => { e.target.style.display = "none"; }} />
        ) : (
          <span style={{ fontSize: 10, color: C.faint }}>No preview</span>
        )}
        {action && (
          <button
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            title={action.title}
            disabled={assignDisabled}
            style={{
              position: "absolute", top: 6, right: 6,
              width: 24, height: 24, borderRadius: "50%",
              background: action.bg, color: action.color,
              border: "none", fontSize: 15, fontWeight: 700, lineHeight: 1,
              cursor: assignDisabled ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
              opacity: assignDisabled ? 0.4 : 1,
            }}
          >
            {action.label}
          </button>
        )}
      </div>
      <div style={{
        padding: "6px 8px",
        fontSize: 11, fontWeight: 600, color: C.text,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {item.name}
      </div>
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
          Empty — add items from the pool above.
        </div>
      ) : (
        <ItemGrid>
          {items.map(it => (
            <ItemCard key={it.id} item={it} onRemove={() => onRemoveItem(it.id)} />
          ))}
        </ItemGrid>
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
