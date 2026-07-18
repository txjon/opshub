"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, SliceSortRow } from "@/components/board-kit";
import { loadJobPhasesBatch } from "@/lib/item-state";
import { deriveProjectStage, PROJ_MILESTONES, ROUTE_DEAD, type ProjStage } from "@/lib/project-stage";

// Projects Board V2 — the "find the job that needs action" board, on the shared
// V2 board-kit (matches /receiving chrome). Each job = a strip with a ticked
// progress bar; completed jobs bucket by client. See [[opshub-project-board-v2]].

type Row = { job: any; stage: ProjStage };
const routeLabel: Record<string, string> = { drop_ship: "drop-ship", ship_through: "ship-through", stage: "stage" };
// "at" a stage — quote_sent (the first column) is never a resting milestone, so it
// represents the pre-quote / quoting jobs; every other column matches its milestone.
const atStage = (r: Row, k: string) => k === "quote_sent" ? r.stage.preQuote : r.stage.milestone === k;
const selStyle = { padding: "9px 14px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontWeight: 700, fontFamily: font, outline: "none", cursor: "pointer" } as const;

export default function ProjectsBoard() {
  const supabase = createClient();
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [phaseViews, setPhaseViews] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("jobs")
        .select("id, job_number, title, phase, shipping_route, quote_approved, quote_approved_at, type_meta, costing_summary, clients(name), payment_records(amount, status, paid_date), items(id, pipeline_stage, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at)")
        .not("phase", "in", "(cancelled)")
        .order("created_at", { ascending: false });
      const js = (data as any[]) || [];
      setJobs(js);
      loadJobPhasesBatch(supabase, js.filter(j => j.phase !== "complete").map(j => j.id)).then(setPhaseViews).catch(() => {});
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  const rows: Row[] = useMemo(() => jobs.map(job => ({
    job, stage: deriveProjectStage(job, phaseViews.get(job.id), job.items || [], job.payment_records || []),
  })), [jobs, phaseViews]);

  const clientName = (r: Row) => (r.job.clients as any)?.name || "—";
  const clients = useMemo(() => [...new Set(rows.filter(r => !r.stage.complete).map(clientName))].sort(), [rows]);

  const q = query.toLowerCase().trim();
  const matchQ = (r: Row) => !q || `${r.job.job_number} ${clientName(r)} ${r.job.title || ""}`.toLowerCase().includes(q);
  const base = rows.filter(r => (!clientFilter || clientName(r) === clientFilter) && matchQ(r));
  const activeCQ = base.filter(r => !r.stage.complete); // client + search filtered — drives the stage counts
  const done = base.filter(r => r.stage.complete);
  const activeAll = rows.filter(r => !r.stage.complete);

  // Stage dropdown TRULY filters: only jobs at the picked stage show (newest first).
  const stageCounts = useMemo(() => Object.fromEntries(PROJ_MILESTONES.map(m => [m.k, activeCQ.filter(r => atStage(r, m.k)).length])) as Record<string, number>, [activeCQ]);
  const active = stageFilter ? activeCQ.filter(r => atStage(r, stageFilter)) : activeCQ;

  const doneByClient = useMemo(() => {
    const m: Record<string, Row[]> = {};
    for (const r of done) (m[clientName(r)] ??= []).push(r);
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [done]);

  const kpi = (k: string) => k === "active" ? activeAll.length : k === "action" ? activeAll.filter(r => !r.stage.preQuote && (r.stage.signal === "act" || r.stage.signal === "late")).length : activeAll.filter(r => r.stage.preQuote).length;

  return (
    <BoardFrame title="Projects">
      <ToggleSearch
        options={[["active", `Active · ${activeAll.length}`], ["completed", `Completed · ${rows.filter(r => r.stage.complete).length}`]]}
        value={tab} onChange={setTab} query={query} setQuery={setQuery} placeholder="Search client, job #, or title…" />

      {tab === "active" ? (
        loading ? <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center" }}>Loading…</div> : (<>
          <style>{`@keyframes projChipPop{from{transform:translateY(2px);opacity:.35}to{transform:none;opacity:1}}.proj-chip{animation:projChipPop .13s ease-out}`}</style>
          <KpiStrip metrics={[{ key: "active", label: "Active" }, { key: "action", label: "Need action" }, { key: "prequote", label: "Pre-quote" }]} get={kpi} onClick={() => { }} />
          <SliceSortRow>
            <span style={{ fontSize: 12, color: T.muted }}>{active.length} {active.length === 1 ? "project" : "projects"}{stageFilter ? <> at <b style={{ color: T.text }}>{PROJ_MILESTONES.find(m => m.k === stageFilter)?.label}</b></> : <> · newest first</>}</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} style={selStyle}>
                <option value="">All clients</option>
                {clients.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={selStyle}>
                <option value="">All stages</option>
                {PROJ_MILESTONES.map(m => <option key={m.k} value={m.k}>{m.label} ({stageCounts[m.k] || 0})</option>)}
              </select>
            </div>
          </SliceSortRow>

          {active.map(r => <Strip key={r.job.id} r={r} onOpen={() => router.push(`/jobs/${r.job.id}`)} />)}
          {active.length === 0 && <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginTop: 8 }}>No active projects match.</div>}
        </>)
      ) : (
        <div style={{ marginTop: 4 }}>
          {doneByClient.map(([c, list]) => (
            <div key={c} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{c} <span style={{ color: T.faint, fontWeight: 400, fontSize: 12 }}>· {list.length}</span></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {list.map(r => <button key={r.job.id} onClick={() => router.push(`/jobs/${r.job.id}`)} style={{ background: T.surface, border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontFamily: mono, color: T.muted, cursor: "pointer" }}>{r.job.job_number} · {r.job.title}</button>)}
              </div>
            </div>
          ))}
          {!doneByClient.length && <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center" }}>No completed projects match.</div>}
        </div>
      )}
    </BoardFrame>
  );
}

// Where each milestone's hover peek deep-links on click (layer 2 of the onion).
// Front stages → the job's tab (?tab= is read on load); tail → the dedicated page.
const STAGE_TARGET: Record<string, { label: string; href: (j: any) => string }> = {
  quote_sent:  { label: "Quote tab",        href: j => `/jobs/${j.id}?tab=quote` },
  quote_appr:  { label: "Proofs & Invoice", href: j => `/jobs/${j.id}?tab=proofs` },
  invoice:     { label: "Client Quote",     href: j => `/jobs/${j.id}?tab=quote` },
  paid:        { label: "Proofs & Invoice", href: j => `/jobs/${j.id}?tab=proofs` },
  order:       { label: "Purchase Order",   href: j => `/jobs/${j.id}?tab=po` },
  production:  { label: "Production board",  href: () => `/production` },
  receiving:   { label: "Receiving",         href: () => `/receiving` },
  shipping:    { label: "Shipping",          href: () => `/shipping` },
  fulfillment: { label: "Staging",           href: () => `/staging2` },
};

function Strip({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const { job, stage } = r;
  // Once a QB invoice # is assigned that's the number used everywhere (POs tie to
  // it, it matches QB) — lead with it, fall back to the job number pre-invoice.
  const invNo = (job.type_meta as any)?.qb_invoice_number || job.job_number;
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const dead = ROUTE_DEAD[stage.route] || [];
  const bars = PROJ_MILESTONES.filter(m => !dead.includes(m.k)); // only this route's real milestones — no N/A hatching
  const cur = bars.findIndex(m => m.k === stage.milestone);
  const sig = stage.signal;
  const edgeColor = sig === "late" ? T.red : sig === "act" ? T.amber : null; // wait → no edge (recedes)
  const N = bars.length;
  // Per-segment content for the styled hover popover (layer 1).
  const statusOf = (m: typeof PROJ_MILESTONES[number], i: number): { label: string; note: string; color: string } => {
    if (stage.preQuote) return m.k === "quote_sent" ? { label: "Your move", note: stage.now, color: T.amber } : { label: "Upcoming", note: "", color: T.faint };
    if (cur >= 0 && i < cur) return { label: "Done", note: "", color: T.green };
    if (i === cur) {
      const lbl = sig === "late" ? "Late" : sig === "act" ? "Your move" : "Waiting on them";
      const clr = sig === "late" ? T.red : sig === "act" ? T.amber : T.muted;
      return { label: lbl, note: stage.reason || stage.detail || stage.now, color: clr };
    }
    return { label: "Upcoming", note: "", color: T.faint };
  };
  // Rich per-stage hover peek (matches the interaction-map artifact), from loaded job data.
  const tm = (job.type_meta || {}) as any;
  const cs = (job.costing_summary || {}) as any;
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const fmtDT = (s?: string) => s ? `${new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "";
  const pays = (job.payment_records || []) as any[];
  const paidAmt = pays.filter(p => p.status === "paid").reduce((a, p) => a + (+p.amount || 0), 0);
  const paidDate = pays.filter(p => p.status === "paid" && p.paid_date).map(p => p.paid_date).sort().pop();
  const invTotal = tm.qb_total_with_tax || cs.grossRev || 0;
  const posSent = ((tm.po_sent_vendors || []) as any[]).length;
  const its = (job.items || []) as any[];
  const nItems = its.length;
  const blanksOrdered = nItems > 0 && its.every(it => it.blanks_order_cost != null || it.blanks_order_number);
  const atVendor = its.filter(it => !it.pipeline_stage || it.pipeline_stage === "in_production").length;
  const received = its.filter(it => it.received_at_hpd).length;
  const forwarded = its.filter(it => it.forwarded_at).length;
  const peekFor = (k: string): string => {
    switch (k) {
      case "quote_sent": return stage.preQuote ? stage.now : [tm.quote_sent_at && `Sent ${fmtDT(tm.quote_sent_at)}`, cs.grossRev && `quote ${money(cs.grossRev)}`].filter(Boolean).join(" · ") || "Quote + proofs";
      case "quote_appr": return job.quote_approved ? (job.quote_approved_at ? `Approved ${fmtDT(job.quote_approved_at)}` : "Approved by client") : "Awaiting client approval";
      case "invoice": return tm.qb_invoice_number ? `Invoice #${tm.qb_invoice_number}${invTotal ? ` · ${money(invTotal)}` : ""}${tm.qb_invoice_created_at ? ` · sent ${fmtDT(tm.qb_invoice_created_at)}` : ""}` : "Not invoiced yet";
      case "paid": return paidAmt > 0 ? `${money(paidAmt)} / ${money(invTotal)} paid${paidDate ? ` · ${fmtDT(paidDate)}` : ""}` : (invTotal ? `Unpaid · ${money(invTotal)} due` : "Unpaid");
      case "order": return `${posSent} PO${posSent === 1 ? "" : "s"} sent · blanks ${blanksOrdered ? "ordered" : "not ordered"}`;
      case "production": return nItems ? `${atVendor}/${nItems} still at vendor` : "In production";
      case "receiving": return nItems ? `${received}/${nItems} received at HPD` : "Receiving";
      case "shipping": return nItems ? `${forwarded}/${nItems} forwarded to client` : "Shipping to client";
      case "fulfillment": return nItems ? `${received}/${nItems} received · staging` : "Staging";
      default: return "";
    }
  };
  const segFill = (i: number) => {
    if (!stage.preQuote && cur >= 0 && i < cur) return T.green;
    if (!stage.preQuote && i === cur) return sig === "wait" ? T.surface : sig === "late" ? T.red : T.amber;
    return T.surface;
  };
  return (
    <div onClick={onOpen} style={{ display: "flex", alignItems: "center", background: T.card, border: `1px solid ${T.border}`, borderLeft: edgeColor ? `4px solid ${edgeColor}` : `1px solid ${T.border}`, borderRadius: 12, padding: edgeColor ? "12px 16px 12px 13px" : "12px 16px", marginTop: 8, cursor: "pointer", position: "relative", zIndex: hover ? 40 : undefined }}>
      <div style={{ width: 230, flexShrink: 0, minWidth: 0, paddingRight: 12 }}>
        <div style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: T.muted }}>{invNo}</div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{(job.clients as any)?.name || "—"}</div>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, fontFamily: mono, marginTop: 3 }}>{routeLabel[stage.route] || stage.route}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, position: "relative", height: 14 }}>
          {/* clipped fill + ticks — variable length, only this route's milestones */}
          <div style={{ position: "absolute", inset: 0, borderRadius: 7, background: T.surface, overflow: "hidden" }}>
            {bars.map((m, i) => {
              const base = { position: "absolute" as const, left: `${(i / N) * 100}%`, top: 0, bottom: 0, width: `${100 / N}%` };
              if (!stage.preQuote && cur >= 0 && i < cur) return <div key={m.k} style={{ ...base, background: T.green }} />;
              if (!stage.preQuote && i === cur) {
                // wait = hollow (live but passive); act = amber; late = red
                if (sig === "wait") return <div key={m.k} style={{ ...base, background: T.surface, boxShadow: `inset 0 0 0 1.5px ${T.faint}` }} />;
                return <div key={m.k} style={{ ...base, background: sig === "late" ? T.red : T.amber }} />;
              }
              return null;
            })}
            {bars.map((m, i) => {
              if (i === 0) return null;
              const prevFilled = !stage.preQuote && ((i - 1) < cur || ((i - 1) === cur && sig !== "wait"));
              return <div key={"t" + m.k} style={{ position: "absolute", left: `${(i / N) * 100}%`, top: 2, bottom: 2, width: 1, zIndex: 2, background: prevFilled ? "rgba(255,255,255,.85)" : T.faint }} />;
            })}
          </div>
          {/* interaction zones — hover peek (layer 1) + click deep-link (layer 2) */}
          {bars.map((m, i) => {
            // Only done / current segments are hoverable — upcoming stages don't peek.
            const hoverable = stage.preQuote ? m.k === "quote_sent" : i <= cur;
            const st = statusOf(m, i);
            const tgt = STAGE_TARGET[m.k];
            const on = hoverable && hover === m.k;
            return (
              <div key={"z" + m.k}
                onMouseEnter={hoverable ? () => setHover(m.k) : undefined} onMouseLeave={hoverable ? () => setHover(h => (h === m.k ? null : h)) : undefined}
                onClick={hoverable ? (e => { e.stopPropagation(); if (tgt) router.push(tgt.href(job)); }) : undefined}
                style={{ position: "absolute", left: `${(i / N) * 100}%`, width: `${100 / N}%`, top: -7, bottom: -7, zIndex: 4, cursor: hoverable ? "pointer" : "default" }}>
                {on && <div className="proj-chip" style={{ position: "absolute", left: 1, right: 1, top: 5, bottom: 5, borderRadius: 4, background: segFill(i), boxShadow: "0 3px 10px rgba(0,0,0,.22)", pointerEvents: "none" }} />}
                {on && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", zIndex: 30, width: 186, background: T.card, border: `1px solid ${T.border}`, borderRadius: 9, boxShadow: "0 10px 30px rgba(0,0,0,.16)", padding: "10px 12px", pointerEvents: "none", textAlign: "left" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: st.color }}>{m.label}</div>
                    <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4, lineHeight: 1.35 }}>{peekFor(m.k)}</div>
                  </div>
                )}
              </div>
            );
          })}
        {/* dynamic status caption — absolute so the BAR stays vertically centered in the strip */}
        {(stage.preQuote || cur >= 0) && (() => {
          const capText = stage.preQuote ? stage.now : (stage.reason || bars[cur].label);
          const capColor = stage.preQuote ? T.muted : (sig === "late" ? T.red : sig === "act" ? T.amber : T.muted);
          const pos = stage.preQuote ? { left: 0 as const } : (cur === N - 1 ? { right: 0 as const } : { left: `${((cur + 0.5) / N) * 100}%`, transform: "translateX(-50%)" });
          return (
            <div style={{ position: "absolute", top: "calc(100% + 3px)", whiteSpace: "nowrap", fontSize: 9.5, fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", color: capColor, ...pos }}>{stage.preQuote ? "" : "▲ "}{capText}</div>
          );
        })()}
      </div>
    </div>
  );
}
