"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";

// ── Document-style theme (matches designer + vendor portals) ──
const C = {
  bg: "#f8f8f9", card: "#ffffff", surface: "#f3f3f5", border: "#e0e0e4",
  text: "#1a1a1a", muted: "#6b6b78", faint: "#a0a0ad",
  accent: "#1a1a1a",
  green: "#1a8c5c", greenBg: "#edf7f2", greenBorder: "#b4dfc9",
  amber: "#b45309", amberBg: "#fef9ee", amberBorder: "#f5dfa8",
  red: "#c43030", redBg: "#fdf2f2", redBorder: "#f0c0c0",
  purple: "#7c3aed", purpleBg: "#f3ebfd", purpleBorder: "#d9c7f2",
  blue: "#2d7a8f", blueBg: "#e0f2f7", blueBorder: "#b6dce6",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "'SF Mono', 'IBM Plex Mono', Menlo, monospace",
};

type Thumb = { drive_file_id: string | null; drive_link: string | null; kind?: string };
type Brief = {
  id: string; title: string | null; concept: string | null; state: string; deadline: string | null;
  job_title: string | null; job_number: string | null;
  intake_token: string | null; intake_requested: boolean; submitted_at: string | null; has_intake: boolean;
  sent_to_designer_at: string | null;
  thumbs: Thumb[]; thumb_total: number; updated_at: string;
  last_activity_at?: string | null;
  has_unread_external?: boolean;
  preview_line?: string | null;
};
type PortalData = { client: { name: string }; briefs: Brief[] };

// Client-facing state labels (internal states collapsed — client doesn't need
// to know about HPD review or pending-prep stages).
function clientStateFor(b: Brief): { label: string; bucket: string; color: string; bg: string; border: string } {
  // Only flag as "Needs your input" when HPD has explicitly sent an intake
  // request to the client and they haven't filled it yet.
  if (b.intake_requested) {
    return { label: "Needs your input", bucket: "action", color: C.amber, bg: C.amberBg, border: C.amberBorder };
  }
  const s = b.state;
  if (s === "draft") {
    return { label: "Planning", bucket: "progress", color: C.muted, bg: C.surface, border: C.border };
  }
  if (s === "sent" || s === "in_progress" || s === "wip_review") {
    return { label: "In design", bucket: "progress", color: C.blue, bg: C.blueBg, border: C.blueBorder };
  }
  if (s === "client_review") {
    return { label: "Needs your review", bucket: "action", color: C.purple, bg: C.purpleBg, border: C.purpleBorder };
  }
  if (s === "revisions") {
    return { label: "In revision", bucket: "progress", color: C.blue, bg: C.blueBg, border: C.blueBorder };
  }
  if (s === "final_approved" || s === "pending_prep" || s === "production_ready") {
    return { label: "Approved", bucket: "done", color: C.green, bg: C.greenBg, border: C.greenBorder };
  }
  if (s === "delivered") {
    return { label: "Delivered", bucket: "done", color: C.green, bg: C.greenBg, border: C.greenBorder };
  }
  return { label: s, bucket: "progress", color: C.muted, bg: C.surface, border: C.border };
}

// Filters collapsed — the unread counter at the top is the only control now.
// State-based filtering lost its purpose when every brief became a live
// conversation instead of a stage in a pipeline.

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: C.red };
  if (diff === 0) return { text: "today", color: C.red };
  if (diff <= 3) return { text: `${diff}d`, color: C.amber };
  return { text: `${diff}d`, color: C.muted };
};

const thumbUrl = (id: string | null | undefined) => id ? `/api/files/thumbnail?id=${id}&thumb=1` : null;

type Toast = { id: string; briefId: string; title: string; preview: string };

export default function ClientPortal({ params }: { params: { token: string } }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [openBrief, setOpenBrief] = useState<Brief | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevActivityRef = useRef<Record<string, string>>({});

  async function fetchPortal(isInitial: boolean) {
    try {
      const res = await fetch(`/api/portal/client/${params.token}`);
      const body = await res.json();
      if (!res.ok) {
        if (isInitial) { setError(body.error || "Couldn't load"); setLoading(false); }
        return;
      }
      const nextBriefs: Brief[] = body.briefs || [];

      // Toast on new external activity between polls
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
          newToasts.forEach(t => setTimeout(() => {
            setToasts(ts => ts.filter(x => x.id !== t.id));
          }, 6000));
        }
      }
      const snap: Record<string, string> = {};
      for (const b of nextBriefs) snap[b.id] = b.last_activity_at || "";
      prevActivityRef.current = snap;

      setData(body);
    } catch {
      if (isInitial) setError("Connection error");
    }
    if (isInitial) setLoading(false);
  }

  useEffect(() => {
    fetchPortal(true);
    const interval = setInterval(() => fetchPortal(false), 15000);
    return () => clearInterval(interval);
  }, [params.token]);

  if (loading) return <CenterMsg msg="Loading…" />;
  if (error) return <CenterMsg msg={error} err />;
  if (!data) return <CenterMsg msg="Nothing here" />;

  const briefs = data.briefs;
  const withBucket = briefs.map(b => ({ b, meta: clientStateFor(b) }));
  // One number that matters: how many items need you?
  const unreadCount = briefs.filter(b => b.has_unread_external).length;
  // Filter is either "all" or "unread" — driven by clicking the counter.
  const filtered = filter === "unread"
    ? withBucket.filter(x => x.b.has_unread_external)
    : withBucket;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      {/* Toast stack — new activity from 15s polling */}
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
        {toasts.map(t => {
          const b = data.briefs.find(x => x.id === t.briefId);
          return (
            <div key={t.id}
              onClick={() => { if (b) setOpenBrief(b); setToasts(ts => ts.filter(x => x.id !== t.id)); }}
              style={{ background: C.card, border: `2px solid ${C.red}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,0.12)" }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: C.red, letterSpacing: "0.08em", marginBottom: 3 }}>NEW</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>{t.title}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{t.preview}</div>
            </div>
          );
        })}
      </div>

      {/* Top bar */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "14px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>House Party Distro</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{data.client.name} · Design Studio</div>
          </div>
          <button onClick={() => setShowNew(true)}
            style={{ padding: "9px 18px", background: C.text, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font, whiteSpace: "nowrap" }}>
            + New Request
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 60px" }}>
        {/* Unread counter — clickable to filter. "All caught up" is static. */}
        <div style={{ marginBottom: 18, display: "flex", alignItems: "baseline", gap: 12 }}>
          {unreadCount > 0 ? (
            <button onClick={() => setFilter(filter === "unread" ? "all" : "unread")}
              style={{ background: filter === "unread" ? C.red : "transparent", color: filter === "unread" ? "#fff" : C.red, border: `1px solid ${C.red}`, borderRadius: 6, padding: "6px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}>
              {unreadCount} new update{unreadCount === 1 ? "" : "s"}{filter === "unread" ? " · showing" : " · tap to filter"}
            </button>
          ) : (
            <span style={{ fontSize: 14, color: C.muted, fontWeight: 700 }}>All caught up.</span>
          )}
          {filter === "unread" && (
            <button onClick={() => setFilter("all")}
              style={{ background: "transparent", color: C.muted, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font, textDecoration: "underline" }}>
              Show all
            </button>
          )}
        </div>

        {/* Tile grid */}
        {filtered.length === 0 ? (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 50, textAlign: "center", color: C.muted, fontSize: 13 }}>
            {briefs.length === 0
              ? "No active design requests yet. HPD will send you a link when one is ready."
              : "Nothing in this bucket."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {filtered.map(({ b, meta }) => <BriefTile key={b.id} brief={b} meta={meta} token={params.token} onOpen={() => setOpenBrief(b)} />)}
          </div>
        )}
      </div>

      {openBrief && (
        <BriefDetailModal
          token={params.token}
          brief={openBrief}
          meta={clientStateFor(openBrief)}
          onClose={() => { setOpenBrief(null); loadPortal(); }}
        />
      )}

      {showNew && (
        <NewRequestModal
          token={params.token}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); loadPortal(); }}
        />
      )}
    </div>
  );

  async function loadPortal() { fetchPortal(false); }
}

// 4-up mosaic — matches OpsHub Art Studio + designer portal tile pattern.
function TileMosaic({ thumbs, total }: { thumbs: Thumb[]; total: number }) {
  const count = Math.min(thumbs.length, 4);
  const overflow = Math.max(0, total - 4);
  if (count === 0) {
    return (
      <div style={{ width: "100%", height: "100%", background: "#f4f4f7", display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
        No preview yet
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
        const src = t.drive_file_id ? `/api/files/thumbnail?id=${t.drive_file_id}&thumb=1` : null;
        return (
          <div key={i} style={{
            position: "relative", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", padding: 6,
            ...(spanLeft ? { gridRow: "1 / span 2" } : {}),
          }}>
            {src && (
              <img src={src} alt="" loading="lazy"
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

function BriefTile({ brief, meta, token, onOpen }: { brief: Brief; meta: ReturnType<typeof clientStateFor>; token: string; onOpen: () => void }) {
  const due = daysUntil(brief.deadline);

  const content = (
    <div style={{
      background: C.card,
      border: brief.has_unread_external ? `2px solid ${C.red}` : `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: "hidden", display: "flex", flexDirection: "column",
      cursor: "pointer",
      transition: "border-color 0.15s, box-shadow 0.15s",
      position: "relative",
    }}
    onMouseEnter={(e: any) => { e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
    onMouseLeave={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}>

      {/* NEW flag — Option C */}
      {brief.has_unread_external && (
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 2,
          padding: "4px 12px", borderRadius: 4,
          background: C.red, color: "#fff",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
          boxShadow: "0 2px 8px rgba(255, 50, 77, 0.35)",
        }}>NEW</div>
      )}

      <div style={{ aspectRatio: "1", position: "relative", overflow: "hidden" }}>
        <TileMosaic thumbs={brief.thumbs || []} total={brief.thumb_total ?? (brief.thumbs?.length || 0)} />
        <div title={meta.label}
          style={{ position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: 99, background: meta.color, boxShadow: "0 0 0 2px #fff", zIndex: 2 }} />
      </div>

      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: brief.has_unread_external ? 800 : 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {brief.title || "Untitled design"}
        </div>
        <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 6, alignItems: "center" }}>
          {brief.job_title && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{brief.job_title}</span>}
          {due && <><span style={{ color: C.faint }}>·</span><span style={{ color: due.color, fontWeight: 600 }}>{due.text}</span></>}
        </div>
        {brief.preview_line && (
          <div style={{ fontSize: 11, fontWeight: 700, color: brief.has_unread_external ? C.red : C.muted, marginTop: 6 }}>
            {brief.preview_line}
          </div>
        )}
      </div>
    </div>
  );

  return <div onClick={onOpen}>{content}</div>;
}

type DetailFile = {
  id: string; file_name: string; drive_link: string | null; drive_file_id: string | null;
  kind: string; version: number;
  hpd_annotation: string | null; client_annotation: string | null; designer_annotation: string | null;
  uploader_role: string; created_at: string;
};
type DetailMessage = {
  id: string; sender_role: string; sender_name: string | null; message: string; created_at: string;
};
type DetailData = {
  brief: any;
  client: { name: string };
  files: DetailFile[];
  messages: DetailMessage[];
};

// Same kind-badge vocabulary as designer portal + Art Studio modal — the
// three surfaces share this visual language so everyone's pointing at the
// same thing when they say "the WIP" or "the first draft".
const KIND_META: Record<string, { short: string; bg: string; fg: string }> = {
  final:       { short: "FINAL", bg: C.green,  fg: "#fff" },
  revision:    { short: "REV",   bg: C.amber,  fg: "#fff" },
  first_draft: { short: "1ST",   bg: C.blue,   fg: "#fff" },
  wip:         { short: "WIP",   bg: C.accent, fg: "#fff" },
  reference:   { short: "REF",   bg: C.purple, fg: "#fff" },
  client_intake: { short: "INTK", bg: C.purpleBg, fg: C.purple },
  print_ready: { short: "PRINT", bg: C.green, fg: "#fff" },
};

// Auto-bullet helper — same behavior as HPD + designer surfaces.
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

// Plain-English "what's happening" for the client, keyed by brief state.
// Keeps them oriented without needing to interpret status chips.
function clientNextStep(state: string): { text: string; tone: "info" | "action" | "done" } | null {
  if (state === "draft" || state === "sent") {
    return { text: "Your designer is getting started. First look coming soon.", tone: "info" };
  }
  if (state === "in_progress" || state === "wip_review") {
    return { text: "Designer is exploring directions. First draft on the way.", tone: "info" };
  }
  if (state === "client_review") {
    return { text: "Your designer shared a draft — review it below and approve or request changes.", tone: "action" };
  }
  if (state === "revisions") {
    return { text: "Your designer is working on your revisions. Updated version coming.", tone: "info" };
  }
  if (state === "final_approved" || state === "pending_prep" || state === "production_ready") {
    return { text: "Your design is approved! HPD is prepping the production file.", tone: "done" };
  }
  if (state === "delivered") {
    return { text: "Complete. Thanks for working with us.", tone: "done" };
  }
  return null;
}

function pickClientHero(state: string, files: DetailFile[]): DetailFile | null {
  if (!files.length) return null;
  const pref: Record<string, string[]> = {
    client_review: ["first_draft", "revision", "wip"],
    revisions: ["revision", "first_draft", "wip"],
    final_approved: ["final", "revision", "first_draft"],
    pending_prep: ["final"],
    production_ready: ["print_ready", "final"],
    delivered: ["final"],
  };
  const order = pref[state] || ["final", "revision", "first_draft", "wip", "reference"];
  for (const kind of order) {
    const hit = files.filter(f => f.kind === kind).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
    if (hit) return hit;
  }
  return [...files].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null;
}

function BriefDetailModal({ token, brief, meta, onClose }: {
  token: string;
  brief: Brief;
  meta: ReturnType<typeof clientStateFor>;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [clientNote, setClientNote] = useState("");
  const [clientNoteSaved, setClientNoteSaved] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => { load(); }, [brief.id]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/client/${token}/briefs/${brief.id}`);
      const data = await res.json();
      if (res.ok) setDetail(data);
    } catch {}
    setLoading(false);
  }

  const [actionPending, setActionPending] = useState<string | null>(null);
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");

  async function runAction(action: "approve" | "request_changes" | "abort", note?: string, fileId?: string) {
    setActionPending(action);
    try {
      const res = await fetch(`/api/portal/client/${token}/briefs/${brief.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note, fileId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `${action} failed`);
      } else {
        setShowRevisionInput(false);
        setRevisionNote("");
        if (action === "abort") {
          // Brief is gone from client view — close modal and reload list
          onClose();
        } else {
          await load();
        }
      }
    } finally {
      setActionPending(null);
    }
  }

  function confirmAbort() {
    if (!window.confirm("Abort this design request? It'll be removed from your view. HPD can still access it for 60 days in case anything needs to be repurposed.")) return;
    runAction("abort");
  }

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (uploadNote.trim()) fd.append("note", uploadNote.trim());
      await fetch(`/api/portal/client/${token}/briefs/${brief.id}/files`, {
        method: "POST",
        body: fd,
      });
      setUploadNote("");
      await load();
    } catch {}
    setUploading(false);
  }

  async function saveClientNote(fileId: string, note: string) {
    if (note === clientNoteSaved) return;
    try {
      await fetch(`/api/portal/client/${token}/briefs/${brief.id}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, client_annotation: note }),
      });
      setClientNoteSaved(note);
      // Keep local state in sync so clicking away and back shows the latest
      // saved value — without this the old value from the initial load wins
      // the next time the effect below fires.
      setDetail(d => d ? {
        ...d,
        files: d.files.map(f => f.id === fileId ? { ...f, client_annotation: note || null } : f),
      } : d);
    } catch {}
  }

  const allFiles = detail?.files || [];

  // Hero = latest file for the brief's current phase. Strip = creative work
  // first (final → revision → 1st → WIP), then client references at the end.
  const hero = (heroId && allFiles.find(f => f.id === heroId)) || pickClientHero(brief.state, allFiles);
  const stripFiles = [
    ...allFiles.filter(f => f.kind !== "reference").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    ...allFiles.filter(f => f.kind === "reference").sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")),
  ];
  const heroMeta = hero ? KIND_META[hero.kind] : null;

  // When hero changes, load the client's saved note for this file
  useEffect(() => {
    const saved = hero?.client_annotation || "";
    setClientNote(saved);
    setClientNoteSaved(saved);
  }, [hero?.id, hero?.client_annotation]);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 14, maxWidth: 1180, width: "100%", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {brief.title || "Untitled design"}
              </div>
              <span style={{ padding: "3px 8px", borderRadius: 4, background: meta.bg, color: meta.color, fontSize: 9, fontWeight: 700, border: `1px solid ${meta.border}`, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {meta.label}
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {brief.job_title && <>{brief.job_title}</>}
              {brief.deadline && <> · Due {new Date(brief.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</>}
            </div>
          </div>
          <button onClick={confirmAbort} disabled={!!actionPending}
            title="Remove this request — HPD still sees it for 60 days"
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 600, cursor: "pointer", padding: "4px 10px", borderRadius: 5, fontFamily: C.font }}>
            Abort request
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
        </div>

        {/* What's next — tells client what's happening + what they owe */}
        {(() => {
          const next = clientNextStep(brief.state);
          if (!next) return null;
          return (
            <div style={{ padding: "10px 22px", background: next.tone === "action" ? C.amberBg : next.tone === "done" ? C.greenBg : C.blueBg, borderBottom: `1px solid ${next.tone === "action" ? C.amberBorder : next.tone === "done" ? C.greenBorder : C.blueBorder}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ flex: 1, fontSize: 12, color: next.tone === "action" ? C.amber : next.tone === "done" ? C.green : C.blue, fontWeight: 600 }}>
                {next.text}
              </div>
            </div>
          );
        })()}

        {/* Main body — hero + strip on left, brief info on right */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 320px", minHeight: 0, overflow: "hidden" }}>
          {/* LEFT — hero + strip + reference upload */}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
            {/* Hero — doubles as the reference drop target */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) uploadFile(f);
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
              }}>
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
                      {heroMeta.short}{hero.version > 1 ? ` · v${hero.version}` : ""}
                    </div>
                  )}
                  {hero.file_name && (
                    <div style={{ position: "absolute", bottom: 12, left: 12, padding: "3px 9px", borderRadius: 4, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 10, fontFamily: C.mono }}>
                      {hero.file_name}
                    </div>
                  )}
                  {dragOver && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(45,122,143,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 16, fontWeight: 700 }}>
                      Drop to add reference
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: "center", color: C.faint, fontSize: 13 }}>
                  {dragOver
                    ? <span style={{ color: C.blue, fontWeight: 700 }}>Drop to add reference</span>
                    : <>
                        <div style={{ fontSize: 36, marginBottom: 8, color: C.faint }}>↑</div>
                        <div>Drop a reference image, or use <strong>+ Add reference</strong> below.</div>
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
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ padding: "5px 12px", background: C.text, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                  {uploading ? "Uploading…" : "+ Add reference"}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              </div>
              {/* Optional note attached to the next reference upload */}
              <textarea value={uploadNote} onChange={e => setUploadNote(e.target.value)}
                {...bulletHandlers(uploadNote, setUploadNote)}
                placeholder="• Note for the next reference (optional)"
                rows={2}
                style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: C.font, outline: "none", background: C.card, resize: "vertical", boxSizing: "border-box", marginBottom: 8 }} />

              {stripFiles.length > 0 ? (
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
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
                <div style={{ fontSize: 11, color: C.faint, fontStyle: "italic" }}>
                  {loading ? "Loading…" : "No images yet — drop a reference or click + Add reference."}
                </div>
              )}

              {/* Approve / Request-changes CTAs — scoped to the current hero
                  when brief is awaiting client review. Request-changes
                  writes the note directly to the hero file's client note. */}
              {brief.state === "client_review" && hero && (hero.kind === "first_draft" || hero.kind === "revision") && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                  {!showRevisionInput ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => runAction("approve")} disabled={!!actionPending}
                        style={{ flex: 1, padding: "10px 14px", background: C.green, color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: actionPending ? "wait" : "pointer", fontFamily: C.font, opacity: actionPending ? 0.7 : 1 }}>
                        {actionPending === "approve" ? "Approving…" : "✓ Approve this design"}
                      </button>
                      <button onClick={() => { setShowRevisionInput(true); setRevisionNote(clientNote); }} disabled={!!actionPending}
                        style={{ flex: 1, padding: "10px 14px", background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}>
                        Request changes
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        What would you like changed?
                      </div>
                      <textarea value={revisionNote} onChange={e => setRevisionNote(e.target.value)}
                        {...bulletHandlers(revisionNote, setRevisionNote)}
                        placeholder="• Bolder serif   • Warmer tone"
                        rows={3}
                        style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.amberBorder}`, borderRadius: 6, fontSize: 12, fontFamily: C.font, outline: "none", background: C.card, resize: "vertical", boxSizing: "border-box" }} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => { setShowRevisionInput(false); setRevisionNote(""); }} disabled={!!actionPending}
                          style={{ padding: "6px 12px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                          Cancel
                        </button>
                        <button onClick={() => runAction("request_changes", revisionNote, hero.id)} disabled={!!actionPending || !revisionNote.trim()}
                          style={{ flex: 1, padding: "6px 14px", background: C.amber, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: actionPending ? "wait" : "pointer", fontFamily: C.font, opacity: actionPending || !revisionNote.trim() ? 0.5 : 1 }}>
                          {actionPending === "request_changes" ? "Sending…" : "Send revision request"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Brief (compact top) + Notes (fills remaining space) */}
          <div style={{ display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.border}`, background: C.card, minHeight: 0, overflow: "hidden" }}>
            {/* Brief — compact, scrolls if long */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0, maxHeight: "40%", overflowY: "auto", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Brief
              </div>
              {detail?.brief?.concept ? (
                <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", color: C.text }}>{detail.brief.concept}</div>
              ) : !loading ? (
                <div style={{ fontSize: 12, color: C.faint, fontStyle: "italic" }}>HPD hasn't written a brief yet.</div>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                {(detail?.brief as any)?.placement && <div><span style={{ color: C.faint, fontWeight: 600 }}>Placement: </span>{(detail!.brief as any).placement}</div>}
                {(detail?.brief as any)?.colors && <div><span style={{ color: C.faint, fontWeight: 600 }}>Colors: </span>{(detail!.brief as any).colors}</div>}
                {(detail?.brief as any)?.mood_words?.length > 0 && (
                  <div><span style={{ color: C.faint, fontWeight: 600 }}>Mood: </span>{((detail!.brief as any).mood_words as string[]).join(" · ")}</div>
                )}
                {brief.deadline && <div><span style={{ color: C.faint, fontWeight: 600 }}>Due: </span>{new Date(brief.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</div>}
              </div>
            </div>

            {/* Notes on the current hero — conversation lives here */}
            <div style={{ padding: "14px 16px", flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Notes on this image
              </div>
              {!hero ? (
                <div style={{ fontSize: 12, color: C.faint, fontStyle: "italic" }}>Pick a file to see + add notes.</div>
              ) : (
                <>
                  {hero.designer_annotation && (
                    <div style={{ padding: "8px 12px", background: C.blueBg, border: `1px solid ${C.blueBorder}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Designer</div>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{hero.designer_annotation}</div>
                    </div>
                  )}
                  {hero.hpd_annotation && (
                    <div style={{ padding: "8px 12px", background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>HPD</div>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{hero.hpd_annotation}</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Your note</div>
                    <textarea
                      value={clientNote}
                      onChange={e => setClientNote(e.target.value)}
                      onBlur={() => saveClientNote(hero.id, clientNote)}
                      {...bulletHandlers(clientNote, setClientNote)}
                      placeholder={hero.kind === "reference" ? "• love the color palette" : "• thoughts on this image"}
                      rows={4}
                      style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.purpleBorder}`, borderRadius: 6, fontSize: 12, fontFamily: C.font, outline: "none", background: C.purpleBg, color: C.text, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
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


type StagedFile = { id: string; file: File; previewUrl: string | null; status: "queued" | "uploading" | "done" | "error"; errorMsg?: string };

function NewRequestModal({ token, onClose, onCreated }: {
  token: string; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, submitting]);

  function addFiles(list: File[]) {
    if (!list.length) return;
    const staged = list.map(f => ({
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      file: f,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      status: "queued" as const,
    }));
    setFiles(prev => [...prev, ...staged]);
  }
  function removeFile(id: string) {
    setFiles(prev => {
      const match = prev.find(f => f.id === id);
      if (match?.previewUrl) URL.revokeObjectURL(match.previewUrl);
      return prev.filter(f => f.id !== id);
    });
  }
  useEffect(() => () => files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl)), []); // eslint-disable-line

  async function submit() {
    if (submitting || files.length === 0) return;
    setSubmitting(true);
    setErrorMsg(null);
    const briefRes = await fetch(`/api/portal/client/${token}/briefs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() || null, concept: description.trim() || null }),
    });
    const briefData = await briefRes.json();
    if (!briefRes.ok || !briefData.brief) {
      setErrorMsg(briefData.error || "Couldn't create the request");
      setSubmitting(false);
      return;
    }
    const brief = briefData.brief;
    setProgress({ current: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "uploading" } : x));
      try {
        const fd = new FormData();
        fd.append("file", f.file);
        const res = await fetch(`/api/portal/client/${token}/briefs/${brief.id}/files`, { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "error", errorMsg: err.error || "Upload failed" } : x));
        } else {
          setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "done" } : x));
        }
      } catch (e: any) {
        setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "error", errorMsg: e.message } : x));
      }
      setProgress({ current: i + 1, total: files.length });
    }
    setSubmitting(false);
    onCreated();
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files || [])); }}
        style={{
          background: C.card, border: `2px solid ${dragOver ? C.text : C.border}`,
          borderRadius: 14, width: "min(900px, 96vw)", height: "min(820px, 92vh)",
          display: "flex", flexDirection: "column", overflow: "hidden", transition: "border-color 0.1s",
        }}>
        <div style={{ padding: "14px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>New Request</div>
          <button onClick={onClose} disabled={submitting}
            style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: submitting ? "not-allowed" : "pointer", padding: "0 4px" }}>×</button>
        </div>

        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${C.border}`, background: C.surface }}>
          <input value={title} onChange={e => setTitle(e.target.value)} disabled={submitting}
            placeholder="Working title (optional)"
            style={{ width: "100%", padding: "9px 12px", fontSize: 13, borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text, outline: "none", fontFamily: C.font, boxSizing: "border-box" }} />
        </div>

        <div style={{ padding: "10px 22px", borderBottom: `1px solid ${C.border}`, background: C.surface }}>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onFocus={e => {
              if (!e.target.value) {
                setDescription("• ");
                setTimeout(() => { (e.target as HTMLTextAreaElement).setSelectionRange(2, 2); }, 0);
              }
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const target = e.target as HTMLTextAreaElement;
                const pos = target.selectionStart;
                const before = description.slice(0, pos);
                const after = description.slice(pos);
                const insert = "\n• ";
                setDescription(before + insert + after);
                setTimeout(() => target.setSelectionRange(pos + insert.length, pos + insert.length), 0);
              }
            }}
            disabled={submitting} rows={3}
            placeholder="Notes (optional) — one bullet per line"
            style={{ width: "100%", padding: "8px 12px", fontSize: 12, borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text, outline: "none", fontFamily: C.font, resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }}
          />
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 20, background: dragOver ? "rgba(26, 26, 26, 0.05)" : "transparent" }}>
          {files.length === 0 ? (
            <div onClick={() => !submitting && inputRef.current?.click()}
              style={{
                minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                color: C.muted, fontSize: 13, cursor: submitting ? "default" : "pointer",
                border: `2px dashed ${C.border}`, borderRadius: 10, padding: 40,
              }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: C.text }}>Drop your reference images here</div>
              <div>or click to browse</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {files.map(f => (
                <div key={f.id} style={{ position: "relative", aspectRatio: "1", background: "#f4f4f7", borderRadius: 8, padding: 8, border: `1px solid ${C.border}` }}>
                  {f.previewUrl ? (
                    <img src={f.previewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff", borderRadius: 4 }} />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", fontSize: 10, color: C.muted }}>
                      {f.file.name}
                    </div>
                  )}
                  {!submitting && (
                    <button onClick={() => removeFile(f.id)}
                      style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 99, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
                  )}
                  {f.status === "uploading" && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.blue, borderRadius: 8 }}>Uploading…</div>}
                  {f.status === "done" && <div style={{ position: "absolute", top: 4, left: 4, background: C.green, color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99 }}>✓</div>}
                  {f.status === "error" && <div style={{ position: "absolute", inset: 0, background: "rgba(255, 200, 200, 0.85)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.red, borderRadius: 8, padding: 4, textAlign: "center" }}>{f.errorMsg || "Failed"}</div>}
                </div>
              ))}
              {!submitting && (
                <button onClick={() => inputRef.current?.click()}
                  style={{ aspectRatio: "1", background: "transparent", border: `2px dashed ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 20, cursor: "pointer" }}>+</button>
              )}
            </div>
          )}
          <input ref={inputRef} type="file" multiple accept="image/*"
            style={{ display: "none" }}
            onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
        </div>

        <div style={{ padding: "12px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 11, color: errorMsg ? C.red : C.muted }}>
            {errorMsg || (progress ? `Uploading ${progress.current} of ${progress.total}…` : files.length > 0 ? `${files.length} image${files.length !== 1 ? "s" : ""} attached` : "Drop images to get started")}
          </div>
          <button onClick={submit} disabled={submitting || files.length === 0}
            style={{ padding: "10px 22px", background: files.length > 0 && !submitting ? C.text : C.border, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: files.length > 0 && !submitting ? "pointer" : "not-allowed", fontFamily: C.font }}>
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
