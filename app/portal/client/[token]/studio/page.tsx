"use client";
// THE STUDIO — the stripped-down idea spot (Jon, Jul 21 2026). Replaces the
// old Designs surface for clients: a casual "here's this idea" drop
// ("Call it something." → "What else?") plus a magazine feed of everything
// in the studio, image-first. Ideas land as draft art_briefs — the team's
// existing studio machinery picks them up. 'studio' grant only.
import { useMemo, useState } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate } from "../_shared/theme";
import { clientStateFor } from "../_shared/state-labels";

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
  const [error, setError] = useState("");

  const briefs = useMemo(() => {
    const list = [...((data?.briefs as any[]) || [])];
    return list.sort((a, b) => (b.last_activity_at || b.updated_at || "").localeCompare(a.last_activity_at || a.updated_at || ""));
  }, [data]);

  if (data && !hasStudio) {
    return (
      <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontSize: 13 }}>
        This page isn&rsquo;t enabled for your account. Reach out to your rep if you&rsquo;d like studio access.
      </div>
    );
  }
  if (!data) return null;

  async function submit() {
    if (!title.trim()) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/portal/client/${token}/ideas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), notes: notes.trim() || undefined }),
      });
      const bodyJson = await res.json();
      if (!res.ok) { setError(bodyJson.error || "Couldn't save the idea."); return; }
      setSent(true); setTitle(""); setNotes(""); setExpanded(false);
      setTimeout(() => setSent(false), 5000);
      refetch();
    } catch { setError("Couldn't save the idea."); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ paddingTop: "clamp(8px, 3vw, 28px)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .st-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}
        @media(min-width:720px){.st-grid{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}}
        .st-card{transition:transform .15s ease,border-color .15s ease}
        .st-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .st-input{width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;color:${C.text};font-family:${C.font}}
        @media(prefers-reduced-motion:reduce){.st-card,.st-card:hover{transition:none;transform:none}}
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
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={submit} disabled={busy || !title.trim()}
                style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "12px 24px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: busy || !title.trim() ? "default" : "pointer", opacity: busy || !title.trim() ? 0.5 : 1, fontFamily: C.font }}>
                {busy ? "Sending…" : "Send it"}
              </button>
              <span style={{ fontSize: 11, color: C.faint }}>Lands with our team — we&rsquo;ll take it from there.</span>
            </div>
          </>
        )}
        {sent && <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, color: C.green }}>In the studio. We&rsquo;re on it.</div>}
        {error && <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, color: C.red }}>{error}</div>}
      </div>

      {/* ── The feed — everything in the studio, image-first ── */}
      {briefs.length > 0 && (
        <>
          <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 900, textTransform: "uppercase" }}>In the studio.</h2>
          <div className="st-grid">
            {briefs.map((b: any) => {
              const meta = clientStateFor(b);
              const src = thumbSrc(b);
              return (
                <div key={b.id} className="st-card"
                  style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
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
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
