"use client";
import { useEffect, useRef, useState } from "react";
import { H, primaryBtn, ghostBtn, inp, tag, fmtStamp, fmtDue } from "@/lib/studio-theme";
import { woTypeLabel, type BriefSpec } from "@/lib/design-work-orders";
import PinBrief from "@/components/studio/PinBrief";
import Lightbox, { type LightboxItem } from "@/components/studio/Lightbox";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";

// THE DESIGNER'S PAGE — one work order by magic link. What we need, the brief
// pinned right on the references (same component we wrote it with), every
// file to download, the thread, and one send to deliver. No client identity
// anywhere (the wall). No account. Mobile-first: designers open this on a
// phone from the email.
const STATE = (s: string) => s === "delivered" ? { label: "Delivered · waiting on HPD", color: H.blue } : s === "in_revision" ? { label: "Changes asked", color: H.amber } : s === "accepted" ? { label: "Accepted", color: H.green } : { label: "Your move", color: H.amber };

export default function DesignerPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [wo, setWo] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [fileBase, setFileBase] = useState("");
  const [bad, setBad] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [staged, setStaged] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");
  const [heroId, setHeroId] = useState<string | null>(null);
  const fileIn = useRef<HTMLInputElement | null>(null);
  const [lit, setLit] = useState<LightboxItem | null>(null);

  async function load() {
    const j = await fetch(`/api/designer/${token}`).then(r => r.json()).catch(() => ({ error: true }));
    if (j.error) { setBad(true); return; }
    setWo(j.workOrder); setMsgs(j.messages || []); setFileBase(j.fileBase || "");
  }
  useEffect(() => { load(); try { setName(localStorage.getItem("hpd_designer_name") || ""); } catch {} /* eslint-disable-next-line */ }, [token]);

  const img = (id: string, size?: number) => `${fileBase}${id}?thumb=1&size=${size || 900}`;
  const dl = (id: string) => `${fileBase}${id}?dl=1`;

  async function send() {
    if (!note.trim() && !staged) return; setBusy(true); setErr(""); setPct(0);
    try {
      let driveFileId: string | null = null;
      if (staged) {
        // Straight into Drive (resumable session, 4MB chunks) — big AI/PSD/ZIP
        // deliverables are fine; no size ceiling on this path.
        const s = await fetch(`/api/designer/${token}/upload-session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: staged.name, mimeType: staged.type }) }).then(r => r.json());
        if (s.error) throw new Error(s.error);
        const up = await uploadFileToDriveSession(s.uploadUrl, staged, (done, total) => setPct(Math.round((done / total) * 100)));
        driveFileId = up.drive_file_id;
      }
      const r = await fetch(`/api/designer/${token}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: note.trim() || null, driveFileId, fileName: staged?.name || null, mimeType: staged?.type || null, fileSize: staged?.size || null, senderName: name.trim() || null }) }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      try { if (name.trim()) localStorage.setItem("hpd_designer_name", name.trim()); } catch {}
      setNote(""); setStaged(null); setHeroId(null); await load();
    } catch (e: any) { setErr(e?.message || "Didn't send — try again."); }
    finally { setBusy(false); setPct(0); }
  }

  if (bad) return <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", color: H.red, fontSize: 14 }}>This link isn&rsquo;t live. If you think it should be, reply to the email it came in.</div>;
  if (!wo) return <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center", color: H.faint, fontSize: 13 }}>Opening the work order…</div>;

  const st = STATE(wo.state); const accepted = wo.state === "accepted";
  const spec: BriefSpec = wo.brief || { canvases: [], extras: [] };
  const files = msgs.filter(m => m.image_url);
  const hero = files.find(f => f.id === heroId) || files[files.length - 1] || null;
  const words = msgs.filter(m => m.body && m.body.trim());

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 14px 90px", overflowX: "hidden", boxSizing: "border-box" }}>
      <Lightbox item={lit} onClose={() => setLit(null)} />
      <div style={{ textAlign: "center" }}>
        <div style={tag(H.faint, 11)}>Work order · House Party Distro</div>
        {(wo.client_name || wo.job_number) && <div style={{ ...tag(H.blue, 11), marginTop: 6 }}>{[wo.client_name, wo.job_number].filter(Boolean).join(" · ")}</div>}
        <h1 style={{ fontSize: "clamp(24px,5vw,40px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 6px" }}>{wo.title || "Design"}</h1>
        <div style={{ display: "inline-flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", justifyContent: "center" }}>
          <span style={tag(H.blue, 10.5)}>{woTypeLabel(wo.type)}</span>
          <span style={tag(st.color, 10)}>{st.label}</span>
          {wo.due_by && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>due {fmtDue(wo.due_by)}</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
        <a href={`/api/designer/${token}/package`} style={{ ...primaryBtn, textDecoration: "none", display: "inline-block", padding: "11px 18px" }}>↓ Download package (.zip)</a>
        <a href={`/api/designer/${token}/packet`} style={{ ...ghostBtn, textDecoration: "none", display: "inline-block", padding: "11px 16px" }}>PDF brief</a>
      </div>
      <div style={{ textAlign: "center", fontSize: 10.5, color: H.faint, marginTop: 6 }}>Every file at full resolution + the brief as a PDF, for working offline. Upload your work below.</div>

      {wo.headline && <div style={{ marginTop: 22, textAlign: "center", fontSize: "clamp(18px,3.5vw,26px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", background: H.blue, color: H.ink, borderRadius: 10, padding: "12px 16px" }}>{wo.headline}</div>}

      {spec.canvases.map((c, i) => (
        <section key={c.id} style={{ marginTop: 22, padding: 12, background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16, minWidth: 0, overflow: "hidden" }}>
          <div style={{ ...tag(H.amber, 9), marginBottom: 8 }}>{spec.canvases.length > 1 ? `Reference ${i + 1}` : "The reference"} · {c.pins?.length || 0} pin{(c.pins?.length || 0) === 1 ? "" : "s"}</div>
          <PinBrief canvas={c} readOnly imgSrc={img} downloadHref={dl(c.driveId)} downloadSrc={dl} onOpenImage={(id, name, caption) => setLit({ src: img(id, 1600), downloadHref: dl(id), name, caption })} />
        </section>
      ))}

      {wo.instructions && (
        <section style={{ marginTop: 18, padding: "14px 16px", background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16 }}>
          <div style={{ ...tag(H.faint, 9), marginBottom: 6 }}>Notes</div>
          <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{wo.instructions}</div>
        </section>
      )}

      {(spec.conversation || []).length > 0 && (
        <section style={{ marginTop: 18, padding: "14px 16px", background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16 }}>
          <div style={{ ...tag(H.faint, 9), marginBottom: 10 }}>What the client said · the conversation so far</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(spec.conversation || []).map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ ...tag(l.role === "client" ? H.blue : H.dim, 8.5), flexShrink: 0, width: 44, paddingTop: 3 }}>{l.role === "client" ? "Client" : "HPD"}</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", color: l.role === "client" ? H.text : H.dim }}>{l.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {spec.extras.length > 0 && (
        <section style={{ marginTop: 18 }}>
          <div style={{ ...tag(H.faint, 9), marginBottom: 8 }}>{spec.canvases.length ? "More files" : "The files"} · tap to view, download from there</div>
          <div style={{ display: "grid", gridTemplateColumns: spec.canvases.length ? "repeat(auto-fill, minmax(92px, 1fr))" : "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {spec.extras.map(e => (
              <button key={e.driveId} type="button" onClick={() => setLit({ src: img(e.previewId || e.driveId, 1600), downloadHref: dl(e.driveId), name: e.name, caption: e.label || "Reference" })} style={{ display: "block", aspectRatio: "1", borderRadius: 10, overflow: "hidden", background: "#fff", position: "relative", border: "none", padding: 0, cursor: "zoom-in", width: "100%" }}>
                {/* No preview (layered PSD): a labeled tile instead of a broken image; the download still works. */}
                <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 10, textAlign: "center", color: "#555", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.3 }}>{(e.name || "").replace(/\.[a-z0-9]+$/i, "")}<br /><span style={{ fontWeight: 600, color: "#999", fontSize: 10, textTransform: "none" }}>{(e.name || "").split(".").pop()?.toUpperCase()} · tap to download</span></span>
                <img src={img(e.previewId || e.driveId, 400)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ position: "relative", width: "100%", height: "100%", objectFit: "cover" }} onError={(ev: any) => { ev.target.style.display = "none"; }} />
                {e.label && <span style={{ position: "absolute", left: 5, top: 5, ...tag(H.ink, 8.5), background: "rgba(255,255,255,.92)", borderRadius: 6, padding: "3px 7px" }}>{e.label}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {hero && (
        <section style={{ marginTop: 22 }}>
          <div style={{ ...tag(H.faint, 9), marginBottom: 8 }}>{hero.sender_role === "designer" ? "Your delivery" : "From HPD"}</div>
          <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", display: "flex", justifyContent: "center", padding: "12px 0", position: "relative" }}>
            <img src={hero.image_url} alt="" referrerPolicy="no-referrer" onClick={() => setLit({ src: hero.image_url, downloadHref: hero.download_url, name: hero.file_name, caption: hero.sender_role === "designer" ? "Your delivery" : "From HPD" })} style={{ maxWidth: "100%", maxHeight: "42vh", objectFit: "contain", cursor: "zoom-in" }} onError={(e: any) => { e.target.style.opacity = 0.15; }} />
            <span style={{ position: "absolute", right: 10, bottom: 8, display: "flex", gap: 6 }}>
              {hero.file_name && <span style={{ ...tag("#666", 8.5), background: "rgba(255,255,255,0.92)", borderRadius: 6, padding: "4px 9px" }}>{hero.file_name}</span>}
              {hero.download_url && <a href={hero.download_url} style={{ ...tag(H.green, 8.5), background: H.ink, borderRadius: 6, padding: "4px 9px", textDecoration: "none" }}>↓</a>}
            </span>
          </div>
          {files.length > 1 && (
            <div style={{ display: "flex", gap: 8, paddingTop: 10, overflowX: "auto" }}>
              {files.map(f => { const active = f.id === hero.id; return (
                <button key={f.id} onClick={() => setHeroId(f.id)} style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.65 }}>
                  <img src={f.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />
                </button>
              ); })}
            </div>
          )}
        </section>
      )}

      <div style={{ marginTop: 22, fontSize: 12.5, color: H.dim, textAlign: "center" }}>
        {accepted ? <span><b style={{ color: H.green }}>✓ Accepted.</b> HPD locked your file. Thanks!</span>
          : wo.state === "in_revision" ? "HPD asked for a change — read below and deliver again."
          : wo.state === "delivered" ? "Delivered — HPD is reviewing. Add a note anytime."
          : "Deliver the file below when it's ready. Questions go here too."}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {words.map((m: any) => {
          const you = m.sender_role === "designer"; const sys = /^[✓✕↩]/.test(String(m.body || ""));
          if (sys) return <div key={m.id} style={{ alignSelf: "center", ...tag(H.green, 10) }}>{m.body}</div>;
          return (
            <div key={m.id} style={{ alignSelf: you ? "flex-end" : "flex-start", maxWidth: "86%", background: you ? "#fff" : H.surface, color: you ? H.ink : H.text, borderRadius: you ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              <span style={{ display: "block", ...tag(you ? "rgba(10,10,10,0.45)" : H.faint, 8.5), marginBottom: 3 }}>{you ? "You" : "House Party Distro"} · {fmtStamp(m.created_at)}</span>
              {m.body}
            </div>
          );
        })}
      </div>

      {!accepted && (
        <div style={{ marginTop: 18, padding: 14, background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={{ ...inp, marginBottom: 8, maxWidth: 260 }} />
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Message HPD…" style={{ ...inp, resize: "vertical", marginBottom: 8 }} />
          {staged && <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontSize: 12.5 }}><span style={{ ...tag(H.green, 9) }}>Attached</span><span style={{ fontFamily: H.mono, fontSize: 11, color: H.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{staged.name} · {(staged.size / 1048576).toFixed(1)} MB</span><button onClick={() => setStaged(null)} style={{ background: "none", border: "none", color: H.faint, cursor: "pointer", fontSize: 16 }}>×</button></div>}
          {busy && pct > 0 && <div style={{ height: 4, background: H.line2, borderRadius: 4, marginBottom: 10, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: H.green, transition: "width .2s" }} /></div>}
          {err && <div style={{ fontSize: 12, color: H.red, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input ref={fileIn} type="file" accept="image/*,.pdf,.ai,.psd,.eps,.svg,.zip" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) setStaged(f); if (fileIn.current) fileIn.current.value = ""; }} />
            <button disabled={busy || !!staged} onClick={() => fileIn.current?.click()} style={{ ...ghostBtn, opacity: staged ? 0.5 : 1 }}>{staged ? "✓ File attached" : "+ Attach the file"}</button>
            <button disabled={busy || (!note.trim() && !staged)} onClick={send} style={{ ...primaryBtn, marginLeft: "auto", padding: "12px 22px", opacity: busy || (!note.trim() && !staged) ? 0.5 : 1 }}>{busy ? (pct ? `Uploading ${pct}%` : "Sending…") : staged ? "Deliver →" : "Send"}</button>
          </div>
          <div style={{ fontSize: 10.5, color: H.faint, marginTop: 8 }}>Big files are fine (AI, PSD, PDF, ZIP). Attach one per send.</div>
        </div>
      )}
    </div>
  );
}
