"use client";
import { useEffect, useRef, useState } from "react";
import { ImageLightbox } from "@/components/DriveThumb";
import { VerdictRow } from "@/components/LineSheetVerdicts";

// THE LINE SHEET VIEW — one presentation, two seats (Jon, Nov 26 2026: "we
// see it internally how he sees it… I like the way his looks better"). The
// client's hub page and HPD's builder both render THIS: the group chips, the
// cards, As is · Change · Pass, notes folded behind 💬, NEW / UPDATED. HPD's
// seat adds only what HPD needs on top: drafts (badge DRAFT), the item number,
// hover tools on the picture, tap-to-select, and drag in Concepts.
//
// The parent owns loading; this owns the interaction (optimistic verdicts and
// notes, the hold, the note box) and hands every write to `save`, so the
// client's POST and HPD's PATCH share every rule.
export const LS = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const C = LS;
const thumbUrl = (id: string, size = 500) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;

export type ViewItem = {
  id: string; name: string | null; item_no: number | null;
  images: { id?: string; driveId: string; name?: string | null }[];
  badge: "new" | "updated" | "draft" | null;
  verdict: "asis" | "change" | "pass" | "liked" | null; verdictBy: "client" | "hpd" | null;
  note: string | null; noteStale: boolean;
  reworked?: boolean;   // he wrote on it and new art is up since (lib/line-sheets askedAgain)
};
type Settable = "asis" | "change" | "pass";
export type SaveBody = { itemId: string; verdict?: Settable | null; note?: string | null; seen?: true };
type Handle = { listeners?: any; attributes?: any };

type Group = "fresh" | "asis" | "change" | "liked" | "concepts" | "pass";
// UPDATED and not answered yet: up top, so a change he asked for comes back
// where he'll see it, not buried in Concepts (Jon, Nov 26). NEW pieces wear
// their badge in Concepts, so a batch of new ones never buries the asks in
// motion (Jon, Nov 27). Answering
// moves it to its verdict's group and retires the badge. A card he wrote on
// that got new art stays up top until he answers the new version, even after a look.
// `fresh` = the badge as LOADED: a look retires the badge on screen but only
// an answer moves the card (the next load knows about the look).
const groupOf = (it: ViewItem, fresh: Set<string>): Group => it.verdict === "asis" || it.verdict === "change" || it.verdict === "liked" || it.verdict === "pass" ? it.verdict
  : fresh.has(it.id) || it.reworked ? "fresh" : "concepts";
// top to bottom: what's new to look at, what's decided, what's being worked,
// what needs an answer, the open concepts, and what he passed on
const GROUPS: { id: Group; name: string; hint?: string }[] = [
  { id: "fresh", name: "Updated" },
  { id: "asis", name: "Good to go" },
  { id: "change", name: "Changes asked", hint: "We're on these. We'll post the new version here." },
  { id: "liked", name: "You liked these", hint: "As is, or change something?" },
  { id: "concepts", name: "Concepts" },
  { id: "pass", name: "Passed" },
];

// A release as the planner sees it (lib/line-sheets boardReleases).
export type ViewRelease = { id: string; title: string; status: string; target_live_date: string | null; cardIds: string[] };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string | null) => { const m = d && /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? `${MON[+m[2] - 1]} ${+m[3]}` : ""; };
// two releases can share a name (FOG has two "12-2026 Pre-Order"): the date tells them apart
const relLabel = (r: ViewRelease, all: ViewRelease[]) => all.some(o => o.id !== r.id && o.title.trim().toLowerCase() === r.title.trim().toLowerCase()) && r.target_live_date ? `${r.title} · ${day(r.target_live_date)}` : r.title;

export function LineSheetView({ items: itemsIn, stamp, head, save, onSettled, stickyTop = 0, readOnly, staff, releases = [], addToRelease }: {
  items: ViewItem[];
  stamp: unknown;                              // changes on every fresh load (the parent's data object)
  head: React.ReactNode;                       // title, version line, note (each seat its own)
  save: (b: SaveBody) => Promise<true | string>;   // the write; a string = it failed, and why
  onSettled?: (hadFailure: boolean) => void;   // every queued write is done (reload here, once)
  readOnly?: boolean;                          // archived: look, don't touch
  stickyTop?: number;                          // the group chips stick under the seat's own top bar
  // The planner (Jon, Nov 27 2026): each release is a filter chip, and an
  // As is card carries "Add to release" (the client's seat; HPD adds from
  // the selection menu). addToRelease(card, releaseId) adds it; null = a
  // new release; it runs in the write queue after any answer still saving,
  // and the seat reloads in onSettled. `addable` = the ids it can add to.
  releases?: ViewRelease[];
  addToRelease?: { add: (it: ViewItem, releaseId: string | null) => Promise<true | string>; addable: string[] };
  staff?: {
    selected: string[];
    onSelect: (id: string, shift: boolean) => void;
    numberOf: (it: ViewItem) => string | null;
    tools: (it: ViewItem) => React.ReactNode;             // on the picture, shown on hover
    footnote?: (it: ViewItem) => React.ReactNode;         // one quiet line, e.g. "on HPD-2611-022"
    onRename: (it: ViewItem, name: string) => void;       // the name is a dotted-underline editable for HPD
    // Concepts is HPD's drag list: wrap its grid (dnd-kit) and pass the
    // picture's drag handle back into card()
    concepts?: (list: ViewItem[], card: (it: ViewItem, h?: Handle) => React.ReactNode) => React.ReactNode;
  };
}) {
  // local, optimistic edits over the parent's items; a fresh load replaces them
  const [patches, setPatches] = useState<Record<string, Partial<ViewItem>>>({});
  useEffect(() => { setPatches({}); }, [stamp]);
  const items = itemsIn.map(it => patches[it.id] ? { ...it, ...patches[it.id] } : it);
  const freshIds = new Set(itemsIn.filter(it => it.badge === "updated").map(it => it.id));
  const groupOfIt = (it: ViewItem) => groupOf(it, freshIds);
  const [filter, setFilter] = useState<string | null>(null);     // a group, "rel:<id>", or null = everything
  const [relFor, setRelFor] = useState<string | null>(null);     // the card whose "Add to release" list is open
  const [adding, setAdding] = useState(false);
  // the note box open on one card: "change" = what should change (a Change
  // saves with it), "note" = editing a note that's there
  const [noteFor, setNoteFor] = useState<{ id: string; mode: "change" | "note" } | null>(null);
  // a card just answered keeps its spot until the next card is touched, so it
  // never jumps out from under a finger
  const [hold, setHold] = useState<{ id: string; group: Group } | null>(null);
  const [zoom, setZoom] = useState<ViewItem | null>(null);
  const [err, setErr] = useState("");
  // The client's layout (Jon, Nov 27): "list" = full cards to answer on,
  // "grid" = small tiles (3 across on a phone) to look over; a tile shows
  // its answer and opens full screen. Remembered per browser.
  const [layout, setLayout] = useState<"list" | "grid">("list");
  useEffect(() => { try { if (localStorage.getItem("planner-layout") === "grid") setLayout("grid"); } catch {} }, []);
  const pickLayout = (l: "list" | "grid") => { setLayout(l); try { localStorage.setItem("planner-layout", l); } catch {} };
  const tiles = layout === "grid" && !staff;
  // notes stay folded behind a comment icon (Jon, Nov 26); tap it to read
  const [shownNotes, setShownNotes] = useState<string[]>([]);
  // On a phone the note box's blur can land just BEFORE the tap that caused
  // it. noteClosed remembers that blur for a moment, so the tap that follows
  // (Change to confirm, the same verdict, Change again to back out) never
  // undoes or reopens what the blur just did.
  const noteClosed = useRef<{ id: string; at: number } | null>(null);
  // one write at a time, in order: a note save and the tap after it can't race
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const noteRef = useRef<HTMLTextAreaElement | null>(null);       // the open note box, read when a verdict is tapped
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(""), 6000); return () => clearTimeout(t); }, [err]);

  const who = staff ? "hpd" as const : "client" as const;
  const shownGroup = (it: ViewItem): Group => hold && hold.id === it.id ? hold.group : groupOfIt(it);
  const byGroup: Record<Group, ViewItem[]> = { fresh: [], asis: [], change: [], liked: [], concepts: [], pass: [] };
  for (const it of items) byGroup[shownGroup(it)].push(it);

  // pending = writes still queued; the parent hears once when they're all
  // done, so a reload never wipes an edit that hasn't been sent yet
  const pending = useRef(0);
  const failed = useRef(false);
  // any write takes its turn in the one queue (verdicts, notes, adding to
  // a release): nothing jumps an answer that hasn't saved yet
  const queued = (write: () => Promise<true | string>): Promise<boolean> => {
    pending.current++;
    const run = chain.current.then(async () => {
      const r = await write().catch(() => "That didn't save. Check your connection and try again.");
      if (r !== true) { setErr(r); failed.current = true; }
      return r === true;
    }).finally(() => { if (--pending.current === 0) { const f = failed.current; failed.current = false; onSettled?.(f); } });
    chain.current = run;
    return run;
  };
  const post = (body: SaveBody) => queued(() => save(body));
  const patchLocal = (id: string, p: Partial<ViewItem>) => setPatches(m => ({ ...m, [id]: { ...m[id], ...p } }));
  const keepSpot = (it: ViewItem) => setHold({ id: it.id, group: hold && hold.id === it.id ? hold.group : groupOfIt(it) });
  // acting on a card lets the last one answered move to its group
  const touch = (it: ViewItem) => { if (hold && hold.id !== it.id) setHold(null); if (noteFor && noteFor.id !== it.id) setNoteFor(null); };
  // a verdict or note from the client retires the badge; HPD's never does
  const seenPatch = staff ? {} : { badge: null };

  // As is / Pass save at once; tapping the one it has undoes it. Change
  // opens the note box: it saves when it says what should change.
  async function pick(it: ViewItem, v: Settable) {
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
        keepSpot(it);
        patchLocal(it.id, { verdict: v, verdictBy: who, ...(text ? { note: text, noteStale: false } : {}), ...seenPatch });
        if (text) await post({ itemId: it.id, note: text });
        await post({ itemId: it.id, verdict: v });
        return;
      }
      // editing a note, then Change: that note IS what should change (empty:
      // ask for it)
      if (v === "change") {
        if (text) await saveNote(it, text, "change"); else setNoteFor({ id: it.id, mode: "change" });
        return;
      }
      // editing a note: save it; the verdict it has confirms, another switches
      await saveNote(it, text, "note");
      noteClosed.current = null;
      if (v === it.verdict) return;
      // (falls through to set As is / Pass below)
    }
    const nc = noteClosed.current;
    const afterNote = !!nc && nc.id === it.id && Date.now() - nc.at < 700;
    noteClosed.current = null;
    // the tap that closed the note box: Change confirmed (or backed out of),
    // or the verdict it already has. Nothing more to do.
    if (afterNote && (v === "change" || v === it.verdict)) return;
    setErr("");
    touch(it);
    if (v === "change" && it.verdict !== "change") { setNoteFor({ id: it.id, mode: "change" }); return; }
    const next = it.verdict === v ? null : v;
    setNoteFor(null);
    keepSpot(it);
    patchLocal(it.id, { verdict: next, verdictBy: next ? who : null, ...seenPatch });
    await post({ itemId: it.id, verdict: next });
  }

  // Opening a piece full screen = the client looked: its NEW / UPDATED badge
  // retires (mig 214). HPD taps a picture to select it instead.
  function openZoom(it: ViewItem) {
    setZoom(it);
    if (!it.badge || it.badge === "draft") return;
    patchLocal(it.id, { badge: null });
    void save({ itemId: it.id, seen: true }).catch(() => {});
  }

  async function saveNote(it: ViewItem, raw: string, mode: "change" | "note") {
    const note = raw.replace(/\s*\n\s*/g, " ").trim() || null;
    setNoteFor(null);
    noteClosed.current = { id: it.id, at: Date.now() };
    setErr("");
    if (mode === "change") {
      if (!note) return;   // nothing said: no Change
      keepSpot(it);
      patchLocal(it.id, { verdict: "change", verdictBy: who, note, noteStale: false, ...seenPatch });
      await post({ itemId: it.id, verdict: "change", note });
      return;
    }
    if ((it.note || null) === note || (!note && it.verdict === "change")) return;   // a Change keeps its note
    patchLocal(it.id, { note, noteStale: false, ...seenPatch });
    await post({ itemId: it.id, note });
  }

  const card = (it: ViewItem, handle?: Handle) => {
    const imgs = it.images || [];
    const open = noteFor?.id === it.id ? noteFor : null;
    const sel = staff ? staff.selected.indexOf(it.id) : -1;
    // the item number, on both seats: "#19" in a text means the same card to both
    const no = staff ? staff.numberOf(it) : it.item_no != null ? String(it.item_no).padStart(2, "0") : null;
    const foot = staff?.footnote?.(it);
    const quote = (text: string) => <span style={{ fontStyle: "italic", overflowWrap: "anywhere" }}>&ldquo;{text}&rdquo;</span>;
    const cap = (text: string, color: string = C.faint) => <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color, marginBottom: 3 }}>{text}</span>;
    const badgeCol = it.badge === "new" ? C.green : it.badge === "draft" ? C.blue : C.amber;
    return (
      <div key={it.id} className="lsx-card" data-card={it.id} style={{ background: C.panel, border: `1px solid ${sel >= 0 ? C.blue : C.line}`, outline: sel >= 0 ? `2px solid ${C.blue}` : "none", outlineOffset: -1, borderRadius: 14, overflow: "hidden", width: "100%", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        <div {...(handle?.attributes || {})} {...(handle?.listeners || {})}
          onClick={e => { if (staff) staff.onSelect(it.id, e.shiftKey); else if (imgs[0]) openZoom(it); }}
          role="button" aria-label={staff ? (sel >= 0 ? "Deselect" : "Select") : "View larger"}
          // overflow hidden: with it, aspect-ratio holds even for a tall picture
          // (otherwise the picture's height wins and the card grows)
          style={{ position: "relative", aspectRatio: "1", overflow: "hidden", width: "100%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: staff ? (handle ? "grab" : "pointer") : "zoom-in", touchAction: handle ? "manipulation" : undefined, WebkitTouchCallout: "none", userSelect: "none" }}>
          {imgs.length > 1 ? (
            <>
              <img key={imgs[0].driveId} src={thumbUrl(imgs[0].driveId, 800)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} style={{ width: "62%", height: "92%", objectFit: "contain", marginRight: "-14%", zIndex: 2, mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
              <img key={imgs[1].driveId} src={thumbUrl(imgs[1].driveId, 800)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} style={{ width: "62%", height: "92%", objectFit: "contain", zIndex: 1, mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.display = "none"; }} />
            </>
          ) : imgs[0] ? (
            <img key={imgs[0].driveId} src={thumbUrl(imgs[0].driveId, 800)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
              // a tall sheet (Jon, Nov 27): show its middle, top and bottom
              // cropped; the full picture opens on tap. Keyed by the
              // picture, so a Replace starts fresh (no crop or fade carried over)
              onLoad={(e: any) => { const m = e.target; if (m.naturalHeight > m.naturalWidth * 1.15) m.style.objectFit = "cover"; }}
              onError={(e: any) => { e.target.style.opacity = 0.15; }} />
          ) : null}
          {it.badge && <span style={{ position: "absolute", top: tiles ? 5 : 8, left: tiles ? 5 : 8, fontSize: tiles ? 7.5 : 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: badgeCol, background: "rgba(10,10,10,.85)", borderRadius: 6, padding: "3px 8px", zIndex: 3 }}>{it.badge}</span>}
          {no && !tiles && <span style={{ position: "absolute", left: 8, bottom: 8, fontFamily: C.mono, fontSize: 10, fontWeight: 700, color: "#555", background: "rgba(255,255,255,.92)", borderRadius: 5, padding: "2px 6px", zIndex: 3 }}>{no}</span>}
          {staff && sel >= 0 && <span style={{ position: "absolute", right: 8, top: 8, background: C.blue, color: C.bg, borderRadius: 999, width: 22, height: 22, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900, zIndex: 3 }}>{sel + 1}</span>}
          {imgs.length > 2 && !tiles && <span style={{ position: "absolute", right: 8, bottom: 8, fontSize: 9, fontWeight: 800, color: "#555", background: "rgba(255,255,255,.92)", borderRadius: 5, padding: "2px 6px", zIndex: 3 }}>+{imgs.length - 2}</span>}
          {staff && sel < 0 && staff.tools(it)}
        </div>
        {tiles ? (
          <div style={{ padding: "6px 7px 7px", flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflowWrap: "anywhere" }}>{it.name || (it.item_no ? String(it.item_no).padStart(2, "0") : "Untitled")}</div>
            {it.verdict && it.verdict !== "liked" && <span style={{ marginTop: "auto", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: it.verdict === "asis" ? C.green : it.verdict === "change" ? C.amber : C.faint }}>{it.verdict === "asis" ? "✓ As is" : it.verdict === "change" ? "✎ Change" : "✕ Pass"}</span>}
          </div>
        ) : (
        <div style={{ padding: "10px 12px 12px", flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            {staff && !readOnly ? (
              // Wraps and grows; one logical line: Enter finishes, no newlines saved
              <textarea key={`${it.id}:${it.name || ""}`} rows={1} defaultValue={it.name || ""} placeholder="Name it" aria-label="Name"
                ref={el => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }}
                onInput={e => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={e => staff.onRename(it, e.target.value.replace(/\s*\n\s*/g, " ").trim())}
                style={{ flex: 1, minWidth: 0, background: "none", border: "none", borderBottom: "1px dotted rgba(255,255,255,.3)", outline: "none", padding: 0, color: C.text, fontFamily: C.font, fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, resize: "none", overflow: "hidden", display: "block" }} />
            ) : (
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{it.name || (it.item_no ? String(it.item_no).padStart(2, "0") : "Untitled")}</div>
            )}
            {it.note && !open && (
              <button onClick={() => setShownNotes(n => n.includes(it.id) ? n.filter(x => x !== it.id) : [...n, it.id])}
                aria-label={shownNotes.includes(it.id) ? "Hide note" : "Show note"} aria-expanded={shownNotes.includes(it.id)}
                style={{ flex: "none", margin: "-6px -6px 0 0", padding: 6, background: "none", border: "none", cursor: "pointer", color: shownNotes.includes(it.id) ? C.text : it.verdict === "change" ? C.amber : C.dim, display: "grid", placeItems: "center" }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill={shownNotes.includes(it.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </button>
            )}
          </div>
          {open ? (
            <textarea key={open.mode} ref={noteRef} autoFocus rows={2} defaultValue={open.mode === "change" && (it.noteStale || it.verdict !== "change") ? "" : it.note || ""} maxLength={500}
              placeholder={open.mode === "change" ? (staff ? "What should change? (their words)" : "What should change?") : "Note"} aria-label={open.mode === "change" ? "What should change?" : "Note"}
              // Escape cancels: flag it so the blur that follows doesn't save
              onBlur={e => { if (e.currentTarget.dataset.cancel) return; saveNote(it, e.target.value, open.mode); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { e.currentTarget.dataset.cancel = "1"; setNoteFor(null); } }}
              style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, background: C.surface, border: `1px solid ${open.mode === "change" ? C.amber : C.line}`, borderRadius: 8, outline: "none", color: C.text, fontSize: 16, fontFamily: C.font, padding: "7px 9px", resize: "none", lineHeight: 1.35 }} />
          ) : it.note && shownNotes.includes(it.id) ? (
            <button disabled={readOnly} onClick={() => { touch(it); setNoteFor({ id: it.id, mode: it.verdict === "change" ? "change" : "note" }); }} title={readOnly ? undefined : "Edit"}
              style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.dim, fontSize: 12, fontFamily: C.font, lineHeight: 1.4 }}>
              {/* the note on the picture on screen, or what was asked on the one before it */}
              {it.noteStale ? cap(it.verdict ? (staff ? "Asked on the last version" : "You asked, on the last version") : (staff ? "Asked. New version is up" : "You asked. Updated, good now?"), it.verdict ? C.faint : C.amber) : it.verdict === "change" ? cap("What to change", C.amber) : null}
              {quote(it.note)}
            </button>
          ) : null}
          {foot}
          {/* actions pinned to the card's foot: every card in a row lines up, whatever the name or note length */}
          <div style={{ marginTop: "auto", paddingTop: 10, ...(readOnly ? { pointerEvents: "none", opacity: 0.6 } : {}) }}>
            <VerdictRow value={it.verdict === "liked" ? null : it.verdict} pending={open?.mode === "change"} onPick={v => pick(it, v)}
              p={{ line: C.line, dim: C.dim, ink: C.bg, green: C.green, amber: C.amber, red: C.red, font: C.font }} />
            {it.verdictBy === "hpd" && it.verdict && it.verdict !== "liked" && <div style={{ marginTop: 6, fontSize: 9.5, color: C.faint, letterSpacing: "0.04em" }}>Marked by HPD</div>}
            {addToRelease && it.verdict === "asis" && (() => {
              const inRels = releases.filter(r => r.cardIds.includes(it.id));
              const can = releases.filter(r => addToRelease.addable.includes(r.id) && !r.cardIds.includes(it.id));
              const go = async (rid: string | null) => {
                setAdding(true);
                const ok = await queued(() => addToRelease.add(it, rid));
                setAdding(false);
                if (ok) setRelFor(null);
              };
              const row: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: C.font, fontSize: 11.5, fontWeight: 700, cursor: "pointer" };
              return (
                <div style={{ marginTop: 8 }}>
                  {inRels.length > 0 && <div style={{ fontSize: 10, color: C.dim, marginBottom: 4 }}>In {inRels.map(r => relLabel(r, releases)).join(", ")}</div>}
                  {relFor === it.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {can.map(r => <button key={r.id} disabled={adding} onClick={() => go(r.id)} style={row}>{relLabel(r, releases)}</button>)}
                      <button disabled={adding} onClick={() => go(null)} style={{ ...row, background: "transparent", color: C.dim }}>+ New release</button>
                      <button disabled={adding} onClick={() => setRelFor(null)} style={{ background: "none", border: "none", color: C.faint, fontSize: 11, fontFamily: C.font, cursor: "pointer", padding: "2px 0" }}>{adding ? "Adding…" : "Cancel"}</button>
                    </div>
                  ) : (
                    <button onClick={() => { touch(it); setRelFor(it.id); }}
                      style={{ background: "none", border: "none", borderBottom: `1px dotted ${C.dim}`, padding: 0, color: C.text, fontFamily: C.font, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Add to release</button>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
        )}
      </div>
    );
  };

  const groups = GROUPS.map(g => ({ ...g, list: byGroup[g.id], n: byGroup[g.id].length })).filter(g => g.n);
  // each release with something on it is a filter too
  const relChips = releases.map(r => ({ id: `rel:${r.id}`, name: relLabel(r, releases), r, list: items.filter(i => r.cardIds.includes(i.id)) })).filter(x => x.list.length);
  const active = filter && (groups.some(g => g.id === filter) || relChips.some(x => x.id === filter)) ? filter : null;
  const activeRel = relChips.find(x => x.id === active) || null;
  // Picking a group keeps the chip row in view instead of leaving the reader
  // staring at the bottom of a shorter page.
  function choose(id: string | null) {
    setFilter(id); setHold(null);
    const bar = document.querySelector(".lsx-filters") as HTMLElement | null;
    if (bar && bar.getBoundingClientRect().top <= parseFloat(getComputedStyle(bar).top || "0") + 1) {
      const y = (bar.parentElement?.querySelector(".lsx-anchor") as HTMLElement | null)?.getBoundingClientRect().top;
      if (y != null) window.scrollTo({ top: window.scrollY + y - parseFloat(getComputedStyle(bar).top || "0"), behavior: "smooth" });
    }
  }
  const grid: React.CSSProperties = tiles
    ? { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100px, calc((100% - 16px) / 3)), 1fr))", gap: 8, marginTop: 12 }
    : { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12, marginTop: 12 };
  // the layout switch: two small icons, the one on shows filled
  const layoutSwitch = staff ? null : (
    <span role="group" aria-label="Layout" style={{ flex: "none", marginLeft: "auto", display: "flex", gap: 2, alignSelf: "center" }}>
      {(["list", "grid"] as const).map(l => (
        <button key={l} onClick={() => pickLayout(l)} aria-pressed={layout === l} aria-label={l === "list" ? "Big cards" : "Grid"} title={l === "list" ? "Big cards" : "Grid"}
          style={{ background: layout === l ? C.surface : "none", border: `1px solid ${layout === l ? C.line : "transparent"}`, borderRadius: 7, padding: 6, cursor: "pointer", color: layout === l ? C.text : C.faint, display: "grid", placeItems: "center" }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            {l === "list" ? <><rect x="5" y="3" width="14" height="8" rx="1.5" /><rect x="5" y="13" width="14" height="8" rx="1.5" /></>
              : <>{[3, 10, 17].flatMap(y => [3, 10, 17].map(x => <rect key={`${x}${y}`} x={x} y={y} width="4.5" height="4.5" rx="1" />))}</>}
          </svg>
        </button>
      ))}
    </span>
  );

  return (
    <div style={{ fontFamily: C.font, color: C.text }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .lsx-filters{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:10px;margin:22px -18px 0;padding:0 18px;background:rgba(10,10,10,.94);backdrop-filter:blur(10px);border-bottom:1px solid ${C.line2}}
        .lsx-chips{flex:1;min-width:0;display:flex;gap:22px;overflow-x:auto;scrollbar-width:none}.lsx-chips::-webkit-scrollbar{display:none}
        @media(min-width:641px){.lsx-filters{top:${stickyTop}px}}
        .lsx-card .lsx-tool{opacity:0;transition:opacity .12s}.lsx-card:hover .lsx-tool,.lsx-card .lsx-tool:focus-visible{opacity:1}@media (hover:none){.lsx-card .lsx-tool{opacity:1}}
      ` }} />
      {head}
      {!staff && <div style={{ marginTop: 6, fontSize: 11.5, color: C.faint }}>Tap As is, Change or Pass on anything. Tap it again to undo. We see it instantly.</div>}
      {err && <div role="alert" onClick={() => setErr("")} style={{ position: "fixed", left: 16, right: 16, bottom: staff ? 190 : 84, zIndex: 260, maxWidth: 520, margin: "0 auto", background: C.surface, border: `1px solid ${C.red}`, borderRadius: 10, padding: "11px 14px", fontSize: 13, color: C.text }}>{err}</div>}
      <div className="lsx-anchor" />
      {(groups.length > 1 || relChips.length > 0) && (
        <nav className="lsx-filters" aria-label="Groups">
          <div className="lsx-chips">{[{ id: null as string | null, name: "All", n: items.length }, ...groups, ...relChips.map(x => ({ id: x.id, name: x.name, n: x.list.length }))].map(g => (
            <button key={g.id ?? "all"} onClick={() => choose(g.id)} aria-pressed={active === g.id}
              style={{ flex: "none", background: "none", border: "none", borderBottom: `2px solid ${active === g.id ? C.text : "transparent"}`, padding: "10px 0 8px", cursor: "pointer", fontFamily: C.font, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: active === g.id ? C.text : C.faint, whiteSpace: "nowrap" }}>
              {g.name}<span style={{ fontFamily: C.mono, fontWeight: 600, letterSpacing: 0, marginLeft: 5, color: C.faint }}>{g.n}</span>
            </button>
          ))}</div>
          {layoutSwitch}
        </nav>
      )}
      {!(groups.length > 1 || relChips.length > 0) && layoutSwitch && <div style={{ display: "flex", marginTop: 16 }}>{layoutSwitch}</div>}
      {activeRel && (
        <section style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", margin: 0, color: C.text }}>{activeRel.r.title}</h2>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>{[activeRel.r.target_live_date ? `live ${day(activeRel.r.target_live_date)}` : "", `${activeRel.list.length} from this board`].filter(Boolean).join(" · ")}</div>
          <div style={grid}>{activeRel.list.map(it => card(it))}</div>
        </section>
      )}
      {!activeRel && groups.filter(g => active === null || g.id === active).map(g => (
        <section key={g.id} style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", margin: 0, color: C.text }}>{g.name}</h2>
          {g.hint && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>{g.hint}</div>}
          {g.id === "concepts" && staff?.concepts
            ? <div style={grid}>{staff.concepts(g.list, card)}</div>
            : <div style={grid}>{g.list.map(it => card(it))}</div>}
        </section>
      ))}
      {zoom && (
        <ImageLightbox preview driveFileId={zoom.images[0].driveId} more={zoom.images.slice(1).map(m => m.driveId)}
          title={zoom.name || undefined} onClose={() => setZoom(null)} />
      )}
    </div>
  );
}
