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

const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Flat uppercase color text — DESIGN.md, no pills.
const STATE_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Drafted", color: T.faint },
  sent: { label: "Sent", color: T.accent },
  paid: { label: "Paid", color: T.green },
  reconcile: { label: "Reconcile", color: T.amber },
  final: { label: "Final", color: T.green },
  invoiced: { label: "Invoiced", color: T.accent },
  ss_paid: { label: "Paid", color: T.green },
};
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
  const [openOnly, setOpenOnly] = useState(true);
  const [tab, setTab] = useState<"index" | "close">("index");
  const [costCompleteByJob, setCostCompleteByJob] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    try {
      const [jobsRes, itemsRes, decoratorsRes, apRes, entriesRes, marksRes, paysRes, clientsRes, ssRes] = await Promise.all([
        supabase.from("jobs").select("id, job_number, title, phase, client_id, clients(name), payment_terms, target_ship_date, costing_summary, costing_data, type_meta, created_at, shipping_route, fulfillment_status, is_inventory, is_test, financial_closed_at"),
        supabase.from("items").select("id, job_id, name, sort_order, blank_costs, pipeline_stage, shipping_route, forwarded_at, buy_sheet_lines(size, qty_ordered)"),
        supabase.from("decorators").select("id, name, short_code, pricing_data, capabilities"),
        supabase.from("ap_vendors").select("id, name, kind, decorator_id, match_keys").eq("active", true),
        supabase.from("cost_entries").select("job_id, vendor_id, amount, source, status"),
        supabase.from("cost_vendor_status").select("job_id, vendor_id, reason"),
        supabase.from("payment_records").select("id, job_id, amount, status, due_date"),
        supabase.from("clients").select("id, name, default_terms"),
        supabase.from("shipstation_reports").select("id, client_id, report_type, period_label, totals, postage_totals, qb_invoice_number, qb_total_with_tax, paid_at, paid_amount, sent_at, created_at"),
      ]);
      const firstErr = [jobsRes, itemsRes, decoratorsRes, apRes, entriesRes, marksRes, paysRes, clientsRes, ssRes].find(r => r.error);
      if (firstErr?.error) { setErr(firstErr.error.message); return; }
      const itemsByJob: Record<string, any[]> = {};
      for (const it of (itemsRes.data || []) as any[]) (itemsByJob[it.job_id] ||= []).push(it);
      const paymentsByJob: Record<string, any[]> = {};
      for (const p of (paysRes.data || []) as any[]) if (p.job_id) (paymentsByJob[p.job_id] ||= []).push(p);
      setAr(buildAr({
        jobs: jobsRes.data || [],
        itemsByJob,
        paymentsByJob,
        clients: (clientsRes.data || []) as any[],
        ssReports: ssRes.data || [],
      }));
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
      setCostCompleteByJob(cc);
    } catch (e: any) { setErr(e?.message || "Load failed"); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const shown: InvoiceRow[] = useMemo(() => {
    if (!ar) return [];
    const needle = q.trim().toLowerCase();
    return ar.rows.filter(r =>
      (stream === "all" || r.stream === stream)
      && (!agingFilter || r.aging === agingFilter)
      && (!openOnly || r.balance > 0.01)
      && (!needle || r.clientName.toLowerCase().includes(needle) || r.label.toLowerCase().includes(needle) || (r.invoiceNumber || "").toLowerCase().includes(needle))
    );
  }, [ar, stream, agingFilter, openOnly, q]);

  const kpi = (label: string, value: string, color = T.text) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 18px", minWidth: 150 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.faint }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color, fontFamily: mono, marginTop: 5 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 4 }}>Invoices</h1>
      <p style={{ fontSize: 12, color: T.faint, marginBottom: 18 }}>
        Every invoice, both streams, one aging model. Rows link to where the actions live — this page only reads.
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
            {(["index", "close"] as const).map(k => {
              const closeable = ar.rows.filter(r => isCloseable(r, !!costCompleteByJob[r.id])).length;
              return (
                <button key={k} onClick={() => setTab(k)}
                  style={{ borderRadius: 8, border: `1px solid ${tab === k ? T.accent : T.border}`, background: tab === k ? T.surface : "transparent", color: tab === k ? T.text : T.muted, fontSize: 12.5, fontWeight: 800, padding: "9px 16px", cursor: "pointer", fontFamily: font }}>
                  {k === "index" ? "All invoices" : `Close-out${closeable ? ` · ${closeable}` : ""}`}
                </button>
              );
            })}
          </div>

          {tab === "close" ? (
            <CloseOutQueue rows={ar.rows} costCompleteByJob={costCompleteByJob} closing={closing}
              onClose={async (row) => {
                setClosing(row.id);
                const { data: { user } } = await supabase.auth.getUser();
                const { error } = await (supabase.from("jobs") as any)
                  .update({ financial_closed_at: new Date().toISOString(), financial_closed_by: user?.id || null })
                  .eq("id", row.id);
                setClosing(null);
                if (error) setErr(error.message); else load();
              }}
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
          {/* Aging strip — clickable buckets filter the index */}
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

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            {(["all", "job", "fulfillment"] as const).map(k => (
              <button key={k} onClick={() => setStream(k)}
                style={{ borderRadius: 6, border: `1px solid ${stream === k ? T.accent : T.border}`, background: stream === k ? T.surface : "transparent", color: stream === k ? T.text : T.muted, fontSize: 12, fontWeight: 700, padding: "7px 13px", cursor: "pointer", fontFamily: font }}>
                {k === "all" ? "All" : k === "job" ? "Jobs" : "Fulfillment"}
              </button>
            ))}
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: T.muted, cursor: "pointer" }}>
              <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} /> open balances only
            </label>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, invoice #, title…"
              style={{ marginLeft: "auto", minWidth: 220, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, fontSize: 12.5, padding: "9px 12px", outline: "none", fontFamily: font }} />
          </div>

          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflowX: "auto", background: T.card }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860, fontSize: 12.5 }}>
              <thead><tr>
                {["Date", "Client", "Inv #", "", "State", "Billed", "Paid", "Balance", "Due / aging"].map((h, i) => (
                  <th key={i} style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: T.faint, textAlign: i >= 5 && i <= 7 ? "right" : "left", padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: "26px 14px", color: T.faint, fontSize: 12.5 }}>
                    {q || agingFilter || stream !== "all" ? "Nothing matches those filters." : openOnly ? "No open balances — everything's collected." : "No invoices yet."}
                  </td></tr>
                )}
                {shown.map(r => {
                  const sm = STATE_META[r.state] || { label: r.state, color: T.faint };
                  const am = AGING_META[r.aging];
                  return (
                    <tr key={`${r.stream}-${r.id}`} onClick={() => { window.location.href = r.href; }}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, color: T.muted, whiteSpace: "nowrap" }}>{fmtDay(r.date)}</td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontWeight: 700, whiteSpace: "nowrap" }}>{r.clientName}</td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, color: r.invoiceNumber ? T.text : T.faint, whiteSpace: "nowrap" }}>{r.invoiceNumber ? `#${r.invoiceNumber}` : "—"}</td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, color: T.muted, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.label}{r.stream === "fulfillment" ? <span style={{ color: T.faint, fontSize: 10.5 }}> · fulfillment</span> : null}
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: sm.color }}>{sm.label}</span>
                      </td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, textAlign: "right", whiteSpace: "nowrap" }}>{money(r.billed)}</td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, textAlign: "right", color: r.paid > 0 ? T.green : T.faint, whiteSpace: "nowrap" }}>{r.paid > 0 ? money(r.paid) : "—"}</td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, fontFamily: mono, textAlign: "right", fontWeight: 700, color: r.balance > 0.01 ? T.amber : T.green, whiteSpace: "nowrap" }}>{r.balance > 0.01 ? money(r.balance) : "—"}</td>
                      <td style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}33`, whiteSpace: "nowrap" }}>
                        {r.financialClosedAt
                          ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.green }}>Closed</span>
                          : r.balance > 0.01
                          ? <span><span style={{ fontFamily: mono, color: T.muted }}>{fmtDay(r.dueDate || r.expectedDate)}</span> <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: am.color, marginLeft: 6 }}>{am.label}</span></span>
                          : <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.green }}>Settled</span>}
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
        </>
      )}
    </div>
  );
}

// ── Close-out queue (Phase 1c). Conditions locked 2026-08-13: complete ·
//    Final (or Paid, no reconcile required) · zero balance · cost-complete.
//    Freight never gates. Job stream only; fulfillment never "closes". ──
function CloseOutQueue({ rows, costCompleteByJob, closing, onClose, onReopen }: {
  rows: InvoiceRow[]; costCompleteByJob: Record<string, boolean>; closing: string | null;
  onClose: (row: InvoiceRow) => Promise<void>; onReopen: (row: InvoiceRow) => Promise<void>;
}) {
  const queue = rows.filter(r => isCloseable(r, !!costCompleteByJob[r.id]));
  const recentlyClosed = rows.filter(r => r.financialClosedAt).slice(0, 12);
  return (
    <div>
      {queue.length === 0 ? (
        <div style={{ color: T.faint, fontSize: 13, padding: "18px 0" }}>
          Nothing ready to close. A job lands here when it is complete, its invoice is Final (or Paid with no reconcile owed), the balance is zero, and every vendor is billed or dispositioned.
        </div>
      ) : queue.map(r => (
        <div key={r.id} style={{ display: "flex", gap: 14, alignItems: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{r.clientName} <span style={{ color: T.faint, fontWeight: 400 }}>· {r.label}</span></div>
            <div style={{ fontSize: 11, fontFamily: mono, color: T.muted, marginTop: 3 }}>{r.jobNumber || ""}{r.invoiceNumber ? ` · #${r.invoiceNumber}` : ""} · {money(r.billed)} billed · paid in full · costs complete</div>
          </div>
          <a href={r.href} style={{ fontSize: 11, color: T.muted, textDecoration: "none", fontWeight: 700 }}>open ↗</a>
          <button disabled={closing === r.id} onClick={() => onClose(r)}
            style={{ background: T.green, color: "#0a0a0a", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: font, opacity: closing === r.id ? 0.6 : 1 }}>
            {closing === r.id ? "Closing…" : "Close it out"}
          </button>
        </div>
      ))}
      {recentlyClosed.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: T.faint, marginBottom: 8 }}>Closed</div>
          {recentlyClosed.map(r => (
            <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: T.muted, padding: "5px 0" }}>
              <span style={{ color: T.green, fontWeight: 800, fontSize: 10, letterSpacing: "0.06em" }}>CLOSED</span>
              <span style={{ fontWeight: 700, color: T.text }}>{r.clientName}</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ fontFamily: mono, color: T.faint }}>{fmtDay(r.financialClosedAt || null)}</span>
              <a href={r.href} style={{ color: T.faint, textDecoration: "none", marginLeft: "auto" }}>open ↗</a>
              <button disabled={closing === r.id} onClick={() => onReopen(r)}
                style={{ background: "none", border: "none", color: T.faint, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: font }}>reopen</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
