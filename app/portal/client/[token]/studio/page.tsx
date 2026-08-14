"use client";
// THE STUDIO, client side (Phase 3, Aug 4 2026) — the Lab's proven client
// experience on REAL briefs. Magazine feed (Your move / In the works / The
// bank) → a sheet with the design big, the thumbs model live (thumbs act
// instantly, sheets carry the weight: keep → order|bank, pass → note +
// quiet exits to shelve or kill), and the conversation. Everything through
// the WALL: the API serves client-visible art and words only.
// Reachable by URL while STUDIO_UNDER_DEV hides the hub tab — the preview.
import { useEffect, useRef, useState } from "react";
import { useClientPortal } from "../_shared/context";
import ThumbIcon from "@/components/ThumbIcon";

const C = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif" };
const STATE = (s: string) => s === "with_client" ? { label: "Your move", color: C.amber } : s === "approved" ? { label: "In the bank", color: C.green } : { label: "In the works", color: C.blue };
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
// Uploads ride through the API; the platform caps request bodies at ~4.5MB —
// bigger files hang then die silently, so refuse them at pick time.
const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024;
const sizeGate = (list: File[]): File[] => {
  const big = list.filter(f => f.size > MAX_UPLOAD_BYTES);
  if (big.length) alert(`Too big to send (4MB max per photo): ${big.map(f => f.name).join(", ")}`);
  return list.filter(f => f.size <= MAX_UPLOAD_BYTES);
};

export default function ClientStudioPage() {
  const { token } = useClientPortal();
  const [client, setClient] = useState<any>(null);
  const [briefs, setBriefs] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [share, setShare] = useState(false);
  const thumb = (id: string, size = 600) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;

  async function loadList() {
    const j = await fetch(`/api/portal/client/${token}/studio`).then(r => r.json()).catch(() => ({}));
    if (!j.error) { setClient(j.client); setBriefs(j.briefs || []); }
  }
  // Chevron speed (Jon, Aug 6): details are cached and neighbors prefetched,
  // so a ‹ › tap swaps instantly from cache (then silently revalidates). The
  // inflight map dedupes — a tap that beats the prefetch joins it mid-flight.
  const detailCache = useRef<Map<string, any>>(new Map());
  const inflight = useRef<Map<string, Promise<any>>>(new Map());
  const openRef = useRef<string | null>(null);
  const fetchDetail = (id: string) => {
    const running = inflight.current.get(id);
    if (running) return running;
    const req = fetch(`/api/portal/client/${token}/studio/${id}`).then(r => r.json())
      .then(d => { inflight.current.delete(id); if (d?.brief) detailCache.current.set(id, d); return d; })
      .catch(() => { inflight.current.delete(id); return null; });
    inflight.current.set(id, req);
    return req;
  };
  async function loadDetail(id: string) {
    const cached = detailCache.current.get(id);
    if (cached) {
      setDetail(cached);
      fetchDetail(id).then(d => { if (d?.brief && openRef.current === id) setDetail(d); });
      return;
    }
    const d = await fetchDetail(id);
    if (openRef.current === id) setDetail(d);
  }
  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [token]);
  useEffect(() => { openRef.current = openId; if (openId) loadDetail(openId); else setDetail(null); /* eslint-disable-next-line */ }, [openId]);
  const refresh = async () => { detailCache.current.clear(); await loadList(); if (openId) await loadDetail(openId); };

  // Scroll-lock the feed while a sheet is open — without it the underlying
  // page scrolls behind the fixed sheet when the keyboard opens (the mobile
  // jump). Restored on close/unmount.
  useEffect(() => {
    if (!openId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [openId]);

  // Post-to-post navigation (Jon, Aug 5): chevrons walk the DESIGNS in feed
  // order — versions inside a design stay the filmstrip's job. Each arrival
  // is a fresh mount (key), so it always lands on the latest version, idle.
  const ordered = ["with_client", "working", "approved"].flatMap(k => briefs.filter(b => b.state === k));
  const navIdx = openId ? ordered.findIndex(b => b.id === openId) : -1;
  // While the sheet is uploading, every exit path holds: backdrop tap,
  // chevrons, arrow keys. The Sheet flips this via onLock.
  const [sheetLock, setSheetLock] = useState(false);
  const goPrev = () => { if (!sheetLock && navIdx > 0) setOpenId(ordered[navIdx - 1].id); };
  const goNext = () => { if (!sheetLock && navIdx >= 0 && navIdx < ordered.length - 1) setOpenId(ordered[navIdx + 1].id); };
  useEffect(() => {
    if (!openId) return;
    const i = ordered.findIndex(b => b.id === openId);
    [ordered[i - 1], ordered[i + 1]].forEach(n => { if (n && !detailCache.current.has(n.id)) fetchDetail(n.id); });
    /* eslint-disable-next-line */
  }, [openId, briefs]);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, [openId, navIdx, ordered.length]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "34px 20px 80px", fontFamily: C.font, color: C.text }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .cs2-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px 12px}
        @media(min-width:600px){.cs2-grid{grid-template-columns:repeat(3,1fr)}}
        .cs2-card{transition:transform .15s ease}
        .cs2-card:hover{transform:translateY(-3px)}
        .cs2-back{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto}
        .cs2-sheet{background:${C.panel};border:1px solid ${C.line};border-radius:20px;max-width:620px;width:100%;overflow:hidden}
        @media(max-width:640px){
          .cs2-back{align-items:flex-end;padding:0;overflow-y:hidden}
          .cs2-sheet{border-radius:18px 18px 0 0;border-bottom:none;max-height:92dvh;overflow-y:auto}
        }
        @media(prefers-reduced-motion:reduce){.cs2-card,.cs2-card:hover{transition:none;transform:none}}
        /* iOS: inputs under 16px trigger focus auto-zoom — the "page zooms
           when I tap Reply" bug. Mobile forms get 16px; desktop stays dense. */
        @media(max-width:640px){
          .cs2-sheet input,.cs2-sheet textarea,.cs2-sheet select{font-size:16px !important}
        }
      ` }} />

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>Your studio</div>
        <h1 style={{ fontSize: "clamp(30px,6.5vw,54px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 18px" }}>{client?.name || "…"}.</h1>
      </div>

      {share ? <ShareForm token={token} onClose={() => setShare(false)} onDone={async (id: string) => { setShare(false); await loadList(); if (id) setOpenId(id); }} />
        : <div style={{ textAlign: "center", marginBottom: 30 }}><button onClick={() => setShare(true)} style={{ ...primaryBtn, padding: "13px 26px", fontSize: 12 }}>Share something →</button></div>}

      {briefs.length === 0 && !share && <div style={{ color: C.dim, fontSize: 13.5, textAlign: "center" }}>Nothing here yet. Share an idea to get started.</div>}
      {[{ k: "with_client", t: "Your move.", c: C.amber }, { k: "working", t: "In the works.", c: C.blue }, { k: "approved", t: "The bank.", c: C.green }].map(bk => {
        const list = briefs.filter(b => b.state === bk.k);
        if (!list.length) return null;
        return (
          <div key={bk.k} style={{ marginTop: 26 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: bk.c }}>{bk.t}</h2>
            <div className="cs2-grid">
              {list.map(b => (
                <button key={b.id} className="cs2-card" onClick={() => setOpenId(b.id)} style={{ textAlign: "left", padding: 0, background: C.panel, border: `1px solid ${b.state === "with_client" ? "rgba(244,178,43,.5)" : C.line}`, borderRadius: 14, overflow: "hidden", cursor: "pointer", fontFamily: C.font, color: C.text, display: "block", width: "100%" }}>
                  <div style={{ aspectRatio: "1", background: b._art || b._lineup ? "#fff" : C.surface, display: "flex", alignItems: "flex-end", overflow: "hidden", position: "relative" }}>
                    {b._lineup && b._lineup.thumbs.length >= 2 ? (
                      <>
                        <span style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gridTemplateRows: "minmax(0,1fr) minmax(0,1fr)", gap: 2, background: "#fff" }}>
                          {b._lineup.thumbs.slice(0, 4).map((id: string, i: number) => <span key={i} style={{ position: "relative", overflow: "hidden" }}><img src={thumb(id, 300)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} /></span>)}
                        </span>
                        <span style={{ position: "absolute", right: 6, bottom: 6, background: "rgba(10,10,10,.85)", color: C.amber, borderRadius: 999, padding: "3px 9px", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{b._lineup.count} options</span>
                      </>
                    ) : b._art ? <img src={thumb(b._art, 400)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                      : <span style={{ padding: 12, fontSize: 14, fontWeight: 900, textTransform: "uppercase", color: C.dim, lineHeight: 1.15 }}>{b.title}</span>}
                  </div>
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.2 }}>{b.title}</div>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: STATE(b.state).color, marginTop: 4 }}>{STATE(b.state).label}</div>
                    {b._release && <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: b._release.status === "cut" ? C.green : C.blue, marginTop: 3 }}>{b._release.status === "cut" ? "In production" : "On release"} · <span style={{ fontWeight: 600 }}>{b._release.title}</span></div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {detail?.brief && <div className="cs2-back" onClick={e => { if (sheetLock) return; if (e.target === e.currentTarget) setOpenId(null); }}>
        <div className="cs2-sheet"><Sheet key={detail.brief.id} detail={detail} token={token} onClose={() => { if (!sheetLock) setOpenId(null); }} onLock={setSheetLock} onRefresh={refresh} nav={{ idx: navIdx, total: ordered.length, onPrev: goPrev, onNext: goNext }} /></div>
      </div>}
    </div>
  );
}

function Sheet({ detail, token, onClose, onRefresh, nav, onLock }: any) {
  const b = detail.brief; const timeline: any[] = detail.timeline || [];
  const orderReq = detail.orderRequest;
  const lineup = detail.lineup;
  const ballotLive = !!(lineup && !lineup.picks_at);
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [pickNote, setPickNote] = useState("");
  const pickCount = Object.values(picks).filter(Boolean).length;
  async function sendPicks() {
    if (!pickCount) return; setBusy(true);
    try {
      await fetch(`/api/portal/client/${token}/studio/${b.id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "picks", optionIds: Object.keys(picks).filter(k => picks[k]), note: pickNote.trim() || null }) });
      setPicks({}); setPickNote(""); await onRefresh();
    } finally { setBusy(false); }
  }
  const st = STATE(b.state);
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const [bar, setBar] = useState<"idle" | "keep" | "order" | "pass">("idle");
  const [killArm, setKillArm] = useState(false);
  const [chNote, setChNote] = useState("");
  const [obBlank, setObBlank] = useState(""); const [obQty, setObQty] = useState(""); const [obNote, setObNote] = useState("");
  const [heroId, setHeroId] = useState<string | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);

  const images = timeline.filter(t => t.kind === "file");
  const live = images.filter(f => f.reaction !== "down");
  const passed = images.filter(f => f.reaction === "down");
  const hero = images.find(f => f.id === heroId) || (live.length ? live[live.length - 1] : images[images.length - 1] || null);
  const notes = timeline.filter(t => t.kind === "note" && t.body && t.body.trim());
  const ended = ["approved", "shelved", "killed"].includes(b.state);
  const heroReactable = !!hero && hero.sender_role === "hpd" && !ended;

  function closeBar() { setBar("idle"); setKillArm(false); setChNote(""); setObBlank(""); setObQty(""); setObNote(""); setHeroId(null); }
  async function act(body: any) {
    await fetch(`/api/portal/client/${token}/studio/${b.id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  async function tapUp() {
    if (!hero) return; setHeroId(hero.id); setBusy(true);
    try { if (hero.reaction !== "up") { await act({ action: "like", fileId: hero.file_id }); await onRefresh(); } setBar("keep"); } finally { setBusy(false); }
  }
  async function tapDown() {
    if (!hero) return; setHeroId(hero.id); setBusy(true);
    try { await act({ action: "pass", fileId: hero.file_id }); await onRefresh(); setBar("pass"); } finally { setBusy(false); }
  }
  async function bankIt() { if (!hero) return; setBusy(true); try { await act({ action: "bank", fileId: hero.file_id }); closeBar(); await onRefresh(); } finally { setBusy(false); } }
  async function sendOrder() {
    if (!hero || !obBlank.trim() || !(parseInt(obQty, 10) > 0)) return; setBusy(true);
    try { await act({ action: "order", fileId: hero.file_id, blank: obBlank.trim(), qty: parseInt(obQty, 10), note: obNote.trim() || null }); closeBar(); await onRefresh(); } finally { setBusy(false); }
  }
  async function sendPassNote() {
    if (!chNote.trim()) { closeBar(); return; } setBusy(true);
    try { const fd = new FormData(); fd.set("body", chNote.trim()); await fetch(`/api/portal/client/${token}/studio/${b.id}/action`, { method: "POST", body: fd }); closeBar(); await onRefresh(); } finally { setBusy(false); }
  }
  async function shelveIt() { setBusy(true); try { await act({ action: "shelve" }); closeBar(); await onRefresh(); } finally { setBusy(false); } }
  const [reopenForm, setReopenForm] = useState(false);
  const [roNote, setRoNote] = useState("");
  async function reopenIt() {
    if (!roNote.trim()) return; setBusy(true);
    try { await act({ action: "reopen", note: roNote.trim() }); setReopenForm(false); setRoNote(""); await onRefresh(); } finally { setBusy(false); }
  }
  async function killIt() { setBusy(true); try { await act({ action: "kill" }); closeBar(); await onRefresh(); } finally { setBusy(false); } }
  async function reply(file?: File) {
    if (!note.trim() && !file) return; setBusy(true);
    try { const fd = new FormData(); if (note.trim()) fd.set("body", note.trim()); if (file) fd.set("file", file); await fetch(`/api/portal/client/${token}/studio/${b.id}/action`, { method: "POST", body: fd }); setNote(""); setHeroId(null); await onRefresh(); } finally { setBusy(false); }
  }
  // Staged attachments: 📎 only STAGES (typing is never interrupted); Send
  // ships note + files together — one request per file so each stays small,
  // the note riding the first. Progress shows on the button and every exit
  // path locks until the batch lands (onLock → backdrop/chevrons/keys hold).
  const [pending, setPending] = useState<{ f: File; url: string }[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  function stage(list: FileList | null) {
    if (!list || !list.length) return;
    // Snapshot before setState — the input resets right after this call and
    // input.files is live, so a deferred Array.from saw an empty list.
    const picked = sizeGate(Array.from(list)).map(f => ({ f, url: URL.createObjectURL(f) }));
    if (picked.length) setPending(prev => [...prev, ...picked]);
  }
  async function sendAll() {
    if (!note.trim() && !pending.length) return;
    setBusy(true); onLock?.(true);
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    try {
      const total = Math.max(1, pending.length);
      setProgress({ done: 0, total: pending.length });
      if (!pending.length) { await postOne(note.trim(), null); }
      else for (let i = 0; i < pending.length; i++) {
        await postOne(i === 0 ? note.trim() : "", pending[i].f);
        setProgress({ done: i + 1, total });
      }
      for (const x of pending) URL.revokeObjectURL(x.url);
      setPending([]); setNote(""); setHeroId(null);
      await onRefresh();
    } catch (e: any) {
      // Note + un-sent photos stay staged so nothing is lost.
      alert(e?.message || "That didn't send — try again.");
    } finally { window.removeEventListener("beforeunload", guard); setProgress(null); setBusy(false); onLock?.(false); }
  }
  async function postOne(body: string, file: File | null) {
    const fd = new FormData();
    if (body) fd.set("body", body);
    if (file) fd.set("file", file);
    const res = await fetch(`/api/portal/client/${token}/studio/${b.id}/action`, { method: "POST", body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error((j as any)?.error || (res.status === 413 ? `That photo is too big to send${file ? ` (${file.name})` : ""} — 4MB max.` : "That didn't send — try again."));
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "16px 20px 4px" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, margin: 0 }}>{b.title}</h1>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: st.color, marginTop: 4 }}>{st.label}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {nav && nav.total > 1 && (
            <>
              <button onClick={nav.onPrev} disabled={nav.idx <= 0} aria-label="Previous design" style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 999, width: 30, height: 30, color: nav.idx <= 0 ? C.faint : C.text, fontSize: 15, cursor: nav.idx <= 0 ? "default" : "pointer", lineHeight: 1, opacity: nav.idx <= 0 ? 0.4 : 1, fontFamily: C.font }}>‹</button>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: C.faint, padding: "0 3px", whiteSpace: "nowrap" }}>{nav.idx + 1} of {nav.total}</span>
              <button onClick={nav.onNext} disabled={nav.idx >= nav.total - 1} aria-label="Next design" style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 999, width: 30, height: 30, color: nav.idx >= nav.total - 1 ? C.faint : C.text, fontSize: 15, cursor: nav.idx >= nav.total - 1 ? "default" : "pointer", lineHeight: 1, opacity: nav.idx >= nav.total - 1 ? 0.4 : 1, fontFamily: C.font }}>›</button>
            </>
          )}
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.dim, fontSize: 26, cursor: "pointer", lineHeight: 1, marginLeft: 6 }}>×</button>
        </div>
      </div>

      {b.concept && <div style={{ margin: "6px 20px 0", fontSize: 12.5, color: C.dim, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{b.concept}</div>}

      {/* ── THE LINEUP BALLOT — tap the ones you like, send as a batch ── */}
      {lineup && (
        <div style={{ padding: "12px 20px 0" }}>
          {ballotLive ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.03em", textTransform: "uppercase", color: C.amber }}>◆ Your move · tap the ones you like</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 3, lineHeight: 1.45 }}>Pick as many as you want, then send them over in one go.</div>
            </>
          ) : (
            <div style={{ background: "rgba(88,201,60,.08)", border: `1px solid rgba(88,201,60,.35)`, borderRadius: 14, padding: "12px 15px", fontSize: 12.5, color: C.dim }}>
              <b style={{ color: C.green }}>✓ Picks are in</b> — {[...(lineup.options || [])].filter((o: any) => o.picked).sort((a: any, z: any) => a.position - z.position).map((o: any) => String(o.position).padStart(2, "0")).join(", ")}. We&rsquo;re on it.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginTop: 12 }}>
            {[...(lineup.options || [])].sort((a: any, z: any) => a.position - z.position).map((o: any) => {
              const on = ballotLive ? !!picks[o.id] : o.picked;
              return (
                <button key={o.id} disabled={!ballotLive} onClick={() => ballotLive && setPicks(m => ({ ...m, [o.id]: !m[o.id] }))}
                  style={{ position: "relative", padding: 0, background: "#fff", border: on ? `3px solid ${C.green}` : `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden", cursor: ballotLive ? "pointer" : "default", opacity: !ballotLive && !o.picked ? 0.45 : 1, fontFamily: C.font }}>
                  <img src={o.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                  <span style={{ position: "absolute", top: 6, left: 6, background: "rgba(10,10,10,.85)", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 900, letterSpacing: "0.06em" }}>{String(o.position).padStart(2, "0")}</span>
                  {on && <span style={{ position: "absolute", top: 6, right: 6, background: C.green, color: "#08210a", borderRadius: 999, width: 22, height: 22, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 900 }}>✓</span>}
                  {o.label && <span style={{ display: "block", padding: "6px 8px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "#333", background: "#fff", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>}
                </button>
              );
            })}
          </div>
          {ballotLive && (
            <div style={{ marginTop: 12 }}>
              <textarea value={pickNote} onChange={e => setPickNote(e.target.value)} rows={2} placeholder="Anything to add? e.g. 11 but in cream" style={{ ...inp, resize: "vertical" }} />
              <div style={{ display: "flex", marginTop: 9 }}>
                <button disabled={busy || !pickCount} onClick={sendPicks} style={{ ...primaryBtn, marginLeft: "auto", background: C.green, color: "#08210a", opacity: busy || !pickCount ? 0.5 : 1 }}>{pickCount ? `Send ${pickCount} pick${pickCount === 1 ? "" : "s"} →` : "Tap to pick"}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!ballotLive && hero && (
        <div style={{ marginTop: 12 }}>
          <div style={{ background: "#fff", position: "relative", minHeight: 150 }}>
            <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#999", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", padding: 20, textAlign: "center" }}>Preview coming</span>
            <img src={hero.file_url} alt="" referrerPolicy="no-referrer" style={{ position: "relative", width: "100%", maxHeight: "40vh", objectFit: "contain", display: "block", margin: "0 auto", background: "#fff", filter: hero.reaction === "down" ? "grayscale(55%)" : "none" }} onError={(e: any) => { e.target.style.display = "none"; }} />
            <span style={{ position: "absolute", right: 10, bottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
              {hero.reaction === "up" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#3c9a2e", background: "rgba(255,255,255,0.85)", borderRadius: 999, padding: "3px 9px" }}><ThumbIcon size={10} color="#3c9a2e" strokeWidth={2.5} /> You liked this</span>}
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: hero.reaction === "down" ? "#b3455a" : "#999", background: "rgba(255,255,255,0.85)", borderRadius: 999, padding: "3px 9px" }}>{hero.reaction === "down" ? "You passed on this" : hero.id === live[live.length - 1]?.id ? "Latest" : fmt(hero.created_at)}</span>
            </span>
          </div>
          {(live.length > 1 || passed.length > 0) && (
            <div style={{ display: "flex", gap: 8, padding: "10px 20px 0", overflowX: "auto", alignItems: "center" }}>
              {live.map(f => (
                <button key={f.id} onClick={() => setHeroId(f.id)} style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 9, overflow: "hidden", background: "#fff", border: f.id === hero.id ? "2px solid #fff" : `1px solid ${C.line}`, padding: 0, cursor: "pointer", opacity: f.id === hero.id ? 1 : 0.65, position: "relative" }}>
                  <img src={f.file_url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                  {f.reaction === "up" && <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(255,255,255,.92)", borderRadius: 4, padding: 2, display: "grid", placeItems: "center" }}><ThumbIcon size={9} color="#3c9a2e" strokeWidth={2.5} /></span>}
                </button>
              ))}
              {passed.length > 0 && <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, marginLeft: 6 }}>Passed on</span>}
              {passed.map(f => (
                <button key={f.id} onClick={() => setHeroId(f.id)} style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 8, overflow: "hidden", background: "#fff", border: f.id === hero.id ? "2px solid #fff" : `1px solid ${C.line2}`, padding: 0, cursor: "pointer", opacity: f.id === hero.id ? 0.9 : 0.4, position: "relative" }}>
                  <img src={f.file_url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(70%)" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                  <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(255,255,255,.92)", borderRadius: 4, padding: 2, display: "grid", placeItems: "center" }}><ThumbIcon down size={9} color="#b3455a" strokeWidth={2.5} /></span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "16px 20px 0" }}>
        {!ballotLive && (heroReactable || bar === "order") && hero && (
          <div style={{ background: hero.reaction === "down" ? "transparent" : "linear-gradient(180deg,rgba(244,178,43,.07),transparent)", border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", marginBottom: 4 }}>
            {bar === "idle" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button disabled={busy} onClick={tapUp} aria-label="Thumbs up" style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 999, background: "rgba(88,201,60,.14)", border: "1px solid rgba(88,201,60,.45)", display: "grid", placeItems: "center", cursor: "pointer", fontFamily: C.font }}><ThumbIcon size={22} color={C.green} /></button>
                {hero.reaction !== "down" && (
                  <button disabled={busy} onClick={tapDown} aria-label="Thumbs down" style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 999, background: C.surface, border: `1px solid ${C.line}`, display: "grid", placeItems: "center", cursor: "pointer", fontFamily: C.font }}><ThumbIcon down size={22} color={C.dim} /></button>
                )}
                <div style={{ minWidth: 0 }}>
                  {b.state === "with_client" && hero.reaction !== "down" && <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.03em", textTransform: "uppercase", color: C.amber }}>◆ Your move</div>}
                  <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.45, marginTop: b.state === "with_client" && hero.reaction !== "down" ? 3 : 0 }}>
                    {hero.reaction === "down" ? "You passed on this one. Thumbs up if it grows on you." : "Thumbs up to keep it. Thumbs down to pass."}
                  </div>
                </div>
              </div>
            )}
            {bar === "keep" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 900, letterSpacing: "0.02em", textTransform: "uppercase", color: C.green }}><ThumbIcon size={14} color={C.green} strokeWidth={2.5} /> Kept. What&rsquo;s the move?</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button disabled={busy} onClick={() => setBar("order")} style={{ flex: 1, minWidth: 140, background: C.green, color: "#08210a", border: "none", borderRadius: 999, padding: "13px", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>Order it →</button>
                  <button disabled={busy} onClick={bankIt} style={{ ...ghostBtn, flex: 1, minWidth: 140, padding: "13px 16px", borderColor: "rgba(88,201,60,.45)", color: C.green }}>Keep it in the bank</button>
                </div>
                <button disabled={busy} onClick={closeBar} style={{ ...ghostBtn, border: "none", color: C.faint, marginTop: 8, padding: "8px 0" }}>Just the like for now</button>
              </div>
            )}
            {bar === "order" && (
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: "0.02em", textTransform: "uppercase", color: C.green }}>Order it. Two quick things.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <input value={obBlank} onChange={e => setObBlank(e.target.value)} placeholder="What garment? e.g. black hoodie" style={{ ...inp, flex: 2, minWidth: 160 }} />
                  <input value={obQty} onChange={e => setObQty(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="How many" style={{ ...inp, flex: 1, minWidth: 90 }} />
                </div>
                <textarea value={obNote} onChange={e => setObNote(e.target.value)} rows={2} placeholder="Anything else? Sizes, timing, whatever helps." style={{ ...inp, resize: "vertical", marginTop: 8 }} />
                <div style={{ fontSize: 11, color: C.faint, marginTop: 7, lineHeight: 1.5 }}>This sends the ask. We price it and a quote comes back to you before anything is made.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button disabled={busy} onClick={() => setBar(heroReactable ? "keep" : "idle")} style={{ ...ghostBtn, border: "none", color: C.faint }}>Back</button>
                  <button disabled={busy || !obBlank.trim() || !(parseInt(obQty, 10) > 0)} onClick={sendOrder} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || !obBlank.trim() || !(parseInt(obQty, 10) > 0) ? 0.5 : 1 }}>Send the request →</button>
                </div>
              </div>
            )}
            {bar === "pass" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 900, letterSpacing: "0.02em", textTransform: "uppercase", color: C.text }}><ThumbIcon down size={14} color={C.text} strokeWidth={2.5} /> Passed. Anything specific?</div>
                <textarea value={chNote} onChange={e => setChNote(e.target.value)} rows={2} placeholder="Totally optional. What would you like different?" style={{ ...inp, resize: "vertical", marginTop: 10 }} />
                <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap", alignItems: "center" }}>
                  <button disabled={busy} onClick={closeBar} style={{ ...ghostBtn, border: "none", color: C.faint }}>That&rsquo;s all</button>
                  <button disabled={busy || !chNote.trim()} onClick={sendPassNote} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || !chNote.trim() ? 0.5 : 1 }}>Send it back</button>
                </div>
                <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, paddingTop: 11, borderTop: `1px dashed ${C.line2}` }}>
                  <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>The whole idea</span>
                  <button disabled={busy} onClick={shelveIt} style={{ background: "none", border: "none", color: C.blue, fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font, padding: 0 }}>Shelve for later</button>
                  <button disabled={busy} onClick={() => (killArm ? killIt() : setKillArm(true))} style={{ background: "none", border: "none", color: C.red, fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font, padding: 0 }}>{killArm ? "Tap again to end it" : "Kill it"}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {b.state === "approved" && (
          <div style={{ background: "rgba(88,201,60,.08)", border: `1px solid rgba(88,201,60,.35)`, borderRadius: 16, padding: "16px 18px", fontSize: 13, color: C.dim }}>
            <b style={{ color: C.green }}>✓ In the bank.</b>{" "}
            {orderReq?.open
              ? <>Your order request is in{orderReq.blank ? <> ({orderReq.blank}{orderReq.qty ? ` × ${orderReq.qty}` : ""})</> : null}. We&rsquo;re pricing it and a quote is coming back to you.</>
              : <>The artwork&rsquo;s locked. Order it whenever you&rsquo;re ready.</>}
            {!orderReq?.open && bar !== "order" && !reopenForm && (
              <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button disabled={busy} onClick={() => setBar("order")} style={{ background: C.green, color: "#08210a", border: "none", borderRadius: 999, padding: "11px 20px", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>Order this</button>
                <button disabled={busy} onClick={() => setReopenForm(true)} style={{ background: "none", border: "none", color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font, padding: 0 }}>Request a change</button>
              </div>
            )}
            {reopenForm && (
              <div style={{ marginTop: 12, border: `1px dashed rgba(255,255,255,.22)`, borderRadius: 12, padding: 13 }}>
                <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>What should change? It comes back to us and we get on it.</div>
                <textarea value={roNote} onChange={e => setRoNote(e.target.value)} autoFocus rows={2} placeholder="e.g. move the print up, try a darker tan" style={{ ...inp, resize: "vertical" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button disabled={busy} onClick={() => { setReopenForm(false); setRoNote(""); }} style={{ ...ghostBtn, border: "none", color: C.faint }}>Never mind</button>
                  <button disabled={busy || !roNote.trim()} onClick={reopenIt} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || !roNote.trim() ? 0.5 : 1 }}>Send it back</button>
                </div>
              </div>
            )}
          </div>
        )}
        {b.state === "working" && bar === "idle" && <div style={{ fontSize: 12.5, color: C.dim, textAlign: "center" }}>We&rsquo;re on it. You&rsquo;ll get a note here the moment it&rsquo;s ready for you.</div>}
      </div>

      <div style={{ padding: "14px 20px 4px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "34vh", overflowY: "auto" }}>
        {notes.length === 0 ? (
          <div style={{ color: C.faint, fontSize: 12.5, padding: "6px 0" }}>No notes yet. Say the first thing.</div>
        ) : notes.map((m: any) => {
          const you = m.sender_role === "client";
          const sys = String(m.body || "").startsWith("✓") ? C.green : String(m.body || "").startsWith("✕") ? C.red : null;
          if (sys && b.state === "approved" && /approved|banked/i.test(String(m.body))) return null;
          if (sys) return <div key={m.id} style={{ alignSelf: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: sys }}>{m.body}</div>;
          return (
            <div key={m.id} style={{ alignSelf: you ? "flex-end" : "flex-start", maxWidth: "84%", background: you ? "#fff" : C.surface, color: you ? C.bg : C.text, borderRadius: you ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              <span style={{ display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: you ? "rgba(10,10,10,0.45)" : C.faint, marginBottom: 3 }}>{you ? "You" : "House Party Distro"} · {fmt(m.created_at)}</span>
              {m.body}
            </div>
          );
        })}
      </div>

      {b.state !== "approved" && b.state !== "killed" && (
        <div style={{ padding: "12px 20px 20px" }}>
          {pending.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {pending.map((x, i) => (
                <span key={i} style={{ display: "inline-flex", position: "relative", opacity: busy && progress && i < progress.done ? 0.35 : 1 }}>
                  <img src={x.url} alt="" style={{ height: 52, borderRadius: 8, background: "#fff" }} />
                  {!busy && <button onClick={() => { URL.revokeObjectURL(x.url); setPending(prev => prev.filter((_, j) => j !== i)); }} aria-label="Remove photo" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 999, background: "#fff", color: C.bg, border: "none", fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* Multi-line like any messenger: Enter = newline, send is the
                button only (deliberate). Grows with content, caps + scrolls. */}
            <textarea value={note} onChange={e => setNote(e.target.value)} disabled={busy} placeholder="Reply…" rows={1}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 132) + "px"; }}
              style={{ ...inp, flex: 1, minWidth: 140, opacity: busy ? 0.6 : 1, resize: "none", overflowY: "auto", maxHeight: 132, lineHeight: 1.45 }} />
            <input ref={fileIn} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { stage(e.target.files); if (fileIn.current) fileIn.current.value = ""; }} />
            <button disabled={busy} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: busy ? 0.5 : 1 }}>{pending.length ? `📎 ${pending.length}` : "📎"}</button>
            <button disabled={busy || (!note.trim() && !pending.length)} onClick={sendAll} style={{ ...primaryBtn, opacity: busy || (!note.trim() && !pending.length) ? 0.5 : 1, minWidth: 92 }}>
              {busy && progress && progress.total > 0 ? `Sending ${Math.min(progress.done + 1, progress.total)}/${progress.total}…` : busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ShareForm({ token, onClose, onDone }: any) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [files, setFiles] = useState<{ f: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const fileIn = useRef<HTMLInputElement | null>(null);
  function pick(list: FileList | null) {
    if (!list || !list.length) return;
    // Snapshot before setState — see stage() above.
    const picked = sizeGate(Array.from(list)).map(f => ({ f, url: URL.createObjectURL(f) }));
    if (picked.length) setFiles(prev => [...prev, ...picked]);
  }
  async function go() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/portal/client/${token}/briefs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), concept: body.trim() || null }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn't share that");
      const bid = j.brief?.id || null;
      // Photos ride in one-per-request through the same client-upload path
      // as replies — each becomes its own entry on the new design.
      if (bid) for (const { f } of files) {
        const fd = new FormData(); fd.set("file", f);
        await fetch(`/api/portal/client/${token}/studio/${bid}/action`, { method: "POST", body: fd });
      }
      for (const { url } of files) URL.revokeObjectURL(url);
      onDone(bid);
    } catch (e: any) { alert(e.message); setBusy(false); }
  }
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 18px", maxWidth: 520, margin: "0 auto 26px" }}>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Calling it something…" style={{ ...inp, fontSize: 16, fontWeight: 800, border: "none", borderBottom: `1px solid ${C.line}`, borderRadius: 0, padding: "6px 0" }} />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="What's the vibe? references, garment, timing — anything." style={{ ...inp, border: "none", padding: "10px 0", resize: "vertical" }} />
      {files.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {files.map((x, i) => (
            <span key={i} style={{ display: "inline-flex", position: "relative" }}>
              <img src={x.url} alt="" style={{ height: 56, borderRadius: 8, background: "#fff" }} />
              <button onClick={() => { URL.revokeObjectURL(x.url); setFiles(prev => prev.filter((_, j) => j !== i)); }} aria-label="Remove photo" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 999, background: "#fff", color: C.bg, border: "none", fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input ref={fileIn} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { pick(e.target.files); if (fileIn.current) fileIn.current.value = ""; }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={() => fileIn.current?.click()} style={ghostBtn}>{files.length ? `✓ ${files.length} photo${files.length === 1 ? "" : "s"}` : "+ Photos"}</button>
        <button onClick={onClose} style={{ ...ghostBtn, border: "none", color: C.faint }}>Not now</button>
        <button disabled={busy || !title.trim()} onClick={go} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || !title.trim() ? 0.5 : 1 }}>{busy ? "Sending…" : "Send it"}</button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const ghostBtn: React.CSSProperties = { background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 999, padding: "10px 14px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, color: C.text, fontSize: 13, padding: "9px 11px", outline: "none", fontFamily: C.font };
