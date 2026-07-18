"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, SliceSortRow, SegmentControl } from "@/components/board-kit";
import { loadJobPhasesBatch } from "@/lib/item-state";
import { deriveProjectStage, PROJ_MILESTONES, ROUTE_DEAD, type ProjStage } from "@/lib/project-stage";

// Projects Board V2 — the "find the job that needs action" board, on the shared
// V2 board-kit (matches /receiving chrome). Each job = a strip with a ticked
// progress bar; completed jobs bucket by client. See [[opshub-project-board-v2]].

type Row = { job: any; stage: ProjStage };
type Sort = "attention" | "ship" | "stage" | "client";
const routeLabel: Record<string, string> = { drop_ship: "drop-ship", ship_through: "ship-through", stage: "stage" };
const idx = (k: string | null) => PROJ_MILESTONES.findIndex(m => m.k === k);
const selStyle = { padding: "9px 14px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontWeight: 700, fontFamily: font, outline: "none", cursor: "pointer" } as const;

export default function ProjectsBoard() {
  const supabase = createClient();
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [phaseViews, setPhaseViews] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("attention");
  const [clientFilter, setClientFilter] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("jobs")
        .select("id, job_number, title, phase, shipping_route, quote_approved, type_meta, costing_summary, clients(name), payment_records(amount, status), items(id, pipeline_stage, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at)")
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
  const clients = useMemo(() => [...new Set(rows.map(clientName))].sort(), [rows]);

  const q = query.toLowerCase().trim();
  const matchQ = (r: Row) => !q || `${r.job.job_number} ${clientName(r)} ${r.job.title || ""}`.toLowerCase().includes(q);
  const base = rows.filter(r => (!clientFilter || clientName(r) === clientFilter) && matchQ(r));
  const active = base.filter(r => !r.stage.complete);
  const done = base.filter(r => r.stage.complete);
  const activeAll = rows.filter(r => !r.stage.complete);

  const score = (r: Row) => r.stage.action ? (r.stage.action.lvl === "red" ? 3 : 2) : r.stage.preQuote ? 0.5 : 1;
  const shipVal = (r: Row) => { const d = r.job.type_meta?.in_hands_date || r.job.type_meta?.show_date; return d ? new Date(d).getTime() : 9e15; };
  const sortedActive = useMemo(() => [...active].sort((a, b) => {
    if (sort === "attention") return score(b) - score(a) || shipVal(a) - shipVal(b);
    if (sort === "ship") return shipVal(a) - shipVal(b);
    if (sort === "stage") return idx(a.stage.milestone) - idx(b.stage.milestone);
    return clientName(a).localeCompare(clientName(b));
  }), [active, sort]);

  const doneByClient = useMemo(() => {
    const m: Record<string, Row[]> = {};
    for (const r of done) (m[clientName(r)] ??= []).push(r);
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [done]);

  const kpi = (k: string) => k === "active" ? activeAll.length : k === "action" ? activeAll.filter(r => r.stage.action).length : activeAll.filter(r => r.stage.preQuote).length;

  return (
    <BoardFrame title="Projects">
      <ToggleSearch
        options={[["active", `Active · ${activeAll.length}`], ["completed", `Completed · ${rows.filter(r => r.stage.complete).length}`]]}
        value={tab} onChange={setTab} query={query} setQuery={setQuery} placeholder="Search client, job #, or title…" />

      {tab === "active" ? (
        loading ? <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center" }}>Loading…</div> : (<>
          <KpiStrip metrics={[{ key: "active", label: "Active" }, { key: "action", label: "Need action" }, { key: "prequote", label: "Pre-quote" }]} get={kpi} onClick={() => { }} />
          <SliceSortRow>
            <SegmentControl label="Sort" options={[["attention", "Needs action"], ["ship", "Ship date"], ["stage", "Stage"], ["client", "Client"]]} value={sort} onChange={setSort} />
            <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} style={selStyle}>
              <option value="">All clients</option>
              {clients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </SliceSortRow>

          {/* frozen aligned milestone header */}
          <div style={{ position: "sticky", top: 0, zIndex: 5, background: T.bg, display: "flex", alignItems: "flex-end", padding: "8px 16px", borderBottom: `1px solid ${T.border}`, boxShadow: "0 6px 10px -8px rgba(0,0,0,.14)" }}>
            <div style={{ width: 230, flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", gap: 0 }}>
              {PROJ_MILESTONES.map(m => <div key={m.k} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 8.5, fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: m.tail ? T.blue : T.faint, lineHeight: 1.15, padding: "0 2px", wordBreak: "break-word" }}>{m.label}</div>)}
            </div>
            <div style={{ width: 158, flexShrink: 0, textAlign: "right", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.faint }}>Now</div>
          </div>

          {sortedActive.map(r => <Strip key={r.job.id} r={r} onOpen={() => router.push(`/jobs/${r.job.id}`)} />)}
          {sortedActive.length === 0 && <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginTop: 8 }}>No active projects match.</div>}
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
  const dead = ROUTE_DEAD[stage.route] || [];
  const cur = idx(stage.milestone);
  const act = stage.action;
  const N = PROJ_MILESTONES.length;
  return (
    <div onClick={onOpen} className="kpi-tile" style={{ display: "flex", alignItems: "center", background: T.card, border: `1px solid ${T.border}`, borderLeft: act ? `4px solid ${act.lvl === "red" ? T.red : T.amber}` : `1px solid ${T.border}`, borderRadius: 12, padding: act ? "12px 16px 12px 13px" : "12px 16px", marginTop: 8, cursor: "pointer" }}>
      <div style={{ width: 230, flexShrink: 0, minWidth: 0, paddingRight: 12 }}>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>{job.job_number}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(job.clients as any)?.name || "—"}</div>
        <div style={{ fontSize: 11.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.title}</div>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, fontFamily: mono, marginTop: 2 }}>{routeLabel[stage.route] || stage.route}</div>
      </div>
      <div style={{ flex: 1, position: "relative", height: 14, borderRadius: 7, background: T.surface, overflow: "hidden" }}>
        {PROJ_MILESTONES.map((m, i) => {
          const base = { position: "absolute" as const, left: `${(i / N) * 100}%`, top: 0, bottom: 0, width: `${100 / N}%` };
          if (dead.includes(m.k)) return <div key={m.k} style={{ ...base, background: `repeating-linear-gradient(45deg,transparent,transparent 3px,${T.border} 3px,${T.border} 4px)` }} title={`${m.label} — n/a (${routeLabel[stage.route]})`} />;
          if (!stage.preQuote && cur >= 0 && i < cur) return <div key={m.k} style={{ ...base, background: T.green }} title={m.label} />;
          if (!stage.preQuote && i === cur) return <div key={m.k} style={{ ...base, background: act ? (act.lvl === "red" ? T.red : T.amber) : T.accent }} title={`Now: ${m.label}`} />;
          return null;
        })}
        {PROJ_MILESTONES.map((m, i) => i > 0 ? <div key={"t" + m.k} style={{ position: "absolute", left: `${(i / N) * 100}%`, top: 2, bottom: 2, width: 1, zIndex: 2, background: !stage.preQuote && (i - 1) <= cur && !dead.includes(PROJ_MILESTONES[i - 1].k) ? "rgba(255,255,255,.85)" : T.faint }} /> : null)}
      </div>
      <div style={{ width: 158, flexShrink: 0, textAlign: "right", paddingLeft: 14 }}>
        {stage.preQuote
          ? <div style={{ fontSize: 12.5, fontWeight: 700, color: T.faint }}>Pre-quote</div>
          : <div style={{ fontSize: 12.5, fontWeight: 700, color: act ? (act.lvl === "red" ? T.red : T.amber) : T.text }}>{stage.now}</div>}
      </div>
    </div>
  );
}
