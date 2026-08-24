"use client";
// Client Hub — Reorder shop (P2, Jul 20 2026). Every piece we've ever made
// for this client, deduped across jobs, presented shop-style (dark skin,
// image-first — same H tokens as the order experience). Tap a piece →
// bottom sheet with per-size quantities prefilled from the last run →
// Add to cart → cart bar pinned to the bottom → submit lands ONE intake
// job on our side via /api/portal/client/[token]/cart. Nothing is priced
// or committed client-side; the team quotes it like any other order.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useClientPortal } from "../_shared/context";
import { H } from "@/components/hub/theme";
import { SIZE_ORDER } from "@/lib/theme";

type CatalogEntry = {
  key: string;
  itemId: string;          // most recent instance — the one we clone from
  name: string;
  vendor: string | null;
  cat: string;
  sku: string | null;
  thumbId: string | null;
  lastQty: number;
  lastSizes: { size: string; qty: number }[];
  lastUnit: number | null; // what the client paid per unit last run
  runs: number;
  lastDate: string;
};

// Phase 3 (Aug 24): one total, one optional note — the curve is ours to
// apply at quoting (seeded server-side from their history).
type CartLine = { total: number; note?: string };

// Product category buckets from garment_type (the QB category each item
// gets in Product Builder). Substring match keeps the 30+ types manageable.
const CATS: { key: string; label: string; match: (g: string) => boolean }[] = [
  { key: "tees", label: "Tees", match: g => g.includes("tee") || g === "tank" || g.includes("shirt") },
  { key: "hoodies", label: "Hoodies", match: g => g.includes("hoodie") || g.includes("crewneck") || g.includes("sweat") },
  { key: "hats", label: "Hats", match: g => g.includes("hat") || g.includes("beanie") || g.includes("cap") },
  { key: "patches", label: "Patches", match: g => g.includes("patch") },
];
const catOf = (g: string | null) => {
  const x = (g || "").toLowerCase();
  return CATS.find(c => c.match(x))?.key || "other";
};

const thumb = (id: string, size = 500) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const sortSizes = (arr: { size: string; qty: number }[]) =>
  [...arr].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.size), bi = SIZE_ORDER.indexOf(b.size);
    if (ai === -1 && bi === -1) return a.size.localeCompare(b.size);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

export default function ReorderPage() {
  const { token, data } = useClientPortal();
  // Releases-granted clients get a second door on each piece: "Add to a
  // release" hands the item to the Releases planner (?add=) instead of the
  // cart. Cart = order it again now; release = put it in the next drop.
  const hasReleases = (((data as any)?.features || []) as string[]).includes("releases");
  const [items, setItems] = useState<any[] | null>(null);
  const [detail, setDetail] = useState<CatalogEntry | null>(null);
  const [cat, setCat] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [reviewing, setReviewing] = useState(false);
  // Edit-from-cart swaps the review sheet for the item sheet and returns
  // after save/close — stacking them rendered the editor underneath.
  const [returnToReview, setReturnToReview] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ jobNumber: string | null; itemCount: number } | null>(null);
  const [error, setError] = useState("");

  // Cart survives refresh — keyed per portal token. The persist effect
  // must not run until the load effect has read storage, or the initial
  // empty state wipes a cart handed off from another tab (StrictMode
  // double-mount makes this a real race in dev).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`hx-cart-${token}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Legacy per-size carts in flight → collapse to totals.
        const conv: Record<string, CartLine> = {};
        for (const [id, l] of Object.entries<any>(parsed || {})) {
          if (l && typeof l.total === "number") conv[id] = l;
          else if (l?.sizes) conv[id] = { total: Object.values(l.sizes as Record<string, number>).reduce((a: number, q: any) => a + (Number(q) || 0), 0) };
        }
        setCart(conv);
      }
    } catch {}
    // eslint-disable-next-line
  }, [token]);
  // Persist at mutation time, never via effect — an effect's first run
  // writes the initial empty state over a cart handed off from another
  // tab (StrictMode double-mount makes that wipe reliable in dev).
  function persistCart(next: Record<string, CartLine>) {
    setCart(next);
    try { localStorage.setItem(`hx-cart-${token}`, JSON.stringify(next)); } catch {}
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/portal/client/${token}/items`);
        const body = await res.json();
        if (res.ok) setItems(body.items || []);
        else setItems([]);
      } catch { setItems([]); }
    })();
    // eslint-disable-next-line
  }, [token]);

  // Dedupe repeats (same piece ordered across jobs) — newest instance
  // represents the piece; runs = how many times it's been ordered.
  const catalog: CatalogEntry[] = useMemo(() => {
    const byKey = new Map<string, CatalogEntry>();
    const sorted = [...(items || [])].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    for (const it of sorted) {
      if (it.status === "cancelled") continue;
      // Only pieces that have actually been RUN belong in the catalog — an
      // intake/unquoted item is an ask in motion, not produced history.
      if (it.run === false) continue;
      const key = `${(it.name || "").trim().toLowerCase()}|${(it.blank_sku || "").trim().toLowerCase()}`;
      const existing = byKey.get(key);
      if (existing) { existing.runs++; continue; }
      byKey.set(key, {
        key,
        itemId: it.id,
        name: it.name,
        vendor: it.blank_vendor || null,
        cat: catOf(it.garment_type),
        sku: it.blank_sku || null,
        thumbId: it.thumb_id || null,
        lastQty: it.qty || 0,
        lastSizes: sortSizes(it.sizes || []),
        lastUnit: it.cost != null ? Number(it.cost) : null,
        runs: 1,
        lastDate: it.created_at,
      });
    }
    return Array.from(byKey.values());
  }, [items]);

  const cartCount = Object.keys(cart).length;
  const cartUnits = Object.values(cart).reduce((a, l) => a + (Number(l.total) || 0), 0);
  const entryFor = (itemId: string) => catalog.find(c => c.itemId === itemId) || null;

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/portal/client/${token}/cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim() || undefined,
          items: Object.entries(cart).map(([itemId, line]) => ({ itemId, total: line.total, note: line.note || undefined })),
        }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || "Couldn't submit your order."); return; }
      setSubmitted({ jobNumber: body.jobNumber, itemCount: body.itemCount });
      persistCart({});
      setNote("");
      setReviewing(false);
      try { localStorage.removeItem(`hx-cart-${token}`); } catch {}
    } catch {
      setError("Couldn't submit your order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      // Full-bleed dark canvas escaping the light shell's centered main.
      margin: "calc(clamp(16px, 4vw, 32px) * -1) calc(clamp(12px, 3vw, 24px) * -1) -60px",
      background: H.ink, color: H.text, fontFamily: H.font, minHeight: "70vh",
    }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .rx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:12px}
        @media(min-width:720px){.rx-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}}
        .rx-card{transition:transform .15s ease,border-color .15s ease}
        .rx-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .rx-back{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto}
        .rx-sheet{background:${H.panel};border:1px solid ${H.line};border-radius:20px;max-width:560px;width:100%;overflow:hidden}
        .rx-handle{display:none}
        .rx-cartbar{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:110}
        @media(max-width:640px){
          .rx-back{align-items:flex-end;padding:0;overflow-y:hidden}
          .rx-sheet{border-radius:18px 18px 0 0;border-bottom:none;max-height:92dvh;overflow-y:auto;animation:rxUp .3s cubic-bezier(.32,.72,0,1)}
          .rx-handle{display:block;width:38px;height:4px;border-radius:999px;background:rgba(255,255,255,0.25);margin:10px auto 0}
          .rx-cartbar{bottom:calc(64px + env(safe-area-inset-bottom) + 12px)}
        }
        @keyframes rxUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @media(prefers-reduced-motion:reduce){.rx-card,.rx-card:hover{transition:none;transform:none}.rx-sheet{animation:none}}
        .rx-qty{width:64px;padding:9px 0;text-align:center;background:${H.surface};border:1px solid ${H.line};border-radius:9px;color:${H.text};font-family:${H.mono};font-size:14px;font-weight:700;outline:none}
        .rx-qty:focus{border-color:rgba(255,255,255,0.5)}
      ` }} />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(28px,5vw,56px) clamp(14px,3vw,24px) 120px" }}>
        {submitted ? (
          <div style={{ minHeight: "50vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 14 }}>
            <div style={{ fontSize: 15, color: H.green, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>Request received</div>
            <div style={{ fontSize: "clamp(28px,6vw,54px)", fontWeight: 900, textTransform: "uppercase", lineHeight: 1, letterSpacing: "-0.02em" }}>It&rsquo;s in motion.</div>
            <div style={{ fontSize: 14, color: H.dim, maxWidth: "46ch", lineHeight: 1.6 }}>
              Your reorder{submitted.jobNumber ? ` (${submitted.jobNumber})` : ""} with {submitted.itemCount} item{submitted.itemCount === 1 ? "" : "s"} is with our team.
              We&rsquo;ll confirm pricing and timing, then send your quote for approval.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={() => setSubmitted(null)}
                style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "13px 26px", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                Keep browsing
              </button>
              <Link href={`/portal/client/${token}/orders`}
                style={{ background: "transparent", color: H.text, border: "1px solid rgba(255,255,255,0.35)", borderRadius: 999, padding: "13px 24px", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none", fontFamily: H.font }}>
                View orders
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint, textAlign: "center" }}>Your catalog</div>
            <h1 style={{ fontSize: "clamp(30px,7vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 10px", textWrap: "balance" as any, textAlign: "center" }}>
              Run it back.
            </h1>
            <div style={{ fontSize: 14, color: H.dim, maxWidth: "52ch", lineHeight: 1.6, margin: "0 auto 28px", textAlign: "center" }}>
              Every piece from your past runs. Request a re-order{hasReleases ? " or plan it into an upcoming release" : ""}.
            </div>

            <ShelfRail token={token} />

            {catalog.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 24 }}>
                {[{ key: "all", label: "All" }, ...CATS, { key: "other", label: "Everything else" }].map(c => {
                  const n = c.key === "all" ? catalog.length : catalog.filter(x => x.cat === c.key).length;
                  if (n === 0 && c.key !== "all") return null;
                  return (
                    <button key={c.key} onClick={() => setCat(c.key)}
                      style={{ borderRadius: 999, border: cat === c.key ? "1px solid #fff" : `1px solid ${H.line}`, background: cat === c.key ? "#fff" : "transparent", color: cat === c.key ? H.ink : H.dim, fontFamily: H.mono, fontSize: 11, fontWeight: 700, padding: "8px 15px", cursor: "pointer", whiteSpace: "nowrap" }}>
                      {(c as any).label} · {n}
                    </button>
                  );
                })}
              </div>
            )}
            {items === null ? (
              <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>Loading your pieces…</div>
            ) : catalog.length === 0 ? (
              <div style={{ color: H.dim, fontSize: 13, padding: "40px 0" }}>No past pieces yet. Once your first order runs, everything lands here for easy reordering.</div>
            ) : (
              <div className="rx-grid">
                {catalog.filter(c => cat === "all" || c.cat === cat).map(c => {
                  const inCart = !!cart[c.itemId];
                  return (
                    <button key={c.key} className="rx-card" onClick={() => setDetail(c)}
                      style={{
                        background: H.panel, border: `1px solid ${inCart ? "rgba(255,255,255,0.45)" : H.line}`, borderRadius: 14,
                        padding: 0, overflow: "hidden", cursor: "pointer", textAlign: "left", fontFamily: H.font, color: H.text, position: "relative",
                      }}>
                      <div style={{ background: "#fff", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {c.thumbId
                          ? <img src={thumb(c.thumbId)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                          : <span style={{ color: "#bbb", fontSize: 11 }}>No preview</span>}
                      </div>
                      {inCart && (
                        <span style={{ position: "absolute", top: 10, right: 10, background: "#fff", color: H.ink, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: 999, padding: "5px 10px" }}>In cart</span>
                      )}
                      <div style={{ padding: "12px 14px 14px" }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{c.name}</div>
                        {(c.vendor || c.sku) && (
                          <div style={{ fontSize: 10.5, color: H.faint, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.vendor, c.sku].filter(Boolean).join(" · ")}</div>
                        )}
                        <div style={{ fontSize: 10, color: H.dim, fontFamily: H.mono, marginTop: 7, letterSpacing: "0.04em" }}>
                          {c.runs > 1 ? `${c.runs} runs` : "1 run"}{c.lastQty ? ` · last ${c.lastQty.toLocaleString()} pcs` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Cart bar — pinned bottom, above the hub's mobile nav ── */}
      {!submitted && cartCount > 0 && (
        <div className="rx-cartbar">
          <button onClick={() => setReviewing(true)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              background: "#fff", color: H.ink, border: "none", borderRadius: 999,
              padding: "14px 26px", fontSize: 13, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase",
              cursor: "pointer", fontFamily: H.font, boxShadow: "0 10px 34px rgba(0,0,0,0.55)", whiteSpace: "nowrap",
            }}>
            Review cart
            <span style={{ fontFamily: H.mono, fontSize: 12, background: H.ink, color: "#fff", borderRadius: 999, padding: "4px 11px" }}>
              {cartCount} · {cartUnits.toLocaleString()} pcs
            </span>
          </button>
        </div>
      )}

      {/* ── Item sheet: per-size quantities, prefilled from the last run ── */}
      {detail && (
        <ItemSheet
          entry={detail}
          line={cart[detail.itemId] || null}
          onAddToRelease={hasReleases ? () => { window.location.href = `/portal/client/${token}/releases?add=${detail.itemId}`; } : undefined}
          onClose={() => { setDetail(null); if (returnToReview) { setReturnToReview(false); setReviewing(true); } }}
          onSave={(l) => {
            const next = { ...cart };
            if (l && l.total > 0) next[detail.itemId] = l;
            else delete next[detail.itemId];
            persistCart(next);
            setDetail(null);
            if (returnToReview) { setReturnToReview(false); setReviewing(true); }
          }}
        />
      )}

      {/* ── Cart review: lines + note + submit ── */}
      {reviewing && (
        <div className="rx-back" onClick={e => { if (e.target === e.currentTarget && !submitting) setReviewing(false); }}>
          <div className="rx-sheet">
            <div className="rx-handle" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px 6px" }}>
              <div style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>Your cart</div>
              <button onClick={() => !submitting && setReviewing(false)} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: "10px 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(cart).map(([itemId, line]) => {
                const c = entryFor(itemId);
                if (!c) return null;
                const units = Number(line.total) || 0;
                const sizeText = line.note ? `\u201C${line.note}\u201D` : "sizes: we\u2019ll apply your usual curve";
                return (
                  <div key={itemId} style={{ display: "flex", gap: 12, alignItems: "center", background: H.card, border: `1px solid ${H.line}`, borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ width: 52, height: 52, background: "#fff", borderRadius: 8, overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {c.thumbId && <img src={thumb(c.thumbId, 200)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                      <div style={{ fontSize: 10.5, color: H.dim, fontFamily: H.mono, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{units.toLocaleString()} pcs{sizeText ? ` · ${sizeText}` : ""}</div>
                    </div>
                    <button onClick={() => { setReturnToReview(true); setReviewing(false); setDetail(c); }} style={{ background: "transparent", border: `1px solid ${H.line}`, color: H.dim, borderRadius: 999, padding: "7px 13px", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, flexShrink: 0 }}>Edit</button>
                  </div>
                );
              })}
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder="Anything we should know? New ship-to, date you need it by, art tweaks…"
                style={{ width: "100%", boxSizing: "border-box", marginTop: 4, padding: "11px 13px", borderRadius: 10, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 13, fontFamily: H.font, outline: "none", resize: "vertical" }} />
              {error && <div style={{ color: H.red, fontSize: 12.5, fontWeight: 700 }}>{error}</div>}
              <div style={{ fontSize: 11.5, color: H.faint, lineHeight: 1.5 }}>
                This sends a reorder request. We&rsquo;ll confirm pricing and timing, then send your quote for approval before production starts.
              </div>
              <button onClick={submit} disabled={submitting}
                style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "15px 26px", fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: submitting ? "wait" : "pointer", fontFamily: H.font, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? "Sending…" : `Submit reorder · ${cartUnits.toLocaleString()} pcs`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemSheet({ entry, line, onClose, onSave, onAddToRelease }: {
  entry: CatalogEntry;
  line: CartLine | null;
  onClose: () => void;
  onSave: (line: CartLine | null) => void;
  onAddToRelease?: () => void;
}) {
  // ONE number (Phase 3): the client types a total; we apply their curve at
  // quoting. Last run rides as reference — total + breakdown, read-only.
  const [totalStr, setTotalStr] = useState<string>(() => line ? String(line.total || "") : "");
  const [lineNote, setLineNote] = useState<string>(line?.note || "");
  const total = Math.max(0, Math.round(Number(totalStr) || 0));

  function commit() {
    onSave(total > 0 ? { total, note: lineNote.trim() || undefined } : null);
  }

  return (
    <div className="rx-back" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rx-sheet">
        <div className="rx-handle" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "16px 20px 4px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2 }}>{entry.name}</div>
            {(entry.vendor || entry.sku) && (
              <div style={{ fontSize: 11, color: H.faint, marginTop: 3 }}>{[entry.vendor, entry.sku].filter(Boolean).join(" · ")}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
        <div style={{ background: "#fff", marginTop: 10 }}>
          {entry.thumbId && (
            <img src={thumb(entry.thumbId, 900)} alt="" referrerPolicy="no-referrer"
              style={{ width: "100%", maxHeight: "38vh", objectFit: "contain", display: "block", margin: "0 auto" }}
              onError={(e: any) => { e.target.style.display = "none"; }} />
          )}
        </div>
        <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 8 }}>
              How many total?
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input className="rx-qty" style={{ width: 110, fontSize: 20, padding: "12px 0" }} type="text" inputMode="numeric" autoFocus
                value={totalStr} placeholder={entry.lastQty ? String(entry.lastQty) : "0"}
                onFocus={e => e.currentTarget.select()}
                onChange={e => setTotalStr(e.target.value.replace(/[^0-9]/g, ""))} />
              {entry.lastQty > 0 && (
                <button onClick={() => setTotalStr(String(entry.lastQty))}
                  style={{ background: "transparent", border: `1px solid ${H.line}`, color: H.dim, borderRadius: 999, padding: "9px 15px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                  Same as last run · {entry.lastQty.toLocaleString()}
                </button>
              )}
            </div>
            {entry.lastSizes.length > 0 && (
              <div style={{ fontSize: 10.5, color: H.faint, fontFamily: H.mono, marginTop: 10, lineHeight: 1.6 }}>
                Last run {entry.lastQty.toLocaleString()} pcs · {entry.lastSizes.map(x => `${x.size} ${x.qty}`).join("  ")}
              </div>
            )}
            <div style={{ fontSize: 11, color: H.dim, marginTop: 8, lineHeight: 1.5 }}>
              We apply your size curve when we quote it — sizes are our job. Anything specific, say it below.
            </div>
            <input value={lineNote} onChange={e => setLineNote(e.target.value)}
              placeholder="Optional — e.g. no smalls this time"
              style={{ marginTop: 10, width: "100%", boxSizing: "border-box", background: H.surface, border: `1px solid ${H.line}`, borderRadius: 10, color: H.text, fontSize: 12.5, padding: "11px 13px", outline: "none", fontFamily: H.font }} />
          </div>
          {entry.lastUnit != null && (
            <div style={{ fontSize: 11.5, color: H.faint, lineHeight: 1.5 }}>
              Last run: ${entry.lastUnit.toFixed(2)}/pc. Final pricing is confirmed on your quote and can shift with quantity.
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={commit}
              style={{ background: "#fff", color: H.ink, border: "none", borderRadius: 999, padding: "13px 24px", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
              {line ? (total > 0 ? `Update · ${total.toLocaleString()} pcs` : "Remove from cart") : `Add to cart · ${total.toLocaleString()} pcs`}
            </button>
            {line && total > 0 && (
              <button onClick={() => onSave(null)}
                style={{ background: "transparent", color: H.dim, border: `1px solid ${H.line}`, borderRadius: 999, padding: "13px 20px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                Remove
              </button>
            )}
            {onAddToRelease && !line && (
              <button onClick={onAddToRelease}
                style={{ background: "transparent", color: H.text, border: `1px solid ${H.line}`, borderRadius: 999, padding: "13px 20px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                Add to a release
              </button>
            )}
          </div>
          {onAddToRelease && !line && (
            <div style={{ fontSize: 11, color: H.faint, lineHeight: 1.5 }}>
              Cart orders it again on its own. A release plans it into your next drop.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── THE SHELF — greenlit products that haven't run yet (Jul 22). "Bring it
// back later" lands here; ordering one is its first run. Produced pieces
// live in the catalog below — one door per state.
function ShelfRail({ token }: { token: string }) {
  const [shelf, setShelf] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "OS"];

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/portal/client/${token}/products`);
        const body = await res.json();
        setShelf(res.ok ? body.products || [] : []);
      } catch { setShelf([]); }
    })();
    // eslint-disable-next-line
  }, [token]);

  if (!shelf || shelf.length === 0) return null;
  const total = Object.values(qtys).reduce((a, n) => a + (Number(n) || 0), 0);

  async function send() {
    if (!open || total <= 0) return;
    setBusy(true); setErr("");
    try {
      const clean: Record<string, number> = {};
      for (const [s, n] of Object.entries(qtys)) if (Number(n) > 0) clean[s] = Number(n);
      const res = await fetch(`/api/portal/client/${token}/products`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: open.id, qtys: clean }),
      });
      const body = await res.json();
      if (!res.ok) { setErr(body.error || "Couldn't send that."); setBusy(false); return; }
      setDone(open.title);
      setShelf(prev => (prev || []).filter(p => p.id !== open.id));
      setOpen(null); setQtys({});
    } catch { setErr("Couldn't send that."); }
    setBusy(false);
  }

  return (
    <div style={{ marginBottom: 34 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, justifyContent: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fd3aa3" }}>On the shelf</span>
        <span style={{ fontSize: 11, color: H.faint }}>greenlit and ready — these haven&rsquo;t run yet</span>
      </div>
      {done && (
        <div style={{ fontSize: 12.5, color: H.green, fontWeight: 700, textAlign: "center", margin: "8px 0" }}>
          ✓ &ldquo;{done}&rdquo; is on its way to production — we&rsquo;ll confirm pricing before anything prints.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginTop: 12 }}>
        {shelf.map(p => (
          <button key={p.id} onClick={() => { setOpen(p); setQtys({}); setErr(""); }}
            style={{ background: H.panel, border: `1px solid ${open?.id === p.id ? "#fff" : H.line}`, borderRadius: 14, overflow: "hidden", cursor: "pointer", textAlign: "left", color: H.text, fontFamily: H.font, padding: 0 }}>
            <div style={{ background: p.artFileId ? "#fff" : H.surface, aspectRatio: "1" }}>
              {p.artFileId && <img src={`/api/files/thumbnail?id=${p.artFileId}&thumb=1&size=300`} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
            </div>
            <div style={{ padding: "9px 12px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{p.title}</div>
              <div style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint, marginTop: 3 }}>{p.format || "product"}{p.retail != null ? ` · $${p.retail}` : ""}</div>
            </div>
          </button>
        ))}
      </div>
      {open && (
        <div style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 14, padding: 18, marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", marginBottom: 4 }}>{open.title} — first run</div>
          <div style={{ fontSize: 11, color: H.dim, marginBottom: 12 }}>Rough is fine — we&rsquo;ll confirm everything with you before anything prints.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {SIZES.map(sz => (
              <label key={sz} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: H.faint }}>{sz}</span>
                <input type="text" inputMode="numeric" value={qtys[sz] || ""}
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => setQtys(prev => ({ ...prev, [sz]: e.target.value.replace(/\D/g, "") }))}
                  style={{ width: 46, padding: "8px 0", textAlign: "center", background: H.ink, border: `1px solid ${H.line}`, borderRadius: 8, outline: "none", color: H.text, fontFamily: H.mono, fontSize: 12.5, fontWeight: 700 }} />
              </label>
            ))}
          </div>
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: H.red, marginBottom: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={send} disabled={busy || total <= 0}
              style={{ background: "#fff", color: H.ink, border: 0, borderRadius: 999, padding: "12px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: busy || total <= 0 ? "default" : "pointer", opacity: busy || total <= 0 ? 0.5 : 1, fontFamily: H.font }}>
              {busy ? "Sending…" : `Send the order · ${total.toLocaleString()} pcs`}
            </button>
            <button onClick={() => setOpen(null)} style={{ background: "none", border: "none", color: H.faint, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>Not yet</button>
          </div>
        </div>
      )}
    </div>
  );
}
