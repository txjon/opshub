// Three-bucket Labs Command Center renderer. Server-rendered.
// Takes a bucket-shaped payload (clients / decorators / designers),
// each with sub-sectioned cards. Visual language matches the
// /command-center-v2 mockup that was approved Apr 27.
//
// Action queue only — no vanity KPIs (those live on their domain
// pages + the owner's insights), no billing column (that's its own
// page now).

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

export function CommandCenterBuckets({ buckets }: { buckets: BucketPayload[] }) {
  const allCards = buckets.flatMap(b => b.sections).flatMap(s => s.cards);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {critical > 0 && (
            <span style={{ background: T.redDim, color: T.red, padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
              {critical} critical
            </span>
          )}
          {actions > 0 && (
            <span style={{ background: T.amberDim, color: T.amber, padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
              {actions} actions
            </span>
          )}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 16,
        alignItems: "start",
      }}>
        {buckets.map(b => <BucketColumn key={b.key} bucket={b} />)}
      </div>
    </div>
  );
}

function BucketColumn({ bucket }: { bucket: BucketPayload }) {
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
                display: "inline-flex", alignItems: "center", gap: 5,
                marginBottom: 4, paddingLeft: 2,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase",
                  color: t.color,
                }}>
                  {section.title}
                </span>
                <span style={{
                  background: t.bg, color: t.color,
                  fontSize: 9, fontWeight: 800,
                  padding: "1px 6px", borderRadius: 99,
                  lineHeight: 1.4,
                }}>
                  {section.cards.length}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {section.cards.map(c => <CardRow key={c.id} card={c} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CardRow({ card }: { card: BucketCard }) {
  const u = URGENCY[card.urgency];
  const isUrgent = card.urgency === "critical" || card.urgency === "action";
  const inner = (
    <>
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
        alignSelf: "center", whiteSpace: "nowrap",
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
    </>
  );

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

  if (card.href) {
    return <Link href={card.href} style={baseStyle}>{inner}</Link>;
  }
  return <div style={baseStyle}>{inner}</div>;
}
