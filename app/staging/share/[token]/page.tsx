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
  const [moodExpanded, setMoodExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, any[]>>({});
  const [msgInput, setMsgInput] = useState<Record<string, string>>({});
  const [clientName, setClientName] = useState("");
  const [activeTab, setActiveTab] = useState<"items" | "production" | "landed">("items");
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

  async function loadMessages(itemId: string) {
    if (!board) return;
    const res = await fetch(`/api/staging/boards/${board.id}/items/${itemId}/messages?share=${params.token}`);
    const data = await res.json();
    if (Array.isArray(data)) setMessages(prev => ({ ...prev, [itemId]: data }));
  }

  async function sendMessage(itemId: string) {
    if (!board) return;
    const text = msgInput[itemId]?.trim();
    if (!text) return;
    const res = await fetch(`/api/staging/boards/${board.id}/items/${itemId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, share_token: params.token, sender_name: clientName || "Client" }),
    });
    const msg = await res.json();
    if (msg.id) {
      setMessages(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), msg] }));
      setMsgInput(prev => ({ ...prev, [itemId]: "" }));
    }
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

  const productionCount = items.filter((it: any) => it.status === "In Production").length;
  const landedCount = items.filter((it: any) => it.status === "LANDED").length;
  const tabItems = activeTab === "items"
    ? items.filter((it: any) => it.status !== "In Production" && it.status !== "LANDED")
    : activeTab === "production"
    ? items.filter((it: any) => it.status === "In Production")
    : items.filter((it: any) => it.status === "LANDED");

  const calc = (list: any[]) => list.reduce((acc: any, it: any) => {
    const qty = it.qty || 0;
    const cost = qty * (parseFloat(it.unit_cost) || 0);
    const gross = qty * (parseFloat(it.retail) || 0);
    return { cost: acc.cost + cost, gross: acc.gross + gross, count: acc.count + 1, qty: acc.qty + qty };
  }, { cost: 0, gross: 0, count: 0, qty: 0 });

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: font, color: T.text }}>
      {/* Sticky header: KPI + tabs */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: T.bg, borderBottom: `1px solid ${T.border}`, paddingBottom: 8 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }}>
          {/* Logo + title */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div dangerouslySetInnerHTML={{ __html: HPD_LOGO }} style={{ marginBottom: 4 }} />
              <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: 0 }}>{board.name}</h1>
              <div style={{ fontSize: 12, color: T.muted }}>{board.client_name}</div>
            </div>
          </div>

          {/* KPI table */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 10, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 10 : 11, minWidth: isMobile ? 360 : "auto" }}>
              <thead>
                <tr style={{ background: T.surface }}>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontSize: 8, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Phase</th>
                  <th style={{ padding: "4px 4px", textAlign: "center", fontSize: 8, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Items</th>
                  <th style={{ padding: "4px 4px", textAlign: "center", fontSize: 8, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Qty</th>
                  <th style={{ padding: "4px 4px", textAlign: "right", fontSize: 8, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Cost</th>
                  <th style={{ padding: "4px 4px", textAlign: "right", fontSize: 8, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Gross</th>
                  <th style={{ padding: "4px 8px", textAlign: "right", fontSize: 8, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Profit</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Pending", ...calc(items.filter((it: any) => it.status !== "In Production" && it.status !== "LANDED")), color: T.amber },
                  { label: "In Production", ...calc(items.filter((it: any) => it.status === "In Production")), color: T.accent },
                  { label: "Landed", ...calc(items.filter((it: any) => it.status === "LANDED")), color: T.green },
                  { label: "Total", ...calc(items), color: T.text },
                ].map((r: any) => {
                  const p = r.gross - r.cost;
                  const isTotal = r.label === "Total";
                  return (
                    <tr key={r.label} style={{ borderTop: isTotal ? `1px solid ${T.border}` : undefined, background: isTotal ? T.surface : "transparent" }}>
                      <td style={{ padding: "3px 8px", fontWeight: isTotal ? 700 : 600, color: r.color, fontSize: isMobile ? 10 : 11 }}>{r.label}</td>
                      <td style={{ padding: "3px 4px", textAlign: "center", fontFamily: mono, color: T.faint, fontSize: 10 }}>{r.count}</td>
                      <td style={{ padding: "3px 4px", textAlign: "center", fontFamily: mono, color: r.qty > 0 ? T.text : T.faint, fontWeight: isTotal ? 700 : 400 }}>{r.qty > 0 ? r.qty.toLocaleString() : "—"}</td>
                      <td style={{ padding: "3px 4px", textAlign: "right", fontFamily: mono, color: r.cost > 0 ? T.muted : T.faint }}>{r.cost > 0 ? fmtD(r.cost) : "—"}</td>
                      <td style={{ padding: "3px 4px", textAlign: "right", fontFamily: mono, color: r.gross > 0 ? T.text : T.faint, fontWeight: isTotal ? 700 : 400 }}>{r.gross > 0 ? fmtD(r.gross) : "—"}</td>
                      <td style={{ padding: "3px 8px", textAlign: "right", fontFamily: mono, color: r.gross > 0 ? (p >= 0 ? T.green : T.red) : T.faint, fontWeight: isTotal ? 700 : 400 }}>{r.gross > 0 ? fmtD(p) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Tab pills */}
          <div style={{ display: "flex", gap: 4, background: T.surface, borderRadius: 8, padding: 3, width: isMobile ? "100%" : "fit-content" }}>
            {([
              { key: "items" as const, label: "Pending", count: items.length - productionCount - landedCount },
              { key: "production" as const, label: "In Production", count: productionCount },
              { key: "landed" as const, label: "Landed", count: landedCount },
            ]).map(tab => {
              const active = activeTab === tab.key;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  style={{
                    flex: isMobile ? 1 : undefined,
                    padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                    fontSize: 12, fontWeight: 600, fontFamily: font,
                    background: active ? T.card : "transparent",
                    color: active ? T.text : T.muted,
                    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                  }}>
                  {tab.label}
                  {tab.count > 0 && <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.7 }}>{tab.count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px" }}>
        {/* ── Mood Board ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
          gap: 12, marginBottom: 24,
        }}>
          {tabItems.map((item: any) => {
            const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;
            const imgUrl = item.images?.[0]?.url;
            const isOpen = moodExpanded === item.id;
            const msgCount = messages[item.id]?.length || 0;

            return (
              <div key={item.id}
                onClick={() => {
                  setMoodExpanded(isOpen ? null : item.id);
                  if (!isOpen && !messages[item.id]) loadMessages(item.id);
                }}
                style={{
                  background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
                  overflow: "hidden", cursor: "pointer",
                }}>
                <div style={{
                  width: "100%", aspectRatio: "1", background: T.surface,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative", overflow: "hidden",
                }}>
                  {imgUrl ? (
                    <img src={imgUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ color: T.faint, fontSize: 11 }}>No image</span>
                  )}
                  {item.images?.length > 1 && (
                    <span style={{ position: "absolute", top: 6, right: 6, fontSize: 9, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 4, padding: "1px 5px" }}>+{item.images.length - 1}</span>
                  )}
                  {msgCount > 0 && (
                    <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 11, background: T.accent, color: "#fff", borderRadius: 6, padding: "2px 8px", fontWeight: 700, boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>{msgCount} msg</span>
                  )}
                  <span style={{ position: "absolute", top: 6, left: 6, padding: "1px 6px", borderRadius: 99, fontSize: 8, fontWeight: 600, background: sc.bg, color: sc.text }}>{item.status || "Pending"}</span>
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.item_name || "Untitled"}</div>
                  {item.notes && <div style={{ fontSize: 10, color: T.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.notes}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Item Modal ── */}
        {moodExpanded && (() => {
          const item = items.find((it: any) => it.id === moodExpanded);
          if (!item) return null;
          const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;
          const itemMsgs = messages[item.id] || [];

          return (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
              onClick={e => { if (e.target === e.currentTarget) setMoodExpanded(null); }}>
            <div style={{
              background: T.card, border: `1px solid ${T.border}`,
              borderRadius: 12, overflow: "auto",
              width: 1000, maxWidth: "95vw", maxHeight: "90vh",
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", minHeight: isMobile ? "auto" : 500 }}>
                {/* Images */}
                <div style={{ width: isMobile ? "100%" : 380, flexShrink: 0, background: T.surface, padding: 16 }}>
                  {item.images?.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <img src={item.images[0].url} alt="" style={{ width: "100%", borderRadius: 8, cursor: "pointer" }}
                        onClick={() => setGalleryItem(item)} />
                      {item.images.length > 1 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {item.images.slice(1).map((img: any) => (
                            <img key={img.id} src={img.url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, cursor: "pointer", border: `1px solid ${T.border}` }}
                              onClick={() => setGalleryItem(item)} />
                          ))}
                        </div>
                      )}
                      <label style={{ display: "inline-block", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 10, color: T.muted, cursor: "pointer", fontFamily: font, textAlign: "center" }}>
                        + Upload Photo
                        <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={async e => {
                          for (const file of Array.from(e.target.files || [])) {
                            const formData = new FormData();
                            formData.append("file", file);
                            const res = await fetch(`/api/staging/boards/${board.id}/items/${item.id}/images?share=${params.token}`, { method: "POST", body: formData });
                            const img = await res.json();
                            if (img.id) {
                              setBoard((b: any) => ({ ...b, items: b.items.map((it: any) => it.id === item.id ? { ...it, images: [...(it.images || []), img] } : it) }));
                            }
                          }
                        }} />
                      </label>
                    </div>
                  ) : (
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, borderRadius: 8, border: `1px dashed ${T.border}`, cursor: "pointer", color: T.faint, fontSize: 12, fontFamily: font, flexDirection: "column", gap: 4 }}>
                      Drop or click to upload
                      <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={async e => {
                        for (const file of Array.from(e.target.files || [])) {
                          const formData = new FormData();
                          formData.append("file", file);
                          const res = await fetch(`/api/staging/boards/${board.id}/items/${item.id}/images?share=${params.token}`, { method: "POST", body: formData });
                          const img = await res.json();
                          if (img.id) {
                            setBoard((b: any) => ({ ...b, items: b.items.map((it: any) => it.id === item.id ? { ...it, images: [...(it.images || []), img] } : it) }));
                          }
                        }
                      }} />
                    </label>
                  )}
                </div>

                {/* Details + Messages */}
                <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{item.item_name || "Untitled"}</div>
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
                        <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 600, background: sc.bg, color: sc.text }}>{item.status || "Pending"}</span>
                      </div>
                    </div>
                    <button onClick={() => setMoodExpanded(null)} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 22 }}>×</button>
                  </div>

                  {/* Read-only pricing details */}
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 8 }}>
                    {[
                      { label: "QTY", value: item.qty ? item.qty.toLocaleString() : "—" },
                      { label: "Unit Cost", value: item.unit_cost ? fmtD(parseFloat(item.unit_cost)) : "—" },
                      { label: "Retail", value: item.retail ? fmtD(parseFloat(item.retail)) : "—" },
                      { label: "Total", value: item.qty && item.retail ? fmtD(item.qty * parseFloat(item.retail)) : "—", bold: true },
                    ].map(f => (
                      <div key={f.label} style={{ background: T.surface, padding: "6px 8px", borderRadius: 6 }}>
                        <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{f.label}</div>
                        <div style={{ fontSize: 13, fontWeight: (f as any).bold ? 700 : 600, color: T.text, fontFamily: mono }}>{f.value}</div>
                      </div>
                    ))}
                  </div>

                  {item.notes && <div style={{ fontSize: 12, color: T.muted, padding: "6px 8px", background: T.surface, borderRadius: 6 }}>{item.notes}</div>}

                  {/* Messages thread */}
                  <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12, flex: 1, display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Messages</div>
                    <div style={{ flex: 1, minHeight: 180, maxHeight: 350, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                      {itemMsgs.length === 0 && <div style={{ fontSize: 13, color: T.faint }}>No messages yet</div>}
                      {itemMsgs.map((msg: any) => (
                        <div key={msg.id} style={{
                          padding: "8px 12px", borderRadius: 8, fontSize: 14,
                          background: msg.sender_type === "client" ? T.accentDim : T.surface,
                          alignSelf: msg.sender_type === "client" ? "flex-end" : "flex-start",
                          maxWidth: "85%",
                        }}>
                          <div style={{ fontSize: 10, color: T.muted, marginBottom: 2 }}>
                            {msg.sender_name || (msg.sender_type === "client" ? "Client" : "HPD")}
                            <span style={{ marginLeft: 6, fontSize: 9, color: T.faint }}>{new Date(msg.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                          </div>
                          <div style={{ color: T.text, lineHeight: 1.4 }}>{msg.message}</div>
                        </div>
                      ))}
                    </div>
                    {/* Client name + input */}
                    {!clientName && (
                      <input value={clientName} onChange={e => setClientName(e.target.value)}
                        placeholder="Your name"
                        style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, outline: "none", fontFamily: font, marginBottom: 8 }} />
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={msgInput[item.id] || ""} onChange={e => setMsgInput(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter") sendMessage(item.id); }}
                        placeholder="Type a message..."
                        style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, outline: "none", fontFamily: font }} />
                      <button onClick={() => sendMessage(item.id)}
                        style={{ padding: "10px 20px", borderRadius: 8, background: T.accent, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                        Send
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          );
        })()}


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
