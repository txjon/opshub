"use client";
import { useEffect, useRef, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, lbl, tag, fmtStamp } from "@/lib/studio-theme";
import { useConfirm } from "@/components/useConfirm";
// @ts-ignore — plain-JS lib, no declarations
import { uploadToDrive } from "@/lib/drive-upload-client";

// THE LINE SHEET BUILDER (mig 190, selection-first rework Oct 1).
// No dragging. Tap cards to select; a sticky action bar does the rest:
// Pair (2 selected → one product), Add to shelf (existing or named right
// there), Drop. Mockups auto-number on arrival (01, 02…). Uploads are
// bulletproof: 3-at-a-time, each file registers the moment it lands (a crash
// keeps everything landed), re-dropping the same folder skips what's already
// on the sheet, and a locked overlay owns the screen until the batch is in.
const thumbUrl = (id: string, size = 500) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
type QFile = { file: File; status: "pending" | "uploading" | "done" | "failed" | "skipped"; error?: string };

export default function LineSheetBuilder({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string[]>([]);   // ordered — first tap = front
  const [newSection, setNewSection] = useState("");
  const [shelfPickOpen, setShelfPickOpen] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [queue, setQueue] = useState<QFile[]>([]);
  const [confirm, confirmEl] = useConfirm();
  const fileIn = useRef<HTMLInputElement | null>(null);
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
    const existing = new Set<string>();
    for (const it of dataRef.current?.items || []) for (const im of it.images || []) if (im.name) existing.add(im.name);
    const incoming = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!incoming.length) return;
    const fresh: QFile[] = incoming.map(f => ({ file: f, status: existing.has(f.name) ? "skipped" as const : "pending" as const }));
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
        const r = await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: [{ driveId: up.fileId, name: q.file.name }] }) });
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
        await load();   // tray fills as the batch lands
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
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    const drop = (e: DragEvent) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); enqueue(e.dataTransfer.files); } };
    window.addEventListener("dragover", over); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
    // eslint-disable-next-line
  }, []);

  if (!data) return <div style={{ padding: 40, color: "rgba(255,255,255,.4)", background: H.ink, minHeight: "100vh", fontFamily: H.font }}>Opening the sheet…</div>;
  const { sheet, sections, versions } = data;
  const items: any[] = data.items.filter((i: any) => !i.dropped);
  const dropped: any[] = data.items.filter((i: any) => i.dropped);
  const tray = items.filter(i => !i.section_id);
  const numberOf = new Map<string, string>(items.map((it, i) => [it.id, String(i + 1).padStart(2, "0")]));

  async function patchSheet(body: any) { setBusy(true); try { const r = await fetch(`/api/studio/line-sheets/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json()); if (r.error) setErr(r.error); await load(); return r; } finally { setBusy(false); } }
  async function patchItem(body: any) { const r = await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json()); if (r.error) setErr(r.error); }

  const visualOrder = [...tray, ...sections.flatMap((s: any) => items.filter(i => i.section_id === s.id))].map(i => i.id);
  const toggleSel = (id: string, shift = false) => setSelected(prev => {
    if (shift && prev.length) {
      // shift-click = select the whole run between the last tap and this one
      const a = visualOrder.indexOf(prev[prev.length - 1]), b = visualOrder.indexOf(id);
      if (a >= 0 && b >= 0) { const range = visualOrder.slice(Math.min(a, b), Math.max(a, b) + 1); return [...prev, ...range.filter(x => !prev.includes(x))]; }
    }
    return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
  });
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
  async function addSelectedToShelf(sectionId: string) {
    setBusy(true); try { for (const id of selected) await patchItem({ id, sectionId }); setSelected([]); setShelfPickOpen(false); setNewShelfName(""); await load(); } finally { setBusy(false); }
  }
  async function addSelectedToNewShelf() {
    if (!newShelfName.trim()) return;
    const r = await fetch(`/api/studio/line-sheets/${params.id}/sections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newShelfName.trim() }) }).then(x => x.json());
    if (r.section?.id) await addSelectedToShelf(r.section.id);
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
    await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: rest.map((r: any) => ({ driveId: r.driveId, name: r.name })) }) });
    await load();
  }

  const card = (it: any) => {
    const imgs = it.images || [];
    const selIdx = selected.indexOf(it.id);
    const on = selIdx >= 0;
    return (
      <div key={it.id} onClick={e => toggleSel(it.id, e.shiftKey)}
        style={{ background: H.panel, border: `1px solid ${on ? H.blue : H.line}`, outline: on ? `2px solid ${H.blue}` : "none", outlineOffset: -1, borderRadius: 12, padding: 10, width: 172, cursor: "pointer", position: "relative", userSelect: "none" }}>
        {/* tight pair render: front left, back tucked right — the PDF look */}
        <div style={{ position: "relative", height: 122, background: "#fff", borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {imgs.length > 1 ? (
            <>
              <img src={thumbUrl(imgs[0].driveId, 400)} alt="" referrerPolicy="no-referrer" style={{ width: "62%", height: "94%", objectFit: "contain", marginRight: "-14%", zIndex: 2, mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
              <img src={thumbUrl(imgs[1].driveId, 400)} alt="" referrerPolicy="no-referrer" style={{ width: "62%", height: "94%", objectFit: "contain", zIndex: 1, mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
            </>
          ) : imgs[0] ? (
            <img src={thumbUrl(imgs[0].driveId, 400)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
          ) : null}
          <span style={{ position: "absolute", left: 5, top: 5, fontFamily: H.mono, fontSize: 10, fontWeight: 700, color: "#555", background: "rgba(255,255,255,.92)", borderRadius: 5, padding: "2px 6px", zIndex: 3 }}>{numberOf.get(it.id)}</span>
          {on && <span style={{ position: "absolute", right: 5, top: 5, background: H.blue, color: H.ink, borderRadius: 999, width: 20, height: 20, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900, zIndex: 3 }}>{selIdx + 1}</span>}
          {imgs.length > 2 && <span style={{ position: "absolute", right: 5, bottom: 5, ...tag("#555", 8.5), background: "rgba(255,255,255,.92)", borderRadius: 5, padding: "2px 6px", zIndex: 3 }}>+{imgs.length - 2}</span>}
          {it.client_thumb && <span style={{ position: "absolute", left: 5, bottom: 5, zIndex: 3, fontSize: 13 }}>{it.client_thumb === "up" ? "👍" : "👎"}</span>}
        </div>
        <input defaultValue={it.name || ""} placeholder={`name it… (${numberOf.get(it.id)})`} onClick={e => e.stopPropagation()}
          onBlur={e => { if ((e.target.value || "") !== (it.name || "")) { patchItem({ id: it.id, name: e.target.value }).then(load); } }}
          style={{ width: "100%", boxSizing: "border-box", background: H.ink, border: `1px solid ${H.line2}`, borderRadius: 6, color: H.text, fontSize: 11.5, fontWeight: 700, padding: "5px 7px", outline: "none", fontFamily: H.font, marginTop: 8 }} />
      </div>
    );
  };

  const doneN = queue.filter(q => q.status === "done").length;
  const skippedN = queue.filter(q => q.status === "skipped").length;
  const failedN = queue.filter(q => q.status === "failed").length;
  const totalN = queue.filter(q => q.status !== "skipped").length;
  const uploadingNames = queue.filter(q => q.status === "uploading").map(q => q.file.name);

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "26px 20px 140px", background: H.ink, minHeight: "100vh", color: H.text, fontFamily: H.font }}>
      {confirmEl}

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

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}><a href="/studio/line-sheets" style={{ color: H.faint, textDecoration: "none" }}>‹ Line sheets</a></div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", margin: "6px 0 4px" }}>
        <input defaultValue={sheet.title} onBlur={e => { if (e.target.value.trim() && e.target.value !== sheet.title) patchSheet({ title: e.target.value }); }}
          style={{ fontSize: "clamp(26px,4vw,44px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", background: "none", border: "none", borderBottom: "1px dotted rgba(255,255,255,.3)", color: H.text, outline: "none", fontFamily: H.font, minWidth: 200, flex: "1 1 300px" }} />
        <input defaultValue={sheet.season || ""} placeholder="[ SEASON ]" onBlur={e => { if ((e.target.value || "") !== (sheet.season || "")) patchSheet({ season: e.target.value }); }}
          style={{ fontFamily: H.mono, fontSize: 13, color: H.amber, background: "none", border: "none", borderBottom: "1px dotted rgba(255,255,255,.25)", outline: "none", width: 140 }} />
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 24 }}>
        <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>{sheet.clients?.name}</span>
        <span style={tag(sheet.current_version ? H.blue : H.amber, 9.5)}>{sheet.current_version ? `v${sheet.current_version} live in their hub` : "Draft · never published"}</span>
        {sheet.current_version > 0 && sheet.clients?.portal_token && <a href={`/portal/client/${sheet.clients.portal_token}/line-sheets`} target="_blank" rel="noreferrer" style={{ ...tag(H.text, 9.5), textDecoration: "none", border: `1px solid ${H.line}`, borderRadius: 8, padding: "4px 9px" }}>View as client ↗</a>}
        {versions.length > 0 && <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint }}>last publish {fmtStamp(versions[versions.length - 1].published_at)}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <input ref={fileIn} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { if (e.target.files?.length) enqueue(e.target.files); if (fileIn.current) fileIn.current.value = ""; }} />
          <button onClick={() => fileIn.current?.click()} style={ghostBtn}>+ Add mockups</button>
          <button disabled={busy} onClick={() => setPublishOpen(true)} style={{ ...primaryBtn, padding: "11px 20px" }}>Publish {sheet.current_version ? `v${sheet.current_version + 1}` : "v1"} →</button>
        </span>
      </div>
      {err && <div style={{ color: H.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}

      {/* THE TRAY */}
      <section style={{ border: `2px dashed ${tray.length ? H.line : H.line2}`, borderRadius: 14, padding: 14, marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: tray.length ? 12 : 0 }}>
          <span style={tag(H.amber, 9.5)}>The tray · {tray.length ? `${tray.length} to sort` : "drop mockups anywhere on this page"}</span>
          <span style={{ fontSize: 10.5, color: H.faint }}>tap two → Pair · shift-tap = select the run · Add to shelf</span>
        </div>
        {tray.length > 0 && <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{tray.map(card)}</div>}
      </section>

      {/* THE SHELVES */}
      {sections.map((s: any, si: number) => {
        const inSection = items.filter(i => i.section_id === s.id);
        return (
          <section key={s.id} style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <input defaultValue={s.name} onBlur={e => { if (e.target.value.trim() && e.target.value !== s.name) fetch(`/api/studio/line-sheets/${params.id}/sections`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, name: e.target.value }) }).then(load); }}
                style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", background: "none", border: "none", borderBottom: "1px dotted rgba(255,255,255,.25)", color: H.text, outline: "none", fontFamily: H.font, width: 240 }} />
              <span style={{ fontSize: 10.5, color: H.faint }}>{inSection.length} item{inSection.length === 1 ? "" : "s"}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {si > 0 && <button onClick={() => Promise.all([fetch(`/api/studio/line-sheets/${params.id}/sections`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, sort: sections[si - 1].sort }) }), fetch(`/api/studio/line-sheets/${params.id}/sections`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sections[si - 1].id, sort: s.sort }) })]).then(load)} style={{ ...ghostBtn, padding: "4px 9px", fontSize: 10 }}>↑</button>}
                {si < sections.length - 1 && <button onClick={() => Promise.all([fetch(`/api/studio/line-sheets/${params.id}/sections`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, sort: sections[si + 1].sort }) }), fetch(`/api/studio/line-sheets/${params.id}/sections`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sections[si + 1].id, sort: s.sort }) })]).then(load)} style={{ ...ghostBtn, padding: "4px 9px", fontSize: 10 }}>↓</button>}
                <button onClick={async () => { if (await confirm({ title: `Remove the "${s.name}" shelf?`, message: "Its items go back to the tray.", confirmLabel: "Remove shelf" })) { await fetch(`/api/studio/line-sheets/${params.id}/sections`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id }) }); await load(); } }} style={{ background: "none", border: "none", color: H.faint, fontSize: 14, cursor: "pointer" }}>×</button>
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", minHeight: 40, borderLeft: `2px solid ${H.line2}`, paddingLeft: 12 }}>
              {inSection.length ? inSection.map(card) : <span style={{ fontSize: 11, color: H.faint, alignSelf: "center" }}>select items → Add to shelf</span>}
            </div>
          </section>
        );
      })}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 30 }}>
        <input value={newSection} onChange={e => setNewSection(e.target.value)} placeholder="New shelf — e.g. HATS" onKeyDown={async e => { if (e.key === "Enter" && newSection.trim()) { await fetch(`/api/studio/line-sheets/${params.id}/sections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newSection.trim() }) }); setNewSection(""); await load(); } }} style={{ ...inp, maxWidth: 240 }} />
        <span style={{ fontSize: 10.5, color: H.faint }}>↵ to add</span>
      </div>

      {dropped.length > 0 && (
        <div style={{ borderTop: `1px solid ${H.line2}`, paddingTop: 12 }}>
          <span style={tag(H.faint, 9)}>✕ {dropped.length} dropped · </span>
          {dropped.map((it: any) => <button key={it.id} onClick={() => patchItem({ id: it.id, restore: true }).then(load)} style={{ background: "none", border: "none", color: H.faint, fontSize: 11, cursor: "pointer", fontFamily: H.font, textDecoration: "underline", padding: "0 6px" }}>{it.name || "untitled"} ↩</button>)}
        </div>
      )}

      {/* ── THE SELECTION BAR ── */}
      {selected.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 250, background: "rgba(10,10,10,.97)", borderTop: `1px solid ${H.line}`, padding: "12px 18px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>{selected.length} selected</span>
          {selected.length === 1 && (items.find(i => i.id === selected[0])?.images?.length || 0) > 1 && <button disabled={busy} onClick={async () => { const it = items.find(i => i.id === selected[0]); setBusy(true); try { await unpairItem(it); setSelected([]); } finally { setBusy(false); } }} style={{ ...ghostBtn, color: H.blue, borderColor: "rgba(143,199,216,.4)" }}>Unpair ({items.find(i => i.id === selected[0])?.images?.length})</button>}
          {selected.length === 2 && <button disabled={busy} onClick={pairSelected} style={{ ...primaryBtn, background: H.blue, color: H.ink }}>Pair → one product</button>}
          {selected.length > 2 && <button disabled={busy} onClick={groupSelected} style={{ ...ghostBtn, color: H.blue, borderColor: "rgba(143,199,216,.4)" }}>Group {selected.length} as one</button>}
          <span style={{ position: "relative" }}>
            <button disabled={busy} onClick={() => setShelfPickOpen(v => !v)} style={primaryBtn}>Add to shelf ▾</button>
            {shelfPickOpen && (
              <span style={{ position: "absolute", bottom: "110%", left: 0, background: "#161616", border: `1px solid ${H.line}`, borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
                {sections.map((s: any) => <button key={s.id} onClick={() => addSelectedToShelf(s.id)} style={{ ...ghostBtn, textAlign: "left", width: "100%" }}>{s.name}</button>)}
                <span style={{ display: "flex", gap: 6 }}>
                  <input value={newShelfName} onChange={e => setNewShelfName(e.target.value)} placeholder="new shelf…" autoFocus={!sections.length} onKeyDown={e => { if (e.key === "Enter") addSelectedToNewShelf(); }} style={{ ...inp, fontSize: 12, padding: "7px 9px" }} />
                  <button onClick={addSelectedToNewShelf} style={{ ...primaryBtn, padding: "7px 12px", fontSize: 10 }}>＋</button>
                </span>
              </span>
            )}
          </span>
          <button disabled={busy} onClick={dropSelected} style={{ ...ghostBtn, color: H.red, borderColor: "rgba(255,90,110,.4)" }}>Remove</button>
          <button onClick={() => { setSelected([]); setShelfPickOpen(false); }} style={{ ...ghostBtn, border: "none", color: H.faint }}>Clear</button>
        </div>
      )}

      {publishOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) setPublishOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 18, width: "100%", maxWidth: 460, padding: "20px 22px" }}>
            <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase" }}>Publish v{sheet.current_version + 1}</div>
            <div style={{ fontSize: 12, color: H.dim, marginTop: 6, lineHeight: 1.5 }}>The client&rsquo;s hub updates to this exact sheet. New items get a NEW badge; visually changed items get UPDATED and their thumb resets — unchanged items keep their 👍/👎.</div>
            {tray.length > 0 && <div style={{ fontSize: 12, color: H.amber, marginTop: 8 }}>Heads up: {tray.length} item{tray.length === 1 ? " is" : "s are"} still in the tray — they publish shelf-less at the bottom.</div>}
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
