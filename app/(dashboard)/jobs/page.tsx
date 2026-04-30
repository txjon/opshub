"use client";
import React, { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/lib/useIsMobile";
import { effectiveRevenue } from "@/lib/revenue";
import { deriveAggregateStatus } from "@/lib/payment-status";

type Job = {
  id: string; title: string; job_type: string; phase: string; priority: string;
  target_ship_date: string|null; job_number: string; created_at: string;
  type_meta?: Record<string, any>|null;
  clients?: { name: string }|null;
  items?: { id: string; pipeline_stage: string|null }[];
};

// Phase labels only — no background colors. List rows use plain
// uppercase text for the label and leave color for actual signal
// (overdue ship dates, Hot/Rush priority).
const PHASE_LABELS: Record<string, string> = {
  intake: "Intake",
  pending: "Pending",
  ready: "Ready",
  pre_production: "Pre-Production",
  production: "Production",
  receiving: "Receiving",
  shipping: "Shipping",
  fulfillment: "Fulfillment",
  complete: "Complete",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

// Per-item bucket rollup for the row's status column. Multi-vendor
// jobs commonly have items in different states at the same time:
// 2 items waiting on PO, 2 in production, 1 received. The job-level
// phase column only shows the dominant blocker — we want to surface
// every state with a count.
//
// Buckets render in workflow order; only those with count > 0 show.
type StatusBucket = { key: string; label: string; color: string; count: number };
function getStatusBuckets(job: any, T: any): StatusBucket[] {
  const items = job.items || [];
  if (items.length === 0) return [];
  const costProds = (job.costing_data?.costProds || []) as any[];
  const cpById: Record<string, any> = {};
  for (const cp of costProds) cpById[cp.id] = cp;
  const poSent = new Set<string>(job.type_meta?.po_sent_vendors || []);

  const counts: Record<string, number> = {
    needs_po: 0, production: 0, receiving: 0, at_hpd: 0,
  };
  for (const it of items) {
    if (it.received_at_hpd === true) { counts.at_hpd++; continue; }
    if (it.pipeline_stage === "shipped") { counts.receiving++; continue; }
    if (it.pipeline_stage === "in_production") { counts.production++; continue; }
    // Item not yet at decorator. If vendor assigned and PO not sent, it
    // needs a PO. If no vendor yet, it's still in earlier setup —
    // ignored here so the row doesn't shout pre-cost noise.
    const vendor = cpById[it.id]?.printVendor;
    if (vendor && !poSent.has(vendor)) counts.needs_po++;
  }
  const out: StatusBucket[] = [];
  if (counts.needs_po) out.push({ key: "needs_po", label: "Needs PO", color: T.amber, count: counts.needs_po });
  if (counts.production) out.push({ key: "production", label: "Production", color: T.accent, count: counts.production });
  if (counts.receiving) out.push({ key: "receiving", label: "Receiving", color: T.blue, count: counts.receiving });
  if (counts.at_hpd) out.push({ key: "at_hpd", label: "At HPD", color: T.purple, count: counts.at_hpd });
  return out;
}

function getItemProgress(job: any): string {
  const items = job.items || [];
  if (!items.length) return "";
  const total = items.length;
  const phase = job.phase;
  if (phase === "complete" || phase === "cancelled") return "";
  const received = items.filter((it: any) => it.received_at_hpd).length;
  if (received > 0 && received < total) return `${received}/${total} received`;
  const shipped = items.filter((it: any) => it.pipeline_stage === "shipped").length;
  if (shipped > 0) return `${shipped}/${total} shipped`;
  const inProd = items.filter((it: any) => it.pipeline_stage === "in_production" || it.pipeline_stage === "shipped").length;
  if (inProd > 0) return `${inProd}/${total} at decorator`;
  return "";
}

import { T, font, mono } from "@/lib/theme";

export default function JobsPage() {
  const router = useRouter();
  const supabase = createClient();
  const isMobile = useIsMobile();
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
      .select("*, clients(name), costing_summary, costing_data, type_meta, payment_records(amount, status), items(id, sell_per_unit, cost_per_unit, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, garment_type, received_at_hpd, buy_sheet_lines(qty_ordered), decorator_assignments(pipeline_stage))")
      .order("created_at", { ascending: false });
    if (data) setJobs(data as Job[]);
    setLoading(false);
  }

  const getJobPct = (job: Job) => {
    const phase = job.phase;
    const pcts: Record<string,number> = { intake:10, pending:20, ready:30, pre_production:40, production:60, receiving:80, shipping:85, fulfillment:90, complete:100, cancelled:0 };
    return pcts[phase] || 0;
  };

  const getInHandsDate = (job: Job) => job.target_ship_date || job.type_meta?.in_hands_date || job.type_meta?.show_date || null;

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

  // Active-pipeline KPIs (Projects · Items · Units · Prints). These
  // moved here from the team Command Center per the rule "vanity KPIs
  // live on their domain page + the owner's insights." Active = Labs
  // domain. Match the Active filter: any item not yet shipped from
  // its decorator. Phase rolls to "receiving" once ONE item ships,
  // but multi-vendor projects often still have items at other
  // decorators — that's still active work for these KPIs.
  const kpis = useMemo(() => {
    const active = jobs.filter(j => {
      if (["complete","cancelled","on_hold"].includes(j.phase)) return false;
      const items = (j as any).items || [];
      return items.length === 0 || items.some((it: any) => it.pipeline_stage !== "shipped");
    });
    const items = active.flatMap(j => (j as any).items || []);
    const units = items.reduce(
      (s: number, it: any) => s + ((it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0)),
      0,
    );
    const NON_GARMENT = new Set(["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"]);
    let prints = 0;
    for (const j of active) {
      const costProds = ((j as any).costing_data?.costProds || []) as any[];
      for (const cp of costProds) {
        const qty = cp.totalQty || 0;
        if (qty === 0) continue;
        const activeLocs = [1,2,3,4,5,6].filter(loc => {
          const ld = cp.printLocations?.[loc];
          return ld?.screens > 0 || ld?.location;
        }).length;
        const hasTag = cp.tagPrint ? 1 : 0;
        const decoCount = NON_GARMENT.has(cp.garment_type)
          ? ((cp.customCosts?.length || 0) > 0 ? 1 : 0)
          : activeLocs + hasTag;
        prints += decoCount * qty;
      }
    }
    return { projects: active.length, items: items.length, units, prints };
  }, [jobs]);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    return jobs.filter(j => {
      // Active = any item not yet shipped from its decorator. Phase
      // rolls to "receiving" once ONE item ships, but a multi-vendor
      // project may still have 4 of 5 items at decorators — that's
      // active production work and the project stays here.
      // The job-level phase column is too coarse: it can't tell
      // "shipped 1 of 5" from "shipped 5 of 5". Item-level pipeline
      // stage is the source of truth.
      const items = j.items || [];
      const hasUnshipped = items.length === 0 || items.some(it => it.pipeline_stage !== "shipped");
      const isTerminal = ["complete","cancelled","on_hold"].includes(j.phase);
      if (filter === "active") {
        if (isTerminal) return false;
        if (!hasUnshipped) return false; // every item shipped → leaves Active
      } else if (filter !== "all" && j.phase !== filter) {
        return false;
      }
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
    } else if (sortKey === "invoice_number") {
      // Numeric-aware: QB returns invoice numbers as strings ("4170")
      // but they're naturally numeric. Coerce when possible; rows
      // without an invoice number sort to the bottom.
      const ai = a.type_meta?.qb_invoice_number;
      const bi = b.type_meta?.qb_invoice_number;
      av = ai ? (Number(ai) || ai) : Infinity;
      bv = bi ? (Number(bi) || bi) : Infinity;
    } else if (sortKey === "pct") {
      av = getJobPct(a); bv = getJobPct(b);
    } else {
      av = a.title.toLowerCase(); bv = b.title.toLowerCase();
    }
    const r = typeof av === "string" ? (av < bv ? -1 : av > bv ? 1 : 0) : (av - bv);
    return sortDir === "asc" ? r : -r;
  }), [visible, sortKey, sortDir]);

  if (loading) return (
    <div style={{ padding:"2rem", color: T.muted, fontFamily: font, fontSize: 13 }}>Loading projects...</div>
  );

  return (
    <div style={{ fontFamily: font, color: T.text, display:"flex", flexDirection:"column", gap:14 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:isMobile?"stretch":"center", gap:isMobile?10:12, flexDirection:isMobile?"column":"row", flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <h1 style={{ fontSize:isMobile?20:22, fontWeight:700, margin:0, letterSpacing:"-0.02em" }}>Projects</h1>
          {isMobile && (
            <a href="/jobs/new" style={{ background:T.accent, color:"#fff", border:"none", borderRadius:8, padding:"8px 14px", fontSize:13, fontFamily:font, fontWeight:600, cursor:"pointer", textDecoration:"none", whiteSpace:"nowrap" }}>
              + New
            </a>
          )}
        </div>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search clients, titles, job numbers..."
          style={{ flex:1, maxWidth:isMobile?"100%":360, padding:"7px 12px", borderRadius:8, border:`1px solid ${T.border}`, background:T.surface, color:T.text, fontSize:13, fontFamily:font, outline:"none" }}
        />
        {!isMobile && (
          <a href="/jobs/new" style={{ background:T.accent, color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontFamily:font, fontWeight:600, cursor:"pointer", textDecoration:"none", whiteSpace:"nowrap" }}>
            + New Project
          </a>
        )}
      </div>

      {/* KPI strip — active pipeline at a glance. Vanity counts moved
          here from the team Command Center; this is their proper home. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 10,
      }}>
        <KpiTile label="Projects" value={kpis.projects.toLocaleString()} />
        <KpiTile label="Items" value={kpis.items.toLocaleString()} tone={T.blue} />
        <KpiTile label="Units" value={kpis.units.toLocaleString()} tone={T.muted} />
        <KpiTile label="Prints" value={kpis.prints.toLocaleString()} tone={T.purple} />
      </div>

      {/* Filter + sort bar — slim, no pill chrome. Per-phase browsing
          went away when the Command Center took over urgency triage;
          this page is now mostly "find a specific project." Four
          top-level buckets cover the browse modes; phase still shows
          per-row in the PHASE column for scanning. */}
      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", borderBottom:`1px solid ${T.border}`, paddingBottom:6 }}>
        {([
          ["active",   "Active",    jobs.filter(j => {
            if (["complete","cancelled","on_hold"].includes(j.phase)) return false;
            const items = (j as any).items || [];
            return items.length === 0 || items.some((it: any) => it.pipeline_stage !== "shipped");
          }).length],
          ["on_hold",  "On Hold",   phaseCounts.on_hold],
          ["complete", "Complete",  phaseCounts.complete],
          ["cancelled","Cancelled", phaseCounts.cancelled],
        ] as const).map(([k, l, count]) => {
          const active = filter === k;
          return (
            <button key={k} onClick={() => setFilter(k)}
              style={{
                background:"none", border:"none", padding:"4px 0",
                cursor:"pointer", fontFamily:font,
                fontSize:13, fontWeight: active ? 800 : 600,
                color: active ? T.text : T.muted,
                borderBottom: active ? `2px solid ${T.text}` : "2px solid transparent",
                marginBottom:-7,
                display:"inline-flex", alignItems:"baseline", gap:5,
              }}>
              {l}
              {count > 0 && (
                <span style={{ fontSize:10, fontWeight:700, color: active ? T.muted : T.faint }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <select value={sortKey} onChange={e => setSortKey(e.target.value)}
          style={{
            marginLeft:"auto",
            background:"none", border:"none",
            padding:"4px 0",
            fontSize:11, fontFamily:font, fontWeight:700,
            color:T.muted, outline:"none", cursor:"pointer",
            letterSpacing:"0.06em", textTransform:"uppercase",
          }}>
          <option value="target_ship_date">Sort · Ship date</option>
          <option value="client">Sort · Client</option>
          <option value="priority">Sort · Priority</option>
          <option value="phase">Sort · Phase</option>
          <option value="invoice_number">Sort · Invoice #</option>
        </select>
      </div>

      {/* Job list */}
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {sorted.length === 0 && (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:32, textAlign:"center", fontSize:12, color:T.faint }}>
            No projects in this view.
          </div>
        )}
        {sorted.map(job => {
          const phaseLabel = PHASE_LABELS[job.phase] || "—";
          const ih = getInHandsDate(job);
          const daysLeft = ih ? Math.ceil((new Date(ih).getTime() - now.getTime()) / (1000*60*60*24)) : null;
          const totalUnits = (job.items||[]).reduce((a:number,it:any) =>
            a + (it.buy_sheet_lines||[]).reduce((b:number,l:any) => b+(l.qty_ordered||0), 0), 0);

          const invNum = job.type_meta?.qb_invoice_number;
          const invoiceSentAt = (job as any).type_meta?.invoice_sent_at;
          const progress = getItemProgress(job);

          // Aggregate paid status: sum collected vs invoice total. Single
          // ".status === paid" check over-claims when a partial QB payment
          // has been received but balance remains.
          const invoiceTotal = Number((job as any).type_meta?.qb_total_with_tax)
            || Number((job as any).costing_summary?.grossRev)
            || 0;
          const aggStatus = deriveAggregateStatus({
            payments: (job as any).payment_records || [],
            invoiceTotal,
          });
          // "Invoice Sent" only after OpsHub actually emailed the invoice
          // (invoice_sent_at). Pushing to QB alone shows "Invoice Drafted"
          // — invoice exists internally but client hasn't seen it yet.
          const status: { label: string; green?: boolean; amber?: boolean } | null =
            aggStatus === "paid" ? { label: "Paid", green: true }
            : aggStatus === "partial" ? { label: "Partial Paid", amber: true }
            : invoiceSentAt ? { label: "Invoice Sent" }
            : invNum ? { label: "Invoice Drafted" }
            : (job as any).quote_approved ? { label: "Quote Approved" }
            : null;

          // Priority only shown for non-normal. Red for hot, amber for rush.
          const pri: { label: string; color: string } | null =
            job.priority === "hot" ? { label: "HOT", color: T.red } :
            job.priority === "rush" ? { label: "RUSH", color: T.amber } : null;

          // Once a project is complete/cancelled, the countdown is just
          // historical — don't keep flagging "Xd over" in red. Active
          // jobs still get the urgency coloring + the "Xd over" wording.
          const isClosed = job.phase === "complete" || job.phase === "cancelled";
          const dateColor = daysLeft === null
            ? T.muted
            : isClosed
              ? T.muted
              : daysLeft < 0
                ? T.red
                : daysLeft <= 3
                  ? T.amber
                  : T.muted;

          if (isMobile) {
            return (
              <div key={job.id} onClick={() => router.push(`/jobs/${job.id}`)}
                style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, cursor:"pointer", padding:"10px 12px", display:"flex", flexDirection:"column", gap:6 }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:T.text, wordBreak:"break-word", lineHeight:1.25, flex:1, minWidth:0 }}>
                    {job.clients?.name||"No client"}
                  </div>
                  {pri && <span style={{ fontSize:10, fontWeight:700, color:pri.color, letterSpacing:"0.08em", whiteSpace:"nowrap" }}>{pri.label}</span>}
                </div>
                <div style={{ fontSize:12, color:T.faint, wordBreak:"break-word", lineHeight:1.35 }}>
                  {job.title}{job.title ? " · " : ""}<span style={{ fontFamily:mono }}>{invNum || job.job_number}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginTop:2, fontSize:11 }}>
                  {(() => {
                    const isTerminal = ["complete","cancelled","on_hold"].includes(job.phase);
                    const buckets = isTerminal ? [] : getStatusBuckets(job, T);
                    if (buckets.length === 0) {
                      return <>
                        <span style={{ color:T.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>{phaseLabel}</span>
                        {progress && <span style={{ color:T.faint, fontFamily:mono }}>{progress}</span>}
                      </>;
                    }
                    return buckets.map(b => (
                      <span key={b.key} style={{ color:b.color, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>
                        {b.label} <span style={{ fontFamily:mono }}>· {b.count}</span>
                      </span>
                    ));
                  })()}
                  {totalUnits > 0 && <span style={{ color:T.muted, fontFamily:mono }}>{totalUnits.toLocaleString()} units</span>}
                  {status && (
                    <span style={{ color: status.green ? T.green : status.amber ? T.amber : T.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", fontSize:10 }}>
                      {status.label}
                    </span>
                  )}
                </div>
                {daysLeft !== null && (
                  <div style={{ display:"flex", alignItems:"baseline", gap:6, fontFamily:mono }}>
                    <span style={{ fontSize:12, fontWeight:700, color:dateColor }}>
                      {daysLeft<0?Math.abs(daysLeft)+"d over":daysLeft===0?"Ships today":daysLeft+"d to ship"}
                    </span>
                    <span style={{ fontSize:10, color:T.faint }}>
                      {new Date(job.target_ship_date!).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    </span>
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={job.id} onClick={() => router.push(`/jobs/${job.id}`)}
              style={{
                background:T.card, border:`1px solid ${T.border}`, borderRadius:10,
                cursor:"pointer", transition:"background 0.1s",
                display:"grid", gridTemplateColumns:"68px 1fr 130px 130px 200px 100px",
                alignItems:"center", gap:14, padding:"12px 18px", minHeight:56,
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = T.surface}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = T.card}>

              {/* Invoice number — left-anchor identifier when present.
                  Replaces the priority chip; priority moved to the
                  right side above ship date. */}
              <span style={{ fontSize:14, fontWeight:700, color: invNum ? T.text : "transparent", fontFamily:mono, whiteSpace:"nowrap" }}>
                {invNum || ""}
              </span>

              {/* Client + title */}
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:700, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {job.clients?.name||"No client"}
                </div>
                <div style={{ fontSize:12, color:T.faint, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {job.title}{job.title ? " · " : ""}<span style={{ fontFamily:mono }}>{job.job_number}</span>
                </div>
              </div>

              {/* Status */}
              <div style={{ fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", color: status?.green ? T.green : status?.amber ? T.amber : T.muted, whiteSpace:"nowrap" }}>
                {status?.label || ""}
              </div>

              {/* Units */}
              <div style={{ fontSize:13, fontWeight:600, color:T.text, fontFamily:mono, whiteSpace:"nowrap" }}>
                {totalUnits>0?totalUnits.toLocaleString():"—"} <span style={{ fontSize:11, fontWeight:400, color:T.muted }}>units</span>
              </div>

              {/* Phase + progress — multi-bucket for active in-flight jobs,
                   plain phase label for terminal/parked phases. */}
              <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
                {(() => {
                  const isTerminal = ["complete","cancelled","on_hold"].includes(job.phase);
                  const buckets = isTerminal ? [] : getStatusBuckets(job, T);
                  if (buckets.length === 0) {
                    return (
                      <>
                        <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", whiteSpace:"nowrap" }}>{phaseLabel}</span>
                        {progress && <span style={{ fontSize:10, color:T.faint, fontFamily:mono, whiteSpace:"nowrap" }}>{progress}</span>}
                      </>
                    );
                  }
                  return (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:"2px 10px" }}>
                      {buckets.map(b => (
                        <span key={b.key} style={{ fontSize:11, fontWeight:700, color:b.color, textTransform:"uppercase", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>
                          {b.label} <span style={{ fontFamily:mono, fontWeight:600 }}>· {b.count}</span>
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Priority (top) + Ship date (bottom) — right-anchored
                  signal column. Priority only renders when non-normal;
                  ship date is always visible when set. */}
              <div style={{ textAlign:"right", minWidth:0, display:"flex", flexDirection:"column", gap:2 }}>
                {pri && (
                  <span style={{ fontSize:10, fontWeight:800, color:pri.color, letterSpacing:"0.1em", whiteSpace:"nowrap" }}>
                    {pri.label}
                  </span>
                )}
                {daysLeft !== null ? (
                  <>
                    {!isClosed && (
                      <div style={{ fontSize:13, fontWeight:700, color:dateColor, fontFamily:mono, whiteSpace:"nowrap" }}>
                        {daysLeft<0?Math.abs(daysLeft)+"d over":daysLeft===0?"Today":daysLeft+"d"}
                      </div>
                    )}
                    <div style={{ fontSize:isClosed?12:10, fontWeight:isClosed?600:400, color:isClosed?T.muted:T.faint, whiteSpace:"nowrap", fontFamily:isClosed?mono:undefined }}>
                      {new Date(job.target_ship_date!).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    </div>
                  </>
                ) : !pri && <span style={{ fontSize:10, color:T.faint }}>No date</span>}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone || T.text, lineHeight: 1, fontFamily: mono }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: T.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}
