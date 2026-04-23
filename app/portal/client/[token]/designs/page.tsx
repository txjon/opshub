"use client";
import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";
import { DriveFileLink } from "@/components/DriveFileLink";
import { useClientPortal } from "../_shared/context";
import { C, daysUntil, thumbUrl } from "../_shared/theme";
import { clientStateFor, isDoneForClient } from "../_shared/state-labels";
import type { Brief, Thumb } from "../_shared/types";

// Designs tab — the Art Studio client view, moved into the tabbed shell.
// Briefs data comes from the shell's context (shared polling + toasts).
// The ?brief=<id> query param auto-opens a brief on mount (used by toasts
// + Overview deep links).

export default function DesignsPage() {
  const { data, refetch, registerBriefOpener } = useClientPortal();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filter, setFilter] = useState<"all" | "unread" | "done">("all");
  const [openBrief, setOpenBrief] = useState<Brief | null>(null);
  const [showNew, setShowNew] = useState(false);

  // Expose a brief-opener to the context so toasts (fired from other tabs)
  // can jump here and open a specific brief. Cleared on unmount.
  useEffect(() => {
    const open = (briefId: string) => {
      const b = data?.briefs.find(x => x.id === briefId);
      if (b) setOpenBrief(b);
    };
    registerBriefOpener(open);
    return () => registerBriefOpener(null);
  }, [data, registerBriefOpener]);

  // ?brief=<id> — auto-open on navigation (from Overview feed, toasts, etc.)
  useEffect(() => {
    const briefId = searchParams?.get("brief");
    if (!briefId || !data) return;
    const b = data.briefs.find(x => x.id === briefId);
    if (b) {
      setOpenBrief(b);
      // Clear the query param so the browser URL is clean (doesn't re-open
      // on refresh if the user closed the modal).
      const params = new URLSearchParams(searchParams.toString());
      params.delete("brief");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : (pathname || ""));
    }
  }, [searchParams, data, router, pathname]);

  if (!data) return null;

  const briefs = data.briefs;
  const withBucket = briefs.map(b => ({ b, meta: clientStateFor(b) }));
  const unreadCount = briefs.filter(b => b.has_unread_external).length;
  const doneCount = briefs.filter(isDoneForClient).length;

  const filtered = filter === "unread"
    ? withBucket.filter(x => x.b.has_unread_external)
    : filter === "done"
      ? withBucket.filter(x => isDoneForClient(x.b))
      : withBucket.filter(x => !isDoneForClient(x.b));

  return (
    <div>
      {/* Filter strip + new request button */}
      <div style={{
        marginBottom: 18,
        display: "flex", alignItems: "center", gap: 10,
        flexWrap: "wrap",
      }}>
        {unreadCount > 0 ? (
          <button onClick={() => setFilter(filter === "unread" ? "all" : "unread")}
            style={{
              background: filter === "unread" ? C.red : "transparent",
              color: filter === "unread" ? "#fff" : C.red,
              border: `1px solid ${C.red}`, borderRadius: 6,
              padding: "8px 14px", minHeight: 40,
              fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
            }}>
            {unreadCount} new update{unreadCount === 1 ? "" : "s"}
            {filter === "unread" ? " · showing" : " · tap to filter"}
          </button>
        ) : (
          <span style={{ fontSize: 14, color: C.muted, fontWeight: 700 }}>All caught up.</span>
        )}
        {filter !== "all" && (
          <button onClick={() => setFilter("all")}
            style={{
              background: "transparent", color: C.muted,
              border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
              fontFamily: C.font, textDecoration: "underline",
            }}>
            Show active
          </button>
        )}
        {doneCount > 0 && filter !== "done" && (
          <button onClick={() => setFilter("done")}
            style={{
              background: "transparent", color: C.muted,
              border: `1px solid ${C.border}`, borderRadius: 6,
              padding: "8px 12px", minHeight: 40,
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
            }}>
            Done · {doneCount}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowNew(true)}
          style={{
            padding: "10px 18px", minHeight: 44,
            background: C.text, color: "#fff",
            border: "none", borderRadius: 8,
            fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
            whiteSpace: "nowrap",
          }}>
          + New design request
        </button>
      </div>

      {/* Tile grid */}
      {filtered.length === 0 ? (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 50, textAlign: "center",
          color: C.muted, fontSize: 13,
        }}>
          {briefs.length === 0
            ? "No active design requests yet. HPD will send you a link when one is ready."
            : "Nothing in this bucket."}
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))",
          gap: 14,
        }}>
          {filtered.map(({ b, meta }) => (
            <BriefTile key={b.id} brief={b} meta={meta} onOpen={() => setOpenBrief(b)} />
          ))}
        </div>
      )}

      {openBrief && (
        <BriefDetailModal
          token={data ? (searchParams?.get("_t") || "") : ""}
          brief={openBrief}
          meta={clientStateFor(openBrief)}
          onClose={() => { setOpenBrief(null); refetch(); }}
        />
      )}

      {showNew && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refetch(); }}
        />
      )}
    </div>
  );
}

// ── Tile ──────────────────────────────────────────────────────────────
function TileMosaic({ thumbs, total }: { thumbs: Thumb[]; total: number }) {
  const count = Math.min(thumbs.length, 4);
  const overflow = Math.max(0, total - 4);
  if (count === 0) {
    return (
      <div style={{
        width: "100%", height: "100%", background: "#f4f4f7",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: C.faint, fontSize: 12,
      }}>
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
              <div style={{
                position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 14, fontWeight: 700,
              }}>
                +{overflow}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BriefTile({ brief, meta, onOpen }: {
  brief: Brief;
  meta: ReturnType<typeof clientStateFor>;
  onOpen: () => void;
}) {
  const due = daysUntil(brief.deadline);
  return (
    <div onClick={onOpen}
      style={{
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
          style={{
            position: "absolute", top: 10, right: 10,
            width: 10, height: 10, borderRadius: 99,
            background: meta.color, boxShadow: "0 0 0 2px #fff", zIndex: 2,
          }} />
      </div>
      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{
          fontSize: 14, fontWeight: brief.has_unread_external ? 800 : 700,
          color: C.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {brief.title || "Untitled design"}
        </div>
        <div style={{
          fontSize: 11, color: C.muted,
          display: "flex", gap: 6, alignItems: "center",
        }}>
          {brief.job_title && (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {brief.job_title}
            </span>
          )}
          {due && <><span style={{ color: C.faint }}>·</span><span style={{ color: due.color, fontWeight: 600 }}>{due.text}</span></>}
        </div>
        {brief.preview_line && (
          <div style={{
            fontSize: 11, fontWeight: 700,
            color: brief.has_unread_external ? C.red : C.muted,
            marginTop: 6,
          }}>
            {brief.preview_line}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────
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

const KIND_META: Record<string, { short: string; bg: string; fg: string }> = {
  final:       { short: "FINAL", bg: C.green,  fg: "#fff" },
  revision:    { short: "REV",   bg: C.amber,  fg: "#fff" },
  first_draft: { short: "1ST",   bg: C.blue,   fg: "#fff" },
  wip:         { short: "WIP",   bg: C.accent, fg: "#fff" },
  reference:   { short: "REF",   bg: C.purple, fg: "#fff" },
  client_intake: { short: "INTK", bg: C.purpleBg, fg: C.purple },
  print_ready: { short: "PRINT", bg: C.green, fg: "#fff" },
};

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
  const { token: ctxToken } = useClientPortal();
  const tk = token || ctxToken;
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

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief.id]);

  async function load(initial: boolean = false) {
    if (initial) setLoading(true);
    try {
      const res = await fetch(`/api/portal/client/${tk}/briefs/${brief.id}`);
      const data = await res.json();
      if (res.ok) setDetail(data);
    } catch {}
    if (initial) setLoading(false);
  }

  const [actionPending, setActionPending] = useState<string | null>(null);
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");

  async function runAction(action: "approve" | "request_changes" | "abort", note?: string, fileId?: string) {
    setActionPending(action);
    try {
      const res = await fetch(`/api/portal/client/${tk}/briefs/${brief.id}/action`, {
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
    const noteForBatch = uploadNote.trim();
    try {
      const sessionRes = await fetch(`/api/portal/client/${tk}/briefs/${brief.id}/upload-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
        }),
      });
      if (!sessionRes.ok) throw new Error("Could not start upload");
      const { uploadUrl } = await sessionRes.json();

      const { drive_file_id } = await uploadFileToDriveSession(uploadUrl, file);

      await fetch(`/api/portal/client/${tk}/briefs/${brief.id}/upload-session/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drive_file_id,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
          note: noteForBatch || null,
        }),
      });
      setUploadNote("");
      await load();
    } catch (e: any) {
      alert(`Upload failed: ${e.message || "unknown error"}`);
    }
    setUploading(false);
  }

  async function saveClientNote(fileId: string, note: string) {
    if (note === clientNoteSaved) return;
    try {
      await fetch(`/api/portal/client/${tk}/briefs/${brief.id}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, client_annotation: note }),
      });
      setClientNoteSaved(note);
      setDetail(d => d ? {
        ...d,
        files: d.files.map(f => f.id === fileId ? { ...f, client_annotation: note || null } : f),
      } : d);
    } catch {}
  }

  const allFiles = detail?.files || [];
  const hero = (heroId && allFiles.find(f => f.id === heroId)) || pickClientHero(brief.state, allFiles);
  const stripFiles = [
    ...allFiles.filter(f => f.kind !== "reference").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    ...allFiles.filter(f => f.kind === "reference").sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")),
  ];
  const heroMeta = hero ? KIND_META[hero.kind] : null;

  useEffect(() => {
    const saved = hero?.client_annotation || "";
    setClientNote(saved);
    setClientNoteSaved(saved);
  }, [hero?.id, hero?.client_annotation]);

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "clamp(8px, 2vw, 24px)",
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 14,
          maxWidth: 1180, width: "100%", maxHeight: "94vh",
          overflow: "hidden", display: "flex", flexDirection: "column",
        }}>
        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, fontWeight: 600, cursor: "pointer", padding: "6px 10px", borderRadius: 5, fontFamily: C.font, minHeight: 32 }}>
            Abort
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
        </div>

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

        {/* Body — on desktop: hero+strip left, brief+notes right. On mobile: stacked. */}
        <div className="brief-modal-body" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <style>{`
            .brief-modal-body { display: grid; grid-template-columns: 1fr 320px; }
            @media (max-width: 768px) {
              .brief-modal-body { grid-template-columns: 1fr !important; overflow-y: auto; }
              .brief-modal-hero { height: clamp(260px, 50vh, 440px) !important; }
              .brief-modal-right { border-left: none !important; border-top: 1px solid ${C.border}; max-height: none !important; }
            }
          `}</style>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
            <div className="brief-modal-hero"
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) uploadFile(f);
              }}
              style={{
                height: "clamp(380px, 55vh, 680px)",
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
                  <DriveFileLink driveFileId={hero.drive_file_id} fileName={hero.file_name} mimeType={(hero as any).mime_type}
                    style={{ display: "block", width: "100%", height: "100%" }}>
                    <img
                      src={hero.drive_file_id ? `https://drive.google.com/thumbnail?id=${hero.drive_file_id}&sz=w1600` : ""}
                      referrerPolicy="no-referrer"
                      alt=""
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                      onError={(e: any) => { e.target.style.display = "none"; }}
                    />
                  </DriveFileLink>
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

            <div style={{ background: C.surface, borderTop: `1px solid ${C.border}`, padding: "10px 14px", flex: 1, overflowY: "auto", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Files {stripFiles.length > 0 && <span style={{ fontWeight: 400, color: C.faint }}>· {stripFiles.length}</span>}
                </div>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ padding: "7px 12px", background: C.text, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: C.font, minHeight: 32 }}>
                  {uploading ? "Uploading…" : "+ Add reference"}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              </div>
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

              {brief.state === "client_review" && hero && (hero.kind === "first_draft" || hero.kind === "revision") && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                  {!showRevisionInput ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => runAction("approve")} disabled={!!actionPending}
                        style={{ flex: "1 1 160px", padding: "12px 14px", background: C.green, color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: actionPending ? "wait" : "pointer", fontFamily: C.font, opacity: actionPending ? 0.7 : 1, minHeight: 44 }}>
                        {actionPending === "approve" ? "Approving…" : "✓ Approve this design"}
                      </button>
                      <button onClick={() => { setShowRevisionInput(true); setRevisionNote(clientNote); }} disabled={!!actionPending}
                        style={{ flex: "1 1 160px", padding: "12px 14px", background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font, minHeight: 44 }}>
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
                          style={{ padding: "8px 12px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: C.font, minHeight: 36 }}>
                          Cancel
                        </button>
                        <button onClick={() => runAction("request_changes", revisionNote, hero.id)} disabled={!!actionPending || !revisionNote.trim()}
                          style={{ flex: 1, padding: "8px 14px", background: C.amber, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: actionPending ? "wait" : "pointer", fontFamily: C.font, opacity: actionPending || !revisionNote.trim() ? 0.5 : 1, minHeight: 36 }}>
                          {actionPending === "request_changes" ? "Sending…" : "Send revision request"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="brief-modal-right" style={{ display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.border}`, background: C.card, minHeight: 0, overflow: "hidden" }}>
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

// ── New-request modal ─────────────────────────────────────────────────
type StagedFile = { id: string; file: File; previewUrl: string | null; status: "queued" | "uploading" | "done" | "error"; errorMsg?: string };

function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token } = useClientPortal();
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
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(8px, 2vw, 24px)" }}>
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
            style={{ width: "100%", padding: "11px 12px", fontSize: 13, borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text, outline: "none", fontFamily: C.font, boxSizing: "border-box", minHeight: 40 }} />
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
            style={{ width: "100%", padding: "10px 12px", fontSize: 12, borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text, outline: "none", fontFamily: C.font, resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }}
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
                      style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 99, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
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

        <div style={{ padding: "12px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: errorMsg ? C.red : C.muted }}>
            {errorMsg || (progress ? `Uploading ${progress.current} of ${progress.total}…` : files.length > 0 ? `${files.length} image${files.length !== 1 ? "s" : ""} attached` : "Drop images to get started")}
          </div>
          <button onClick={submit} disabled={submitting || files.length === 0}
            style={{ padding: "12px 22px", background: files.length > 0 && !submitting ? C.text : C.border, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: files.length > 0 && !submitting ? "pointer" : "not-allowed", fontFamily: C.font, minHeight: 44 }}>
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
