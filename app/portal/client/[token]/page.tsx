"use client";
import Link from "next/link";
import { useClientPortal } from "./_shared/context";
import { C, daysUntil, fmtDate } from "./_shared/theme";
import { clientStateFor, isDoneForClient } from "./_shared/state-labels";

// Overview — the hub's front page, editorial shop treatment (Jul 20 2026):
// client name as the hero, needs-you line, big numerals over hairlines
// instead of system stat cards, then the activity feed. Same data as the
// old card layout — presentation only.

export default function OverviewPage() {
  const { data, token } = useClientPortal();
  if (!data) return null;

  const base = `/portal/client/${token}`;
  const briefs = data.briefs;
  const unreadCount = briefs.filter(b => b.has_unread_external).length;
  const activeBriefsCount = briefs.filter(b => !isDoneForClient(b)).length;
  const summary = data.orders_summary || { active_count: 0, delivered_recent_count: 0, unpaid_count: 0, next_ship_date: null };

  const recentBriefs = [...briefs]
    .sort((a, b) => (b.last_activity_at || b.updated_at || "").localeCompare(a.last_activity_at || a.updated_at || ""))
    .slice(0, 8);

  const needsYou: { label: string; href: string }[] = [];
  if (unreadCount > 0) needsYou.push({ label: `${unreadCount} design${unreadCount === 1 ? "" : "s"} to review`, href: `${base}/designs` });
  if (summary.unpaid_count > 0) needsYou.push({ label: `${summary.unpaid_count} unpaid invoice${summary.unpaid_count === 1 ? "" : "s"}`, href: `${base}/orders?filter=unpaid` });

  const stats: { label: string; value: number; hint: string; href: string; accent?: string }[] = [
    { label: "Active orders", value: summary.active_count, hint: summary.next_ship_date ? `Next ship ${fmtDate(summary.next_ship_date)}` : "In motion", href: `${base}/orders` },
    { label: "Active designs", value: activeBriefsCount, hint: activeBriefsCount === 0 ? "Studio quiet" : "In the studio", href: `${base}/designs` },
    { label: "Design updates", value: unreadCount, hint: unreadCount === 0 ? "All caught up" : "Tap to review", href: `${base}/designs`, accent: unreadCount > 0 ? C.purple : undefined },
    { label: "Unpaid invoices", value: summary.unpaid_count, hint: summary.unpaid_count === 0 ? "Nothing due" : "Tap to review", href: `${base}/orders?filter=unpaid`, accent: summary.unpaid_count > 0 ? C.amber : undefined },
  ];

  return (
    <div style={{ paddingTop: "clamp(8px, 3vw, 28px)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .ov-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border-top:1px solid ${C.border}}
        @media(min-width:720px){.ov-stats{grid-template-columns:repeat(4,1fr)}}
        .ov-stat{border-bottom:1px solid ${C.border};padding:22px 4px 20px;text-decoration:none;display:block;transition:background .15s}
        .ov-stat:hover{background:${C.card}}
      ` }} />

      {/* Hero — the client's name, the website way */}
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>
        Welcome back
      </div>
      <h1 style={{ fontSize: "clamp(30px,6.5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 12px", textWrap: "balance" as any }}>
        {data.client.name}.
      </h1>

      {/* Needs-you line */}
      {needsYou.length > 0 ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "0 0 30px" }}>
          {needsYou.map(n => (
            <Link key={n.label} href={n.href}
              style={{ background: "#fff", color: C.bg, borderRadius: 999, padding: "10px 20px", fontSize: 11, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", textDecoration: "none" }}>
              {n.label} →
            </Link>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 14, color: C.muted, margin: "0 0 30px", lineHeight: 1.6 }}>
          All caught up. Here&rsquo;s where everything stands.
        </div>
      )}

      {/* Stat band — big numerals over hairlines */}
      <div className="ov-stats" style={{ marginBottom: 34 }}>
        {stats.map(s => (
          <Link key={s.label} href={s.href} className="ov-stat">
            <div style={{ fontSize: 9.5, fontWeight: 800, color: C.faint, letterSpacing: "0.14em", textTransform: "uppercase" }}>{s.label}</div>
            <div style={{ fontSize: "clamp(30px,4vw,44px)", fontWeight: 900, color: s.accent || C.text, lineHeight: 1.05, marginTop: 6, fontFamily: C.font, letterSpacing: "-0.02em" }}>{s.value}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{s.hint}</div>
          </Link>
        ))}
      </div>

      {/* Recent activity */}
      <section>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>The latest.</h2>
          <Link href={`${base}/designs`} style={{ fontSize: 10.5, color: C.muted, textDecoration: "none", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            All designs →
          </Link>
        </div>

        {recentBriefs.length === 0 ? (
          <div style={{ padding: "28px 0", color: C.muted, fontSize: 13 }}>
            No activity yet. We&rsquo;ll send you a link when something&rsquo;s ready to review.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {recentBriefs.map((b) => {
              const meta = clientStateFor(b);
              const due = daysUntil(b.deadline);
              return (
                <Link key={b.id} href={`${base}/designs?brief=${b.id}`}
                  style={{
                    display: "flex", gap: 14, alignItems: "center",
                    padding: "13px 0",
                    borderBottom: `1px solid ${C.border}`,
                    textDecoration: "none", color: C.text,
                    minHeight: 56,
                  }}>
                  {b.has_unread_external ? (
                    <div style={{ width: 42, minWidth: 42, textAlign: "center", padding: "3px 6px", background: C.purple, color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", borderRadius: 3 }}>NEW</div>
                  ) : (
                    <div style={{ width: 42, minWidth: 42, display: "flex", justifyContent: "center" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: meta.color }} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: b.has_unread_external ? 800 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {b.title || "Untitled design"}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
                      {b.preview_line || meta.label}
                      {due && <span style={{ color: due.color, marginLeft: 8 }}>· {due.text}</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.faint, whiteSpace: "nowrap", fontFamily: C.mono }}>
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
