"use client";
import { useEffect, useRef, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, lbl, tag, fmtStamp } from "@/lib/studio-theme";
import { useConfirm } from "@/components/useConfirm";
// @ts-ignore — plain-JS lib, no declarations
import { uploadToDrive } from "@/lib/drive-upload-client";

// THE LINE SHEET BUILDER (mig 190). The desktop mockup folder, grown a UI:
// an ever-present drop zone, a sorting tray, drag-to-merge fronts and backs
// into one product, sections as shelves, and an explicit Publish that stamps
// the next version the client sees. The client only ever sees snapshots —
// everything here is the draft.
const thumbUrl = (id: string, size = 500) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;

export default function LineSheetBuilder({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploadingN, setUploadingN] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newSection, setNewSection] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [confirm, confirmEl] = useConfirm();
  const fileIn = useRef<HTMLInputElement | null>(null);
  const dragItem = useRef<string | null>(null);

  const load = async () => { const j = await fetch(`/api/studio/line-sheets/${params.id}`).then(r => r.json()).catch(() => null); if (j && !j.error) setData(j); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params.id]);

  if (!data) return <div style={{ padding: 40, color: "rgba(255,255,255,.4)", background: H.ink, minHeight: "100vh", fontFamily: H.font }}>Opening the sheet…</div>;
  const { sheet, sections, versions } = data;
  const items: any[] = data.items.filter((i: any) => !i.dropped);
  const dropped: any[] = data.items.filter((i: any) => i.dropped);
  const tray = items.filter(i => !i.section_id);
  const unpublished = items.some(i => i.added_in == null) || sheet.current_version === 0;

  async function patchSheet(body: any) { setBusy(true); try { const r = await fetch(`/api/studio/line-sheets/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json()); if (r.error) setErr(r.error); await load(); return r; } finally { setBusy(false); } }
  async function patchItem(body: any) { const r = await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json()); if (r.error) setErr(r.error); await load(); }

  // ── uploads: every dropped file lands in the tray as its own item ──
  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!list.length) return;
    setUploadingN(list.length); setErr("");
    const registered: { driveId: string; name: string }[] = [];
    for (const f of list) {
      try {
        const up = await uploadToDrive({ blob: f, fileName: f.name, mimeType: f.type || "image/png", itemId: null, clientName: sheet.clients?.name || "Studio", projectTitle: "Line Sheets", itemName: sheet.title || "Line Sheet", onProgress: undefined });
        registered.push({ driveId: up.fileId, name: f.name });
      } catch (e: any) { setErr(`${f.name} didn't upload — ${e?.message || "try again"}`); }
      setUploadingN(n => Math.max(0, n - 1));
    }
    if (registered.length) await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: registered }) });
    setUploadingN(0); await load();
  }
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDragOver(true); } };
    const leave = (e: DragEvent) => { if ((e as any).relatedTarget == null) setDragOver(false); };
    const drop = (e: DragEvent) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); } else setDragOver(false); };
    window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
    // eslint-disable-next-line
  }, [sheet?.title]);

  // ── merge: drag a card onto another = one product (front + back) ──
  async function mergeInto(targetId: string) {
    const src = dragItem.current; dragItem.current = null;
    if (!src || src === targetId) return;
    await patchItem({ id: targetId, mergeFrom: src });
  }
  async function groupSelected() {
    const ids = Array.from(selected); if (ids.length < 2) return;
    const [first, ...rest] = ids;
    for (const id of rest) await patchItem({ id: first, mergeFrom: id });
    setSelected(new Set());
  }

  async function publish() {
    const r = await patchSheet({ publish: true, note: publishNote.trim() || null });
    if (r?.ok) { setPublishOpen(false); setPublishNote(""); }
  }

  const card = (it: any, draggable = true) => {
    const imgs = it.images || [];
    const sel = selected.has(it.id);
    return (
      <div key={it.id}
        draggable={draggable}
        onDragStart={() => { dragItem.current = it.id; }}
        onDragOver={e => { if (dragItem.current && dragItem.current !== it.id) e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); mergeInto(it.id); }}
        style={{ background: H.panel, border: `1px solid ${sel ? H.blue : H.line}`, borderRadius: 12, padding: 10, width: 170 }}>
        <div style={{ position: "relative", height: 120, background: "#fff", borderRadius: 8, overflow: "hidden" }}>
          {imgs.slice(0, 2).map((im: any, i: number) => (
            <img key={im.id} src={thumbUrl(im.driveId, 400)} alt="" referrerPolicy="no-referrer"
              style={{ position: "absolute", top: i === 0 ? 0 : 10, left: i === 0 ? 0 : 36, width: imgs.length > 1 ? "75%" : "100%", height: imgs.length > 1 ? "85%" : "100%", objectFit: "contain", zIndex: i === 0 ? 2 : 1, filter: i === 0 ? "none" : "brightness(.96)" }}
              onError={(e: any) => { e.target.style.opacity = 0.15; }} />
          ))}
          {imgs.length > 2 && <span style={{ position: "absolute", right: 4, bottom: 4, ...tag("#555", 8.5), background: "rgba(255,255,255,.92)", borderRadius: 5, padding: "2px 6px", zIndex: 3 }}>+{imgs.length - 2}</span>}
          {it.client_thumb && <span style={{ position: "absolute", left: 4, top: 4, zIndex: 3, fontSize: 13 }}>{it.client_thumb === "up" ? "👍" : "👎"}</span>}
          {it.added_in == null && <span style={{ position: "absolute", right: 4, top: 4, ...tag(H.amber, 8), background: "rgba(10,10,10,.85)", borderRadius: 5, padding: "2px 6px", zIndex: 3 }}>unpublished</span>}
        </div>
        <input defaultValue={it.name || ""} placeholder="name it…" onBlur={e => { if ((e.target.value || "") !== (it.name || "")) patchItem({ id: it.id, name: e.target.value }); }}
          style={{ width: "100%", boxSizing: "border-box", background: H.ink, border: `1px solid ${H.line2}`, borderRadius: 6, color: H.text, fontSize: 11.5, fontWeight: 700, padding: "5px 7px", outline: "none", fontFamily: H.font, marginTop: 8 }} />
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
          <input type="checkbox" checked={sel} onChange={() => setSelected(prev => { const n = new Set(prev); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })} title="Select to group" />
          <select value={it.section_id || ""} onChange={e => patchItem({ id: it.id, sectionId: e.target.value || null })}
            style={{ flex: 1, background: H.ink, border: `1px solid ${H.line2}`, borderRadius: 6, color: H.dim, fontSize: 10, padding: "4px 5px", fontFamily: H.font }}>
            <option value="">· tray ·</option>
            {sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={async () => {
            if (it.added_in == null) { if (await confirm({ title: "Delete this item?", message: "It was never published — it deletes outright.", confirmLabel: "Delete" })) { await fetch(`/api/studio/line-sheets/${params.id}/items`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id }) }); await load(); } }
            else if (await confirm({ title: "Drop this item?", message: "It leaves the sheet on the next publish. History keeps it.", confirmLabel: "Drop" })) await patchItem({ id: it.id, drop: true });
          }} style={{ background: "none", border: "none", color: H.faint, fontSize: 13, cursor: "pointer", padding: 0 }} title={it.added_in == null ? "Delete" : "Drop from the sheet"}>×</button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "26px 20px 120px", background: H.ink, minHeight: "100vh", color: H.text, fontFamily: H.font }}>
      {confirmEl}
      {dragOver && <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(10,10,10,.8)", border: `3px dashed ${H.blue}`, display: "grid", placeItems: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 22, fontWeight: 900, textTransform: "uppercase", color: H.blue }}>Drop the mockups</div>
      </div>}
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}><a href="/studio/line-sheets" style={{ color: H.faint, textDecoration: "none" }}>‹ Line sheets</a></div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", margin: "6px 0 4px" }}>
        <input defaultValue={sheet.title} onBlur={e => { if (e.target.value.trim() && e.target.value !== sheet.title) patchSheet({ title: e.target.value }); }}
          style={{ fontSize: "clamp(26px,4vw,44px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", background: "none", border: "none", borderBottom: "1px dotted rgba(255,255,255,.3)", color: H.text, outline: "none", fontFamily: H.font, minWidth: 200, flex: "1 1 300px" }} />
        <input defaultValue={sheet.season || ""} placeholder="[ SEASON ]" onBlur={e => { if ((e.target.value || "") !== (sheet.season || "")) patchSheet({ season: e.target.value }); }}
          style={{ fontFamily: H.mono, fontSize: 13, color: H.red === undefined ? H.amber : H.amber, background: "none", border: "none", borderBottom: "1px dotted rgba(255,255,255,.25)", outline: "none", width: 140 }} />
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 24 }}>
        <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>{sheet.clients?.name}</span>
        <span style={tag(sheet.current_version ? H.blue : H.amber, 9.5)}>{sheet.current_version ? `v${sheet.current_version} live in their hub` : "Draft · never published"}</span>
        {versions.length > 0 && <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint }}>last publish {fmtStamp(versions[versions.length - 1].published_at)}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {selected.size >= 2 && <button onClick={groupSelected} style={{ ...ghostBtn, color: H.blue, borderColor: "rgba(143,199,216,.4)" }}>Group {selected.size} as one item</button>}
          <input ref={fileIn} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { if (e.target.files?.length) uploadFiles(e.target.files); if (fileIn.current) fileIn.current.value = ""; }} />
          <button onClick={() => fileIn.current?.click()} style={ghostBtn}>{uploadingN ? `Uploading ${uploadingN}…` : "+ Add mockups"}</button>
          <button disabled={busy} onClick={() => setPublishOpen(true)} style={{ ...primaryBtn, padding: "11px 20px" }}>Publish {sheet.current_version ? `v${sheet.current_version + 1}` : "v1"} →</button>
        </span>
      </div>
      {err && <div style={{ color: H.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}

      {/* THE TRAY — drops land here; drag one card onto another to make one product */}
      <section style={{ border: `2px dashed ${tray.length ? H.line : H.line2}`, borderRadius: 14, padding: 14, marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: tray.length ? 12 : 0 }}>
          <span style={tag(H.amber, 9.5)}>The tray · {tray.length ? `${tray.length} to sort` : "drop mockups anywhere"}</span>
          <span style={{ fontSize: 10.5, color: H.faint }}>drag a card onto another to pair front + back · name it · send it to a shelf</span>
        </div>
        {tray.length > 0 && <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{tray.map(it => card(it))}</div>}
      </section>

      {/* THE SHELVES */}
      {sections.map((s: any, si: number) => {
        const inSection = items.filter(i => i.section_id === s.id);
        return (
          <section key={s.id} style={{ marginBottom: 26 }}
            onDragOver={e => { if (dragItem.current) e.preventDefault(); }}
            onDrop={async e => { e.preventDefault(); const src = dragItem.current; dragItem.current = null; if (src) await patchItem({ id: src, sectionId: s.id }); }}>
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
              {inSection.length ? inSection.map(it => card(it)) : <span style={{ fontSize: 11, color: H.faint, alignSelf: "center" }}>drag items here</span>}
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
          {dropped.map((it: any) => <button key={it.id} onClick={() => patchItem({ id: it.id, restore: true })} style={{ background: "none", border: "none", color: H.faint, fontSize: 11, cursor: "pointer", fontFamily: H.font, textDecoration: "underline", padding: "0 6px" }}>{it.name || "untitled"} ↩</button>)}
        </div>
      )}

      {publishOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) setPublishOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 18, width: "100%", maxWidth: 460, padding: "20px 22px" }}>
            <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase" }}>Publish v{sheet.current_version + 1}</div>
            <div style={{ fontSize: 12, color: H.dim, marginTop: 6, lineHeight: 1.5 }}>The client&rsquo;s hub updates to this exact sheet. New items get a NEW badge; visually changed items get UPDATED and their thumb resets — unchanged items keep their 👍/👎.</div>
            {tray.length > 0 && <div style={{ fontSize: 12, color: H.amber, marginTop: 8 }}>Heads up: {tray.length} item{tray.length === 1 ? " is" : "s are"} still in the tray — they publish shelf-less at the bottom.</div>}
            <label style={{ ...lbl, marginTop: 12 }}>What changed <span style={{ color: H.faint }}>(the client sees this)</span></label>
            <textarea value={publishNote} onChange={e => setPublishNote(e.target.value)} rows={2} placeholder="e.g. your swaps are in, added the M81 and a popup sticker pack" style={{ ...inp, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => setPublishOpen(false)} style={{ ...ghostBtn, border: "none", color: H.faint }}>Cancel</button>
              <button disabled={busy} onClick={publish} style={{ ...primaryBtn, marginLeft: "auto", padding: "12px 22px" }}>{busy ? "Publishing…" : `Publish v${sheet.current_version + 1} →`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
