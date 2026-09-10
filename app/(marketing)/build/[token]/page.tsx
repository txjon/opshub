"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { distributeCurve, gridKey, SIZE_ORDER, type Quote, type PunchPoint, type QuoteLine } from "@/lib/menu-quote";

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

type QuoteItem = { styleCode: string; qty: number; colors: string[]; notes?: string };
type FileRef = { filename: string; path: string; size: number; uploading?: boolean; url?: string; styleCode?: string | null; placement?: string | null };
type Picks = {
  items: QuoteItem[];
  budget: number | null;
  artStatus: "ready" | "need_help" | null;
  notes: string;
  files: FileRef[];
};

const DEFAULT_PICKS: Picks = { items: [], budget: null, artStatus: null, notes: "", files: [] };

const GROUPS: { key: string; label: string }[] = [
  { key: "tee", label: "Tees" },
  { key: "hoodie", label: "Hoodies" },
  { key: "hat", label: "Hats" },
  { key: "accessory", label: "Accessories" },
];

const GARMENT_LANES: { key: string; label: string; blurb: string }[] = [
  { key: "la_apparel", label: "LA Apparel", blurb: "Made in Los Angeles. The premium washed look our drops are known for." },
  { key: "as_colour", label: "AS Colour", blurb: "Boxy, heavy, consistent. The modern brand standard." },
  { key: "popular", label: "Popular Picks", blurb: "Our most printed blanks. Dependable and priced right." },
];
const LANES_BY_GROUP: Record<string, { key: string; label: string; blurb: string }[]> = {
  tee: GARMENT_LANES,
  hoodie: GARMENT_LANES,
  hat: [{ key: "headwear", label: "Headwear", blurb: "Embroidered staples. The caps we run every week." }],
  accessory: [
    { key: "patches", label: "Patches", blurb: "Sew-on or heat-seal, up to about 3.5 inches. From 50." },
    { key: "flags", label: "Flags", blurb: "Full-color 3x5. The wall piece. From 50." },
    { key: "stickers", label: "Stickers", blurb: "Die-cut vinyl. The handout that travels. From 25." },
  ],
};
// Minimums and tiers derive from each style's own rate rows — the
// Accessories tab mixes minimums (patches/flags 50, stickers 25), so
// per-group band config would lie. Apparel additionally opens a 25–49
// DTF small-batch zone BELOW its screen-print minimum of 50.
// The most-ordered style per group (order-line counts from our sales
// history, derived Sep 10; re-derive when the lineup changes): worn as a
// MOST ORDERED badge, data speaking as social proof.
const MOST_ORDERED = new Set(["NL6210", "IND4000", "YP6245CM", "PATCH-PVC"]);

const styleBands = (s: StyleRow): number[] =>
  Object.keys(s.bands).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
const styleMin = (s: StyleRow): number => styleBands(s)[0] ?? 50;

const STYLE_META: Record<string, { displayName: string; spec: string; blurb: string }> = {
  "1801GD": { displayName: "The LA Heavyweight", spec: "6.5 oz · garment dyed", blurb: "The heavyweight with the lived-in fade." },
  "1801MW": { displayName: "Mineral Wash Tee", spec: "6.5 oz · mineral wash", blurb: "Every piece washes a little different." },
  "5001":   { displayName: "The Staple Tee", spec: "midweight · clean fit", blurb: "The modern staple. Huge color range." },
  "5026":   { displayName: "Classic Heavy Tee", spec: "heavyweight · boxy", blurb: "Heavy, structured, streetwear cut." },
  "5082":   { displayName: "Heavy Faded Tee", spec: "extra heavy · oversized", blurb: "The heaviest tee on the menu." },
  "NL6210": { displayName: "CVC Everyday Tee", spec: "CVC blend · soft", blurb: "Soft, durable, and the best value here." },
  "NL3600": { displayName: "Lightweight Cotton Tee", spec: "lightweight cotton", blurb: "Clean lightweight staple." },
  "CC1717": { displayName: "Garment-Dyed Tee", spec: "6.1 oz · garment dyed", blurb: "The vintage-fade classic everyone knows." },
  "HF-09":  { displayName: "Heavy Fleece Hoodie", spec: "14 oz heavy fleece", blurb: "Serious hoodie weight, garment dyed." },
  "5101":   { displayName: "Supply Hood", spec: "midweight fleece", blurb: "The clean everyday hood." },
  "5161":   { displayName: "Heavy Hood", spec: "heavy fleece · boxy", blurb: "The AS hood we run the most." },
  "5166":   { displayName: "Oversized Faded Hood", spec: "oversized heavy fleece", blurb: "Drop-shoulder, streetwear cut." },
  "IND4000": { displayName: "The Workhorse Hoodie", spec: "10 oz fleece", blurb: "Our most printed hoodie." },
  "CHAMPS700": { displayName: "Champion Eco Hoodie", spec: "9 oz eco fleece", blurb: "The classic C-logo staple." },
  "CC1567":  { displayName: "Garment-Dyed Hoodie", spec: "garment dyed fleece", blurb: "The vintage-fade hood, built like the 1717." },
  "YP6245CM":   { displayName: "Classic Dad Hat", spec: "unstructured · embroidered", blurb: "The everyday shape everyone wears." },
  "474700":     { displayName: "'47 Clean Up Cap", spec: "'47 brand · retail grade", blurb: "The licensed-look upgrade." },
  "RICHARDSON": { displayName: "Trucker Cap", spec: "mesh back · embroidered", blurb: "The mesh-back workhorse." },
  "PATCH-EMB":  { displayName: "Embroidered Patch", spec: "embroidered · to 3.5 in", blurb: "The classic stitched look." },
  "PATCH-PVC":  { displayName: "PVC Patch", spec: "pvc rubber · to 3.5 in", blurb: "Molded, tactical, durable." },
  "PATCH-WVN":  { displayName: "Woven Patch", spec: "woven · fine detail", blurb: "Holds small text and tight lines." },
  "FLAG-3X5":   { displayName: "3x5 Flag", spec: "3 x 5 ft · full color", blurb: "The wall piece for the true fans." },
  "STICKER-DC": { displayName: "Die-Cut Stickers", spec: "die-cut vinyl · to 4 in", blurb: "The handout that ends up everywhere." },
};

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : `$${n.toFixed(2)}`;

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

// The card's "From $X" = the best per-piece price on the style's ladder
// (highest volume tier). Honest, and it leads with the number that makes
// volume feel like the customer's lever instead of a wall.
function fromPrice(style: StyleRow): number | null {
  let best: number | null = null;
  for (const r of Object.values(style.bands)) {
    if (r?.lo != null && (best === null || r.lo < best)) best = r.lo;
  }
  return best;
}

// Smooth price: piecewise-linear interpolation between band anchors.
// Margin-based pricing scales continuously — stair-stepped tiers were an
// artifact of the table, not the math. Below the group minimum (the DTF
// small-batch zone for garments) there is deliberately no price.
function itemRange(style: StyleRow, qty: number): { lo: number; hi: number } | null {
  const anchors = styleBands(style)
    .map((b) => ({ q: b, r: style.bands[b] }))
    .filter((a) => a.r?.lo != null && a.r?.hi != null);
  if (!anchors.length) return null;
  if (qty < anchors[0].q) return null;
  let prev = anchors[0];
  for (const a of anchors) {
    if (qty <= a.q) {
      if (a.q === prev.q) return { lo: a.r!.lo!, hi: a.r!.hi! };
      const t = (qty - prev.q) / (a.q - prev.q);
      return { lo: prev.r!.lo! + (a.r!.lo! - prev.r!.lo!) * t, hi: prev.r!.hi! + (a.r!.hi! - prev.r!.hi!) * t };
    }
    prev = a;
  }
  return { lo: prev.r!.lo!, hi: prev.r!.hi! };
}

// Log-scaled slider mapping — real control resolution where orders actually
// live (25–250) instead of half the track being 500–1000.
const SLIDER_STEPS = 300;
const posToQty = (pos: number, sMin: number, sMax: number) =>
  Math.round(sMin * Math.pow(sMax / sMin, pos / SLIDER_STEPS));
const qtyToPos = (q: number, sMin: number, sMax: number) =>
  Math.round((Math.log(Math.min(Math.max(q, sMin), sMax) / sMin) / Math.log(sMax / sMin)) * SLIDER_STEPS);

export default function MenuPage() {
  const { token } = useParams<{ token: string }>();
  const [invalid, setInvalid] = useState(false);
  const [styles, setStyles] = useState<StyleRow[] | null>(null);
  const [picks, setPicks] = useState<Picks>(DEFAULT_PICKS);
  const [status, setStatus] = useState<string>("browsed");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [view, setView] = useState<"menu" | "quote">("menu");
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
        if (d.quote) { setQuote(d.quote); setView("quote"); }
        if (d.email) setEmail(d.email);
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

  const PLACEMENTS = ["front", "back", "left chest", "right chest", "sleeve", "other"];

  async function uploadFiles(list: FileList | null, styleCode: string | null) {
    if (!list) return;
    for (const file of Array.from(list).slice(0, 6)) {
      if (file.size > 100 * 1024 * 1024) continue;
      const temp: FileRef = { filename: file.name, path: "", size: file.size, uploading: true, styleCode, placement: "front" };
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
          files: p.files.map((f) => (f.filename === file.name && f.uploading ? { ...f, path: init.path, uploading: false } : f)),
        }));
      } catch {
        setPicks((p) => ({ ...p, files: p.files.filter((f) => !(f.filename === file.name && f.uploading)) }));
      }
    }
  }
  function removeFileRef(f: FileRef) {
    setPicks((p) => ({ ...p, files: p.files.filter((x) => x.path !== f.path || x.filename !== f.filename) }));
    if (f.path) fetch("/api/onboard/upload", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: f.path }) }).catch(() => {});
  }
  function setFilePlacement(f: FileRef, placement: string) {
    setPicks((p) => ({ ...p, files: p.files.map((x) => (x.path === f.path ? { ...x, placement } : x)) }));
  }

  // Autosave (debounced) — the return link reopens right here.
  useEffect(() => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => savePicksNow(latestPicks.current), 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [picks, token]);

  const [group, setGroup] = useState<string>("tee");
  const visible = useMemo(() => (styles || []).filter((s) => s.group === group), [styles, group]);
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
    if (!picks.budget || visible.length === 0) return null;
    const st = byCode[picks.items[0]?.styleCode] || visible[0];
    let units = 100;
    for (let i = 0; i < 4; i++) {
      const r = itemRange(st, Math.max(units, styleMin(st)));
      if (!r) return null;
      const next = Math.floor(picks.budget / ((r.lo + r.hi) / 2));
      if (Math.abs(next - units) < 5) { units = next; break; }
      units = next;
    }
    return units >= styleMin(st) ? { units, style: st } : null;
  }, [picks.budget, picks.items, visible, byCode]);

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
    return <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: FAINT, fontSize: 14 }}>Opening The Build...</div>;
  }

  const openStyleRow = openStyle ? byCode[openStyle] : null;

  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT }}>
      {/* Hub-style header: quiet, functional, yours — not a marketing hero.
          The email chip whispers "you already have an account here." */}
      <section style={{ background: BG, padding: "128px 24px 0" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <div style={{ maxWidth: 620 }}>
              <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.01em", lineHeight: 1.2, margin: 0 }}>
                Nine times out of ten, it starts with one of these.
              </h1>
              <p style={{ color: MUTED, fontSize: 13.5, lineHeight: 1.6, margin: "8px 0 0" }}>
                These are the styles our clients build their brands on. Tap one to see colors
                and real pricing, then add it to your quote. No checkout, no commitment,
                just numbers.
              </p>
            </div>
            {email && (
              <span style={{ fontSize: 11, fontFamily: monoFont, color: FAINT, border: `1px solid ${LINE_SOFT}`, padding: "5px 10px", whiteSpace: "nowrap" }}>
                building as <span style={{ color: MUTED }}>{email}</span>
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 2, marginTop: 18, borderBottom: `1px solid ${LINE_SOFT}` }}>
            <button onClick={() => setView("menu")} style={{ background: "transparent", border: "none", borderBottom: view === "menu" ? `2px solid ${TEAL}` : "2px solid transparent", color: view === "menu" ? TEXT : FAINT, fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: "10px 14px", cursor: "pointer", fontFamily: "inherit" }}>
              The Goods
            </button>
            {quote && (
              <button onClick={() => setView("quote")} style={{ background: "transparent", border: "none", borderBottom: view === "quote" ? `2px solid ${TEAL}` : "2px solid transparent", color: view === "quote" ? TEXT : FAINT, fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: "10px 14px", cursor: "pointer", fontFamily: "inherit" }}>
                Your Quote
              </button>
            )}
          </div>
        </div>
      </section>

      {quote && view === "quote" ? (
        <QuoteView
          token={token}
          quote={quote}
          setQuote={setQuote}
          status={status}
          setStatus={setStatus}
          byCode={byCode}
        />
      ) : (
      <section style={{ padding: "24px 24px 170px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>

          {(status === "quote_requested" || status === "responded" || justSent) && !quote && (
            <div style={{ border: `1px solid ${TEAL}`, background: CARD, padding: "14px 18px", marginBottom: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>
                {justSent ? "Got it. You'll hear from us within 1 business day." : "Quote requested. We are on it."}
              </div>
              <div style={{ fontSize: 12, color: MUTED }}>Keep browsing. Your picks stay saved, and you can update your request any time.</div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 30 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {GROUPS.filter((g) => (styles || []).some((s) => s.group === g.key)).map((g) => (
                <Chip key={g.key} on={group === g.key} onClick={() => setGroup(g.key)}>{g.label}</Chip>
              ))}
            </div>
            <a
              href={`/start?brief=1${email ? `&email=${encodeURIComponent(email)}` : ""}`}
              style={{ fontSize: 12, color: MUTED, textDecoration: "none", border: `1px solid ${LINE_SOFT}`, padding: "8px 14px", whiteSpace: "nowrap" }}
            >
              I know what I want →
            </a>
          </div>

          {(LANES_BY_GROUP[group] || []).map((lane) => {
            const laneStyles = visible.filter((s) => s.lane === lane.key);
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
                        {inQuote ? (
                          <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2, background: TEAL, color: BG, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", padding: "4px 8px", textTransform: "uppercase" }}>
                            In quote · {inQuote.qty}
                          </div>
                        ) : MOST_ORDERED.has(s.code) ? (
                          <div style={{ position: "absolute", top: 10, left: 10, zIndex: 2, background: "rgba(10,10,12,0.85)", color: TEAL, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", padding: "4px 8px", textTransform: "uppercase", border: `1px solid rgba(115,182,201,0.4)` }}>
                            Most ordered
                          </div>
                        ) : null}
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
                          <div style={{ fontSize: 14.5, fontWeight: 700, textTransform: "uppercase", lineHeight: 1.25 }}>{meta?.displayName || s.name}</div>
                          <div style={{ fontSize: 10.5, color: FAINT, fontFamily: monoFont, marginBottom: 4 }}>{s.name}</div>
                          <div style={{ fontSize: 12, color: FAINT, lineHeight: 1.45, marginBottom: 10 }}>{meta?.blurb}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,0.82)", fontFamily: monoFont }}>
                              {inQuote && r
                                ? <>{money(r.lo)}–{money(r.hi)}<span style={{ fontSize: 11, color: FAINT, fontWeight: 400 }}>/pc</span></>
                                : fromPrice(s) !== null
                                  ? <><span style={{ fontSize: 11, color: FAINT, fontWeight: 400 }}>from </span>{money(fromPrice(s))}<span style={{ fontSize: 11, color: FAINT, fontWeight: 400 }}>/pc</span></>
                                  : <span style={{ fontSize: 12, color: FAINT }}>ask us</span>}
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
            Prices include a 1-2 location print and are shown as ranges on purpose. The real
            quote is exact and lands within 1 business day of asking.
            Minimums: apparel 50 per design screen-printed (25–49 runs as DTF), hats 25,
            patches and flags 50, stickers 25. Each colorway runs its own minimum. Specialty inks,
            extra locations, and rush timelines move the number.
          </p>
        </div>
      </section>

      )}

      {/* Sticky basket bar */}
      {view === "menu" && (
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
              <span style={{ color: FAINT }}>Tap a style to start your quote, or just tell us what you are thinking</span>
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

      )}

      {openStyleRow && (
        <StyleModal
          style={openStyleRow}
          existing={picks.items.find((i) => i.styleCode === openStyleRow.code) || null}
          files={picks.files.filter((f) => f.styleCode === openStyleRow.code)}
          placements={PLACEMENTS}
          onUpload={(list) => uploadFiles(list, openStyleRow.code)}
          onRemoveFile={removeFileRef}
          onPlacement={setFilePlacement}
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
          onUpload={(list) => uploadFiles(list, null)}
          onRemoveFile={removeFileRef}
          onClose={() => setReviewOpen(false)}
          savePicksNow={savePicksNow}
          onSent={() => { setReviewOpen(false); setStatus("quote_requested"); setJustSent(true); }}
        />
      )}
    </div>
  );
}

// ─── Style modal (the product view) ─────────────────────────────

function StyleModal({ style, existing, files, placements, onUpload, onRemoveFile, onPlacement, onClose, onSave, onRemove }: {
  style: StyleRow;
  existing: QuoteItem | null;
  files: FileRef[];
  placements: string[];
  onUpload: (list: FileList | null) => void;
  onRemoveFile: (f: FileRef) => void;
  onPlacement: (f: FileRef, placement: string) => void;
  onClose: () => void;
  onSave: (item: QuoteItem) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState<number>(existing?.qty ?? 100);
  const [colors, setColors] = useState<string[]>(existing?.colors ?? []);
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const meta = STYLE_META[style.code];
  const r = itemRange(style, qty);
  const groupMin = styleMin(style); // the style's real minimum (apparel screen-print = 50)
  const colorways = Math.max(colors.length, 1);
  const minPieces = colorways * groupMin;
  const underMin = qty >= groupMin && qty < minPieces;
  const isGarment = style.group === "tee" || style.group === "hoodie";
  const sliderMin = isGarment ? 25 : groupMin;   // garments open the 25+ DTF small-batch zone
  const sliderMax = 1000;
  const inDtfZone = isGarment && qty < groupMin;
  const tickMarks = styleBands(style).filter((b) => b >= sliderMin && b <= sliderMax);
  const groupLabel = GROUPS.find((g) => g.key === style.group)?.label || style.group;
  const laneLabel = (LANES_BY_GROUP[style.group] || []).find((l) => l.key === style.lane)?.label;

  // One tap = select the color AND show its garment photo. Tapping a
  // selected color deselects it (preview stays put so nothing flashes).
  function toggleColor(c: PaletteColor) {
    const selecting = !colors.includes(c.name);
    setColors((cs) => selecting ? [...cs, c.name] : cs.filter((x) => x !== c.name));
    if (selecting) { if (c.image) setPreviewImg(c.image); setPreviewName(c.name); }
  }

  const img = previewImg || style.hero;
  const uploadsPending = files.some((f) => f.uploading);

  return (
    // Slide-over drawer (the quick-shop pattern): full height, natural
    // scroll, sticky CTA at the bottom — a centered modal clips against
    // maxHeight and loses the CTA below the fold. z 300 clears the fixed
    // nav (z 100) and its mobile menu (z 200).
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300 }}>
      <style dangerouslySetInnerHTML={{ __html: `@keyframes hpdSlideIn { from { transform: translateX(48px); opacity: 0.4; } to { transform: none; opacity: 1; } }` }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(460px, 100vw)", background: CARD, borderLeft: `1px solid ${LINE}`,
          display: "flex", flexDirection: "column", animation: "hpdSlideIn 0.22s ease-out",
        }}
      >
        <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}>
          {/* Image well — close floats over it */}
          <div style={{ position: "relative", background: "#fff", height: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
            <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, borderRadius: 99, background: "rgba(10,10,12,0.85)", color: "#fff", border: "none", fontSize: 17, cursor: "pointer", lineHeight: 1 }}>×</button>
            {img
              ? <img src={img} alt={style.name} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              : <span style={{ fontSize: 11, color: "#999", fontFamily: monoFont, textTransform: "uppercase", letterSpacing: "0.1em" }}>{style.code} · photo coming</span>}
          </div>

          {/* Details */}
          <div style={{ padding: "20px 20px 24px", color: TEXT }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontFamily: monoFont, letterSpacing: "0.08em", color: FAINT, textTransform: "uppercase", marginBottom: 8 }}>
                  {groupLabel}{laneLabel ? ` / ${laneLabel}` : ""} / <span style={{ color: TEAL }}>{style.name}</span>
                </div>
                <h3 style={{ margin: 0, fontSize: 22, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.15, letterSpacing: "-0.01em" }}>{meta?.displayName || style.name}</h3>
                <div style={{ ...eyebrowStyle, color: FAINT, marginTop: 6 }}>{meta?.spec}</div>
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: "10px 0 16px" }}>{meta?.blurb}</p>

            {/* Palette — swatch dot grid, name of the active color above */}
            {style.allColors.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <span style={{ ...eyebrowStyle, color: FAINT }}>Colors</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {previewName || (colors.length ? colors[colors.length - 1] : "")}
                  </span>
                  {colors.length > 0 && <span style={{ fontSize: 11, color: FAINT }}>({colors.length} selected)</span>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, maxHeight: 132, overflowY: "auto", padding: 2 }}>
                  {style.allColors.map((c) => {
                    const sel = colors.includes(c.name);
                    return (
                      <button
                        key={c.name}
                        onClick={() => toggleColor(c)}
                        title={c.name}
                        aria-label={c.name}
                        style={{
                          width: 24, height: 24, borderRadius: 99, padding: 0, cursor: "pointer",
                          background: c.hex || "#2a2a30",
                          // Selection ring drawn INSIDE the dot (inset gap ring) —
                          // outer shadows clip against the scroll container edges.
                          border: sel ? `2px solid ${TEAL}` : `1px solid ${LINE}`,
                          boxShadow: sel ? `inset 0 0 0 2px ${CARD}` : "none",
                          flexShrink: 0,
                        }}
                      />
                    );
                  })}
                </div>
                {colors.length > 1 && (
                  <div style={{ fontSize: 11.5, color: AMBER, marginTop: 8 }}>
                    {colors.length} colorways = {colors.length} × {groupMin} piece minimums ({minPieces}+ total).
                  </div>
                )}
              </div>
            )}

            {/* How many — ONE control: drag (or type) and watch the price move.
                Tiers are tick marks, not buttons; the DTF small-batch zone is
                the marked stretch below the screen-print minimum. */}
            <div style={{ borderTop: `1px solid ${LINE_SOFT}`, paddingTop: 14, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ ...eyebrowStyle, color: FAINT }}>How many</span>
                <input
                  type="number"
                  min={1}
                  value={qty || ""}
                  onChange={(e) => setQty(e.target.value ? Number(e.target.value) : sliderMin)}
                  style={{ width: 82, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontFamily: monoFont, color: TEXT, background: BG, textAlign: "center" }}
                />
              </div>

              <input
                type="range"
                min={0}
                max={SLIDER_STEPS}
                value={qtyToPos(qty, sliderMin, sliderMax)}
                onChange={(e) => setQty(posToQty(Number(e.target.value), sliderMin, sliderMax))}
                aria-label="Quantity"
                style={{ width: "100%", accentColor: TEAL, cursor: "pointer" }}
              />
              <div style={{ position: "relative", height: 16, marginTop: 2 }}>
                {tickMarks.map((t) => (
                  <span key={t} style={{ position: "absolute", left: `${(qtyToPos(t, sliderMin, sliderMax) / SLIDER_STEPS) * 100}%`, transform: "translateX(-50%)", fontSize: 9.5, color: FAINT, fontFamily: monoFont }}>
                    {t}
                  </span>
                ))}
              </div>

              {inDtfZone ? (
                <div style={{ fontSize: 12.5, color: AMBER, lineHeight: 1.55, marginTop: 10 }}>
                  <b>{qty} pieces = small batch.</b> 25-49 pieces run as DTF prints instead
                  of screens, so there is no per-piece price here; we quote it per design. Send it
                  as is, or slide up to {groupMin}+ for screen-print pricing.
                </div>
              ) : r ? (
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 19, fontWeight: 700, fontFamily: monoFont }}>
                    {money(r.lo)}–{money(r.hi)}<span style={{ fontSize: 11.5, color: FAINT, fontWeight: 400 }}> /piece</span>
                  </span>
                  {fromPrice(style) !== null && r.lo > fromPrice(style)! + 0.011 && (
                    <span style={{ fontSize: 11, color: FAINT, fontFamily: monoFont }}>
                      slides to {money(fromPrice(style))} at volume
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: FAINT, marginTop: 10 }}>No listed price for this one yet. Ask and we'll quote it.</div>
              )}

              {underMin && !inDtfZone && (
                <div style={{ fontSize: 11.5, color: AMBER, marginTop: 8 }}>
                  {colors.length > 1
                    ? `${colors.length} colorways = ${colors.length} × ${groupMin} piece minimums (${minPieces}+ total).`
                    : `Minimum is ${groupMin} per design.`}
                </div>
              )}

              {/* What moves the number — Taylor's explanation, printed */}
              <div style={{ fontSize: 11.5, color: FAINT, lineHeight: 1.6, marginTop: 12 }}>
                What moves your price: <span style={{ color: MUTED }}>volume</span> (slide it and
                watch), <span style={{ color: MUTED }}>the blank</span> (a premium garment costs
                more before ink ever touches it), and <span style={{ color: MUTED }}>the print</span>{" "}
                (1-2 locations included; extra locations, specialty inks, and rush move it).
                The exact quote comes from our team, and it lives inside this range.
              </div>
            </div>

            {/* Artwork for THIS style */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ ...eyebrowStyle, color: FAINT, marginBottom: 8 }}>Artwork</div>
              <input ref={fileInput} type="file" multiple accept="image/*,.pdf,.ai,.psd,.eps,.svg,.zip" hidden onChange={(e) => { onUpload(e.target.files); e.target.value = ""; }} />
              {files.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  {files.map((f, i) => (
                    <div key={`${f.path || f.filename}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${LINE_SOFT}`, padding: "7px 10px" }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontFamily: monoFont, color: MUTED }}>{f.filename}</span>
                      {f.uploading ? (
                        <span style={{ fontSize: 11, color: TEAL, fontFamily: monoFont }}>uploading...</span>
                      ) : (
                        <>
                          <select
                            value={f.placement || "front"}
                            onChange={(e) => onPlacement(f, e.target.value)}
                            style={{ background: BG, color: MUTED, border: `1px solid ${LINE}`, fontSize: 11, padding: "3px 6px", fontFamily: "inherit" }}
                          >
                            {placements.map((pl) => <option key={pl} value={pl}>{pl}</option>)}
                          </select>
                          <button onClick={() => onRemoveFile(f)} aria-label="Remove file" style={{ background: "transparent", border: "none", color: FAINT, fontSize: 14, cursor: "pointer" }}>×</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => fileInput.current?.click()} style={{ background: "transparent", border: `1px dashed ${LINE}`, color: MUTED, fontSize: 12, padding: "9px 14px", cursor: "pointer", width: "100%", fontFamily: "inherit" }}>
                + Add artwork (optional, we take it from here)
              </button>
            </div>

            {/* Design notes */}
            <textarea
              placeholder="Design notes for this piece (placement details, color of ink, the vibe...)"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 800))}
              style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${LINE}`, padding: "9px 11px", fontSize: 12.5, minHeight: 52, fontFamily: "inherit", color: TEXT, background: BG, resize: "vertical", marginBottom: 12 }}
            />

            {/* Trust banner — true, because the proof flow exists */}
            <div style={{ borderLeft: `2px solid ${TEAL}`, background: "rgba(115,182,201,0.07)", padding: "10px 12px", fontSize: 12, color: MUTED, lineHeight: 1.5, marginBottom: 16 }}>
              Worried about your artwork? Don&apos;t be. Our team reviews every design and you
              approve the final proof before anything prints.
            </div>

          </div>
        </div>

        {/* Sticky CTA — never below the fold */}
        <div style={{ borderTop: `1px solid ${LINE}`, background: CARD, padding: "12px 16px" }}>
          {r ? (
            <div style={{ fontSize: 11.5, fontFamily: monoFont, color: FAINT, marginBottom: 8 }}>
              {qty} pieces · <span style={{ color: TEAL }}>≈ ${Math.round(r.lo * qty).toLocaleString()}–${Math.round(r.hi * qty).toLocaleString()}</span>
            </div>
          ) : inDtfZone ? (
            <div style={{ fontSize: 11.5, fontFamily: monoFont, color: AMBER, marginBottom: 8 }}>
              {qty} pieces · small batch DTF · quoted per design
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onSave({ styleCode: style.code, qty: Math.max(qty, 1), colors, notes: notes.trim() || undefined })}
              disabled={uploadsPending}
              style={{ flex: 1, background: TEXT, color: BG, border: "none", padding: "14px 0", fontSize: 13, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em", opacity: uploadsPending ? 0.6 : 1 }}
            >
              {uploadsPending ? "Waiting on upload..." : existing ? "Update quote" : "Add to quote"}
            </button>
            {existing && (
              <button onClick={onRemove} style={{ background: "transparent", color: FAINT, border: `1px solid ${LINE}`, padding: "14px 16px", fontSize: 12.5, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Review modal (basket → request) ────────────────────────────

function ReviewModal({ token, picks, setPicks, byCode, onEditItem, onRemoveItem, onUpload, onRemoveFile, onClose, savePicksNow, onSent }: {
  token: string;
  picks: Picks;
  setPicks: React.Dispatch<React.SetStateAction<Picks>>;
  byCode: Record<string, StyleRow>;
  onEditItem: (code: string) => void;
  onRemoveItem: (code: string) => void;
  onUpload: (list: FileList | null) => void;
  onRemoveFile: (f: FileRef) => void;
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(460px, 100vw)", background: CARD, borderLeft: `1px solid ${LINE}`,
          padding: 24, overflowY: "auto", overscrollBehavior: "contain", color: TEXT,
          animation: "hpdSlideIn 0.22s ease-out",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: `@keyframes hpdSlideIn { from { transform: translateX(48px); opacity: 0.4; } to { transform: none; opacity: 1; } }` }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>The real number</div>
            <h3 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 900, textTransform: "uppercase" }}>Your quote request</h3>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: FAINT, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
          Exact pricing from our team within 1 business day.
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
                    {it.notes && <div style={{ fontSize: 11, color: FAINT, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>&ldquo;{it.notes}&rdquo;</div>}
                  </div>
                  <button onClick={() => onRemoveItem(it.styleCode)} aria-label="Remove" style={{ background: "transparent", border: "none", color: FAINT, fontSize: 16, cursor: "pointer" }}>×</button>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ border: `1px dashed ${LINE}`, padding: "12px 14px", fontSize: 12.5, color: MUTED, marginBottom: 18 }}>
            No styles picked yet. That is fine. Tell us what you are thinking below and we will point you right.
          </div>
        )}

        {/* Art */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...eyebrowStyle, color: FAINT, marginBottom: 8 }}>Your art</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <Chip small on={picks.artStatus === "ready"} onClick={() => setPicks((p) => ({ ...p, artStatus: p.artStatus === "ready" ? null : "ready" }))}>Art is ready</Chip>
            <Chip small on={picks.artStatus === "need_help"} onClick={() => setPicks((p) => ({ ...p, artStatus: p.artStatus === "need_help" ? null : "need_help" }))}>I need design help</Chip>
          </div>
          <input ref={fileInput} type="file" multiple accept="image/*,.pdf,.ai,.psd,.eps,.svg,.zip" hidden onChange={(e) => { onUpload(e.target.files); e.target.value = ""; }} />
          <button onClick={() => fileInput.current?.click()} style={{ background: "transparent", border: `1px dashed ${LINE}`, color: MUTED, fontSize: 12, padding: "9px 14px", cursor: "pointer", width: "100%", fontFamily: "inherit" }}>
            + Attach art files if you have them (optional)
          </button>
          {picks.files.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
              {picks.files.map((f, i) => (
                <div key={`${f.path || f.filename}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: MUTED, fontFamily: monoFont }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.filename}
                    <span style={{ color: FAINT }}>{f.styleCode ? ` · ${f.styleCode}` : ""}{f.placement ? ` · ${f.placement}` : ""}</span>
                  </span>
                  {f.uploading
                    ? <span style={{ color: TEAL }}>uploading...</span>
                    : <button onClick={() => onRemoveFile(f)} style={{ background: "transparent", border: "none", color: FAINT, cursor: "pointer", fontSize: 13 }}>×</button>}
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

// ─── The client's quote view ────────────────────────────────────
// Exact prices (ranges die when Taylor quotes), a punch list the client
// COMPLETES on the page instead of answering by email, and one Accept
// button. Reads like checkout because psychologically it is.

function QuoteView({ token, quote, setQuote, status, setStatus, byCode }: {
  token: string;
  quote: Quote;
  setQuote: (q: Quote) => void;
  status: string;
  setStatus: (s: string) => void;
  byCode: Record<string, StyleRow>;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const accepted = status === "accepted" || !!quote.acceptedAt;
  const doneCount = quote.punch.filter((p) => p.status === "done").length;
  const requiredOpen = quote.punch.filter((p) => p.required && p.status !== "done");

  async function savePunch(key: string, body: Record<string, unknown>) {
    setBusyKey(key);
    const res = await fetch(`/api/menu/lead/${token}/punch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, ...body }),
    }).catch(() => null);
    setBusyKey(null);
    if (res?.ok) {
      const d = await res.json();
      if (d?.quote) setQuote(d.quote);
    }
  }

  async function accept() {
    if (accepting) return;
    setAccepting(true);
    const res = await fetch(`/api/menu/lead/${token}/accept`, { method: "POST" }).catch(() => null);
    setAccepting(false);
    if (res?.ok) {
      setStatus("accepted");
      setQuote({ ...quote, acceptedAt: new Date().toISOString() });
    }
  }

  return (
    <section style={{ padding: "8px 24px 120px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {accepted && (
          <div style={{ border: `1px solid ${TEAL}`, background: "rgba(115,182,201,0.08)", padding: "14px 18px", marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>You&apos;re in. We&apos;re rolling.</div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
              {requiredOpen.length
                ? `Finish the ${requiredOpen.length} open point${requiredOpen.length > 1 ? "s" : ""} below whenever you can. We start on our side now.`
                : "Everything we need is here."} You approve the final proof before anything prints.
            </div>
          </div>
        )}

        {/* Lines */}
        <div style={{ border: `1px solid ${LINE_SOFT}`, marginBottom: 8 }}>
          {quote.lines.map((l, i) => {
            const st = l.styleCode ? byCode[l.styleCode] : null;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i < quote.lines.length - 1 ? `1px solid ${LINE_SOFT}` : "none" }}>
                {st?.hero && (
                  <span style={{ width: 44, height: 44, background: "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 3 }}>
                    <img src={st.hero} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase" }}>{l.label}</div>
                  <div style={{ fontSize: 11, color: FAINT, fontFamily: monoFont }}>
                    {l.qty} pcs{l.colors.length ? ` · ${l.colors.join(", ")}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontFamily: monoFont }}>
                  {l.unitPrice != null ? (
                    <>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>${(l.unitPrice * l.qty).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      <div style={{ fontSize: 10.5, color: FAINT }}>${l.unitPrice.toFixed(2)}/pc</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: AMBER }}>quoted on art</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: FAINT }}>Good through {quote.validUntil}</span>
          <span style={{ fontSize: 20, fontWeight: 800, fontFamily: monoFont }}>${Number(quote.total || 0).toLocaleString()}</span>
        </div>
        <p style={{ fontSize: 11, color: FAINT, margin: "0 0 26px" }}>
          Exact pricing based on your picks. Nothing prints without your approval on the final proof.
        </p>

        {/* Punch list */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
          <span style={eyebrowStyle}>Before we can print</span>
          <span style={{ fontSize: 11, color: FAINT, fontFamily: monoFont }}>{doneCount}/{quote.punch.length} done</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
          {quote.punch.map((pt) => (
            <PunchItem
              key={pt.key}
              token={token}
              point={pt}
              lines={quote.lines}
              byCode={byCode}
              busy={busyKey === pt.key}
              onSave={(body) => savePunch(pt.key, body)}
            />
          ))}
        </div>

        {!accepted && (
          <button
            onClick={accept}
            disabled={accepting}
            style={{ width: "100%", background: TEXT, color: BG, border: "none", padding: "16px 0", fontSize: 14, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em", opacity: accepting ? 0.6 : 1 }}
          >
            {accepting ? "One second..." : "Accept quote"}
          </button>
        )}
        {!accepted && requiredOpen.length > 0 && (
          <p style={{ fontSize: 11, color: FAINT, textAlign: "center", marginTop: 8 }}>
            You can accept now and finish the checklist after. We start on our side either way.
          </p>
        )}
      </div>
    </section>
  );
}

function PunchItem({ token, point, lines, byCode, busy, onSave }: {
  token: string;
  point: PunchPoint;
  lines: QuoteLine[];
  byCode: Record<string, StyleRow>;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const done = point.status === "done";
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useState<string>(((point.payload as any)?.value as string) || "");
  const payload = point.payload as any;

  // Size grids only make sense for garment lines (an item per colorway is
  // how HPD jobs model reality — these grids become the buy sheet).
  const garmentLines = lines
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => l.styleCode && ["tee", "hoodie"].includes(byCode[l.styleCode!]?.group || ""));
  const [grids, setGrids] = useState<Record<string, Record<string, number>>>(payload?.grids || {});

  async function uploadPunchFile(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    for (const file of Array.from(list).slice(0, 6)) {
      try {
        const init = await fetch("/api/onboard/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, session: `menu-${token.slice(0, 16)}` }),
        }).then((r) => r.json());
        if (!init?.uploadUrl) continue;
        const put = await fetch(init.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
        if (put.ok) onSave({ add: { filename: file.name, path: init.path, size: file.size } });
      } catch { /* skip file */ }
    }
    setUploading(false);
  }

  return (
    <div style={{ border: `1px solid ${done ? "rgba(115,182,201,0.4)" : LINE_SOFT}`, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 14, color: done ? TEAL : FAINT }}>{done ? "✓" : "○"}</span>
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em" }}>{point.label}</span>
        {!point.required && <span style={{ fontSize: 10, color: FAINT, fontFamily: monoFont }}>optional</span>}
      </div>
      {point.desc && <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.5, margin: "6px 0 0 22px" }}>{point.desc}</p>}

      <div style={{ margin: "10px 0 0 22px" }}>
        {point.kind === "files" && (
          <>
            {(payload?.files || []).map((f: any) => (
              <div key={f.path} style={{ fontSize: 11.5, fontFamily: monoFont, color: MUTED, marginBottom: 4 }}>📎 {f.filename}</div>
            ))}
            <input ref={fileInput} type="file" multiple accept="image/*,.pdf,.ai,.psd,.eps,.svg,.zip" hidden onChange={(e) => { uploadPunchFile(e.target.files); e.target.value = ""; }} />
            <button onClick={() => fileInput.current?.click()} disabled={uploading} style={{ background: "transparent", border: `1px dashed ${LINE}`, color: MUTED, fontSize: 12, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>
              {uploading ? "Uploading..." : "+ Upload files"}
            </button>
          </>
        )}

        {point.kind === "sizes" && (
          <>
            {garmentLines.length === 0 ? (
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 1200))} placeholder="Tell us the breakdown..." style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${LINE}`, padding: "8px 10px", fontSize: 12.5, minHeight: 48, fontFamily: "inherit", color: TEXT, background: BG }} />
            ) : garmentLines.map(({ l, idx }) => {
              const cws = l.colors.length ? l.colors : [null];
              return cws.map((cw) => {
                const k = gridKey(idx, cw);
                const g = grids[k] || {};
                const sum = SIZE_ORDER.reduce((s, sz) => s + (g[sz] || 0), 0);
                const target = Math.round(l.qty / cws.length);
                return (
                  <div key={k} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700 }}>{l.label}{cw ? ` · ${cw}` : ""}</span>
                      <span style={{ fontSize: 10.5, color: sum === target ? TEAL : FAINT, fontFamily: monoFont }}>{sum}/{target}</span>
                      <button
                        onClick={() => setGrids((gs) => ({ ...gs, [k]: distributeCurve(target) }))}
                        style={{ background: "transparent", border: "none", color: TEAL, fontSize: 10.5, cursor: "pointer", fontFamily: monoFont, textDecoration: "underline", padding: 0 }}
                      >
                        use our standard curve
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {SIZE_ORDER.map((sz) => (
                        <label key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                          <span style={{ fontSize: 9.5, color: FAINT, fontFamily: monoFont }}>{sz}</span>
                          <input
                            type="number" min={0}
                            value={g[sz] || ""}
                            onChange={(e) => setGrids((gs) => ({ ...gs, [k]: { ...gs[k], [sz]: Number(e.target.value) || 0 } }))}
                            style={{ width: 46, border: `1px solid ${LINE}`, padding: "5px 4px", fontSize: 12, fontFamily: monoFont, color: TEXT, background: BG, textAlign: "center" }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              });
            })}
            <button
              onClick={() => onSave({ payload: garmentLines.length === 0 ? { value: text } : { grids } })}
              disabled={busy}
              style={{ background: "transparent", border: `1px solid ${TEAL}`, color: TEAL, fontSize: 12, padding: "7px 16px", cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}
            >
              {busy ? "Saving..." : done ? "Update sizes" : "Save sizes"}
            </button>
          </>
        )}

        {point.kind === "date" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ""} onChange={(e) => setText(e.target.value)} style={{ border: `1px solid ${LINE}`, padding: "7px 10px", fontSize: 13, fontFamily: monoFont, color: TEXT, background: BG, colorScheme: "dark" }} />
            <button onClick={() => text && onSave({ payload: { value: text } })} disabled={busy || !text} style={{ background: "transparent", border: `1px solid ${TEAL}`, color: TEAL, fontSize: 12, padding: "7px 16px", cursor: "pointer", fontFamily: "inherit" }}>
              {busy ? "Saving..." : done ? "Update" : "Save"}
            </button>
          </div>
        )}

        {(point.kind === "address" || point.kind === "text") && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 1200))}
              placeholder={point.kind === "address" ? "Ship-to address, or 'hold at House Party for fulfillment'" : "Your answer..."}
              style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${LINE}`, padding: "8px 10px", fontSize: 12.5, minHeight: 48, fontFamily: "inherit", color: TEXT, background: BG, resize: "vertical" }}
            />
            <button onClick={() => text.trim() && onSave({ payload: { value: text.trim() } })} disabled={busy || !text.trim()} style={{ background: "transparent", border: `1px solid ${TEAL}`, color: TEAL, fontSize: 12, padding: "7px 16px", cursor: "pointer", fontFamily: "inherit", marginTop: 6 }}>
              {busy ? "Saving..." : done ? "Update" : "Save"}
            </button>
          </>
        )}

        {point.kind === "confirm" && !done && (
          <button onClick={() => onSave({ payload: { confirmed: true } })} disabled={busy} style={{ background: "transparent", border: `1px solid ${TEAL}`, color: TEAL, fontSize: 12, padding: "7px 16px", cursor: "pointer", fontFamily: "inherit" }}>
            {busy ? "Saving..." : "Confirmed"}
          </button>
        )}
      </div>
    </div>
  );
}
