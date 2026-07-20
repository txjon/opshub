"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, SliceSortRow } from "@/components/board-kit";
import { loadJobPhasesBatch } from "@/lib/item-state";
import { deriveProjectStage, PROJ_MILESTONES, type ProjStage } from "@/lib/project-stage";
import { JobStatusBar } from "@/components/JobStatusBar";
import { etaCountdown, resolveEta } from "@/lib/eta";
import { fmtDay } from "@/lib/dates";

// An item has finished its lifecycle when its ROUTE says so (item route
// overrides job route — mig 076): drop_ship = shipped from vendor,
// ship_through = forwarded to client, stage = entered in the webstore.
function itemLifecycleDone(it: any, jobRoute: string): boolean {
  const route = it.shipping_route || jobRoute || "ship_through";
  if (route === "drop_ship") return it.pipeline_stage === "shipped";
  if (route === "stage") return !!it.webstore_entered_at;
  return !!it.forwarded_at;
}

// The board countdown target: the EARLIEST expected date among items still in
// flight (per-item client_eta, else the job ship date — resolveEta precedence).
function firstItemDue(job: any): string | null {
  const dates = ((job.items || []) as any[])
    .filter(it => !itemLifecycleDone(it, job.shipping_route))
    .map(it => resolveEta({ client_eta: it.client_eta, job_target_ship_date: job.target_ship_date })?.date)
    .filter(Boolean) as string[];
  return dates.length ? dates.sort()[0] : null;
}

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
  const [proofStatus, setProofStatus] = useState<Record<string, { allApproved: boolean; state?: "approved" | "revision" | "pending" | "none" }> | undefined>(undefined);
  const [thumbs, setThumbs] = useState<Record<string, string>>({}); // itemId → drive_file_id (mockup, else proof) for the strip's items peek
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("jobs")
        .select("id, job_number, title, phase, shipping_route, payment_terms, quote_approved, quote_approved_at, created_at, target_ship_date, type_meta, costing_summary, clients(name), payment_records(amount, status, paid_date), items(id, name, sort_order, pipeline_stage, artwork_status, shipping_route, client_eta, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at, webstore_entered_at, buy_sheet_lines(qty_ordered))")
        .not("phase", "in", "(cancelled)")
        .order("created_at", { ascending: false });
      const js = (data as any[]) || [];
      setJobs(js);
      loadJobPhasesBatch(supabase, js.filter(j => j.phase !== "complete").map(j => j.id)).then(setPhaseViews).catch(() => {});
      // Proof approvals (Approved milestone gate) + item thumbnails (the strip's
      // items peek) — one batched pass over the live (non-superseded) proof +
      // mockup files of every active job's items, chunked to keep the .in()
      // URL under limits. Proof logic mirrors the job-detail computation.
      (async () => {
        const ids = js.filter(j => j.phase !== "complete").flatMap(j => (j.items || []).map((it: any) => it.id));
        const ps: Record<string, { allApproved: boolean; state: "approved" | "revision" | "pending" | "none" }> = {};
        const th: Record<string, string> = {};
        for (let i = 0; i < ids.length; i += 150) {
          const { data: files } = await supabase.from("item_files")
            .select("item_id, stage, approval, drive_file_id").in("stage", ["proof", "mockup"]).is("superseded_at", null)
            .in("item_id", ids.slice(i, i + 150));
          const byItem: Record<string, any[]> = {};
          for (const f of (files || []) as any[]) (byItem[f.item_id] ||= []).push(f);
          for (const id of ids.slice(i, i + 150)) {
            const proofs = (byItem[id] || []).filter((f: any) => f.stage === "proof");
            const state = proofs.some((f: any) => f.approval === "revision_requested") ? "revision"
              : (proofs.length > 0 && proofs.every((f: any) => f.approval === "approved")) ? "approved"
              : proofs.length > 0 ? "pending" : "none";
            ps[id] = { allApproved: state === "approved", state };
            const visual = (byItem[id] || []).find((f: any) => f.stage === "mockup") || proofs[0];
            if (visual?.drive_file_id) th[id] = visual.drive_file_id;
          }
        }
        setProofStatus(ps);
        setThumbs(th);
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

          {active.map(r => <Strip key={r.job.id} r={r} thumbs={thumbs} proofStatus={proofStatus} onOpen={() => router.push(`/jobs/${r.job.id}`)} />)}
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

// Per-item state for the peek — flat uppercase color text (v2 style).
function itemPeekState(it: any, ps?: { state?: string }): [string, string] {
  if (it.received_at_hpd) return ["Received", T.green];
  if (it.pipeline_stage === "shipped") return ["Shipped", T.blue];
  if (it.pipeline_stage === "in_production") return ["In production", T.blue];
  if (it.artwork_status === "approved" || ps?.state === "approved") return ["Proof approved", T.green];
  if (ps?.state === "revision") return ["Revision requested", T.amber];
  if (ps?.state === "pending") return ["Proof pending", T.amber];
  return ["No proof yet", T.faint];
}

function Strip({ r, thumbs, proofStatus, onOpen }: { r: Row; thumbs: Record<string, string>; proofStatus?: Record<string, { state?: string }>; onOpen: () => void }) {
  const { job, stage } = r;
  const [peek, setPeek] = useState(false); // inline items panel
  const items = ([...(job.items || [])] as any[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const thumbUrl = (id: string, size: number) => `/api/files/thumbnail?id=${thumbs[id]}&size=${size}`;
  // Once a QB invoice # is assigned that's the number used everywhere (POs tie to
  // it, it matches QB) — lead with it, fall back to the job number pre-invoice.
  const invNo = (job.type_meta as any)?.qb_invoice_number || job.job_number;
  const [raised, setRaised] = useState(false); // rise above sibling strips while the peek is open
  const sig = stage.signal;
  const edgeColor = sig === "late" ? T.red : sig === "act" ? T.amber : null; // wait → no edge (recedes)
  // Countdown = first item due to complete its lifecycle (Jon 2026-07-20) —
  // earliest resolveEta over in-flight items. "~" = estimate; unset = TBD (R5).
  const firstDue = firstItemDue(job);
  const cd = etaCountdown(firstDue);
  const cdColor = cd ? ({ red: T.red, amber: T.amber, muted: T.muted, green: T.green } as const)[cd.band] : T.faint;
  // created_at is a full timestamp — format via new Date(), NOT fmtDay/parseDay
  // (slicing a UTC timestamp shows the previous day for Vegas evenings).
  const opened = job.created_at ? new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return (
    <div onClick={onOpen} style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: edgeColor ? `4px solid ${edgeColor}` : `1px solid ${T.border}`, borderRadius: 12, padding: edgeColor ? "10px 16px 10px 13px" : "10px 16px", marginTop: 8, cursor: "pointer", position: "relative", zIndex: raised ? 40 : undefined }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: 236, flexShrink: 0, minWidth: 0, paddingRight: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: T.muted }}>{invNo}</span>
            <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, fontFamily: mono }}>{routeLabel[stage.route] || stage.route}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{(job.clients as any)?.name || "—"}</div>
          {job.title && <div style={{ fontSize: 11, color: T.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{job.title}</div>}
        </div>
        <JobStatusBar job={job} stage={stage} items={job.items} payments={job.payment_records} navigate onHoverChange={setRaised} />
        {/* Items peek toggle — overlapping mockup thumbs; click expands the panel. */}
        {items.length > 0 && (
          <button onClick={e => { e.stopPropagation(); setPeek(p => !p); }} title={peek ? "Hide items" : `Peek ${items.length} item${items.length === 1 ? "" : "s"}`}
            style={{ display: "flex", alignItems: "center", flexShrink: 0, marginLeft: 14, padding: 0, background: "none", border: "none", cursor: "pointer" }}>
            {items.slice(0, 4).map((it: any, i: number) => (
              <div key={it.id} style={{ width: 30, height: 30, borderRadius: 7, border: `2px solid ${peek ? T.text : T.card}`, background: T.surface, overflow: "hidden", marginLeft: i === 0 ? 0 : -9, boxShadow: "0 1px 3px rgba(0,0,0,.12)", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {thumbs[it.id] && <img src={thumbUrl(it.id, 60)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
            ))}
            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 800, color: T.muted, marginLeft: 6 }}>{items.length > 4 ? `+${items.length - 4}` : ""}{peek ? "▴" : "▾"}</span>
          </button>
        )}
        {/* Dates rail — opened date + countdown to expected completion. */}
        <div style={{ width: 108, flexShrink: 0, textAlign: "right", paddingLeft: 14 }}>
          <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 800, color: cdColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            {cd ? cd.text : "TBD"}
          </div>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 3 }}>
            {firstDue ? <>first item due ~<span style={{ fontFamily: mono }}>{fmtDay(firstDue)}</span></> : "no dates set"}
          </div>
          {opened && <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 3 }}>opened <span style={{ fontFamily: mono }}>{opened}</span></div>}
        </div>
      </div>
      {/* Inline items peek — v2-style visual cards: thumb, name, units, state. */}
      {peek && (
        <div onClick={e => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}`, cursor: "default" }}>
          {items.map((it: any) => {
            const units = ((it.buy_sheet_lines || []) as any[]).reduce((a, l) => a + (Number(l.qty_ordered) || 0), 0);
            const [lbl, clr] = itemPeekState(it, proofStatus?.[it.id]);
            return (
              <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: T.surface, overflow: "hidden", flexShrink: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumbs[it.id] && <img src={thumbUrl(it.id, 88)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name || "Item"}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: clr, whiteSpace: "nowrap" }}>{lbl}</span>
                    {units > 0 && <span style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, fontVariantNumeric: "tabular-nums" }}>{units} u</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
