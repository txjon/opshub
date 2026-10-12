"use client";

// The client CATALOG + ARCHIVE — shared by the client page (/clients/[id]) and
// the view-only /catalog page (Oct 2026: a creative needs a client's art
// without the client page's balances, orders and contacts). Moved verbatim
// from the client page; CatalogRail gained readOnly.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasRun } from "@/lib/run-gate";
import { isCostingLocked } from "@/lib/costing-lock";
import { H } from "@/components/hub/theme";

const PURPLE = "#fd3aa3";

// Card/grid/row classes the catalog, archive and client page share.
export const CLIENT_CARD_CSS = `
        .cs-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px 14px}
        @media(min-width:900px){.cs-grid{grid-template-columns:repeat(4,1fr)}}
        .cs-card{background:${H.panel};border:1px solid ${H.line};border-radius:14px;overflow:hidden;cursor:pointer;text-align:left;color:${H.text};font-family:${H.font};padding:0;transition:transform .15s ease,border-color .15s ease;display:block;width:100%;text-decoration:none}
        .cs-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .cs-row{display:flex;gap:14px;align-items:baseline;padding:13px 0;border-bottom:1px solid ${H.line};text-decoration:none;color:${H.text};flex-wrap:wrap}
        .cs-row:hover{background:rgba(255,255,255,0.02)}
        @media(prefers-reduced-motion:reduce){.cs-card,.cs-card:hover{transition:none;transform:none}}
`;
const thumbSrc = (id: string, size = 300) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmtShort = (iso?: string | null) => iso ? new Date(String(iso).includes("T") ? iso : iso + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

// Catalog category chips — IDENTICAL definitions to the client hub's reorder
// page (Tees / Hoodies / Hats / Patches / Everything else), so the internal
// catalog filters the same pieces into the same buckets the client sees.
export const CATALOG_CATS: { key: string; label: string; match: (g: string) => boolean }[] = [
  { key: "tees", label: "Tees", match: g => g.includes("tee") || g === "tank" || g.includes("shirt") },
  { key: "hoodies", label: "Hoodies", match: g => g.includes("hoodie") || g.includes("crewneck") || g.includes("sweat") },
  { key: "hats", label: "Hats", match: g => g.includes("hat") || g.includes("beanie") || g.includes("cap") },
  { key: "patches", label: "Patches", match: g => g.includes("patch") },
];
export const catOfGarment = (g: string | null) => {
  const x = (g || "").toLowerCase();
  return CATALOG_CATS.find(c => c.match(x))?.key || "other";
};

// Catalog pieces — SAME shape/order as the client hub's reorder catalog:
// dedupe by name|blank_sku, newest instance represents the piece, newest
// first (Jon, Aug 3: internal catalog mirrors what the client sees). Only RUN
// pieces count (lib/run-gate). Jobs need items(id, name, created_at,
// blank_sku, blank_vendor, garment_type, drive_link, pipeline_stage,
// sell_per_unit, buy_sheet_lines) + phase / job_number / qb_invoice_number.
export function buildCatalogPieces(jobs: any[]): any[] {
      const byKey = new Map<string, any>();
      const flat = jobs.flatMap(j => (j.items || []).map((i: any) => ({ ...i, job: j })))
        .filter((i: any) => hasRun(i.job.phase, i.pipeline_stage))
        .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      for (const it of flat) {
        if (!(it.name || "").trim()) continue;
        const key = `${(it.name || "").trim().toLowerCase()}|${(it.blank_sku || "").trim().toLowerCase()}`;
        const inst = {
          itemId: it.id, jobId: it.job.id, driveLink: it.drive_link || null,
          ref: it.job.qb_invoice_number ? `#${it.job.qb_invoice_number}` : it.job.job_number,
          date: it.created_at,
          qty: (it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0),
          sizes: (it.buy_sheet_lines || []).filter((l: any) => (l.qty_ordered || 0) > 0),
          sell: it.sell_per_unit != null ? Number(it.sell_per_unit) : null,
        };
        const ex = byKey.get(key);
        if (ex) { ex.runs++; ex.instances.push(inst); continue; }
        byKey.set(key, { key, itemId: it.id, name: it.name, blank: [it.blank_vendor, it.blank_sku].filter(Boolean).join(" "), jobId: it.job.id, runs: 1, cat: catOfGarment(it.garment_type), instances: [inst] });
      }
      return Array.from(byKey.values());
}

// readOnly (the /catalog page — view + download, Oct 2026): hides Run it /
// Flip it, the reorder cart, job links and HPD sell prices. Browsing, the
// piece detail, View art and downloads stay.
export function CatalogRail({ products, briefs, model, router, secHead, thumbs, clientId, readOnly = false }: any) {
  const [cat, setCat] = useState<string>("all");
  const [detail, setDetail] = useState<any | null>(null);
  // "View art" gallery — every file on the piece (all runs), view + download.
  const [artFiles, setArtFiles] = useState<any[] | null>(null);   // null = closed
  const [artLoading, setArtLoading] = useState(false);
  // Reorder cart — the hub's flow, internal door. Prefill = last run's sizes.
  const [cart, setCart] = useState<Record<string, { name: string; sizes: Record<string, number> }>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [cartNote, setCartNote] = useState("");
  const [cartBusy, setCartBusy] = useState(false);
  const [cartErr, setCartErr] = useState<string | null>(null);
  const addToCart = (pc: any) => {
    const last = pc.instances[0];
    const sizes: Record<string, number> = {};
    for (const l of (last?.sizes || [])) sizes[l.size] = Number(l.qty_ordered) || 0;
    setCart(c => ({ ...c, [last.itemId]: { name: pc.name, sizes } }));
  };
  const cartCount = Object.keys(cart).length;
  // Where the cart lands: a NEW intake job (default) or one of this client's
  // open jobs that can still take items (not quoted/approved — lib/costing-lock).
  // Same engine either way (lib/reorder-cart). Oct 2026: Taylor needed past
  // pieces added to a pre-order she'd already started.
  const [cartDest, setCartDest] = useState<string>("new");
  const [openJobs, setOpenJobs] = useState<{ id: string; job_number: string | null; title: string | null }[]>([]);
  useEffect(() => {
    if (!cartOpen || !clientId) return;
    createClient().from("jobs").select("id, job_number, title, phase, quote_approved, type_meta")
      .eq("client_id", clientId).not("phase", "in", "(complete,cancelled)").order("created_at", { ascending: false }).limit(30)
      .then(({ data }) => setOpenJobs(((data || []) as any[]).filter(j => !isCostingLocked(j))));
  }, [cartOpen, clientId]);
  const submitCart = async () => {
    setCartBusy(true); setCartErr(null);
    try {
      const items = Object.entries(cart).map(([itemId, v]) => ({ itemId, sizes: v.sizes }));
      const res = await fetch(`/api/clients/${clientId}/reorder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, note: cartNote, ...(cartDest !== "new" ? { to_job_id: cartDest } : {}) }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Couldn't create the reorder");
      router.push(`/jobs/${b.jobId}`);
    } catch (e: any) { setCartErr(e.message); setCartBusy(false); }
  };
  const supabase = createClient();
  const openArt = async (pc: any) => {
    setArtLoading(true); setArtFiles([]);
    try {
      const ids = pc.instances.map((r: any) => r.itemId);
      const { data } = await supabase.from("item_files")
        .select("id, item_id, file_name, stage, drive_file_id, drive_link, mime_type, created_at")
        .in("item_id", ids).is("superseded_at", null).neq("stage", "packing_slip")
        .order("created_at", { ascending: false });
      setArtFiles(data || []);
    } finally { setArtLoading(false); }
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const artFor = (p: any) => {
    const b = briefs.find((x: any) => x.id === p.brief_id);
    const t = (b?.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
    return t ? thumbSrc(t.preview_drive_file_id || t.drive_file_id) : null;
  };
  async function runIt(p: any) {
    setBusy(p.id); setErr(null);
    try {
      const res = await fetch(`/api/products/${p.id}/run`, { method: "POST" });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Couldn't start the run");
      router.push(`/jobs/${b.jobId}`);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }
  async function flipIt(p: any) {
    setBusy(`flip-${p.id}`); setErr(null);
    try {
      const res = await fetch(`/api/products/${p.id}/flip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Couldn't open the flip");
      router.push(`/studio?brief=${b.briefId}`);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }
  return (
    <>
      {secHead("The catalog.", "their products — greenlit designs and everything ever produced")}
      {err && <div style={{ color: H.red, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{err}</div>}
      {products.length > 0 && (
        <div className="cs-grid" style={{ marginBottom: 30 }}>
          {products.map((p: any) => {
            const src = artFor(p);
            return (
              <div key={p.id} className="cs-card" style={{ cursor: "default" }}>
                {src ? (
                  <div style={{ background: "#fff", aspectRatio: "1" }}>
                    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                  </div>
                ) : (
                  <div style={{ aspectRatio: "1", display: "flex", alignItems: "flex-end", padding: 14, background: H.surface }}>
                    <span style={{ fontSize: 14, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.15, color: H.dim }}>{p.title}</span>
                  </div>
                )}
                <div style={{ padding: "10px 13px 13px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{p.title}</div>
                  <div style={{ fontSize: 10, fontFamily: H.mono, color: H.blue, marginTop: 3 }}>
                    {p.format || "product"}{p.retail != null ? ` · $${p.retail} retail` : ""}{p.model && p.model !== "not_sure" ? ` · ${p.model === "preorder" ? "pre-order" : "fixed run"}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {!readOnly && (<>
                    <button onClick={() => runIt(p)} disabled={busy === p.id}
                      style={{ background: "#fff", color: H.ink, border: 0, borderRadius: 999, padding: "8px 14px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, opacity: busy === p.id ? 0.5 : 1 }}>
                      {busy === p.id ? "Starting…" : "Run it →"}
                    </button>
                    <button onClick={() => flipIt(p)} disabled={busy === `flip-${p.id}`}
                      style={{ background: "transparent", color: PURPLE, border: `1px solid ${PURPLE}`, borderRadius: 999, padding: "8px 14px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, opacity: busy === `flip-${p.id}` ? 0.5 : 1 }}>
                      {busy === `flip-${p.id}` ? "Opening…" : "Flip it"}
                    </button>
                    </>)}
                    {p.brief_id && <a href={`/studio?brief=${p.brief_id}`} style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: H.dim, textDecoration: "none", padding: "8px 4px" }}>The idea →</a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {model.pieces.length > 0 && (
        <>
          {secHead("Everything produced.", "the client's catalog, exactly as their hub sorts it — newest first")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {[{ key: "all", label: "All" }, ...CATALOG_CATS, { key: "other", label: "Everything else" }].map((c: any) => {
              const on = cat === c.key;
              return (
                <button key={c.key} onClick={() => setCat(c.key)}
                  style={{ borderRadius: 999, border: `1px solid ${on ? "#fff" : H.line}`, background: on ? "#fff" : "transparent", color: on ? H.ink : H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "8px 15px", cursor: "pointer", fontFamily: H.font }}>{c.label}</button>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {model.pieces.filter((pc: any) => cat === "all" || pc.cat === cat).map((pc: any) => (
              <a key={pc.key} href={readOnly ? undefined : `/jobs/${pc.jobId}`} title={pc.name}
                onClick={e => { e.preventDefault(); setDetail(pc); }}
                style={{ position: "relative", display: "block", aspectRatio: "1", borderRadius: 10, overflow: "hidden", background: thumbs[pc.itemId] ? "#fff" : H.surface, textDecoration: "none", cursor: "pointer" }}>
                {thumbs[pc.itemId] && (
                  <img src={thumbSrc(thumbs[pc.itemId], 400)} alt="" loading="lazy" referrerPolicy="no-referrer"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                )}
                <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "18px 9px 7px", background: "linear-gradient(transparent, rgba(0,0,0,0.75))", color: "#fff", fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pc.name}{pc.runs > 1 ? <span style={{ color: PURPLE }}> ·×{pc.runs}</span> : null}
                </span>
              </a>
            ))}
          </div>
        </>
      )}
      {detail && (() => {
        const pc = detail;
        const last = pc.instances[0];
        const sizeLine = (last?.sizes || []).map((l: any) => `${l.size} ${l.qty_ordered}`).join(" · ");
        return (
          <div onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px,4vh,48px) 16px", overflowY: "auto", fontFamily: H.font }}>
            <div style={{ background: H.card, border: `1px solid ${H.line}`, borderRadius: 16, width: "min(760px, 100%)", overflow: "hidden", color: H.text, display: "flex", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 280px", minWidth: 260, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1" }}>
                {thumbs[pc.itemId]
                  ? <img src={thumbSrc(thumbs[pc.itemId], 800)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : <span style={{ color: "#bbb", fontSize: 12 }}>No preview</span>}
              </div>
              <div style={{ flex: "1 1 300px", minWidth: 280, padding: "20px 22px", display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.15 }}>{pc.name}</div>
                {pc.blank && <div style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint, marginTop: 4 }}>{pc.blank}</div>}
                <div style={{ fontSize: 11, color: H.dim, marginTop: 6 }}>
                  {pc.runs} run{pc.runs === 1 ? "" : "s"}{!readOnly && last?.sell != null ? ` · last at $${last.sell.toFixed(2)}/u` : ""}
                </div>
                {sizeLine && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginBottom: 4 }}>Last run sizes</div>
                    <div style={{ fontSize: 11.5, fontFamily: H.mono, color: H.dim, lineHeight: 1.6 }}>{sizeLine}</div>
                  </div>
                )}
                <div style={{ marginTop: 12, flex: 1, minHeight: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginBottom: 4 }}>Run history</div>
                  <div style={{ maxHeight: 170, overflowY: "auto" }}>
                    {pc.instances.map((r: any) => (
                      <a key={r.itemId} href={readOnly ? undefined : `/jobs/${r.jobId}`}
                        style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: `1px solid ${H.line}`, textDecoration: "none", color: H.text }}>
                        <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint, width: 52, flexShrink: 0 }}>{fmtShort(r.date)}</span>
                        <span style={{ fontSize: 11, fontFamily: H.mono, color: H.blue, width: 64, flexShrink: 0 }}>{r.ref}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, flex: 1 }}>{r.qty ? `${r.qty.toLocaleString()} pcs` : "—"}</span>
                        {!readOnly && r.sell != null && <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.dim }}>${r.sell.toFixed(2)}/u</span>}
                      </a>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                  {!readOnly && (<>
                  <button onClick={() => { addToCart(pc); setDetail(null); }}
                    style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                    {cart[pc.instances[0]?.itemId] ? "✓ In cart" : "+ Add to reorder"}
                  </button>
                  <a href={`/jobs/${pc.jobId}`}
                    style={{ background: "transparent", color: H.dim, border: `1px solid ${H.line}`, borderRadius: 999, padding: "10px 18px", fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", textDecoration: "none", fontFamily: H.font }}>Open latest job →</a>
                  </>)}
                  <button onClick={() => openArt(pc)}
                    style={{ background: "transparent", color: H.dim, border: `1px solid ${H.line}`, borderRadius: 999, padding: "10px 18px", fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>View art</button>
                  <button onClick={() => setDetail(null)}
                    style={{ marginLeft: "auto", background: "transparent", color: H.faint, border: "none", fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Close</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {artFiles !== null && detail && (
        <div onClick={e => { if (e.target === e.currentTarget) setArtFiles(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 420, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "clamp(12px,4vh,48px) 16px", overflowY: "auto", fontFamily: H.font }}>
          <div style={{ background: H.card, border: `1px solid ${H.line}`, borderRadius: 16, width: "min(880px, 100%)", padding: "20px 22px", color: H.text }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", flex: 1 }}>{detail.name} — art</div>
              {/* The Drive folder link is gone: the archive is private and this
                  landed on a request-access page. The files themselves are
                  listed right below, each opening through OpsHub. */}
              <button onClick={() => setArtFiles(null)}
                style={{ background: "none", border: "none", color: H.faint, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            {artLoading && <div style={{ color: H.faint, fontSize: 12.5, padding: "20px 0" }}>Loading files…</div>}
            {!artLoading && artFiles.length === 0 && <div style={{ color: H.faint, fontSize: 12.5, padding: "20px 0" }}>No files on this piece.</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {artFiles.map((f: any) => (
                <div key={f.id} style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${H.line}` }}>
                  <a href={`/api/files/thumbnail?id=${f.drive_file_id}`} target="_blank" rel="noreferrer" title={f.file_name}
                    style={{ display: "block", aspectRatio: "1", background: "#fff" }}>
                    <img src={thumbSrc(f.drive_file_id, 400)} alt="" loading="lazy" referrerPolicy="no-referrer"
                      style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                  </a>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: H.faint, flex: 1 }}>{(f.stage || "").replace(/_/g, " ")}</span>
                      <a href={`/api/files/thumbnail?id=${f.drive_file_id}&dl=1`} download={f.file_name} title={`Download ${f.file_name}`}
                        style={{ fontSize: 12, color: H.blue, textDecoration: "none" }}>⬇</a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {cartCount > 0 && (
        <button onClick={() => setCartOpen(true)}
          style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 22, zIndex: 380, background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "13px 26px", fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
          Reorder cart · {cartCount}
        </button>
      )}
      {cartOpen && (
        <div onClick={e => { if (e.target === e.currentTarget && !cartBusy) setCartOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 430, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "clamp(12px,4vh,48px) 16px", overflowY: "auto", fontFamily: H.font }}>
          <div style={{ background: H.card, border: `1px solid ${H.line}`, borderRadius: 16, width: "min(640px, 100%)", padding: "20px 22px", color: H.text }}>
            <div style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", marginBottom: 4 }}>Run it back.</div>
            <div style={{ fontSize: 11.5, color: H.dim, marginBottom: 14 }}>{cartDest === "new" ? <>Lands as ONE intake job — cost and quote it like any order.</> : <>Adds these pieces to the job you picked, art, blank and vendor carried.</>} Quantities prefilled from each piece&rsquo;s last run.</div>
            {openJobs.length > 0 && (
              <label style={{ display: "block", marginTop: 14 }}>
                <span style={{ display: "block", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginBottom: 6 }}>Add to</span>
                <select value={cartDest} onChange={e => setCartDest(e.target.value)} disabled={cartBusy}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 16, fontFamily: H.font }}>
                  <option value="new">A new intake job</option>
                  {openJobs.map(j => <option key={j.id} value={j.id}>{[j.job_number, j.title].filter(Boolean).join(" · ") || "Untitled job"}</option>)}
                </select>
              </label>
            )}
            {Object.entries(cart).map(([itemId, v]) => (
              <div key={itemId} style={{ padding: "10px 0", borderBottom: `1px solid ${H.line}` }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", flex: 1 }}>{v.name}</span>
                  <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>{Object.values(v.sizes).reduce((a, n) => a + (Number(n) || 0), 0).toLocaleString()} pcs</span>
                  <button onClick={() => setCart(c => { const n = { ...c }; delete n[itemId]; return n; })}
                    style={{ border: "none", background: "transparent", color: H.faint, fontSize: 13, cursor: "pointer" }}>✕</button>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {Object.entries(v.sizes).map(([sz, q]) => (
                    <label key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 8.5, fontWeight: 800, fontFamily: H.mono, color: H.faint }}>{sz}</span>
                      <input inputMode="numeric" value={q}
                        onChange={e => { const n = Math.max(0, Math.round(Number(e.target.value) || 0)); setCart(c => ({ ...c, [itemId]: { ...c[itemId], sizes: { ...c[itemId].sizes, [sz]: n } } })); }}
                        onFocus={e => e.target.select()}
                        style={{ width: 52, textAlign: "center", padding: "6px 4px", borderRadius: 7, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 12, fontFamily: H.mono, outline: "none" }} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <textarea value={cartNote} onChange={e => setCartNote(e.target.value)} placeholder="Note for intake (optional)"
              style={{ width: "100%", boxSizing: "border-box", marginTop: 12, padding: "10px 12px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 12.5, fontFamily: H.font, outline: "none", minHeight: 54, resize: "vertical" }} />
            {cartErr && <div style={{ color: H.red, fontSize: 12, marginTop: 8 }}>{cartErr}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button disabled={cartBusy} onClick={submitCart}
                style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "11px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, opacity: cartBusy ? 0.6 : 1 }}>
                {cartBusy ? (cartDest === "new" ? "Creating…" : "Adding…") : cartDest === "new" ? `Create intake job · ${cartCount} item${cartCount === 1 ? "" : "s"}` : `Add ${cartCount} item${cartCount === 1 ? "" : "s"} to ${openJobs.find(j => j.id === cartDest)?.job_number || "job"}`}
              </button>
              <button disabled={cartBusy} onClick={() => setCartOpen(false)}
                style={{ background: "transparent", color: H.dim, border: `1px solid ${H.line}`, borderRadius: 999, padding: "11px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Keep browsing</button>
            </div>
          </div>
        </div>
      )}
      {products.length === 0 && model.pieces.length === 0 && (
        <div style={{ color: H.faint, fontSize: 12.5 }}>Empty shelf — the greenlight fork fills it.</div>
      )}
    </>
  );
}

// ── Archive: the indexed pre-OpsHub art, browsable in place ──
export function ArchiveRail({ archive, briefs, clientId, secHead }: any) {
  const supabase = createClient();
  const [path, setPath] = useState<string>("");
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState<any | null>(null);   // the file being sent
  const [sent, setSent] = useState<{ briefId: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // "use this" — promotion by pointer: the archive file joins an idea's
  // thread as a reference; nothing in Drive moves or copies
  async function sendToBrief(file: any, briefId: string, briefTitle: string) {
    setBusy(true);
    try {
      const { error } = await supabase.from("art_brief_files").insert({
        brief_id: briefId,
        file_name: file.file_name,
        drive_file_id: file.drive_file_id,
        drive_link: `https://drive.google.com/file/d/${file.drive_file_id}/view`,
        mime_type: file.mime_type || null,
        kind: "reference",
        uploader_role: "hpd",
      } as never);
      if (error) throw new Error(error.message);
      setSent({ briefId, title: briefTitle });
      setPicker(null);
    } catch { /* surface stays quiet; retry is a tap away */ }
    setBusy(false);
  }
  async function sendToNewIdea(file: any) {
    setBusy(true);
    try {
      const title = String(file.file_name || "Archive pull").replace(/\.\w+$/, "").slice(0, 140);
      const { data: brief, error } = await supabase.from("art_briefs").insert({
        client_id: clientId, title, state: "working", source: "hpd",
        internal_only: true,   // prep quietly; share from the studio sheet
        concept: `Pulled from the archive: ${file.folder_path || ""}/${file.file_name}`,
      } as never).select("id").single();
      if (error || !brief) throw new Error(error?.message || "failed");
      await sendToBrief(file, (brief as any).id, title);
    } catch { setBusy(false); }
  }
  const isImg = (r: any) => /image\//.test(r.mime_type || "") || /\.(png|jpe?g|gif|webp)$/i.test(r.file_name || "");
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? archive.filter((r: any) => `${r.file_name || ""} ${r.folder_path || ""}`.toLowerCase().includes(needle)).slice(0, 60)
    : null;
  const here = archive.filter((r: any) => (r.folder_path || "") === path);
  const subfolders = new Map<string, { n: number; thumb: string | null }>();
  for (const r of archive) {
    const p = r.folder_path || "";
    if (path && !p.startsWith(path + "/")) continue;
    if (!path && !p) continue;
    const rest = path ? p.slice(path.length + 1) : p;
    const seg = rest.split("/")[0];
    if (!seg) continue;
    const cur = subfolders.get(seg) || { n: 0, thumb: null };
    cur.n++;
    if (!cur.thumb && isImg(r)) cur.thumb = r.drive_file_id;
    subfolders.set(seg, cur);
  }
  const crumb = path ? path.split("/") : [];
  const fileCard = (r: any) => (
    <a key={r.id} className="cs-card" href={`/api/files/view/${encodeURIComponent(r.name || r.file_name || "file")}?id=${r.drive_file_id}`} target="_blank" rel="noreferrer">
      <div style={{ background: "#fff", aspectRatio: "1", position: "relative" }}>
        <img src={thumbSrc(r.drive_file_id)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={(e: any) => { e.target.style.display = "none"; e.target.parentElement.style.background = "#1e1e1e"; }} />
        <span style={{ position: "absolute", left: 8, bottom: 6, fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888", background: "rgba(0,0,0,0.55)", borderRadius: 999, padding: "3px 8px" }}>
          {((r.file_name || "").match(/\.(\w+)$/) || [, "file"])[1]}
        </span>
        <button onClick={e => { e.preventDefault(); e.stopPropagation(); setSent(null); setPicker(r); }}
          title="Send to the Studio"
          style={{ position: "absolute", right: 6, top: 6, background: "rgba(0,0,0,0.7)", color: "#fff", border: 0, borderRadius: 999, padding: "6px 11px", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
          → Studio
        </button>
      </div>
      <div style={{ padding: "8px 11px 11px", fontSize: 10.5, lineHeight: 1.35, wordBreak: "break-word" }}>{r.file_name}</div>
    </a>
  );
  return (
    <>
      {secHead("The archive.", `${archive.length.toLocaleString()} files, indexed in place — nothing moved, everything findable`)}
      {sent && (
        <div style={{ fontSize: 12.5, color: H.green, fontWeight: 700, marginBottom: 14 }}>
          ✓ Sent to "{sent.title}" — <a href={`/studio?brief=${sent.briefId}`} style={{ color: H.green }}>open it in the Studio →</a>
        </div>
      )}
      {picker && (
        <div onClick={() => setPicker(null)} style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.66)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 16, width: "100%", maxWidth: 440, padding: 22, maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 4 }}>Send to the Studio</div>
            <div style={{ fontSize: 14, fontWeight: 900, textTransform: "uppercase", marginBottom: 14, wordBreak: "break-word" }}>{picker.file_name}</div>
            <button onClick={() => sendToNewIdea(picker)} disabled={busy}
              style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", color: H.ink, border: 0, borderRadius: 10, padding: "12px 15px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer", fontFamily: H.font, marginBottom: 14, opacity: busy ? 0.5 : 1 }}>
              + New idea from this file
            </button>
            {briefs.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 8 }}>or onto an existing idea</div>}
            {briefs.map((b: any) => (
              <button key={b.id} onClick={() => sendToBrief(picker, b.id, b.title || "Untitled idea")} disabled={busy}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", color: H.text, border: `1px solid ${H.line}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: H.font, marginBottom: 8, opacity: busy ? 0.5 : 1 }}>
                {b.title || "Untitled idea"}
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: H.faint, marginLeft: 8 }}>{b.state === "approved" ? "greenlit" : b.state === "with_client" ? "with them" : "in the studio"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {archive.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>No archive indexed for this client yet — one pasted Drive link does it.</div>}
      {archive.length > 0 && (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the archive…"
            style={{ margin: "0 0 16px", padding: "10px 16px", fontSize: 13, background: H.card, border: `1px solid ${H.line}`, borderRadius: 999, outline: "none", color: H.text, fontFamily: H.font, width: 300, maxWidth: "100%" }} />
          {hits ? (
            <>
              <div style={{ fontSize: 10.5, color: H.faint, marginBottom: 12 }}>{hits.length} hit{hits.length === 1 ? "" : "s"}{hits.length === 60 ? " (first 60)" : ""}</div>
              <div className="cs-grid">{hits.map(fileCard)}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, fontFamily: H.mono, color: H.dim, marginBottom: 14 }}>
                <span style={{ cursor: "pointer", color: path ? H.blue : H.text }} onClick={() => setPath("")}>archive</span>
                {crumb.map((seg, i) => (
                  <span key={i}>
                    {" / "}
                    <span style={{ cursor: "pointer", color: i === crumb.length - 1 ? H.text : H.blue }} onClick={() => setPath(crumb.slice(0, i + 1).join("/"))}>{seg}</span>
                  </span>
                ))}
              </div>
              {subfolders.size > 0 && (
                <div className="cs-grid" style={{ marginBottom: here.length ? 24 : 0 }}>
                  {Array.from(subfolders.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([seg, v]) => (
                    <button key={seg} className="cs-card" onClick={() => setPath(path ? `${path}/${seg}` : seg)} style={{ cursor: "pointer" }}>
                      <div style={{ background: v.thumb ? "#fff" : H.surface, aspectRatio: "1" }}>
                        {v.thumb && <img src={thumbSrc(v.thumb)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                      </div>
                      <div style={{ padding: "9px 12px 12px" }}>
                        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{seg}</div>
                        <div style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint, marginTop: 3 }}>{v.n} file{v.n === 1 ? "" : "s"}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {here.length > 0 && <div className="cs-grid">{here.map(fileCard)}</div>}
            </>
          )}
        </>
      )}
    </>
  );
}

// ── Money: internal only ──
// MoneyRail merged into OrdersRail (Jon, Aug 3) — git history holds it.
