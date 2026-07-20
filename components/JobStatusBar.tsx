"use client";
// THE shared job status bar — variable-length fill, signal colors, per-tail
// item-progress "half steps", the styled hover peek (dates/counts/$ per stage),
// and the ▲ current-stage caption. Used by BOTH the /projects list (navigate=true
// → segment click deep-links into the job) and the job detail (navigate=false →
// status-only; hover peek still works, but nav is the button row, not the bar).
// One source for the bar so the two can never drift. See [[jon-clean-architecture-standard]].
import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/theme";
import { PROJ_MILESTONES, ROUTE_DEAD, type ProjStage } from "@/lib/project-stage";

const HATCH_GREEN = "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(58,154,34,0.5) 3px,rgba(58,154,34,0.5) 4px)";
const TERMS_LABEL: Record<string, string> = { net_15: "Net 15", net_30: "Net 30", net_45: "Net 45", net_60: "Net 60", prepaid: "Prepaid", deposit_balance: "Deposit" };

// Where each milestone deep-links on click (navigate mode only).
const STAGE_TARGET: Record<string, (j: any) => string> = {
  quote_sent: j => `/jobs/${j.id}?tab=quote`,
  quote_appr: j => `/jobs/${j.id}?tab=quote`,
  invoice: j => `/jobs/${j.id}?tab=invoice`,
  paid: j => `/jobs/${j.id}?tab=invoice`,
  order: j => `/jobs/${j.id}?tab=po`,
  // Warehouse-tail stages deep-link to the v2 board PRE-FILTERED to this job
  // (its number — sharper than a client/vendor filter, which pulls in siblings).
  // Point at the v2 routes directly so the ?q= survives (/production redirects
  // and would drop it).
  production: j => `/production2?q=${encodeURIComponent(j.job_number || "")}`,
  receiving: j => `/receiving2?q=${encodeURIComponent(j.job_number || "")}`,
  shipping: j => `/shipping2?q=${encodeURIComponent(j.job_number || "")}`,
  fulfillment: j => `/staging2?q=${encodeURIComponent(j.job_number || "")}`,
};

// Stages that live on an external board (not a job tab). On the job detail these
// are the ONLY clickable segments — the quote/invoice segments stay status-only
// (the flat tab-button row owns that nav). See [[opshub-v2-board-ux]].
const WAREHOUSE_TAIL = new Set(["production", "receiving", "shipping", "fulfillment"]);

export function JobStatusBar({ job, stage, items = [], payments = [], navigate = false, tailNav = false, onHoverChange, showLabels = false, onBeforeNavigate }: {
  job: any; stage: ProjStage; items?: any[]; payments?: any[]; navigate?: boolean;
  tailNav?: boolean; // job-detail: make ONLY the warehouse-tail segments clickable (→ their board, filtered to this job)
  onHoverChange?: (hovering: boolean) => void; // parent raises its z-index so the peek isn't clipped
  showLabels?: boolean; // persistent milestone titles above the segments (job detail has the room; the list doesn't)
  onBeforeNavigate?: () => void; // fires before a segment deep-link — the projects board records scan-resume state here
}) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const dead = ROUTE_DEAD[stage.route] || [];
  const bars = PROJ_MILESTONES.filter(m => !dead.includes(m.k)); // only this route's real milestones
  // Complete → every milestone is done (cur past the end fills the whole bar).
  const cur = stage.complete ? bars.length : bars.findIndex(m => m.k === stage.milestone);
  const sig = stage.signal;
  // Amber = started but not complete (Jon 2026-07-20): a current segment with
  // real partial progress fills amber even when the signal is "wait" — e.g.
  // Approved with the quote signed off but proofs still pending. No progress +
  // wait stays hollow.
  const curPartial = stage.milestone === "quote_appr" && !!job.quote_approved;
  const N = bars.length;

  const statusOf = (m: typeof PROJ_MILESTONES[number], i: number): { label: string; note: string; color: string } => {
    if (stage.preQuote) return m.k === "quote_sent" ? { label: "Your move", note: stage.now, color: T.amber } : { label: "Upcoming", note: "", color: T.faint };
    // Invoice + Paid read their own state even beyond the current milestone —
    // a revision can hold the spine at Approved while an invoice/payment exist.
    if (m.k === "paid" && (i <= cur || paidAmt > 0))
      return { label: paidFull ? "Paid" : paidPartial ? "Partially paid" : stage.paidState === "onaccount" ? "On account" : "Due", note: "", color: paidColor };
    if (m.k === "invoice" && invoiced && i !== cur)
      return invoiceStale ? { label: "Needs update", note: "", color: T.amber } : { label: "Done", note: "", color: T.green };
    // Warehouse-tail segments read their own item fraction: full = done (green),
    // partial = in progress (amber) — never green off spine position alone.
    const tfx = tailFrac[m.k];
    if (tfx !== undefined && tfx > 0 && i !== cur) return tfx >= 1 ? { label: "Done", note: "", color: T.green } : { label: "In progress", note: "", color: T.amber };
    if (cur >= 0 && i < cur) return { label: "Done", note: "", color: T.green };
    if (i === cur) {
      const lbl = sig === "late" ? "Late" : sig === "act" ? "Your move" : "Waiting on them";
      const clr = sig === "late" ? T.red : (sig === "act" || curPartial) ? T.amber : T.muted;
      return { label: lbl, note: stage.reason || stage.detail || stage.now, color: clr };
    }
    return { label: "Upcoming", note: "", color: T.faint };
  };

  const tm = (job.type_meta || {}) as any;
  const cs = (job.costing_summary || {}) as any;
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const fmtDT = (s?: string) => s ? `${new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "";
  const pays = (payments || []) as any[];
  const paidAmt = pays.filter(p => p.status === "paid").reduce((a, p) => a + (+p.amount || 0), 0);
  const paidDate = pays.filter(p => p.status === "paid" && p.paid_date).map(p => p.paid_date).sort().pop();
  const invTotal = tm.qb_total_with_tax || cs.grossRev || 0;
  // Per-segment truth for Invoice + Paid (Jon 2026-07-20): these render their
  // OWN state even when the spine holds earlier (e.g. a revision reopens
  // proofs). "Complete" is measured against the job's CURRENT value — when a
  // job is revised upward after invoicing, the old invoice/payment no longer
  // covers it, so both slip back to amber until re-invoiced / topped up.
  const invoiced = !!(tm.qb_invoice_number || (job as any).invoice_sent);
  const paidTarget = Math.max(invTotal || 0, cs.grossRev || 0);
  const paidFull = paidAmt > 0 && paidAmt >= paidTarget - 0.005;
  const paidPartial = paidAmt > 0 && !paidFull;
  const invoiceStale = invoiced && (cs.grossRev || 0) > (invTotal || 0) + 0.005;
  const paidColor = paidFull ? T.green : paidPartial ? T.amber : stage.paidState === "onaccount" ? T.blue : T.amber;
  const paidLabel = paidFull ? "Paid" : paidPartial ? "Partially paid" : (TERMS_LABEL[(job.payment_terms || "") as string] || "Payment") + (stage.paidState === "due" ? " due" : "");
  const posSent = ((tm.po_sent_vendors || []) as any[]).length;
  const its = (items || []) as any[];
  const nItems = its.length;
  const blanksOrdered = nItems > 0 && its.every(it => it.blanks_order_cost != null || it.blanks_order_number);
  // A drop_ship item ships DIRECT from the vendor to the client — it never
  // touches HPD, so it has no received/forwarded stamp. Once it's shipped it's
  // "past" receiving AND shipping (it went direct), so it must count as done in
  // those tails — otherwise a mixed-route job reads as stuck at 5/6 forever.
  const isDropShipDone = (it: any) => it.shipping_route === "drop_ship" && it.pipeline_stage === "shipped";
  const received = its.filter(it => it.received_at_hpd || isDropShipDone(it)).length;
  const forwarded = its.filter(it => it.forwarded_at || isDropShipDone(it)).length;
  const entered = its.filter(it => it.webstore_entered_at).length;
  // ONLY an explicit "shipped" stage counts — never "anything that isn't
  // in_production". Legacy assignment stages (e.g. blanks_ordered) used to
  // leak through the old subtraction and read 6/6 shipped on jobs that never
  // entered production.
  const shipped = its.filter(it => it.pipeline_stage === "shipped").length;
  const tailFrac: Record<string, number> = nItems ? { production: shipped / nItems, receiving: received / nItems, shipping: forwarded / nItems, fulfillment: entered / nItems } : {};

  const peekFor = (k: string): string => {
    switch (k) {
      case "quote_sent": return stage.preQuote ? stage.now : [tm.quote_sent_at && `Sent ${fmtDT(tm.quote_sent_at)}`, cs.grossRev && `quote ${money(cs.grossRev)}`].filter(Boolean).join(" · ") || "Quote + proofs";
      case "quote_appr": {
        const quotePart = job.quote_approved ? (job.quote_approved_at ? `Quote approved ${fmtDT(job.quote_approved_at)}` : "Quote approved") : "Awaiting quote approval";
        const p = stage.proofs;
        return p ? `${quotePart} · ${p.approved}/${p.total} proofs approved` : quotePart;
      }
      case "invoice": return tm.qb_invoice_number ? `Invoice #${tm.qb_invoice_number}${invTotal ? ` · ${money(invTotal)}` : ""}${tm.qb_invoice_created_at ? ` · sent ${fmtDT(tm.qb_invoice_created_at)}` : ""}${invoiceStale ? ` · quote now ${money(cs.grossRev)} — needs update` : ""}` : "Not invoiced yet";
      case "paid": return paidAmt > 0 ? `${money(paidAmt)} / ${money(paidTarget)} paid${paidDate ? ` · ${fmtDT(paidDate)}` : ""}` : (paidTarget ? `${money(paidTarget)} due` : (stage.paidState === "onaccount" ? "On account" : "Unpaid"));
      case "order": return `${posSent} PO${posSent === 1 ? "" : "s"} sent · blanks ${blanksOrdered ? "ordered" : "not ordered"}`;
      case "production": return nItems ? `${shipped}/${nItems} shipped from vendor` : "In production";
      case "receiving": return nItems ? `${received}/${nItems} received at HPD` : "Receiving";
      case "shipping": return nItems ? `${forwarded}/${nItems} forwarded to client` : "Shipping to client";
      case "fulfillment": return nItems ? `${entered}/${nItems} entered in Shopify` : "Staging";
      default: return "";
    }
  };
  const segFill = (i: number) => {
    if (!stage.preQuote && bars[i]?.k === "paid" && (i <= cur || paidAmt > 0)) return paidColor;
    if (!stage.preQuote && bars[i]?.k === "invoice" && invoiced && i !== cur) return invoiceStale ? T.amber : T.green;
    if (!stage.preQuote && cur >= 0 && i < cur) return T.green;
    if (!stage.preQuote && i === cur) return sig === "late" ? T.red : (sig === "wait" && !curPartial) ? T.surface : T.amber;
    return T.surface;
  };

  const bar = (
    <div style={{ flex: 1, minWidth: 0, position: "relative", height: 14 }}>
      {/* clipped fill + ticks — variable length, only this route's milestones */}
      <div style={{ position: "absolute", inset: 0, borderRadius: 7, background: T.surface, overflow: "hidden" }}>
        {bars.map((m, i) => {
          const base = { position: "absolute" as const, left: `${(i / N) * 100}%`, top: 0, bottom: 0, width: `${100 / N}%` };
          const tf = tailFrac[m.k];
          if (!stage.preQuote && tf !== undefined) {
            const reached = i <= cur || tf > 0;
            // Partial tail = amber fill (in progress); green ONLY at 100%.
            return <div key={m.k} style={{ ...base, background: reached ? HATCH_GREEN : "transparent", overflow: "hidden" }}>
              {tf > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${Math.round(tf * 100)}%`, background: tf >= 1 ? T.green : T.amber }} />}
            </div>;
          }
          if (!stage.preQuote && m.k === "paid" && (i <= cur || paidAmt > 0)) return <div key={m.k} style={{ ...base, background: paidColor }} />;
          if (!stage.preQuote && m.k === "invoice" && invoiced && i !== cur) return <div key={m.k} style={{ ...base, background: invoiceStale ? T.amber : T.green }} />;
          if (!stage.preQuote && cur >= 0 && i < cur) return <div key={m.k} style={{ ...base, background: T.green }} />;
          if (!stage.preQuote && i === cur) {
            if (sig === "wait" && !curPartial) return <div key={m.k} style={{ ...base, background: T.surface, boxShadow: `inset 0 0 0 1.5px ${T.faint}` }} />;
            return <div key={m.k} style={{ ...base, background: sig === "late" ? T.red : T.amber }} />;
          }
          return null;
        })}
        {bars.map((m, i) => {
          if (i === 0) return null;
          const prevFilled = !stage.preQuote && ((i - 1) < cur || ((i - 1) === cur && (sig !== "wait" || curPartial)));
          return <div key={"t" + m.k} style={{ position: "absolute", left: `${(i / N) * 100}%`, top: 2, bottom: 2, width: 1, zIndex: 2, background: prevFilled ? "rgba(255,255,255,.85)" : T.faint }} />;
        })}
      </div>
      {/* interaction zones — hover peek + (navigate mode) click deep-link */}
      {bars.map((m, i) => {
        const tf = tailFrac[m.k];
        const hoverable = stage.preQuote ? m.k === "quote_sent"
          : (tf !== undefined ? (i <= cur || tf > 0)
          : (i <= cur || (m.k === "paid" && paidAmt > 0) || (m.k === "invoice" && invoiced)));
        const st = statusOf(m, i);
        const on = hoverable && hover === m.k;
        const tgt = STAGE_TARGET[m.k];
        const clickable = hoverable && (navigate || (tailNav && WAREHOUSE_TAIL.has(m.k)));
        return (
          <div key={"z" + m.k}
            onMouseEnter={hoverable ? () => { setHover(m.k); onHoverChange?.(true); } : undefined} onMouseLeave={hoverable ? () => { setHover(h => (h === m.k ? null : h)); onHoverChange?.(false); } : undefined}
            onClick={clickable ? (e => { e.stopPropagation(); if (tgt) { onBeforeNavigate?.(); router.push(tgt(job)); } }) : undefined}
            style={{ position: "absolute", left: `${(i / N) * 100}%`, width: `${100 / N}%`, top: -7, bottom: -7, zIndex: 4, cursor: clickable ? "pointer" : "default" }}>
            {on && (tf !== undefined
              ? <div className="proj-chip" style={{ position: "absolute", left: 1, right: 1, top: 5, bottom: 5, borderRadius: 4, background: (i <= cur || tf > 0) ? HATCH_GREEN : T.surface, boxShadow: "0 3px 10px rgba(0,0,0,.22)", pointerEvents: "none", overflow: "hidden" }}>
                  {tf > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${Math.round(tf * 100)}%`, background: tf >= 1 ? T.green : T.amber }} />}
                </div>
              : <div className="proj-chip" style={{ position: "absolute", left: 1, right: 1, top: 5, bottom: 5, borderRadius: 4, background: segFill(i), boxShadow: "0 3px 10px rgba(0,0,0,.22)", pointerEvents: "none" }} />)}
            {on && (
              <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", zIndex: 30, width: 186, background: T.card, border: `1px solid ${T.border}`, borderRadius: 9, boxShadow: "0 10px 30px rgba(0,0,0,.16)", padding: "10px 12px", pointerEvents: "none", textAlign: "left" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: st.color }}>{m.k === "paid" ? paidLabel : m.label}</div>
                <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4, lineHeight: 1.35 }}>{peekFor(m.k)}</div>
              </div>
            )}
          </div>
        );
      })}
      {/* ▲ current-stage caption */}
      {stage.complete && (
        <div style={{ position: "absolute", top: "calc(100% + 3px)", right: 0, whiteSpace: "nowrap", fontSize: 9.5, fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", color: T.green }}>✓ Complete</div>
      )}
      {!stage.complete && (stage.preQuote || cur >= 0) && (() => {
        const capText = stage.preQuote ? stage.now : (stage.reason || bars[cur].label);
        const capColor = stage.preQuote ? T.muted : (sig === "late" ? T.red : sig === "act" ? T.amber : T.muted);
        const pos: any = stage.preQuote ? { left: 0 } : (cur === N - 1 ? { right: 0 } : { left: `${((cur + 0.5) / N) * 100}%`, transform: "translateX(-50%)" });
        return <div style={{ position: "absolute", top: "calc(100% + 3px)", whiteSpace: "nowrap", fontSize: 9.5, fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", color: capColor, ...pos }}>{stage.preQuote ? "" : "▲ "}{capText}</div>;
      })()}
    </div>
  );

  if (!showLabels) return bar;
  // Job-detail: persistent milestone titles above the segments, aligned to the
  // same equal-width columns the bar uses.
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", marginBottom: 9 }}>
        {bars.map(m => {
          const tail = tailFrac[m.k] !== undefined;
          return <div key={m.k} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 9, fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", color: tail ? T.blue : T.muted, lineHeight: 1.15, wordBreak: "break-word" }}>{m.label}</div>;
        })}
      </div>
      {bar}
    </div>
  );
}
