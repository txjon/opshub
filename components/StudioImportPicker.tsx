"use client";
// The Studio clean-up → board (lib/studio-import). Every request of this
// client, every file laid out; each file is Keep (default), Board or Trash,
// and one Apply does it all. Delete with lib/studio-import.
import { useEffect, useState } from "react";
import { H, primaryBtn, ghostBtn, tag, ago } from "@/lib/studio-theme";
import { useConfirm } from "@/components/useConfirm";
import { T } from "@/lib/theme";   // T.accent = the confirm dialog's dark-text button
import type { StudioRequest, StudioFile } from "@/lib/studio-import";

type Fate = "keep" | "board" | "trash";
const thumb = (id: string) => `/api/files/thumbnail?id=${id}&thumb=1&size=300`;
const KIND: Record<string, string> = { reference: "Reference", wip: "Work", first_draft: "Draft", revision: "Revision", final: "Final" };
const FATE_WORD: Record<Fate, string> = { keep: "Keep", board: "Board", trash: "Trash" };

const Icon = ({ f }: { f: Fate }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {f === "keep" && <path d="M5 4h14v16l-7-4-7 4Z" />}
    {f === "board" && <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>}
    {f === "trash" && <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>}
  </svg>
);

export function StudioImportPicker({ sheetId, onClose, onDone }: { sheetId: string; onClose: () => void; onDone: () => void }) {
  const [reqs, setReqs] = useState<StudioRequest[] | null>(null);
  const [fate, setFate] = useState<Record<string, Fate>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirm, confirmEl] = useConfirm();

  useEffect(() => {
    fetch(`/api/studio/line-sheets/${sheetId}/from-studio`).then(r => r.json()).then(r => {
      if (r.error) { setErr(r.error); setReqs([]); return; }
      setReqs(r.requests);
    }).catch(() => { setErr("Couldn't load the Studio requests. Try again."); setReqs([]); });
  }, [sheetId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  const set = (ids: string[], f: Fate) => setFate(m => { const n = { ...m }; for (const id of ids) { if (f === "keep") delete n[id]; else n[id] = f; } return n; });
  const ofFate = (f: Fate) => Object.keys(fate).filter(id => fate[id] === f);
  const boardN = ofFate("board").length, trashN = ofFate("trash").length;
  const cardsN = (reqs || []).filter(q => q.files.some(f => fate[f.id] === "board" && !f.onBoard)).length;

  async function apply() {
    const parts = [boardN ? `${boardN} file${boardN === 1 ? "" : "s"} become${boardN === 1 ? "s" : ""} ${cardsN} draft card${cardsN === 1 ? "" : "s"} on the board and leave${boardN === 1 ? "s" : ""} Studio.` : "", trashN ? `${trashN} file${trashN === 1 ? "" : "s"} leave${trashN === 1 ? "s" : ""} Studio for good (Drive keeps them in its trash for 30 days).` : ""].filter(Boolean);
    if (!await confirm({ title: "Apply the clean-up?", message: `${parts.join(" ")} A file that leaves Studio takes its comment thread with it; the client's comments are copied onto the card's note. A PSD sent to the board stays in Studio as the print file; only its preview goes on the card. Everything you left on Keep stays.`, confirmLabel: "Apply", confirmColor: trashN ? H.red : T.accent })) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/studio/line-sheets/${sheetId}/from-studio`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board: ofFate("board"), trash: ofFate("trash") }) }).then(x => x.json());
      if (r.error) setErr(r.error);
      else if (r.failed) setErr(`${r.failed} file${r.failed === 1 ? "" : "s"} couldn't leave Studio. The rest is done; close and reopen to see where things stand.`);
      else onDone();
    } catch { setErr("The clean-up didn't finish. Close and reopen to see where things stand."); }
    finally { setBusy(false); }
  }

  const tile = (q: StudioRequest, f: StudioFile) => {
    const v = fate[f.id] || "keep";
    const canBoard = !!f.driveId;
    const col: Record<Fate, string> = { keep: H.faint, board: H.blue, trash: H.red };
    return (
      <div key={f.id} style={{ background: H.panel, borderRadius: 10, overflow: "hidden", border: `2px ${v === "trash" ? "dashed" : "solid"} ${v === "keep" ? H.line2 : col[v]}` }}>
        <div style={{ position: "relative", aspectRatio: "1", background: "#f4f2ee", display: "flex", alignItems: "center", justifyContent: "center", opacity: v === "trash" ? 0.3 : 1 }}>
          {f.driveId
            ? <img src={thumb(f.driveId)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain", mixBlendMode: "multiply" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
            : <span style={{ fontFamily: H.mono, fontSize: 10, color: "#555", padding: 8, wordBreak: "break-all", textAlign: "center" }}>{f.name || "file"}</span>}
        </div>
        <div style={{ padding: "6px 7px 7px" }}>
          <div title={f.name || undefined} style={{ ...tag(f.kind === "reference" ? H.amber : H.faint, 8.5), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.onBoard ? "On the board" : v === "board" && f.layered ? "Preview to board · PSD stays" : f.id === q.approvedFileId ? "Approved · lands As is" : KIND[f.kind] || f.kind}
          </div>
          {/* the file name tells versions apart ("v4 - FO - Army Green") */}
          <div title={f.name || undefined} style={{ fontSize: 10, color: H.dim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(f.name || "").replace(/\.[a-z0-9]{2,5}$/i, "")}</div>
          <div role="group" aria-label="What happens to this file" style={{ display: "flex", gap: 3, marginTop: 5 }}>
            {(["keep", "board", "trash"] as Fate[]).map(x => {
              const on = v === x, off = x === "board" && !canBoard;
              return (
                <button key={x} type="button" disabled={busy || off} aria-pressed={on} title={off ? "No picture to show on the board" : FATE_WORD[x]} onClick={() => set([f.id], x)}
                  style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "7px 0 6px", borderRadius: 7, cursor: off ? "default" : "pointer", fontFamily: H.font, opacity: off ? 0.3 : 1,
                    border: `1.5px solid ${on ? (x === "keep" ? H.dim : col[x]) : H.line}`, background: on ? (x === "keep" ? "transparent" : col[x]) : "transparent", color: on ? (x === "keep" ? H.text : H.ink) : H.dim }}>
                  <Icon f={x} />
                  <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1 }}>{FATE_WORD[x]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div role="dialog" aria-label="Studio clean-up" style={{ position: "fixed", inset: 0, zIndex: 300, background: H.ink, overflowY: "auto", fontFamily: H.font, color: H.text }}>
      {confirmEl}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 16px 130px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
          <div style={{ fontSize: "clamp(22px,3.5vw,34px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", flex: "1 1 260px" }}>Studio clean-up</div>
          <button onClick={onClose} disabled={busy} style={ghostBtn}>Close</button>
        </div>
        <div style={{ fontSize: 12.5, color: H.dim, marginBottom: 22, maxWidth: 720 }}>
          Every file in their Studio. Mark each one: <b style={{ color: H.text }}>Keep</b> stays in Studio, <b style={{ color: H.text }}>Board</b> becomes a draft card and leaves Studio, <b style={{ color: H.text }}>Trash</b> leaves Studio for good. Board files from one request make one card; split it on the board if they&rsquo;re separate products. Nothing shows in their hub until you publish.
        </div>
        {reqs === null && <div style={{ color: H.faint, fontSize: 13 }}>Loading their Studio…</div>}
        {reqs && !reqs.length && !err && <div style={{ color: H.faint, fontSize: 13 }}>Nothing left in this client&rsquo;s Studio.</div>}
        {(reqs || []).map(q => {
          const ids = q.files.map(f => f.id);
          return (
            <section key={q.id} style={{ marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", borderBottom: `1px solid ${H.line2}`, paddingBottom: 7, marginBottom: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{q.title}</span>
                <span style={tag(q.state === "approved" ? H.green : H.faint, 9)}>{q.state === "approved" ? `Approved · ${q.files.length} file${q.files.length === 1 ? "" : "s"}` : `${ago(q.updatedAt)} · ${q.files.length} file${q.files.length === 1 ? "" : "s"}`}</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
                  <button disabled={busy} onClick={() => set(ids, "trash")} style={link}>Trash all</button>
                  <button disabled={busy} onClick={() => set(ids, "keep")} style={link}>Reset</button>
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 10 }}>{q.files.map(f => tile(q, f))}</div>
            </section>
          );
        })}
      </div>
      {(boardN > 0 || trashN > 0 || err) && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "rgba(10,10,10,.96)", borderTop: `1px solid ${H.line}`, padding: "12px 16px", display: "flex", gap: 14, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          {err && <span style={{ color: H.red, fontSize: 12 }}>{err}</span>}
          {boardN > 0 && <span style={{ fontSize: 12.5, color: H.text }}><b>{boardN}</b> to board ({cardsN} card{cardsN === 1 ? "" : "s"})</span>}
          {trashN > 0 && <span style={{ fontSize: 12.5, color: H.text }}><b>{trashN}</b> to trash</span>}
          {(boardN > 0 || trashN > 0) && <button disabled={busy} onClick={apply} style={primaryBtn}>{busy ? "Working…" : "Apply →"}</button>}
        </div>
      )}
    </div>
  );
}

const link: React.CSSProperties = { background: "none", border: "none", padding: 0, color: H.blue, cursor: "pointer", fontSize: 12, fontFamily: H.font, borderBottom: `1px dotted ${H.blue}` };
