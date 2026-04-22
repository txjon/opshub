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

const FILTERS: { key: string; label: string; buckets: string[] }[] = [
  { key: "all", label: "All", buckets: [] },
  { key: "action", label: "Needs you", buckets: ["action"] },
  { key: "progress", label: "In progress", buckets: ["progress"] },
  { key: "done", label: "Done", buckets: ["done"] },
];

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

export default function ClientPortal({ params }: { params: { token: string } }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [openBrief, setOpenBrief] = useState<Brief | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/portal/client/${params.token}`);
        const body = await res.json();
        if (!res.ok) { setError(body.error || "Couldn't load"); setLoading(false); return; }
        setData(body);
      } catch {
        setError("Connection error");
      }
      setLoading(false);
    })();
  }, [params.token]);

  if (loading) return <CenterMsg msg="Loading…" />;
  if (error) return <CenterMsg msg={error} err />;
  if (!data) return <CenterMsg msg="Nothing here" />;

  const briefs = data.briefs;
  const withBucket = briefs.map(b => ({ b, meta: clientStateFor(b) }));
  const activeBuckets = FILTERS.find(f => f.key === filter)?.buckets || [];
  const filtered = activeBuckets.length === 0 ? withBucket : withBucket.filter(x => activeBuckets.includes(x.meta.bucket));

  // Overview
  const overview = {
    total: briefs.length,
    action: withBucket.filter(x => x.meta.bucket === "action").length,
    progress: withBucket.filter(x => x.meta.bucket === "progress").length,
    done: withBucket.filter(x => x.meta.bucket === "done").length,
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
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
        {/* Overview strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          <StatCard label="Total" value={overview.total} color={C.text} />
          <StatCard label="Needs you" value={overview.action} color={overview.action > 0 ? C.amber : C.muted} />
          <StatCard label="In progress" value={overview.progress} color={overview.progress > 0 ? C.blue : C.muted} />
          <StatCard label="Done" value={overview.done} color={overview.done > 0 ? C.green : C.muted} />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {FILTERS.map(f => {
            const count = f.buckets.length === 0 ? briefs.length : withBucket.filter(x => f.buckets.includes(x.meta.bucket)).length;
            const isActive = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{
                  padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: C.font,
                  background: isActive ? C.text : C.card,
                  color: isActive ? C.card : C.muted,
                  border: `1px solid ${isActive ? C.text : C.border}`,
                }}>
                {f.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{count}</span>
              </button>
            );
          })}
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

  async function loadPortal() {
    const res = await fetch(`/api/portal/client/${params.token}`);
    const body = await res.json();
    if (res.ok) setData(body);
  }
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 9, color: C.faint, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: C.mono, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function BriefTile({ brief, meta, token, onOpen }: { brief: Brief; meta: ReturnType<typeof clientStateFor>; token: string; onOpen: () => void }) {
  const firstThumb = brief.thumbs[0]?.drive_file_id || null;
  const thumb = thumbUrl(firstThumb);
  const due = daysUntil(brief.deadline);
  // Intake pending → opens intake form. Otherwise → opens detail modal.
  const goToIntake = brief.intake_requested && !!brief.intake_token;

  const content = (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      overflow: "hidden", display: "flex", flexDirection: "column",
      cursor: "pointer",
      transition: "border-color 0.15s, box-shadow 0.15s",
    }}
    onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
    onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}>

      <div style={{ aspectRatio: "1", background: "#f4f4f7", position: "relative", overflow: "hidden", padding: 10 }}>
        {thumb ? (
          <img src={thumb} alt="" loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff", borderRadius: 4 }}
            onError={(e: any) => { e.target.style.display = "none"; }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
            No preview yet
          </div>
        )}
        {/* Small status dot, tooltip reveals label */}
        <div title={meta.label}
          style={{ position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: 99, background: meta.color, boxShadow: "0 0 0 2px #fff" }} />
        {brief.thumb_total > 1 && (
          <div style={{ position: "absolute", bottom: 14, right: 14, padding: "1px 6px", borderRadius: 3, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: C.mono }}>
            +{brief.thumb_total - 1}
          </div>
        )}
      </div>

      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {brief.title || "Untitled design"}
        </div>
        <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 6, alignItems: "center" }}>
          {brief.job_title && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{brief.job_title}</span>}
          {due && <><span style={{ color: C.faint }}>·</span><span style={{ color: due.color, fontWeight: 600 }}>{due.text}</span></>}
        </div>
      </div>
    </div>
  );

  if (goToIntake) {
    return <Link href={`/art-intake/${brief.intake_token}`} style={{ textDecoration: "none" }}>{content}</Link>;
  }
  return <div onClick={onOpen}>{content}</div>;
}

type DetailFile = {
  id: string; file_name: string; drive_link: string | null; drive_file_id: string | null;
  kind: string; version: number;
  hpd_annotation: string | null; client_annotation: string | null;
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

function FileCard({
  file, token, briefId, clientKindLabel, kindColor,
}: {
  file: DetailFile; token: string; briefId: string;
  clientKindLabel: (k: string) => string; kindColor: (k: string) => { bg: string; fg: string };
}) {
  const [note, setNote] = useState(file.client_annotation || "");
  const [savedNote, setSavedNote] = useState(file.client_annotation || "");
  const [saving, setSaving] = useState(false);
  const kc = kindColor(file.kind);
  const fullUrl = file.drive_file_id ? `/api/files/thumbnail?id=${file.drive_file_id}` : null;
  const thumb = file.drive_file_id ? `/api/files/thumbnail?id=${file.drive_file_id}&thumb=1` : null;
  const isReference = file.kind === "reference";

  async function saveAnnotation() {
    if (note === savedNote) return;
    setSaving(true);
    try {
      await fetch(`/api/portal/client/${token}/briefs/${briefId}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id, client_annotation: note }),
      });
      setSavedNote(note);
    } catch {}
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <a href={fullUrl || "#"} target="_blank" rel="noopener noreferrer"
        style={{ display: "block", background: "#000", borderRadius: "8px 8px 0 0", overflow: "hidden", border: `1px solid ${C.border}`, textDecoration: "none", position: "relative" }}>
        <div style={{ aspectRatio: "1" }}>
          {thumb && (
            <img src={thumb} alt="" loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              onError={(e: any) => { e.target.style.display = "none"; }} />
          )}
        </div>
        <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 99, background: kc.bg, color: kc.fg, fontSize: 9, fontWeight: 700, border: `1px solid ${C.border}` }}>
          {clientKindLabel(file.kind)}{file.version > 1 ? ` v${file.version}` : ""}
        </div>
      </a>
      {isReference ? (
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={saveAnnotation}
          placeholder="What do you like about this one? (optional)"
          rows={2}
          style={{
            width: "100%", padding: "6px 8px", boxSizing: "border-box",
            border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 8px 8px",
            background: saving ? C.surface : C.card, color: C.text,
            fontSize: 11, fontFamily: C.font, lineHeight: 1.4, outline: "none",
            resize: "vertical",
          }}
        />
      ) : file.hpd_annotation ? (
        <div style={{ padding: "6px 8px", border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 8px 8px", background: C.amberBg, fontSize: 11, color: C.text, lineHeight: 1.4 }}>
          {file.hpd_annotation}
        </div>
      ) : (
        <div style={{ height: 1, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 8px 8px", background: C.card }} />
      )}
    </div>
  );
}

function BriefDetailModal({ token, brief, meta, onClose }: {
  token: string;
  brief: Brief;
  meta: ReturnType<typeof clientStateFor>;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  async function sendMessage() {
    if (!msgInput.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`/api/portal/client/${token}/briefs/${brief.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msgInput.trim() }),
      });
      setMsgInput("");
      await load();
    } catch {}
    setSending(false);
  }

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await fetch(`/api/portal/client/${token}/briefs/${brief.id}/files`, {
        method: "POST",
        body: fd,
      });
      await load();
    } catch {}
    setUploading(false);
  }

  // Group files by kind for display. Client sees all kinds except hpd-internal.
  const allFiles = detail?.files || [];
  const clientKindLabel = (kind: string) => ({
    reference: "Reference",
    wip: "WIP",
    first_draft: "1st Draft",
    revision: "Revision",
    final: "Final",
    client_intake: "Intake",
  }[kind] || kind);
  const kindColor = (kind: string) => ({
    reference: { bg: C.surface, fg: C.muted },
    wip: { bg: C.blueBg, fg: C.blue },
    first_draft: { bg: C.purpleBg, fg: C.purple },
    revision: { bg: C.amberBg, fg: C.amber },
    final: { bg: C.greenBg, fg: C.green },
    client_intake: { bg: C.surface, fg: C.muted },
  }[kind] || { bg: C.surface, fg: C.muted });

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 14, maxWidth: 1100, width: "100%", maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{brief.title || "Untitled design"}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, display: "flex", gap: 8, alignItems: "center" }}>
              {brief.job_title && <span>{brief.job_title}</span>}
              {brief.deadline && <><span style={{ color: C.faint }}>·</span><span>Due {new Date(brief.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</span></>}
            </div>
          </div>
          <span style={{ padding: "4px 12px", borderRadius: 99, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 700, border: `1px solid ${meta.border}`, whiteSpace: "nowrap" }}>
            {meta.label}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 24, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
        </div>

        {/* Two-col body */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 0, flex: 1, overflow: "hidden" }}>
          {/* Left — images + notes */}
          <div style={{ overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            {detail?.brief?.concept && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Notes from HPD</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                  {detail.brief.concept}
                </div>
              </div>
            )}

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Images {allFiles.length > 0 && `(${allFiles.length})`}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ padding: "6px 12px", background: C.text, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                  {uploading ? "Uploading…" : "+ Add reference"}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              </div>

              {loading ? (
                <div style={{ color: C.faint, fontSize: 12, padding: 20, textAlign: "center" }}>Loading…</div>
              ) : allFiles.length === 0 ? (
                <div style={{ color: C.faint, fontSize: 12, padding: 20, textAlign: "center", fontStyle: "italic" }}>No images yet — add references above or ask HPD.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                  {allFiles.map(f => (
                    <FileCard key={f.id} file={f} token={token} briefId={brief.id}
                      clientKindLabel={clientKindLabel} kindColor={kindColor} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right — thread */}
          <div style={{ display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.border}`, background: C.surface }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Conversation
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {loading ? (
                <div style={{ color: C.faint, fontSize: 12 }}>Loading…</div>
              ) : (detail?.messages || []).length === 0 ? (
                <div style={{ color: C.faint, fontSize: 12, fontStyle: "italic", padding: "8px 0", textAlign: "center" }}>
                  Drop a note for the design team
                </div>
              ) : (
                detail!.messages.map(m => (
                  <div key={m.id} style={{
                    background: m.sender_role === "client" ? C.purpleBg : m.sender_role === "designer" ? C.blueBg : C.card,
                    borderRadius: 8, padding: "8px 10px", fontSize: 12,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                      <span>{m.sender_role === "client" ? "You" : m.sender_role === "designer" ? "Designer" : "HPD"}</span>
                      <span style={{ color: C.faint, fontWeight: 400, textTransform: "none" }}>{new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    </div>
                    <div style={{ lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{m.message}</div>
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}`, background: C.card, display: "flex", gap: 6 }}>
              <input value={msgInput} onChange={e => setMsgInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Type a note…"
                style={{ flex: 1, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontFamily: C.font, outline: "none" }} />
              <button onClick={sendMessage} disabled={!msgInput.trim() || sending}
                style={{ padding: "8px 14px", background: C.text, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                {sending ? "…" : "Send"}
              </button>
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
