"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { BoardFrame, SliceSortRow, ModalShell } from "@/components/board-kit";
import { loadJobPhasesBatch } from "@/lib/item-state";
import { deriveProjectStage, PROJ_MILESTONES, type ProjStage } from "@/lib/project-stage";
import { JobStatusBar } from "@/components/JobStatusBar";
import { etaCountdown } from "@/lib/eta";
import { useIsMobile } from "@/lib/useIsMobile";
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
// flight. Internal proxy = the per-item production/receiving date (ship_est ▸
// legacy expected_arrival); the chain-resolved CLIENT ETA lives on the customer
// surfaces. client_eta is retired. Final fallback: the earliest agreed/live
// vendor ship-by from the PO tab's vendor chips (type_meta.po_ship_live /
// po_ship_dates) — most jobs carry their dates THERE, not on target_ship_date.
function vendorShipFallback(job: any, liveVendors: Set<string> | null): string | null {
  const tm = job.type_meta || {};
  const dates: string[] = [];
  for (const src of [tm.po_ship_live, tm.po_ship_dates]) {
    for (const [vendor, v] of Object.entries(src || {})) {
      // NEXT item due (Jon, Jul 28): a vendor whose items are ALL finished
      // must stop contributing dates — stale May ship-bys were pinning
      // months-old jobs to the top of the board "for no reason". When we
      // can't resolve vendors (no assignments loaded), count everything.
      if (liveVendors && !liveVendors.has(vendor)) continue;
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) dates.push(v.slice(0, 10));
    }
  }
  return dates.length ? dates.sort()[0] : null;
}
function firstItemDue(job: any): string | null {
  const liveItems = ((job.items || []) as any[]).filter(it => !itemLifecycleDone(it, job.shipping_route));
  const dates = liveItems.map(it => it.ship_est || it.expected_arrival || null).filter(Boolean) as string[];
  if (dates.length) return dates.sort()[0];
  // Fallback: vendor ship-bys, but only from vendors that still have live items.
  const liveVendors = new Set<string>();
  let anyResolved = false;
  for (const it of liveItems) {
    const dec = (it.decorator_assignments || [])[0]?.decorators;
    if (dec) { anyResolved = true; if (dec.name) liveVendors.add(dec.name); if (dec.short_code) liveVendors.add(dec.short_code); }
  }
  return vendorShipFallback(job, anyResolved ? liveVendors : null);
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

// Scan-resume state (Jon 2026-07-20): the board remembers how you left it —
// tab, sort, filters, search, and WHICH strip you clicked into — so "‹ Projects"
// from a job detail puts you back mid-scan: same order, scrolled to the same
// strip, briefly ink-outlined. Session-scoped (survives navigation, not a new tab).
const BOARD_STATE_KEY = "projectsBoardState.v1";
type BoardReturn = { jobId: string; scrollY: number } | null;
function readBoardState(): any {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(sessionStorage.getItem(BOARD_STATE_KEY) || "null"); } catch { return null; }
}

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
  const [sortBy, setSortBy] = useState<"due" | "invoice" | "newest">("due"); // default: next item due
  const [unpaidOnly, setUnpaidOnly] = useState(false); // completed tab: only jobs with money outstanding
  const returnRef = useRef<BoardReturn>(null); // strip we left through, for scroll-back
  const [flashId, setFlashId] = useState<string | null>(null); // strip to ink-outline after return

  // Restore the saved board state on mount (post-hydration so SSR markup matches).
  useEffect(() => {
    const s = readBoardState();
    if (!s) return;
    if (s.tab === "active" || s.tab === "completed") setTab(s.tab);
    if (typeof s.query === "string") setQuery(s.query);
    if (typeof s.stageFilter === "string") setStageFilter(s.stageFilter);
    if (typeof s.clientFilter === "string") setClientFilter(s.clientFilter);
    if (s.sortBy === "due" || s.sortBy === "invoice" || s.sortBy === "newest") setSortBy(s.sortBy);
    setUnpaidOnly(!!s.unpaidOnly);
    returnRef.current = s.returnTo || null;
  }, []);
  const persistBoardState = (returnTo: BoardReturn = returnRef.current) => {
    try { sessionStorage.setItem(BOARD_STATE_KEY, JSON.stringify({ tab, query, stageFilter, clientFilter, sortBy, unpaidOnly, returnTo })); } catch {}
  };
  useEffect(() => { persistBoardState(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, query, stageFilter, clientFilter, sortBy, unpaidOnly]);
  // Record the strip we're leaving through — called on strip click AND by the
  // status bar right before its segment deep-links (which do their own push).
  const rememberJob = (r: Row) => {
    returnRef.current = { jobId: r.job.id, scrollY: window.scrollY };
    persistBoardState(returnRef.current);
  };
  const openJob = (r: Row) => {
    rememberJob(r);
    router.push(`/jobs/${r.job.id}`);
  };
  // After the rows land, jump back to the strip we left through (once).
  useEffect(() => {
    if (loading) return;
    const rt = returnRef.current;
    if (!rt) return;
    returnRef.current = null;
    persistBoardState(null);
    requestAnimationFrame(() => {
      const el = document.getElementById(`strip-${rt.jobId}`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        setFlashId(rt.jobId);
        setTimeout(() => setFlashId(null), 1700);
      } else if (rt.scrollY) window.scrollTo(0, rt.scrollY);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("jobs")
        .select("id, job_number, title, phase, shipping_route, payment_terms, quote_approved, quote_approved_at, created_at, updated_at, phase_timestamps, target_ship_date, type_meta, costing_summary, clients(name), payment_records(amount, status, paid_date), items(id, name, sort_order, pipeline_stage, artwork_status, shipping_route, ship_est, expected_arrival, blanks_order_cost, blanks_order_number, received_at_hpd, forwarded_at, webstore_entered_at, buy_sheet_lines(qty_ordered), decorator_assignments(decorators(name, short_code)))")
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
  // Client filter options follow the tab — completed clients aren't necessarily active ones.
  const clients = useMemo(() => [...new Set(rows.filter(r => tab === "completed" ? r.stage.complete : !r.stage.complete).map(clientName))].sort(), [rows, tab]);

  const q = query.toLowerCase().trim();
  const matchQ = (r: Row) => !q || `${r.job.job_number} ${(r.job as any).type_meta?.qb_invoice_number || ""} ${clientName(r)} ${r.job.title || ""}`.toLowerCase().includes(q);
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
    // On-hold jobs always sink to the bottom — their dates aren't live, so they
    // must never outrank working jobs in any sort mode.
    const hold = (r: Row) => (r.job.phase === "on_hold" ? 1 : 0);
    const list = [...filtered];
    if (sortBy === "due") {
      list.sort((a, b) => {
        if (hold(a) !== hold(b)) return hold(a) - hold(b);
        const da = firstItemDue(a.job), db = firstItemDue(b.job);
        if (da && db) return da.localeCompare(db) || byCreated(a, b);
        if (da) return -1;
        if (db) return 1;
        return byCreated(a, b);
      });
    } else if (sortBy === "invoice") {
      const inv = (r: Row) => parseInt((r.job.type_meta as any)?.qb_invoice_number, 10);
      list.sort((a, b) => {
        if (hold(a) !== hold(b)) return hold(a) - hold(b);
        const ia = inv(a), ib = inv(b);
        if (!isNaN(ia) && !isNaN(ib)) return ib - ia;
        if (!isNaN(ia)) return -1;
        if (!isNaN(ib)) return 1;
        return (b.job.job_number || "").localeCompare(a.job.job_number || "");
      });
    } else list.sort((a, b) => (hold(a) - hold(b)) || byCreated(a, b));
    return list;
  }, [filtered, sortBy]);

  // Completed strips sort by close date, most recently finished first.
  const doneSorted = useMemo(() =>
    [...done]
      .filter(r => !unpaidOnly || payState(r.job).state !== "paid")
      .sort((a, b) => (closedAt(b.job) || "").localeCompare(closedAt(a.job) || "")),
  [done, unpaidOnly]);


  return (
    <BoardFrame title="Projects" action={
      <a href="/jobs/new" style={{ background: T.accent, color: "#0a0a0a", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontFamily: font, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>+ New Project</a>
    }>
      {/* Active/Completed toggles + search on ONE row (Jon, Jul 29) — search
          sits left beside the tabs, same height, white pill kept but compact. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "14px 0 4px", flexWrap: "wrap" }}>
        {([["active", `Active · ${activeAll.length}`], ["completed", `Completed · ${rows.filter(r => r.stage.complete).length}`]] as [typeof tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 9, cursor: "pointer", border: `1px solid ${tab === k ? T.text : T.border}`, background: tab === k ? T.text : T.card, color: tab === k ? "#0a0a0a" : T.muted }}>{label}</button>
        ))}
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search client, job #, invoice #, or title…"
          style={{ width: "min(360px, 100%)", boxSizing: "border-box", fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 999, border: "none", background: "#ffffff", color: "#0a0a0a", fontFamily: font, outline: "none" }} />
      </div>

      {tab === "active" ? (
        loading ? <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center" }}>Loading…</div> : (<>
          <style>{`@keyframes projChipPop{from{transform:translateY(2px);opacity:.35}to{transform:none;opacity:1}}.proj-chip{animation:projChipPop .13s ease-out}`}</style>
          <SliceSortRow>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={selStyle}>
              <option value="due">Next item due</option>
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
                {/* Filter labels = the WORK each bucket represents, not the
                    milestone reached (Jon: "half a step ahead" — resting at
                    Approved means the invoice is the next move). The strip
                    spine keeps milestone names; this dropdown picks work. */}
                {PROJ_MILESTONES.map(m => {
                  const FILTER_LABELS: Record<string, string> = {
                    quote_sent: "Needs quote sent",
                    quote_appr: "Waiting on client",
                    invoice: "Needs invoice",
                    paid: "Awaiting payment",
                    order: "Needs blanks + POs",
                    production: "In production",
                    receiving: "Receiving",
                    shipping: "Shipping",
                    fulfillment: "Staging",
                  };
                  return <option key={m.k} value={m.k}>{FILTER_LABELS[m.k] || m.label} ({stageCounts[m.k] || 0})</option>;
                })}
              </select>
            </div>
          </SliceSortRow>

          {active.map(r => <Strip key={r.job.id} r={r} thumbs={thumbs} proofStatus={proofStatus} flash={flashId === r.job.id} onOpen={() => openJob(r)} onRemember={() => rememberJob(r)} />)}
          {active.length === 0 && <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginTop: 8 }}>No active projects match.</div>}
        </>)
      ) : (
        <div style={{ marginTop: 4 }}>
          <SliceSortRow>
            <span style={{ fontSize: 12, color: T.muted }}>{doneSorted.length} {doneSorted.length === 1 ? "project" : "projects"}{unpaidOnly ? <> with <b style={{ color: T.text }}>money outstanding</b></> : null}</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={() => setUnpaidOnly(u => !u)}
                style={{ ...selStyle, background: unpaidOnly ? T.text : T.card, color: unpaidOnly ? "#0a0a0a" : T.text, border: `1px solid ${unpaidOnly ? T.text : T.border}` }}>
                Unpaid only
              </button>
              <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} style={selStyle}>
                <option value="">All clients</option>
                {clients.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </SliceSortRow>
          {doneSorted.map(r => <Strip key={r.job.id} r={r} thumbs={thumbs} proofStatus={proofStatus} completed flash={flashId === r.job.id} onOpen={() => openJob(r)} onRemember={() => rememberJob(r)} />)}
          {!doneSorted.length && <div style={{ color: T.muted, fontSize: 14, padding: 40, textAlign: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginTop: 8 }}>No completed projects match.</div>}
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

// Money state for a strip: paid against the invoice total (QB with tax, else
// costing gross). "none" = nothing invoiced and no value to chase.
function payState(job: any): { state: "paid" | "partial" | "unpaid" | "none"; due: number } {
  const paid = ((job.payment_records || []) as any[]).filter(p => p.status === "paid").reduce((a, p) => a + (+p.amount || 0), 0);
  const total = (job.type_meta as any)?.qb_total_with_tax || (job.costing_summary as any)?.grossRev || 0;
  if (total <= 0) return { state: paid > 0 ? "paid" : "none", due: 0 };
  const due = Math.max(0, total - paid);
  if (paid >= total - 0.005) return { state: "paid", due: 0 };
  return { state: paid > 0 ? "partial" : "unpaid", due };
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

function Strip({ r, thumbs, proofStatus, completed = false, flash = false, onOpen, onRemember }: { r: Row; thumbs: Record<string, string>; proofStatus?: Record<string, { state?: string }>; completed?: boolean; flash?: boolean; onOpen: () => void; onRemember?: () => void }) {
  const { job, stage } = r;
  const isMobile = useIsMobile();
  const [peek, setPeek] = useState(false); // inline items panel
  const items = ([...(job.items || [])] as any[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  // thumb=1 — serve Drive's pre-rendered thumbnail, NOT the multi-MB original
  // (these render at 30-52px; the original PNG was the board's slow part).
  const thumbUrl = (id: string, size: number) => `/api/files/thumbnail?id=${thumbs[id]}&thumb=1&size=${size}`;
  // Once a QB invoice # is assigned that's the number used everywhere (POs tie to
  // it, it matches QB) — lead with it, fall back to the job number pre-invoice.
  const invNo = (job.type_meta as any)?.qb_invoice_number || job.job_number;
  const [raised, setRaised] = useState(false); // rise above sibling strips while the peek is open
  const sig = stage.signal;
  // On hold: dates aren't live — no countdown, no urgency edge, sinks in sort.
  const onHold = job.phase === "on_hold";
  const edgeColor = onHold ? null : sig === "late" ? T.red : sig === "act" ? T.amber : null; // wait → no edge (recedes)
  // Countdown = first item due to complete its lifecycle (Jon 2026-07-20) —
  // earliest resolveEta over in-flight items. "~" = estimate; unset = TBD (R5).
  const firstDue = onHold ? null : firstItemDue(job);
  const cd = etaCountdown(firstDue);
  const cdColor = cd ? ({ red: T.red, amber: T.amber, muted: T.muted, green: T.green } as const)[cd.band] : T.faint;
  // created_at is a full timestamp — format via new Date(), NOT fmtDay/parseDay
  // (slicing a UTC timestamp shows the previous day for Vegas evenings).
  const opened = job.created_at ? new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return (
    <div id={`strip-${job.id}`} onClick={onOpen} style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: edgeColor ? `4px solid ${edgeColor}` : `1px solid ${T.border}`, borderRadius: 12, padding: edgeColor ? "10px 16px 10px 13px" : "10px 16px", marginTop: 8, cursor: "pointer", position: "relative", zIndex: raised ? 40 : undefined, outline: flash ? `2.5px solid ${T.text}` : "none", outlineOffset: -1, transition: "outline-color 0.5s" }}>
      <div style={isMobile ? { display: "flex", flexDirection: "column" as const, alignItems: "stretch", gap: 10 } : { display: "flex", alignItems: "center" }}>
        <div style={{ width: isMobile ? "auto" : 236, flexShrink: 0, minWidth: 0, paddingRight: isMobile ? 0 : 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: T.muted }}>{invNo}</span>
            <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, fontFamily: mono }}>{routeLabel[stage.route] || stage.route}</span>
            {(job.type_meta as any)?.source === "client_portal_cart" && (
              // Self-serve origin — the client built this order in the hub cart.
              <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: T.amber, fontFamily: mono }}>Client</span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{(job.clients as any)?.name || "—"}</div>
          {job.title && <div style={{ fontSize: 11, color: T.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{job.title}</div>}
        </div>
        {completed ? (
          /* Completed: flex spacer, then a FIXED-WIDTH run block so every strip's
             dates + rail line up in columns: payment state · opened ●─ Nd hero ─● completed. */
          (() => {
            const close = closedAt(job);
            const days = job.created_at && close ? Math.max(0, Math.floor((new Date(close).getTime() - new Date(job.created_at).getTime()) / 86400000)) : null;
            const pay = payState(job);
            const payClr = pay.state === "paid" ? T.green : pay.state === "partial" ? T.amber : pay.state === "unpaid" ? T.red : T.faint;
            const payLbl = pay.state === "paid" ? "Paid" : pay.state === "partial" ? "Partially paid" : pay.state === "unpaid" ? "Unpaid" : "No invoice";
            const endLbl = (date: string | null, label: string, align: "left" | "right") => (
              <div style={{ textAlign: align, width: 52, flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: T.text, whiteSpace: "nowrap" }}>{fmtStamp(date)}</div>
                <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 2 }}>{label}</div>
              </div>
            );
            return (<>
              {!isMobile && <div style={{ flex: 1, minWidth: 12 }} />}
              <div style={{ width: isMobile ? "auto" : 112, flexShrink: 0, textAlign: isMobile ? "left" : "right", paddingRight: isMobile ? 0 : 18 }}>
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: payClr }}>{payLbl}</div>
                {pay.due > 0 && <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: payClr, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>${Math.round(pay.due).toLocaleString()} due</div>}
              </div>
              <div style={{ width: isMobile ? "auto" : 330, flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
                {endLbl(job.created_at, "Opened", "right")}
                <div style={{ flex: 1, position: "relative", height: 16 }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: T.border }} />
                  <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 7, height: 7, borderRadius: 999, background: T.green }} />
                  <div style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", width: 7, height: 7, borderRadius: 999, background: T.green }} />
                  {days !== null && (
                    <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", background: T.card, padding: "0 9px", whiteSpace: "nowrap", display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 800, color: T.text, fontVariantNumeric: "tabular-nums" }}>{days}</span>
                      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint }}>{days === 1 ? "day" : "days"}</span>
                    </div>
                  )}
                </div>
                {endLbl(close, "Completed", "left")}
              </div>
            </>);
          })()
        ) : (
          <JobStatusBar job={job} stage={stage} items={job.items} payments={job.payment_records} navigate onHoverChange={setRaised} onBeforeNavigate={onRemember} />
        )}
        {/* Items peek toggle — overlapping mockup thumbs; click expands the panel. */}
        {items.length > 0 && (
          <button onClick={e => { e.stopPropagation(); setPeek(p => !p); }} title={peek ? "Hide items" : `Peek ${items.length} item${items.length === 1 ? "" : "s"}`}
            style={{ display: "flex", alignItems: "center", justifyContent: isMobile ? "flex-start" : "flex-end", width: isMobile ? "auto" : 130, flexShrink: 0, marginLeft: isMobile ? 0 : 14, padding: 0, background: "none", border: "none", cursor: "pointer" }}>
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
        {!completed && (isMobile ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 800, color: onHold ? T.muted : cdColor, fontVariantNumeric: "tabular-nums" }}>{onHold ? "ON HOLD" : cd ? cd.text : "TBD"}</span>
            <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint }}>
              {onHold ? "dates paused" : firstDue ? <>first item due ~<span style={{ fontFamily: mono }}>{fmtDay(firstDue)}</span></> : "no dates set"}
            </span>
            {opened && <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint }}>opened <span style={{ fontFamily: mono }}>{opened}</span></span>}
          </div>
        ) : (
          <div style={{ width: 108, flexShrink: 0, textAlign: "right", paddingLeft: 14 }}>
            <div style={{ fontFamily: mono, fontSize: onHold ? 12 : 16, fontWeight: 800, color: onHold ? T.muted : cdColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {onHold ? "ON HOLD" : cd ? cd.text : "TBD"}
            </div>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 3 }}>
              {onHold ? "dates paused" : firstDue ? <>first item due ~<span style={{ fontFamily: mono }}>{fmtDay(firstDue)}</span></> : "no dates set"}
            </div>
            {opened && <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint, marginTop: 3 }}>opened <span style={{ fontFamily: mono }}>{opened}</span></div>}
          </div>
        ))}
      </div>
      {/* Items peek — V2 modal (eyebrow → title → summary strip → cards → footer). */}
      {peek && (
        <div onClick={e => e.stopPropagation()} style={{ cursor: "default" }}>
          <ModalShell onClose={() => setPeek(false)} maxWidth={560}>
            <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, fontFamily: mono }}>{invNo} · {routeLabel[stage.route] || stage.route}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 3 }}>{(job.clients as any)?.name || "—"}{job.title ? <span style={{ color: T.muted, fontWeight: 400 }}> · {job.title}</span> : null}</div>
            </div>
            <div style={{ display: "flex", gap: 26, padding: "12px 22px", background: T.surface, flexWrap: "wrap" }}>
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
              <button onClick={onOpen} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 18px", border: "none", background: T.text, color: "#0a0a0a", cursor: "pointer", fontFamily: font }}>Open project →</button>
            </div>
          </ModalShell>
        </div>
      )}
    </div>
  );
}
