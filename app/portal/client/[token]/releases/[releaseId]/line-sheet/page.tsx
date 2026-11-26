"use client";
import { useEffect, useRef, useState } from "react";
import { ImageLightbox } from "@/components/DriveThumb";
import { useNoPageZoom } from "@/lib/useNoPageZoom";
import { VerdictRow } from "@/components/LineSheetVerdicts";

// THE LINE SHEET, client side (mig 190) — the line as a webstore they react
// to: one list of concepts, product cards (front/back nested), and a verdict
// on each (mig 215): As is · Change · Pass. Always the latest PUBLISHED art;
// drafts never show here. Since mig 192 it's the proposal stage of one
// release, so it lives under that release.
const C = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const thumbUrl = (id: string, size = 500) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

export default function ReleaseLineSheet({ params }: { params: { token: string; releaseId: string } }) {
  return <SheetView token={params.token} releaseId={params.releaseId} />;
}

type Group = "asis" | "change" | "liked" | "concepts" | "pass";
const groupOf = (it: any): Group => it.verdict === "asis" || it.verdict === "change" || it.verdict === "liked" || it.verdict === "pass" ? it.verdict : "concepts";
// top to bottom: what's decided, what's being worked, what needs an answer,
// the open concepts, and what he passed on
const GROUPS: { id: Group; name: string; hint?: string }[] = [
  { id: "asis", name: "Good to go" },
  { id: "change", name: "Changes asked", hint: "We're on these. We'll post the new version here." },
  { id: "liked", name: "You liked these", hint: "As is, or change something?" },
  { id: "concepts", name: "Concepts" },
  { id: "pass", name: "Passed" },
];

function SheetView({ token, releaseId }: { token: string; releaseId: string }) {
  const [data, setData] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<Group | null>(null);      // null = everything
  // the note box open on one card: "change" = what should change (a Change
  // saves with it), "note" = a plain note on an As is / Pass
  const [noteFor, setNoteFor] = useState<{ id: string; mode: "change" | "note" } | null>(null);
  // a card he just answered keeps its spot until he acts on another, so it
  // never jumps out from under his finger
  const [hold, setHold] = useState<{ id: string; group: Group } | null>(null);
  const [zoom, setZoom] = useState<any>(null);                    // item open full screen
  const [err, setErr] = useState("");
  // notes stay folded behind a comment icon (Jon, Nov 26); tap it to read
  const [shownNotes, setShownNotes] = useState<string[]>([]);
  // On a phone the note box's blur lands just BEFORE the tap that caused it.
  // noteClosed remembers that blur for a moment, so the tap that follows
  // (Change to confirm, As is after a note, Change again to back out) never
  // undoes or reopens what the blur just did.
  const noteClosed = useRef<{ id: string; at: number } | null>(null);
  // one write at a time, in order: a note save and the tap after it can't race
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const noteRef = useRef<HTMLTextAreaElement | null>(null);       // the open note box, read when a verdict is tapped
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(""), 6000); return () => clearTimeout(t); }, [err]);
  useNoPageZoom();                                                // app feel: the page doesn't pinch; the viewer does
  const load = () => fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`).then(r => r.json()).then(j => { if (j.error) setMissing(true); else setData(j); }).catch(() => setMissing(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [releaseId]);
  const back = <a href={`/portal/client/${token}/releases`} style={{ color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" }}>‹ {data?.release?.title || "Releases"}</a>;
  if (missing) return <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px", fontFamily: C.font }}>{back}<div style={{ color: C.faint, fontSize: 13, marginTop: 14 }}>No line sheet on this release yet.</div></div>;
  if (!data) return <div style={{ padding: 40, color: C.faint, fontFamily: C.font, fontSize: 13 }}>Loading…</div>;
  const { sheet, version } = data;
  const items: any[] = data.items;
  const shownGroup = (it: any): Group => hold && hold.id === it.id ? hold.group : groupOf(it);
  const byGroup: Record<Group, any[]> = { asis: [], change: [], liked: [], concepts: [], pass: [] };
  for (const it of items) byGroup[shownGroup(it)].push(it);
  const newCount = items.filter(i => i.badge === "new").length;
  const updCount = items.filter(i => i.badge === "updated").length;

  const post = (body: any): Promise<boolean> => {
    const run = chain.current.then(async () => {
      const r = await fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: data?.version?.n, ...body }) }).catch(() => null);
      if (r && r.ok) return true;
      const j = r ? await r.json().catch(() => null) : null;
      setErr(j?.error || "That didn't save. Check your connection and try again.");
      load();
      return false;
    });
    chain.current = run;
    return run;
  };
  const patchLocal = (id: string, p: any) => setData((d: any) => ({ ...d, items: d.items.map((x: any) => x.id === id ? { ...x, ...p } : x) }));
  // acting on a card lets the last one he answered move to its group
  const touch = (it: any) => { if (hold && hold.id !== it.id) setHold(null); if (noteFor && noteFor.id !== it.id) setNoteFor(null); };

  // As is / Pass save at once; tapping the one he picked undoes it. Change
  // opens the note box: it saves when he says what should change.
  async function pick(it: any, v: "asis" | "change" | "pass") {
    // A note box open on ANOTHER card: the tap doesn't blur it (the buttons
    // never take focus), so save what's typed there first; the chain keeps
    // the order.
    if (noteFor && noteFor.id !== it.id && noteRef.current) {
      const other = items.find(x => x.id === noteFor.id);
      const el = noteRef.current;
      el.dataset.cancel = "1";
      // not awaited: saveNote queues its write synchronously, so order holds
      if (other) void saveNote(other, el.value, noteFor.mode);
      else setNoteFor(null);
    }
    // The note box on this card is still open (the tap didn't take focus):
    // the tap is the answer, with what's typed in the box.
    const el = noteFor?.id === it.id ? noteRef.current : null;
    if (el && noteFor) {
      const mode = noteFor.mode;
      const text = el.value.replace(/\s*\n\s*/g, " ").trim();
      el.dataset.cancel = "1";             // its unmount blur must not save again
      setErr("");
      if (mode === "change" && v === "change") { if (text) await saveNote(it, text, "change"); else setNoteFor(null); return; }
      if (mode === "change") {
        // typed a change, then picked As is / Pass: that verdict, note kept
        setNoteFor(null);
        setHold({ id: it.id, group: hold && hold.id === it.id ? hold.group : groupOf(it) });
        patchLocal(it.id, { verdict: v, verdictBy: "client", ...(text ? { note: text, noteStale: false } : {}), badge: null });
        if (text) await post({ itemId: it.id, note: text });
        await post({ itemId: it.id, verdict: v });
        return;
      }
      // a plain note, then Change: that note IS what should change (empty:
      // ask for it)
      if (v === "change") {
        if (text) await saveNote(it, text, "change"); else setNoteFor({ id: it.id, mode: "change" });
        return;
      }
      // a plain note: save it; tapping the verdict he has confirms, another one switches
      await saveNote(it, text, "note");
      noteClosed.current = null;
      if (v === it.verdict) return;
      // (falls through to set As is / Pass below)
    }
    const nc = noteClosed.current;
    const afterNote = !!nc && nc.id === it.id && Date.now() - nc.at < 700;
    noteClosed.current = null;
    // the tap that closed the note box: Change confirmed (or backed out of),
    // or the verdict he already has. Nothing more to do.
    if (afterNote && (v === "change" || v === it.verdict)) return;
    setErr("");
    touch(it);
    if (v === "change" && it.verdict !== "change") { setNoteFor({ id: it.id, mode: "change" }); return; }
    const next = it.verdict === v ? null : v;
    setNoteFor(null);
    setHold({ id: it.id, group: hold && hold.id === it.id ? hold.group : groupOf(it) });
    patchLocal(it.id, { verdict: next, verdictBy: next ? "client" : null, badge: null });
    await post({ itemId: it.id, verdict: next });
  }

  // Opening a piece full screen = he looked: its NEW / UPDATED badge retires
  // (mig 214). Fire and forget; the server ignores HPD's own previews.
  function openZoom(it: any) {
    setZoom(it);
    if (!it.badge) return;
    patchLocal(it.id, { badge: null });
    fetch(`/api/portal/client/${token}/releases/${releaseId}/line-sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: data?.version?.n, itemId: it.id, seen: true }) }).catch(() => {});
  }

  async function saveNote(it: any, raw: string, mode: "change" | "note") {
    const note = raw.replace(/\s*\n\s*/g, " ").trim() || null;
    setNoteFor(null);
    noteClosed.current = { id: it.id, at: Date.now() };
    setErr("");
    if (mode === "change") {
      if (!note) return;   // nothing said: no Change
      setHold({ id: it.id, group: hold && hold.id === it.id ? hold.group : groupOf(it) });
      patchLocal(it.id, { verdict: "change", verdictBy: "client", note, noteStale: false, badge: null });
      await post({ itemId: it.id, verdict: "change", note });
      return;
    }
    if ((it.note || null) === note || (!note && it.verdict === "change")) return;   // a Change keeps its note
    patchLocal(it.id, { note, noteStale: false, badge: null });
    await post({ itemId: it.id, note });
  }

  const itemCard = (it: any) => {
    const imgs = it.images || [];
    const open = noteFor?.id === it.id ? noteFor : null;
    const quote = (text: string) => <span style={{ fontStyle: "italic", overflowWrap: "anywhere" }}>&ldquo;{text}&rdquo;</span>;
    const cap = (text: string, color: string = C.faint) => <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color, marginBottom: 3 }}>{text}</span>;
    return (
      <div key={it.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", width: "100%", display: "flex", flexDirection: "column" }}>
        <div onClick={() => imgs[0] && openZoom(it)} role={imgs[0] ? "button" : undefined} aria-label={imgs[0] ? "View larger" : undefined}
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
        <div style={{ padding: "10px 12px 12px", flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{it.name || (it.item_no ? String(it.item_no).padStart(2, "0") : "Untitled")}</div>
            {it.note && !open && (
              <button onClick={() => setShownNotes(n => n.includes(it.id) ? n.filter(x => x !== it.id) : [...n, it.id])}
                aria-label={shownNotes.includes(it.id) ? "Hide note" : "Show note"} aria-expanded={shownNotes.includes(it.id)}
                style={{ flex: "none", margin: "-6px -6px 0 0", padding: 6, background: "none", border: "none", cursor: "pointer", color: shownNotes.includes(it.id) ? C.text : C.dim, display: "grid", placeItems: "center" }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill={shownNotes.includes(it.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </button>
            )}
          </div>
          {open ? (
            <textarea key={open.mode} ref={noteRef} autoFocus rows={2} defaultValue={open.mode === "change" && (it.noteStale || it.verdict !== "change") ? "" : it.note || ""} maxLength={500}
              placeholder={open.mode === "change" ? "What should change?" : "Add a note"} aria-label={open.mode === "change" ? "What should change?" : "Note"}
              // Escape cancels: flag it so the blur that follows doesn't save
              onBlur={e => { if (e.currentTarget.dataset.cancel) return; saveNote(it, e.target.value, open.mode); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { e.currentTarget.dataset.cancel = "1"; setNoteFor(null); } }}
              style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, background: C.surface, border: `1px solid ${open.mode === "change" ? C.amber : C.line}`, borderRadius: 8, outline: "none", color: C.text, fontSize: 16, fontFamily: C.font, padding: "7px 9px", resize: "none", lineHeight: 1.35 }} />
          ) : it.note && shownNotes.includes(it.id) ? (
            <button onClick={() => { touch(it); setNoteFor({ id: it.id, mode: it.verdict === "change" ? "change" : "note" }); }} title="Edit"
              style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.dim, fontSize: 12, fontFamily: C.font, lineHeight: 1.4 }}>
              {/* the note on the picture he's looking at, or what he asked for on the one before it */}
              {it.noteStale ? cap(it.verdict ? "You asked, on the last version" : "You asked. Updated, good now?", it.verdict ? C.faint : C.amber) : it.verdict === "change" ? cap("What to change", C.amber) : null}
              {quote(it.note)}
            </button>
          ) : null}
          {/* actions pinned to the card's foot: every card in a row lines up, whatever the name or note length */}
          <div style={{ marginTop: "auto", paddingTop: 10 }}>
            <VerdictRow value={it.verdict === "liked" ? null : it.verdict} pending={open?.mode === "change"} onPick={v => pick(it, v)}
              p={{ line: C.line, dim: C.dim, ink: C.bg, green: C.green, amber: C.amber, red: C.red, font: C.font }} />
            {it.verdictBy === "hpd" && it.verdict && it.verdict !== "liked" && <div style={{ marginTop: 6, fontSize: 9.5, color: C.faint, letterSpacing: "0.04em" }}>Marked by HPD</div>}
          </div>
        </div>
      </div>
    );
  };

  const groups = GROUPS.map(g => ({ ...g, list: byGroup[g.id], n: byGroup[g.id].length })).filter(g => g.n);
  const active = filter && groups.some(g => g.id === filter) ? filter : null;
  // Picking a group keeps the filter row in view instead of leaving the
  // client staring at the bottom of a shorter page.
  function choose(id: Group | null) {
    setFilter(id); setHold(null);
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
      <div style={{ marginTop: 6, fontSize: 11.5, color: C.faint }}>Tap As is, Change or Pass on anything. Tap it again to undo. We see it instantly.</div>
      {err && <div role="alert" onClick={() => setErr("")} style={{ position: "fixed", left: 16, right: 16, bottom: 84, zIndex: 60, maxWidth: 520, margin: "0 auto", background: C.surface, border: `1px solid ${C.red}`, borderRadius: 10, padding: "11px 14px", fontSize: 13, color: C.text }}>{err}</div>}
      <div className="lsx-anchor" />
      {groups.length > 1 && (
        <nav className="lsx-filters" aria-label="Groups">
          {[{ id: null as Group | null, name: "All", n: items.length }, ...groups].map(g => (
            <button key={g.id ?? "all"} onClick={() => choose(g.id)} aria-pressed={active === g.id}
              style={{ flex: "none", background: "none", border: "none", borderBottom: `2px solid ${active === g.id ? C.text : "transparent"}`, padding: "10px 0 8px", cursor: "pointer", fontFamily: C.font, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: active === g.id ? C.text : C.faint, whiteSpace: "nowrap" }}>
              {g.name}<span style={{ fontFamily: C.mono, fontWeight: 600, letterSpacing: 0, marginLeft: 5, color: C.faint }}>{g.n}</span>
            </button>
          ))}
        </nav>
      )}
      {groups.filter(g => active === null || g.id === active).map(g => (
        <section key={g.id} style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", margin: 0, color: C.text }}>{g.name}</h2>
          {g.hint && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>{g.hint}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12, marginTop: 12 }}>{g.list.map(itemCard)}</div>
        </section>
      ))}
      {zoom && (
        <ImageLightbox preview driveFileId={zoom.images[0].driveId} more={zoom.images.slice(1).map((m: any) => m.driveId)}
          title={zoom.name || undefined} onClose={() => setZoom(null)} />
      )}
    </div>
  );
}
