"use client";

// Unified file-stack view — every uploaded file (REF, WIP, draft,
// revision, final, print) renders as a card with the same shape:
//   • full-width header bar (KIND label · download · optional delete)
//   • image
//   • per-file chat thread (HPD / Designer / Client) with composer
//
// The thread is shared across all three portals — viewer's bubbles
// align right with their accent color, others align left in neutral.
// Posting is gated by viewerRole + onPostComment; without it the
// thread is read-only.
//
// Files are sorted server-side most of the time, but the component also
// applies a phase-priority sort so newer phases bubble to the top
// (Final > Revisions > 1st Draft > WIP > References) within a single
// rendering pass.

import { useState, useEffect, useRef } from "react";
import { formatFileLabel } from "@/lib/art-activity-text";

export type FileComment = {
  id: string;
  sender_role: "hpd" | "designer" | "client";
  body: string;
  created_at: string;
};

export type RefFile = {
  id: string;
  drive_file_id: string | null;
  /** Server-rendered preview (e.g. flattened PSD → PNG). When set, the
   *  tile + lightbox use this for thumbnails since Drive can't render
   *  the original. Falls back to drive_file_id when null. */
  preview_drive_file_id?: string | null;
  drive_link?: string | null;
  kind: string;
  kind_ordinal?: number | null;
  comments?: FileComment[];
  uploader_role?: string | null;
  created_at?: string;
};

export type ViewerRole = "hpd" | "designer" | "client";

export type ArtReferencesGridProps = {
  files: RefFile[];
  viewerRole: ViewerRole;
  /** Optional read-only mode for aborted briefs etc. */
  readOnly?: boolean;
  /** Called when the viewer sends a chat comment. Receives the
   *  trimmed body — server determines sender_role from the token /
   *  auth context. Should return a promise that resolves with the new
   *  comment row so the UI can append optimistically. */
  onPostComment?: (fileId: string, body: string) => Promise<FileComment | null | void> | void;
  /** Optional delete handler. Visibility on each card is gated by
   *  canDelete(file) — defaults to "uploader can delete their own". */
  onDelete?: (fileId: string) => void | Promise<void>;
  canDelete?: (file: RefFile) => boolean;
  /** Optional empty-state UI override. */
  emptyState?: React.ReactNode;
};

// Header bar accent per kind — uses T's tokens.
const KIND_ACCENT: Record<string, string> = {
  reference:   "#1a1a1a", // T.text — context, neutral black
  wip:         "#f4b22b", // T.amber — early/rough
  first_draft: "#73b6c9", // T.blue — first formal
  revision:    "#fd3aa3", // T.purple — iteration
  final:       "#4ddb88", // T.green — locked
  print_ready: "#4ddb88", // T.green — production
  client_intake: "#1a1a1a", // T.text — client-side context
};

// Soft tint of each kind accent — used for the viewer's own bubbles
// so the chat ties visually to which file is being commented on.
const KIND_BUBBLE_BG: Record<string, string> = {
  reference:   "#eaeaee", // T.surface
  wip:         "#fef5e0", // T.amberDim
  first_draft: "#e3f1f5", // T.blueDim
  revision:    "#fee8f4", // T.purpleDim
  final:       "#e5f9ed", // T.greenDim
  print_ready: "#e5f9ed", // T.greenDim
  client_intake: "#eaeaee",
};

// Phase priority — lower number = higher in the stack. Newest
// deliverable bubbles to the top so designers + clients see "the
// latest thing" without scrolling. References sit at the bottom as
// context.
const KIND_RANK: Record<string, number> = {
  final:        0,
  revision:     1,
  first_draft:  2,
  wip:          3,
  reference:    4,
  print_ready:  5,
  client_intake: 6,
};

const C = {
  card: "#ffffff",      // T.card
  surface: "#eaeaee",   // T.surface
  border: "#dcdce0",    // T.border
  text: "#1a1a1a",      // T.text
  muted: "#6b6b78",     // T.muted
  faint: "#a0a0ad",     // T.faint
  font: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
  mono: "'IBM Plex Mono', 'Courier New', monospace",
};

function sortFiles(files: RefFile[]): RefFile[] {
  return [...files].sort((a, b) => {
    const ar = KIND_RANK[a.kind] ?? 99;
    const br = KIND_RANK[b.kind] ?? 99;
    if (ar !== br) return ar - br;
    // Within a kind:
    //   References — oldest first (REF 1, REF 2, REF 3 in upload order)
    //   Everything else — newest first (latest revision on top, etc.)
    if (a.kind === "reference") return (a.created_at || "").localeCompare(b.created_at || "");
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

export function ArtReferencesGrid({
  files,
  viewerRole,
  readOnly,
  onPostComment,
  onDelete,
  canDelete,
  emptyState,
}: ArtReferencesGridProps) {
  if (files.length === 0) {
    return emptyState ? <>{emptyState}</> : null;
  }

  const ordered = sortFiles(files);
  const canDeleteFn = canDelete ?? ((f: RefFile) => f.uploader_role === viewerRole);

  // Split into two zones — deliverables (the actual creative work) get
  // larger cards and fewer columns; references are context, smaller and
  // denser. Gives the latest WIP / draft / final visual primacy without
  // burying it under a row of refs.
  const deliverables = ordered.filter(f => f.kind !== "reference");
  const refs = ordered.filter(f => f.kind === "reference");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: C.font }}>
      {deliverables.length > 0 && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          {deliverables.map(f => (
            <FileCard
              key={f.id}
              file={f}
              viewerRole={viewerRole}
              readOnly={!!readOnly}
              onPostComment={onPostComment}
              onDelete={onDelete && canDeleteFn(f) ? onDelete : undefined}
              variant="deliverable"
            />
          ))}
        </div>
      )}

      {refs.length > 0 && (
        <>
          {deliverables.length > 0 && (
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
              color: C.faint, paddingTop: 4, borderTop: `1px solid ${C.border}`,
            }}>
              References · {refs.length}
            </div>
          )}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 12, alignItems: "start",
          }}>
            {refs.map(f => (
              <FileCard
                key={f.id}
                file={f}
                viewerRole={viewerRole}
                readOnly={!!readOnly}
                onPostComment={onPostComment}
                onDelete={onDelete && canDeleteFn(f) ? onDelete : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Detect whether we're on a wide enough viewport to use the side-by-side
// deliverable layout. Reads from window on mount + resize.
function useIsDesktop(threshold = 720) {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= threshold);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [threshold]);
  return isDesktop;
}

function FileCard({
  file,
  viewerRole,
  readOnly,
  onPostComment,
  onDelete,
  variant = "reference",
}: {
  file: RefFile;
  viewerRole: ViewerRole;
  readOnly: boolean;
  onPostComment?: (fileId: string, body: string) => Promise<FileComment | null | void> | void;
  onDelete?: (fileId: string) => void | Promise<void>;
  /** "reference" = compact stacked tile (image-on-top, thread below).
   *  "deliverable" = full-width card; on desktop image sits left,
   *  thread right; collapses to stacked on mobile. */
  variant?: "reference" | "deliverable";
}) {
  const label = formatFileLabel(file.kind, file.kind_ordinal).toUpperCase();
  const accent = KIND_ACCENT[file.kind] || KIND_ACCENT.reference;
  const isDesktop = useIsDesktop();
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Optimistic local comments — appended on send, replaced when the
  // server returns the saved row. Falls back to file.comments otherwise.
  const [localComments, setLocalComments] = useState<FileComment[]>(file.comments || []);
  useEffect(() => {
    setLocalComments(file.comments || []);
  }, [file.comments, file.id]);

  const canPost = !readOnly && !!onPostComment;
  const hasThread = canPost || localComments.length > 0;
  const sideBySide = variant === "deliverable" && isDesktop && hasThread;

  // Drive direct-download URL — opens "save file" prompt without a
  // separate Drive UI step. Lets designers pull files into their tools.
  const downloadUrl = file.drive_file_id
    ? `https://drive.google.com/uc?export=download&id=${file.drive_file_id}`
    : null;

  // Image container — references stay at fixed 1:1 aspect; deliverables
  // get a 4:3 frame with internal padding so the image reads like a
  // framed photograph next to the chat thread.
  const imageWrapStyle: React.CSSProperties = sideBySide
    ? {
        position: "relative", background: C.card,
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", padding: 18, aspectRatio: "4 / 3",
      }
    : variant === "deliverable"
    ? {
        position: "relative", background: C.card,
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", aspectRatio: "4 / 3", padding: 18,
      }
    : {
        position: "relative", background: C.surface,
        display: "flex", alignItems: "center", justifyContent: "center",
        aspectRatio: "1 / 1", overflow: "hidden",
      };

  // Prefer the server-rendered preview when present (Drive can't
  // thumbnail PSDs etc.), fall back to the original drive_file_id.
  const thumbId = file.preview_drive_file_id || file.drive_file_id;
  const imageSrc = thumbId
    ? `https://drive.google.com/thumbnail?id=${thumbId}&sz=w1600`
    : null;

  const handleSend = async (body: string): Promise<boolean> => {
    if (!onPostComment) return false;
    const text = body.trim();
    if (!text) return false;
    // Optimistic insert with a temp id; replaced when server returns.
    const tempId = `temp-${Date.now()}`;
    const optimistic: FileComment = {
      id: tempId, sender_role: viewerRole, body: text, created_at: new Date().toISOString(),
    };
    setLocalComments(prev => [...prev, optimistic]);
    try {
      const saved = await onPostComment(file.id, text);
      if (saved && typeof saved === "object" && "id" in saved) {
        setLocalComments(prev => prev.map(c => c.id === tempId ? saved : c));
      }
      return true;
    } catch {
      // Roll back on failure
      setLocalComments(prev => prev.filter(c => c.id !== tempId));
      return false;
    }
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      border: `1px solid ${C.border}`, borderRadius: 12,
      overflow: "hidden", background: C.card,
    }}>
      {/* Full-width header bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px",
        background: accent, color: "#fff",
        font: `800 10px ${C.mono}`, letterSpacing: "0.08em",
      }}>
        <span>{label}</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Download original file"
              style={{
                background: "rgba(255,255,255,0.18)", color: "#fff", border: "none",
                borderRadius: 3, width: 22, height: 20, cursor: "pointer",
                fontSize: 11, lineHeight: "20px", padding: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                textDecoration: "none",
              }}
            >↓</a>
          )}
          {onDelete && !readOnly && (
            <button
              onClick={() => onDelete(file.id)}
              title="Delete file"
              style={{
                background: "rgba(255,255,255,0.18)", color: "#fff", border: "none",
                borderRadius: 3, width: 22, height: 20, cursor: "pointer",
                fontSize: 13, lineHeight: 1, padding: 0,
              }}
            >×</button>
          )}
        </div>
      </div>

      <div style={sideBySide ? {
        display: "grid", gridTemplateColumns: "2.6fr 1fr",
        alignItems: "start", minHeight: 0,
      } : { display: "flex", flexDirection: "column" }}>

        <div
          style={{ ...imageWrapStyle, cursor: imageSrc ? "zoom-in" : "default" }}
          onClick={() => imageSrc && setLightboxOpen(true)}
        >
          {imageSrc && (
            <img
              src={imageSrc}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{
                width: "100%",
                height: "100%",
                objectFit: variant === "reference" ? "cover" : "contain",
                display: "block",
              }}
              onError={(e: any) => { e.target.style.display = "none"; }}
            />
          )}
        </div>

        {hasThread && (
          <ChatThread
            comments={localComments}
            viewerRole={viewerRole}
            canPost={canPost}
            onSend={handleSend}
            sideBySide={sideBySide}
            myBubbleBg={KIND_BUBBLE_BG[file.kind] || C.surface}
          />
        )}
      </div>

      {lightboxOpen && imageSrc && (
        <Lightbox src={imageSrc} label={label} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
}

const ROLE_LABEL: Record<ViewerRole, string> = {
  hpd: "HPD",
  designer: "Designer",
  client: "Client",
};

function ChatThread({
  comments, viewerRole, canPost, onSend, sideBySide, myBubbleBg,
}: {
  comments: FileComment[];
  viewerRole: ViewerRole;
  canPost: boolean;
  onSend: (body: string) => Promise<boolean>;
  sideBySide: boolean;
  myBubbleBg: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Composer sits at the top; messages render below in reverse
  // chronological order so the newest comment lands right under the
  // input. Scroll to the top of the list whenever a new comment
  // arrives.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [comments.length]);

  const ordered = [...comments].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      borderTop: sideBySide ? "none" : `1px solid ${C.border}`,
      borderLeft: sideBySide ? `1px solid ${C.border}` : "none",
      minWidth: 0,
      alignSelf: sideBySide ? "stretch" : undefined,
      maxHeight: sideBySide ? "100%" : undefined,
    }}>
      {canPost && <Composer viewerRole={viewerRole} onSend={onSend} />}
      <div
        ref={listRef}
        style={{
          flex: 1, minHeight: 0,
          overflowY: "auto",
          padding: "10px 12px 12px",
          display: "flex", flexDirection: "column", gap: 8,
        }}
      >
        {comments.length === 0 && (
          <div style={{ color: C.faint, fontSize: 12, fontStyle: "italic", padding: "4px 2px" }}>
            No comments yet.
          </div>
        )}
        {ordered.map(c => (
          <ChatBubble
            key={c.id}
            comment={c}
            mine={c.sender_role === viewerRole}
            myBubbleBg={myBubbleBg}
          />
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ comment, mine, myBubbleBg }: { comment: FileComment; mine: boolean; myBubbleBg: string }) {
  const role = comment.sender_role as ViewerRole;
  const bg = mine ? myBubbleBg : C.surface;
  const senderLabel = mine ? "You" : ROLE_LABEL[role];

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: mine ? "flex-end" : "flex-start",
      maxWidth: "100%",
    }}>
      <div style={{
        font: `700 9px ${C.font}`,
        letterSpacing: "0.1em", textTransform: "uppercase",
        color: C.text, marginBottom: 2,
        padding: mine ? "0 4px 0 0" : "0 0 0 4px",
      }}>
        {senderLabel}
      </div>
      <div style={{
        background: bg,
        color: C.text,
        padding: "7px 11px",
        borderRadius: mine ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
        fontSize: 13, lineHeight: 1.4,
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        maxWidth: "92%",
      }}>
        {comment.body}
      </div>
      <div style={{
        fontSize: 10, color: C.faint, marginTop: 2,
        padding: mine ? "0 4px 0 0" : "0 0 0 4px",
      }}>
        {formatTime(comment.created_at)}
      </div>
    </div>
  );
}

function Composer({
  viewerRole, onSend,
}: {
  viewerRole: ViewerRole;
  onSend: (body: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    const body = draft;
    setDraft("");
    const ok = await onSend(body);
    if (!ok) setDraft(body);
    setSending(false);
    taRef.current?.focus();
  };

  return (
    <div style={{
      borderBottom: `1px solid ${C.border}`,
      background: C.card,
    }}>
      <div style={{
        padding: 8,
        display: "flex", gap: 6, alignItems: "flex-end",
      }}>
        <textarea
          ref={taRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
              return;
            }
            // Shift+Enter: insert a newline and auto-continue bullet
            // lists. If the current line starts with "• ", prepend the
            // same on the new line so users can stack bullet points
            // without retyping the marker.
            if (e.key === "Enter" && e.shiftKey) {
              const ta = taRef.current;
              if (!ta) return;
              const start = ta.selectionStart;
              const before = draft.slice(0, start);
              const after = draft.slice(ta.selectionEnd);
              const lineStart = before.lastIndexOf("\n") + 1;
              const currentLine = before.slice(lineStart);
              const continuesBullet = currentLine.startsWith("• ");
              if (!continuesBullet) return; // let the textarea insert "\n"
              e.preventDefault();
              const insert = "\n• ";
              const next = before + insert + after;
              setDraft(next);
              setTimeout(() => {
                if (taRef.current) {
                  const pos = start + insert.length;
                  taRef.current.selectionStart = taRef.current.selectionEnd = pos;
                }
              }, 0);
            }
          }}
          placeholder={composerPlaceholder(viewerRole)}
          rows={1}
          style={{
            flex: 1, minWidth: 0,
            padding: "7px 10px",
            border: `1px solid ${C.border}`, borderRadius: 8,
            background: C.card, color: C.text,
            font: `13px/1.4 ${C.font}`,
            resize: "none", boxSizing: "border-box", outline: "none",
            maxHeight: 120,
          }}
        />
        <button
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          style={{
            background: C.text, color: "#fff", border: "none",
            padding: "7px 12px", borderRadius: 8,
            font: `700 12px ${C.font}`,
            cursor: !draft.trim() || sending ? "not-allowed" : "pointer",
            opacity: !draft.trim() || sending ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
      <div style={{
        padding: "0 12px 6px",
        fontSize: 10, color: C.faint, letterSpacing: "0.02em",
      }}>
        ↵ send · ⇧↵ new line
      </div>
    </div>
  );
}

function composerPlaceholder(_viewerRole: ViewerRole): string {
  return "Comment…";
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + time;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + time;
}

function Lightbox({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, cursor: "zoom-out",
      }}
    >
      <div style={{
        position: "absolute", top: 16, left: 20,
        font: `800 11px ${C.mono}`, letterSpacing: "0.1em",
        color: "rgba(255,255,255,0.85)",
      }}>
        {label}
      </div>
      <button
        onClick={onClose}
        title="Close (Esc)"
        style={{
          position: "absolute", top: 12, right: 16,
          width: 36, height: 36, borderRadius: 6,
          background: "rgba(255,255,255,0.12)", color: "#fff", border: "none",
          fontSize: 18, lineHeight: 1, cursor: "pointer",
        }}
      >×</button>
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: "92vw", maxHeight: "92vh",
          objectFit: "contain", display: "block", cursor: "default",
        }}
      />
    </div>
  );
}
