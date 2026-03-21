import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const T = {
  card:"#1e2333", surface:"#181c27", border:"#2a3050",
  text:"#e8eaf2", muted:"#7a82a0", faint:"#3a4060",
  accent:"#4f8ef7", accentDim:"#1e3a6e",
  green:"#34c97a", greenDim:"#0e3d24",
  amber:"#f5a623", amberDim:"#3d2a08",
  red:"#f05353", redDim:"#3d1212",
  purple:"#a78bfa", purpleDim:"#2d1f5e",
};

const font = `'IBM Plex Sans','Helvetica Neue',Arial,sans-serif`;
const mono = `'IBM Plex Mono','Courier New',monospace`;

const PHASE_STYLES: Record<string,{bg:string,text:string,label:string}> = {
  intake:         { bg:T.surface,    text:T.muted,   label:"Intake" },
  pre_production: { bg:T.purpleDim,  text:T.purple,  label:"Pre-Production" },
  production:     { bg:T.accentDim,  text:T.accent,  label:"Production" },
  receiving:      { bg:T.amberDim,   text:T.amber,   label:"Receiving" },
  shipping:       { bg:T.greenDim,   text:T.green,   label:"Shipping" },
  complete:       { bg:T.greenDim,   text:T.green,   label:"Complete" },
  on_hold:        { bg:T.redDim,     text:T.red,     label:"On Hold" },
  cancelled:      { bg:T.surface,    text:T.muted,   label:"Cancelled" },
};

function pill(bg: string, color: string, label: string) {
  return (
    <span style={{ padding:"2px 8px", borderRadius:99, fontSize:10, fontWeight:600, background:bg, color, whiteSpace:"nowrap" as const }}>
      {label}
    </span>
  );
}

function card(children: React.ReactNode, style?: React.CSSProperties) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px", ...style }}>
      {children}
    </div>
  );
}

function secLabel(label: string) {
  return <div style={{ fontSize:10, fontWeight:600, color:T.muted, textTransform:"uppercase" as const, letterSpacing:"0.07em", marginBottom:8, fontFamily:font }}>{label}</div>;
}

function statBox(label: string, value: string, sub?: string, subColor?: string) {
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"10px 12px" }}>
      <div style={{ fontSize:10, color:T.muted, marginBottom:2, fontFamily:font }}>{label}</div>
      <div style={{ fontSize:16, fontWeight:700, color:T.text, fontFamily:mono, lineHeight:1.2 }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:subColor||T.muted, marginTop:2, fontFamily:font }}>{sub}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), costing_summary, items(id, sell_per_unit, cost_per_unit, buy_sheet_lines(qty_ordered))")
    .not("phase", "in", '("complete","cancelled")')
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const { data: payments } = await supabase
    .from("payments")
    .select("*, jobs(title, clients(name))")
    .neq("status", "paid")
    .order("due_date", { ascending: true })
    .limit(10);

  const activeJobs = jobs || [];

  // Compute KPIs
  const totalRevenue = activeJobs.reduce((a, j) => {
    if ((j as any).costing_summary?.grossRev) return a + (j as any).costing_summary.grossRev;
    return a + (j.items||[]).reduce((b: number, it: any) => {
      const qty = (it.buy_sheet_lines||[]).reduce((c: number, l: any) => c + (l.qty_ordered||0), 0);
      return b + (it.sell_per_unit||0) * qty;
    }, 0);
  }, 0);

  const totalCost = activeJobs.reduce((a, j) => {
    if ((j as any).costing_summary?.totalCost) return a + (j as any).costing_summary.totalCost;
    return a + (j.items||[]).reduce((b: number, it: any) => {
      const qty = (it.buy_sheet_lines||[]).reduce((c: number, l: any) => c + (l.qty_ordered||0), 0);
      return b + (it.cost_per_unit||0) * qty;
    }, 0);
  }, 0);

  const avgMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;

  const totalUnits = activeJobs.reduce((a, j) =>
    a + (j.items||[]).reduce((b: number, it: any) =>
      b + (it.buy_sheet_lines||[]).reduce((c: number, l: any) => c + (l.qty_ordered||0), 0), 0), 0);

  const shippingThisWeek = activeJobs.filter(j => {
    if (!j.target_ship_date) return false;
    const d = new Date(j.target_ship_date);
    const diff = Math.ceil((d.getTime() - now.getTime()) / (1000*60*60*24));
    return diff >= -1 && diff <= 7;
  });

  const overdueJobs = activeJobs.filter(j =>
    j.target_ship_date && new Date(j.target_ship_date) < now && j.phase !== "complete"
  );

  const phaseCounts = activeJobs.reduce((a: Record<string,number>, j) => {
    a[j.phase] = (a[j.phase]||0) + 1; return a;
  }, {});

  const overduePayments = (payments||[]).filter(p =>
    p.due_date && new Date(p.due_date) < now
  );
  const outstandingTotal = (payments||[]).reduce((a, p) => a + (p.amount||0), 0);
  const overdueTotal = overduePayments.reduce((a, p) => a + (p.amount||0), 0);

  const needsAction = [
    ...overdueJobs.map(j => ({
      type: "overdue", label: "Overdue",
      bg: T.redDim, color: T.red,
      title: `${(j.clients as any)?.name} — ${j.title}`,
      sub: `${(PHASE_STYLES[j.phase]||{}).label} · ${Math.abs(Math.ceil((new Date(j.target_ship_date!).getTime()-now.getTime())/(1000*60*60*24)))}d overdue`,
      href: `/jobs/${j.id}`,
    })),
    ...overduePayments.slice(0,3).map(p => ({
      type: "payment", label: "Payment",
      bg: T.amberDim, color: T.amber,
      title: `${(p.jobs as any)?.title || "Unknown job"}`,
      sub: `$${(p.amount||0).toLocaleString()} overdue ${Math.abs(Math.ceil((new Date(p.due_date).getTime()-now.getTime())/(1000*60*60*24)))}d`,
      href: `/jobs/${(p as any).job_id}`,
    })),
    ...activeJobs.filter(j => j.phase === "pre_production").slice(0,2).map(j => ({
      type: "art", label: "Pre-Prod",
      bg: T.purpleDim, color: T.purple,
      title: `${(j.clients as any)?.name} — ${j.title}`,
      sub: "Awaiting art approval",
      href: `/jobs/${j.id}`,
    })),
  ].slice(0, 6);

  const phaseOrder = ["pre_production","production","receiving","shipping"];
  const phaseMax = Math.max(...phaseOrder.map(p => phaseCounts[p]||0), 1);

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
          {needsAction.length > 0 && (
            <span style={{ padding:"4px 12px", borderRadius:99, fontSize:11, fontWeight:600, background:T.amberDim, color:T.amber }}>
              {needsAction.length} need attention
            </span>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, alignItems:"stretch" }}>
        {statBox("Active revenue", totalRevenue > 0 ? "$"+Math.round(totalRevenue/1000)+"K" : "—", "pipeline", T.accent)}
        {statBox("Avg margin", avgMargin > 0 ? avgMargin.toFixed(1)+"%" : "—", undefined, avgMargin >= 30 ? T.green : avgMargin >= 20 ? T.amber : T.red)}
        {statBox("Units in pipeline", totalUnits > 0 ? totalUnits.toLocaleString() : "—", activeJobs.length === 1 ? "1 project" : `${activeJobs.length} projects`)}
        {statBox("Outstanding", outstandingTotal > 0 ? "$"+Math.round(outstandingTotal/1000)+"K" : "$0", overdueTotal > 0 ? "$"+Math.round(overdueTotal/1000)+"K overdue" : "All current", overdueTotal > 0 ? T.red : T.green)}
        {statBox("Shipping this week", shippingThisWeek.length.toString(), shippingThisWeek.filter(j => j.target_ship_date && new Date(j.target_ship_date) < now).length > 0 ? shippingThisWeek.filter(j => j.target_ship_date && new Date(j.target_ship_date) < now).length+" at risk" : "On track", shippingThisWeek.filter(j => j.target_ship_date && new Date(j.target_ship_date) < now).length > 0 ? T.red : T.green)}
      </div>

      {/* Main 3-column layout */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>

        {/* Left: Needs action */}
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px" }}>
          {secLabel("Needs action now")}
          {needsAction.length === 0 && (
            <div style={{ fontSize:12, color:T.muted, padding:"16px 0", textAlign:"center" }}>All clear — no immediate actions needed.</div>
          )}
          {needsAction.map((item, i) => (
            <Link key={i} href={item.href} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0", borderBottom:i<needsAction.length-1?`1px solid ${T.border}`:"none", textDecoration:"none" }}>
              <span style={{ padding:"2px 8px", borderRadius:99, fontSize:10, fontWeight:600, background:item.bg, color:item.color, whiteSpace:"nowrap", flexShrink:0 }}>{item.label}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
                <div style={{ fontSize:10, color:T.muted, marginTop:1 }}>{item.sub}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Middle: Production pipeline + shipping */}
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px" }}>
          {secLabel("Production pipeline")}
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
            {phaseOrder.map(phase => {
              const count = phaseCounts[phase]||0;
              const ps = PHASE_STYLES[phase];
              const pct = Math.round((count/phaseMax)*100);
              return (
                <div key={phase}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:11, color:T.muted, fontFamily:font }}>{ps.label}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:ps.text, fontFamily:mono }}>{count}</span>
                  </div>
                  <div style={{ height:4, background:T.surface, borderRadius:2, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:pct+"%", background:ps.text, borderRadius:2 }}/>
                  </div>
                </div>
              );
            })}
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

        {/* Right: Finance + all active jobs */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

          {/* Finance */}
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px" }}>
            {secLabel("Finance")}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
              <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"8px 10px" }}>
                <div style={{ fontSize:10, color:T.muted, marginBottom:2 }}>Outstanding</div>
                <div style={{ fontSize:15, fontWeight:700, color:T.amber, fontFamily:mono }}>{outstandingTotal > 0 ? "$"+outstandingTotal.toLocaleString() : "$0"}</div>
              </div>
              <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"8px 10px" }}>
                <div style={{ fontSize:10, color:T.muted, marginBottom:2 }}>Overdue</div>
                <div style={{ fontSize:15, fontWeight:700, color:overdueTotal > 0 ? T.red : T.muted, fontFamily:mono }}>{overdueTotal > 0 ? "$"+overdueTotal.toLocaleString() : "$0"}</div>
              </div>
            </div>
            {(payments||[]).slice(0,3).map((p, i) => {
              const late = p.due_date && new Date(p.due_date) < now;
              return (
                <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:i<Math.min((payments||[]).length,3)-1?`1px solid ${T.border}`:"none" }}>
                  <div style={{ flex:1, fontSize:11, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {(p.jobs as any)?.title || "Unknown"}
                  </div>
                  <span style={{ fontSize:11, fontFamily:mono, color:late?T.red:T.amber, flexShrink:0 }}>
                    ${(p.amount||0).toLocaleString()} · {late ? "overdue" : p.due_date ? new Date(p.due_date).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "—"}
                  </span>
                </div>
              );
            })}
            {(payments||[]).length === 0 && <div style={{ fontSize:12, color:T.muted }}>No outstanding payments.</div>}
          </div>

          {/* Active projects quick list */}
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px", flex:1 }}>
            {secLabel("All active projects")}
            <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
              {activeJobs.slice(0,8).map((j, i) => {
                const ps = PHASE_STYLES[j.phase] || PHASE_STYLES.intake;
                const daysLeft = j.target_ship_date ? Math.ceil((new Date(j.target_ship_date).getTime()-now.getTime())/(1000*60*60*24)) : null;
                return (
                  <Link key={j.id} href={`/jobs/${j.id}`} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:i<Math.min(activeJobs.length,8)-1?`1px solid ${T.border}`:"none", textDecoration:"none" }}>
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
            {activeJobs.length > 8 && (
              <Link href="/jobs" style={{ display:"block", marginTop:8, fontSize:11, color:T.accent, textDecoration:"none" }}>
                View all {activeJobs.length} projects →
              </Link>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
