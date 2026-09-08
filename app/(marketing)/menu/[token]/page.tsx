"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

// /menu/[token] — the unlisted menu, shaped like the shop it sits next to.
// Cards open a style modal (full palette, qty, live math) and picks
// accumulate into a QUOTE BASKET; the sticky bar reviews the basket, where
// art files + contact ride along with the request. The token is a
// menu_leads row and the URL doubles as the emailed return link; the
// basket autosaves so the page reopens mid-thought.
//
// Styled to match /shop: #0a0a0c ground, #141417 sharp cards with white
// square image wells, uppercase headings, teal/amber accents.

type MenuColor = { name: string; hex: string | null; image: string | null };
type PaletteColor = { name: string; hex: string | null; image?: string | null };
type StyleRow = {
  code: string;
  name: string;
  lane: string;
  group: string;
  sort: number;
  bands: Record<string, { lo: number | null; hi: number | null }>;
  hero: string | null;
  colors: MenuColor[];
  allColors: PaletteColor[];
  moreColors: number;
};

type QuoteItem = { styleCode: string; qty: number; colors: string[] };
type FileRef = { filename: string; path: string; size: number; uploading?: boolean; url?: string };
type Picks = {
  items: QuoteItem[];
  budget: number | null;
  artStatus: "ready" | "need_help" | null;
  notes: string;
  files: FileRef[];
};

const DEFAULT_PICKS: Picks = { items: [], budget: null, artStatus: null, notes: "", files: [] };

const LANES: { key: string; label: string; blurb: string }[] = [
  { key: "la_apparel", label: "LA Apparel", blurb: "Made in Los Angeles. The premium washed look our drops are known for." },
  { key: "as_colour", label: "AS Colour", blurb: "Boxy, heavy, consistent. The modern brand standard." },
  { key: "popular", label: "Popular Picks", blurb: "Our most printed blanks. Dependable and priced right." },
];

const STYLE_META: Record<string, { spec: string; blurb: string }> = {
  "1801GD": { spec: "6.5 oz · garment dyed", blurb: "The heavyweight with the lived-in fade." },
  "1801MW": { spec: "6.5 oz · mineral wash", blurb: "Every piece washes a little different." },
  "5001":   { spec: "midweight · clean fit", blurb: "The modern staple. Huge color range." },
  "5026":   { spec: "heavyweight · boxy", blurb: "Heavy, structured, streetwear cut." },
  "5082":   { spec: "extra heavy · oversized", blurb: "The heaviest tee on the menu." },
  "NL6210": { spec: "CVC blend · soft", blurb: "Soft, durable, and the best value here." },
  "NL3600": { spec: "lightweight cotton", blurb: "Clean lightweight staple." },
  "CC1717": { spec: "6.1 oz · garment dyed", blurb: "The vintage-fade classic everyone knows." },
  "HF-09":  { spec: "14 oz heavy fleece", blurb: "Serious hoodie weight, garment dyed." },
  "5101":   { spec: "midweight fleece", blurb: "The clean everyday hood." },
  "IND4000": { spec: "10 oz fleece", blurb: "Our most printed hoodie." },
};

const bandFor = (qty: number) =>
  qty >= 500 ? 500 : qty >= 250 ? 250 : qty >= 100 ? 100 : 48;

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${n.toFixed(2)}`;

// /shop design language.
const BG = "#0a0a0c";
const CARD = "#141417";
const LINE = "rgba(255,255,255,0.1)";
const LINE_SOFT = "rgba(255,255,255,0.06)";
const TEXT = "#ffffff";
const MUTED = "rgba(255,255,255,0.7)";
const FAINT = "rgba(255,255,255,0.45)";
const TEAL = "#73B6C9";
const AMBER = "#E0A26A";
const monoFont = "'SF Mono',ui-monospace,Menlo,monospace";

const eyebrowStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.16em", color: TEAL,
};

function itemRange(style: StyleRow, qty: number): { lo: number; hi: number } | null {
  const r = style.bands[bandFor(Math.max(qty, 48))];
  return r?.lo != null && r?.hi != null ? { lo: r.lo, hi: r.hi } : null;
}

export default function MenuPage() {
  const { token } = useParams<{ token: string }>();
  const [invalid, setInvalid] = useState(false);
  const [styles, setStyles] = useState<StyleRow[] | null>(null);
  const [picks, setPicks] = useState<Picks>(DEFAULT_PICKS);
  const [status, setStatus] = useState<string>("browsed");
  const [openStyle, setOpenStyle] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPicks = useRef(picks);
  latestPicks.current = picks;

  useEffect(() => {
    fetch(`/api/menu/lead/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setStyles(d.styles || []);
        setStatus(d.status || "browsed");
        const p = d.picks || {};
        setPicks({
          ...DEFAULT_PICKS,
          ...p,
          items: Array.isArray(p.items) ? p.items : [],
          files: (Array.isArray(p.files) ? p.files : []).map((f: FileRef) => ({ ...f, uploading: false })),
        });
        loaded.current = true;
      })
      .catch(() => setInvalid(true));
  }, [token]);

  async function savePicksNow(p: Picks) {
    const clean = { ...p, files: p.files.filter((f) => !f.uploading).map(({ uploading: _u, ...rest }) => rest) };
    await fetch(`/api/menu/lead/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: clean }),
    }).catch(() => {});
  }

  // Autosave (debounced) — the return link reopens right here.
  useEffect(() => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => savePicksNow(latestPicks.current), 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [picks, token]);

  const tees = useMemo(() => (styles || []).filter((s) => s.group === "tee"), [styles]);
  const byCode = useMemo(() => Object.fromEntries((styles || []).map((s) => [s.code, s])), [styles]);

  const basket = useMemo(() => {
    let pieces = 0, lo = 0, hi = 0, priced = 0;
    for (const it of picks.items) {
      const st = byCode[it.styleCode];
      pieces += it.qty;
      const r = st ? itemRange(st, it.qty) : null;
      if (r) { lo += r.lo * it.qty; hi += r.hi * it.qty; priced++; }
    }
    return { pieces, lo, hi, priced };
  }, [picks.items, byCode]);

  const budgetEstimate = useMemo(() => {
    if (!picks.budget || tees.length === 0) return null;
    const st = byCode[picks.items[0]?.styleCode] || tees[0];
    let b = 100;
    for (let i = 0; i < 3; i++) {
      const r = st.bands[b];
      if (!r?.lo || !r?.hi) return null;
      const units = Math.floor(picks.budget / ((r.lo + r.hi) / 2));
      const nb = bandFor(Math.max(units, 48));
      if (nb === b) return { units, style: st };
      b = nb;
    }
    const r = st.bands[b];
    if (!r?.lo || !r?.hi) return null;
    return { units: Math.floor(picks.budget / ((r.lo + r.hi) / 2)), style: st };
  }, [picks.budget, picks.items, tees, byCode]);

  function upsertItem(item: QuoteItem) {
    setPicks((p) => {
      const items = p.items.some((i) => i.styleCode === item.styleCode)
        ? p.items.map((i) => (i.styleCode === item.styleCode ? item : i))
        : [...p.items, item];
      return { ...p, items };
    });
  }
  function removeItem(styleCode: string) {
    setPicks((p) => ({ ...p, items: p.items.filter((i) => i.styleCode !== styleCode) }));
  }

  if (invalid) {
    return (
      <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <div>
          <div style={{ ...eyebrowStyle, marginBottom: 12 }}>House Party Distro</div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: TEXT, margin: "0 0 10px", textTransform: "uppercase" }}>This link is not active</h1>
          <p style={{ color: MUTED, fontSize: 14 }}>
            Knock again at <a href="/start" style={{ color: TEAL }}>housepartydistro.com/start</a> and we will send you a fresh one.
          </p>
        </div>
      </div>
    );
  }
  if (styles === null) {
    return <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: FAINT, fontSize: 14 }}>Opening the menu...</div>;
  }

  const openStyleRow = openStyle ? byCode[openStyle] : null;

  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT }}>
      <section style={{ background: BG, padding: "144px 32px 40px", textAlign: "center" }}>
        <div style={{ ...eyebrowStyle, marginBottom: 14 }}>By invitation · Real styles · Real prices</div>
        <h1 style={{ fontSize: "clamp(32px, 5.5vw, 60px)", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase", lineHeight: 1.05, margin: 0 }}>
          The Menu.
        </h1>
        <p style={{ color: MUTED, fontSize: 14, maxWidth: 520, lineHeight: 1.6, margin: "16px auto 0" }}>
          The blanks we actually print, at the prices we actually charge. Tap a style to build
          your quote request — ask for the real number when it feels right.
        </p>
      </section>

      <section style={{ padding: "8px 32px 170px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>

          {(status === "quote_requested" || status === "responded" || justSent) && (
            <div style={{ border: `1px solid ${TEAL}`, background: CARD, padding: "14px 18px", marginBottom: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>
                {justSent ? "Got it. A human replies within 1 business day." : "Quote requested. We are on it."}
              </div>
              <div style={{ fontSize: 12, color: MUTED }}>Keep browsing — your picks stay saved, and you can update your request any time.</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 34, justifyContent: "center" }}>
            <Chip on>Tees</Chip>
            <Chip dim>Hoodies · soon</Chip>
            <Chip dim>Headwear · soon</Chip>
          </div>

          {LANES.map((lane) => {
            const laneStyles = tees.filter((s) => s.lane === lane.key);
            if (laneStyles.length === 0) return null;
            return (
              <section key={lane.key} style={{ marginBottom: 44 }}>
                <div style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, textTransform: "uppercase" }}>{lane.label}</h2>
                  <span style={{ fontSize: 12.5, color: FAINT }}>{lane.blurb}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "24px 20px" }}>
                  {laneStyles.map((s) => {
                    const inQuote = picks.items.find((i) => i.styleCode === s.code);
                    const r = itemRange(s, inQuote?.qty ?? 100);
                    const meta = STYLE_META[s.code];
                    return (
                      <div
                        key={s.code}
                        onClick={() => setOpenStyle(s.code)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setOpenStyle(s.code)}
                        style={{
                          textAlign: "left", cursor: "pointer", background: CARD,
                          border: inQuote ? `1px solid ${TEAL}` : `1px solid ${LINE_SOFT}`,
                          boxShadow: inQuote ? `0 0 0 1px ${TEAL}` : "none",
                          overflow: "hidden", position: "relative",
                        }}
                      >
                        {inQuote && (
                          <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2, background: TEAL, color: BG, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", padding: "4px 8px", textTransform: "uppercase" }}>
                            In quote · {inQuote.qty}
                          </div>
                        )}
                        {s.hero ? (
                          <div style={{ aspectRatio: "1 / 1", background: "#fff", padding: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <img src={s.hero} alt={s.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                          </div>
                        ) : (
                          <div style={{ aspectRatio: "1 / 1", background: "linear-gradient(160deg,#1b1b20,#101013)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: FAINT, letterSpacing: "0.1em", fontFamily: monoFont, textTransform: "uppercase" }}>
                            {s.code} · photo coming
                          </div>
                        )}
                        <div style={{ padding: "14px 16px 16px" }}>
                          <div style={{ ...eyebrowStyle, color: inQuote ? TEAL : FAINT, marginBottom: 6 }}>{meta?.spec}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", lineHeight: 1.25, marginBottom: 4 }}>{s.name}</div>
                          <div style={{ fontSize: 12, color: FAINT, lineHeight: 1.45, marginBottom: 10 }}>{meta?.blurb}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,0.82)", fontFamily: monoFont }}>
                              {r ? <>{money(r.lo)}–{money(r.hi)}<span style={{ fontSize: 11, color: FAINT, fontWeight: 400 }}>/pc</span></> : <span style={{ fontSize: 12, color: FAINT }}>ask us</span>}
                            </span>
                            <span style={{ fontSize: 10.5, color: FAINT, fontFamily: monoFont }}>
                              {s.allColors.length > 0 ? `${s.allColors.length} colors` : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {/* Budget helper */}
          <section style={{ background: CARD, border: `1px solid ${LINE_SOFT}`, padding: 22, marginBottom: 18 }}>
            <div style={{ ...eyebrowStyle, marginBottom: 12 }}>Not sure where to start? Start from your budget</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[2500, 5000, 10000].map((b) => (
                <Chip key={b} on={picks.budget === b} onClick={() => setPicks((p) => ({ ...p, budget: p.budget === b ? null : b }))}>${b.toLocaleString()}</Chip>
              ))}
            </div>
            {budgetEstimate && (
              <div style={{ fontSize: 13, color: MUTED, marginTop: 10 }}>
                ${picks.budget!.toLocaleString()} runs roughly <b style={{ color: TEXT }}>{Math.floor(budgetEstimate.units / 10) * 10} pieces</b> of the {budgetEstimate.style.name}, one design. Tap a style above to build on that.
              </div>
            )}
          </section>

          <p style={{ fontSize: 12, color: FAINT, lineHeight: 1.6, maxWidth: 620 }}>
            Prices include a 1–2 location print and are shown as ranges on purpose — the real
            quote is exact, comes from a human, and lands within 1 business day of asking.
            48 piece minimum per design; each colorway runs its own minimum. Specialty inks,
            extra locations, and rush timelines move the number.
          </p>
        </div>
      </section>

      {/* Sticky basket bar */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "rgba(10,10,12,0.92)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderTop: `1px solid ${LINE}`, padding: "12px 20px", zIndex: 40 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: MUTED, minWidth: 200 }}>
            {picks.items.length > 0 ? (
              <>
                <b style={{ color: TEXT }}>{picks.items.length} {picks.items.length === 1 ? "style" : "styles"}</b>
                {" · "}{basket.pieces.toLocaleString()} pieces
                {basket.priced > 0 && (
                  <>
                    {" · approx "}
                    <span style={{ fontFamily: monoFont, color: TEAL }}>
                      ${Math.round(basket.lo).toLocaleString()}–${Math.round(basket.hi).toLocaleString()}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span style={{ color: FAINT }}>Tap a style to start your quote — or just tell us what you are thinking</span>
            )}
          </div>
          <button
            onClick={() => setReviewOpen(true)}
            style={{ background: TEXT, color: BG, border: "none", padding: "13px 28px", fontSize: 13, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em" }}
          >
            {status === "quote_requested" || status === "responded" ? "Update my request" : picks.items.length > 0 ? "Review quote request" : "Request my real quote"}
          </button>
        </div>
      </div>

      {openStyleRow && (
        <StyleModal
          style={openStyleRow}
          existing={picks.items.find((i) => i.styleCode === openStyleRow.code) || null}
          onClose={() => setOpenStyle(null)}
          onSave={(item) => { upsertItem(item); setOpenStyle(null); }}
          onRemove={() => { removeItem(openStyleRow.code); setOpenStyle(null); }}
        />
      )}

      {reviewOpen && (
        <ReviewModal
          token={token}
          picks={picks}
          setPicks={setPicks}
          byCode={byCode}
          onEditItem={(code) => { setReviewOpen(false); setOpenStyle(code); }}
          onRemoveItem={removeItem}
          onClose={() => setReviewOpen(false)}
          savePicksNow={savePicksNow}
          onSent={() => { setReviewOpen(false); setStatus("quote_requested"); setJustSent(true); }}
        />
      )}
    </div>
  );
}

// ─── Style modal (the product view) ─────────────────────────────

function StyleModal({ style, existing, onClose, onSave, onRemove }: {
  style: StyleRow;
  existing: QuoteItem | null;
  onClose: () => void;
  onSave: (item: QuoteItem) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState<number>(existing?.qty ?? 100);
  const [colors, setColors] = useState<string[]>(existing?.colors ?? []);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const meta = STYLE_META[style.code];
  const r = itemRange(style, qty);
  const colorways = Math.max(colors.length, 1);
  const minPieces = colorways * 48;
  const underMin = qty < minPieces;

  // One tap = select the color AND show its garment photo. Tapping a
  // selected color deselects it (preview stays put so nothing flashes).
  function toggleColor(c: PaletteColor) {
    const selecting = !colors.includes(c.name);
    setColors((cs) => selecting ? [...cs, c.name] : cs.filter((x) => x !== c.name));
    if (selecting && c.image) setPreviewImg(c.image);
  }

  const img = previewImg || style.hero;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: CARD, border: `1px solid ${LINE}`, width: "100%", maxWidth: 760, maxHeight: "92vh", overflowY: "auto" }}>
        <div className="hpd-menu-modal-grid" style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) minmax(280px,1.2fr)" }}>
          <style>{`@media (max-width: 640px){ .hpd-menu-modal-grid { grid-template-columns: 1fr !important; } }`}</style>

          {/* Image well */}
          <div style={{ background: "#fff", minHeight: 260, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
            {img
              ? <img src={img} alt={style.name} style={{ width: "100%", maxHeight: 420, objectFit: "contain", display: "block" }} />
              : <span style={{ fontSize: 11, color: "#999", fontFamily: monoFont, textTransform: "uppercase", letterSpacing: "0.1em" }}>{style.code} · photo coming</span>}
          </div>

          {/* Details */}
          <div style={{ padding: "22px 22px 18px", color: TEXT }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div style={{ ...eyebrowStyle, marginBottom: 6 }}>{meta?.spec}</div>
                <h3 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.2 }}>{style.name}</h3>
              </div>
              <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: FAINT, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: "8px 0 16px" }}>{meta?.blurb}</p>

            {/* Palette */}
            {style.allColors.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ ...eyebrowStyle, color: FAINT, marginBottom: 8 }}>
                  Colors · pick what you are feeling {colors.length > 0 ? `(${colors.length} selected)` : "(optional)"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto", paddingRight: 4 }}>
                  {style.allColors.map((c) => {
                    const sel = colors.includes(c.name);
                    return (
                      <button
                        key={c.name}
                        onClick={() => toggleColor(c)}
                        title={c.name}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          background: sel ? "rgba(115,182,201,0.15)" : "transparent",
                          border: sel ? `1px solid ${TEAL}` : `1px solid ${LINE_SOFT}`,
                          color: sel ? TEXT : MUTED, fontSize: 11, padding: "4px 9px 4px 5px",
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        <span style={{ width: 14, height: 14, borderRadius: 99, background: c.hex || "#2a2a30", border: `1px solid ${LINE}`, flexShrink: 0 }} />
                        {c.name}
                      </button>
                    );
                  })}
                </div>
                {colors.length > 1 && (
                  <div style={{ fontSize: 11.5, color: AMBER, marginTop: 8 }}>
                    {colors.length} colorways = {colors.length} × 48 piece minimums ({minPieces}+ total).
                  </div>
                )}
              </div>
            )}

            {/* Qty */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...eyebrowStyle, color: FAINT, marginBottom: 8 }}>How many</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {[48, 100, 250, 500].map((q) => (
                  <Chip key={q} small on={qty === q} onClick={() => setQty(q)}>{q}</Chip>
                ))}
                <input
                  type="number"
                  min={1}
                  placeholder="exact"
                  value={[48, 100, 250, 500].includes(qty) ? "" : qty || ""}
                  onChange={(e) => setQty(e.target.value ? Number(e.target.value) : 100)}
                  style={{ width: 76, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 12px", fontSize: 12, fontFamily: monoFont, color: TEXT, background: BG }}
                />
              </div>
              {underMin && (
                <div style={{ fontSize: 11.5, color: AMBER, marginTop: 8 }}>
                  Minimum for this setup is {minPieces} pieces{colors.length > 1 ? ` (${colors.length} colorways)` : " (48 per design)"}.
                </div>
              )}
            </div>

            {/* Live math */}
            <div style={{ borderTop: `1px solid ${LINE_SOFT}`, paddingTop: 14, marginBottom: 18 }}>
              {r ? (
                <div style={{ fontSize: 14, fontFamily: monoFont }}>
                  {money(r.lo)}–{money(r.hi)}<span style={{ fontSize: 11, color: FAINT }}> /pc at {bandFor(Math.max(qty, 48))}+</span>
                  <span style={{ color: FAINT }}> · </span>
                  <span style={{ color: TEAL }}>≈ ${Math.round(r.lo * Math.max(qty, 48)).toLocaleString()}–${Math.round(r.hi * Math.max(qty, 48)).toLocaleString()}</span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: FAINT }}>No menu price for this one yet — ask and a human quotes it.</div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => onSave({ styleCode: style.code, qty: Math.max(qty, 1), colors })}
                style={{ flex: 1, background: TEXT, color: BG, border: "none", padding: "13px 0", fontSize: 12.5, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em" }}
              >
                {existing ? "Update quote" : "Add to quote"}
              </button>
              {existing && (
                <button onClick={onRemove} style={{ background: "transparent", color: FAINT, border: `1px solid ${LINE}`, padding: "13px 16px", fontSize: 12.5, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Review modal (basket → request) ────────────────────────────

function ReviewModal({ token, picks, setPicks, byCode, onEditItem, onRemoveItem, onClose, savePicksNow, onSent }: {
  token: string;
  picks: Picks;
  setPicks: React.Dispatch<React.SetStateAction<Picks>>;
  byCode: Record<string, StyleRow>;
  onEditItem: (code: string) => void;
  onRemoveItem: (code: string) => void;
  onClose: () => void;
  savePicksNow: (p: Picks) => Promise<void>;
  onSent: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadsPending = picks.files.some((f) => f.uploading);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list).slice(0, 6)) {
      if (file.size > 100 * 1024 * 1024) continue;
      const temp: FileRef = { filename: file.name, path: "", size: file.size, uploading: true };
      setPicks((p) => ({ ...p, files: [...p.files, temp] }));
      try {
        const init = await fetch("/api/onboard/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, session: `menu-${token.slice(0, 16)}` }),
        }).then((r) => r.json());
        if (!init?.uploadUrl) throw new Error("no upload url");
        const put = await fetch(init.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
        if (!put.ok) throw new Error(`upload ${put.status}`);
        setPicks((p) => ({
          ...p,
          files: p.files.map((f) => (f === temp || (f.filename === file.name && f.uploading) ? { filename: file.name, path: init.path, size: file.size, uploading: false } : f)),
        }));
      } catch {
        setPicks((p) => ({ ...p, files: p.files.filter((f) => !(f.filename === file.name && f.uploading)) }));
        setErr(`Upload failed for ${file.name}.`);
      }
    }
  }

  async function removeFile(f: FileRef) {
    setPicks((p) => ({ ...p, files: p.files.filter((x) => x.path !== f.path) }));
    if (f.path) fetch("/api/onboard/upload", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: f.path }) }).catch(() => {});
  }

  async function send() {
    if (!name.trim() || sending || uploadsPending) return;
    setSending(true);
    setErr(null);
    await savePicksNow(picks); // flush the basket before the snapshot freezes
    const res = await fetch(`/api/menu/lead/${token}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, neededBy }),
    }).catch(() => null);
    setSending(false);
    if (res?.ok) { onSent(); return; }
    setErr("Something went wrong. Try again.");
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: CARD, border: `1px solid ${LINE}`, padding: 26, width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", color: TEXT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>The real number</div>
            <h3 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 900, textTransform: "uppercase" }}>Your quote request</h3>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: FAINT, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
          A human replies with exact pricing within 1 business day.
        </p>

        {/* Line items */}
        {picks.items.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
            {picks.items.map((it) => {
              const st = byCode[it.styleCode];
              const r = st ? itemRange(st, it.qty) : null;
              return (
                <div key={it.styleCode} style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${LINE_SOFT}`, padding: "10px 12px" }}>
                  {st?.hero && (
                    <span style={{ width: 44, height: 44, background: "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 3 }}>
                      <img src={st.hero} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onEditItem(it.styleCode)}>
                    <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase" }}>{st?.name || it.styleCode}</div>
                    <div style={{ fontSize: 11.5, color: FAINT, fontFamily: monoFont }}>
                      {it.qty} pcs{it.colors.length ? ` · ${it.colors.slice(0, 3).join(", ")}${it.colors.length > 3 ? ` +${it.colors.length - 3}` : ""}` : ""}
                      {r ? ` · ≈ $${Math.round(r.lo * it.qty).toLocaleString()}–$${Math.round(r.hi * it.qty).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <button onClick={() => onRemoveItem(it.styleCode)} aria-label="Remove" style={{ background: "transparent", border: "none", color: FAINT, fontSize: 16, cursor: "pointer" }}>×</button>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ border: `1px dashed ${LINE}`, padding: "12px 14px", fontSize: 12.5, color: MUTED, marginBottom: 18 }}>
            No styles picked yet — that is fine. Tell us what you are thinking below and we will point you right.
          </div>
        )}

        {/* Art */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...eyebrowStyle, color: FAINT, marginBottom: 8 }}>Your art</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <Chip small on={picks.artStatus === "ready"} onClick={() => setPicks((p) => ({ ...p, artStatus: p.artStatus === "ready" ? null : "ready" }))}>Art is ready</Chip>
            <Chip small on={picks.artStatus === "need_help"} onClick={() => setPicks((p) => ({ ...p, artStatus: p.artStatus === "need_help" ? null : "need_help" }))}>I need design help</Chip>
          </div>
          <input ref={fileInput} type="file" multiple accept="image/*,.pdf,.ai,.psd,.eps,.svg,.zip" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button onClick={() => fileInput.current?.click()} style={{ background: "transparent", border: `1px dashed ${LINE}`, color: MUTED, fontSize: 12, padding: "9px 14px", cursor: "pointer", width: "100%", fontFamily: "inherit" }}>
            + Attach art files if you have them (optional)
          </button>
          {picks.files.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
              {picks.files.map((f, i) => (
                <div key={`${f.path || f.filename}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: MUTED, fontFamily: monoFont }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</span>
                  {f.uploading
                    ? <span style={{ color: TEAL }}>uploading...</span>
                    : <button onClick={() => removeFile(f)} style={{ background: "transparent", border: "none", color: FAINT, cursor: "pointer", fontSize: 13 }}>×</button>}
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Anything else" value={picks.notes} onChange={(v) => setPicks((p) => ({ ...p, notes: v.slice(0, 1200) }))} textarea placeholder="The vibe, a reference brand, a deadline..." />
        <Field label="Name" value={name} onChange={setName} autoFocus={picks.items.length > 0} />
        <Field label="Phone (optional)" value={phone} onChange={setPhone} />
        <Field label="Needed by (optional)" value={neededBy} onChange={setNeededBy} placeholder="e.g. mid October" />
        {err && <div style={{ fontSize: 12, color: "#ff8a96", marginTop: 4 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            onClick={send}
            disabled={!name.trim() || sending || uploadsPending}
            style={{ flex: 1, background: TEXT, color: BG, border: "none", padding: "13px 0", fontSize: 13, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em", opacity: !name.trim() || sending || uploadsPending ? 0.5 : 1 }}
          >
            {sending ? "Sending..." : uploadsPending ? "Waiting on uploads..." : "Send it"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ children, on, dim, small, onClick }: { children: React.ReactNode; on?: boolean; dim?: boolean; small?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={dim || !onClick}
      style={{
        border: on ? `1px solid ${TEXT}` : `1px solid ${LINE}`,
        background: on ? TEXT : "transparent",
        color: dim ? "rgba(255,255,255,0.3)" : on ? BG : MUTED,
        borderRadius: 999,
        padding: small ? "6px 14px" : "8px 18px",
        fontSize: small ? 12 : 13,
        fontWeight: 700,
        cursor: dim || !onClick ? "default" : "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, textarea, autoFocus }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; textarea?: boolean; autoFocus?: boolean }) {
  const common: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", border: `1px solid ${LINE}`,
    padding: "11px 12px", fontSize: 14, fontFamily: "inherit", color: TEXT, background: BG,
  };
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: FAINT, marginBottom: 6, textTransform: "uppercase" }}>{label}</span>
      {textarea
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...common, minHeight: 60, resize: "vertical" }} />
        : <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} style={common} />}
    </label>
  );
}
