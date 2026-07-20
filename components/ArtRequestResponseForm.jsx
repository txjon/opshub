"use client";
import { useState } from "react";

// Designer-facing quote form on the public art gallery. Prices EACH item
// (screen count + price) — not one total — and submits everything at once to
// /api/art-request/[token]/respond. Standalone light palette (matches the
// gallery document theme) — no app theme import.
const C = {
  card: "#ffffff", surface: "#f3f3f5", border: "#e0e0e4",
  text: "#1a1a1a", muted: "#6b6b78", faint: "#a0a0ad", accent: "#1a1a1a",
  green: "#1a8c5c", greenBg: "#edf7f2", greenBorder: "#b4dfc9", red: "#c43030",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
};

const fmtMoney = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ArtRequestResponseForm({ token, items, initial }) {
  // items: [{ id, name }]. initial: { items: [{item_id, amount, screens}], note } | null
  const initialFor = (id) => (initial?.items || []).find((r) => r.item_id === id) || {};
  const [rows, setRows] = useState(() => {
    const map = {};
    (items || []).forEach((it) => {
      const seed = initialFor(it.id);
      map[it.id] = { amount: seed.amount != null ? String(seed.amount) : "", screens: seed.screens != null ? String(seed.screens) : "" };
    });
    return map;
  });
  const [note, setNote] = useState(initial?.note || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(!!initial);
  const [editing, setEditing] = useState(false);

  const setRow = (id, field, val) => setRows((r) => ({ ...r, [id]: { ...r[id], [field]: val } }));
  const total = (items || []).reduce((a, it) => a + (parseFloat(rows[it.id]?.amount) || 0), 0);

  const submit = async () => {
    // Require a valid price on every item.
    const payloadItems = [];
    for (const it of items || []) {
      const raw = rows[it.id]?.amount;
      const amt = parseFloat(raw);
      if (raw == null || raw === "" || isNaN(amt) || amt < 0) {
        setErr(`Enter a price for "${it.name || "item"}".`);
        return;
      }
      const scr = rows[it.id]?.screens;
      payloadItems.push({ item_id: it.id, item_name: it.name || "", amount: amt, screens: scr === "" || scr == null ? null : parseInt(scr, 10) });
    }
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/art-request/${token}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payloadItems, note: note.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Submit failed");
      setDone(true); setEditing(false);
    } catch (e) {
      setErr(e.message || "Submit failed");
    }
    setBusy(false);
  };

  const wrap = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px", marginBottom: 30, fontFamily: C.font };
  const lbl = { fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" };
  const inp = { height: 42, padding: "0 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 15, fontFamily: C.font, boxSizing: "border-box", width: "100%" };

  // ── Confirmation (already quoted, not editing) ──
  if (done && !editing) {
    return (
      <div style={{ ...wrap, background: C.greenBg, border: `1px solid ${C.greenBorder}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.green, fontWeight: 800, fontSize: 15, marginBottom: 14 }}>
          <span style={{ fontSize: 18 }}>✓</span> Quote submitted — thank you!
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(items || []).map((it) => {
            const r = rows[it.id] || {};
            return (
              <div key={it.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 8, borderBottom: `1px solid ${C.greenBorder}` }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{it.name || "Item"}</div>
                <div style={{ display: "flex", gap: 22, textAlign: "right" }}>
                  <div><span style={{ ...lbl }}>Screens</span><div style={{ fontSize: 16, fontWeight: 800 }}>{r.screens !== "" && r.screens != null ? r.screens : "—"}</div></div>
                  <div><span style={{ ...lbl }}>Price</span><div style={{ fontSize: 16, fontWeight: 800 }}>{r.amount !== "" ? fmtMoney(r.amount) : "—"}</div></div>
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4, fontSize: 15 }}>
            <span style={{ color: C.muted }}>Total</span><span style={{ fontWeight: 800 }}>{fmtMoney(total)}</span>
          </div>
        </div>
        {note && <div style={{ fontSize: 13, color: C.muted, marginTop: 12, whiteSpace: "pre-wrap" }}>{note}</div>}
        <button onClick={() => setEditing(true)}
          style={{ marginTop: 14, background: "none", border: "none", color: C.accent, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font, padding: 0, textDecoration: "underline" }}>
          Update quote
        </button>
      </div>
    );
  }

  // ── Quote form (one row per item) ──
  return (
    <div style={wrap}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>Send your quote</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 18 }}>Enter a screen count and price for each item, then submit.</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {(items || []).map((it) => (
          <div key={it.id} style={{ display: "grid", gridTemplateColumns: "1fr 130px 160px", gap: 12, alignItems: "end", paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, paddingBottom: 10 }}>{it.name || "Item"}</div>
            <div>
              <label style={{ ...lbl, display: "block", marginBottom: 5 }}>Screens</label>
              <input value={rows[it.id]?.screens || ""} onChange={(e) => setRow(it.id, "screens", e.target.value)} inputMode="numeric" placeholder="e.g. 4" style={inp} />
            </div>
            <div>
              <label style={{ ...lbl, display: "block", marginBottom: 5 }}>Price *</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: 11, fontSize: 15, color: C.faint }}>$</span>
                <input value={rows[it.id]?.amount || ""} onChange={(e) => setRow(it.id, "amount", e.target.value)} inputMode="decimal" placeholder="0.00" style={{ ...inp, paddingLeft: 24 }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 10, marginTop: 14 }}>
        <span style={{ ...lbl }}>Total</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: C.text }}>{fmtMoney(total)}</span>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ ...lbl, display: "block", marginBottom: 5 }}>Note <span style={{ color: C.faint }}>(optional)</span></label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Turnaround, separations, anything to flag…"
          style={{ ...inp, height: "auto", padding: "10px 12px", resize: "vertical", lineHeight: 1.45 }} />
      </div>

      {err && <div style={{ fontSize: 13, color: C.red, marginTop: 12 }}>{err}</div>}
      <button onClick={submit} disabled={busy}
        style={{ marginTop: 16, height: 46, padding: "0 26px", borderRadius: 10, border: "none", background: busy ? C.surface : C.accent, color: busy ? C.muted : "#fff", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: C.font }}>
        {busy ? "Sending…" : "Submit quote"}
      </button>
    </div>
  );
}
