"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate } from "../_shared/theme";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";

// Staging tab — release planning + client-uploaded mockup proposals.
//
// Two kinds of tiles share the pool/release surface:
//   • items — real OpsHub items from this client's existing jobs
//   • proposals — client-uploaded mockups (this client's planning sandbox).
//                 Saved to client_proposal_items, mockup stored in Drive.
//
// Each tile has kind === "item" | "proposal". Assigning a tile to a
// release POSTs either { item_id } or { proposal_id }. Each kind can
// live in at most one release at a time (partial unique indexes on
// release_items.item_id and .proposal_id).

type ClientItemStatus = "draft" | "in_production" | "shipping" | "delivered" | "paused" | "cancelled";

type ItemTile = {
  kind: "item";
  id: string;
  name: string;
  garment_type: string | null;
  qty: number;
  status: ClientItemStatus;
  thumb_id: string | null;
  job: { job_number: string | null; title: string | null };
};

type ProposalTile = {
  kind: "proposal";
  id: string;
  name: string;
  drive_file_id: string | null;
  drive_link: string | null;
  qty_estimate: number | null;
  garment_type: string | null;
  notes: string | null;
  status: string;
  converted_to_item_id: string | null;
  created_at: string;
};

type Tile = ItemTile | ProposalTile;

// Strip "Mockup" from a tile's display name. Most uploaded mockups end
// with "... Mockup" or "... - Mockup" by convention; the brand planner
// reads cleaner without the suffix. Original name stays in the DB.
function cleanTileName(name: string): string {
  return (name || "")
    .replace(/\bmockup\b/gi, "")
    .replace(/\s+-\s*$/g, "")
    .replace(/^\s*-\s+/g, "")
    .replace(/\s+/g, " ")
    .trim() || (name || "Untitled");
}

type Release = {
  id: string;
  title: string;
  target_date: string | null;
  sort_order: number;
  item_ids: string[];
  proposal_ids: string[];
  // Brand Planner layout — outer = row, inner = tiles in left-to-right
  // order. Empty rows are filtered out by the API before they reach us.
  rows: Array<Array<{ kind: "item" | "proposal"; id: string }>>;
};

export default function StagingPage() {
  const { token } = useClientPortal();
  const [items, setItems] = useState<ItemTile[]>([]);
  const [proposals, setProposals] = useState<ProposalTile[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [assigning, setAssigning] = useState<Tile | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  // Track in-flight file uploads (drag-from-OS) so a small banner can
  // show progress without blocking interaction.
  const [uploadingFiles, setUploadingFiles] = useState<{ name: string; pct: number; error?: string }[]>([]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    try {
      const [itemsRes, proposalsRes, relsRes] = await Promise.all([
        fetch(`/api/portal/client/${token}/items`).then(r => r.json()),
        fetch(`/api/portal/client/${token}/proposals`).then(r => r.json()),
        fetch(`/api/portal/client/${token}/releases`).then(r => r.json()),
      ]);
      setItems(((itemsRes.items || []) as any[]).map(i => ({ ...i, kind: "item" as const })));
      setProposals(((proposalsRes.proposals || []) as any[])
        .filter(p => p.status !== "declined" && p.status !== "archived")
        .map(p => ({ ...p, kind: "proposal" as const })));
      setReleases(((relsRes.releases || []) as any[]).map(r => ({
        ...r,
        rows: r.rows || (r.item_ids?.length || r.proposal_ids?.length
          ? [[
              ...((r.item_ids || []).map((id: string) => ({ kind: "item" as const, id }))),
              ...((r.proposal_ids || []).map((id: string) => ({ kind: "proposal" as const, id }))),
            ]]
          : []),
      })));
    } catch {}
    setLoading(false);
  }

  // Pool = tiles not currently in any release. Items and proposals are
  // tracked separately on each release row, so we check both sets.
  const { pool, byKey } = useMemo(() => {
    const assignedItems = new Set<string>();
    const assignedProposals = new Set<string>();
    for (const r of releases) {
      for (const id of r.item_ids) assignedItems.add(id);
      for (const id of r.proposal_ids || []) assignedProposals.add(id);
    }
    const all: Tile[] = [...items, ...proposals];
    const pool = all.filter(t => t.kind === "item" ? !assignedItems.has(t.id) : !assignedProposals.has(t.id));
    const byKey: Record<string, Tile> = {};
    for (const t of all) byKey[`${t.kind}:${t.id}`] = t;
    return { pool, byKey };
  }, [items, proposals, releases]);

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

  async function assignTile(tile: Tile, releaseId: string) {
    // Optimistic move
    setReleases(prev => prev.map(r => {
      if (r.id === releaseId) {
        if (tile.kind === "item") return { ...r, item_ids: [...r.item_ids.filter(id => id !== tile.id), tile.id] };
        return { ...r, proposal_ids: [...(r.proposal_ids || []).filter(id => id !== tile.id), tile.id] };
      }
      if (tile.kind === "item") return { ...r, item_ids: r.item_ids.filter(id => id !== tile.id) };
      return { ...r, proposal_ids: (r.proposal_ids || []).filter(id => id !== tile.id) };
    }));
    setAssigning(null);
    const body = tile.kind === "item" ? { item_id: tile.id } : { proposal_id: tile.id };
    try {
      const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error("[staging] assignTile failed", r.status, err);
        alert(`Couldn't move "${tile.name}" — ${err.error || `status ${r.status}`}. Refreshing.`);
        load();
      }
    } catch (e: any) {
      console.error("[staging] assignTile network error", e);
      alert(`Network error moving "${tile.name}". Refreshing.`);
      load();
    }
  }

  async function removeTile(tile: Tile, releaseId: string) {
    setReleases(prev => prev.map(r => r.id === releaseId
      ? tile.kind === "item"
        ? { ...r, item_ids: r.item_ids.filter(id => id !== tile.id) }
        : { ...r, proposal_ids: (r.proposal_ids || []).filter(id => id !== tile.id) }
      : r
    ));
    const param = tile.kind === "item" ? `item_id=${tile.id}` : `proposal_id=${tile.id}`;
    try {
      const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/items?${param}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error("[staging] removeTile failed", r.status, err);
        alert(`Couldn't remove "${tile.name}" — ${err.error || `status ${r.status}`}. Refreshing.`);
        load();
      }
    } catch (e: any) {
      console.error("[staging] removeTile network error", e);
      load();
    }
  }

  async function deleteProposal(p: ProposalTile) {
    if (!window.confirm(`Delete "${p.name}"? This removes it from any release.`)) return;
    setProposals(prev => prev.filter(x => x.id !== p.id));
    setReleases(prev => prev.map(r => ({ ...r, proposal_ids: (r.proposal_ids || []).filter(id => id !== p.id) })));
    await fetch(`/api/portal/client/${token}/proposals/${p.id}`, { method: "DELETE" });
  }

  // ── Drag & drop ────────────────────────────────────────────────────
  // Each tile is draggable. Drop targets:
  //   • a release column → assign tile to that release
  //   • the pool         → remove tile from whichever release it was in
  // Source release id is shipped through dataTransfer so dropping on the
  // pool knows which release to pluck from. Native HTML5 dnd is desktop-
  // only; the click-to-assign + AssignDialog flow remains the mobile path.
  function readDragPayload(e: React.DragEvent): { kind: "item" | "proposal"; id: string; sourceReleaseId: string | null } | null {
    // text/plain has universal browser support; some browsers strip
    // custom MIME types like application/x-tile after the dragend.
    try {
      const raw = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("application/x-tile");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.kind && parsed?.id) return parsed;
    } catch {}
    return null;
  }

  // Upload one file from the OS → create a proposal record, optionally
  // assign it to a release at a specific row. The fast brand-planner
  // path: drop a mockup straight onto a row and it lands there ready.
  async function uploadFileToProposal(file: File, releaseId: string | null, rowIndex: number | null) {
    const fileLabel = file.name;
    setUploadingFiles(prev => [...prev, { name: fileLabel, pct: 0 }]);
    const updatePct = (pct: number) => setUploadingFiles(prev => prev.map(u => u.name === fileLabel ? { ...u, pct } : u));
    const updateErr = (error: string) => setUploadingFiles(prev => prev.map(u => u.name === fileLabel ? { ...u, error } : u));
    try {
      const sessionRes = await fetch(`/api/portal/client/${token}/proposals/upload-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, mime_type: file.type || "application/octet-stream" }),
      });
      if (!sessionRes.ok) throw new Error("Could not start upload");
      const { uploadUrl } = await sessionRes.json();

      const result = await uploadFileToDriveSession(uploadUrl, file, (done, total) => {
        updatePct(Math.round((done / total) * 100));
      });

      const baseName = file.name.replace(/\.[^.]+$/, "") || file.name;
      const propRes = await fetch(`/api/portal/client/${token}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: baseName, drive_file_id: result.drive_file_id }),
      });
      if (!propRes.ok) {
        const e = await propRes.json().catch(() => ({}));
        throw new Error(e.error || "Save failed");
      }
      const { proposal } = await propRes.json();

      if (releaseId && proposal?.id) {
        const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposal_id: proposal.id,
            ...(rowIndex !== null ? { row_index: rowIndex } : {}),
          }),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          console.error("[staging] auto-assign after upload failed", r.status, e);
        }
      }

      setUploadingFiles(prev => prev.filter(u => u.name !== fileLabel));
    } catch (e: any) {
      updateErr(e.message || "Upload failed");
      console.error("[staging] uploadFileToProposal", e);
    }
  }

  async function uploadDroppedFiles(files: File[], releaseId: string | null, rowIndex: number | null) {
    await Promise.all(files.map(f => uploadFileToProposal(f, releaseId, rowIndex)));
    load();
  }

  // Walks up from the event target looking for a TileCard's data-tile-key.
  function findTileTargetKey(e: React.DragEvent): string | null {
    let el = e.target as HTMLElement | null;
    while (el) {
      if (el.dataset && el.dataset.tileKey) return el.dataset.tileKey;
      el = el.parentElement;
    }
    return null;
  }

  // Compute the new 2D row layout given a drag (fromKey) landing in
  // (rowIndex, beforeKey). beforeKey null → append to that row. rowIndex
  // beyond the current row count → create a new row at the end.
  function computeNewRows(release: Release, fromKey: string, rowIndex: number, beforeKey: string | null): Array<Array<{ kind: "item" | "proposal"; id: string }>> {
    let rows: Array<Array<{ kind: "item" | "proposal"; id: string }>> = release.rows.map(r => [...r]);
    const [fromKind, fromId] = fromKey.split(":") as ["item" | "proposal", string];
    rows = rows.map(row => row.filter(e => `${e.kind}:${e.id}` !== fromKey));
    while (rows.length <= rowIndex) rows.push([]);
    const targetRow = rows[rowIndex];
    const insertEntry = { kind: fromKind, id: fromId };
    if (!beforeKey) {
      targetRow.push(insertEntry);
    } else {
      const idx = targetRow.findIndex(e => `${e.kind}:${e.id}` === beforeKey);
      if (idx === -1) targetRow.push(insertEntry);
      else targetRow.splice(idx, 0, insertEntry);
    }
    return rows.filter(row => row.length > 0);
  }

  async function persistRows(releaseId: string, rows: Array<Array<{ kind: "item" | "proposal"; id: string }>>) {
    setReleases(prev => prev.map(r => {
      if (r.id !== releaseId) return r;
      const flat = rows.flat();
      return {
        ...r,
        rows,
        item_ids: flat.filter(e => e.kind === "item").map(e => e.id),
        proposal_ids: flat.filter(e => e.kind === "proposal").map(e => e.id),
      };
    }));
    try {
      const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/items/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error("[staging] reorder failed", r.status, err);
        load();
      }
    } catch (e: any) {
      console.error("[staging] reorder network error", e);
      load();
    }
  }

  // Top-level drop handler called by every row-strip + new-row zone.
  // Routes file drops, cross-release moves, and intra-release reorders.
  function handleDropOnRow(releaseId: string, rowIndex: number, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Files from OS → upload + assign at the targeted row position
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.size > 0);
      if (files.length > 0) { uploadDroppedFiles(files, releaseId, rowIndex); return; }
    }
    // In-app tile drag
    const p = readDragPayload(e);
    if (!p) return;
    const tile = byKey[`${p.kind}:${p.id}`];
    if (!tile) return;
    const fromKey = `${p.kind}:${p.id}`;
    const targetKey = findTileTargetKey(e); // null if dropped on empty space
    if (targetKey === fromKey) return; // dropped onto self

    const release = releases.find(r => r.id === releaseId);
    if (!release) return;
    const alreadyHere = release.rows.some(row => row.some(e2 => `${e2.kind}:${e2.id}` === fromKey));

    if (alreadyHere) {
      // Same-release: pure layout reshuffle
      const newRows = computeNewRows(release, fromKey, rowIndex, targetKey);
      persistRows(releaseId, newRows);
    } else {
      // Cross-release / from pool: assign first (server delete-then-
      // insert removes from any prior release), then reorder to drop
      // it at the targeted (row, position).
      crossReleaseDrop(tile, releaseId, rowIndex, targetKey);
    }
  }

  async function crossReleaseDrop(tile: Tile, releaseId: string, rowIndex: number, beforeKey: string | null) {
    // Optimistic add to local state
    const fromKey = `${tile.kind}:${tile.id}`;
    const targetRelease = releases.find(r => r.id === releaseId);
    if (!targetRelease) return;
    const newRows = computeNewRows(targetRelease, fromKey, rowIndex, beforeKey);
    setReleases(prev => prev.map(r => {
      // Strip the tile from any other release first
      if (r.id !== releaseId) {
        return {
          ...r,
          rows: r.rows.map(row => row.filter(e => `${e.kind}:${e.id}` !== fromKey)).filter(row => row.length > 0),
          item_ids: r.item_ids.filter(id => !(tile.kind === "item" && id === tile.id)),
          proposal_ids: (r.proposal_ids || []).filter(id => !(tile.kind === "proposal" && id === tile.id)),
        };
      }
      const flat = newRows.flat();
      return {
        ...r,
        rows: newRows,
        item_ids: flat.filter(e => e.kind === "item").map(e => e.id),
        proposal_ids: flat.filter(e => e.kind === "proposal").map(e => e.id),
      };
    }));

    try {
      // Step 1: assign to destination (server clears any prior assignment)
      const body: any = tile.kind === "item" ? { item_id: tile.id } : { proposal_id: tile.id };
      const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error("[staging] cross-release assign failed", r.status, err);
        alert(`Couldn't move "${tile.name}" — ${err.error || `status ${r.status}`}. Refreshing.`);
        load();
        return;
      }
      // Step 2: rewrite the destination's row layout
      await fetch(`/api/portal/client/${token}/releases/${releaseId}/items/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: newRows }),
      });
    } catch (e: any) {
      console.error("[staging] crossReleaseDrop", e);
      load();
    }
  }

  function handleDropOnPool(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Files dropped on the pool — upload but don't auto-assign
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(f => f.size > 0);
      if (files.length > 0) { uploadDroppedFiles(files, null, null); return; }
    }
    const p = readDragPayload(e);
    if (!p || !p.sourceReleaseId) return;
    const tile = byKey[`${p.kind}:${p.id}`];
    if (!tile) return;
    removeTile(tile, p.sourceReleaseId);
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
      {/* Header + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Brand planner</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Upload mockups, drag them into release buckets to plan what ships when.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowUpload(true)}
          style={{
            padding: "10px 18px", minHeight: 44,
            background: C.surface, color: C.text,
            border: `1px solid ${C.border}`, borderRadius: 8,
            fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
          }}>
          + Upload mockup
        </button>
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

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Pool — drop target for "remove from release" */}
        <DropZone
          onDrop={handleDropOnPool}
          isPool
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            Unassigned · {pool.length}
          </div>
          {pool.length === 0 ? (
            <div style={{ fontSize: 12, color: C.faint, fontStyle: "italic", padding: "8px 0" }}>
              All mockups are in a release. Upload more or create another release above.
            </div>
          ) : (
            <ItemGrid>
              {pool.map(t => (
                <TileCard key={`${t.kind}:${t.id}`} tile={t}
                  sourceReleaseId={null}
                  onAssign={releases.length > 0 ? () => setAssigning(t) : undefined}
                  onDeleteProposal={t.kind === "proposal" ? () => deleteProposal(t) : undefined}
                  assignDisabled={releases.length === 0}
                />
              ))}
            </ItemGrid>
          )}
        </DropZone>

        {/* Releases */}
        {releases.length === 0 ? (
          <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 50, textAlign: "center", color: C.muted, fontSize: 13 }}>
            No releases yet. Create one above to start planning.
          </div>
        ) : (
          releases.map(r => {
            // Hydrate each row's entries into actual Tile objects.
            // Skip entries whose underlying item/proposal is missing
            // (defensive — the API filters but client state can lag).
            const tileRows: Tile[][] = (r.rows || []).map(row =>
              row.map(entry => byKey[`${entry.kind}:${entry.id}`]).filter(Boolean) as Tile[]
            ).filter(row => row.length > 0);
            return (
              <ReleaseColumn key={r.id} release={r}
                tileRows={tileRows}
                onRename={() => renameRelease(r)}
                onSetDate={() => setReleaseDate(r)}
                onDelete={() => deleteRelease(r)}
                onRemoveTile={(tile) => removeTile(tile, r.id)}
                onDropOnRow={(rowIndex, e) => handleDropOnRow(r.id, rowIndex, e)}
              />
            );
          })
        )}
      </div>

      {/* Upload progress banner — surfaces in-flight file drops so the
          client knows the upload is actually happening. Auto-clears on
          success; per-line errors stick until dismissed. */}
      {uploadingFiles.length > 0 && (
        <div style={{
          position: "fixed", bottom: 16, right: 16, zIndex: 1100,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: "10px 14px", minWidth: 280, maxWidth: 380,
          boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
          fontFamily: C.font,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Uploading {uploadingFiles.length} mockup{uploadingFiles.length === 1 ? "" : "s"}
          </div>
          {uploadingFiles.map(u => (
            <div key={u.name} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{u.name}</span>
                <span style={{ fontSize: 10, color: u.error ? C.red : C.muted, fontFamily: "monospace" }}>{u.error ? "error" : `${u.pct}%`}</span>
              </div>
              <div style={{ height: 3, background: C.surface, borderRadius: 2, overflow: "hidden", marginTop: 3 }}>
                <div style={{ height: "100%", width: `${u.pct}%`, background: u.error ? C.red : C.text, transition: "width 0.15s" }} />
              </div>
              {u.error && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: C.red }}>{u.error}</span>
                  <button onClick={() => setUploadingFiles(prev => prev.filter(x => x.name !== u.name))}
                    style={{ background: "none", border: "none", color: C.muted, fontSize: 10, cursor: "pointer", padding: 0 }}>
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {assigning && (
        <AssignDialog
          tile={assigning}
          releases={releases}
          onPick={(releaseId) => assignTile(assigning, releaseId)}
          onClose={() => setAssigning(null)}
        />
      )}

      {showUpload && (
        <UploadDialog
          token={token}
          onClose={() => setShowUpload(false)}
          onCreated={() => { setShowUpload(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Image-first tile grid (items + uploaded mockups share visual) ───
function ItemGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(216px, 1fr))",
      gap: 12,
    }}>
      {children}
    </div>
  );
}

// Drop zone wrapper — provides the dotted-highlight on dragover and
// renders the pool styling. Uses a render prop so children stay
// declarative.
function DropZone({ children, onDrop, isPool, dashedWhenEmpty }: {
  children: React.ReactNode;
  onDrop: (e: React.DragEvent) => void;
  isPool?: boolean;
  dashedWhenEmpty?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setOver(false); }}
      onDrop={(e) => { setOver(false); onDrop(e); }}
      style={{
        background: over ? "rgba(70,130,180,0.06)" : C.card,
        border: `${over ? 2 : 1}px ${over ? "dashed" : (dashedWhenEmpty ? "dashed" : "solid")} ${over ? C.text : C.border}`,
        borderRadius: 12, padding: 16,
        transition: "background 0.12s, border-color 0.12s",
      }}>
      {children}
    </div>
  );
}

function TileCard({ tile, sourceReleaseId, onAssign, onRemove, onDeleteProposal, assignDisabled }: {
  tile: Tile;
  sourceReleaseId: string | null;
  onAssign?: () => void;
  onRemove?: () => void;
  onDeleteProposal?: () => void;
  assignDisabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);

  const action = onAssign
    ? { label: "+", title: assignDisabled ? "Create a release first" : "Add to release", onClick: onAssign, bg: C.text, color: "#fff" }
    : onRemove
      ? { label: "×", title: "Remove from release", onClick: onRemove, bg: "rgba(0,0,0,0.7)", color: "#fff" }
      : null;
  // Pool tiles keep their + button always visible (it's the primary
  // call to action); release tiles fade their × in only on hover so the
  // mockup imagery isn't competing with chrome.
  const isRemoveAction = !!onRemove;
  const cardClick = onAssign ? onAssign : undefined;

  // Thumbnail source per kind. Both go through the same /api/files/thumbnail
  // endpoint — items use item_files.drive_file_id, mockups use the
  // proposal's drive_file_id. Visually identical card.
  let thumbSrc: string | null = null;
  if (tile.kind === "item" && tile.thumb_id) {
    thumbSrc = `/api/files/thumbnail?id=${tile.thumb_id}&thumb=1`;
  } else if (tile.kind === "proposal" && tile.drive_file_id) {
    thumbSrc = `/api/files/thumbnail?id=${tile.drive_file_id}&thumb=1`;
  }

  function onDragStart(e: React.DragEvent) {
    const payload = JSON.stringify({ kind: tile.kind, id: tile.id, sourceReleaseId });
    // text/plain works everywhere; setting application/x-tile too lets
    // future receivers prefer the typed version if both are present.
    e.dataTransfer.setData("text/plain", payload);
    try { e.dataTransfer.setData("application/x-tile", payload); } catch {}
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }
  function onDragEnd() { setDragging(false); }

  return (
    <div
      draggable
      data-tile-key={`${tile.kind}:${tile.id}`}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={cardClick}
      style={{
        position: "relative",
        background: "transparent", border: "none",
        borderRadius: 8, overflow: "visible",
        cursor: cardClick ? "pointer" : "grab",
        display: "flex", flexDirection: "column",
        transition: "transform 0.08s, opacity 0.12s",
        opacity: dragging ? 0.4 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        height: 120, background: "transparent",
        overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}>
        {thumbSrc ? (
          <img src={thumbSrc}
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
              opacity: isRemoveAction ? (hovered ? 1 : 0) : (assignDisabled ? 0.4 : 1),
              transition: "opacity 0.15s",
              pointerEvents: isRemoveAction && !hovered ? "none" : "auto",
            }}
          >
            {action.label}
          </button>
        )}
        {/* Mockup-only secondary action: delete (only on pool cards) */}
        {tile.kind === "proposal" && onDeleteProposal && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteProposal(); }}
            title="Delete this mockup"
            style={{
              position: "absolute", bottom: 6, right: 6,
              fontSize: 9, fontWeight: 700, padding: "3px 8px",
              borderRadius: 4, background: "rgba(255,255,255,0.92)", border: `1px solid ${C.border}`,
              color: C.muted || "#666", cursor: "pointer",
            }}
          >
            Delete
          </button>
        )}
      </div>
      <div style={{
        padding: "6px 8px",
        fontSize: 11, fontWeight: 600, color: C.text,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        textAlign: "center",
      }}>
        {cleanTileName(tile.name)}
      </div>
      {tile.kind === "proposal" && (tile as ProposalTile).qty_estimate ? (
        <div style={{ padding: "0 8px 6px", fontSize: 10, color: C.muted, textAlign: "center" }}>
          ~{(tile as ProposalTile).qty_estimate} units
        </div>
      ) : null}
    </div>
  );
}

// ── Release column with row-strips (Brand Planner layout) ──────────
function ReleaseColumn({ release, tileRows, onRename, onSetDate, onDelete, onRemoveTile, onDropOnRow }: {
  release: Release;
  tileRows: Tile[][];
  onRename: () => void;
  onSetDate: () => void;
  onDelete: () => void;
  onRemoveTile: (tile: Tile) => void;
  onDropOnRow: (rowIndex: number, e: React.DragEvent) => void;
}) {
  const totalCount = tileRows.reduce((a, r) => a + r.length, 0);
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: 16,
    }}>
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
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{totalCount} item{totalCount === 1 ? "" : "s"}</div>
        <button onClick={onRename}
          style={{ padding: "4px 10px", fontSize: 10, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, cursor: "pointer", fontFamily: C.font }}>
          Rename
        </button>
        <button onClick={onDelete}
          style={{ padding: "4px 10px", fontSize: 10, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.red, cursor: "pointer", fontFamily: C.font }}>
          Delete
        </button>
      </div>

      {/* Row strips. Each row is its own drop target — drop on a tile
          inserts before it, drop on empty space appends to that row. */}
      {tileRows.length === 0 ? (
        <RowStrip rowIndex={0} releaseId={release.id} tiles={[]} onDrop={onDropOnRow} onRemoveTile={onRemoveTile} placeholder />
      ) : (
        tileRows.map((row, i) => (
          <RowStrip key={i} rowIndex={i} releaseId={release.id} tiles={row} onDrop={onDropOnRow} onRemoveTile={onRemoveTile} />
        ))
      )}

      {/* New-row drop zone — only render when there's at least one
          non-empty row above, otherwise the empty placeholder already
          serves as the row-0 drop target. */}
      {tileRows.length > 0 && (
        <RowStrip rowIndex={tileRows.length} releaseId={release.id} tiles={[]} onDrop={onDropOnRow} onRemoveTile={onRemoveTile} isNewRow />
      )}
    </div>
  );
}

function RowStrip({ rowIndex, releaseId, tiles, onDrop, onRemoveTile, placeholder, isNewRow }: {
  rowIndex: number;
  releaseId: string;
  tiles: Tile[];
  onDrop: (rowIndex: number, e: React.DragEvent) => void;
  onRemoveTile: (tile: Tile) => void;
  placeholder?: boolean;
  isNewRow?: boolean;
}) {
  const [over, setOver] = useState(false);
  const empty = tiles.length === 0;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setOver(false); }}
      onDrop={(e) => { setOver(false); onDrop(rowIndex, e); }}
      style={{
        display: "flex", flexWrap: "nowrap", gap: 12,
        overflowX: "auto",
        padding: empty ? "10px 8px" : "8px 0",
        marginBottom: empty ? 6 : 8,
        minHeight: empty ? 56 : "auto",
        borderRadius: 8,
        border: empty
          ? `1px dashed ${over ? C.text : C.border}`
          : `1px solid ${over ? C.text : "transparent"}`,
        background: over ? "rgba(70,130,180,0.06)" : "transparent",
        transition: "background 0.12s, border-color 0.12s",
        alignItems: "stretch",
      }}>
      {tiles.length > 0 && tiles.map(t => (
        <div key={`${t.kind}:${t.id}`} style={{ flex: "0 0 216px" }}>
          <TileCard tile={t} sourceReleaseId={releaseId} onRemove={() => onRemoveTile(t)} />
        </div>
      ))}
      {empty && (
        <div style={{ flex: 1, fontSize: 11, color: C.faint, fontStyle: "italic", textAlign: "center", alignSelf: "center" }}>
          {placeholder ? "Drop a mockup here, or use + on a tile in the pool."
            : isNewRow ? "Drop here to start a new row"
              : ""}
        </div>
      )}
    </div>
  );
}

// ── Assign dialog — pick which release to put a tile in ─────────────
function AssignDialog({ tile, releases, onPick, onClose }: {
  tile: Tile;
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
            {cleanTileName(tile.name)}
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
                {r.item_ids.length + (r.proposal_ids || []).length} item{(r.item_ids.length + (r.proposal_ids || []).length) === 1 ? "" : "s"}
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

// ── Upload dialog — client uploads a mockup + names a proposal ──────
function UploadDialog({ token, onClose, onCreated }: {
  token: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !uploading) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, uploading]);

  async function submit() {
    if (!name.trim()) { setError("Name required"); return; }
    setUploading(true);
    setError(null);
    try {
      let drive_file_id: string | null = null;
      if (file) {
        const sessionRes = await fetch(`/api/portal/client/${token}/proposals/upload-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: file.name, mime_type: file.type || "application/octet-stream" }),
        });
        if (!sessionRes.ok) throw new Error("Could not start upload");
        const { uploadUrl } = await sessionRes.json();
        const result = await uploadFileToDriveSession(uploadUrl, file, (done, total) => {
          setProgress(Math.round((done / total) * 100));
        });
        drive_file_id = result.drive_file_id;
      }
      const res = await fetch(`/api/portal/client/${token}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          drive_file_id,
          qty_estimate: qty || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Save failed");
      }
      onCreated();
    } catch (e: any) {
      setError(e.message || "Upload failed");
    }
    setUploading(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  return (
    <div onClick={uploading ? undefined : onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        fontFamily: C.font,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 12,
          width: "min(540px, 95vw)", maxHeight: "90vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Upload mockup</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Add a mockup you're considering — name it and (optionally) drop in an image. You can group it into a release after.
          </div>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              placeholder="e.g. Tour Tee — black"
              style={{ width: "100%", padding: "9px 12px", fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: C.font, outline: "none", boxSizing: "border-box" as const }} />
          </div>

          {/* File drop zone */}
          <div ref={dragRef}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${C.border}`, borderRadius: 10, padding: 18,
              textAlign: "center", background: C.surface,
              minHeight: 120, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            {file ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{file.name}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                <button onClick={() => setFile(null)}
                  style={{ marginTop: 4, padding: "4px 10px", fontSize: 11, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, cursor: "pointer", fontFamily: C.font }}>
                  Remove
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: C.muted }}>Drag a file here, or</div>
                <label style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, background: C.text, color: "#fff", borderRadius: 6, cursor: "pointer" }}>
                  Choose file
                  <input type="file" accept="image/*,application/pdf" hidden
                    onChange={e => setFile(e.target.files?.[0] || null)} />
                </label>
                <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>
                  Optional — you can add the image later
                </div>
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>Est. qty</label>
              <input type="number" value={qty} onChange={e => setQty(e.target.value)}
                placeholder="100"
                style={{ width: "100%", padding: "9px 12px", fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: C.font, outline: "none", boxSizing: "border-box" as const }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 4, fontWeight: 600 }}>Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Anything HPD should know"
                style={{ width: "100%", padding: "9px 12px", fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: C.font, outline: "none", boxSizing: "border-box" as const }} />
            </div>
          </div>

          {uploading && file && (
            <div style={{ fontSize: 11, color: C.muted }}>
              Uploading… {progress}%
            </div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: C.red, padding: "6px 10px", background: "rgba(220,40,40,0.06)", borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: "9px 16px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: uploading ? "not-allowed" : "pointer", fontFamily: C.font }}>
            Cancel
          </button>
          <button onClick={submit} disabled={uploading || !name.trim()}
            style={{ padding: "9px 18px", background: name.trim() && !uploading ? C.text : C.border, color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: uploading || !name.trim() ? "not-allowed" : "pointer", fontFamily: C.font }}>
            {uploading ? "Saving…" : "Save proposal"}
          </button>
        </div>
      </div>
    </div>
  );
}
