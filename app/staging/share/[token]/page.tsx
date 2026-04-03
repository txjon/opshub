"use client";
import { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Pending: { bg: T.amberDim, text: T.amber },
  Approved: { bg: T.greenDim, text: T.green },
  "Changes Requested": { bg: "#3d2a08", text: "#f5a623" },
  Rejected: { bg: T.redDim, text: T.red },
  "In Production": { bg: T.accentDim, text: T.accent },
  "LANDED": { bg: T.greenDim, text: T.green },
  "On Hold": { bg: T.redDim, text: T.red },
  "Locating a Source": { bg: "#2d1f5e", text: T.purple },
  "Reference Sample Sent to Factory": { bg: "#2d1f5e", text: T.purple },
  "NEED REVISIONS - SWATCHES WORKING": { bg: T.amberDim, text: T.amber },
  "Done - Awaiting Shipping": { bg: T.greenDim, text: T.green },
};

const fmtD = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const HPD_LOGO = `<svg width="160" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227.14 28.53"><g><path fill="#e8eaf2" d="M15.48,14.1v8.5c0,.13-.11.24-.24.24h-4.51c-.13,0-.24-.11-.24-.24v-8.27c0-.56-.03-1.2-.27-1.72-.11-.22-.25-.4-.42-.54-.28-.22-.65-.33-1.12-.33-.87,0-1.54.3-1.76.78-.24.52-.24,1.24-.24,1.81v8.27c0,.13-.11.24-.24.24H1.93c-.13,0-.24-.11-.24-.24V3.21c0-.13.11-.24.24-.24h4.22c.13,0,.24.11.24.24v5.17c0,.1.11.15.19.1,3.4-2.34,6.72.26,6.75.29.12.09.24.2.34.3h0c1.54,1.55,1.8,2.81,1.8,5.03Z"/><path fill="#e8eaf2" d="M31.55,15.4c0,4.36-3.6,7.91-8.02,7.91s-8.02-3.55-8.02-7.91,3.6-7.91,8.02-7.91,8.02,3.55,8.02,7.91ZM27.02,15.4c0-1.9-1.57-3.45-3.5-3.45s-3.5,1.55-3.5,3.45,1.57,3.45,3.5,3.45,3.5-1.55,3.5-3.45Z"/><path fill="#e8eaf2" d="M45.34,7.97v14.63c0,.13-.11.24-.24.24h-4.22c-.13,0-.24-.11-.24-.24v-.41c0-.1-.11-.15-.19-.1-1.06.73-2.1.98-3.04.98-2.1,0-3.68-1.24-3.71-1.26-.12-.09-.24-.2-.34-.3h0c-1.54-1.55-1.8-2.81-1.8-5.03V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24v8.27c0,.56.03,1.2.27,1.72.11.22.25.4.42.54.28.22.65.33,1.12.33.87,0,1.54-.3,1.76-.78.24-.52.24-1.24.24-1.81V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24Z"/><path fill="#e8eaf2" d="M57.67,18.33c-.04.53-.17,1.09-.41,1.67-.9,1.93-2.99,3.07-5.59,3.07-.36,0-.73-.02-1.1-.07-1.17-.14-2.19-.45-3.04-.92-.87-.59-1.54-1.42-1.99-2.46-.06-.14.02-.3.17-.33l4.14-.89c.1-.02.2.02.25.1.29.43.78.64,1.05.68.63.08.96-.09,1.13-.25.17-.16.24-.37.21-.6-.07-.52-.38-.77-1.98-1.53h-.02c-.32-.16-.72-.35-1.16-.57-.31-.13-.6-.28-.88-.42h-.02s-.08-.06-.12-.08c-1.44-.82-2.28-1.83-2.49-2.98-.31-1.65.75-3.05.97-3.31.32-.36.69-.68,1.11-.95,1.26-.8,2.88-1.13,4.56-.94,1.01.12,1.93.39,2.73.81.38.2.73.43,1.05.7.22.19.89.86,1.1,1.89.03.13-.06.26-.19.28l-4.07.82c-.12.02-.23-.04-.27-.15-.11-.28-.37-.57-.9-.63-.36-.04-.68.06-.89.29-.16.17-.22.39-.17.56.08.27.36.7,1.88,1.32.3.12.58.23.86.34.35.13.7.26,1.02.4h0c.97.45,3.21,1.76,3.07,4.15Z"/><path fill="#e8eaf2" d="M73.45,15.4c0,.44-.05.95-.13,1.4-.02.12-.12.2-.24.2h-10.58c-.19,0-.3.2-.21.37.65,1.1,1.81,1.79,3.1,1.79,1.09,0,2.11-.48,2.84-1.41.06-.07.15-.11.23-.09l4.05.73c.16.03.24.2.18.34-.09.19-.21.43-.27.54h0c-.06.1-.13.21-.2.32-.09.14-.18.27-.27.38l-.05.07c-.06.07-.11.13-.17.2l-.05.06c-.09.1-.18.2-.28.3l-.05.06c-.06.06-.13.13-.19.19l-.02.02c-.07.07-.14.13-.22.2l-.08.07c-.11.1-.22.18-.33.26l-.09.07c-.12.09-.25.18-.38.26l-.04.02c-.15.1-.3.19-.45.27l-.04.02s-.07.04-.11.06h-.03c-.07.05-.13.08-.2.11l-.04.02c-.14.07-.28.13-.41.18h-.03l-.25.11-.1.04-.3.1h-.02l-.35.11-.09.02c-.23.06-.46.1-.69.14h-.09c-.24.05-.48.07-.72.09h-.09l-.37.01-.37,0c-.03,0-.06,0-.08,0h-.03l-.27-.02h-.03s-.05,0-.08,0c-.13-.01-.25-.03-.35-.04h0l-.1-.02-.45-.08-.16-.03-.4-.09h-.04s-.05-.02-.08-.03c-.13-.03-.24-.06-.34-.1l-.34-.11c-.03,0-.05-.02-.08-.03h-.02l-.24-.1h-.02s-.05-.03-.07-.04l-.32-.14h-.01l-.3-.16c-.02-.01-.05-.03-.07-.04h-.02l-.22-.14-.09-.05-.29-.18c-.96-.64-1.78-1.49-2.38-2.46l-.15-.25-.02-.04-.13-.24-.02-.05s-.03-.05-.04-.07c-.15-.31-.29-.64-.4-.98l-.15-.5-.09-.38c-.08-.39-.13-.79-.15-1.19l-.01-.41,0-.41c.04-.7.17-1.4.39-2.07l.23-.6.14-.31c.01-.02.02-.05.04-.07l.03-.06s.02-.05.04-.07l.04-.07.07-.13c.06-.1.11-.2.17-.3.6-.97,1.42-1.82,2.38-2.46l.29-.18.09-.05.22-.13h.02s.05-.04.07-.05l.31-.16.32-.14c.02-.01.05-.02.07-.03h.02l.24-.1h.02s.05-.03.08-.04l.33-.11.34-.1c.02,0,.05-.01.08-.02h.03l.26-.07h.06l.38-.08h.02l.35-.04c.03,0,.05,0,.08,0h.03l.27-.02h.02s.06,0,.09,0l.37,0,.37,0h.09l.72.08h.1l.68.15.1.03.34.1h.02l.3.11.09.03.25.1.04.02.41.18.04.02.19.1h.02l.49.29h.02l.4.28.02.02s.05.04.08.06l.33.26.06.05.25.22.02.02.19.19.05.05.28.3.04.05.16.19.05.06.18.23h0l.14.21.09.13.11.18.15.25h0c.3.52.54,1.08.7,1.64.22.73.33,1.48.33,2.23ZM68.72,13.4c-.19-1.11-1.48-1.98-3.11-1.98-1.49,0-2.9.86-3.11,1.98-.03.15.09.29.24.29h5.75c.15,0,.26-.14.24-.28Z"/></g><g><path fill="#e8eaf2" d="M96.76,14.82c0,4.68-3.86,8.48-8.6,8.48-1.5,0-2.97-.39-4.27-1.12-.09-.05-.19.01-.19.11v5.59c0,.14-.12.26-.26.26h-4.52c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.49c0,.1.11.16.19.11,1.3-.73,2.76-1.12,4.27-1.12,4.74,0,8.6,3.8,8.6,8.48ZM91.33,14.82c0-2.14-1.77-3.89-3.94-3.89s-3.68,1.74-3.68,3.89,1.51,3.89,3.68,3.89,3.94-1.74,3.94-3.89Z"/><path fill="#e8eaf2" d="M114.9,6.85v15.68c0,.14-.12.26-.26.26h-4.53c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.19-.11-1.3.73-2.76,1.12-4.27,1.12-4.74,0-8.6-3.8-8.6-8.48s3.86-8.48,8.6-8.48c1.5,0,2.97.39,4.27,1.12.09.05.19-.01.19-.11v-.49c0-.14.12-.26.26-.26h4.53c.14,0,.26.12.26.26ZM109.86,14.82c0-2.14-1.51-3.89-3.68-3.89s-3.94,1.74-3.94,3.89,1.77,3.89,3.94,3.89,3.68-1.74,3.68-3.89Z"/><path fill="#e8eaf2" d="M124.28,6.87l-.15,3.79c0,.15-.13.26-.28.25-.44-.04-1.33-.1-1.85.03-.58.14-.92.59-1.02.81-.26.56-.26,1.06-.26,1.68v9.11c0,.14-.12.26-.26.26h-4.83c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.45c0,.1.11.16.2.11,1.07-.67,2.34-.81,3.41-.82.15,0,.27.12.26.27Z"/><path fill="#e8eaf2" d="M134.26,18.88l-.58,3.83c-.02.12-.12.21-.24.22-.56.03-2.04.12-2.49.12-.04,0-.07,0-.09,0-2.75-.14-4.2-1.56-4.2-4.08v-7.77c0-.14-.12-.26-.26-.26h-1.68c-.14,0-.26-.12-.26-.26v-3.83c0-.14.12-.26.26-.26h1.68c.14,0,.26-.12.26-.26V1.88c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v4.44c0,.14.12.26.26.26h1.68c.14,0,.26.12.26.26v3.83c0,.14-.12.26-.26.26h-1.68c-.14,0-.26.11-.26.26,0,1.34,0,5.32,0,5.36v.11c-.02.49-.04,1.17.35,1.57.23.24.59.36,1.07.36h.88c.16,0,.28.14.26.3Z"/><path fill="#e8eaf2" d="M150.4,6.95l-5.1,14.17-2.37,6.74c-.04.1-.13.17-.24.17h-5.03c-.18,0-.3-.17-.25-.34l1.97-5.84c.02-.06.02-.12,0-.17l-5.39-14.72c-.06-.17.06-.35.24-.35h4.51c.11,0,.21.07.24.17l2.95,7.98c.08.23.41.22.49,0l2.72-7.97c.04-.1.13-.18.25-.18h4.77c.18,0,.3.18.24.35Z"/><path fill="#e8eaf2" d="M171.26,1.54v21.08c0,.15-.12.26-.26.26h-4.59c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.2-.11-1.32.74-2.8,1.14-4.33,1.14-4.81,0-8.72-3.86-8.72-8.6s3.91-8.6,8.72-8.6c1.53,0,3.01.39,4.33,1.13.09.05.2-.01.2-.11V1.54c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26ZM166.14,14.79c0-2.18-1.53-3.95-3.74-3.95s-4,1.77-4,3.95,1.79,3.95,4,3.95,3.74-1.77,3.74-3.95Z"/><path fill="#e8eaf2" d="M176.51,6.46h-4.59c-.15,0-.26.12-.26.26v15.9c0,.14.12.26.26.26h4.59c.15,0,.26-.12.26-.26V6.72c0-.15-.12-.26-.26-.26ZM176.71,1.38s0-.02-.02-.02c-1.55-.11-5.01,2.17-4.97,3.72,0,0,.01.01.02.02.04.04.11.07.17.07h4.59c.15,0,.26-.12.26-.26V1.54c0-.06-.02-.12-.06-.17Z"/><path fill="#e8eaf2" d="M189.79,17.99c-.04.57-.19,1.19-.44,1.82-.98,2.09-3.25,3.34-6.08,3.34-.39,0-.79-.02-1.19-.07-1.27-.15-2.38-.49-3.3-1.01-.95-.64-1.67-1.54-2.16-2.67-.07-.15.02-.33.19-.36l4.5-.97c.11-.02.21.02.27.11.32.47.85.7,1.14.73.69.08,1.05-.1,1.22-.27.18-.17.26-.4.23-.66-.07-.57-.41-.83-2.15-1.66h-.02c-.35-.18-.78-.38-1.26-.62-.33-.14-.66-.3-.96-.46l-.03-.02s-.09-.05-.13-.08c-1.56-.9-2.47-1.99-2.71-3.24-.34-1.79.82-3.31,1.05-3.6.35-.39.75-.74,1.21-1.03,1.37-.87,3.13-1.23,4.96-1.02,1.1.13,2.1.43,2.96.88.41.22.8.47,1.14.76.24.21.97.94,1.2,2.05.03.14-.07.28-.21.31l-4.43.9c-.13.02-.25-.05-.29-.16-.12-.31-.4-.62-.98-.69-.39-.05-.74.07-.96.32-.17.19-.24.42-.19.61.08.29.39.76,2.04,1.44.33.13.63.24.93.37.38.14.76.29,1.11.44h0c1.05.49,3.48,1.92,3.34,4.51Z"/><path fill="#e8eaf2" d="M199.29,18.92l-.59,3.89c-.02.12-.12.22-.24.22-.56.03-2.07.12-2.53.12-.04,0-.07,0-.09,0-2.79-.15-4.26-1.58-4.26-4.14v-7.89c0-.14-.12-.26-.26-.26h-1.71c-.14,0-.26-.12-.26-.26v-3.89c0-.14.12-.26.26-.26h1.71c.14,0,.26-.12.26-.26V1.67c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26v4.51c0,.14.12.26.26.26h1.71c.14,0,.26.12.26.26v3.89c0,.14-.12.26-.26.26h-1.71c-.14,0-.26.12-.26.26,0,1.36,0,5.39,0,5.44v.11c-.02.5-.04,1.18.36,1.59.23.24.6.36,1.09.36h.89c.16,0,.28.14.26.3Z"/><path fill="#e8eaf2" d="M208.56,6.73l-.16,3.84c0,.15-.14.26-.29.25-.45-.04-1.35-.1-1.88.03-.59.14-.93.6-1.03.82-.27.57-.27,1.07-.27,1.71v9.25c0,.14-.12.26-.26.26h-4.9c-.15,0-.26-.12-.26-.26V6.72c0-.14.12-.26.26-.26h4.59c.15,0,.26.12.26.26v.46c0,.1.11.17.2.11,1.09-.68,2.38-.82,3.46-.83.15,0,.27.12.27.27Z"/><path fill="#e8eaf2" d="M225.19,14.8c0,4.74-3.91,8.6-8.72,8.6s-8.72-3.86-8.72-8.6,3.91-8.6,8.72-8.6,8.72,3.86,8.72,8.6ZM220.27,14.8c0-2.07-1.71-3.75-3.8-3.75s-3.8,1.68-3.8,3.75,1.71,3.75,3.8,3.75,3.8-1.68,3.8-3.75Z"/></g></svg>`;

export default function SharePage({ params }: { params: { token: string } }) {
  const [password, setPassword] = useState("");
  const [board, setBoard] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [galleryItem, setGalleryItem] = useState<any>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  async function verify() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/staging/share/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) {
        setBoard(data);
      } else {
        setError(data.error || "Access denied");
      }
    } catch {
      setError("Something went wrong");
    }
    setLoading(false);
  }

  // Password screen
  if (!board) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 32, width: 360, textAlign: "center" }}>
          <div dangerouslySetInnerHTML={{ __html: HPD_LOGO }} style={{ marginBottom: 20 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>Staging Board</div>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 20 }}>Enter the password to view</div>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && verify()}
            placeholder="Password"
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, outline: "none", fontFamily: font, boxSizing: "border-box", marginBottom: 12, textAlign: "center" }}
            autoFocus />
          {error && <div style={{ fontSize: 12, color: T.red, marginBottom: 8 }}>{error}</div>}
          <button onClick={verify} disabled={loading}
            style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: loading ? 0.5 : 1 }}>
            {loading ? "Verifying..." : "View Board"}
          </button>
        </div>
      </div>
    );
  }

  // Board view (read-only)
  const items = board.items || [];
  const totals = items.reduce((acc: any, it: any) => {
    const qty = it.qty || 0;
    const cost = qty * (parseFloat(it.unit_cost) || 0);
    const gross = qty * (parseFloat(it.retail) || 0);
    return { cost: acc.cost + cost, gross: acc.gross + gross };
  }, { cost: 0, gross: 0 });
  const profit = totals.gross - totals.cost;

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sortedItems = sortKey ? [...items].sort((a: any, b: any) => {
    let av: any, bv: any;
    const qa = a.qty || 0, qb = b.qty || 0;
    const uca = parseFloat(a.unit_cost) || 0, ucb = parseFloat(b.unit_cost) || 0;
    const ra = parseFloat(a.retail) || 0, rb = parseFloat(b.retail) || 0;
    switch (sortKey) {
      case "item_name": av = (a.item_name || "").toLowerCase(); bv = (b.item_name || "").toLowerCase(); break;
      case "qty": av = qa; bv = qb; break;
      case "total_cost": av = qa * uca; bv = qb * ucb; break;
      case "gross": av = qa * ra; bv = qb * rb; break;
      case "profit": av = qa * ra - qa * uca; bv = qb * rb - qb * ucb; break;
      case "status": av = (a.status || "").toLowerCase(); bv = (b.status || "").toLowerCase(); break;
      default: return 0;
    }
    const r = typeof av === "string" ? av.localeCompare(bv) : (av - bv);
    return sortDir === "asc" ? r : -r;
  }) : items;

  const SortTh = ({ col, label, style: s }: { col: string; label: string; style?: any }) => {
    const active = sortKey === col;
    return (
      <th onClick={() => toggleSort(col)} style={{ ...s, padding: "8px 6px", fontSize: 10, color: active ? T.accent : T.muted, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", cursor: "pointer", userSelect: "none" as const }}>
        {label}{active && <span style={{ marginLeft: 3, fontSize: 8 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
      </th>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: font, color: T.text }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div dangerouslySetInnerHTML={{ __html: HPD_LOGO }} style={{ marginBottom: 8 }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{board.name}</h1>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{board.client_name}</div>
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexDirection: isMobile ? "column" : "row" }}>
          {[
            { label: "Total Cost", value: fmtD(totals.cost), color: T.text },
            { label: "Total Retail", value: fmtD(totals.gross), color: T.accent },
            { label: "Total Profit", value: fmtD(profit), color: profit >= 0 ? T.green : T.red },
          ].map(s => (
            <div key={s.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: isMobile ? "8px 12px" : "10px 16px", flex: 1, display: isMobile ? "flex" : "block", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
              <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, color: s.color, fontFamily: mono }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Items (read-only) */}
        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((item: any, idx: number) => {
              const qty = item.qty || 0;
              const unitCost = parseFloat(item.unit_cost) || 0;
              const retail = parseFloat(item.retail) || 0;
              const gross = qty * retail;
              const itemProfit = gross - qty * unitCost;
              const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;
              return (
                <div key={item.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {item.images?.[0]?.url ? (
                      <img src={item.images[0].url} onClick={() => setGalleryItem(item)}
                        style={{ width: 50, height: 50, borderRadius: 6, objectFit: "cover", border: `1px solid ${T.border}`, flexShrink: 0, cursor: "pointer" }} />
                    ) : (
                      <div style={{ width: 50, height: 50, borderRadius: 6, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.item_name || "—"}</div>
                      <div style={{ display: "flex", gap: 10, marginTop: 3, fontSize: 11 }}>
                        <span style={{ color: T.muted, fontFamily: mono }}>{qty || "—"} qty</span>
                        {gross > 0 && <span style={{ color: T.accent, fontFamily: mono }}>{fmtD(gross)}</span>}
                        {gross > 0 && <span style={{ color: itemProfit >= 0 ? T.green : T.red, fontFamily: mono }}>{fmtD(itemProfit)}</span>}
                      </div>
                    </div>
                    <span style={{ padding: "2px 6px", borderRadius: 99, fontSize: 9, fontWeight: 600, background: sc.bg, color: sc.text, flexShrink: 0 }}>{item.status || "Pending"}</span>
                  </div>
                  {item.notes && <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>{item.notes}</div>}
                </div>
              );
            })}
          </div>
        ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surface }}>
                <th style={{ padding: "8px 6px", width: 90 }} />
                <SortTh col="item_name" label="Item" style={{ textAlign: "left", padding: "8px 10px" }} />
                <SortTh col="qty" label="QTY" style={{ textAlign: "center", width: 60 }} />
                <SortTh col="total_cost" label="Cost" style={{ textAlign: "center", width: 80 }} />
                <SortTh col="gross" label="Gross" style={{ textAlign: "center", width: 80 }} />
                <SortTh col="profit" label="Profit" style={{ textAlign: "center", width: 80 }} />
                <SortTh col="status" label="Status" style={{ textAlign: "center", width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item: any, idx: number) => {
                const qty = item.qty || 0;
                const unitCost = parseFloat(item.unit_cost) || 0;
                const retail = parseFloat(item.retail) || 0;
                const totalCost = qty * unitCost;
                const gross = qty * retail;
                const itemProfit = gross - totalCost;
                const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;

                return (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: "4px" }}>
                      <div style={{ width: 80, height: 52, borderRadius: 6, overflow: "hidden", cursor: item.images?.length ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", background: T.surface, border: `1px solid ${T.border}`, position: "relative" }}
                        onClick={() => item.images?.length && setGalleryItem(item)}>
                        {item.images?.[0]?.url ? (
                          <img src={item.images[0].url} style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : null}
                        {item.images?.length > 1 && (
                          <span style={{ position: "absolute", bottom: 2, right: 2, fontSize: 8, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 3, padding: "0 3px" }}>+{item.images.length - 1}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{item.item_name || "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono }}>{qty || "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono, color: T.muted }}>{totalCost > 0 ? fmtD(totalCost) : "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono, color: T.accent }}>{gross > 0 ? fmtD(gross) : "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono, color: itemProfit >= 0 ? T.green : T.red }}>{gross > 0 ? fmtD(itemProfit) : "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 600, background: sc.bg, color: sc.text }}>{item.status || "Pending"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: T.faint }}>House Party Distro · housepartydistro.com</div>
      </div>

      {/* Image gallery modal */}
      {galleryItem && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setGalleryItem(null); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 600, maxWidth: "90vw", maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{galleryItem.item_name || "Item"}</div>
              <button onClick={() => setGalleryItem(null)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {(galleryItem.images || []).map((img: any) => (
                <img key={img.id} src={img.url} style={{ width: "100%", borderRadius: 8, border: `1px solid ${T.border}` }} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
