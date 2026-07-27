"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
export const DEFAULT_CURVE = {S:5.13,M:20.57,L:38.14,XL:25.90,"2XL":7.69,"3XL":2.56};
// Waist × Inseam sell-through curve, derived from real Ridgeline sales (units
// sold per "{waist} / {inseam}" combo, summed across fits). Keys match the
// size-grid wiLabel format; distribute() normalizes across the selected subset.
export const WAIST_INSEAM_CURVE = {
  "28 / 30 (Short)":93, "28 / 32 (Regular)":57, "28 / 34 (Long)":8, "30 / 30 (Short)":196,
  "30 / 32 (Regular)":254, "30 / 34 (Long)":34, "32 / 30 (Short)":355, "32 / 32 (Regular)":653,
  "32 / 34 (Long)":226, "32 / 36 (Tall)":53, "34 / 30 (Short)":318, "34 / 32 (Regular)":757,
  "34 / 34 (Long)":378, "34 / 36 (Tall)":111, "36 / 30 (Short)":165, "36 / 32 (Regular)":366,
  "36 / 34 (Long)":163, "36 / 36 (Tall)":73, "38 / 30 (Short)":77, "38 / 32 (Regular)":152,
  "38 / 34 (Long)":88, "38 / 36 (Tall)":56, "40 / 30 (Short)":29, "40 / 32 (Regular)":38,
  "40 / 34 (Long)":17, "40 / 36 (Tall)":9, "42 / 30 (Short)":14, "42 / 32 (Regular)":36,
  "42 / 34 (Long)":7, "42 / 36 (Tall)":5,
};

// Auto-detect QB garment_type from supplier category + item name
export function detectGarmentType(category, name) {
  const cat = (category || "").toLowerCase();
  const n = (name || "").toLowerCase();
  // Category-based (supplier categories)
  const catMap = {
    "t-shirts":"tee","short sleeve t-shirts":"tee","long sleeve t-shirts":"longsleeve",
    "longsleeve t-shirts":"longsleeve","fleece":"hoodie","hoodies":"hoodie",
    "hooded sweatshirts":"hoodie","sweatshirts":"crewneck","crew sweatshirts":"crewneck",
    "outerwear":"jacket","zip sweatshirts":"jacket","caps":"hat","headwear":"hat",
    "pants":"pants","shorts":"shorts","men / unisex":"tee","womens":"tee",
  };
  if (catMap[cat]) return catMap[cat];
  // Name keyword fallback
  if (n.includes("hoodie") || n.includes("hooded")) return "hoodie";
  if (n.includes("crew") && (n.includes("sweat") || n.includes("neck"))) return "crewneck";
  if (n.includes("jacket") || n.includes("windbreaker") || n.includes("coach")) return "jacket";
  if (n.includes("long sleeve") || n.includes("longsleeve") || n.includes("l/s")) return "longsleeve";
  if (n.includes("beanie") || n.includes("knit cap")) return "beanie";
  if (n.includes("hat") || n.includes("cap") || n.includes("snapback") || n.includes("trucker")) return "hat";
  if (n.includes("pant") || n.includes("jogger") || n.includes("sweatpant")) return "pants";
  if (n.includes("short") && !n.includes("sleeve")) return "shorts";
  if (n.includes("tote") || n.includes("bag")) return "tote";
  if (n.includes("sock")) return "socks";
  if (n.includes("towel")) return "towel";
  if (n.includes("bandana")) return "bandana";
  if (n.includes("patch")) return "patch";
  if (n.includes("sticker")) return "sticker";
  if (n.includes("poster")) return "poster";
  if (n.includes("pin") && !n.includes("pine")) return "pin";
  if (n.includes("koozie") || n.includes("can cooler")) return "koozie";
  if (n.includes("banner")) return "banner";
  if (n.includes("flag")) return "flag";
  if (n.includes("key chain") || n.includes("keychain")) return "key_chain";
  if (n.includes("water bottle") || n.includes("bottle")) return "water_bottle";
  if (n.includes("woven label")) return "woven_labels";
  if (n.includes("tee") || n.includes("t-shirt") || n.includes("tank") || n.includes("sun shirt") || n.includes("performance")) return "tee";
  if (n.includes("shirt")) return "longsleeve";
  return "custom";
}

export const FLEECE_GARMENTS = ["crewneck", "hoodie", "jacket"];
export const fleeceFlag = (gt) => (gt && FLEECE_GARMENTS.includes(gt) ? { is_fleece: true } : {});

// Assign/swap a blank onto an existing item WITHOUT losing quantities — the
// ONE shared transform (ProductBuilder + JobDetailV2). The blank supplies
// vendor / SKU / style / color / cost; sizes carry by exact label match.
// When NOTHING matches but the item already has an order:
//   - single-size blank → adopt its label and move the whole order onto it
//     (fixes a one-size item going e.g. "One Size" → "Adjustable", which
//      previously remapped to qty 0 and wiped the order)
//   - multi-size blank → keep the item's own sizes + qtys, so a pre-order
//     size breakdown can't be collapsed by a mismatched blank
export function applyBlankToItem(it, blankData) {
  const blankSizes = blankData.sizes || [];
  const oldTotal = Object.values(it.qtys || {}).reduce((a, v) => a + (v || 0), 0);
  let sizes, qtys;
  // A blank only "carries" quantities when its qtys actually SUM to > 0. The
  // pickers seed a zero-filled qtys object ({S:0,M:0,…}) for the blank's sizes;
  // that must NOT be treated as authoritative or it overwrites the order with 0.
  const blankQtySum = blankData.qtys ? Object.values(blankData.qtys).reduce((a, v) => a + (v || 0), 0) : 0;
  if (blankQtySum > 0) {
    sizes = blankSizes; qtys = blankData.qtys;
  } else {
    const exact = Object.fromEntries(blankSizes.map(sz => [sz, it.qtys?.[sz] || 0]));
    const carried = Object.values(exact).reduce((a, v) => a + (v || 0), 0);
    if (carried > 0 || oldTotal === 0) {
      // Keep ordered sizes the blank DOESN'T carry (e.g. a 5001 maxes at 3XL but
      // the pre-order has 4XL) instead of dropping them — those units are real
      // orders. They stay on the card as substitution candidates (no blank cost
      // until a per-size substitute is set). This is the fix for silent size/unit
      // loss on assign; see size_subs.
      const uncovered = (it.sizes || []).filter(sz => !blankSizes.includes(sz) && (it.qtys?.[sz] || 0) > 0);
      sizes = [...blankSizes, ...uncovered];
      qtys = Object.fromEntries(sizes.map(sz => [sz, it.qtys?.[sz] || 0]));
    }
    else if (blankSizes.length === 1) { sizes = blankSizes; qtys = { [blankSizes[0]]: oldTotal }; }
    else { sizes = it.sizes || []; qtys = it.qtys || {}; }
  }
  // Normalize: qtys must hold EXACTLY the resolved sizes — strip any keys
  // left over from the old blank's size system (e.g. "Adjustable" lingering
  // after a swap to "OS"). Stray keys survive the save's buy_sheet_lines
  // prune (it keys on Object.keys(qtys)) and become orphan rows that
  // double-count and show a phantom size on the card. New sizes start at 0.
  qtys = Object.fromEntries(sizes.map(sz => [sz, qtys[sz] || 0]));
  const newTotal = Object.values(qtys).reduce((a, v) => a + (v || 0), 0);
  // A blank swap must re-derive cost_per_unit from the NEW blank's per-size
  // costs — otherwise the old blank's average lingers on the item row and
  // the Blanks tab keeps pricing off it (a $0/free blank would still show
  // the old cost). Same formula CostingTab uses on save (avg of the >0
  // per-size costs; all-zero/free → 0) so the two write paths agree.
  const newBlankCosts = blankData.blankCosts || {};
  const costVals = Object.values(newBlankCosts).map(Number).filter(v => v > 0);
  const newCostPerUnit = costVals.length
    ? Math.round(costVals.reduce((a, v) => a + v, 0) / costVals.length * 100) / 100
    : 0;
  const gt = blankData.garment_type || detectGarmentType("", (it.name || "") + " " + (blankData.blank_vendor || "")) || it.garment_type;
  return {
    ...it, blank_vendor: blankData.blank_vendor, blank_sku: blankData.blank_sku,
    style: blankData.style, color: blankData.color, sizes,
    qtys,
    blankCosts: newBlankCosts,
    cost_per_unit: newCostPerUnit,
    garment_type: gt,
    ...fleeceFlag(gt),
    totalQty: newTotal,
    curve: blankData.curve || it.curve || DEFAULT_CURVE,
  };
}

// Shift-click range selection for size pickers
export function handleSizeToggle(sz, e, availableSizes, setSelSizes, lastClickedRef) {
  if (e?.shiftKey && lastClickedRef.current && lastClickedRef.current !== sz) {
    const sorted = sortSizes(availableSizes);
    const a = sorted.indexOf(lastClickedRef.current);
    const b = sorted.indexOf(sz);
    if (a >= 0 && b >= 0) {
      const [start, end] = a < b ? [a, b] : [b, a];
      setSelSizes(p => { const n = { ...p }; sorted.slice(start, end + 1).forEach(s => { n[s] = 1; }); return n; });
      return;
    }
  }
  lastClickedRef.current = sz;
  setSelSizes(p => { const n = { ...p }; if (n[sz] !== undefined) delete n[sz]; else n[sz] = 1; return n; });
}

export function distribute(total, sizes, curve) {
  const relevant = sizes.filter(sz => curve[sz] !== undefined);
  const total_pct = relevant.reduce((a,sz) => a+(curve[sz]||0), 0);
  const result = {}; sizes.forEach(sz => { result[sz] = 0; });
  if (!total_pct || !relevant.length) return result;
  let assigned = 0;
  relevant.forEach(sz => { const n = Math.ceil(total*(curve[sz]||0)/total_pct); result[sz] = n; assigned += n; });
  const over = assigned - total;
  if (over > 0) {
    const sorted = [...relevant].sort((a,b) => (curve[b]||0)-(curve[a]||0));
    for (let i = 0; i < over; i++) result[sorted[i % sorted.length]]--;
  }
  return result;
}

// ── S&S Catalog Picker ──────────────────────────────────────────────────────

export function SSPicker({ onAdd, onClose, isFav, toggleFav, assignMode, defaultItemName }) {
  const [query, setQuery] = useState("");
  const [colorSearch, setColorSearch] = useState("");
  const [brands, setBrands] = useState([]);
  const [selBrand, setSelBrand] = useState(null);
  const [styles, setStyles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selStyle, setSelStyle] = useState(null);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selColor, setSelColor] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [filteredBrands, setFilteredBrands] = useState(null);
  const [itemName, setItemName] = useState(defaultItemName || "");
  const lastClickedSize = useRef(null);

  useEffect(() => {
    fetch("/api/ss?endpoint=brands")
      .then(r => r.json())
      .then(data => setBrands(Array.isArray(data) ? data.map(b => b.name).sort() : []))
      .catch(() => {});
  }, []);

  const searchByBrand = async (brandName) => {
    setSelBrand(brandName); setStyles([]); setSelStyle(null); setProducts([]); setSelColor(null); setFilteredBrands(null); setLoading(true);
    try {
      const res = await fetch(`/api/ss?endpoint=search&brand=${encodeURIComponent(brandName)}`);
      const data = await res.json();
      setStyles(Array.isArray(data) ? data.filter(s => s.brandName === brandName) : []);
    } catch { setStyles([]); }
    finally { setLoading(false); }
  };

  const searchByQuery = async (q) => {
    const term = q !== undefined ? q : query;
    if (!term.trim()) return;
    setSelBrand(null); setStyles([]); setSelStyle(null); setProducts([]); setSelColor(null); setLoading(true);
    try {
      const res = await fetch(`/api/ss?endpoint=search&q=${encodeURIComponent(term)}`);
      const data = await res.json();
      const results = Array.isArray(data) ? data : [];
      setStyles(results);
      setFilteredBrands([...new Set(results.map(s => s.brandName))].sort());
    } catch { setStyles([]); setFilteredBrands(null); }
    finally { setLoading(false); }
  };

  // Debounced auto-search as you type
  const searchTimer = useRef(null);
  useEffect(() => {
    if (!query.trim() || query.length < 2) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchByQuery(query), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query]);

  const loadProducts = async (style) => {
    setSelStyle(style); setLoadingProducts(true); setSelColor(null);
    try {
      const res = await fetch(`/api/ss?endpoint=products&styleId=${style.styleID}`);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch { setProducts([]); }
    finally { setLoadingProducts(false); }
  };

  const colorGroups = products.reduce((acc, p) => {
    if (!acc[p.colorName]) acc[p.colorName] = { items: [], sizes: [], prices: {} };
    acc[p.colorName].items.push(p);
    if (!acc[p.colorName].sizes.includes(p.sizeName)) acc[p.colorName].sizes.push(p.sizeName);
    acc[p.colorName].prices[p.sizeName] = p.customerPrice || p.casePrice || 0;
    return acc;
  }, {});
  const colorNames = Object.keys(colorGroups).sort();
  const currentColor = selColor ? colorGroups[selColor] : null;

  const toggleSz = (sz, e) => handleSizeToggle(sz, e, currentColor?.sizes || [], setSelSizes, lastClickedSize);
  const canAdd = selStyle && selColor && currentColor && Object.keys(selSizes).length > 0;

  const doAdd = () => {
    if (!canAdd) return;
    const allSizes = sortSizes(Object.keys(selSizes));
    const qtys = {}; allSizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = {}; allSizes.forEach(sz => { blankCosts[sz] = currentColor.prices[sz] || 0; });
    const itemFullName = itemName.trim() || `${selStyle.brandName} ${selStyle.styleName} - ${selColor}`;
    onAdd({
      id: Date.now() + Math.random(),
      name: itemFullName,
      blank_vendor: `${selStyle.brandName} ${selStyle.styleName}`,
      blank_sku: selColor,
      style: `${selStyle.brandName} ${selStyle.styleName}`,
      color: selColor,
      garment_type: detectGarmentType(selStyle.categoryName, itemFullName),
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  };

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding:"8px 11px", cursor:"pointer", fontSize:11, fontFamily:font, background:active?T.accent:"transparent", color:active?"#0a0a0a":T.text, borderBottom:`1px solid ${T.border}`, transition:"background 0.1s" }}
      onMouseEnter={e => { if(!active) e.currentTarget.style.background=T.surface; }}
      onMouseLeave={e => { if(!active) e.currentTarget.style.background="transparent"; }}>
      {label}
      {sub && <div style={{ fontSize:9, color:active?"rgba(0,0,0,0.6)":T.faint, marginTop:1 }}>{sub}</div>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding:"5px 11px", background:T.surface, borderBottom:`1px solid ${T.border}`, fontSize:9, fontWeight:700, color:T.muted, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:font }}>{title}</div>
  );

  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden", marginBottom:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", borderBottom:`1px solid ${T.border}` }}>
        <span style={{ fontSize:12, fontWeight:700, color:T.text, fontFamily:font, whiteSpace:"nowrap" }}>S&amp;S Activewear</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search styles..." autoFocus style={{ flex:1, fontFamily:font, fontSize:12, color:T.text, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 10px", outline:"none" }} />
        {loading && <span style={{ fontSize:10, color:T.muted }}>Searching...</span>}
        <input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily:font, fontSize:12, color:T.text, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 10px", outline:"none", width:180 }} />
        <button onClick={doAdd} disabled={!canAdd} style={{ background:canAdd?T.accent:T.surface, color:canAdd?"#0a0a0a":T.muted, border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontFamily:font, fontWeight:600, cursor:canAdd?"pointer":"default", transition:"all 0.15s" }}>{assignMode ? "Assign to item →" : "Add to buy sheet →"}</button>
        <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1.5fr 1fr", height:300 }}>
        <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {colHead("Brand")}
          <div style={{ flex:1, overflowY:"auto" }}>
            {(filteredBrands || brands).map(b => colRow(b, selBrand===b, () => { setSelBrand(b); if(filteredBrands){ setSelStyle(null); setSelColor(null); } else { searchByBrand(b); } }))}
          </div>
        </div>
        <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {colHead("Style")}
          <div style={{ flex:1, overflowY:"auto" }}>
            {loading ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>Loading…</div>
              : styles.length===0 ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>← Brand or search</div>
              : (selBrand ? styles.filter(s => s.brandName===selBrand) : styles).map(s => (
                <div key={s.styleID} style={{ display:"flex", alignItems:"center", borderBottom:`1px solid ${T.border}` }}>
                  <div onClick={() => loadProducts(s)} style={{ flex:1, padding:"8px 11px", cursor:"pointer", fontSize:11, fontFamily:font, background:selStyle?.styleID===s.styleID?T.accent:"transparent", color:selStyle?.styleID===s.styleID?"#0a0a0a":T.text, transition:"background 0.1s" }}
                    onMouseEnter={e => { if(selStyle?.styleID!==s.styleID) e.currentTarget.style.background=T.surface; }}
                    onMouseLeave={e => { if(selStyle?.styleID!==s.styleID) e.currentTarget.style.background="transparent"; }}>
                    {s.styleName}
                    {(s.title||s.baseCategory) && <div style={{ fontSize:9, color:selStyle?.styleID===s.styleID?"rgba(255,255,255,0.7)":T.faint, marginTop:1 }}>{s.title||s.baseCategory}</div>}
                  </div>
                  {isFav && <button onClick={(e) => { e.stopPropagation(); toggleFav("ss", s.styleName, `${s.brandName} ${s.styleName}`, s.baseCategory || s.title); }}
                    style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 8px", fontSize:14, color:isFav("ss",s.styleName)?T.amber:T.faint, flexShrink:0 }}>
                    {isFav("ss",s.styleName)?"★":"☆"}
                  </button>}
                </div>
              ))}
          </div>
        </div>
        <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {colHead("Color")}
          {selStyle && <div style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}><input value={colorSearch} onChange={e => setColorSearch(e.target.value)} placeholder="Search colors..." style={{ width: "100%", fontFamily: font, fontSize: 11, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "4px 8px", outline: "none", boxSizing: "border-box" }} /></div>}
          <div style={{ flex:1, overflowY:"auto" }}>
            {loadingProducts ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>Loading…</div>
              : !selStyle ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>← Style</div>
              : colorNames.filter(c => !colorSearch.trim() || c.toLowerCase().includes(colorSearch.toLowerCase())).map(c => {
                const stock = (colorGroups[c]?.items||[]).reduce((a,p) => a + (p.warehouses||[]).reduce((b,w) => b + w.qty, 0), 0);
                return colRow(c, selColor===c, () => { setSelColor(c); setSelSizes({}); }, stock > 0 ? `${stock.toLocaleString()} avail` : undefined);
              })}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {colHead("Sizes")}
          <div style={{ flex:1, overflowY:"auto", padding:8 }}>
            {!selColor ? <div style={{ padding:"6px 2px", fontSize:10, color:T.faint, fontFamily:font }}>← Color</div>
              : <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {sortSizes(currentColor.sizes).map(sz => {
                    const on = selSizes[sz] !== undefined;
                    const sizeProduct = (currentColor.items||[]).find(p => p.sizeName === sz);
                    const sizeStock = sizeProduct ? (sizeProduct.warehouses||[]).reduce((a,w) => a + w.qty, 0) : 0;
                    return (
                      <div key={sz} onClick={(e) => toggleSz(sz, e)}
                        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 10px", borderRadius:6, cursor:"pointer", border:`1px solid ${on?T.accent:T.border}`, background:on?T.accent:T.surface, transition:"all 0.12s", userSelect:"none" }}>
                        <span style={{ fontSize:12, fontWeight:700, color:on?"#0a0a0a":T.muted, fontFamily:mono }}>{sz}</span>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:9, color:on?"rgba(0,0,0,0.45)":sizeStock>100?T.green:sizeStock>0?T.amber:T.red, fontFamily:mono }}>{sizeStock.toLocaleString()}</span>
                          <span style={{ fontSize:10, color:on?"rgba(0,0,0,0.6)":T.muted }}>${Number(currentColor.prices[sz]||0).toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </div>
          {selColor && Object.keys(selSizes).length > 0 && (
            <div style={{ padding:"5px 10px", borderTop:`1px solid ${T.border}`, fontSize:10, fontFamily:font, color:T.muted }}>
              {Object.keys(selSizes).length} size{Object.keys(selSizes).length!==1?"s":""} selected
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ── AS Colour Picker ─────────────────────────────────────────────────────────

export function ASColourPicker({ onAdd, onClose, isFav, toggleFav, assignMode, defaultItemName }) {
  const [colorSearch, setColorSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pricing, setPricing] = useState({});  // { sku: price }
  const [selCategory, setSelCategory] = useState(null);
  const [selStyle, setSelStyle] = useState(null);
  const [variants, setVariants] = useState([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [selColor, setSelColor] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [inventory, setInventory] = useState({});  // { sku: totalQty }
  const [itemName, setItemName] = useState(defaultItemName || "");
  const lastClickedSize = useRef(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      const [prodRes, priceRes] = await Promise.all([
        fetch("/api/ascolour?endpoint=products"),
        fetch("/api/ascolour?endpoint=pricing"),
      ]);
      const prodData = await prodRes.json();
      setProducts(Array.isArray(prodData) ? prodData : []);
      const priceData = await priceRes.json();
      const pm = {};
      (Array.isArray(priceData) ? priceData : []).forEach(p => { pm[p.sku] = p.price; });
      setPricing(pm);
      setLoading(false);
    }
    load();
  }, []);

  const categories = [...new Set(products.map(p => p.productType).filter(Boolean))].sort();
  const filteredProducts = products.filter(p => {
    if (search.trim()) return p.styleName?.toLowerCase().includes(search.toLowerCase()) || p.styleCode?.includes(search) || p.productType?.toLowerCase().includes(search.toLowerCase());
    if (selCategory) return p.productType === selCategory;
    return true;
  });

  async function loadVariants(style) {
    setSelStyle(style);
    setSelColor(null);
    setSelSizes({});
    setVariants([]);
    setInventory({});
    setLoadingVariants(true);
    try {
      const [varRes, invRes] = await Promise.all([
        fetch(`/api/ascolour?endpoint=variants&styleCode=${style.styleCode}`),
        fetch(`/api/ascolour?endpoint=inventory&q=${style.styleCode}`),
      ]);
      const varData = await varRes.json();
      setVariants(Array.isArray(varData) ? varData : []);
      const invData = await invRes.json();
      const inv = {};
      (Array.isArray(invData) ? invData : []).forEach(item => {
        inv[item.sku] = (inv[item.sku] || 0) + item.quantity;
      });
      setInventory(inv);
    } catch (e) { console.error("AS Colour load error:", e); }
    setLoadingVariants(false);
  }

  // Group variants by color
  const colorGroups = variants.reduce((acc, v) => {
    if (!acc[v.colour]) acc[v.colour] = [];
    acc[v.colour].push(v);
    return acc;
  }, {});
  const colorNames = Object.keys(colorGroups).sort();
  const currentColorVariants = selColor ? (colorGroups[selColor] || []) : [];

  const toggleSz = (sz, e) => handleSizeToggle(sz, e, currentColorVariants.map(v => v.sizeCode), setSelSizes, lastClickedSize);
  const canAdd = selStyle && selColor && Object.keys(selSizes).length > 0;

  const doAdd = () => {
    if (!canAdd) return;
    const allSizes = sortSizes(Object.keys(selSizes));
    const qtys = {}; allSizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = {};
    allSizes.forEach(sz => {
      const variant = currentColorVariants.find(v => v.sizeCode === sz);
      if (variant) blankCosts[sz] = pricing[variant.sku] || 0;
    });
    const itemFullName = itemName.trim() || `AS Colour ${selStyle.styleCode} - ${selColor}`;
    onAdd({
      id: Date.now() + Math.random(),
      name: itemFullName,
      blank_vendor: `AS Colour ${selStyle.styleCode}`,
      blank_sku: selColor,
      style: `AS Colour ${selStyle.styleCode}`,
      color: selColor,
      garment_type: detectGarmentType(selStyle.category, itemFullName + " " + (selStyle.name || "")),
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  };

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#0a0a0a" : T.text, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {label}
      {sub && <div style={{ fontSize: 9, color: active ? "rgba(0,0,0,0.6)" : T.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding: "5px 11px", background: T.surface, borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: font }}>{title}</div>
  );

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font, whiteSpace: "nowrap" }}>AS Colour</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search styles..." autoFocus style={{ flex: 1, fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none" }} />
        <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 180 }} />
        <button onClick={doAdd} disabled={!canAdd} style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#0a0a0a" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default", transition: "all 0.15s" }}>{assignMode ? "Assign to item →" : "Add to buy sheet →"}</button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.muted, fontFamily: font }}>Loading AS Colour catalog...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 1.2fr 1fr", height: 300 }}>
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Category")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {categories.map(cat => colRow(cat, selCategory === cat, () => { setSelCategory(selCategory === cat ? null : cat); setSelStyle(null); setSelColor(null); setSelSizes({}); setVariants([]); }))}
            </div>
          </div>
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Style")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {filteredProducts.map(p => (
                <div key={p.styleCode} style={{ display:"flex", alignItems:"center", borderBottom:`1px solid ${T.border}` }}>
                  <div onClick={() => loadVariants(p)} style={{ flex:1, padding:"8px 11px", cursor:"pointer", fontSize:11, fontFamily:font, background:selStyle?.styleCode===p.styleCode?T.accent:"transparent", color:selStyle?.styleCode===p.styleCode?"#0a0a0a":T.text, transition:"background 0.1s" }}
                    onMouseEnter={e => { if(selStyle?.styleCode!==p.styleCode) e.currentTarget.style.background=T.surface; }}
                    onMouseLeave={e => { if(selStyle?.styleCode!==p.styleCode) e.currentTarget.style.background="transparent"; }}>
                    {`${p.styleCode} — ${(p.styleName || "").replace(` | ${p.styleCode}`, "")}`}
                  </div>
                  {isFav && <button onClick={(e) => { e.stopPropagation(); toggleFav("ascolour", p.styleCode, `AS Colour ${p.styleCode}`, p.productType); }}
                    style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 8px", fontSize:14, color:isFav("ascolour",p.styleCode)?T.amber:T.faint, flexShrink:0 }}>
                    {isFav("ascolour",p.styleCode)?"★":"☆"}
                  </button>}
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Color")}
            {selStyle && <div style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}><input value={colorSearch} onChange={e => setColorSearch(e.target.value)} placeholder="Search colors..." style={{ width: "100%", fontFamily: font, fontSize: 11, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "4px 8px", outline: "none", boxSizing: "border-box" }} /></div>}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {loadingVariants ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>Loading...</div>
                : !selStyle ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>← Style</div>
                : colorNames.filter(c => !colorSearch.trim() || c.toLowerCase().includes(colorSearch.toLowerCase())).map(c => {
                  const colorVars = colorGroups[c] || [];
                  const stock = colorVars.reduce((a, v) => a + (inventory[v.sku] || 0), 0);
                  return colRow(c, selColor === c, () => { setSelColor(c); setSelSizes({}); }, stock > 0 ? `${stock.toLocaleString()} avail` : undefined);
                })}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Sizes")}
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {!selColor ? <div style={{ padding: "6px 2px", fontSize: 10, color: T.faint, fontFamily: font }}>← Color</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {sortSizes(currentColorVariants.map(v => v.sizeCode)).map(sz => {
                    const on = selSizes[sz] !== undefined;
                    const variant = currentColorVariants.find(v => v.sizeCode === sz);
                    const price = variant ? (pricing[variant.sku] || 0) : 0;
                    const stock = variant ? (inventory[variant.sku] || 0) : 0;
                    return (
                      <div key={sz} onClick={(e) => toggleSz(sz, e)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.surface, transition: "all 0.12s", userSelect: "none" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#0a0a0a" : T.muted, fontFamily: mono }}>{sz}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 9, color: on ? "rgba(0,0,0,0.45)" : stock > 100 ? T.green : stock > 0 ? T.amber : T.red, fontFamily: mono }}>{stock.toLocaleString()}</span>
                          {price > 0 && <span style={{ fontSize: 10, color: on ? "rgba(0,0,0,0.6)" : T.muted }}>${price.toFixed(2)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              }
            </div>
            {selColor && Object.keys(selSizes).length > 0 && (
              <div style={{ padding: "5px 10px", borderTop: `1px solid ${T.border}`, fontSize: 10, fontFamily: font, color: T.muted }}>
                {Object.keys(selSizes).length} size{Object.keys(selSizes).length !== 1 ? "s" : ""} selected
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LA Apparel Picker ────────────────────────────────────────────────────────
export function LAApparelPicker({ onAdd, onClose, isFav, toggleFav, assignMode, defaultItemName }) {
  const [colorSearch, setColorSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selCategory, setSelCategory] = useState(null);
  const [selStyle, setSelStyle] = useState(null);
  const [variants, setVariants] = useState([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [selColor, setSelColor] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [itemName, setItemName] = useState(defaultItemName || "");
  const [search, setSearch] = useState("");
  const [newColorName, setNewColorName] = useState("");
  const [addingColor, setAddingColor] = useState(false);
  const lastClickedSize = useRef(null);

  useEffect(() => {
    fetch("/api/laapparel?endpoint=products").then(r => r.json()).then(data => {
      setProducts(Array.isArray(data) ? data : []);
      setLoading(false);
    });
  }, []);

  // Add a colorway to the style's catalog rows, then reload variants. This is
  // how colors get onto styles the LA Apparel live API can't serve (468/479
  // catalog rows shipped colorless; their API has been down — Jul 27).
  const addStyleColor = async () => {
    const c = newColorName.trim();
    if (!c || !selStyle || addingColor) return;
    setAddingColor(true);
    await fetch(`/api/laapparel?endpoint=add_color&styleCode=${encodeURIComponent(selStyle.styleCode)}&color=${encodeURIComponent(c)}`).catch(() => {});
    setNewColorName(""); setAddingColor(false);
    loadStyle(selStyle);
  };

  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  const filteredProducts = products.filter(p => {
    if (search.trim()) return p.styleCode.toLowerCase().includes(search.toLowerCase()) || (p.name||"").toLowerCase().includes(search.toLowerCase());
    if (selCategory) return p.category === selCategory;
    return true;
  });

  async function loadStyle(product) {
    setSelStyle(product); setSelColor(null); setSelSizes({}); setVariants([]); setLoadingVariants(true);
    const res = await fetch(`/api/laapparel?endpoint=variants&styleCode=${product.styleCode}`);
    const data = await res.json();
    setVariants(Array.isArray(data) ? data : []);
    setLoadingVariants(false);
  }

  // Group variants by color
  const colorGroups = variants.reduce((acc, v) => {
    if (!v.colour) return acc;
    if (!acc[v.colour]) acc[v.colour] = [];
    acc[v.colour].push(v);
    return acc;
  }, {});
  const colorNames = Object.keys(colorGroups).sort();
  const currentColorVariants = selColor ? (colorGroups[selColor] || []) : [];

  const toggleSz = (sz, e) => handleSizeToggle(sz, e, currentColorVariants.map(v => v.sizeCode), setSelSizes, lastClickedSize);
  const canAdd = selStyle && selColor && Object.keys(selSizes).length > 0;

  const doAdd = () => {
    if (!canAdd) return;
    const allSizes = sortSizes(Object.keys(selSizes));
    const qtys = {}; allSizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = {};
    allSizes.forEach(sz => {
      const variant = currentColorVariants.find(v => v.sizeCode === sz);
      if (variant) blankCosts[sz] = variant.price || 0;
    });
    const itemFullName = itemName.trim() || `LA Apparel ${selStyle.styleCode} - ${selColor}`;
    onAdd({
      id: Date.now() + Math.random(),
      name: itemFullName,
      blank_vendor: `LA Apparel ${selStyle.styleCode}`,
      blank_sku: selColor,
      style: `LA Apparel ${selStyle.styleCode}`,
      color: selColor,
      garment_type: detectGarmentType(selStyle.category, itemFullName + " " + (selStyle.name || "")),
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  };

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#0a0a0a" : T.text, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {label}
      {sub && <div style={{ fontSize: 9, color: active ? "rgba(0,0,0,0.6)" : T.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding: "5px 11px", background: T.surface, borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: font }}>{title}</div>
  );

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font, whiteSpace: "nowrap" }}>LA Apparel</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search styles..." autoFocus style={{ flex: 1, fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none" }} />
        <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 180 }} />
        <button onClick={doAdd} disabled={!canAdd} style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#0a0a0a" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default" }}>{assignMode ? "Assign to item →" : "Add to buy sheet →"}</button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.muted }}>Loading LA Apparel catalog...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 1fr 1fr", height: 300 }}>
          {/* Category */}
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Category")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {categories.map(cat => colRow(cat, selCategory === cat, () => { setSelCategory(selCategory === cat ? null : cat); setSelStyle(null); setSelColor(null); setSelSizes({}); }))}
            </div>
          </div>
          {/* Style */}
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Style")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {filteredProducts.map(p => (
                <div key={p.styleCode} style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${T.border}` }}>
                  <div onClick={() => loadStyle(p)} style={{ flex: 1, padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: selStyle?.styleCode === p.styleCode ? T.accent : "transparent", color: selStyle?.styleCode === p.styleCode ? "#0a0a0a" : T.text, transition: "background 0.1s" }}
                    onMouseEnter={e => { if (selStyle?.styleCode !== p.styleCode) e.currentTarget.style.background = T.surface; }}
                    onMouseLeave={e => { if (selStyle?.styleCode !== p.styleCode) e.currentTarget.style.background = "transparent"; }}>
                    {p.styleCode}
                    <div style={{ fontSize: 9, color: selStyle?.styleCode === p.styleCode ? "rgba(255,255,255,0.7)" : T.faint, marginTop: 1 }}>{p.name || p.description}</div>
                  </div>
                  {isFav && <button onClick={(e) => { e.stopPropagation(); toggleFav("laapparel", p.styleCode, `LA Apparel ${p.styleCode}`, p.description); }}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", fontSize: 14, color: isFav("laapparel", p.styleCode) ? T.amber : T.faint, flexShrink: 0 }}>
                    {isFav("laapparel", p.styleCode) ? "★" : "☆"}
                  </button>}
                </div>
              ))}
            </div>
          </div>
          {/* Color */}
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Color")}
            {selStyle && <div style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}><input value={colorSearch} onChange={e => setColorSearch(e.target.value)} placeholder="Search colors..." style={{ width: "100%", fontFamily: font, fontSize: 11, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "4px 8px", outline: "none", boxSizing: "border-box" }} /></div>}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {!selStyle ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint }}>← Style</div>
                : loadingVariants ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint }}>Loading...</div>
                : <>
                  {colorNames.filter(c => !colorSearch.trim() || c.toLowerCase().includes(colorSearch.toLowerCase())).map(c => {
                    const stock = colorGroups[c].reduce((a, v) => a + (v.stock || 0), 0);
                    return colRow(c, selColor === c, () => { setSelColor(c); setSelSizes({}); }, stock > 0 ? `${stock.toLocaleString()} avail` : undefined);
                  })}
                  {colorNames.length === 0 && (
                    <div style={{ padding: "10px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>
                      No colors on file for this style — add the colorway you need:
                    </div>
                  )}
                  <div style={{ padding: "6px", display: "flex", gap: 4 }}>
                    <input value={newColorName} onChange={e => setNewColorName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addStyleColor(); }}
                      placeholder="+ Add color" disabled={addingColor}
                      style={{ flex: 1, minWidth: 0, fontFamily: font, fontSize: 11, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "4px 8px", outline: "none", boxSizing: "border-box" }} />
                    {newColorName.trim() && (
                      <button onClick={addStyleColor} disabled={addingColor}
                        style={{ fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.card, color: T.text, cursor: addingColor ? "default" : "pointer" }}>
                        {addingColor ? "…" : "Add"}
                      </button>
                    )}
                  </div>
                </>
              }
            </div>
          </div>
          {/* Sizes */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Sizes")}
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {!selColor ? <div style={{ padding: "6px 2px", fontSize: 10, color: T.faint, fontFamily: font }}>← Color</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {sortSizes(currentColorVariants.map(v => v.sizeCode)).map(sz => {
                    const on = selSizes[sz] !== undefined;
                    const variant = currentColorVariants.find(v => v.sizeCode === sz);
                    const price = variant?.price || 0;
                    // stock null = catalog fallback (LA Apparel live API down) — unknown,
                    // not zero. Hide the count instead of showing a false red 0.
                    const stock = variant?.stock ?? null;
                    return (
                      <div key={sz} onClick={(e) => toggleSz(sz, e)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.surface, transition: "all 0.12s", userSelect: "none" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#0a0a0a" : T.muted, fontFamily: mono }}>{sz}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {stock != null && <span style={{ fontSize: 9, color: on ? "rgba(0,0,0,0.45)" : stock > 100 ? T.green : stock > 0 ? T.amber : T.red, fontFamily: mono }}>{stock.toLocaleString()}</span>}
                          {price > 0 && <span style={{ fontSize: 10, color: on ? "rgba(0,0,0,0.6)" : T.muted }}>${price.toFixed(2)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              }
            </div>
            {selColor && Object.keys(selSizes).length > 0 && (
              <div style={{ padding: "5px 10px", borderTop: `1px solid ${T.border}`, fontSize: 10, fontFamily: font, color: T.muted }}>
                {Object.keys(selSizes).length} size{Object.keys(selSizes).length !== 1 ? "s" : ""} selected
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Favorites Picker ─────────────────────────────────────────────────────────
export function FavoritesPicker({ favorites, setFavorites, onAdd, onClose, toggleFav, assignMode, defaultItemName }) {
  const [colorSearch, setColorSearch] = useState("");
  const HP_CATEGORIES = ["Crewnecks", "Hats", "Hoodies", "Jackets", "Long Sleeve", "Tees", "Other"];
  const [selCategory, setSelCategory] = useState(null);
  const [selFav, setSelFav] = useState(null);
  const [variants, setVariants] = useState([]);
  const [inventory, setInventory] = useState({});
  const [pricing, setPricing] = useState({});
  const [loading, setLoading] = useState(false);
  const [selColor, setSelColor] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [itemName, setItemName] = useState(defaultItemName || "");
  const [newColor, setNewColor] = useState("");
  const lastClickedSize = useRef(null);

  async function addLAColor() {
    if (!newColor.trim() || !selFav || selFav.supplier !== "laapparel") return;
    await fetch(`/api/laapparel?endpoint=add_color&styleCode=${selFav.style_code}&color=${encodeURIComponent(newColor.trim())}`);
    // Reload variants to pick up new color
    await loadFav(selFav);
    setNewColor("");
  }

  async function loadFav(fav) {
    setSelFav(fav); setSelColor(null); setSelSizes({}); setVariants([]); setInventory({}); setLoading(true);
    try {
      if (fav.supplier === "ss") {
        // S&S: search by style name, get products
        const searchRes = await fetch(`/api/ss?endpoint=search&q=${encodeURIComponent(fav.style_code)}`);
        const searchData = await searchRes.json();
        const match = (searchData || []).find(s => s.styleName === fav.style_code);
        if (match) {
          const prodRes = await fetch(`/api/ss?endpoint=products&styleId=${match.styleID}`);
          const products = await prodRes.json();
          const mapped = (products || []).map(p => ({
            sku: `${p.styleName}-${p.colorName}-${p.sizeName}`,
            colour: p.colorName,
            sizeCode: p.sizeName,
            price: p.customerPrice || p.casePrice || 0,
            stock: (p.warehouses || []).reduce((a, w) => a + w.qty, 0),
          }));
          setVariants(mapped);
          const inv = {}; mapped.forEach(v => { inv[v.sku] = v.stock; });
          setInventory(inv);
          const pr = {}; mapped.forEach(v => { pr[v.sku] = v.price; });
          setPricing(pr);
        }
      } else if (fav.supplier === "ascolour") {
        const [varRes, invRes, priceRes] = await Promise.all([
          fetch(`/api/ascolour?endpoint=variants&styleCode=${fav.style_code}`),
          fetch(`/api/ascolour?endpoint=inventory&q=${fav.style_code}`),
          fetch(`/api/ascolour?endpoint=pricing`),
        ]);
        const varData = await varRes.json();
        setVariants((varData || []).map(v => ({ ...v, colour: v.colour, sizeCode: v.sizeCode })));
        const invData = await invRes.json();
        const inv = {};
        (invData || []).forEach(item => { inv[item.sku] = (inv[item.sku] || 0) + item.quantity; });
        setInventory(inv);
        const priceData = await priceRes.json();
        const pr = {};
        (priceData || []).forEach(p => { pr[p.sku] = p.price; });
        setPricing(pr);
      } else if (fav.supplier === "laapparel") {
        const varRes = await fetch(`/api/laapparel?endpoint=variants&styleCode=${fav.style_code}`);
        const varData = await varRes.json();
        setVariants(Array.isArray(varData) ? varData : []);
        const pr = {}; const inv = {};
        (varData || []).forEach(v => { pr[v.sku] = v.price || 0; inv[v.sku] = v.stock || 0; });
        setPricing(pr);
        setInventory(inv);
      }
    } catch (e) { console.error("Favorites load error:", e); }
    setLoading(false);
  }

  const colorGroups = variants.reduce((acc, v) => {
    if (!acc[v.colour]) acc[v.colour] = [];
    acc[v.colour].push(v);
    return acc;
  }, {});
  const colorNames = Object.keys(colorGroups).sort();
  const currentColorVariants = selColor ? (colorGroups[selColor] || []) : [];

  const toggleSz = (sz, e) => handleSizeToggle(sz, e, currentColorVariants.map(v => v.sizeCode), setSelSizes, lastClickedSize);
  const canAdd = selFav && selColor && Object.keys(selSizes).length > 0;

  const doAdd = () => {
    if (!canAdd) return;
    const allSizes = sortSizes(Object.keys(selSizes));
    const qtys = {}; allSizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = {};
    allSizes.forEach(sz => {
      const variant = currentColorVariants.find(v => v.sizeCode === sz);
      if (variant) blankCosts[sz] = pricing[variant.sku] || variant.price || 0;
    });
    const itemFullName = itemName.trim() || `${selFav.style_name} - ${selColor}`;
    onAdd({
      id: Date.now() + Math.random(),
      name: itemFullName,
      blank_vendor: selFav.style_name || selFav.style_code || "",
      blank_sku: selColor,
      style: selFav.style_name,
      color: selColor,
      garment_type: detectGarmentType(selFav.category || "", itemFullName + " " + (selFav.style_name || "") + " " + selColor),
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  };

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#0a0a0a" : T.text, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {label}
      {sub && <div style={{ fontSize: 9, color: active ? "rgba(0,0,0,0.6)" : T.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding: "5px 11px", background: T.surface, borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: font }}>{title}</div>
  );

  const supplierLabel = { ss: "S&S", ascolour: "AS Colour" };

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font, whiteSpace: "nowrap" }}>House Party Favorites</span>
        <div style={{ flex: 1 }} />
        <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 180 }} />
        <button onClick={doAdd} disabled={!canAdd} style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#0a0a0a" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default" }}>{assignMode ? "Assign to item →" : "Add to buy sheet →"}</button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.4fr 1fr 1fr", height: 300 }}>
        {/* Category column */}
        <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {colHead("Category")}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {HP_CATEGORIES.filter(cat => favorites.some(f => (f.category || "Other") === cat)).map(cat => {
              const count = favorites.filter(f => (f.category || "Other") === cat).length;
              return colRow(`${cat}`, selCategory === cat, () => { setSelCategory(selCategory === cat ? null : cat); setSelFav(null); }, `${count} style${count !== 1 ? "s" : ""}`);
            })}
          </div>
        </div>
        {/* Favorites column */}
        <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {colHead("Favorites")}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {(()=>{
              const filtered = selCategory ? favorites.filter(f => (f.category || "Other") === selCategory) : favorites;
              return filtered.length === 0 ? (
              <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>{selCategory ? "No favorites in this category" : "No favorites yet — star styles in S&S, AS Colour, or LA Apparel"}</div>
            ) : filtered.map(fav => (
              <div key={`${fav.supplier}-${fav.style_code}`} style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${T.border}` }}>
                <div onClick={() => loadFav(fav)} style={{ flex: 1, padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: selFav?.style_code === fav.style_code && selFav?.supplier === fav.supplier ? T.accent : "transparent", color: selFav?.style_code === fav.style_code && selFav?.supplier === fav.supplier ? "#0a0a0a" : T.text, transition: "background 0.1s" }}
                  onMouseEnter={e => { if (!(selFav?.style_code === fav.style_code && selFav?.supplier === fav.supplier)) e.currentTarget.style.background = T.surface; }}
                  onMouseLeave={e => { if (!(selFav?.style_code === fav.style_code && selFav?.supplier === fav.supplier)) e.currentTarget.style.background = "transparent"; }}>
                  {fav.style_name}
                  <div style={{ fontSize: 9, color: selFav?.style_code === fav.style_code && selFav?.supplier === fav.supplier ? "rgba(255,255,255,0.7)" : T.faint, marginTop: 1 }}>{supplierLabel[fav.supplier] || fav.supplier}</div>
                </div>
                <select value={fav.category || "Other"} onClick={e => e.stopPropagation()} onChange={async e => {
                  const newCat = e.target.value;
                  await createClient().from("favorites").update({ category: newCat }).eq("id", fav.id);
                  setFavorites(prev => prev.map(f => f.id === fav.id ? { ...f, category: newCat } : f));
                }} style={{ fontSize: 8, padding: "1px 2px", border: `1px solid ${T.border}`, borderRadius: 3, background: T.surface, color: T.faint, outline: "none", cursor: "pointer", flexShrink: 0, marginRight: 2 }}>
                  {HP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={() => toggleFav(fav.supplier, fav.style_code, fav.style_name)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 8px", fontSize: 14, color: T.amber, flexShrink: 0 }}>★</button>
              </div>
            ));
            })()}
          </div>
        </div>
        <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {colHead("Color")}
          {selFav && <div style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}><input value={colorSearch} onChange={e => setColorSearch(e.target.value)} placeholder="Search colors..." style={{ width: "100%", fontFamily: font, fontSize: 11, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "4px 8px", outline: "none", boxSizing: "border-box" }} /></div>}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>Loading...</div>
              : !selFav ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>← Select a favorite</div>
              : <>
                {colorNames.filter(c => !colorSearch.trim() || c.toLowerCase().includes(colorSearch.toLowerCase())).map(c => {
                  const stock = (colorGroups[c] || []).reduce((a, v) => a + (inventory[v.sku] || 0), 0);
                  return colRow(c, selColor === c, () => { setSelColor(c); setSelSizes({}); }, stock > 0 ? `${stock.toLocaleString()} avail` : undefined);
                })}
                {selFav?.supplier === "laapparel" && (
                  <div style={{ padding: "6px 8px", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input value={newColor} onChange={e => setNewColor(e.target.value)} onKeyDown={e => e.key === "Enter" && addLAColor()}
                        placeholder="Add color..." style={{ flex: 1, padding: "4px 8px", fontSize: 10, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, outline: "none", fontFamily: font }} />
                      <button onClick={addLAColor} disabled={!newColor.trim()}
                        style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, border: "none", background: newColor.trim() ? T.accent : T.surface, color: newColor.trim() ? "#0a0a0a" : T.faint, cursor: newColor.trim() ? "pointer" : "default" }}>+</button>
                    </div>
                  </div>
                )}
              </>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {colHead("Sizes")}
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {!selColor ? <div style={{ padding: "6px 2px", fontSize: 10, color: T.faint, fontFamily: font }}>← Color</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {sortSizes(currentColorVariants.map(v => v.sizeCode)).map(sz => {
                  const on = selSizes[sz] !== undefined;
                  const variant = currentColorVariants.find(v => v.sizeCode === sz);
                  const price = variant ? (pricing[variant.sku] || variant.price || 0) : 0;
                  const stock = variant ? (inventory[variant.sku] || 0) : 0;
                  return (
                    <div key={sz} onClick={(e) => toggleSz(sz, e)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.surface, transition: "all 0.12s", userSelect: "none" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#0a0a0a" : T.muted, fontFamily: mono }}>{sz}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 9, color: on ? "rgba(0,0,0,0.45)" : stock > 100 ? T.green : stock > 0 ? T.amber : T.red, fontFamily: mono }}>{stock.toLocaleString()}</span>
                        {price > 0 && <span style={{ fontSize: 10, color: on ? "rgba(0,0,0,0.6)" : T.muted }}>${Number(price).toFixed(2)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            }
          </div>
          {selColor && Object.keys(selSizes).length > 0 && (
            <div style={{ padding: "5px 10px", borderTop: `1px solid ${T.border}`, fontSize: 10, fontFamily: font, color: T.muted }}>
              {Object.keys(selSizes).length} size{Object.keys(selSizes).length !== 1 ? "s" : ""} selected
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Other / Custom Blank Picker ──────────────────────────────────────────────

export function OtherPicker({ onAdd, onClose, assignMode, defaultItemName }) {
  const [colorSearch, setColorSearch] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selBrand, setSelBrand] = useState(null);
  const [selStyle, setSelStyle] = useState(null);
  const [selColor, setSelColor] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [itemName, setItemName] = useState(defaultItemName || "");
  const [search, setSearch] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const lastClickedSize = useRef(null);

  // New entry form state
  const [newBrand, setNewBrand] = useState("");
  const [newStyle, setNewStyle] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newSizes, setNewSizes] = useState({});
  const [newPrices, setNewPrices] = useState({});
  const newLastClickedSize = useRef(null);

  // Edit-existing-entry state (inline catalog edit: cost + brand/style/color).
  // editId = the blank_catalog row being edited; null when not editing.
  const [editId, setEditId] = useState(null);
  const [editBrand, setEditBrand] = useState("");
  const [editStyle, setEditStyle] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editCosts, setEditCosts] = useState({});

  useEffect(() => { loadCatalog(); }, []);
  async function loadCatalog() {
    const supabase = createClient();
    const { data } = await supabase.from("blank_catalog").select("*").order("brand").order("style");
    setCatalog(data || []);
    setLoading(false);
  }

  const brands = [...new Set(catalog.map(c => c.brand))].sort();
  const styles = selBrand ? [...new Set(catalog.filter(c => c.brand === selBrand).map(c => c.style))].sort() : [];
  const colors = selStyle ? catalog.filter(c => c.brand === selBrand && c.style === selStyle) : [];
  const currentEntry = selColor ? catalog.find(c => c.id === selColor) : null;

  const filteredBrands = search.trim()
    ? brands.filter(b => b.toLowerCase().includes(search.toLowerCase()) || catalog.some(c => c.brand === b && c.style.toLowerCase().includes(search.toLowerCase())))
    : brands;

  const toggleSz = (sz, e) => handleSizeToggle(sz, e, currentEntry?.sizes || [], setSelSizes, lastClickedSize);
  const canAdd = currentEntry && Object.keys(selSizes).length > 0;

  function doAdd() {
    if (!currentEntry) return;
    const allSizes = sortSizes(Object.keys(selSizes));
    const qtys = {}; allSizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = {}; allSizes.forEach(sz => { blankCosts[sz] = currentEntry.costs?.[sz] || 0; });
    const fullName = itemName.trim() || `${currentEntry.brand} ${currentEntry.style} - ${currentEntry.color}`;
    onAdd({
      id: Date.now() + Math.random(),
      name: fullName,
      blank_vendor: `${currentEntry.brand} ${currentEntry.style}`,
      blank_sku: currentEntry.color,
      style: `${currentEntry.brand} ${currentEntry.style}`,
      color: currentEntry.color,
      garment_type: detectGarmentType("", fullName),
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  }

  async function saveNewEntry() {
    if (!newBrand.trim() || !newStyle.trim() || !newColor.trim() || Object.keys(newSizes).length === 0) return;
    const supabase = createClient();
    const sizes = sortSizes(Object.keys(newSizes));
    const costs = {}; sizes.forEach(sz => { costs[sz] = parseFloat(newPrices[sz]) || 0; });
    await supabase.from("blank_catalog").insert({ brand: newBrand.trim(), style: newStyle.trim(), color: newColor.trim(), sizes, costs });
    setNewBrand(""); setNewStyle(""); setNewColor(""); setNewSizes({}); setNewPrices({});
    setShowNewForm(false);
    loadCatalog();
  }

  async function deleteEntry(id) {
    const supabase = createClient();
    await supabase.from("blank_catalog").delete().eq("id", id);
    setConfirmDelete(null);
    if (selColor === id) { setSelColor(null); setSelSizes({}); }
    loadCatalog();
  }

  // Open the inline editor for an existing catalog entry, pre-filled.
  function startEdit(entry) {
    setShowNewForm(false);
    setEditId(entry.id);
    setEditBrand(entry.brand || "");
    setEditStyle(entry.style || "");
    setEditColor(entry.color || "");
    const costs = {};
    sortSizes(entry.sizes || []).forEach(sz => { costs[sz] = entry.costs?.[sz] != null ? String(entry.costs[sz]) : ""; });
    setEditCosts(costs);
  }

  function cancelEdit() { setEditId(null); }

  // Persist edits to blank_catalog. Permanent — affects future projects that
  // pick this blank. Existing job items keep their own items.blank_costs (a
  // per-job snapshot), so nothing already in production changes. Sizes stay
  // as-is; only costs + brand/style/color are editable here.
  async function saveEdit() {
    if (!editId || !editBrand.trim() || !editStyle.trim() || !editColor.trim()) return;
    const supabase = createClient();
    const costs = {};
    Object.keys(editCosts).forEach(sz => { costs[sz] = parseFloat(editCosts[sz]) || 0; });
    await supabase.from("blank_catalog").update({ brand: editBrand.trim(), style: editStyle.trim(), color: editColor.trim(), costs }).eq("id", editId);
    // Follow the entry if its brand/style was renamed so the drill-down
    // doesn't land on an empty column after reload.
    setSelBrand(editBrand.trim());
    setSelStyle(editStyle.trim());
    setEditId(null);
    loadCatalog();
  }

  const colRow = (label, active, onClick, sub, onDelete, onEdit) => (
    <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${T.border}` }}>
      <div onClick={onClick} style={{ flex: 1, padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#0a0a0a" : T.text, transition: "background 0.1s" }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
        {label}
        {sub && <div style={{ fontSize: 9, color: active ? "rgba(0,0,0,0.6)" : T.faint, marginTop: 1 }}>{sub}</div>}
      </div>
      {onEdit && <button onClick={e => { e.stopPropagation(); onEdit(); }} title="Edit cost / details"
        style={{ background: "none", border: "none", color: active ? "rgba(0,0,0,0.6)" : T.faint, cursor: "pointer", fontSize: 11, padding: "4px 6px", flexShrink: 0 }}
        onMouseEnter={e => (e.currentTarget.style.color = T.accent)} onMouseLeave={e => (e.currentTarget.style.color = active ? "rgba(0,0,0,0.6)" : T.faint)}>✎</button>}
      {onDelete && <button onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 10, padding: "4px 8px", flexShrink: 0 }}
        onMouseEnter={e => (e.currentTarget.style.color = T.red)} onMouseLeave={e => (e.currentTarget.style.color = T.faint)}>✕</button>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding: "5px 11px", background: T.surface, borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: font }}>{title}</div>
  );

  const ic = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" };

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font, whiteSpace: "nowrap" }}>Other</span>
        <button onClick={() => { setEditId(null); setShowNewForm(!showNewForm); }} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>+ New</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search styles..." autoFocus style={{ flex: 1, fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none" }} />
        <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 180 }} />
        <button onClick={doAdd} disabled={!canAdd} style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#0a0a0a" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default" }}>{assignMode ? "Assign to item →" : "Add to buy sheet →"}</button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>

      {/* New entry form */}
      {showNewForm && (
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div><label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Brand</label><input value={newBrand} onChange={e => setNewBrand(e.target.value)} style={ic} /></div>
            <div><label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Style</label><input value={newStyle} onChange={e => setNewStyle(e.target.value)} style={ic} /></div>
            <div><label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Color</label><input value={newColor} onChange={e => setNewColor(e.target.value)} style={ic} /></div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 4 }}>Sizes</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {["XS","S","M","L","XL","2XL","3XL","4XL","5XL","OS"].map(sz => {
                const on = newSizes[sz] !== undefined;
                return <button key={sz} onClick={e => handleSizeToggle(sz, e, ["XS","S","M","L","XL","2XL","3XL","4XL","5XL","OS"], setNewSizes, newLastClickedSize)}
                  style={{ padding: "4px 8px", borderRadius: 4, border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accentDim : "transparent", color: on ? T.accent : T.faint, fontSize: 10, fontFamily: mono, cursor: "pointer" }}>{sz}</button>;
              })}
            </div>
          </div>
          {Object.keys(newSizes).length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {sortSizes(Object.keys(newSizes)).map(sz => (
                <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: T.muted, fontFamily: mono }}>{sz}</span>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: T.faint, marginRight: 1 }}>$</span>
                    <input type="text" inputMode="decimal" value={newPrices[sz] || ""} onChange={e => setNewPrices(p => ({...p, [sz]: e.target.value}))} onFocus={e => e.target.select()}
                      style={{ width: 44, textAlign: "center", padding: "3px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 10, outline: "none", fontFamily: mono }} />
                  </div>
                </div>
              ))}
              {Object.keys(newSizes).length > 1 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: T.accent, fontFamily: mono }}>ALL</span>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: T.faint, marginRight: 1 }}>$</span>
                    <input type="text" inputMode="decimal" onChange={e => { const v = e.target.value; setNewPrices(Object.fromEntries(sortSizes(Object.keys(newSizes)).map(sz => [sz, v]))); }} onFocus={e => e.target.select()}
                      style={{ width: 44, textAlign: "center", padding: "3px", borderRadius: 4, border: `1px solid ${T.accent}44`, background: T.accentDim, color: T.accent, fontSize: 10, outline: "none", fontFamily: mono }} />
                  </div>
                </div>
              )}
            </div>
          )}
          <button onClick={saveNewEntry} disabled={!newBrand.trim() || !newStyle.trim() || !newColor.trim() || Object.keys(newSizes).length === 0}
            style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: newBrand.trim() && newStyle.trim() && newColor.trim() && Object.keys(newSizes).length > 0 ? T.green : T.surface, color: newBrand.trim() && newStyle.trim() ? "#fff" : T.faint, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
            Save to Catalog
          </button>
        </div>
      )}

      {/* Edit existing entry — inline catalog edit (cost + brand/style/color).
          Sizes stay fixed; only their per-size costs are editable here. */}
      {editId && (
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, fontFamily: font, letterSpacing: "0.04em", textTransform: "uppercase" }}>Edit catalog entry</span>
            <button onClick={cancelEdit} style={{ background: "none", border: "none", color: T.muted, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div><label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Brand</label><input value={editBrand} onChange={e => setEditBrand(e.target.value)} style={ic} /></div>
            <div><label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Style</label><input value={editStyle} onChange={e => setEditStyle(e.target.value)} style={ic} /></div>
            <div><label style={{ fontSize: 9, color: T.muted, display: "block", marginBottom: 2 }}>Color</label><input value={editColor} onChange={e => setEditColor(e.target.value)} style={ic} /></div>
          </div>
          {Object.keys(editCosts).length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {sortSizes(Object.keys(editCosts)).map(sz => (
                <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: T.muted, fontFamily: mono }}>{sz}</span>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: T.faint, marginRight: 1 }}>$</span>
                    <input type="text" inputMode="decimal" value={editCosts[sz] || ""} onChange={e => setEditCosts(p => ({...p, [sz]: e.target.value}))} onFocus={e => e.target.select()}
                      style={{ width: 44, textAlign: "center", padding: "3px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 10, outline: "none", fontFamily: mono }} />
                  </div>
                </div>
              ))}
              {Object.keys(editCosts).length > 1 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: T.accent, fontFamily: mono }}>ALL</span>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: T.faint, marginRight: 1 }}>$</span>
                    <input type="text" inputMode="decimal" onChange={e => { const v = e.target.value; setEditCosts(Object.fromEntries(Object.keys(editCosts).map(sz => [sz, v]))); }} onFocus={e => e.target.select()}
                      style={{ width: 44, textAlign: "center", padding: "3px", borderRadius: 4, border: `1px solid ${T.accent}44`, background: T.accentDim, color: T.accent, fontSize: 10, outline: "none", fontFamily: mono }} />
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveEdit} disabled={!editBrand.trim() || !editStyle.trim() || !editColor.trim()}
              style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: editBrand.trim() && editStyle.trim() && editColor.trim() ? T.green : T.surface, color: editBrand.trim() && editStyle.trim() && editColor.trim() ? "#fff" : T.faint, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
              Save Changes
            </button>
            <button onClick={cancelEdit} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 11, cursor: "pointer", fontFamily: font }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.muted }}>Loading catalog...</div>
      ) : catalog.length === 0 && !showNewForm ? (
        <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.faint }}>No custom items yet — click "+ New" to add one.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", height: 300 }}>
          {/* Brand */}
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Brand")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {filteredBrands.map(b => colRow(b, selBrand === b, () => { setSelBrand(selBrand === b ? null : b); setSelStyle(null); setSelColor(null); setSelSizes({}); }))}
            </div>
          </div>
          {/* Style */}
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Style")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {!selBrand ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint }}>← Brand</div>
                : styles.map(s => colRow(s, selStyle === s, () => { setSelStyle(selStyle === s ? null : s); setSelColor(null); setSelSizes({}); }))}
            </div>
          </div>
          {/* Color */}
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Color")}
            {selStyle && <div style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}><input value={colorSearch} onChange={e => setColorSearch(e.target.value)} placeholder="Search colors..." style={{ width: "100%", fontFamily: font, fontSize: 11, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "4px 8px", outline: "none", boxSizing: "border-box" }} /></div>}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {!selStyle ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint }}>← Style</div>
                : colors.filter(c => !colorSearch.trim() || c.color.toLowerCase().includes(colorSearch.toLowerCase())).map(c => colRow(c.color, selColor === c.id, () => { setSelColor(c.id); setSelSizes({}); },
                  `${c.sizes?.length || 0} sizes · $${Object.values(c.costs || {}).filter(v => v > 0)[0]?.toFixed(2) || "—"}`,
                  () => setConfirmDelete(c), () => startEdit(c)))}
            </div>
          </div>
          {/* Sizes */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Sizes")}
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {!currentEntry ? <div style={{ padding: "6px 2px", fontSize: 10, color: T.faint, fontFamily: font }}>← Color</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {sortSizes(currentEntry.sizes || []).map(sz => {
                    const on = selSizes[sz] !== undefined;
                    const price = currentEntry.costs?.[sz] || 0;
                    return (
                      <div key={sz} onClick={e => toggleSz(sz, e)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.surface, transition: "all 0.12s", userSelect: "none" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#0a0a0a" : T.muted, fontFamily: mono }}>{sz}</span>
                        {price > 0 && <span style={{ fontSize: 10, color: on ? "rgba(0,0,0,0.6)" : T.muted }}>${price.toFixed(2)}</span>}
                      </div>
                    );
                  })}
                </div>
              }
            </div>
            {selColor && Object.keys(selSizes).length > 0 && (
              <div style={{ padding: "5px 10px", borderTop: `1px solid ${T.border}`, fontSize: 10, fontFamily: font, color: T.muted }}>
                {Object.keys(selSizes).length} size{Object.keys(selSizes).length !== 1 ? "s" : ""} selected
              </div>
            )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setConfirmDelete(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 20, width: 340 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 8 }}>Delete "{confirmDelete.brand} {confirmDelete.style} - {confirmDelete.color}"?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => deleteEntry(confirmDelete.id)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: T.red, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// (The BuySheetTab component itself was removed 2026-07-17 — dead since the
// Product Builder merge. This file now only exports the live pickers +
// size/curve helpers ProductBuilder imports. Full component in git history.)

// ── Cotton Collective Picker ──────────────────────────────────────────────────

export function CottonCollectivePicker({ onAdd, onClose, assignMode, defaultItemName }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selCategory, setSelCategory] = useState(null);
  const [selStyle, setSelStyle] = useState(null);
  const [selColor, setSelColor] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [itemName, setItemName] = useState(defaultItemName || "");
  const [colorSearch, setColorSearch] = useState("");

  useEffect(() => {
    fetch("/api/cottoncollective?action=products")
      .then(r => r.json())
      .then(d => { setProducts(d.products || []); setCategories(d.categories || {}); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = (() => {
    let list = products;
    if (selCategory) list = list.filter(p => p.category === selCategory);
    if (search.trim()) list = list.filter(p => (p.name + " " + p.typeLabel + " " + p.sku).toLowerCase().includes(search.toLowerCase()));
    return list;
  })();

  const colors = selStyle ? selStyle.colors : [];
  const selColorData = selColor ? colors.find(c => c.color === selColor) : null;

  const lastClickedSize = useRef(null);
  const availSizes = selColorData ? selColorData.sizes : [];
  const toggleSz = (sz, e) => handleSizeToggle(sz, e, availSizes, setSelSizes, lastClickedSize);

  const canAdd = selStyle && selColor && Object.keys(selSizes).length > 0;

  const doAdd = () => {
    if (!canAdd) return;
    const allSizes = sortSizes(Object.keys(selSizes));
    const qtys = {}; allSizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = {};
    allSizes.forEach(sz => {
      if (selColorData?.prices?.[sz]) blankCosts[sz] = selColorData.prices[sz];
    });
    const itemFullName = itemName.trim() || `Cotton Collective ${selStyle.typeLabel} - ${selColor}`;
    onAdd({
      id: Date.now() + Math.random(),
      name: itemFullName,
      blank_vendor: `Cotton Collective ${selStyle.sku}`,
      blank_sku: selColor,
      style: `Cotton Collective ${selStyle.sku}`,
      color: selColor,
      garment_type: detectGarmentType(selStyle.category || "", itemFullName + " " + (selStyle.typeLabel || "")),
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  };

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#0a0a0a" : T.text, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {label}
      {sub && <div style={{ fontSize: 9, color: active ? "rgba(0,0,0,0.6)" : T.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const colHead = (label) => (
    <div style={{ padding: "6px 11px", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", background: T.surface, borderBottom: `1px solid ${T.border}`, fontFamily: font }}>{label}</div>
  );

  const CAT_ORDER = ["Tees", "Crewnecks", "Hoodies", "Crops", "Tanks", "Bottoms", "Thermals", "Socks", "Raw", "Other"];

  return (
    <div style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.border}`, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "80vh" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font, whiteSpace: "nowrap" }}>Cotton Collective</span>
        <input value={search} onChange={e => { setSearch(e.target.value); setSelStyle(null); setSelColor(null); setSelSizes({}); }}
          placeholder="Search styles..." autoFocus
          style={{ flex: 1, fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none" }} />
        <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item display name"
          style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 180 }} />
        <button onClick={doAdd} disabled={!canAdd}
          style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#0a0a0a" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default", transition: "all 0.15s" }}>
          {assignMode ? "Assign to item →" : "Add to buy sheet →"}
        </button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>Loading Cotton Collective catalog...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1fr 1fr 1fr", height: 300, overflow: "hidden" }}>
          {/* Categories column */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Categories")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {colRow(<><span style={{ fontWeight: 600 }}>All</span><span style={{ color: T.faint, marginLeft: 4 }}>({products.length})</span></>, !selCategory, () => { setSelCategory(null); setSelStyle(null); setSelColor(null); setSelSizes({}); })}
              {CAT_ORDER.filter(cat => categories[cat]).map(cat =>
                colRow(<><span style={{ fontWeight: 600 }}>{cat}</span><span style={{ color: selCategory === cat ? "rgba(255,255,255,0.7)" : T.faint, marginLeft: 4 }}>({categories[cat]})</span></>, selCategory === cat, () => { setSelCategory(cat); setSelStyle(null); setSelColor(null); setSelSizes({}); })
              )}
            </div>
          </div>

          {/* Styles column */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead(`Styles (${filtered.length})`)}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {filtered.length === 0 && <div style={{ padding: 14, fontSize: 11, color: T.faint }}>No styles found</div>}
              {filtered.map(p => colRow(
                p.typeLabel || p.name,
                selStyle?.sku === p.sku,
                () => { setSelStyle(p); setSelColor(null); setSelSizes({}); setColorSearch(""); },
                p.sku
              ))}
            </div>
          </div>

          {/* Colors column */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Colors")}
            {selStyle && (
              <div style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}>
                <input value={colorSearch} onChange={e => setColorSearch(e.target.value)} placeholder="Search colors..."
                  style={{ width: "100%", fontFamily: font, fontSize: 11, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "4px 8px", outline: "none", boxSizing: "border-box" }} />
              </div>
            )}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {!selStyle ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>← Style</div>
                : colors.filter(c => !colorSearch.trim() || c.color.toLowerCase().includes(colorSearch.toLowerCase())).map(c => colRow(c.color, selColor === c.color, () => { setSelColor(c.color); setSelSizes({}); }))}
            </div>
          </div>

          {/* Sizes column — pill style matching SSPicker */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Sizes")}
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {!selColorData ? <div style={{ padding: "6px 2px", fontSize: 10, color: T.faint, fontFamily: font }}>← Color</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {selColorData.sizes.map(sz => {
                      const on = selSizes[sz] !== undefined;
                      const price = selColorData.prices[sz] || 0;
                      return (
                        <div key={sz} onClick={(e) => toggleSz(sz, e)}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.surface, transition: "all 0.12s", userSelect: "none" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#0a0a0a" : T.muted, fontFamily: mono }}>{sz}</span>
                          <span style={{ fontSize: 10, color: on ? "rgba(0,0,0,0.6)" : T.muted }}>${price.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
            {selColor && Object.keys(selSizes).length > 0 && (
              <div style={{ padding: "5px 10px", borderTop: `1px solid ${T.border}`, fontSize: 10, fontFamily: font, color: T.muted }}>
                {Object.keys(selSizes).length} size{Object.keys(selSizes).length !== 1 ? "s" : ""} selected · Shift+click for range
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
