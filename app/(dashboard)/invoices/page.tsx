"use client";
// INVOICES — the AR index (Financial V2 Phase 1b, Aug 24 2026).
// Spec: docs/financial-v2-phase1-invoices.md. One page, both revenue
// streams (job invoices + fulfillment reports), one aging model.
// READ INDEX + QUEUE ONLY: every row deep-links to where its actions live
// (job Invoice surface / fulfillment detail). No send/adjust/payment verbs
// here — the only writes this surface will ever gain are close-out (1c).
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { buildAr, isCloseable, type ArAging, type ArSummary, type InvoiceRow } from "@/lib/ar";
import { computeBillingQueue } from "@/lib/billing-queue";
import { buildPrintersMap } from "@/lib/pricing";
import { maybeAutoFinalizeInvoice } from "@/lib/job/auto-finalize";

const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Flat uppercase color text — DESIGN.md, no pills.
const menuBtn: any = { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: "#e6e9f2", fontSize: 12.5, fontWeight: 600, padding: "8px 12px", cursor: "pointer", borderRadius: 6, fontFamily: "inherit" };

// Unified AR vocabulary (accounting-standard, Jon Aug 25): the state column
// is PAYMENT state only — Draft → Sent → Partial → Paid — one language for
// both streams. Reconcile keeps its amber exception because it demands a
// human. "Final" (qtys confirmed) is a workflow fact, not a payment fact —
// it reads as done on a chase list, so here it renders as its payment state;
// the job's invoice rail still says Final where the workflow meaning lives.
function stateMeta(r: InvoiceRow): { label: string; color: string } {
  if (r.state === "reconcile") return { label: "Reconcile", color: T.amber };
  if (r.state === "draft") return { label: "Draft", color: T.faint };
  if (r.state === "paid" || r.state === "ss_paid" || r.balance <= 0.01) return { label: "Paid", color: T.green };
  return r.paid > 0.01
    ? { label: "Partial", color: T.accent }
    : { label: "Sent", color: T.accent };
}
const AGING_META: Record<ArAging, { label: string; color: string }> = {
  not_due: { label: "Not due", color: T.faint },
  on_terms: { label: "On terms", color: T.muted },
  overdue_30: { label: "Overdue ≤30", color: T.amber },
  overdue_60: { label: "Overdue ≤60", color: T.amber },
  overdue_90: { label: "Overdue 90+", color: T.red },
};

export default function InvoicesPage() {
  const supabase = createClient();
  const [ar, setAr] = useState<ArSummary | null>(null);
  const [err, setErr] = useState("");
  const [stream, setStream] = useState<"all" | "job" | "fulfillment">(() => {
    if (typeof window === "undefined") return "all";
    const q = new URLSearchParams(window.location.search).get("stream");
    return q === "fulfillment" || q === "job" ? q : "all";
  });
  const [agingFilter, setAgingFilter] = useState<ArAging | null>(null);
  const [view, setView] = useState<"open" | "history">("open");
  const [tab, setTab] = useState<"index" | "close">("index");
  const [costCompleteByJob, setCostCompleteByJob] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);   // row key with ⋯ open
  const [actBusy, setActBusy] = useState(false);
  const [actMsg, setActMsg] = useState("");                       // last action outcome
  const [waiveArm, setWaiveArm] = useState(false);                // two-tap close-short
  const [q, setQ] = useState("");
  const [stmtOpen, setStmtOpen] = useState(false);

  async function load(depth = 0) {
    try {
      const [jobsRes, itemsRes, decoratorsRes, apRes, entriesRes, marksRes, paysRes, clientsRes, ssRes] = await Promise.all([
        supabase.from("jobs").select("id, job_number, title, phase, client_id, clients(name), payment_terms, target_ship_date, costing_summary, costing_data, type_meta, created_at, shipping_route, fulfillment_status, is_inventory, is_test, is_internal, financial_closed_at"),
        supabase.from("items").select("id, job_id, name, sort_order, blank_costs, pipeline_stage, shipping_route, forwarded_at, buy_sheet_lines(size, qty_ordered)"),
        supabase.from("decorators").select("id, name, short_code, pricing_data, capabilities"),
        supabase.from("ap_vendors").select("id, name, kind, decorator_id, match_keys").eq("active", true),
        supabase.from("cost_entries").select("job_id, vendor_id, amount, source, status"),
        supabase.from("cost_vendor_status").select("job_id, vendor_id, reason"),
        supabase.from("payment_records").select("id, job_id, amount, status, due_date"),
        supabase.from("clients").select("id, name, default_terms"),
        supabase.from("shipstation_reports").select("id, client_id, report_type, period_label, totals, postage_totals, qb_invoice_number, qb_total_with_tax, qb_payment_link, paid_at, paid_amount, sent_at, created_at"),
      ]);
      const firstErr = [jobsRes, itemsRes, decoratorsRes, apRes, entriesRes, marksRes, paysRes, clientsRes, ssRes].find(r => r.error);
      if (firstErr?.error) { setErr(firstErr.error.message); return; }
      const itemsByJob: Record<string, any[]> = {};
      for (const it of (itemsRes.data || []) as any[]) (itemsByJob[it.job_id] ||= []).push(it);
      const paymentsByJob: Record<string, any[]> = {};
      for (const p of (paysRes.data || []) as any[]) if (p.job_id) (paymentsByJob[p.job_id] ||= []).push(p);
      const arData = buildAr({
        jobs: jobsRes.data || [],
        itemsByJob,
        paymentsByJob,
        clients: (clientsRes.data || []) as any[],
        ssReports: ssRes.data || [],
      });
      // Cost-complete per job×vendor (lib/billing-queue) — the fourth
      // close-out condition. Freight sources excluded (never gates close).
      const q = computeBillingQueue({
        jobs: jobsRes.data || [],
        printers: buildPrintersMap((decoratorsRes.data || []) as any[]),
        apVendors: (apRes.data || []) as any[],
        entries: ((entriesRes.data || []) as any[]).filter((e: any) => !String(e.source || "").startsWith("ups")),
        marks: (marksRes.data || []) as any[],
        itemsByJob,
      });
      const cc: Record<string, boolean> = {};
      for (const row of (q as any).jobs || []) cc[row.id] = !!row.costComplete;

      // The no-human-needed sweeps (Jon, Aug 26): zero-variance reconciles
      // self-finalize, and jobs passing every close gate self-close — amber
      // and queues only ever hold real human decisions. Loop ≤2 extra passes
      // so a job can finalize AND close in one visit; both stamps are
      // idempotent so this terminates.
      if (depth < 2) {
        const rec = arData.rows.filter(r => r.stream === "job" && r.state === "reconcile");
        const didFinal = await Promise.all(rec.map(r => maybeAutoFinalizeInvoice(supabase, r.id).catch(() => false)));
        const closeable = arData.rows.filter(r => isCloseable(r, !!cc[r.id]));
        for (const r of closeable) {
          await (supabase.from("jobs") as any)
            .update({ financial_closed_at: new Date().toISOString(), financial_closed_by: null })
            .eq("id", r.id);
          await (supabase.from("job_activity") as any).insert({
            job_id: r.id, user_id: null, type: "auto",
            message: "Financially closed automatically — settled, shipped, and cost-complete", metadata: {},
          });
        }
        if (didFinal.some(Boolean) || closeable.length > 0) return load(depth + 1);
      }
      setAr(arData);
      setCostCompleteByJob(cc);
    } catch (e: any) { setErr(e?.message || "Load failed"); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // ── Row actions (⋯ menu). Reminder + close-short live HERE because they
  //    are AR-index verbs, not job-surface verbs; everything else deep-links.
  async function sendReminder(row: InvoiceRow) {
    setActBusy(true); setActMsg("");
    try {
      // billing contact → primary → first with an email (house-page rule)
      const { data: jcs } = await supabase.from("job_contacts")
        .select("role_on_job, contacts(name, email)").eq("job_id", row.id);
      const flat = (jcs || []).map((r: any) => ({ role: r.role_on_job, ...(r.contacts || {}) })).filter((c: any) => c.email);
      const to = flat.find((c: any) => c.role === "billing") || flat.find((c: any) => c.role === "primary") || flat[0];
      if (!to) { setActMsg(`No contact with an email on ${row.clientName} — open the job to add one.`); return; }
      const res = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reminder", jobId: row.id, recipientEmail: to.email, recipientName: to.name || undefined }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setActMsg(out.error || "Reminder didn't send."); return; }
      setActMsg(`Reminder sent to ${to.email} — ${money(row.balance)} outstanding on #${row.invoiceNumber || row.jobNumber}.`);
      setMenuFor(null);
    } finally { setActBusy(false); }
  }
  async function closeShort(row: InvoiceRow) {
    setActBusy(true); setActMsg("");
    try {
      const { data: job } = await supabase.from("jobs").select("type_meta").eq("id", row.id).single();
      const tm = { ...((job as any)?.type_meta || {}) };
      tm.invoice_waived_amount = Math.round(((Number(tm.invoice_waived_amount) || 0) + row.balance) * 100) / 100;
      tm.invoice_waived_at = new Date().toISOString();
      tm.invoice_waived_note = "closed short from the invoices index";
      const { error } = await (supabase.from("jobs") as any).update({ type_meta: tm }).eq("id", row.id);
      if (error) { setActMsg(error.message); return; }
      setActMsg(`Closed short — ${money(row.balance)} waived on #${row.invoiceNumber || row.jobNumber}. Revenue reports keep the real paid figure.`);
      setMenuFor(null); load();
    } finally { setActBusy(false); }
  }
  async function unWaive(row: InvoiceRow) {
    setActBusy(true); setActMsg("");
    try {
      const { data: job } = await supabase.from("jobs").select("type_meta").eq("id", row.id).single();
      const tm = { ...((job as any)?.type_meta || {}) };
      delete tm.invoice_waived_amount; delete tm.invoice_waived_at; delete tm.invoice_waived_note;
      const { error } = await (supabase.from("jobs") as any).update({ type_meta: tm }).eq("id", row.id);
      if (error) { setActMsg(error.message); return; }
      setActMsg(`Waiver removed on #${row.invoiceNumber || row.jobNumber} — balance is live again.`);
      setMenuFor(null); load();
    } finally { setActBusy(false); }
  }

  // Chase math: how late is this row, against its real anchor (explicit due
  // date when one exists, else the terms-derived expected date).
  const daysLate = (r: InvoiceRow) => {
    const anchor = r.dueDate || r.expectedDate;
    if (!anchor) return 0;
    return Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000);
  };
  const shown: InvoiceRow[] = useMemo(() => {
    if (!ar) return [];
    const needle = q.trim().toLowerCase();
    const rows = ar.rows.filter(r =>
      (stream === "all" || r.stream === stream)
      && (!agingFilter || r.aging === agingFilter)
      && (view === "history" || r.balance > 0.01)
      && (!needle || r.clientName.toLowerCase().includes(needle) || r.label.toLowerCase().includes(needle) || (r.invoiceNumber || "").toLowerCase().includes(needle))
    );
    if (view === "open") {
      // Chase order: most late first; not-yet-due below, soonest deadline first.
      rows.sort((a, b) => {
        const la = daysLate(a), lb = daysLate(b);
        const aLate = la > 0, bLate = lb > 0;
        if (aLate !== bLate) return aLate ? -1 : 1;
        if (aLate) return lb - la || b.balance - a.balance;
        return la !== lb ? lb - la : b.balance - a.balance;
      });
    }
    return rows;
  }, [ar, stream, agingFilter, view, q]);

  const kpi = (label: string, value: string, color = T.text) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 18px", minWidth: 150 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.faint }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color, fontFamily: mono, marginTop: 5 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>Invoices</h1>
        <button onClick={() => setStmtOpen(true)}
          style={{ marginLeft: "auto", background: "transparent", color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
          Send statement
        </button>
        <a href="/invoices/fulfillment/new"
          style={{ background: T.accent, color: "#0a0a0a", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, textDecoration: "none", fontFamily: font }}>
          + Fulfillment invoice
        </a>
      </div>
      <p style={{ fontSize: 12, color: T.faint, marginBottom: 18 }}>
        Every invoice, both streams, one aging model. Rows link to where the actions live. Job invoices are born on their jobs; fulfillment invoices are born here.
      </p>
      {err && <div style={{ color: T.red, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{err}</div>}
      {!ar ? (
        <div style={{ color: T.faint, fontSize: 13, padding: "30px 0" }}>Loading the ledger…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            {kpi("Outstanding", money(ar.kpis.outstanding))}
            {kpi("Overdue", money(ar.kpis.overdue), ar.kpis.overdue > 0 ? T.red : T.green)}
            {kpi("On terms", money(ar.kpis.onTerms), T.muted)}
            {kpi("Expected · 30d", money(ar.kpis.expected30), T.green)}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {(["index", "close"] as const).map(k => (
              <button key={k} onClick={() => setTab(k)}
                style={{ borderRadius: 8, border: `1px solid ${tab === k ? T.accent : T.border}`, background: tab === k ? T.surface : "transparent", color: tab === k ? T.text : T.muted, fontSize: 12.5, fontWeight: 800, padding: "9px 16px", cursor: "pointer", fontFamily: font }}>
                {k === "index" ? "All invoices" : "Closed"}
              </button>
            ))}
          </div>

          {tab === "close" ? (
            <ClosedLog rows={ar.rows} closing={closing}
              onReopen={async (row) => {
                setClosing(row.id);
                const { error } = await (supabase.from("jobs") as any)
                  .update({ financial_closed_at: null, financial_closed_by: null })
                  .eq("id", row.id);
                setClosing(null);
                if (error) setErr(error.message); else load();
              }} />
          ) : (
          <>
          {/* Aging strip — clickable buckets filter the chase list */}
          {view === "open" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {(Object.keys(AGING_META) as ArAging[]).map(k => {
              const b = ar.aging[k]; const m = AGING_META[k]; const on = agingFilter === k;
              return (
                <button key={k} onClick={() => setAgingFilter(on ? null : k)}
                  style={{ background: on ? T.surface : "transparent", border: `1px solid ${on ? m.color : T.border}`, borderRadius: 8, padding: "8px 13px", cursor: "pointer", fontFamily: font, textAlign: "left" }}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: m.color, display: "block" }}>{m.label}</span>
                  <span style={{ fontSize: 12.5, fontFamily: mono, color: b.total > 0 ? T.text : T.faint, fontWeight: 700 }}>{b.total > 0 ? money(b.total) : "—"}{b.count > 0 ? ` · ${b.count}` : ""}</span>
                </button>
              );
            })}
          </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            {(["open", "history"] as const).map(k => {
              const openCount = ar.rows.filter(r => r.balance > 0.01 && (stream === "all" || r.stream === stream)).length;
              return (
                <button key={k} onClick={() => { setView(k); setAgingFilter(null); }}
                  style={{ borderRadius: 6, border: `1px solid ${view === k ? T.accent : T.border}`, background: view === k ? T.surface : "transparent", color: view === k ? T.text : T.muted, fontSize: 12, fontWeight: 800, padding: "7px 14px", cursor: "pointer", fontFamily: font }}>
                  {k === "open" ? `Open · ${openCount}` : "History"}
                </button>
              );
            })}
            <span style={{ display: "inline-flex", gap: 2, marginLeft: 6 }}>
              {(["all", "job", "fulfillment"] as const).map(k => (
                <button key={k} onClick={() => setStream(k)}
                  style={{ background: "none", border: "none", color: stream === k ? T.text : T.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 7px", cursor: "pointer", fontFamily: font, textDecoration: stream === k ? "underline" : "none", textUnderlineOffset: 4 }}>
                  {k === "all" ? "All" : k === "job" ? "Jobs" : "Fulfillment"}
                </button>
              ))}
            </span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, invoice #, title…"
              style={{ marginLeft: "auto", minWidth: 220, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 12.5, padding: "9px 12px", outline: "none", fontFamily: font }} />
          </div>

          {actMsg && <div style={{ fontSize: 12, fontWeight: 700, color: actMsg.includes("didn") || actMsg.includes("No contact") ? T.red : T.green, marginBottom: 10 }}>{actMsg}</div>}
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflowX: "auto", background: T.card }} onClick={() => menuFor && setMenuFor(null)}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860, fontSize: 12.5 }}>
              <thead><tr>
                {(view === "open"
                  ? ["Client", "Inv #", "", "State", "Balance", "Due / late", ""]
                  : ["Date", "Client", "Inv #", "", "State", "Billed", "Paid", "Balance", "Status", ""]
                ).map((h, i) => (
                  <th key={i} style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: T.faint, textAlign: h === "Billed" || h === "Paid" || h === "Balance" ? "right" : "left", padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={view === "open" ? 7 : 10} style={{ padding: "26px 14px", color: T.faint, fontSize: 12.5 }}>
                    {q || agingFilter || stream !== "all" ? "Nothing matches those filters." : view === "open" ? "No open balances — everything's collected." : "No invoices yet."}
                  </td></tr>
                )}
                {shown.map(r => {
                  const sm = stateMeta(r);
                  const am = AGING_META[r.aging];
                  return (
                    <tr key={`${r.stream}-${r.id}`} onClick={() => { window.location.href = r.href; }}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      {view === "history" && <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, color: T.muted, whiteSpace: "nowrap" }}>{fmtDay(r.date)}</td>}
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontWeight: 700, whiteSpace: "nowrap" }}>{r.clientName}</td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, color: r.invoiceNumber ? T.text : T.faint, whiteSpace: "nowrap" }}>{r.invoiceNumber ? `#${r.invoiceNumber}` : "—"}</td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, color: T.muted, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.label}{r.stream === "fulfillment" ? <span style={{ color: T.faint, fontSize: 10.5 }}> · fulfillment</span> : null}
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: sm.color }}>{sm.label}</span>
                      </td>
                      {view === "history" && <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, textAlign: "right", whiteSpace: "nowrap" }}>{money(r.billed)}</td>}
                      {view === "history" && <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, textAlign: "right", color: r.paid > 0 ? T.green : T.faint, whiteSpace: "nowrap" }}>{r.paid > 0 ? money(r.paid) : "—"}</td>}
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, textAlign: "right", fontWeight: 700, color: r.balance > 0.01 ? T.amber : T.green, whiteSpace: "nowrap" }}>{r.balance > 0.01 ? money(r.balance) : "—"}</td>
                      {view === "open" ? (
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, whiteSpace: "nowrap" }}>
                        {(() => {
                          // A draft was never billed — no due date exists yet,
                          // so chase math would only mislead.
                          if (r.state === "draft") return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.faint }}>Not sent yet</span>;
                          const late = daysLate(r);
                          return late > 0
                            ? <span><span style={{ fontFamily: mono, fontWeight: 800, color: am.color }}>{late}d late</span><span style={{ fontFamily: mono, color: T.faint, marginLeft: 8, fontSize: 11 }}>{r.dueDate ? `due ${fmtDay(r.dueDate)}` : `expected ${fmtDay(r.expectedDate)}`}</span></span>
                            : <span><span style={{ fontFamily: mono, color: T.muted }}>{fmtDay(r.dueDate || r.expectedDate)}</span> <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: am.color, marginLeft: 6 }}>{am.label}</span></span>;
                        })()}
                      </td>
                      ) : (
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, whiteSpace: "nowrap" }}>
                        {r.financialClosedAt
                          ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.green }}>Closed</span>
                          : (r.waived || 0) > 0.01 && r.balance <= 0.01
                          ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.amber }}>Closed short · {money(r.waived || 0)} waived</span>
                          : r.balance > 0.01
                          ? <span><span style={{ fontFamily: mono, color: T.muted }}>{fmtDay(r.dueDate || r.expectedDate)}</span> <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: am.color, marginLeft: 6 }}>{am.label}</span></span>
                          : <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.green }}>Settled</span>}
                      </td>
                      )}
                      <td style={{ padding: "6px 8px", borderBottom: `1px solid ${T.border}33`, position: "relative", width: 36 }} onClick={e => e.stopPropagation()}>
                        {(r.stream === "job" ? (r.balance > 0.01 || (r.waived || 0) > 0.01) : r.balance > 0.01) && (
                          <>
                            <button onClick={() => { setMenuFor(menuFor === `${r.stream}-${r.id}` ? null : `${r.stream}-${r.id}`); setWaiveArm(false); }}
                              style={{ background: "none", border: "none", color: T.muted, fontSize: 16, cursor: "pointer", fontFamily: font, padding: "2px 8px" }}>⋯</button>
                            {menuFor === `${r.stream}-${r.id}` && (
                              <div style={{ position: "absolute", right: 8, top: 30, zIndex: 40, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 6, minWidth: 210, boxShadow: "0 8px 30px rgba(0,0,0,0.45)" }}>
                                {r.stream === "job" && r.balance > 0.01 && (
                                  <button disabled={actBusy} onClick={() => sendReminder(r)} style={menuBtn}>Send payment reminder</button>
                                )}
                                {r.payLink && (
                                  <button onClick={() => { navigator.clipboard?.writeText(r.payLink!); setActMsg("Pay link copied."); setMenuFor(null); }} style={menuBtn}>Copy pay link</button>
                                )}
                                {r.stream === "fulfillment" && r.balance > 0.01 && (
                                  <button disabled={actBusy} onClick={async () => {
                                    setActBusy(true);
                                    const { error } = await (supabase.from("shipstation_reports") as any)
                                      .update({ paid_at: new Date().toISOString(), paid_amount: r.billed })
                                      .eq("id", r.id);
                                    setActBusy(false); setMenuFor(null);
                                    if (error) setActMsg(error.message); else { setActMsg("Marked paid."); load(); }
                                  }} style={{ ...menuBtn, color: T.green }}>Mark paid · {money(r.balance)}</button>
                                )}
                                {r.stream === "job" && r.balance > 0.01 && (
                                  <button disabled={actBusy} onClick={() => { if (!waiveArm) { setWaiveArm(true); return; } closeShort(r); }}
                                    style={{ ...menuBtn, color: waiveArm ? T.red : T.amber }}>
                                    {waiveArm ? `Tap again — waive ${money(r.balance)}` : `Close short · waive ${money(r.balance)}`}
                                  </button>
                                )}
                                {(r.waived || 0) > 0.01 && (
                                  <button disabled={actBusy} onClick={() => unWaive(r)} style={{ ...menuBtn, color: T.muted }}>Remove waiver · {money(r.waived || 0)}</button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10.5, color: T.faint, marginTop: 10 }}>
            {shown.length} invoice{shown.length === 1 ? "" : "s"} shown · aging is terms-aware (waiting inside net terms reads as on-terms, not late)
          </div>
          </>
          )}
          {stmtOpen && <SendStatementModal rows={ar.rows} daysLate={daysLate} onClose={() => setStmtOpen(false)} />}
        </>
      )}
    </div>
  );
}

// ── Send account statement (Aug 25 2026). Pick a client with open money,
//    review recipients + copy, send from billing@ with the statement PDF
//    attached (/api/statement/send → /api/pdf/statement). ──
function SendStatementModal({ rows, daysLate, onClose }: {
  rows: InvoiceRow[]; daysLate: (r: InvoiceRow) => number; onClose: () => void;
}) {
  const supabase = createClient();
  const [clientId, setClientId] = useState<string>("");
  const [contacts, setContacts] = useState<{ name: string; email: string; role_label: string | null; is_primary: boolean }[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const money0 = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Clients with open balances, biggest first.
  const clients = useMemo(() => {
    const by: Record<string, { id: string; name: string; total: number; pastDue: number; count: number }> = {};
    for (const r of rows) {
      if (r.balance <= 0.01) continue;
      const c = (by[r.clientId] ||= { id: r.clientId, name: r.clientName, total: 0, pastDue: 0, count: 0 });
      c.total += r.balance; c.count++;
      if (daysLate(r) > 0) c.pastDue += r.balance;
    }
    return Object.values(by).sort((a, b) => b.total - a.total);
  }, [rows, daysLate]);

  async function pickClient(id: string) {
    setClientId(id); setMsg("");
    const c = clients.find(x => x.id === id)!;
    const dateLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    setSubject(`Account Statement — ${c.name} — ${dateLabel}`);
    setBody(c.pastDue > 0.01
      ? `Hi Accounts Payable team,

Please find attached your current account statement from House Party Distro, dated ${dateLabel}.

The account reflects a total balance of ${money0(c.total)}, of which ${money0(c.pastDue)} is now past due. We'd greatly appreciate remittance of the past-due amount at your earliest convenience.

If you need a copy of any invoice, a PO cross-reference, or believe there's a discrepancy, just reply here and we'll get it resolved right away.

Thank you for your continued business.`
      : `Hi Accounts Payable team,

Please find attached your current account statement from House Party Distro, dated ${dateLabel}.

The account reflects a total balance of ${money0(c.total)}. Nothing is currently past due — this statement is a summary for your records.

If you need a copy of any invoice, a PO cross-reference, or believe there's a discrepancy, just reply here and we'll get it resolved right away.

Thank you for your continued business.`);
    const { data } = await supabase.from("contacts").select("name, email, role_label, is_primary").eq("client_id", id);
    const list = ((data || []) as any[]).filter(x => x.email);
    setContacts(list);
    const def: Record<string, boolean> = {};
    const billing = list.filter(x => /bill|account|a\/?p/i.test(x.role_label || ""));
    const defaults = billing.length > 0 ? billing : list.filter(x => x.is_primary);
    for (const x of (defaults.length > 0 ? defaults : list.slice(0, 1))) def[x.email] = true;
    setPicked(def);
  }

  async function send() {
    const recipients = Object.keys(picked).filter(e => picked[e]);
    if (recipients.length === 0) { setMsg("Pick at least one recipient."); return; }
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/statement/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, recipients, subject, body }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Send failed");
      setMsg("Statement sent.");
      setTimeout(onClose, 900);
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  const label = (t: string) => <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.faint, marginBottom: 6 }}>{t}</div>;
  const inputStyle: any = { width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 12.5, padding: "9px 12px", outline: "none", fontFamily: font, boxSizing: "border-box" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 22, width: "100%", maxWidth: 620, fontFamily: font, color: T.text }}>
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Send account statement</div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: T.faint, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        {!clientId ? (
          <div>
            {label("Client — open balances")}
            {clients.length === 0 && <div style={{ color: T.faint, fontSize: 13 }}>No clients with open balances.</div>}
            {clients.map(c => (
              <div key={c.id} onClick={() => pickClient(c.id)}
                style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "10px 12px", borderRadius: 8, cursor: "pointer", border: `1px solid transparent` }}
                onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</span>
                <span style={{ fontSize: 11, color: T.faint }}>{c.count} open</span>
                <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 12.5, fontWeight: 700 }}>{money0(c.total)}</span>
                {c.pastDue > 0.01 && <span style={{ fontFamily: mono, fontSize: 11, color: T.red, fontWeight: 700 }}>{money0(c.pastDue)} past due</span>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>{clients.find(c => c.id === clientId)?.name}</span>
              <button onClick={() => setClientId("")} style={{ background: "none", border: "none", color: T.faint, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>change</button>
              <a href={`/api/pdf/statement/${clientId}`} target="_blank" rel="noreferrer"
                style={{ marginLeft: "auto", fontSize: 11, color: T.accent, fontWeight: 700, textDecoration: "none" }}>Preview statement ↗</a>
            </div>
            <div>
              {label("Recipients")}
              {contacts.length === 0 && <div style={{ color: T.amber, fontSize: 12 }}>No contacts with an email on this client — add one on the client page first.</div>}
              {contacts.map(c => (
                <label key={c.email} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, padding: "4px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!picked[c.email]} onChange={e => setPicked(p => ({ ...p, [c.email]: e.target.checked }))} />
                  <span style={{ fontWeight: 600 }}>{c.name || c.email}</span>
                  <span style={{ color: T.faint, fontSize: 11 }}>{c.email}{c.role_label ? ` · ${c.role_label}` : ""}</span>
                </label>
              ))}
            </div>
            <div>{label("Subject")}<input value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} /></div>
            <div>{label("Message")}<textarea value={body} onChange={e => setBody(e.target.value)} rows={10} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} /></div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.faint }}>Sends from billing@ · statement PDF attached</span>
              {msg && <span style={{ fontSize: 12, fontWeight: 700, color: msg === "Statement sent." ? T.green : T.red }}>{msg}</span>}
              <button disabled={busy} onClick={send}
                style={{ marginLeft: "auto", background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: font, opacity: busy ? 0.6 : 1 }}>
                {busy ? "Sending…" : "Send statement"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Closed log (auto-close, Aug 26 2026). Close-out stopped being a human
//    step: when a job passes every gate (complete · Final or Paid-no-
//    reconcile · zero balance · cost-complete) the load() sweep stamps it
//    closed automatically. This tab is the record — reopen is the escape
//    hatch for a job that needs to stay live (e.g. a trailing cost). ──
function ClosedLog({ rows, closing, onReopen }: {
  rows: InvoiceRow[]; closing: string | null; onReopen: (row: InvoiceRow) => Promise<void>;
}) {
  const closed = rows.filter(r => r.financialClosedAt)
    .sort((a, b) => String(b.financialClosedAt).localeCompare(String(a.financialClosedAt)));
  return (
    <div>
      <div style={{ fontSize: 12, color: T.faint, marginBottom: 14, maxWidth: "70ch" }}>
        Jobs close themselves when the books are finished — complete, invoice final, paid to zero, every vendor billed or dispositioned. Reopen one if money still needs to move on it.
      </div>
      {closed.length === 0 && <div style={{ color: T.faint, fontSize: 13, padding: "12px 0" }}>Nothing closed yet.</div>}
      {closed.slice(0, 40).map(r => (
        <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: T.muted, padding: "6px 0", borderBottom: `1px solid ${T.border}33` }}>
          <span style={{ color: T.green, fontWeight: 800, fontSize: 10, letterSpacing: "0.06em" }}>CLOSED</span>
          <span style={{ fontWeight: 700, color: T.text }}>{r.clientName}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <span style={{ fontFamily: mono, color: T.faint }}>{fmtDay(r.financialClosedAt || null)}</span>
          <span style={{ fontFamily: mono, color: T.faint, marginLeft: "auto" }}>{money(r.billed)}</span>
          <a href={r.href} style={{ color: T.faint, textDecoration: "none" }}>open ↗</a>
          <button disabled={closing === r.id} onClick={() => onReopen(r)}
            style={{ background: "none", border: "none", color: T.faint, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: font }}>reopen</button>
        </div>
      ))}
      {closed.length > 40 && <div style={{ fontSize: 11, color: T.faint, marginTop: 10 }}>{closed.length - 40} older closed jobs not shown — search History for a specific one.</div>}
    </div>
  );
}
