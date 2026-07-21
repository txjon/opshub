"use client";
// Client Hub — Orders landing, shop skin (P2 session 2, Jul 20 2026).
// Dark storefront list of every order: invoice-number identity, client-safe
// payment status, tap → the full OrderExperience in a dark modal. Same data
// contract as the old light list (orders API, unpaid/on-hold/all filters,
// archive toggle, fulfillment rows expand inline) — presentation follows
// components/hub/theme. Default filter is ALL (the old Unpaid default hid
// most of the history and read as missing orders).
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClientPortal } from "../_shared/context";
import { H } from "@/components/hub/theme";
import { fmtDate } from "../_shared/theme";
import { OrderDetailView } from "./[jobId]/OrderDetailView";

type OrderItem = {
  id: string;
  name: string | null;
  qty: number;
  thumb_id: string | null;
};

type Order = {
  id: string;
  kind?: "project" | "fulfillment";
  job_number: string | null;
  title: string | null;
  phase: string;
  created_at: string;
  items: OrderItem[];
  total_qty: number;
  total: number;
  paid_amount: number;
  balance: number;
  payment_status: "paid" | "unpaid" | "partial" | "deposit" | "none";
  paid_at?: string | null;
  invoice_number: string | null;
  payment_link: string | null;
  qb_invoice_number: string | null;
  qb_payment_link: string | null;
  pricing_visible?: boolean;
  has_invoice: boolean;
  period_label?: string;
};

const money = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function OrdersPage() {
  const { token, data: portalData } = useClientPortal();
  const tenantLabel = (portalData?.company?.slug || "hpd").toUpperCase();
  const search = useSearchParams();
  const filterParam = (search?.get("filter") as "all" | "unpaid" | "on_hold" | "pending" | "attention" | null) || "attention";
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [archive, setArchive] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unpaid" | "on_hold" | "pending" | "attention">(["unpaid","on_hold","pending","all"].includes(filterParam) ? filterParam as any : "attention");
  // Project orders open the shared OrderExperience in a dark modal —
  // keeps scroll position + filter state intact.
  const [modalJobId, setModalJobId] = useState<string | null>(null);

  // Deep-link: /orders?open=<jobId> opens that order's experience directly
  // (Home's "awaiting your approval" pill uses this for single orders).
  const openParam = search?.get("open");
  useEffect(() => { if (openParam) setModalJobId(openParam); }, [openParam]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/client/${token}/orders${archive ? "?archive=1" : ""}`);
      const body = await res.json();
      if (res.ok) setOrders(body.orders || []);
    } catch {}
    setLoading(false);
  }

  const isUnpaid = (o: Order) => o.payment_status === "unpaid" || o.payment_status === "partial";
  // Stale pending proofs on finished orders are moot — only live orders count.
  const isDone = (o: Order) => ["complete", "cancelled"].includes(o.phase);
  // Client action exists only when the QUOTE still needs them or live
  // proofs await them. Phase 'pending' with quote approved + no pending
  // proofs = waiting on US (proofs not sent yet) — never "approval needed"
  // (the #4359 case: client pre-paid, nothing to approve yet).
  const isPending = (o: Order) => !isDone(o) && ((o.phase === "pending" && !(o as any).quote_approved) || ((o as any).proofs_pending || 0) > 0);
  const attentionCount = (orders || []).filter(o => isPending(o) || isUnpaid(o)).length;
  // "Needs you" is the default landing — approvals first, payments second.
  // With nothing needing them, fall through to All so the page isn't empty.
  const effFilter = filter === "attention" && orders !== null && attentionCount === 0 ? "all" : filter;
  const filtered = (orders || []).filter(o => {
    if (effFilter === "attention") return isPending(o) || isUnpaid(o);
    if (effFilter === "pending") return isPending(o);
    if (effFilter === "unpaid") return isUnpaid(o);
    if (effFilter === "on_hold") return o.phase === "on_hold";
    return true;
  }).sort((a, b) => effFilter === "attention" ? Number(isPending(b)) - Number(isPending(a)) : 0);

  const unpaidTotal = (orders || []).filter(o => o.payment_status === "unpaid" || o.payment_status === "partial").length;
  const onHoldTotal = (orders || []).filter(o => o.phase === "on_hold").length;

  const pendingTotal = (orders || []).filter(o => o.phase === "pending").length;
  const chips: { key: "all" | "unpaid" | "on_hold" | "pending" | "attention"; label: string; count: number | null }[] = [
    ...(attentionCount > 0 ? [{ key: "attention" as const, label: "Needs you", count: attentionCount }] : []),
    { key: "all", label: "All", count: orders ? (orders || []).length : null },
    { key: "unpaid", label: "Unpaid", count: orders ? unpaidTotal : null },
    { key: "on_hold", label: "On hold", count: orders ? onHoldTotal : null },
  ];

  return (
    <div style={{
      // Full-bleed dark canvas escaping the light shell's centered main.
      margin: "calc(clamp(16px, 4vw, 32px) * -1) calc(clamp(12px, 3vw, 24px) * -1) -60px",
      background: H.ink, color: H.text, fontFamily: H.font, minHeight: "70vh",
    }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .ox-chip{flex-shrink:0;border-radius:999px;border:1px solid ${H.line};background:transparent;color:${H.dim};font-family:${H.mono};font-size:11px;font-weight:700;padding:8px 15px;cursor:pointer;white-space:nowrap}
        .ox-chip.on{background:#fff;color:${H.ink};border-color:#fff}
        .ox-row{transition:border-color .15s ease,transform .15s ease}
        .ox-row:hover{border-color:rgba(255,255,255,.3);transform:translateY(-2px)}
        @media(prefers-reduced-motion:reduce){.ox-row,.ox-row:hover{transition:none;transform:none}}
        .ox-head{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px 18px;align-items:center}
        @media(max-width:640px){
          .ox-head{grid-template-columns:minmax(0,1fr) auto}
          .ox-head .ox-money{grid-column:1;grid-row:2;justify-self:start}
        }
      ` }} />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(28px,5vw,56px) clamp(14px,3vw,24px) 100px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint, textAlign: "center" }}>Orders</div>
        <h1 style={{ fontSize: "clamp(30px,7vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 22px", textAlign: "center" }}>
          Your orders.
        </h1>

        {/* Filters + history toggle */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
          {chips.map(c => (
            <button key={c.key} className={`ox-chip${effFilter === c.key ? " on" : ""}`} onClick={() => setFilter(c.key)}>
              {c.label}{c.count != null ? ` · ${c.count}` : ""}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className={`ox-chip${archive ? " on" : ""}`} onClick={() => setArchive(a => !a)}>
            {archive ? "Showing all history" : "Show all history"}
          </button>
        </div>

        {loading && !orders ? (
          <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>Loading orders…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: H.dim, fontSize: 13, padding: "40px 0" }}>
            {orders?.length === 0
              ? `No orders yet. Once ${tenantLabel} starts an order for you, it lands here.`
              : "Nothing matches that filter."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((o, i) => (<div key={o.id}>
              {effFilter === "attention" && isPending(o) && (i === 0) && (
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.amber, margin: "2px 0 8px" }}>Needs approval</div>
              )}
              {effFilter === "attention" && !isPending(o) && (i === 0 || isPending(filtered[i - 1])) && (
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.dim, margin: i === 0 ? "2px 0 8px" : "16px 0 8px" }}>Payment due</div>
              )}
              <OrderRow order={o}
                expanded={expanded === o.id}
                onToggle={() => setExpanded(expanded === o.id ? null : o.id)}
                onOpenModal={(id) => setModalJobId(id)}
                token={token}
              />
            </div>))}
          </div>
        )}
      </div>

      {/* Full-window dark modal — the shared OrderExperience */}
      {modalJobId && (
        <OrderFullScreenModal
          token={token}
          jobId={modalJobId}
          onClose={() => setModalJobId(null)}
        />
      )}
    </div>
  );
}

function OrderFullScreenModal({ token, jobId, onClose }: {
  token: string; jobId: string; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: H.ink,
      display: "flex", flexDirection: "column",
      fontFamily: H.font, color: H.text,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", borderBottom: `1px solid ${H.line}`, flexShrink: 0,
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: H.faint, textTransform: "uppercase", letterSpacing: "0.14em" }}>
          Order
        </div>
        <button onClick={onClose}
          style={{
            background: "none", border: `1px solid ${H.line}`, borderRadius: 999,
            color: H.dim, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "7px 16px", cursor: "pointer", fontFamily: H.font,
          }}
          title="Close (Esc)">Close ×</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <OrderDetailView token={token} jobId={jobId} onClose={onClose} suppressOwnChrome />
      </div>
    </div>
  );
}

function OrderRow({ order, expanded, onToggle, onOpenModal, token }: {
  order: Order; expanded: boolean; onToggle: () => void; onOpenModal: (id: string) => void; token: string;
}) {
  // Project orders open the full experience; fulfillment invoices have no
  // deep surface, they expand inline (summary + report + pay).
  const isFulfillment = order.kind === "fulfillment";
  const handleRowClick = isFulfillment ? onToggle : () => onOpenModal(order.id);
  const ref = order.invoice_number || order.qb_invoice_number;
  // What exactly needs the client — the row says it, not just the filter.
  const rowDone = ["complete", "cancelled"].includes(order.phase);
  const proofsN = (order as any).proofs_pending || 0;
  const needBit = rowDone ? null
    : proofsN > 0 ? `${proofsN} proof${proofsN === 1 ? "" : "s"} to approve`
    : order.phase === "pending" && !(order as any).quote_approved ? "approval needed"
    : null;
  // Quote approved, nothing pending, still pre-production = our move.
  const usBit = !rowDone && !needBit && order.phase === "pending" ? "proofs on the way" : null;

  const paidBit = (() => {
    if (order.payment_status === "none") return null;
    const isPaid = order.payment_status === "paid";
    const isPartial = order.payment_status === "partial";
    const stamp = order.paid_at ? fmtDate(order.paid_at) : null;
    const color = isPaid ? H.green : isPartial ? H.amber : H.dim;
    const label = isPaid ? (stamp ? `Paid · ${stamp}` : "Paid") : isPartial ? "Partial paid" : "Unpaid";
    return <span style={{ fontSize: 10, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{label}</span>;
  })();

  return (
    <div className="ox-row" style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 14, overflow: "hidden" }}>
      <button onClick={handleRowClick} className="ox-head"
        style={{
          width: "100%", background: "transparent", border: "none",
          padding: "16px 18px", cursor: "pointer", fontFamily: H.font, color: H.text, textAlign: "left",
        }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.01em", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ref ? `Invoice #${ref}` : (order.job_number || "Order")}
          </div>
          <div style={{ fontSize: 11, color: H.dim, fontFamily: H.mono, marginTop: 4 }}>
            {isFulfillment
              ? `${order.total_qty.toLocaleString()} units sold${order.period_label ? ` · ${order.period_label}` : ""}`
              : `${order.total_qty.toLocaleString()} ${order.total_qty === 1 ? "pc" : "pcs"}`}
            {needBit && <span style={{ color: H.amber, fontWeight: 800 }}> · {needBit}</span>}
            {usBit && <span style={{ color: H.dim, fontWeight: 700 }}> · {usBit}</span>}
            {!rowDone && !isFulfillment && (order.payment_status === "unpaid" || order.payment_status === "partial") && order.pricing_visible !== false && order.balance > 0.01 && (
              <span style={{ color: H.dim, fontWeight: 700 }}> · {money(order.balance)} due</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{paidBit}</div>

        <div className="ox-money" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {order.pricing_visible !== false && (
            <span style={{ fontSize: 14, fontWeight: 800, fontFamily: H.mono }}>{money(order.total)}</span>
          )}
          <span style={{ fontSize: 15, color: H.faint, transform: isFulfillment && expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
        </div>
      </button>

      {/* Fulfillment inline detail — report + invoice/pay */}
      {isFulfillment && expanded && (
        <div style={{ borderTop: `1px solid ${H.line}`, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: H.dim, lineHeight: 1.6, maxWidth: "60ch" }}>
            {(order as any).postage_mode === "bulk" && (order as any).report_type === "postage" ? (
              <>Postage reimbursement for <b style={{ color: H.text }}>{order.period_label}</b>: {((order as any).bulk_count || 0).toLocaleString()} postage purchase{((order as any).bulk_count || 0) === 1 ? "" : "s"} billed at cost.</>
            ) : (
              <>Fulfillment fee for <b style={{ color: H.text }}>{order.period_label}</b> covering <b style={{ color: H.text }}>{order.total_qty.toLocaleString()} units</b> shipped.</>
            )}
          </div>
          {order.pricing_visible !== false && (
            <div style={{ display: "flex", gap: 18, fontFamily: H.mono, fontSize: 12.5, flexWrap: "wrap" }}>
              <span style={{ color: H.dim }}>Total <b style={{ color: H.text }}>{money(order.total)}</b></span>
              <span style={{ color: H.dim }}>Paid <b style={{ color: H.text }}>{money(order.paid_amount)}</b></span>
              <span style={{ color: H.dim }}>Balance <b style={{ color: order.balance > 0.01 ? H.amber : H.text }}>{money(order.balance)}</b></span>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(order.payment_link || order.qb_payment_link) && order.balance > 0.01 && (
              <a href={(order.payment_link || order.qb_payment_link) as string} target="_blank" rel="noopener noreferrer"
                style={{ background: "#fff", color: H.ink, borderRadius: 999, padding: "11px 22px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none", fontFamily: H.font }}>
                Pay now · {money(order.balance)}
              </a>
            )}
            <a href={`/api/pdf/shipstation/${order.id}?portal=${token}&download=1`}
              style={{ background: "transparent", color: H.text, border: `1px solid rgba(255,255,255,0.35)`, borderRadius: 999, padding: "11px 20px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none", fontFamily: H.font }}>
              Download report
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
