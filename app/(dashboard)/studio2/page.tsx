"use client";
// STUDIO V2 — the internal side of the client hub's Studio (Jul 21 2026).
// Same magazine, operator verbs: the feed buckets by whose move it is, cards
// are art-first, and the sheet is the SAME ping-pong thread the client sees
// plus the operator layer (reply with client-visible/internal toggle, share
// WIP files to the client, spec lines read). First magazine-ized internal
// surface — the client-workspace pattern's proof piece.
// Legacy /art-studio stays untouched for the full management tooling.
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { H } from "@/components/hub/theme";

const thumbSrc = (id: string, size = 500) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

const DONE_STATES = ["final_approved", "pending_prep", "production_ready", "delivered"];
const DESIGNER_STATES = ["sent", "in_progress", "wip_review", "revisions"];
const QUIET_DAYS = 30;

const STATE_WORDS: Record<string, { label: string; color: string }> = {
  draft: { label: "New idea", color: H.amber },
  sent: { label: "With designer", color: H.blue },
  in_progress: { label: "Sketching", color: H.blue },
  wip_review: { label: "WIP review", color: H.blue },
  client_review: { label: "With the client", color: "#fd3aa3" },
  revisions: { label: "Reworking", color: H.blue },
  final_approved: { label: "Greenlit", color: H.green },
  pending_prep: { label: "Greenlit", color: H.green },
  production_ready: { label: "Print-ready", color: H.green },
  delivered: { label: "Delivered", color: H.green },
};

type Bucket = "your_move" | "designers" | "clients" | "rack" | "quiet";
const BUCKETS: { key: Bucket; title: string; hint: string; color?: string }[] = [
  { key: "your_move", title: "Your move.", hint: "new ideas + client words waiting on this building", color: H.amber },
  { key: "designers", title: "With designers.", hint: "out for sketching" },
  { key: "clients", title: "With clients.", hint: "they're reviewing — their move" },
  { key: "rack", title: "The rack.", hint: "greenlit — drop-planner shelf, ready to become items", color: H.green },
  { key: "quiet", title: "Gone quiet.", hint: "30d+ without a move — nudge or shelve" },
];

function bucketOf(b: any): Bucket {
  const clientAt = b.last_client_activity?.at || "";
  const hpdAt = [b.last_hpd_activity?.at || "", b.hpd_last_seen_at || ""].sort().pop() || "";
  const yourMove = b.state === "draft" || (!!clientAt && clientAt > hpdAt);
  if (DONE_STATES.includes(b.state)) return "rack";
  if (yourMove) return "your_move";
  const last = [clientAt, b.last_designer_activity?.at || "", b.last_hpd_activity?.at || "", b.created_at || ""].sort().pop() || "";
  if (last && Date.now() - new Date(last).getTime() > QUIET_DAYS * 86400000) return "quiet";
  if (b.state === "client_review") return "clients";
  if (DESIGNER_STATES.includes(b.state)) return "designers";
  return "your_move";
}

const briefThumb = (b: any): string | null => {
  const t = (b.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
  const id = t?.preview_drive_file_id || t?.drive_file_id;
  return id ? thumbSrc(id) : null;
};

export default function Studio2Page() {
  const [briefs, setBriefs] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [q, setQ] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/art-briefs");
      const body = await res.json();
      setBriefs(body.briefs || []);
    } catch { setBriefs([]); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const list = (briefs || []).filter((b: any) => !b.client_aborted_at);
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((b: any) => `${b.title || ""} ${b.clients?.name || ""}`.toLowerCase().includes(needle));
  }, [briefs, q]);

  return (
    <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 24, color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .sv-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:22px 14px}
        @media(min-width:900px){.sv-grid{grid-template-columns:repeat(4,1fr);gap:28px 18px}}
        .sv-card{background:${H.panel};border:1px solid ${H.line};border-radius:14px;overflow:hidden;cursor:pointer;text-align:left;color:${H.text};font-family:${H.font};padding:0;transition:transform .15s ease,border-color .15s ease;display:block;width:100%}
        .sv-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .sv-back{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:34px 14px;overflow-y:auto}
        .sv-sheet{background:${H.panel};border:1px solid ${H.line};border-radius:20px;max-width:760px;width:100%;overflow:hidden}
        @media(prefers-reduced-motion:reduce){.sv-card,.sv-card:hover{transition:none;transform:none}}
      ` }} />

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "26px 0 80px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>Product development · internal</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "6px 0 8px" }}>The studio.</h1>
          <a href="/art-studio" style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, textDecoration: "none" }}>legacy tooling →</a>
        </div>
        <div style={{ fontSize: 13.5, color: H.dim, maxWidth: "58ch", lineHeight: 1.6, marginBottom: 8 }}>
          The other paddle of the clients&rsquo; ping-pong table. Same threads, same art — your verbs.
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ideas or clients…"
          style={{ margin: "12px 0 8px", padding: "10px 16px", fontSize: 13, background: H.card, border: `1px solid ${H.line}`, borderRadius: 999, outline: "none", color: H.text, fontFamily: H.font, width: 280, maxWidth: "100%" }} />

        {briefs === null ? (
          <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>Loading the studio…</div>
        ) : BUCKETS.map(bk => {
          const list = filtered.filter((b: any) => bucketOf(b) === bk.key)
            .sort((a: any, b: any) => {
              const la = [a.last_client_activity?.at, a.last_designer_activity?.at, a.last_hpd_activity?.at, a.created_at].filter(Boolean).sort().pop() || "";
              const lb = [b.last_client_activity?.at, b.last_designer_activity?.at, b.last_hpd_activity?.at, b.created_at].filter(Boolean).sort().pop() || "";
              return lb.localeCompare(la);
            });
          if (!list.length) return null;
          return (
            <section key={bk.key} style={{ marginTop: 40 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: bk.color || H.text }}>{bk.title}</h2>
                <span style={{ fontSize: 10, fontWeight: 800, color: H.faint, fontFamily: H.mono }}>{list.length}</span>
                <span style={{ fontSize: 10.5, color: H.faint }}>{bk.hint}</span>
              </div>
              <div className="sv-grid">
                {list.map((b: any) => {
                  const w = STATE_WORDS[b.state] || { label: b.state, color: H.faint };
                  const src = briefThumb(b);
                  const ps = Array.isArray(b.product_spec?.products) ? b.product_spec.products : [];
                  const lastAt = [b.last_client_activity?.at, b.last_designer_activity?.at, b.last_hpd_activity?.at, b.created_at].filter(Boolean).sort().pop();
                  return (
                    <button key={b.id} className="sv-card" onClick={() => setOpen(b)}>
                      {src ? (
                        <div style={{ background: "#fff", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                        </div>
                      ) : (
                        <div style={{ aspectRatio: "1", display: "flex", alignItems: "flex-end", padding: 14, background: H.surface }}>
                          <span style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.15, color: H.dim }}>{b.title || "Untitled"}</span>
                        </div>
                      )}
                      <div style={{ padding: "10px 13px 13px" }}>
                        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.clients?.name || "—"}</div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, marginTop: 3, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{b.title || "Untitled idea"}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: w.color }}>{w.label}</span>
                          {b.assigned_to && <span style={{ fontSize: 9, color: H.faint, fontFamily: H.mono }}>{b.assigned_to}</span>}
                          <span style={{ fontSize: 9.5, color: H.faint, fontFamily: H.mono }}>{fmtDate(lastAt)}</span>
                        </div>
                        {ps.length > 0 && (
                          <div style={{ fontSize: 9.5, fontFamily: H.mono, color: H.dim, marginTop: 4 }}>
                            {ps.slice(0, 3).map((x: any) => [x.format || "item", x.retail != null ? `$${x.retail}` : null].filter(Boolean).join(" ")).join(" · ")}{ps.length > 3 ? ` +${ps.length - 3}` : ""}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {open && <OpsBriefSheet brief={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function OpsBriefSheet({ brief, onClose }: { brief: any; onClose: () => void }) {
  const supabase = createClient();
  const [detail, setDetail] = useState<any>(null);
  const [note, setNote] = useState("");
  const [vis, setVis] = useState<"all" | "hpd_designer">("all");
  const [busy, setBusy] = useState(false);
  const [heroIdx, setHeroIdx] = useState<number | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/art-briefs?id=${brief.id}`);
      const body = await res.json();
      setDetail(body);
    } catch { setDetail({}); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [brief.id]);
  useEffect(() => { threadEnd.current?.scrollIntoView({ block: "end" }); }, [detail]);

  const files = (detail?.files || []).filter((f: any) => (f.preview_drive_file_id || f.drive_file_id) && !/pdf/i.test(f.mime_type || ""));
  const hero = files.length ? files[heroIdx == null ? files.length - 1 : Math.min(heroIdx, files.length - 1)] : null;
  const msgs = detail?.messages || [];
  const spec = brief.product_spec || {};
  const products = Array.isArray(spec.products) ? spec.products : [];
  const w = STATE_WORDS[brief.state] || { label: brief.state, color: H.faint };

  async function send() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/art-briefs/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief_id: brief.id, message: note.trim(), visibility: vis }),
      });
      setNote(""); await load();
    } finally { setBusy(false); }
  }

  async function toggleShare(f: any) {
    const next = f.shared_with_client_at ? null : new Date().toISOString();
    await supabase.from("art_brief_files").update({ shared_with_client_at: next } as never).eq("id", f.id);
    await load();
  }

  return (
    <div className="sv-back" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sv-sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint }}>{brief.clients?.name || "—"}</div>
            <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, marginTop: 2 }}>{brief.title || "Untitled idea"}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: w.color }}>{w.label}</span>
              {brief.assigned_to && <span style={{ fontSize: 10, color: H.faint, fontFamily: H.mono }}>designer: {brief.assigned_to}</span>}
              <span title="Drop planner is next — the rack becomes slottable" style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: H.faint, border: `1px dashed ${H.line}`, borderRadius: 999, padding: "5px 11px", cursor: "default" }}>Slot into drop · soon</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {hero && (
          <div style={{ marginTop: 10 }}>
            <div style={{ background: "#fff", position: "relative" }}>
              <img src={thumbSrc(hero.preview_drive_file_id || hero.drive_file_id, 700)} alt="" referrerPolicy="no-referrer"
                style={{ width: "100%", maxHeight: "36vh", objectFit: "contain", display: "block", margin: "0 auto" }}
                onError={(e: any) => { e.target.parentElement.style.display = "none"; }} />
              <span style={{ position: "absolute", right: 10, bottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: hero.shared_with_client_at || hero.uploader_role === "client" ? "#3c9a2e" : "#b7791f", background: "rgba(255,255,255,0.9)", borderRadius: 999, padding: "4px 10px" }}>
                  {hero.uploader_role === "client" ? "From client" : hero.shared_with_client_at ? "Client sees this" : "Internal only"}
                </span>
                {hero.uploader_role !== "client" && (
                  <button onClick={() => toggleShare(hero)}
                    style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "#0a0a0a", color: "#fff", border: "none", borderRadius: 999, padding: "5px 11px", cursor: "pointer", fontFamily: H.font }}>
                    {hero.shared_with_client_at ? "Unshare" : "Share to client"}
                  </button>
                )}
              </span>
            </div>
            {files.length > 1 && (
              <div style={{ display: "flex", gap: 8, padding: "10px 22px 0", overflowX: "auto", scrollbarWidth: "none" as any }}>
                {files.map((f: any, i: number) => {
                  const active = (heroIdx == null ? files.length - 1 : heroIdx) === i;
                  return (
                    <button key={f.id} onClick={() => setHeroIdx(i)}
                      style={{ flexShrink: 0, width: 50, height: 50, borderRadius: 9, overflow: "hidden", background: "#fff", border: active ? "2px solid #fff" : `1px solid ${H.line}`, padding: 0, cursor: "pointer", opacity: active ? 1 : 0.6, position: "relative" }}>
                      <img src={thumbSrc(f.preview_drive_file_id || f.drive_file_id, 200)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                      {!(f.shared_with_client_at || f.uploader_role === "client") && <span style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 2px rgba(244,178,43,.75)", borderRadius: 8, pointerEvents: "none" }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {products.length > 0 && (
          <div style={{ padding: "14px 22px 0" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 8 }}>Their build-out — future items</div>
            {products.map((x: any, i: number) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "7px 0", borderBottom: `1px solid ${H.line}`, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase" }}>{x.format || "Item"}</span>
                {x.retail != null && <span style={{ fontSize: 11.5, fontFamily: H.mono, color: H.dim }}>${x.retail} retail</span>}
                {x.model && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: x.model === "preorder" ? "#fd3aa3" : H.blue }}>{x.model === "preorder" ? "Pre-order" : "Fixed run"}</span>}
                {x.run_size != null && <span style={{ fontSize: 11, fontFamily: H.mono, color: H.faint }}>~{Number(x.run_size).toLocaleString()} pcs</span>}
                {x.notes && <span style={{ flexBasis: "100%", fontSize: 11.5, color: H.dim, lineHeight: 1.5 }}>{x.notes}</span>}
              </div>
            ))}
          </div>
        )}

        {/* ── The thread — every voice, whispers included ── */}
        <div style={{ padding: "16px 22px 4px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "34vh", overflowY: "auto" }}>
          {detail === null ? (
            <div style={{ color: H.faint, fontSize: 12 }}>Loading the thread…</div>
          ) : msgs.length === 0 && !brief.concept ? (
            <div style={{ color: H.faint, fontSize: 12.5 }}>No words yet.</div>
          ) : (
            <>
              {brief.concept && (
                <div style={{ alignSelf: "flex-start", maxWidth: "84%", background: H.surface, borderRadius: "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                  <span style={{ display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginBottom: 3 }}>{brief.clients?.name || "Client"} · the idea</span>
                  {brief.concept}
                </div>
              )}
              {msgs.map((m: any) => {
                const mine = m.sender_role !== "client";
                const whisper = m.visibility && m.visibility !== "all";
                const marker = String(m.message || "").startsWith("✎") || String(m.message || "").startsWith("✓");
                if (marker) return <div key={m.id} style={{ alignSelf: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: String(m.message).startsWith("✓") ? H.green : H.faint }}>{m.message}</div>;
                return (
                  <div key={m.id} style={{
                    alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "84%",
                    background: whisper ? "rgba(244,178,43,0.09)" : mine ? "#fff" : H.surface,
                    color: whisper ? H.text : mine ? H.ink : H.text,
                    border: whisper ? `1px dashed rgba(244,178,43,.5)` : "none",
                    borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    padding: "9px 13px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap",
                  }}>
                    <span style={{ display: "block", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: whisper ? H.amber : mine ? "rgba(10,10,10,0.45)" : H.faint, marginBottom: 3 }}>
                      {m.sender_name || m.sender_role}{whisper ? " · internal" : ""} · {fmtTime(m.created_at)}
                    </span>
                    {m.message}
                  </div>
                );
              })}
            </>
          )}
          <div ref={threadEnd} />
        </div>

        {/* ── Composer: one thread, two voices ── */}
        <div style={{ padding: "12px 22px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder={vis === "all" ? "Reply to the client…" : "Internal note — team + designer only…"}
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 10, border: vis === "all" ? `1px solid ${H.line}` : `1px dashed rgba(244,178,43,.6)`, background: H.surface, color: H.text, fontSize: 13, fontFamily: H.font, outline: "none", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", gap: 6 }}>
              {([["all", "Client-visible"], ["hpd_designer", "Internal"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setVis(k)}
                  style={{ borderRadius: 999, border: vis === k ? "1px solid #fff" : `1px solid ${H.line}`, background: vis === k ? "#fff" : "transparent", color: vis === k ? H.ink : H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "9px 14px", cursor: "pointer", fontFamily: H.font }}>
                  {label}
                </button>
              ))}
            </span>
            <button onClick={send} disabled={busy || !note.trim()}
              style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "12px 24px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: busy || !note.trim() ? "default" : "pointer", opacity: busy || !note.trim() ? 0.5 : 1, fontFamily: H.font }}>
              {busy ? "Sending…" : vis === "all" ? "Send to client" : "Post internal"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
