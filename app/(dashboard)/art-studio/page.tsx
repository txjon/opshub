"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { ProjectPicker } from "@/components/ProjectPicker";
import {
  resolveBrief,
  sortYourMove,
  sortInFlight,
  matchesFilter,
  type Resolution,
  type FilterKey,
  type PrimaryActionKind,
} from "@/lib/art-studio-v2";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";

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
  thumbs?: Array<{ drive_file_id: string | null; drive_link: string | null }>;
  thumb_total?: number;
  thumb_file_id?: string | null;
  thumb_link?: string | null;
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

// Small colored dot — replaces the kanban stage column. Tooltip carries the
// literal state for the rare case anyone cares; day-to-day it's decoration.
function OwnerDot({ owner }: { owner: Resolution["owner"] }) {
  const color = owner === "hpd" ? T.accent
    : owner === "client" ? T.purple
    : owner === "designer" ? T.blue
    : T.green;
  const label = owner === "hpd" ? "Your move"
    : owner === "client" ? "With client"
    : owner === "designer" ? "With designer"
    : "Delivered";
  return (
    <div title={label} style={{
      width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0,
      boxShadow: "0 0 0 2px rgba(255,255,255,0.9), 0 0 0 3px rgba(0,0,0,0.06)",
    }} />
  );
}

// ─── BriefTile — the new image-first card ────────────────────────────────
// Replaces the nine-column kanban BriefCard. Shows mosaic + title + context
// + activity line + primary action (only in "Your move" sections).
function BriefTile({
  brief,
  resolution,
  variant = "large",
  onOpen,
  onAction,
  actionPending,
}: {
  brief: Brief;
  resolution: Resolution;
  variant?: "large" | "compact";
  onOpen: () => void;
  onAction: (kind: PrimaryActionKind) => void;
  actionPending?: PrimaryActionKind | null;
}) {
  const hasTitle = brief.title && brief.title.trim().length > 0;
  const context = brief.clients?.name || "Unlinked";
  const subContext = brief.jobs?.title || brief.items?.name || "";
  const dCount = brief.designer_message_count || 0;
  // Show primary action on Your move tiles + on aborted tiles (Repurpose)
  const showAction = !!resolution.primary
    && resolution.primary.action !== "open"
    && (resolution.section === "your_move" || resolution.isAborted);
  const pending = actionPending === resolution.primary?.action;

  return (
    <div
      onClick={onOpen}
      style={{
        background: T.card,
        border: resolution.hasUnreadClient
          ? `2px solid ${T.red}`
          : `1px solid ${resolution.urgency === "stale" ? T.amber + "77" : T.border}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        transition: "transform 0.08s, border-color 0.08s, box-shadow 0.08s",
        position: "relative",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = "none";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      {resolution.hasUnreadClient && (
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 2,
          padding: "4px 12px", borderRadius: 4,
          background: T.red, color: "#fff",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
          boxShadow: "0 2px 8px rgba(255, 50, 77, 0.35)",
        }}>NEW</div>
      )}
      {resolution.isAborted && (
        <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 4, background: T.red, color: "#fff", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", zIndex: 2 }}>
          ABORTED
        </div>
      )}
      <div style={{ opacity: resolution.isAborted ? 0.55 : 1 }}>
        <ImageMosaic
          thumbs={brief.thumbs || []}
          total={brief.thumb_total ?? (brief.thumbs?.length || 0)}
          aspect={variant === "compact" ? "1/1" : "4/3"}
        />
      </div>
      <div style={{ padding: variant === "compact" ? "8px 10px" : "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <OwnerDot owner={resolution.owner} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {hasTitle && (
              <div style={{
                fontSize: variant === "compact" ? 12 : 13,
                fontWeight: resolution.hasUnreadClient ? 800 : 700,
                color: T.text, lineHeight: 1.25,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {brief.title}
              </div>
            )}
            <div style={{
              fontSize: variant === "compact" ? 10 : 11,
              color: T.muted, marginTop: hasTitle ? 1 : 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {context}{subContext ? ` · ${subContext}` : ""}
            </div>
          </div>
          {dCount > 0 && (
            <span title={`${dCount} from designer`} style={{
              fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
              background: T.blueDim, color: T.blue, flexShrink: 0,
            }}>{dCount}</span>
          )}
        </div>

        {variant === "large" && (
          <div style={{
            fontSize: 11,
            color: resolution.hasUnreadClient ? T.red : (resolution.urgency === "action" ? T.text : T.muted),
            marginTop: 6, lineHeight: 1.3,
            fontWeight: resolution.hasUnreadClient ? 700 : (resolution.urgency === "action" ? 600 : 400),
          }}>
            {resolution.activity}
          </div>
        )}

        {brief.deadline && variant === "large" && (
          <div style={{ fontSize: 10, color: T.amber, marginTop: 3, fontWeight: 600 }}>
            Due {new Date(brief.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        )}

        {showAction && resolution.primary && (
          <button
            onClick={e => { e.stopPropagation(); onAction(resolution.primary!.action); }}
            disabled={pending}
            style={{
              marginTop: 10, width: "100%",
              padding: "7px 12px",
              background: pending ? T.accentDim : T.accent,
              color: pending ? T.muted : "#fff",
              border: "none", borderRadius: 5,
              fontSize: 11, fontWeight: 700, cursor: pending ? "wait" : "pointer",
              fontFamily: font,
            }}
          >
            {pending ? "Working…" : resolution.primary.label}
          </button>
        )}
      </div>
    </div>
  );
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
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [deliveredExpanded, setDeliveredExpanded] = useState(false);
  // Keyed by brief id so two tiles can never claim the spinner
  const [actionPending, setActionPending] = useState<Record<string, PrimaryActionKind | null>>({});

  useEffect(() => { loadBriefs(); loadClients(); }, []);

  // Deep-link: open brief from ?brief=id (set by notification bell)
  useEffect(() => {
    const briefId = params?.get("brief");
    if (!briefId || briefs.length === 0) return;
    const match = briefs.find(b => b.id === briefId);
    if (match && (!selectedBrief || selectedBrief.id !== briefId)) setSelectedBrief(match);
  }, [params, briefs]);

  async function loadBriefs() {
    setLoading(true);
    const res = await fetch("/api/art-briefs");
    const data = await res.json();
    setBriefs(data.briefs || []);
    setLoading(false);
  }

  async function loadClients() {
    const { data } = await supabase.from("clients").select("id, name").order("name");
    setClients(data || []);
  }

  // Resolve each brief once — section/owner/activity/primary-action
  const resolved = useMemo(
    () => briefs.map(b => ({ brief: b, res: resolveBrief(b) })),
    [briefs]
  );

  const allClients = useMemo(() => {
    const set = new Set<string>();
    briefs.forEach(b => b.clients?.name && set.add(b.clients.name));
    return Array.from(set).sort();
  }, [briefs]);

  // Base predicate: search + client filter (applied before section split)
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

  // Filter pills slice basePassed by section/owner
  const filtered = useMemo(
    () => basePassed.filter(({ res }) => matchesFilter(res, filter)),
    [basePassed, filter]
  );

  // Split into sections. Your-move uses deadline-weighted oldest ordering,
  // in-flight is newest-first, delivered matches in-flight.
  const yourMove = useMemo(() => {
    const list = filtered.filter(r => r.res.section === "your_move").map(r => r.brief);
    return sortYourMove(list).map(b => ({ brief: b, res: resolveBrief(b) }));
  }, [filtered]);

  const inFlight = useMemo(() => {
    const list = filtered.filter(r => r.res.section === "in_flight").map(r => r.brief);
    return sortInFlight(list).map(b => ({ brief: b, res: resolveBrief(b) }));
  }, [filtered]);

  const delivered = useMemo(() => {
    const list = filtered.filter(r => r.res.section === "delivered").map(r => r.brief);
    return sortInFlight(list).map(b => ({ brief: b, res: resolveBrief(b) }));
  }, [filtered]);

  // Section counts for the header (based on pill-filtered set, not section-filtered)
  const sectionCounts = useMemo(() => {
    // Match "All" pill's semantics (hides delivered)
    const visibleForAll = basePassed.filter(r => r.res.section !== "delivered");
    return {
      all: visibleForAll.length,
      your_move: basePassed.filter(r => r.res.section === "your_move").length,
      with_client: basePassed.filter(r => r.res.section === "in_flight" && r.res.owner === "client").length,
      with_designer: basePassed.filter(r => r.res.section === "in_flight" && r.res.owner === "designer").length,
      delivered: basePassed.filter(r => r.res.section === "delivered").length,
    };
  }, [basePassed]);

  async function runAction(brief: Brief, action: PrimaryActionKind) {
    if (action === "open") { setSelectedBrief(brief); return; }
    setActionPending(p => ({ ...p, [brief.id]: action }));
    try {
      const res = await fetch(`/api/art-briefs/${brief.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `Action ${action} failed`);
      } else {
        await loadBriefs();
      }
    } finally {
      setActionPending(p => ({ ...p, [brief.id]: null }));
    }
  }

  const totalVisible = yourMove.length + inFlight.length + (filter === "delivered" ? delivered.length : 0);

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Art Studio</h1>
          <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {sectionCounts.your_move > 0
              ? <><strong style={{ color: T.text }}>{sectionCounts.your_move}</strong> need your move</>
              : "Nothing needs your move."}
            {sectionCounts.with_client + sectionCounts.with_designer > 0 && (
              <> · <strong style={{ color: T.text }}>{sectionCounts.with_client + sectionCounts.with_designer}</strong> in flight</>
            )}
            {sectionCounts.delivered > 0 && (
              <> · {sectionCounts.delivered} delivered</>
            )}
          </p>
        </div>
        <button onClick={() => setShowNewRequest(true)}
          style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontFamily: font, fontWeight: 700, cursor: "pointer" }}>
          + New Request
        </button>
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <FilterPill label="All" count={sectionCounts.all} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterPill label="Your move" count={sectionCounts.your_move} active={filter === "your_move"} onClick={() => setFilter("your_move")} />
        <FilterPill label="With client" count={sectionCounts.with_client} active={filter === "with_client"} onClick={() => setFilter("with_client")} />
        <FilterPill label="With designer" count={sectionCounts.with_designer} active={filter === "with_designer"} onClick={() => setFilter("with_designer")} />
        <FilterPill label="Delivered" count={sectionCounts.delivered} active={filter === "delivered"} onClick={() => setFilter("delivered")} />
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

      {/* Content */}
      {loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Loading…</div>
      ) : briefs.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 40, textAlign: "center", fontSize: 13, color: T.faint }}>
          No requests yet. Click <strong>+ New Request</strong> to load some references.
        </div>
      ) : totalVisible === 0 && !(filter === "all" && delivered.length > 0) ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 30, textAlign: "center", fontSize: 12, color: T.faint }}>
          Nothing in this bucket.
        </div>
      ) : (
        <>
          {/* Your move — prominent, shown first */}
          {yourMove.length > 0 && (
            <Section
              title="Your move"
              count={yourMove.length}
              hint="HPD owns the next step"
              tone="action"
            >
              <TileGrid>
                {yourMove.map(({ brief, res }) => (
                  <BriefTile
                    key={brief.id}
                    brief={brief}
                    resolution={res}
                    variant="large"
                    onOpen={() => setSelectedBrief(brief)}
                    onAction={(kind) => runAction(brief, kind)}
                    actionPending={actionPending[brief.id] || null}
                  />
                ))}
              </TileGrid>
            </Section>
          )}

          {/* In flight — client or designer owns */}
          {inFlight.length > 0 && (
            <Section
              title="In flight"
              count={inFlight.length}
              hint="Waiting on client or designer"
              tone="neutral"
            >
              <TileGrid>
                {inFlight.map(({ brief, res }) => (
                  <BriefTile
                    key={brief.id}
                    brief={brief}
                    resolution={res}
                    variant="large"
                    onOpen={() => setSelectedBrief(brief)}
                    onAction={(kind) => runAction(brief, kind)}
                    actionPending={actionPending[brief.id] || null}
                  />
                ))}
              </TileGrid>
            </Section>
          )}

          {/* Delivered — collapsed by default unless filter = delivered */}
          {(filter === "delivered" || delivered.length > 0) && (
            <Section
              title="Delivered"
              count={delivered.length}
              hint="Closed loop — ready for product life"
              tone="muted"
              collapsible={filter !== "delivered"}
              expanded={filter === "delivered" || deliveredExpanded}
              onToggle={() => setDeliveredExpanded(x => !x)}
            >
              {(filter === "delivered" || deliveredExpanded) && (
                <TileGrid compact>
                  {delivered.map(({ brief, res }) => (
                    <BriefTile
                      key={brief.id}
                      brief={brief}
                      resolution={res}
                      variant="compact"
                      onOpen={() => setSelectedBrief(brief)}
                      onAction={(kind) => runAction(brief, kind)}
                      actionPending={actionPending[brief.id] || null}
                    />
                  ))}
                </TileGrid>
              )}
            </Section>
          )}
        </>
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
function hpdNextStep(state: string): {
  text: string;
  tone: "info" | "action" | "done";
  action?: { label: string; kind: "send_to_client" | "mark_production_ready" | "mark_delivered" | "upload_print_ready" };
} | null {
  if (state === "draft") {
    return { text: "Fill in the brief, then Send to Designer when ready.", tone: "info" };
  }
  if (state === "sent" || state === "in_progress") {
    return { text: "Designer is working. You'll see a WIP when they share.", tone: "info" };
  }
  if (state === "wip_review") {
    return { text: "Designer shared a WIP — take a look. Everyone can see it.", tone: "info" };
  }
  if (state === "client_review") {
    return { text: "Client is reviewing the draft. Wait for approve or revision request.", tone: "info" };
  }
  if (state === "revisions") {
    return { text: "Client requested changes — designer is handling it.", tone: "info" };
  }
  if (state === "final_approved" || state === "pending_prep") {
    return {
      text: "Client approved. Upload the Print-Ready file when prep is done.",
      tone: "action",
      action: { label: "+ Upload Print-Ready", kind: "upload_print_ready" },
    };
  }
  if (state === "production_ready") {
    return {
      text: "Print-Ready file is up. Ready to close this out.",
      tone: "action",
      action: { label: "Mark Delivered", kind: "mark_delivered" },
    };
  }
  if (state === "delivered") {
    return { text: "Complete.", tone: "done" };
  }
  return null;
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
    if (!window.confirm("Archive this brief? It'll disappear from the active list. You'll have 60 days to repurpose it before it's gone for good.")) return;
    const res = await fetch(`/api/art-briefs/${brief.id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    if (res.ok) onClose(true);
    else alert("Archive failed");
  }

  async function handleRecall() {
    if (!window.confirm("Recall this brief from the designer? It'll disappear from their portal and you'll need to re-send (to the same or a different designer). Blocked if they've already uploaded work.")) return;
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

  const context = brief.clients?.name || brief.jobs?.title || "Unlinked brief";
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
      ? `${window.location.origin}/portal/client/${data.client_portal_token}`
      : (data.token ? `${window.location.origin}/art-intake/${data.token}` : null);
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

  async function uploadFiles(files: File[], kind: "reference" | "print_ready") {
    if (!files.length) return;
    setUploadingRefs(files.length);
    setRefUploadError(null);
    let doneCount = 0;
    const newFiles: any[] = [];
    const noteForBatch = uploadNote.trim();
    for (const file of files) {
      try {
        // 1. Get a Drive upload session (server mints the URL)
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

        // 2. Upload bytes — tries direct-to-Drive, falls back to chunked proxy
        const { drive_file_id } = await uploadFileToDriveSession(uploadUrl, file);

        // 3. Register in OpsHub
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
        if (data.file) newFiles.push(data.file);
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
    setUploadingRefs(0);
  }

  async function deleteReference(fileId: string) {
    if (!confirm("Remove this reference?")) return;
    await fetch(`/api/art-briefs/files?id=${fileId}`, { method: "DELETE" });
    setAllFiles(p => p.filter(r => r.id !== fileId));
    setChanged(true);
  }

  const heroMeta = hero ? KIND_META[hero.kind] : null;
  const statusChip = STATE_LABELS[form.state] || { label: form.state, color: T.muted, bg: T.surface };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(changed); }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, width: "94vw", maxWidth: 1180, maxHeight: "94vh", display: "flex", flexDirection: "column", fontFamily: font, overflow: "hidden" }}>
        {/* ── Header ── */}
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {form.title || "Untitled Brief"}
              </div>
              {/* Status chip — read-only, rectangle w/ small radius per plan */}
              <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: statusChip.bg, color: statusChip.color, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>
                {statusChip.label}
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {context}{brief.items?.name ? ` · ${brief.items.name}` : ""}
              {" · "}
              <span style={{ color: T.text, fontWeight: 600 }}>{resolution.activity}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {/* Primary action (only when HPD owns next + action is not "open") */}
            {resolution.section === "your_move" && resolution.primary && resolution.primary.action !== "open" && (
              <button onClick={() => runPrimaryAction(resolution.primary!.action)}
                disabled={actionPending !== null}
                style={{ padding: "6px 14px", background: T.accent, color: "#fff", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: actionPending ? "wait" : "pointer", fontFamily: font, opacity: actionPending ? 0.6 : 1 }}>
                {actionPending ? "Working…" : resolution.primary.label}
              </button>
            )}
            {/* Send to Designer — only visible when not yet sent */}
            {!sentAt && (
              <button onClick={() => setShowSendModal(true)}
                style={{ padding: "6px 14px", background: T.text, color: T.bg, border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                Send to Designer
              </button>
            )}
            {sentAt && (
              <span style={{ fontSize: 10, padding: "4px 10px", background: T.greenDim, color: T.green, borderRadius: 4, fontWeight: 600 }}>
                ✓ Designer
              </span>
            )}
            {sendResult && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>{sendResult}</span>}
            {savedIndicator && !sendResult && <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>Saved</span>}

            {/* Admin gear — state override, delete, intake-send, etc */}
            <div style={{ position: "relative" }}>
              <button onClick={() => setAdminOpen(v => !v)}
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
            <button onClick={() => onClose(changed)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18, padding: "0 4px" }}>×</button>
          </div>
        </div>

        {/* What's next — orients HPD on who's blocking + surfaces the
            single most useful action for the current state. */}
        {(() => {
          const next = hpdNextStep(form.state);
          if (!next) return null;
          const tone = next.tone;
          const bg = tone === "action" ? T.amberDim : tone === "done" ? T.greenDim : T.blueDim;
          const border = tone === "action" ? T.amber + "55" : tone === "done" ? T.green + "55" : T.blue + "55";
          const textColor = tone === "action" ? T.amber : tone === "done" ? T.green : T.blue;
          return (
            <div style={{ padding: "10px 18px", background: bg, borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ flex: 1, fontSize: 12, color: textColor, fontWeight: 600 }}>
                {next.text}
              </div>
              {next.action && (
                <button
                  onClick={next.action.kind === "upload_print_ready"
                    ? () => printInputRef.current?.click()
                    : () => runPrimaryAction(next.action!.kind as PrimaryActionKind)}
                  disabled={actionPending !== null}
                  style={{ padding: "6px 14px", background: textColor, color: "#fff", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: actionPending ? "wait" : "pointer", fontFamily: font, opacity: actionPending ? 0.6 : 1, whiteSpace: "nowrap" }}>
                  {actionPending ? "Working…" : next.action.label}
                </button>
              )}
            </div>
          );
        })()}

        {/* ── Main body: hero+strip on left, chat on right ── */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 320px", gap: 0, overflow: "hidden", minHeight: 0 }}>
          {/* ── Left: hero + strip ── */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            {/* Hero — fixed height container, never shifts, never crops.
                clamp(480px, 60vh, 720px) = generous on any screen, capped. */}
            <div style={{
              height: "clamp(480px, 60vh, 720px)",
              flexShrink: 0,
              background: T.surface,
              position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
            }}>
              {hero ? (
                <>
                  <a href={hero.drive_link || "#"} target="_blank" rel="noopener noreferrer" style={{ display: "contents" }}>
                    <img
                      src={hero.drive_file_id ? `https://drive.google.com/thumbnail?id=${hero.drive_file_id}&sz=w1200` : ""}
                      referrerPolicy="no-referrer"
                      alt=""
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                      onError={e => (e.target as HTMLImageElement).style.display = "none"}
                    />
                  </a>
                  {heroMeta && (
                    <div style={{ position: "absolute", top: 12, left: 12, padding: "3px 9px", borderRadius: 4, background: heroMeta.bg, color: heroMeta.fg, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em" }}>
                      {heroMeta.short}{hero.version ? ` · v${hero.version}` : ""}
                    </div>
                  )}
                  {hero.file_name && (
                    <div style={{ position: "absolute", bottom: 12, left: 12, padding: "3px 9px", borderRadius: 4, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 10, fontFamily: mono }}>
                      {hero.file_name}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: "center", color: T.faint, fontSize: 12 }}>
                  No files yet — client or designer will upload as the brief moves forward
                </div>
              )}
            </div>

            {/* Strip + upload — takes remaining space, scrolls internally.
                Hero is fixed above; this absorbs the overflow. */}
            <div style={{ background: T.surface, borderTop: `1px solid ${T.border}`, padding: "10px 12px", flex: 1, overflowY: "auto", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  All files {stripFiles.length > 0 && <span style={{ fontWeight: 400, color: T.faint }}>· {stripFiles.length}</span>}
                </div>
                <div style={{ flex: 1 }} />
                {uploadingRefs > 0 && <span style={{ fontSize: 10, color: T.blue, fontWeight: 600 }}>Uploading… {uploadingRefs} left</span>}
                {refUploadError && <span style={{ fontSize: 10, color: T.red, fontWeight: 600 }}>{refUploadError}</span>}
                <button onClick={() => refInputRef.current?.click()} disabled={uploadingRefs > 0}
                  style={{ padding: "4px 10px", background: T.card, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: uploadingRefs > 0 ? "not-allowed" : "pointer", fontFamily: font, opacity: uploadingRefs > 0 ? 0.5 : 1 }}>
                  + Reference
                </button>
                <button onClick={() => printInputRef.current?.click()} disabled={uploadingRefs > 0}
                  title="Upload production-ready file (separations, CMYK) — flips brief to production_ready"
                  style={{ padding: "4px 10px", background: T.green, color: "#fff", border: "none", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: uploadingRefs > 0 ? "not-allowed" : "pointer", fontFamily: font, opacity: uploadingRefs > 0 ? 0.5 : 1 }}>
                  + Print-Ready
                </button>
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
              {/* Optional note — lands as HPD's annotation on uploaded refs */}
              <div style={{ marginBottom: 8 }}>
                <textarea value={uploadNote} onChange={e => setUploadNote(e.target.value)}
                  {...bulletHandlers(uploadNote, setUploadNote)}
                  placeholder="• Note for the next reference (optional)"
                  rows={2}
                  style={{ width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 4, fontSize: 11, fontFamily: font, outline: "none", background: T.card, color: T.text, lineHeight: 1.4, resize: "vertical", boxSizing: "border-box" }} />
              </div>
              {stripFiles.length === 0 ? (
                <div
                  onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = T.accent; }}
                  onDragLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.border; }}
                  onDrop={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = T.border; uploadFiles(Array.from(e.dataTransfer.files || []), "reference"); }}
                  onClick={() => refInputRef.current?.click()}
                  style={{ padding: 14, border: `2px dashed ${T.border}`, borderRadius: 6, textAlign: "center", fontSize: 11, color: T.faint, cursor: "pointer", background: T.card }}>
                  Drop reference images here or click <strong>+ Reference</strong>
                </div>
              ) : (
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); uploadFiles(Array.from(e.dataTransfer.files || []), "reference"); }}
                  style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                  {stripFiles.map(f => {
                    const meta = KIND_META[f.kind] || KIND_META.reference;
                    const isHero = hero?.id === f.id;
                    return (
                      <div key={f.id}
                        onClick={() => setHeroId(f.id)}
                        title={`${meta.short}${f.version ? ` v${f.version}` : ""} — ${f.file_name || ""}`}
                        style={{
                          width: 72, height: 72, flexShrink: 0,
                          background: "#fff", borderRadius: 4,
                          border: `2px solid ${isHero ? T.accent : T.border}`,
                          boxShadow: isHero ? `0 0 0 2px ${T.accent}44` : "none",
                          overflow: "hidden", position: "relative", cursor: "pointer",
                        }}>
                        <img
                          src={f.drive_file_id ? `https://drive.google.com/thumbnail?id=${f.drive_file_id}&sz=w200` : ""}
                          referrerPolicy="no-referrer"
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={e => (e.target as HTMLImageElement).style.display = "none"}
                        />
                        <div style={{ position: "absolute", top: 2, left: 2, padding: "1px 4px", borderRadius: 2, background: meta.bg, color: meta.fg, fontSize: 8, fontWeight: 700 }}>
                          {meta.short}
                        </div>
                        {f.kind === "reference" && (
                          <button onClick={e => { e.stopPropagation(); deleteReference(f.id); }}
                            style={{ position: "absolute", top: 2, right: 2, width: 16, height: 16, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontSize: 10, lineHeight: 1, padding: 0 }}>
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Promote final → print-ready (HPD's current mechanism) */}
              {hero?.kind === "final" && brief.item_id && (
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => promoteFinalToPrintReady(hero.id)} disabled={promoting === hero.id}
                    style={{ padding: "6px 14px", background: T.accent, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: promoting === hero.id ? 0.5 : 1 }}>
                    {promoting === hero.id ? "Promoting…" : "→ Print-Ready"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Brief (editable top) + Notes on hero (flex middle) ── */}
          <div style={{ borderLeft: `1px solid ${T.border}`, background: T.card, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            {/* Brief — editable, scrolls if long */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, flexShrink: 0, maxHeight: "50%", overflowY: "auto", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Brief
              </div>
              <div>
                <label style={label}>Title</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} onBlur={() => handleBlur("title")} style={ic} />
              </div>
              <div>
                <label style={label}>Concept (for designer)</label>
                <textarea rows={3} value={form.concept} onChange={e => setForm(p => ({ ...p, concept: e.target.value }))} onBlur={() => handleBlur("concept")}
                  {...bulletHandlers(form.concept, (v) => setForm(p => ({ ...p, concept: v })))}
                  style={{ ...ic, resize: "vertical", lineHeight: 1.4 }} placeholder="• Creative direction" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={label}>Deadline</label>
                  <input type="date" value={form.deadline || ""} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} onBlur={() => handleBlur("deadline")} style={ic} />
                </div>
                <div>
                  <label style={label}>Placement</label>
                  <input value={form.placement} onChange={e => setForm(p => ({ ...p, placement: e.target.value }))} onBlur={() => handleBlur("placement")} style={ic} placeholder="Full back" />
                </div>
              </div>
              <div>
                <label style={label}>Colors</label>
                <input value={form.colors} onChange={e => setForm(p => ({ ...p, colors: e.target.value }))} onBlur={() => handleBlur("colors")} style={ic} placeholder="2c — white, red" />
              </div>
              <div>
                <label style={{ ...label, color: T.amber }}>Internal Notes (HPD only)</label>
                <textarea rows={2} value={form.internal_notes} onChange={e => setForm(p => ({ ...p, internal_notes: e.target.value }))} onBlur={() => handleBlur("internal_notes")}
                  {...bulletHandlers(form.internal_notes, (v) => setForm(p => ({ ...p, internal_notes: v })))}
                  style={{ ...ic, resize: "vertical", lineHeight: 1.4, borderColor: T.amber + "44" }} placeholder="• Scratch pad, private" />
              </div>
            </div>

            {/* Notes on the current hero */}
            <div style={{ padding: "14px 16px", flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Notes on this image
              </div>
              {!hero ? (
                <div style={{ fontSize: 12, color: T.faint, fontStyle: "italic" }}>Pick a file to see + add notes.</div>
              ) : (
                <>
                  {hero.client_annotation && (
                    <div style={{ padding: "8px 12px", background: T.purpleDim, border: `1px solid ${T.purple}55`, borderRadius: 4 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.purple, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Client</div>
                      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{hero.client_annotation}</div>
                    </div>
                  )}
                  {hero.designer_annotation && (
                    <div style={{ padding: "8px 12px", background: T.blueDim, border: `1px solid ${T.blue}55`, borderRadius: 4 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Designer</div>
                      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{hero.designer_annotation}</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>HPD note</div>
                    <textarea
                      value={hpdNote}
                      onChange={e => setHpdNote(e.target.value)}
                      onBlur={() => saveHpdAnnotation(hero.id, hpdNote)}
                      {...bulletHandlers(hpdNote, setHpdNote)}
                      placeholder={hero.kind === "reference" ? "• HPD note to designer" : "• Internal note"}
                      rows={4}
                      style={{ width: "100%", padding: "8px 10px", border: `1px solid ${T.amber}55`, borderRadius: 4, background: T.amberDim + "33", color: T.text, fontFamily: font, outline: "none", fontSize: 12, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Send to Designer modal — unchanged */}
      {showSendModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowSendModal(false); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 440, maxWidth: "90vw" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0, marginBottom: 6 }}>Send Brief to Designer</h3>
            <p style={{ fontSize: 12, color: T.muted, margin: 0, marginBottom: 16 }}>Designer will see this brief in their dashboard. If they have an email set, they'll get a notification.</p>
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

