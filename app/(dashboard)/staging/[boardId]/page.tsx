"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";

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

export default function BoardDetailPage({ params }: { params: { boardId: string } }) {
  const router = useRouter();
  const [board, setBoard] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [deleteItem, setDeleteItem] = useState<any>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"items" | "production" | "landed">("items");
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});
  const [galleryItem, setGalleryItem] = useState<any>(null);
  const [dragoverRow, setDragoverRow] = useState<string | null>(null);
  const [uploadingRow, setUploadingRow] = useState<string | null>(null);
  const [moodExpanded, setMoodExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, any[]>>({});
  const [msgInput, setMsgInput] = useState<Record<string, string>>({});
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [didDrag, setDidDrag] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const latestValues = useRef<Record<string, any>>({});

  useEffect(() => { loadBoard(); }, [params.boardId]);

  async function loadBoard() {
    const res = await fetch(`/api/staging/boards/${params.boardId}`);
    const data = await res.json();
    if (data.items) {
      setBoard(data);
      setItems(data.items);
      data.items.forEach((it: any) => { latestValues.current[it.id] = it; });
    }
    setLoading(false);
  }

  // Auto-save with debounce (same pattern as CostingTab)
  const saveItem = useCallback((itemId: string, updates: any) => {
    latestValues.current[itemId] = { ...latestValues.current[itemId], ...updates };
    setSaveStatus(p => ({ ...p, [itemId]: "saving" }));

    if (saveTimers.current[itemId]) clearTimeout(saveTimers.current[itemId]);
    saveTimers.current[itemId] = setTimeout(async () => {
      try {
        await fetch(`/api/staging/boards/${params.boardId}/items/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        setSaveStatus(p => ({ ...p, [itemId]: "saved" }));
      } catch {
        setSaveStatus(p => ({ ...p, [itemId]: "error" }));
      }
    }, 800);
  }, [params.boardId]);

  function updateItemLocal(itemId: string, field: string, value: any) {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, [field]: value } : it));
    saveItem(itemId, { [field]: value });
    // Auto-switch tab when status changes
    if (field === "status") {
      if (value === "In Production") setActiveTab("production");
      else if (value === "LANDED") setActiveTab("landed");
      else if (value !== "In Production" && value !== "LANDED") setActiveTab("items");
    }
  }

  async function addItem() {
    const res = await fetch(`/api/staging/boards/${params.boardId}/items`, { method: "POST" });
    const item = await res.json();
    if (item.id) {
      setItems(prev => [...prev, { ...item, images: [] }]);
      latestValues.current[item.id] = item;
    }
  }

  async function removeItem(itemId: string) {
    await fetch(`/api/staging/boards/${params.boardId}/items/${itemId}`, { method: "DELETE" });
    setItems(prev => prev.filter(it => it.id !== itemId));
    setDeleteItem(null);
  }

  async function uploadImage(itemId: string, file: File) {
    setUploadingRow(itemId);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/staging/boards/${params.boardId}/items/${itemId}/images`, {
      method: "POST", body: formData,
    });
    const img = await res.json();
    if (img.id) {
      setItems(prev => prev.map(it => it.id === itemId ? { ...it, images: [...(it.images || []), img] } : it));
    }
    setUploadingRow(null);
  }

  async function deleteImage(itemId: string, imageId: string) {
    await fetch(`/api/staging/boards/${params.boardId}/items/${itemId}/images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId }),
    });
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, images: (it.images || []).filter((img: any) => img.id !== imageId) } : it));
  }

  async function loadMessages(itemId: string) {
    const res = await fetch(`/api/staging/boards/${params.boardId}/items/${itemId}/messages`);
    const data = await res.json();
    if (Array.isArray(data)) setMessages(prev => ({ ...prev, [itemId]: data }));
  }

  async function sendMessage(itemId: string) {
    const text = msgInput[itemId]?.trim();
    if (!text) return;
    const res = await fetch(`/api/staging/boards/${params.boardId}/items/${itemId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const msg = await res.json();
    if (msg.id) {
      setMessages(prev => ({ ...prev, [itemId]: [...(prev[itemId] || []), msg] }));
      setMsgInput(prev => ({ ...prev, [itemId]: "" }));
    }
  }

  function handleMoodDrop(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const pending = items.filter(it => it.status !== "In Production" && it.status !== "LANDED");
    const reordered = [...pending];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // Update sort_order for all reordered items
    const updates = reordered.map((it, i) => ({ ...it, sort_order: i }));
    setItems(prev => {
      const nonPending = prev.filter(it => it.status === "In Production" || it.status === "LANDED");
      return [...updates, ...nonPending];
    });
    for (const it of updates) {
      saveItem(it.id, { sort_order: it.sort_order });
    }
  }

  function handleRowDrop(e: React.DragEvent, itemId: string) {
    e.preventDefault();
    setDragoverRow(null);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    for (const file of files) uploadImage(itemId, file);
  }

  function copyShareLink() {
    if (!board?.share_token) return;
    navigator.clipboard.writeText(`${window.location.origin}/staging/share/${board.share_token}`);
  }

  async function updateBoardName(name: string) {
    setBoard((b: any) => b ? { ...b, name } : b);
    await fetch(`/api/staging/boards/${params.boardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  const TAB_STATUSES: Record<string, string> = { production: "In Production", landed: "LANDED" };
  const tabItems = activeTab === "items"
    ? items.filter(it => it.status !== "In Production" && it.status !== "LANDED")
    : items.filter(it => it.status === TAB_STATUSES[activeTab]);
  const productionCount = items.filter(it => it.status === "In Production").length;
  const landedCount = items.filter(it => it.status === "LANDED").length;

  // Computed totals (reflect active tab)
  const totals = tabItems.reduce((acc, it) => {
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

  const filteredItems = search.trim() ? tabItems.filter(it => {
    const q = search.toLowerCase();
    return (it.item_name || "").toLowerCase().includes(q) || (it.notes || "").toLowerCase().includes(q) || (it.status || "").toLowerCase().includes(q);
  }) : tabItems;

  const sortedItems = sortKey ? [...filteredItems].sort((a, b) => {
    let av: any, bv: any;
    const qa = a.qty || 0, qb = b.qty || 0;
    const uca = parseFloat(a.unit_cost) || 0, ucb = parseFloat(b.unit_cost) || 0;
    const ra = parseFloat(a.retail) || 0, rb = parseFloat(b.retail) || 0;
    switch (sortKey) {
      case "item_name": av = (a.item_name || "").toLowerCase(); bv = (b.item_name || "").toLowerCase(); break;
      case "qty": av = qa; bv = qb; break;
      case "unit_cost": av = uca; bv = ucb; break;
      case "total_cost": av = qa * uca; bv = qb * ucb; break;
      case "retail": av = ra; bv = rb; break;
      case "gross": av = qa * ra; bv = qb * rb; break;
      case "profit": av = qa * ra - qa * uca; bv = qb * rb - qb * ucb; break;
      case "status": av = (a.status || "").toLowerCase(); bv = (b.status || "").toLowerCase(); break;
      case "notes": av = (a.notes || "").toLowerCase(); bv = (b.notes || "").toLowerCase(); break;
      case "eta": av = a.eta || "9999"; bv = b.eta || "9999"; break;
      default: return 0;
    }
    const r = typeof av === "string" ? av.localeCompare(bv) : (av - bv);
    return sortDir === "asc" ? r : -r;
  }) : filteredItems;

  const SortTh = ({ col, label, style: s }: { col: string; label: string; style?: any }) => {
    const active = sortKey === col;
    return (
      <th onClick={() => toggleSort(col)} style={{ ...s, padding: "8px 6px", fontSize: 10, color: active ? T.accent : T.muted, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", cursor: "pointer", userSelect: "none" as const }}>
        {label}{active && <span style={{ marginLeft: 3, fontSize: 8 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
      </th>
    );
  };

  const ic = { padding: "5px 8px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: mono, boxSizing: "border-box" as const };

  if (loading) return <div style={{ fontFamily: font, color: T.muted, padding: 20 }}>Loading...</div>;
  if (!board) return <div style={{ fontFamily: font, color: T.red, padding: 20 }}>Board not found</div>;

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      {/* Summary table */}
      {(() => {
        const calc = (list: any[]) => list.reduce((acc, it) => {
          const qty = it.qty || 0;
          const cost = qty * (parseFloat(it.unit_cost) || 0);
          const gross = qty * (parseFloat(it.retail) || 0);
          return { cost: acc.cost + cost, gross: acc.gross + gross, count: acc.count + 1, qty: acc.qty + qty };
        }, { cost: 0, gross: 0, count: 0, qty: 0 });
        const rows = [
          { label: "Pending", ...calc(items.filter(it => it.status !== "In Production" && it.status !== "LANDED")), color: T.amber },
          { label: "In Production", ...calc(items.filter(it => it.status === "In Production")), color: T.accent },
          { label: "Landed", ...calc(items.filter(it => it.status === "LANDED")), color: T.green },
          { label: "Total", ...calc(items), color: T.text },
        ];
        return (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 16, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: T.surface }}>
                  <th style={{ padding: "5px 10px", textAlign: "left", fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Phase</th>
                  <th style={{ padding: "5px 8px", textAlign: "center", fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", width: 40 }}>Items</th>
                  <th style={{ padding: "5px 8px", textAlign: "center", fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", width: 50 }}>Qty</th>
                  <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", width: 80 }}>Cost</th>
                  <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", width: 80 }}>Gross</th>
                  <th style={{ padding: "5px 10px", textAlign: "right", fontSize: 9, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", width: 80 }}>Profit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = r.gross - r.cost;
                  const isTotal = r.label === "Total";
                  return (
                    <tr key={r.label} style={{ borderTop: isTotal ? `1px solid ${T.border}` : undefined, background: isTotal ? T.surface : "transparent" }}>
                      <td style={{ padding: "4px 10px", fontWeight: isTotal ? 700 : 600, color: r.color }}>{r.label}</td>
                      <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: mono, color: r.count > 0 ? T.faint : T.faint, fontSize: 10 }}>{r.count}</td>
                      <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: mono, color: r.qty > 0 ? T.text : T.faint, fontWeight: isTotal ? 700 : 400 }}>{r.qty > 0 ? r.qty.toLocaleString() : "—"}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: mono, color: r.cost > 0 ? T.muted : T.faint }}>{r.cost > 0 ? fmtD(r.cost) : "—"}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: mono, color: r.gross > 0 ? T.text : T.faint, fontWeight: isTotal ? 700 : 400 }}>{r.gross > 0 ? fmtD(r.gross) : "—"}</td>
                      <td style={{ padding: "4px 10px", textAlign: "right", fontFamily: mono, color: r.gross > 0 ? (p >= 0 ? T.green : T.red) : T.faint, fontWeight: isTotal ? 700 : 400 }}>{r.gross > 0 ? fmtD(p) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={board.name} onChange={e => updateBoardName(e.target.value)}
          style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, color: T.text, background: "transparent", border: "none", outline: "none", fontFamily: font, flex: 1, minWidth: 120 }} />
        {!isMobile && <span style={{ fontSize: 12, color: T.muted }}>{board.client_name}</span>}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search..."
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, width: isMobile ? "100%" : 160 }} />
        {!isMobile && <>
          <button onClick={copyShareLink}
            style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontFamily: font }}>
            Copy Share Link
          </button>
          <button disabled style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.faint, fontSize: 11, padding: "6px 12px", cursor: "default", fontFamily: font }}>
            Create Project
          </button>
        </>}
      </div>

      {/* Tab pills */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, background: T.surface, borderRadius: 8, padding: 3, width: "fit-content" }}>
        {([
          { key: "items" as const, label: "Pending", count: items.length - productionCount - landedCount },
          { key: "production" as const, label: "In Production", count: productionCount },
          { key: "landed" as const, label: "Landed", count: landedCount },
        ]).map(tab => {
          const active = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600, fontFamily: font,
                background: active ? T.card : "transparent",
                color: active ? T.text : T.muted,
                boxShadow: active ? `0 1px 3px rgba(0,0,0,0.2)` : "none",
                transition: "all 0.15s",
              }}>
              {tab.label}
              {tab.count > 0 && <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.7 }}>{tab.count}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Mood Board (Pending tab) ── */}
      {activeTab === "items" && (() => {
        const pending = sortedItems;
        return (
          <div>
            {/* Tile grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
              gap: 12,
            }}>
              {pending.map((item, idx) => {
                const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;
                const isOpen = moodExpanded === item.id;
                const imgUrl = item.images?.[0]?.url;
                const msgCount = messages[item.id]?.length || 0;

                return (
                  <div key={item.id}
                    onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
                    style={{
                      background: T.card,
                      border: `1px solid ${dragOverIdx === idx ? T.accent : T.border}`,
                      borderRadius: 10,
                      overflow: "hidden",
                      opacity: dragIdx === idx ? 0.5 : 1,
                      transition: "border-color 0.15s, opacity 0.15s",
                    }}>
                    {/* Drag handle */}
                    <div
                      draggable
                      onDragStart={() => setDragIdx(idx)}
                      onDragEnd={() => { if (dragIdx !== null && dragOverIdx !== null) handleMoodDrop(dragIdx, dragOverIdx); setDragIdx(null); setDragOverIdx(null); }}
                      style={{ padding: "3px 0", textAlign: "center", cursor: "grab", background: T.surface, fontSize: 9, color: T.faint, letterSpacing: 2, userSelect: "none" }}>
                      ⋮⋮
                    </div>
                    {/* Clickable content */}
                    <div onClick={() => { setMoodExpanded(isOpen ? null : item.id); if (!isOpen && !messages[item.id]) loadMessages(item.id); }} style={{ cursor: "pointer" }}>
                      {/* Image area */}
                      <div
                        onDragOver={e => { e.preventDefault(); setDragoverRow(item.id); }}
                        onDragLeave={() => setDragoverRow(null)}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragoverRow(null); const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/")); if (files.length) { for (const file of files) uploadImage(item.id, file); setDragIdx(null); setDragOverIdx(null); } }}
                        style={{
                          width: "100%",
                          aspectRatio: "1",
                          background: T.surface,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          position: "relative",
                          overflow: "hidden",
                        }}>
                        {imgUrl ? (
                          <img src={imgUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div style={{ textAlign: "center", color: T.faint, fontSize: 11 }}>
                            {uploadingRow === item.id ? "Uploading..." : "Drop image"}
                          </div>
                        )}
                        {item.images?.length > 1 && (
                          <span style={{ position: "absolute", top: 6, right: 6, fontSize: 9, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 4, padding: "1px 5px" }}>+{item.images.length - 1}</span>
                        )}
                        {msgCount > 0 && (
                          <span style={{ position: "absolute", bottom: 6, right: 6, fontSize: 9, background: T.accent, color: "#fff", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>{msgCount}</span>
                        )}
                        <span style={{ position: "absolute", top: 6, left: 6, padding: "1px 6px", borderRadius: 99, fontSize: 8, fontWeight: 600, background: sc.bg, color: sc.text }}>{item.status || "Pending"}</span>
                      </div>
                      {/* Name + qty */}
                      <div style={{ padding: "8px 10px" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.item_name || "Untitled"}</div>
                        <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                          {item.qty ? `${item.qty} qty` : ""}
                          {item.retail ? ` · ${fmtD(item.qty * parseFloat(item.retail))}` : ""}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add tile */}
              <div
                onClick={addItem}
                style={{
                  background: "transparent",
                  border: `1px dashed ${T.border}`,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  minHeight: isMobile ? 150 : 200,
                  color: T.faint,
                  fontSize: 13,
                  fontFamily: font,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = T.accent)}
                onMouseLeave={e => (e.currentTarget.style.color = T.faint)}>
                + Add Item
              </div>
            </div>

            {/* Expanded detail panel */}
            {moodExpanded && (() => {
              const item = items.find(it => it.id === moodExpanded);
              if (!item) return null;
              const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;
              const itemMsgs = messages[item.id] || [];

              return (
                <div style={{
                  marginTop: 16, background: T.card, border: `1px solid ${T.border}`,
                  borderRadius: 12, overflow: "hidden",
                }}>
                  <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row" }}>
                    {/* Images */}
                    <div style={{ width: isMobile ? "100%" : 320, flexShrink: 0, background: T.surface, padding: 12 }}>
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
                            + Upload
                            <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => {
                              for (const file of Array.from(e.target.files || [])) uploadImage(item.id, file);
                            }} />
                          </label>
                        </div>
                      ) : (
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, borderRadius: 8, border: `1px dashed ${T.border}`, cursor: "pointer", color: T.faint, fontSize: 12, fontFamily: font }}>
                          Drop or click to upload
                          <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => {
                            for (const file of Array.from(e.target.files || [])) uploadImage(item.id, file);
                          }} />
                        </label>
                      )}
                    </div>

                    {/* Details + Messages */}
                    <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                      {/* Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <input value={item.item_name || ""} onChange={e => updateItemLocal(item.id, "item_name", e.target.value)}
                          style={{ fontSize: 16, fontWeight: 700, color: T.text, background: "transparent", border: "none", outline: "none", fontFamily: font, flex: 1, padding: 0 }} />
                        <button onClick={() => setMoodExpanded(null)} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
                      </div>

                      {/* Fields */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>QTY</label>
                          <input type="text" inputMode="numeric" value={item.qty ?? ""} onChange={e => updateItemLocal(item.id, "qty", parseInt(e.target.value) || null)} onFocus={e => e.target.select()} style={{ ...ic, width: "100%" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Unit Cost</label>
                          <input type="text" inputMode="decimal" value={item.unit_cost ?? ""} onChange={e => updateItemLocal(item.id, "unit_cost", e.target.value)} onBlur={e => updateItemLocal(item.id, "unit_cost", parseFloat(e.target.value) || null)} onFocus={e => e.target.select()} style={{ ...ic, width: "100%" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Retail</label>
                          <input type="text" inputMode="decimal" value={item.retail ?? ""} onChange={e => updateItemLocal(item.id, "retail", e.target.value)} onBlur={e => updateItemLocal(item.id, "retail", parseFloat(e.target.value) || null)} onFocus={e => e.target.select()} style={{ ...ic, width: "100%" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Status</label>
                          <select value={item.status || "Pending"} onChange={e => updateItemLocal(item.id, "status", e.target.value)}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: `1px solid ${sc.bg}`, background: sc.bg, color: sc.text, fontSize: 11, fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: font }}>
                            {["Pending", "Approved", "Changes Requested", "Rejected", "In Production", "LANDED", "On Hold", "Locating a Source", "Reference Sample Sent to Factory", "NEED REVISIONS - SWATCHES WORKING", "Done - Awaiting Shipping"].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Notes</label>
                        <input value={item.notes || ""} onChange={e => updateItemLocal(item.id, "notes", e.target.value)}
                          style={{ ...ic, width: "100%", fontFamily: font }} />
                      </div>

                      {/* Messages thread */}
                      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, marginTop: 4, flex: 1, display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Messages</div>
                        <div style={{ flex: 1, maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                          {itemMsgs.length === 0 && <div style={{ fontSize: 11, color: T.faint }}>No messages yet</div>}
                          {itemMsgs.map((msg: any) => (
                            <div key={msg.id} style={{
                              padding: "5px 8px", borderRadius: 6, fontSize: 11,
                              background: msg.sender_type === "client" ? T.accentDim : T.surface,
                              alignSelf: msg.sender_type === "client" ? "flex-start" : "flex-end",
                              maxWidth: "85%",
                            }}>
                              <div style={{ fontSize: 9, color: T.muted, marginBottom: 1 }}>
                                {msg.sender_name || (msg.sender_type === "client" ? "Client" : "HPD")}
                                <span style={{ marginLeft: 6, fontSize: 8, color: T.faint }}>{new Date(msg.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                              </div>
                              <div style={{ color: T.text }}>{msg.message}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input value={msgInput[item.id] || ""} onChange={e => setMsgInput(prev => ({ ...prev, [item.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") sendMessage(item.id); }}
                            placeholder="Type a message..."
                            style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font }} />
                          <button onClick={() => sendMessage(item.id)}
                            style={{ padding: "6px 14px", borderRadius: 6, background: T.accent, color: "#fff", border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                            Send
                          </button>
                        </div>
                      </div>

                      {/* Delete */}
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={() => setDeleteItem(item)} style={{ fontSize: 10, color: T.red, background: "none", border: "none", cursor: "pointer", fontFamily: font }}>Delete Item</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Items — table/cards (In Production + Landed tabs) */}
      {activeTab !== "items" && (isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sortedItems.map((item, idx) => {
            const qty = item.qty || 0;
            const unitCost = parseFloat(item.unit_cost) || 0;
            const retail = parseFloat(item.retail) || 0;
            const totalCost = qty * unitCost;
            const gross = qty * retail;
            const itemProfit = gross - totalCost;
            const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;
            const isExpanded = expandedRow === item.id;

            return (
              <div key={item.id}
                onDragOver={e => { e.preventDefault(); setDragoverRow(item.id); }}
                onDragLeave={() => setDragoverRow(null)}
                onDrop={e => handleRowDrop(e, item.id)}
                onClick={() => setExpandedRow(isExpanded ? null : item.id)}
                style={{ background: isExpanded ? T.surface : T.card, border: `1px solid ${dragoverRow === item.id ? T.accent : T.border}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {item.images?.[0]?.url ? (
                    <img src={item.images[0].url} onClick={e => { e.stopPropagation(); setGalleryItem(item); }}
                      style={{ width: 50, height: 50, borderRadius: 6, objectFit: "cover", border: `1px solid ${T.border}`, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 50, height: 50, borderRadius: 6, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 8, color: T.faint }}>Drop</span>
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.item_name || "—"}</div>
                    <div style={{ display: "flex", gap: 10, marginTop: 3, fontSize: 11, alignItems: "center" }}>
                      <span style={{ color: T.muted, fontFamily: mono }}>{qty || "—"} qty</span>
                      {gross > 0 && <span style={{ color: T.accent, fontFamily: mono }}>{fmtD(gross)}</span>}
                      {gross > 0 && <span style={{ color: itemProfit >= 0 ? T.green : T.red, fontFamily: mono }}>{fmtD(itemProfit)}</span>}
                      {activeTab !== "items" && item.eta && (() => {
                        const days = Math.ceil((new Date(item.eta).getTime() - Date.now()) / 86400000);
                        const color = days < 0 ? T.red : days <= 3 ? T.amber : T.green;
                        return <span style={{ color, fontWeight: 600 }}>{days < 0 ? `${Math.abs(days)}d late` : `${days}d`}</span>;
                      })()}
                      {activeTab !== "items" && item.payment_received && <span style={{ color: T.green, fontSize: 10, fontWeight: 600 }}>Paid</span>}
                    </div>
                  </div>
                  <span style={{ padding: "2px 6px", borderRadius: 99, fontSize: 9, fontWeight: 600, background: sc.bg, color: sc.text, flexShrink: 0 }}>{item.status || "Pending"}</span>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                    <input value={item.item_name || ""} onChange={e => updateItemLocal(item.id, "item_name", e.target.value)}
                      style={{ ...ic, width: "100%", fontFamily: font, fontWeight: 600 }} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>QTY</label>
                        <input type="text" inputMode="numeric" value={item.qty ?? ""} onChange={e => updateItemLocal(item.id, "qty", parseInt(e.target.value) || null)} onFocus={e => e.target.select()} style={{ ...ic, width: "100%" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Unit Cost</label>
                        <input type="text" inputMode="decimal" value={item.unit_cost ?? ""} onChange={e => updateItemLocal(item.id, "unit_cost", e.target.value)} onBlur={e => updateItemLocal(item.id, "unit_cost", parseFloat(e.target.value) || null)} onFocus={e => e.target.select()} style={{ ...ic, width: "100%" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Retail</label>
                        <input type="text" inputMode="decimal" value={item.retail ?? ""} onChange={e => updateItemLocal(item.id, "retail", e.target.value)} onBlur={e => updateItemLocal(item.id, "retail", parseFloat(e.target.value) || null)} onFocus={e => e.target.select()} style={{ ...ic, width: "100%" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Status</label>
                        <select value={item.status || "Pending"} onChange={e => updateItemLocal(item.id, "status", e.target.value)}
                          style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: `1px solid ${sc.bg}`, background: sc.bg, color: sc.text, fontSize: 11, fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: font }}>
                          {["Pending", "Approved", "Changes Requested", "Rejected", "In Production", "LANDED", "On Hold", "Locating a Source", "Reference Sample Sent to Factory", "NEED REVISIONS - SWATCHES WORKING", "Done - Awaiting Shipping"].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    {activeTab !== "items" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>ETA</label>
                          <input type="date" value={item.eta || ""} onChange={e => updateItemLocal(item.id, "eta", e.target.value || null)} style={{ ...ic, width: "100%", fontFamily: font }} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 14 }}>
                          <input type="checkbox" checked={!!item.payment_received} onChange={e => updateItemLocal(item.id, "payment_received", e.target.checked)} style={{ accentColor: T.green, width: 16, height: 16 }} />
                          <label style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>Payment Received</label>
                        </div>
                      </div>
                    )}
                    <div>
                      <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Notes</label>
                      <input value={item.notes || ""} onChange={e => updateItemLocal(item.id, "notes", e.target.value)} style={{ ...ic, width: "100%", fontFamily: font }} />
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                      <button onClick={() => setExpandedRow(null)} style={{ fontSize: 10, color: T.accent, background: "none", border: "none", cursor: "pointer", fontFamily: font }}>▲ Close</button>
                      <button onClick={() => setDeleteItem(item)} style={{ fontSize: 10, color: T.red, background: "none", border: "none", cursor: "pointer", fontFamily: font }}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={addItem}
            style={{ background: "none", border: `1px dashed ${T.border}`, borderRadius: 10, color: T.faint, fontSize: 12, padding: "12px", cursor: "pointer", fontFamily: font, textAlign: "center" }}
            onMouseEnter={e => (e.currentTarget.style.color = T.accent)}
            onMouseLeave={e => (e.currentTarget.style.color = T.faint)}>
            + Add Item
          </button>
        </div>
      ) : (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.surface }}>
              <th style={{ padding: "8px 6px", width: 30 }}><input type="checkbox" onChange={e => { if (e.target.checked) setChecked(new Set(items.map(i => i.id))); else setChecked(new Set()); }} checked={checked.size === items.length && items.length > 0} style={{ accentColor: T.accent }} /></th>
              <th style={{ padding: "8px 6px", width: 90 }} />
              <SortTh col="item_name" label="Item" style={{ textAlign: "left", padding: "8px 10px" }} />
              <SortTh col="qty" label="QTY" style={{ textAlign: "center", width: 60 }} />
              <SortTh col="total_cost" label="Cost" style={{ textAlign: "center", width: 80 }} />
              <SortTh col="gross" label="Gross" style={{ textAlign: "center", width: 80 }} />
              <SortTh col="profit" label="Profit" style={{ textAlign: "center", width: 80 }} />
              <SortTh col="status" label="Status" style={{ textAlign: "center", width: 120 }} />
              {activeTab !== "items" && <>
                <SortTh col="eta" label="ETA" style={{ textAlign: "center", width: 100 }} />
                <th style={{ padding: "8px 6px", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", textAlign: "center", width: 50 }}>Paid</th>
              </>}
              <th style={{ padding: "8px 6px", width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item, idx) => {
              const qty = item.qty || 0;
              const unitCost = parseFloat(item.unit_cost) || 0;
              const retail = parseFloat(item.retail) || 0;
              const totalCost = qty * unitCost;
              const gross = qty * retail;
              const itemProfit = gross - totalCost;
              const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;
              const isDragover = dragoverRow === item.id;

              const isExpanded = expandedRow === item.id;

              return (
                <tr key={item.id}
                  onDragOver={e => { e.preventDefault(); setDragoverRow(item.id); }}
                  onDragLeave={() => setDragoverRow(null)}
                  onDrop={e => handleRowDrop(e, item.id)}
                  onClick={() => setExpandedRow(isExpanded ? null : item.id)}
                  style={{ borderBottom: `1px solid ${T.border}`, background: isDragover ? T.accentDim : isExpanded ? T.surface : "transparent", cursor: "pointer", transition: "background 0.1s" }}>
                  {/* Checkbox */}
                  <td style={{ padding: "6px", textAlign: "center", verticalAlign: "top" }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checked.has(item.id)} onChange={() => setChecked(prev => { const n = new Set(prev); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; })} style={{ accentColor: T.accent }} />
                  </td>
                  {/* Image */}
                  <td style={{ padding: "4px", verticalAlign: "top" }} onClick={e => { e.stopPropagation(); if (item.images?.length) setGalleryItem(item); }}>
                    <div style={{ width: 80, height: 52, borderRadius: 6, overflow: "hidden", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: T.surface, border: `1px solid ${T.border}`, position: "relative" }}>
                      {item.images?.[0]?.url ? (
                        <img src={item.images[0].url} style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <span style={{ fontSize: 9, color: T.faint }}>{uploadingRow === item.id ? "..." : "Drop"}</span>
                      )}
                      {item.images?.length > 1 && (
                        <span style={{ position: "absolute", bottom: 2, right: 2, fontSize: 8, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 3, padding: "0 3px" }}>+{item.images.length - 1}</span>
                      )}
                    </div>
                  </td>
                  {/* Name + expanded edit area */}
                  <td style={{ padding: "8px 10px", verticalAlign: "top" }} colSpan={isExpanded ? (activeTab !== "items" ? 8 : 6) : 1}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setExpandedRow(isExpanded ? null : item.id)}>
                      <input value={item.item_name || ""} onChange={e => updateItemLocal(item.id, "item_name", e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{ background: "transparent", border: "none", outline: "none", color: T.text, fontSize: 13, fontWeight: 600, fontFamily: font, flex: 1, padding: 0 }} />
                      {isExpanded && <span style={{ fontSize: 10, color: T.faint, flexShrink: 0 }}>▲ Click to close</span>}
                    </div>
                    {isExpanded && (
                      <div onClick={e => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>QTY</label>
                          <input type="text" inputMode="numeric" value={item.qty ?? ""} onChange={e => updateItemLocal(item.id, "qty", parseInt(e.target.value) || null)} onFocus={e => e.target.select()} onClick={e => e.stopPropagation()} style={{ ...ic, width: "100%" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Unit Cost</label>
                          <input type="text" inputMode="decimal" value={item.unit_cost ?? ""} onChange={e => updateItemLocal(item.id, "unit_cost", e.target.value)} onBlur={e => updateItemLocal(item.id, "unit_cost", parseFloat(e.target.value) || null)} onFocus={e => e.target.select()} onClick={e => e.stopPropagation()} style={{ ...ic, width: "100%" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Retail</label>
                          <input type="text" inputMode="decimal" value={item.retail ?? ""} onChange={e => updateItemLocal(item.id, "retail", e.target.value)} onBlur={e => updateItemLocal(item.id, "retail", parseFloat(e.target.value) || null)} onFocus={e => e.target.select()} onClick={e => e.stopPropagation()} style={{ ...ic, width: "100%" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Status</label>
                          <select value={item.status || "Pending"} onChange={e => updateItemLocal(item.id, "status", e.target.value)} onClick={e => e.stopPropagation()}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: `1px solid ${sc.bg}`, background: sc.bg, color: sc.text, fontSize: 11, fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: font }}>
                            {["Pending", "Approved", "Changes Requested", "Rejected", "In Production", "LANDED", "On Hold", "Locating a Source", "Reference Sample Sent to Factory", "NEED REVISIONS - SWATCHES WORKING", "Done - Awaiting Shipping"].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        {activeTab !== "items" && <>
                          <div>
                            <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>ETA</label>
                            <input type="date" value={item.eta || ""} onChange={e => updateItemLocal(item.id, "eta", e.target.value || null)} onClick={e => e.stopPropagation()} style={{ ...ic, width: "100%", fontFamily: font }} />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 14 }}>
                            <input type="checkbox" checked={!!item.payment_received} onChange={e => updateItemLocal(item.id, "payment_received", e.target.checked)} onClick={e => e.stopPropagation()} style={{ accentColor: T.green, width: 16, height: 16 }} />
                            <label style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>Payment Received</label>
                          </div>
                        </>}
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Notes</label>
                          <input value={item.notes || ""} onChange={e => updateItemLocal(item.id, "notes", e.target.value)} onClick={e => e.stopPropagation()}
                            style={{ ...ic, width: "100%", fontFamily: font }} />
                        </div>
                      </div>
                    )}
                  </td>
                  {/* Collapsed KPIs */}
                  {!isExpanded && <>
                    <td style={{ padding: "6px", textAlign: "center", fontFamily: mono, fontSize: 12, color: T.text }}>{qty || "—"}</td>
                    <td style={{ padding: "6px", textAlign: "center", fontFamily: mono, fontSize: 11, color: T.muted }}>{totalCost > 0 ? fmtD(totalCost) : "—"}</td>
                    <td style={{ padding: "6px", textAlign: "center", fontFamily: mono, fontSize: 11, color: T.accent }}>{gross > 0 ? fmtD(gross) : "—"}</td>
                    <td style={{ padding: "6px", textAlign: "center", fontFamily: mono, fontSize: 11, color: itemProfit >= 0 ? T.green : T.red }}>{gross > 0 ? fmtD(itemProfit) : "—"}</td>
                    <td style={{ padding: "6px", textAlign: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 600, background: sc.bg, color: sc.text }}>{item.status || "Pending"}</span>
                    </td>
                    {activeTab !== "items" && <>
                      <td style={{ padding: "6px", textAlign: "center", fontSize: 11 }} onClick={e => e.stopPropagation()}>
                        {item.eta ? (() => {
                          const days = Math.ceil((new Date(item.eta).getTime() - Date.now()) / 86400000);
                          const color = days < 0 ? T.red : days <= 3 ? T.amber : T.green;
                          return (
                            <div>
                              <div style={{ fontSize: 10, color: T.muted }}>{new Date(item.eta + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color }}>{days < 0 ? `${Math.abs(days)}d late` : days === 0 ? "Today" : `${days}d`}</div>
                            </div>
                          );
                        })() : <span style={{ color: T.faint, fontSize: 10 }}>—</span>}
                      </td>
                      <td style={{ padding: "6px", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={!!item.payment_received} onChange={e => updateItemLocal(item.id, "payment_received", e.target.checked)} style={{ accentColor: T.green, width: 15, height: 15, cursor: "pointer" }} />
                      </td>
                    </>}
                  </>}
                  {/* Delete */}
                  <td style={{ padding: "4px", textAlign: "center", verticalAlign: "top" }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => setDeleteItem(item)}
                      style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11 }}
                      onMouseEnter={e => (e.currentTarget.style.color = T.red)}
                      onMouseLeave={e => (e.currentTarget.style.color = T.faint)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}` }}>
          <button onClick={addItem}
            style={{ background: "none", border: `1px dashed ${T.border}`, borderRadius: 6, color: T.faint, fontSize: 11, padding: "6px 14px", cursor: "pointer", fontFamily: font, width: "100%" }}
            onMouseEnter={e => (e.currentTarget.style.color = T.accent)}
            onMouseLeave={e => (e.currentTarget.style.color = T.faint)}>
            + Add Item
          </button>
        </div>
      </div>
      ))}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteItem}
        title="Delete item"
        message={deleteItem ? `Delete "${deleteItem.item_name || "this item"}"?` : ""}
        confirmLabel="Delete"
        onConfirm={() => deleteItem && removeItem(deleteItem.id)}
        onCancel={() => setDeleteItem(null)}
      />

      {/* Image Gallery Modal */}
      {galleryItem && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={e => { if (e.target === e.currentTarget) setGalleryItem(null); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 600, maxWidth: "90vw", maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{galleryItem.item_name || "Item"} — Images</div>
              <button onClick={() => setGalleryItem(null)} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
              {(galleryItem.images || []).map((img: any) => (
                <div key={img.id} style={{ position: "relative" }}>
                  <img src={img.url} style={{ width: "100%", borderRadius: 8, border: `1px solid ${T.border}` }} />
                  <button onClick={() => { deleteImage(galleryItem.id, img.id); setGalleryItem((g: any) => g ? { ...g, images: g.images.filter((i: any) => i.id !== img.id) } : null); }}
                    style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 4, background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.red)}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0.6)")}>✕</button>
                </div>
              ))}
            </div>
            <label style={{ display: "inline-block", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 14px", fontSize: 11, color: T.muted, cursor: "pointer", fontFamily: font }}>
              Upload Image
              <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={async e => {
                for (const file of Array.from(e.target.files || [])) {
                  await uploadImage(galleryItem.id, file);
                }
                // Refresh gallery
                const res = await fetch(`/api/staging/boards/${params.boardId}`);
                const data = await res.json();
                const updated = data.items?.find((it: any) => it.id === galleryItem.id);
                if (updated) setGalleryItem(updated);
              }} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
