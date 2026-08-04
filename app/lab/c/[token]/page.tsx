"use client";
import { useEffect, useRef, useState } from "react";
import ThumbIcon from "@/components/ThumbIcon";

// THE LAB · CLIENT HUB (magic link). Built to look like the real client portal
// studio: a magazine feed of ideas → a bottom-SHEET modal (slides up on mobile,
// centers on desktop — same chrome the real hub uses, so the team learns it).
// Share an idea, watch it come together, and — when it's your move — approve
// the DESIGN (locks the art) or send it back with a photo. Client-visible only.
const C = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", purple: "#fd3aa3", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const STATE = (s: string) => s === "with_client" ? { label: "Your move", color: C.amber } : s === "approved" ? { label: "In the bank", color: C.green } : s === "shelved" ? { label: "Shelved", color: C.faint } : s === "killed" ? { label: "Closed", color: C.red } : { label: "In the works", color: C.blue };
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const fmtDay = (iso?: string) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

async function uploadImage(file: File): Promise<{ url: string; name: string }> {
  const s = await fetch("/api/lab/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type }) });
  const j = await s.json(); if (!s.ok) throw new Error(j.error || "Upload failed");
  const put = await fetch(j.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" } });
  if (!put.ok) throw new Error("Upload failed");
  return { url: j.publicUrl, name: file.name };
}

export default function LabClient({ params }: { params: { token: string } }) {
  const token = params.token;
  const [client, setClient] = useState<any>(null);
  const [threads, setThreads] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [share, setShare] = useState(false);
  const [bad, setBad] = useState(false);

  async function loadList() {
    const j = await fetch(`/api/lab/threads?clientToken=${token}`).then(r => r.json());
    if (j.error) { setBad(true); return; }
    setClient(j.client); setThreads(j.threads || []);
  }
  async function loadDetail(id: string) { const d = await fetch(`/api/lab/threads/${id}?clientToken=${token}`).then(r => r.json()); setDetail(d); }
  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [token]);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); /* eslint-disable-next-line */ }, [openId]);
  const refresh = async () => { await loadList(); if (openId) await loadDetail(openId); };

  if (bad) return <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", color: C.red, fontSize: 14 }}>This link isn&rsquo;t valid.</div>;
  if (!client) return <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>Opening your studio…</div>;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "34px 20px 80px" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .lc-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px 12px}
        @media(min-width:600px){.lc-grid{grid-template-columns:repeat(3,1fr)}}
        .lc-card{transition:transform .15s ease,border-color .15s ease}
        .lc-card:hover{transform:translateY(-3px)}
        .lc-back{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto}
        .lc-sheet{background:${C.panel};border:1px solid ${C.line};border-radius:20px;max-width:620px;width:100%;overflow:hidden}
        .lc-handle{display:none}
        @media(max-width:640px){
          .lc-back{align-items:flex-end;padding:0;overflow-y:hidden}
          .lc-sheet{border-radius:18px 18px 0 0;border-bottom:none;max-height:92dvh;overflow-y:auto;animation:lcUp .3s cubic-bezier(.32,.72,0,1)}
          .lc-handle{display:block;width:38px;height:4px;border-radius:999px;background:rgba(255,255,255,0.25);margin:10px auto 0}
        }
        @keyframes lcUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @media(prefers-reduced-motion:reduce){.lc-card,.lc-card:hover{transition:none;transform:none}.lc-sheet{animation:none}}
      ` }} />

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>Your studio</div>
        <h1 style={{ fontSize: "clamp(30px,6.5vw,54px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 18px" }}>{client.name}.</h1>
      </div>

      {share ? <ShareForm token={token} onClose={() => setShare(false)} onDone={async (id: string) => { setShare(false); await loadList(); setOpenId(id); }} />
        : <div style={{ textAlign: "center", marginBottom: 30 }}><button onClick={() => setShare(true)} style={{ ...primaryBtn, padding: "13px 26px", fontSize: 12 }}>Share something →</button></div>}

      {threads.length === 0 && !share && <div style={{ color: C.dim, fontSize: 13.5, textAlign: "center" }}>Nothing here yet. Share an idea to get started.</div>}
      {[{ k: "with_client", t: "Your move.", c: C.amber }, { k: "working", t: "In the works.", c: C.blue }, { k: "approved", t: "The bank.", c: C.green }].map(bk => {
        const list = threads.filter(t => t.state === bk.k);
        if (!list.length) return null;
        return (
          <div key={bk.k} style={{ marginTop: 26 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: bk.c }}>{bk.t}</h2>
            <div className="lc-grid">
              {list.map(t => (
                <button key={t.id} className="lc-card" onClick={() => setOpenId(t.id)} style={{ textAlign: "left", padding: 0, background: C.panel, border: `1px solid ${t.state === "with_client" ? "rgba(244,178,43,.5)" : C.line}`, borderRadius: 14, overflow: "hidden", cursor: "pointer", fontFamily: C.font, color: C.text, display: "block", width: "100%" }}>
                  <div style={{ aspectRatio: "1", background: t._art ? "#fff" : C.surface, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
                    {t._art ? <img src={t._art} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                      : <span style={{ padding: 12, fontSize: 14, fontWeight: 900, textTransform: "uppercase", color: C.dim, lineHeight: 1.15 }}>{t.title}</span>}
                  </div>
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.2 }}>{t.title}</div>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: STATE(t.state).color, marginTop: 4 }}>{STATE(t.state).label}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {detail && <ClientThreadSheet key={detail.thread.id} detail={detail} token={token} onClose={() => setOpenId(null)} onRefresh={refresh} />}
    </div>
  );
}

// The idea's sheet — mirrors the real portal's BriefSheet: latest art big + an
// evolution filmstrip, the exchange as chat bubbles, and (when it's their move)
// approve-the-design / request-a-change. A bottom sheet on mobile, centered on
// desktop. × is the only exit — a backdrop tap mid-notes reads as data loss.
function ClientThreadSheet({ detail, token, onClose, onRefresh }: any) {
  const t = detail.thread; const msgs: any[] = detail.messages || [];
  const st = STATE(t.state);
  const orderReq = detail.orderRequest;
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  // The reaction card under the hero. The thumb acts INSTANTLY (like / pass);
  // the sheet that opens carries the heavier moves: keep → order|bank,
  // pass → note + the two quiet idea-level exits (shelve, kill).
  const [bar, setBar] = useState<"idle" | "keep" | "order" | "pass">("idle");
  const [killArm, setKillArm] = useState(false);
  const [chNote, setChNote] = useState(""); const [chFile, setChFile] = useState<{ url: string; name: string } | null>(null);
  const [obBlank, setObBlank] = useState(""); const [obQty, setObQty] = useState(""); const [obNote, setObNote] = useState("");
  const [heroId, setHeroId] = useState<string | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null); const chIn = useRef<HTMLInputElement | null>(null);

  // Live designs carry the filmstrip; passed-on ones (thumbs down) tuck into a
  // dimmed strip of their own. The hero can be either — a thumbs up on a passed
  // design brings it back.
  const images = msgs.filter(m => m.file_url);
  const live = images.filter(m => m.reaction !== "down");
  const passed = images.filter(m => m.reaction === "down");
  const hero = images.find(m => m.id === heroId) || (live.length ? live[live.length - 1] : images[images.length - 1] || null);
  const notes = msgs.filter(m => m.body && m.body.trim());
  // The client only ever sees client-visible messages, so any image here from HPD
  // is a design WE sent — the thing they can react to.
  const hpdDesign = images.some(m => m.sender_role === "hpd");
  const ended = t.state === "approved" || t.state === "shelved" || t.state === "killed";
  const heroReactable = !!hero && hero.sender_role === "hpd" && !ended;

  function closeBar() { setBar("idle"); setKillArm(false); setChNote(""); setChFile(null); setObBlank(""); setObQty(""); setObNote(""); setHeroId(null); }
  async function act(body: any) {
    await fetch(`/api/lab/threads/${t.id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientToken: token, ...body }) });
  }
  async function reply(fileUrl?: string, fileName?: string) {
    if (!note.trim() && !fileUrl) return; setBusy(true);
    try { await fetch(`/api/lab/threads/${t.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientToken: token, body: note.trim() || null, fileUrl, fileName }) }); setNote(""); setHeroId(null); await onRefresh(); } finally { setBusy(false); }
  }
  async function onReplyFile(f: File) { setUploading(true); try { const u = await uploadImage(f); await reply(u.url, u.name); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }
  // 👍 — the like lands instantly (no ball move), then the sheet offers the doors.
  async function tapUp() {
    if (!hero) return; setHeroId(hero.id); setBusy(true);
    try { if (hero.reaction !== "up") { await act({ action: "like", messageId: hero.id }); await onRefresh(); } setBar("keep"); } finally { setBusy(false); }
  }
  // 👎 — the pass lands instantly (version dims, ball back to us), then the sheet.
  async function tapDown() {
    if (!hero) return; setHeroId(hero.id); setBusy(true);
    try { await act({ action: "request_changes", messageId: hero.id }); await onRefresh(); setBar("pass"); } finally { setBusy(false); }
  }
  async function bankIt() { if (!hero) return; setBusy(true); try { await act({ action: "approve", messageId: hero.id }); closeBar(); await onRefresh(); } finally { setBusy(false); } }
  async function sendOrder() {
    if (!hero || !obBlank.trim() || !(parseInt(obQty, 10) > 0)) return; setBusy(true);
    try { await act({ action: "order", messageId: hero.id, blank: obBlank.trim(), qty: parseInt(obQty, 10), note: obNote.trim() || null }); closeBar(); await onRefresh(); } finally { setBusy(false); }
  }
  // The note after a pass is just a reply — the pass itself already landed.
  async function sendPassNote() {
    if (!chNote.trim() && !chFile) { closeBar(); return; } setBusy(true);
    try { await fetch(`/api/lab/threads/${t.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientToken: token, body: chNote.trim() || null, fileUrl: chFile?.url || null, fileName: chFile?.name || null }) }); closeBar(); await onRefresh(); } finally { setBusy(false); }
  }
  async function shelveIt() { setBusy(true); try { await act({ action: "shelve" }); closeBar(); await onRefresh(); } finally { setBusy(false); } }
  async function killIt() { setBusy(true); try { await act({ action: "kill" }); closeBar(); await onRefresh(); } finally { setBusy(false); } }
  async function onChFile(f: File) { setUploading(true); try { setChFile(await uploadImage(f)); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }

  return (
    <div className="lc-back">
      <div className="lc-sheet">
        <div className="lc-handle" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "16px 20px 4px" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, margin: 0 }}>{t.title}</h1>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: st.color, marginTop: 4 }}>{st.label}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.dim, fontSize: 26, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* latest drop big + evolution filmstrip + the passed-on strip */}
        {hero && (
          <div style={{ marginTop: 12 }}>
            <div style={{ background: "#fff", position: "relative" }}>
              <img src={hero.file_url} alt="" style={{ width: "100%", maxHeight: "40vh", objectFit: "contain", display: "block", margin: "0 auto", filter: hero.reaction === "down" ? "grayscale(55%)" : "none" }} onError={(e: any) => { e.target.parentElement.style.display = "none"; }} />
              <span style={{ position: "absolute", right: 10, bottom: 8, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: hero.reaction === "down" ? "#b3455a" : "#999", background: "rgba(255,255,255,0.85)", borderRadius: 999, padding: "3px 9px" }}>{hero.reaction === "down" ? "You passed on this" : hero.id === live[live.length - 1]?.id ? "Latest" : fmtDay(hero.created_at)}</span>
            </div>
            {(live.length > 1 || (live.length > 0 && hero.reaction === "down")) && (
              <div style={{ display: "flex", gap: 8, padding: "10px 20px 0", overflowX: "auto", scrollbarWidth: "none" as any }}>
                {live.map(im => {
                  const active = im.id === hero.id;
                  return (
                    <button key={im.id} onClick={() => setHeroId(im.id)} style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${C.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.65 }}>
                      <img src={im.file_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                    </button>
                  );
                })}
              </div>
            )}
            {passed.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px 0", overflowX: "auto", scrollbarWidth: "none" as any }}>
                <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>Passed on</span>
                {passed.map(im => {
                  const active = im.id === hero.id;
                  return (
                    <button key={im.id} onClick={() => setHeroId(im.id)} style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 8, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${C.line2}`, padding: 0, cursor: "pointer", opacity: active ? 0.9 : 0.4, position: "relative" }}>
                      <img src={im.file_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(70%)" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                      <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(255,255,255,.92)", borderRadius: 4, padding: 2, display: "grid", placeItems: "center" }}><ThumbIcon down size={9} color="#b3455a" strokeWidth={2.5} /></span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* the reaction card — thumbs act instantly; the sheet holds the doors */}
        <div style={{ padding: "16px 20px 0" }}>
          {(heroReactable || bar === "order") && hero && (
            <div style={{ background: hero.reaction === "down" ? "transparent" : "linear-gradient(180deg,rgba(244,178,43,.07),transparent)", border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", marginBottom: 4 }}>
              {bar === "idle" && (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button disabled={busy} onClick={tapUp} aria-label="Thumbs up" style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 999, background: "rgba(88,201,60,.14)", border: "1px solid rgba(88,201,60,.45)", display: "grid", placeItems: "center", cursor: "pointer", fontFamily: C.font }}><ThumbIcon size={22} color={C.green} /></button>
                  {hero.reaction !== "down" && (
                    <button disabled={busy} onClick={tapDown} aria-label="Thumbs down" style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 999, background: C.surface, border: `1px solid ${C.line}`, display: "grid", placeItems: "center", cursor: "pointer", fontFamily: C.font }}><ThumbIcon down size={22} color={C.dim} /></button>
                  )}
                  <div style={{ minWidth: 0 }}>
                    {t.state === "with_client" && hero.reaction !== "down" && <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.03em", textTransform: "uppercase", color: C.amber }}>◆ Your move</div>}
                    <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.45, marginTop: t.state === "with_client" && hero.reaction !== "down" ? 3 : 0 }}>
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
                  {chFile && <div style={{ marginTop: 8 }}><img src={chFile.url} alt="" style={{ maxHeight: 70, borderRadius: 8, background: "#fff", border: `1px solid ${C.line}` }} /></div>}
                  <input ref={chIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onChFile(f); if (chIn.current) chIn.current.value = ""; }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap", alignItems: "center" }}>
                    <button disabled={uploading} onClick={() => chIn.current?.click()} style={{ ...ghostBtn, color: C.blue, borderColor: "rgba(143,199,216,.4)" }}>{uploading ? "Uploading…" : "📎 Show us what you mean"}</button>
                    <button disabled={busy} onClick={closeBar} style={{ ...ghostBtn, border: "none", color: C.faint }}>That&rsquo;s all</button>
                    <button disabled={busy || uploading || (!chNote.trim() && !chFile)} onClick={sendPassNote} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || uploading || (!chNote.trim() && !chFile) ? 0.5 : 1 }}>Send it back</button>
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

          {t.state === "with_client" && !hpdDesign && <div style={{ fontSize: 12.5, color: C.amber, textAlign: "center", fontWeight: 700 }}>Your move. Reply below.</div>}
          {t.state === "approved" && (
            <div style={{ background: "rgba(88,201,60,.08)", border: `1px solid rgba(88,201,60,.35)`, borderRadius: 16, padding: "16px 18px", fontSize: 13, color: C.dim }}>
              <b style={{ color: C.green }}>✓ In the bank.</b>{" "}
              {orderReq && !orderReq.handled_at
                ? <>Your order request is in{orderReq.blank ? <> ({orderReq.blank}{orderReq.qty ? ` × ${orderReq.qty}` : ""})</> : null}. We&rsquo;re pricing it and a quote is coming back to you.</>
                : <>The artwork&rsquo;s locked. Order it whenever you&rsquo;re ready.</>}
              {(!orderReq || orderReq.handled_at) && bar !== "order" && (
                <div style={{ marginTop: 10 }}><button disabled={busy} onClick={() => setBar("order")} style={{ background: C.green, color: "#08210a", border: "none", borderRadius: 999, padding: "11px 20px", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>Order this</button></div>
              )}
            </div>
          )}
          {t.state === "shelved" && <div style={{ background: C.panel, border: `1px dashed ${C.line}`, borderRadius: 16, padding: "16px 18px", fontSize: 13, color: C.dim }}><b style={{ color: C.text }}>On the shelf.</b> Not now, not never. Say the word below and we pick it right back up.</div>}
          {t.state === "killed" && <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 18px", fontSize: 13, color: C.faint }}><b style={{ color: C.red }}>✕ Closed.</b> This one&rsquo;s done. If it ever comes back, it&rsquo;ll be a fresh start.</div>}
          {t.state === "working" && bar === "idle" && <div style={{ fontSize: 12.5, color: C.dim, textAlign: "center" }}>We&rsquo;re on it. You&rsquo;ll get a note here the moment it&rsquo;s ready for you.</div>}
        </div>

        {/* the exchange — notes as chat bubbles; images live in the strip above */}
        <div style={{ padding: "14px 20px 4px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "34vh", overflowY: "auto" }}>
          {notes.length === 0 ? (
            <div style={{ color: C.faint, fontSize: 12.5, padding: "6px 0" }}>No notes yet — say the first thing.</div>
          ) : notes.map((m: any) => {
            const you = m.sender_role === "client";
            const sys = String(m.body || "").startsWith("✓") ? C.green : String(m.body || "").startsWith("✕") ? C.red : null;
            if (sys) return <div key={m.id} style={{ alignSelf: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: sys }}>{m.body}</div>;
            return (
              <div key={m.id} style={{ alignSelf: you ? "flex-end" : "flex-start", maxWidth: "84%", background: you ? "#fff" : C.surface, color: you ? C.bg : C.text, borderRadius: you ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                <span style={{ display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: you ? "rgba(10,10,10,0.45)" : C.faint, marginBottom: 3 }}>{you ? "You" : "House Party Distro"} · {fmt(m.created_at)}</span>
                {m.body}
              </div>
            );
          })}
        </div>

        {/* reply — stays open on the shelf (a reply revives the thread), closed when killed */}
        {t.state !== "approved" && t.state !== "killed" && (
          <div style={{ padding: "12px 20px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reply…" style={{ ...inp, flex: 1, minWidth: 140 }} />
            <input ref={fileIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onReplyFile(f); if (fileIn.current) fileIn.current.value = ""; }} />
            <button disabled={uploading} onClick={() => fileIn.current?.click()} style={ghostBtn}>{uploading ? "…" : "📎"}</button>
            <button disabled={busy || !note.trim()} onClick={() => reply()} style={{ ...primaryBtn, opacity: busy || !note.trim() ? 0.5 : 1 }}>Send</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ShareForm({ token, onClose, onDone }: any) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const fileIn = useRef<HTMLInputElement | null>(null);
  async function pick(f: File) { setUploading(true); try { setFile(await uploadImage(f)); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }
  async function go() {
    if (!title.trim()) { alert("Give it a name."); return; }
    setBusy(true);
    try { const r = await fetch("/api/lab/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientToken: token, title: title.trim(), body: body.trim() || null, fileUrl: file?.url || null, fileName: file?.name || null }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); onDone(j.thread.id); } catch (e: any) { alert(e.message); setBusy(false); }
  }
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 18px", maxWidth: 520, margin: "0 auto 26px" }}>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Calling it something…" style={{ ...inp, fontSize: 16, fontWeight: 800, border: "none", borderBottom: `1px solid ${C.line}`, borderRadius: 0, padding: "6px 0" }} />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="What's the vibe? references, garment, timing — anything." style={{ ...inp, border: "none", padding: "10px 0", resize: "vertical" }} />
      {file && <div style={{ marginBottom: 8 }}><img src={file.url} alt="" style={{ maxHeight: 90, borderRadius: 8, background: "#fff", border: `1px solid ${C.line}` }} /></div>}
      <input ref={fileIn} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); if (fileIn.current) fileIn.current.value = ""; }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button disabled={uploading} onClick={() => fileIn.current?.click()} style={ghostBtn}>{uploading ? "Uploading…" : "+ Photo"}</button>
        <button onClick={onClose} style={{ ...ghostBtn, border: "none", color: C.faint }}>Not now</button>
        <button disabled={busy} onClick={go} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy ? 0.5 : 1 }}>{busy ? "Sending…" : "Send it"}</button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const ghostBtn: React.CSSProperties = { background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 999, padding: "10px 14px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, color: C.text, fontSize: 13, padding: "9px 11px", outline: "none", fontFamily: C.font };
