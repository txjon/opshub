"use client";
import { useState, useEffect } from "react";
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
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>House Party Distro</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{data.client.name} · Design Studio</div>
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

      {openBrief && <BriefDetailModal brief={openBrief} meta={clientStateFor(openBrief)} onClose={() => setOpenBrief(null)} />}
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

      <div style={{ aspectRatio: "4/3", background: thumb ? "#000" : C.surface, position: "relative", overflow: "hidden" }}>
        {thumb ? (
          <img src={thumb} alt="" loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={(e: any) => { e.target.style.display = "none"; }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
            No preview yet
          </div>
        )}
        <div style={{ position: "absolute", top: 10, left: 10, padding: "3px 10px", borderRadius: 99, background: meta.bg, color: meta.color, fontSize: 10, fontWeight: 700, border: `1px solid ${meta.border}` }}>
          {meta.label}
        </div>
        {brief.thumb_total > 1 && (
          <div style={{ position: "absolute", bottom: 10, right: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: C.mono }}>
            +{brief.thumb_total - 1}
          </div>
        )}
      </div>

      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

function BriefDetailModal({ brief, meta, onClose }: { brief: Brief; meta: ReturnType<typeof clientStateFor>; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 14, maxWidth: 900, width: "100%", maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
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

        {/* Body */}
        <div style={{ overflow: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Images */}
          {brief.thumbs.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
              {brief.thumbs.map((t, i) => {
                const fullUrl = t.drive_file_id ? `/api/files/thumbnail?id=${t.drive_file_id}` : null;
                const thumbMed = t.drive_file_id ? `/api/files/thumbnail?id=${t.drive_file_id}&thumb=1` : null;
                return (
                  <a key={i} href={fullUrl || "#"} target="_blank" rel="noopener noreferrer"
                    style={{ display: "block", aspectRatio: "1", background: "#000", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
                    {thumbMed && (
                      <img src={thumbMed} alt="" loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        onError={(e: any) => { e.target.style.display = "none"; }} />
                    )}
                  </a>
                );
              })}
            </div>
          )}

          {/* Notes */}
          {brief.concept && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Notes</div>
              <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                {brief.concept}
              </div>
            </div>
          )}

          {!brief.concept && brief.thumbs.length === 0 && (
            <div style={{ color: C.faint, fontSize: 13, fontStyle: "italic", padding: "20px 0", textAlign: "center" }}>
              HPD is still setting this up — more details coming soon.
            </div>
          )}
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
