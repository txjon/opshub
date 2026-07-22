"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "vaul";
import { T, font, mono, sortSizes } from "@/lib/theme";

// Mobile-only blank picker — search-first MVP. Replaces the desktop
// catalog tables (which crammed Brand/Style/Color/Size columns into
// 375px and were unusable on a phone).
//
// Two screens:
//   1. BROWSE  — sticky search at top, Favorites underneath. Typing
//                hits /api/ss?endpoint=search&q= (debounced 350ms)
//                and the results replace the favorites list.
//   2. CONFIG  — picked a style, choose a color (swatch grid) and
//                size quantities, then tap "Assign". Calls onAdd
//                with the same shape SSPicker/FavoritesPicker emit.
//
// MVP scope: S&S Activewear only, plus existing favorites (S&S
// supplier rows). AS Colour, LA Apparel, Cotton Collective fall back
// to the existing desktop pickers when needed.

// Normalize a size label so different catalogs map to the same slot.
// "X-Large" === "XL", "OS" === "OSFA", "Small" === "S", etc. Strips
// non-alphanumeric and uppercases, then runs a tiny alias table.
function normalizeSize(sz) {
  const k = (sz || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const alias = {
    XSMALL: "XS", SMALL: "S", MEDIUM: "M", LARGE: "L", XLARGE: "XL",
    XXL: "2XL", XXXL: "3XL", XXXXL: "4XL", XXXXXL: "5XL",
    "2X": "2XL", "3X": "3XL", "4X": "4XL", "5X": "5XL",
    OS: "OSFA", ONESIZE: "OSFA", ONESIZEFITSALL: "OSFA",
  };
  return alias[k] || k;
}

// Carry over existing qtys to a new size set by label match. Returns
// merged qtys for sizes the new blank supports + a "dropped" list of
// sizes the new blank doesn't carry so we can surface them to the user.
function carryOverQtys(existingQtys, newSizes) {
  if (!existingQtys) return { merged: {}, dropped: [] };
  const newByNorm = {};
  for (const sz of newSizes) newByNorm[normalizeSize(sz)] = sz;
  const merged = {};
  const dropped = [];
  for (const [oldSz, q] of Object.entries(existingQtys)) {
    const qty = Number(q) || 0;
    if (qty <= 0) continue;
    const match = newByNorm[normalizeSize(oldSz)];
    if (match) merged[match] = qty;
    else dropped.push({ size: oldSz, qty });
  }
  return { merged, dropped };
}

export function MobileBlankPicker({
  open, onClose, onAdd,
  favorites = [], toggleFav, isFav,
  assignMode = false, defaultItemName = "",
  existingQtys = null,
}) {
  // Lock body scroll while open (mirrors how the client portal's
  // MobileSheet treats fullscreen surfaces).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const [screen, setScreen] = useState("browse"); // browse | config
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [favDetails, setFavDetails] = useState([]); // hydrated favorites
  const [favLoading, setFavLoading] = useState(false);
  // Local catalogs for AS Colour + LA Apparel — those APIs don't
  // expose a "search" endpoint, so we pull the full product list
  // once when the picker opens and filter client-side on each
  // keystroke. S&S is hit live for each search.
  const [ascCatalog, setAscCatalog] = useState([]);
  const [laaCatalog, setLaaCatalog] = useState([]);

  // Config screen state
  const [picked, setPicked] = useState(null); // a style result from search/favorites
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selColor, setSelColor] = useState(null);
  const [qtys, setQtys] = useState({});
  const [itemName, setItemName] = useState(defaultItemName || "");
  // Sizes from the previously-assigned blank that the new color
  // doesn't carry. Surfaces as a small banner so the user can decide
  // before they hit Assign. Cleared when they dismiss or pick another
  // color.
  const [droppedSizes, setDroppedSizes] = useState([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Reset to browse when re-opened.
  useEffect(() => {
    if (open) {
      setScreen("browse"); setQuery(""); setResults([]); setPicked(null);
      setProducts([]); setSelColor(null); setQtys({}); setItemName(defaultItemName || "");
      setDroppedSizes([]); setBannerDismissed(false);
    }
  }, [open, defaultItemName]);

  // Preload AS Colour + LA Apparel catalogs once when the picker
  // opens. Both server endpoints return cached lists fast (DB-backed
  // catalog cache). Stored as plain arrays for client-side filtering
  // on each keystroke.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [asc, laa] = await Promise.all([
          fetch("/api/ascolour?endpoint=products").then(r => r.ok ? r.json() : []).catch(() => []),
          fetch("/api/laapparel?endpoint=products").then(r => r.ok ? r.json() : []).catch(() => []),
        ]);
        if (cancelled) return;
        setAscCatalog(Array.isArray(asc) ? asc : []);
        setLaaCatalog(Array.isArray(laa) ? laa : []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Live search across all sources — S&S via API (live), AS Colour +
  // LA Apparel by filtering the preloaded catalogs in memory. Results
  // are merged and tagged with their supplier so the rest of the
  // picker can route appropriately on tap.
  const searchTimer = useRef(null);
  useEffect(() => {
    if (!open) return;
    if (!query.trim() || query.length < 2) { setResults([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const q = query.trim().toLowerCase();

      // S&S — live API
      const ssPromise = fetch(`/api/ss?endpoint=search&q=${encodeURIComponent(query.trim())}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => (Array.isArray(data) ? data : []).map(s => ({ ...s, _supplier: "ss" })))
        .catch(() => []);

      // AS Colour — local filter
      const ascResults = (ascCatalog || [])
        .filter(p => {
          const code = (p.styleCode || "").toLowerCase();
          const name = (p.name || "").toLowerCase();
          return code.includes(q) || name.includes(q);
        })
        .slice(0, 40)
        .map(p => ({
          _supplier: "ascolour",
          styleID: `ascolour-${p.styleCode}`,
          styleName: p.styleCode,
          title: p.name || "",
          brandName: "AS Colour",
          baseCategory: p.category || "",
          styleImage: null,
        }));

      // LA Apparel — local filter
      const laaResults = (laaCatalog || [])
        .filter(p => {
          const code = (p.styleCode || "").toLowerCase();
          const name = (p.name || "").toLowerCase();
          return code.includes(q) || name.includes(q);
        })
        .slice(0, 40)
        .map(p => ({
          _supplier: "laapparel",
          styleID: `laapparel-${p.styleCode}`,
          styleName: p.styleCode,
          title: p.name || "",
          brandName: "LA Apparel",
          baseCategory: p.category || "",
          styleImage: null,
        }));

      const ssResults = await ssPromise;
      // Merge: AS Colour + LA Apparel come back instantly; S&S after
      // the API roundtrip. Stable order — supplier-grouped so the user
      // doesn't see them shuffle as S&S arrives.
      setResults([...ssResults, ...ascResults, ...laaResults]);
      setSearching(false);
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, open, ascCatalog, laaCatalog]);

  // Hydrate favorites across all suppliers. S&S favorites get their
  // full style record via the search endpoint so the row shows brand
  // + title + image. AS Colour / LA Apparel don't have a search
  // endpoint that returns metadata, so we synthesize a minimal
  // "style" object from the favorite row (style_code + style_name +
  // category). Tapping any of them routes through pickStyle which
  // branches on supplier to load the right color/size data.
  useEffect(() => {
    if (!open) return;
    const favs = favorites || [];
    if (favs.length === 0) { setFavDetails([]); return; }
    (async () => {
      setFavLoading(true);
      const hydrated = [];
      for (const fav of favs) {
        try {
          if (fav.supplier === "ss") {
            const res = await fetch(`/api/ss?endpoint=search&q=${encodeURIComponent(fav.style_code)}`);
            const data = await res.json();
            const match = (Array.isArray(data) ? data : []).find(s => s.styleName === fav.style_code) || (Array.isArray(data) ? data : [])[0];
            if (match) hydrated.push({ ...match, _supplier: "ss" });
          } else {
            // AS Colour, LA Apparel, etc. — show as a row using the
            // saved style_name + category; picker loads details on tap.
            hydrated.push({
              _supplier: fav.supplier,
              styleID: `${fav.supplier}-${fav.style_code}`,
              styleName: fav.style_code,
              title: fav.style_name || "",
              brandName: fav.supplier === "ascolour" ? "AS Colour" : fav.supplier === "laapparel" ? "LA Apparel" : (fav.category || fav.supplier),
              styleImage: null,
            });
          }
        } catch {}
      }
      setFavDetails(hydrated);
      setFavLoading(false);
    })();
  }, [favorites, open]);

  // Load a style's color/size data into a normalized "products" array
  // ({ colorName, sizeName, customerPrice, colorSwatchImage, color1 }).
  // S&S returns this shape natively; AS Colour + LA Apparel come back
  // as variants that we map into the same shape so the rest of the
  // picker doesn't need to know which catalog it's looking at.
  async function pickStyle(style) {
    setPicked(style); setProducts([]); setSelColor(null); setQtys({});
    if (!itemName) setItemName(style.title || style.styleName || "");
    setScreen("config");
    setLoadingProducts(true);
    const supplier = style._supplier || "ss";
    try {
      if (supplier === "ss") {
        const res = await fetch(`/api/ss?endpoint=products&styleId=${style.styleID}`);
        const data = await res.json();
        setProducts(Array.isArray(data) ? data : []);
      } else if (supplier === "ascolour") {
        const [varRes, invRes, priceRes] = await Promise.all([
          fetch(`/api/ascolour?endpoint=variants&styleCode=${style.styleName}`),
          fetch(`/api/ascolour?endpoint=inventory&q=${style.styleName}`),
          fetch(`/api/ascolour?endpoint=pricing`),
        ]);
        const variants = await varRes.json().catch(() => []);
        const inv = {}; (await invRes.json().catch(() => [])).forEach(it => { inv[it.sku] = (inv[it.sku] || 0) + (it.quantity || 0); });
        const prices = {}; (await priceRes.json().catch(() => [])).forEach(p => { prices[p.sku] = p.price; });
        setProducts((variants || []).map(v => ({
          colorName: v.colour, sizeName: v.sizeCode,
          customerPrice: prices[v.sku] || 0,
          colorSwatchImage: null, color1: null,
        })));
      } else if (supplier === "laapparel") {
        const res = await fetch(`/api/laapparel?endpoint=variants&styleCode=${style.styleName}`);
        const variants = await res.json().catch(() => []);
        setProducts((Array.isArray(variants) ? variants : []).map(v => ({
          colorName: v.colour, sizeName: v.sizeCode,
          customerPrice: v.price || 0,
          colorSwatchImage: null, color1: null,
        })));
      } else {
        setProducts([]);
      }
    } catch { setProducts([]); }
    setLoadingProducts(false);
  }

  // Group products by color for the swatch grid.
  // S&S returns colorSwatchImage as a relative path under cdn.ssactivewear.com
  // and color1 already includes a leading "#" — neither of which I had
  // right the first pass, so swatches rendered blank.
  const colorGroups = useMemo(() => {
    const acc = {};
    for (const p of products) {
      const c = p.colorName || "—";
      if (!acc[c]) {
        const swatchPath = p.colorSwatchImage || p.colorFrontImage || null;
        const swatchUrl = swatchPath ? `https://cdn.ssactivewear.com/${swatchPath.replace(/^\/+/, "")}` : null;
        acc[c] = {
          items: [], sizes: [], prices: {},
          swatch: swatchUrl,
          hex: p.color1 && /^#[0-9a-f]{3,8}$/i.test(p.color1) ? p.color1 : null,
        };
      }
      acc[c].items.push(p);
      if (!acc[c].sizes.includes(p.sizeName)) acc[c].sizes.push(p.sizeName);
      acc[c].prices[p.sizeName] = p.customerPrice || p.casePrice || 0;
    }
    return acc;
  }, [products]);

  const colorNames = Object.keys(colorGroups).sort();
  const currentColor = selColor ? colorGroups[selColor] : null;
  const totalQty = Object.values(qtys).reduce((a, n) => a + (Number(n) || 0), 0);
  const canAssign = !!(picked && selColor && totalQty > 0);

  function handleAssign() {
    if (!canAssign) return;
    const sizes = sortSizes(currentColor.sizes.filter(sz => (qtys[sz] || 0) > 0));
    const qtyMap = {}; for (const sz of sizes) qtyMap[sz] = Number(qtys[sz]) || 0;
    const blankCosts = {}; for (const sz of sizes) blankCosts[sz] = currentColor.prices[sz] || 0;

    const supplier = picked._supplier || "ss";
    // blank_vendor mirrors the desktop picker's "{brand} {style}" shape
    // (e.g. "Comfort Colors 1717"). Falling back to style/part number
    // alone if brand metadata is missing.
    const vendorLabel = [picked.brandName, picked.styleName || picked.partNumber || ""]
      .filter(Boolean).join(" ").trim();
    onAdd({
      name: itemName || picked.title || picked.styleName || "",
      blank_vendor: vendorLabel || picked.styleName || picked.partNumber || "",
      blank_sku: selColor,
      style: vendorLabel || picked.styleName || picked.partNumber || "",
      color: selColor,
      sizes,
      qtys: qtyMap,
      totalQty,
      blankCosts,
      garment_type: detectGarmentType(picked.baseCategory || "", (picked.title || "") + " " + (picked.styleName || "")),
      supplier,
      style_code: picked.styleName || picked.partNumber || "",
    });
    onClose();
  }

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1100,
      background: T.bg, color: T.text, fontFamily: font,
      display: "flex", flexDirection: "column",
    }}>
      {/* ── Sticky header — same height across both screens, iOS
          navigation-bar style with a back chevron when in config. */}
      <div style={{
        position: "sticky", top: 0, zIndex: 2,
        background: "rgba(244,244,246,0.92)", backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: `1px solid ${T.border}`,
        padding: "10px 12px",
        display: "flex", alignItems: "center", gap: 10,
        paddingTop: "calc(10px + env(safe-area-inset-top))",
      }}>
        {screen === "config" ? (
          <button onClick={() => setScreen("browse")}
            style={{ background: "transparent", border: "none", color: T.accent, fontSize: 16, fontWeight: 600, padding: "6px 4px", minHeight: 44, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontFamily: font }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span> Back
          </button>
        ) : (
          <button onClick={onClose}
            style={{ background: "transparent", border: "none", color: T.accent, fontSize: 16, fontWeight: 600, padding: "6px 4px", minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer", fontFamily: font }}>
            Cancel
          </button>
        )}
        <div style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 700, color: T.text }}>
          {screen === "browse" ? (assignMode ? "Assign Blank" : "Add Item") : (picked?.styleName || "Configure")}
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* ── Browse screen ── */}
      {screen === "browse" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px 100px" }}>
          {/* Search */}
          <div style={{ position: "sticky", top: 0, zIndex: 1, marginBottom: 12, paddingBottom: 4, background: T.bg }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search S&S — brand, style #, name"
              style={{
                width: "100%", padding: "11px 14px",
                background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
                fontSize: 15, fontFamily: font, color: T.text, outline: "none",
                boxSizing: "border-box", minHeight: 44,
              }}
            />
          </div>

          {/* Default state: favorites */}
          {!query.trim() && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", margin: "6px 4px 8px" }}>
                Favorites
              </div>
              {favLoading ? (
                <div style={{ fontSize: 12, color: T.muted, padding: 12 }}>Loading favorites…</div>
              ) : favDetails.length === 0 ? (
                <div style={{ fontSize: 12, color: T.muted, padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, lineHeight: 1.5 }}>
                  No favorites yet. Star a blank from a desktop session and it'll show up here for quick access on the go.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {favDetails.map(s => <ResultRow key={s.styleID} style={s} onPick={pickStyle} isFav={isFav} toggleFav={toggleFav} />)}
                </div>
              )}
            </div>
          )}

          {/* Search state: results */}
          {query.trim() && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", margin: "6px 4px 8px" }}>
                {searching ? "Searching…" : `${results.length} result${results.length !== 1 ? "s" : ""}`}
              </div>
              {!searching && results.length === 0 && query.length >= 2 && (
                <div style={{ fontSize: 12, color: T.muted, padding: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10 }}>
                  Nothing matches "{query}". Try a style number (1717) or brand keyword.
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {results.map(s => <ResultRow key={s.styleID} style={s} onPick={pickStyle} isFav={isFav} toggleFav={toggleFav} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Configure screen ── */}
      {screen === "config" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 110px" }}>
          {/* Style summary */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 3 }}>{picked?.brandName}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{picked?.styleName} <span style={{ fontWeight: 500, color: T.muted, fontSize: 14, marginLeft: 6 }}>{picked?.title}</span></div>
          </div>

          {/* Item name */}
          {!assignMode && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Item name</div>
              <input value={itemName} onChange={e => setItemName(e.target.value)}
                placeholder="Name this item"
                style={{
                  width: "100%", padding: "11px 14px",
                  background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
                  fontSize: 15, fontFamily: font, color: T.text, outline: "none",
                  boxSizing: "border-box", minHeight: 44,
                }} />
            </div>
          )}

          {/* Color picker */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Color</div>
            {loadingProducts && colorNames.length === 0 && (
              <div style={{ fontSize: 12, color: T.muted, padding: 8 }}>Loading colors…</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              {colorNames.map(c => {
                const isSel = selColor === c;
                const g = colorGroups[c];
                const fallbackBg = g.hex || T.surface;
                return (
                  <button key={c} onClick={() => {
                      setSelColor(c);
                      // Carry over qtys from the item's existing blank.
                      // Sizes the new blank doesn't have surface as
                      // dropped — banner shows them with a Dismiss.
                      const { merged, dropped } = carryOverQtys(existingQtys, colorGroups[c].sizes);
                      setQtys(merged);
                      setDroppedSizes(dropped);
                      setBannerDismissed(false);
                    }}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      padding: 8, borderRadius: 10,
                      background: isSel ? T.accentDim : T.card,
                      border: `2px solid ${isSel ? T.accent : T.border}`,
                      cursor: "pointer", fontFamily: font, color: T.text,
                      minHeight: 80,
                    }}>
                    {/* Image swatch (S&S CDN) with hex fallback. Hex is
                        also painted underneath so a slow-loading image
                        shows the right color immediately. */}
                    <div style={{
                      width: 44, height: 44, borderRadius: 8,
                      background: fallbackBg,
                      border: `1px solid ${T.border}`,
                      overflow: "hidden", position: "relative",
                    }}>
                      {g.swatch && (
                        <img src={g.swatch} alt="" loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={e => { e.currentTarget.style.display = "none"; }}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      )}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.text, textAlign: "center", lineHeight: 1.2 }}>{c}</span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {/* ── Sizes & qty bottom sheet ──
          Slides up from the bottom when a color is selected so the
          user doesn't have to scroll past the color grid to find the
          size inputs. Non-modal — colors behind stay tappable so the
          user can swap colors without dismissing. Swipe down on the
          handle dismisses (clears selColor). */}
      {screen === "config" && (
        <Drawer.Root
          open={!!selColor}
          onOpenChange={(o) => { if (!o) { setSelColor(null); setQtys({}); setDroppedSizes([]); setBannerDismissed(false); } }}
          modal={false}
          dismissible
        >
          <Drawer.Portal>
            <Drawer.Content
              aria-describedby={undefined}
              style={{
                position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1200,
                background: T.card, color: T.text, fontFamily: font,
                borderRadius: "18px 18px 0 0",
                maxHeight: "82vh", display: "flex", flexDirection: "column",
                paddingBottom: "env(safe-area-inset-bottom)",
                boxShadow: "0 -8px 32px rgba(0,0,0,0.18)",
                outline: "none",
              }}>
              {/* Drag handle */}
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px", flexShrink: 0 }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: T.border }} />
              </div>

              {/* Header */}
              <div style={{ padding: "6px 16px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {selColor && currentColor && (
                  <div style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: currentColor.hex || T.surface,
                    border: `1px solid ${T.border}`,
                    overflow: "hidden", position: "relative", flexShrink: 0,
                  }}>
                    {currentColor.swatch && (
                      <img src={currentColor.swatch} alt="" loading="lazy" referrerPolicy="no-referrer"
                        onError={e => { e.currentTarget.style.display = "none"; }}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    )}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Drawer.Title asChild>
                    <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{selColor || ""}</div>
                  </Drawer.Title>
                  <div style={{ fontSize: 11, color: T.muted }}>Sizes & quantities</div>
                </div>
              </div>

              {/* Scrollable body */}
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
                {/* Dropped-sizes banner */}
                {selColor && droppedSizes.length > 0 && !bannerDismissed && (
                  <div style={{
                    background: T.amberDim, border: `1px solid ${T.amber}55`, borderRadius: 10,
                    padding: "10px 12px", marginBottom: 14,
                    display: "flex", alignItems: "flex-start", gap: 10,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.amber, marginBottom: 2 }}>
                        {droppedSizes.length === 1 ? "1 size won't carry over" : `${droppedSizes.length} sizes won't carry over`}
                      </div>
                      <div style={{ fontSize: 11, color: T.text, lineHeight: 1.5 }}>
                        {droppedSizes.map(d => `${d.size} (${d.qty})`).join(" · ")} — not stocked in {selColor}. Pick a different color or these will drop.
                      </div>
                    </div>
                    <button onClick={() => setBannerDismissed(true)}
                      style={{ background: "transparent", border: "none", color: T.amber, fontSize: 18, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
                  </div>
                )}

                {/* Size + qty grid */}
                {selColor && currentColor && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(74px, 1fr))", gap: 8 }}>
                    {sortSizes(currentColor.sizes).map(sz => {
                      // "Kept" indicator: sizes whose qty carried over
                      // from the previous blank get a subtle green
                      // border so the user can see what survived.
                      const wasCarried = existingQtys
                        && Object.keys(existingQtys).some(oldSz => normalizeSize(oldSz) === normalizeSize(sz) && (Number(existingQtys[oldSz]) || 0) > 0);
                      return (
                        <div key={sz} style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                          padding: 8, background: T.surface,
                          border: `1px solid ${wasCarried ? `${T.green}77` : T.border}`,
                          borderRadius: 10,
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: T.muted, fontFamily: mono }}>{sz}</span>
                          <input type="text" inputMode="numeric" value={qtys[sz] || ""}
                            onChange={e => {
                              const v = e.target.value.replace(/\D/g, "");
                              setQtys(p => ({ ...p, [sz]: v }));
                            }}
                            onFocus={e => e.target.select()}
                            placeholder="0"
                            style={{
                              width: "100%", padding: "8px", textAlign: "center",
                              background: T.card, border: `1px solid ${T.border}`, borderRadius: 6,
                              fontSize: 16, fontWeight: 700, color: T.text, fontFamily: mono,
                              outline: "none", boxSizing: "border-box", minHeight: 40,
                            }} />
                          <span style={{ fontSize: 9, color: T.faint, fontFamily: mono }}>${(currentColor.prices[sz] || 0).toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Sticky footer CTA */}
              <div style={{
                borderTop: `1px solid ${T.border}`,
                padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 12,
                flexShrink: 0, background: T.card,
              }}>
                <div style={{ flex: 1, fontSize: 12, color: T.muted, fontFamily: font }}>
                  {totalQty > 0 ? `${totalQty} units · ${selColor}` : `Set quantities`}
                </div>
                <button onClick={handleAssign} disabled={!canAssign}
                  style={{
                    padding: "12px 22px", borderRadius: 10, border: "none",
                    background: canAssign ? T.text : T.surface,
                    color: canAssign ? "#0a0a0a" : T.muted,
                    fontSize: 14, fontWeight: 700, fontFamily: font,
                    cursor: canAssign ? "pointer" : "default",
                    minHeight: 44, transition: "background 0.15s",
                  }}>
                  {assignMode ? "Assign blank" : "Add item"}
                </button>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </div>
  );
}

function ResultRow({ style, onPick, isFav, toggleFav }) {
  // Search results come from S&S (no _supplier tag); favorites carry
  // their original supplier. Star toggles map to whichever applies.
  const supplier = style._supplier || "ss";
  const fav = isFav ? isFav(supplier, style.styleName) : false;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
      padding: 12, minHeight: 64,
    }}>
      <button onClick={() => onPick(style)}
        style={{
          flex: 1, minWidth: 0, textAlign: "left", background: "transparent",
          border: "none", padding: 0, cursor: "pointer", fontFamily: font, color: T.text,
          display: "flex", alignItems: "center", gap: 12,
        }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{style.brandName}</span>
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
              color: supplier === "ss" ? T.blue : supplier === "ascolour" ? T.purple : supplier === "laapparel" ? T.green : T.faint,
            }}>
              {supplier === "ss" ? "S&S" : supplier === "ascolour" ? "AS Colour" : supplier === "laapparel" ? "LA Apparel" : supplier}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {style.styleName}
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {style.title}
          </div>
        </div>
      </button>
      {toggleFav && (
        <button onClick={() => toggleFav(supplier, style.styleName, style.styleName, style.brandName)}
          aria-label={fav ? "Unfavorite" : "Favorite"}
          style={{
            background: "transparent", border: "none", padding: 8, cursor: "pointer",
            fontSize: 18, color: fav ? T.amber : T.faint, flexShrink: 0,
          }}>
          {fav ? "★" : "☆"}
        </button>
      )}
    </div>
  );
}

// Lightweight garment-type sniffer — same vocabulary as
// BuySheetTab.detectGarmentType but standalone so we don't have to
// import an extra file. Falls back to "tee" so the costing card
// doesn't drop into accessory mode for an unrecognized blank.
function detectGarmentType(category, name) {
  const cat = (category || "").toLowerCase();
  const n = (name || "").toLowerCase();
  const catMap = {
    "t-shirts":"tee","short sleeve t-shirts":"tee","long sleeve t-shirts":"longsleeve",
    "longsleeve t-shirts":"longsleeve","fleece":"hoodie","hoodies":"hoodie",
    "hooded sweatshirts":"hoodie","sweatshirts":"crewneck","crew sweatshirts":"crewneck",
    "outerwear":"jacket","zip sweatshirts":"jacket","caps":"hat","headwear":"hat",
    "pants":"pants","shorts":"shorts","men / unisex":"tee","womens":"tee",
  };
  if (catMap[cat]) return catMap[cat];
  if (n.includes("hoodie") || n.includes("hooded")) return "hoodie";
  if (n.includes("crew") && (n.includes("sweat") || n.includes("neck"))) return "crewneck";
  if (n.includes("jacket") || n.includes("windbreaker")) return "jacket";
  if (n.includes("long sleeve") || n.includes("longsleeve") || n.includes("l/s")) return "longsleeve";
  if (n.includes("beanie") || n.includes("knit cap")) return "beanie";
  if (n.includes("hat") || n.includes("cap") || n.includes("snapback") || n.includes("trucker")) return "hat";
  if (n.includes("pant") || n.includes("jogger") || n.includes("sweatpant")) return "pants";
  if (n.includes("short") && !n.includes("sleeve")) return "shorts";
  if (n.includes("tee") || n.includes("t-shirt") || n.includes("tank")) return "tee";
  return "tee";
}
