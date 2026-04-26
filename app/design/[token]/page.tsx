"use client";
import { useState, useEffect, useRef } from "react";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";
import { DriveFileLink } from "@/components/DriveFileLink";
import { formatFileLabel, unreadHighlightFor, unreadEventFor } from "@/lib/art-activity-text";
import { ArtReferencesGrid } from "@/components/ArtReferencesGrid";

// ── Designer portal theme — mirrors OpsHub's T palette so the portal
// looks like an extension of the dashboard. Borders are derived from
// each color's *Dim background tone.
const C = {
  bg: "#f4f4f6",        // T.bg
  card: "#ffffff",      // T.card
  surface: "#eaeaee",   // T.surface
  border: "#dcdce0",    // T.border
  text: "#1a1a1a",      // T.text
  muted: "#6b6b78",     // T.muted
  faint: "#a0a0ad",     // T.faint
  accent: "#000000",    // T.accent
  accentBg: "#e8e8e8",  // T.accentDim
  green: "#4ddb88",     // T.green
  greenBg: "#e5f9ed",   // T.greenDim
  greenBorder: "#bdebd0",
  amber: "#f4b22b",     // T.amber
  amberBg: "#fef5e0",   // T.amberDim
  amberBorder: "#f5dfa8",
  red: "#ff324d",       // T.red
  redBg: "#ffe8ec",     // T.redDim
  redBorder: "#ffc3cc",
  purple: "#fd3aa3",    // T.purple
  purpleBg: "#fee8f4",  // T.purpleDim
  purpleBorder: "#fbc3df",
  blue: "#73b6c9",      // T.blue
  blueBg: "#e3f1f5",    // T.blueDim
  blueBorder: "#bbdde6",
  font: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
  mono: "'IBM Plex Mono', 'Courier New', monospace",
};

type ThumbLite = { drive_file_id: string | null; preview_drive_file_id?: string | null; drive_link: string | null; kind?: string };
type Brief = {
  id: string; title: string | null; state: string; deadline: string | null;
  concept: string | null; placement: string | null; colors: string | null;
  mood_words: string[]; sent_to_designer_at: string | null; updated_at: string;
  version_count: number; clients?: { name: string } | null;
  latest_thumb: { drive_file_id: string; drive_link: string; kind: string } | null;
  thumbs?: ThumbLite[];
  thumb_total?: number;
  file_counts: { wip: number; first_draft: number; revision: number; final: number; reference: number };
  last_activity_at?: string | null;
  has_unread_external?: boolean;
  unread_by_role?: "client" | "hpd" | null;
  unread_type?: "upload" | "note" | "message" | null;
  unread_kind?: string | null;
  preview_line?: string | null;
  client_aborted_at?: string | null;
  archived_by?: "client" | "hpd" | null;
};
type BriefFile = {
  id: string; file_name: string; drive_link: string | null; drive_file_id: string | null;
  kind: string; version: number;
  /** 1-based index of this file within its kind on this brief — populated server-side. */
  kind_ordinal?: number | null;
  hpd_annotation: string | null; client_annotation: string | null; designer_annotation: string | null;
  uploader_role: string; created_at: string;
};
type Message = {
  id: string; sender_role: string; sender_name: string | null; message: string; created_at: string;
};

// ── State → display ──
const STATE_META: Record<string, { label: string; color: string; bg: string; border: string; group: string }> = {
  sent:             { label: "New request",         color: C.red,    bg: C.redBg,    border: C.redBorder,    group: "action" },
  in_progress:      { label: "In progress",         color: C.blue,   bg: C.blueBg,   border: C.blueBorder,   group: "progress" },
  wip_review:       { label: "HPD reviewing WIP",   color: C.amber,  bg: C.amberBg,  border: C.amberBorder,  group: "hold" },
  client_review:    { label: "Client reviewing",    color: C.purple, bg: C.purpleBg, border: C.purpleBorder, group: "hold" },
  revisions:        { label: "Revisions needed",    color: C.red,    bg: C.redBg,    border: C.redBorder,    group: "action" },
  final_approved:   { label: "Client approved",     color: C.green,  bg: C.greenBg,  border: C.greenBorder,  group: "done" },
  pending_prep:     { label: "Awaiting HPD prep",   color: C.muted,  bg: C.surface,  border: C.border,       group: "done" },
  production_ready: { label: "Production ready",    color: C.green,  bg: C.greenBg,  border: C.greenBorder,  group: "done" },
  delivered:        { label: "Delivered",           color: C.green,  bg: C.greenBg,  border: C.greenBorder,  group: "done" },
  draft:            { label: "Draft",               color: C.faint,  bg: C.surface,  border: C.border,       group: "done" },
};

// Filters collapsed — state-based pills don't help with the new messaging
// model. Unread counter at top is the only control.

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: C.red };
  if (diff === 0) return { text: "today", color: C.red };
  if (diff <= 3) return { text: `${diff}d`, color: C.amber };
  return { text: `${diff}d`, color: C.muted };
};

// Proxied via /api/files/thumbnail?thumb=1 — returns Drive's pre-sized
// thumbnailLink (small, fast) instead of the full file, cached 24h.
const thumbUrl = (id: string | null | undefined) => id ? `/api/files/thumbnail?id=${id}&thumb=1` : null;

type Toast = { id: string; briefId: string; title: string; preview: string };

export default function DesignerPortal({ params }: { params: { token: string } }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [designer, setDesigner] = useState<{ name: string } | null>(null);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevActivityRef = useRef<Record<string, string>>({});

  useEffect(() => {
    loadDashboard(true);
    // Poll every 15s for new activity. Diff against last snapshot to toast.
    const interval = setInterval(() => loadDashboard(false), 15000);
    return () => clearInterval(interval);
  }, []);

  async function loadDashboard(isInitial: boolean) {
    if (isInitial) setLoading(true);
    try {
      const res = await fetch(`/api/design/${params.token}`);
      const data = await res.json();
      if (!res.ok) {
        if (isInitial) setError(data.error || "Could not load");
        if (isInitial) setLoading(false);
        return;
      }
      setDesigner(data.designer);
      const nextBriefs: Brief[] = data.briefs || [];

      // Detect new activity since last poll, fire toasts. Skip initial load —
      // first render just seeds the snapshot.
      if (!isInitial) {
        const prev = prevActivityRef.current;
        const newToasts: Toast[] = [];
        for (const b of nextBriefs) {
          const nextAt = b.last_activity_at || "";
          const prevAt = prev[b.id] || "";
          if (nextAt && nextAt > prevAt && b.has_unread_external) {
            newToasts.push({
              id: `${b.id}-${nextAt}`,
              briefId: b.id,
              title: b.title || "Untitled design",
              preview: b.preview_line || "New activity",
            });
          }
        }
        if (newToasts.length > 0) {
          setToasts(t => [...newToasts, ...t].slice(0, 5));
          // Auto-dismiss after 6s
          newToasts.forEach(t => setTimeout(() => {
            setToasts(ts => ts.filter(x => x.id !== t.id));
          }, 6000));
        }
      }
      // Update snapshot
      const snap: Record<string, string> = {};
      for (const b of nextBriefs) snap[b.id] = b.last_activity_at || "";
      prevActivityRef.current = snap;

      setBriefs(nextBriefs);
    } catch {
      if (isInitial) setError("Connection error");
    }
    if (isInitial) setLoading(false);
  }

  if (loading) return <CenterMsg msg="Loading…" />;
  if (error) return <CenterMsg msg={error} err />;

  // "Done" from designer's POV = Final is uploaded, their part is over.
  // Designer's lifecycle splits at client approval. "Working" = pre-
  // approval (designer is actively making something). "Done" =
  // post-approval (their part is complete; the brief still hangs around
  // for context but they don't need to act).
  const DONE_STATES = ["final_approved", "pending_prep", "production_ready", "delivered"];
  const bucketFor = (b: Brief): "working" | "done" =>
    DONE_STATES.includes(b.state) ? "done" : "working";

  const counts = {
    all: briefs.length,
    working: briefs.filter(b => bucketFor(b) === "working").length,
    done: briefs.filter(b => bucketFor(b) === "done").length,
    unread: briefs.filter(b => b.has_unread_external).length,
  };

  const filtered = (() => {
    if (filter === "unread") return briefs.filter(b => b.has_unread_external);
    if (filter === "working") return briefs.filter(b => bucketFor(b) === "working");
    if (filter === "done") return briefs.filter(b => bucketFor(b) === "done");
    return briefs;
  })();

  const overdueCount = briefs.filter(b => {
    if (!b.deadline) return false;
    const d = Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000);
    return d < 0 && !DONE_STATES.includes(b.state);
  }).length;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      {/* Toast stack — new-activity notifications from 15s polling */}
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
        {toasts.map(t => (
          <div key={t.id}
            onClick={() => { setSelected(t.briefId); setToasts(ts => ts.filter(x => x.id !== t.id)); }}
            style={{ background: C.card, border: `2px solid ${C.blue}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,0.12)", animation: "slideIn 0.2s ease-out" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: C.blue, letterSpacing: "0.08em", marginBottom: 3 }}>NEW</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>{t.title}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{t.preview}</div>
          </div>
        ))}
      </div>

      {/* Top bar */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "14px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>House Party Distro</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>Design Studio</div>
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>{designer?.name}</div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 60px" }}>
        {/* Filter pills — Working / Done split at client approval. */}
        <div style={{ marginBottom: 18, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <DesignerFilterPill label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
          <DesignerFilterPill label="Working" count={counts.working} active={filter === "working"} onClick={() => setFilter("working")} />
          <DesignerFilterPill label="Done" count={counts.done} active={filter === "done"} onClick={() => setFilter("done")} />
          {counts.unread > 0 && (
            <DesignerFilterPill label="Unread" count={counts.unread} active={filter === "unread"} onClick={() => setFilter("unread")} accent={C.blue} />
          )}
          {overdueCount > 0 && (
            <span style={{ color: C.red, fontSize: 13, fontWeight: 700, marginLeft: "auto" }}>
              {overdueCount} overdue
            </span>
          )}
        </div>

        {/* Image-first brief grid */}
        {filtered.length === 0 ? (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 50, textAlign: "center", color: C.muted, fontSize: 13 }}>
            {filter === "all"
              ? "No design requests yet. You'll be notified when something is assigned."
              : "Nothing in this bucket."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {filtered.map(b => (
              <BriefCard key={b.id} brief={b} onOpen={() => setSelected(b.id)} />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <BriefDetailModal
          token={params.token}
          briefId={selected}
          onClose={() => { setSelected(null); loadDashboard(false); }}
        />
      )}
    </div>
  );
}

// 4-up mosaic — matches the OpsHub Art Studio tile pattern. Renders 1/2/3/4
// thumbs in a smart grid. Overflow (>4) shown as "+N" on the last cell.
function TileMosaic({ thumbs, total }: { thumbs: ThumbLite[]; total: number }) {
  const count = Math.min(thumbs.length, 4);
  const overflow = Math.max(0, total - 4);
  if (count === 0) {
    return (
      <div style={{ width: "100%", height: "100%", background: "#f4f4f7", display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
        No work yet
      </div>
    );
  }
  let gridTemplate = "1fr", rows = "1fr";
  if (count === 2) { gridTemplate = "1fr 1fr"; rows = "1fr"; }
  if (count === 3) { gridTemplate = "1fr 1fr"; rows = "1fr 1fr"; }
  if (count === 4) { gridTemplate = "1fr 1fr"; rows = "1fr 1fr"; }
  return (
    <div style={{
      width: "100%", height: "100%", background: "#f4f4f7",
      display: "grid", gridTemplateColumns: gridTemplate, gridTemplateRows: rows,
      gap: 2, overflow: "hidden",
    }}>
      {thumbs.slice(0, count).map((t, i) => {
        const spanLeft = count === 3 && i === 0;
        const isLast = i === count - 1;
        // Prefer server-rendered preview (PSD → PNG) over the original
        const tid = (t as any).preview_drive_file_id || t.drive_file_id;
        const thumb = tid ? `/api/files/thumbnail?id=${tid}&thumb=1` : null;
        return (
          <div key={i} style={{
            position: "relative", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", padding: 6,
            ...(spanLeft ? { gridRow: "1 / span 2" } : {}),
          }}>
            {thumb && (
              <img src={thumb} alt="" loading="lazy"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                onError={(e: any) => { e.target.style.display = "none"; }} />
            )}
            {isLast && overflow > 0 && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>
                +{overflow}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DesignerFilterPill({ label, count, active, onClick, accent }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  accent?: string;
}) {
  const fg = active ? "#fff" : (accent || C.text);
  const bg = active ? (accent || C.text) : "transparent";
  const border = accent || C.border;
  return (
    <button onClick={onClick}
      style={{
        background: bg, color: fg, border: `1px solid ${border}`,
        borderRadius: 6, padding: "6px 12px",
        fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
        display: "inline-flex", alignItems: "center", gap: 6,
      }}>
      <span>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 600, opacity: active ? 0.85 : 0.6 }}>· {count}</span>
    </button>
  );
}

function BriefCard({ brief, onOpen }: { brief: Brief; onOpen: () => void }) {
  const meta = STATE_META[brief.state] || STATE_META.draft;
  const due = daysUntil(brief.deadline);
  const kindLabel = brief.latest_thumb?.kind === "first_draft" ? "1st Draft"
    : brief.latest_thumb?.kind === "revision" ? "Revision"
    : brief.latest_thumb?.kind === "final" ? "Final"
    : brief.latest_thumb?.kind === "wip" ? "WIP"
    : null;
  const noWorkYet = !brief.latest_thumb;

  // Preview line pre-computed server-side — "Client uploaded a reference",
  // "HPD added a note on 1st Draft", etc.
  const unreadPreview = brief.preview_line || null;
  const isClientAborted = brief.archived_by === "client" && !!brief.client_aborted_at;
  const event = brief.has_unread_external && !isClientAborted
    ? unreadEventFor(brief.state, brief.unread_by_role, "designer", brief.preview_line)
    : null;
  const highlight = brief.has_unread_external && !isClientAborted
    ? (event?.color || unreadHighlightFor(brief.unread_kind))
    : null;
  const ribbonLabel = event?.label || "NEW";
  const ribbonText = event ? (event.kind === "approval" ? "Client approved" : "Client requested changes") : (unreadPreview || "New activity");
  return (
    <div onClick={onOpen} style={{
      background: C.card,
      border: highlight ? `2px solid ${highlight}` : `1px solid ${C.border}`,
      borderRadius: 12,
      cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column",
      transition: "border-color 0.15s, box-shadow 0.15s",
      position: "relative",
    }}
    onMouseEnter={(e: any) => { e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
    onMouseLeave={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}>

      {/* Unread ribbon — full-width banner across the top with the
          specific activity text. Replaces the old corner "NEW" badge so
          you can read what changed without opening the card. Aborted
          briefs get a quieter muted ribbon since the action is dead. */}
      {brief.has_unread_external && !isClientAborted && highlight && (
        <div style={{
          padding: "6px 14px", background: highlight, color: "#fff",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.02em",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "1px 5px", borderRadius: 2, background: event ? "rgba(0,0,0,0.18)" : C.purple, color: "#fff" }}>{ribbonLabel}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ribbonText}
          </span>
        </div>
      )}
      {isClientAborted && (
        <div style={{
          padding: "6px 14px", background: C.muted, color: "#fff",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
        }}>Client aborted</div>
      )}

      {/* Thumb — mosaic of up to 4 most-recent files. When unread, a
          30% darken overlay sits on top of the mosaic to draw attention
          while still letting the featured tile show through. */}
      <div style={{ aspectRatio: "1", position: "relative", overflow: "hidden", opacity: isClientAborted ? 0.45 : 1 }}>
        <TileMosaic thumbs={brief.thumbs || []} total={brief.thumb_total ?? (brief.thumbs?.length || 0)} />
        {brief.has_unread_external && !isClientAborted && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.30)", pointerEvents: "none", zIndex: 1 }} />
        )}
        {kindLabel && !noWorkYet && (
          <div style={{ position: "absolute", bottom: 10, right: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: C.mono, zIndex: 2 }}>
            {kindLabel}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: brief.has_unread_external ? 800 : 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {brief.title || "Untitled design"}
        </div>
        <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 6, alignItems: "center" }}>
          {brief.clients?.name && <span>{brief.clients.name}</span>}
          {due && <><span style={{ color: C.faint }}>·</span><span style={{ color: due.color, fontWeight: 600 }}>{due.text}</span></>}
        </div>
      </div>
    </div>
  );
}

function CenterMsg({ msg, err }: { msg: string; err?: boolean }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: err ? C.red : C.muted, fontSize: 14 }}>{msg}</div>
    </div>
  );
}

// ── Brief detail (designer view) ──
// Kind display metadata for the file strip + hero badge. Matches the OpsHub
// Art Studio v2 modal's color coding so designer + HPD see the same visual
// language.
const KIND_META: Record<string, { short: string; bg: string; fg: string; rank: number }> = {
  final:       { short: "FINAL", bg: C.green,  fg: "#fff", rank: 5 },
  revision:    { short: "REV",   bg: C.amber,  fg: "#fff", rank: 4 },
  first_draft: { short: "1ST",   bg: C.blue,   fg: "#fff", rank: 3 },
  wip:         { short: "WIP",   bg: C.accent, fg: "#fff", rank: 2 },
  reference:   { short: "REF",   bg: C.purple, fg: "#fff", rank: 1 },
  client_intake: { short: "INTK", bg: C.purpleBg, fg: C.purple, rank: 1 },
  print_ready: { short: "PRINT", bg: C.green, fg: "#fff", rank: 5 },
};

// Pick the default hero: latest file of the kind matching brief's current
// state. Falls back to newest file of any kind.
function pickHeroFile(state: string, files: BriefFile[]): BriefFile | null {
  if (!files.length) return null;
  const pref: Record<string, string[]> = {
    sent: ["reference"],
    in_progress: ["wip", "reference"],
    wip_review: ["wip", "reference"],
    client_review: ["first_draft", "revision", "wip"],
    revisions: ["first_draft", "revision", "wip"],
    final_approved: ["final", "first_draft"],
    pending_prep: ["final"],
    production_ready: ["print_ready", "final"],
    delivered: ["final"],
  };
  const order = pref[state] || ["final", "first_draft", "wip", "reference"];
  for (const kind of order) {
    const hit = files.filter(f => f.kind === kind).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
    if (hit) return hit;
  }
  return [...files].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null;
}

type UploadKind = "wip" | "first_draft" | "revision" | "final";
const UPLOAD_LABELS: Record<UploadKind, string> = {
  wip: "WIP",
  first_draft: "1st Draft",
  revision: "Revision",
  final: "Final",
};

// What the designer should know/do next, based on brief state.
// Keeps everyone oriented — no blank slate after uploads.
function designerNextStep(
  state: string,
  ctx?: { latestWipAt?: string; latestFinalAt?: string }
): { text: string; tone: "info" | "action" | "done" } | null {
  if (state === "sent") {
    return { text: "New design request — please review below. Upload a Work In Progress PNG if direction needs confirmation, or jump to 1st Draft PNG when ready.", tone: "action" };
  }
  if (state === "in_progress") {
    return { text: "New design request — please review references. Upload a Work In Progress PNG if direction needs confirmation, or jump to 1st Draft PNG when ready.", tone: "action" };
  }
  if (state === "wip_review") {
    const ts = ctx?.latestWipAt ? formatStamp(ctx.latestWipAt) : "";
    return { text: ts ? `Work In Progress shared ${ts}.` : "Work In Progress shared.", tone: "info" };
  }
  if (state === "client_review") {
    return { text: "We're reviewing your draft. You'll hear back soon — approval or revisions.", tone: "info" };
  }
  if (state === "revisions") {
    return { text: "Changes requested — see comments on the latest file. Upload Revision PNG when ready.", tone: "action" };
  }
  if (state === "final_approved") {
    return { text: 'Approved. Upload final print file. Specs: PSD 300dpi 20"×20" RGB, layered / AI artboard 20"×20" RGB.', tone: "action" };
  }
  if (state === "pending_prep" || state === "production_ready") {
    const ts = ctx?.latestFinalAt ? formatStamp(ctx.latestFinalAt) : "";
    return { text: ts ? `All done — Final uploaded ${ts}.` : "All done — Final uploaded.", tone: "done" };
  }
  if (state === "delivered") {
    return { text: "Your part is complete. HPD is handling production prep.", tone: "done" };
  }
  return null;
}

// Formats an ISO timestamp as "Mar 5 · 2:30 PM" — used in banner copy.
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

// Auto-bullet helper — focus empty → "• ", Enter → "\n• ". Matches HPD + client.
function bulletHandlers(value: string, setValue: (v: string) => void) {
  return {
    onFocus: (e: React.FocusEvent<HTMLTextAreaElement>) => {
      if (!e.target.value) {
        const b = "• ";
        setValue(b);
        setTimeout(() => (e.target as HTMLTextAreaElement).setSelectionRange(b.length, b.length), 0);
      }
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const t = e.target as HTMLTextAreaElement;
        const pos = t.selectionStart;
        const insert = "\n• ";
        const next = value.slice(0, pos) + insert + value.slice(pos);
        setValue(next);
        setTimeout(() => t.setSelectionRange(pos + insert.length, pos + insert.length), 0);
      }
    },
  };
}

function BriefDetailModal({ token, briefId, onClose }: { token: string; briefId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<any>(null);
  const [files, setFiles] = useState<BriefFile[]>([]);
  const [uploadingKind, setUploadingKind] = useState<UploadKind | null>(null);
  const [selectedKind, setSelectedKind] = useState<UploadKind>("wip");
  const [heroId, setHeroId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    load();
    // Poll every 15s so HPD/client notes, new uploads, and annotations
    // propagate live while the modal is open. Typing state is preserved by
    // the init-vs-poll split below.
    const interval = setInterval(() => load(), 15000);
    return () => clearInterval(interval);
  }, [briefId]);

  // Escape closes the modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);


  async function load() {
    const res = await fetch(`/api/design/${token}/briefs/${briefId}`);
    const data = await res.json();
    setBrief(data.brief);
    setFiles(data.files || []);
    setLoading(false);
    // Default the upload kind to whatever the state suggests is next
    const nextKind = defaultUploadKind(data.brief?.state);
    if (nextKind) setSelectedKind(nextKind);
  }

  async function upload(file: File, kind: UploadKind) {
    setUploadingKind(kind);
    const noteForBatch = uploadNote.trim();
    try {
      // 1. Session — server returns Drive upload URL
      const sessionRes = await fetch(`/api/design/${token}/briefs/${briefId}/upload-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          kind,
        }),
      });
      if (!sessionRes.ok) throw new Error("Could not start upload");
      const { uploadUrl } = await sessionRes.json();

      // 2. Upload bytes — direct-to-Drive, falls back to chunked proxy
      const { drive_file_id } = await uploadFileToDriveSession(uploadUrl, file);

      // 3. Register with OpsHub — triggers state transition + notification
      await fetch(`/api/design/${token}/briefs/${briefId}/upload-session/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drive_file_id,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
          kind,
          note: noteForBatch || null,
        }),
      });
    } catch (e: any) {
      alert(`Upload failed: ${e.message || "unknown error"}`);
    }
    setUploadNote("");
    setUploadingKind(null);
    load();
  }

  async function deleteFile(fileId: string) {
    if (!window.confirm("Delete this upload?")) return;
    await fetch(`/api/design/${token}/briefs/${briefId}/files?fileId=${fileId}`, { method: "DELETE" });
    if (heroId === fileId) setHeroId(null);
    load();
  }


  if (loading || !brief) return <CenterMsg msg="Loading…" />;

  const meta = STATE_META[brief.state] || STATE_META.draft;
  const due = daysUntil(brief.deadline);
  const isClientAborted = brief.archived_by === "client" && !!brief.client_aborted_at;

  // References render as a moodboard grid above the hero (see below)
  // so the strip + hero only deal with non-reference files (drafts,
  // revisions, finals). Refs were the click-each-one pain point.
  const nonRefFiles = files.filter(f => f.kind !== "reference");
  const hero = (heroId && nonRefFiles.find(f => f.id === heroId)) || pickHeroFile(brief.state, nonRefFiles);
  const stripFiles = [...nonRefFiles].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const heroMeta = hero ? KIND_META[hero.kind] : null;
  const references = files.filter(f => f.kind === "reference").sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

  return (
    // Full-viewport panel — design requests are the primary surface
    // for designers, so the detail view takes over the screen instead
    // of floating in the middle. X button returns to the list.
    <div
      style={{ position: "fixed", inset: 0, background: C.card, zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: C.font, color: C.text }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "12px 22px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {brief.title || "Untitled design"}
            </div>
            <span style={{ color: meta.color, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {meta.label}
            </span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {brief.clients?.name || "Client"}
            {brief.deadline && <> · Due {new Date(brief.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric" })}{due && ` · ${due.text}`}</>}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
      </div>

      {/* What's next — tells designer what they + everyone else is waiting on */}
      {!isClientAborted && (() => {
        const latestWip = nonRefFiles.filter(f => f.kind === "wip").sort((a,b) => (b.created_at||"").localeCompare(a.created_at||""))[0];
        const latestFinal = nonRefFiles.filter(f => f.kind === "final").sort((a,b) => (b.created_at||"").localeCompare(a.created_at||""))[0];
        const next = designerNextStep(brief.state, {
          latestWipAt: latestWip?.created_at,
          latestFinalAt: latestFinal?.created_at,
        });
        if (!next) return null;
        return (
          <div style={{ padding: "10px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <div style={{ flex: 1, fontSize: 12, color: next.tone === "action" ? C.amber : next.tone === "done" ? C.green : C.blue, fontWeight: 600 }}>
              {next.text}
            </div>
          </div>
        );
      })()}

      {/* Client-aborted banner — read-only mode */}
      {isClientAborted && (
        <div style={{ padding: "10px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: 13, color: C.red, fontWeight: 700 }}>
            CLIENT ABORTED
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginLeft: 8 }}>
              — design request is read-only. HPD may repurpose it within 60 days.
            </span>
          </div>
        </div>
      )}

      {/* Main body — single column. Brief context (if any) + upload bar
          ride at the top; file cards take the full width below. */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f, selectedKind);
        }}
        style={{
          flex: 1, minHeight: 0, overflow: "auto",
          background: C.surface,
          display: "flex", flexDirection: "column",
          outline: dragOver ? `3px dashed ${C.blue}` : "none", outlineOffset: -3,
        }}
      >
        {/* From HPD — only when there's actual content. Compact info bar. */}
        {(brief.concept || brief.placement || brief.colors || brief.mood_words?.length > 0 || brief.deadline) && (
          <div style={{ padding: "12px 18px", background: C.card, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>
              From HPD
            </div>
            {brief.concept && (
              <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", color: C.text, marginBottom: 8 }}>{brief.concept}</div>
            )}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: C.muted }}>
              {brief.placement && <span><span style={{ color: C.faint, fontWeight: 600 }}>Placement</span> · {brief.placement}</span>}
              {brief.colors && <span><span style={{ color: C.faint, fontWeight: 600 }}>Colors</span> · {brief.colors}</span>}
              {brief.mood_words?.length > 0 && <span><span style={{ color: C.faint, fontWeight: 600 }}>Mood</span> · {brief.mood_words.join(", ")}</span>}
              {brief.deadline && <span><span style={{ color: C.faint, fontWeight: 600 }}>Due</span> · {new Date(brief.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</span>}
            </div>
          </div>
        )}

        {/* Upload bar — sticky at top of the scrolling column. Single
            row: kind pills · note · choose file. Wraps on narrow widths. */}
        <div style={{
          position: "sticky", top: 0, zIndex: 5,
          padding: "10px 18px",
          background: C.card, borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Upload
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["wip", "first_draft", "revision", "final"] as UploadKind[]).map(k => {
              const isSelected = selectedKind === k;
              const isFinal = k === "final";
              return (
                <button key={k}
                  onClick={() => setSelectedKind(k)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 4,
                    background: isSelected ? (isFinal ? C.green : C.accent) : C.surface,
                    color: isSelected ? "#fff" : (isFinal ? C.green : C.muted),
                    border: `1px solid ${isSelected ? (isFinal ? C.green : C.accent) : C.border}`,
                    fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
                  }}>
                  {UPLOAD_LABELS[k]}
                </button>
              );
            })}
          </div>
          <input
            value={uploadNote}
            onChange={e => setUploadNote(e.target.value)}
            placeholder="Note for this upload (optional)"
            style={{
              flex: 1, minWidth: 200,
              padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6,
              fontSize: 12, fontFamily: C.font, outline: "none",
              background: C.surface, color: C.text,
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingKind !== null || isClientAborted}
            title={isClientAborted ? "Client aborted this design request — upload disabled" : undefined}
            style={{
              padding: "7px 16px",
              background: isClientAborted ? C.surface : (uploadingKind ? C.surface : C.text),
              color: isClientAborted ? C.faint : (uploadingKind ? C.muted : "#fff"),
              border: "none", borderRadius: 6,
              fontSize: 12, fontWeight: 700,
              cursor: (uploadingKind || isClientAborted) ? "not-allowed" : "pointer",
              fontFamily: C.font, whiteSpace: "nowrap",
            }}>
            {isClientAborted ? "Upload disabled" : (uploadingKind ? `Uploading ${UPLOAD_LABELS[uploadingKind]}…` : `+ Choose file`)}
          </button>
          <input ref={fileInputRef} type="file" style={{ display: "none" }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) upload(f, selectedKind);
              e.target.value = "";
            }} />
        </div>

        {/* Files header + grid — full width, scrolls with column */}
        <div style={{ padding: "14px 18px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted }}>
            Files {files.length > 0 && <span style={{ fontWeight: 400, color: C.faint }}>· {files.length}</span>}
          </div>
          {dragOver && (
            <span style={{ color: C.blue, fontSize: 11, fontWeight: 700 }}>
              Drop to upload as {UPLOAD_LABELS[selectedKind]}
            </span>
          )}
        </div>

        {files.length > 0 ? (
          <div style={{ padding: "0 18px 24px", flexShrink: 0 }}>
            <ArtReferencesGrid
              files={files as any}
              viewerRole="designer"
              readOnly={isClientAborted}
              onPostComment={async (fileId, body) => {
                const r = await fetch(`/api/design/${token}/briefs/${briefId}/comments`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ fileId, body }),
                });
                if (!r.ok) throw new Error("post failed");
                const d = await r.json();
                const saved = d?.comment;
                setFiles(p => p.map(f => f.id === fileId ? {
                  ...f,
                  comments: [...((f as any).comments || []), saved],
                } as any : f));
                return saved;
              }}
              onDelete={(fileId) => deleteFile(fileId)}
              canDelete={(f) => f.uploader_role === "designer"}
            />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center", color: C.faint, fontSize: 13 }}>
            {dragOver ? (
              <span style={{ color: C.blue, fontWeight: 700 }}>Drop to upload as {UPLOAD_LABELS[selectedKind]}</span>
            ) : (
              <div>
                <div style={{ fontSize: 36, marginBottom: 8, color: C.faint }}>↑</div>
                <div>Drop a file anywhere on this view, or use the upload bar above</div>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function defaultUploadKind(state: string | undefined): UploadKind | null {
  if (state === "sent" || state === "in_progress") return "wip";
  if (state === "wip_review") return "first_draft";
  if (state === "client_review") return "first_draft";
  if (state === "revisions") return "revision";
  if (state === "final_approved") return "final";
  return null;
}
