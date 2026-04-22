"use client";
import { useState, useEffect, useRef } from "react";

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

type Brief = {
  id: string; title: string | null; state: string; deadline: string | null;
  concept: string | null; placement: string | null; colors: string | null;
  mood_words: string[]; sent_to_designer_at: string | null; updated_at: string;
  version_count: number; clients?: { name: string } | null;
  latest_thumb: { drive_file_id: string; drive_link: string; kind: string } | null;
  file_counts: { wip: number; first_draft: number; revision: number; final: number; reference: number };
};
type BriefFile = {
  id: string; file_name: string; drive_link: string | null; drive_file_id: string | null;
  kind: string; version: number; hpd_annotation: string | null; client_annotation: string | null; uploader_role: string; created_at: string;
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

// ── Filter pill buckets ──
const FILTERS: { key: string; label: string; states: string[] }[] = [
  { key: "all",     label: "All",              states: [] },
  { key: "action",  label: "Action needed",    states: ["sent", "revisions"] },
  { key: "progress",label: "In progress",      states: ["in_progress"] },
  { key: "review",  label: "Awaiting review",  states: ["wip_review", "client_review"] },
  { key: "done",    label: "Done",             states: ["final_approved", "pending_prep", "production_ready", "delivered"] },
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

// Proxied via /api/files/thumbnail?thumb=1 — returns Drive's pre-sized
// thumbnailLink (small, fast) instead of the full file, cached 24h.
const thumbUrl = (id: string | null | undefined) => id ? `/api/files/thumbnail?id=${id}&thumb=1` : null;

export default function DesignerPortal({ params }: { params: { token: string } }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [designer, setDesigner] = useState<{ name: string } | null>(null);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => { loadDashboard(); }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const res = await fetch(`/api/design/${params.token}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not load"); setLoading(false); return; }
      setDesigner(data.designer);
      setBriefs(data.briefs || []);
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  }

  if (loading) return <CenterMsg msg="Loading…" />;
  if (error) return <CenterMsg msg={error} err />;

  if (selected) {
    return <BriefDetail token={params.token} briefId={selected} onBack={() => { setSelected(null); loadDashboard(); }} />;
  }

  const activeStates = FILTERS.find(f => f.key === filter)?.states || [];
  const filtered = activeStates.length === 0 ? briefs : briefs.filter(b => activeStates.includes(b.state));

  // Overview stats
  const overview = {
    total: briefs.length,
    action: briefs.filter(b => ["sent", "revisions"].includes(b.state)).length,
    progress: briefs.filter(b => b.state === "in_progress").length,
    due_soon: briefs.filter(b => {
      if (!b.deadline) return false;
      const d = Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000);
      return d >= 0 && d <= 7 && !["final_approved", "pending_prep", "production_ready", "delivered"].includes(b.state);
    }).length,
    overdue: briefs.filter(b => {
      if (!b.deadline) return false;
      const d = Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000);
      return d < 0 && !["final_approved", "pending_prep", "production_ready", "delivered"].includes(b.state);
    }).length,
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
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
        {/* Overview strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
          <StatCard label="Total" value={overview.total} color={C.text} />
          <StatCard label="Action needed" value={overview.action} color={overview.action > 0 ? C.red : C.muted} />
          <StatCard label="In progress" value={overview.progress} color={overview.progress > 0 ? C.blue : C.muted} />
          <StatCard label="Due this week" value={overview.due_soon} color={overview.due_soon > 0 ? C.amber : C.muted} />
          <StatCard label="Overdue" value={overview.overdue} color={overview.overdue > 0 ? C.red : C.muted} />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {FILTERS.map(f => {
            const count = f.states.length === 0 ? briefs.length : briefs.filter(b => f.states.includes(b.state)).length;
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
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 9, color: C.faint, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: C.mono, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function BriefCard({ brief, onOpen }: { brief: Brief; onOpen: () => void }) {
  const meta = STATE_META[brief.state] || STATE_META.draft;
  const due = daysUntil(brief.deadline);
  const thumb = thumbUrl(brief.latest_thumb?.drive_file_id);
  const kindLabel = brief.latest_thumb?.kind === "first_draft" ? "1st Draft"
    : brief.latest_thumb?.kind === "revision" ? "Revision"
    : brief.latest_thumb?.kind === "final" ? "Final"
    : brief.latest_thumb?.kind === "wip" ? "WIP"
    : null;
  const noWorkYet = !brief.latest_thumb;

  return (
    <div onClick={onOpen} style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column",
      transition: "border-color 0.15s, box-shadow 0.15s",
    }}
    onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
    onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}>

      {/* Thumb */}
      <div style={{ aspectRatio: "1", background: "#f4f4f7", position: "relative", overflow: "hidden", padding: 10 }}>
        {thumb && !noWorkYet ? (
          <img src={thumb} alt="" loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff", borderRadius: 4 }}
            onError={(e: any) => { e.target.style.display = "none"; }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
            No work yet
          </div>
        )}
        {/* Status dot */}
        <div title={meta.label}
          style={{ position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: 99, background: meta.color, boxShadow: "0 0 0 2px #fff" }} />
        {kindLabel && !noWorkYet && (
          <div style={{ position: "absolute", bottom: 14, right: 14, padding: "1px 6px", borderRadius: 3, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: C.mono }}>
            {kindLabel}{brief.latest_thumb && brief.file_counts[brief.latest_thumb.kind as keyof typeof brief.file_counts] > 1 ? ` v${brief.file_counts[brief.latest_thumb.kind as keyof typeof brief.file_counts]}` : ""}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {brief.title || "Untitled brief"}
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
function BriefDetail({ token, briefId, onBack }: { token: string; briefId: string; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<any>(null);
  const [files, setFiles] = useState<BriefFile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { load(); }, [briefId]);

  async function load() {
    const res = await fetch(`/api/design/${token}/briefs/${briefId}`);
    const data = await res.json();
    setBrief(data.brief);
    setFiles(data.files || []);
    setMessages(data.messages || []);
    setLoading(false);
  }

  async function upload(file: File, kind: "wip" | "first_draft" | "revision" | "final") {
    setUploadingKind(kind);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    await fetch(`/api/design/${token}/briefs/${briefId}/files`, { method: "POST", body: fd });
    setUploadingKind(null);
    load();
  }

  async function deleteFile(fileId: string) {
    if (!window.confirm("Delete this upload?")) return;
    await fetch(`/api/design/${token}/briefs/${briefId}/files?fileId=${fileId}`, { method: "DELETE" });
    load();
  }

  async function sendMessage() {
    if (!msgInput.trim()) return;
    setSending(true);
    await fetch(`/api/design/${token}/briefs/${briefId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msgInput.trim() }),
    });
    setMsgInput(""); setSending(false); load();
  }

  if (loading || !brief) return <CenterMsg msg="Loading…" />;

  const meta = STATE_META[brief.state] || STATE_META.draft;
  const references = files.filter(f => f.kind === "reference");
  const byKind = {
    wip: files.filter(f => f.kind === "wip").sort((a, b) => b.version - a.version),
    first_draft: files.filter(f => f.kind === "first_draft").sort((a, b) => b.version - a.version),
    revision: files.filter(f => f.kind === "revision").sort((a, b) => b.version - a.version),
    final: files.filter(f => f.kind === "final").sort((a, b) => b.version - a.version),
  };

  const panel: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 };
  const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 };

  const due = daysUntil(brief.deadline);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      {/* Top bar */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "14px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: C.muted, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: C.font }}>← Back to briefs</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 60px" }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>{brief.title || "Untitled brief"}</h1>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
              {brief.clients?.name || "Client"}
              {brief.deadline && <> · Due <strong>{new Date(brief.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</strong>{due && ` (${due.text})`}</>}
            </div>
          </div>
          <span style={{ padding: "4px 12px", borderRadius: 99, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 700, border: `1px solid ${meta.border}`, whiteSpace: "nowrap" }}>
            {meta.label}
          </span>
        </div>

        {/* Two column layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
          {/* Left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Concept */}
            <div style={panel}>
              <div style={sectionLabel}>Brief</div>
              <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: brief.placement || brief.colors ? 14 : 0 }}>
                {brief.concept || <span style={{ color: C.faint, fontStyle: "italic" }}>(no concept provided)</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12 }}>
                {brief.placement && <div><span style={{ color: C.faint, fontWeight: 600 }}>Placement: </span>{brief.placement}</div>}
                {brief.colors && <div><span style={{ color: C.faint, fontWeight: 600 }}>Colors: </span>{brief.colors}</div>}
                {brief.mood_words?.length > 0 && (
                  <div><span style={{ color: C.faint, fontWeight: 600 }}>Mood: </span>{brief.mood_words.join(" · ")}</div>
                )}
              </div>
            </div>

            {/* References */}
            {references.length > 0 && (
              <div style={panel}>
                <div style={sectionLabel}>References ({references.length})</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                  {references.map(r => (
                    <div key={r.id} style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                      <a href={r.drive_link || "#"} target="_blank" rel="noopener noreferrer">
                        <div style={{ width: "100%", aspectRatio: "1", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${C.border}` }}>
                          <img src={thumbUrl(r.drive_file_id) || ""} alt=""
                            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                            onError={(e: any) => { e.target.style.display = "none"; }} />
                        </div>
                      </a>
                      {r.client_annotation && (
                        <div style={{ padding: 8, fontSize: 11, lineHeight: 1.4, background: C.purpleBg, color: C.text, borderTop: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Client note</div>
                          {r.client_annotation}
                        </div>
                      )}
                      {r.hpd_annotation && (
                        <div style={{ padding: 8, fontSize: 11, lineHeight: 1.4, background: C.amberBg, color: C.text, borderTop: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>HPD note</div>
                          {r.hpd_annotation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Your work — 4 upload slots */}
            <div style={panel}>
              <div style={sectionLabel}>Your work</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <UploadSlot kind="wip" label="WIP" desc="Early drafts, before client sees" items={byKind.wip}
                  uploading={uploadingKind === "wip"} onUpload={f => upload(f, "wip")} onDelete={deleteFile} inputRef={el => inputRefs.current.wip = el} />
                <UploadSlot kind="first_draft" label="1st Draft" desc="First version for client review" items={byKind.first_draft}
                  uploading={uploadingKind === "first_draft"} onUpload={f => upload(f, "first_draft")} onDelete={deleteFile} inputRef={el => inputRefs.current.first_draft = el} />
                <UploadSlot kind="revision" label="Revision" desc="Updated after client feedback" items={byKind.revision}
                  uploading={uploadingKind === "revision"} onUpload={f => upload(f, "revision")} onDelete={deleteFile} inputRef={el => inputRefs.current.revision = el} />
                <UploadSlot kind="final" label="Final" desc="Production-ready asset" items={byKind.final}
                  uploading={uploadingKind === "final"} onUpload={f => upload(f, "final")} onDelete={deleteFile} inputRef={el => inputRefs.current.final = el} highlight />
              </div>
            </div>
          </div>

          {/* Right column — message thread */}
          <div style={panel}>
            <div style={sectionLabel}>Thread</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 440, overflowY: "auto", marginBottom: 12, paddingRight: 4 }}>
              {messages.length === 0 ? (
                <div style={{ color: C.faint, fontSize: 12, fontStyle: "italic", padding: "8px 0" }}>No messages yet.</div>
              ) : messages.map(m => (
                <div key={m.id} style={{
                  background: m.sender_role === "designer" ? C.blueBg : m.sender_role === "client" ? C.purpleBg : C.surface,
                  borderRadius: 8, padding: "8px 10px", fontSize: 12,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                    <span>{m.sender_role === "designer" ? "You" : m.sender_role === "client" ? "Client" : "HPD"}</span>
                    <span style={{ color: C.faint, fontWeight: 400, textTransform: "none" }}>{fmtDate(m.created_at)}</span>
                  </div>
                  <div style={{ lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{m.message}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
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

function UploadSlot({
  kind, label, desc, items, uploading, onUpload, onDelete, inputRef, highlight,
}: {
  kind: string; label: string; desc: string; items: BriefFile[];
  uploading: boolean; onUpload: (f: File) => void; onDelete: (id: string) => void;
  inputRef: (el: HTMLInputElement | null) => void; highlight?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: highlight ? C.green : C.text }}>{label}</span>
        <span style={{ fontSize: 10, color: C.muted }}>{desc}</span>
        {items.length > 0 && <span style={{ fontSize: 10, color: C.faint, marginLeft: "auto", fontFamily: C.mono }}>{items.length} version{items.length !== 1 ? "s" : ""}</span>}
      </div>
      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {items.map(w => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: C.surface, borderRadius: 6, fontSize: 12 }}>
              <span style={{ padding: "1px 6px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 9, fontWeight: 700, fontFamily: C.mono }}>v{w.version}</span>
              <a href={w.drive_link || "#"} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, color: C.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {w.file_name}
              </a>
              <span style={{ fontSize: 10, color: C.faint }}>{fmtDate(w.created_at)}</span>
              <button onClick={() => onDelete(w.id)} title="Delete"
                style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 13, padding: "0 4px" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => document.getElementById(`upload-${kind}`)?.click()} disabled={uploading}
        style={{
          padding: "8px", border: `1px dashed ${highlight ? C.green : C.border}`,
          borderRadius: 6, background: "transparent",
          color: highlight ? C.green : C.muted,
          fontSize: 12, cursor: "pointer", width: "100%", fontFamily: C.font, fontWeight: 600,
        }}>
        {uploading ? "Uploading…" : `+ Upload ${label}`}
      </button>
      <input id={`upload-${kind}`} ref={inputRef} type="file" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
    </div>
  );
}
