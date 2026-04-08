"use client";
import { useState, useEffect } from "react";

// ── Light theme for client-facing portal ──
const C = {
  bg: "#f5f6fa",
  card: "#ffffff",
  border: "#e2e5ee",
  text: "#1a1d2b",
  muted: "#6b7089",
  faint: "#9ca3b8",
  accent: "#4361ee",
  accentBg: "#eef1ff",
  green: "#10b981",
  greenBg: "#ecfdf5",
  greenBorder: "#a7f3d0",
  amber: "#d97706",
  amberBg: "#fffbeb",
  amberBorder: "#fde68a",
  red: "#ef4444",
  redBg: "#fef2f2",
  redBorder: "#fecaca",
  font: "'Inter', -apple-system, sans-serif",
};

const fmtD = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const timeAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

type PortalData = {
  project: {
    title: string; jobNumber: string; phase: string; phaseLabel: string;
    shipDate: string | null; quoteApproved: boolean; quoteApprovedAt: string | null;
    paymentTerms: string | null;
  };
  client: { name: string };
  quote: { items: { name: string; qty: number; sellPerUnit: number; total: number }[]; subtotal: number; tax: number; total: number };
  items: { id: string; name: string; proofs: { id: string; fileName: string; stage: string; approval: string; driveLink: string; driveFileId: string; createdAt: string }[] }[];
  payments: { id: string; type: string; amount: number; status: string; dueDate: string | null; paidDate: string | null; invoiceNumber: string | null }[];
  paymentLink: string | null;
  invoiceNumber: string | null;
  activity: { message: string; date: string }[];
};

const PHASE_STEPS = [
  { key: "intake", label: "Setup" },
  { key: "pending", label: "Review" },
  { key: "ready", label: "Preparation" },
  { key: "production", label: "Production" },
  { key: "complete", label: "Complete" },
];

export default function PortalPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState<Record<string, string>>({});
  const [showRevisionInput, setShowRevisionInput] = useState<string | null>(null);
  const [showQuoteReject, setShowQuoteReject] = useState(false);
  const [quoteRejectNote, setQuoteRejectNote] = useState("");
  const [viewingProof, setViewingProof] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    loadPortal();
  }, [params.token]);

  async function loadPortal() {
    try {
      const res = await fetch(`/api/portal/${params.token}`);
      if (!res.ok) {
        setError("This link is no longer valid.");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Unable to load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function doAction(action: string, extra?: Record<string, any>) {
    const key = action + (extra?.fileId || "");
    setActionLoading(key);
    try {
      const res = await fetch(`/api/portal/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) {
        await loadPortal();
        setShowRevisionInput(null);
      }
    } catch {}
    setActionLoading(null);
  }

  // ── Error / Loading states ──
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.muted, fontFamily: C.font, fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 48, opacity: 0.3 }}>🔒</div>
        <div style={{ color: C.text, fontFamily: C.font, fontSize: 16, fontWeight: 600 }}>{error || "Not found"}</div>
        <div style={{ color: C.muted, fontFamily: C.font, fontSize: 13 }}>Contact your rep if you believe this is an error.</div>
      </div>
    );
  }

  const { project, client, quote, items, payments, paymentLink, invoiceNumber, activity } = data;

  const totalPaid = payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const balance = (quote.total || 0) - totalPaid;
  const hasQuote = quote.items.length > 0;
  const actualProofs = items.flatMap(i => i.proofs.filter(p => p.stage === "proof"));
  const hasProofs = actualProofs.length > 0;
  const allProofsApproved = hasProofs && actualProofs.every(p => p.approval === "approved");
  const pendingProofCount = actualProofs.filter(p => p.approval === "pending").length;
  const hasPayments = payments.length > 0 || paymentLink;

  // Figure out which phase step we're at
  const phaseOrder = ["intake", "pending", "ready", "production", "complete"];
  const currentIdx = phaseOrder.indexOf(
    ["receiving", "fulfillment", "shipped"].includes(project.phase) ? "production" : project.phase
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.font, color: C.text }}>
      {/* ── Top Bar ── */}
      <div style={{
        background: "#1a1d2b", padding: isMobile ? "16px 20px" : "14px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="120" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227.14 28.53"><g><path fill="#e8eaf2" d="M15.48,14.1v8.5c0,.13-.11.24-.24.24h-4.51c-.13,0-.24-.11-.24-.24v-8.27c0-.56-.03-1.2-.27-1.72-.11-.22-.25-.4-.42-.54-.28-.22-.65-.33-1.12-.33-.87,0-1.54.3-1.76.78-.24.52-.24,1.24-.24,1.81v8.27c0,.13-.11.24-.24.24H1.93c-.13,0-.24-.11-.24-.24V3.21c0-.13.11-.24.24-.24h4.22c.13,0,.24.11.24.24v5.17c0,.1.11.15.19.1,3.4-2.34,6.72.26,6.75.29.12.09.24.2.34.3h0c1.54,1.55,1.8,2.81,1.8,5.03Z"/><path fill="#e8eaf2" d="M31.55,15.4c0,4.36-3.6,7.91-8.02,7.91s-8.02-3.55-8.02-7.91,3.6-7.91,8.02-7.91,8.02,3.55,8.02,7.91ZM27.02,15.4c0-1.9-1.57-3.45-3.5-3.45s-3.5,1.55-3.5,3.45,1.57,3.45,3.5,3.45,3.5-1.55,3.5-3.45Z"/><path fill="#e8eaf2" d="M45.34,7.97v14.63c0,.13-.11.24-.24.24h-4.22c-.13,0-.24-.11-.24-.24v-.41c0-.1-.11-.15-.19-.1-1.06.73-2.1.98-3.04.98-2.1,0-3.68-1.24-3.71-1.26-.12-.09-.24-.2-.34-.3h0c-1.54-1.55-1.8-2.81-1.8-5.03V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24v8.27c0,.56.03,1.2.27,1.72.11.22.25.4.42.54.28.22.65.33,1.12.33.87,0,1.54-.3,1.76-.78.24-.52.24-1.24.24-1.81V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24Z"/><path fill="#e8eaf2" d="M57.67,18.33c-.04.53-.17,1.09-.41,1.67-.9,1.93-2.99,3.07-5.59,3.07-.36,0-.73-.02-1.1-.07-1.17-.14-2.19-.45-3.04-.92-.87-.59-1.54-1.42-1.99-2.46-.06-.14.02-.3.17-.33l4.14-.89c.1-.02.2.02.25.1.29.43.78.64,1.05.68.63.08.96-.09,1.13-.25.17-.16.24-.37.21-.6-.07-.52-.38-.77-1.98-1.53h-.02c-.32-.16-.72-.35-1.16-.57-.31-.13-.6-.28-.88-.42h-.02s-.08-.06-.12-.08c-1.44-.82-2.28-1.83-2.49-2.98-.31-1.65.75-3.05.97-3.31.32-.36.69-.68,1.11-.95,1.26-.8,2.88-1.13,4.56-.94,1.01.12,1.93.39,2.73.81.38.2.73.43,1.05.7.22.19.89.86,1.1,1.89.03.13-.06.26-.19.28l-4.07.82c-.12.02-.23-.04-.27-.15-.11-.28-.37-.57-.9-.63-.36-.04-.68.06-.89.29-.16.17-.22.39-.17.56.08.27.36.7,1.88,1.32.3.12.58.23.86.34.35.13.7.26,1.02.4h0c.97.45,3.21,1.76,3.07,4.15Z"/><path fill="#e8eaf2" d="M73.45,15.4c0,.44-.05.95-.13,1.4-.02.12-.12.2-.24.2h-10.58c-.19,0-.3.2-.21.37.65,1.1,1.81,1.79,3.1,1.79,1.09,0,2.11-.48,2.84-1.41.06-.07.15-.11.23-.09l4.05.73c.16.03.24.2.18.34-.09.19-.21.43-.27.54h0c-.06.1-.13.21-.2.32-.09.14-.18.27-.27.38l-.05.07c-.06.07-.11.13-.17.2l-.05.06c-.09.1-.18.2-.28.3l-.05.06c-.06.06-.13.13-.19.19l-.02.02c-.07.07-.14.13-.22.2l-.08.07c-.11.1-.22.18-.33.26l-.09.07c-.12.09-.25.18-.38.26l-.04.02c-.15.1-.3.19-.45.27l-.04.02s-.07.04-.11.06h-.03c-.07.05-.13.08-.2.11l-.04.02c-.14.07-.28.13-.41.18h-.03l-.25.11-.1.04-.3.1h-.02l-.35.11-.09.02c-.23.06-.46.1-.69.14h-.09c-.24.05-.48.07-.72.09h-.09l-.37.01-.37,0c-.03,0-.06,0-.08,0h-.03l-.27-.02h-.03s-.05,0-.08,0c-.13-.01-.25-.03-.35-.04h0l-.1-.02-.45-.08-.16-.03-.4-.09h-.04s-.05-.02-.08-.03c-.13-.03-.24-.06-.34-.1l-.34-.11c-.03,0-.05-.02-.08-.03h-.02l-.24-.1h-.02s-.05-.03-.07-.04l-.32-.14h-.01l-.3-.16c-.02-.01-.05-.03-.07-.04h-.02l-.22-.14-.09-.05-.29-.18c-.96-.64-1.78-1.49-2.38-2.46l-.15-.25-.02-.04-.13-.24-.02-.05s-.03-.05-.04-.07c-.15-.31-.29-.64-.4-.98l-.15-.5-.09-.38c-.08-.39-.13-.79-.15-1.19l-.01-.41,0-.41c.04-.7.17-1.4.39-2.07l.23-.6.14-.31c.01-.02.02-.05.04-.07l.03-.06s.02-.05.04-.07l.04-.07.07-.13c.06-.1.11-.2.17-.3.6-.97,1.42-1.82,2.38-2.46l.29-.18.09-.05.22-.13h.02s.05-.04.07-.05l.31-.16.32-.14c.02-.01.05-.02.07-.03h.02l.24-.1h.02s.05-.03.08-.04l.33-.11.34-.1c.02,0,.05-.01.08-.02h.03l.26-.07h.06l.38-.08h.02l.35-.04c.03,0,.05,0,.08,0h.03l.27-.02h.02s.06,0,.09,0l.37,0,.37,0h.09l.72.08h.1l.68.15.1.03.34.1h.02l.3.11.09.03.25.1.04.02.41.18.04.02.19.1h.02l.49.29h.02l.4.28.02.02s.05.04.08.06l.33.26.06.05.25.22.02.02.19.19.05.05.28.3.04.05.16.19.05.06.18.23h0l.14.21.09.13.11.18.15.25h0c.3.52.54,1.08.7,1.64.22.73.33,1.48.33,2.23ZM68.72,13.4c-.19-1.11-1.48-1.98-3.11-1.98-1.49,0-2.9.86-3.11,1.98-.03.15.09.29.24.29h5.75c.15,0,.26-.14.24-.28Z"/></g><g><path fill="#e8eaf2" d="M96.76,14.82c0,4.68-3.86,8.48-8.6,8.48-1.5,0-2.97-.39-4.27-1.12-.09-.05-.19.01-.19.11v5.59c0,.14-.12.26-.26.26h-4.52c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.49c0,.1.11.16.19.11,1.3-.73,2.76-1.12,4.27-1.12,4.74,0,8.6,3.8,8.6,8.48ZM91.33,14.82c0-2.14-1.77-3.89-3.94-3.89s-3.68,1.74-3.68,3.89,1.51,3.89,3.68,3.89,3.94-1.74,3.94-3.89Z"/><path fill="#e8eaf2" d="M114.9,6.85v15.68c0,.14-.12.26-.26.26h-4.53c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.19-.11-1.3.73-2.76,1.12-4.27,1.12-4.74,0-8.6-3.8-8.6-8.48s3.86-8.48,8.6-8.48c1.5,0,2.97.39,4.27,1.12.09.05.19-.01.19-.11v-.49c0-.14.12-.26.26-.26h4.53c.14,0,.26.12.26.26ZM109.86,14.82c0-2.14-1.51-3.89-3.68-3.89s-3.94,1.74-3.94,3.89,1.77,3.89,3.94,3.89,3.68-1.74,3.68-3.89Z"/><path fill="#e8eaf2" d="M124.28,6.87l-.15,3.79c0,.15-.13.26-.28.25-.44-.04-1.33-.1-1.85.03-.58.14-.92.59-1.02.81-.26.56-.26,1.06-.26,1.68v9.11c0,.14-.12.26-.26.26h-4.83c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.45c0,.1.11.16.2.11,1.07-.67,2.34-.81,3.41-.82.15,0,.27.12.26.27Z"/><path fill="#e8eaf2" d="M134.26,18.88l-.58,3.83c-.02.12-.12.21-.24.22-.56.03-2.04.12-2.49.12-.04,0-.07,0-.09,0-2.75-.14-4.2-1.56-4.2-4.08v-7.77c0-.14-.12-.26-.26-.26h-1.68c-.14,0-.26-.12-.26-.26v-3.83c0-.14.12-.26.26-.26h1.68c.14,0,.26-.12.26-.26V1.88c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v4.44c0,.14.12.26.26.26h1.68c.14,0,.26.12.26.26v3.83c0,.14-.12.26-.26.26h-1.68c-.14,0-.26.11-.26.26,0,1.34,0,5.32,0,5.36v.11c-.02.49-.04,1.17.35,1.57.23.24.59.36,1.07.36h.88c.16,0,.28.14.26.3Z"/><path fill="#e8eaf2" d="M150.4,6.95l-5.1,14.17-2.37,6.74c-.04.1-.13.17-.24.17h-5.03c-.18,0-.3-.17-.25-.34l1.97-5.84c.02-.06.02-.12,0-.17l-5.39-14.72c-.06-.17.06-.35.24-.35h4.51c.11,0,.21.07.24.17l2.95,7.98c.08.23.41.22.49,0l2.72-7.97c.04-.1.13-.18.25-.18h4.77c.18,0,.3.18.24.35Z"/><path fill="#e8eaf2" d="M171.26,1.54v21.08c0,.15-.12.26-.26.26h-4.59c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.2-.11-1.32.74-2.8,1.14-4.33,1.14-4.81,0-8.72-3.86-8.72-8.6s3.91-8.6,8.72-8.6c1.53,0,3.01.39,4.33,1.13.09.05.2-.01.2-.11V1.54c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26ZM166.14,14.79c0-2.18-1.53-3.95-3.74-3.95s-4,1.77-4,3.95,1.79,3.95,4,3.95,3.74-1.77,3.74-3.95Z"/><path fill="#e8eaf2" d="M176.51,6.46h-4.59c-.15,0-.26.12-.26.26v15.9c0,.14.12.26.26.26h4.59c.15,0,.26-.12.26-.26V6.72c0-.15-.12-.26-.26-.26ZM176.71,1.38s0-.02-.02-.02c-1.55-.11-5.01,2.17-4.97,3.72,0,0,.01.01.02.02.04.04.11.07.17.07h4.59c.15,0,.26-.12.26-.26V1.54c0-.06-.02-.12-.06-.17Z"/><path fill="#e8eaf2" d="M189.79,17.99c-.04.57-.19,1.19-.44,1.82-.98,2.09-3.25,3.34-6.08,3.34-.39,0-.79-.02-1.19-.07-1.27-.15-2.38-.49-3.3-1.01-.95-.64-1.67-1.54-2.16-2.67-.07-.15.02-.33.19-.36l4.5-.97c.11-.02.21.02.27.11.32.47.85.7,1.14.73.69.08,1.05-.1,1.22-.27.18-.17.26-.4.23-.66-.07-.57-.41-.83-2.15-1.66h-.02c-.35-.18-.78-.38-1.26-.62-.33-.14-.66-.3-.96-.46l-.03-.02s-.09-.05-.13-.08c-1.56-.9-2.47-1.99-2.71-3.24-.34-1.79.82-3.31,1.05-3.6.35-.39.75-.74,1.21-1.03,1.37-.87,3.13-1.23,4.96-1.02,1.1.13,2.1.43,2.96.88.41.22.8.47,1.14.76.24.21.97.94,1.2,2.05.03.14-.07.28-.21.31l-4.43.9c-.13.02-.25-.05-.29-.16-.12-.31-.4-.62-.98-.69-.39-.05-.74.07-.96.32-.17.19-.24.42-.19.61.08.29.39.76,2.04,1.44.33.13.63.24.93.37.38.14.76.29,1.11.44h0c1.05.49,3.48,1.92,3.34,4.51Z"/><path fill="#e8eaf2" d="M199.29,18.92l-.59,3.89c-.02.12-.12.22-.24.22-.56.03-2.07.12-2.53.12-.04,0-.07,0-.09,0-2.79-.15-4.26-1.58-4.26-4.14v-7.89c0-.14-.12-.26-.26-.26h-1.71c-.14,0-.26-.12-.26-.26v-3.89c0-.14.12-.26.26-.26h1.71c.14,0,.26-.12.26-.26V1.67c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26v4.51c0,.14.12.26.26.26h1.71c.14,0,.26.12.26.26v3.89c0,.14-.12.26-.26.26h-1.71c-.14,0-.26.12-.26.26,0,1.36,0,5.39,0,5.44v.11c-.02.5-.04,1.18.36,1.59.23.24.6.36,1.09.36h.89c.16,0,.28.14.26.3Z"/><path fill="#e8eaf2" d="M208.56,6.73l-.16,3.84c0,.15-.14.26-.29.25-.45-.04-1.35-.1-1.88.03-.59.14-.93.6-1.03.82-.27.57-.27,1.07-.27,1.71v9.25c0,.14-.12.26-.26.26h-4.9c-.15,0-.26-.12-.26-.26V6.72c0-.14.12-.26.26-.26h4.59c.15,0,.26.12.26.26v.46c0,.1.11.17.2.11,1.09-.68,2.38-.82,3.46-.83.15,0,.27.12.27.27Z"/><path fill="#e8eaf2" d="M225.19,14.8c0,4.74-3.91,8.6-8.72,8.6s-8.72-3.86-8.72-8.6,3.91-8.6,8.72-8.6,8.72,3.86,8.72,8.6ZM220.27,14.8c0-2.07-1.71-3.75-3.8-3.75s-3.8,1.68-3.8,3.75,1.71,3.75,3.8,3.75,3.8-1.68,3.8-3.75Z"/></g></svg>
        </div>
        <div style={{ color: "#8a92b0", fontSize: 11 }}>Project Portal</div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: isMobile ? "20px 16px 60px" : "32px 24px 60px" }}>

        {/* ── Project Header ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginBottom: 4 }}>{client.name} {(invoiceNumber || project.jobNumber) && `· ${invoiceNumber || project.jobNumber}`}</div>
          <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}>{project.title}</h1>
          {project.shipDate && (
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Ship date: {fmtDate(project.shipDate)}</div>
          )}
        </div>

        {/* ── Phase Progress ── */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: isMobile ? "16px" : "16px 24px", marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 8 }}>
            {PHASE_STEPS.map((step, idx) => {
              const isActive = idx <= currentIdx && currentIdx >= 0;
              const isCurrent = phaseOrder[currentIdx] === step.key ||
                (step.key === "production" && ["production", "receiving", "fulfillment"].includes(project.phase));
              return (
                <div key={step.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{
                    height: 4, width: "100%", borderRadius: 2,
                    background: isActive ? C.accent : "#e2e5ee",
                    transition: "background 0.3s",
                  }} />
                  <span style={{
                    fontSize: isMobile ? 9 : 10, fontWeight: isCurrent ? 700 : 500,
                    color: isCurrent ? C.accent : isActive ? C.text : C.faint,
                  }}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "center", marginTop: 12, fontSize: 13, fontWeight: 600, color: C.accent }}>
            {project.phaseLabel}
          </div>
        </div>

        {/* ── Quote Section ── */}
        {hasQuote && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: isMobile ? "16px" : "20px 24px", marginBottom: 20,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Quote</h2>
              {project.quoteApproved ? (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                  background: C.greenBg, color: C.green, border: `1px solid ${C.greenBorder}`,
                }}>Approved {project.quoteApprovedAt ? fmtDate(project.quoteApprovedAt) : ""}</span>
              ) : (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                  background: C.amberBg, color: C.amber, border: `1px solid ${C.amberBorder}`,
                }}>Awaiting Approval</span>
              )}
            </div>

            {/* Line items */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ textAlign: "left", padding: "8px 0", fontSize: 11, fontWeight: 600, color: C.muted }}>Item</th>
                  <th style={{ textAlign: "right", padding: "8px 0", fontSize: 11, fontWeight: 600, color: C.muted, width: 60 }}>Qty</th>
                  <th style={{ textAlign: "right", padding: "8px 0", fontSize: 11, fontWeight: 600, color: C.muted, width: 80 }}>Unit</th>
                  <th style={{ textAlign: "right", padding: "8px 0", fontSize: 11, fontWeight: 600, color: C.muted, width: 90 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {quote.items.map((qi: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 0", fontWeight: 500 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {qi.thumbnailFileId && (
                          <img src={`/api/files/thumbnail?id=${qi.thumbnailFileId}`} alt=""
                            onError={(e: any) => { e.target.style.display = "none"; }}
                            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4, border: `1px solid ${C.border}`, flexShrink: 0 }} />
                        )}
                        <span>{qi.name}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right", padding: "10px 0", color: C.muted }}>{qi.qty}</td>
                    <td style={{ textAlign: "right", padding: "10px 0", color: C.muted }}>{fmtD(qi.sellPerUnit)}</td>
                    <td style={{ textAlign: "right", padding: "10px 0", fontWeight: 600 }}>{fmtD(qi.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ borderTop: `2px solid ${C.border}`, paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, marginBottom: 4 }}>
                <span>Subtotal</span><span>{fmtD(quote.subtotal)}</span>
              </div>
              {quote.tax > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, marginBottom: 4 }}>
                  <span>Tax</span><span>{fmtD(quote.tax)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                <span>Total</span><span>{fmtD(quote.total)}</span>
              </div>
            </div>

            {/* Quote actions */}
            {!project.quoteApproved && (
              <div style={{ marginTop: 16 }}>
                <button
                  onClick={() => doAction("approve-quote")}
                  disabled={actionLoading === "approve-quote"}
                  style={{
                    width: "100%", padding: "14px 0", borderRadius: 10,
                    background: C.green, color: "#fff", border: "none",
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                    opacity: actionLoading === "approve-quote" ? 0.6 : 1,
                  }}
                >
                  {actionLoading === "approve-quote" ? "Approving..." : "Approve Quote"}
                </button>
                {!showQuoteReject ? (
                  <button
                    onClick={() => setShowQuoteReject(true)}
                    style={{
                      width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 10,
                      background: "transparent", color: C.muted, border: `1px solid ${C.border}`,
                      fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    Request Changes
                  </button>
                ) : (
                  <div style={{ marginTop: 10, background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>What changes are needed?</div>
                    <textarea
                      value={quoteRejectNote}
                      onChange={e => setQuoteRejectNote(e.target.value)}
                      placeholder="Describe the changes you'd like..."
                      rows={3}
                      style={{
                        width: "100%", padding: 10, borderRadius: 8,
                        border: `1px solid ${C.border}`, background: C.card, color: C.text,
                        fontSize: 13, resize: "vertical", outline: "none", boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => doAction("reject-quote", { note: quoteRejectNote })}
                        disabled={!quoteRejectNote.trim() || actionLoading === "reject-quote"}
                        style={{
                          flex: 1, padding: "10px", borderRadius: 8,
                          background: C.red || "#f87171", color: "#fff", border: "none",
                          fontSize: 13, fontWeight: 600, cursor: "pointer",
                          opacity: (!quoteRejectNote.trim() || actionLoading === "reject-quote") ? 0.5 : 1,
                        }}
                      >
                        {actionLoading === "reject-quote" ? "Sending..." : "Submit Changes"}
                      </button>
                      <button
                        onClick={() => { setShowQuoteReject(false); setQuoteRejectNote(""); }}
                        style={{
                          padding: "10px 16px", borderRadius: 8,
                          background: "transparent", border: `1px solid ${C.border}`, color: C.muted,
                          fontSize: 13, cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Download Quote PDF */}
            <a href={`/api/pdf/quote/${(project as any).id || ""}?portal=${params.token}`} target="_blank" rel="noopener noreferrer"
              style={{
                display: "inline-block", marginTop: 12, fontSize: 12, fontWeight: 600,
                color: C.accent, textDecoration: "none",
              }}>
              Download Quote PDF
            </a>
          </div>
        )}

        {/* ── Proofs Section ── */}
        {hasProofs && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: isMobile ? "16px" : "20px 24px", marginBottom: 20,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{allProofsApproved ? "Proofs" : "Proofs for Review"}</h2>
              {allProofsApproved && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 99, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBorder}` }}>All Approved</span>
              )}
              {!allProofsApproved && pendingProofCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 99, background: C.amberBg, color: C.amber, border: `1px solid ${C.amberBorder}` }}>{pendingProofCount} pending</span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {items.filter(i => i.proofs.length > 0).map(item => (
                <div key={item.id}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: C.text }}>{item.name}</div>
                  {item.proofs.map(proof => {
                    const isMockup = proof.stage === "mockup";
                    const actionKey = `approve-proof${proof.id}`;
                    const revKey = `request-revision${proof.id}`;
                    const approvedTime = proof.approvedAt ? fmtDate(proof.approvedAt) : null;
                    const approvalStyle = proof.approval === "approved"
                      ? { bg: C.greenBg, color: C.green, border: C.greenBorder, label: approvedTime ? `Approved ${approvedTime}` : "Approved" }
                      : proof.approval === "revision_requested"
                      ? { bg: C.amberBg, color: C.amber, border: C.amberBorder, label: "Revision Requested" }
                      : { bg: C.amberBg, color: C.amber, border: C.amberBorder, label: "Pending Review" };

                    return (
                      <div key={proof.id} style={{
                        border: `1px solid ${C.border}`, borderRadius: 8, padding: 12,
                        marginBottom: 8, background: C.bg,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{proof.fileName}</span>
                            <span style={{ fontSize: 10, color: C.faint, marginLeft: 8 }}>{isMockup ? "Mockup" : "Proof"}</span>
                          </div>
                          {/* Only show approval pill for proofs, not mockups */}
                          {!isMockup && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 99,
                              background: approvalStyle.bg, color: approvalStyle.color,
                              border: `1px solid ${approvalStyle.border}`,
                            }}>
                              {approvalStyle.label}
                            </span>
                          )}
                        </div>

                        {/* View button — different label for mockup vs proof */}
                        {proof.driveFileId && (
                          <button
                            onClick={() => setViewingProof(proof)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 12, color: C.accent, textDecoration: "none", fontWeight: 600,
                              marginBottom: 8, background: "none", border: `1px solid ${C.accent}44`,
                              borderRadius: 6, padding: "6px 14px", cursor: "pointer",
                            }}>
                            {isMockup ? "View Mockup" : "View Proof"}
                          </button>
                        )}

                        {/* Action buttons only for proofs (not mockups), if pending or revision_requested */}
                        {!isMockup && (proof.approval === "pending" || proof.approval === "revision_requested") && (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => doAction("approve-proof", { fileId: proof.id })}
                              disabled={actionLoading === actionKey}
                              style={{
                                padding: "8px 20px", borderRadius: 8,
                                background: C.green, color: "#fff", border: "none",
                                fontSize: 12, fontWeight: 600, cursor: "pointer",
                                opacity: actionLoading === actionKey ? 0.6 : 1,
                              }}>
                              {actionLoading === actionKey ? "..." : "Approve"}
                            </button>
                            <button
                              onClick={() => setShowRevisionInput(showRevisionInput === proof.id ? null : proof.id)}
                              style={{
                                padding: "8px 20px", borderRadius: 8,
                                background: "transparent", color: C.red, border: `1px solid ${C.redBorder}`,
                                fontSize: 12, fontWeight: 600, cursor: "pointer",
                              }}>
                              Request Changes
                            </button>
                          </div>
                        )}

                        {/* Revision note input */}
                        {showRevisionInput === proof.id && (
                          <div style={{ marginTop: 8 }}>
                            <textarea
                              value={revisionNote[proof.id] || ""}
                              onChange={e => setRevisionNote(prev => ({ ...prev, [proof.id]: e.target.value }))}
                              placeholder="What changes would you like? (optional)"
                              style={{
                                width: "100%", minHeight: 60, borderRadius: 8,
                                border: `1px solid ${C.border}`, padding: 10,
                                fontSize: 12, fontFamily: C.font, resize: "vertical",
                                background: C.card, color: C.text,
                              }}
                            />
                            <button
                              onClick={() => doAction("request-revision", { fileId: proof.id, note: revisionNote[proof.id] || "" })}
                              disabled={actionLoading === revKey}
                              style={{
                                marginTop: 6, padding: "8px 20px", borderRadius: 8,
                                background: C.red, color: "#fff", border: "none",
                                fontSize: 12, fontWeight: 600, cursor: "pointer",
                                opacity: actionLoading === revKey ? 0.6 : 1,
                              }}>
                              {actionLoading === revKey ? "Sending..." : "Submit Revision Request"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Payment Section ── */}
        {(hasPayments || hasQuote) && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: isMobile ? "16px" : "20px 24px", marginBottom: 20,
          }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Payment</h2>

            {/* Balance strip */}
            <div style={{
              display: "flex", gap: isMobile ? 12 : 24,
              flexWrap: "wrap", marginBottom: 16,
            }}>
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Total</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtD(quote.total)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Paid</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.green }}>{fmtD(totalPaid)}</div>
              </div>
              {balance > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Balance Due</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.red }}>{fmtD(balance)}</div>
                </div>
              )}
            </div>

            {/* Pay button */}
            {paymentLink && balance > 0 && (
              <a href={paymentLink} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "block", textAlign: "center", width: "100%",
                  padding: "14px 0", borderRadius: 10, textDecoration: "none",
                  background: C.accent, color: "#fff",
                  fontSize: 15, fontWeight: 700,
                }}>
                Pay Now — {fmtD(balance)}
              </a>
            )}

            {/* Payment history */}
            {payments.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>History</div>
                {payments.map(p => (
                  <div key={p.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 13,
                  }}>
                    <div>
                      <span style={{ fontWeight: 500 }}>{p.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                      {p.invoiceNumber && <span style={{ color: C.faint, marginLeft: 8, fontSize: 11 }}>#{p.invoiceNumber}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{fmtD(p.amount)}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                        background: p.status === "paid" ? C.greenBg : p.status === "overdue" ? C.redBg : C.amberBg,
                        color: p.status === "paid" ? C.green : p.status === "overdue" ? C.red : C.amber,
                      }}>
                        {p.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Terms */}
            {project.paymentTerms && (
              <div style={{ fontSize: 11, color: C.faint, marginTop: 12 }}>
                Terms: {project.paymentTerms.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              </div>
            )}
          </div>
        )}

        {/* ── Activity Timeline ── */}
        {activity.length > 0 && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: isMobile ? "16px" : "20px 24px",
          }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Updates</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activity.map((a, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  padding: "6px 0", borderBottom: i < activity.length - 1 ? `1px solid ${C.border}` : "none",
                }}>
                  <span style={{ fontSize: 12, color: C.text, lineHeight: 1.4, paddingRight: 12 }}>{a.message}</span>
                  <span style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{timeAgo(a.date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ textAlign: "center", marginTop: 40, fontSize: 11, color: C.faint }}>
          Powered by House Party Distro
        </div>
      </div>

      {/* ── Proof Preview Modal ── */}
      {viewingProof && (
        <div onClick={() => setViewingProof(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.card, borderRadius: 16, maxWidth: 640, width: "100%",
            maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }}>
            {/* Header */}
            <div style={{
              padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{viewingProof.fileName}</div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{viewingProof.stage === "mockup" ? "Mockup" : "Print Proof"}</div>
              </div>
              <button onClick={() => setViewingProof(null)} style={{
                background: "none", border: "none", fontSize: 22, color: C.faint, cursor: "pointer",
              }}>&times;</button>
            </div>

            {/* Content — images inline, PDFs in iframe */}
            <div style={{ padding: 20, textAlign: "center" }}>
              {/\.pdf$/i.test(viewingProof.fileName) ? (
                <iframe
                  src={`/api/files/thumbnail?id=${viewingProof.driveFileId}`}
                  style={{ width: "100%", height: "65vh", border: "none", borderRadius: 8 }}
                />
              ) : (
                <img
                  src={`/api/files/thumbnail?id=${viewingProof.driveFileId}`}
                  alt={viewingProof.fileName}
                  style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 8, objectFit: "contain" }}
                />
              )}
            </div>

            {/* Action buttons */}
            {(viewingProof.approval === "pending" || viewingProof.approval === "revision_requested") && (
              <div style={{
                padding: "16px 20px", borderTop: `1px solid ${C.border}`,
                display: "flex", gap: 10, justifyContent: "center",
              }}>
                <button
                  onClick={async () => {
                    await doAction("approve-proof", { fileId: viewingProof.id });
                    setViewingProof(null);
                  }}
                  disabled={actionLoading === `approve-proof${viewingProof.id}`}
                  style={{
                    padding: "12px 32px", borderRadius: 10,
                    background: C.green, color: "#fff", border: "none",
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                    opacity: actionLoading ? 0.6 : 1,
                  }}>
                  Approve
                </button>
                <button
                  onClick={() => { setShowRevisionInput(viewingProof.id); setViewingProof(null); }}
                  style={{
                    padding: "12px 32px", borderRadius: 10,
                    background: "transparent", color: C.red, border: `1px solid ${C.redBorder}`,
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                  }}>
                  Request Changes
                </button>
              </div>
            )}

            {/* Approved state */}
            {viewingProof.approval === "approved" && (
              <div style={{
                padding: "16px 20px", borderTop: `1px solid ${C.border}`,
                textAlign: "center", fontSize: 14, fontWeight: 600, color: C.green,
              }}>
                Approved {viewingProof.approvedAt ? fmtDate(viewingProof.approvedAt) : ""}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
