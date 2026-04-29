"use client";
// Three-bucket Labs Command Center renderer. Client component so cards
// can be dismissed locally — dismissed IDs persist in localStorage
// (per-browser, not per-user-account; "for now" — share-across-team
// would need a server table). Click X on any card to hide it; the
// header shows a small "N dismissed · undo" link to bring them back.
//
// Visual language matches the /command-center-v2 mockup approved Apr 27.
//
// Action queue only — no vanity KPIs (those live on their domain
// pages + the owner's insights), no billing column (that's its own
// page now).

import { useEffect, useState } from "react";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";

export type Urgency = "critical" | "action" | "watch" | "ok";

export type BucketCard = {
  id: string;
  title: string;
  subtitle: string;
  meta?: string;
  /** "invoice" gets visually stronger treatment than "job" — invoice
   *  numbers are the business reference clients quote back at us, so
   *  they read first when they exist. */
  metaKind?: "invoice" | "job";
  badge?: string;
  urgency: Urgency;
  href?: string;
  /** When present, clicking the card opens a per-revision modal
   *  (mockup thumbnail + client message + link into Proofs tab)
   *  instead of just navigating to the job. Used for revision cards. */
  revision?: {
    jobId: string;
    itemId: string;
    itemName: string;
    notes: string | null;
    href: string;
  };
};

export type BucketSection = { title: string; cards: BucketCard[] };

export type BucketPayload = {
  key: "clients" | "decorators" | "designers";
  label: string;
  hint: string;
  sections: BucketSection[];
};

const URGENCY: Record<Urgency, { color: string; bg: string }> = {
  critical: { color: T.red, bg: T.redDim },
  action:   { color: T.amber, bg: T.amberDim },
  watch:    { color: T.blue, bg: T.blueDim },
  ok:       { color: T.muted, bg: T.surface },
};

function sectionTone(cards: BucketCard[]): Urgency {
  const order: Record<Urgency, number> = { critical: 0, action: 1, watch: 2, ok: 3 };
  return cards.reduce<Urgency>(
    (best, c) => (order[c.urgency] < order[best] ? c.urgency : best),
    "ok",
  );
}

const STORAGE_KEY = "cc_dismissed_v1";

export function CommandCenterBuckets({ buckets }: { buckets: BucketPayload[] }) {
  // Dismissed-card IDs — populated from localStorage on mount.
  // First render uses empty set so server and client agree (no
  // hydration mismatch); second render hides whatever was in storage.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [revisionView, setRevisionView] = useState<BucketCard["revision"] | null>(null);
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw) setDismissed(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  function dismiss(id: string) {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }
  function clearDismissed() {
    setDismissed(new Set());
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  // Strip dismissed cards, then strip empty sections.
  const visibleBuckets: BucketPayload[] = buckets.map(b => ({
    ...b,
    sections: b.sections
      .map(s => ({ ...s, cards: s.cards.filter(c => !dismissed.has(c.id)) }))
      .filter(s => s.cards.length > 0),
  }));

  const allCards = visibleBuckets.flatMap(b => b.sections).flatMap(s => s.cards);
  const critical = allCards.filter(c => c.urgency === "critical").length;
  const actions = allCards.filter(c => c.urgency === "action").length;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: font, color: T.text, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>Command Center</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>{today}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, fontWeight: 700 }}>
          {critical > 0 && (
            <span style={{ color: T.red }}>
              {critical} critical
            </span>
          )}
          {actions > 0 && (
            <span style={{ color: T.amber }}>
              {actions} actions
            </span>
          )}
          {dismissed.size > 0 && (
            <button onClick={clearDismissed}
              style={{ background: "transparent", border: "none", padding: 0, color: T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, textDecoration: "underline" }}>
              {dismissed.size} dismissed · restore
            </button>
          )}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 16,
        alignItems: "start",
      }}>
        {visibleBuckets.map(b => <BucketColumn key={b.key} bucket={b} onDismiss={dismiss} onOpenRevision={setRevisionView} />)}
      </div>
      {revisionView && <RevisionPreviewModal payload={revisionView} onClose={() => setRevisionView(null)} />}
    </div>
  );
}

function BucketColumn({ bucket, onDismiss, onOpenRevision }: { bucket: BucketPayload; onDismiss: (id: string) => void; onOpenRevision: (r: BucketCard["revision"]) => void }) {
  const total = bucket.sections.reduce((sum, s) => sum + s.cards.length, 0);
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em" }}>
          {bucket.label}
        </h2>
        <span style={{ color: T.faint, fontSize: 11, fontWeight: 700 }}>{total}</span>
      </div>
      <div style={{ fontSize: 10, color: T.muted, marginTop: -2 }}>
        {bucket.hint}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>
        {bucket.sections.length === 0 && (
          <div style={{
            padding: "20px 8px", textAlign: "center",
            color: T.faint, fontSize: 11, fontStyle: "italic",
          }}>
            All clear
          </div>
        )}
        {bucket.sections.map(section => {
          const tone = sectionTone(section.cards);
          const t = URGENCY[tone];
          return (
            <div key={section.title}>
              <div style={{
                display: "inline-flex", alignItems: "baseline", gap: 6,
                marginBottom: 4, paddingLeft: 2,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
                  color: t.color,
                }}>
                  {section.title}
                </span>
                <span style={{
                  color: t.color,
                  fontSize: 10, fontWeight: 800,
                }}>
                  {section.cards.length}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {section.cards.map(c => <CardRow key={c.id} card={c} onDismiss={onDismiss} onOpenRevision={onOpenRevision} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CardRow({ card, onDismiss, onOpenRevision }: { card: BucketCard; onDismiss: (id: string) => void; onOpenRevision: (r: BucketCard["revision"]) => void }) {
  const u = URGENCY[card.urgency];
  const isUrgent = card.urgency === "critical" || card.urgency === "action";
  const [hovered, setHovered] = useState(false);

  const handleDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDismiss(card.id);
  };

  // Wrap with a relative container so the dismiss X can sit absolutely
  // inside the row without disrupting the existing grid layout.
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative" }}
    >
      <CardLink card={card} onOpenRevision={onOpenRevision}>
        {isUrgent && (
          <span style={{
            position: "absolute", left: 0, top: 8, bottom: 8,
            width: 2, borderRadius: 2,
            background: u.color,
          }} />
        )}
        <div style={{
          fontSize: 12.5, fontWeight: isUrgent ? 700 : 600,
          color: T.text,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
          lineHeight: 1.3,
          minWidth: 0,
        }}>
          {card.title}
        </div>
        <div style={{
          fontSize: card.metaKind === "invoice" ? 11 : 9,
          color: card.metaKind === "invoice" ? T.text : T.faint,
          fontWeight: card.metaKind === "invoice" ? 700 : 400,
          fontFamily: mono,
          alignSelf: "start", whiteSpace: "nowrap",
          marginTop: 1,
          // Leave room for the X on hover so the meta doesn't jump.
          paddingRight: hovered ? 18 : 0,
          transition: "padding-right 0.1s",
        }}>
          {card.meta || ""}
        </div>
        <div style={{
          fontSize: 11, color: T.muted, fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          minWidth: 0,
        }}>
          {card.subtitle}
        </div>
        <div style={{ alignSelf: "center", whiteSpace: "nowrap" }}>
          {card.badge && (
            <span style={{
              color: u.color,
              fontSize: 9, fontWeight: 800, letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}>
              {card.badge}
            </span>
          )}
        </div>
      </CardLink>
      {/* Dismiss X — visible on hover. Outside the Link so it doesn't
          navigate. preventDefault + stopPropagation on click for safety. */}
      <button
        onClick={handleDismiss}
        title="Dismiss this card"
        aria-label="Dismiss"
        style={{
          position: "absolute", top: 6, right: 4,
          width: 18, height: 18, padding: 0,
          background: hovered ? T.surface : "transparent",
          border: "none", borderRadius: 4,
          color: T.faint, fontSize: 13, lineHeight: 1,
          cursor: "pointer",
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.1s, background 0.1s",
          fontFamily: font,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.text; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.faint; }}
      >
        ×
      </button>
    </div>
  );
}

function CardLink({ card, children, onOpenRevision }: { card: BucketCard; children: React.ReactNode; onOpenRevision: (r: BucketCard["revision"]) => void }) {
  const baseStyle: React.CSSProperties = {
    borderTop: `1px solid ${T.border}`,
    padding: "8px 4px 8px 10px",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    columnGap: 8,
    rowGap: 1,
    position: "relative",
    color: T.text,
    textDecoration: "none",
  };
  if (card.revision) {
    return (
      <button
        onClick={() => onOpenRevision(card.revision)}
        style={{ ...baseStyle, background: "none", border: "none", borderTop: `1px solid ${T.border}`, cursor: "pointer", textAlign: "left", fontFamily: font, width: "100%" }}>
        {children}
      </button>
    );
  }
  if (card.href) {
    return <Link href={card.href} style={baseStyle}>{children}</Link>;
  }
  return <div style={baseStyle}>{children}</div>;
}

// Per-revision preview modal — fetched proof thumbnail + client message
// + link into the Proofs tab where the user can regenerate.
function RevisionPreviewModal({ payload, onClose }: { payload: NonNullable<BucketCard["revision"]>; onClose: () => void }) {
  const [proofFile, setProofFile] = useState<{ drive_file_id: string; file_name: string; notes?: string | null; created_at?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/files?itemId=${payload.itemId}`);
        if (!r.ok) { if (!cancelled) setLoading(false); return; }
        const d = await r.json();
        // Prefer the mockup image — that's what the team revises. Falls back
        // to the latest proof if no mockup is on file. Then to any image.
        const all = (d.files || []) as any[];
        const sortDesc = (arr: any[]) => [...arr].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        const file =
          sortDesc(all.filter(f => f.stage === "mockup"))[0] ||
          sortDesc(all.filter(f => f.stage === "proof"))[0] ||
          null;
        // Pull the client message from the latest revision-requested proof
        const revisedProof = sortDesc(all.filter(f => f.stage === "proof" && f.approval === "revision_requested"))[0];
        if (!cancelled) {
          setProofFile(file ? { ...file, notes: revisedProof?.notes ?? file.notes } : null);
          setLoading(false);
        }
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [payload.itemId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prefer the proof-file's own notes (the client-typed message on the
  // file approval) over the alert's revisionNotes — they're the same when
  // both exist, but the file row is the source of truth.
  const message = (proofFile?.notes || payload.notes || "").trim();

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, width: "100%", maxWidth: 560, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.red, letterSpacing: "0.06em", textTransform: "uppercase" }}>Revision requested</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{payload.itemName}</div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 6px" }}>✕</button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          {loading && <div style={{ fontSize: 12, color: T.muted, textAlign: "center", padding: 20 }}>Loading proof…</div>}
          {!loading && proofFile?.drive_file_id && (
            <a href={`/api/files/thumbnail?id=${proofFile.drive_file_id}`} target="_blank" rel="noopener noreferrer"
              style={{ background: "#000", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", maxHeight: 360 }}>
              <img src={`/api/files/thumbnail?id=${proofFile.drive_file_id}&thumb=1`} alt={proofFile.file_name}
                style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain" }} />
            </a>
          )}
          {!loading && !proofFile && (
            <div style={{ fontSize: 12, color: T.faint, fontStyle: "italic", padding: "12px 0", textAlign: "center" }}>No proof file found for this item.</div>
          )}

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Client message</div>
            <div style={{ fontSize: 13, color: T.text, background: T.surface, borderRadius: 6, padding: "10px 12px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {message || <span style={{ color: T.faint, fontStyle: "italic" }}>No message included.</span>}
            </div>
          </div>
        </div>

        <div style={{ padding: "10px 16px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 8, background: T.surface }}>
          <button onClick={onClose}
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: "pointer", fontFamily: font }}>
            Close
          </button>
          <Link href={payload.href}
            style={{ background: T.text, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, padding: "6px 14px", cursor: "pointer", fontFamily: font, textDecoration: "none" }}>
            Open in Proofs →
          </Link>
        </div>
      </div>
    </div>
  );
}
