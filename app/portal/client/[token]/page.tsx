"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClientPortal } from "./_shared/context";
import { C, fmtDate } from "./_shared/theme";
import { uploadFileToDriveSession } from "@/lib/upload-drive-client";

// HOME — the hub's front door (reworked Jul 21 2026; idea door added Jul 22,
// Jon: "home should have a way to send an idea"). Answers: what needs me,
// what's dropping next, what's new — and invites the next build.
// Data: orders + items APIs (same as tabs).

export default function HomePage() {
  const { data, token } = useClientPortal();
  const base = `/portal/client/${token}`;
  const [orders, setOrders] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[] | null>(null);
  const [drops, setDrops] = useState<any[] | null>(null);
  const [products, setProducts] = useState<any[] | null>(null);
  const features = (data as any)?.features || [];
  const hasPipeline = features.includes("pipeline");
  const hasStudio = features.includes("studio");
  const briefs: any[] = (data as any)?.briefs || [];

  useEffect(() => {
    (async () => {
      const [o, i, d, p] = await Promise.all([
        fetch(`/api/portal/client/${token}/orders`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/portal/client/${token}/items`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/portal/client/${token}/drops`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/portal/client/${token}/products`).then(r => r.json()).catch(() => ({})),
      ]);
      setOrders(o.orders || []); setItems(i.items || []); setDrops(d.drops || []); setProducts(p.products || []);
    })();
    // eslint-disable-next-line
  }, [token]);

  if (!data) return null;
  const loading = orders === null || items === null || drops === null || products === null;
  const thumb = (id: string) => `/api/files/thumbnail?id=${id}&thumb=1&size=600`;

  // ── THE GUEST HOUSE (Jon, Jul 22): the client's own version of The House —
  //    same magazine feed, their news. A plate per thing: the art is the cover,
  //    the client's move (or status) is the headline written on it. Amber = your
  //    move; blue = we've got it; green = done/live. Sections run in Jon's order:
  //    Studio · Drops · Orders · Pipeline · Catalog, each hitting what matters. ──
  const plate = (key: string, art: string | null, eyebrow: string, verb: string, verbColor: string, meta: string, href: string) => (
    <a key={key} href={href} className="gh-plate" style={art ? { background: "#fff" } : undefined}>
      {art && <img src={art} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e: any) => { e.target.style.display = "none"; }} />}
      <span className="veil" />
      <span className="body">
        <span style={{ display: "block", fontSize: 9, fontWeight: 800, letterSpacing: "0.13em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{eyebrow}</span>
        <span style={{ display: "block", fontSize: "clamp(19px,2vw,25px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6, color: verbColor, textWrap: "balance" as any }}>{verb}.</span>
        {meta && <span style={{ display: "block", fontSize: 10.5, fontFamily: C.mono, color: C.blue, marginTop: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</span>}
      </span>
    </a>
  );
  const sec = (title: string, hint: string, href: string, seeAll: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "38px 0 14px", flexWrap: "wrap" }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{title}</h2>
      <span style={{ fontSize: 10.5, color: C.faint }}>{hint}</span>
      <Link href={href} style={{ marginLeft: "auto", fontSize: 10, color: C.muted, textDecoration: "none", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{seeAll} →</Link>
    </div>
  );

  const bThumb = (b: any) => { const t = (b.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id); return t ? thumb(t.preview_drive_file_id || t.drive_file_id) : null; };

  // Studio — ideas in motion; amber "Take a look" when we've replied.
  const studioFeed = briefs.filter(b => b.state !== "delivered").slice(0, 3);
  // Drops — building / live / cut.
  const DROP_VERB: Record<string, { verb: string; color: string }> = {
    building: { verb: "Coming together", color: C.amber }, live: { verb: "It's live", color: C.green },
    cut: { verb: "In production", color: C.blue }, closed: { verb: "Window closed", color: C.blue },
  };
  const dropFeed = (drops || []).filter(d => DROP_VERB[d.status]).slice(0, 2);
  // Orders — needs-you first, then in motion.
  const orderMove = (o: any): { verb: string; color: string; act: number } => {
    if (!o.quote_approved && ["intake", "pending"].includes(o.phase)) return { verb: "Review & approve", color: C.amber, act: 1 };
    if ((o.proofs_pending || 0) > 0) return { verb: "Approve your proofs", color: C.amber, act: 1 };
    if (o.phase === "production") return { verb: "In production", color: C.blue, act: 0 };
    if (["receiving", "shipping"].includes(o.phase)) return { verb: "On its way", color: C.blue, act: 0 };
    if (o.phase === "complete") return { verb: "Delivered", color: C.green, act: 0 };
    return { verb: "In motion", color: C.blue, act: 0 };
  };
  const orderFeed = (orders || []).filter(o => o.phase !== "cancelled").map(o => ({ o, ...orderMove(o) }))
    .sort((a, b) => b.act - a.act).slice(0, 3);
  // Pipeline — items on the move.
  const pipeMove = (it: any): { verb: string; color: string; meta: string } => {
    if (it.status === "in_stock") return { verb: "In stock", color: C.green, meta: `${(it.qty || 0).toLocaleString()} pcs ready` };
    if (it.eta) return { verb: "On the way", color: C.blue, meta: `lands ${fmtDate(it.eta)}` };
    return { verb: "In production", color: C.blue, meta: it.qty ? `${Number(it.qty).toLocaleString()} pcs` : "" };
  };
  const pipeFeed = (items || []).filter(it => !["complete", "archived", "cancelled", "on_hold"].includes(it.status)).slice(0, 4);
  // Catalog — run any of it back.
  const catFeed = (products || []).slice(0, 4);

  const moveCount = orderFeed.filter(x => x.act).length + studioFeed.filter(b => b.has_unread_external).length;
  const nothing = !loading && studioFeed.length === 0 && dropFeed.length === 0 && orderFeed.length === 0 && pipeFeed.length === 0 && catFeed.length === 0;

  return (
    <div style={{ paddingTop: "clamp(8px, 3vw, 28px)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .gh-grid{display:grid;grid-template-columns:1fr;gap:14px}
        @media(min-width:640px){.gh-grid{grid-template-columns:repeat(2,1fr)}}
        @media(min-width:1000px){.gh-grid{grid-template-columns:repeat(3,1fr)}}
        .gh-plate{position:relative;border-radius:10px;overflow:hidden;background:#141414;min-height:224px;display:flex;flex-direction:column;justify-content:flex-end;text-decoration:none;color:#fff;transition:transform .16s ease}
        .gh-plate:hover{transform:translateY(-4px)}
        .gh-plate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.92}
        .gh-plate .veil{position:absolute;inset:0;background:linear-gradient(178deg,rgba(0,0,0,.08) 20%,rgba(0,0,0,.9) 76%)}
        .gh-plate .body{position:relative;padding:16px}
        @media(prefers-reduced-motion:reduce){.gh-plate,.gh-plate:hover{transition:none;transform:none}}
      ` }} />

      {/* Hero */}
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, textAlign: "center" }}>Welcome back</div>
      <h1 style={{ fontSize: "clamp(30px,6.5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 14px", textWrap: "balance" as any, textAlign: "center" }}>
        {data.client.name}.
      </h1>

      {/* The idea door — the Studio's front-door form, in place */}
      {hasStudio && <IdeaDoor token={token} base={base} />}

      {/* Your move — one honest line, then the feed carries the detail (amber cards) */}
      {!loading && (
        <div style={{ fontSize: 13, color: C.muted, margin: "0 0 8px", lineHeight: 1.6, textAlign: "center" }}>
          {moveCount > 0
            ? <><b style={{ color: C.text }}>{moveCount}</b> thing{moveCount === 1 ? "" : "s"} need{moveCount === 1 ? "s" : ""} you below. Everything else is moving.</>
            : nothing ? "Nothing here yet. Share something above to get started." : "Nothing needs you right now. Here's where everything stands."}
        </div>
      )}

      {loading ? (
        <div style={{ color: C.faint, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Loading your house…</div>
      ) : (
        <>
          {/* ── Studio ── */}
          {hasStudio && studioFeed.length > 0 && (
            <>
              {sec("The studio.", "your ideas in motion", `${base}/studio`, "Open studio")}
              <div className="gh-grid">
                {studioFeed.map(b => plate(`st-${b.id}`, bThumb(b), b.title || "Your idea",
                  b.has_unread_external ? "Take a look" : "In the studio",
                  b.has_unread_external ? C.amber : C.blue,
                  b.preview_line || "we're on it", `${base}/studio`))}
              </div>
            </>
          )}

          {/* ── Drops ── */}
          {dropFeed.length > 0 && (
            <>
              {sec("The drops.", "your releases", `${base}/drops`, "Open drops")}
              <div className="gh-grid">
                {dropFeed.map(d => { const dv = DROP_VERB[d.status]; return plate(`dr-${d.id}`, null, d.title, dv.verb, dv.color,
                  `${d.model === "stock" ? "in-stock" : "pre-order"}${d.target_live_date ? ` · live ${fmtDate(d.target_live_date)}` : ""}`, `${base}/drops`); })}
              </div>
            </>
          )}

          {/* ── Orders ── */}
          {orderFeed.length > 0 && (
            <>
              {sec("Your orders.", "where each one stands", `${base}/orders`, "All orders")}
              <div className="gh-grid">
                {orderFeed.map(({ o, verb, color }) => {
                  const art = (o.items || []).map((it: any) => it.thumb_id).find(Boolean);
                  return plate(`or-${o.id}`, art ? thumb(art) : null,
                    o.job_number || "Your order", verb, color, o.title || "", `${base}/orders?open=${o.id}`);
                })}
              </div>
            </>
          )}

          {/* ── Pipeline ── */}
          {hasPipeline && pipeFeed.length > 0 && (
            <>
              {sec("In flight.", "everything on the move", `${base}/items`, "Full pipeline")}
              <div className="gh-grid">
                {pipeFeed.map(it => { const pm = pipeMove(it); return plate(`pi-${it.id}`, it.thumb_id ? thumb(it.thumb_id) : null,
                  it.name, pm.verb, pm.color, pm.meta, `${base}/items`); })}
              </div>
            </>
          )}

          {/* ── Catalog ── */}
          {catFeed.length > 0 && (
            <>
              {sec("Your catalog.", "run any of it back", `${base}/reorder`, "Open catalog")}
              <div className="gh-grid">
                {catFeed.map(p => plate(`ca-${p.id}`, p.artFileId ? thumb(p.artFileId) : null, p.title, "Run it back", C.text,
                  `${p.format || "product"}${p.retail != null ? ` · $${p.retail}` : ""}`, `${base}/reorder`))}
              </div>
            </>
          )}

          <div style={{ height: 60 }} />
        </>
      )}
    </div>
  );
}

// ── The idea door, in place — the Studio's front-door form living on Home.
// Same rules (a name and a picture is all it takes), same POST + upload
// chain, so the idea lands exactly where a Studio submission lands.
function IdeaDoor({ token, base }: { token: string; base: string }) {
  const [open, setOpen] = useState(false);
  // two kinds of sharing (Jon, Jul 22): a general idea (studio ping-pong)
  // vs "I have this product ready to make" (art's done — move it)
  const [kind, setKind] = useState<"idea" | "ready">("idea");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const canSend = !!title.trim() && files.length > 0;

  async function submit() {
    if (!canSend || busy) return;
    setBusy(true); setError(""); setState("Sending…");
    try {
      const res = await fetch(`/api/portal/client/${token}/ideas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), notes: notes.trim(), kind }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || "Couldn't save the idea."); return; }
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        setState(`Uploading ${i + 1} of ${files.length}…`);
        try {
          const f = files[i];
          const sess = await fetch(`/api/portal/client/${token}/briefs/${body.briefId}/upload-session`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_name: f.name, mime_type: f.type || "application/octet-stream" }),
          });
          if (!sess.ok) throw new Error("session");
          const { uploadUrl } = await sess.json();
          const { drive_file_id } = await uploadFileToDriveSession(uploadUrl, f);
          await fetch(`/api/portal/client/${token}/briefs/${body.briefId}/upload-session/complete`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ drive_file_id, file_name: f.name, mime_type: f.type || "application/octet-stream", file_size: f.size }),
          });
        } catch { failed++; }
      }
      if (failed > 0) setError(`Idea sent, but ${failed} attachment${failed === 1 ? "" : "s"} didn't make it — add ${failed === 1 ? "it" : "them"} from the Studio.`);
      setSent(title.trim());
      setTitle(""); setNotes(""); setFiles([]); setOpen(false);
    } catch { setError("Couldn't save the idea."); }
    finally { setBusy(false); setState(""); }
  }

  if (sent) return (
    <div style={{ textAlign: "center", margin: "0 0 26px", fontSize: 13, color: C.text }}>
      <span style={{ fontWeight: 800 }}>&ldquo;{sent}&rdquo; landed with our team.</span>{" "}
      <Link href={`${base}/studio`} style={{ color: "#fd3aa3", fontWeight: 800, textDecoration: "none" }}>Watch it in the Studio →</Link>
    </div>
  );

  if (!open) return (
    <div style={{ textAlign: "center", margin: "0 0 26px" }}>
      <button onClick={() => setOpen(true)}
        style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "12px 26px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
        Share something →
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: 560, margin: "0 auto 30px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "16px 18px", textAlign: "left" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {([["idea", "A general idea"], ["ready", "Ready to make"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)}
            style={{ borderRadius: 999, border: kind === k ? "1px solid #fff" : `1px solid ${C.border}`, background: kind === k ? "#fff" : "transparent", color: kind === k ? C.bg : C.muted, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 14px", cursor: "pointer", fontFamily: C.font }}>
            {label}
          </button>
        ))}
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Calling it something"
        style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 17, fontWeight: 800, fontFamily: C.font, padding: "4px 0", borderBottom: `1px solid ${C.border}` }} />
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={kind === "idea" ? "What else? Vibe, references, garment, timing — anything." : "What is it, the sizes you'll want, when you need it — anything we should know."}
        style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 13, fontFamily: C.font, padding: "10px 0 4px", resize: "vertical" }} />
      {files.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "4px 0 8px" }}>
          {files.map((f, i) => (
            <span key={i} style={{ fontSize: 10.5, fontFamily: C.mono, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999, padding: "5px 11px" }}>
              {f.name} <span onClick={() => setFiles(prev => prev.filter((_, x) => x !== i))} style={{ cursor: "pointer", marginLeft: 4 }}>×</span>
            </span>
          ))}
        </div>
      )}
      {error && <div style={{ fontSize: 12, fontWeight: 700, color: "#ff5a6e", margin: "6px 0" }}>{error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <input ref={fileInput} type="file" multiple accept="image/*,.pdf,.ai,.psd,.eps,.svg" style={{ display: "none" }}
          onChange={e => { setFiles(prev => [...prev, ...Array.from(e.target.files || [])]); if (fileInput.current) fileInput.current.value = ""; }} />
        <button onClick={() => fileInput.current?.click()}
          style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999, padding: "11px 17px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
          + Photos &amp; files
        </button>
        <button onClick={submit} disabled={busy || !canSend}
          style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "11px 22px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: busy || !canSend ? "default" : "pointer", opacity: busy || !canSend ? 0.5 : 1, fontFamily: C.font }}>
          {busy ? (state || "Sending…") : "Send it"}
        </button>
        <span style={{ fontSize: 11, color: C.faint }}>
          {!canSend ? "A name and a picture is all it takes." : kind === "ready" ? "Straight to our team to get moving." : "Lands with our team."}
        </span>
        <button onClick={() => setOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>Not yet</button>
      </div>
    </div>
  );
}
