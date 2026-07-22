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
  const hasPipeline = ((data as any)?.features || []).includes("pipeline");
  const hasStudio = ((data as any)?.features || []).includes("studio");

  useEffect(() => {
    (async () => {
      try {
        const [o, i] = await Promise.all([
          fetch(`/api/portal/client/${token}/orders`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/portal/client/${token}/items`).then(r => r.json()).catch(() => ({})),
        ]);
        setOrders(o.orders || []);
        setItems(i.items || []);
      } catch { setOrders([]); setItems([]); }
    })();
    // eslint-disable-next-line
  }, [token]);

  if (!data) return null;

  const unpaid = (orders || []).filter(o => o.payment_status === "unpaid" || o.payment_status === "partial");
  const needsAction = (orders || []).filter(o => !["complete", "cancelled"].includes(o.phase) && ((o.phase === "pending" && !o.quote_approved) || (o.proofs_pending || 0) > 0));
  const active = (items || []).filter(it => !["complete", "archived", "cancelled", "on_hold"].includes(it.status));
  const landing = active
    .filter(it => it.eta && it.status !== "in_stock")
    .sort((a, b) => String(a.eta).localeCompare(String(b.eta)))
    .slice(0, 6);
  const storeReady = active.filter(it => it.status === "in_stock").slice(0, 6);
  const loadingData = orders === null || items === null;

  const pills: { label: string; href: string }[] = [];
  if (needsAction.length > 0) pills.push({
    label: `${needsAction.length} order${needsAction.length === 1 ? "" : "s"} awaiting your approval`,
    // One order -> open it directly; several -> the needs-approval filter.
    href: needsAction.length === 1 ? `${base}/orders?open=${needsAction[0].id}` : `${base}/orders?filter=pending`,
  });

  const thumb = (id: string) => `/api/files/thumbnail?id=${id}&thumb=1&size=500`;

  const Strip = ({ title, sub, list, badge }: { title: string; sub: string; list: any[]; badge: (it: any) => string }) => (
    <section style={{ marginBottom: 38 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{title}</h2>
        <Link href={`${base}/items`} style={{ fontSize: 10, color: C.muted, textDecoration: "none", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{sub} →</Link>
      </div>
      <div className="hm-strip">
        {list.map(it => (
          <Link key={it.id} href={`${base}/items`} className="hm-card"
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", textDecoration: "none", color: C.text, display: "block" }}>
            <div style={{ background: "#fff", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {it.thumb_id
                ? <img src={thumb(it.thumb_id)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                : <span style={{ color: "#bbb", fontSize: 11 }}>No preview</span>}
            </div>
            <div style={{ padding: "10px 12px 12px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{it.name}</div>
              <div style={{ fontSize: 9.5, fontFamily: C.mono, color: C.muted, marginTop: 5 }}>{badge(it)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <div style={{ paddingTop: "clamp(8px, 3vw, 28px)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .hm-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
        @media(min-width:720px){.hm-strip{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}}
        .hm-card{transition:transform .15s ease,border-color .15s ease}
        .hm-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        @media(prefers-reduced-motion:reduce){.hm-card,.hm-card:hover{transition:none;transform:none}}
      ` }} />

      {/* Hero */}
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, textAlign: "center" }}>
        Welcome back
      </div>
      <h1 style={{ fontSize: "clamp(30px,6.5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 14px", textWrap: "balance" as any, textAlign: "center" }}>
        {data.client.name}.
      </h1>

      {/* The idea door — fills out IN PLACE (Jon, Jul 22): tap → the same
          name + picture form the Studio runs, posting to the same machinery.
          No page hop; the idea lands where it needs to go. */}
      {hasStudio && <IdeaDoor token={token} base={base} />}

      {/* What needs you */}
      {pills.length > 0 ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "0 0 36px", justifyContent: "center" }}>
          {pills.map(n => (
            <Link key={n.label} href={n.href}
              style={{ background: "#fff", color: C.bg, borderRadius: 999, padding: "11px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", textDecoration: "none" }}>
              {n.label} →
            </Link>
          ))}
        </div>
      ) : !loadingData ? (
        <div style={{ fontSize: 14, color: C.muted, margin: "0 0 36px", lineHeight: 1.6, textAlign: "center" }}>
          Nothing needs you right now. Here&rsquo;s what&rsquo;s moving.
        </div>
      ) : <div style={{ height: 36 }} />}

      {loadingData ? (
        <div style={{ color: C.faint, fontSize: 13, padding: "30px 0", textAlign: "center" }}>Loading…</div>
      ) : (
        <>
          {hasPipeline && storeReady.length > 0 && (
            <Strip title="Live-ready." sub="See all" list={storeReady}
              badge={(it) => `${(it.qty || 0).toLocaleString()} pcs ready`} />
          )}
          {hasPipeline && landing.length > 0 && (
            <Strip title="Coming soon." sub="Full pipeline" list={landing}
              badge={(it) => `lands ${fmtDate(it.eta)}`} />
          )}
          {hasPipeline && landing.length === 0 && storeReady.length === 0 && (
            <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "20px 0 40px" }}>
              Nothing in production right now. Start an idea, or run something back from your catalog.
            </div>
          )}

          {/* Quick doors */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", margin: "6px 0 20px" }}>
            {[...(hasStudio ? [{ label: "Studio", href: `${base}/studio` }] : []), { label: "Catalog", href: `${base}/reorder` }, { label: "Orders", href: `${base}/orders` }, ...(hasPipeline ? [{ label: "Pipeline", href: `${base}/items` }] : [])].map(d => (
              <Link key={d.label} href={d.href}
                style={{ border: `1px solid ${C.border}`, color: C.muted, borderRadius: 999, padding: "10px 20px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "none" }}>
                {d.label}
              </Link>
            ))}
          </div>
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
        body: JSON.stringify({ title: title.trim(), notes: notes.trim() }),
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
        Got an idea? Start it →
      </button>
    </div>
  );

  return (
    <div style={{ maxWidth: 560, margin: "0 auto 30px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "16px 18px", textAlign: "left" }}>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Calling it something"
        style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 17, fontWeight: 800, fontFamily: C.font, padding: "4px 0", borderBottom: `1px solid ${C.border}` }} />
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="What else? Vibe, references, garment, timing — anything."
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
          {!canSend ? "A name and a picture is all it takes." : "Lands with our team."}
        </span>
        <button onClick={() => setOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>Not yet</button>
      </div>
    </div>
  );
}
