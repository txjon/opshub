"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
const DEFAULT_CURVE = {S:5.13,M:20.57,L:38.14,XL:25.90,"2XL":7.69,"3XL":2.56};

// Shift-click range selection for size pickers
function handleSizeToggle(sz, e, availableSizes, setSelSizes, lastClickedRef) {
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

function distribute(total, sizes, curve) {
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

function SSPicker({ onAdd, onClose, isFav, toggleFav }) {
  const [query, setQuery] = useState("");
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
  const [itemName, setItemName] = useState("");
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

  const searchByQuery = async () => {
    if (!query.trim()) return;
    setSelBrand(null); setStyles([]); setSelStyle(null); setProducts([]); setSelColor(null); setLoading(true);
    try {
      const res = await fetch(`/api/ss?endpoint=search&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      const results = Array.isArray(data) ? data : [];
      setStyles(results);
      setFilteredBrands([...new Set(results.map(s => s.brandName))].sort());
    } catch { setStyles([]); setFilteredBrands(null); }
    finally { setLoading(false); }
  };

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
    onAdd({
      id: Date.now() + Math.random(),
      name: itemName.trim() || `${selStyle.brandName} ${selStyle.styleName} - ${selColor}`,
      blank_vendor: `${selStyle.brandName} ${selStyle.styleName}`,
      blank_sku: selColor,
      style: `${selStyle.brandName} ${selStyle.styleName}`,
      color: selColor,
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  };

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding:"8px 11px", cursor:"pointer", fontSize:11, fontFamily:font, background:active?T.accent:"transparent", color:active?"#fff":T.text, borderBottom:`1px solid ${T.border}`, transition:"background 0.1s" }}
      onMouseEnter={e => { if(!active) e.currentTarget.style.background=T.surface; }}
      onMouseLeave={e => { if(!active) e.currentTarget.style.background="transparent"; }}>
      {label}
      {sub && <div style={{ fontSize:9, color:active?"rgba(255,255,255,0.7)":T.faint, marginTop:1 }}>{sub}</div>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding:"5px 11px", background:T.surface, borderBottom:`1px solid ${T.border}`, fontSize:9, fontWeight:700, color:T.muted, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:font }}>{title}</div>
  );

  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden", marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", borderBottom:`1px solid ${T.border}` }}>
        <span style={{ fontSize:12, fontWeight:700, color:T.text, fontFamily:font }}>Browse S&amp;S Catalog</span>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key==="Enter" && searchByQuery()} placeholder="Search style # or keyword..." style={{ fontFamily:font, fontSize:12, color:T.text, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 10px", outline:"none", width:200 }} />
          <button onClick={searchByQuery} disabled={loading} style={{ background:T.accent, color:"#fff", border:"none", borderRadius:6, padding:"5px 12px", fontSize:12, fontFamily:font, fontWeight:600, cursor:"pointer", opacity:loading?0.6:1 }}>{loading?"…":"Search"}</button>
          <input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily:font, fontSize:12, color:T.text, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 10px", outline:"none", width:180 }} />
          <button onClick={doAdd} disabled={!canAdd} style={{ background:canAdd?T.accent:T.surface, color:canAdd?"#fff":T.muted, border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontFamily:font, fontWeight:600, cursor:canAdd?"pointer":"default", transition:"all 0.15s" }}>Add to buy sheet →</button>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>
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
                  <div onClick={() => loadProducts(s)} style={{ flex:1, padding:"8px 11px", cursor:"pointer", fontSize:11, fontFamily:font, background:selStyle?.styleID===s.styleID?T.accent:"transparent", color:selStyle?.styleID===s.styleID?"#fff":T.text, transition:"background 0.1s" }}
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
          <div style={{ flex:1, overflowY:"auto" }}>
            {loadingProducts ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>Loading…</div>
              : !selStyle ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>← Style</div>
              : colorNames.map(c => {
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
                        <span style={{ fontSize:12, fontWeight:700, color:on?"#fff":T.muted, fontFamily:mono }}>{sz}</span>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:9, color:on?"rgba(255,255,255,0.5)":sizeStock>100?T.green:sizeStock>0?T.amber:T.red, fontFamily:mono }}>{sizeStock.toLocaleString()}</span>
                          <span style={{ fontSize:10, color:on?"rgba(255,255,255,0.7)":T.muted }}>${Number(currentColor.prices[sz]||0).toFixed(2)}</span>
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

function ASColourPicker({ onAdd, onClose, isFav, toggleFav }) {
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
  const [itemName, setItemName] = useState("");
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
    onAdd({
      id: Date.now() + Math.random(),
      name: itemName.trim() || `AS Colour ${selStyle.styleCode} - ${selColor}`,
      blank_vendor: `AS Colour ${selStyle.styleCode}`,
      blank_sku: selColor,
      style: `AS Colour ${selStyle.styleCode}`,
      color: selColor,
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  };

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#fff" : T.text, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {label}
      {sub && <div style={{ fontSize: 9, color: active ? "rgba(255,255,255,0.7)" : T.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding: "5px 11px", background: T.surface, borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: font }}>{title}</div>
  );

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font }}>Browse AS Colour</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search style # or name..." style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 200 }} />
          <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 180 }} />
          <button onClick={doAdd} disabled={!canAdd} style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#fff" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default", transition: "all 0.15s" }}>Add to buy sheet →</button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
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
                  <div onClick={() => loadVariants(p)} style={{ flex:1, padding:"8px 11px", cursor:"pointer", fontSize:11, fontFamily:font, background:selStyle?.styleCode===p.styleCode?T.accent:"transparent", color:selStyle?.styleCode===p.styleCode?"#fff":T.text, transition:"background 0.1s" }}
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
            <div style={{ flex: 1, overflowY: "auto" }}>
              {loadingVariants ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>Loading...</div>
                : !selStyle ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>← Style</div>
                : colorNames.map(c => {
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
                        <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#fff" : T.muted, fontFamily: mono }}>{sz}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 9, color: on ? "rgba(255,255,255,0.5)" : stock > 100 ? T.green : stock > 0 ? T.amber : T.red, fontFamily: mono }}>{stock.toLocaleString()}</span>
                          {price > 0 && <span style={{ fontSize: 10, color: on ? "rgba(255,255,255,0.7)" : T.muted }}>${price.toFixed(2)}</span>}
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
function LAApparelPicker({ onAdd, onClose, isFav, toggleFav }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selCategory, setSelCategory] = useState(null);
  const [selStyle, setSelStyle] = useState(null);
  const [variants, setVariants] = useState([]);
  const [selColorType, setSelColorType] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [itemName, setItemName] = useState("");
  const [newColor, setNewColor] = useState("");
  const [search, setSearch] = useState("");
  const lastClickedSize = useRef(null);

  useEffect(() => {
    fetch("/api/laapparel?endpoint=products").then(r => r.json()).then(data => {
      setProducts(Array.isArray(data) ? data : []);
      setLoading(false);
    });
  }, []);

  const categories = [...new Set(products.map(p => p.category))].sort();
  const filteredProducts = products.filter(p => {
    if (search.trim()) return p.styleCode.includes(search) || p.description.toLowerCase().includes(search.toLowerCase());
    if (selCategory) return p.category === selCategory;
    return true;
  });

  async function loadStyle(product) {
    setSelStyle(product); setSelColorType(null); setSelSizes({}); setVariants([]);
    const res = await fetch(`/api/laapparel?endpoint=variants&styleCode=${product.styleCode}`);
    const data = await res.json();
    setVariants(Array.isArray(data) ? data : []);
  }

  // Group variants by color_type
  const colorTypes = [...new Set(variants.map(v => v.color_type))];
  // Also include any custom colors added to the style
  const customColors = selStyle?.colors || [];
  const allColorOptions = [...colorTypes, ...customColors.filter(c => !colorTypes.includes(c))];

  // Get size rows for selected color type
  const sizeRows = selColorType ? variants.filter(v => v.color_type === selColorType || (v.color_type === "Colors" && !["White"].includes(selColorType) && !colorTypes.includes(selColorType))) : [];
  // If custom color selected, use "Colors" pricing
  const effectiveRows = sizeRows.length > 0 ? sizeRows : variants.filter(v => v.color_type === "Colors");

  // Expand size ranges into individual sizes
  const expandSizes = (sizeStr) => {
    if (!sizeStr) return [];
    const s = sizeStr.trim();
    // Handle ranges like S-XL, XS-3XL
    const rangeMatch = s.match(/^(\w+)\s*-\s*(\w+)$/);
    if (rangeMatch) {
      const SIZE_ORDER = ["3-6M","6-12M","12-18M","18-24M","2T","3T","4T","5T","6T","OSFA","OS","XXS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
      const start = SIZE_ORDER.indexOf(rangeMatch[1]);
      const end = SIZE_ORDER.indexOf(rangeMatch[2]);
      if (start >= 0 && end >= 0 && end >= start) return SIZE_ORDER.slice(start, end + 1);
    }
    // Handle comma-separated or single sizes
    return s.split(",").map(x => x.trim()).filter(Boolean);
  };

  const laAvailSizes = effectiveRows.flatMap(r => expandSizes(r.sizes)).filter((s,i,a) => a.indexOf(s) === i);
  const toggleSz = (sz, e) => handleSizeToggle(sz, e, laAvailSizes, setSelSizes, lastClickedSize);
  const canAdd = selStyle && selColorType && Object.keys(selSizes).length > 0;

  const doAdd = () => {
    if (!canAdd) return;
    const allSizes = sortSizes(Object.keys(selSizes));
    const qtys = {}; allSizes.forEach(sz => { qtys[sz] = 0; });
    // Find case price — use matching row's price for each size
    const blankCosts = {};
    for (const sz of allSizes) {
      const row = effectiveRows.find(r => expandSizes(r.sizes).includes(sz));
      if (row) blankCosts[sz] = row.case_price;
    }
    const colorLabel = selColorType === "White" ? "White" : selColorType === "Colors" ? "Colors" : selColorType;
    onAdd({
      id: Date.now() + Math.random(),
      name: itemName.trim() || `LA Apparel ${selStyle.styleCode} - ${colorLabel}`,
      blank_vendor: `LA Apparel ${selStyle.styleCode}`,
      blank_sku: colorLabel,
      style: `LA Apparel ${selStyle.styleCode}`,
      color: colorLabel,
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColorType(null); setSelSizes({});
  };

  async function addColor() {
    if (!newColor.trim() || !selStyle) return;
    await fetch(`/api/laapparel?endpoint=add_color&styleCode=${selStyle.styleCode}&color=${encodeURIComponent(newColor.trim())}`);
    setProducts(prev => prev.map(p => p.styleCode === selStyle.styleCode ? { ...p, colors: [...(p.colors || []), newColor.trim()] } : p));
    setSelStyle(prev => prev ? { ...prev, colors: [...(prev.colors || []), newColor.trim()] } : prev);
    setNewColor("");
  }

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#fff" : T.text, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {label}
      {sub && <div style={{ fontSize: 9, color: active ? "rgba(255,255,255,0.7)" : T.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding: "5px 11px", background: T.surface, borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: font }}>{title}</div>
  );

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font }}>Browse LA Apparel</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search style # or name..." style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 180 }} />
          <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 160 }} />
          <button onClick={doAdd} disabled={!canAdd} style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#fff" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default" }}>Add to buy sheet →</button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
      </div>
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: T.muted }}>Loading LA Apparel catalog...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 1fr 1fr", height: 300 }}>
          {/* Category */}
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Category")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {categories.map(cat => colRow(cat, selCategory === cat, () => { setSelCategory(selCategory === cat ? null : cat); setSelStyle(null); setSelColorType(null); setSelSizes({}); }))}
            </div>
          </div>
          {/* Style */}
          <div style={{ borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Style")}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {filteredProducts.map(p => (
                <div key={p.styleCode} style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${T.border}` }}>
                  <div onClick={() => loadStyle(p)} style={{ flex: 1, padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: selStyle?.styleCode === p.styleCode ? T.accent : "transparent", color: selStyle?.styleCode === p.styleCode ? "#fff" : T.text, transition: "background 0.1s" }}
                    onMouseEnter={e => { if (selStyle?.styleCode !== p.styleCode) e.currentTarget.style.background = T.surface; }}
                    onMouseLeave={e => { if (selStyle?.styleCode !== p.styleCode) e.currentTarget.style.background = "transparent"; }}>
                    {p.styleCode}
                    <div style={{ fontSize: 9, color: selStyle?.styleCode === p.styleCode ? "rgba(255,255,255,0.7)" : T.faint, marginTop: 1 }}>{p.description}</div>
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
            <div style={{ flex: 1, overflowY: "auto" }}>
              {!selStyle ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint }}>← Style</div>
                : <>
                  {allColorOptions.map(c => colRow(c, selColorType === c, () => { setSelColorType(c); setSelSizes({}); }))}
                  <div style={{ padding: "6px 8px", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input value={newColor} onChange={e => setNewColor(e.target.value)} onKeyDown={e => e.key === "Enter" && addColor()}
                        placeholder="Add color..." style={{ flex: 1, padding: "4px 8px", fontSize: 10, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, outline: "none", fontFamily: font }} />
                      <button onClick={addColor} disabled={!newColor.trim()}
                        style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, border: "none", background: newColor.trim() ? T.accent : T.surface, color: newColor.trim() ? "#fff" : T.faint, cursor: newColor.trim() ? "pointer" : "default" }}>+</button>
                    </div>
                  </div>
                </>}
            </div>
          </div>
          {/* Sizes */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {colHead("Sizes")}
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {!selColorType ? <div style={{ padding: "6px 2px", fontSize: 10, color: T.faint }}>← Color</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {(() => {
                    const allSizes = [];
                    for (const row of effectiveRows) {
                      for (const sz of expandSizes(row.sizes)) {
                        if (!allSizes.find(s => s.size === sz)) allSizes.push({ size: sz, price: row.case_price });
                      }
                    }
                    return sortSizes(allSizes.map(s => s.size)).map(sz => {
                      const on = selSizes[sz] !== undefined;
                      const price = allSizes.find(s => s.size === sz)?.price || 0;
                      return (
                        <div key={sz} onClick={(e) => toggleSz(sz, e)}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accent : T.surface, transition: "all 0.12s", userSelect: "none" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#fff" : T.muted, fontFamily: mono }}>{sz}</span>
                          {price > 0 && <span style={{ fontSize: 10, color: on ? "rgba(255,255,255,0.7)" : T.muted }}>${price.toFixed(2)}</span>}
                        </div>
                      );
                    });
                  })()}
                </div>
              }
            </div>
            {selColorType && Object.keys(selSizes).length > 0 && (
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
function FavoritesPicker({ favorites, setFavorites, onAdd, onClose, toggleFav }) {
  const HP_CATEGORIES = ["Crewnecks", "Hats", "Hoodies", "Jackets", "Long Sleeve", "Tees", "Other"];
  const [selCategory, setSelCategory] = useState(null);
  const [selFav, setSelFav] = useState(null);
  const [variants, setVariants] = useState([]);
  const [inventory, setInventory] = useState({});
  const [pricing, setPricing] = useState({});
  const [loading, setLoading] = useState(false);
  const [selColor, setSelColor] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [itemName, setItemName] = useState("");
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
        // LA Apparel has color_type (White/Colors) + custom colors array
        const colorTypes = [...new Set((varData || []).map(v => v.color_type))];
        const customColors = (varData || []).length > 0 ? (varData[0].colors || []) : [];
        const allColors = [...colorTypes, ...customColors.filter(c => !colorTypes.includes(c))];
        // Expand sizes and build variants per color
        const SIZE_ORDER = ["3-6M","6-12M","12-18M","18-24M","2T","3T","4T","5T","6T","OSFA","OS","XXS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL"];
        const expandSizes = (s) => {
          const rangeMatch = s.trim().match(/^(\w+)\s*-\s*(\w+)$/);
          if (rangeMatch) { const start = SIZE_ORDER.indexOf(rangeMatch[1]); const end = SIZE_ORDER.indexOf(rangeMatch[2]); if (start >= 0 && end >= start) return SIZE_ORDER.slice(start, end + 1); }
          return s.split(",").map(x => x.trim()).filter(Boolean);
        };
        const mapped = [];
        for (const color of allColors) {
          // Use "Colors" pricing for custom colors, or matching color_type
          const rows = varData.filter(v => v.color_type === color || (v.color_type === "Colors" && !["White"].includes(color) && !colorTypes.includes(color)));
          const effectiveRows = rows.length > 0 ? rows : varData.filter(v => v.color_type === "Colors");
          for (const row of effectiveRows) {
            for (const sz of expandSizes(row.sizes)) {
              if (!mapped.find(m => m.colour === color && m.sizeCode === sz)) {
                mapped.push({ sku: `${fav.style_code}-${color}-${sz}`, colour: color, sizeCode: sz, price: row.case_price });
              }
            }
          }
        }
        setVariants(mapped);
        const pr = {}; mapped.forEach(v => { pr[v.sku] = v.price || 0; });
        setPricing(pr);
        setInventory({});
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
    const prefix = selFav.supplier === "ss" ? "" : "AS Colour ";
    onAdd({
      id: Date.now() + Math.random(),
      name: itemName.trim() || `${selFav.style_name} - ${selColor}`,
      blank_vendor: selFav.style_name,
      blank_sku: selColor,
      style: selFav.style_name,
      color: selColor,
      sizes: allSizes, qtys, curve: DEFAULT_CURVE, totalQty: 0, blankCosts,
    });
    setItemName(""); setSelColor(null); setSelSizes({});
  };

  const colRow = (label, active, onClick, sub) => (
    <div onClick={onClick} style={{ padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: active ? T.accent : "transparent", color: active ? "#fff" : T.text, borderBottom: `1px solid ${T.border}`, transition: "background 0.1s" }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {label}
      {sub && <div style={{ fontSize: 9, color: active ? "rgba(255,255,255,0.7)" : T.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding: "5px 11px", background: T.surface, borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: font }}>{title}</div>
  );

  const supplierLabel = { ss: "S&S", ascolour: "AS Colour" };

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#5795b2", fontFamily: font }}>House Party Favorites</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item display name" style={{ fontFamily: font, fontSize: 12, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px", outline: "none", width: 180 }} />
          <button onClick={doAdd} disabled={!canAdd} style={{ background: canAdd ? T.accent : T.surface, color: canAdd ? "#fff" : T.muted, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: canAdd ? "pointer" : "default" }}>Add to buy sheet →</button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
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
                <div onClick={() => loadFav(fav)} style={{ flex: 1, padding: "8px 11px", cursor: "pointer", fontSize: 11, fontFamily: font, background: selFav?.style_code === fav.style_code && selFav?.supplier === fav.supplier ? T.accent : "transparent", color: selFav?.style_code === fav.style_code && selFav?.supplier === fav.supplier ? "#fff" : T.text, transition: "background 0.1s" }}
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
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>Loading...</div>
              : !selFav ? <div style={{ padding: "14px 11px", fontSize: 10, color: T.faint, fontFamily: font }}>← Select a favorite</div>
              : <>
                {colorNames.map(c => {
                  const stock = (colorGroups[c] || []).reduce((a, v) => a + (inventory[v.sku] || 0), 0);
                  return colRow(c, selColor === c, () => { setSelColor(c); setSelSizes({}); }, stock > 0 ? `${stock.toLocaleString()} avail` : undefined);
                })}
                {selFav?.supplier === "laapparel" && (
                  <div style={{ padding: "6px 8px", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input value={newColor} onChange={e => setNewColor(e.target.value)} onKeyDown={e => e.key === "Enter" && addLAColor()}
                        placeholder="Add color..." style={{ flex: 1, padding: "4px 8px", fontSize: 10, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, outline: "none", fontFamily: font }} />
                      <button onClick={addLAColor} disabled={!newColor.trim()}
                        style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, border: "none", background: newColor.trim() ? T.accent : T.surface, color: newColor.trim() ? "#fff" : T.faint, cursor: newColor.trim() ? "pointer" : "default" }}>+</button>
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
                      <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#fff" : T.muted, fontFamily: mono }}>{sz}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 9, color: on ? "rgba(255,255,255,0.5)" : stock > 100 ? T.green : stock > 0 ? T.amber : T.red, fontFamily: mono }}>{stock.toLocaleString()}</span>
                        {price > 0 && <span style={{ fontSize: 10, color: on ? "rgba(255,255,255,0.7)" : T.muted }}>${Number(price).toFixed(2)}</span>}
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

// ── Main BuySheetTab ─────────────────────────────────────────────────────────

export function BuySheetTab({ items, jobId, onRegisterSave, onSaveStatus, onSaved }) {
  const [localItems, setLocalItems] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify(items || []));
  const onSaveRef = useRef(null);

  // Working items: local edits take priority, otherwise parent data
  const workingItems = localItems !== null ? localItems : (items||[]);

  // Dirty detection via JSON comparison (same pattern as CostingTab)
  const currentSnapshot = JSON.stringify(workingItems);
  const isDirty = currentSnapshot !== savedSnapshot;

  const updateLocal = (newItems) => {
    setLocalItems(newItems);
  };

  // Sync savedSnapshot when parent items change externally (e.g. initial load)
  useEffect(() => {
    if (localItems === null) {
      setSavedSnapshot(JSON.stringify(items || []));
    }
  }, [items]);

  // ── Auto-save: 1500ms debounce after any change (longer for rapid qty entry) ────
  useEffect(() => {
    if (!isDirty) return;
    const t = setTimeout(async () => {
      await onSaveRef.current?.();
    }, 1500);
    return () => clearTimeout(t);
  }, [currentSnapshot]);

  // Register save with parent for tab-switch saves
  useEffect(() => {
    if (typeof onRegisterSave === "function") {
      onRegisterSave(async () => { await onSaveRef.current?.(); });
    }
  }, [currentSnapshot]);

  // Save on unmount if dirty
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    const handler = (e) => { if (isDirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      if (onSaveRef.current) onSaveRef.current();
    };
  }, []);

  // ── Save function: diffs against DB, writes changes, updates parent ────────
  const doSave = async () => {
    const current = workingItems;
    const saved = JSON.parse(savedSnapshot);
    const supabase = createClient();

    try {
      // 1. Deleted items
      const deleted = saved.filter(s => !current.find(c => c.id === s.id));
      for (const item of deleted) {
        if (typeof item.id === "string" && item.id.length > 20) {
          await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id);
          await supabase.from("items").delete().eq("id", item.id);
        }
      }

      // 2. Added items (temp IDs are numbers from Date.now)
      const idMap = {};
      const added = current.filter(c => !saved.find(s => s.id === c.id));
      for (const item of added) {
        const { data } = await supabase.from("items").insert({
          job_id: jobId, name: item.name,
          blank_vendor: item.blank_vendor || null,
          blank_sku: item.blank_sku || null,
          cost_per_unit: item.cost_per_unit || null,
          blank_costs: item.blankCosts && Object.keys(item.blankCosts).length > 0 ? item.blankCosts : null,
          garment_type: item.garment_type || null,
          status: "tbd", artwork_status: "not_started",
          sort_order: current.indexOf(item),
        }).select("id").single();
        if (data) {
          idMap[item.id] = data.id;
          if (item.sizes?.length > 0) {
            await supabase.from("buy_sheet_lines").insert(
              item.sizes.map(sz => ({ item_id: data.id, size: sz, qty_ordered: item.qtys?.[sz] || 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }))
            );
          }
        }
      }

      // 3. Updated items (name, qtys, sort order)
      const updated = current.filter(c => saved.find(s => s.id === c.id));
      for (const item of updated) {
        const prev = saved.find(s => s.id === item.id);
        const newSortOrder = current.indexOf(item);
        const dbUpdates = {};
        if (item.name !== prev?.name) dbUpdates.name = item.name;
        if (item.garment_type !== prev?.garment_type) dbUpdates.garment_type = item.garment_type || null;
        if (item.cost_per_unit !== prev?.cost_per_unit) dbUpdates.cost_per_unit = item.cost_per_unit || null;
        if (JSON.stringify(item.blankCosts) !== JSON.stringify(prev?.blankCosts)) dbUpdates.blank_costs = item.blankCosts || null;
        dbUpdates.sort_order = newSortOrder;
        await supabase.from("items").update(dbUpdates).eq("id", item.id);

        // Upsert buy_sheet_lines for changed qtys
        if (JSON.stringify(item.qtys) !== JSON.stringify(prev?.qtys)) {
          for (const [size, qty] of Object.entries(item.qtys || {})) {
            await supabase.from("buy_sheet_lines").upsert(
              { item_id: item.id, size, qty_ordered: qty },
              { onConflict: "item_id,size" }
            );
          }
        }
      }

      // 4. Remap temp IDs to real DB IDs if new items were added
      const hasNewIds = Object.keys(idMap).length > 0;
      if (hasNewIds) {
        // Only touch localItems when we need to swap temp IDs for real DB IDs
        setLocalItems(prev => {
          if (!prev) return prev;
          return prev.map(it => idMap[it.id] ? { ...it, id: idMap[it.id] } : it);
        });
      }

      // 5. Update snapshot to what was ACTUALLY saved to DB (not current local state)
      // This ensures edits made during the async save are still marked dirty and get saved next cycle
      const resolvedCurrent = current.map(it => idMap[it.id] ? { ...it, id: idMap[it.id] } : it);
      setSavedSnapshot(JSON.stringify(resolvedCurrent));
      if (onSaved) onSaved(resolvedCurrent);
      if (onSaveStatus) onSaveStatus("saved");
    } catch (e) {
      console.error("Buy sheet save failed", e);
      if (onSaveStatus) onSaveStatus("error");
    }
  };
  onSaveRef.current = doSave;

  const safeItems = (workingItems||[]).map(it => ({
    ...it,
    sizes: it.sizes||[],
    qtys: it.qtys||{},
    totalQty: it.totalQty || Object.values(it.qtys||{}).reduce((a,v)=>a+v,0),
  }));

  const [focused, setFocused] = useState(null);
  const [distRow, setDistRow] = useState(null);
  const [distTotal, setDistTotal] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [showASColour, setShowASColour] = useState(false);
  const [showLAApparel, setShowLAApparel] = useState(false);
  const [showAddType, setShowAddType] = useState(null); // "apparel" | "accessory" | null
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [favorites, setFavorites] = useState([]);
  useEffect(() => {
    createClient().from("favorites").select("*").order("style_name").then(({ data }) => setFavorites(data || []));
  }, []);
  const HP_CATEGORIES = ["Crewnecks", "Hats", "Hoodies", "Jackets", "Long Sleeve", "Tees"];
  const CATEGORY_MAP = {
    // S&S
    "T-Shirts": "Tees", "Short Sleeve T-Shirts": "Tees", "Long Sleeve T-Shirts": "Long Sleeve",
    "Fleece": "Hoodies", "Sweatshirts": "Crewnecks", "Hoodies": "Hoodies", "Outerwear": "Jackets",
    "Caps": "Hats", "Headwear": "Hats",
    // AS Colour
    "Longsleeve T-Shirts": "Long Sleeve", "Hooded Sweatshirts": "Hoodies", "Crew Sweatshirts": "Crewnecks",
    "Zip Sweatshirts": "Jackets",
    // LA Apparel
    "Men / Unisex": "Tees", "Womens": "Tees",
  };
  const guessCategory = (supplier, styleName, sourceCategory) => {
    if (sourceCategory && CATEGORY_MAP[sourceCategory]) return CATEGORY_MAP[sourceCategory];
    const lower = (styleName || "").toLowerCase();
    if (lower.includes("hoodie") || lower.includes("hooded")) return "Hoodies";
    if (lower.includes("crew") && lower.includes("sweat")) return "Crewnecks";
    if (lower.includes("jacket") || lower.includes("zip")) return "Jackets";
    if (lower.includes("long sleeve") || lower.includes("l/s")) return "Long Sleeve";
    if (lower.includes("hat") || lower.includes("cap") || lower.includes("beanie")) return "Hats";
    if (lower.includes("tee") || lower.includes("t-shirt")) return "Tees";
    return "Other";
  };
  const isFav = (supplier, styleCode) => favorites.some(f => f.supplier === supplier && f.style_code === styleCode);
  const toggleFav = async (supplier, styleCode, styleName, sourceCategory) => {
    const supabase = createClient();
    if (isFav(supplier, styleCode)) {
      await supabase.from("favorites").delete().eq("supplier", supplier).eq("style_code", styleCode);
      setFavorites(prev => prev.filter(f => !(f.supplier === supplier && f.style_code === styleCode)));
    } else {
      const category = guessCategory(supplier, styleName, sourceCategory);
      const { data } = await supabase.from("favorites").insert({ supplier, style_code: styleCode, style_name: styleName, category }).select().single();
      if (data) setFavorites(prev => [...prev, data].sort((a, b) => a.style_name.localeCompare(b.style_name)));
    }
  };
  const [accType, setAccType] = useState("");
  const [accName, setAccName] = useState("");
  const [accQty, setAccQty] = useState("");
  const [accCatalog, setAccCatalog] = useState([]);
  const SEED_ACC_TYPES = ["Patch - PVC", "Patch - Embroidered", "Flag", "Keychain"];
  const [accTypes, setAccTypes] = useState(SEED_ACC_TYPES);
  useEffect(() => {
    createClient().from("items").select("name, blank_vendor").eq("garment_type", "accessory").then(({ data }) => {
      setAccCatalog([...new Set((data || []).map(d => d.name).filter(Boolean))].sort());
      setAccTypes([...new Set([...SEED_ACC_TYPES, ...(data || []).map(d => d.blank_vendor).filter(Boolean)])].sort());
    });
  }, []);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [localQtys, setLocalQtys] = useState({});
  const localQtysRef = useRef({});
  localQtysRef.current = localQtys;
  const workingItemsRef = useRef(workingItems);
  workingItemsRef.current = workingItems;

  // Flush pending qty edits into workingItems before save
  useEffect(() => {
    return () => {
      const pending = localQtysRef.current;
      if (!pending || Object.keys(pending).length === 0) return;
      const items = workingItemsRef.current || [];
      const updated = items.map(it => {
        let newQtys = { ...(it.qtys || {}) };
        let modified = false;
        (it.sizes || []).forEach(sz => {
          const key = it.id + "_" + sz;
          if (pending[key] !== undefined) { newQtys[sz] = parseInt(pending[key]) || 0; modified = true; }
        });
        return modified ? { ...it, qtys: newQtys, totalQty: Object.values(newQtys).reduce((a, v) => a + v, 0) } : it;
      });
      setLocalItems(updated);
    };
  }, []);
  const inputRefs = useRef({});

  const getLocalQty = (itemId, sz) => {
    const key = itemId+"_"+sz;
    return localQtys[key] !== undefined ? localQtys[key] : null;
  };
  const setLocalQty = (itemId, sz, val) => {
    setLocalQtys(p => ({...p, [itemId+"_"+sz]: val}));
  };
  const commitTimers = useRef({});
  const commitQty = (rowIdx, itemId, sz) => {
    const key = itemId+"_"+sz;
    // Clear any pending auto-commit to prevent double-fire with stale closure
    if (commitTimers.current[key]) { clearTimeout(commitTimers.current[key]); delete commitTimers.current[key]; }
    // Read from ref (not closure) so scheduled timers always get fresh data
    const val = localQtysRef.current[key];
    if (val === undefined) return;
    const parsed = parseInt(val) || 0;
    setLocalQtys(p => { const n={...p}; delete n[key]; return n; });
    // Functional update: always merges into latest localItems, finds item by ID (not stale index)
    setLocalItems(prev => {
      const items = prev || workingItemsRef.current || [];
      return items.map(it => {
        if (it.id !== itemId) return it;
        const newQtys = {...(it.qtys||{}), [sz]: parsed};
        return {...it, qtys: newQtys, totalQty: Object.values(newQtys).reduce((a,v)=>a+v,0)};
      });
    });
  };
  // Auto-commit qty after 500ms of no typing
  const scheduleCommit = (rowIdx, itemId, sz) => {
    const key = itemId+"_"+sz;
    if (commitTimers.current[key]) clearTimeout(commitTimers.current[key]);
    commitTimers.current[key] = setTimeout(() => commitQty(rowIdx, itemId, sz), 500);
  };

  const isEmpty = safeItems.length === 0;
  const grandTotal = safeItems.reduce((a,it) => a+(it.totalQty||0), 0);

  const removeItem = (id) => updateLocal((workingItems||[]).filter(x => x.id !== id));

  const updateQty = (rowIdx, sz, val) => {
    const parsed = parseInt(val)||0;
    const newItems = (workingItems||[]).map((it,i) => {
      if (i !== rowIdx) return it;
      const newQtys = {...(it.qtys||{}), [sz]:parsed};
      return {...it, qtys:newQtys, totalQty:Object.values(newQtys).reduce((a,v)=>a+v,0)};
    });
    updateLocal(newItems);
  };

  const handleDist = (rowIdx) => {
    const total = parseInt(distTotal); if (!total||total<=0) return;
    const item = safeItems[rowIdx];
    const dist = distribute(total, item.sizes, item.curve||DEFAULT_CURVE);
    updateLocal((workingItems||[]).map((it,i) => i!==rowIdx ? it : {...it, qtys:dist, totalQty:Object.values(dist).reduce((a,v)=>a+v,0)}));
    setDistRow(null); setDistTotal("");
  };

  const addItem = (item) => { updateLocal([...(workingItems||[]), item]); };

  const addAccessory = () => {
    if (!accName.trim()) return;
    const typeName = accType.trim();
    const item = {
      id: Date.now() + Math.random(),
      name: accName.trim(),
      blank_vendor: typeName,
      blank_sku: "",
      style: typeName,
      color: "",
      garment_type: "accessory",
      sizes: ["OS"],
      qtys: { OS: parseInt(accQty) || 0 },
      curve: DEFAULT_CURVE,
      totalQty: parseInt(accQty) || 0,
      blankCosts: {},
      cost_per_unit: 0,
    };
    addItem(item);
    if (!accCatalog.includes(accName.trim())) setAccCatalog(prev => [...prev, accName.trim()].sort());
    if (typeName && !accTypes.includes(typeName)) setAccTypes(prev => [...prev, typeName].sort());
    setAccType("");
    setAccName("");
    setAccQty("");
  };

  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDrop = (idx) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const newItems = [...(workingItems||[])];
    const [moved] = newItems.splice(dragIdx, 1);
    newItems.splice(idx, 0, moved);
    updateLocal(newItems);
    setDragIdx(null); setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
      {(showPicker || showASColour || showLAApparel || showFavorites) && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
          onClick={() => { setShowPicker(false); setShowASColour(false); setShowLAApparel(false); setShowFavorites(false); }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"95vw", maxWidth:1000, maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
            <div style={{ marginBottom:8, display:"flex", gap:8, alignItems:"center" }}>
              <button onClick={() => { setShowPicker(false); setShowASColour(false); setShowLAApparel(false); setShowFavorites(false); setShowAddModal(true); }}
                style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, fontSize:11, fontWeight:600, padding:"4px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
                ← Sources
              </button>
            </div>
            {showPicker && <SSPicker onAdd={item => { addItem(item); }} onClose={() => setShowPicker(false)} isFav={isFav} toggleFav={toggleFav} />}
            {showASColour && <ASColourPicker onAdd={item => { addItem(item); setShowASColour(false); }} onClose={() => setShowASColour(false)} isFav={isFav} toggleFav={toggleFav} />}
            {showLAApparel && <LAApparelPicker onAdd={item => { addItem(item); }} onClose={() => setShowLAApparel(false)} isFav={isFav} toggleFav={toggleFav} />}
            {showFavorites && <FavoritesPicker favorites={favorites} setFavorites={setFavorites} onAdd={item => { addItem(item); }} onClose={() => setShowFavorites(false)} toggleFav={toggleFav} />}
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => setShowAddModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"24px", width:420, maxWidth:"90vw" }}>
            <div style={{ fontSize:16, fontWeight:700, color:T.text, fontFamily:font, marginBottom:4 }}>Add Item</div>
            <div style={{ fontSize:12, color:T.muted, marginBottom:16 }}>Choose a source</div>
            <button onClick={() => { setShowAddModal(false); setShowFavorites(true); }}
              style={{ width:"100%", padding:"12px", borderRadius:8, border:"none", background:"#5795b2", color:"#fff", fontSize:13, fontWeight:700, fontFamily:font, cursor:"pointer", marginBottom:10, transition:"opacity 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
              House Party Favorites {favorites.length > 0 && <span style={{ fontSize:10, opacity:0.7, marginLeft:4 }}>{favorites.length}</span>}
            </button>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {[
                { label:"S&S Activewear", bg:"#b65722", color:"#fff", action:() => { setShowAddModal(false); setShowPicker(true); } },
                { label:"AS Colour", bg:"#000000", color:"#fff", action:() => { setShowAddModal(false); setShowASColour(true); } },
                { label:"LA Apparel", bg:"#ffffff", color:"#000000", border:true, action:() => { setShowAddModal(false); setShowLAApparel(true); } },
                { label:"Custom Accessory", bg:T.surface, color:T.text, border:true, action:() => { setShowAddModal(false); setShowAddType("accessory"); } },
              ].map(opt => (
                <button key={opt.label} onClick={opt.disabled ? undefined : opt.action} disabled={opt.disabled}
                  style={{ padding:"10px 14px", borderRadius:8, border:opt.border?`1px solid ${T.border}`:"none", background:opt.bg,
                    cursor:opt.disabled?"default":"pointer", opacity:opt.disabled?0.4:1, textAlign:"center", transition:"opacity 0.15s",
                    fontSize:12, fontWeight:600, color:opt.color, fontFamily:font }}
                  onMouseEnter={e => { if(!opt.disabled) e.currentTarget.style.opacity = "0.85"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = opt.disabled?"0.4":"1"; }}>
                  {opt.label}{opt.sub ? <span style={{ fontSize:9, marginLeft:6, opacity:0.6 }}>{opt.sub}</span> : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Accessory modal */}
      {showAddType === "accessory" && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => setShowAddType(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"24px", width:400, maxWidth:"90vw" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight:700, color:T.text, fontFamily:font }}>Custom Accessory</div>
              <button onClick={() => setShowAddType(null)} style={{ background:"none", border:"none", color:T.muted, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ position:"relative" }}>
                <label style={{ fontSize:10, color:T.muted, marginBottom:3, display:"block" }}>Type</label>
                <input value={accType} onChange={e=>setAccType(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addAccessory()}
                  list="acc-types-modal" placeholder="Patch - PVC, Sticker, Pin..." autoFocus style={{ width:"100%", padding:"8px 10px", border:`1px solid ${T.border}`, borderRadius:7, background:T.surface, color:T.text, fontSize:13, fontFamily:font, outline:"none", boxSizing:"border-box" }}/>
                <datalist id="acc-types-modal">{accTypes.map(t=><option key={t} value={t}/>)}</datalist>
              </div>
              <div style={{ position:"relative" }}>
                <label style={{ fontSize:10, color:T.muted, marginBottom:3, display:"block" }}>Name</label>
                <input value={accName} onChange={e=>setAccName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addAccessory()}
                  list="acc-catalog-modal" placeholder="Item name..." style={{ width:"100%", padding:"8px 10px", border:`1px solid ${T.border}`, borderRadius:7, background:T.surface, color:T.text, fontSize:13, fontFamily:font, outline:"none", boxSizing:"border-box" }}/>
                <datalist id="acc-catalog-modal">{accCatalog.map(n=><option key={n} value={n}/>)}</datalist>
              </div>
              <div>
                <label style={{ fontSize:10, color:T.muted, marginBottom:3, display:"block" }}>Qty</label>
                <input value={accQty} onChange={e=>setAccQty(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addAccessory()}
                  type="text" inputMode="numeric" placeholder="0" style={{ width:100, padding:"8px 10px", border:`1px solid ${T.border}`, borderRadius:7, background:T.surface, color:T.text, fontSize:13, fontFamily:mono, outline:"none", textAlign:"center", boxSizing:"border-box" }}/>
              </div>
              <button onClick={() => { addAccessory(); setShowAddType(null); }} disabled={!accName.trim()}
                style={{ width:"100%", padding:"10px", borderRadius:8, border:"none", fontSize:13, fontWeight:600, cursor:accName.trim()?"pointer":"default",
                  background:accName.trim()?T.accent:T.surface, color:accName.trim()?"#fff":T.faint }}>
                Add to Buy Sheet
              </button>
            </div>
          </div>
        </div>
      )}

      {isEmpty && !showPicker && !showASColour && !showLAApparel && !showFavorites && !showAddType && (
        <div style={{ padding:"20px 0", textAlign:"center" }}>
          <div style={{ color:T.faint, fontSize:13, fontFamily:font, marginBottom:16 }}>No items yet — add products to start your buy sheet.</div>
          <button onClick={() => setShowAddModal(true)}
            style={{ background:T.accent, color:"#fff", border:"none", borderRadius:8, padding:"12px 32px", fontSize:14, fontFamily:font, fontWeight:700, cursor:"pointer" }}>
            + Add Item
          </button>
        </div>
      )}

      {!isEmpty && (
        <>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
            <button onClick={() => setShowAddModal(true)}
              style={{ background:T.accent, color:"#fff", border:"none", borderRadius:7, padding:"6px 14px", fontSize:12, fontFamily:font, fontWeight:600, cursor:"pointer" }}>
              + Add Item
            </button>
            {grandTotal > 0 && <span style={{ fontSize:12, color:T.green, fontFamily:mono, fontWeight:600 }}>{grandTotal.toLocaleString()} units total</span>}
            <div style={{ marginLeft:"auto", display:"flex", gap:12 }}>
              {[["↑↓←→","Nav"],["Enter","↓"],["Tab","→"]].map(([k,l]) => (
                <div key={k} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:4, padding:"1px 6px", fontSize:9, fontFamily:mono, color:T.accent }}>{k}</span>
                  <span style={{ fontSize:9, color:T.faint, fontFamily:font }}>{l}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderRadius:10, border:`1px solid ${T.border}`, overflow:"hidden" }}>
            <table style={{ borderCollapse:"collapse", fontSize:12, width:"100%" }}>
              <thead>
                <tr style={{ background:T.surface }}>
                  <th style={{ padding:"8px 14px", textAlign:"left", fontSize:10, fontWeight:700, color:T.muted, fontFamily:font, letterSpacing:"0.06em", textTransform:"uppercase", borderRight:`1px solid ${T.border}`, width:"28%" }}>Item</th>
                  <th style={{ padding:"8px 14px", textAlign:"left", fontSize:10, fontWeight:700, color:T.muted, fontFamily:font, letterSpacing:"0.06em", textTransform:"uppercase", borderRight:`1px solid ${T.border}` }}>Sizes & Qty</th>
                  <th style={{ padding:"8px 14px", textAlign:"center", fontSize:10, fontWeight:700, color:T.muted, fontFamily:font, letterSpacing:"0.06em", textTransform:"uppercase", borderRight:`1px solid ${T.border}`, width:80 }}>Total</th>
                  <th style={{ padding:"8px 14px", textAlign:"center", fontSize:10, fontWeight:700, color:T.muted, fontFamily:font, letterSpacing:"0.06em", textTransform:"uppercase", width:100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {safeItems.map((item, rowIdx) => {
                  const isLast = rowIdx === safeItems.length - 1;
                  return (
                    <tr key={item.id} onDragOver={e => handleDragOver(e, rowIdx)} onDrop={() => handleDrop(rowIdx)} style={{ borderBottom:isLast?"none":`1px solid ${T.border}`, background:dragOverIdx===rowIdx?T.accentDim:T.card, transition:"background 0.1s" }}>
                      <td style={{ padding:"10px 14px", verticalAlign:"middle", borderRight:`1px solid ${T.border}` }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div draggable onDragStart={() => handleDragStart(rowIdx)} onDragOver={e => handleDragOver(e, rowIdx)} onDrop={() => handleDrop(rowIdx)} onDragEnd={handleDragEnd}
                            style={{color:dragOverIdx===rowIdx?"rgba(79,142,247,0.7)":"rgba(255,255,255,0.2)",fontSize:12,cursor:"grab",padding:"0 4px 0 0",flexShrink:0,userSelect:"none",transition:"color 0.1s"}}>⠿</div>
                          <button onClick={() => removeItem(item.id)}
                            style={{ flexShrink:0, background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.4)", fontSize:13, lineHeight:1, padding:"1px 2px", borderRadius:3 }}
                            onMouseEnter={e => e.currentTarget.style.color=T.red}
                            onMouseLeave={e => e.currentTarget.style.color="rgba(255,255,255,0.4)"}>✕</button>
                          <div>
                            <input
                              value={item.name}
                              onChange={e => {
                                const newItems = (workingItems||[]).map((it,idx) => idx===rowIdx ? {...it, name:e.target.value} : it);
                                updateLocal(newItems);
                              }}
                              onClick={e => e.stopPropagation()}
                              onMouseDown={e => e.stopPropagation()}
                              style={{ fontSize:12, fontWeight:600, color:"#fff", fontFamily:font, background:"transparent", border:"none", outline:"none", width:"100%", cursor:"text" }}
                            />
                            <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontFamily:font, marginTop:1, display:"flex", alignItems:"center", gap:6 }}>
                              {item.blank_vendor||item.style}{(item.blank_sku||item.color)?` · ${item.blank_sku||item.color}`:""}
                              {item.stockLevel > 0 && <span style={{ marginLeft:6, color:item.stockLevel>100?T.green:T.amber }}>{item.stockLevel.toLocaleString()} in stock</span>}
                              {item.cost_per_unit > 0 && <span style={{ marginLeft:6, color:T.amber }}>${item.cost_per_unit.toFixed(2)}/unit</span>}
                              <select value={item.garment_type||""} onChange={e => {
                                const newItems = (workingItems||[]).map((it,idx) => idx===rowIdx ? {...it, garment_type:e.target.value||null} : it);
                                updateLocal(newItems);
                              }} onClick={e=>e.stopPropagation()} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:4, color:item.garment_type?T.text:T.faint, fontSize:9, padding:"1px 4px", outline:"none", cursor:"pointer", marginLeft:4 }}>
                                <option value="">Type</option>
                                <option value="tee">Tee</option>
                                <option value="longsleeve">Longsleeve</option>
                                <option value="hoodie">Hoodie</option>
                                <option value="crewneck">Crewneck</option>
                                <option value="jacket">Jacket</option>
                                <option value="pants">Pants</option>
                                <option value="shorts">Shorts</option>
                                <option value="hat">Hat</option>
                                <option value="beanie">Beanie</option>
                                <option value="tote">Tote</option>
                                <option value="patch">Patch</option>
                                <option value="poster">Poster</option>
                                <option value="sticker">Sticker</option>
                                <option value="socks">Socks</option>
                                <option value="bandana">Bandana</option>
                                <option value="banner">Banner</option>
                                <option value="flag">Flag</option>
                                <option value="pin">Pin</option>
                                <option value="koozie">Koozie</option>
                                <option value="can_cooler">Can Cooler</option>
                                <option value="key_chain">Key Chain</option>
                                <option value="custom_bag">Custom Bag</option>
                                <option value="water_bottle">Water Bottle</option>
                                <option value="towel">Towel</option>
                                <option value="woven_labels">Woven Labels</option>
                                <option value="custom">Custom</option>
                                <option value="accessory">Accessory</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding:"8px 10px", borderRight:`1px solid ${T.border}`, verticalAlign:"middle" }}>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                          {item.sizes.map((sz, szIdx) => {
                            const qty = item.qtys[sz]??0;
                            const isFocused = focused?.row===rowIdx && focused?.col===szIdx;
                            return (
                              <div key={sz} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, padding:"4px 6px", borderRadius:6, border:`1px solid ${isFocused?T.accent:qty>0?T.accent+"66":T.border}`, background:isFocused?T.accentDim:qty>0?T.surface:T.card, minWidth:44, transition:"all 0.1s" }}>
                                <span style={{ fontSize:9, fontWeight:700, color:qty>0?T.accent:T.muted, fontFamily:mono, letterSpacing:"0.04em" }}>{sz}</span>
                                <input type="text" inputMode="numeric" pattern="[0-9]*"
                                  value={getLocalQty(item.id,sz) !== null ? getLocalQty(item.id,sz) : (qty||"")}
                                  placeholder="0"
                                  onFocus={e => { setFocused({row:rowIdx,col:szIdx}); setLocalQty(item.id,sz,qty||""); e.target.select(); }}
                                  onChange={e => { setLocalQty(item.id, sz, e.target.value); scheduleCommit(rowIdx, item.id, sz); }}
                                  onBlur={() => commitQty(rowIdx, item.id, sz)}
                                  onKeyDown={e => {
                                    const moveTo = (r,c) => { setFocused({row:r,col:c}); setTimeout(()=>{ const el=inputRefs.current[r+"_"+c]; if(el) el.focus(); },0); };
                                    if (e.key==="Enter") { e.preventDefault(); commitQty(rowIdx,item.id,sz); if(rowIdx<safeItems.length-1) moveTo(rowIdx+1, szIdx<safeItems[rowIdx+1].sizes.length?szIdx:0); }
                                    if (e.key==="ArrowRight"||(e.key==="Tab"&&!e.shiftKey)) { e.preventDefault(); commitQty(rowIdx,item.id,sz); const nc=szIdx+1; if(nc<item.sizes.length) moveTo(rowIdx,nc); else if(rowIdx<safeItems.length-1) moveTo(rowIdx+1,0); }
                                    if (e.key==="ArrowLeft"||(e.key==="Tab"&&e.shiftKey)) { e.preventDefault(); commitQty(rowIdx,item.id,sz); const nc=szIdx-1; if(nc>=0) moveTo(rowIdx,nc); else if(rowIdx>0) moveTo(rowIdx-1,safeItems[rowIdx-1].sizes.length-1); }
                                    if (e.key==="ArrowDown") { e.preventDefault(); commitQty(rowIdx,item.id,sz); if(rowIdx<safeItems.length-1) moveTo(rowIdx+1,szIdx<safeItems[rowIdx+1].sizes.length?szIdx:0); }
                                    if (e.key==="ArrowUp") { e.preventDefault(); commitQty(rowIdx,item.id,sz); if(rowIdx>0) moveTo(rowIdx-1,szIdx<safeItems[rowIdx-1].sizes.length?szIdx:0); }
                                  }}
                                  ref={el => { if(el) inputRefs.current[rowIdx+"_"+szIdx] = el; }}
                                  style={{ width:36, textAlign:"center", background:"transparent", border:"none", outline:"none", color:isFocused?T.text:qty>0?T.text:T.muted, fontSize:12, fontFamily:mono, padding:0 }}/>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td style={{ padding:"10px 14px", textAlign:"center", fontFamily:mono, fontSize:13, fontWeight:700, color:(item.totalQty||0)>0?T.green:T.faint, borderRight:`1px solid ${T.border}` }}>
                        {(item.totalQty||0)||null}
                      </td>
                      <td style={{ padding:8, textAlign:"center", verticalAlign:"middle" }}>
                        {distRow===rowIdx ? (
                          <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center" }}>
                            <input type="text" inputMode="numeric" value={distTotal} onChange={e=>setDistTotal(e.target.value)}
                              onKeyDown={e => { if(e.key==="Enter") handleDist(rowIdx); }} placeholder="Total" autoFocus
                              style={{ width:70, background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, color:T.text, fontSize:12, fontFamily:mono, padding:"3px 6px", outline:"none", textAlign:"center" }}/>
                            <div style={{ display:"flex", gap:3 }}>
                              <button onClick={() => handleDist(rowIdx)} style={{ background:T.accent, color:"#fff", border:"none", borderRadius:4, padding:"3px 8px", fontSize:11, cursor:"pointer", fontFamily:font, fontWeight:600 }}>Fill</button>
                              <button onClick={() => { setDistRow(null); setDistTotal(""); }} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:4, color:T.muted, cursor:"pointer", fontSize:11, padding:"3px 6px" }}>✕</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setDistRow(rowIdx)}
                            style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, color:T.muted, cursor:"pointer", padding:"4px 8px", fontSize:10, fontFamily:font, whiteSpace:"nowrap" }}
                            onMouseEnter={e => { e.currentTarget.style.background=T.accentDim; e.currentTarget.style.color=T.accent; }}
                            onMouseLeave={e => { e.currentTarget.style.background=T.surface; e.currentTarget.style.color=T.muted; }}>
                            ⟳ Dist
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {safeItems.length > 1 && (
                  <tr style={{ background:T.surface, borderTop:`2px solid ${T.border}` }}>
                    <td style={{ padding:"8px 14px", fontWeight:700, fontSize:11, color:T.muted, fontFamily:font, textTransform:"uppercase", letterSpacing:"0.06em", borderRight:`1px solid ${T.border}` }}>Grand Total</td>
                    <td style={{ borderRight:`1px solid ${T.border}` }}/>
                    <td style={{ padding:"8px 14px", textAlign:"center", fontFamily:mono, fontSize:14, fontWeight:700, color:T.green, borderRight:`1px solid ${T.border}` }}>{grandTotal.toLocaleString()}</td>
                    <td/>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
