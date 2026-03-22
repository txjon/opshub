"use client";
import React, { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type Job = {
  id: string; title: string; job_type: string; phase: string; priority: string;
  target_ship_date: string|null; job_number: string; created_at: string;
  clients?: { name: string }|null;
  items?: { id: string; pipeline_stage: string|null }[];
};

const PHASE_COLORS: Record<string,{bg:string,text:string,label:string}> = {
  intake:        { bg:"#2a3050", text:"#7a82a0", label:"Intake" },
  pre_production:{ bg:"#2d1f5e", text:"#a78bfa", label:"Pre-Production" },
  production:    { bg:"#1e3a6e", text:"#4f8ef7", label:"Production" },
  receiving:     { bg:"#3d2a08", text:"#f5a623", label:"Receiving" },
  shipping:      { bg:"#0e3d24", text:"#34c97a", label:"Shipping" },
  complete:      { bg:"#0e3d24", text:"#34c97a", label:"Complete" },
  on_hold:       { bg:"#3d1212", text:"#f05353", label:"On Hold" },
  cancelled:     { bg:"#2a3050", text:"#7a82a0", label:"Cancelled" },
};

const PIPELINE_STAGES = ["blanks_ordered","blanks_shipped","blanks_received","strikeoff_approval","in_production","shipped"];
const getPct = (stage: string|null) => {
  const pcts: Record<string,number> = { blanks_ordered:10, blanks_shipped:25, blanks_received:40, strikeoff_approval:55, in_production:75, shipped:100 };
  return stage ? (pcts[stage] || 0) : 0;
};

const T = {
  bg:"#0f1117", surface:"#181c27", card:"#1e2333", border:"#2a3050",
  accent:"#4f8ef7", green:"#34c97a", amber:"#f5a623", red:"#f05353",
  text:"#e8eaf2", muted:"#7a82a0", faint:"#3a4060",
};
const font = `'IBM Plex Sans','Helvetica Neue',Arial,sans-serif`;
const mono = `'IBM Plex Mono','Courier New',monospace`;

export default function JobsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");
  const [sortKey, setSortKey] = useState("target_ship_date");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");
  const now = new Date();

  useEffect(() => { loadJobs(); }, []);

  async function loadJobs() {
    setLoading(true);
    const { data } = await supabase
      .from("jobs")
      .select("*, clients(name), costing_summary, items(id, sell_per_unit, cost_per_unit, buy_sheet_lines(qty_ordered), decorator_assignments(pipeline_stage))")
      .order("created_at", { ascending: false });
    if (data) setJobs(data as Job[]);
    setLoading(false);
  }

  const getJobPct = (job: Job) => {
    const items = job.items || [];
    if (!items.length) return 0;
    const stages = items.map((it: any) => it.decorator_assignments?.[0]?.pipeline_stage || null);
    const pcts = stages.map(s => getPct(s));
    return Math.round(pcts.reduce((a,p) => a+p, 0) / pcts.length);
  };

  const getFlags = (job: Job) => {
    const flags: { label: string; color: string }[] = [];
    if (job.target_ship_date && new Date(job.target_ship_date) < now && !["complete","cancelled"].includes(job.phase)) {
      flags.push({ label: "Overdue", color: T.red });
    }
    if (job.priority === "urgent") flags.push({ label: "Urgent", color: T.red });
    if (job.priority === "high") flags.push({ label: "High Priority", color: T.amber });
    return flags;
  };

  const phaseCounts = useMemo(() => ({
    intake: jobs.filter(j => j.phase === "intake").length,
    pre_production: jobs.filter(j => j.phase === "pre_production").length,
    production: jobs.filter(j => j.phase === "production").length,
    receiving: jobs.filter(j => j.phase === "receiving").length,
    shipping: jobs.filter(j => j.phase === "shipping").length,
  }), [jobs]);

  const visible = useMemo(() => jobs.filter(j => {
    if (filter === "active") return !["complete","cancelled","on_hold"].includes(j.phase);
    if (filter === "intake") return j.phase === "intake";
    if (filter === "pre_production") return j.phase === "pre_production";
    if (filter === "production") return j.phase === "production";
    if (filter === "receiving") return j.phase === "receiving";
    if (filter === "shipping") return j.phase === "shipping";
    if (filter === "all") return true;
    return true;
  }), [jobs, filter]);

  const sorted = useMemo(() => [...visible].sort((a,b) => {
    let av: any, bv: any;
    if (sortKey === "target_ship_date") {
      av = a.target_ship_date ? new Date(a.target_ship_date).getTime() : Infinity;
      bv = b.target_ship_date ? new Date(b.target_ship_date).getTime() : Infinity;
    } else if (sortKey === "client") {
      av = (a.clients?.name || "").toLowerCase();
      bv = (b.clients?.name || "").toLowerCase();
    } else if (sortKey === "priority") {
      const order: Record<string,number> = { urgent:0, high:1, normal:2 };
      av = order[a.priority] ?? 3; bv = order[b.priority] ?? 3;
    } else if (sortKey === "phase") {
      const order: Record<string,number> = { intake:0, pre_production:1, production:2, receiving:3, shipping:4, complete:5 };
      av = order[a.phase] ?? 9; bv = order[b.phase] ?? 9;
    } else if (sortKey === "pct") {
      av = getJobPct(a); bv = getJobPct(b);
    } else {
      av = a.title.toLowerCase(); bv = b.title.toLowerCase();
    }
    const r = typeof av === "string" ? (av < bv ? -1 : av > bv ? 1 : 0) : (av - bv);
    return sortDir === "asc" ? r : -r;
  }), [visible, sortKey, sortDir]);

  const SortBtn = ({ col, label }: { col: string; label: string }) => {
    const active = sortKey === col;
    return (
      <button onClick={() => { if (sortKey === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(col); setSortDir("asc"); }}}
        style={{ background:"none", border:"none", padding:"5px 9px", cursor:"pointer", fontFamily:font, fontSize:10, fontWeight:700, color:active?T.accent:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", display:"flex", alignItems:"center", gap:3, whiteSpace:"nowrap" }}>
        {label}{active && <span style={{fontSize:9}}>{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    );
  };

  if (loading) return (
    <div style={{ padding:"2rem", color: T.muted, fontFamily: font, fontSize: 13 }}>Loading jobs...</div>
  );

  return (
    <div style={{ fontFamily: font, color: T.text, display:"flex", flexDirection:"column", gap:14 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize:22, fontWeight:700, margin:"0 0 10px", letterSpacing:"-0.02em" }}>Jobs</h1>
        <a href="/jobs/new" style={{ background:T.accent, color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontFamily:font, fontWeight:600, cursor:"pointer", textDecoration:"none" }}>
          + New Job
        </a>
      </div>

      {/* Filter + sort bar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:3, background:T.surface, padding:3, borderRadius:8 }}>
          {[
            ["active","All Active",jobs.filter(j => !["complete","cancelled","on_hold"].includes(j.phase)).length],
            ["intake","Intake",phaseCounts.intake],
            ["pre_production","Pre-Production",phaseCounts.pre_production],
            ["production","Production",phaseCounts.production],
            ["receiving","Receiving",phaseCounts.receiving],
            ["shipping","Shipping",phaseCounts.shipping],
            ["all","All",null],
          ].map(([k,l,count]) => (
            <button key={k as string} onClick={() => setFilter(k as string)}
              style={{ background:filter===k?T.accent:"transparent", color:filter===k?"#fff":T.muted, border:"none", borderRadius:5, padding:"4px 10px", fontSize:11, fontFamily:font, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
              {l as string}
              {(count as number) > 0 && <span style={{ background:filter===k?"rgba(255,255,255,0.25)":T.faint+"44", borderRadius:10, padding:"0 5px", fontSize:9 }}>{count as number}</span>}
            </button>
          ))}
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:0, background:T.surface, borderRadius:8, padding:3 }}>
          <SortBtn col="client" label="Client" />
          <SortBtn col="priority" label="Priority" />
          <SortBtn col="phase" label="Phase" />
          <SortBtn col="target_ship_date" label="Ship Date" />
        </div>
      </div>

      {/* Job list */}
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {sorted.length === 0 && (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:32, textAlign:"center", fontSize:12, color:T.faint }}>
            No jobs in this view.
          </div>
        )}
        {sorted.map(job => {
          const phase = PHASE_COLORS[job.phase] || PHASE_COLORS.intake;
          const flags = getFlags(job);
          const pct = getJobPct(job);
          const pctColor = pct === 100 ? T.green : pct >= 60 ? T.accent : pct >= 30 ? T.amber : T.muted;
          const daysLeft = job.target_ship_date ? Math.ceil((new Date(job.target_ship_date).getTime() - now.getTime()) / (1000*60*60*24)) : null;
          const itemCount = job.items?.length || 0;

          const priorityStyle: Record<string,{bg:string,text:string,label:string}> = {
            urgent: { bg:"#3d1212", text:"#f05353", label:"Urgent" },
            high:   { bg:"#3d2a08", text:"#f5a623", label:"High priority" },
            normal: { bg:"#2a3050", text:"#7a82a0", label:"Normal" },
          };
          const pri = priorityStyle[job.priority] || priorityStyle.normal;
          const borderColor = job.priority==="urgent" ? T.red+"44" : job.priority==="high" ? T.amber+"44" : daysLeft!==null&&daysLeft<0 ? T.red+"44" : T.border;
          const totalUnits = (job.items||[]).reduce((a:number,it:any) =>
            a + (it.buy_sheet_lines||[]).reduce((b:number,l:any) => b+(l.qty_ordered||0), 0), 0);
          const totalRevenue = (job as any).costing_summary?.grossRev ||
            (job.items||[]).reduce((a:number,it:any) => {
              const qty = (it.buy_sheet_lines||[]).reduce((b:number,l:any) => b+(l.qty_ordered||0), 0);
              return a + (it.sell_per_unit||0) * qty;
            }, 0);

          return (
            <div key={job.id} onClick={() => router.push(`/jobs/${job.id}`)}
              style={{ background:T.card, border:`1px solid ${borderColor}`, borderRadius:10, cursor:"pointer", transition:"background 0.1s", display:"flex", alignItems:"center", gap:12, padding:"11px 14px" }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = T.surface}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = T.card}>

              {/* Client + project name */}
              <div style={{ width:240, flexShrink:0 }}>
                <div style={{ fontSize:14, fontWeight:700, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{job.clients?.name||"No client"}</div>
                <div style={{ fontSize:11, color:T.muted, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{job.title} · <span style={{ fontFamily:mono, fontSize:10 }}>{job.job_number}</span></div>
              </div>

              {/* Units + Revenue stats */}
              <div style={{ display:"flex", gap:20, width:160, flexShrink:0 }}>
                <div>
                  <div style={{ fontSize:10, color:T.muted, marginBottom:2 }}>Units</div>
                  <div style={{ fontSize:13, fontWeight:600, color:T.text, fontFamily:mono }}>{totalUnits>0?totalUnits.toLocaleString():"—"}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T.muted, marginBottom:2 }}>Revenue</div>
                  <div style={{ fontSize:13, fontWeight:600, color:totalRevenue>0?T.accent:T.muted, fontFamily:mono }}>{totalRevenue>0?"$"+Math.round(totalRevenue).toLocaleString():"—"}</div>
                </div>
              </div>

              <div style={{ flex:1 }}/>

              {/* Priority - fixed width so columns align */}
              <div style={{ width:110, flexShrink:0, display:"flex", justifyContent:"center" }}>
                <span style={{ padding:"2px 9px", borderRadius:99, fontSize:11, fontWeight:600, background:pri.bg, color:pri.text, whiteSpace:"nowrap" }}>{pri.label}</span>
              </div>

              {/* Phase - fixed width */}
              <div style={{ width:120, flexShrink:0, display:"flex", justifyContent:"center" }}>
                <span style={{ padding:"2px 9px", borderRadius:99, fontSize:11, fontWeight:600, background:phase.bg, color:phase.text, whiteSpace:"nowrap" }}>{phase.label}</span>
              </div>

              {/* Progress */}
              <div style={{ width:120, flexShrink:0 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                  <span style={{ fontSize:10, color:T.muted }}>Progress</span>
                  <span style={{ fontSize:11, fontWeight:700, color:pctColor, fontFamily:mono }}>{pct}%</span>
                </div>
                <div style={{ height:5, background:T.surface, borderRadius:3 }}>
                  <div style={{ height:"100%", width:pct+"%", background:pctColor, borderRadius:3, transition:"width 0.4s" }}/>
                </div>
              </div>

              {/* Days */}
              <div style={{ textAlign:"right", minWidth:56, flexShrink:0 }}>
                {daysLeft !== null ? (
                  <>
                    <div style={{ fontSize:14, fontWeight:700, color:daysLeft<0?T.red:daysLeft<=3?T.amber:T.muted, fontFamily:mono }}>
                      {daysLeft<0?Math.abs(daysLeft)+"d over":daysLeft===0?"Today":daysLeft+"d"}
                    </div>
                    <div style={{ fontSize:10, color:T.faint }}>
                      {new Date(job.target_ship_date!).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    </div>
                  </>
                ) : <span style={{ fontSize:10, color:T.faint }}>No date</span>}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
