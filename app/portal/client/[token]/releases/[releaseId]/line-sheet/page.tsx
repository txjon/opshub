"use client";
import { useEffect, useState } from "react";

// THE LINE SHEET, client side (mig 190) — the product line as a webstore they
// react to: shelves, product cards (front/back nested), one tap to thumb.
// Always the latest PUBLISHED version; drafts never show here. Since mig 192
// it's the proposal stage of one release, so it lives under that release.
const C = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const thumbUrl = (id: string, size = 500) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

export default function ReleaseLineSheet({ params }: { params: { token: string; releaseId: string } }) {
  return <SheetView token={params.token} releaseId={params.releaseId} />;
}

function SheetView({ token, releaseId }: { token: string; releaseId: string }) {
  const [data, setData] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  // Shelf filter — null = the whole line. "__more" = unshelved pieces.
  const [shelf, setShelf] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);   // item whose "why" field is open
  const load = () => fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`).then(r => r.json()).then(j => { if (j.error) setMissing(true); else setData(j); }).catch(() => setMissing(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [releaseId]);
  const back = <a href={`/portal/client/${token}/releases`} style={{ color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" }}>‹ {data?.release?.title || "Releases"}</a>;
  if (missing) return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px", fontFamily: C.font }}>{back}<div style={{ color: C.faint, fontSize: 13, marginTop: 14 }}>No line sheet on this release yet.</div></div>;
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
    // a thumbs-down offers the optional why right there; any other change closes it
    setNoteFor(next === "down" ? it.id : null);
    setData((d: any) => ({ ...d, items: d.items.map((x: any) => x.id === it.id ? { ...x, thumb: next, note: null } : x) }));
    const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: it.id, thumb: next }) }).catch(() => null);
    if (!r || !r.ok) load();
  }

  // Optional "why" on a thumbs-down (mig 195): saves on blur/Enter, never
  // required, empty clears it.
  async function saveNote(it: any, raw: string) {
    const note = raw.trim() || null;
    setNoteFor(null);
    if ((it.note || null) === note) return;
    setData((d: any) => ({ ...d, items: d.items.map((x: any) => x.id === it.id ? { ...x, note } : x) }));
    const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: it.id, note }) }).catch(() => null);
    if (!r || !r.ok) load();
  }

const ThumbIcon = ({ dir, size = 15 }: { dir: "up" | "down"; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dir === "down" ? "rotate(180deg)" : undefined, verticalAlign: "middle" }} aria-hidden>
      <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );

  const itemCard = (it: any) => {
    const imgs = it.images || [];
    return (
      <div key={it.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", width: "100%" }}>
        <div style={{ position: "relative", aspectRatio: "1", width: "100%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {imgs.length > 1 ? (
            <>
              <img src={thumbUrl(imgs[0].driveId, 480)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: "62%", height: "92%", objectFit: "contain", marginRight: "-14%", zIndex: 2, mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
              <img src={thumbUrl(imgs[1].driveId, 480)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: "62%", height: "92%", objectFit: "contain", zIndex: 1, mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.display = "none"; }} />
            </>
          ) : imgs[0] ? (
            <img src={thumbUrl(imgs[0].driveId, 480)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
          ) : null}
          {it.badge && <span style={{ position: "absolute", top: 8, left: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: it.badge === "new" ? C.green : C.amber, background: "rgba(10,10,10,.85)", borderRadius: 6, padding: "3px 8px", zIndex: 3 }}>{it.badge}</span>}
        </div>
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{it.name || (it.item_no ? String(it.item_no).padStart(2, "0") : "Untitled")}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <button onClick={() => react(it, "up")} aria-label="Thumbs up" style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${it.thumb === "up" ? C.green : C.line}`, background: it.thumb === "up" ? "rgba(88,201,60,.14)" : "transparent", cursor: "pointer", opacity: it.thumb === "down" ? 0.45 : 1, color: it.thumb === "up" ? C.green : C.dim, display: "grid", placeItems: "center" }}><ThumbIcon dir="up" /></button>
            <button onClick={() => react(it, "down")} aria-label="Thumbs down" style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${it.thumb === "down" ? C.red : C.line}`, background: it.thumb === "down" ? "rgba(255,90,110,.12)" : "transparent", cursor: "pointer", opacity: it.thumb === "up" ? 0.45 : 1, color: it.thumb === "down" ? C.red : C.dim, display: "grid", placeItems: "center" }}><ThumbIcon dir="down" /></button>
          </div>
          {it.thumb === "down" && (noteFor === it.id ? (
            <input defaultValue={it.note || ""} placeholder="Why? (optional)" maxLength={500} aria-label="Why the thumbs down (optional)"
              onBlur={e => saveNote(it, e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNoteFor(null); }}
              style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, background: "transparent", border: "none", borderBottom: `1px solid ${C.line}`, outline: "none", color: C.dim, fontSize: 12, fontFamily: C.font, padding: "4px 0" }} />
          ) : it.note ? (
            <button onClick={() => setNoteFor(it.id)} title="Edit" style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.dim, fontSize: 12, fontStyle: "italic", fontFamily: C.font, lineHeight: 1.4 }}>&ldquo;{it.note}&rdquo;</button>
          ) : (
            <button onClick={() => setNoteFor(it.id)} style={{ marginTop: 7, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.faint, fontSize: 11, fontFamily: C.font }}>+ why</button>
          ))}
        </div>
      </div>
    );
  };

  const renderShelf = (title: string, list: any[]) => list.length ? (
    <section key={title} style={{ marginTop: 30 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", margin: "0 0 12px", color: C.text }}>{title}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>{list.map(itemCard)}</div>
    </section>
  ) : null;

  const shelves = [
    ...sections.map((s: any) => ({ id: s.id as string, name: s.name as string, list: bySection[s.id] || [] })),
    { id: "__more", name: sections.length ? "More" : "The line", list: loose },
  ].filter(f => f.list.length).map(f => ({ ...f, n: f.list.length }));
  const active = shelf && shelves.some(f => f.id === shelf) ? shelf : null;
  // Picking a shelf keeps the filter row in view instead of leaving the
  // client staring at the bottom of a shorter page.
  function pick(id: string | null) {
    setShelf(id);
    const bar = document.querySelector(".lsx-filters") as HTMLElement | null;
    if (bar && bar.getBoundingClientRect().top <= parseFloat(getComputedStyle(bar).top || "0") + 1) {
      const y = (bar.parentElement?.querySelector(".lsx-anchor") as HTMLElement | null)?.getBoundingClientRect().top;
      if (y != null) window.scrollTo({ top: window.scrollY + y - parseFloat(getComputedStyle(bar).top || "0"), behavior: "smooth" });
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px 90px", fontFamily: C.font, color: C.text }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .lsx-filters{position:sticky;top:0;z-index:20;display:flex;gap:22px;overflow-x:auto;scrollbar-width:none;margin:22px -18px 0;padding:0 18px;background:rgba(10,10,10,.94);backdrop-filter:blur(10px);border-bottom:1px solid ${C.line2}}
        .lsx-filters::-webkit-scrollbar{display:none}
        @media(min-width:641px){.lsx-filters{top:52px}}
      ` }} />
      {back}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
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
      <div style={{ marginTop: 6, fontSize: 11.5, color: C.faint }}>Thumb anything up or down. We see it instantly.</div>
      <div className="lsx-anchor" />
      {shelves.length > 1 && (
        <nav className="lsx-filters" aria-label="Shelves">
          {[{ id: null as string | null, name: "All", n: items.length }, ...shelves].map(f => (
            <button key={f.id ?? "all"} onClick={() => pick(f.id)} aria-pressed={active === f.id}
              style={{ flex: "none", background: "none", border: "none", borderBottom: `2px solid ${active === f.id ? C.text : "transparent"}`, padding: "10px 0 8px", cursor: "pointer", fontFamily: C.font, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: active === f.id ? C.text : C.faint, whiteSpace: "nowrap" }}>
              {f.name}<span style={{ fontFamily: C.mono, fontWeight: 600, letterSpacing: 0, marginLeft: 5, color: C.faint }}>{f.n}</span>
            </button>
          ))}
        </nav>
      )}
      {shelves.filter(f => active === null || f.id === active).map(f => renderShelf(f.name, f.list))}
    </div>
  );
}
