"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

// /menu/[token] — the unlisted menu. Public but not in the nav; the token
// is a menu_leads row and the URL doubles as the personal return link
// emailed from the gate. Picks autosave against the lead as the customer
// browses; "Request my real quote" promotes the lead to quote_requested
// and staff pick it up in /intake.
//
// Styled to match /shop (the site's shopping experience): #0a0a0c ground,
// #141417 sharp-cornered cards with white square image wells, uppercase
// headings, teal/amber accents. Tees only for now — hoodies and headwear
// chips are visible but marked soon. Prices come live from menu_rates
// (lo/hi only; cost basis never leaves the building).

type MenuColor = { name: string; hex: string | null; image: string | null };
type StyleRow = {
  code: string;
  name: string;
  lane: string;
  group: string;
  sort: number;
  bands: Record<string, { lo: number | null; hi: number | null }>;
  hero: string | null;
  colors: MenuColor[];
  moreColors: number;
};

type Picks = {
  productGroup: string;
  styleCode: string | null;
  qty: number | null;
  notSure: boolean;
  budget: number | null;
  colorways: number;
  artStatus: "ready" | "need_help" | null;
  notes: string;
};

const DEFAULT_PICKS: Picks = {
  productGroup: "tee",
  styleCode: null,
  qty: 100,
  notSure: false,
  budget: null,
  colorways: 1,
  artStatus: null,
  notes: "",
};

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

export default function MenuPage() {
  const { token } = useParams<{ token: string }>();
  const [invalid, setInvalid] = useState(false);
  const [styles, setStyles] = useState<StyleRow[] | null>(null);
  const [picks, setPicks] = useState<Picks>(DEFAULT_PICKS);
  const [status, setStatus] = useState<string>("browsed");
  const [quoteOpen, setQuoteOpen] = useState(false);
  // Per-card colorway preview: styleCode → the tapped color's image.
  const [colorPreview, setColorPreview] = useState<Record<string, string>>({});
  const [qName, setQName] = useState("");
  const [qPhone, setQPhone] = useState("");
  const [qNeeded, setQNeeded] = useState("");
  const [qNotes, setQNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/menu/lead/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setStyles(d.styles || []);
        setStatus(d.status || "browsed");
        if (d.picks && Object.keys(d.picks).length > 0) setPicks({ ...DEFAULT_PICKS, ...d.picks });
        loaded.current = true;
      })
      .catch(() => setInvalid(true));
  }, [token]);

  // Autosave picks (debounced) — the return link reopens right here.
  useEffect(() => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/menu/lead/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks }),
      }).catch(() => {});
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [picks, token]);

  const tees = useMemo(
    () => (styles || []).filter((s) => s.group === "tee"),
    [styles]
  );
  const selected = tees.find((s) => s.code === picks.styleCode) || null;
  const qty = picks.notSure ? 100 : (picks.qty ?? 100);
  const band = bandFor(Math.max(qty, 48));
  const range = selected?.bands[band] || null;
  const underMin = !picks.notSure && (picks.qty ?? 0) > 0 && (picks.qty ?? 0) < 48;

  // Budget-first estimate: what does $X buy of the selected (or cheapest) style.
  const budgetEstimate = useMemo(() => {
    if (!picks.budget) return null;
    const st = selected || tees[0];
    if (!st) return null;
    let b = 100;
    for (let i = 0; i < 3; i++) {
      const r = st.bands[b];
      if (!r?.lo || !r?.hi) return null;
      const mid = (r.lo + r.hi) / 2;
      const units = Math.floor(picks.budget / mid);
      const nb = bandFor(Math.max(units, 48));
      if (nb === b) return { units, style: st };
      b = nb;
    }
    const r = st.bands[b];
    if (!r?.lo || !r?.hi) return null;
    return { units: Math.floor(picks.budget / ((r.lo + r.hi) / 2)), style: st };
  }, [picks.budget, selected, tees]);

  async function submitQuote() {
    if (!qName.trim() || sending) return;
    setSending(true);
    const res = await fetch(`/api/menu/lead/${token}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: qName, phone: qPhone, neededBy: qNeeded, notes: qNotes }),
    }).catch(() => null);
    setSending(false);
    if (res?.ok) {
      setStatus("quote_requested");
      setJustSent(true);
      setQuoteOpen(false);
    }
  }

  if (invalid) {
    return (
      <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <div>
          <div style={{ ...eyebrowStyle, marginBottom: 12 }}>House Party Distro</div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: TEXT, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "-0.01em" }}>This link is not active</h1>
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

  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT }}>
      {/* Hero band — matches /shop */}
      <section style={{ background: BG, padding: "144px 32px 40px", textAlign: "center" }}>
        <div style={{ ...eyebrowStyle, marginBottom: 14 }}>By invitation · Real styles · Real prices</div>
        <h1 style={{
          fontSize: "clamp(32px, 5.5vw, 60px)", fontWeight: 900,
          letterSpacing: "-0.02em", textTransform: "uppercase", lineHeight: 1.05, margin: 0,
        }}>
          The Menu.
        </h1>
        <p style={{ color: MUTED, fontSize: 14, maxWidth: 520, lineHeight: 1.6, margin: "16px auto 0" }}>
          The blanks we actually print, at the prices we actually charge. Pick a direction,
          see the math, ask for the real quote when it feels right.
        </p>
      </section>

      <section style={{ padding: "8px 32px 160px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>

          {(status === "quote_requested" || justSent) && (
            <div style={{ border: `1px solid ${TEAL}`, background: CARD, padding: "14px 18px", marginBottom: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {justSent ? "Got it. A human replies within 1 business day." : "Quote requested. We are on it."}
              </div>
              <div style={{ fontSize: 12, color: MUTED }}>Keep browsing — your picks stay saved, and you can update your request any time.</div>
            </div>
          )}

          {/* Product chips */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 34, justifyContent: "center" }}>
            <Chip on>Tees</Chip>
            <Chip dim>Hoodies · soon</Chip>
            <Chip dim>Headwear · soon</Chip>
          </div>

          {/* Lanes */}
          {LANES.map((lane) => {
            const laneStyles = tees.filter((s) => s.lane === lane.key);
            if (laneStyles.length === 0) return null;
            return (
              <section key={lane.key} style={{ marginBottom: 44 }}>
                <div style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 900, color: TEXT, margin: 0, textTransform: "uppercase", letterSpacing: "0.01em" }}>{lane.label}</h2>
                  <span style={{ fontSize: 12.5, color: FAINT }}>{lane.blurb}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "24px 20px" }}>
                  {laneStyles.map((s) => {
                    const on = picks.styleCode === s.code;
                    const r = s.bands[band];
                    const meta = STYLE_META[s.code];
                    const shownImg = colorPreview[s.code] || s.hero;
                    return (
                      <div
                        key={s.code}
                        onClick={() => setPicks((p) => ({ ...p, styleCode: on ? null : s.code }))}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setPicks((p) => ({ ...p, styleCode: on ? null : s.code }))}
                        style={{
                          textAlign: "left", cursor: "pointer", background: CARD,
                          border: on ? `1px solid ${TEAL}` : `1px solid ${LINE_SOFT}`,
                          boxShadow: on ? `0 0 0 1px ${TEAL}` : "none",
                          overflow: "hidden",
                        }}
                      >
                        {/* White square image well — matches /shop product cards */}
                        {shownImg ? (
                          <div style={{ aspectRatio: "1 / 1", background: "#fff", padding: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <img src={shownImg} alt={s.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                          </div>
                        ) : (
                          <div style={{ aspectRatio: "1 / 1", background: "linear-gradient(160deg,#1b1b20,#101013)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: FAINT, letterSpacing: "0.1em", fontFamily: monoFont, textTransform: "uppercase" }}>
                            {s.code} · photo coming
                          </div>
                        )}
                        <div style={{ padding: "14px 16px 16px" }}>
                          <div style={{ ...eyebrowStyle, color: on ? TEAL : FAINT, marginBottom: 6 }}>{meta?.spec}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.01em", lineHeight: 1.25, marginBottom: 4 }}>{s.name}</div>
                          <div style={{ fontSize: 12, color: FAINT, lineHeight: 1.45, marginBottom: 12 }}>{meta?.blurb}</div>
                          {s.colors.length > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                              {s.colors.map((c) => (
                                c.hex || c.image ? (
                                  <span
                                    key={c.name}
                                    title={c.name}
                                    onClick={(e) => {
                                      if (!c.image) return;
                                      e.stopPropagation();
                                      setColorPreview((m) => ({ ...m, [s.code]: c.image! }));
                                    }}
                                    style={{
                                      width: 20, height: 20, borderRadius: 99, display: "inline-block",
                                      border: colorPreview[s.code] === c.image && c.image ? `1.5px solid ${TEAL}` : `1px solid ${LINE}`,
                                      cursor: c.image ? "pointer" : "default",
                                      background: c.hex ? c.hex : undefined, overflow: "hidden", flexShrink: 0,
                                    }}
                                  >
                                    {!c.hex && c.image && (
                                      <img src={c.image} alt={c.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(2.4)" }} />
                                    )}
                                  </span>
                                ) : (
                                  <span key={c.name} style={{ fontSize: 10, color: FAINT, fontFamily: monoFont }}>{c.name}</span>
                                )
                              ))}
                              {s.moreColors > 0 && (
                                <span style={{ fontSize: 10.5, color: FAINT, fontFamily: monoFont }}>+{s.moreColors}</span>
                              )}
                            </div>
                          )}
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,0.82)", fontFamily: monoFont }}>
                            {r?.lo != null
                              ? <>{money(r.lo)}–{money(r.hi)}<span style={{ fontSize: 11, color: FAINT, fontWeight: 400 }}> / shirt at {band}+</span></>
                              : <span style={{ fontSize: 12, color: FAINT }}>ask us</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {/* Quantity + budget */}
          <section style={{ background: CARD, border: `1px solid ${LINE_SOFT}`, padding: 22, marginBottom: 18 }}>
            <div style={{ ...eyebrowStyle, marginBottom: 14 }}>How many?</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {[48, 100, 250, 500].map((q) => (
                <Chip key={q} on={!picks.notSure && picks.qty === q} onClick={() => setPicks((p) => ({ ...p, qty: q, notSure: false }))}>{q}</Chip>
              ))}
              <input
                type="number"
                min={1}
                placeholder="exact"
                value={picks.notSure ? "" : (picks.qty && ![48, 100, 250, 500].includes(picks.qty) ? picks.qty : "")}
                onChange={(e) => setPicks((p) => ({ ...p, qty: e.target.value ? Number(e.target.value) : null, notSure: false }))}
                style={{ width: 84, border: `1px solid ${LINE}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontFamily: monoFont, color: TEXT, background: BG }}
              />
              <Chip on={picks.notSure} onClick={() => setPicks((p) => ({ ...p, notSure: !p.notSure }))}>Not sure yet</Chip>
            </div>
            {underMin && (
              <div style={{ fontSize: 12, color: AMBER, marginTop: 10 }}>
                Our minimum is 48 per design — pricing below starts there.
              </div>
            )}
            {picks.notSure && (
              <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>
                No problem. We priced things at 100 pieces so you have a feel — most first drops land between 100 and 250.
              </div>
            )}

            <div style={{ borderTop: `1px solid ${LINE_SOFT}`, margin: "18px 0", paddingTop: 16 }}>
              <div style={{ ...eyebrowStyle, marginBottom: 12 }}>Or start from your budget</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[2500, 5000, 10000].map((b) => (
                  <Chip key={b} on={picks.budget === b} onClick={() => setPicks((p) => ({ ...p, budget: p.budget === b ? null : b }))}>${b.toLocaleString()}</Chip>
                ))}
              </div>
              {budgetEstimate && (
                <div style={{ fontSize: 13, color: MUTED, marginTop: 10 }}>
                  ${picks.budget!.toLocaleString()} runs roughly <b style={{ color: TEXT }}>{Math.floor(budgetEstimate.units / 10) * 10} pieces</b> of the {budgetEstimate.style.name}, one design.
                </div>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${LINE_SOFT}`, paddingTop: 16 }}>
              <div style={{ ...eyebrowStyle, marginBottom: 12 }}>Colorways</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {[1, 2, 3].map((c) => (
                  <Chip key={c} on={picks.colorways === c} onClick={() => setPicks((p) => ({ ...p, colorways: c }))}>{c === 3 ? "3+" : c}</Chip>
                ))}
                {picks.colorways > 1 && (
                  <span style={{ fontSize: 12, color: AMBER }}>
                    Heads up: each colorway runs its own 48-piece minimum — {picks.colorways === 3 ? "3+" : picks.colorways} colorways means {picks.colorways * 48}+ pieces total.
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Art */}
          <section style={{ background: CARD, border: `1px solid ${LINE_SOFT}`, padding: 22, marginBottom: 18 }}>
            <div style={{ ...eyebrowStyle, marginBottom: 14 }}>Your art</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip on={picks.artStatus === "ready"} onClick={() => setPicks((p) => ({ ...p, artStatus: p.artStatus === "ready" ? null : "ready" }))}>Art is ready</Chip>
              <Chip on={picks.artStatus === "need_help"} onClick={() => setPicks((p) => ({ ...p, artStatus: p.artStatus === "need_help" ? null : "need_help" }))}>I need design help</Chip>
            </div>
            {picks.artStatus === "need_help" && (
              <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>
                We have in-house designers who take a logo and a vibe to a finished drop. It is a service we quote alongside the print run.
              </div>
            )}
            <textarea
              placeholder="Anything else? The vibe, a reference brand, a deadline..."
              value={picks.notes}
              onChange={(e) => setPicks((p) => ({ ...p, notes: e.target.value.slice(0, 1200) }))}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 16, border: `1px solid ${LINE}`, padding: "10px 12px", fontSize: 13, minHeight: 64, fontFamily: "inherit", color: TEXT, background: BG, resize: "vertical" }}
            />
          </section>

          <p style={{ fontSize: 12, color: FAINT, lineHeight: 1.6, maxWidth: 620 }}>
            Prices include a 1–2 location print and are shown as ranges on purpose — the real
            quote is exact, comes from a human, and lands within 1 business day of asking.
            Specialty inks, extra locations, and rush timelines move the number.
          </p>
        </div>
      </section>

      {/* Sticky quote bar */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "rgba(10,10,12,0.92)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderTop: `1px solid ${LINE}`, padding: "12px 20px", zIndex: 40 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: MUTED, minWidth: 200 }}>
            {selected && range?.lo != null ? (
              <>
                <b style={{ color: TEXT, textTransform: "uppercase" }}>{selected.name}</b>
                {" · "}{picks.notSure ? "~100" : Math.max(qty, 48)} pieces · <span style={{ fontFamily: monoFont }}>{money(range.lo)}–{money(range.hi)}</span>/shirt
                {" · approx "}
                <span style={{ fontFamily: monoFont, color: TEAL }}>
                  ${Math.round(range.lo * Math.max(qty, 48)).toLocaleString()}–${Math.round(range.hi! * Math.max(qty, 48)).toLocaleString()}
                </span>
              </>
            ) : (
              <span style={{ color: FAINT }}>Pick a style to see your math</span>
            )}
          </div>
          <button
            onClick={() => setQuoteOpen(true)}
            style={{ background: TEXT, color: BG, border: "none", padding: "13px 28px", fontSize: 13, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em" }}
          >
            {status === "quote_requested" ? "Update my request" : "Request my real quote"}
          </button>
        </div>
      </div>

      {/* Quote modal */}
      {quoteOpen && (
        <div onClick={() => setQuoteOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: CARD, border: `1px solid ${LINE}`, padding: 28, width: "100%", maxWidth: 440 }}>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>The real number</div>
            <h3 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 900, color: TEXT, textTransform: "uppercase" }}>Get your quote</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
              Your picks come with it. A human replies within 1 business day.
            </p>
            <Field label="Name" value={qName} onChange={setQName} autoFocus />
            <Field label="Phone (optional)" value={qPhone} onChange={setQPhone} />
            <Field label="Needed by (optional)" value={qNeeded} onChange={setQNeeded} placeholder="e.g. mid October" />
            <Field label="Anything else (optional)" value={qNotes} onChange={setQNotes} textarea />
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={submitQuote} disabled={!qName.trim() || sending} style={{ flex: 1, background: TEXT, color: BG, border: "none", padding: "13px 0", fontSize: 13, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em", opacity: !qName.trim() || sending ? 0.5 : 1 }}>
                {sending ? "Sending..." : "Send it"}
              </button>
              <button onClick={() => setQuoteOpen(false)} style={{ background: "transparent", color: MUTED, border: `1px solid ${LINE}`, padding: "13px 20px", fontSize: 13, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children, on, dim, onClick }: { children: React.ReactNode; on?: boolean; dim?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={dim || !onClick}
      style={{
        border: on ? `1px solid ${TEXT}` : `1px solid ${LINE}`,
        background: on ? TEXT : "transparent",
        color: dim ? "rgba(255,255,255,0.3)" : on ? BG : MUTED,
        borderRadius: 999,
        padding: "8px 18px",
        fontSize: 13,
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
