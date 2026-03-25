"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, SIZE_ORDER } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const supabase = createClient();

type CatalogEntry = {
  id: string;
  brand: string;
  style: string;
  color: string;
  sizes: string[];
  costs: Record<string, number>;
};

export default function BlankCatalogPage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState<CatalogEntry | null>(null);

  // Form state
  const [fBrand, setFBrand] = useState("");
  const [fStyle, setFStyle] = useState("");
  const [fColor, setFColor] = useState("");
  const [fSizes, setFSizes] = useState<string[]>([]);
  const [fCosts, setFCosts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("blank_catalog").select("*").order("brand").order("style").order("color");
    setEntries(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const brands = [...new Set(entries.map(e => e.brand))].sort();
  const styles = selectedBrand
    ? [...new Set(entries.filter(e => e.brand === selectedBrand).map(e => e.style))].sort()
    : [];
  const colors = selectedBrand && selectedStyle
    ? entries.filter(e => e.brand === selectedBrand && e.style === selectedStyle)
    : [];

  const openNew = () => {
    setEditEntry(null);
    setFBrand(selectedBrand || "");
    setFStyle(selectedStyle || "");
    setFColor("");
    setFSizes([]);
    setFCosts({});
    setShowForm(true);
  };

  const openEdit = (entry: CatalogEntry) => {
    setEditEntry(entry);
    setFBrand(entry.brand);
    setFStyle(entry.style);
    setFColor(entry.color);
    setFSizes(entry.sizes);
    setFCosts(Object.fromEntries(Object.entries(entry.costs).map(([k, v]) => [k, String(v)])));
    setShowForm(true);
  };

  const toggleSize = (sz: string) => {
    setFSizes(prev => {
      const next = prev.includes(sz) ? prev.filter(s => s !== sz) : [...prev, sz];
      setFCosts(c => {
        const nc = { ...c };
        if (!next.includes(sz)) delete nc[sz];
        else if (!nc[sz]) nc[sz] = "";
        return nc;
      });
      return next;
    });
  };

  const save = async () => {
    if (!fBrand.trim() || !fStyle.trim() || !fColor.trim() || fSizes.length === 0) return;
    setSaving(true);
    const sorted = [...fSizes].sort((a, b) => {
      const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });
    const costs: Record<string, number> = {};
    sorted.forEach(sz => { costs[sz] = parseFloat(fCosts[sz] || "0") || 0; });

    if (editEntry) {
      await supabase.from("blank_catalog").update({ brand: fBrand.trim(), style: fStyle.trim(), color: fColor.trim(), sizes: sorted, costs }).eq("id", editEntry.id);
    } else {
      await supabase.from("blank_catalog").insert({ brand: fBrand.trim(), style: fStyle.trim(), color: fColor.trim(), sizes: sorted, costs });
    }
    setSaving(false);
    setShowForm(false);
    await load();
  };

  const deleteEntry = async (id: string) => {
    await supabase.from("blank_catalog").delete().eq("id", id);
    setConfirmDeleteId(null);
    await load();
  };

  const inp = (value: string, onChange: (v: string) => void, placeholder: string, list?: string) => (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} list={list}
      style={{ width: "100%", fontFamily: font, fontSize: 13, color: T.text, background: T.card, border: `1px solid ${T.border}`, borderRadius: 7, padding: "8px 12px", outline: "none", boxSizing: "border-box" as const }} />
  );

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: font, color: T.text, padding: "28px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Blank Catalog</h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Manage non-S&S blanks — brands, styles, colors, sizes, and costs</div>
        </div>
        <button onClick={openNew} style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + Add Entry
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 280px 1fr", gap: 0, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", minHeight: 500 }}>
        {/* Brands */}
        <div style={{ borderRight: `1px solid ${T.border}`, background: T.surface }}>
          <div style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.muted, borderBottom: `1px solid ${T.border}` }}>Brand</div>
          {loading ? <div style={{ padding: 16, color: T.muted, fontSize: 12 }}>Loading…</div> : brands.map(b => (
            <div key={b} onClick={() => { setSelectedBrand(b); setSelectedStyle(null); }}
              style={{ padding: "10px 14px", fontSize: 13, cursor: "pointer", background: selectedBrand === b ? T.accent : "transparent", color: selectedBrand === b ? "#fff" : T.text, borderBottom: `1px solid ${T.border}` }}>
              {b}
              <span style={{ fontSize: 10, color: selectedBrand === b ? "rgba(255,255,255,0.6)" : T.muted, marginLeft: 6 }}>
                {entries.filter(e => e.brand === b).length}
              </span>
            </div>
          ))}
          {brands.length === 0 && !loading && <div style={{ padding: 16, color: T.muted, fontSize: 12 }}>No brands yet — add an entry</div>}
        </div>

        {/* Styles */}
        <div style={{ borderRight: `1px solid ${T.border}`, background: T.surface }}>
          <div style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.muted, borderBottom: `1px solid ${T.border}` }}>Style</div>
          {!selectedBrand ? <div style={{ padding: 16, color: T.muted, fontSize: 12 }}>← Select a brand</div> : styles.map(s => (
            <div key={s} onClick={() => setSelectedStyle(s)}
              style={{ padding: "10px 14px", fontSize: 13, cursor: "pointer", background: selectedStyle === s ? T.card : "transparent", color: T.text, borderBottom: `1px solid ${T.border}`, borderLeft: selectedStyle === s ? `3px solid ${T.accent}` : "3px solid transparent" }}>
              {s}
            </div>
          ))}
        </div>

        {/* Colors / details */}
        <div style={{ background: T.bg }}>
          <div style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.muted, borderBottom: `1px solid ${T.border}` }}>Colors & Costs</div>
          {!selectedStyle ? <div style={{ padding: 16, color: T.muted, fontSize: 12 }}>← Select a style</div> : colors.length === 0 ? (
            <div style={{ padding: 16, color: T.muted, fontSize: 12 }}>No colors yet — click + Add Entry</div>
          ) : colors.map(entry => (
            <div key={entry.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{entry.color}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => openEdit(entry)} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 5, padding: "3px 10px", fontSize: 11, color: T.muted, cursor: "pointer" }}>Edit</button>
                  <button onClick={() => setConfirmDeleteId(entry.id)} style={{ background: "transparent", border: `1px solid ${T.red}`, borderRadius: 5, padding: "3px 10px", fontSize: 11, color: T.red, cursor: "pointer" }}>Delete</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                {entry.sizes.map(sz => (
                  <div key={sz} style={{ background: T.card, borderRadius: 5, padding: "4px 10px", fontSize: 11, fontFamily: mono }}>
                    <span style={{ color: T.muted, marginRight: 4 }}>{sz}</span>
                    <span style={{ color: T.green, fontWeight: 700 }}>${(entry.costs[sz] || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: T.surface, borderRadius: 12, padding: 28, width: 520, maxHeight: "90vh", overflowY: "auto" as const, border: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{editEntry ? "Edit Entry" : "Add Catalog Entry"}</span>
              <button onClick={() => setShowForm(false)} style={{ background: "transparent", border: "none", color: T.muted, fontSize: 20, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4 }}>BRAND</label>
                {inp(fBrand, setFBrand, "e.g. Comfort Colors", "brands-list")}
                <datalist id="brands-list">{brands.map(b => <option key={b} value={b} />)}</datalist>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4 }}>STYLE</label>
                {inp(fStyle, setFStyle, "e.g. 1717 - Heavyweight Tee")}
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 4 }}>COLOR</label>
                {inp(fColor, setFColor, "e.g. Black")}
              </div>

              <div>
                <label style={{ fontSize: 11, color: T.muted, display: "block", marginBottom: 8 }}>SIZES & COSTS</label>
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 10 }}>
                  {SIZE_ORDER.map(sz => (
                    <button key={sz} onClick={() => toggleSize(sz)}
                      style={{ padding: "4px 10px", fontSize: 11, fontFamily: mono, borderRadius: 5, border: `1px solid ${fSizes.includes(sz) ? T.accent : T.border}`, background: fSizes.includes(sz) ? T.accent + "33" : "transparent", color: fSizes.includes(sz) ? T.accent : T.muted, cursor: "pointer" }}>
                      {sz}
                    </button>
                  ))}
                </div>
                {fSizes.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    {[...fSizes].sort((a, b) => {
                      const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
                      if (ai === -1 && bi === -1) return a.localeCompare(b);
                      if (ai === -1) return 1; if (bi === -1) return -1;
                      return ai - bi;
                    }).map(sz => (
                      <div key={sz} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 40, fontSize: 12, fontFamily: mono, color: T.muted }}>{sz}</span>
                        <div style={{ position: "relative" as const, flex: 1 }}>
                          <span style={{ position: "absolute" as const, left: 10, top: "50%", transform: "translateY(-50%)", color: T.muted, fontSize: 13 }}>$</span>
                          <input type="number" step="0.01" value={fCosts[sz] || ""} onChange={e => setFCosts(c => ({ ...c, [sz]: e.target.value }))} placeholder="0.00"
                            style={{ width: "100%", fontFamily: mono, fontSize: 13, color: T.text, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px 6px 22px", outline: "none", boxSizing: "border-box" as const }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 0", fontSize: 13, color: T.muted, cursor: "pointer" }}>Cancel</button>
                <button onClick={save} disabled={saving || !fBrand.trim() || !fStyle.trim() || !fColor.trim() || fSizes.length === 0}
                  style={{ flex: 2, background: T.accent, border: "none", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Saving…" : editEntry ? "Save Changes" : "Add to Catalog"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete catalog entry"
        message="This will permanently remove this entry from the blank catalog."
        confirmLabel="Delete"
        onConfirm={() => confirmDeleteId && deleteEntry(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
