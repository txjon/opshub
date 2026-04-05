import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";

const PHASE_STYLES: Record<string,{bg:string,text:string,label:string}> = {
  intake:         { bg:T.surface,    text:T.muted,   label:"Intake" },
  pending:        { bg:T.purpleDim,  text:T.purple,  label:"Pending" },
  ready:          { bg:T.amberDim,   text:T.amber,   label:"Ready" },
  pre_production: { bg:T.purpleDim,  text:T.purple,  label:"Pre-Production" },
  production:     { bg:T.accentDim,  text:T.accent,  label:"Production" },
  receiving:      { bg:T.amberDim,   text:T.amber,   label:"Receiving" },
  fulfillment:    { bg:T.purpleDim,  text:T.purple,  label:"Fulfillment" },
  shipped:        { bg:T.greenDim,   text:T.green,   label:"Shipped" },
  complete:       { bg:T.greenDim,   text:T.green,   label:"Complete" },
  on_hold:        { bg:T.redDim,     text:T.red,     label:"On Hold" },
  cancelled:      { bg:T.surface,    text:T.muted,   label:"Cancelled" },
};

function secLabel(label: string) {
  return <div style={{ fontSize:10, fontWeight:600, color:T.muted, textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8, fontFamily:font }}>{label}</div>;
}


export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), quote_approved, type_meta, costing_data, items(id, name, pipeline_stage, blanks_order_number, ship_tracking, artwork_status, buy_sheet_lines(qty_ordered))")
    .not("phase", "in", '("complete","cancelled")')
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const { data: payments } = await supabase
    .from("payment_records")
    .select("*, jobs(id, title, clients(name))")
    .neq("status", "paid")
    .neq("status", "void")
    .order("due_date", { ascending: true })
    .limit(10);

  // Load proof status for all active items
  const allItemIds = (jobs || []).flatMap(j => (j.items || []).map((it: any) => it.id));
  const { data: proofFiles } = allItemIds.length > 0
    ? await supabase.from("item_files").select("item_id, stage, approval").in("item_id", allItemIds).eq("stage", "proof")
    : { data: [] };

  const proofMap: Record<string, { hasProof: boolean; allApproved: boolean }> = {};
  for (const id of allItemIds) {
    const proofs = (proofFiles || []).filter(f => f.item_id === id);
    proofMap[id] = { hasProof: proofs.length > 0, allApproved: proofs.length > 0 && proofs.every(f => f.approval === "approved") };
  }

  const activeJobs = jobs || [];

  const shippingThisWeek = activeJobs.filter(j => {
    if (!j.target_ship_date) return false;
    const d = new Date(j.target_ship_date);
    const diff = Math.ceil((d.getTime() - now.getTime()) / (1000*60*60*24));
    return diff >= -1 && diff <= 7;
  });

  const overdueJobs = activeJobs.filter(j =>
    j.target_ship_date && new Date(j.target_ship_date) < now
  );

  const phaseCounts = activeJobs.reduce((a: Record<string,number>, j) => {
    a[j.phase] = (a[j.phase]||0) + 1; return a;
  }, {});

  const overduePayments = (payments||[]).filter(p => p.due_date && new Date(p.due_date) < now);

  // Build workflow-aware "needs action" list
  const needsAction: { type: string; label: string; bg: string; color: string; title: string; sub: string; href: string }[] = [];

  // Overdue projects
  for (const j of overdueJobs.slice(0, 3)) {
    const days = Math.abs(Math.ceil((new Date(j.target_ship_date!).getTime() - now.getTime()) / (1000*60*60*24)));
    needsAction.push({
      type: "overdue", label: "Overdue", bg: T.redDim, color: T.red,
      title: `${(j.clients as any)?.name} — ${j.title}`,
      sub: `${days}d overdue · ${(PHASE_STYLES[j.phase]||{}).label}`,
      href: `/jobs/${j.id}`,
    });
  }

  // Overdue payments
  for (const p of overduePayments.slice(0, 2)) {
    const days = Math.abs(Math.ceil((new Date(p.due_date).getTime() - now.getTime()) / (1000*60*60*24)));
    needsAction.push({
      type: "payment", label: "Payment", bg: T.amberDim, color: T.amber,
      title: `${(p.jobs as any)?.clients?.name || ""} — ${(p.jobs as any)?.title || ""}`,
      sub: `$${(p.amount||0).toLocaleString()} overdue ${days}d`,
      href: `/jobs/${(p.jobs as any)?.id || ""}`,
    });
  }

  // Workflow-specific actions
  for (const j of activeJobs) {
    const items = j.items || [];
    if (items.length === 0) continue;

    // Waiting on quote approval
    if (j.phase === "intake" && !(j as any).quote_approved && items.length > 0) {
      needsAction.push({
        type: "quote", label: "Quote", bg: T.purpleDim, color: T.purple,
        title: `${(j.clients as any)?.name} — ${j.title}`,
        sub: "Quote not yet approved",
        href: `/jobs/${j.id}`,
      });
    }

    // Proofs pending
    if (j.phase === "pending" || j.phase === "ready" || j.phase === "intake") {
      const pendingProofs = items.filter((it: any) => !proofMap[it.id]?.allApproved);
      if (pendingProofs.length > 0 && (j as any).quote_approved) {
        needsAction.push({
          type: "proof", label: "Proofs", bg: T.amberDim, color: T.amber,
          title: `${(j.clients as any)?.name} — ${j.title}`,
          sub: `${pendingProofs.length} item${pendingProofs.length !== 1 ? "s" : ""} need proof approval`,
          href: `/jobs/${j.id}`,
        });
      }
    }

    // Blanks not ordered (ready phase with all proofs approved)
    if (j.phase === "ready") {
      const needsBlanks = items.filter((it: any) => !it.blanks_order_number);
      const allApproved = items.every((it: any) => proofMap[it.id]?.allApproved);
      if (needsBlanks.length > 0 && allApproved) {
        needsAction.push({
          type: "blanks", label: "Blanks", bg: T.accentDim, color: T.accent,
          title: `${(j.clients as any)?.name} — ${j.title}`,
          sub: `${needsBlanks.length} item${needsBlanks.length !== 1 ? "s" : ""} need blanks ordered`,
          href: `/jobs/${j.id}`,
        });
      }
    }

    // POs not sent
    if (j.phase === "ready" || j.phase === "production") {
      const poSent = (j as any).type_meta?.po_sent_vendors || [];
      const costProds = (j as any).costing_data?.costProds || [];
      const vendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))] as string[];
      const unsent = vendors.filter(v => !poSent.includes(v));
      if (unsent.length > 0 && items.some((it: any) => it.blanks_order_number)) {
        needsAction.push({
          type: "po", label: "PO", bg: T.accentDim, color: T.accent,
          title: `${(j.clients as any)?.name} — ${j.title}`,
          sub: `PO not sent to: ${unsent.join(", ")}`,
          href: `/jobs/${j.id}`,
        });
      }
    }
  }

  // Limit and dedupe
  const actionItems = needsAction.slice(0, 10);

  const phaseOrder = ["intake","pending","ready","production","receiving","fulfillment"];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10, fontFamily:font, color:T.text }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700 }}>
            {`Good ${now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}`}
          </div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            {now.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})} · {activeJobs.length} active projects
          </div>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {overdueJobs.length > 0 && (
            <span style={{ padding:"4px 12px", borderRadius:99, fontSize:11, fontWeight:600, background:T.redDim, color:T.red }}>
              {overdueJobs.length} overdue
            </span>
          )}
          {actionItems.length > 0 && (
            <span style={{ padding:"4px 12px", borderRadius:99, fontSize:11, fontWeight:600, background:T.amberDim, color:T.amber }}>
              {actionItems.length} need attention
            </span>
          )}
        </div>
      </div>

      {/* Main 2-column layout */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>

        {/* Left: Needs action */}
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px" }}>
          {secLabel("What needs attention")}
          {actionItems.length === 0 && (
            <div style={{ fontSize:12, color:T.muted, padding:"16px 0", textAlign:"center" }}>All clear — nothing needs attention right now.</div>
          )}
          {actionItems.map((item, i) => (
            <Link key={i} href={item.href} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderBottom:i<actionItems.length-1?`1px solid ${T.border}`:"none", textDecoration:"none" }}>
              <span style={{ padding:"2px 8px", borderRadius:99, fontSize:10, fontWeight:600, background:item.bg, color:item.color, whiteSpace:"nowrap", flexShrink:0 }}>{item.label}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
                <div style={{ fontSize:10, color:T.muted, marginTop:1 }}>{item.sub}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Middle: Pipeline + shipping */}
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px" }}>
          {secLabel("Project pipeline")}
          <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:12 }}>
            {phaseOrder.map(phase => {
              const count = phaseCounts[phase]||0;
              const ps = PHASE_STYLES[phase] || PHASE_STYLES.intake;
              return (
                <div key={phase} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 8px", borderRadius:6, background:count>0?ps.bg:"transparent" }}>
                  <span style={{ fontSize:12, color:count>0?ps.text:T.muted, fontFamily:font, fontWeight:count>0?600:400 }}>{ps.label}</span>
                  <span style={{ fontSize:16, fontWeight:700, color:count>0?ps.text:T.faint, fontFamily:mono }}>{count}</span>
                </div>
              );
            })}
            {(phaseCounts.on_hold||0) > 0 && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 8px", borderRadius:6, background:T.redDim }}>
                <span style={{ fontSize:12, color:T.red, fontFamily:font, fontWeight:600 }}>On Hold</span>
                <span style={{ fontSize:16, fontWeight:700, color:T.red, fontFamily:mono }}>{phaseCounts.on_hold}</span>
              </div>
            )}
          </div>

          <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:10 }}>
            {secLabel("Shipping this week")}
            {shippingThisWeek.length === 0 && <div style={{ fontSize:12, color:T.muted }}>Nothing shipping this week.</div>}
            {shippingThisWeek.map((j, i) => {
              const d = new Date(j.target_ship_date!);
              const diff = Math.ceil((d.getTime()-now.getTime())/(1000*60*60*24));
              const late = diff < 0;
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:i<shippingThisWeek.length-1?`1px solid ${T.border}`:"none", textDecoration:"none" }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:late?T.red:T.green, flexShrink:0 }}/>
                  <div style={{ flex:1, fontSize:11, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {(j.clients as any)?.name} · {j.title}
                  </div>
                  <span style={{ fontSize:11, fontFamily:mono, color:late?T.red:T.muted, flexShrink:0 }}>
                    {d.toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right: Active projects */}
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px" }}>
          {secLabel("All active projects")}
          <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
            {activeJobs.slice(0,12).map((j, i) => {
              const ps = PHASE_STYLES[j.phase] || PHASE_STYLES.intake;
              const daysLeft = j.target_ship_date ? Math.ceil((new Date(j.target_ship_date).getTime()-now.getTime())/(1000*60*60*24)) : null;
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:i<Math.min(activeJobs.length,12)-1?`1px solid ${T.border}`:"none", textDecoration:"none" }}>
                  <span style={{ padding:"1px 7px", borderRadius:99, fontSize:9, fontWeight:600, background:ps.bg, color:ps.text, whiteSpace:"nowrap", flexShrink:0 }}>{ps.label}</span>
                  <div style={{ flex:1, fontSize:11, fontWeight:600, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {(j.clients as any)?.name} — {j.title}
                  </div>
                  {daysLeft !== null && (
                    <span style={{ fontSize:11, fontFamily:mono, color:daysLeft<0?T.red:daysLeft<=3?T.amber:T.muted, flexShrink:0 }}>
                      {daysLeft<0?Math.abs(daysLeft)+"d over":daysLeft+"d"}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          {activeJobs.length > 12 && (
            <Link href="/jobs" style={{ display:"block", marginTop:8, fontSize:11, color:T.accent, textDecoration:"none" }}>
              View all {activeJobs.length} projects →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
