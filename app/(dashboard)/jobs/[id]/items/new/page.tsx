"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type SelectedStyle = {
  styleID: number;
  styleName: string;
  brandName: string;
  colorName: string;
  sizes: string[];
  totalStock: number;
};

type SSStyle = {
  styleID: number;
  styleName: string;
  brandName: string;
  baseCategory: string;
  title: string;
};

type SSProduct = {
  sku: string;
  colorName: string;
  sizeName: string;
  warehouses: { warehouseAbbr: string; qty: number }[];
};

function StylePicker({ onSelect, onClose }: { onSelect: (s: SelectedStyle) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [styles, setStyles] = useState<SSStyle[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<SSStyle | null>(null);
  const [products, setProducts] = useState<SSProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [selectedBrand, setSelectedBrand] = useState("");

  useEffect(() => {
    fetch("/api/ss?endpoint=brands")
      .then(r => r.json())
      .then(data => setBrands(Array.isArray(data) ? data.map((b: {name: string}) => b.name).slice(0, 50) : []))
      .catch(() => {});
  }, []);

  const search = useCallback(async () => {
    if (!query.trim() && !selectedBrand) return;
    setLoading(true);
    setStyles([]);
    try {
      const params = new URLSearchParams({ endpoint: "search" });
      if (query) params.set("q", query);
      if (selectedBrand) params.set("brand", selectedBrand);
      const res = await fetch(`/api/ss?${params.toString()}`);
      const data = await res.json();
      setStyles(Array.isArray(data) ? data.slice(0, 30) : []);
    } catch { setStyles([]); }
    finally { setLoading(false); }
  }, [query, selectedBrand]);

  const loadProducts = async (style: SSStyle) => {
    setSelectedStyle(style);
    setSelectedColor(null);
    setLoadingProducts(true);
    try {
      const res = await fetch(`/api/ss?endpoint=products&styleId=${style.styleID}`);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch { setProducts([]); }
    finally { setLoadingProducts(false); }
  };

  const colorGroups = products.reduce((acc: Record<string, SSProduct[]>, p) => {
    if (!acc[p.colorName]) acc[p.colorName] = [];
    acc[p.colorName].push(p);
    return acc;
  }, {});

  const handleSelectColor = (colorName: string) => {
    if (!selectedStyle) return;
    const colorProducts = colorGroups[colorName] || [];
    const sizes = [...new Set(colorProducts.map(p => p.sizeName))];
    const totalStock = colorProducts.reduce((a, p) => a + (p.warehouses || []).reduce((b, w) => b + w.qty, 0), 0);
    onSelect({ styleID: selectedStyle.styleID, styleName: selectedStyle.styleName, brandName: selectedStyle.brandName, colorName, sizes, totalStock });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-bold text-lg">Browse S&amp;S Catalog</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl leading-none">&times;</button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/2 border-r border-border flex flex-col overflow-hidden">
            <div className="p-4 space-y-3 shrink-0">
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
                placeholder="Style number or keyword..."
                className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm outline-none focus:border-primary" />
              <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm outline-none">
                <option value="">All brands</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <button onClick={search} disabled={loading}
                className="w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {loading ? "Searching..." : "Search"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
              {styles.length === 0 && !loading && <p className="text-xs text-muted-foreground text-center py-8">Search to see styles</p>}
              {styles.map(style => (
                <button key={style.styleID} onClick={() => loadProducts(style)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${selectedStyle?.styleID === style.styleID ? "bg-primary/20 border-primary/40" : "hover:bg-secondary border-transparent"}`}>
                  <p className="text-sm font-semibold">{style.brandName} {style.styleName}</p>
                  <p className="text-xs text-muted-foreground">{style.title || style.baseCategory}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="w-1/2 flex flex-col overflow-hidden">
            {!selectedStyle ? (
              <div className="flex-1 flex items-center justify-center"><p className="text-sm text-muted-foreground">Select a style</p></div>
            ) : loadingProducts ? (
              <div className="flex-1 flex items-center justify-center"><p className="text-sm text-muted-foreground">Loading...</p></div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Select Color</p>
                {Object.entries(colorGroups).map(([colorName, colorProducts]) => {
                  const sizes = [...new Set(colorProducts.map(p => p.sizeName))];
                  const totalStock = colorProducts.reduce((a, p) => a + (p.warehouses || []).reduce((b, w) => b + w.qty, 0), 0);
                  return (
                    <button key={colorName} onClick={() => setSelectedColor(colorName)}
                      className={`w-full text-left px-3 py-3 rounded-lg border transition-colors ${selectedColor === colorName ? "bg-primary/20 border-primary/40" : "border-border hover:bg-secondary"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold">{colorName}</span>
                        <span className={`text-xs font-medium ${totalStock > 100 ? "text-green-400" : totalStock > 0 ? "text-amber-400" : "text-destructive"}`}>
                          {totalStock.toLocaleString()} in stock
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {sizes.map(sz => <span key={sz} className="px-1.5 py-0.5 bg-secondary rounded text-xs text-muted-foreground">{sz}</span>)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedColor && (
              <div className="p-4 border-t border-border shrink-0">
                <button onClick={() => handleSelectColor(selectedColor)}
                  className="w-full py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90">
                  Select {selectedStyle?.brandName} {selectedStyle?.styleName} - {selectedColor}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewItemPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [form, setForm] = useState({ name: "", blank_vendor: "", blank_sku: "", garment_type: "tee", status: "tbd" as "tbd"|"confirmed", artwork_status: "not_started", notes: "" });
  const [selectedSizes, setSelectedSizes] = useState<string[]>(["S","M","L","XL"]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleStyleSelect = (style: SelectedStyle) => {
    setForm(f => ({ ...f, name: f.name || `${style.brandName} ${style.styleName} - ${style.colorName}`, blank_vendor: `${style.brandName} ${style.styleName}`, blank_sku: style.colorName }));
    if (style.sizes.length > 0) setSelectedSizes(style.sizes);
    setShowPicker(false);
  };

  const toggleSize = (size: string) => setSelectedSizes(prev => prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data: item, error: itemError } = await supabase.from("items").insert({
        job_id: params.id, name: form.name, blank_vendor: form.blank_vendor || null,
        blank_sku: form.blank_sku || null, garment_type: form.garment_type || null,
        status: form.status, artwork_status: form.artwork_status, notes: form.notes || null, sort_order: 0,
      }).select("id").single();
      if (itemError) throw itemError;
      if (selectedSizes.length > 0) {
        const { error: lineError } = await supabase.from("buy_sheet_lines").insert(
          selectedSizes.map(size => ({ item_id: item.id, size, qty_ordered: 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }))
        );
        if (lineError) throw lineError;
      }
      router.push(`/jobs/${params.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const ic = "w-full px-3 py-2 rounded-md bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary transition-colors";
  const lc = "block text-sm font-medium mb-1.5";
  const SIZES = { Standard: ["XS","S","M","L","XL","2XL","3XL"], Youth: ["YS","YM","YL","YXL"], "One Size": ["OS"] };

  return (
    <>
      {showPicker && <StylePicker onSelect={handleStyleSelect} onClose={() => setShowPicker(false)} />}
      <div className="max-w-2xl space-y-6">
        <div>
          <button onClick={() => router.back()} className="text-sm text-muted-foreground hover:text-foreground mb-4 block">Back to job</button>
          <h1 className="text-2xl font-bold tracking-tight">Add Item</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Item Details</h2>
              <button type="button" onClick={() => setShowPicker(true)}
                className="px-3 py-1.5 rounded-md bg-primary/20 border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/30 transition-colors">
                Browse S&amp;S Catalog
              </button>
            </div>
            {form.blank_vendor && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-950/50 border border-green-900/50">
                <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <p className="text-xs text-green-400 font-medium">{form.blank_vendor} - {form.blank_sku}</p>
                <button type="button" onClick={() => { set("blank_vendor",""); set("blank_sku",""); }} className="ml-auto text-muted-foreground hover:text-foreground text-xs">clear</button>
              </div>
            )}
            <div><label className={lc}>Item Name *</label><input value={form.name} onChange={e => set("name",e.target.value)} required placeholder="e.g. Tour Tee - Black" className={ic}/></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={lc}>Blank / Style</label><input value={form.blank_vendor} onChange={e => set("blank_vendor",e.target.value)} placeholder="e.g. Comfort Colors 1717" className={ic}/></div>
              <div><label className={lc}>Color</label><input value={form.blank_sku} onChange={e => set("blank_sku",e.target.value)} placeholder="e.g. Black" className={ic}/></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={lc}>Garment Type</label>
                <select value={form.garment_type} onChange={e => set("garment_type",e.target.value)} className={ic}>
                  {["tee","hoodie","longsleeve","crewneck","hat","beanie","tote","patch","poster","sticker","custom"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className={lc}>Status</label>
                <select value={form.status} onChange={e => set("status",e.target.value)} className={ic}>
                  <option value="tbd">TBD</option><option value="confirmed">Confirmed</option>
                </select>
              </div>
            </div>
            <div><label className={lc}>Artwork Status</label>
              <select value={form.artwork_status} onChange={e => set("artwork_status",e.target.value)} className={ic}>
                <option value="not_started">Not Started</option>
                <option value="in_progress">In Progress</option>
                <option value="approved">Approved</option>
                <option value="n_a">N/A</option>
              </select>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Sizes</h2>
            {Object.entries(SIZES).map(([group, sizes]) => (
              <div key={group}>
                <p className="text-xs text-muted-foreground mb-2">{group}</p>
                <div className="flex flex-wrap gap-2">
                  {sizes.map(size => (
                    <button key={size} type="button" onClick={() => toggleSize(size)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${selectedSizes.includes(size) ? "bg-primary border-primary text-primary-foreground" : "bg-secondary border-border text-muted-foreground hover:text-foreground"}`}>
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <label className={lc}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes",e.target.value)} placeholder="Any additional notes..." rows={3} className={ic + " resize-none"}/>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={loading} className="px-6 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {loading ? "Adding..." : "Add item"}
            </button>
            <button type="button" onClick={() => router.back()} className="px-6 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary transition-colors">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
