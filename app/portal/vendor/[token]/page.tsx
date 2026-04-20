"use client";
import { useState, useEffect } from "react";
import { sortSizes } from "@/lib/theme";

// ── Document-style theme — matches invoice/PO PDF aesthetic ──
const C = {
  bg: "#f8f8f9", card: "#ffffff", surface: "#f3f3f5", border: "#e0e0e4",
  text: "#1a1a1a", muted: "#6b6b78", faint: "#a0a0ad",
  accent: "#1a1a1a", accentBg: "#f0f0f2",
  green: "#1a8c5c", greenBg: "#edf7f2", greenBorder: "#b4dfc9",
  amber: "#b45309", amberBg: "#fef9ee", amberBorder: "#f5dfa8",
  red: "#c43030", redBg: "#fdf2f2", redBorder: "#f0c0c0",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: "'SF Mono', 'IBM Plex Mono', Menlo, monospace",
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtDateLong = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const daysUntil = (iso: string) => {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: C.red, urgent: true };
  if (diff <= 3) return { text: `${diff}d`, color: C.amber, urgent: true };
  if (diff <= 7) return { text: `${diff}d`, color: C.amber, urgent: false };
  return { text: `${diff}d`, color: C.green, urgent: false };
};

type DecoLine = { label: string; qty: number; rate: number; total: number };
type Order = {
  jobId: string; jobNumber: string; jobTitle: string; clientName: string;
  phase: string; shipDate: string | null; shippingRoute: string;
  poSent: boolean; poSentDate: string | null; shipTo: any; shipMethod: string | null;
  shippingAccount: string; grandTotal: number; totalUnits: number;
  items: OrderItem[];
};
type OrderItem = {
  id: string; name: string; letter: string; garmentType: string; blankVendor: string;
  blankSku: string; pipelineStage: string; driveLink: string | null;
  incomingGoods: string | null; productionNotes: string | null;
  packingNotes: string | null; shipTracking: string | null;
  shipQtys: Record<string, number> | null; sizes: string[]; qtys: Record<string, number>;
  totalQty: number; decoLines: DecoLine[]; itemTotal: number;
  mockupThumb: string | null; blanksOrdered: boolean;
};

const STAGE_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: "PO Sent", bg: C.accentBg, color: C.text },
  in_production: { label: "In Production", bg: C.amberBg, color: C.amber },
  shipped: { label: "Shipped", bg: C.greenBg, color: C.green },
  complete: { label: "Complete", bg: C.greenBg, color: C.green },
};

export default function VendorPortalPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<{ decorator: { name: string; shortCode: string }; orders: Order[]; completed: Order[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, { tracking: string; carrier: string }>>({});
  const [shipQtyInputs, setShipQtyInputs] = useState<Record<string, Record<string, number>>>({});
  const [packingSlipFiles, setPackingSlipFiles] = useState<Record<string, File | null>>({});
  const [issueInputs, setIssueInputs] = useState<Record<string, string>>({});
  const [showIssue, setShowIssue] = useState<string | null>(null);
  const [showTracking, setShowTracking] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ itemId: string; action: string; label: string } | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"active" | "completed">("active");
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [completedSearch, setCompletedSearch] = useState("");
  const [completedLoading, setCompletedLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { loadData(); }, [params.token]);

  // Auto-select first order on load
  useEffect(() => {
    if (data?.orders?.length && !selectedOrderId) {
      setSelectedOrderId(data.orders[0].jobId);
    }
  }, [data?.orders?.length]);

  async function loadData() {
    try {
      const res = await fetch(`/api/portal/vendor/${params.token}`);
      if (!res.ok) { setError("This link is no longer valid."); return; }
      const d = await res.json();
      setData(d);
      setCompletedOrders(d.completed || []);
      setCompletedTotal(d.completedTotal || 0);
      setCompletedOffset(0);
    } catch { setError("Unable to load."); }
    finally { setLoading(false); }
  }

  async function loadCompleted(offset: number, search: string, append: boolean) {
    setCompletedLoading(true);
    try {
      const qs = new URLSearchParams({ completed_offset: String(offset), completed_limit: "10" });
      if (search) qs.set("completed_search", search);
      const res = await fetch(`/api/portal/vendor/${params.token}?${qs}`);
      if (res.ok) {
        const d = await res.json();
        setCompletedOrders(append ? (prev: any[]) => [...prev, ...(d.completed || [])] : d.completed || []);
        setCompletedTotal(d.completedTotal || 0);
        setCompletedOffset(offset);
      }
    } catch {}
    setCompletedLoading(false);
  }

  async function doAction(action: string, payload: Record<string, any>) {
    const key = action + payload.itemId;
    setActionLoading(key);
    try {
      const res = await fetch(`/api/portal/vendor/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) {
        await loadData();
        setShowTracking(null);
        setShowIssue(null);
        setConfirmAction(null);
      }
    } catch {}
    setActionLoading(null);
  }

  // Combined Mark as Shipped — per-size qtys + optional packing slip upload
  async function markShipped(item: OrderItem, orderJobId: string) {
    const t = trackingInputs[item.id];
    if (!t?.tracking?.trim()) return;
    const key = "enter_tracking" + item.id;
    setActionLoading(key);
    try {
      // Upload packing slip first (if attached) so we have the Drive link logged
      const slip = packingSlipFiles[item.id];
      if (slip) {
        const fd = new FormData();
        fd.append("itemId", item.id);
        fd.append("file", slip);
        await fetch(`/api/portal/vendor/${params.token}/packing-slip`, { method: "POST", body: fd }).catch(() => {});
      }
      // Fill in ordered qtys for sizes the user didn't touch, so the saved
      // ship_qtys object has a value for every size (matches UI defaults).
      const ordered = item.qtys || {};
      const inputs = shipQtyInputs[item.id] || {};
      const completeShipQtys = { ...ordered, ...inputs };
      // Then mark shipped with tracking + complete per-size qtys
      await fetch(`/api/portal/vendor/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enter_tracking",
          itemId: item.id,
          jobId: orderJobId,
          tracking: t.tracking.trim(),
          carrier: t.carrier || "",
          shipQtys: Object.keys(completeShipQtys).length > 0 ? completeShipQtys : null,
        }),
      });
      await loadData();
      setShowTracking(null);
      setPackingSlipFiles(prev => ({ ...prev, [item.id]: null }));
    } catch {}
    setActionLoading(null);
  }

  // ── Loading / Error ──
  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.muted, fontFamily: C.font }}>Loading...</div>
    </div>
  );

  if (error || !data) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 48, opacity: 0.3 }}>🔒</div>
      <div style={{ color: C.text, fontFamily: C.font, fontSize: 16, fontWeight: 600 }}>{error || "Not found"}</div>
    </div>
  );

  const { decorator, orders, completed } = data;
  const totalItems = orders.reduce((s, o) => s + o.items.length, 0);
  const needsAction = orders.reduce((s, o) => s + o.items.filter(i => i.pipelineStage === "pending").length, 0);
  const inProd = orders.reduce((s, o) => s + o.items.filter(i => i.pipelineStage === "in_production").length, 0);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      {/* ── Top Bar ── */}
      <div style={{
        background: "#fff", padding: isMobile ? "16px 20px" : "14px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid #e0e0e4",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="140" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227.14 28.53"><g><path fill="#1a1a1a" d="M15.48,14.1v8.5c0,.13-.11.24-.24.24h-4.51c-.13,0-.24-.11-.24-.24v-8.27c0-.56-.03-1.2-.27-1.72-.11-.22-.25-.4-.42-.54-.28-.22-.65-.33-1.12-.33-.87,0-1.54.3-1.76.78-.24.52-.24,1.24-.24,1.81v8.27c0,.13-.11.24-.24.24H1.93c-.13,0-.24-.11-.24-.24V3.21c0-.13.11-.24.24-.24h4.22c.13,0,.24.11.24.24v5.17c0,.1.11.15.19.1,3.4-2.34,6.72.26,6.75.29.12.09.24.2.34.3h0c1.54,1.55,1.8,2.81,1.8,5.03Z"/><path fill="#1a1a1a" d="M31.55,15.4c0,4.36-3.6,7.91-8.02,7.91s-8.02-3.55-8.02-7.91,3.6-7.91,8.02-7.91,8.02,3.55,8.02,7.91ZM27.02,15.4c0-1.9-1.57-3.45-3.5-3.45s-3.5,1.55-3.5,3.45,1.57,3.45,3.5,3.45,3.5-1.55,3.5-3.45Z"/><path fill="#1a1a1a" d="M45.34,7.97v14.63c0,.13-.11.24-.24.24h-4.22c-.13,0-.24-.11-.24-.24v-.41c0-.1-.11-.15-.19-.1-1.06.73-2.1.98-3.04.98-2.1,0-3.68-1.24-3.71-1.26-.12-.09-.24-.2-.34-.3h0c-1.54-1.55-1.8-2.81-1.8-5.03V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24v8.27c0,.56.03,1.2.27,1.72.11.22.25.4.42.54.28.22.65.33,1.12.33.87,0,1.54-.3,1.76-.78.24-.52.24-1.24.24-1.81V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24Z"/><path fill="#1a1a1a" d="M57.67,18.33c-.04.53-.17,1.09-.41,1.67-.9,1.93-2.99,3.07-5.59,3.07-.36,0-.73-.02-1.1-.07-1.17-.14-2.19-.45-3.04-.92-.87-.59-1.54-1.42-1.99-2.46-.06-.14.02-.3.17-.33l4.14-.89c.1-.02.2.02.25.1.29.43.78.64,1.05.68.63.08.96-.09,1.13-.25.17-.16.24-.37.21-.6-.07-.52-.38-.77-1.98-1.53h-.02c-.32-.16-.72-.35-1.16-.57-.31-.13-.6-.28-.88-.42h-.02s-.08-.06-.12-.08c-1.44-.82-2.28-1.83-2.49-2.98-.31-1.65.75-3.05.97-3.31.32-.36.69-.68,1.11-.95,1.26-.8,2.88-1.13,4.56-.94,1.01.12,1.93.39,2.73.81.38.2.73.43,1.05.7.22.19.89.86,1.1,1.89.03.13-.06.26-.19.28l-4.07.82c-.12.02-.23-.04-.27-.15-.11-.28-.37-.57-.9-.63-.36-.04-.68.06-.89.29-.16.17-.22.39-.17.56.08.27.36.7,1.88,1.32.3.12.58.23.86.34.35.13.7.26,1.02.4h0c.97.45,3.21,1.76,3.07,4.15Z"/><path fill="#1a1a1a" d="M73.45,15.4c0,.44-.05.95-.13,1.4-.02.12-.12.2-.24.2h-10.58c-.19,0-.3.2-.21.37.65,1.1,1.81,1.79,3.1,1.79,1.09,0,2.11-.48,2.84-1.41.06-.07.15-.11.23-.09l4.05.73c.16.03.24.2.18.34-.09.19-.21.43-.27.54h0c-.06.1-.13.21-.2.32-.09.14-.18.27-.27.38l-.05.07c-.06.07-.11.13-.17.2l-.05.06c-.09.1-.18.2-.28.3l-.05.06c-.06.06-.13.13-.19.19l-.02.02c-.07.07-.14.13-.22.2l-.08.07c-.11.1-.22.18-.33.26l-.09.07c-.12.09-.25.18-.38.26l-.04.02c-.15.1-.3.19-.45.27l-.04.02s-.07.04-.11.06h-.03c-.07.05-.13.08-.2.11l-.04.02c-.14.07-.28.13-.41.18h-.03l-.25.11-.1.04-.3.1h-.02l-.35.11-.09.02c-.23.06-.46.1-.69.14h-.09c-.24.05-.48.07-.72.09h-.09l-.37.01-.37,0c-.03,0-.06,0-.08,0h-.03l-.27-.02h-.03s-.05,0-.08,0c-.13-.01-.25-.03-.35-.04h0l-.1-.02-.45-.08-.16-.03-.4-.09h-.04s-.05-.02-.08-.03c-.13-.03-.24-.06-.34-.1l-.34-.11c-.03,0-.05-.02-.08-.03h-.02l-.24-.1h-.02s-.05-.03-.07-.04l-.32-.14h-.01l-.3-.16c-.02-.01-.05-.03-.07-.04h-.02l-.22-.14-.09-.05-.29-.18c-.96-.64-1.78-1.49-2.38-2.46l-.15-.25-.02-.04-.13-.24-.02-.05s-.03-.05-.04-.07c-.15-.31-.29-.64-.4-.98l-.15-.5-.09-.38c-.08-.39-.13-.79-.15-1.19l-.01-.41,0-.41c.04-.7.17-1.4.39-2.07l.23-.6.14-.31c.01-.02.02-.05.04-.07l.03-.06s.02-.05.04-.07l.04-.07.07-.13c.06-.1.11-.2.17-.3.6-.97,1.42-1.82,2.38-2.46l.29-.18.09-.05.22-.13h.02s.05-.04.07-.05l.31-.16.32-.14c.02-.01.05-.02.07-.03h.02l.24-.1h.02s.05-.03.08-.04l.33-.11.34-.1c.02,0,.05-.01.08-.02h.03l.26-.07h.06l.38-.08h.02l.35-.04c.03,0,.05,0,.08,0h.03l.27-.02h.02s.06,0,.09,0l.37,0,.37,0h.09l.72.08h.1l.68.15.1.03.34.1h.02l.3.11.09.03.25.1.04.02.41.18.04.02.19.1h.02l.49.29h.02l.4.28.02.02s.05.04.08.06l.33.26.06.05.25.22.02.02.19.19.05.05.28.3.04.05.16.19.05.06.18.23h0l.14.21.09.13.11.18.15.25h0c.3.52.54,1.08.7,1.64.22.73.33,1.48.33,2.23ZM68.72,13.4c-.19-1.11-1.48-1.98-3.11-1.98-1.49,0-2.9.86-3.11,1.98-.03.15.09.29.24.29h5.75c.15,0,.26-.14.24-.28Z"/></g><g><path fill="#1a1a1a" d="M96.76,14.82c0,4.68-3.86,8.48-8.6,8.48-1.5,0-2.97-.39-4.27-1.12-.09-.05-.19.01-.19.11v5.59c0,.14-.12.26-.26.26h-4.52c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.49c0,.1.11.16.19.11,1.3-.73,2.76-1.12,4.27-1.12,4.74,0,8.6,3.8,8.6,8.48ZM91.33,14.82c0-2.14-1.77-3.89-3.94-3.89s-3.68,1.74-3.68,3.89,1.51,3.89,3.68,3.89,3.94-1.74,3.94-3.89Z"/><path fill="#1a1a1a" d="M114.9,6.85v15.68c0,.14-.12.26-.26.26h-4.53c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.19-.11-1.3.73-2.76,1.12-4.27,1.12-4.74,0-8.6-3.8-8.6-8.48s3.86-8.48,8.6-8.48c1.5,0,2.97.39,4.27,1.12.09.05.19-.01.19-.11v-.49c0-.14.12-.26.26-.26h4.53c.14,0,.26.12.26.26ZM109.86,14.82c0-2.14-1.51-3.89-3.68-3.89s-3.94,1.74-3.94,3.89,1.77,3.89,3.94,3.89,3.68-1.74,3.68-3.89Z"/><path fill="#1a1a1a" d="M124.28,6.87l-.15,3.79c0,.15-.13.26-.28.25-.44-.04-1.33-.1-1.85.03-.58.14-.92.59-1.02.81-.26.56-.26,1.06-.26,1.68v9.11c0,.14-.12.26-.26.26h-4.83c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.45c0,.1.11.16.2.11,1.07-.67,2.34-.81,3.41-.82.15,0,.27.12.26.27Z"/><path fill="#1a1a1a" d="M134.26,18.88l-.58,3.83c-.02.12-.12.21-.24.22-.56.03-2.04.12-2.49.12-.04,0-.07,0-.09,0-2.75-.14-4.2-1.56-4.2-4.08v-7.77c0-.14-.12-.26-.26-.26h-1.68c-.14,0-.26-.12-.26-.26v-3.83c0-.14.12-.26.26-.26h1.68c.14,0,.26-.12.26-.26V1.88c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v4.44c0,.14.12.26.26.26h1.68c.14,0,.26.12.26.26v3.83c0,.14-.12.26-.26.26h-1.68c-.14,0-.26.11-.26.26,0,1.34,0,5.32,0,5.36v.11c-.02.49-.04,1.17.35,1.57.23.24.59.36,1.07.36h.88c.16,0,.28.14.26.3Z"/><path fill="#1a1a1a" d="M150.4,6.95l-5.1,14.17-2.37,6.74c-.04.1-.13.17-.24.17h-5.03c-.18,0-.3-.17-.25-.34l1.97-5.84c.02-.06.02-.12,0-.17l-5.39-14.72c-.06-.17.06-.35.24-.35h4.51c.11,0,.21.07.24.17l2.95,7.98c.08.23.41.22.49,0l2.72-7.97c.04-.1.13-.18.25-.18h4.77c.18,0,.3.18.24.35Z"/><path fill="#1a1a1a" d="M171.26,1.54v21.08c0,.15-.12.26-.26.26h-4.59c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.2-.11-1.32.74-2.8,1.14-4.33,1.14-4.81,0-8.72-3.86-8.72-8.6s3.91-8.6,8.72-8.6c1.53,0,3.01.39,4.33,1.13.09.05.2-.01.2-.11V1.54c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26ZM166.14,14.79c0-2.18-1.53-3.95-3.74-3.95s-4,1.77-4,3.95,1.79,3.95,4,3.95,3.74-1.77,3.74-3.95Z"/><path fill="#1a1a1a" d="M176.51,6.46h-4.59c-.15,0-.26.12-.26.26v15.9c0,.14.12.26.26.26h4.59c.15,0,.26-.12.26-.26V6.72c0-.15-.12-.26-.26-.26ZM176.71,1.38s0-.02-.02-.02c-1.55-.11-5.01,2.17-4.97,3.72,0,0,.01.01.02.02.04.04.11.07.17.07h4.59c.15,0,.26-.12.26-.26V1.54c0-.06-.02-.12-.06-.17Z"/><path fill="#1a1a1a" d="M189.79,17.99c-.04.57-.19,1.19-.44,1.82-.98,2.09-3.25,3.34-6.08,3.34-.39,0-.79-.02-1.19-.07-1.27-.15-2.38-.49-3.3-1.01-.95-.64-1.67-1.54-2.16-2.67-.07-.15.02-.33.19-.36l4.5-.97c.11-.02.21.02.27.11.32.47.85.7,1.14.73.69.08,1.05-.1,1.22-.27.18-.17.26-.4.23-.66-.07-.57-.41-.83-2.15-1.66h-.02c-.35-.18-.78-.38-1.26-.62-.33-.14-.66-.3-.96-.46l-.03-.02s-.09-.05-.13-.08c-1.56-.9-2.47-1.99-2.71-3.24-.34-1.79.82-3.31,1.05-3.6.35-.39.75-.74,1.21-1.03,1.37-.87,3.13-1.23,4.96-1.02,1.1.13,2.1.43,2.96.88.41.22.8.47,1.14.76.24.21.97.94,1.2,2.05.03.14-.07.28-.21.31l-4.43.9c-.13.02-.25-.05-.29-.16-.12-.31-.4-.62-.98-.69-.39-.05-.74.07-.96.32-.17.19-.24.42-.19.61.08.29.39.76,2.04,1.44.33.13.63.24.93.37.38.14.76.29,1.11.44h0c1.05.49,3.48,1.92,3.34,4.51Z"/><path fill="#1a1a1a" d="M199.29,18.92l-.59,3.89c-.02.12-.12.22-.24.22-.56.03-2.07.12-2.53.12-.04,0-.07,0-.09,0-2.79-.15-4.26-1.58-4.26-4.14v-7.89c0-.14-.12-.26-.26-.26h-1.71c-.14,0-.26-.12-.26-.26v-3.89c0-.14.12-.26.26-.26h1.71c.14,0,.26-.12.26-.26V1.67c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26v4.51c0,.14.12.26.26.26h1.71c.14,0,.26.12.26.26v3.89c0,.14-.12.26-.26.26h-1.71c-.14,0-.26.12-.26.26,0,1.36,0,5.39,0,5.44v.11c-.02.5-.04,1.18.36,1.59.23.24.6.36,1.09.36h.89c.16,0,.28.14.26.3Z"/><path fill="#1a1a1a" d="M208.56,6.73l-.16,3.84c0,.15-.14.26-.29.25-.45-.04-1.35-.1-1.88.03-.59.14-.93.6-1.03.82-.27.57-.27,1.07-.27,1.71v9.25c0,.14-.12.26-.26.26h-4.9c-.15,0-.26-.12-.26-.26V6.72c0-.14.12-.26.26-.26h4.59c.15,0,.26.12.26.26v.46c0,.1.11.17.2.11,1.09-.68,2.38-.82,3.46-.83.15,0,.27.12.27.27Z"/><path fill="#1a1a1a" d="M225.19,14.8c0,4.74-3.91,8.6-8.72,8.6s-8.72-3.86-8.72-8.6,3.91-8.6,8.72-8.6,8.72,3.86,8.72,8.6ZM220.27,14.8c0-2.07-1.71-3.75-3.8-3.75s-3.8,1.68-3.8,3.75,1.71,3.75,3.8,3.75,3.8-1.68,3.8-3.75Z"/></g></svg>
        </div>
        <div style={{ color: C.muted, fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>Vendor Portal</div>
      </div>

      {/* ── Sidebar + Content Layout ── */}
      <div style={{ display: "flex", height: "calc(100vh - 49px)" }}>
        {/* Left sidebar */}
        <div style={{ width: isMobile ? "100%" : 280, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.card, overflowY: "auto" }}>
          <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{decorator.name}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {totalItems} item{totalItems !== 1 ? "s" : ""} · {orders.length} order{orders.length !== 1 ? "s" : ""}
              {needsAction > 0 && <span style={{ color: C.amber, marginLeft: 6 }}>{needsAction} pending</span>}
            </div>
          </div>
          {/* Active / Completed tabs */}
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
            {(["active", "completed"] as const).map(t => (
              <button key={t} onClick={() => { setSidebarTab(t); if (t === "completed" && completedOrders.length === 0) loadCompleted(0, "", false); }}
                style={{ flex: 1, padding: "10px 0", fontSize: 11, fontWeight: 700, cursor: "pointer", border: "none",
                  background: sidebarTab === t ? C.bg : C.card, color: sidebarTab === t ? C.text : C.faint,
                  borderBottom: sidebarTab === t ? `2px solid ${C.text}` : "2px solid transparent",
                  textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {t === "active" ? `Active (${orders.length})` : `Completed`}
              </button>
            ))}
          </div>

          {/* Active orders list */}
          {sidebarTab === "active" && orders.map(order => {
            const selected = selectedOrderId === order.jobId;
            const shipInfo = order.shipDate ? daysUntil(order.shipDate) : null;
            return (
              <div key={order.jobId} onClick={() => setSelectedOrderId(order.jobId)}
                style={{ padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                  background: selected ? C.bg : C.card, borderLeft: selected ? `3px solid ${C.text}` : "3px solid transparent" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{order.jobNumber || "Order"}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{order.clientName}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: C.faint }}>{order.items.length} item{order.items.length !== 1 ? "s" : ""} · {order.totalUnits.toLocaleString()} units</span>
                  {shipInfo && <span style={{ fontSize: 10, fontWeight: 600, color: shipInfo.color, fontFamily: C.mono }}>{shipInfo.text}</span>}
                </div>
              </div>
            );
          })}

          {/* Completed orders list */}
          {sidebarTab === "completed" && (
            <>
              {/* Search */}
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
                <input value={completedSearch}
                  onChange={e => { setCompletedSearch(e.target.value); }}
                  onKeyDown={e => { if (e.key === "Enter") loadCompleted(0, completedSearch, false); }}
                  placeholder="Search by PO # or name..."
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              </div>
              {completedOrders.map(order => {
                const selected = selectedOrderId === order.jobId;
                return (
                  <div key={order.jobId} onClick={() => setSelectedOrderId(order.jobId)}
                    style={{ padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                      background: selected ? C.bg : C.card, borderLeft: selected ? `3px solid ${C.text}` : "3px solid transparent" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{order.jobNumber || "Order"}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{order.clientName}</div>
                  </div>
                );
              })}
              {/* Load more */}
              {completedOrders.length < completedTotal && (
                <button onClick={() => loadCompleted(completedOffset + 10, completedSearch, true)}
                  disabled={completedLoading}
                  style={{ width: "100%", padding: "12px", border: "none", background: C.bg, color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                  {completedLoading ? "Loading..." : `Load more (${completedTotal - completedOrders.length} remaining)`}
                </button>
              )}
              {completedOrders.length === 0 && !completedLoading && (
                <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: C.faint }}>No completed orders{completedSearch ? " matching search" : ""}</div>
              )}
            </>
          )}
        </div>

        {/* Right content */}
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "24px 28px" }}>
        {(() => {
          const order = [...orders, ...completedOrders].find(o => o.jobId === selectedOrderId);
          if (!order) return <div style={{ padding: 40, textAlign: "center", color: C.muted }}>Select an order</div>;
          const shipInfo = order.shipDate ? daysUntil(order.shipDate) : null;
          const pendingItems = order.items.filter(i => i.pipelineStage === "pending");
          const expanded = true;
          return (<div>
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{order.jobNumber || "Order"} — {order.clientName}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{order.items.length} item{order.items.length !== 1 ? "s" : ""} · {order.totalUnits.toLocaleString()} units</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {shipInfo && <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: shipInfo.urgent ? (shipInfo.color === C.red ? C.redBg : C.amberBg) : C.greenBg, color: shipInfo.color }}>Ship {fmtDate(order.shipDate!)} · {shipInfo.text}</div>}
            {order.shipMethod && <div style={{ fontSize: 10, color: C.faint }}>{order.shipMethod}{order.shippingAccount ? ` · ${order.shippingAccount}` : ""}</div>}
          </div>
        </div>

              {/* PO detail content */}
                <div style={{ padding: isMobile ? "12px 16px" : "20px 24px" }}>

                  {/* Bulk confirm button if multiple pending */}
                  {pendingItems.length > 1 && (
                    <button
                      onClick={() => doAction("bulk_confirm", { itemIds: pendingItems.map(i => i.id) })}
                      disabled={actionLoading === "bulk_confirm" + pendingItems[0].id}
                      style={{
                        width: "100%", padding: "10px 0", borderRadius: 8, marginBottom: 16,
                        background: C.accent, color: "#fff", border: "none",
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                        opacity: actionLoading ? 0.6 : 1,
                      }}
                    >
                      Confirm All {pendingItems.length} Items Received
                    </button>
                  )}

                  {/* ── Info Strip (mirrors PO PDF) ── */}
                  <div style={{
                    display: "flex", flexWrap: "wrap", gap: 0, overflow: "hidden",
                    border: `1px solid ${C.border}`, marginBottom: 16,
                  }}>
                    {([
                      ["Date", order.poSentDate ? fmtDateLong(order.poSentDate) : "—"],
                      ["Ship Date", order.shipDate ? fmtDateLong(order.shipDate) : "TBD"],
                      ["Vendor ID", decorator.shortCode || decorator.name],
                      ["Ship Method", order.shipMethod || "—"],
                      ["Ship Acct #", order.shippingAccount || "—"],
                    ] as [string, string][]).map(([label, val], idx) => (
                      <div key={idx} style={{
                        flex: 1, minWidth: isMobile ? "33%" : 0, padding: "6px 10px",
                        borderRight: idx < 4 ? `1px solid ${C.border}` : "none",
                        background: C.card,
                      }}>
                        <div style={{ fontSize: 8, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* ── Bill To / Ship To ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16, fontSize: 12 }}>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Bill to</div>
                      <div style={{ lineHeight: 1.7, color: C.text }}>
                        House Party Distro<br/>
                        jon@housepartydistro.com<br/>
                        3945 W Reno Ave, Ste A<br/>
                        Las Vegas, NV 89118
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Ship to</div>
                      <div style={{ lineHeight: 1.7, color: C.text, whiteSpace: "pre-wrap" }}>
                        {order.shipTo
                          ? (typeof order.shipTo === "string" ? order.shipTo : [order.shipTo.name, order.shipTo.address, [order.shipTo.city, order.shipTo.state, order.shipTo.zip].filter(Boolean).join(", ")].filter(Boolean).join("\n"))
                          : "—"}
                      </div>
                    </div>
                  </div>

                  {/* ── Dark Info Bar (mirrors PO PDF) ── */}
                  <div style={{
                    background: "#1a1d2b", color: "#fff", padding: "6px 12px",
                    display: "flex", gap: 20, fontSize: 11, marginBottom: 20, borderRadius: 4,
                  }}>
                    <div><span style={{ opacity: 0.5, marginRight: 4, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em" }}>Client</span>{order.clientName}</div>
                    <div><span style={{ opacity: 0.5, marginRight: 4, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em" }}>Items</span>{order.items.length}</div>
                    <div><span style={{ opacity: 0.5, marginRight: 4, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em" }}>Total units</span>{order.totalUnits.toLocaleString()}</div>
                  </div>

                  {/* ── Item Blocks (mirrors PO PDF) ── */}
                  {order.items.map(item => {
                    const stage = STAGE_LABELS[item.pipelineStage] || STAGE_LABELS.pending;
                    const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
                    const sortedSizes = [...item.sizes].filter(s => (item.qtys[s] || 0) > 0).sort((a, b) => {
                      const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
                      if (ai === -1 && bi === -1) return a.localeCompare(b);
                      if (ai === -1) return 1; if (bi === -1) return -1;
                      return ai - bi;
                    });
                    const sizeStr = sortedSizes.map(sz => `${sz} ${item.qtys[sz]}`).join("  ·  ");

                    return (
                      <div key={item.id} style={{
                        borderLeft: `3px solid #1a1d2b`, paddingLeft: 16, marginBottom: 20,
                      }}>
                        {/* Item header: letter — name + units + stage */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <div style={{ fontSize: 15, fontWeight: 700 }}>
                            {item.letter} — {item.name}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: C.muted }}>{item.totalQty.toLocaleString()} units</span>
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                              background: stage.bg, color: stage.color,
                            }}>
                              {stage.label}
                            </span>
                          </div>
                        </div>

                        {/* Meta: Brand / Color */}
                        <div style={{ display: "flex", gap: 12, marginBottom: 4, fontSize: 11, color: C.muted }}>
                          {item.blankVendor && (
                            <div><span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 4 }}>Brand</span>{item.blankVendor}</div>
                          )}
                          {item.blankSku && (
                            <div><span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 4 }}>Color</span>{item.blankSku}</div>
                          )}
                        </div>

                        {/* Sizes */}
                        {sizeStr && (
                          <div style={{
                            fontSize: 11, color: C.muted, padding: "4px 8px", background: C.bg,
                            borderRadius: 4, marginBottom: 6, border: `1px solid ${C.border}`,
                          }}>
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 6 }}>Sizes</span>
                            {sizeStr}
                          </div>
                        )}

                        {/* Production files link */}
                        {item.driveLink && (
                          <div style={{
                            fontSize: 11, padding: "4px 8px", background: "#eef3ff",
                            borderRadius: 4, marginBottom: 6,
                          }}>
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.faint, marginRight: 6 }}>Production folder</span>
                            <a href={item.driveLink} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none" }}>{item.driveLink}</a>
                          </div>
                        )}

                        {/* Mockup thumbnail + Decoration table */}
                        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 6 }}>
                          {item.mockupThumb && (
                            <div style={{ flexShrink: 0 }}>
                              <img src={item.mockupThumb} alt="" style={{
                                height: 120, width: "auto", objectFit: "contain",
                                borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`,
                              }} onError={e => (e.currentTarget.style.display = "none")} />
                            </div>
                          )}
                          {item.decoLines.length > 0 && (
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 4 }}>Print & Decoration</div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                  <tbody>
                                    {item.decoLines.map((l, li) => (
                                      <tr key={li}>
                                        <td style={{ padding: "2px 0", color: C.text }}>{l.label}</td>
                                        <td style={{ padding: "2px 6px", textAlign: "right", color: C.muted, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
                                          {l.qty.toLocaleString()}×{fmtD(l.rate)}
                                        </td>
                                        <td style={{ padding: "2px 0", textAlign: "right", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{fmtD(l.total)}</td>
                                      </tr>
                                    ))}
                                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                                      <td colSpan={2} style={{ padding: "4px 0 2px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted }}>Item total</td>
                                      <td style={{ padding: "4px 0 2px", textAlign: "right", fontSize: 13, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>{fmtD(item.itemTotal)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Notes grid (incoming, production notes, packing) */}
                        {(item.incomingGoods || item.productionNotes || item.packingNotes) && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
                            {item.incomingGoods ? (
                              <div style={{ background: C.bg, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 2 }}>Incoming goods</div>
                                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{item.incomingGoods}</div>
                              </div>
                            ) : <div />}
                            {item.productionNotes ? (
                              <div style={{ background: C.amberBg, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.amberBorder}` }}>
                                <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber, marginBottom: 2 }}>Production notes</div>
                                <div style={{ fontSize: 11, color: C.amber, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.productionNotes}</div>
                              </div>
                            ) : <div />}
                            {item.packingNotes ? (
                              <div style={{ background: C.accentBg, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.accent}33` }}>
                                <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.accent, marginBottom: 2 }}>Packing / shipping</div>
                                <div style={{ fontSize: 11, color: C.accent, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.packingNotes}</div>
                              </div>
                            ) : <div />}
                          </div>
                        )}

                        {/* ── Actions ── */}
                        {(() => {
                          const isShipped = item.pipelineStage === "shipped" || item.pipelineStage === "complete" || !!item.shipTracking;
                          const alreadyReceived = item.pipelineStage === "in_production" || item.pipelineStage === "blanks_received" || isShipped;
                          return (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                              {/* Mark Blanks Received — visible until shipped */}
                              {!isShipped && (
                                <button
                                  onClick={() => setConfirmAction({ itemId: item.id, action: "confirm_received", label: `Mark ${item.name} blanks as received?` })}
                                  disabled={alreadyReceived}
                                  style={{
                                    padding: "8px 16px", borderRadius: 8,
                                    background: alreadyReceived ? C.greenBg : C.accent,
                                    color: alreadyReceived ? C.green : "#fff",
                                    border: alreadyReceived ? `1px solid ${C.greenBorder}` : "none",
                                    fontSize: 12, fontWeight: 600,
                                    cursor: alreadyReceived ? "default" : "pointer",
                                  }}>
                                  {alreadyReceived ? "✓ Blanks Received" : "Mark Blanks Received"}
                                </button>
                              )}

                              {/* Enter Tracking — visible until shipped */}
                              {!isShipped && (
                                <button
                                  onClick={() => setShowTracking(showTracking === item.id ? null : item.id)}
                                  style={{
                                    padding: "8px 16px", borderRadius: 8,
                                    background: C.green, color: "#fff", border: "none",
                                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                                  }}>
                                  {showTracking === item.id ? "Cancel" : "Enter Tracking + Ship Qtys"}
                                </button>
                              )}

                              {/* Shipped state */}
                              {item.shipTracking && (
                                <div style={{ fontSize: 12, color: C.green, fontWeight: 600, padding: "8px 0" }}>
                                  Tracking: {item.shipTracking}
                                </div>
                              )}

                              {/* Report Discrepancy — always visible on unshipped items */}
                              {!isShipped && (
                                <button
                                  onClick={() => setShowIssue(showIssue === item.id ? null : item.id)}
                                  style={{
                                    padding: "8px 16px", borderRadius: 8,
                                    background: "transparent", color: C.amber, border: `1px solid ${C.amberBorder}`,
                                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                                  }}>
                                  {showIssue === item.id ? "Cancel" : "Report Discrepancy"}
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {/* Tracking input + per-size ship qtys + packing slip */}
                        {showTracking === item.id && (
                          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, background: C.bg, padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}>
                            {/* Per-size shipped quantities */}
                            {item.sizes && item.sizes.length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, marginBottom: 6 }}>
                                  Shipped quantities (defaults to ordered)
                                </div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {sortSizes(item.sizes).map(sz => {
                                    const ordered = item.qtys?.[sz] || 0;
                                    const current = shipQtyInputs[item.id]?.[sz];
                                    const value = current !== undefined ? current : ordered;
                                    const mismatch = value !== ordered;
                                    return (
                                      <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                        <span style={{ fontSize: 9, color: C.muted, fontFamily: C.mono }}>{sz}</span>
                                        <input
                                          type="number"
                                          min={0}
                                          value={value}
                                          onChange={e => {
                                            const n = parseInt(e.target.value || "0", 10);
                                            setShipQtyInputs(prev => ({
                                              ...prev,
                                              [item.id]: { ...(prev[item.id] || {}), [sz]: isNaN(n) ? 0 : n },
                                            }));
                                          }}
                                          onFocus={e => e.target.select()}
                                          style={{ width: 50, textAlign: "center", padding: "4px", border: `1px solid ${mismatch ? C.amber : C.border}`, borderRadius: 4, background: C.card, color: mismatch ? C.amber : C.text, fontSize: 12, fontFamily: C.mono, outline: "none" }}
                                        />
                                        <span style={{ fontSize: 8, color: C.faint, fontFamily: C.mono }}>{ordered}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Packing slip upload */}
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, marginBottom: 6 }}>
                                Packing slip (optional)
                              </div>
                              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: C.card, border: `1px dashed ${C.border}`, borderRadius: 6, cursor: "pointer", fontSize: 12, color: C.muted }}>
                                <input
                                  type="file"
                                  accept="application/pdf,image/*"
                                  style={{ display: "none" }}
                                  onChange={e => {
                                    const f = e.target.files?.[0] || null;
                                    setPackingSlipFiles(prev => ({ ...prev, [item.id]: f }));
                                  }}
                                />
                                <span style={{ fontSize: 16, lineHeight: 1, color: C.faint }}>＋</span>
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {packingSlipFiles[item.id]?.name || "Click to attach your packing slip (PDF or image)"}
                                </span>
                                {packingSlipFiles[item.id] && (
                                  <span
                                    onClick={e => { e.preventDefault(); e.stopPropagation(); setPackingSlipFiles(prev => ({ ...prev, [item.id]: null })); }}
                                    style={{ fontSize: 14, color: C.muted, padding: "0 4px" }}
                                  >×</span>
                                )}
                              </label>
                            </div>

                            {/* Carrier + tracking */}
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, marginTop: 4 }}>
                              Tracking
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <select
                                value={trackingInputs[item.id]?.carrier || ""}
                                onChange={e => setTrackingInputs(prev => ({
                                  ...prev, [item.id]: { ...prev[item.id], carrier: e.target.value, tracking: prev[item.id]?.tracking || "" }
                                }))}
                                style={{
                                  width: 120, padding: "8px 10px", borderRadius: 8,
                                  border: `1px solid ${C.border}`, fontSize: 12,
                                  fontFamily: C.font, background: C.card,
                                }}
                              >
                                <option value="">Carrier</option>
                                <option>UPS</option>
                                <option>FedEx</option>
                                <option>USPS</option>
                                <option>Freight</option>
                                <option>Will Call</option>
                              </select>
                              <input
                                value={trackingInputs[item.id]?.tracking || ""}
                                onChange={e => setTrackingInputs(prev => ({
                                  ...prev, [item.id]: { ...prev[item.id], tracking: e.target.value, carrier: prev[item.id]?.carrier || "" }
                                }))}
                                placeholder="Tracking number"
                                style={{
                                  flex: 1, padding: "8px 10px", borderRadius: 8,
                                  border: `1px solid ${C.border}`, fontSize: 12,
                                  fontFamily: C.font, background: C.card,
                                }}
                              />
                            </div>
                            <button
                              onClick={() => markShipped(item, order.jobId)}
                              disabled={!trackingInputs[item.id]?.tracking?.trim() || actionLoading === "enter_tracking" + item.id}
                              style={{
                                padding: "10px 0", borderRadius: 8, width: "100%",
                                background: C.green, color: "#fff", border: "none",
                                fontSize: 13, fontWeight: 600, cursor: "pointer",
                                opacity: (!trackingInputs[item.id]?.tracking?.trim() || actionLoading === "enter_tracking" + item.id) ? 0.5 : 1,
                              }}>
                              {actionLoading === "enter_tracking" + item.id ? "Saving..." : "Mark as Shipped"}
                            </button>
                          </div>
                        )}

                        {/* Discrepancy input — blanks received counts off, qc issues, etc. */}
                        {showIssue === item.id && (
                          <div style={{ marginTop: 10, background: C.amberBg, padding: 12, borderRadius: 8, border: `1px solid ${C.amberBorder}` }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.amber, marginBottom: 6 }}>
                              Report a discrepancy on this item
                            </div>
                            <textarea
                              value={issueInputs[item.id] || ""}
                              onChange={e => setIssueInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                              placeholder="e.g. short M-3, over L-12"
                              style={{
                                width: "100%", minHeight: 60, padding: 10, borderRadius: 6,
                                border: `1px solid ${C.amberBorder}`, fontSize: 12,
                                fontFamily: C.font, resize: "vertical", background: C.card,
                                boxSizing: "border-box",
                              }}
                            />
                            <button
                              onClick={() => {
                                if (!issueInputs[item.id]?.trim()) return;
                                doAction("flag_issue", {
                                  itemId: item.id,
                                  jobId: order.jobId,
                                  note: issueInputs[item.id].trim(),
                                });
                              }}
                              disabled={!issueInputs[item.id]?.trim() || actionLoading === "flag_issue" + item.id}
                              style={{
                                marginTop: 8, padding: "8px 20px", borderRadius: 6,
                                background: C.amber, color: "#fff", border: "none",
                                fontSize: 12, fontWeight: 600, cursor: "pointer",
                                opacity: (!issueInputs[item.id]?.trim() || actionLoading === "flag_issue" + item.id) ? 0.5 : 1,
                              }}>
                              {actionLoading === "flag_issue" + item.id ? "Sending..." : "Send to HPD"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* ── PO Total ── */}
                  {order.grandTotal > 0 && (
                    <div style={{
                      borderTop: `2px solid #1a1d2b`, paddingTop: 12, marginBottom: 20,
                      textAlign: "right",
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.faint, marginBottom: 4 }}>PO Total — Decoration</div>
                      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", fontFamily: "ui-monospace, monospace" }}>{fmtD(order.grandTotal)}</div>
                    </div>
                  )}

                  {/* ── Terms ── */}
                  <div style={{
                    borderTop: `1px solid ${C.border}`, paddingTop: 10,
                    fontSize: 10, color: C.faint, lineHeight: 1.6,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 3 }}>House Party Distro Purchase Order Conditions</div>
                    House Party Distro must be notified of any blank shortages or discrepancies within 24 hours of receipt of goods. Outbound shipping is at the sole direction of House Party Distro. Packing lists and tracking numbers must be supplied to House Party Distro immediately after the order has shipped. House Party Distro must be invoiced for any charges within 30 days of the PO date.
                  </div>
                </div>
        </div>);
        })()}
        </div>
      </div>

      {/* ── Confirm Dialog ── */}
      {confirmAction && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999,
        }} onClick={() => setConfirmAction(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.card, borderRadius: 8, padding: 24, maxWidth: 380, width: "90%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{confirmAction.label}</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
              This will update the status to &quot;In Production&quot;.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmAction(null)} style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: C.bg, border: `1px solid ${C.border}`, color: C.text, cursor: "pointer",
              }}>Cancel</button>
              <button
                onClick={() => doAction(confirmAction.action, { itemId: confirmAction.itemId })}
                disabled={actionLoading === confirmAction.action + confirmAction.itemId}
                style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: C.accent, border: "none", color: "#fff", cursor: "pointer",
                }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
