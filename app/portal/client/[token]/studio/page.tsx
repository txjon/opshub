"use client";
// THE STUDIO — the stripped-down idea spot (Jon, Jul 21 2026). Replaces the
// old Designs surface for clients: a casual "here's this idea" drop
// ("Call it something." → "What else?") plus a magazine feed of everything
// in the studio, image-first. Ideas land as draft art_briefs — the team's
// existing studio machinery picks them up. 'studio' grant only.
import { useEffect, useMemo, useRef, useState } from "react";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate } from "../_shared/theme";
import { clientStateFor } from "../_shared/state-labels";

// The creative process isn't a pipeline — it's a conversation. So the feed
// buckets by WHOSE MOVE it is + freshness, not by internal process stage
// (Jon: "make it better than how I originally and rigidly tried to
// systemize the creative process").
const QUIET_DAYS = 30;
type StudioBucket = "your_move" | "working" | "ready" | "quiet";
function studioBucket(b: any): StudioBucket {
  const done = ["final_approved", "pending_prep", "production_ready", "delivered"].includes(b.state);
  if (done) return "ready";
  if (b.state === "client_review" || b.has_unread_external) return "your_move";
  const last = b.last_activity_at || b.created_at || "";
  const stale = last && (Date.now() - new Date(last).getTime()) > QUIET_DAYS * 86400000;
  return stale ? "quiet" : "working";
}
const BUCKETS: { key: StudioBucket; title: string; hint: string }[] = [
  { key: "your_move", title: "Your move.", hint: "Fresh work waiting on your eyes" },
  { key: "working", title: "In the works.", hint: "We're sketching — sit tight" },
  { key: "ready", title: "Ready to run.", hint: "Greenlit — say the word and it becomes product" },
  { key: "quiet", title: "Been quiet.", hint: "No motion in a while — revive or shelve" },
];

// Studio-local state words (Jon, Jul 21): "approve" is a KEEP-GOING nudge
// here, not a sign-off ceremony — most cards are point-of-entry ideas.
// Looser vocabulary than clientStateFor's; internal states unchanged.
const STATE_WORDS: Record<string, { label: string; color: string }> = {
  draft: { label: "On the wall", color: C.muted },
  sent: { label: "Sketching", color: C.blue },
  in_progress: { label: "Sketching", color: C.blue },
  wip_review: { label: "Sketching", color: C.blue },
  client_review: { label: "Fresh look in", color: C.purple },
  revisions: { label: "Reworking", color: C.blue },
  final_approved: { label: "Greenlit", color: C.green },
  pending_prep: { label: "Greenlit", color: C.green },
  production_ready: { label: "Greenlit", color: C.green },
  delivered: { label: "Delivered", color: C.green },
};
const stateWord = (b: any) => STATE_WORDS[b.state] || { label: clientStateFor(b).label, color: C.muted };

const thumbSrc = (b: any): string | null => {
  const t = (b.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
  const id = t?.preview_drive_file_id || t?.drive_file_id;
  return id ? `/api/files/thumbnail?id=${id}&thumb=1&size=700` : null;
};

export default function StudioPage() {
  const { data, token, refetch } = useClientPortal();
  const hasStudio = ((data as any)?.features || []).includes("studio");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [openBrief, setOpenBrief] = useState<any>(null);
  const [error, setError] = useState("");
  // Photos / docs attached before sending — held locally, uploaded after
  // the idea creates its brief (session → Drive → register, the same path
  // the old designs surface used).
  const [files, setFiles] = useState<File[]>([]);
  const [sendState, setSendState] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  const briefs = useMemo(() => {
    const list = [...((data?.briefs as any[]) || [])];
    return list.sort((a, b) => (b.last_activity_at || b.created_at || "").localeCompare(a.last_activity_at || a.created_at || ""));
  }, [data]);

  if (data && !hasStudio) {
    return (
      <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontSize: 13 }}>
        This page isn&rsquo;t enabled for your account. Reach out to your rep if you&rsquo;d like studio access.
      </div>
    );
  }
  if (!data) return null;

  const canSend = !!title.trim() && !!notes.trim();
  async function submit() {
    if (!canSend) return;
    setBusy(true); setError(""); setSendState("Sending…");
    try {
      const res = await fetch(`/api/portal/client/${token}/ideas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), notes: notes.trim() }),
      });
      const bodyJson = await res.json();
      if (!res.ok) { setError(bodyJson.error || "Couldn't save the idea."); return; }
      const briefId = bodyJson.briefId;
      // Attach files to the fresh brief — best-effort per file; a failed
      // attachment never sinks the idea itself.
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        setSendState(`Uploading ${i + 1} of ${files.length}…`);
        try {
          const f = files[i];
          const sess = await fetch(`/api/portal/client/${token}/briefs/${briefId}/upload-session`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_name: f.name, mime_type: f.type || "application/octet-stream" }),
          });
          if (!sess.ok) throw new Error("session");
          const { uploadUrl } = await sess.json();
          const { drive_file_id } = await uploadFileToDriveSession(uploadUrl, f);
          await fetch(`/api/portal/client/${token}/briefs/${briefId}/upload-session/complete`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ drive_file_id, file_name: f.name, mime_type: f.type || "application/octet-stream", file_size: f.size }),
          });
        } catch { failed++; }
      }
      if (failed > 0) setError(`Idea sent, but ${failed} attachment${failed === 1 ? "" : "s"} didn't make it — try adding ${failed === 1 ? "it" : "them"} from the idea's thread.`);
      const sentTitle = title.trim(); const sentNotes = notes.trim();
      setSent(true); setTitle(""); setNotes(""); setFiles([]); setExpanded(false);
      setTimeout(() => setSent(false), 5000);
      refetch();
      // Straight into shaping — open the fresh idea's sheet (Build It Out,
      // attachments, thread) instead of dropping them back at the form.
      setOpenBrief({ id: briefId, title: sentTitle, concept: sentNotes, state: "draft", product_spec: {}, thumbs: [], created_at: new Date().toISOString(), last_activity_at: null });
    } catch { setError("Couldn't save the idea."); }
    finally { setBusy(false); setSendState(""); }
  }

  return (
    <div style={{ paddingTop: "clamp(8px, 3vw, 28px)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .st-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}
        @media(min-width:720px){.st-grid{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}}
        .st-card{transition:transform .15s ease,border-color .15s ease}
        .st-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .st-input{width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;color:${C.text};font-family:${C.font}}
        .st-back{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto}
        .st-sheet{background:${C.card};border:1px solid ${C.border};border-radius:20px;max-width:620px;width:100%;overflow:hidden}
        .st-handle{display:none}
        @media(max-width:640px){
          .st-back{align-items:flex-end;padding:0;overflow-y:hidden}
          .st-sheet{border-radius:18px 18px 0 0;border-bottom:none;max-height:92dvh;overflow-y:auto;animation:stUp .3s cubic-bezier(.32,.72,0,1)}
          .st-handle{display:block;width:38px;height:4px;border-radius:999px;background:rgba(255,255,255,0.25);margin:10px auto 0}
        }
        @keyframes stUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @media(prefers-reduced-motion:reduce){.st-card,.st-card:hover{transition:none;transform:none}.st-sheet{animation:none}}
      ` }} />

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, textAlign: "center" }}>Studio</div>
      <h1 style={{ fontSize: "clamp(30px,6.5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 12px", textAlign: "center" }}>
        Got an idea?
      </h1>
      <div style={{ fontSize: 14, color: C.muted, maxWidth: "48ch", lineHeight: 1.6, margin: "0 auto 26px", textAlign: "center" }}>
        Drop it here, however rough. We&rsquo;ll shape it into a product with you.
      </div>

      {/* ── The idea drop — one big casual input ── */}
      <div style={{ maxWidth: 640, margin: "0 auto 44px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: "20px 22px" }}>
        <input className="st-input" value={title} placeholder="Call it something."
          onChange={e => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={e => { if (e.key === "Enter" && !expanded) setExpanded(true); }}
          style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em" }} />
        {expanded && (
          <>
            <div style={{ height: 1, background: C.border, margin: "14px 0" }} />
            <textarea className="st-input" value={notes} rows={3}
              placeholder="What else? Vibe, references, garment, timing — anything."
              onChange={e => setNotes(e.target.value)}
              style={{ fontSize: 14, lineHeight: 1.6, resize: "vertical" }} />
            {/* Attachments — photos, art files, docs */}
            <input ref={fileInput} type="file" multiple accept="image/*,.pdf,.ai,.eps,.psd,.svg,.zip" style={{ display: "none" }}
              onChange={e => { const list = Array.from(e.target.files || []); if (list.length) setFiles(prev => [...prev, ...list].slice(0, 10)); e.target.value = ""; }} />
            {files.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {files.map((f, i) => (
                  <span key={i} style={{ position: "relative", display: "inline-flex" }}>
                    {f.type.startsWith("image/") ? (
                      <img src={URL.createObjectURL(f)} alt="" style={{ width: 58, height: 58, objectFit: "cover", borderRadius: 9, background: "#fff" }} />
                    ) : (
                      <span style={{ width: 58, height: 58, borderRadius: 9, background: C.surface, border: `1px solid ${C.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", padding: 4, textAlign: "center", overflow: "hidden" }}>{(f.name.split(".").pop() || "file").slice(0, 4)}</span>
                    )}
                    <button onClick={() => setFiles(prev => prev.filter((_, x) => x !== i))} aria-label="Remove"
                      style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 999, background: "#fff", color: C.bg, border: "none", fontSize: 11, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => fileInput.current?.click()}
                style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999, padding: "12px 18px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
                + Photos &amp; files
              </button>
              <button onClick={submit} disabled={busy || !canSend}
                style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "12px 24px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: busy || !canSend ? "default" : "pointer", opacity: busy || !canSend ? 0.5 : 1, fontFamily: C.font }}>
                {busy ? (sendState || "Sending…") : "Send it"}
              </button>
              <span style={{ fontSize: 11, color: C.faint }}>Lands with our team — we&rsquo;ll take it from there.</span>
            </div>
          </>
        )}
        {sent && <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, color: C.green }}>In the studio. We&rsquo;re on it.</div>}
        {error && <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, color: C.red }}>{error}</div>}
      </div>

      {/* ── The feed — conversation buckets, image-first ── */}
      {BUCKETS.map(bucket => {
        const list = briefs.filter((b: any) => studioBucket(b) === bucket.key);
        if (list.length === 0) return null;
        return (
          <div key={bucket.key} style={{ marginBottom: 36 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: bucket.key === "your_move" ? C.amber : C.text }}>{bucket.title}</h2>
              <span style={{ fontSize: 10, fontWeight: 800, color: C.faint, fontFamily: C.mono }}>{list.length}</span>
              <span style={{ fontSize: 10.5, color: C.faint }}>{bucket.hint}</span>
            </div>
            <div className="st-grid">
              {list.map((b: any) => {
                const meta = stateWord(b);
                const src = thumbSrc(b);
                return (
                  <button key={b.id} className="st-card" onClick={() => setOpenBrief(b)}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", padding: 0, textAlign: "left", cursor: "pointer", color: C.text, fontFamily: C.font }}>
                    {src ? (
                      <div style={{ background: "#fff", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                      </div>
                    ) : (
                      <div style={{ aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, background: C.surface }}>
                        <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, textAlign: "center", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 6, overflow: "hidden" }}>
                          {b.concept || "Sketching soon."}
                        </span>
                      </div>
                    )}
                    <div style={{ padding: "11px 13px 13px" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{b.title || "Untitled idea"}</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.color }}>{meta.label}</span>
                        <span style={{ fontSize: 9.5, color: C.faint, fontFamily: C.mono }}>{b.last_activity_at ? fmtDate(b.last_activity_at) : ""}</span>
                        {b.has_unread_external && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: C.purple }}>NEW</span>}
                      </div>
                      {(() => {
                        const ps = Array.isArray(b.product_spec?.products) && b.product_spec.products.length ? b.product_spec.products
                          : (b.product_spec?.retail != null || b.product_spec?.model || b.product_spec?.format) ? [b.product_spec] : [];
                        if (!ps.length) return null;
                        const bits = ps.slice(0, 3).map((x: any) => [x.format || "item", x.retail != null ? `$${x.retail}` : null].filter(Boolean).join(" "));
                        if (ps.length > 3) bits.push(`+${ps.length - 3}`);
                        return <div style={{ fontSize: 9.5, fontFamily: C.mono, color: C.muted, marginTop: 4 }}>{bits.join(" · ")}</div>;
                      })()}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {openBrief && (
        <BriefSheet brief={openBrief} token={token}
          onClose={() => setOpenBrief(null)}
          onActed={() => { setOpenBrief(null); refetch(); }} />
      )}
    </div>
  );
}

// ── Brief sheet: latest art big + the conversation actions ──
function BriefSheet({ brief, token, onClose, onActed }: { brief: any; token: string; onClose: () => void; onActed: () => void }) {
  const bucket = studioBucket(brief);
  const meta = stateWord(brief);
  const src = thumbSrc(brief);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  // The thread IS the brief — one ping-pong exchange: the opening idea,
  // every note from either side, every shared image drop, chronological.
  // (The old machinery scattered notes across four stores; this renders
  // the client-visible spine and every client note is always visible.)
  const [thread, setThread] = useState<any[] | null>(null);
  // Build it out — the client shapes their own idea. Prompts, not forms;
  // saves on blur/tap, changes echo into the thread as ✎ markers.
  const spec0 = brief.product_spec || {};
  const [specTitle, setSpecTitle] = useState<string>(brief.title || "");
  // One artwork, N sellable versions. Legacy single-spec briefs migrate to
  // one line on open.
  const [products, setProducts] = useState<any[]>(() => {
    if (Array.isArray(spec0.products) && spec0.products.length) return spec0.products;
    if (spec0.format || spec0.retail != null || spec0.model || spec0.run_size != null) {
      return [{ id: "legacy1", format: spec0.format || "", retail: spec0.retail ?? null, model: spec0.model || null, run_size: spec0.run_size ?? null }];
    }
    return [];
  });
  const [specSaved, setSpecSaved] = useState(false);
  function pushProducts(next: any[]) {
    setProducts(next);
    saveSpec({ products: next.map(x => ({ id: x.id, format: x.format || null, retail: x.retail === "" ? null : x.retail, model: x.model || null, run_size: x.run_size === "" ? null : x.run_size })) });
  }
  function patchLine(id: string, patch: any, save = true) {
    const next = products.map(x => x.id === id ? { ...x, ...patch } : x);
    if (save) pushProducts(next); else setProducts(next);
  }
  async function saveSpec(patch: any) {
    try {
      const res = await fetch(`/api/portal/client/${token}/briefs/${brief.id}/spec`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (res.ok) { setSpecSaved(true); setTimeout(() => setSpecSaved(false), 1800); }
    } catch {}
  }
  // Evolution scrubbing: latest drop is the hero; earlier drops become a
  // filmstrip of thumbs (old → new). Tap a thumb to swap it into the hero.
  const [heroIdx, setHeroIdx] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/portal/client/${token}/briefs/${brief.id}`);
        const body = await res.json();
        if (!res.ok) { setThread([]); return; }
        const entries: any[] = [];
        if (brief.concept) entries.push({ at: brief.created_at || "", who: "you", type: "text", body: brief.concept });
        for (const m of (body.messages || [])) {
          entries.push({ at: m.created_at, who: m.sender_role === "client" ? "you" : "us", type: "text", body: m.message, system: (m.message || "").startsWith("✓") });
        }
        for (const f of (body.files || [])) {
          const id = f.preview_drive_file_id || f.drive_file_id;
          if (!id) continue;
          entries.push({ at: f.created_at, who: f.uploader_role === "client" ? "you" : "us", type: "image", driveId: id, kind: f.kind });
        }
        entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
        setThread(entries);
      } catch { setThread([]); }
    })();
    // eslint-disable-next-line
  }, [brief.id]);

  async function act(kind: "approve" | "abort") {
    setBusy(kind); setMsg("");
    try {
      const res = await fetch(`/api/portal/client/${token}/briefs/${brief.id}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind }),
      });
      const b = await res.json();
      if (!res.ok) { setMsg(b.error || "Couldn't do that."); setBusy(null); return; }
      onActed();
    } catch { setMsg("Couldn't do that."); setBusy(null); }
  }
  async function sendNote(text: string) {
    if (!text.trim()) return;
    setBusy("note"); setMsg("");
    try {
      const res = await fetch(`/api/portal/client/${token}/briefs/${brief.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text.trim() }),
      });
      if (!res.ok) { setMsg("Couldn't send that."); setBusy(null); return; }
      onActed();
    } catch { setMsg("Couldn't send that."); setBusy(null); }
  }

  const pill: React.CSSProperties = { background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "12px 22px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };
  const ghost: React.CSSProperties = { background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "12px 20px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font };

  return (
    <div className="st-back" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="st-sheet">
        <div className="st-handle" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "16px 20px 4px" }}>
          <div style={{ minWidth: 0 }}>
            <input value={specTitle} onChange={e => setSpecTitle(e.target.value)}
              onBlur={() => { if (specTitle.trim() && specTitle.trim() !== brief.title) saveSpec({ title: specTitle.trim() }); }}
              placeholder="Untitled idea"
              style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, background: "transparent", border: "none", outline: "none", color: C.text, width: "100%", fontFamily: C.font, padding: 0 }} />
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 4 }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.color }}>{meta.label}</span>
              <span style={{ fontSize: 10, color: C.faint, fontFamily: C.mono }}>{brief.last_activity_at ? fmtDate(brief.last_activity_at) : ""}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.muted, fontSize: 26, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
        {/* ── Latest drop big + evolution filmstrip ── */}
        {(() => {
          const images = (thread || []).filter(e => e.type === "image");
          if (images.length === 0) return null;
          const hero = images[heroIdx == null ? images.length - 1 : Math.min(heroIdx, images.length - 1)];
          const heroDate = hero.at ? fmtDate(hero.at) : "";
          return (
            <div style={{ marginTop: 12 }}>
              <div style={{ background: "#fff", position: "relative" }}>
                <img src={`/api/files/thumbnail?id=${hero.driveId}&thumb=1&size=700`} alt="" referrerPolicy="no-referrer"
                  style={{ width: "100%", maxHeight: "40vh", objectFit: "contain", display: "block", margin: "0 auto" }}
                  onError={(ev: any) => { ev.target.parentElement.style.display = "none"; }} />
                {heroDate && <span style={{ position: "absolute", right: 10, bottom: 8, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#999", background: "rgba(255,255,255,0.85)", borderRadius: 999, padding: "3px 9px" }}>{(heroIdx == null || heroIdx === images.length - 1) ? "Latest" : heroDate}</span>}
              </div>
              {images.length > 1 && (
                <div style={{ display: "flex", gap: 8, padding: "10px 20px 0", overflowX: "auto", scrollbarWidth: "none" as any }}>
                  {images.map((im, i) => {
                    const active = (heroIdx == null ? images.length - 1 : heroIdx) === i;
                    return (
                      <button key={i} onClick={() => setHeroIdx(i)}
                        style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${C.border}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.65 }}>
                        <img src={`/api/files/thumbnail?id=${im.driveId}&thumb=1&size=200`} alt="" loading="lazy" referrerPolicy="no-referrer"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={(ev: any) => { ev.target.style.display = "none"; }} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Build it out — the client shapes the product ── */}
        <div style={{ padding: "16px 20px 2px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>Build it out</span>
            {specSaved && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.green }}>Saved</span>}
          </div>
          {products.map((ln) => (
            <div key={ln.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>What is it?</span>
                <input type="text" value={ln.format || ""} placeholder="Tee, hoodie, LS…"
                  onChange={e => patchLine(ln.id, { format: e.target.value }, false)}
                  onBlur={() => pushProducts(products)}
                  style={{ width: 118, padding: "9px 10px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, outline: "none", color: C.text, fontFamily: C.font, fontSize: 12.5 }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>Retail</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, padding: "0 10px" }}>
                  <span style={{ color: C.faint, fontFamily: C.mono, fontSize: 13 }}>$</span>
                  <input type="text" inputMode="decimal" value={ln.retail ?? ""} placeholder="—"
                    onFocus={e => e.currentTarget.select()}
                    onChange={e => patchLine(ln.id, { retail: e.target.value.replace(/[^0-9.]/g, "") }, false)}
                    onBlur={() => pushProducts(products.map(x => x.id === ln.id ? { ...x, retail: x.retail === "" || x.retail == null ? null : Number(x.retail) } : x))}
                    style={{ width: 52, padding: "9px 0", background: "transparent", border: "none", outline: "none", color: C.text, fontFamily: C.mono, fontSize: 13.5, fontWeight: 700 }} />
                </span>
              </label>
              <span style={{ display: "inline-flex", gap: 6 }}>
                {[["stock", "Fixed"], ["preorder", "Pre-order"]].map(([k, label]) => (
                  <button key={k} onClick={() => patchLine(ln.id, { model: ln.model === k ? null : k })}
                    style={{ borderRadius: 999, border: ln.model === k ? "1px solid #fff" : `1px solid ${C.border}`, background: ln.model === k ? "#fff" : "transparent", color: ln.model === k ? C.bg : C.muted, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "10px 13px", cursor: "pointer", fontFamily: C.font }}>
                    {label}
                  </button>
                ))}
              </span>
              {ln.model === "stock" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>Run size</span>
                  <input type="text" inputMode="numeric" value={ln.run_size ?? ""} placeholder="—"
                    onFocus={e => e.currentTarget.select()}
                    onChange={e => patchLine(ln.id, { run_size: e.target.value.replace(/[^0-9]/g, "") }, false)}
                    onBlur={() => pushProducts(products.map(x => x.id === ln.id ? { ...x, run_size: x.run_size === "" || x.run_size == null ? null : Number(x.run_size) } : x))}
                    style={{ width: 78, padding: "9px 10px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, outline: "none", color: C.text, fontFamily: C.mono, fontSize: 13, fontWeight: 700 }} />
                </label>
              )}
              <button onClick={() => pushProducts(products.filter(x => x.id !== ln.id))} aria-label="Remove version"
                style={{ marginLeft: "auto", background: "none", border: "none", color: C.faint, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "8px 2px" }}>×</button>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={() => pushProducts([...products, { id: Math.random().toString(36).slice(2, 10), format: "", retail: null, model: null, run_size: null }])}
              style={{ borderRadius: 999, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "10px 18px", cursor: "pointer", fontFamily: C.font }}>
              {products.length === 0 ? "+ Add a version — tee, hoodie, LS…" : "+ Another version"}
            </button>
            {products.length > 0 && <span style={{ fontSize: 10.5, color: C.faint }}>same artwork — each version gets its own retail &amp; run</span>}
          </div>
        </div>

        {/* ── The exchange — notes only; images live in the strip above ── */}
        <div style={{ padding: "14px 20px 4px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "34vh", overflowY: "auto" }}>
          {thread === null ? (
            <div style={{ color: C.faint, fontSize: 12, padding: "10px 0" }}>Loading the thread…</div>
          ) : thread.filter(e => e.type !== "image").length === 0 ? (
            <div style={{ color: C.faint, fontSize: 12.5, padding: "6px 0" }}>No notes yet — say the first thing.</div>
          ) : thread.filter(e => e.type !== "image").map((e, i) => (
            e.system ? (
              <div key={i} style={{ alignSelf: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.green }}>{e.body}</div>
            ) : (
              <div key={i} style={{
                alignSelf: e.who === "you" ? "flex-end" : "flex-start", maxWidth: "84%",
                background: e.who === "you" ? "#fff" : C.surface, color: e.who === "you" ? C.bg : C.text,
                borderRadius: e.who === "you" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                padding: "9px 13px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap",
              }}>{e.body}</div>
            )
          ))}
        </div>
        <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder={bucket === "your_move" ? "Thoughts on this one?" : "Your turn — notes, references, direction…"}
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13, fontFamily: C.font, outline: "none", resize: "vertical" }} />
          {msg && <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>{msg}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {bucket === "your_move" && brief.state === "client_review" && (
              <button style={pill} disabled={!!busy} onClick={() => act("approve")}>{busy === "approve" ? "Sending…" : "Love it — keep going"}</button>
            )}
            {bucket === "ready" && (
              <button style={pill} disabled={!!busy} onClick={() => sendNote(note.trim() ? `Let's make this one real. ${note.trim()}` : "Let's make this one real — what's the move?")}>
                {busy === "note" ? "Sending…" : "Make it real"}
              </button>
            )}
            {bucket === "quiet" && (
              <button style={pill} disabled={!!busy} onClick={() => sendNote(note.trim() ? `Still into this one. ${note.trim()}` : "Still into this one — let's get it moving again.")}>
                {busy === "note" ? "Sending…" : "Revive it"}
              </button>
            )}
            <button style={ghost} disabled={!!busy || !note.trim()} onClick={() => sendNote(note)}>{busy === "note" ? "Sending…" : "Send note"}</button>
            {(bucket === "quiet" || brief.state === "draft") && (
              <button style={{ ...ghost, color: C.faint, borderColor: "transparent", marginLeft: "auto" }} disabled={!!busy}
                onClick={() => { if (confirm("Shelve this idea? We'll set it aside — you can always bring it back with your rep.")) act("abort"); }}>
                {busy === "abort" ? "Shelving…" : "Shelve it"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
