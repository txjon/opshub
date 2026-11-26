"use client";
import { useEffect, useState } from "react";
import { ImageLightbox } from "@/components/DriveThumb";
import { useNoPageZoom } from "@/lib/useNoPageZoom";

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
  const [noteFor, setNoteFor] = useState<string | null>(null);   // item whose comment field is open
  const [hold, setHold] = useState<string | null>(null);         // just-thumbed item holding its shelf spot until he moves on
  const [zoom, setZoom] = useState<any>(null);                    // item open full screen
  useNoPageZoom();                                                // app feel: the page doesn't pinch; the viewer does
  const load = () => fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`).then(r => r.json()).then(j => { if (j.error) setMissing(true); else setData(j); }).catch(() => setMissing(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [releaseId]);
  const back = <a href={`/portal/client/${token}/releases`} style={{ color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" }}>‹ {data?.release?.title || "Releases"}</a>;
  if (missing) return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px", fontFamily: C.font }}>{back}<div style={{ color: C.faint, fontSize: 13, marginTop: 14 }}>No line sheet on this release yet.</div></div>;
  if (!data) return <div style={{ padding: 40, color: C.faint, fontFamily: C.font, fontSize: 13 }}>Loading…</div>;
  const { sheet, version, sections } = data;
  const items: any[] = data.items;
  const bySection: Record<string, any[]> = {};
  const loose: any[] = [];
  // Thumbed pieces leave their shelf for a bucket: thumbs-up to "Selections"
  // at the top (Jon, Nov 25), thumbs-down to "Not approved" at the bottom
  // (Oct 1). The shelf itself is untouched, so Clear puts a piece straight
  // back. A fresh thumb holds its spot until he acts on another piece, so the
  // card never jumps out from under his finger.
  const selections: any[] = [];
  const notApproved: any[] = [];
  for (const it of items) {
    if (it.thumb === "up" && hold !== it.id) { selections.push(it); continue; }
    if (it.thumb === "down" && hold !== it.id) { notApproved.push(it); continue; }
    if (it.section_id && sections.some((s: any) => s.id === it.section_id)) (bySection[it.section_id] ||= []).push(it); else loose.push(it);
  }
  const newCount = items.filter(i => i.badge === "new").length;
  const updCount = items.filter(i => i.badge === "updated").length;

  // On a shelf: 👍 / 👎 (tap again to undo). In a bucket: thumb = null is
  // Clear, back to its shelf with both thumbs open. The comment is untouched.
  async function react(it: any, thumb: "up" | "down" | null) {
    const next = thumb && it.thumb === thumb ? null : thumb;
    if (noteFor !== it.id) setNoteFor(null);
    setHold(thumb ? it.id : null);
    setData((d: any) => ({ ...d, items: d.items.map((x: any) => x.id === it.id ? { ...x, thumb: next } : x) }));
    const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: it.id, thumb: next }) }).catch(() => null);
    if (!r || !r.ok) load();
  }

  // His comment (mig 213): any piece, any time, thumb or not. Saves on
  // blur/Enter; empty clears it. A fresh one is about the current picture.
  function openNote(it: any) {
    if (hold && hold !== it.id) setHold(null);
    setNoteFor(noteFor === it.id ? null : it.id);
  }
  async function saveNote(it: any, raw: string) {
    const note = raw.replace(/\s*\n\s*/g, " ").trim() || null;
    setNoteFor(null);
    if ((it.note || null) === note) return;
    setData((d: any) => ({ ...d, items: d.items.map((x: any) => x.id === it.id ? { ...x, note, noteStale: false } : x) }));
    const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: it.id, note }) }).catch(() => null);
    if (!r || !r.ok) load();
  }

  const NoteIcon = ({ filled, size = 15 }: { filled: boolean; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle" }} aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );

const ThumbIcon = ({ dir, size = 15 }: { dir: "up" | "down"; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dir === "down" ? "rotate(180deg)" : undefined, verticalAlign: "middle" }} aria-hidden>
      <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );

  const itemCard = (it: any) => {
    const imgs = it.images || [];
    return (
      <div key={it.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", width: "100%" }}>
        <div onClick={() => imgs[0] && setZoom(it)} role={imgs[0] ? "button" : undefined} aria-label={imgs[0] ? "View larger" : undefined}
          style={{ position: "relative", aspectRatio: "1", width: "100%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: imgs[0] ? "zoom-in" : undefined }}>
          {imgs.length > 1 ? (
            <>
              <img src={thumbUrl(imgs[0].driveId, 800)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: "62%", height: "92%", objectFit: "contain", marginRight: "-14%", zIndex: 2, mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
              <img src={thumbUrl(imgs[1].driveId, 800)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: "62%", height: "92%", objectFit: "contain", zIndex: 1, mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.display = "none"; }} />
            </>
          ) : imgs[0] ? (
            <img src={thumbUrl(imgs[0].driveId, 800)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
          ) : null}
          {it.badge && <span style={{ position: "absolute", top: 8, left: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: it.badge === "new" ? C.green : C.amber, background: "rgba(10,10,10,.85)", borderRadius: 6, padding: "3px 8px", zIndex: 3 }}>{it.badge}</span>}
        </div>
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{it.name || (it.item_no ? String(it.item_no).padStart(2, "0") : "Untitled")}</div>
          {(() => {
            const btn = (on: boolean, col: string, wash: string): React.CSSProperties => ({ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${on ? col : C.line}`, background: on ? wash : "transparent", cursor: "pointer", color: on ? col : C.dim, display: "grid", placeItems: "center", fontFamily: C.font });
            const noteBtn = <button onClick={() => openNote(it)} aria-label={it.note ? "Edit comment" : "Add a comment"} aria-expanded={noteFor === it.id}
              style={{ ...btn(!!it.note, C.text, "rgba(255,255,255,.08)"), flex: "0 0 44px" }}><NoteIcon filled={!!it.note} /></button>;
            // in a bucket (Selections / Not approved): the verdict, the comment, Clear
            if (it.thumb && hold !== it.id) {
              const up = it.thumb === "up";
              return (
                <div style={{ display: "flex", gap: 8, marginTop: 9, alignItems: "center" }}>
                  {/* the bucket heading names it; the card shows which way (shape, not just colour) */}
                  <span role="img" aria-label={up ? "Selected" : "Not approved"} style={{ flex: 1, display: "flex", alignItems: "center", paddingLeft: 4, color: up ? C.green : C.red }}>
                    <ThumbIcon dir={up ? "up" : "down"} size={16} />
                  </span>
                  {noteBtn}
                  <button onClick={() => react(it, null)} aria-label="Clear: back to its shelf"
                    style={{ ...btn(false, C.text, ""), flex: "0 0 auto", padding: "7px 12px", fontSize: 11, fontWeight: 700 }}>Clear</button>
                </div>
              );
            }
            return (
              <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                <button onClick={() => react(it, "up")} aria-label="Thumbs up" aria-pressed={it.thumb === "up"} style={btn(it.thumb === "up", C.green, "rgba(88,201,60,.14)")}><ThumbIcon dir="up" /></button>
                <button onClick={() => react(it, "down")} aria-label="Thumbs down" aria-pressed={it.thumb === "down"} style={btn(it.thumb === "down", C.red, "rgba(255,90,110,.12)")}><ThumbIcon dir="down" /></button>
                {noteBtn}
              </div>
            );
          })()}
          {noteFor === it.id ? (
            <textarea autoFocus rows={2} defaultValue={it.note || ""} placeholder="Add a comment" maxLength={500} aria-label="Comment"
              // Escape cancels: flag it so the blur that follows doesn't save
              onBlur={e => { if (e.currentTarget.dataset.cancel) return; saveNote(it, e.target.value); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { e.currentTarget.dataset.cancel = "1"; setNoteFor(null); } }}
              style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, outline: "none", color: C.text, fontSize: 16, fontFamily: C.font, padding: "7px 9px", resize: "none", lineHeight: 1.35 }} />
          ) : it.note ? (
            <button onClick={() => openNote(it)} title="Edit comment" style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.dim, fontSize: 12, fontFamily: C.font, lineHeight: 1.4 }}>
              <span style={{ fontStyle: "italic", overflowWrap: "anywhere" }}>&ldquo;{it.note}&rdquo;</span>
              {it.noteStale && <span style={{ display: "block", marginTop: 3, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>On the previous version</span>}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const renderShelf = (id: string, title: string, list: any[]) => list.length ? (
    <section key={id} style={{ marginTop: 30 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", margin: "0 0 12px", color: C.text }}>{title}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>{list.map(itemCard)}</div>
    </section>
  ) : null;

  const shelves = [
    { id: "__up", name: "Selections", list: selections },
    ...sections.map((s: any) => ({ id: s.id as string, name: s.name as string, list: bySection[s.id] || [] })),
    { id: "__more", name: sections.length ? "More" : "The line", list: loose },
    { id: "__down", name: "Not approved", list: notApproved },
  ].filter(f => f.list.length).map(f => ({ ...f, n: f.list.length }));
  const active = shelf && shelves.some(f => f.id === shelf) ? shelf : null;
  // Picking a shelf keeps the filter row in view instead of leaving the
  // client staring at the bottom of a shorter page.
  function pick(id: string | null) {
    setShelf(id); setHold(null);
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
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginTop: 8, fontSize: 11, fontFamily: C.mono, color: C.faint }}>
        <span style={{ color: C.blue, fontWeight: 700 }}>v{version.n}</span>
        <span>published {fmt(version.published_at)}</span>
        {newCount > 0 && <span style={{ color: C.green }}>{newCount} new</span>}
        {updCount > 0 && <span style={{ color: C.amber }}>{updCount} updated</span>}
      </div>
      {version.note && <div style={{ marginTop: 10, padding: "11px 14px", background: C.surface, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 10, fontSize: 13, color: C.dim, maxWidth: 640 }}>{version.note}</div>}
      <div style={{ marginTop: 6, fontSize: 11.5, color: C.faint }}>Thumb anything up or down, or leave a comment. We see it instantly.</div>
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
      {shelves.filter(f => active === null || f.id === active).map(f => renderShelf(f.id, f.name, f.list))}
      {zoom && (
        <ImageLightbox preview driveFileId={zoom.images[0].driveId} more={zoom.images.slice(1).map((m: any) => m.driveId)}
          title={zoom.name || undefined} onClose={() => setZoom(null)} />
      )}
    </div>
  );
}
