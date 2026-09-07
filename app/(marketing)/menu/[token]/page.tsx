"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

// /menu/[token] — the unlisted menu. Public but not in the nav; the token
// is a menu_leads row and the URL doubles as the personal return link
// emailed from the gate. Picks autosave against the lead as the customer
// browses; "Request my real quote" promotes the lead to quote_requested
// and staff pick it up in /intake.
//
// Tees only for now — hoodies and headwear chips are visible but marked
// soon, matching the brand-led lineup (LA Apparel · AS Colour · Popular
// Picks). Prices come live from menu_rates (lo/hi only; cost basis never
// leaves the building).

type StyleRow = {
  code: string;
  name: string;
  lane: string;
  group: string;
  sort: number;
  bands: Record<string, { lo: number | null; hi: number | null }>;
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

const ink = "#1a1a1a";
const faint = "#a09a8d";
const muted = "#6b665c";
const line = "#e5e1d8";
const bg = "#faf9f6";
const monoFont = "'SF Mono',ui-monospace,Menlo,monospace";

export default function MenuPage() {
  const { token } = useParams<{ token: string }>();
  const [invalid, setInvalid] = useState(false);
  const [styles, setStyles] = useState<StyleRow[] | null>(null);
  const [picks, setPicks] = useState<Picks>(DEFAULT_PICKS);
  const [status, setStatus] = useState<string>("browsed");
  const [quoteOpen, setQuoteOpen] = useState(false);
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
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", color: faint, marginBottom: 10 }}>HOUSE PARTY DISTRO</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: ink, margin: "0 0 10px" }}>This link is not active</h1>
          <p style={{ color: muted, fontSize: 14 }}>
            Knock again at <a href="/start" style={{ color: ink }}>housepartydistro.com/start</a> and we will send you a fresh one.
          </p>
        </div>
      </div>
    );
  }

  if (styles === null) {
    return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: faint, fontSize: 14 }}>Opening the menu...</div>;
  }

  return (
    <div style={{ background: bg, minHeight: "100vh", paddingTop: 120, paddingBottom: 140 }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 20px" }}>

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: faint, marginBottom: 10 }}>THE MENU · BY INVITATION</div>
        <h1 style={{ fontSize: "clamp(30px,5vw,44px)", fontWeight: 800, color: ink, letterSpacing: "-0.02em", margin: "0 0 10px", lineHeight: 1.1 }}>
          Real styles. Real prices.
        </h1>
        <p style={{ color: muted, fontSize: 15, maxWidth: 560, lineHeight: 1.6, margin: "0 0 28px" }}>
          These are the blanks we actually print, at the prices we actually charge. Pick a
          direction, see the math, and ask for the real quote when it feels right.
        </p>

        {(status === "quote_requested" || justSent) && (
          <div style={{ border: `1.5px solid ${ink}`, borderRadius: 12, padding: "14px 18px", marginBottom: 26, background: "#fff" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: ink, marginBottom: 3 }}>
              {justSent ? "Got it. You will hear from a human within 1 business day." : "Quote requested. We are on it."}
            </div>
            <div style={{ fontSize: 12, color: muted }}>Keep browsing — your picks stay saved, and you can update your request any time.</div>
          </div>
        )}

        {/* Product chips */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 26 }}>
          <Chip on>Tees</Chip>
          <Chip dim>Hoodies · soon</Chip>
          <Chip dim>Headwear · soon</Chip>
        </div>

        {/* Lanes */}
        {LANES.map((lane) => {
          const laneStyles = tees.filter((s) => s.lane === lane.key);
          if (laneStyles.length === 0) return null;
          return (
            <section key={lane.key} style={{ marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: ink, margin: 0 }}>{lane.label}</h2>
                <span style={{ fontSize: 12, color: faint }}>{lane.blurb}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginTop: 12 }}>
                {laneStyles.map((s) => {
                  const on = picks.styleCode === s.code;
                  const r = s.bands[band];
                  const meta = STYLE_META[s.code];
                  return (
                    <button
                      key={s.code}
                      onClick={() => setPicks((p) => ({ ...p, styleCode: on ? null : s.code }))}
                      style={{
                        textAlign: "left", cursor: "pointer", background: "#fff",
                        border: on ? `2px solid ${ink}` : `1.5px solid ${line}`,
                        borderRadius: 14, padding: 16, fontFamily: "inherit",
                      }}
                    >
                      <div style={{ height: 84, borderRadius: 9, background: "linear-gradient(160deg,#efece5,#dedacf)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: faint, letterSpacing: "0.06em", marginBottom: 12, fontFamily: monoFont }}>
                        {s.code}
                      </div>
                      <div style={{ fontSize: 14.5, fontWeight: 800, color: ink }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: faint, fontFamily: monoFont, margin: "3px 0 7px" }}>{meta?.spec}</div>
                      <div style={{ fontSize: 12, color: muted, lineHeight: 1.45, marginBottom: 10 }}>{meta?.blurb}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: ink, fontFamily: monoFont }}>
                        {r?.lo != null ? <>{money(r.lo)}–{money(r.hi)}<span style={{ fontSize: 11, color: faint, fontWeight: 400 }}> / shirt at {band}+</span></> : <span style={{ fontSize: 12, color: faint }}>ask us</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Quantity + budget */}
        <section style={{ background: "#fff", border: `1.5px solid ${line}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: faint, marginBottom: 12 }}>HOW MANY?</div>
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
              style={{ width: 84, border: `1.5px solid ${line}`, borderRadius: 999, padding: "7px 14px", fontSize: 13, fontFamily: monoFont, color: ink, background: bg }}
            />
            <Chip on={picks.notSure} onClick={() => setPicks((p) => ({ ...p, notSure: !p.notSure }))}>Not sure yet</Chip>
          </div>
          {underMin && (
            <div style={{ fontSize: 12, color: "#a3623a", marginTop: 10 }}>
              Our minimum is 48 per design — pricing below starts there.
            </div>
          )}
          {picks.notSure && (
            <div style={{ fontSize: 12, color: muted, marginTop: 10 }}>
              No problem. We priced things at 100 pieces so you have a feel — most first drops land between 100 and 250.
            </div>
          )}

          <div style={{ borderTop: `1px solid ${line}`, margin: "16px 0", paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: faint, marginBottom: 10 }}>OR START FROM YOUR BUDGET</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[2500, 5000, 10000].map((b) => (
                <Chip key={b} on={picks.budget === b} onClick={() => setPicks((p) => ({ ...p, budget: p.budget === b ? null : b }))}>${b.toLocaleString()}</Chip>
              ))}
            </div>
            {budgetEstimate && (
              <div style={{ fontSize: 13, color: muted, marginTop: 10 }}>
                ${picks.budget!.toLocaleString()} runs roughly <b style={{ color: ink }}>{Math.floor(budgetEstimate.units / 10) * 10} pieces</b> of the {budgetEstimate.style.name}, one design.
              </div>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${line}`, paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: faint, marginBottom: 10 }}>COLORWAYS</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {[1, 2, 3].map((c) => (
                <Chip key={c} on={picks.colorways === c} onClick={() => setPicks((p) => ({ ...p, colorways: c }))}>{c === 3 ? "3+" : c}</Chip>
              ))}
              {picks.colorways > 1 && (
                <span style={{ fontSize: 12, color: "#a3623a" }}>
                  Heads up: each colorway runs its own 48-piece minimum — {picks.colorways === 3 ? "3+" : picks.colorways} colorways means {picks.colorways * 48}+ pieces total.
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Art */}
        <section style={{ background: "#fff", border: `1.5px solid ${line}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: faint, marginBottom: 12 }}>YOUR ART</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip on={picks.artStatus === "ready"} onClick={() => setPicks((p) => ({ ...p, artStatus: p.artStatus === "ready" ? null : "ready" }))}>Art is ready</Chip>
            <Chip on={picks.artStatus === "need_help"} onClick={() => setPicks((p) => ({ ...p, artStatus: p.artStatus === "need_help" ? null : "need_help" }))}>I need design help</Chip>
          </div>
          {picks.artStatus === "need_help" && (
            <div style={{ fontSize: 12, color: muted, marginTop: 10 }}>
              We have in-house designers who take a logo and a vibe to a finished drop. It is a service we quote alongside the print run.
            </div>
          )}
          <textarea
            placeholder="Anything else? The vibe, a reference brand, a deadline..."
            value={picks.notes}
            onChange={(e) => setPicks((p) => ({ ...p, notes: e.target.value.slice(0, 1200) }))}
            style={{ width: "100%", boxSizing: "border-box", marginTop: 14, border: `1.5px solid ${line}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, minHeight: 64, fontFamily: "inherit", color: ink, background: bg, resize: "vertical" }}
          />
        </section>

        <p style={{ fontSize: 12, color: faint, lineHeight: 1.6, maxWidth: 620 }}>
          Prices include a 1–2 location print and are shown as ranges on purpose — the real
          quote is exact, comes from a human, and lands within 1 business day of asking.
          Specialty inks, extra locations, and rush timelines move the number.
        </p>
      </div>

      {/* Sticky quote bar */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "#fff", borderTop: `1.5px solid ${line}`, padding: "12px 20px", zIndex: 40 }}>
        <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: muted, minWidth: 200 }}>
            {selected && range?.lo != null ? (
              <>
                <b style={{ color: ink }}>{selected.name}</b>
                {" · "}{picks.notSure ? "~100" : Math.max(qty, 48)} pieces · <span style={{ fontFamily: monoFont }}>{money(range.lo)}–{money(range.hi)}</span>/shirt
                {" · approx "}
                <span style={{ fontFamily: monoFont, color: ink }}>
                  ${Math.round(range.lo * Math.max(qty, 48)).toLocaleString()}–${Math.round(range.hi! * Math.max(qty, 48)).toLocaleString()}
                </span>
              </>
            ) : (
              <span style={{ color: faint }}>Pick a style to see your math</span>
            )}
          </div>
          <button
            onClick={() => setQuoteOpen(true)}
            style={{ background: ink, color: "#fff", border: "none", borderRadius: 999, padding: "12px 26px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            {status === "quote_requested" ? "Update my request" : "Request my real quote"}
          </button>
        </div>
      </div>

      {/* Quote modal */}
      {quoteOpen && (
        <div onClick={() => setQuoteOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 440 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 19, fontWeight: 800, color: ink }}>Get the real number</h3>
            <p style={{ margin: "0 0 18px", fontSize: 13, color: muted, lineHeight: 1.5 }}>
              Your picks come with it. A human replies within 1 business day.
            </p>
            <Field label="Name" value={qName} onChange={setQName} autoFocus />
            <Field label="Phone (optional)" value={qPhone} onChange={setQPhone} />
            <Field label="Needed by (optional)" value={qNeeded} onChange={setQNeeded} placeholder="e.g. mid October" />
            <Field label="Anything else (optional)" value={qNotes} onChange={setQNotes} textarea />
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={submitQuote} disabled={!qName.trim() || sending} style={{ flex: 1, background: ink, color: "#fff", border: "none", borderRadius: 999, padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: !qName.trim() || sending ? 0.5 : 1 }}>
                {sending ? "Sending..." : "Send it"}
              </button>
              <button onClick={() => setQuoteOpen(false)} style={{ background: "transparent", color: muted, border: `1.5px solid ${line}`, borderRadius: 999, padding: "12px 20px", fontSize: 14, cursor: "pointer" }}>
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
        border: on ? `1.5px solid ${ink}` : `1.5px solid ${line}`,
        background: on ? ink : "#fff",
        color: dim ? faint : on ? "#fff" : muted,
        borderRadius: 999,
        padding: "7px 16px",
        fontSize: 13,
        fontWeight: 600,
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
    width: "100%", boxSizing: "border-box", border: `1.5px solid ${line}`, borderRadius: 10,
    padding: "10px 12px", fontSize: 14, fontFamily: "inherit", color: ink, background: bg,
  };
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: faint, marginBottom: 5, textTransform: "uppercase" }}>{label}</span>
      {textarea
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...common, minHeight: 60, resize: "vertical" }} />
        : <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} style={common} />}
    </label>
  );
}
