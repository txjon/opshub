"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate } from "../_shared/theme";
import { OrderDetailView } from "./[jobId]/page";


type OrderItem = {
  id: string;
  name: string | null;
  garment_type: string | null;
  mockup_color: string | null;
  qty: number;
  drive_link: string | null;
  thumb_id: string | null;
};

type Order = {
  id: string;
  kind?: "project" | "fulfillment";
  job_number: string | null;
  title: string | null;
  phase: string;
  target_ship_date: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  total_qty: number;
  total: number;
  paid_amount: number;
  balance: number;
  payment_status: "paid" | "unpaid" | "partial" | "deposit" | "none";
  paid_at?: string | null;
  qb_invoice_number: string | null;
  qb_payment_link: string | null;
  pricing_visible?: boolean;
  has_invoice: boolean;
  period_label?: string;
};

export default function OrdersPage() {
  const { token } = useClientPortal();
  const search = useSearchParams();
  const filterParam = (search?.get("filter") as "all" | "unpaid" | "paid" | null) || "all";
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [archive, setArchive] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unpaid" | "paid">(filterParam === "unpaid" || filterParam === "paid" ? filterParam : "all");
  // Project orders open a full-page modal using the shared OrderDetailView
  // instead of navigating. Keeps scroll position + filter state intact.
  const [modalJobId, setModalJobId] = useState<string | null>(null);

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

  const filtered = (orders || []).filter(o => {
    if (filter === "unpaid") return o.payment_status === "unpaid" || o.payment_status === "partial";
    if (filter === "paid") return o.payment_status === "paid";
    return true;
  });

  const unpaidTotal = (orders || []).filter(o => o.payment_status === "unpaid" || o.payment_status === "partial").length;
  const paidTotal = (orders || []).filter(o => o.payment_status === "paid").length;

  return (
    <div>
      {/* Filter tabs + archive toggle */}
      <div style={{
        display: "flex", gap: 18, alignItems: "center", marginBottom: 18,
        flexWrap: "wrap", borderBottom: `1px solid ${C.border}`, paddingBottom: 6,
      }}>
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
          All {orders && `· ${orders.length}`}
        </FilterPill>
        <FilterPill active={filter === "unpaid"} onClick={() => setFilter("unpaid")}>
          Unpaid{orders ? ` · ${unpaidTotal}` : ""}
        </FilterPill>
        <FilterPill active={filter === "paid"} onClick={() => setFilter("paid")}>
          Paid{orders ? ` · ${paidTotal}` : ""}
        </FilterPill>
        <div style={{ flex: 1 }} />
        <button onClick={() => setArchive(a => !a)}
          style={{
            padding: "7px 12px", minHeight: 36,
            background: archive ? C.text : "transparent",
            color: archive ? "#fff" : C.muted,
            border: `1px solid ${archive ? C.text : C.border}`,
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            fontFamily: C.font,
          }}>
          {archive ? "Showing all history" : "Show all history"}
        </button>
      </div>

      {loading && !orders ? (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 40, textAlign: "center", color: C.muted,
        }}>
          Loading orders…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 50, textAlign: "center",
          color: C.muted, fontSize: 13,
        }}>
          {orders?.length === 0
            ? "No orders yet. Once HPD starts a job for you, it'll land here."
            : "Nothing matches that filter."}
        </div>
      ) : (
        <div>
          {filtered.map(o => (
            <OrderRow key={o.id} order={o}
              expanded={expanded === o.id}
              onToggle={() => setExpanded(expanded === o.id ? null : o.id)}
              onOpenModal={(id) => setModalJobId(id)}
              token={token}
            />
          ))}
        </div>
      )}

      {/* Full-page modal for per-order detail. Uses the shared
          OrderDetailView so deep links (/orders/[jobId]) and this modal
          render identical content. Close button lives inside the view
          itself (matches the proof modal pattern) so nested modals
          don't end up with two X's fighting for the same corner. */}
      {modalJobId && (
        <div
          onClick={() => setModalJobId(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            overflowY: "auto",
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "relative",
              background: C.bg,
              width: "min(920px, 96vw)",
              minHeight: "100%",
              padding: "28px 28px 60px",
              boxSizing: "border-box",
            }}>
            <OrderDetailView
              token={token}
              jobId={modalJobId}
              onClose={() => setModalJobId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "8px 0", minHeight: 40,
        background: "transparent",
        color: active ? C.text : C.muted,
        border: "none",
        borderBottom: active ? `2px solid ${C.text}` : "2px solid transparent",
        fontSize: 13, fontWeight: active ? 800 : 600,
        cursor: "pointer", fontFamily: C.font,
        marginBottom: -7,
      }}>
      {children}
    </button>
  );
}

function OrderRow({ order, expanded, onToggle, onOpenModal, token }: {
  order: Order; expanded: boolean; onToggle: () => void; onOpenModal: (id: string) => void; token: string;
}) {
  // Project orders open the full detail in a modal (stays on the Orders
  // tab, no navigation round-trip). Fulfillment invoices keep expanding
  // inline — no deep detail surface, just summary + PDF.
  const navigatesToDetail = order.kind !== "fulfillment";
  const handleRowClick = navigatesToDetail
    ? () => onOpenModal(order.id)
    : onToggle;

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12, marginBottom: 10,
      overflow: "hidden",
    }}>
      {/* Row header — clickable to expand. On desktop: 3-col. On mobile:
          title row (with chevron), then pills + total wrap below. */}
      <button onClick={handleRowClick}
        className="order-row-header"
        style={{
          width: "100%", background: "transparent", border: "none",
          padding: "14px 18px", cursor: "pointer", fontFamily: C.font,
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: "14px 18px", alignItems: "center", textAlign: "left",
          minHeight: 64,
        }}>
        <style>{`
          @media (max-width: 640px) {
            .order-row-header {
              grid-template-columns: 1fr auto !important;
              grid-template-rows: auto auto !important;
              row-gap: 10px !important;
            }
            .order-row-header > :nth-child(2) {
              grid-row: 2 !important;
              grid-column: 1 / -1 !important;
              flex-wrap: wrap;
            }
            .order-row-header > :nth-child(3) {
              grid-row: 1 !important;
              grid-column: 2 !important;
            }
          }
        `}</style>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: C.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {order.title || "Untitled"}
            {order.job_number && (
              <span style={{ fontSize: 11, color: C.faint, fontWeight: 500, marginLeft: 8 }}>
                {order.job_number}
              </span>
            )}
          </div>
          <div style={{
            fontSize: 11, color: C.muted, marginTop: 3,
            display: "flex", gap: 10, flexWrap: "wrap",
          }}>
            {order.kind === "fulfillment" ? (
              <>
                <span>{order.total_qty.toLocaleString()} units sold</span>
                {order.qb_invoice_number && <span>· Invoice #{order.qb_invoice_number}</span>}
              </>
            ) : (
              <>
                <span>{order.total_qty} {order.total_qty === 1 ? "pc" : "pcs"}</span>
                {order.qb_invoice_number
                  ? <span>· Invoice #{order.qb_invoice_number}</span>
                  : order.job_number ? <span>· {order.job_number}</span> : null}
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* Status the client cares about: paid or unpaid. Rows without
              an invoice yet (status "none") show nothing — no invoice
              means nothing to pay, so "Unpaid" would be misleading. */}
          {(() => {
            // No status when there's nothing to pay — either the order
            // was never invoiced OR its total is zero (voided / migrated
            // history record). Prevents "Unpaid · $0.00" from showing
            // next to zero-dollar invoices.
            if (order.payment_status === "none") return null;
            if ((order.total || 0) <= 0.01) return null;
            const isPaid = order.payment_status === "paid";
            const isPartial = order.payment_status === "partial";
            const paidStamp = order.paid_at ? fmtDate(order.paid_at) : null;
            const color = isPaid ? C.green : isPartial ? C.amber : C.muted;
            const label = isPaid
              ? (paidStamp ? `Paid · ${paidStamp}` : "Paid")
              : isPartial
              ? "Partial Paid"
              : "Unpaid";
            return (
              <span style={{
                fontSize: 10, fontWeight: 600, color,
                textTransform: "uppercase", letterSpacing: "0.06em",
                whiteSpace: "nowrap",
              }}>
                {label}
              </span>
            );
          })()}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Hide the dollar amount until the client has actually been
              shown a number — quote sent, invoice sent, or a manual
              payment record exists. Server zeros total in that state. */}
          {order.pricing_visible !== false && (order.total || 0) > 0.01 && (
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: C.mono }}>
              ${order.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
          <div style={{ fontSize: 14, color: C.muted, transform: (navigatesToDetail ? false : expanded) ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
            ›
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <OrderDetail order={order} token={token} />
      )}
    </div>
  );
}

function OrderDetail({ order, token }: { order: Order; token: string }) {
  return (
    <div style={{
      borderTop: `1px solid ${C.border}`,
      background: C.surface,
      padding: "16px 18px",
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: 14,
    }}>
      <style>{`
        @media (min-width: 768px) {
          .order-detail-grid { grid-template-columns: 1fr 280px !important; }
        }
      `}</style>
      <div className="order-detail-grid" style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr" }}>
        {/* LEFT — items (projects) or summary + report link (fulfillment) */}
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, color: C.faint,
            textTransform: "uppercase", letterSpacing: "0.08em",
            marginBottom: 10,
          }}>
            {order.kind === "fulfillment" ? "Report" : "Items"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {order.kind === "fulfillment" && (
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "14px 16px",
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                  Fulfillment fee for <strong>{order.period_label}</strong> covering{" "}
                  <strong>{order.total_qty.toLocaleString()} units</strong> shipped through HPD.
                </div>
                <a
                  href={`/api/pdf/shipstation/${order.id}?portal=${token}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    alignSelf: "flex-start",
                    padding: "8px 14px",
                    background: "transparent",
                    color: C.text,
                    border: `1px solid ${C.border}`,
                    borderRadius: 6, fontSize: 12, fontWeight: 600,
                    textDecoration: "none", fontFamily: C.font,
                  }}>
                  Download full report →
                </a>
              </div>
            )}
            {order.kind !== "fulfillment" && order.items.map(it => (
              <div key={it.id} style={{
                display: "grid", gridTemplateColumns: "48px 1fr auto",
                gap: 12, alignItems: "center",
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "10px 12px",
              }}>
                <div style={{
                  width: 48, height: 48,
                  background: "#f4f4f7", borderRadius: 4,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden",
                }}>
                  {it.thumb_id ? (
                    <img src={`/api/files/thumbnail?id=${it.thumb_id}&thumb=1`}
                      alt="" referrerPolicy="no-referrer" loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e: any) => { e.target.style.display = "none"; }} />
                  ) : (
                    <span style={{ fontSize: 9, color: C.faint }}>—</span>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: C.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {it.name || "Item"}
                  </div>
                  <div style={{
                    fontSize: 11, color: C.muted, marginTop: 3,
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    {it.garment_type && <span>{it.garment_type}</span>}
                    {it.mockup_color && (
                      <>
                        {it.garment_type && <span style={{ color: C.faint }}>·</span>}
                        <ColorDot color={it.mockup_color} />
                      </>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.muted, fontFamily: C.mono, whiteSpace: "nowrap" }}>
                  {it.qty} pc{it.qty === 1 ? "" : "s"}
                </div>
              </div>
            ))}
            {order.kind !== "fulfillment" && order.items.length === 0 && (
              <div style={{ fontSize: 12, color: C.faint, fontStyle: "italic", padding: "8px 12px" }}>
                Item list not ready yet.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — invoice + pay. Hidden until pricing is visible to client. */}
        {order.pricing_visible !== false ? (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "14px 16px", height: "fit-content",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Invoice
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            <Line label="Total" value={`$${order.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
            <Line label="Paid" value={`$${order.paid_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 6, marginTop: 2 }}>
              <Line
                label="Balance"
                value={`$${order.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                bold
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {order.qb_payment_link && order.balance > 0.01 && (
              <a href={order.qb_payment_link} target="_blank" rel="noopener noreferrer"
                style={{
                  padding: "10px 12px", background: C.green, color: "#fff",
                  border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700,
                  textAlign: "center", textDecoration: "none",
                  fontFamily: C.font, cursor: "pointer", minHeight: 40,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                Pay online →
              </a>
            )}
            {order.has_invoice && (
              <a
                href={order.kind === "fulfillment"
                  ? `/api/pdf/shipstation/${order.id}?portal=${token}&download=1`
                  : `/api/pdf/invoice/${order.id}?download=1`}
                style={{
                  padding: "9px 12px", background: "transparent", color: C.text,
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  fontSize: 12, fontWeight: 600, textAlign: "center",
                  textDecoration: "none", fontFamily: C.font, cursor: "pointer", minHeight: 40,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                Download invoice
              </a>
            )}
          </div>

          {order.qb_invoice_number && (
            <div style={{ marginTop: 10, fontSize: 10, color: C.faint, fontFamily: C.mono }}>
              Invoice #{order.qb_invoice_number}
            </div>
          )}
        </div>
        ) : null}
      </div>
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: bold ? 700 : 500 }}>
      <span style={{ color: bold ? C.text : C.muted }}>{label}</span>
      <span style={{ color: C.text, fontFamily: C.mono }}>{value}</span>
    </div>
  );
}

// Renders the item's garment color as a swatch + friendly name when the
// stored value is a hex. Falls back to showing the raw string (e.g. "heather
// grey") if it's already a name. Common hex → name mappings cover the
// blanks we order frequently; anything else shows as a colored dot only.
function ColorDot({ color }: { color: string }) {
  const trimmed = (color || "").trim();
  const isHex = /^#?[0-9a-f]{3,8}$/i.test(trimmed);
  const hexNorm = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const name = isHex ? HEX_NAMES[hexNorm.toLowerCase()] : trimmed;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{
        width: 10, height: 10, borderRadius: 99,
        background: isHex ? hexNorm : trimmed,
        border: `1px solid ${C.border}`,
        display: "inline-block",
      }} />
      {name && <span>{name}</span>}
    </span>
  );
}

// Known hex → readable-name map. Extend as we add colors to the catalog.
const HEX_NAMES: Record<string, string> = {
  "#ffffff": "White",
  "#000000": "Black",
  "#d9d9d9": "Ash",
  "#b5b5b5": "Sport Grey",
  "#808080": "Charcoal",
  "#1a1a1a": "Pitch Black",
  "#eeeeee": "Natural",
  "#f5f5dc": "Cream",
  "#8b0000": "Cardinal",
  "#b22222": "Red",
  "#000080": "Navy",
  "#228b22": "Forest",
  "#4682b4": "Royal",
  "#d2b48c": "Sand",
};

function paymentPillFor(status: Order["payment_status"], hasInvoice: boolean): { label: string; color: string; bg: string } {
  if (status === "paid") return { label: "Paid", color: C.green, bg: C.greenBg };
  if (status === "partial") return { label: "Partial Paid", color: C.amber, bg: C.amberBg };
  if (status === "unpaid" && hasInvoice) return { label: "Unpaid", color: C.red, bg: C.redBg };
  return { label: "Pending", color: C.muted, bg: C.surface };
}
