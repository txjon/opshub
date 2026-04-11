"use client";
import React, { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type Job = {
  id: string; title: string; job_type: string; phase: string; priority: string;
  target_ship_date: string|null; job_number: string; created_at: string;
  type_meta?: Record<string, any>|null;
  clients?: { name: string }|null;
  items?: { id: string; pipeline_stage: string|null }[];
};

const PHASE_COLORS: Record<string,{bg:string,text:string,label:string}> = {
  intake:        { bg:T.accentDim, text:T.accent, label:"Intake" },
  pending:       { bg:T.amberDim, text:"#a07008", label:"Pending" },
  ready:         { bg:T.amberDim, text:"#a07008", label:"Ready" },
  pre_production:{ bg:T.blueDim, text:"#3a8a9e", label:"Pre-Production" },
  production:    { bg:T.blueDim, text:"#3a8a9e", label:"Production" },
  receiving:     { bg:T.blueDim, text:"#3a8a9e", label:"Receiving" },
  shipping:      { bg:T.blueDim, text:"#3a8a9e", label:"Shipping" },
  fulfillment:   { bg:T.purpleDim, text:"#c4207a", label:"Fulfillment" },
  complete:      { bg:T.greenDim, text:"#2a9e5c", label:"Complete" },
  on_hold:       { bg:T.redDim, text:T.red, label:"On Hold" },
  cancelled:     { bg:T.accentDim, text:T.muted, label:"Cancelled" },
};

const getPct = (stage: string|null) => {
  const pcts: Record<string,number> = { blanks_ordered:25, in_production:50, shipped:100 };
  return stage ? (pcts[stage] || 0) : 0;
};

function getItemProgress(job: any): string {
  const items = job.items || [];
  if (!items.length) return "";
  const total = items.length;
  const phase = job.phase;
  if (phase === "complete") return `${total}/${total} complete`;
  const shipped = items.filter((it: any) => it.pipeline_stage === "shipped" && it.ship_tracking).length;
  if (shipped > 0) return `${shipped}/${total} shipped`;
  const inProd = items.filter((it: any) => it.pipeline_stage === "in_production" || it.pipeline_stage === "shipped").length;
  if (inProd > 0) return `${inProd}/${total} in production`;
  const apparel = items.filter((it: any) => it.garment_type !== "accessory");
  const ordered = apparel.filter((it: any) => it.blanks_order_number).length;
  if (apparel.length > 0 && ordered > 0) return `${ordered}/${apparel.length} blanks ordered`;
  return `${total} items`;
}

import { T, font, mono } from "@/lib/theme";

export default function JobsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("target_ship_date");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");
  const now = new Date();

  useEffect(() => { loadJobs(); }, []);

  async function loadJobs() {
    setLoading(true);
    const { data } = await supabase
      .from("jobs")
      .select("*, clients(name), costing_summary, type_meta, payment_records(status), items(id, sell_per_unit, cost_per_unit, pipeline_stage, blanks_order_number, ship_tracking, garment_type, buy_sheet_lines(qty_ordered), decorator_assignments(pipeline_stage))")
      .order("created_at", { ascending: false });
    if (data) setJobs(data as Job[]);
    setLoading(false);
  }

  const getJobPct = (job: Job) => {
    const items = job.items || [];
    if (!items.length) return 0;
    const pcts = items.map((it: any) => getPct(it.pipeline_stage || it.decorator_assignments?.[0]?.pipeline_stage || null));
    return Math.round(pcts.reduce((a,p) => a+p, 0) / pcts.length);
  };

  const getInHandsDate = (job: Job) => job.type_meta?.in_hands_date || job.type_meta?.show_date || null;

  const getFlags = (job: Job) => {
    const flags: { label: string; color: string }[] = [];
    const ih = getInHandsDate(job);
    if (ih && new Date(ih) < now && !["complete","cancelled"].includes(job.phase)) {
      flags.push({ label: "Overdue", color: T.red });
    }
    if (job.priority === "hot") flags.push({ label: "Hot", color: T.red });
    if (job.priority === "rush") flags.push({ label: "Rush", color: T.amber });
    return flags;
  };

  const phaseCounts = useMemo(() => ({
    intake: jobs.filter(j => j.phase === "intake").length,
    pending: jobs.filter(j => j.phase === "pending").length,
    ready: jobs.filter(j => j.phase === "ready").length,
    production: jobs.filter(j => j.phase === "production").length,
    receiving: jobs.filter(j => j.phase === "receiving").length,
    fulfillment: jobs.filter(j => j.phase === "fulfillment").length,
    complete: jobs.filter(j => j.phase === "complete").length,
    cancelled: jobs.filter(j => j.phase === "cancelled").length,
    on_hold: jobs.filter(j => j.phase === "on_hold").length,
  }), [jobs]);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    return jobs.filter(j => {
      // Phase filter
      if (filter === "active" && ["complete","cancelled"].includes(j.phase)) return false;
      if (filter !== "active" && filter !== "all" && j.phase !== filter) return false;
      // Text search
      if (q && !(
        (j.clients?.name || "").toLowerCase().includes(q) ||
        j.title.toLowerCase().includes(q) ||
        j.job_number.toLowerCase().includes(q) ||
        (j.type_meta?.qb_invoice_number || "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [jobs, filter, search]);

  const sorted = useMemo(() => [...visible].sort((a,b) => {
    let av: any, bv: any;
    if (sortKey === "target_ship_date") {
      av = a.target_ship_date ? new Date(a.target_ship_date).getTime() : Infinity;
      bv = b.target_ship_date ? new Date(b.target_ship_date).getTime() : Infinity;
    } else if (sortKey === "client") {
      av = (a.clients?.name || "").toLowerCase();
      bv = (b.clients?.name || "").toLowerCase();
    } else if (sortKey === "priority") {
      const order: Record<string,number> = { hot:0, rush:1, normal:2 };
      av = order[a.priority] ?? 3; bv = order[b.priority] ?? 3;
    } else if (sortKey === "phase") {
      const order: Record<string,number> = { intake:0, pending:1, ready:2, production:3, receiving:4, fulfillment:5, complete:6 };
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
    <div style={{ padding:"2rem", color: T.muted, fontFamily: font, fontSize: 13 }}>Loading projects...</div>
  );

  return (
    <div style={{ fontFamily: font, color: T.text, display:"flex", flexDirection:"column", gap:14 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <h1 style={{ fontSize:22, fontWeight:700, margin:0, letterSpacing:"-0.02em" }}>Projects</h1>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search clients, titles, job numbers..."
          style={{ flex:1, maxWidth:360, padding:"7px 12px", borderRadius:8, border:`1px solid ${T.border}`, background:T.surface, color:T.text, fontSize:13, fontFamily:font, outline:"none" }}
        />
        <a href="/jobs/new" style={{ background:T.accent, color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontFamily:font, fontWeight:600, cursor:"pointer", textDecoration:"none", whiteSpace:"nowrap" }}>
          + New Project
        </a>
      </div>

      {/* Filter + sort bar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:3, background:T.surface, padding:3, borderRadius:8 }}>
          {[
            ["active","All Active",jobs.filter(j => !["complete","cancelled"].includes(j.phase)).length],
            ["intake","Intake",phaseCounts.intake],
            ["pending","Pending",phaseCounts.pending],
            ["ready","Ready",phaseCounts.ready],
            ["production","Production",phaseCounts.production],
            ["receiving","Receiving",phaseCounts.receiving],
            ["fulfillment","Fulfillment",phaseCounts.fulfillment],
            ["on_hold","On Hold",phaseCounts.on_hold],
            ["complete","Complete",phaseCounts.complete],
            ["cancelled","Cancelled",phaseCounts.cancelled],
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
            No projects in this view.
          </div>
        )}
        {sorted.map(job => {
          const phase = PHASE_COLORS[job.phase] || PHASE_COLORS.intake;
          const flags = getFlags(job);
          const pct = getJobPct(job);
          const pctColor = pct === 100 ? T.green : pct >= 60 ? T.accent : pct >= 30 ? T.amber : T.muted;
          const ih = getInHandsDate(job);
          const daysLeft = ih ? Math.ceil((new Date(ih).getTime() - now.getTime()) / (1000*60*60*24)) : null;
          const itemCount = job.items?.length || 0;

          const priorityStyle: Record<string,{bg:string,text:string,label:string}> = {
            hot:    { bg:T.purpleDim, text:"#c4207a", label:"Hot" },
            rush:   { bg:T.amberDim, text:"#a07008", label:"Rush" },
            normal: { bg:T.accentDim, text:T.accent, label:"Normal" },
          };
          const pri = priorityStyle[job.priority] || priorityStyle.normal;
          const borderColor = job.priority==="hot" ? T.red+"44" : job.priority==="rush" ? T.amber+"44" : daysLeft!==null&&daysLeft<0 ? T.red+"44" : T.border;
          const totalUnits = (job.items||[]).reduce((a:number,it:any) =>
            a + (it.buy_sheet_lines||[]).reduce((b:number,l:any) => b+(l.qty_ordered||0), 0), 0);
          const totalRevenue = (job as any).costing_summary?.grossRev ||
            (job.items||[]).reduce((a:number,it:any) => {
              const qty = (it.buy_sheet_lines||[]).reduce((b:number,l:any) => b+(l.qty_ordered||0), 0);
              return a + (it.sell_per_unit||0) * qty;
            }, 0);

          const invNum = job.type_meta?.qb_invoice_number;
          const progress = getItemProgress(job);

          return (
            <div key={job.id} onClick={() => router.push(`/jobs/${job.id}`)}
              style={{ background:T.card, border:`1px solid ${borderColor}`, borderRadius:10, cursor:"pointer", transition:"background 0.1s", display:"flex", alignItems:"center", gap:14, padding:"10px 14px", height:56 }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = T.surface}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = T.card}>

              {/* Priority indicator */}
              {job.priority !== "normal" ? (
                <span style={{ padding:"2px 8px", borderRadius:99, fontSize:10, fontWeight:700, background:pri.bg, color:pri.text, whiteSpace:"nowrap", flexShrink:0 }}>{pri.label}</span>
              ) : (
                <span style={{ width:36, flexShrink:0 }}/>
              )}

              {/* Client + memo */}
              <div style={{ width:360, flexShrink:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {job.clients?.name||"No client"}
                </div>
                <div style={{ fontSize:12, color:"#9aa3c0", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {job.title}{job.title ? " · " : ""}<span style={{ fontFamily:mono }}>{invNum || job.job_number}</span>{invNum && <span style={{ color:T.faint, marginLeft:4, fontSize:10 }}>{job.job_number}</span>}
                </div>
              </div>

              {/* Status signals */}
              <div style={{ display:"flex", gap:4, alignItems:"center", flex:1, flexWrap:"wrap" }}>
                {job.quote_approved && <span style={{ fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:99, background:T.greenDim, color:T.green, whiteSpace:"nowrap" }}>Quote Approved</span>}
                {invNum && !(job as any).payment_records?.some((p:any) => p.status === "paid") && <span style={{ fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:99, background:T.accentDim, color:T.accent, whiteSpace:"nowrap" }}>Invoice Ready</span>}
                {(job as any).payment_records?.some((p:any) => p.status === "paid") && <span style={{ fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:99, background:T.greenDim, color:T.green, whiteSpace:"nowrap" }}>Paid</span>}
                {job.items?.some((it:any) => it.pipeline_stage === "shipped") && <span style={{ fontSize:9, fontWeight:600, padding:"2px 6px", borderRadius:99, background:T.purpleDim, color:T.purple, whiteSpace:"nowrap" }}>Items Shipped</span>}
              </div>

              {/* Units */}
              <span style={{ fontSize:13, fontWeight:600, color:T.text, fontFamily:mono }}>{totalUnits>0?totalUnits.toLocaleString():"—"} <span style={{ fontSize:11, fontWeight:400, color:T.muted }}>units</span></span>

              {/* Phase infographic */}
              <div style={{ width:330, flexShrink:0 }}>
                <div style={{ position:"relative", background:phase.bg, borderRadius:8, padding:"6px 10px", overflow:"hidden" }}>
                  {/* Progress fill */}
                  <div style={{ position:"absolute", top:0, left:0, bottom:0, width:pct+"%", background:phase.text+"18", borderRadius:8, transition:"width 0.4s" }}/>
                  <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"space-between", whiteSpace:"nowrap", overflow:"hidden" }}>
                    <div style={{ overflow:"hidden", textOverflow:"ellipsis" }}>
                      <span style={{ fontSize:14, fontWeight:700, color:phase.text }}>{phase.label}</span>
                      {progress && <span style={{ fontSize:12, color:"rgba(255,255,255,0.6)", marginLeft:6, fontFamily:mono }}>{progress}</span>}
                    </div>
                    <span style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.5)", fontFamily:mono, marginLeft:6, flexShrink:0 }}>{pct}%</span>
                  </div>
                </div>
              </div>

              {/* Ship date */}
              <div style={{ textAlign:"right", minWidth:56, flexShrink:0 }}>
                {daysLeft !== null ? (
                  <>
                    <div style={{ fontSize:13, fontWeight:700, color:daysLeft<0?T.red:daysLeft<=3?T.amber:T.muted, fontFamily:mono }}>
                      {daysLeft<0?Math.abs(daysLeft)+"d over":daysLeft===0?"Today":daysLeft+"d"}
                    </div>
                    <div style={{ fontSize:10, color:"#9aa3c0" }}>
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
