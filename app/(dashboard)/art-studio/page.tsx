"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { ProjectPicker } from "@/components/ProjectPicker";
import { appBaseUrl } from "@/lib/public-url";
import {
  resolveBrief,
  type Resolution,
  type PrimaryActionKind,
} from "@/lib/art-studio-v2";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";
import { formatFileLabel, unreadHighlightFor, unreadEventFor } from "@/lib/art-activity-text";
import { DriveFileLink } from "@/components/DriveFileLink";
import { ArtReferencesGrid } from "@/components/ArtReferencesGrid";

// Kept for BriefDetailModal's (legacy) state dropdown. When the modal is
// rebuilt (Phase 2), this map goes with it.
const STATE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: T.muted, bg: T.surface },
  sent: { label: "Sent", color: T.accent, bg: T.accentDim },
  in_progress: { label: "In Progress", color: T.accent, bg: T.accentDim },
  wip_review: { label: "WIP Review", color: T.amber, bg: T.amberDim },
  client_review: { label: "Client Review", color: T.purple, bg: T.purpleDim },
  revisions: { label: "Revisions", color: T.red, bg: T.redDim },
  final_approved: { label: "Final Approved", color: T.green, bg: T.greenDim },
  pending_prep: { label: "Pending Prep", color: T.amber, bg: T.amberDim },
  production_ready: { label: "Production Ready", color: T.green, bg: T.greenDim },
  delivered: { label: "Delivered", color: T.green, bg: T.greenDim },
};

type Brief = {
  id: string;
  title: string | null;
  concept: string | null;
  state: string;
  source?: string | null;
  deadline: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  version_count: number;
  item_id: string | null;
  job_id: string | null;
  client_id: string | null;
  client_intake_token?: string | null;
  client_intake_submitted_at?: string | null;
  sent_to_designer_at?: string | null;
  items?: { name: string } | null;
  jobs?: { title: string; job_number: string; job_type: string | null } | null;
  clients?: { name: string } | null;
  message_count?: number;
  designer_message_count?: number;
  thumbs?: Array<{ drive_file_id: string | null; drive_link: string | null; kind?: string }>;
  thumb_total?: number;
  thumb_file_id?: string | null;
  thumb_link?: string | null;
  has_unread_external?: boolean;
  unread_by_role?: "client" | "designer" | null;
  unread_kind?: string | null;
  preview_line?: string | null;
  last_activity_at?: string | null;
  client_aborted_at?: string | null;
  archived_by?: "client" | "hpd" | null;
};

type Client = { id: string; name: string };

// ─── Image mosaic (image-first tile visual) ───────────────────────────────
// Up to 4 thumbnails in a smart 1/2/3/4-cell layout. Overflow → "+N" badge.
// Copied from components/ArtBoard so the legacy preview page can diverge
// without our tiles being affected.
function thumbUrl(fileId: string | null | undefined, w = 400) {
  if (!fileId) return null;
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${w}`;
}

type Thumb = { drive_file_id: string | null; drive_link: string | null };

function ImageMosaic({ thumbs, total, aspect = "4/3" }: { thumbs: Thumb[]; total: number; aspect?: string }) {
  const count = Math.min(thumbs.length, 4);
  const overflow = Math.max(0, total - 4);

  if (count === 0) {
    return (
      <div style={{ width: "100%", aspectRatio: aspect, background: "#f4f4f7", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 10, color: T.faint }}>No images</span>
      </div>
    );
  }

  let gridTemplate = "1fr", rows = "1fr";
  if (count === 2) { gridTemplate = "1fr 1fr"; rows = "1fr"; }
  if (count === 3) { gridTemplate = "1fr 1fr"; rows = "1fr 1fr"; }
  if (count === 4) { gridTemplate = "1fr 1fr"; rows = "1fr 1fr"; }

  return (
    <div style={{
      width: "100%", aspectRatio: aspect, background: "#f4f4f7",
      display: "grid", gridTemplateColumns: gridTemplate, gridTemplateRows: rows,
      gap: 2, overflow: "hidden",
    }}>
      {thumbs.slice(0, count).map((t, i) => {
        const spanLeft = count === 3 && i === 0;
        const isLast = i === count - 1;
        return (
          <div key={i} style={{
            position: "relative", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
            ...(spanLeft ? { gridRow: "1 / span 2" } : {}),
          }}>
            {t.drive_file_id ? (
              <img
                src={thumbUrl(t.drive_file_id, 320) || ""}
                referrerPolicy="no-referrer"
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={e => ((e.target as HTMLImageElement).style.display = "none")}
              />
            ) : (
              <span style={{ fontSize: 9, color: T.faint }}>—</span>
            )}
            {isLast && overflow > 0 && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em",
              }}>+{overflow}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── BriefTile — image-first card matching designer + client portals ────
// + activity line + primary action (only in "Your move" sections).
function BriefTile({
  brief,
  resolution,
  variant = "large",
  onOpen,
}: {
  brief: Brief;
  resolution: Resolution;
  variant?: "large" | "compact";
  onOpen: () => void;
  onAction?: (kind: PrimaryActionKind) => void;
  actionPending?: PrimaryActionKind | null;
}) {
  // Mirrors the designer + client portal tile (BriefCard). Image mosaic
  // up top, optional unread ribbon, plain title + client + due date in
  // the body. All HPD actions live inside the modal now — no inline
  // buttons on the tile.
  const due = brief.deadline ? daysUntil(brief.deadline) : null;
  const unread = brief.has_unread_external && !resolution.isAborted;
  const isAborted = resolution.isAborted || (brief.archived_by === "client" && !!brief.client_aborted_at);
  // Milestone events (client approval, revision request) override the
  // kind-based highlight so the tile celebrates / flags the moment.
  const event = unread ? unreadEventFor(brief.state, brief.unread_by_role, "hpd", brief.preview_line) : null;
  const highlight = unread ? (event?.color || unreadHighlightFor(brief.unread_kind)) : null;
  const ribbonLabel = event?.label || "NEW";
  const ribbonText = event ? (event.kind === "approval" ? "Client approved" : "Client requested changes") : (brief.preview_line || "New activity");
  const kindLabel = (() => {
    const k = brief.thumbs?.[0]?.kind;
    if (k === "first_draft") return "1st Draft";
    if (k === "revision") return "Revision";
    if (k === "final") return "Final";
    if (k === "wip") return "WIP";
    if (k === "print_ready") return "Print";
    return null;
  })();
  const noWorkYet = !brief.thumbs?.length;

  return (
    <div
      onClick={onOpen}
      style={{
        background: T.card,
        border: highlight ? `2px solid ${highlight}` : `1px solid ${T.border}`,
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        position: "relative",
        display: "flex", flexDirection: "column",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.05)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      {/* Unread ribbon — full-width banner with the specific activity text */}
      {unread && highlight && (
        <div style={{
          padding: "6px 14px", background: highlight, color: "#fff",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.02em",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "1px 5px", borderRadius: 2, background: event ? "rgba(0,0,0,0.18)" : T.purple, color: "#fff" }}>{ribbonLabel}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ribbonText}
          </span>
        </div>
      )}
      {isAborted && (
        <div style={{
          padding: "6px 14px", background: T.muted, color: "#fff",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
        }}>{brief.archived_by === "hpd" ? "Archived" : "Client aborted"}</div>
      )}

      {/* Thumb mosaic — same 1:1 aspect + 30% darken overlay when unread */}
      <div style={{ aspectRatio: "1", position: "relative", overflow: "hidden", opacity: isAborted ? 0.45 : 1 }}>
        <ImageMosaic
          thumbs={brief.thumbs || []}
          total={brief.thumb_total ?? (brief.thumbs?.length || 0)}
          aspect="1/1"
        />
        {unread && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.30)", pointerEvents: "none", zIndex: 1 }} />
        )}
        {kindLabel && !noWorkYet && (
          <div style={{ position: "absolute", bottom: 10, right: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: mono, zIndex: 2 }}>
            {kindLabel}
          </div>
        )}
      </div>

      {/* Body — title, client, due. No activity line, no inline action. */}
      <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: unread ? 800 : 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {brief.title || "Untitled design"}
        </div>
        <div style={{ fontSize: 11, color: T.muted, display: "flex", gap: 6, alignItems: "center" }}>
          {brief.clients?.name && <span>{brief.clients.name}</span>}
          {due && <><span style={{ color: T.faint }}>·</span><span style={{ color: due.color, fontWeight: 600 }}>{due.text}</span></>}
        </div>
      </div>
    </div>
  );
}

// Days-until helper — matches the portal's daysUntil so HPD tiles use
// the same red/amber/muted treatment for deadlines.
function daysUntil(iso: string | null): { text: string; color: string } | null {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: T.red };
  if (diff === 0) return { text: "today", color: T.red };
  if (diff <= 3) return { text: `${diff}d`, color: T.amber };
  return { text: `${diff}d`, color: T.muted };
}

// ─── Filter pill button ────────────────────────────────────────────────────
function FilterPill({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 4, // rectangles w/ small radius per plan
        border: `1px solid ${active ? T.text : T.border}`,
        background: active ? T.text : T.card,
        color: active ? T.bg : T.muted,
        fontSize: 11, fontWeight: 600, fontFamily: font, cursor: "pointer",
        transition: "all 0.1s",
        letterSpacing: "0.02em",
      }}
    >
      {label}{typeof count === "number" && count > 0 ? ` · ${count}` : ""}
    </button>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function ArtStudioPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<Brief | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "working" | "ready" | "done" | "unread" | "aborted">("unread");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  useEffect(() => {
    loadBriefs(true);
    loadClients();
    // Poll every 15s so client/designer activity (approvals, uploads,
    // comments) propagates without a manual refresh. Silent poll —
    // doesn't flash the loading state — matches portal cadence.
    const interval = setInterval(() => loadBriefs(false), 15000);
    return () => clearInterval(interval);
  }, []);

  // Deep-link: open brief from ?brief=id (set by notification bell)
  useEffect(() => {
    const briefId = params?.get("brief");
    if (!briefId || briefs.length === 0) return;
    const match = briefs.find(b => b.id === briefId);
    if (match && (!selectedBrief || selectedBrief.id !== briefId)) setSelectedBrief(match);
  }, [params, briefs]);

  async function loadBriefs(initial = false) {
    if (initial) setLoading(true);
    const res = await fetch("/api/art-briefs");
    const data = await res.json();
    setBriefs(data.briefs || []);
    if (initial) setLoading(false);
  }

  async function loadClients() {
    const { data } = await supabase.from("clients").select("id, name").order("name");
    setClients(data || []);
  }

  // Resolve each brief once — keeps the existing model around for the
  // detail modal's owner-aware copy, but the dashboard list now treats
  // every brief as a feed item sorted by last activity.
  const resolved = useMemo(
    () => briefs.map(b => ({ brief: b, res: resolveBrief(b) })),
    [briefs]
  );

  const allClients = useMemo(() => {
    const set = new Set<string>();
    briefs.forEach(b => b.clients?.name && set.add(b.clients.name));
    return Array.from(set).sort();
  }, [briefs]);

  // Buckets — match the lifecycle Jon defined for HPD:
  //   pending → not sent to designer yet (draft)
  //   working → sent through client approval (sent..final_approved)
  //   ready   → designer's final is in, HPD needs to make print-ready (pending_prep)
  //   done    → print-ready up / brief closed (production_ready, delivered)
  const bucketOf = (state: string): "pending" | "working" | "ready" | "done" => {
    if (state === "draft") return "pending";
    if (state === "pending_prep") return "ready";
    if (state === "production_ready" || state === "delivered") return "done";
    return "working";
  };

  // Base filter — search + client filter
  const basePassed = useMemo(() => {
    return resolved.filter(({ brief }) => {
      if (clientFilter && brief.clients?.name !== clientFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hit =
          (brief.title || "").toLowerCase().includes(q) ||
          (brief.clients?.name || "").toLowerCase().includes(q) ||
          (brief.jobs?.title || "").toLowerCase().includes(q) ||
          (brief.jobs?.job_number || "").toLowerCase().includes(q) ||
          (brief.items?.name || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [resolved, clientFilter, search]);

  // Single feed — most-recent-activity first, like a chat inbox.
  // Aborted briefs are hidden from every bucket except "Aborted" so
  // they don't crowd the active feed.
  const feed = useMemo(() => {
    const matching = basePassed.filter(({ brief }) => {
      const isAborted = !!brief.client_aborted_at;
      if (filter === "aborted") return isAborted;
      if (isAborted) return false;
      if (filter === "unread") return !!brief.has_unread_external;
      const b = bucketOf(brief.state);
      if (filter === "all") return true;
      return b === filter;
    });
    return [...matching].sort((a, b) => {
      const at = a.brief.last_activity_at || a.brief.updated_at || "";
      const bt = b.brief.last_activity_at || b.brief.updated_at || "";
      return bt.localeCompare(at);
    });
  }, [basePassed, filter]);

  const counts = useMemo(() => {
    const active = basePassed.filter(r => !r.brief.client_aborted_at);
    return {
      all: active.length,
      pending: active.filter(r => bucketOf(r.brief.state) === "pending").length,
      working: active.filter(r => bucketOf(r.brief.state) === "working").length,
      ready: active.filter(r => bucketOf(r.brief.state) === "ready").length,
      done: active.filter(r => bucketOf(r.brief.state) === "done").length,
      unread: active.filter(r => r.brief.has_unread_external).length,
      aborted: basePassed.filter(r => r.brief.client_aborted_at).length,
    };
  }, [basePassed]);


  return (
    <div style={{ fontFamily: font, color: T.text }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Art Studio</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {counts.unread > 0 && <><strong style={{ color: T.blue }}>{counts.unread}</strong> unread · </>}
            <strong style={{ color: T.text }}>{counts.pending}</strong> pending
            {counts.working > 0 && <> · <strong style={{ color: T.text }}>{counts.working}</strong> working</>}
            {counts.ready > 0 && <> · <strong style={{ color: T.green }}>{counts.ready}</strong> ready</>}
            {counts.done > 0 && <> · {counts.done} done</>}
          </p>
        </div>
        <button onClick={() => setShowNewRequest(true)}
          style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontFamily: font, fontWeight: 700, cursor: "pointer" }}>
          + New Request
        </button>
      </div>

      {/* Filter pills — feed-style buckets matching the brief lifecycle.
          Pending = not sent yet; Working = with designer through client
          approval; Ready = designer's final is in, HPD's turn to make it
          print-ready; Done = print-ready uploaded. Unread + Aborted are
          orthogonal slices for HPD admin. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <FilterPill label="Unread" count={counts.unread} active={filter === "unread"} onClick={() => setFilter("unread")} />
        <FilterPill label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterPill label="Pending" count={counts.pending} active={filter === "pending"} onClick={() => setFilter("pending")} />
        <FilterPill label="Working" count={counts.working} active={filter === "working"} onClick={() => setFilter("working")} />
        <FilterPill label="Ready" count={counts.ready} active={filter === "ready"} onClick={() => setFilter("ready")} />
        <FilterPill label="Done" count={counts.done} active={filter === "done"} onClick={() => setFilter("done")} />
        {counts.aborted > 0 && <FilterPill label="Aborted" count={counts.aborted} active={filter === "aborted"} onClick={() => setFilter("aborted")} />}
      </div>

      {/* Search + client filter row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items, clients…"
          style={{ padding: "7px 12px", fontSize: 12, borderRadius: 6, border: `1px solid ${T.border}`, background: T.card, color: T.text, outline: "none", fontFamily: font, width: 220 }}
        />
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          style={{ padding: "7px 12px", fontSize: 12, borderRadius: 6, border: `1px solid ${clientFilter ? T.text : T.border}`, background: T.card, color: T.text, outline: "none", fontFamily: font, cursor: "pointer", minWidth: 180, fontWeight: clientFilter ? 600 : 400 }}
        >
          <option value="">All clients ({allClients.length})</option>
          {allClients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(search || clientFilter) && (
          <button onClick={() => { setSearch(""); setClientFilter(""); }}
            style={{ padding: "7px 14px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Content — single feed, latest activity first */}
      {loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Loading…</div>
      ) : briefs.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 40, textAlign: "center", fontSize: 13, color: T.faint }}>
          No requests yet. Click <strong>+ New Request</strong> to load some references.
        </div>
      ) : feed.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 30, textAlign: "center", fontSize: 12, color: T.faint }}>
          Nothing here.
        </div>
      ) : (
        <TileGrid>
          {feed.map(({ brief, res }) => (
            <BriefTile
              key={brief.id}
              brief={brief}
              resolution={res}
              variant="large"
              onOpen={() => setSelectedBrief(brief)}
            />
          ))}
        </TileGrid>
      )}

      {showNewRequest && (
        <NewRequestModal
          clients={clients}
          onClose={() => setShowNewRequest(false)}
          onCreated={() => loadBriefs()}
        />
      )}

      {selectedBrief && (
        <BriefDetailModal brief={selectedBrief} onClose={(updated) => {
          setSelectedBrief(null);
          if (params?.get("brief")) router.replace("/art-studio");
          if (updated) loadBriefs();
        }} />
      )}
    </div>
  );
}

// ─── Section shell ─────────────────────────────────────────────────────────
function Section({
  title, count, hint, tone = "neutral",
  collapsible, expanded, onToggle, children,
}: {
  title: string;
  count: number;
  hint?: string;
  tone?: "action" | "neutral" | "muted";
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const toneColor = tone === "action" ? T.text : tone === "muted" ? T.faint : T.muted;
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 10,
        marginBottom: 10, paddingBottom: 6,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: toneColor, letterSpacing: "0.02em" }}>
          {title}
        </h2>
        <span style={{ fontSize: 11, fontWeight: 700, color: toneColor, fontFamily: mono }}>
          {count}
        </span>
        {hint && <span style={{ fontSize: 11, color: T.faint }}>{hint}</span>}
        {collapsible && (
          <button onClick={onToggle}
            style={{ marginLeft: "auto", background: "transparent", border: "none", color: T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
            {expanded ? "Hide ↑" : "Show ↓"}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

// ─── Tile grid ─────────────────────────────────────────────────────────────
function TileGrid({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: compact
        ? "repeat(auto-fill, minmax(160px, 1fr))"
        : "repeat(auto-fill, minmax(240px, 1fr))",
      gap: compact ? 8 : 12,
    }}>
      {children}
    </div>
  );
}

// Kind labels + colors for the file strip badges. These match the designer
// portal's mental model so uploads feel coherent across surfaces.
const KIND_META: Record<string, { short: string; bg: string; fg: string; rank: number }> = {
  final:       { short: "FINAL",  bg: T.green,    fg: "#fff",       rank: 5 },
  revision:    { short: "REV",    bg: T.amber,    fg: "#fff",       rank: 4 },
  first_draft: { short: "1ST",    bg: T.accent,   fg: "#fff",       rank: 3 },
  wip:         { short: "WIP",    bg: T.blue,     fg: "#fff",       rank: 2 },
  reference:   { short: "REF",    bg: T.purple,   fg: "#fff",       rank: 1 },
  client_intake: { short: "INTK", bg: T.purpleDim, fg: T.purple,    rank: 1 },
  packing_slip: { short: "PACK",  bg: T.surface,  fg: T.muted,      rank: 0 },
  print_ready: { short: "PRINT",  bg: T.green,    fg: "#fff",       rank: 5 },
};

// What HPD should know + do next, based on brief state. Surfaces the one
// most useful action (when there is one) alongside plain-English status.
function hpdNextStep(
  state: string,
  ctx?: { designerName?: string | null }
): { text: string; tone: "info" | "action" | "done" } | null {
  const designer = ctx?.designerName || "designer";
  if (state === "draft") {
    return { text: `Send to ${designer} when ready.`, tone: "action" };
  }
  if (state === "sent") {
    return { text: `Sent to ${designer}.`, tone: "info" };
  }
  if (state === "in_progress") {
    return { text: `Viewed by ${designer}.`, tone: "info" };
  }
  if (state === "wip_review") {
    return { text: `${cap(designer)} shared an image — approve and/or comment.`, tone: "action" };
  }
  if (state === "client_review") {
    return { text: `Forwarded to client — awaiting their decision.`, tone: "info" };
  }
  if (state === "revisions") {
    return { text: `Changes requested — ${designer} is preparing revision. Chime in if needed.`, tone: "info" };
  }
  if (state === "final_approved") {
    return { text: `Client approved — awaiting final from ${designer}.`, tone: "info" };
  }
  if (state === "pending_prep") {
    return { text: `${cap(designer)} uploaded final — download and make it print-ready.`, tone: "action" };
  }
  if (state === "production_ready") {
    return { text: "Print-Ready file is up. Ready to close this out.", tone: "action" };
  }
  if (state === "delivered") {
    return null;
  }
  return null;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Bullet-auto helper for textareas — focus empty → "• ", Enter → "\n• ".
// Mirrors the New Request modal input style so all note fields feel alike.
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

// Pick the default hero: latest file of the kind matching brief's current
// state. Falls back to newest file of any kind.
function pickHeroFile(state: string, files: any[]): any | null {
  if (!files.length) return null;
  // State-to-relevant-kind preference order
  const pref: Record<string, string[]> = {
    draft: ["reference", "client_intake"],
    sent: ["reference"],
    in_progress: ["wip", "reference"],
    wip_review: ["wip", "reference"],
    client_review: ["first_draft", "revision", "wip"],
    revisions: ["first_draft", "revision", "wip"],
    final_approved: ["final", "first_draft", "wip"],
    pending_prep: ["final", "first_draft"],
    production_ready: ["print_ready", "final"],
    delivered: ["print_ready", "final"],
  };
  const order = pref[state] || ["final", "first_draft", "wip", "reference"];
  for (const kind of order) {
    const hit = files.filter(f => f.kind === kind).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
    if (hit) return hit;
  }
  // Fallback — newest overall
  return [...files].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
}

function BriefDetailModal({ brief, onClose }: { brief: Brief; onClose: (updated?: boolean) => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: brief.title || "",
    concept: brief.concept || "",
    placement: (brief as any).placement || "",
    colors: (brief as any).colors || "",
    deadline: brief.deadline || "",
    internal_notes: (brief as any).internal_notes || "",
    state: brief.state || "draft",
  });
  const [saving, setSaving] = useState(false);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [changed, setChanged] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [actionPending, setActionPending] = useState<PrimaryActionKind | null>(null);

  async function save(updates: any) {
    setSaving(true);
    await fetch("/api/art-briefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: brief.id, ...updates }),
    });
    setSaving(false);
    setSavedIndicator(true);
    setChanged(true);
    setTimeout(() => setSavedIndicator(false), 1200);
  }

  function handleBlur(field: string) {
    if ((form as any)[field] !== (brief as any)[field]) save({ [field]: (form as any)[field] });
  }

  async function handleArchive() {
    if (!window.confirm("Archive this design request? It'll disappear from the active list. You'll have 60 days to repurpose it before it's gone for good.")) return;
    const res = await fetch(`/api/art-briefs/${brief.id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    if (res.ok) onClose(true);
    else alert("Archive failed");
  }

  async function handleRecall() {
    if (!window.confirm("Recall this design request from the designer? It'll disappear from their portal and you'll need to re-send (to the same or a different designer). Blocked if they've already uploaded work.")) return;
    const res = await fetch(`/api/art-briefs/${brief.id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recall" }),
    });
    if (res.ok) {
      setSentAt(null);
      setAssignedDesignerId(null);
      setForm(p => ({ ...p, state: "draft" }));
      setChanged(true);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Recall failed");
    }
  }

  const ic = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" as const };
  const label = { fontSize: 10, fontWeight: 600 as const, color: T.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4, display: "block" };

  const context = brief.clients?.name || brief.jobs?.title || "Unlinked";
  const resolution = useMemo(() => resolveBrief({
    ...brief,
    state: form.state,
  }), [brief, form.state]);

  const [allFiles, setAllFiles] = useState<any[]>([]);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [designers, setDesigners] = useState<any[]>([]);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [assignedDesignerId, setAssignedDesignerId] = useState<string | null>((brief as any).assigned_designer_id || null);
  const [sentAt, setSentAt] = useState<string | null>((brief as any).sent_to_designer_at || null);

  // Derived: references subset (for annotation UI + uploads)
  const references = useMemo(() => allFiles.filter(f => f.kind === "reference"), [allFiles]);
  const hero = useMemo(() => {
    if (heroId) {
      const found = allFiles.find(f => f.id === heroId);
      if (found) return found;
    }
    return pickHeroFile(form.state, allFiles);
  }, [allFiles, heroId, form.state]);

  // Strip order: newest first, but keep references at the end so creative
  // work uploads get prominence.
  const stripFiles = useMemo(() => {
    const nonRef = allFiles.filter(f => f.kind !== "reference")
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const refs = allFiles.filter(f => f.kind === "reference")
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    return [...nonRef, ...refs];
  }, [allFiles]);

  useEffect(() => {
    const loadBrief = () => {
      fetch(`/api/art-briefs?id=${brief.id}`).then(r => r.json()).then(data => {
        if (data.brief) {
          setAssignedDesignerId(data.brief.assigned_designer_id || null);
          setSentAt(data.brief.sent_to_designer_at || null);
        }
        setAllFiles(data.files || []);
      });
    };
    loadBrief();
    fetch("/api/designers").then(r => r.json()).then(d => setDesigners((d.designers || []).filter((x: any) => x.active)));
    // Poll every 15s so designer uploads and client annotations propagate
    // live while the modal is open. (Designers list is static — no poll.)
    const interval = setInterval(loadBrief, 15000);
    return () => clearInterval(interval);
  }, [brief.id]);

  // Keep legacy refs used below ("finals" promote-final list)
  const finals = useMemo(() => allFiles.filter(f => f.kind === "final").sort((a, b) => (b.version || 0) - (a.version || 0)), [allFiles]);
  const wips = useMemo(() => allFiles.filter(f => f.kind === "wip").sort((a, b) => (b.version || 0) - (a.version || 0)), [allFiles]);

  const [hpdNote, setHpdNote] = useState("");
  const [hpdNoteSaved, setHpdNoteSaved] = useState("");

  // Init HPD's note editor when hero changes; on poll-driven annotation
  // updates, only sync if HPD has nothing typed (preserve in-progress edits).
  const lastInitHeroRef = useRef<string | null>(null);
  const hpdNoteSavedRef = useRef("");
  useEffect(() => { hpdNoteSavedRef.current = hpdNoteSaved; }, [hpdNoteSaved]);
  useEffect(() => {
    const saved = hero?.hpd_annotation || "";
    const currentHeroId = hero?.id || null;
    if (lastInitHeroRef.current !== currentHeroId) {
      lastInitHeroRef.current = currentHeroId;
      setHpdNote(saved);
      setHpdNoteSaved(saved);
      return;
    }
    if (saved !== hpdNoteSavedRef.current) {
      setHpdNote(prev => prev === hpdNoteSavedRef.current ? saved : prev);
      setHpdNoteSaved(saved);
    }
  }, [hero?.id, hero?.hpd_annotation]);

  async function runPrimaryAction(action: PrimaryActionKind) {
    if (action === "open") return;
    setActionPending(action);
    try {
      const res = await fetch(`/api/art-briefs/${brief.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed");
      } else {
        setForm(p => ({ ...p, state: data.to }));
        setChanged(true);
        setSendResult(`→ ${data.to.replace(/_/g, " ")}`);
        setTimeout(() => setSendResult(null), 2500);
      }
    } finally {
      setActionPending(null);
    }
  }

  async function promoteFinalToPrintReady(fileId: string) {
    setPromoting(fileId);
    const res = await fetch("/api/art-briefs/promote-final", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_file_id: fileId, brief_id: brief.id }),
    });
    const data = await res.json();
    setPromoting(null);
    if (data.success) {
      setSendResult(data.item_id ? "Promoted to print-ready on item ✓" : "Promoted (no item linked)");
      setChanged(true);
      setTimeout(() => setSendResult(null), 2500);
    } else {
      setSendResult(`Error: ${data.error}`);
      setTimeout(() => setSendResult(null), 3000);
    }
  }

  async function sendToDesigner(designerId: string) {
    setSending(true);
    const res = await fetch("/api/art-briefs/send-to-designer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: brief.id, designer_id: designerId }),
    });
    const data = await res.json();
    setSending(false);
    setShowSendModal(false);
    if (data.success) {
      setAssignedDesignerId(designerId);
      setSentAt(new Date().toISOString());
      setSendResult(data.emailed ? "Sent + email delivered" : "Sent (no email — set up email on designer)");
      setChanged(true);
      setTimeout(() => setSendResult(null), 3000);
    } else {
      setSendResult(`Error: ${data.error}`);
    }
  }

  async function copyIntakeLink() {
    const res = await fetch("/api/art-briefs/intake-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: brief.id }),
    });
    const data = await res.json();
    // Prefer the client-wide portal URL; fall back to per-brief intake
    const url = data.client_portal_token
      ? `${appBaseUrl()}/portal/client/${data.client_portal_token}`
      : (data.token ? `${appBaseUrl()}/art-intake/${data.token}` : null);
    if (url) {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  async function saveHpdAnnotation(fileId: string, annotation: string) {
    if (annotation === hpdNoteSaved) return;
    try {
      await fetch("/api/art-briefs/files", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: fileId, hpd_annotation: annotation }),
      });
      setHpdNoteSaved(annotation);
      // Keep local state in sync so re-focusing the file shows the latest value.
      setAllFiles(p => p.map(f => f.id === fileId ? { ...f, hpd_annotation: annotation || null } : f));
      setChanged(true);
    } catch {}
  }

  const refInputRef = useRef<HTMLInputElement>(null);
  const printInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRefs, setUploadingRefs] = useState(0);
  const [refUploadError, setRefUploadError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState("");
  // After a print-ready upload, show a "where to next?" card with the
  // file id so the two CTAs (new project / add to existing) can carry
  // the graphic forward.
  const [printReadyDestination, setPrintReadyDestination] = useState<{
    fileId: string;
    driveLink: string | null;
    driveFileId: string | null;
  } | null>(null);
  const [showAddToExisting, setShowAddToExisting] = useState(false);

  async function uploadFiles(files: File[], kind: "reference" | "print_ready") {
    if (!files.length) return;
    setUploadingRefs(files.length);
    setRefUploadError(null);
    let doneCount = 0;
    const newFiles: any[] = [];
    let printReadyResult: { fileId: string; driveLink: string | null; driveFileId: string | null } | null = null;
    let briefDelivered = false;
    const noteForBatch = uploadNote.trim();
    for (const file of files) {
      try {
        const sessionRes = await fetch("/api/art-briefs/upload-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brief_id: brief.id,
            file_name: file.name,
            mime_type: file.type || "application/octet-stream",
            kind,
          }),
        });
        if (!sessionRes.ok) {
          const err = await sessionRes.json().catch(() => ({}));
          throw new Error(err.error || "Could not start upload");
        }
        const { uploadUrl } = await sessionRes.json();

        const { drive_file_id } = await uploadFileToDriveSession(uploadUrl, file);

        const completeRes = await fetch("/api/art-briefs/upload-session/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brief_id: brief.id,
            drive_file_id,
            file_name: file.name,
            mime_type: file.type || "application/octet-stream",
            file_size: file.size,
            kind,
            note: noteForBatch || null,
          }),
        });
        if (!completeRes.ok) {
          const err = await completeRes.json().catch(() => ({}));
          throw new Error(err.error || "Could not register upload");
        }
        const data = await completeRes.json();
        if (data.file) {
          newFiles.push(data.file);
          if (kind === "print_ready") {
            printReadyResult = {
              fileId: data.file.id,
              driveLink: data.file.drive_link || null,
              driveFileId: data.file.drive_file_id || null,
            };
          }
        }
        if (data.delivered) briefDelivered = true;
      } catch (e: any) {
        setRefUploadError(e.message || "Upload failed");
      }
      doneCount++;
      setUploadingRefs(files.length - doneCount);
    }
    setUploadNote("");
    if (newFiles.length) {
      setAllFiles(p => [...p, ...newFiles]);
      setChanged(true);
    }
    if (briefDelivered) setForm(p => ({ ...p, state: "delivered" }));
    if (printReadyResult) setPrintReadyDestination(printReadyResult);
    setUploadingRefs(0);
  }

  async function deleteReference(fileId: string) {
    if (!confirm("Remove this reference?")) return;
    await fetch(`/api/art-briefs/files?id=${fileId}`, { method: "DELETE" });
    setAllFiles(p => p.filter(r => r.id !== fileId));
    setChanged(true);
  }

  const statusChip = STATE_LABELS[form.state] || { label: form.state, color: T.muted, bg: T.surface };
  const assignedDesigner = designers.find(d => d.id === assignedDesignerId);
  const designerName = assignedDesigner?.name || null;
  const next = hpdNextStep(form.state, { designerName });

  // State-driven HPD action bar — appears below the banner. Primary
  // actions are the ones that move the brief forward.
  const actionsForState: { label: string; kind: PrimaryActionKind; tone: "primary" | "secondary" | "warn" }[] = (() => {
    if (form.state === "draft") {
      return sentAt ? [] : [];
    }
    if (form.state === "wip_review") {
      return [
        { label: "Forward to client", kind: "forward_to_client", tone: "primary" },
        { label: "Send back as revision", kind: "request_revision", tone: "warn" },
      ];
    }
    if (form.state === "pending_prep" || form.state === "final_approved") {
      return [{ label: "Mark production-ready", kind: "mark_production_ready", tone: "primary" }];
    }
    if (form.state === "production_ready") {
      return [{ label: "Mark delivered", kind: "mark_delivered", tone: "primary" }];
    }
    return [];
  })();

  return (
    <div style={{ position: "fixed", inset: 0, background: T.card, zIndex: 100, display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* ── Header — title, plain badge, controls ── */}
        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {form.title || "Untitled design"}
              </div>
              <span style={{ color: statusChip.color, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {statusChip.label}
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {context}{brief.items?.name ? ` · ${brief.items.name}` : ""}
              {assignedDesigner && <> · Designer: <span style={{ color: T.text, fontWeight: 600 }}>{assignedDesigner.name}</span></>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {!sentAt && (
              <button onClick={() => setShowSendModal(true)}
                style={{ padding: "6px 14px", background: T.text, color: "#fff", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                Send to Designer
              </button>
            )}
            {sendResult && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>{sendResult}</span>}
            {savedIndicator && !sendResult && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>Saved</span>}
            <div style={{ position: "relative" }}>
              <button onClick={() => setAdminOpen(v => !v)}
                title="Admin"
                style={{ padding: "6px 10px", background: adminOpen ? T.surface : "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                ⚙
              </button>
              {adminOpen && (
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, width: 280, zIndex: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.08)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Admin</div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={label}>State override</label>
                    <select value={form.state}
                      onChange={e => { const v = e.target.value; setForm(p => ({ ...p, state: v })); save({ state: v }); }}
                      style={{ ...ic, cursor: "pointer" }}>
                      {Object.entries(STATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>
                      For unsticking edge cases only. Day-to-day transitions happen automatically.
                    </div>
                  </div>
                  <button onClick={copyIntakeLink}
                    style={{ width: "100%", padding: "6px 10px", background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: font, marginBottom: 10 }}>
                    {linkCopied ? "✓ Copied" : "Copy portal link"}
                  </button>
                  {sentAt && (
                    <button onClick={handleRecall}
                      style={{ width: "100%", padding: "6px 10px", background: "transparent", color: T.amber, border: `1px solid ${T.amber}55`, borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: font, marginBottom: 10 }}>
                      Recall from designer
                    </button>
                  )}
                  <button onClick={handleArchive}
                    style={{ width: "100%", padding: "6px 10px", background: "transparent", color: T.red, border: `1px solid ${T.red}55`, borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                    Archive brief
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => onClose(changed)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 22, padding: "0 6px", lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* State banner — HPD copy, plain colored text, no fill */}
        {next && (
          <div style={{ padding: "10px 22px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: next.tone === "action" ? T.amber : next.tone === "done" ? T.green : T.blue, fontWeight: 600 }}>
              {next.text}
            </div>
          </div>
        )}

        {/* Print-Ready hand-off — surfaces immediately after HPD uploads
            the print-ready file. Two CTAs propel the graphic into a
            production lifecycle (new job or attach to an existing one). */}
        {printReadyDestination && (
          <div style={{ padding: "12px 22px", background: T.greenDim, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              ✓ Print-Ready uploaded · Ready for production
            </div>
            <div style={{ fontSize: 12, color: T.text, marginBottom: 10 }}>
              Send this graphic into production. Pick a destination:
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  const params = new URLSearchParams();
                  if (brief.client_id) params.set("clientId", brief.client_id);
                  if (printReadyDestination.driveLink) params.set("driveLink", printReadyDestination.driveLink);
                  if (form.title) params.set("itemName", form.title);
                  router.push(`/jobs/new?${params.toString()}`);
                }}
                style={{ padding: "8px 16px", background: T.text, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                Create new project
              </button>
              <button
                onClick={() => setShowAddToExisting(true)}
                style={{ padding: "8px 16px", background: T.card, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                Add to existing project
              </button>
              <button
                onClick={() => setPrintReadyDestination(null)}
                style={{ padding: "8px 12px", background: "transparent", color: T.muted, border: "none", fontSize: 11, cursor: "pointer", fontFamily: font, marginLeft: "auto" }}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* State-driven action bar — shows the buttons for HPD's next move */}
        {actionsForState.length > 0 && (
          <div style={{ padding: "10px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {actionsForState.map(a => (
              <button
                key={a.kind}
                onClick={() => runPrimaryAction(a.kind)}
                disabled={actionPending !== null}
                style={{
                  padding: "8px 16px",
                  background: a.tone === "primary" ? T.green : a.tone === "warn" ? T.card : T.text,
                  color: a.tone === "warn" ? T.text : "#fff",
                  border: a.tone === "warn" ? `1px solid ${T.border}` : "none",
                  borderRadius: 6, fontSize: 12, fontWeight: 700,
                  cursor: actionPending ? "wait" : "pointer", fontFamily: font,
                  opacity: actionPending ? 0.6 : 1,
                }}>
                {actionPending === a.kind ? "Working…" : a.label}
              </button>
            ))}
          </div>
        )}

        {/* Body — single column scroll: brief editor → upload bar → files grid */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: T.surface, display: "flex", flexDirection: "column" }}>
          {/* Brief editor — Working Title + date, then concept */}
          <div style={{ padding: "12px 22px", background: T.card, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
              Working Title
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} onBlur={() => handleBlur("title")}
                placeholder="Working title" style={{ ...ic, fontSize: 14, fontWeight: 600 }} />
              <input type="date" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} onBlur={() => handleBlur("deadline")}
                style={ic} />
            </div>
            <textarea value={form.concept} onChange={e => setForm(p => ({ ...p, concept: e.target.value }))} onBlur={() => handleBlur("concept")}
              {...bulletHandlers(form.concept, (v) => setForm(p => ({ ...p, concept: v })))}
              placeholder="Concept — what is this design? Style, vibe, key elements." rows={3}
              style={{ ...ic, resize: "vertical", lineHeight: 1.4 }} />
          </div>

          {/* Upload bar — references + print-ready */}
          <div style={{ padding: "12px 22px", background: T.card, borderBottom: `1px solid ${T.border}`, flexShrink: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.12em" }}>Upload</div>
            <button onClick={() => refInputRef.current?.click()} disabled={uploadingRefs > 0}
              style={{ padding: "6px 12px", background: T.card, color: T.text, border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: uploadingRefs > 0 ? "not-allowed" : "pointer", fontFamily: font, opacity: uploadingRefs > 0 ? 0.5 : 1 }}>
              + Reference
            </button>
            <button onClick={() => printInputRef.current?.click()} disabled={uploadingRefs > 0}
              title="Upload production-ready file (separations, CMYK) — flips request to production_ready"
              style={{ padding: "6px 12px", background: T.green, color: "#fff", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: uploadingRefs > 0 ? "not-allowed" : "pointer", fontFamily: font, opacity: uploadingRefs > 0 ? 0.5 : 1 }}>
              + Print-Ready
            </button>
            <input value={uploadNote} onChange={e => setUploadNote(e.target.value)}
              placeholder="Note for the next upload (optional)"
              style={{ ...ic, flex: 1, minWidth: 200 }} />
            {uploadingRefs > 0 && <span style={{ fontSize: 11, color: T.blue, fontWeight: 600 }}>Uploading… {uploadingRefs} left</span>}
            {refUploadError && <span style={{ fontSize: 11, color: T.red, fontWeight: 600 }}>{refUploadError}</span>}
            <input ref={refInputRef} type="file" multiple style={{ display: "none" }}
              onChange={e => {
                const files = Array.from(e.target.files || []);
                uploadFiles(files, "reference");
                if (refInputRef.current) refInputRef.current.value = "";
              }} />
            <input ref={printInputRef} type="file" style={{ display: "none" }}
              onChange={e => {
                const files = Array.from(e.target.files || []);
                uploadFiles(files, "print_ready");
                if (printInputRef.current) printInputRef.current.value = "";
              }} />
          </div>

          {/* Files header + grid */}
          <div style={{ padding: "14px 22px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted }}>
              Files {allFiles.length > 0 && <span style={{ fontWeight: 400, color: T.faint }}>· {allFiles.length}</span>}
            </div>
          </div>
          {allFiles.length > 0 ? (
            <div style={{ padding: "0 22px 24px" }}>
              <ArtReferencesGrid
                files={allFiles as any}
                viewerRole="hpd"
                onPostComment={async (fileId, body) => {
                  const r = await fetch(`/api/art-briefs/${brief.id}/comments`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fileId, body }),
                  });
                  if (!r.ok) throw new Error("post failed");
                  const d = await r.json();
                  const saved = d?.comment;
                  setAllFiles(p => p.map(f => f.id === fileId ? {
                    ...f,
                    comments: [...((f as any).comments || []), saved],
                  } as any : f));
                  return saved;
                }}
                onDelete={async (fileId) => {
                  if (!window.confirm("Delete this file?")) return;
                  await fetch(`/api/art-briefs/files?id=${fileId}`, { method: "DELETE" });
                  setAllFiles(p => p.filter(f => f.id !== fileId));
                  setChanged(true);
                }}
                /* HPD can delete anything (per spec) */
                canDelete={() => true}
              />
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: T.faint, fontSize: 13 }}>
              No files yet — references can be uploaded above.
            </div>
          )}
        </div>
      </div>

      {/* Add-to-Existing-Project picker — surfaced after Print-Ready
          upload to attach the graphic to another active job for the
          same client. Picking a project creates a fresh item there
          with the graphic pre-attached, then jumps to that job. */}
      {showAddToExisting && printReadyDestination && brief.client_id && (
        <AddToExistingProjectModal
          clientId={brief.client_id}
          itemName={form.title || "Item"}
          driveLink={printReadyDestination.driveLink}
          driveFileId={printReadyDestination.driveFileId}
          onClose={() => setShowAddToExisting(false)}
        />
      )}

      {/* Send to Designer modal — unchanged */}
      {showSendModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowSendModal(false); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 440, maxWidth: "90vw" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0, marginBottom: 6 }}>Send Design Request to Designer</h3>
            <p style={{ fontSize: 12, color: T.muted, margin: 0, marginBottom: 16 }}>Designer will see this request in their dashboard. If they have an email set, they'll get a notification.</p>
            {designers.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.faint, background: T.surface, borderRadius: 8 }}>
                No active designers.<br/>
                <a href="/settings/designers" style={{ color: T.accent, textDecoration: "none" }}>Add one in Settings →</a>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {designers.map(d => (
                  <button key={d.id} onClick={() => sendToDesigner(d.id)} disabled={sending}
                    style={{ padding: "10px 14px", textAlign: "left", background: assignedDesignerId === d.id ? T.accentDim : T.surface, border: `1px solid ${assignedDesignerId === d.id ? T.accent : T.border}`, borderRadius: 8, cursor: "pointer", fontFamily: font, opacity: sending ? 0.5 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{d.name}</div>
                    <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{d.email || "No email"}</div>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowSendModal(false)} style={{ marginTop: 14, width: "100%", padding: "8px", background: "transparent", border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: font }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Request Modal ────────────────────────────────────────────────────
// Visual-first input: one request = many refs. Pick client + optional project,
// drop images, optionally name it. Creates ONE brief with N reference files.
type StagedFile = {
  id: string;
  file: File;
  previewUrl: string | null;
  status: "queued" | "uploading" | "done" | "error";
  errorMsg?: string;
};

function NewRequestModal({
  clients,
  onClose,
  onCreated,
}: {
  clients: Client[];
  onClose: () => void;
  onCreated: (brief: Brief | null) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [jobId, setJobId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: File[]) {
    if (!list.length) return;
    const staged = list.map(f => {
      const isImg = f.type.startsWith("image/");
      return {
        id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        file: f,
        previewUrl: isImg ? URL.createObjectURL(f) : null,
        status: "queued" as const,
      };
    });
    setFiles(prev => [...prev, ...staged]);
  }

  function removeFile(id: string) {
    setFiles(prev => {
      const match = prev.find(f => f.id === id);
      if (match?.previewUrl) URL.revokeObjectURL(match.previewUrl);
      return prev.filter(f => f.id !== id);
    });
  }

  useEffect(() => {
    return () => files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = !!clientId && files.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);

    const finalTitle = (title.trim() || "").slice(0, 200);

    // 1. Create the brief
    const briefRes = await fetch("/api/art-briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: finalTitle,
        client_id: clientId,
        job_id: jobId || null,
        concept: description.trim() || null,
        state: "draft",
      }),
    });
    const briefData = await briefRes.json();
    if (!briefRes.ok || !briefData.brief) {
      setErrorMsg(briefData.error || "Couldn't create the request");
      setSubmitting(false);
      return;
    }
    const brief: Brief = briefData.brief;

    // 2. Upload references one by one
    setProgress({ current: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "uploading" } : x));
      try {
        const fd = new FormData();
        fd.append("brief_id", brief.id);
        fd.append("file", f.file);
        fd.append("kind", "reference");
        const res = await fetch("/api/art-briefs/upload-reference", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "error", errorMsg: data.error || "Upload failed" } : x));
        } else {
          setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "done" } : x));
        }
      } catch (e: any) {
        setFiles(prev => prev.map(x => x.id === f.id ? { ...x, status: "error", errorMsg: e.message || "Upload failed" } : x));
      }
      setProgress({ current: i + 1, total: files.length });
    }

    setSubmitting(false);
    onCreated(brief);
    onClose();
  }

  const selectedClient = clients.find(c => c.id === clientId);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        onDragOver={e => { if (clientId) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          if (!clientId) return;
          e.preventDefault();
          setDragOver(false);
          addFiles(Array.from(e.dataTransfer.files || []));
        }}
        style={{
          background: T.card,
          border: `2px solid ${dragOver ? T.accent : T.border}`,
          borderRadius: 14,
          width: "88vw",
          maxWidth: 960,
          height: "86vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "border-color 0.1s",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFamily: font }}>New Request</div>
          <button onClick={onClose} disabled={submitting} style={{ background: "none", border: "none", color: T.muted, cursor: submitting ? "not-allowed" : "pointer", fontSize: 22, padding: "0 4px" }}>×</button>
        </div>

        {/* Top input row — minimal, compact */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "grid", gridTemplateColumns: "220px 1fr 1fr", gap: 12, alignItems: "center", background: T.surface }}>
          <select
            value={clientId}
            onChange={e => { setClientId(e.target.value); setJobId(""); }}
            disabled={submitting}
            autoFocus
            style={{
              padding: "9px 12px",
              fontSize: 13,
              borderRadius: 7,
              border: `1px solid ${clientId ? T.accent : T.border}`,
              background: clientId ? T.accentDim : T.card,
              color: T.text,
              outline: "none",
              fontFamily: font,
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: clientId ? 600 : 400,
            }}
          >
            <option value="">Select client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <ProjectPicker
            clientId={clientId}
            value={jobId}
            onChange={setJobId}
            disabled={submitting}
            label=""
            helperText=""
          />

          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={submitting}
            placeholder="Working title (optional)"
            style={{
              padding: "9px 12px",
              fontSize: 13,
              borderRadius: 7,
              border: `1px solid ${T.border}`,
              background: T.card,
              color: T.text,
              outline: "none",
              fontFamily: font,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Bullet notes — optional, auto-prefix • on each line */}
        <div style={{ padding: "10px 20px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onFocus={e => {
              if (!e.target.value) {
                const bullet = "• ";
                setDescription(bullet);
                // place caret after bullet
                setTimeout(() => { e.target.setSelectionRange(bullet.length, bullet.length); }, 0);
              }
            }}
            onKeyDown={e => {
              // Auto-add "• " on Enter
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const target = e.target as HTMLTextAreaElement;
                const pos = target.selectionStart;
                const before = description.slice(0, pos);
                const after = description.slice(pos);
                const insert = "\n• ";
                const newVal = before + insert + after;
                setDescription(newVal);
                setTimeout(() => { target.setSelectionRange(pos + insert.length, pos + insert.length); }, 0);
              }
            }}
            disabled={submitting}
            placeholder="Notes (optional) — one bullet per line"
            rows={3}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 12,
              borderRadius: 7,
              border: `1px solid ${T.border}`,
              background: T.card,
              color: T.text,
              outline: "none",
              fontFamily: font,
              resize: "vertical",
              boxSizing: "border-box",
              lineHeight: 1.5,
            }}
          />
        </div>

        {/* Visual area — the main real estate */}
        <div style={{ flex: 1, overflow: "auto", padding: 20, background: dragOver ? T.accentDim + "44" : "transparent" }}>
          {files.length === 0 ? (
            <div
              onClick={() => clientId && !submitting && inputRef.current?.click()}
              style={{
                height: "100%",
                minHeight: 320,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: 20,
                border: `2px dashed ${clientId ? (dragOver ? T.accent : T.border) : T.border}`,
                borderRadius: 14,
                background: clientId ? T.surface : T.surface + "88",
                cursor: clientId && !submitting ? "pointer" : "not-allowed",
                opacity: clientId ? 1 : 0.5,
                transition: "all 0.1s",
              }}
            >
              <div style={{ fontSize: 28, color: T.faint }}>⤴</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
                {clientId ? "Drop references here" : "Pick a client first"}
              </div>
              <div style={{ fontSize: 12, color: T.muted }}>
                {clientId ? "or click to browse · multi-select ok" : "then drop or select your reference images"}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {files.length} reference{files.length === 1 ? "" : "s"}
                </div>
                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={submitting}
                  style={{ padding: "6px 12px", background: "transparent", color: T.accent, border: `1px solid ${T.accent}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", fontFamily: font, opacity: submitting ? 0.5 : 1 }}
                >
                  + Add more
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                {files.map(f => (
                  <div
                    key={f.id}
                    style={{
                      position: "relative",
                      aspectRatio: "1/1",
                      background: T.card,
                      borderRadius: 8,
                      border: `1px solid ${f.status === "error" ? T.red + "77" : f.status === "done" ? T.green + "77" : T.border}`,
                      overflow: "hidden",
                    }}
                  >
                    {f.previewUrl ? (
                      <img
                        src={f.previewUrl}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.faint, fontSize: 11, padding: 10, textAlign: "center" }}>
                        {f.file.name.split(".").pop()?.toUpperCase() || "FILE"}
                      </div>
                    )}

                    {/* Status overlay */}
                    {f.status === "uploading" && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 600 }}>
                        Uploading…
                      </div>
                    )}
                    {f.status === "done" && (
                      <div style={{ position: "absolute", top: 6, right: 6, background: T.green, color: "#fff", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                        ✓
                      </div>
                    )}
                    {f.status === "error" && (
                      <div style={{ position: "absolute", inset: "auto 0 0 0", background: T.red, color: "#fff", padding: "4px 8px", fontSize: 10, fontWeight: 600 }}>
                        {f.errorMsg || "Failed"}
                      </div>
                    )}

                    {!submitting && f.status !== "done" && (
                      <button
                        onClick={() => removeFile(f.id)}
                        style={{ position: "absolute", top: 4, left: 4, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: 4, width: 20, height: 20, cursor: "pointer", fontSize: 13, lineHeight: 1 }}
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={e => {
              addFiles(Array.from(e.target.files || []));
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, background: T.surface }}>
          {errorMsg && <span style={{ fontSize: 11, color: T.red, fontWeight: 600 }}>{errorMsg}</span>}
          {progress && progress.current < progress.total && (
            <span style={{ fontSize: 11, color: T.muted }}>Uploading {progress.current}/{progress.total}…</span>
          )}
          {selectedClient && !errorMsg && !progress && files.length > 0 && (
            <span style={{ fontSize: 11, color: T.muted }}>
              → Filing under <strong style={{ color: T.text }}>{selectedClient.name}</strong>
              {jobId && " in selected project"}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, fontFamily: font, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "9px 22px",
              borderRadius: 6,
              border: "none",
              background: T.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: font,
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.4,
            }}
          >
            {submitting ? "Creating…" : `Create request${files.length ? ` · ${files.length}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add-to-Existing Project picker ──────────────────────────────────────
// Lists the client's active projects and, on selection, creates a fresh
// item under that project with the print-ready graphic pre-attached
// (items.drive_link + item_files at stage=print_ready). Then jumps to
// that job so HPD can finish setting up sizes/decoration on the new
// item. Used by the Art Studio Print-Ready hand-off flow.
function AddToExistingProjectModal({
  clientId, itemName, driveLink, driveFileId, onClose,
}: {
  clientId: string;
  itemName: string;
  driveLink: string | null;
  driveFileId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<{ id: string; title: string | null; job_number: string | null; phase: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, title, job_number, phase")
        .eq("client_id", clientId)
        .not("phase", "in", "(complete,cancelled)")
        .order("created_at", { ascending: false });
      setProjects((data as any) || []);
      setLoading(false);
    })();
  }, [clientId]);

  async function addToProject(jobId: string) {
    setAdding(jobId);
    try {
      const r = await fetch("/api/items/add-with-graphic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          name: itemName,
          drive_link: driveLink,
          drive_file_id: driveFileId,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        alert(err.error || "Failed to add");
        setAdding(null);
        return;
      }
      router.push(`/jobs/${jobId}`);
    } catch (e: any) {
      alert(e.message || "Failed");
      setAdding(null);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 480, maxWidth: "90vw", maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0, marginBottom: 6 }}>Add to Existing Project</h3>
        <p style={{ fontSize: 12, color: T.muted, margin: 0, marginBottom: 16 }}>
          Pick a project for this client. A new item will be created there with the print-ready graphic attached.
        </p>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.faint }}>Loading…</div>
          ) : projects.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.faint, background: T.surface, borderRadius: 8 }}>
              No active projects for this client.
            </div>
          ) : (
            projects.map(p => (
              <button key={p.id} onClick={() => addToProject(p.id)} disabled={adding !== null}
                style={{ padding: "10px 14px", textAlign: "left", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, cursor: adding ? "wait" : "pointer", fontFamily: font, opacity: adding && adding !== p.id ? 0.5 : 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.title || "Untitled project"}</div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                  {p.job_number || "no job #"} · {p.phase}
                  {adding === p.id && <span style={{ marginLeft: 8, color: T.blue }}>Adding…</span>}
                </div>
              </button>
            ))
          )}
        </div>
        <button onClick={onClose} disabled={adding !== null}
          style={{ marginTop: 14, width: "100%", padding: "8px", background: "transparent", border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: font }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

