import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { AlertGroups } from "@/components/AlertGroups";

const PHASE_STYLES: Record<string,{bg:string,text:string,label:string}> = {
  intake:         { bg:T.surface,    text:T.muted,   label:"Intake" },
  pending:        { bg:T.purpleDim,  text:T.purple,  label:"Pending" },
  ready:          { bg:T.amberDim,   text:T.amber,   label:"Ready" },
  production:     { bg:T.accentDim,  text:T.accent,  label:"Production" },
  receiving:      { bg:T.amberDim,   text:T.amber,   label:"Receiving" },
  fulfillment:    { bg:T.purpleDim,  text:T.purple,  label:"Fulfillment" },
  on_hold:        { bg:T.redDim,     text:T.red,     label:"On Hold" },
};

type Alert = {
  priority: number; // 0=critical, 1=high, 2=medium
  type: string;
  label: string;
  bg: string;
  color: string;
  title: string;
  sub: string;
  href: string; // deep link to specific tab
  time?: string;
  jobId: string;
  projectName: string;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), quote_approved, quote_approved_at, type_meta, costing_data, items(id, name, pipeline_stage, blanks_order_number, ship_tracking, artwork_status, buy_sheet_lines(qty_ordered))")
    .not("phase", "in", '("complete","cancelled")')
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const { data: payments } = await supabase
    .from("payment_records")
    .select("*, jobs(id, title, clients(name))")
    .neq("status", "paid")
    .neq("status", "void")
    .order("due_date", { ascending: true })
    .limit(20);

  // Load proof files for approval status
  const allItemIds = (jobs || []).flatMap(j => (j.items || []).map((it: any) => it.id));
  const { data: proofFiles } = allItemIds.length > 0
    ? await supabase.from("item_files").select("item_id, stage, approval, approved_at").in("item_id", allItemIds).in("stage", ["proof", "mockup"])
    : { data: [] };

  // Load recent notifications for approval/payment events
  const { data: recentNotifs } = await supabase
    .from("job_activity")
    .select("job_id, message, created_at")
    .eq("type", "auto")
    .order("created_at", { ascending: false })
    .limit(50);

  const proofMap: Record<string, { allApproved: boolean; hasRevision: boolean; pendingCount: number }> = {};
  for (const id of allItemIds) {
    const proofs = (proofFiles || []).filter(f => f.item_id === id && f.stage === "proof");
    const revisions = proofs.filter(f => f.approval === "revision_requested");
    const pending = proofs.filter(f => f.approval === "pending");
    proofMap[id] = {
      allApproved: proofs.length > 0 && proofs.every(f => f.approval === "approved"),
      hasRevision: revisions.length > 0,
      pendingCount: pending.length,
    };
  }

  const activeJobs = jobs || [];
  const alerts: Alert[] = [];
  const jn = (j: any) => `${(j.clients as any)?.name || ""} — ${j.title}`;

  // ── CRITICAL: Revision requests from clients ──
  for (const j of activeJobs) {
    for (const it of (j.items || [])) {
      if (proofMap[it.id]?.hasRevision) {
        const ra = (recentNotifs || []).find(n => n.job_id === j.id && n.message.toLowerCase().includes("revision") && n.message.includes(it.name));
        alerts.push({ priority: 0, type: "revision", label: "Revision", bg: T.redDim, color: T.red, title: it.name, sub: "Client requested changes", href: `/jobs/${j.id}?tab=art`, time: ra?.created_at, jobId: j.id, projectName: jn(j) });
      }
    }
  }

  // ── CRITICAL: Overdue projects ──
  for (const j of activeJobs.filter(j => j.target_ship_date && new Date(j.target_ship_date) < now)) {
    const days = Math.abs(Math.ceil((new Date(j.target_ship_date!).getTime() - now.getTime()) / 86400000));
    alerts.push({ priority: 0, type: "overdue", label: "Overdue", bg: T.redDim, color: T.red, title: jn(j), sub: `${days}d past ship date`, href: `/jobs/${j.id}`, jobId: j.id, projectName: jn(j) });
  }

  // ── HIGH: Overdue payments ──
  for (const p of (payments || []).filter(p => p.due_date && new Date(p.due_date) < now)) {
    const days = Math.abs(Math.ceil((new Date(p.due_date).getTime() - now.getTime()) / 86400000));
    const jid = (p.jobs as any)?.id || "";
    alerts.push({ priority: 1, type: "payment_overdue", label: "Payment Overdue", bg: T.redDim, color: T.red, title: `$${(p.amount||0).toLocaleString()}`, sub: `${days}d overdue`, href: `/jobs/${jid}?tab=approvals`, jobId: jid, projectName: `${(p.jobs as any)?.clients?.name||""} — ${(p.jobs as any)?.title||""}` });
  }

  // ── HIGH: Quote approved — ready to act ──
  for (const j of activeJobs) {
    if ((j as any).quote_approved && j.phase === "pending") {
      alerts.push({ priority: 1, type: "quote_approved", label: "Quote Approved", bg: T.greenDim, color: T.green, title: "Ready to proceed", sub: "Send proofs + collect payment", href: `/jobs/${j.id}?tab=approvals`, time: (j as any).quote_approved_at, jobId: j.id, projectName: jn(j) });
    }
  }

  // ── HIGH: Proofs pending ──
  for (const j of activeJobs) {
    if (!(j as any).quote_approved) continue;
    const pending = (j.items || []).filter((it: any) => proofMap[it.id]?.pendingCount > 0);
    if (pending.length > 0) {
      alerts.push({ priority: 1, type: "proofs_pending", label: "Proofs Pending", bg: T.amberDim, color: T.amber, title: `${pending.length} item${pending.length !== 1 ? "s" : ""}`, sub: "Awaiting client approval", href: `/jobs/${j.id}?tab=approvals`, jobId: j.id, projectName: jn(j) });
    }
  }

  // ── HIGH: Payment needed ──
  for (const j of activeJobs) {
    if (!(j as any).quote_approved) continue;
    const terms = j.payment_terms || "";
    if (terms === "net_15" || terms === "net_30") continue;
    const jobPayments = (payments || []).filter(p => (p.jobs as any)?.id === j.id);
    if (jobPayments.length === 0 && j.phase === "pending") {
      alerts.push({ priority: 1, type: "payment_needed", label: "Payment Needed", bg: T.amberDim, color: T.amber, title: terms.replace(/_/g, " "), sub: "No payment recorded", href: `/jobs/${j.id}?tab=approvals`, jobId: j.id, projectName: jn(j) });
    }
  }

  // ── MEDIUM: Quote not approved ──
  for (const j of activeJobs) {
    if (j.phase === "intake" && !(j as any).quote_approved && (j.items || []).length > 0) {
      alerts.push({ priority: 2, type: "quote_pending", label: "Quote", bg: T.purpleDim, color: T.purple, title: "Not yet approved", sub: "", href: `/jobs/${j.id}?tab=quote`, jobId: j.id, projectName: jn(j) });
    }
  }

  // ── MEDIUM: Blanks not ordered ──
  for (const j of activeJobs) {
    if (j.phase !== "ready") continue;
    const needsBlanks = (j.items || []).filter((it: any) => !it.blanks_order_number);
    if (needsBlanks.length > 0) {
      alerts.push({ priority: 2, type: "blanks", label: "Order Blanks", bg: T.accentDim, color: T.accent, title: `${needsBlanks.length} item${needsBlanks.length !== 1 ? "s" : ""}`, sub: "", href: `/jobs/${j.id}?tab=blanks`, jobId: j.id, projectName: jn(j) });
    }
  }

  // ── MEDIUM: POs not sent ──
  for (const j of activeJobs) {
    if (j.phase !== "ready" && j.phase !== "production") continue;
    const poSent = (j as any).type_meta?.po_sent_vendors || [];
    const costProds = (j as any).costing_data?.costProds || [];
    const vendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))] as string[];
    const unsent = vendors.filter(v => !poSent.includes(v));
    if (unsent.length > 0 && (j.items || []).some((it: any) => it.blanks_order_number)) {
      alerts.push({ priority: 2, type: "po", label: "Send PO", bg: T.accentDim, color: T.accent, title: unsent.join(", "), sub: "", href: `/jobs/${j.id}?tab=po`, jobId: j.id, projectName: jn(j) });
    }
  }

  alerts.sort((a, b) => a.priority - b.priority);

  // Group alerts by project
  const groupedAlerts: { jobId: string; projectName: string; topPriority: number; alerts: Alert[] }[] = [];
  for (const a of alerts) {
    let group = groupedAlerts.find(g => g.jobId === a.jobId);
    if (!group) {
      group = { jobId: a.jobId, projectName: a.projectName, topPriority: a.priority, alerts: [] };
      groupedAlerts.push(group);
    }
    group.alerts.push(a);
    if (a.priority < group.topPriority) group.topPriority = a.priority;
  }
  groupedAlerts.sort((a, b) => a.topPriority - b.topPriority);

  const criticalCount = alerts.filter(a => a.priority === 0).length;
  const highCount = alerts.filter(a => a.priority === 1).length;

  const phaseCounts = activeJobs.reduce((a: Record<string, number>, j) => {
    a[j.phase] = (a[j.phase] || 0) + 1; return a;
  }, {});
  const phaseOrder = ["intake", "pending", "ready", "production", "receiving", "fulfillment"];

  const shippingThisWeek = activeJobs.filter(j => {
    if (!j.target_ship_date) return false;
    const diff = Math.ceil((new Date(j.target_ship_date).getTime() - now.getTime()) / 86400000);
    return diff >= -1 && diff <= 7;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: font, color: T.text }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Command Center</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · {activeJobs.length} active projects
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {criticalCount > 0 && (
            <span style={{ padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: T.redDim, color: T.red }}>
              {criticalCount} critical
            </span>
          )}
          {highCount > 0 && (
            <span style={{ padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: T.amberDim, color: T.amber }}>
              {highCount} action needed
            </span>
          )}
          {alerts.length === 0 && (
            <span style={{ padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: T.greenDim, color: T.green }}>
              All clear
            </span>
          )}
        </div>
      </div>

      {/* ── ALERTS — grouped by project ── */}
      <AlertGroups groups={groupedAlerts} />

      {/* ── SECONDARY: Pipeline + Shipping | Active Projects ── */}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 10 }}>

        {/* Pipeline + Shipping */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Pipeline</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {phaseOrder.map(phase => {
                const count = phaseCounts[phase] || 0;
                const ps = PHASE_STYLES[phase] || PHASE_STYLES.intake;
                return (
                  <div key={phase} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 6, background: count > 0 ? ps.bg : "transparent" }}>
                    <span style={{ fontSize: 11, color: count > 0 ? ps.text : T.faint, fontWeight: count > 0 ? 600 : 400 }}>{ps.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: count > 0 ? ps.text : T.faint, fontFamily: mono }}>{count}</span>
                  </div>
                );
              })}
              {(phaseCounts.on_hold || 0) > 0 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 6, background: T.redDim }}>
                  <span style={{ fontSize: 11, color: T.red, fontWeight: 600 }}>On Hold</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.red, fontFamily: mono }}>{phaseCounts.on_hold}</span>
                </div>
              )}
            </div>
          </div>

          {shippingThisWeek.length > 0 && (
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Shipping This Week</div>
              {shippingThisWeek.map((j, i) => {
                const d = new Date(j.target_ship_date!);
                const late = d < now;
                return (
                  <Link key={j.id} href={`/jobs/${j.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: i < shippingThisWeek.length - 1 ? `1px solid ${T.border}` : "none", textDecoration: "none" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: late ? T.red : T.green, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 11, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(j.clients as any)?.name} · {j.title}
                    </div>
                    <span style={{ fontSize: 10, fontFamily: mono, color: late ? T.red : T.muted, flexShrink: 0 }}>
                      {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Projects */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Active Projects</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {activeJobs.map((j, i) => {
              const ps = PHASE_STYLES[j.phase] || PHASE_STYLES.intake;
              const daysLeft = j.target_ship_date ? Math.ceil((new Date(j.target_ship_date).getTime() - now.getTime()) / 86400000) : null;
              const itemCount = (j.items || []).length;
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < activeJobs.length - 1 ? `1px solid ${T.border}` : "none", textDecoration: "none" }}>
                  <span style={{ padding: "1px 7px", borderRadius: 99, fontSize: 9, fontWeight: 600, background: ps.bg, color: ps.text, whiteSpace: "nowrap", flexShrink: 0, minWidth: 65, textAlign: "center" }}>{ps.label}</span>
                  <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(j.clients as any)?.name} — {j.title}
                  </div>
                  <span style={{ fontSize: 10, color: T.faint, flexShrink: 0 }}>{itemCount} items</span>
                  {daysLeft !== null && (
                    <span style={{ fontSize: 10, fontFamily: mono, color: daysLeft < 0 ? T.red : daysLeft <= 3 ? T.amber : T.muted, flexShrink: 0, minWidth: 40, textAlign: "right" }}>
                      {daysLeft < 0 ? Math.abs(daysLeft) + "d over" : daysLeft + "d"}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          {activeJobs.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint, padding: "20px 0", textAlign: "center" }}>No active projects.</div>
          )}
        </div>
      </div>
    </div>
  );
}
