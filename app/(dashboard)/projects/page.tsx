"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { loadJobPhasesBatch } from "@/lib/item-state";
import { deriveProjectStage, PROJ_MILESTONES, ROUTE_DEAD, type ProjStage } from "@/lib/project-stage";

// Projects Board V2 — the "find the job that needs action" board. Each job is a
// strip with a linear milestone bar (frozen aligned headers); completed jobs drop
// off and bucket by client. See [[opshub-project-board-v2]].

type Row = { job: any; stage: ProjStage };
const routeLabel: Record<string, string> = { drop_ship: "drop-ship", ship_through: "ship-through", stage: "stage" };
const idx = (k: string | null) => PROJ_MILESTONES.findIndex(m => m.k === k);

export default function ProjectsBoard() {
  const supabase = createClient();
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [phaseViews, setPhaseViews] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"attention" | "ship" | "stage" | "client">("attention");
  const [clientFilter, setClientFilter] = useState("");
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("jobs")
        .select("id, job_number, title, phase, shipping_route, quote_approved, type_meta, costing_summary, clients(name), payment_records(amount, status), items(id, pipeline_stage, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at)")
        .not("phase", "in", "(cancelled)")
        .order("created_at", { ascending: false });
      const js = (data as any[]) || [];
      setJobs(js);
      const activeIds = js.filter(j => j.phase !== "complete").map(j => j.id);
      loadJobPhasesBatch(supabase, activeIds).then(setPhaseViews).catch(() => {});
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  const rows: Row[] = useMemo(() => jobs.map(job => ({
    job, stage: deriveProjectStage(job, phaseViews.get(job.id), job.items || [], job.payment_records || []),
  })), [jobs, phaseViews]);

  const clientName = (r: Row) => (r.job.clients as any)?.name || "—";
  const clients = useMemo(() => [...new Set(rows.map(clientName))].sort(), [rows]);

  const filtered = clientFilter ? rows.filter(r => clientName(r) === clientFilter) : rows;
  const active = filtered.filter(r => !r.stage.complete);
  const done = filtered.filter(r => r.stage.complete);

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

  const counts = {
    action: active.filter(r => r.stage.action).length,
    active: active.length,
  };

  return (
    <div style={{ padding: "22px 22px 80px", fontFamily: font, maxWidth: 1320, margin: "0 auto", color: T.text }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={lbl}>OpsHub</div>
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>Projects</h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{counts.active} active · <span style={{ color: counts.action ? T.red : T.muted, fontWeight: counts.action ? 700 : 400 }}>{counts.action} need action</span></div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} style={selStyle}>
            <option value="">All clients</option>
            {clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* sticky sort + milestone header */}
      <div style={{ position: "sticky", top: 0, zIndex: 6, background: T.bg, display: "flex", gap: 8, flexWrap: "wrap", padding: "14px 0 8px" }}>
        <span style={{ ...lbl, marginRight: 2, alignSelf: "center" }}>Sort</span>
        {(["attention", "ship", "stage", "client"] as const).map(s => (
          <button key={s} onClick={() => setSort(s)} style={sortBtn(sort === s)}>{s === "attention" ? "Needs action" : s === "ship" ? "Ship date" : s === "stage" ? "Stage" : "Client"}</button>
        ))}
      </div>
      <div style={{ position: "sticky", top: 46, zIndex: 5, background: T.bg, display: "flex", alignItems: "flex-end", padding: "8px 14px", borderBottom: `1px solid ${T.border}`, boxShadow: "0 6px 10px -8px rgba(0,0,0,.14)" }}>
        <div style={{ width: 230, flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", gap: 0 }}>
          {PROJ_MILESTONES.map(m => <div key={m.k} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 8.5, fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: m.tail ? T.blue : T.faint, lineHeight: 1.15, padding: "0 2px", wordBreak: "break-word" }}>{m.label}</div>)}
        </div>
        <div style={{ width: 158, flexShrink: 0, textAlign: "right", ...lbl }}>Now</div>
      </div>

      {loading ? <div style={{ color: T.muted, fontSize: 12, padding: 16 }}>Loading…</div> : (
        <>
          {sortedActive.map(r => <Strip key={r.job.id} r={r} onOpen={() => router.push(`/jobs/${r.job.id}`)} />)}
          {sortedActive.length === 0 && <div style={{ color: T.muted, fontSize: 12, padding: 16 }}>No active projects{clientFilter ? " for this client" : ""}.</div>}

          {done.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <button onClick={() => setShowDone(s => !s)} style={{ background: "none", border: "none", color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", cursor: "pointer", fontFamily: font, padding: 0 }}>{showDone ? "▾" : "▸"} Completed — {done.length} · {doneByClient.length} clients</button>
              {showDone && (
                <div style={{ marginTop: 10 }}>
                  {doneByClient.map(([c, list]) => (
                    <div key={c} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", marginTop: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{c} <span style={{ color: T.faint, fontWeight: 400, fontSize: 11 }}>· {list.length}</span></div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {list.map(r => <button key={r.job.id} onClick={() => router.push(`/jobs/${r.job.id}`)} style={{ background: T.surface, border: "none", borderRadius: 6, padding: "4px 9px", fontSize: 11, fontFamily: mono, color: T.muted, cursor: "pointer" }}>{r.job.job_number} · {r.job.title}</button>)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Strip({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const { job, stage } = r;
  const dead = ROUTE_DEAD[stage.route] || [];
  const cur = idx(stage.milestone);
  const act = stage.action;
  return (
    <div onClick={onOpen} style={{ display: "flex", alignItems: "center", background: T.card, border: `1px solid ${T.border}`, borderLeft: act ? `4px solid ${act.lvl === "red" ? T.red : T.amber}` : `1px solid ${T.border}`, borderRadius: 11, padding: act ? "12px 14px 12px 11px" : "12px 14px", marginTop: 8, cursor: "pointer" }}>
      <div style={{ width: 230, flexShrink: 0, minWidth: 0, paddingRight: 12 }}>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>{job.job_number}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(job.clients as any)?.name || "—"}</div>
        <div style={{ fontSize: 11.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.title}</div>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, fontFamily: mono, marginTop: 2 }}>{routeLabel[stage.route] || stage.route}</div>
      </div>
      <div style={{ flex: 1, position: "relative", height: 14, borderRadius: 7, background: T.surface, overflow: "hidden" }}>
        {PROJ_MILESTONES.map((m, i) => {
          const left = `${(i / PROJ_MILESTONES.length) * 100}%`, w = `${100 / PROJ_MILESTONES.length}%`;
          const base = { position: "absolute" as const, left, top: 0, bottom: 0, width: w };
          if (dead.includes(m.k)) return <div key={m.k} style={{ ...base, background: `repeating-linear-gradient(45deg,transparent,transparent 3px,${T.border} 3px,${T.border} 4px)` }} title={`${m.label} — n/a (${routeLabel[stage.route]})`} />;
          if (!stage.preQuote && cur >= 0 && i < cur) return <div key={m.k} style={{ ...base, background: T.green }} title={m.label} />;
          if (!stage.preQuote && i === cur) return <div key={m.k} style={{ ...base, background: act ? (act.lvl === "red" ? T.red : T.amber) : T.accent }} title={`Now: ${m.label}`} />;
          return null;
        })}
        {PROJ_MILESTONES.map((m, i) => i > 0 ? <div key={"t" + m.k} style={{ position: "absolute", left: `${(i / PROJ_MILESTONES.length) * 100}%`, top: 2, bottom: 2, width: 1, zIndex: 2, background: !stage.preQuote && (i - 1) <= cur && !dead.includes(PROJ_MILESTONES[i - 1].k) ? "rgba(255,255,255,.85)" : T.faint }} /> : null)}
      </div>
      <div style={{ width: 158, flexShrink: 0, textAlign: "right", paddingLeft: 14 }}>
        {stage.preQuote
          ? <><div style={{ fontSize: 12.5, fontWeight: 700, color: T.faint }}>Pre-quote</div><div style={{ fontSize: 10.5, color: T.muted, marginTop: 2 }}>{stage.now}</div></>
          : <><div style={{ fontSize: 12.5, fontWeight: 700 }}>{stage.now}</div><div style={{ fontSize: 10.5, marginTop: 2, color: act ? (act.lvl === "red" ? T.red : T.amber) : T.muted }}>{act ? act.reason : stage.detail || ""}</div></>}
      </div>
    </div>
  );
}

const lbl = { fontSize: 9.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: T.faint } as const;
const sortBtn = (on: boolean) => ({ border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.card, color: on ? "#fff" : T.muted, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font } as const);
const selStyle = { border: `1px solid ${T.border}`, background: T.card, color: T.text, borderRadius: 8, padding: "7px 11px", fontSize: 12.5, fontFamily: font, outline: "none" } as const;
