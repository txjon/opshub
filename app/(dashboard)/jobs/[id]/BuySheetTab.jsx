"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const T = {
  bg:"#0f1117", surface:"#181c27", card:"#1e2333", border:"#2a3050",
  accent:"#4f8ef7", accentDim:"#1e3a6e",
  green:"#34c97a", amber:"#f5a623", red:"#f05353",
  text:"#e8eaf2", muted:"#7a82a0", faint:"#3a4060",
};
const font = `'IBM Plex Sans','Helvetica Neue',Arial,sans-serif`;
const mono = `'IBM Plex Mono','Courier New',monospace`;

const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","YXS","YS","YM","YL","YXL"];
const sortSizes = (sizes) => [...sizes].sort((a,b) => {
  const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1; if (bi === -1) return -1;
  return ai - bi;
});
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
  const [brand, setBrand] = useState("");
  const [brands, setBrands] = useState([]);
  const [styles, setStyles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [pendingItem, setPendingItem] = useState(null);
  const [itemName, setItemName] = useState("");

  useEffect(() => {
    fetch("/api/ss?endpoint=brands")
      .then(r => r.json())
      .then(data => setBrands(Array.isArray(data) ? data.map(b => b.name) : []))
      .catch(() => {});
  }, []);

  const search = useCallback(async () => {
    if (!query.trim() && !brand) return;
    setLoading(true); setStyles([]);
    try {
      const p = new URLSearchParams({ endpoint: "search" });
      if (query) p.set("q", query);
      if (brand) p.set("brand", brand);
      const res = await fetch(`/api/ss?${p.toString()}`);
      const data = await res.json();
      setStyles(Array.isArray(data) ? data.slice(0, 40) : []);
    } catch { setStyles([]); }
    finally { setLoading(false); }
  }, [query, brand]);

  const loadProducts = async (style) => {
    setSelectedStyle(style); setLoadingProducts(true);
    try {
      const res = await fetch(`/api/ss?endpoint=products&styleId=${style.styleID}`);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch { setProducts([]); }
    finally { setLoadingProducts(false); }
  };

  const colorGroups = products.reduce((acc, p) => {
    if (!acc[p.colorName]) acc[p.colorName] = [];
    acc[p.colorName].push(p);
    return acc;
  }, {});

  const handleColorClick = (colorName) => {
    const colorProducts = colorGroups[colorName] || [];
    const sizes = sortSizes([...new Set(colorProducts.map(p => p.sizeName))]);
    const stock = colorProducts.reduce((a,p) => a+(p.warehouses||[]).reduce((b,w) => b+w.qty,0), 0);
    const qtys = {}; sizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = {};
    colorProducts.forEach(p => {
      const cost = (p.customerPrice && p.customerPrice > 0) ? p.customerPrice : (p.casePrice || 0);
      blankCosts[p.sizeName] = cost;
    });
    const costValues = Object.values(blankCosts).filter(v => v > 0);
    const avgCost = costValues.length > 0 ? costValues.reduce((a,v) => a+v, 0) / costValues.length : 0;
    setPendingItem({
      id: Date.now() + Math.random(),
      name: "",
      blank_vendor: `${selectedStyle.brandName} ${selectedStyle.styleName}`,
      blank_sku: colorName,
      style: `${selectedStyle.brandName} ${selectedStyle.styleName}`,
      color: colorName,
      sizes, qtys, curve: DEFAULT_CURVE, totalQty: 0,
      stockLevel: stock,
      cost_per_unit: avgCost,
      blankCosts,
    });
    setItemName("");
  };

  const confirmAdd = () => {
    if (!pendingItem) return;
    onAdd({ ...pendingItem, name: itemName.trim() || `${pendingItem.blank_vendor} - ${pendingItem.blank_sku}` });
    setPendingItem(null);
    setItemName("");
  };

  const inp = { background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:font, fontSize:12, padding:"7px 10px", outline:"none", width:"100%", boxSizing:"border-box" };

  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden", marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", borderBottom:`1px solid ${T.border}` }}>
        <span style={{ fontSize:12, fontWeight:700, color:T.text, fontFamily:font }}>Browse S&amp;S Catalog</span>
        <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:16 }}>✕</button>
      </div>
      <div style={{ display:"flex", height:400 }}>
        <div style={{ width:"50%", borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column" }}>
          <div style={{ padding:12, display:"flex", flexDirection:"column", gap:8, borderBottom:`1px solid ${T.border}` }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key==="Enter" && search()} placeholder="Style number or keyword..." style={inp} />
            <select value={brand} onChange={e => setBrand(e.target.value)} style={inp}>
              <option value="">All brands</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <button onClick={search} disabled={loading} style={{ background:T.accent, color:"#fff", border:"none", borderRadius:6, padding:"7px", fontSize:12, fontFamily:font, fontWeight:600, cursor:"pointer", opacity:loading?0.6:1 }}>
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:8 }}>
            {styles.length === 0 && !loading && <div style={{ padding:24, textAlign:"center", fontSize:12, color:T.muted, fontFamily:font }}>Search to see styles</div>}
            {styles.map(style => (
              <button key={style.styleID} onClick={() => loadProducts(style)}
                style={{ width:"100%", textAlign:"left", padding:"8px 10px", borderRadius:6, border:`1px solid ${selectedStyle?.styleID===style.styleID?T.accent:"transparent"}`, background:selectedStyle?.styleID===style.styleID?T.accentDim:"transparent", cursor:"pointer", marginBottom:2 }}>
                <div style={{ fontSize:12, fontWeight:600, color:T.text, fontFamily:font }}>{style.brandName} {style.styleName}</div>
                <div style={{ fontSize:10, color:T.muted, fontFamily:font }}>{style.title||style.baseCategory}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ width:"50%", display:"flex", flexDirection:"column" }}>
          {!selectedStyle ? (
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontSize:12, color:T.muted, fontFamily:font }}>Select a style</span>
            </div>
          ) : loadingProducts ? (
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontSize:12, color:T.muted, fontFamily:font }}>Loading...</span>
            </div>
          ) : (
            <>
              <div style={{ padding:"10px 12px", borderBottom:`1px solid ${T.border}`, fontSize:11, fontWeight:700, color:T.muted, fontFamily:font, textTransform:"uppercase", letterSpacing:"0.06em" }}>
                {selectedStyle.brandName} {selectedStyle.styleName}
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:8 }}>
                {Object.entries(colorGroups).map(([colorName, colorProducts]) => {
                  const sizes = sortSizes([...new Set(colorProducts.map(p => p.sizeName))]);
                  const stock = colorProducts.reduce((a,p) => a+(p.warehouses||[]).reduce((b,w) => b+w.qty,0), 0);
                  const first = colorProducts[0] || {};
                  const cost = (first.customerPrice && first.customerPrice > 0) ? first.customerPrice : (first.casePrice || 0);
                  return (
                    <button key={colorName} onClick={() => handleColorClick(colorName)}
                      style={{ width:"100%", textAlign:"left", padding:"8px 10px", borderRadius:6, border:`1px solid ${T.border}`, background:T.surface, cursor:"pointer", marginBottom:4 }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor=T.accent; e.currentTarget.style.background=T.accentDim; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor=T.border; e.currentTarget.style.background=T.surface; }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:T.text, fontFamily:font }}>{colorName}</span>
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          {cost > 0 && <span style={{ fontSize:10, fontFamily:mono, color:T.amber }}>${cost.toFixed(2)}</span>}
                          <span style={{ fontSize:10, fontFamily:mono, color:stock>100?T.green:stock>0?T.amber:T.red }}>{stock.toLocaleString()} in stock</span>
                        </div>
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                        {sizes.map(sz => <span key={sz} style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:T.card, color:T.muted, fontFamily:mono }}>{sz}</span>)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {pendingItem && (
            <div style={{ padding:"12px", borderTop:`1px solid ${T.border}`, background:T.surface }}>
              <div style={{ fontSize:11, color:T.muted, fontFamily:font, marginBottom:6 }}>
                Name this item — this will be used across all departments
              </div>
              <input
                autoFocus
                value={itemName}
                onChange={e => setItemName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && confirmAdd()}
                placeholder={`e.g. Tour Tee, Crew Neck, VIP Hoodie...`}
                style={{ width:"100%", background:T.card, border:`1px solid ${T.accent}`, borderRadius:6, color:T.text, fontFamily:font, fontSize:13, padding:"8px 10px", outline:"none", boxSizing:"border-box", marginBottom:8 }}
              />
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={confirmAdd}
                  style={{ flex:1, background:T.accent, color:"#fff", border:"none", borderRadius:6, padding:"8px", fontSize:12, fontFamily:font, fontWeight:600, cursor:"pointer" }}>
                  Add to buy sheet →
                </button>
                <button onClick={() => { setPendingItem(null); setItemName(""); }}
                  style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, cursor:"pointer", fontSize:12, padding:"8px 12px" }}>
                  Cancel
                </button>
              </div>
              <div style={{ fontSize:10, color:T.faint, fontFamily:font, marginTop:6 }}>
                Blank: {pendingItem.blank_vendor} · {pendingItem.blank_sku} · {pendingItem.sizes.length} sizes
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ── Manual Picker (pulls from blank_catalog table) ───────────────────────────

function ManualPicker({ onAdd, onClose }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sB, setSB] = useState(null);
  const [sS, setSS] = useState(null);
  const [sC, setSC] = useState(null);
  const [sizes, setSizes] = useState({});
  const [name, setName] = useState("");

  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    sb.from("blank_catalog").select("*").order("brand").order("style").order("color")
      .then(({ data }) => { setCatalog(data || []); setLoading(false); });
  }, []);

  const brands = [...new Set(catalog.map(e => e.brand))].sort();
  const styles = sB ? [...new Set(catalog.filter(e => e.brand === sB).map(e => e.style))].sort() : [];
  const colors = sB && sS ? catalog.filter(e => e.brand === sB && e.style === sS) : [];
  const selectedEntry = sC ? colors.find(e => e.color === sC) : null;
  const szList = selectedEntry ? selectedEntry.sizes : [];
  const canAdd = sB && sS && sC && Object.keys(sizes).length > 0;

  const toggleSz = (sz) => setSizes(p => { const n={...p}; if(n[sz]!==undefined) delete n[sz]; else n[sz]=1; return n; });

  const doAdd = () => {
    const selectedSizes = sortSizes(Object.keys(sizes));
    const qtys = {}; selectedSizes.forEach(sz => { qtys[sz] = 0; });
    const blankCosts = selectedEntry ? selectedEntry.costs : {};
    onAdd({
      id: Date.now()+Math.random(),
      name: name.trim()||`${sB} ${sS} - ${sC}`,
      blank_vendor: `${sB} ${sS}`,
      blank_sku: sC,
      style: `${sB} ${sS}`,
      color: sC,
      sizes: selectedSizes,
      qtys,
      curve: DEFAULT_CURVE,
      totalQty: 0,
      blankCosts: blankCosts,
    });
    setSizes({}); setName(""); setSC(null); setSS(null); setSB(null);
  };

  const colRow = (label, active, onClick) => (
    <div onClick={onClick} style={{ padding:"8px 11px", cursor:"pointer", fontSize:11, fontFamily:font, background:active?T.accent:"transparent", color:active?"#fff":T.text, borderBottom:`1px solid ${T.border}`, transition:"background 0.1s" }}
      onMouseEnter={e => { if(!active) e.currentTarget.style.background=T.surface; }}
      onMouseLeave={e => { if(!active) e.currentTarget.style.background="transparent"; }}>
      {label}
    </div>
  );

  const colHead = (title) => (
    <div style={{ padding:"5px 11px", background:T.surface, borderBottom:`1px solid ${T.border}`, fontSize:9, fontWeight:700, color:T.muted, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:font }}>{title}</div>
  );

  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden", marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", borderBottom:`1px solid ${T.border}` }}>
        <span style={{ fontSize:12, fontWeight:700, color:T.text, fontFamily:font }}>Add Manually</span>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Item display name" style={{ fontFamily:font, fontSize:12, color:T.text, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 10px", outline:"none", width:200 }} />
          <button onClick={doAdd} disabled={!canAdd} style={{ background:canAdd?T.accent:T.surface, color:canAdd?"#fff":T.muted, border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontFamily:font, fontWeight:600, cursor:canAdd?"pointer":"default", transition:"all 0.15s" }}>Add to buy sheet →</button>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>
      </div>
      {loading ? (
        <div style={{ padding:20, textAlign:"center", fontSize:12, color:T.muted, fontFamily:font }}>Loading catalog…</div>
      ) : catalog.length === 0 ? (
        <div style={{ padding:20, textAlign:"center", fontSize:12, color:T.muted, fontFamily:font }}>
          No entries in blank catalog yet. <a href="/blank-catalog" target="_blank" style={{ color:T.accent }}>Add some →</a>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", height:260 }}>
          <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {colHead("Brand")}
            <div style={{ flex:1, overflowY:"auto" }}>
              {brands.map(b => colRow(b, sB===b, () => { setSB(b); setSS(null); setSC(null); setSizes({}); }))}
            </div>
          </div>
          <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {colHead("Style")}
            <div style={{ flex:1, overflowY:"auto" }}>
              {!sB ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>← Brand</div>
                : styles.map(s => colRow(s, sS===s, () => { setSS(s); setSC(null); setSizes({}); }))}
            </div>
          </div>
          <div style={{ borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {colHead("Color")}
            <div style={{ flex:1, overflowY:"auto" }}>
              {!sS ? <div style={{ padding:"14px 11px", fontSize:10, color:T.faint, fontFamily:font }}>← Style</div>
                : colors.map(e => colRow(e.color, sC===e.color, () => { setSC(e.color); setSizes({}); }))}
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {colHead("Sizes")}
            <div style={{ flex:1, overflowY:"auto", padding:8 }}>
              {!sC ? <div style={{ padding:"6px 2px", fontSize:10, color:T.faint, fontFamily:font }}>← Color</div>
                : <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {szList.map(sz => {
                      const on = sizes[sz] !== undefined;
                      const cost = selectedEntry?.costs?.[sz];
                      return (
                        <div key={sz} onClick={() => toggleSz(sz)}
                          style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 10px", borderRadius:6, cursor:"pointer", border:`1px solid ${on?T.accent:T.border}`, background:on?T.accent:T.surface, transition:"all 0.12s", userSelect:"none" }}>
                          <span style={{ fontSize:12, fontWeight:700, color:on?"#fff":T.muted, fontFamily:mono }}>{sz}</span>
                          <span style={{ fontSize:10, color:on?"rgba(255,255,255,0.7)":T.muted }}>
                            {cost ? `$${Number(cost).toFixed(2)}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
            {sC && Object.keys(sizes).length > 0 && (
              <div style={{ padding:"5px 10px", borderTop:`1px solid ${T.border}`, fontSize:10, fontFamily:font, color:T.muted }}>
                {Object.keys(sizes).length} size{Object.keys(sizes).length!==1?"s":""} selected
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

  // ── Auto-save: 1.5s debounce after any change ──────────────────────────────
  useEffect(() => {
    if (!isDirty) return;
    if (onSaveStatus) onSaveStatus("saving");
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

  // Warn on page close if unsaved
  useEffect(() => {
    const handler = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── Save function: diffs against DB, writes changes, updates parent ────────
  const doSave = async () => {
    const current = workingItems;
    const saved = JSON.parse(savedSnapshot);
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

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

      // 4. Remap temp IDs to real DB IDs in local state
      const resolved = current.map(it => {
        if (idMap[it.id]) return { ...it, id: idMap[it.id] };
        return it;
      });

      // 5. Update snapshots and notify parent
      const newSnapshot = JSON.stringify(resolved);
      setSavedSnapshot(newSnapshot);
      setLocalItems(resolved);
      if (onSaved) onSaved(resolved);
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
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [localQtys, setLocalQtys] = useState({});
  const inputRefs = {};

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
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={() => setShowPicker(true)} style={{ background:T.accent, color:"#fff", border:"none", borderRadius:8, padding:"9px 20px", fontSize:13, fontFamily:font, fontWeight:600, cursor:"pointer" }}>
              Browse S&amp;S Catalog
            </button>
            <button onClick={() => setShowManual(true)} style={{ background:T.surface, color:T.text, border:`1px solid ${T.border}`, borderRadius:8, padding:"9px 20px", fontSize:13, fontFamily:font, cursor:"pointer" }}>
              + Add Manually
            </button>
          </div>
        </div>
      )}

      {!isEmpty && (
        <>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
            <button onClick={() => { setShowPicker(!showPicker); setShowManual(false); }} style={{ background:T.accent, color:"#fff", border:"none", borderRadius:7, padding:"6px 14px", fontSize:12, fontFamily:font, fontWeight:600, cursor:"pointer" }}>
              Browse S&amp;S
            </button>
            <button onClick={() => { setShowManual(!showManual); setShowPicker(false); }} style={{ background:T.surface, color:T.muted, border:`1px solid ${T.border}`, borderRadius:7, padding:"6px 14px", fontSize:12, fontFamily:font, cursor:"pointer" }}>
              + Manual
            </button>
            {isDirty && <span style={{ fontSize:11, color:T.amber, fontFamily:font }}>Saving…</span>}
            {!isDirty && <span style={{ fontSize:11, color:T.faint, fontFamily:font }}>All saved</span>}
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
                    <tr key={item.id} style={{ borderBottom:isLast?"none":`1px solid ${T.border}`, background:T.card }}>
                      <td style={{ padding:"10px 14px", verticalAlign:"middle", borderRight:`1px solid ${T.border}` }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{color:"rgba(255,255,255,0.2)",fontSize:12,cursor:"grab",padding:"0 4px 0 0",flexShrink:0,userSelect:"none"}}>⠿</div>
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
                                  onFocus={() => { setFocused({row:rowIdx,col:szIdx}); setLocalQty(item.id,sz,qty||""); }}
                                  onChange={e => setLocalQty(item.id, sz, e.target.value)}
                                  onBlur={() => commitQty(rowIdx, item.id, sz)}
                                  onKeyDown={e => {
                                    const moveTo = (r,c) => { setFocused({row:r,col:c}); setTimeout(()=>{ const el=inputRefs[r+"_"+c]; if(el) el.focus(); },0); };
                                    if (e.key==="Enter") { e.preventDefault(); commitQty(rowIdx,item.id,sz); if(rowIdx<safeItems.length-1) moveTo(rowIdx+1, szIdx<safeItems[rowIdx+1].sizes.length?szIdx:0); }
                                    if (e.key==="ArrowRight"||(e.key==="Tab"&&!e.shiftKey)) { e.preventDefault(); commitQty(rowIdx,item.id,sz); const nc=szIdx+1; if(nc<item.sizes.length) moveTo(rowIdx,nc); else if(rowIdx<safeItems.length-1) moveTo(rowIdx+1,0); }
                                    if (e.key==="ArrowLeft"||(e.key==="Tab"&&e.shiftKey)) { e.preventDefault(); commitQty(rowIdx,item.id,sz); const nc=szIdx-1; if(nc>=0) moveTo(rowIdx,nc); else if(rowIdx>0) moveTo(rowIdx-1,safeItems[rowIdx-1].sizes.length-1); }
                                    if (e.key==="ArrowDown") { e.preventDefault(); commitQty(rowIdx,item.id,sz); if(rowIdx<safeItems.length-1) moveTo(rowIdx+1,szIdx<safeItems[rowIdx+1].sizes.length?szIdx:0); }
                                    if (e.key==="ArrowUp") { e.preventDefault(); commitQty(rowIdx,item.id,sz); if(rowIdx>0) moveTo(rowIdx-1,szIdx<safeItems[rowIdx-1].sizes.length?szIdx:0); }
                                  }}
                                  ref={el => { if(el) inputRefs[rowIdx+"_"+szIdx] = el; }}
                                  style={{ width:36, textAlign:"center", background:"transparent", border:"none", outline:"none", color:qty>0?T.text:T.faint, fontSize:12, fontFamily:mono, padding:0 }}/>
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
