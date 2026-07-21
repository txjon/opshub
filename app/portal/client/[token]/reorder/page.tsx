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
  sku: string | null;
  thumbId: string | null;
  lastQty: number;
  lastSizes: { size: string; qty: number }[];
  lastUnit: number | null; // what the client paid per unit last run
  runs: number;
  lastDate: string;
};

type CartLine = { sizes: Record<string, number> };

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
  const { token } = useClientPortal();
  const [items, setItems] = useState<any[] | null>(null);
  const [detail, setDetail] = useState<CatalogEntry | null>(null);
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
      if (raw) setCart(JSON.parse(raw));
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
      const key = `${(it.name || "").trim().toLowerCase()}|${(it.blank_sku || "").trim().toLowerCase()}`;
      const existing = byKey.get(key);
      if (existing) { existing.runs++; continue; }
      byKey.set(key, {
        key,
        itemId: it.id,
        name: it.name,
        vendor: it.blank_vendor || null,
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
  const cartUnits = Object.values(cart).reduce((a, l) => a + Object.values(l.sizes).reduce((s, q) => s + (Number(q) || 0), 0), 0);
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
          items: Object.entries(cart).map(([itemId, line]) => ({ itemId, sizes: line.sizes })),
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
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint, textAlign: "center" }}>Reorder</div>
            <h1 style={{ fontSize: "clamp(30px,7vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 10px", textWrap: "balance" as any, textAlign: "center" }}>
              Run it back.
            </h1>
            <div style={{ fontSize: 14, color: H.dim, maxWidth: "52ch", lineHeight: 1.6, margin: "0 auto 28px", textAlign: "center" }}>
              Every piece from your past runs. Tap one, set your quantities, and send it our way.
              We&rsquo;ll confirm pricing and timing before anything goes into production.
            </div>

            {items === null ? (
              <div style={{ color: H.faint, fontSize: 13, padding: "40px 0" }}>Loading your pieces…</div>
            ) : catalog.length === 0 ? (
              <div style={{ color: H.dim, fontSize: 13, padding: "40px 0" }}>No past pieces yet. Once your first order runs, everything lands here for easy reordering.</div>
            ) : (
              <div className="rx-grid">
                {catalog.map(c => {
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
          onClose={() => { setDetail(null); if (returnToReview) { setReturnToReview(false); setReviewing(true); } }}
          onSave={(sizes) => {
            const total = Object.values(sizes).reduce((a, q) => a + (Number(q) || 0), 0);
            const next = { ...cart };
            if (total > 0) next[detail.itemId] = { sizes };
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
                const units = Object.values(line.sizes).reduce((a, q) => a + (Number(q) || 0), 0);
                const sizeText = sortSizes(Object.entries(line.sizes).filter(([, q]) => Number(q) > 0).map(([size, qty]) => ({ size, qty: Number(qty) })))
                  .map(s => `${s.size} ${s.qty}`).join(" · ");
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

function ItemSheet({ entry, line, onClose, onSave }: {
  entry: CatalogEntry;
  line: CartLine | null;
  onClose: () => void;
  onSave: (sizes: Record<string, number>) => void;
}) {
  // Local string state per size so typing isn't fought by parsing —
  // prefill from the cart line if editing, else from the last run.
  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (line) {
      for (const [size, q] of Object.entries(line.sizes)) out[size] = String(q);
      for (const s of entry.lastSizes) if (!(s.size in out)) out[s.size] = "0";
    } else {
      for (const s of entry.lastSizes) out[s.size] = String(s.qty);
    }
    if (Object.keys(out).length === 0) out["OSFA"] = String(entry.lastQty || 0);
    return out;
  });
  const total = Object.values(qtys).reduce((a, v) => a + (Math.max(0, Math.round(Number(v) || 0))), 0);
  const orderedSizes = sortSizes(Object.keys(qtys).map(size => ({ size, qty: 0 }))).map(s => s.size);

  function commit() {
    const sizes: Record<string, number> = {};
    for (const [size, v] of Object.entries(qtys)) {
      const q = Math.max(0, Math.round(Number(v) || 0));
      if (q > 0) sizes[size] = q;
    }
    onSave(sizes);
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
              Quantities <span style={{ color: H.dim, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>· prefilled from your last run</span>
            </div>
            {orderedSizes.length <= 8 ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {orderedSizes.map(size => (
                  <label key={size} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: H.dim, fontFamily: H.mono, letterSpacing: "0.05em" }}>{size}</span>
                    <input className="rx-qty" type="text" inputMode="numeric" value={qtys[size] ?? "0"}
                      onFocus={e => e.currentTarget.select()}
                      onChange={e => setQtys(p => ({ ...p, [size]: e.target.value.replace(/[^0-9]/g, "") }))} />
                  </label>
                ))}
              </div>
            ) : (
              /* Dimensional runs (waist/inseam pants etc.) — aligned rows,
                 label left / qty right, wrapping into columns on wide screens. */
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "4px 18px", maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                {orderedSizes.map(size => (
                  <label key={size} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderBottom: `1px solid ${H.line}`, padding: "5px 0" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: H.dim, fontFamily: H.mono, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{size}</span>
                    <input className="rx-qty" style={{ width: 58, flexShrink: 0 }} type="text" inputMode="numeric" value={qtys[size] ?? "0"}
                      onFocus={e => e.currentTarget.select()}
                      onChange={e => setQtys(p => ({ ...p, [size]: e.target.value.replace(/[^0-9]/g, "") }))} />
                  </label>
                ))}
              </div>
            )}
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
              <button onClick={() => onSave({})}
                style={{ background: "transparent", color: H.dim, border: `1px solid ${H.line}`, borderRadius: 999, padding: "13px 20px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
