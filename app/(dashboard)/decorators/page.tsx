"use client";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono } from "@/lib/theme";

type PricingData = {
  qtys: number[];
  prices: Record<number, number[]>;
  tagPrices: number[];
  finishing: Record<string, number>;
  setup: Record<string, number>;
  specialty: Record<string, number>;
};

type Decorator = {
  id: string;
  name: string;
  short_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  capabilities: string[];
  lead_time_days: number | null;
  notes: string | null;
  pricing_data: PricingData | null;
};

const EMPTY_PRICING: PricingData = {
  qtys: [48, 72, 144, 288, 500, 1000, 2500],
  prices: { 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] },
  tagPrices: [],
  finishing: { Tee: 0, Longsleeve: 0, Fleece: 0 },
  setup: { Screens: 0, TagScreens: 0, Seps: 0, InkChange: 0 },
  specialty: { HangTag:0, HemTag:0, Applique:0, WaterBase:0, Glow:0, Shimmer:0, Metallic:0, Puff:0, HighDensity:0, Reflective:0, Foil:0 },
};

function Field({ label, value, onChange, placeholder, isMono, wide }: {
  label: string; value: string; onChange: (v:string)=>void; placeholder?: string; isMono?: boolean; wide?: boolean;
}) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      <div style={{ fontSize:10, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>{label}</div>
      {wide ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:font, fontSize:12, padding:"7px 10px", outline:"none", width:"100%", resize:"vertical", minHeight:60, lineHeight:1.5, boxSizing:"border-box" as const }} />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:isMono?mono:font, fontSize:12, padding:"7px 10px", outline:"none", width:"100%", boxSizing:"border-box" as const }} />
      )}
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return <div style={{ fontSize:10, fontWeight:700, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.08em", marginBottom:8, marginTop:4 }}>{title}</div>;
}

function NumCell({ value, onChange, width }: { value: number; onChange: (v:number)=>void; width?: number }) {
  return (
    <input type="text" inputMode="numeric" value={value || ""} placeholder="0"
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      style={{ width:width||58, textAlign:"center" as const, background:T.surface, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontFamily:mono, fontSize:11, padding:"4px 2px", outline:"none" }} />
  );
}

// ── Pricing Table Editor ────────────────────────────────────────────────────

function PricingEditor({ pricing, onChange }: { pricing: PricingData; onChange: (p:PricingData)=>void }) {
  const p = pricing;
  const colorCounts = Object.keys(p.prices).map(Number).sort((a,b)=>a-b);
  const maxColors = Math.max(...colorCounts, 1);

  const updateQty = (i: number, v: number) => {
    const qtys = [...p.qtys]; qtys[i] = v;
    onChange({ ...p, qtys });
  };
  const addQtyTier = () => {
    const last = p.qtys[p.qtys.length-1] || 0;
    const newQtys = [...p.qtys, last + 500];
    const newPrices = { ...p.prices };
    for (const c of Object.keys(newPrices)) { newPrices[Number(c)] = [...(newPrices[Number(c)]||[]), 0]; }
    const newTags = [...p.tagPrices, 0];
    onChange({ ...p, qtys: newQtys, prices: newPrices, tagPrices: newTags });
  };
  const removeQtyTier = (i: number) => {
    const newQtys = p.qtys.filter((_,idx)=>idx!==i);
    const newPrices = { ...p.prices };
    for (const c of Object.keys(newPrices)) { newPrices[Number(c)] = (newPrices[Number(c)]||[]).filter((_: number,idx: number)=>idx!==i); }
    const newTags = p.tagPrices.filter((_,idx)=>idx!==i);
    onChange({ ...p, qtys: newQtys, prices: newPrices, tagPrices: newTags });
  };
  const updatePrice = (colors: number, tierIdx: number, v: number) => {
    const newPrices = { ...p.prices };
    const arr = [...(newPrices[colors]||[])]; arr[tierIdx] = v;
    newPrices[colors] = arr;
    onChange({ ...p, prices: newPrices });
  };
  const updateTag = (i: number, v: number) => {
    const arr = [...p.tagPrices]; arr[i] = v;
    onChange({ ...p, tagPrices: arr });
  };
  const addColorRow = () => {
    const next = maxColors + 1;
    const newPrices = { ...p.prices, [next]: p.qtys.map(()=>0) };
    onChange({ ...p, prices: newPrices });
  };

  const thStyle = { padding:"4px 6px", fontSize:9, fontWeight:700, color:T.muted, fontFamily:mono, textTransform:"uppercase" as const, letterSpacing:"0.06em", textAlign:"center" as const, borderBottom:`1px solid ${T.border}` };
  const tdStyle = { padding:"3px 4px", textAlign:"center" as const, borderBottom:`1px solid ${T.border}22` };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Print pricing grid */}
      <div>
        <SectionHead title="Print Pricing (per unit by color count & qty)" />
        <div style={{ overflowX:"auto" as const }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, width:"100%" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign:"left" as const, width:80 }}>Colors</th>
                {p.qtys.map((q,i) => (
                  <th key={i} style={thStyle}>
                    <NumCell value={q} onChange={v=>updateQty(i,v)} width={52} />
                    <button onClick={()=>removeQtyTier(i)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:9, display:"block", margin:"2px auto 0" }}>✕</button>
                  </th>
                ))}
                <th style={thStyle}>
                  <button onClick={addQtyTier} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:4, color:T.muted, fontSize:10, padding:"2px 8px", cursor:"pointer" }}>+</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {colorCounts.map(c => (
                <tr key={c}>
                  <td style={{ ...tdStyle, textAlign:"left" as const, fontWeight:600, fontFamily:mono, color:T.accent, fontSize:11, padding:"4px 8px" }}>{c} color{c>1?"s":""}</td>
                  {p.qtys.map((_,i) => (
                    <td key={i} style={tdStyle}>
                      <NumCell value={(p.prices[c]||[])[i]||0} onChange={v=>updatePrice(c,i,v)} width={52} />
                    </td>
                  ))}
                  <td style={tdStyle} />
                </tr>
              ))}
              <tr>
                <td colSpan={p.qtys.length+2} style={{ padding:"4px 8px" }}>
                  <button onClick={addColorRow} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:4, color:T.muted, fontSize:10, fontFamily:font, padding:"3px 10px", cursor:"pointer" }}>+ Add color row</button>
                </td>
              </tr>
              {/* Tag pricing */}
              <tr>
                <td style={{ ...tdStyle, textAlign:"left" as const, fontWeight:600, fontFamily:mono, color:T.amber, fontSize:11, padding:"4px 8px" }}>Tag print</td>
                {p.qtys.map((_,i) => (
                  <td key={i} style={tdStyle}>
                    <NumCell value={p.tagPrices[i]||0} onChange={v=>updateTag(i,v)} width={52} />
                  </td>
                ))}
                <td style={tdStyle} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Finishing, Setup, Specialty in 3 columns */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
        <div>
          <SectionHead title="Finishing (per unit)" />
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {Object.entries(p.finishing).map(([k,v]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                <span style={{ fontSize:11, color:T.text, fontFamily:font }}>{k}</span>
                <NumCell value={v} onChange={val => onChange({...p, finishing:{...p.finishing, [k]:val}})} width={60} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionHead title="Setup Fees" />
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {Object.entries(p.setup).map(([k,v]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                <span style={{ fontSize:11, color:T.text, fontFamily:font }}>{k}</span>
                <NumCell value={v} onChange={val => onChange({...p, setup:{...p.setup, [k]:val}})} width={60} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionHead title="Specialty (per unit upcost)" />
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {Object.entries(p.specialty).map(([k,v]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                <span style={{ fontSize:11, color:T.text, fontFamily:font }}>{k}</span>
                <NumCell value={v} onChange={val => onChange({...p, specialty:{...p.specialty, [k]:val}})} width={60} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Ship From toggle ─────────────────────────────────────────────────────────

function ShipFromSection({ d, upd }: { d: any; upd: (u: any) => void }) {
  const hasData = !!(d.ship_from_address || d.ship_from_city || d.ship_from_state || d.ship_from_zip);
  const [showFields, setShowFields] = useState(hasData);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <div style={{ fontSize:10, fontWeight:700, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.08em" }}>Ship From (pickup)</div>
        <button onClick={() => {
          if (showFields) {
            upd({ ship_from_address: null, ship_from_city: null, ship_from_state: null, ship_from_zip: null });
            setShowFields(false);
          } else {
            setShowFields(true);
          }
        }} style={{ fontSize:10, color:showFields ? T.amber : T.accent, fontFamily:font, background:"none", border:`1px solid ${T.border}`, borderRadius:4, padding:"2px 8px", cursor:"pointer" }}>
          {showFields ? "Use same as ship-to" : "Different address"}
        </button>
      </div>
      {showFields ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <Field label="Street address" value={d.ship_from_address||""} onChange={v=>upd({ship_from_address:v})} placeholder="123 Pickup Ln" />
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:8 }}>
            <Field label="City" value={d.ship_from_city||""} onChange={v=>upd({ship_from_city:v})} placeholder="Las Vegas" />
            <Field label="State" value={d.ship_from_state||""} onChange={v=>upd({ship_from_state:v.toUpperCase()})} placeholder="NV" />
            <Field label="Zip" value={d.ship_from_zip||""} onChange={v=>upd({ship_from_zip:v})} placeholder="89101" isMono />
          </div>
        </div>
      ) : (
        <div style={{ fontSize:11, color:T.faint, fontFamily:font, padding:"8px 0" }}>Same as ship-to address</div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function DecoratorsPage() {
  const supabase = createClient();
  const [decorators, setDecorators] = useState<Decorator[]>([]);
  const [expanded, setExpanded] = useState<string|null>(null);
  const [saving, setSaving] = useState<Record<string,boolean>>({});
  const [adding, setAdding] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from("decorators").select("*").order("name");
    setDecorators((data || []) as Decorator[]);
  }

  function updateDecorator(id: string, updates: Partial<Decorator>) {
    setDecorators(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    // Debounce save
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    setSaving(p => ({...p, [id]: true}));
    saveTimers.current[id] = setTimeout(async () => {
      await supabase.from("decorators").update(updates).eq("id", id);
      setSaving(p => ({...p, [id]: false}));
    }, 1500);
  }

  async function addDecorator() {
    const { data } = await supabase.from("decorators").insert({ name: "New Decorator" }).select("id").single();
    if (data) {
      await load();
      setExpanded(data.id);
      setAdding(false);
    }
  }

  async function removeDecorator(id: string) {
    if (!confirm("Delete this decorator and all its assignments?")) return;
    await supabase.from("decorator_assignments").delete().eq("decorator_id", id);
    await supabase.from("decorators").delete().eq("id", id);
    if (expanded === id) setExpanded(null);
    load();
  }

  return (
    <div style={{ fontFamily:font, color:T.text, display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700 }}>Decorators</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{decorators.length} vendors</div>
        </div>
        <button onClick={addDecorator} style={{ background:T.accent, border:"none", borderRadius:7, color:"#fff", fontSize:12, fontFamily:font, fontWeight:600, padding:"7px 16px", cursor:"pointer" }}>
          + Add decorator
        </button>
      </div>

      {decorators.length === 0 && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:32, textAlign:"center" as const, color:T.muted, fontSize:13 }}>
          No decorators yet. Add your first one to start generating POs.
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {decorators.map(d => {
          const isOpen = expanded === d.id;
          const isSaving = saving[d.id];
          const upd = (updates: Partial<Decorator>) => updateDecorator(d.id, updates);

          return (
            <div key={d.id} style={{ background:T.card, border:`1px solid ${isOpen?T.accent:T.border}`, borderRadius:10, overflow:"hidden", transition:"border-color 0.15s" }}>
              {/* Header row — click to expand */}
              <div onClick={() => setExpanded(isOpen ? null : d.id)}
                style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:14, cursor:"pointer" }}>
                <div style={{ width:40, height:40, borderRadius:8, background:T.accentDim, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:mono, fontSize:11, fontWeight:700, color:T.accent, flexShrink:0 }}>
                  {(d.short_code||d.name.slice(0,3)).toUpperCase()}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:T.text }}>{d.name}</div>
                  <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>
                    {[d.contact_email||d.email, [d.city, d.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No details yet"}
                  </div>
                </div>
                {isSaving && <span style={{ fontSize:11, color:T.amber, fontFamily:font }}>Saving…</span>}
                {d.pricing_data ? (
                  <span style={{ fontSize:10, color:T.green, fontFamily:mono, background:T.greenDim, padding:"2px 8px", borderRadius:99 }}>Pricing set</span>
                ) : (
                  <span style={{ fontSize:10, color:T.faint, fontFamily:mono }}>No pricing</span>
                )}
                <span style={{ fontSize:12, color:T.muted }}>{isOpen ? "▲" : "▼"}</span>
              </div>

              {/* Expanded detail view */}
              {isOpen && (
                <div style={{ borderTop:`1px solid ${T.border}`, padding:"16px" }}>
                  {/* Contact + Address */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
                    <div>
                      <SectionHead title="Contact Info" />
                      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                        <Field label="Company name" value={d.name||""} onChange={v=>upd({name:v})} placeholder="ICON Printing" />
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                          <Field label="Short code" value={d.short_code||""} onChange={v=>upd({short_code:v.toUpperCase()})} placeholder="ICON" isMono />
                          <Field label="Lead time (days)" value={String(d.lead_time_days||"")} onChange={v=>upd({lead_time_days:parseInt(v)||null} as any)} placeholder="7" isMono />
                        </div>
                        <Field label="Contact name" value={d.contact_name||""} onChange={v=>upd({contact_name:v})} placeholder="John Smith" />
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                          <Field label="Email" value={d.contact_email||d.email||""} onChange={v=>upd({contact_email:v, email:v})} placeholder="orders@printer.com" />
                          <Field label="Phone" value={d.contact_phone||d.phone||""} onChange={v=>upd({contact_phone:v, phone:v})} placeholder="(702) 555-0100" />
                        </div>
                      </div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                      <div>
                        <SectionHead title="Ship To (receiving blanks)" />
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          <Field label="Street address" value={d.address||""} onChange={v=>upd({address:v})} placeholder="123 Print Ave" />
                          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:8 }}>
                            <Field label="City" value={d.city||""} onChange={v=>upd({city:v})} placeholder="Las Vegas" />
                            <Field label="State" value={d.state||""} onChange={v=>upd({state:v.toUpperCase()})} placeholder="NV" />
                            <Field label="Zip" value={d.zip||""} onChange={v=>upd({zip:v})} placeholder="89101" isMono />
                          </div>
                        </div>
                      </div>
                      <ShipFromSection d={d} upd={upd} />
                      <Field label="Notes" value={d.notes||""} onChange={v=>upd({notes:v})} placeholder="Dock hours, special instructions..." wide />
                    </div>
                  </div>

                  {/* Pricing */}
                  <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:16 }}>
                    {d.pricing_data ? (
                      <PricingEditor pricing={d.pricing_data} onChange={pd => upd({pricing_data:pd} as any)} />
                    ) : (
                      <div style={{ textAlign:"center" as const, padding:"20px 0" }}>
                        <div style={{ fontSize:12, color:T.muted, marginBottom:10 }}>No pricing table yet</div>
                        <button onClick={() => upd({pricing_data: EMPTY_PRICING} as any)}
                          style={{ background:T.accent, border:"none", borderRadius:7, color:"#fff", fontSize:12, fontFamily:font, fontWeight:600, padding:"7px 16px", cursor:"pointer" }}>
                          Set up pricing
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Delete */}
                  <div style={{ borderTop:`1px solid ${T.border}`, marginTop:16, paddingTop:12, display:"flex", justifyContent:"flex-end" }}>
                    <button onClick={() => removeDecorator(d.id)}
                      style={{ background:"transparent", border:`1px solid ${T.redDim}`, borderRadius:6, color:T.red, fontSize:11, fontFamily:font, padding:"5px 14px", cursor:"pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.redDim)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      Delete decorator
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
