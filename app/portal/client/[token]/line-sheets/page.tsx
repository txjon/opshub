"use client";
import { useEffect, useState } from "react";
import { useClientPortal } from "../_shared/context";

// THE LINE SHEET, client side (mig 190) — the product line as a webstore they
// react to: shelves, product cards (front/back nested), one tap to thumb.
// Always the latest PUBLISHED version; drafts never show here.
const C = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const thumbUrl = (id: string, size = 500) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

export default function LineSheetsTab() {
  const { token } = useClientPortal() as any;
  const [sheets, setSheets] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { fetch(`/api/portal/client/${token}/line-sheets`).then(r => r.json()).then(j => { const list = j.sheets || []; setSheets(list); if (list.length === 1) setOpen(list[0].id); }).catch(() => setSheets([])); }, [token]);
  if (sheets === null) return <div style={{ padding: 40, color: C.faint, fontFamily: C.font, fontSize: 13 }}>Loading…</div>;
  if (open) return <SheetView token={token} sheetId={open} onBack={sheets.length > 1 ? () => setOpen(null) : undefined} />;
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px 90px", fontFamily: C.font, color: C.text }}>
      <h1 style={{ fontSize: "clamp(26px,4.5vw,40px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", margin: "0 0 18px" }}>Line sheets.</h1>
      {sheets.length === 0 && <div style={{ color: C.faint, fontSize: 13 }}>Nothing here yet.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {sheets.map(s => (
          <button key={s.id} onClick={() => setOpen(s.id)} style={{ textAlign: "left", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px", color: C.text, cursor: "pointer", fontFamily: C.font }}>
            <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase" }}>{s.title}</div>
            <div style={{ fontSize: 10.5, fontFamily: C.mono, color: C.faint, marginTop: 4 }}>{s.season ? `${s.season} · ` : ""}v{s.current_version} · {s.itemCount} items</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SheetView({ token, sheetId, onBack }: { token: string; sheetId: string; onBack?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const load = () => fetch(`/api/portal/client/${token}/line-sheets/${sheetId}`).then(r => r.json()).then(j => { if (!j.error) setData(j); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sheetId]);
  if (!data) return <div style={{ padding: 40, color: C.faint, fontFamily: C.font, fontSize: 13 }}>Loading…</div>;
  const { sheet, version, sections } = data;
  const items: any[] = data.items;
  const bySection: Record<string, any[]> = {};
  const loose: any[] = [];
  for (const it of items) { if (it.section_id && sections.some((s: any) => s.id === it.section_id)) (bySection[it.section_id] ||= []).push(it); else loose.push(it); }
  const newCount = items.filter(i => i.badge === "new").length;
  const updCount = items.filter(i => i.badge === "updated").length;

  async function react(it: any, thumb: "up" | "down") {
    const next = it.thumb === thumb ? null : thumb;
    setData((d: any) => ({ ...d, items: d.items.map((x: any) => x.id === it.id ? { ...x, thumb: next } : x) }));
    const r = await fetch(`/api/portal/client/${token}/line-sheets/${sheetId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: it.id, thumb: next }) }).catch(() => null);
    if (!r || !r.ok) load();
  }

  const itemCard = (it: any) => {
    const imgs = it.images || [];
    const flip = flipped.has(it.id) && imgs.length > 1;
    const show = flip ? imgs[1] : imgs[0];
    return (
      <div key={it.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", width: "100%" }}>
        <button onClick={() => imgs.length > 1 && setFlipped(prev => { const n = new Set(prev); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })}
          style={{ display: "block", width: "100%", border: "none", padding: 0, background: "#fff", cursor: imgs.length > 1 ? "pointer" : "default", position: "relative" }}>
          <div style={{ position: "relative", aspectRatio: "1", width: "100%" }}>
            {imgs.length > 1 && !flip && imgs[1] && (
              <img src={thumbUrl(imgs[1].driveId, 400)} alt="" referrerPolicy="no-referrer" style={{ position: "absolute", top: "8%", left: "30%", width: "68%", height: "86%", objectFit: "contain", filter: "brightness(.97)", mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.display = "none"; }} />
            )}
            {show && <img src={thumbUrl(show.driveId, 600)} alt="" referrerPolicy="no-referrer" style={{ position: "absolute", top: 0, left: 0, width: imgs.length > 1 ? "78%" : "100%", height: "100%", objectFit: "contain", mixBlendMode: imgs.length > 1 ? "multiply" : undefined }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />}
          </div>
          {it.badge && <span style={{ position: "absolute", top: 8, left: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: it.badge === "new" ? C.green : C.amber, background: "rgba(10,10,10,.85)", borderRadius: 6, padding: "3px 8px" }}>{it.badge}</span>}
          {imgs.length > 1 && <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#666", background: "rgba(255,255,255,.92)", borderRadius: 6, padding: "3px 8px" }}>{flip ? "back · tap" : "tap to flip"}</span>}
        </button>
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{it.name || "Untitled"}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <button onClick={() => react(it, "up")} aria-label="Thumbs up" style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${it.thumb === "up" ? C.green : C.line}`, background: it.thumb === "up" ? "rgba(88,201,60,.14)" : "transparent", fontSize: 14, cursor: "pointer", opacity: it.thumb === "down" ? 0.45 : 1 }}>👍</button>
            <button onClick={() => react(it, "down")} aria-label="Thumbs down" style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${it.thumb === "down" ? C.red : C.line}`, background: it.thumb === "down" ? "rgba(255,90,110,.12)" : "transparent", fontSize: 14, cursor: "pointer", opacity: it.thumb === "up" ? 0.45 : 1 }}>👎</button>
          </div>
        </div>
      </div>
    );
  };

  const shelf = (title: string, list: any[]) => list.length ? (
    <section key={title} style={{ marginTop: 30 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", margin: "0 0 12px", color: C.text }}>{title}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>{list.map(itemCard)}</div>
    </section>
  ) : null;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px 90px", fontFamily: C.font, color: C.text }}>
      {onBack && <button onClick={onBack} style={{ background: "none", border: "none", color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font, padding: 0 }}>‹ Line sheets</button>}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginTop: onBack ? 8 : 0 }}>
        <h1 style={{ fontSize: "clamp(26px,4.5vw,40px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", margin: 0 }}>{sheet.title}</h1>
        {sheet.season && <span style={{ fontFamily: C.mono, fontSize: 12, color: C.amber }}>{sheet.season}</span>}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 8, fontSize: 11, fontFamily: C.mono, color: C.faint }}>
        <span style={{ color: C.blue, fontWeight: 700 }}>v{version.n}</span>
        <span>published {fmt(version.published_at)}</span>
        {newCount > 0 && <span style={{ color: C.green }}>{newCount} new</span>}
        {updCount > 0 && <span style={{ color: C.amber }}>{updCount} updated</span>}
      </div>
      {version.note && <div style={{ marginTop: 10, padding: "11px 14px", background: C.surface, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 10, fontSize: 13, color: C.dim, maxWidth: 640 }}>{version.note}</div>}
      <div style={{ marginTop: 6, fontSize: 11.5, color: C.faint }}>Tap 👍 or 👎 on anything — we see it instantly. Tap a card to see the back.</div>
      {sections.map((s: any) => shelf(s.name, bySection[s.id] || []))}
      {shelf(sections.length ? "More" : "The line", loose)}
    </div>
  );
}
