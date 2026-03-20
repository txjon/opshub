"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import StylePicker from "@/components/jobs/StylePicker";

type SelectedStyle = {
  styleID: number;
  styleName: string;
  brandName: string;
  colorName: string;
  colorCode: string;
  sizes: string[];
  totalStock: number;
};

export default function NewItemPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [form, setForm] = useState({
    name: "",
    blank_vendor: "",
    blank_sku: "",
    garment_type: "tee" as string,
    status: "tbd" as "tbd" | "confirmed",
    artwork_status: "not_started" as string,
    notes: "",
  });
  const [selectedSizes, setSelectedSizes] = useState<string[]>(["S","M","L","XL"]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleStyleSelect = (style: SelectedStyle) => {
    setForm(f => ({
      ...f,
      name: f.name || `${style.brandName} ${style.styleName} - ${style.colorName}`,
      blank_vendor: `${style.brandName} ${style.styleName}`,
      blank_sku: style.colorName,
    }));
    if (style.sizes.length > 0) setSelectedSizes(style.sizes);
    setShowPicker(false);
  };

  const toggleSize = (size: string) => {
    setSelectedSizes(prev =>
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data: item, error: itemError } = await supabase
        .from("items")
        .insert({
          job_id: params.id,
          name: form.name,
          blank_vendor: form.blank_vendor || null,
          blank_sku: form.blank_sku || null,
          garment_type: form.garment_type || null,
          status: form.status,
          artwork_status: form.artwork_status,
          notes: form.notes || null,
          sort_order: 0,
        })
        .select("id")
        .single();
      if (itemError) throw itemError;
      if (selectedSizes.length > 0) {
        const lines = selectedSizes.map(size => ({
          item_id: item.id, size,
          qty_ordered: 0, qty_shipped_from_vendor: 0,
          qty_received_at_hpd: 0, qty_shipped_to_customer: 0,
        }));
        const { error: lineError } = await supabase.from("buy_sheet_lines").insert(lines);
        if (lineError) throw lineError;
      }
      router.push(`/jobs/${params.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const inputClass = "w-full px-3 py-2 rounded-md bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary transition-colors";
  const labelClass = "block text-sm font-medium mb-1.5";
  const SIZES_STANDARD = ["XS","S","M","L","XL","2XL","3XL"];
  const SIZES_YOUTH = ["YS","YM","YL","YXL"];
  const SIZES_ONE_SIZE = ["OS"];

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
                <button type="button" onClick={() => { set("blank_vendor", ""); set("blank_sku", ""); }}
                  className="ml-auto text-muted-foreground hover:text-foreground text-xs">clear</button>
              </div>
            )}
            <div>
              <label className={labelClass}>Item Name *</label>
              <input value={form.name} onChange={e => set("name", e.target.value)} required
                placeholder="e.g. Tour Tee - Black" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Blank / Style</label>
                <input value={form.blank_vendor} onChange={e => set("blank_vendor", e.target.value)}
                  placeholder="e.g. Comfort Colors 1717" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Color</label>
                <input value={form.blank_sku} onChange={e => set("blank_sku", e.target.value)}
                  placeholder="e.g. Black" className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Garment Type</label>
                <select value={form.garment_type} onChange={e => set("garment_type", e.target.value)} className={inputClass}>
                  <option value="tee">Tee</option>
                  <option value="hoodie">Hoodie</option>
                  <option value="longsleeve">Longsleeve</option>
                  <option value="crewneck">Crewneck</option>
                  <option value="hat">Hat</option>
                  <option value="beanie">Beanie</option>
                  <option value="tote">Tote</option>
                  <option value="patch">Patch</option>
                  <option value="poster">Poster</option>
                  <option value="sticker">Sticker</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Status</label>
                <select value={form.status} onChange={e => set("status", e.target.value)} className={inputClass}>
                  <option value="tbd">TBD</option>
                  <option value="confirmed">Confirmed</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Artwork Status</label>
              <select value={form.artwork_status} onChange={e => set("artwork_status", e.target.value)} className={inputClass}>
                <option value="not_started">Not Started</option>
                <option value="in_progress">In Progress</option>
                <option value="approved">Approved</option>
                <option value="n_a">N/A</option>
              </select>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Sizes</h2>
            <div className="space-y-3">
              {[
                { label: "Standard", sizes: SIZES_STANDARD },
                { label: "Youth", sizes: SIZES_YOUTH },
                { label: "One Size", sizes: SIZES_ONE_SIZE },
              ].map(group => (
                <div key={group.label}>
                  <p className="text-xs text-muted-foreground mb-2">{group.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.sizes.map(size => (
                      <button key={size} type="button" onClick={() => toggleSize(size)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                          selectedSizes.includes(size)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                        }`}>
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <label className={labelClass}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
              placeholder="Any additional notes..." rows={3}
              className={inputClass + " resize-none"} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={loading}
              className="px-6 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {loading ? "Adding..." : "Add item"}
            </button>
            <button type="button" onClick={() => router.back()}
              className="px-6 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
