"use client";

// Mockup — Command Center reorganized into the three conversations Jon's
// team actually has: clients, decorators, designers. Static sample data,
// live theme tokens. Compare side-by-side with /dashboard. Not linked
// from nav; navigate by URL.

import Link from "next/link";
import { T, font, mono } from "@/lib/theme";

type Urgency = "critical" | "action" | "watch" | "ok";

type Card = {
  id: string;
  title: string;
  subtitle: string;        // smaller line — what to do or what's waiting
  meta?: string;            // right-aligned ref (job #, brief #, etc.)
  badge?: string;           // small chip like "7d over" / "ships 1d"
  urgency: Urgency;
  href?: string;
};

type Bucket = {
  key: "clients" | "decorators" | "designers";
  label: string;
  /** Plain-English single-line read of the bucket's overall state. */
  hint: string;
  /** Sub-sectioned cards. Most-urgent sub-section first; cards within
   *  sorted by urgency too. */
  sections: { title: string; cards: Card[] }[];
};

// ── Sample data — modeled after Jon's screenshot ────────────────────────
const SAMPLE: Bucket[] = [
  {
    key: "clients",
    label: "Clients",
    hint: "1 past ship · 2 new leads · 2 awaiting client review",
    sections: [
      {
        title: "Past ship date",
        cards: [
          {
            id: "c1",
            title: "HPD Web — House Party Labs Heat Transfer Hat Sample",
            subtitle: "7 days past ship date · client follow-up",
            meta: "4170",
            badge: "7d over",
            urgency: "critical",
          },
        ],
      },
      {
        title: "New leads",
        cards: [
          {
            id: "c2",
            title: "Fez",
            subtitle: "New client — create project",
            urgency: "action",
          },
          {
            id: "c3",
            title: "Superior Defense",
            subtitle: "New client — create project",
            urgency: "action",
          },
        ],
      },
      {
        title: "Awaiting client review",
        cards: [
          {
            id: "c4",
            title: "FOG — Halo Tee Sample",
            subtitle: "1st draft sent · 2d ago",
            meta: "4198",
            urgency: "watch",
          },
          {
            id: "c5",
            title: "13th Heaven — A-13 Patch",
            subtitle: "Proof sent · 1d ago",
            meta: "4226",
            urgency: "watch",
          },
        ],
      },
    ],
  },
  {
    key: "decorators",
    label: "Decorators",
    hint: "2 POs to send · 28 in production · 3 ship-status to verify",
    sections: [
      {
        title: "PO past ship date",
        cards: [
          {
            id: "d1",
            title: "Forward Observations Group — Green F Hats / Totes / RT",
            subtitle: "Send PO · FCX, MB",
            meta: "4191",
            badge: "7d over",
            urgency: "critical",
          },
        ],
      },
      {
        title: "Order blanks",
        cards: [
          {
            id: "d2",
            title: "Forward Observations Group — In Stock Belts/Flags",
            subtitle: "Order blanks · 5 items",
            meta: "3682",
            urgency: "action",
          },
          {
            id: "d3",
            title: "13th Heaven — A-13 Patch Restock",
            subtitle: "Order blanks · 1 item",
            meta: "4226",
            urgency: "action",
          },
        ],
      },
      {
        title: "Verify shipping",
        cards: [
          {
            id: "d4",
            title: "HPD Web — Squid Snapback Sample",
            subtitle: "Ships in 1d — verify status",
            meta: "4227",
            badge: "1d",
            urgency: "action",
          },
          {
            id: "d5",
            title: "Privateer Group — Apr '26 Pre Order",
            subtitle: "Ships in 2d — verify status",
            meta: "4215",
            badge: "2d",
            urgency: "watch",
          },
          {
            id: "d6",
            title: "Spiritus Systems — Wolf Icon Tee Restock",
            subtitle: "Ships in 2d — verify status",
            meta: "4216",
            badge: "2d",
            urgency: "watch",
          },
        ],
      },
      {
        title: "At decorator",
        cards: [
          {
            id: "d7",
            title: "ICON",
            subtitle: "14 jobs in production",
            urgency: "ok",
          },
          {
            id: "d8",
            title: "TEELAND — EMB",
            subtitle: "6 jobs in production",
            urgency: "ok",
          },
          {
            id: "d9",
            title: "STOKED",
            subtitle: "4 jobs in production",
            urgency: "ok",
          },
          {
            id: "d10",
            title: "SCORP / MB / 1 STOP",
            subtitle: "4 jobs combined",
            urgency: "ok",
          },
        ],
      },
    ],
  },
  {
    key: "designers",
    label: "Designers",
    hint: "1 awaiting your review · 2 in design",
    sections: [
      {
        title: "Awaiting HPD review",
        cards: [
          {
            id: "ds1",
            title: "13th Heaven — Mexi Test",
            subtitle: "Designer uploaded 1st Draft · 1d",
            badge: "Review",
            urgency: "action",
          },
        ],
      },
      {
        title: "In design",
        cards: [
          {
            id: "ds2",
            title: "FOG — Halo Hoodie",
            subtitle: "With designer · 2d",
            urgency: "watch",
          },
          {
            id: "ds3",
            title: "Privateer — Patch Set",
            subtitle: "Revisions · with designer",
            urgency: "watch",
          },
        ],
      },
      {
        title: "Final → Print prep",
        cards: [
          {
            id: "ds4",
            title: "Spiritus — Wolf Icon",
            subtitle: "Designer uploaded final · prep print-ready",
            badge: "Prep",
            urgency: "action",
          },
        ],
      },
    ],
  },
];

const URGENCY: Record<Urgency, { color: string; bg: string }> = {
  critical: { color: T.red, bg: T.redDim },
  action:   { color: T.amber, bg: T.amberDim },
  watch:    { color: T.blue, bg: T.blueDim },
  ok:       { color: T.muted, bg: T.surface },
};

export default function CommandCenterV2() {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const totalCritical = SAMPLE.flatMap(b => b.sections).flatMap(s => s.cards).filter(c => c.urgency === "critical").length;
  const totalActions = SAMPLE.flatMap(b => b.sections).flatMap(s => s.cards).filter(c => c.urgency === "action").length;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: font, color: T.text, padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>Command Center</div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>{today} · v2 mockup</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {totalCritical > 0 && (
            <span style={{ background: T.redDim, color: T.red, padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
              {totalCritical} critical
            </span>
          )}
          {totalActions > 0 && (
            <span style={{ background: T.amberDim, color: T.amber, padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
              {totalActions} actions
            </span>
          )}
          <Link href="/dashboard" style={{ marginLeft: 8, padding: "6px 12px", border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11, color: T.muted, textDecoration: "none", fontWeight: 600 }}>
            ← Live dashboard
          </Link>
        </div>
      </div>

      {/* Three-column buckets — tightened from 360 to 300 so all three
          fit at typical desktop widths. With only 3 children, auto-fit
          naturally collapses any extra slots on wider screens. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 16,
        alignItems: "start",
      }}>
        {SAMPLE.map(bucket => (
          <BucketColumn key={bucket.key} bucket={bucket} />
        ))}
      </div>

      <div style={{ marginTop: 32, padding: "12px 16px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
        <strong style={{ color: T.text }}>Mockup notes:</strong> three columns map to the three
        conversations the team has — Clients, Decorators, Designers. Per-column
        stats are queue counts (actionable), not vanity rollups. Cards
        sub-sectioned and sorted by urgency (critical → action → watch → ok).
        Vanity KPIs (projects / items / units / prints) and Billing
        intentionally absent — they belong on their respective pages.
        Static sample data — wire real queries once the structure feels right.
      </div>
    </div>
  );
}

function BucketColumn({ bucket }: { bucket: Bucket }) {
  const total = bucket.sections.reduce((sum, s) => sum + s.cards.length, 0);
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      {/* Column header — bucket name + count + plain-English read on
          one tight block. Inbox-style: title + small meta, no chrome. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em" }}>
          {bucket.label}
        </h2>
        <span style={{
          color: T.faint,
          fontSize: 11, fontWeight: 700,
        }}>
          {total}
        </span>
      </div>
      <div style={{ fontSize: 10, color: T.muted, marginTop: -2 }}>
        {bucket.hint}
      </div>

      {/* Sections + rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
        {bucket.sections.map(section => (
          <div key={section.title}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.faint, marginBottom: 3, paddingLeft: 2 }}>
              {section.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {section.cards.map(c => <CardRow key={c.id} card={c} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardRow({ card }: { card: Card }) {
  const u = URGENCY[card.urgency];
  return (
    <div style={{
      borderTop: `1px solid ${T.border}`,
      padding: "6px 4px 6px 8px",
      display: "flex", alignItems: "center", gap: 8,
      cursor: card.href ? "pointer" : "default",
      position: "relative",
      minHeight: 36,
    }}>
      {/* urgency dot — small, on the left, replaces the heavy left border */}
      <span style={{
        flexShrink: 0,
        width: 6, height: 6, borderRadius: 99,
        background: u.color,
      }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: T.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flexShrink: 1, minWidth: 0,
        }}>
          {card.title}
        </span>
        <span style={{
          fontSize: 11, color: u.color, fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flexShrink: 1, minWidth: 0,
        }}>
          · {card.subtitle}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
        {card.badge && (
          <span style={{
            color: u.color,
            fontSize: 9, fontWeight: 800, letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            {card.badge}
          </span>
        )}
        {card.meta && (
          <span style={{ fontSize: 9, color: T.faint, fontFamily: mono }}>
            {card.meta}
          </span>
        )}
      </div>
    </div>
  );
}
