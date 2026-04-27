"use client";
import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";
import { DriveFileLink } from "@/components/DriveFileLink";
import { useClientPortal } from "../_shared/context";
import { C, daysUntil, thumbUrl } from "../_shared/theme";
import { clientStateFor } from "../_shared/state-labels";
import { formatFileLabel, unreadHighlightFor } from "@/lib/art-activity-text";
import { ArtReferencesGrid } from "@/components/ArtReferencesGrid";
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
  const [filter, setFilter] = useState<"all" | "pending" | "working" | "done" | "unread">("all");
  const [openBrief, setOpenBrief] = useState<Brief | null>(null);
  // True when the brief was opened from an "Approve" deep-link in an
  // email — the modal will fire window.confirm on detail load.
  const [autoApprove, setAutoApprove] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // Expose a brief-opener to the context so toasts (fired from other tabs)
  // can jump here and open a specific brief. Cleared on unmount.
  useEffect(() => {
    const open = (briefId: string) => {
      const b = data?.briefs.find(x => x.id === briefId);
      if (b) {
        setOpenBrief(b);
        setAutoApprove(false);
      }
    };
    registerBriefOpener(open);
    return () => registerBriefOpener(null);
  }, [data, registerBriefOpener]);

  // ?brief=<id> — auto-open on navigation (from Overview feed, toasts, etc.)
  // ?approve=1 — also fire approve confirm once the modal's detail loads.
  useEffect(() => {
    const briefId = searchParams?.get("brief");
    if (!briefId || !data) return;
    const b = data.briefs.find(x => x.id === briefId);
    if (b) {
      setOpenBrief(b);
      setAutoApprove(searchParams?.get("approve") === "1");
      // Clear query params so the browser URL is clean (doesn't re-open
      // / re-confirm on refresh if the user closed the modal).
      const params = new URLSearchParams(searchParams.toString());
      params.delete("brief");
      params.delete("approve");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : (pathname || ""));
    }
  }, [searchParams, data, router, pathname]);

  if (!data) return null;

  const briefs = data.briefs;
  const withBucket = briefs.map(b => ({ b, meta: clientStateFor(b) }));

  // Client lifecycle:
  //   Pending → draft / revision is up for review (client_review)
  //   Working → in design (sent through revisions)
  //   Done    → client approved (final_approved+)
  const DONE_STATES = ["final_approved", "pending_prep", "production_ready", "delivered"];
  const bucketFor = (b: Brief): "pending" | "working" | "done" => {
    if (DONE_STATES.includes(b.state)) return "done";
    // Client owes a move when a draft/revision is up for review.
    if (b.state === "client_review") return "pending";
    return "working";
  };

  const counts = {
    all: briefs.length,
    pending: briefs.filter(b => bucketFor(b) === "pending").length,
    working: briefs.filter(b => bucketFor(b) === "working").length,
    done: briefs.filter(b => bucketFor(b) === "done").length,
    unread: briefs.filter(b => b.has_unread_external).length,
  };

  const filtered = (() => {
    if (filter === "unread") return withBucket.filter(x => x.b.has_unread_external);
    if (filter === "pending") return withBucket.filter(x => bucketFor(x.b) === "pending");
    if (filter === "working") return withBucket.filter(x => bucketFor(x.b) === "working");
    if (filter === "done") return withBucket.filter(x => bucketFor(x.b) === "done");
    return withBucket;
  })();

  return (
    <div>
      {/* Filter pills + new request button */}
      <div style={{
        marginBottom: 18,
        display: "flex", alignItems: "center", gap: 6,
        flexWrap: "wrap",
      }}>
        <ClientFilterPill label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
        {counts.pending > 0 && (
          <ClientFilterPill label="Needs your input" count={counts.pending} active={filter === "pending"} onClick={() => setFilter("pending")} accent={C.amber} />
        )}
        <ClientFilterPill label="In design" count={counts.working} active={filter === "working"} onClick={() => setFilter("working")} />
        <ClientFilterPill label="Approved" count={counts.done} active={filter === "done"} onClick={() => setFilter("done")} accent={C.green} />
        {counts.unread > 0 && (
          <ClientFilterPill label="Unread" count={counts.unread} active={filter === "unread"} onClick={() => setFilter("unread")} accent={C.blue} />
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
          autoApprove={autoApprove}
          onClose={() => { setOpenBrief(null); setAutoApprove(false); refetch(); }}
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
function ClientFilterPill({ label, count, active, onClick, accent }: {
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
        borderRadius: 6, padding: "8px 12px", minHeight: 40,
        fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
        display: "inline-flex", alignItems: "center", gap: 6,
      }}>
      <span>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 600, opacity: active ? 0.85 : 0.6 }}>· {count}</span>
    </button>
  );
}

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
        const tid = t.preview_drive_file_id || t.drive_file_id;
        const src = tid ? `/api/files/thumbnail?id=${tid}&thumb=1` : null;
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
  const highlight = brief.has_unread_external ? unreadHighlightFor(brief.unread_kind) : null;
  // Persistent action-banner: derives from clientNextStep, only shown
  // when tone === "action" (a move is genuinely owed). Survives modal
  // open — softens to info once the client has actually posted, so a
  // commented-on WIP doesn't keep nagging them.
  const next = clientNextStep(brief.state, {
    hasLatestDraft: !!brief.has_latest_draft,
    clientEngaged: !!brief.client_engaged_with_review,
  });
  const actionPending = next?.tone === "action";
  return (
    <div onClick={onOpen}
      style={{
        background: C.card,
        border: highlight ? `2px solid ${highlight}` : `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: "hidden", display: "flex", flexDirection: "column",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        position: "relative",
      }}
      onMouseEnter={(e: any) => { e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
      onMouseLeave={(e: any) => { e.currentTarget.style.boxShadow = "none"; }}>
      {/* Unread ribbon — full-width banner across the top with the
          specific activity text. Replaces the old corner "NEW" badge. */}
      {brief.has_unread_external && highlight && (
        <div style={{
          padding: "6px 14px", background: highlight, color: "#fff",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.02em",
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <span style={{ flexShrink: 0, marginTop: 1, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "1px 5px", borderRadius: 2, background: C.purple, color: "#fff" }}>NEW</span>
          <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {brief.preview_line || "New activity"}
            </span>
            {brief.unread_body && (
              <span style={{
                fontSize: 11, fontWeight: 500, lineHeight: 1.35,
                opacity: 0.92,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}>
                {brief.unread_body}
              </span>
            )}
          </span>
        </div>
      )}
      {/* Mosaic with optional 30% darken overlay when unread.
          Centered banner card always shows whatever the client's
          next-step is for this state — bold + amber for action,
          softer for info/done so the client can scan status at a
          glance without it shouting on every tile. */}
      <div style={{ aspectRatio: "1", position: "relative", overflow: "hidden" }}>
        <TileMosaic thumbs={brief.thumbs || []} total={brief.thumb_total ?? (brief.thumbs?.length || 0)} />
        {brief.has_unread_external && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.30)", pointerEvents: "none", zIndex: 1 }} />
        )}
        {next && (actionPending || !brief.has_unread_external) && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex",
            alignItems: actionPending ? "center" : "flex-end",
            justifyContent: "center",
            padding: 12, zIndex: 2, pointerEvents: "none",
          }}>
            <div style={{
              background: actionPending ? "rgba(20,20,28,0.92)" : "rgba(20,20,28,0.72)",
              color: "#fff",
              padding: actionPending ? "10px 14px" : "8px 12px",
              borderRadius: 8,
              fontSize: actionPending ? 12 : 11,
              fontWeight: 700, lineHeight: 1.4, textAlign: "center",
              border: actionPending ? `2px solid ${C.amber}` :
                next.tone === "done" ? `1px solid ${C.green}` : "1px solid rgba(255,255,255,0.18)",
              boxShadow: actionPending ? "0 4px 16px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.2)",
              maxWidth: "100%",
            }}>
              {next.text}
            </div>
          </div>
        )}
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
      </div>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────
type DetailFile = {
  id: string; file_name: string; drive_link: string | null; drive_file_id: string | null;
  kind: string; version: number;
  /** 1-based index of this file within its kind on this brief — populated server-side. */
  kind_ordinal?: number | null;
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
  print_ready: { short: "PRINT", bg: C.green, fg: "#fff" },
};

function clientNextStep(
  state: string,
  ctx?: { hasLatestDraft?: boolean; clientEngaged?: boolean }
): { text: string; tone: "info" | "action" | "done" } | null {
  if (state === "draft") {
    return { text: "We're getting started. First look coming soon.", tone: "info" };
  }
  if (state === "sent" || state === "in_progress" || state === "wip_review") {
    return { text: "We're creating. First look coming soon.", tone: "info" };
  }
  if (state === "client_review") {
    // Client already posted (comment or upload) since the deliverable
    // landed — soften to status, the ball is back on HPD/designer.
    // For drafts, approval is still the formal next step but the comment
    // counts as engagement; designer can iterate or HPD can chase the
    // approval directly.
    if (ctx?.clientEngaged) {
      return { text: "We got your feedback. Your design team is on it.", tone: "info" };
    }
    // Draft/revision present = formal review with an Approve button.
    // No draft yet = HPD forwarded a WIP for a direction check; comments
    // are the only action available.
    if (ctx?.hasLatestDraft === false) {
      return { text: "Direction check — your design team shared a work-in-progress. Leave a comment with your thoughts.", tone: "action" };
    }
    return { text: "Draft ready — review it below and approve or comment.", tone: "action" };
  }
  if (state === "revisions") {
    return { text: "We're working on your revisions. Updated version coming soon.", tone: "info" };
  }
  if (state === "final_approved" || state === "pending_prep" || state === "production_ready") {
    return { text: "Your design is approved. We're getting it ready for print.", tone: "done" };
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

function BriefDetailModal({ token, brief, meta, onClose, autoApprove }: {
  token: string;
  brief: Brief;
  meta: ReturnType<typeof clientStateFor>;
  onClose: () => void;
  autoApprove?: boolean;
}) {
  const { token: ctxToken } = useClientPortal();
  const tk = token || ctxToken;
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoApproveTriggered = useRef(false);

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

  // Client now has two paths at client_review: approve (a button), or
  // request changes by leaving comments on the file (handled by the
  // chat composer in ArtReferencesGrid). HPD reads the comments and
  // flips the brief to revisions from their modal — no client-side
  // request_changes button.
  async function runAction(action: "approve" | "abort") {
    setActionPending(action);
    try {
      const res = await fetch(`/api/portal/client/${tk}/briefs/${brief.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `${action} failed`);
      } else if (action === "abort") {
        onClose();
      } else {
        await load();
      }
    } finally {
      setActionPending(null);
    }
  }

  function confirmAbort() {
    if (!window.confirm("Abort this design request? It'll be removed from your view. HPD can still access it for 60 days in case anything needs to be repurposed.")) return;
    runAction("abort");
  }

  // Email "Approve" deep-link → fire confirm once detail loads. Uses a
  // ref so the prompt fires exactly once per modal open even if detail
  // refetches via the 15s poll. State guard prevents firing on a stale
  // link (e.g. designer pushed a new revision after the email landed).
  useEffect(() => {
    if (!autoApprove || autoApproveTriggered.current || !detail) return;
    const liveState = detail.brief?.state;
    const latestDraft = (detail.files || []).find(f =>
      f.kind === "first_draft" || f.kind === "revision"
    );
    if (liveState !== "client_review" || !latestDraft) return;
    autoApproveTriggered.current = true;
    const t = setTimeout(() => {
      if (window.confirm("Approve this design? This sends it to production prep. To request changes instead, cancel here and leave a comment on the file.")) {
        runAction("approve");
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoApprove, detail]);

  async function uploadFile(file: File) {
    setUploading(true);
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
        }),
      });
      await load();
    } catch (e: any) {
      alert(`Upload failed: ${e.message || "unknown error"}`);
    }
    setUploading(false);
  }

  async function postClientComment(fileId: string, body: string) {
    const r = await fetch(`/api/portal/client/${tk}/briefs/${brief.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, body }),
    });
    if (!r.ok) throw new Error("post failed");
    const d = await r.json();
    const saved = d?.comment;
    setDetail(prev => prev ? {
      ...prev,
      files: prev.files.map(f => f.id === fileId ? {
        ...f,
        comments: [...((f as any).comments || []), saved],
      } as any : f),
    } : prev);
    return saved;
  }

  async function deleteClientFile(fileId: string) {
    if (!window.confirm("Delete this reference?")) return;
    const r = await fetch(`/api/portal/client/${tk}/briefs/${brief.id}/files?fileId=${fileId}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      alert(data.error || "Couldn't delete");
      return;
    }
    await load();
  }

  const allFiles = detail?.files || [];
  const hero = (heroId && allFiles.find(f => f.id === heroId)) || pickClientHero(brief.state, allFiles);
  const stripFiles = [
    ...allFiles.filter(f => f.kind !== "reference").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    ...allFiles.filter(f => f.kind === "reference").sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")),
  ];
  const heroMeta = hero ? KIND_META[hero.kind] : null;

  return (
    // Full-viewport panel — design requests are a primary surface for
    // clients, so the detail view takes over the screen. × returns to
    // the dashboard list.
    <div
      style={{
        position: "fixed", inset: 0, background: C.card, zIndex: 1000,
        display: "flex", flexDirection: "column",
      }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {brief.title || "Untitled design"}
              </div>
              {(() => {
                // Recompute the badge from the freshly-loaded brief
                // state so it flips immediately on approve / revision.
                const liveMeta = clientStateFor({ ...brief, state: detail?.brief?.state || brief.state } as any);
                return (
                  <span style={{ color: liveMeta.color, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {liveMeta.label}
                  </span>
                );
              })()}
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
          // Live state — after the client approves / requests changes,
          // load() refetches the brief into `detail`. Read from there so
          // the banner + button update immediately. Falls back to the
          // parent prop while detail is still loading.
          const liveState = detail?.brief?.state || brief.state;
          const hasLatestDraft = !!(detail?.files || []).find(f =>
            f.kind === "first_draft" || f.kind === "revision"
          );
          const next = clientNextStep(liveState, { hasLatestDraft });
          if (!next) return null;
          return (
            <div style={{ padding: "10px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ flex: 1, fontSize: 12, color: next.tone === "action" ? C.amber : next.tone === "done" ? C.green : C.blue, fontWeight: 600 }}>
                {next.text}
              </div>
            </div>
          );
        })()}

        {/* Body — single column, brief banner + action bar + upload bar
            + files grid. Notes live inline on each file card. */}
        {(() => {
          const allFiles = (detail?.files || []) as DetailFile[];
          // Latest draft/revision = the deliverable the client is being
          // asked to act on. Used as the target for Approve / Request
          // changes when state === client_review.
          const latestDraft = [...allFiles]
            .filter(f => f.kind === "first_draft" || f.kind === "revision")
            .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null;
          const liveState = detail?.brief?.state || brief.state;
          const showActionBar = liveState === "client_review" && !!latestDraft;

          return (
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
                flex: 1, minHeight: 0, overflow: "auto",
                background: C.surface,
                display: "flex", flexDirection: "column",
                outline: dragOver ? `3px dashed ${C.blue}` : "none", outlineOffset: -3,
              }}
            >
              {/* Approve action — only when a draft/revision is in
                  client_review. Revisions happen by leaving comments on
                  the file (chat composer below); HPD reviews and clicks
                  "Send back as revision" from their modal. */}
              {showActionBar && latestDraft && (
                <div style={{ padding: "12px 18px", background: C.card, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
                      Ready to approve the {formatFileLabel(latestDraft.kind, latestDraft.kind_ordinal)}?
                    </span>
                    <button onClick={() => runAction("approve")} disabled={!!actionPending}
                      style={{ padding: "10px 18px", background: C.green, color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: actionPending ? "wait" : "pointer", fontFamily: C.font, opacity: actionPending ? 0.7 : 1, minHeight: 40 }}>
                      {actionPending === "approve" ? "Approving…" : "✓ Approve this design"}
                    </button>
                    <span style={{ fontSize: 11, color: C.muted }}>
                      Need changes? Leave a comment on the file below.
                    </span>
                  </div>
                </div>
              )}

              {/* Upload bar — clients only upload references; kind is
                  fixed, no pills needed. */}
              <div style={{
                position: "sticky", top: 0, zIndex: 5,
                padding: "10px 18px",
                background: C.card, borderBottom: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  Add reference
                </span>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{
                    padding: "7px 16px",
                    background: uploading ? C.surface : C.text,
                    color: uploading ? C.muted : "#fff",
                    border: "none", borderRadius: 6,
                    fontSize: 12, fontWeight: 700,
                    cursor: uploading ? "not-allowed" : "pointer",
                    fontFamily: C.font, whiteSpace: "nowrap",
                  }}>
                  {uploading ? "Uploading…" : "+ Choose file"}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              </div>

              {/* Files header + grid */}
              <div style={{ padding: "14px 18px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted }}>
                  Files {allFiles.length > 0 && <span style={{ fontWeight: 400, color: C.faint }}>· {allFiles.length}</span>}
                </div>
                {dragOver && (
                  <span style={{ color: C.blue, fontSize: 11, fontWeight: 700 }}>
                    Drop to add reference
                  </span>
                )}
              </div>

              {allFiles.length > 0 ? (
                <div style={{ padding: "0 18px 24px", flexShrink: 0 }}>
                  <ArtReferencesGrid
                    files={allFiles as any}
                    viewerRole="client"
                    onPostComment={async (fileId, body) => {
                      const saved = await postClientComment(fileId, body);
                      return saved;
                    }}
                    /* Default canDelete = uploader_role === viewerRole, so
                       the trash icon only appears on the client's own refs.
                       Designer uploads and HPD-uploaded refs stay locked. */
                    onDelete={deleteClientFile}
                    /* Watermark + lock-down on deliverables (WIP/draft/
                       revision/final) until HPD marks the brief delivered.
                       References stay clean — they're the client's own
                       uploads. */
                    protectImages={(detail?.brief?.state || brief.state) !== "delivered"}
                  />
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center", color: C.faint, fontSize: 13 }}>
                  {dragOver ? (
                    <span style={{ color: C.blue, fontWeight: 700 }}>Drop to add reference</span>
                  ) : loading ? (
                    "Loading…"
                  ) : (
                    <div>
                      <div style={{ fontSize: 36, marginBottom: 8, color: C.faint }}>↑</div>
                      <div>Drop a reference image, or use the upload bar above.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── New-request modal ─────────────────────────────────────────────────
type StagedFile = { id: string; file: File; previewUrl: string | null; status: "queued" | "uploading" | "done" | "error"; errorMsg?: string };

function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token } = useClientPortal();
  const [title, setTitle] = useState("");
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
      body: JSON.stringify({ title: title.trim() || null }),
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
