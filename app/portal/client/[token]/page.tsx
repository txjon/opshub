"use client";
import Link from "next/link";
import { useClientPortal } from "./_shared/context";
import { C, daysUntil, fmtDate } from "./_shared/theme";
import { clientStateFor, isDoneForClient } from "./_shared/state-labels";

// Overview — the default landing tab. High-level stats + a recent activity
// feed stitched from briefs (and eventually orders, once that poll lands).

export default function OverviewPage() {
  const { data, token } = useClientPortal();
  if (!data) return null;

  const base = `/portal/client/${token}`;
  const briefs = data.briefs;
  const unreadCount = briefs.filter(b => b.has_unread_external).length;
  const activeBriefsCount = briefs.filter(b => !isDoneForClient(b)).length;
  const summary = data.orders_summary || { active_count: 0, delivered_recent_count: 0, unpaid_count: 0, next_ship_date: null };

  // Sort briefs newest-activity-first for the feed
  const recentBriefs = [...briefs]
    .sort((a, b) => (b.last_activity_at || b.updated_at || "").localeCompare(a.last_activity_at || a.updated_at || ""))
    .slice(0, 8);

  return (
    <div>
      {/* Stat strip — 4 metric boxes, responsive grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12, marginBottom: 24,
      }}>
        <StatCard
          href={`${base}/designs`}
          label="Designs with updates"
          value={unreadCount}
          hint={unreadCount === 0 ? "All caught up" : "Tap to review"}
          accent={unreadCount > 0 ? C.purple : C.muted}
        />
        <StatCard
          href={`${base}/designs`}
          label="Active designs"
          value={activeBriefsCount}
          hint={activeBriefsCount === 0 ? "No active work" : "In flight"}
          accent={C.text}
        />
        <StatCard
          href={`${base}/orders`}
          label="Active orders"
          value={summary.active_count}
          hint={summary.next_ship_date ? `Next ship: ${fmtDate(summary.next_ship_date)}` : "—"}
          accent={C.text}
        />
        <StatCard
          href={`${base}/orders?filter=unpaid`}
          label="Unpaid invoices"
          value={summary.unpaid_count}
          hint={summary.unpaid_count === 0 ? "Nothing due" : "Tap to review"}
          accent={summary.unpaid_count > 0 ? C.amber : C.muted}
        />
      </div>

      {/* Recent activity */}
      <section style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: "20px 24px",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Recent activity</h2>
          <Link href={`${base}/designs`} style={{
            fontSize: 12, color: C.muted, textDecoration: "none",
            fontWeight: 600,
          }}>
            See all designs →
          </Link>
        </div>

        {recentBriefs.length === 0 ? (
          <div style={{
            padding: "28px 12px", textAlign: "center",
            color: C.muted, fontSize: 13,
          }}>
            No activity yet. HPD will send you a link when something's ready to review.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {recentBriefs.map((b, i) => {
              const meta = clientStateFor(b);
              const due = daysUntil(b.deadline);
              return (
                <Link key={b.id} href={`${base}/designs?brief=${b.id}`}
                  style={{
                    display: "flex", gap: 14, alignItems: "center",
                    padding: "12px 0",
                    borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
                    textDecoration: "none", color: C.text,
                    minHeight: 56,
                  }}>
                  {/* NEW badge OR state dot */}
                  {b.has_unread_external ? (
                    <div style={{
                      width: 42, minWidth: 42, textAlign: "center",
                      padding: "3px 6px", background: C.purple, color: "#fff",
                      fontSize: 9, fontWeight: 800, letterSpacing: "0.06em",
                      borderRadius: 3,
                    }}>NEW</div>
                  ) : (
                    <div style={{
                      width: 42, minWidth: 42, display: "flex", justifyContent: "center",
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: 99, background: meta.color,
                      }} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: b.has_unread_external ? 700 : 600,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {b.title || "Untitled design"}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {b.preview_line || meta.label}
                      {due && <span style={{ color: due.color, marginLeft: 8 }}>· {due.text}</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>
                    {b.last_activity_at ? fmtDate(b.last_activity_at) : ""}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ href, label, value, hint, accent }: {
  href: string; label: string; value: number; hint: string; accent: string;
}) {
  return (
    <Link href={href} style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "16px 18px",
      textDecoration: "none", color: C.text,
      display: "flex", flexDirection: "column", gap: 4,
      transition: "border-color 0.15s",
      minHeight: 88,
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = accent; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{
        fontSize: 10, color: C.muted, fontWeight: 700,
        letterSpacing: "0.08em", textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: accent, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.muted }}>
        {hint}
      </div>
    </Link>
  );
}
