"use client";
// THE STUDIO — the stripped-down idea spot (Jon, Jul 21 2026). Replaces the
// old Designs surface for clients: a casual "here's this idea" drop
// ("Call it something." → "What else?") plus a magazine feed of everything
// in the studio, image-first. Ideas land as draft art_briefs — the team's
// existing studio machinery picks them up. 'studio' grant only.
import { useEffect, useMemo, useState } from "react";
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
            <div style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2 }}>{brief.title || "Untitled idea"}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 4 }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.color }}>{meta.label}</span>
              <span style={{ fontSize: 10, color: C.faint, fontFamily: C.mono }}>{brief.last_activity_at ? fmtDate(brief.last_activity_at) : ""}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.muted, fontSize: 26, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
        {/* ── The exchange ── */}
        <div style={{ padding: "14px 20px 4px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "48vh", overflowY: "auto" }}>
          {thread === null ? (
            <div style={{ color: C.faint, fontSize: 12, padding: "10px 0" }}>Loading the thread…</div>
          ) : thread.length === 0 ? (
            <div style={{ color: C.faint, fontSize: 12.5, padding: "6px 0" }}>Nothing here yet — say the first thing.</div>
          ) : thread.map((e, i) => (
            e.type === "image" ? (
              <div key={i} style={{ alignSelf: "stretch", background: "#fff", borderRadius: 12, overflow: "hidden" }}>
                <img src={`/api/files/thumbnail?id=${e.driveId}&thumb=1&size=1000`} alt="" loading="lazy" referrerPolicy="no-referrer"
                  style={{ width: "100%", maxHeight: "38vh", objectFit: "contain", display: "block", margin: "0 auto" }}
                  onError={(ev: any) => { ev.target.parentElement.style.display = "none"; }} />
              </div>
            ) : e.system ? (
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
