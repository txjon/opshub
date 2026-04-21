import { createClient } from "@/lib/supabase/server";
import { T, font, mono } from "@/lib/theme";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Job = any;
type Item = any;

export default async function DistroDashboard() {
  const supabase = await createClient();

  // Active warehouse-relevant jobs (non-drop-ship, not complete/cancelled/on_hold)
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, job_number, phase, shipping_route, fulfillment_status, fulfillment_tracking, target_ship_date, type_meta, clients(name), items(id, name, pipeline_stage, pipeline_timestamps, received_at_hpd, received_at_hpd_at, ship_tracking, ship_qtys, received_qtys, receiving_data, decorator_assignments(decorators(short_code, name)), buy_sheet_lines(qty_ordered))")
    .not("phase", "in", '("complete","cancelled","on_hold")')
    .not("shipping_route", "eq", "drop_ship")
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const allJobs: Job[] = jobs || [];
  const allItems: Item[] = allJobs.flatMap(j => j.items || []);

  // Active fulfillment projects (separate from jobs — standalone stage projects)
  const { data: fulfillmentProjects } = await supabase
    .from("fulfillment_projects")
    .select("id, name, status, source_job_id, fulfillment_daily_logs(log_date, orders_shipped, remaining_orders, created_at)")
    .in("status", ["staging", "active"])
    .order("created_at", { ascending: false });

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfDay.getTime() + 7 * 86400000);
  const msPerDay = 86400000;
  const daysBetween = (a: Date | string, b: Date | string) =>
    Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);

  // ── Incoming (in transit from decorator to HPD)
  const incomingByJob: { job: Job; items: Item[] }[] = [];
  for (const j of allJobs) {
    const items = (j.items || []).filter((it: Item) => it.pipeline_stage === "shipped" && !it.received_at_hpd);
    if (items.length > 0) incomingByJob.push({ job: j, items });
  }
  // Today vs this week vs overdue
  const incomingToday = incomingByJob.filter(g => g.items.some((it: Item) =>
    it.pipeline_timestamps?.shipped && daysBetween(it.pipeline_timestamps.shipped, now) <= 3
  )).length;

  // ── Ready to ship out (ship_through, all items received, not yet shipped)
  const readyToShip: Job[] = allJobs.filter(j =>
    j.shipping_route === "ship_through" &&
    (j.items || []).length > 0 &&
    (j.items || []).every((it: Item) => it.received_at_hpd) &&
    j.fulfillment_status !== "shipped"
  );

  // ── Fulfillment: stage-route jobs with all items received (inventory parked at HPD)
  const stagedJobs: Job[] = allJobs.filter(j =>
    j.shipping_route === "stage" &&
    (j.items || []).length > 0 &&
    (j.items || []).every((it: Item) => it.received_at_hpd) &&
    j.fulfillment_status !== "shipped"
  );

  const activeFulfillmentCount = (fulfillmentProjects || []).length + stagedJobs.length;

  // ── Staged inventory total (units)
  const stagedUnits = stagedJobs.reduce((a, j) =>
    a + (j.items || []).reduce((b: number, it: Item) => {
      const rec = it.received_qtys || {};
      const recTotal = Object.values(rec).reduce((x: number, q: any) => x + (Number(q) || 0), 0);
      return b + (recTotal || 0);
    }, 0), 0
  );

  // ── Outgoing today (items in ship_through or stage with a ship date today or earlier that haven't shipped)
  const outgoingToday = readyToShip.filter(j => {
    if (!j.target_ship_date) return false;
    return new Date(j.target_ship_date) <= endOfWeek;
  }).length;

  // ── Exceptions: variance + damaged
  type Exception = { jobId: string; jobTitle: string; clientName: string; itemName: string; kind: "variance" | "damage" | "stuck"; detail: string };
  const exceptions: Exception[] = [];
  for (const j of allJobs) {
    const clientName = (j.clients as any)?.name || "Unknown";
    for (const it of (j.items || [])) {
      // Variance: received_qtys total < ordered (when received)
      if (it.received_at_hpd && it.buy_sheet_lines?.length) {
        const ordered = it.buy_sheet_lines.reduce((s: number, l: any) => s + (l.qty_ordered || 0), 0);
        const receivedTotal = Object.values(it.received_qtys || {}).reduce((s: number, q: any) => s + (Number(q) || 0), 0);
        if (ordered > 0 && receivedTotal > 0 && receivedTotal < ordered) {
          exceptions.push({
            jobId: j.id, jobTitle: j.title, clientName,
            itemName: it.name,
            kind: "variance",
            detail: `${receivedTotal}/${ordered} received`,
          });
        }
      }
      // Damage: receiving_data.condition = "damaged"
      const cond = (it.receiving_data as any)?.condition;
      if (cond === "damaged" || cond === "partial_damage") {
        exceptions.push({
          jobId: j.id, jobTitle: j.title, clientName,
          itemName: it.name,
          kind: "damage",
          detail: (it.receiving_data as any)?.notes || "Flagged damaged on arrival",
        });
      }
      // Stuck: shipped 7+ days ago, still not received
      if (it.pipeline_stage === "shipped" && !it.received_at_hpd && it.pipeline_timestamps?.shipped) {
        const daysShipped = daysBetween(it.pipeline_timestamps.shipped, now);
        if (daysShipped >= 7) {
          exceptions.push({
            jobId: j.id, jobTitle: j.title, clientName,
            itemName: it.name,
            kind: "stuck",
            detail: `Shipped ${daysShipped}d ago, no receipt confirmation`,
          });
        }
      }
    }
  }

  // ── Format helpers
  const fmtDate = (d: string | null) => {
    if (!d) return "no date";
    const date = new Date(d);
    const dd = Math.ceil((date.getTime() - now.getTime()) / msPerDay);
    if (dd < 0) return `${Math.abs(dd)}d overdue`;
    if (dd === 0) return "today";
    if (dd === 1) return "tomorrow";
    if (dd <= 7) return `${dd}d`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const fmtDateColor = (d: string | null) => {
    if (!d) return T.muted;
    const dd = Math.ceil((new Date(d).getTime() - now.getTime()) / msPerDay);
    if (dd < 0) return T.red;
    if (dd <= 3) return T.amber;
    return T.muted;
  };

  // ── Render ──
  const card: any = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 };
  const kpiCard: any = { ...card, padding: "14px 16px", textAlign: "center" };

  const kpis = [
    { label: "Incoming this week", value: incomingToday, color: T.amber, href: "/receiving" },
    { label: "Outgoing this week", value: outgoingToday, color: T.green, href: "/shipping" },
    { label: "Exceptions", value: exceptions.length, color: exceptions.length > 0 ? T.red : T.faint, href: null },
    { label: "Staged Units", value: stagedUnits.toLocaleString(), color: T.purple, href: "/fulfillment" },
    { label: "Fulfillment Active", value: activeFulfillmentCount, color: T.accent, href: "/fulfillment" },
  ];

  return (
    <div style={{ fontFamily: font, color: T.text, padding: "20px 24px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Distro Dashboard</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
          {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · Warehouse operations
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
        {kpis.map(kpi => {
          const inner = (
            <div style={{ ...kpiCard, cursor: kpi.href ? "pointer" : "default" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: kpi.color, fontFamily: mono }}>{kpi.value}</div>
              <div style={{ fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>{kpi.label}</div>
            </div>
          );
          return kpi.href
            ? <Link key={kpi.label} href={kpi.href} style={{ textDecoration: "none" }}>{inner}</Link>
            : <div key={kpi.label}>{inner}</div>;
        })}
      </div>

      {/* 3-column work board */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>

        {/* ── Incoming ── */}
        <div style={{ ...card, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.muted }}>Incoming</span>
            <Link href="/receiving" style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.amber, textDecoration: "none" }}>{incomingByJob.length}</Link>
          </div>
          {incomingByJob.length === 0 ? (
            <div style={{ fontSize: 11, color: T.faint, padding: "12px 4px", textAlign: "center" }}>Nothing expected</div>
          ) : incomingByJob.slice(0, 8).map(({ job, items }) => {
            const decorators = [...new Set(items.flatMap((it: Item) =>
              (it.decorator_assignments || []).map((da: any) => da.decorators?.short_code || da.decorators?.name)
            ).filter(Boolean))];
            const shipped = items.find((it: Item) => it.pipeline_timestamps?.shipped);
            const shippedDaysAgo = shipped ? daysBetween(shipped.pipeline_timestamps.shipped, now) : null;
            return (
              <Link key={job.id} href={`/receiving`} style={{ textDecoration: "none", color: T.text }}>
                <div style={{ padding: "8px 10px", marginBottom: 6, background: T.surface, borderRadius: 6, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>
                    {(job.clients as any)?.name || "—"} · {job.title}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                    {items.length} item{items.length !== 1 ? "s" : ""}
                    {decorators.length > 0 && ` · from ${decorators.join(", ")}`}
                    {shippedDaysAgo !== null && ` · shipped ${shippedDaysAgo}d ago`}
                  </div>
                </div>
              </Link>
            );
          })}
          {incomingByJob.length > 8 && (
            <Link href="/receiving" style={{ display: "block", textAlign: "center", fontSize: 10, color: T.muted, padding: "6px 0" }}>+{incomingByJob.length - 8} more</Link>
          )}
        </div>

        {/* ── Ready to Ship ── */}
        <div style={{ ...card, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.muted }}>Ready to Ship Out</span>
            <Link href="/shipping" style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.green, textDecoration: "none" }}>{readyToShip.length}</Link>
          </div>
          {readyToShip.length === 0 ? (
            <div style={{ fontSize: 11, color: T.faint, padding: "12px 4px", textAlign: "center" }}>Nothing ready</div>
          ) : readyToShip.slice(0, 8).map(j => {
            const itemCount = (j.items || []).length;
            const totalUnits = (j.items || []).reduce((a: number, it: Item) =>
              a + Object.values(it.received_qtys || {}).reduce((x: number, q: any) => x + (Number(q) || 0), 0), 0);
            return (
              <Link key={j.id} href="/shipping" style={{ textDecoration: "none", color: T.text }}>
                <div style={{ padding: "8px 10px", marginBottom: 6, background: T.surface, borderRadius: 6, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>
                    {(j.clients as any)?.name || "—"} · {j.title}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                    {itemCount} item{itemCount !== 1 ? "s" : ""} · {totalUnits.toLocaleString()}u
                    <span style={{ color: fmtDateColor(j.target_ship_date), marginLeft: 6 }}>· ship {fmtDate(j.target_ship_date)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
          {readyToShip.length > 8 && (
            <Link href="/shipping" style={{ display: "block", textAlign: "center", fontSize: 10, color: T.muted, padding: "6px 0" }}>+{readyToShip.length - 8} more</Link>
          )}
        </div>

        {/* ── Fulfillment ── */}
        <div style={{ ...card, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.muted }}>Fulfillment Queue</span>
            <Link href="/fulfillment" style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.purple, textDecoration: "none" }}>{activeFulfillmentCount}</Link>
          </div>
          {activeFulfillmentCount === 0 ? (
            <div style={{ fontSize: 11, color: T.faint, padding: "12px 4px", textAlign: "center" }}>No active projects</div>
          ) : (
            <>
              {(fulfillmentProjects || []).slice(0, 5).map((p: any) => {
                const logs = (p.fulfillment_daily_logs || []).sort((a: any, b: any) => new Date(b.log_date).getTime() - new Date(a.log_date).getTime());
                const latest = logs[0];
                const hasLogToday = latest?.log_date === today;
                return (
                  <Link key={p.id} href="/fulfillment" style={{ textDecoration: "none", color: T.text }}>
                    <div style={{ padding: "8px 10px", marginBottom: 6, background: T.surface, borderRadius: 6, border: `1px solid ${hasLogToday ? T.border : T.amber}` }}>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                        {latest ? `${latest.remaining_orders} orders remaining` : "no log yet"}
                        {!hasLogToday && <span style={{ color: T.amber, marginLeft: 6 }}>· no log today</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
              {stagedJobs.slice(0, 3).map(j => {
                const units = (j.items || []).reduce((a: number, it: Item) =>
                  a + Object.values(it.received_qtys || {}).reduce((x: number, q: any) => x + (Number(q) || 0), 0), 0);
                return (
                  <Link key={j.id} href="/fulfillment" style={{ textDecoration: "none", color: T.text }}>
                    <div style={{ padding: "8px 10px", marginBottom: 6, background: T.surface, borderRadius: 6, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>
                        {(j.clients as any)?.name || "—"} · {j.title}
                      </div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                        Staged · {units.toLocaleString()}u ready
                      </div>
                    </div>
                  </Link>
                );
              })}
            </>
          )}
        </div>

      </div>

      {/* ── Exceptions panel ── */}
      {exceptions.length > 0 && (
        <div style={{ ...card, borderColor: T.red, background: "#1a0a0a", padding: "12px 16px", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#fca5a5" }}>
              {exceptions.length} Exception{exceptions.length !== 1 ? "s" : ""} — needs attention
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {exceptions.slice(0, 10).map((ex, i) => (
              <Link key={i} href={`/jobs/${ex.jobId}`} style={{ textDecoration: "none", color: T.text }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 4, background: "rgba(239,68,68,0.08)" }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 99, fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                    background: ex.kind === "variance" ? "#3a2a0a" : ex.kind === "damage" ? "#3a0a0a" : "#2a1a3a",
                    color: ex.kind === "variance" ? T.amber : ex.kind === "damage" ? T.red : T.purple,
                    flexShrink: 0,
                  }}>{ex.kind}</span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{ex.clientName} · {ex.jobTitle} · {ex.itemName}</span>
                  <span style={{ fontSize: 10, color: T.muted, marginLeft: "auto" }}>{ex.detail}</span>
                </div>
              </Link>
            ))}
            {exceptions.length > 10 && (
              <div style={{ fontSize: 10, color: T.muted, textAlign: "center", paddingTop: 4 }}>+{exceptions.length - 10} more</div>
            )}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {[
          { href: "/receiving", label: "Receiving", desc: "Confirm incoming shipments", color: T.amber, count: incomingByJob.length },
          { href: "/shipping", label: "Shipping", desc: "Ship-through orders", color: T.green, count: readyToShip.length },
          { href: "/fulfillment", label: "Fulfillment", desc: "Ongoing pack + ship", color: T.purple, count: activeFulfillmentCount },
        ].map(link => (
          <Link key={link.href} href={link.href} style={{ textDecoration: "none" }}>
            <div style={{ ...card, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: link.color }}>{link.label}</div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{link.desc}</div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: mono, color: link.count > 0 ? link.color : T.faint }}>{link.count}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
