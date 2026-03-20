"use client";
import { useState, useEffect, useCallback } from "react";
import { Search, ChevronDown, ChevronRight, Package } from "lucide-react";

type SSStyle = {
  styleID: number;
  styleName: string;
  brandName: string;
  baseCategory: string;
  title: string;
  description: string;
  colorCount: number;
};

type SSProduct = {
  sku: string;
  styleID: number;
  colorName: string;
  colorCode: string;
  sizeName: string;
  gtin: string;
  warehouses: { warehouseAbbr: string; qty: number }[];
};

type SelectedStyle = {
  styleID: number;
  styleName: string;
  brandName: string;
  colorName: string;
  colorCode: string;
  sizes: string[];
  totalStock: number;
};

type StylePickerProps = {
  onSelect: (style: SelectedStyle) => void;
  onClose: () => void;
};

export default function StylePicker({ onSelect, onClose }: StylePickerProps) {
  const [view, setView] = useState<"search" | "browse">("search");
  const [query, setQuery] = useState("");
  const [styles, setStyles] = useState<SSStyle[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<SSStyle | null>(null);
  const [products, setProducts] = useState<SSProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [brands, setBrands] = useState<{ brandName: string }[]>([]);
  const [selectedBrand, setSelectedBrand] = useState("");

  // Load brands and categories on mount
  useEffect(() => {
    fetch("/api/ss?endpoint=brands")
      .then(r => r.json())
      .then(data => setBrands(Array.isArray(data) ? data.slice(0, 50) : []))
      .catch(() => {});
    fetch("/api/ss?endpoint=categories")
      .then(r => r.json())
      .then(data => setCategories(Array.isArray(data) ? data.map((c: { categoryName: string }) => c.categoryName) : []))
      .catch(() => {});
  }, []);

  const search = useCallback(async () => {
    if (!query.trim() && !selectedBrand && !selectedCategory) return;
    setLoading(true);
    setStyles([]);
    try {
      const params = new URLSearchParams({ endpoint: "search" });
      if (query) params.set("q", query);
      if (selectedBrand) params.set("brand", selectedBrand);
      if (selectedCategory) params.set("category", selectedCategory);
      const res = await fetch(`/api/ss?${params.toString()}`);
      const data = await res.json();
      setStyles(Array.isArray(data) ? data.slice(0, 30) : []);
    } catch {
      setStyles([]);
    } finally {
      setLoading(false);
    }
  }, [query, selectedBrand, selectedCategory]);

  const loadProducts = async (style: SSStyle) => {
    setSelectedStyle(style);
    setSelectedColor(null);
    setLoadingProducts(true);
    try {
      const res = await fetch(`/api/ss?endpoint=products&styleId=${style.styleID}`);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  // Group products by color
  const colorGroups = products.reduce((acc: Record<string, SSProduct[]>, p) => {
    const key = p.colorName;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  const handleSelectColor = (colorName: string) => {
    if (!selectedStyle) return;
    const colorProducts = colorGroups[colorName] || [];
    const sizes = [...new Set(colorProducts.map(p => p.sizeName))];
    const totalStock = colorProducts.reduce((a, p) =>
      a + (p.warehouses || []).reduce((b, w) => b + w.qty, 0), 0
    );
    const colorCode = colorProducts[0]?.colorCode || "";
    onSelect({
      styleID: selectedStyle.styleID,
      styleName: selectedStyle.styleName,
      brandName: selectedStyle.brandName,
      colorName,
      colorCode,
      sizes,
      totalStock,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-bold text-lg">Select Style</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {(["search", "browse"] as const).map(tab => (
            <button key={tab} onClick={() => setView(tab)}
              className={`px-5 py-3 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px ${
                view === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {tab}
            </button>
          ))}
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: search / browse */}
          <div className="w-1/2 border-r border-border flex flex-col overflow-hidden">
            <div className="p-4 space-y-3 shrink-0">
              {/* Search bar */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && search()}
                  placeholder="Style number or keyword..."
                  className="w-full pl-8 pr-3 py-2 bg-secondary border border-border rounded-md text-sm outline-none focus:border-primary"
                />
              </div>

              {view === "browse" && (
                <div className="grid grid-cols-2 gap-2">
                  <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
                    className="px-3 py-2 bg-secondary border border-border rounded-md text-sm outline-none">
                    <option value="">All brands</option>
                    {brands.map(b => <option key={b.brandName} value={b.brandName}>{b.brandName}</option>)}
                  </select>
                  <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
                    className="px-3 py-2 bg-secondary border border-border rounded-md text-sm outline-none">
                    <option value="">All categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}

              <button onClick={search} disabled={loading}
                className="w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {loading ? "Searching..." : "Search"}
              </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
              {styles.length === 0 && !loading && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  Search for a style or use filters to browse
                </p>
              )}
              {styles.map(style => (
                <button key={style.styleID} onClick={() => loadProducts(style)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-3 ${
                    selectedStyle?.styleID === style.styleID
                      ? "bg-primary/20 border border-primary/40"
                      : "hover:bg-secondary border border-transparent"
                  }`}>
                  <Package size={14} className="text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{style.brandName} {style.styleName}</p>
                    <p className="text-xs text-muted-foreground truncate">{style.title || style.baseCategory}</p>
                  </div>
                  <ChevronRight size={12} className="text-muted-foreground shrink-0 ml-auto" />
                </button>
              ))}
            </div>
          </div>

          {/* Right: color + size selection */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            {!selectedStyle ? (
              <div className="flex-1 flex items-center justify-center text-center p-8">
                <p className="text-sm text-muted-foreground">Select a style to see colors and sizes</p>
              </div>
            ) : loadingProducts ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading...</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
                  {selectedStyle.brandName} {selectedStyle.styleName} — Select Color
                </p>
                {Object.entries(colorGroups).map(([colorName, colorProducts]) => {
                  const sizes = [...new Set(colorProducts.map(p => p.sizeName))];
                  const totalStock = colorProducts.reduce((a, p) =>
                    a + (p.warehouses || []).reduce((b, w) => b + w.qty, 0), 0
                  );
                  const isSelected = selectedColor === colorName;
                  return (
                    <button key={colorName} onClick={() => setSelectedColor(colorName)}
                      className={`w-full text-left px-3 py-3 rounded-lg border transition-colors ${
                        isSelected ? "bg-primary/20 border-primary/40" : "border-border hover:bg-secondary"
                      }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold">{colorName}</span>
                        <span className={`text-xs font-medium ${totalStock > 100 ? "text-green-400" : totalStock > 0 ? "text-amber-400" : "text-destructive"}`}>
                          {totalStock.toLocaleString()} in stock
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {sizes.map(sz => (
                          <span key={sz} className="px-1.5 py-0.5 bg-secondary rounded text-xs text-muted-foreground">{sz}</span>
                        ))}
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
