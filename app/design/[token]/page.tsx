"use client";
import { useState, useEffect, useRef } from "react";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";

// ── Document-style theme — matches vendor portal (light, professional) ──
const C = {
  bg: "#f8f8f9", card: "#ffffff", surface: "#f3f3f5", border: "#e0e0e4",
  text: "#1a1a1a", muted: "#6b6b78", faint: "#a0a0ad",
  accent: "#1a1a1a", accentBg: "#f0f0f2",
  green: "#1a8c5c", greenBg: "#edf7f2", greenBorder: "#b4dfc9",
  amber: "#b45309", amberBg: "#fef9ee", amberBorder: "#f5dfa8",
  red: "#c43030", redBg: "#fdf2f2", redBorder: "#f0c0c0",
  purple: "#7c3aed", purpleBg: "#f3ebfd", purpleBorder: "#d9c7f2",
  blue: "#2d7a8f", blueBg: "#e0f2f7", blueBorder: "#b6dce6",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "'SF Mono', 'IBM Plex Mono', Menlo, monospace",
};

type ThumbLite = { drive_file_id: string | null; drive_link: string | null; kind?: string };
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
  preview_line?: string | null;
  client_aborted_at?: string | null;
  archived_by?: "client" | "hpd" | null;
};
type BriefFile = {
  id: string; file_name: string; drive_link: string | null; drive_file_id: string | null;
  kind: string; version: number;
  hpd_annotation: string | null; client_annotation: string | null; designer_annotation: string | null;
  uploader_role: string; created_at: string;
};
type Message = {
  id: string; sender_role: string; sender_name: string | null; message: string; created_at: string;
};

// ── State → display ──
const STATE_META: Record<string, { label: string; color: string; bg: string; border: string; group: string }> = {
  sent:             { label: "New brief",           color: C.red,    bg: C.redBg,    border: C.redBorder,    group: "action" },
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
              title: b.title || "Untitled brief",
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
  // Brief drops out of the active feed unless someone else acted on it
  // (has_unread_external = true re-surfaces it automatically).
  const DONE_STATES = ["pending_prep", "final_approved", "production_ready", "delivered"];
  const isDoneForDesigner = (b: Brief) =>
    DONE_STATES.includes(b.state) && !b.has_unread_external;

  const doneCount = briefs.filter(isDoneForDesigner).length;

  const filtered = filter === "unread"
    ? briefs.filter(b => b.has_unread_external)
    : filter === "done"
      ? briefs.filter(isDoneForDesigner)
      : briefs.filter(b => !isDoneForDesigner(b)); // "all" = active only

  // One number: how many briefs have activity you haven't seen?
  const unreadCount = briefs.filter(b => b.has_unread_external).length;
  const overdueCount = briefs.filter(b => {
    if (!b.deadline) return false;
    const d = Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000);
    return d < 0 && !["final_approved", "pending_prep", "production_ready", "delivered"].includes(b.state);
  }).length;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      {/* Toast stack — new-activity notifications from 15s polling */}
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
        {toasts.map(t => (
          <div key={t.id}
            onClick={() => { setSelected(t.briefId); setToasts(ts => ts.filter(x => x.id !== t.id)); }}
            style={{ background: C.card, border: `2px solid ${C.red}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,0.12)", animation: "slideIn 0.2s ease-out" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: C.red, letterSpacing: "0.08em", marginBottom: 3 }}>NEW</div>
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
        {/* Unread counter — clickable to filter */}
        <div style={{ marginBottom: 18, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          {unreadCount > 0 ? (
            <button onClick={() => setFilter(filter === "unread" ? "all" : "unread")}
              style={{ background: filter === "unread" ? C.red : "transparent", color: filter === "unread" ? "#fff" : C.red, border: `1px solid ${C.red}`, borderRadius: 6, padding: "6px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}>
              {unreadCount} new update{unreadCount === 1 ? "" : "s"}{filter === "unread" ? " · showing" : " · tap to filter"}
            </button>
          ) : (
            <span style={{ fontSize: 14, color: C.muted, fontWeight: 700 }}>All caught up.</span>
          )}
          {filter !== "all" && (
            <button onClick={() => setFilter("all")}
              style={{ background: "transparent", color: C.muted, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font, textDecoration: "underline" }}>
              Show active
            </button>
          )}
          {doneCount > 0 && filter !== "done" && (
            <button onClick={() => setFilter("done")}
              style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
              Done · {doneCount}
            </button>
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
              ? "No briefs yet. You'll be notified when something is assigned."
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
        const thumb = t.drive_file_id ? `/api/files/thumbnail?id=${t.drive_file_id}&thumb=1` : null;
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
  return (
    <div onClick={onOpen} style={{
      background: C.card,
      border: brief.has_unread_external ? `2px solid ${C.red}` : `1px solid ${C.border}`,
      borderRadius: 12,
      cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column",
      transition: "border-color 0.15s, box-shadow 0.15s",
      position: "relative",
    }}
    onMouseEnter={(e: any) => { e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
    onMouseLeave={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}>

      {/* NEW flag — Option C */}
      {brief.has_unread_external && !isClientAborted && (
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 2,
          padding: "4px 12px", borderRadius: 4,
          background: C.red, color: "#fff",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
          boxShadow: "0 2px 8px rgba(255, 50, 77, 0.35)",
        }}>NEW</div>
      )}
      {/* Client-aborted flag — higher priority than NEW */}
      {isClientAborted && (
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 2,
          padding: "4px 12px", borderRadius: 4,
          background: C.muted, color: "#fff",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
        }}>CLIENT ABORTED</div>
      )}

      {/* Thumb — mosaic of up to 4 most-recent files */}
      <div style={{ aspectRatio: "1", position: "relative", overflow: "hidden", opacity: isClientAborted ? 0.45 : 1 }}>
        <TileMosaic thumbs={brief.thumbs || []} total={brief.thumb_total ?? (brief.thumbs?.length || 0)} />
        {/* Status dot */}
        <div title={meta.label}
          style={{ position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: 99, background: meta.color, boxShadow: "0 0 0 2px #fff", zIndex: 2 }} />
        {kindLabel && !noWorkYet && (
          <div style={{ position: "absolute", bottom: 10, right: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: C.mono, zIndex: 2 }}>
            {kindLabel}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: brief.has_unread_external ? 800 : 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {brief.title || "Untitled brief"}
        </div>
        <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 6, alignItems: "center" }}>
          {brief.clients?.name && <span>{brief.clients.name}</span>}
          {due && <><span style={{ color: C.faint }}>·</span><span style={{ color: due.color, fontWeight: 600 }}>{due.text}</span></>}
        </div>
        {unreadPreview && (
          <div style={{ fontSize: 11, fontWeight: 700, color: C.red, marginTop: 6 }}>
            {unreadPreview}
          </div>
        )}
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
function designerNextStep(state: string): { text: string; tone: "info" | "action" | "done" } | null {
  if (state === "sent" || state === "in_progress") {
    return { text: "Upload a WIP to share direction — or jump straight to 1st Draft when ready.", tone: "info" };
  }
  if (state === "wip_review") {
    return { text: "WIP shared with the team. Upload 1st Draft when you're ready for formal client review.", tone: "info" };
  }
  if (state === "client_review") {
    return { text: "Client is reviewing your draft. You'll hear back soon — either approval or revision notes.", tone: "info" };
  }
  if (state === "revisions") {
    return { text: "Client requested changes — see their note on the latest file. Upload Revision when you've addressed it.", tone: "action" };
  }
  if (["final_approved", "pending_prep", "production_ready", "delivered"].includes(state)) {
    return { text: "Your part is complete. HPD is handling production prep.", tone: "done" };
  }
  return null;
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
  const [designerNote, setDesignerNote] = useState("");
  const [designerNoteSaved, setDesignerNoteSaved] = useState("");
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

  // When hero changes, init the designer's note from that file's saved value.
  // When files update via poll, sync the "saved" marker but don't clobber an
  // in-progress edit (only update the textarea if user has nothing typed).
  const lastInitHeroRef = useRef<string | null>(null);
  const designerNoteSavedRef = useRef("");
  useEffect(() => { designerNoteSavedRef.current = designerNoteSaved; }, [designerNoteSaved]);
  useEffect(() => {
    const heroFile = heroId ? files.find(f => f.id === heroId) : null;
    const saved = heroFile?.designer_annotation || "";
    if (lastInitHeroRef.current !== heroId) {
      lastInitHeroRef.current = heroId;
      setDesignerNote(saved);
      setDesignerNoteSaved(saved);
      return;
    }
    if (saved !== designerNoteSavedRef.current) {
      setDesignerNote(prev => prev === designerNoteSavedRef.current ? saved : prev);
      setDesignerNoteSaved(saved);
    }
  }, [heroId, files]);

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

  async function saveDesignerNote(fileId: string, note: string) {
    if (note === designerNoteSaved) return;
    try {
      await fetch(`/api/design/${token}/briefs/${briefId}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, designer_annotation: note }),
      });
      setDesignerNoteSaved(note);
      setFiles(p => p.map(f => f.id === fileId ? { ...f, designer_annotation: note || null } : f));
    } catch {}
  }

  if (loading || !brief) return <CenterMsg msg="Loading…" />;

  const meta = STATE_META[brief.state] || STATE_META.draft;
  const due = daysUntil(brief.deadline);
  const isClientAborted = brief.archived_by === "client" && !!brief.client_aborted_at;

  // Hero: selected or state-derived default. Strip: all files, newest first,
  // references pushed to the end so creative work dominates the strip.
  const hero = (heroId && files.find(f => f.id === heroId)) || pickHeroFile(brief.state, files);
  const stripFiles = [
    ...files.filter(f => f.kind !== "reference").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    ...files.filter(f => f.kind === "reference").sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")),
  ];
  const heroMeta = hero ? KIND_META[hero.kind] : null;
  const references = files.filter(f => f.kind === "reference");

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 14, maxWidth: 1180, width: "100%", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column", fontFamily: C.font, color: C.text }}>
      {/* Header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "12px 22px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {brief.title || "Untitled brief"}
            </div>
            <span style={{ padding: "3px 8px", borderRadius: 4, background: meta.bg, color: meta.color, fontSize: 9, fontWeight: 700, border: `1px solid ${meta.border}`, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.06em" }}>
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
        const next = designerNextStep(brief.state);
        if (!next) return null;
        return (
          <div style={{ padding: "10px 22px", background: next.tone === "action" ? C.amberBg : next.tone === "done" ? C.greenBg : C.blueBg, borderBottom: `1px solid ${next.tone === "action" ? C.amberBorder : next.tone === "done" ? C.greenBorder : C.blueBorder}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <div style={{ flex: 1, fontSize: 12, color: next.tone === "action" ? C.amber : next.tone === "done" ? C.green : C.blue, fontWeight: 600 }}>
              {next.text}
            </div>
          </div>
        );
      })()}

      {/* Client-aborted banner — read-only mode */}
      {isClientAborted && (
        <div style={{ padding: "10px 22px", background: C.redBg, borderBottom: `1px solid ${C.redBorder}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: 13, color: C.red, fontWeight: 700 }}>
            CLIENT ABORTED
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginLeft: 8 }}>
              — brief is read-only. HPD may repurpose it within 60 days.
            </span>
          </div>
        </div>
      )}

      {/* Main body — hero + strip on left, thread on right */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 320px", minHeight: 0, overflow: "hidden" }}>
        {/* LEFT — hero + strip + upload pills */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {/* Hero — doubles as the drop target */}
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
              height: "clamp(480px, 60vh, 720px)",
              flexShrink: 0,
              background: C.surface,
              position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
              outline: dragOver ? `3px dashed ${C.blue}` : "none",
              outlineOffset: -3,
            }}
          >
            {hero ? (
              <>
                <a href={hero.drive_link || "#"} target="_blank" rel="noopener noreferrer" style={{ display: "contents" }}>
                  <img
                    src={hero.drive_file_id ? `https://drive.google.com/thumbnail?id=${hero.drive_file_id}&sz=w1600` : ""}
                    referrerPolicy="no-referrer"
                    alt=""
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                    onError={(e: any) => { e.target.style.display = "none"; }}
                  />
                </a>
                {heroMeta && (
                  <div style={{ position: "absolute", top: 12, left: 12, padding: "3px 9px", borderRadius: 4, background: heroMeta.bg, color: heroMeta.fg, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em" }}>
                    {heroMeta.short}{hero.version ? ` · v${hero.version}` : ""}
                  </div>
                )}
                {hero.file_name && (
                  <div style={{ position: "absolute", bottom: 12, left: 12, padding: "3px 9px", borderRadius: 4, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 10, fontFamily: C.mono }}>
                    {hero.file_name}
                  </div>
                )}
                {hero.uploader_role === "designer" && (
                  <button onClick={() => deleteFile(hero.id)}
                    style={{ position: "absolute", top: 12, right: 12, padding: "4px 10px", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                    Delete
                  </button>
                )}
                {dragOver && (
                  <div style={{ position: "absolute", inset: 0, background: "rgba(45,122,143,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 16, fontWeight: 700 }}>
                    Drop to upload as {UPLOAD_LABELS[selectedKind]}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: "center", color: C.faint, fontSize: 13 }}>
                {dragOver
                  ? <span style={{ color: C.blue, fontWeight: 700 }}>Drop to upload as {UPLOAD_LABELS[selectedKind]}</span>
                  : <>
                      <div style={{ fontSize: 36, marginBottom: 8, color: C.faint }}>↑</div>
                      <div>Drop a file here, or use the upload pills below</div>
                    </>}
              </div>
            )}
          </div>

          {/* Strip + notes — takes remaining vertical space, scrolls.
              Hero above is fixed; this absorbs overflow. */}
          <div style={{ background: C.surface, borderTop: `1px solid ${C.border}`, padding: "10px 14px", flex: 1, overflowY: "auto", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Files {stripFiles.length > 0 && <span style={{ fontWeight: 400, color: C.faint }}>· {stripFiles.length}</span>}
              </div>
            </div>

            {/* Strip */}
            {stripFiles.length > 0 ? (
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
                {stripFiles.map(f => {
                  const m = KIND_META[f.kind] || KIND_META.reference;
                  const isHero = hero?.id === f.id;
                  return (
                    <div key={f.id}
                      onClick={() => setHeroId(f.id)}
                      title={`${m.short}${f.version ? ` v${f.version}` : ""} — ${f.file_name || ""}`}
                      style={{
                        width: 72, height: 72, flexShrink: 0,
                        background: "#fff", borderRadius: 4,
                        border: `2px solid ${isHero ? C.blue : C.border}`,
                        boxShadow: isHero ? `0 0 0 2px ${C.blueBorder}` : "none",
                        overflow: "hidden", position: "relative", cursor: "pointer",
                      }}>
                      <img
                        src={thumbUrl(f.drive_file_id) || ""}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e: any) => { e.target.style.display = "none"; }}
                      />
                      <div style={{ position: "absolute", top: 2, left: 2, padding: "1px 4px", borderRadius: 2, background: m.bg, color: m.fg, fontSize: 8, fontWeight: 700 }}>
                        {m.short}
                      </div>
                      {f.version > 1 && (
                        <div style={{ position: "absolute", bottom: 2, left: 2, padding: "1px 4px", borderRadius: 2, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 8, fontFamily: C.mono }}>
                          v{f.version}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: C.faint, fontStyle: "italic", marginBottom: 10 }}>
                No uploads yet.
              </div>
            )}

          </div>
        </div>

        {/* RIGHT — Brief (top, compact) + Notes (middle, flex) + Upload (bottom, pinned) */}
        <div style={{ borderLeft: `1px solid ${C.border}`, background: C.card, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {/* Brief — compact top */}
          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0, maxHeight: "35%", overflowY: "auto", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Brief from HPD
            </div>
            {brief.concept ? (
              <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", color: C.text }}>{brief.concept}</div>
            ) : (
              <div style={{ fontSize: 12, color: C.faint, fontStyle: "italic" }}>(no concept provided)</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              {brief.placement && <div><span style={{ color: C.faint, fontWeight: 600 }}>Placement: </span>{brief.placement}</div>}
              {brief.colors && <div><span style={{ color: C.faint, fontWeight: 600 }}>Colors: </span>{brief.colors}</div>}
              {brief.mood_words?.length > 0 && <div><span style={{ color: C.faint, fontWeight: 600 }}>Mood: </span>{brief.mood_words.join(" · ")}</div>}
              {brief.deadline && <div><span style={{ color: C.faint, fontWeight: 600 }}>Due: </span>{new Date(brief.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</div>}
            </div>
          </div>

          {/* Notes on the current hero — conversation lives here */}
          <div style={{ padding: "14px 16px", flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 10, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Notes on this image
            </div>
            {!hero ? (
              <div style={{ fontSize: 12, color: C.faint, fontStyle: "italic" }}>Pick a file to see + add notes.</div>
            ) : (
              <>
                {hero.client_annotation && (
                  <div style={{ padding: "8px 12px", background: C.purpleBg, border: `1px solid ${C.purpleBorder}`, borderRadius: 6 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Client</div>
                    <div style={{ fontSize: 12, color: C.text, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{hero.client_annotation}</div>
                  </div>
                )}
                {hero.hpd_annotation && (
                  <div style={{ padding: "8px 12px", background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 6 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>HPD</div>
                    <div style={{ fontSize: 12, color: C.text, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{hero.hpd_annotation}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Your note</div>
                  <textarea
                    value={designerNote}
                    onChange={e => setDesignerNote(e.target.value)}
                    onBlur={() => saveDesignerNote(hero.id, designerNote)}
                    {...bulletHandlers(designerNote, setDesignerNote)}
                    placeholder="• Design notes, caveats, open questions"
                    rows={4}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.blueBorder}`, borderRadius: 6, fontSize: 12, fontFamily: C.font, outline: "none", background: C.blueBg, color: C.text, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Upload (pinned to bottom of right column) */}
          <div style={{ borderTop: `1px solid ${C.border}`, background: C.surface, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Upload
            </div>
            <textarea value={uploadNote} onChange={e => setUploadNote(e.target.value)}
              {...bulletHandlers(uploadNote, setUploadNote)}
              placeholder="• Note for this upload (optional)"
              rows={2}
              style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: C.font, outline: "none", background: C.card, resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", width: "100%" }}>Kind</span>
              {(["wip", "first_draft", "revision", "final"] as UploadKind[]).map(k => {
                const isSelected = selectedKind === k;
                const isFinal = k === "final";
                return (
                  <button key={k}
                    onClick={() => setSelectedKind(k)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 4,
                      background: isSelected ? (isFinal ? C.green : C.accent) : C.card,
                      color: isSelected ? "#fff" : (isFinal ? C.green : C.muted),
                      border: `1px solid ${isSelected ? (isFinal ? C.green : C.accent) : C.border}`,
                      fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
                    }}>
                    {UPLOAD_LABELS[k]}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingKind !== null || isClientAborted}
              title={isClientAborted ? "Client aborted this brief — upload disabled" : undefined}
              style={{
                width: "100%",
                padding: "8px 14px",
                background: isClientAborted ? C.surface : (uploadingKind ? C.surface : C.text),
                color: isClientAborted ? C.faint : (uploadingKind ? C.muted : "#fff"),
                border: "none", borderRadius: 6,
                fontSize: 12, fontWeight: 700,
                cursor: (uploadingKind || isClientAborted) ? "not-allowed" : "pointer",
                fontFamily: C.font,
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
        </div>
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
  return null;
}
