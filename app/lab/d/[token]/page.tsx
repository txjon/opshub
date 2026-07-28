"use client";
import { useEffect, useRef, useState } from "react";

// THE LAB · DESIGNER (Room 2, magic link). One work order: the design + brief we
// handed over — with NO client identity (the wall) — and a simple deliver/reply
// thread. Mirrors the client side; the designer works for House Party Distro.
const C = { bg: "#0a0a0a", panel: "#131313", surface: "#1e1e1e", line: "rgba(255,255,255,.13)", line2: "rgba(255,255,255,.07)", text: "#fff", dim: "rgba(255,255,255,.6)", faint: "rgba(255,255,255,.38)", amber: "#f4b22b", green: "#58c93c", blue: "#8fc7d8", red: "#ff5a6e", font: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" };
const TY: Record<string, string> = { creative: "Creative art", vector: "Vector clean-up", separations: "Separations" };
const WSTATE = (s: string) => s === "delivered" ? { label: "Delivered", color: C.blue } : s === "in_revision" ? { label: "Revisions asked", color: C.amber } : s === "accepted" ? { label: "Accepted", color: C.green } : { label: "Your move", color: C.amber };
const fmt = (iso?: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const fmtDay = (iso?: string) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";

async function uploadImage(file: File): Promise<{ url: string; name: string }> {
  const s = await fetch("/api/lab/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type }) });
  const j = await s.json(); if (!s.ok) throw new Error(j.error || "Upload failed");
  const put = await fetch(j.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" } });
  if (!put.ok) throw new Error("Upload failed");
  return { url: j.publicUrl, name: file.name };
}

export default function LabDesigner({ params }: { params: { token: string } }) {
  const token = params.token;
  const [wo, setWo] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [bad, setBad] = useState(false);
  const [note, setNote] = useState(""); const [staged, setStaged] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [heroIdx, setHeroIdx] = useState<number | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);

  async function load() {
    const j = await fetch(`/api/lab/work-orders?token=${token}`).then(r => r.json());
    if (j.error) { setBad(true); return; }
    setWo(j.workOrder); setMsgs(j.messages || []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  const images = msgs.filter(m => m.file_url);
  const hero = images.length ? images[heroIdx == null ? images.length - 1 : Math.min(heroIdx, images.length - 1)] : null;
  const notes = msgs.filter(m => m.body && m.body.trim());

  async function send() {
    if (!note.trim() && !staged) return; setBusy(true);
    try { await fetch(`/api/lab/work-orders/${wo.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ designerToken: token, body: note.trim() || null, fileUrl: staged?.url || null, fileName: staged?.name || null }) }); setNote(""); setStaged(null); setHeroIdx(null); await load(); } finally { setBusy(false); }
  }
  async function onFile(f: File) { setUploading(true); try { setStaged(await uploadImage(f)); } catch (e: any) { alert(e.message); } finally { setUploading(false); } }

  if (bad) return <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", color: C.red, fontSize: 14 }}>This link isn&rsquo;t valid.</div>;
  if (!wo) return <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>Opening the work order…</div>;

  const st = WSTATE(wo.state);
  const accepted = wo.state === "accepted";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 18px 80px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>Work order · House Party Distro</div>
        <h1 style={{ fontSize: "clamp(24px,5vw,40px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 6px" }}>{wo.title || "Design"}</h1>
        <div style={{ display: "inline-flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.blue }}>{TY[wo.type] || wo.type}</span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: st.color }}>{st.label}</span>
          {wo.due_by && <span style={{ fontSize: 10.5, fontFamily: C.mono, color: C.faint }}>due {fmtDay(wo.due_by)}</span>}
        </div>
      </div>

      {/* the design + deliveries — latest big, earlier scrubable */}
      {hero && (
        <div style={{ marginTop: 18 }}>
          <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", display: "flex", justifyContent: "center", padding: "12px 0", position: "relative" }}>
            <img src={hero.file_url} alt="" style={{ maxWidth: "100%", maxHeight: "42vh", objectFit: "contain" }} onError={(e: any) => { e.target.parentElement.style.display = "none"; }} />
            <span style={{ position: "absolute", right: 10, bottom: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: hero.sender_role === "designer" ? "#3c9a2e" : "#666", background: "rgba(255,255,255,0.9)", borderRadius: 999, padding: "4px 10px" }}>{hero.sender_role === "designer" ? "Your delivery" : "From HPD"}</span>
          </div>
          {images.length > 1 && (
            <div style={{ display: "flex", gap: 8, padding: "10px 0 0", overflowX: "auto", scrollbarWidth: "none" as any }}>
              {images.map((im, i) => { const active = (heroIdx == null ? images.length - 1 : heroIdx) === i; return (
                <button key={im.id} onClick={() => setHeroIdx(i)} style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${C.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.65 }}>
                  <img src={im.file_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                </button>
              ); })}
            </div>
          )}
        </div>
      )}

      {accepted
        ? <div style={{ marginTop: 16, background: "rgba(88,201,60,.08)", border: `1px solid rgba(88,201,60,.35)`, borderRadius: 16, padding: "16px 18px", fontSize: 13, color: C.dim, textAlign: "center" }}><b style={{ color: C.green }}>✓ Accepted.</b> HPD locked your file. Thanks!</div>
        : <div style={{ marginTop: 16, fontSize: 12.5, color: C.dim, textAlign: "center" }}>{wo.state === "in_revision" ? "HPD asked for a change — read below and re-deliver." : wo.state === "delivered" ? "Delivered — waiting on HPD." : "Deliver the file below when it's ready."}</div>}

      {/* the exchange */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        {notes.map((m: any) => {
          const you = m.sender_role === "designer";
          const system = String(m.body || "").startsWith("✓");
          if (system) return <div key={m.id} style={{ alignSelf: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.green }}>{m.body}</div>;
          return (
            <div key={m.id} style={{ alignSelf: you ? "flex-end" : "flex-start", maxWidth: "84%", background: you ? "#fff" : C.surface, color: you ? C.bg : C.text, borderRadius: you ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              <span style={{ display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: you ? "rgba(10,10,10,0.45)" : C.faint, marginBottom: 3 }}>{you ? "You" : "House Party Distro"} · {fmt(m.created_at)}</span>
              {m.body}
            </div>
          );
        })}
      </div>

      {/* deliver / reply — one send, like email */}
      {!accepted && (
        <div style={{ marginTop: 16 }}>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Message HPD…" style={{ ...inp, marginBottom: staged ? 10 : 0 }} />
          {staged && <div style={{ display: "inline-flex", position: "relative", marginBottom: 10 }}>
            <img src={staged.url} alt="" style={{ maxHeight: 80, borderRadius: 8, background: "#fff", border: `1px solid ${C.line}` }} />
            <button onClick={() => setStaged(null)} aria-label="Remove" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 999, background: "#fff", color: C.bg, border: "none", fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
          </div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input ref={fileIn} type="file" accept="image/*,.pdf,.ai,.psd,.eps,.svg" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); if (fileIn.current) fileIn.current.value = ""; }} />
            <button disabled={uploading || !!staged} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: uploading || staged ? 0.5 : 1 }}>{uploading ? "Attaching…" : staged ? "✓ Attached" : "+ Attach the file"}</button>
            <button disabled={busy || (!note.trim() && !staged)} onClick={send} style={{ ...primaryBtn, marginLeft: "auto", opacity: busy || (!note.trim() && !staged) ? 0.5 : 1 }}>{staged ? "Deliver" : "Send"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = { background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "11px 20px", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const ghostBtn: React.CSSProperties = { background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 999, padding: "11px 15px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, color: C.text, fontSize: 13, padding: "11px 13px", outline: "none", fontFamily: C.font };
