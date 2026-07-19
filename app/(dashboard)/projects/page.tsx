"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, SliceSortRow } from "@/components/board-kit";
import { loadJobPhasesBatch } from "@/lib/item-state";
import { deriveProjectStage, PROJ_MILESTONES, type ProjStage } from "@/lib/project-stage";
import { JobStatusBar } from "@/components/JobStatusBar";

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
        .select("id, job_number, title, phase, shipping_route, payment_terms, quote_approved, quote_approved_at, type_meta, costing_summary, clients(name), payment_records(amount, status, paid_date), items(id, pipeline_stage, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at, webstore_entered_at)")
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

function Strip({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const { job, stage } = r;
  // Once a QB invoice # is assigned that's the number used everywhere (POs tie to
  // it, it matches QB) — lead with it, fall back to the job number pre-invoice.
  const invNo = (job.type_meta as any)?.qb_invoice_number || job.job_number;
  const [raised, setRaised] = useState(false); // rise above sibling strips while the peek is open
  const sig = stage.signal;
  const edgeColor = sig === "late" ? T.red : sig === "act" ? T.amber : null; // wait → no edge (recedes)
  return (
    <div onClick={onOpen} style={{ display: "flex", alignItems: "center", background: T.card, border: `1px solid ${T.border}`, borderLeft: edgeColor ? `4px solid ${edgeColor}` : `1px solid ${T.border}`, borderRadius: 12, padding: edgeColor ? "12px 16px 12px 13px" : "12px 16px", marginTop: 8, cursor: "pointer", position: "relative", zIndex: raised ? 40 : undefined }}>
      <div style={{ width: 230, flexShrink: 0, minWidth: 0, paddingRight: 12 }}>
        <div style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: T.muted }}>{invNo}</div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{(job.clients as any)?.name || "—"}</div>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, fontFamily: mono, marginTop: 3 }}>{routeLabel[stage.route] || stage.route}</div>
      </div>
      <JobStatusBar job={job} stage={stage} items={job.items} payments={job.payment_records} navigate onHoverChange={setRaised} />
    </div>
  );
}
