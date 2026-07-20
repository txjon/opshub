"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, SliceSortRow } from "@/components/board-kit";
import { loadJobPhasesBatch } from "@/lib/item-state";
import { deriveProjectStage, PROJ_MILESTONES, type ProjStage } from "@/lib/project-stage";
import { JobStatusBar } from "@/components/JobStatusBar";
import { etaCountdown } from "@/lib/eta";
import { fmtDay } from "@/lib/dates";

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
  // Per-item proof approvals — gates the Approved milestone. undefined until
  // loaded so deriveProjectStage's proof gate stays OFF (never flash every job
  // back to "Approved · 0/N proofs" while the batch query is in flight).
  const [proofStatus, setProofStatus] = useState<Record<string, { allApproved: boolean }> | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("jobs")
        .select("id, job_number, title, phase, shipping_route, payment_terms, quote_approved, quote_approved_at, created_at, target_ship_date, type_meta, costing_summary, clients(name), payment_records(amount, status, paid_date), items(id, pipeline_stage, artwork_status, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at, webstore_entered_at)")
        .not("phase", "in", "(cancelled)")
        .order("created_at", { ascending: false });
      const js = (data as any[]) || [];
      setJobs(js);
      loadJobPhasesBatch(supabase, js.filter(j => j.phase !== "complete").map(j => j.id)).then(setPhaseViews).catch(() => {});
      // Proof approvals for the Approved milestone — one batched pass over the
      // live (non-superseded) proof files of every active job's items, chunked
      // to keep the .in() URL under limits. Mirrors the job-detail computation.
      (async () => {
        const ids = js.filter(j => j.phase !== "complete").flatMap(j => (j.items || []).map((it: any) => it.id));
        const ps: Record<string, { allApproved: boolean }> = {};
        for (let i = 0; i < ids.length; i += 150) {
          const { data: files } = await supabase.from("item_files")
            .select("item_id, approval").eq("stage", "proof").is("superseded_at", null)
            .in("item_id", ids.slice(i, i + 150));
          const byItem: Record<string, any[]> = {};
          for (const f of (files || []) as any[]) (byItem[f.item_id] ||= []).push(f);
          for (const id of ids.slice(i, i + 150)) {
            const proofs = byItem[id] || [];
            ps[id] = { allApproved: proofs.length > 0 && proofs.every((f: any) => f.approval === "approved") };
          }
        }
        setProofStatus(ps);
      })().catch(() => {});
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  const rows: Row[] = useMemo(() => jobs.map(job => ({
    job, stage: deriveProjectStage(job, phaseViews.get(job.id), job.items || [], job.payment_records || [], proofStatus),
  })), [jobs, phaseViews, proofStatus]);

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
  // Expected OpsHub completion = jobs.target_ship_date (in-hands, human-entered
  // → "~" estimate per the date standard; R5: unset shows TBD, never a guess).
  const cd = etaCountdown(job.target_ship_date);
  const cdColor = cd ? ({ red: T.red, amber: T.amber, muted: T.muted, green: T.green } as const)[cd.band] : T.faint;
  // created_at is a full timestamp — format via new Date(), NOT fmtDay/parseDay
  // (slicing a UTC timestamp shows the previous day for Vegas evenings).
  const opened = job.created_at ? new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return (
    <div onClick={onOpen} style={{ display: "flex", alignItems: "center", background: T.card, border: `1px solid ${T.border}`, borderLeft: edgeColor ? `4px solid ${edgeColor}` : `1px solid ${T.border}`, borderRadius: 12, padding: edgeColor ? "10px 16px 10px 13px" : "10px 16px", marginTop: 8, cursor: "pointer", position: "relative", zIndex: raised ? 40 : undefined }}>
      <div style={{ width: 236, flexShrink: 0, minWidth: 0, paddingRight: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: T.muted }}>{invNo}</span>
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, fontFamily: mono }}>{routeLabel[stage.route] || stage.route}</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{(job.clients as any)?.name || "—"}</div>
        {job.title && <div style={{ fontSize: 11, color: T.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{job.title}</div>}
      </div>
      <JobStatusBar job={job} stage={stage} items={job.items} payments={job.payment_records} navigate onHoverChange={setRaised} />
      {/* Dates rail — opened date + countdown to expected completion. */}
      <div style={{ width: 108, flexShrink: 0, textAlign: "right", paddingLeft: 14 }}>
        <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 800, color: cdColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {cd ? cd.text : "TBD"}
        </div>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 3 }}>
          {job.target_ship_date ? <>in hands ~<span style={{ fontFamily: mono }}>{fmtDay(job.target_ship_date)}</span></> : "no in-hands set"}
        </div>
        {opened && <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 3 }}>opened <span style={{ fontFamily: mono }}>{opened}</span></div>}
      </div>
    </div>
  );
}
