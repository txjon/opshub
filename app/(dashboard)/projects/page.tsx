"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { BoardFrame, ToggleSearch, KpiStrip, SliceSortRow, ModalShell } from "@/components/board-kit";
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
  const [sortBy, setSortBy] = useState<"due" | "invoice" | "newest">("due"); // default: first item due

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("jobs")
        .select("id, job_number, title, phase, shipping_route, payment_terms, quote_approved, quote_approved_at, created_at, updated_at, phase_timestamps, target_ship_date, type_meta, costing_summary, clients(name), payment_records(amount, status, paid_date), items(id, name, sort_order, pipeline_stage, artwork_status, shipping_route, client_eta, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at, webstore_entered_at, buy_sheet_lines(qty_ordered))")
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
        // ALL jobs (completed included) — the completed strips keep the thumb
        // cluster + items peek, so they need thumbnails too.
        const ids = js.flatMap(j => (j.items || []).map((it: any) => it.id));
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

  // Stage dropdown TRULY filters: only jobs at the picked stage show.
  const stageCounts = useMemo(() => Object.fromEntries(PROJ_MILESTONES.map(m => [m.k, activeCQ.filter(r => atStage(r, m.k)).length])) as Record<string, number>, [activeCQ]);
  const filtered = stageFilter ? activeCQ.filter(r => atStage(r, stageFilter)) : activeCQ;
  // Sort (Jon 2026-07-20): default = first item due (soonest first, TBD last);
  // invoice = highest invoice # first (uninvoiced last); newest = created desc.
  const active = useMemo(() => {
    const byCreated = (a: Row, b: Row) => (b.job.created_at || "").localeCompare(a.job.created_at || "");
    const list = [...filtered];
    if (sortBy === "due") {
      list.sort((a, b) => {
        const da = firstItemDue(a.job), db = firstItemDue(b.job);
        if (da && db) return da.localeCompare(db) || byCreated(a, b);
        if (da) return -1;
        if (db) return 1;
        return byCreated(a, b);
      });
    } else if (sortBy === "invoice") {
      const inv = (r: Row) => parseInt((r.job.type_meta as any)?.qb_invoice_number, 10);
      list.sort((a, b) => {
        const ia = inv(a), ib = inv(b);
        if (!isNaN(ia) && !isNaN(ib)) return ib - ia;
        if (!isNaN(ia)) return -1;
        if (!isNaN(ib)) return 1;
        return (b.job.job_number || "").localeCompare(a.job.job_number || "");
      });
    } else list.sort(byCreated);
    return list;
  }, [filtered, sortBy]);

  // Completed strips sort by close date, most recently finished first.
  const doneSorted = useMemo(() =>
    [...done].sort((a, b) => (closedAt(b.job) || "").localeCompare(closedAt(a.job) || "")),
  [done]);

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
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={selStyle}>
              <option value="due">First item due</option>
              <option value="invoice">Invoice #</option>
              <option value="newest">Newest</option>
            </select>
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
          {doneSorted.map(r => <Strip key={r.job.id} r={r} thumbs={thumbs} proofStatus={proofStatus} completed onOpen={() => router.push(`/jobs/${r.job.id}`)} />)}
          {!doneSorted.length && <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 }}>No completed projects match.</div>}
        </div>
      )}
    </BoardFrame>
  );
}

// When a completed job actually closed: the lifecycle stamp, else last touch.
function closedAt(job: any): string | null {
  return (job.phase_timestamps as any)?.complete || job.updated_at || null;
}
const fmtStamp = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

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

function Strip({ r, thumbs, proofStatus, completed = false, onOpen }: { r: Row; thumbs: Record<string, string>; proofStatus?: Record<string, { state?: string }>; completed?: boolean; onOpen: () => void }) {
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
        {completed ? (
          /* Completed: the run timeline — opened ●──── N DAYS ────● closed. */
          (() => {
            const close = closedAt(job);
            const days = job.created_at && close ? Math.max(0, Math.floor((new Date(close).getTime() - new Date(job.created_at).getTime()) / 86400000)) : null;
            const endLbl = (date: string | null, label: string, align: "left" | "right") => (
              <div style={{ textAlign: align, flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: T.text }}>{fmtStamp(date)}</div>
                <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 2 }}>{label}</div>
              </div>
            );
            return (
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 6px" }}>
                {endLbl(job.created_at, "Opened", "right")}
                <div style={{ flex: 1, position: "relative", height: 14, display: "flex", alignItems: "center" }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: T.border }} />
                  <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 7, height: 7, borderRadius: 999, background: T.green }} />
                  <div style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", width: 7, height: 7, borderRadius: 999, background: T.green }} />
                  {days !== null && (
                    <div style={{ position: "absolute", left: "50%", transform: "translate(-50%, -50%)", top: "50%", background: T.card, padding: "0 10px", fontFamily: mono, fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", color: T.muted, whiteSpace: "nowrap" }}>
                      {days} {days === 1 ? "DAY" : "DAYS"}
                    </div>
                  )}
                </div>
                {endLbl(close, "Completed", "left")}
              </div>
            );
          })()
        ) : (
          <JobStatusBar job={job} stage={stage} items={job.items} payments={job.payment_records} navigate onHoverChange={setRaised} />
        )}
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
        {/* Dates rail — opened date + countdown to expected completion (active only;
            completed strips carry the timeline instead). */}
        {!completed && (
          <div style={{ width: 108, flexShrink: 0, textAlign: "right", paddingLeft: 14 }}>
            <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 800, color: cdColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {cd ? cd.text : "TBD"}
            </div>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 3 }}>
              {firstDue ? <>first item due ~<span style={{ fontFamily: mono }}>{fmtDay(firstDue)}</span></> : "no dates set"}
            </div>
            {opened && <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 3 }}>opened <span style={{ fontFamily: mono }}>{opened}</span></div>}
          </div>
        )}
      </div>
      {/* Items peek — V2 modal (eyebrow → title → summary strip → cards → footer). */}
      {peek && (
        <div onClick={e => e.stopPropagation()} style={{ cursor: "default" }}>
          <ModalShell onClose={() => setPeek(false)} maxWidth={560}>
            <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, fontFamily: mono }}>{invNo} · {routeLabel[stage.route] || stage.route}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 3 }}>{(job.clients as any)?.name || "—"}{job.title ? <span style={{ color: T.muted, fontWeight: 400 }}> · {job.title}</span> : null}</div>
            </div>
            <div style={{ display: "flex", gap: 26, padding: "12px 22px", background: T.surface }}>
              {[
                ["Items", String(items.length)],
                ["Units", String(items.reduce((a: number, it: any) => a + ((it.buy_sheet_lines || []) as any[]).reduce((x: number, l: any) => x + (Number(l.qty_ordered) || 0), 0), 0).toLocaleString())],
                completed ? ["Completed", fmtStamp(closedAt(job))] : ["First due", firstDue ? `~${fmtDay(firstDue)}` : "TBD"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint }}>{k}</div>
                  <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: "14px 22px", display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
              {items.map((it: any) => {
                const units = ((it.buy_sheet_lines || []) as any[]).reduce((a, l) => a + (Number(l.qty_ordered) || 0), 0);
                const [lbl, clr] = itemPeekState(it, proofStatus?.[it.id]);
                return (
                  <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 9, background: T.surface, overflow: "hidden", flexShrink: 0, border: `1px solid ${T.border}` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumbs[it.id] && <img src={thumbUrl(it.id, 104)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name || "Item"}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: clr, marginTop: 3 }}>{lbl}</div>
                    </div>
                    {units > 0 && <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{units} u</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 22px", borderTop: `1px solid ${T.border}` }}>
              <button onClick={() => setPeek(false)} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 16px", border: `1px solid ${T.border}`, background: T.card, color: T.text, cursor: "pointer", fontFamily: font }}>Close</button>
              <button onClick={onOpen} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 18px", border: "none", background: T.text, color: "#fff", cursor: "pointer", fontFamily: font }}>Open project →</button>
            </div>
          </ModalShell>
        </div>
      )}
    </div>
  );
}
