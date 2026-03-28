"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
const DEFAULT_CURVE = {S:5.13,M:20.57,L:38.14,XL:25.90,"2XL":7.69,"3XL":2.56};

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

function SSPicker({ onAdd, onClose }) {
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

  const toggleSz = (sz) => setSelSizes(p => { const n={...p}; if(n[sz]!==undefined) delete n[sz]; else n[sz]=1; return n; });
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
              : (selBrand ? styles.filter(s => s.brandName===selBrand) : styles).map(s => colRow(s.styleName, selStyle?.styleID===s.styleID, () => loadProducts(s), s.title||s.baseCategory))}
          </div>
        </div>
        <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {colHead("Color")}
          <div style={{ flex:1, overflowY:"auto" }}>
            {loadingProducts ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>Loading…</div>
              : !selStyle ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>← Style</div>
              : colorNames.map(c => colRow(c, selColor===c, () => { setSelColor(c); setSelSizes({}); }))}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {colHead("Sizes")}
          <div style={{ flex:1, overflowY:"auto", padding:8 }}>
            {!selColor ? <div style={{ padding:"6px 2px", fontSize:10, color:T.faint, fontFamily:font }}>← Color</div>
              : <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {sortSizes(currentColor.sizes).map(sz => {
                    const on = selSizes[sz] !== undefined;
                    return (
                      <div key={sz} onClick={() => toggleSz(sz)}
                        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 10px", borderRadius:6, cursor:"pointer", border:`1px solid ${on?T.accent:T.border}`, background:on?T.accent:T.surface, transition:"all 0.12s", userSelect:"none" }}>
                        <span style={{ fontSize:12, fontWeight:700, color:on?"#fff":T.muted, fontFamily:mono }}>{sz}</span>
                        <span style={{ fontSize:10, color:on?"rgba(255,255,255,0.7)":T.muted }}>${Number(currentColor.prices[sz]||0).toFixed(2)}</span>
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
// ── Manual Picker (pulls from blank_catalog table) ───────────────────────────

const POPULAR_STYLES = [
  { brand: "Comfort Colors", style: "1717", title: "Garment-Dyed Heavyweight Tee" },
  { brand: "Next Level", style: "6210", title: "Unisex CVC T-Shirt" },
];

function ManualPicker({ onAdd, onClose }) {
  const [loading, setLoading] = useState(true);
  const [styleData, setStyleData] = useState({}); // { "CC-1717": { colors: { "Black": { sizes: [...], prices: {...} } } } }
  const [selBrand, setSelBrand] = useState(null);
  const [selStyle, setSelStyle] = useState(null);
  const [selColor, setSelColor] = useState(null);
  const [selSizes, setSelSizes] = useState({});
  const [name, setName] = useState("");

  useEffect(() => {
    async function loadAll() {
      const results = {};

      // 1. Load S&S popular styles
      for (const ps of POPULAR_STYLES) {
        const key = `${ps.brand}-${ps.style}`;
        try {
          const searchRes = await fetch(`/api/ss?endpoint=search&q=${ps.style}&brand=${encodeURIComponent(ps.brand)}`);
          const searchData = await searchRes.json();
          const match = (searchData || []).find(s => s.styleName === ps.style);
          if (!match) continue;
          const prodRes = await fetch(`/api/ss?endpoint=products&styleId=${match.styleID}`);
          const products = await prodRes.json();
          const colors = {};
          (products || []).forEach(p => {
            if (!colors[p.colorName]) colors[p.colorName] = { sizes: [], prices: {} };
            if (!colors[p.colorName].sizes.includes(p.sizeName)) colors[p.colorName].sizes.push(p.sizeName);
            colors[p.colorName].prices[p.sizeName] = p.customerPrice;
          });
          results[key] = { ...ps, source: "ss", colors };
        } catch (e) { console.error("Failed to load", key, e); }
      }

      // 2. Load blank catalog entries
      try {
        const supabase = createClient();
        const { data: catalog } = await supabase.from("blank_catalog").select("*").order("brand").order("style").order("color");
        if (catalog && catalog.length > 0) {
          const grouped = {};
          catalog.forEach(entry => {
            const key = `${entry.brand}-${entry.style}`;
            if (results[key]) return; // S&S takes priority
            if (!grouped[key]) grouped[key] = { brand: entry.brand, style: entry.style, title: "", source: "catalog", colors: {} };
            grouped[key].colors[entry.color] = { sizes: entry.sizes || [], prices: entry.costs || {} };
          });
          Object.assign(results, grouped);
        }
      } catch (e) { console.error("Failed to load blank catalog", e); }

      setStyleData(results);
      setLoading(false);
    }
    loadAll();
  }, []);

  const brands = [...new Set(Object.values(styleData).map(sd => sd.brand))].sort();
  const brandStyles = selBrand ? Object.entries(styleData).filter(([_, sd]) => sd.brand === selBrand) : [];
  const currentStyle = selStyle ? styleData[selStyle] : null;
  const colorNames = currentStyle ? Object.keys(currentStyle.colors).sort() : [];
  const currentColor = currentStyle && selColor ? currentStyle.colors[selColor] : null;
  const toggleSz = (sz) => setSelSizes(p => { const n={...p}; if(n[sz]!==undefined) delete n[sz]; else n[sz]=1; return n; });
  const canAdd = currentStyle && currentColor && Object.keys(selSizes).length > 0;

  const doAdd = () => {
    if (!canAdd) return;
    const allSizes = sortSizes(Object.keys(selSizes));
    const qtys = {}; allSizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = {}; allSizes.forEach(sz => { blankCosts[sz] = currentColor.prices[sz] || 0; });
    onAdd({
      id: Date.now() + Math.random(),
      name: name.trim() || `${currentStyle.brand} ${currentStyle.style} - ${selColor}`,
      blank_vendor: `${currentStyle.brand} ${currentStyle.style}`,
      blank_sku: selColor,
      style: `${currentStyle.brand} ${currentStyle.style}`,
      color: selColor,
      sizes: allSizes,
      qtys,
      curve: DEFAULT_CURVE,
      totalQty: 0,
      blankCosts,
    });
    setName(""); setSelColor(null); setSelSizes({}); setSelStyle(null); setSelBrand(null);
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
        <span style={{ fontSize:12, fontWeight:700, color:T.text, fontFamily:font }}>Popular Styles</span>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Item display name" style={{ fontFamily:font, fontSize:12, color:T.text, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 10px", outline:"none", width:200 }} />
          <button onClick={doAdd} disabled={!canAdd} style={{ background:canAdd?T.accent:T.surface, color:canAdd?"#fff":T.muted, border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontFamily:font, fontWeight:600, cursor:canAdd?"pointer":"default", transition:"all 0.15s" }}>Add to buy sheet →</button>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>
      </div>
      {loading ? (
        <div style={{ padding:20, textAlign:"center", fontSize:12, color:T.muted, fontFamily:font }}>Loading popular styles from S&amp;S…</div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1.5fr 1fr", height:300 }}>
          <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {colHead("Brand")}
            <div style={{ flex:1, overflowY:"auto" }}>
              {brands.map(b => colRow(b, selBrand===b, () => { setSelBrand(b); setSelStyle(null); setSelColor(null); setSelSizes({}); }))}
            </div>
          </div>
          <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {colHead("Style")}
            <div style={{ flex:1, overflowY:"auto" }}>
              {!selBrand ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>← Brand</div>
                : brandStyles.map(([key, sd]) => colRow(sd.style, selStyle===key, () => { setSelStyle(key); setSelColor(null); setSelSizes({}); }, sd.title))}
            </div>
          </div>
          <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {colHead("Color")}
            <div style={{ flex:1, overflowY:"auto" }}>
              {!selStyle ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>← Style</div>
                : colorNames.map(c => colRow(c, selColor===c, () => { setSelColor(c); setSelSizes({}); }))}
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {colHead("Sizes")}
            <div style={{ flex:1, overflowY:"auto", padding:8 }}>
              {!selColor ? <div style={{ padding:"6px 2px", fontSize:10, color:T.faint, fontFamily:font }}>← Color</div>
                : <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {sortSizes(currentColor.sizes).map(sz => {
                      const on = selSizes[sz] !== undefined;
                      return (
                        <div key={sz} onClick={() => toggleSz(sz)}
                          style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 10px", borderRadius:6, cursor:"pointer", border:`1px solid ${on?T.accent:T.border}`, background:on?T.accent:T.surface, transition:"all 0.12s", userSelect:"none" }}>
                          <span style={{ fontSize:12, fontWeight:700, color:on?"#fff":T.muted, fontFamily:mono }}>{sz}</span>
                          <span style={{ fontSize:10, color:on?"rgba(255,255,255,0.7)":T.muted }}>${Number(currentColor.prices[sz]||0).toFixed(2)}</span>
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
      )}
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

  // ── Auto-save: 1.5s debounce after any change (longer for fast tabbing) ────
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
      if (isDirtyRef.current && onSaveRef.current) onSaveRef.current();
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

      // 5. Update snapshot to match what's now in DB (use current local state, not a stale copy)
      // Read the latest localItems to build an accurate snapshot
      setLocalItems(prev => {
        const resolved = (prev || current).map(it => idMap[it.id] ? { ...it, id: idMap[it.id] } : it);
        setSavedSnapshot(JSON.stringify(resolved));
        if (onSaved) onSaved(resolved);
        return prev; // Don't overwrite — keep whatever the user is currently editing
      });
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
  const [showManual, setShowManual] = useState(false);
  const [showAddType, setShowAddType] = useState(null); // "apparel" | null
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [localQtys, setLocalQtys] = useState({});
  const inputRefs = useRef({});

  const getLocalQty = (itemId, sz) => {
    const key = itemId+"_"+sz;
    return localQtys[key] !== undefined ? localQtys[key] : null;
  };
  const setLocalQty = (itemId, sz, val) => {
    setLocalQtys(p => ({...p, [itemId+"_"+sz]: val}));
  };
  const commitQty = (rowIdx, itemId, sz) => {
    const key = itemId+"_"+sz;
    if (localQtys[key] === undefined) return;
    const parsed = parseInt(localQtys[key]) || 0;
    setLocalQtys(p => { const n={...p}; delete n[key]; return n; });
    updateQty(rowIdx, sz, parsed);
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
      {showPicker && <SSPicker onAdd={item => { addItem(item); }} onClose={() => setShowPicker(false)} />}
      {showManual && <ManualPicker onAdd={item => { addItem(item); setShowManual(false); }} onClose={() => setShowManual(false)} />}

      {isEmpty && !showPicker && !showManual && (
        <div style={{ padding:"20px 0" }}>
          <div style={{ color:T.faint, fontSize:13, fontFamily:font, marginBottom:12 }}>No items yet — add products to start your buy sheet.</div>
          <div style={{ display:"flex", gap:10, marginBottom:showAddType==="apparel"?12:0 }}>
            <button onClick={() => setShowAddType(showAddType==="apparel"?null:"apparel")} style={{ background:showAddType==="apparel"?T.accent:T.surface, color:showAddType==="apparel"?"#fff":T.text, border:`1px solid ${showAddType==="apparel"?T.accent:T.border}`, borderRadius:8, padding:"9px 20px", fontSize:13, fontFamily:font, fontWeight:600, cursor:"pointer" }}>
              + Apparel
            </button>
            <button disabled style={{ background:T.surface, color:T.faint, border:`1px solid ${T.border}`, borderRadius:8, padding:"9px 20px", fontSize:13, fontFamily:font, cursor:"default", opacity:0.6 }}>
              + Headwear <span style={{ fontSize:10, marginLeft:4 }}>coming soon</span>
            </button>
            <button disabled style={{ background:T.surface, color:T.faint, border:`1px solid ${T.border}`, borderRadius:8, padding:"9px 20px", fontSize:13, fontFamily:font, cursor:"default", opacity:0.6 }}>
              + Accessory <span style={{ fontSize:10, marginLeft:4 }}>coming soon</span>
            </button>
          </div>
          {showAddType==="apparel"&&(
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setShowPicker(true)} style={{ background:T.accent, color:"#fff", border:"none", borderRadius:8, padding:"9px 20px", fontSize:13, fontFamily:font, fontWeight:600, cursor:"pointer" }}>
                Browse S&amp;S Catalog
              </button>
              <button onClick={() => setShowManual(true)} style={{ background:T.surface, color:T.text, border:`1px solid ${T.border}`, borderRadius:8, padding:"9px 20px", fontSize:13, fontFamily:font, cursor:"pointer" }}>
                + Popular
              </button>
            </div>
          )}
        </div>
      )}

      {!isEmpty && (
        <>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
            <button onClick={() => { setShowAddType(showAddType==="apparel"?null:"apparel"); setShowPicker(false); setShowManual(false); }} style={{ background:showAddType==="apparel"?T.accent:T.surface, color:showAddType==="apparel"?"#fff":T.muted, border:`1px solid ${showAddType==="apparel"?T.accent:T.border}`, borderRadius:7, padding:"6px 14px", fontSize:12, fontFamily:font, fontWeight:600, cursor:"pointer" }}>
              + Apparel
            </button>
            <button disabled style={{ background:T.surface, color:T.faint, border:`1px solid ${T.border}`, borderRadius:7, padding:"6px 14px", fontSize:12, fontFamily:font, cursor:"default", opacity:0.6 }}>
              + Headwear <span style={{ fontSize:9, marginLeft:3 }}>soon</span>
            </button>
            <button disabled style={{ background:T.surface, color:T.faint, border:`1px solid ${T.border}`, borderRadius:7, padding:"6px 14px", fontSize:12, fontFamily:font, cursor:"default", opacity:0.6 }}>
              + Accessory <span style={{ fontSize:9, marginLeft:3 }}>soon</span>
            </button>
            {showAddType==="apparel"&&(
              <>
                <div style={{ width:1, height:20, background:T.border }}/>
                <button onClick={() => { setShowPicker(!showPicker); setShowManual(false); }} style={{ background:T.accent, color:"#fff", border:"none", borderRadius:7, padding:"6px 14px", fontSize:12, fontFamily:font, fontWeight:600, cursor:"pointer" }}>
                  Browse S&amp;S
                </button>
                <button onClick={() => { setShowManual(!showManual); setShowPicker(false); }} style={{ background:T.surface, color:T.muted, border:`1px solid ${T.border}`, borderRadius:7, padding:"6px 14px", fontSize:12, fontFamily:font, cursor:"pointer" }}>
                  + Popular
                </button>
              </>
            )}
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
                            <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontFamily:font, marginTop:1 }}>
                              {item.blank_vendor||item.style}{(item.blank_sku||item.color)?` · ${item.blank_sku||item.color}`:""}
                              {item.stockLevel > 0 && <span style={{ marginLeft:6, color:item.stockLevel>100?T.green:T.amber }}>{item.stockLevel.toLocaleString()} in stock</span>}
                              {item.cost_per_unit > 0 && <span style={{ marginLeft:6, color:T.amber }}>${item.cost_per_unit.toFixed(2)}/unit</span>}
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
                                  onChange={e => setLocalQty(item.id, sz, e.target.value)}
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
