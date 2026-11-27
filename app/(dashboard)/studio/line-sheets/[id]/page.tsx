"use client";
import { useEffect, useRef, useState } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { H, primaryBtn, ghostBtn, inp, lbl, tag, fmtStamp, fmtDue } from "@/lib/studio-theme";
import { T } from "@/lib/theme";   // T.accent = the confirm dialog's dark-text button
import { useConfirm } from "@/components/useConfirm";
// @ts-ignore — plain-JS lib, no declarations
import { uploadToDrive } from "@/lib/drive-upload-client";
import { layoutNumbering, noteIsStale, askedAgain, badgeFor } from "@/lib/line-sheets";
import { LineSheetView, LS, type ViewItem, type SaveBody, type ViewRelease } from "@/components/LineSheetView";
import { VerdictRow } from "@/components/LineSheetVerdicts";
import { StudioImportPicker } from "@/components/StudioImportPicker";

// THE LINE SHEET BUILDER (mig 190, selection-first rework Oct 1; one list of
// concepts + verdicts Nov 26 2026). Everything lands in Concepts; the
// client's verdicts (or HPD's) move a card up to Good to go / Changes asked
// or down to Passed. Cards only SHOW state (Jon: the per-card buttons were
// overwhelming); tap cards to select and the sticky action bar does the
// rest: As is / Change / Pass / ↩ Concepts, Pair (2 selected → one
// product), Group, Download, Remove. Uploads are bulletproof: 3-at-a-time,
// each file registers the moment it lands (a crash keeps everything landed),
// re-dropping the same folder skips what's already on the sheet, and a
// locked overlay owns the screen until the batch is in.
type QFile = { file: File; status: "pending" | "uploading" | "done" | "failed" | "skipped"; error?: string };

export default function LineSheetBuilder({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string[]>([]);   // ordered — first tap = front
  const [changeNote, setChangeNote] = useState<string | null>(null);   // the bar's "what should change?" box (null = closed)
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [queue, setQueue] = useState<QFile[]>([]);
  const [confirm, confirmEl] = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);   // ⋯ Archive / Delete
  const [fromStudio, setFromStudio] = useState(false);  // the one-time Studio → board picker
  const [dragging, setDragging] = useState(false);   // files over the page → drop overlay
  // DRAG TO REORDER (Nov 2026). Reorder ONLY: a card dropped on a card never
  // merges (that's what killed drag in the Oct 1 rework); pairing stays in the
  // selection bar. Drag starts after 8px of movement (mouse) or a 250ms hold
  // (touch), by the picture only, so clicks still select and the name box is
  // never a handle. Pointer-based, so it can't collide with file drops.
  const [dragId, setDragId] = useState<string | null>(null);
  const justDragged = useRef(false);                 // swallow the click a drop can fire
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );
  // Line sheet → order (api/.../order): the sheet's job, the Good to go items
  // not on it yet, and the ids that are.
  const [order, setOrder] = useState<{ job: { id: string; job_number: string } | null; pending: number; ordered: string[] } | null>(null);
  // The door to a release (mig 217): the client's open releases and which
  // board cards each already holds.
  const [rels, setRels] = useState<ViewRelease[]>([]);   // the client's open releases: chips, Add to release, Schedule
  const [relPick, setRelPick] = useState(false);          // the bar's "Add to release" list
  const [newRel, setNewRel] = useState("");
  const loadRels = () => fetch(`/api/studio/line-sheets/${params.id}/releases`).then(r => r.json()).then(j => { if (Array.isArray(j.releases)) setRels(j.releases); }).catch(() => {});
  useEffect(() => { loadRels(); /* eslint-disable-next-line */ }, [params.id]);
  useEffect(() => { setRelPick(false); setNewRel(""); }, [selected]);
  // The card menu opens where you clicked (Jon, Nov 27), and rides along with
  // that card as the page scrolls; phones keep it docked at the bottom.
  const barRef = useRef<HTMLDivElement | null>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const grip = useRef<{ id: string; dx: number; dy: number } | null>(null);   // where on the card the click landed
  const [barAt, setBarAt] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { lastPt.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);
  useEffect(() => {
    const last = selected[selected.length - 1];
    const cardEl = (id: string) => document.querySelector(`[data-card="${id}"]`) as HTMLElement | null;
    if (last && grip.current?.id !== last) {
      const r = cardEl(last)?.getBoundingClientRect(), pt = lastPt.current;
      grip.current = r ? { id: last, dx: pt ? pt.x - r.left : r.width / 2, dy: pt ? pt.y - r.top : r.height / 2 } : null;
    }
    if (!last) { grip.current = null; setBarAt(null); return; }
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const g = grip.current, el = g && cardEl(g.id), vw = window.innerWidth, vh = window.innerHeight;
        if (!g || !el || vw < 760) { setBarAt(null); return; }
        const r = el.getBoundingClientRect(), w = Math.min(460, vw - 32), h = barRef.current?.offsetHeight || 170;
        const x = r.left + g.dx, y = r.top + g.dy;
        const left = Math.min(Math.max(x - w / 2, 16), vw - w - 16);
        // just below the click; above it when there's no room; always on screen
        let top = y + 18;
        if (top + h > vh - 16) top = y - h - 18;
        top = Math.min(Math.max(top, 16), vh - h - 16);
        setBarAt({ left, top });
      });
    };
    place();
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [selected, data, relPick, changeNote]);
  const loadOrder = () => fetch(`/api/studio/line-sheets/${params.id}/order`).then(r => r.json()).then(j => { if (!j.error) setOrder(j); }).catch(() => {});
  useEffect(() => { loadOrder(); /* eslint-disable-next-line */ }, [params.id, data?.items]);
  const fileIn = useRef<HTMLInputElement | null>(null);
  // Replace (Nov 25): swap one mockup on an item in place
  const replaceIn = useRef<HTMLInputElement | null>(null);
  const replaceTarget = useRef<{ id: string; at: number } | null>(null);
  const [replacing, setReplacing] = useState<string[]>([]);         // item ids mid-upload
  const [pickSide, setPickSide] = useState<string | null>(null);     // multi-image item asking which one
  useEffect(() => {
    // any click outside the "Replace which?" picker closes it (clicks inside stop at React's root)
    if (!pickSide) return;
    const close = () => setPickSide(null);
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", close); };
  }, [pickSide]);
  // the bar's Change box belongs to the selection it was opened on
  useEffect(() => { setChangeNote(null); }, [selected]);
  const dataRef = useRef<any>(null);
  const queueRef = useRef<QFile[]>([]);
  const pumping = useRef(false);

  const load = async () => { const j = await fetch(`/api/studio/line-sheets/${params.id}`).then(r => r.json()).catch(() => null); if (j && !j.error) { setData(j); dataRef.current = j; } };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params.id]);
  useEffect(() => { dataRef.current = data; }, [data]);

  // ── THE UPLOADER ──────────────────────────────────────────────────────────
  const uploadsActive = queue.some(q => q.status === "pending" || q.status === "uploading");
  const setQ = (next: QFile[]) => { queueRef.current = next; setQueue([...next]); };
  function enqueue(files: FileList | File[]) {
    const sheet = dataRef.current?.sheet; if (!sheet) return;
    // Skip a re-drop of the SAME file: name AND size match. A revision saved
    // over the same name has a different size and uploads (Jon deletes the
    // desktop copy after, so a silent skip would lose it). Images stored
    // before sizes were recorded never match: a duplicate beats a lost file.
    const existing = new Set<string>();
    for (const it of dataRef.current?.items || []) for (const im of it.images || []) if (im.name && im.size) existing.add(`${im.name}|${im.size}`);
    const incoming = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!incoming.length) return;
    const fresh: QFile[] = incoming.map(f => ({ file: f, status: existing.has(`${f.name}|${f.size}`) ? "skipped" as const : "pending" as const }));
    setQ([...queueRef.current.filter(q => q.status !== "done" && q.status !== "skipped"), ...fresh]);
    pump();
  }
  async function uploadOne(q: QFile) {
    const sheet = dataRef.current?.sheet;
    // one retry inside before marking failed
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const up = await uploadToDrive({ blob: q.file, fileName: q.file.name, mimeType: q.file.type || "image/png", itemId: null, clientName: sheet?.clients?.name || "Studio", projectTitle: "Line Sheets", itemName: sheet?.title || "Line Sheet", onProgress: undefined });
        // register IMMEDIATELY — a crash after this point loses nothing
        const r = await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: [{ driveId: up.fileId, name: q.file.name, size: q.file.size }] }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "register failed");
        q.status = "done"; setQ(queueRef.current);
        return;
      } catch (e: any) { q.error = e?.message || "upload failed"; if (attempt === 1) { q.status = "failed"; setQ(queueRef.current); } else await new Promise(res => setTimeout(res, 1500)); }
    }
  }
  async function pump() {
    if (pumping.current) return; pumping.current = true;
    try {
      for (;;) {
        const pend = queueRef.current.filter(q => q.status === "pending");
        if (!pend.length) break;
        const batch = pend.slice(0, 3);
        batch.forEach(q => { q.status = "uploading"; });
        setQ(queueRef.current);
        await Promise.all(batch.map(uploadOne));
        await load();   // Concepts fills as the batch lands
      }
    } finally { pumping.current = false; await load(); }
  }
  function retryFailed() { queueRef.current.forEach(q => { if (q.status === "failed") q.status = "pending"; }); setQ(queueRef.current); pump(); }
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (queueRef.current.some(q => q.status === "pending" || q.status === "uploading")) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useEffect(() => {
    // The whole page is the drop zone (Jon, Nov 2026); the overlay says so.
    // Heartbeat: dragover fires every ~50ms while files are over the page, so
    // the overlay stays up while those keep coming and clears 500ms after
    // they stop (left the window, Esc, drop). enter/leave counting drifts,
    // and Safari sends every dragleave with no relatedTarget.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const off = () => { if (timer) clearTimeout(timer); timer = null; setDragging(false); };
    const over = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragging(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(off, 500);   // spec allows ~550ms gaps when the pointer is still
    };
    const drop = (e: DragEvent) => { off(); if (e.dataTransfer?.files?.length) { e.preventDefault(); enqueue(e.dataTransfer.files); } };
    window.addEventListener("dragover", over); window.addEventListener("drop", drop); window.addEventListener("dragend", off);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); window.removeEventListener("dragend", off);
    };
    // eslint-disable-next-line
  }, []);

  if (!data) return <div style={{ padding: 40, color: "rgba(255,255,255,.4)", background: H.ink, minHeight: "100vh", fontFamily: H.font }}>Opening the sheet…</div>;
  const { sheet, versions } = data;
  const items: any[] = data.items.filter((i: any) => !i.dropped).sort((a: any, b: any) => ((a.sort || 0) - (b.sort || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));   // id tie-break = lib/line-sheets sortItems
  const dropped: any[] = data.items.filter((i: any) => i.dropped);
  // The verdicts get their own groups, here AND in the hub (mig 215). An
  // item keeps its place in the one list, so ↩ puts it straight back in
  // Concepts where it was. Only Concepts is a drag list.
  const goodToGo = items.filter(i => i.client_verdict === "asis");
  const changes = items.filter(i => i.client_verdict === "change");
  const liked = items.filter(i => i.client_verdict === "liked");
  const passed = items.filter(i => i.client_verdict === "pass");
  const concepts = items.filter(i => !i.client_verdict);
  const goN = goodToGo.length;
  const goLiveN = goodToGo.filter(i => i.added_in != null).length;   // what the ZIP holds: published art only
  const ordered = new Set(order?.ordered || []);
  // Organizing is live in their hub; only never-published uploads wait (Oct 1 2026).
  const unpublished = items.filter(i => !i.dropped && i.added_in == null).length;
  // live pieces whose art was replaced: the client sees the old picture until a publish
  const replacedN = items.filter(i => i.added_in != null && (i.images || []).some((im: any) => im.replaces)).length;
  const waiting = unpublished + replacedN;
  // Never published → numbers follow the list (lib/line-sheets layoutNumbering);
  // once published, the stamped item_no is permanent.
  const draftNo = sheet.current_version ? null : layoutNumbering(data.items);
  const noOf = (it: any) => { const n = draftNo ? draftNo[it.id] : it.item_no; return n ? String(n).padStart(2, "0") : null; };

  async function patchSheet(body: any) { setBusy(true); try { const r = await fetch(`/api/studio/line-sheets/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json()); if (r.error) setErr(r.error); await load(); return r; } finally { setBusy(false); } }
  // Archive (mig 211): off the Studio list and out of the client's hub, data
  // kept. Delete: gone, with its versions and the client's thumbs.
  async function toggleArchive() {
    setMenuOpen(false);
    const sh = dataRef.current?.sheet;
    if (!sh) return;
    if (!sh.archived_at && !await confirm({ title: `Archive ${sh.clients?.name ? `${sh.clients.name}\u2019s` : "this"} planner?`, message: "It leaves your Planners list and the client's hub. Items, versions and their verdicts are kept; Unarchive brings it all back.", confirmLabel: "Archive", confirmColor: T.accent })) return;
    const r = await patchSheet(sh.archived_at ? { unarchive: true } : { archive: true });
    if (r?.ok && !sh.archived_at) window.location.href = "/studio/line-sheets";
  }
  async function deleteSheet() {
    setMenuOpen(false);
    const sh = dataRef.current?.sheet;
    if (!sh) return;
    const n = (dataRef.current?.items || []).length;
    if (!await confirm({ title: `Delete ${sh.clients?.name ? `${sh.clients.name}\u2019s` : "this"} planner for good?`, message: `This removes ${n} item${n === 1 ? "" : "s"}, every version, and the client's verdicts, and takes it out of their hub. The mockup files stay in Drive, but OpsHub loses track of them: download what you need first (⋯ → Download all). It can't be undone. To just put it away, use Archive.`, confirmLabel: "Delete", confirmColor: H.red })) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/studio/line-sheets/${params.id}`, { method: "DELETE" }).then(x => x.json()).catch(() => ({ error: "Delete failed" }));
      if (r.error) { setErr(r.error); return; }
      window.location.href = "/studio/line-sheets";
    } finally { setBusy(false); }
  }
  async function makeOrder() {
    if (!order) return;
    const job = order.job;
    const ok = await confirm(job
      ? { title: `Add ${order.pending} to ${job.job_number}?`, message: `The ${order.pending} new Good to go item${order.pending === 1 ? "" : "s"} go onto ${job.job_number} with their mockups.`, confirmLabel: "Add to order", confirmColor: T.accent }
      : { title: `Create an order from ${order.pending} Good to go item${order.pending === 1 ? "" : "s"}?`, message: "One intake order for this client, an item per As is with its mockup. Changes asked wait until they're As is. Quantities, blanks, pricing and proofs come next, on the order.", confirmLabel: "Create order", confirmColor: T.accent });
    if (!ok) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/studio/line-sheets/${params.id}/order`, { method: "POST" }).then(x => x.json()).catch(() => ({ error: "Couldn't create the order" }));
      if (r.error) { setErr(r.error); await loadOrder(); return; }
      window.location.href = `/jobs/${r.jobId}`;
    } finally { setBusy(false); }
  }
  function startReplace(it: any, at: number) {
    setPickSide(null);
    replaceTarget.current = { id: it.id, at };
    replaceIn.current?.click();
  }
  async function doReplace(file: File) {
    const t = replaceTarget.current; replaceTarget.current = null;
    const sheet = dataRef.current?.sheet;
    if (!t || !sheet) return;
    if (file.type && !file.type.startsWith("image/")) { setErr("Replace takes an image file"); return; }
    setReplacing(r => [...r, t.id]); setErr("");
    try {
      const up = await uploadToDrive({ blob: file, fileName: file.name, mimeType: file.type || "image/png", itemId: null, clientName: sheet?.clients?.name || "Studio", projectTitle: "Line Sheets", itemName: sheet?.title || "Line Sheet", onProgress: undefined });
      await patchItem({ id: t.id, replaceImage: { at: t.at, driveId: up.fileId, name: file.name, size: file.size } });
    } catch (e: any) { setErr(`Replace failed: ${e?.message || "upload failed"}`); }
    finally { setReplacing(r => r.filter(x => x !== t.id)); await load(); }
  }
  async function patchItem(body: any) { const r = await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json()); if (r.error) setErr(r.error); return r; }
  // HPD sets the verdict on the selected cards (Jon, Nov 26: both sides move
  // things between As is, Change and Pass). null = back to Concepts. Change
  // carries one note, what should change, onto each.
  async function setVerdicts(v: "asis" | "change" | "pass" | null, note?: string) {
    const ids = [...selected];
    setChangeNote(null); setBusy(true); setErr("");
    try {
      // a failure stops here and keeps the selection, so it's clear what's left
      let ok = true;
      for (const id of ids) { const r = await patchItem({ id, verdict: v, ...(note ? { note } : {}) }); if (r?.error) { ok = false; break; } }
      if (ok) setSelected([]);
      await load();
    } finally { setBusy(false); }
  }

  // the view's order (components/LineSheetView GROUPS), for shift-select runs
  const fresh = (it: any) => !it.client_verdict && it.added_in != null && (askedAgain(it) || (!(it.images || []).some((im: any) => im.replaces) && !!badgeFor(it)));
  const visualOrder = [...concepts.filter(fresh), ...goodToGo, ...changes, ...liked, ...concepts.filter(i => !fresh(i)), ...passed].map(i => i.id);
  const toggleSel = (id: string, shift = false) => setSelected(prev => {
    if (shift && prev.length) {
      // shift-click = select the whole run between the last tap and this one
      const a = visualOrder.indexOf(prev[prev.length - 1]), b = visualOrder.indexOf(id);
      if (a >= 0 && b >= 0) { const range = visualOrder.slice(Math.min(a, b), Math.max(a, b) + 1); return [...prev, ...range.filter(x => !prev.includes(x))]; }
    }
    return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
  });
  async function addToRelease(target: { releaseId?: string; newTitle?: string }) {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/studio/line-sheets/${params.id}/releases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardIds: selected, ...target }) }).then(x => x.json()).catch(() => ({ error: "Couldn't add to the release" }));
      if (r.error) { setErr(r.error); return; }
      const why = Array.from(new Set((r.skipped || []).map((x: any) => x.error)));
      if (r.skipped?.length) setErr(`${r.added} added; ${r.skipped.length} skipped: ${why.join("; ")}`);
      else setSelected([]);
      setRelPick(false); setNewRel("");
      await loadRels();
    } finally { setBusy(false); }
  }
  async function pairSelected() {
    if (selected.length !== 2) return;
    const [front, back] = selected;
    setBusy(true); try { await patchItem({ id: front, mergeFrom: back }); setSelected([]); await load(); } finally { setBusy(false); }
  }
  async function groupSelected() {
    if (selected.length < 2) return;
    const [first, ...rest] = selected;
    setBusy(true); try { for (const id of rest) await patchItem({ id: first, mergeFrom: id }); setSelected([]); await load(); } finally { setBusy(false); }
  }
  async function dropSelected() {
    if (!await confirm({ title: `Remove ${selected.length} item${selected.length === 1 ? "" : "s"}?`, message: "Never-published items delete outright; published ones drop (kept in history).", confirmLabel: "Remove" })) return;
    setBusy(true);
    try {
      for (const id of selected) {
        const it = items.find(x => x.id === id); if (!it) continue;
        if (it.added_in == null) await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        else await patchItem({ id, drop: true });
      }
      setSelected([]); await load();
    } finally { setBusy(false); }
  }
  async function unpairItem(it: any) {
    // split a grouped item back into singles: keep first image, re-register the rest
    const [first, ...rest] = it.images || [];
    if (!rest.length) return;
    await patchItem({ id: it.id, images: [first] });
    await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ splitFrom: it.id, images: rest.map((r: any) => ({ driveId: r.driveId, name: r.name, size: r.size, replaces: r.replaces })) }) });
    await load();
  }

  // Drag reorders Concepts. The WHOLE list is renumbered, cards in the other
  // groups included in their slots, so a card sent back to Concepts returns
  // where it was, not to the front.
  function onDragStart(e: DragStartEvent) {
    if (busy) return;
    setDragId(String(e.active.id));
  }
  // the cards a drag of `id` moves: the selection (in list order) when the
  // card is part of it, else just the card
  const movingWith = (id: string, ids: string[]) => selected.includes(id) ? ids.filter(x => selected.includes(x)) : [id];
  async function onDragEnd(e: DragEndEvent, ids: string[]) {
    const { active, over } = e;
    setDragId(null);
    justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 0);
    if (!over) return;
    const oldIdx = ids.indexOf(String(active.id)), newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
    // Dragging a selected card carries the whole selection (Jon, Nov 27):
    // the picked cards land together, in list order, where it was dropped.
    const group = movingWith(String(active.id), ids);
    let next: string[];
    if (group.length > 1) {
      if (group.includes(String(over.id))) return;
      const rest = ids.filter(id => !group.includes(id));
      const at = rest.indexOf(String(over.id)) + (oldIdx < newIdx ? 1 : 0);   // dragged down → after the target
      next = [...rest.slice(0, at), ...group, ...rest.slice(at)];
      setSelected([]);
    } else next = arrayMove(ids, oldIdx, newIdx);
    const vis = new Set(next);
    let v = 0;
    const merged = items.map(i => i.id).map(id => vis.has(id) ? next[v++] : id);
    const sortOf: Record<string, number> = {};
    merged.forEach((id, k) => { sortOf[id] = (k + 1) * 10; });
    setData((d: any) => ({ ...d, items: d.items.map((x: any) => sortOf[x.id] != null ? { ...x, sort: sortOf[x.id] } : x) }));
    setBusy(true);
    try {
      const r = await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reorder: merged.map(id => ({ id, sort: sortOf[id] })) }) }).then(x => x.json()).catch(() => ({ error: "Couldn't save the new order" }));
      if (r.error) setErr(r.error);
    } finally { setBusy(false); await load(); }
  }

  // THE CLIENT'S VIEW, HPD's seat (components/LineSheetView; Jon, Nov 26:
  // "we see it internally how he sees it"). Same cards and groups; HPD sees
  // drafts too, dimmed and badged DRAFT: never published, or new art
  // waiting on a publish (the client still sees the old picture).
  const raw = new Map(items.map(i => [i.id, i]));
  const view: ViewItem[] = items.map(it => ({
    id: it.id, name: it.name, item_no: it.item_no, images: it.images || [],
    badge: it.added_in == null || (it.images || []).some((im: any) => im.replaces) ? "draft" : badgeFor(it),
    verdict: it.client_verdict ?? null, verdictBy: it.client_verdict_by ?? null,
    note: it.client_note ?? null, noteStale: noteIsStale(it), reworked: askedAgain(it),
  }));
  // One card write from the view. No reload here: the view queues writes and
  // calls onSettled (load) once they're all done, so a reload never wipes an
  // edit still waiting its turn. A failure comes back as the message.
  async function saveFromView(b: SaveBody): Promise<true | string> {
    if (b.seen) return true;   // HPD looking never counts as the client looking
    const r = await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.itemId, ...(b.verdict !== undefined ? { verdict: b.verdict } : {}), ...(b.note !== undefined ? { note: b.note } : {}) }) })
      .then(x => x.json()).catch(() => ({ error: "That didn't save. Check your connection and try again." }));
    return r?.error || true;
  }
  const tool: React.CSSProperties = { position: "absolute", top: 8, zIndex: 3, color: "#555", background: "rgba(255,255,255,.92)", border: "none", borderRadius: 6, minWidth: 28, height: 28, display: "grid", placeItems: "center", fontSize: 14, fontWeight: 800, cursor: "pointer", padding: 0, textDecoration: "none" };
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation(), onTouchStart: (e: React.TouchEvent) => e.stopPropagation(), onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };
  const tools = (v: ViewItem) => {
    const it = raw.get(v.id); const imgs = it?.images || [];
    if (!it || !imgs.length) return null;
    return (<>
      {/* ↻ Replace: swap the mockup in place (a front/back pair asks which) */}
      {!sheet.archived_at && <button {...stop} onClick={e => { e.stopPropagation(); if (imgs.length === 1) startReplace(it, 0); else setPickSide(pickSide === it.id ? null : it.id); }}
        disabled={replacing.includes(it.id)} title={imgs.length === 1 ? "Replace this mockup" : "Replace one of these mockups"} aria-label="Replace mockup"
        className={replacing.includes(it.id) ? undefined : "lsx-tool"} style={{ ...tool, right: 40 }}>{replacing.includes(it.id) ? "…" : "↻"}</button>}
      {/* this item's file(s), named by the item (one = the file, more = a ZIP) */}
      <a {...stop} className="lsx-tool" href={`/api/studio/line-sheets/${params.id}/download?pick=${it.id}`} download title={imgs.length > 1 ? `Download ${imgs.length} files` : "Download file"} style={{ ...tool, right: 8, fontSize: 13 }}>↓</a>
      {pickSide === it.id && (
        <div {...stop} style={{ position: "absolute", left: 6, right: 6, top: 6, maxHeight: "80%", overflowY: "auto", zIndex: 4, background: "#161616", border: `1px solid ${H.line}`, borderRadius: 8, padding: 4, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, padding: "4px 7px" }}>Replace which?</span>
          {imgs.map((im: any, k: number) => (
            <button key={im.id || k} onClick={() => startReplace(it, k)} title={im.name || undefined}
              style={{ background: "none", border: "none", color: H.text, fontSize: 12, fontFamily: H.font, textAlign: "left", padding: "6px 7px", cursor: "pointer", borderRadius: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {imgs.length === 2 ? (k === 0 ? "Front" : "Back") : `Picture ${k + 1}`}
            </button>
          ))}
        </div>
      )}
    </>);
  };

  const doneN = queue.filter(q => q.status === "done").length;
  const skippedN = queue.filter(q => q.status === "skipped").length;
  const failedN = queue.filter(q => q.status === "failed").length;
  const totalN = queue.filter(q => q.status !== "skipped").length;
  const uploadingNames = queue.filter(q => q.status === "uploading").map(q => q.file.name);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "26px 18px 220px", background: H.ink, minHeight: "100vh", color: H.text, fontFamily: H.font }}>
      {confirmEl}
      {dragging && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, pointerEvents: "none", background: "rgba(10,10,10,.72)", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ border: `2px dashed ${H.blue}`, borderRadius: 18, padding: "46px 60px", textAlign: "center", background: "rgba(22,22,22,.9)" }}>
            <div style={{ fontSize: 26, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: H.text }}>Drop to add mockups</div>
            <div style={{ fontSize: 12, color: H.dim, marginTop: 8 }}>They land in Concepts{sheet.current_version ? ", at the top" : ""}, named by file. The exact same file is skipped; a re-saved revision lands as a new card.</div>
          </div>
        </div>
      )}

      {fromStudio && <StudioImportPicker sheetId={params.id} onClose={() => { setFromStudio(false); load(); }} onDone={() => { setFromStudio(false); load(); }} />}

      {/* ── LOCKED UPLOAD OVERLAY — owns the screen until the batch is in ── */}
      {(uploadsActive || failedN > 0) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,10,10,.96)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 20 }}>
          <div style={{ fontSize: "clamp(30px,5vw,52px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", textAlign: "center" }}>
            {uploadsActive ? <>Uploading <span style={{ color: H.blue }}>{doneN}</span> / {totalN}</> : failedN > 0 ? <span style={{ color: H.red }}>{failedN} didn&rsquo;t make it</span> : "Done"}
          </div>
          <div style={{ width: "min(520px, 86vw)", height: 8, background: H.surface, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${totalN ? Math.round((doneN / totalN) * 100) : 0}%`, height: "100%", background: failedN ? H.amber : H.blue, transition: "width .3s" }} />
          </div>
          {uploadingNames.length > 0 && <div style={{ fontFamily: H.mono, fontSize: 11, color: H.faint, textAlign: "center", maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "86vw" }}>{uploadingNames.join(" · ")}</div>}
          {skippedN > 0 && <div style={{ fontSize: 11.5, color: H.dim }}>{skippedN} already on the sheet — skipped</div>}
          {uploadsActive && <div style={{ ...tag(H.amber, 10) }}>Keep this tab open — each file saves the moment it lands</div>}
          {!uploadsActive && failedN > 0 && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexDirection: "column" }}>
              <div style={{ fontFamily: H.mono, fontSize: 11, color: H.faint, maxWidth: 520, textAlign: "center" }}>{queue.filter(q => q.status === "failed").map(q => q.file.name).join(" · ")}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={retryFailed} style={{ ...primaryBtn, padding: "12px 22px" }}>Retry failed ({failedN})</button>
                <button onClick={() => setQ([])} style={{ ...ghostBtn }}>Dismiss</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Not-published alert (Jon, Oct 1): organizing is live in their hub,
          but new uploads aren't — say so up top until they're published.
          DESIGN.md: 3px accent rail, no color wash. */}
      {waiting > 0 && !sheet.archived_at && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderLeft: `3px solid ${H.amber}`, background: H.panel, borderRadius: "0 10px 10px 0", padding: "11px 14px", marginBottom: 16 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.amber }}>Not published</span>
          <span style={{ fontSize: 12.5, color: H.text }}>
            {sheet.current_version
              ? [unpublished ? `${unpublished} new upload${unpublished === 1 ? " isn't" : "s aren't"} in their hub yet.` : "", replacedN ? `${replacedN} replaced mockup${replacedN === 1 ? " is" : "s are"} waiting: they still see the old one.` : "", "Organizing is already live."].filter(Boolean).join(" ")
              : `The client can't see this sheet yet: ${unpublished} item${unpublished === 1 ? "" : "s"} waiting for the first publish.`}
          </span>
          <button disabled={busy} onClick={() => setPublishOpen(true)} style={{ ...primaryBtn, padding: "8px 16px", marginLeft: "auto" }}>Publish {sheet.current_version ? `v${sheet.current_version + 1}` : "v1"} →</button>
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}><a href="/studio/line-sheets" style={{ color: H.faint, textDecoration: "none" }}>‹ Planners</a></div>
      {/* Header (Jon, Nov 25; Nov 27): title + who/where on the left; on the
          right the status, the ⋯ menu, and the two stamps (last publish,
          client updated). Publish lives in the Not published banner, the
          only time there's anything to publish. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap", margin: "6px 0 24px" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          {/* no name of its own (Jon, Nov 27): it's the client's planner */}
          <h1 style={{ fontSize: "clamp(26px,4vw,44px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", margin: 0, lineHeight: 1.05 }}>{sheet.clients?.name || "Planner"}</h1>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <span style={tag(H.faint, 10)}>Planner</span>
            {!sheet.archived_at && sheet.current_version > 0 && sheet.clients?.portal_token && <CopyLink url={`${window.location.origin}/portal/client/${sheet.clients.portal_token}/line-sheet`} />}
            {order?.job && <a href={`/jobs/${order.job.id}`} style={{ fontSize: 10.5, fontFamily: H.mono, color: H.dim, textDecoration: "none", borderBottom: "1px dotted rgba(255,255,255,.3)" }}>Order {order.job.job_number} →</a>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, marginLeft: "auto" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={tag(sheet.archived_at ? H.faint : sheet.current_version ? H.blue : H.amber, 9.5)}>
              {sheet.archived_at ? "Archived · hidden from their hub" : sheet.current_version ? `v${sheet.current_version} live in their hub` : "Draft · never published"}
            </span>
            <input ref={replaceIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (replaceIn.current) replaceIn.current.value = ""; if (f) doReplace(f); else replaceTarget.current = null; }} />
            <input ref={fileIn} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { if (e.target.files?.length) enqueue(e.target.files); if (fileIn.current) fileIn.current.value = ""; }} />
            <span style={{ position: "relative" }}>
              <button disabled={busy} onClick={() => setMenuOpen(o => !o)} title="More" aria-haspopup="menu" aria-expanded={menuOpen} style={{ ...ghostBtn, padding: "6px 14px", fontSize: 17, lineHeight: 1, border: `1.5px solid ${H.blue}`, color: menuOpen ? H.ink : H.blue, background: menuOpen ? H.blue : "rgba(143,199,216,.12)" }}>⋯</button>
              {menuOpen && (<>
                <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div role="menu" onClick={() => setMenuOpen(false)} style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41, background: "#161616", border: `1px solid ${H.line}`, borderRadius: 10, padding: 5, minWidth: 220 }}>
                  {!sheet.archived_at && <button role="menuitem" onClick={() => fileIn.current?.click()} style={menuItem}>+ Add mockups</button>}
                  {!sheet.archived_at && <button role="menuitem" onClick={() => setFromStudio(true)} title="Every file in this client's Studio: keep it, put it on the board, or trash it" style={menuItem}>Studio clean-up</button>}
                  {goN > 0 && <button role="menuitem" onClick={() => setSelected(goodToGo.map(i => i.id))} title="Select every Good to go item (then download, pair…)" style={menuItem}>Select Good to go ({goN})</button>}
                  {!sheet.archived_at && order && order.pending > 0 && <button role="menuitem" disabled={busy} onClick={makeOrder} title="Turn the Good to go items into an order" style={menuItem}>{order.job ? `Add ${order.pending} Good to go to ${order.job.job_number}` : `Create order (${order.pending} Good to go)`}</button>}
                  {goLiveN > 0 && <a role="menuitem" href={`/api/studio/line-sheets/${params.id}/download?pick=approved`} download title="Every Good to go mockup the client has seen, full res, in one ZIP" style={menuItem}>↓ Download Good to go ({goLiveN})</a>}
                  {items.length > 0 && <a role="menuitem" href={`/api/studio/line-sheets/${params.id}/download?pick=all`} download title="Every mockup on the sheet, full res, in one ZIP" style={menuItem}>↓ Download all</a>}
                  <div style={{ height: 1, background: H.line2, margin: "5px 6px" }} />
                  <button role="menuitem" onClick={toggleArchive} style={menuItem}>{sheet.archived_at ? "Unarchive" : "Archive"}</button>
                  <button role="menuitem" onClick={deleteSheet} style={{ ...menuItem, color: H.red }}>Delete…</button>
                </div>
              </>)}
            </span>
          </div>
          {versions.length > 0 && <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint }}>last publish {fmtStamp(versions[versions.length - 1].published_at)}</span>}
          {sheet.current_version > 0 && <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint }}>client updated {sheet.client_updated_at ? fmtStamp(sheet.client_updated_at) : "not yet"}</span>}
        </div>
      </div>
      {err && <div style={{ color: H.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}

      {/* the client's view, with HPD's tools on top */}
      {items.length === 0 && !sheet.archived_at && (
        <div style={{ border: `2px dashed ${H.line}`, borderRadius: 14, padding: "40px 20px", textAlign: "center", color: H.dim, fontSize: 13, marginTop: 10 }}>
          Drop mockups anywhere on this page, or <button onClick={() => fileIn.current?.click()} style={{ background: "none", border: "none", padding: 0, color: H.blue, cursor: "pointer", fontSize: 13, fontFamily: H.font, textDecoration: "underline" }}>pick files</button>. They land in Concepts, named by file.
        </div>
      )}
      <LineSheetView items={view} stamp={data} save={saveFromView} onSettled={() => { load(); }} readOnly={!!sheet.archived_at} head={null} releases={rels} staff={{
        selected,
        onSelect: (id, shift) => { if (!justDragged.current) toggleSel(id, shift); },
        numberOf: v => { const it = raw.get(v.id); return it ? noOf(it) : null; },
        tools,
        onRename: (v, name) => { const it = raw.get(v.id); if (it && name !== (it.name || "")) patchItem({ id: v.id, name }).then(load); },
        footnote: v => {
          const inRels = rels.filter(r => r.cardIds.includes(v.id)).map(r => r.title);
          const onOrder = ordered.has(v.id) && order?.job ? order.job.job_number : null;
          return inRels.length || onOrder ? <div style={{ marginTop: 6, fontSize: 9.5, fontFamily: LS.mono, color: LS.faint, lineHeight: 1.4 }}>{[inRels.length ? `in ${inRels.join(", ")}` : "", onOrder ? `on ${onOrder}` : ""].filter(Boolean).join(" · ")}</div> : null;
        },
        concepts: (list, card) => (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={e => onDragEnd(e, list.map(i => i.id))} onDragCancel={() => { setDragId(null); load(); }}>
            <SortableContext items={list.map(i => i.id)} strategy={rectSortingStrategy}>
              {list.map(it => <SortableCard key={it.id} id={it.id} disabled={busy || !!sheet.archived_at} riding={!!dragId && dragId !== it.id && movingWith(dragId, list.map(i => i.id)).includes(it.id)}>{h => card(it, h)}</SortableCard>)}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {dragId ? (() => {
                const it = list.find(i => i.id === dragId); if (!it) return null;
                const n = movingWith(dragId, list.map(i => i.id)).length;
                // a stack: the grabbed card on top, a count when it carries others
                return (
                  <div style={{ position: "relative", cursor: "grabbing" }}>
                    {n > 1 && <div style={{ position: "absolute", inset: 0, transform: "translate(8px, 8px)", borderRadius: 14, background: LS.panel, border: `1px solid ${LS.line}` }} />}
                    <div style={{ position: "relative", boxShadow: "0 12px 30px rgba(0,0,0,.55)", borderRadius: 14 }}>{card(it)}</div>
                    {n > 1 && <span style={{ position: "absolute", top: -10, right: -10, zIndex: 5, background: LS.blue, color: LS.bg, borderRadius: 999, minWidth: 30, height: 30, padding: "0 8px", boxSizing: "border-box", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 900 }}>{n}</span>}
                  </div>
                );
              })() : null}
            </DragOverlay>
          </DndContext>
        ),
      }} />

      {/* THE SCHEDULE (Jon, Nov 27): the client's releases under the board,
          the same order his Planner tab shows them. Dates, buys and the cut
          live in /drops. */}
      <section style={{ borderTop: `1px solid ${H.line}`, marginTop: 48, paddingTop: 30 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: "clamp(20px,3vw,28px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", margin: 0 }}>Schedule</h2>
          <a href="/drops" style={{ fontSize: 11, color: H.dim, textDecoration: "none", borderBottom: "1px dotted rgba(255,255,255,.3)" }}>Open in Drops →</a>
        </div>
        {rels.length === 0
          ? <div style={{ fontSize: 12.5, color: H.faint, marginTop: 10 }}>No open releases. Select As is cards and use Add to release to start one.</div>
          : <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14, maxWidth: 760 }}>
              {rels.map(r => (
                <a key={r.id} href="/drops" style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", background: H.panel, border: `1px solid ${H.line}`, borderRadius: 14, padding: "14px 16px", color: H.text, textDecoration: "none" }}>
                  <span style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase" }}>{r.title}</span>
                  {r.target_live_date && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>live {fmtDue(r.target_live_date)}</span>}
                  <span style={tag(r.status === "building" ? H.amber : r.status === "live" ? H.green : H.blue, 9.5)}>{r.status === "building" ? "Client building" : r.status === "ready" ? "With us" : r.status === "live" ? "Selling" : "Closed"}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10.5, fontFamily: H.mono, color: H.dim }}>{r.cardIds.length} from the board</span>
                </a>
              ))}
            </div>}
      </section>

      {dropped.length > 0 && (
        <div style={{ borderTop: `1px solid ${H.line2}`, paddingTop: 12 }}>
          <span style={tag(H.faint, 9)}>✕ {dropped.length} dropped · </span>
          {dropped.map((it: any) => <button key={it.id} onClick={() => patchItem({ id: it.id, restore: true }).then(load)} style={{ background: "none", border: "none", color: H.faint, fontSize: 11, cursor: "pointer", fontFamily: H.font, textDecoration: "underline", padding: "0 6px" }}>{it.name || "untitled"} ↩</button>)}
        </div>
      )}

      {/* ── THE SELECTION BAR (Jon, Nov 26: one clean card) ──
          header: how many + close · their answer, the same As is / Change /
          Pass row the client sees (tap the lit one again = back to Concepts)
          · quiet links for the rest. */}
      {selected.length > 0 && (() => {
        const sel = selected.map(id => items.find(i => i.id === id)).filter(Boolean) as any[];
        // the lit answer: the one every selected card shares (an old Liked reads as none)
        const shared = sel.length && sel.every(i => i.client_verdict === sel[0].client_verdict) && sel[0].client_verdict !== "liked" ? sel[0].client_verdict : null;
        const one = sel.length === 1 ? sel[0] : null;
        const link: React.CSSProperties = { background: "none", border: "none", padding: "4px 2px", cursor: "pointer", fontFamily: H.font, fontSize: 12.5, fontWeight: 700, color: H.dim, textDecoration: "none" };
        const close = () => { setSelected([]); setChangeNote(null); };
        return (
          <div ref={barRef} role="dialog" aria-label={`${selected.length} selected`} style={{ position: "fixed", ...(barAt ? { left: barAt.left, top: barAt.top } : { left: "50%", transform: "translateX(-50%)", bottom: 16 }), zIndex: 250, width: "min(460px, calc(100vw - 32px))", boxSizing: "border-box", background: "#161616", border: `1px solid ${H.line}`, borderRadius: 16, boxShadow: "0 18px 50px rgba(0,0,0,.6)", padding: "12px 14px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.text }}>{one ? (one.name || (noOf(one) ? `#${noOf(one)}` : "1 selected")) : `${selected.length} selected`}</span>
              <button onClick={close} aria-label="Close" title="Close (deselect)" style={{ marginLeft: "auto", background: "none", border: "none", color: H.faint, fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 4 }}>✕</button>
            </div>
            {!sheet.archived_at && (changeNote !== null ? (
              <div>
                <input autoFocus value={changeNote} onChange={e => setChangeNote(e.target.value)} placeholder="What should change? (their words)" maxLength={500}
                  onKeyDown={e => { if (e.key === "Enter" && changeNote.trim()) setVerdicts("change", changeNote.trim()); if (e.key === "Escape") setChangeNote(null); }}
                  style={{ ...inp, width: "100%", boxSizing: "border-box", fontSize: 13, padding: "10px 12px", borderColor: H.amber }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => setChangeNote(null)} style={{ ...ghostBtn, border: "none", color: H.faint }}>Cancel</button>
                  <button disabled={busy || !changeNote.trim()} onClick={() => setVerdicts("change", changeNote.trim())} style={{ ...primaryBtn, marginLeft: "auto", background: H.amber, color: H.ink, padding: "9px 18px" }}>Save change</button>
                </div>
              </div>
            ) : (
              <VerdictRow disabled={busy} value={shared} onPick={v => {
                if (v === shared) return setVerdicts(null);
                if (v !== "change") return setVerdicts(v);
                // a Change is one card's own note
                if (!one) { setErr("Change one card at a time: it carries that card's note"); return; }
                setErr("");
                setChangeNote(one.client_note && !noteIsStale(one) ? one.client_note : "");
              }} p={{ line: H.line, dim: H.dim, ink: H.ink, green: H.green, amber: H.amber, red: H.red, font: H.font }} />
            ))}
            {err && <div role="alert" style={{ color: H.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginTop: 10, paddingTop: 8, borderTop: `1px solid ${H.line2}` }}>
              {/* a Change's note, reworded (tapping the lit Change would send it back to Concepts) */}
              {one && one.client_verdict === "change" && changeNote === null && !sheet.archived_at && <button disabled={busy} onClick={() => setChangeNote(noteIsStale(one) ? "" : one.client_note || "")} style={{ ...link, color: H.amber }}>Edit what to change</button>}
              {one && (one.images?.length || 0) > 1 && <button disabled={busy} onClick={async () => { setBusy(true); try { await unpairItem(one); setSelected([]); } finally { setBusy(false); } }} style={link}>Unpair ({one.images.length})</button>}
              {!sheet.archived_at && <span style={{ position: "relative" }}>
                <button disabled={busy} onClick={() => setRelPick(o => !o)} style={{ ...link, color: H.text }}>Add to release ▾</button>
                {relPick && (
                  <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 5, background: "#1c1c1c", border: `1px solid ${H.line}`, borderRadius: 12, padding: 8, display: "flex", flexDirection: "column", gap: 2, minWidth: 240, boxShadow: "0 12px 30px rgba(0,0,0,.5)" }}>
                    {rels.map(r => <button key={r.id} disabled={busy} onClick={() => addToRelease({ releaseId: r.id })} style={{ ...link, textAlign: "left", padding: "7px 8px", color: H.text, fontWeight: 600 }}>{r.title}<span style={{ color: H.faint, fontFamily: H.mono, fontSize: 10, marginLeft: 6 }}>{r.status}</span></button>)}
                    <span style={{ display: "flex", gap: 6, padding: "4px 4px 2px" }}>
                      <input value={newRel} onChange={e => setNewRel(e.target.value)} placeholder="New release…" onKeyDown={e => { if (e.key === "Enter" && newRel.trim()) addToRelease({ newTitle: newRel.trim() }); }}
                        style={{ ...inp, fontSize: 12, padding: "7px 9px", flex: 1 }} />
                      <button disabled={busy || !newRel.trim()} onClick={() => addToRelease({ newTitle: newRel.trim() })} style={{ ...primaryBtn, padding: "7px 12px", fontSize: 10 }}>＋</button>
                    </span>
                  </span>
                )}
              </span>}
              {selected.length === 2 && <button disabled={busy} onClick={pairSelected} title="First tapped = front" style={{ ...link, color: H.blue }}>Pair as one product</button>}
              {selected.length > 2 && <button disabled={busy} onClick={groupSelected} style={{ ...link, color: H.blue }}>Group as one</button>}
              <a href={`/api/studio/line-sheets/${params.id}/download?pick=${selected.join(",")}`} download style={link}>↓ Download</a>
              <button disabled={busy} onClick={dropSelected} style={{ ...link, color: H.red, marginLeft: "auto" }}>Remove</button>
            </div>
          </div>
        );
      })()}

      {publishOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) setPublishOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 18, width: "100%", maxWidth: 460, padding: "20px 22px" }}>
            <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase" }}>Publish v{sheet.current_version + 1}</div>
            <div style={{ fontSize: 12, color: H.dim, marginTop: 6, lineHeight: 1.5 }}>New uploads and replaced mockups go live in their hub{waiting ? ` (${waiting} waiting)` : ""}. Names, order, grouping and verdicts are already live without publishing. New items get a NEW badge; items with new art get UPDATED, and their verdict clears so the client is asked again about the new picture (back in Concepts). Their note stays, shown as what they asked for.</div>
            <label style={{ ...lbl, marginTop: 12 }}>What changed <span style={{ color: H.faint }}>(the client sees this)</span></label>
            <textarea value={publishNote} onChange={e => setPublishNote(e.target.value)} rows={2} placeholder="e.g. your swaps are in, added the M81 and a popup sticker pack" style={{ ...inp, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => setPublishOpen(false)} style={{ ...ghostBtn, border: "none", color: H.faint }}>Cancel</button>
              <button disabled={busy} onClick={async () => { const r = await patchSheet({ publish: true, note: publishNote.trim() || null }); if (r?.ok) { setPublishOpen(false); setPublishNote(""); } }} style={{ ...primaryBtn, marginLeft: "auto", padding: "12px 22px" }}>{busy ? "Publishing…" : `Publish v${sheet.current_version + 1} →`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const menuItem: React.CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", textAlign: "left", background: "none", border: "none", color: H.text, fontSize: 13, fontFamily: H.font, padding: "9px 11px", cursor: "pointer", borderRadius: 7, textDecoration: "none" };

// The direct link for a message to the client — opens straight to this sheet.
function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1600); } catch {} }}
      style={{ ...tag(done ? H.green : H.text, 9.5), background: "none", cursor: "pointer", border: `1px solid ${H.line}`, borderRadius: 8, padding: "4px 9px", fontFamily: H.font }}>
      {done ? "Copied ✓" : "Copy client link"}
    </button>
  );
}

// One draggable card: the wrapper moves, the picture is the handle (card()).
// riding = selected and carried along by another card's drag: it fades out of
// its spot like the grabbed one.
function SortableCard({ id, disabled, riding, children }: { id: string; disabled?: boolean; riding?: boolean; children: (h: { listeners: any; attributes: any }) => React.ReactNode }) {
  // disabled while a save is in flight, so a second drag can't race the reload
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({ id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging || riding ? 0.3 : 1, height: "100%" }}>
      {children({ listeners, attributes })}
    </div>
  );
}
