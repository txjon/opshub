"use client";
import { useState } from "react";
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

const HPD_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227.14 28.53" fill="#e8eaf2" width="160"><g><path d="M15.48,14.1v8.5c0,.13-.11.24-.24.24h-4.51c-.13,0-.24-.11-.24-.24v-8.27c0-.56-.03-1.2-.27-1.72-.11-.22-.25-.4-.42-.54-.28-.22-.65-.33-1.12-.33-.87,0-1.54.3-1.76.78-.24.52-.24,1.24-.24,1.81v8.27c0,.13-.11.24-.24.24H1.93c-.13,0-.24-.11-.24-.24V3.21c0-.13.11-.24.24-.24h4.22c.13,0,.24.11.24.24v5.17c0,.1.11.15.19.1,3.4-2.34,6.72.26,6.75.29.12.09.24.2.34.3h0c1.54,1.55,1.8,2.81,1.8,5.03Z"/></g></svg>`;

export default function SharePage({ params }: { params: { token: string } }) {
  const [password, setPassword] = useState("");
  const [board, setBoard] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [galleryItem, setGalleryItem] = useState<any>(null);

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
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Total Cost", value: fmtD(totals.cost), color: T.text },
            { label: "Total Retail", value: fmtD(totals.gross), color: T.accent },
            { label: "Total Profit", value: fmtD(profit), color: profit >= 0 ? T.green : T.red },
          ].map(s => (
            <div key={s.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 16px", flex: 1 }}>
              <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: mono }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Table (read-only) */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.surface }}>
                <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 30 }}>#</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Item</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 60 }}>QTY</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 80 }}>Unit Cost</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 80 }}>Total</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 80 }}>Retail</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 80 }}>Gross</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 80 }}>Profit</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 110 }}>Status</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700 }}>Notes</th>
                <th style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, color: T.muted, fontWeight: 700, width: 80 }}>Images</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, idx: number) => {
                const qty = item.qty || 0;
                const unitCost = parseFloat(item.unit_cost) || 0;
                const retail = parseFloat(item.retail) || 0;
                const totalCost = qty * unitCost;
                const gross = qty * retail;
                const itemProfit = gross - totalCost;
                const sc = STATUS_COLORS[item.status] || STATUS_COLORS.Pending;

                return (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: "8px 6px", textAlign: "center", color: T.faint, fontSize: 10, fontFamily: mono }}>{idx + 1}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{item.item_name || "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono }}>{qty || "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono }}>{unitCost > 0 ? fmtD(unitCost) : "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono, color: T.muted }}>{totalCost > 0 ? fmtD(totalCost) : "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono }}>{retail > 0 ? fmtD(retail) : "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono, color: T.accent }}>{gross > 0 ? fmtD(gross) : "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center", fontFamily: mono, color: itemProfit >= 0 ? T.green : T.red }}>{gross > 0 ? fmtD(itemProfit) : "—"}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 600, background: sc.bg, color: sc.text }}>{item.status || "Pending"}</span>
                    </td>
                    <td style={{ padding: "8px 6px", fontSize: 10, color: T.muted }}>{item.notes || ""}</td>
                    <td style={{ padding: "8px 6px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 2, justifyContent: "center", cursor: item.images?.length ? "pointer" : "default" }}
                        onClick={() => item.images?.length && setGalleryItem(item)}>
                        {(item.images || []).slice(0, 3).map((img: any) => (
                          <img key={img.id} src={img.url} style={{ width: 24, height: 24, borderRadius: 3, objectFit: "cover", border: `1px solid ${T.border}` }}
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ))}
                        {(item.images?.length || 0) > 3 && <span style={{ fontSize: 9, color: T.faint }}>+{item.images.length - 3}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
