"use client";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono } from "@/lib/theme";
import { FALLBACK_PRINTERS } from "./legacy-pricing";

type PricingData = {
  qtys: number[];
  prices: Record<number, number[]>;
  tagPrices: number[];
  packaging: Record<string, number>;
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
  packaging: { Tee: 0, Longsleeve: 0, Fleece: 0 },
  finishing: {},
  setup: { Screens: 0, TagScreens: 0, Seps: 0, InkChange: 0 },
  specialty: {},
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

function NumCell({ value, onChange, width, gridId, row, col }: { value: number; onChange: (v:number)=>void; width?: number; gridId?: string; row?: number; col?: number }) {
  const [local, setLocal] = useState<string|null>(null);
  const display = local !== null ? local : (value ? String(value) : "");
  const commit = (raw: string) => { setLocal(null); onChange(parseFloat(raw) || 0); };
  const moveTo = (r: number, c: number) => {
    const el = document.querySelector(`[data-grid="${gridId}"][data-row="${r}"][data-col="${c}"]`) as HTMLInputElement;
    if (el) { el.focus(); el.select(); }
  };
  return (
    <input type="text" inputMode="decimal" value={display} placeholder="0"
      data-grid={gridId} data-row={row} data-col={col}
      onChange={e => setLocal(e.target.value)}
      onFocus={e => { setLocal(String(value || "")); e.target.select(); }}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); commit(e.currentTarget.value); if(gridId!==undefined) moveTo(row!, col! + 1); }
        if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); commit(e.currentTarget.value); if(gridId!==undefined) moveTo(row!, col! - 1); }
        if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); commit(e.currentTarget.value); if(gridId!==undefined) moveTo(row! + 1, col!); }
        if (e.key === "ArrowUp") { e.preventDefault(); commit(e.currentTarget.value); if(gridId!==undefined) moveTo(row! - 1, col!); }
        if (gridId!==undefined && e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) { e.preventDefault(); commit(e.currentTarget.value); moveTo(row!, col! + 1); }
        if (gridId!==undefined && e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) { e.preventDefault(); commit(e.currentTarget.value); moveTo(row!, col! - 1); }
      }}
      style={{ width:width||48, textAlign:"center" as const, background:T.surface, border:`1px solid ${T.border}`, borderRadius:3, color:T.text, fontFamily:mono, fontSize:10, padding:"3px 1px", outline:"none" }} />
  );
}

// ── Editable key-value section (finishing, setup, specialty) ─────────────────

function KeyValueSection({ title, data, onUpdate }: { title: string; data: Record<string,number>; onUpdate: (d: Record<string,number>)=>void }) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [editingKey, setEditingKey] = useState<string|null>(null);
  const [editKeyVal, setEditKeyVal] = useState("");

  const handleAdd = () => {
    const k = newKey.trim();
    if (!k || data[k] !== undefined) return;
    onUpdate({...data, [k]: 0});
    setNewKey("");
    setAdding(false);
  };

  const handleRename = (oldKey: string) => {
    const nk = editKeyVal.trim();
    if (!nk || (nk !== oldKey && data[nk] !== undefined)) { setEditingKey(null); return; }
    if (nk === oldKey) { setEditingKey(null); return; }
    const newData: Record<string,number> = {};
    for (const [k,v] of Object.entries(data)) {
      newData[k === oldKey ? nk : k] = v;
    }
    onUpdate(newData);
    setEditingKey(null);
  };

  const handleDelete = (key: string) => {
    const newData = {...data};
    delete newData[key];
    onUpdate(newData);
  };

  const inp = { background:T.surface, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontFamily:font, fontSize:11, padding:"3px 6px", outline:"none", width:90 };

  return (
    <div>
      <SectionHead title={title} />
      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
        {Object.entries(data).map(([k,v]) => (
          <div key={k} style={{ display:"flex", alignItems:"center", gap:6 }}>
            {editingKey === k ? (
              <input value={editKeyVal} onChange={e=>setEditKeyVal(e.target.value)}
                onBlur={()=>handleRename(k)} onKeyDown={e=>e.key==="Enter"&&handleRename(k)}
                autoFocus style={{...inp, flex:1}} />
            ) : (
              <span onClick={()=>{setEditingKey(k);setEditKeyVal(k);}}
                style={{ fontSize:11, color:T.text, fontFamily:font, flex:1, cursor:"text", padding:"3px 0" }}>{k}</span>
            )}
            <NumCell value={v} onChange={val => onUpdate({...data, [k]:val})} width={56} />
            <button onClick={()=>handleDelete(k)}
              style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:11, padding:"0 2px", lineHeight:1 }}
              onMouseEnter={e=>e.currentTarget.style.color=T.red}
              onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
          </div>
        ))}
        {adding ? (
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            <input value={newKey} onChange={e=>setNewKey(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")handleAdd();if(e.key==="Escape"){setAdding(false);setNewKey("");}}}
              placeholder="Name..." autoFocus style={{...inp, flex:1}} />
            <button onClick={handleAdd} style={{ background:T.accent, border:"none", borderRadius:4, color:"#fff", fontSize:10, padding:"3px 8px", cursor:"pointer" }}>Add</button>
            <button onClick={()=>{setAdding(false);setNewKey("");}} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:11 }}>✕</button>
          </div>
        ) : (
          <button onClick={()=>setAdding(true)}
            style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:4, color:T.muted, fontSize:10, fontFamily:font, padding:"3px 8px", cursor:"pointer", marginTop:2, alignSelf:"flex-start" }}>
            + Add
          </button>
        )}
      </div>
    </div>
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

  const tagRowIdx = colorCounts.length;
  const thStyle = { padding:"2px 3px", fontSize:8, fontWeight:700, color:T.muted, fontFamily:mono, textTransform:"uppercase" as const, letterSpacing:"0.04em", textAlign:"center" as const, borderBottom:`1px solid ${T.border}` };
  const tdStyle = { padding:"1px 2px", textAlign:"center" as const, borderBottom:`1px solid ${T.border}15` };
  const gid = "pricing";

  return (
    <div style={{ display:"flex", gap:20, alignItems:"flex-start" }}>
      {/* Print pricing grid */}
      <div style={{ flexShrink:0 }}>
        <SectionHead title="Print Pricing (per unit by color count & qty)" />
        <div style={{ overflowX:"auto" as const }}>
          <table style={{ borderCollapse:"collapse", fontSize:10 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign:"left" as const, width:65, padding:"2px 4px" }}>Colors</th>
                {p.qtys.map((q,i) => (
                  <th key={i} style={thStyle}>
                    <NumCell value={q} onChange={v=>updateQty(i,v)} width={44} gridId={gid} row={-1} col={i} />
                    <button onClick={()=>removeQtyTier(i)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:8, display:"block", margin:"1px auto 0" }}>✕</button>
                  </th>
                ))}
                <th style={thStyle}>
                  <button onClick={addQtyTier} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:3, color:T.muted, fontSize:9, padding:"1px 6px", cursor:"pointer" }}>+</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {colorCounts.map((c, rowIdx) => (
                <tr key={c}>
                  <td style={{ ...tdStyle, textAlign:"left" as const, fontWeight:600, fontFamily:mono, color:T.accent, fontSize:10, padding:"1px 4px" }}>{c}c</td>
                  {p.qtys.map((_,i) => (
                    <td key={i} style={tdStyle}>
                      <NumCell value={(p.prices[c]||[])[i]||0} onChange={v=>updatePrice(c,i,v)} width={44} gridId={gid} row={rowIdx} col={i} />
                    </td>
                  ))}
                  <td style={tdStyle} />
                </tr>
              ))}
              <tr>
                <td colSpan={p.qtys.length+2} style={{ padding:"2px 4px" }}>
                  <button onClick={addColorRow} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:3, color:T.muted, fontSize:9, fontFamily:font, padding:"2px 8px", cursor:"pointer" }}>+ color row</button>
                </td>
              </tr>
              {/* Tag pricing */}
              <tr>
                <td style={{ ...tdStyle, textAlign:"left" as const, fontWeight:600, fontFamily:mono, color:T.amber, fontSize:10, padding:"1px 4px" }}>Tag</td>
                {p.qtys.map((_,i) => (
                  <td key={i} style={tdStyle}>
                    <NumCell value={p.tagPrices[i]||0} onChange={v=>updateTag(i,v)} width={44} gridId={gid} row={tagRowIdx} col={i} />
                  </td>
                ))}
                <td style={tdStyle} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Packaging, Finishing, Setup, Specialty on the right */}
      <div style={{ flex:1, minWidth:0, display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12, alignItems:"flex-start" }}>
        <KeyValueSection title="Packaging (per unit)" data={p.packaging||{}}
          onUpdate={packaging => onChange({...p, packaging})} />
        <KeyValueSection title="Finishing (per unit)" data={p.finishing}
          onUpdate={finishing => onChange({...p, finishing})} />
        <KeyValueSection title="Setup Fees" data={p.setup}
          onUpdate={setup => onChange({...p, setup})} />
        <KeyValueSection title="Specialty (per unit upcost)" data={p.specialty}
          onUpdate={specialty => onChange({...p, specialty})} />
      </div>
    </div>
  );
}

// ── Decorator Contacts (multiple per decorator) ──────────────────────────────

function DecoratorContacts({ contacts, onChange }: { contacts: any[]; onChange: (list: any[])=>void }) {
  const [adding, setAdding] = useState(false);
  const inp = { background:T.surface, border:`1px solid ${T.border}`, borderRadius:4, color:T.text, fontFamily:font, fontSize:11, padding:"5px 8px", outline:"none", width:"100%" as const, boxSizing:"border-box" as const };

  const addContact = () => {
    const name = (document.getElementById("dc-name") as HTMLInputElement)?.value.trim();
    const email = (document.getElementById("dc-email") as HTMLInputElement)?.value.trim();
    const phone = (document.getElementById("dc-phone") as HTMLInputElement)?.value.trim();
    const role = (document.getElementById("dc-role") as HTMLInputElement)?.value.trim();
    if (!name && !email) return;
    onChange([...contacts, { name: name||"", email: email||"", phone: phone||"", role: role||"" }]);
    setAdding(false);
  };

  const removeContact = (idx: number) => onChange(contacts.filter((_: any, i: number) => i !== idx));

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <div style={{ fontSize:10, fontWeight:700, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.08em" }}>Contacts</div>
        <button onClick={()=>setAdding(!adding)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:4, color:T.muted, fontSize:10, padding:"2px 8px", cursor:"pointer" }}>+ Add</button>
      </div>
      {adding && (
        <div style={{ background:T.surface, border:`1px solid ${T.accent}44`, borderRadius:6, padding:8, marginBottom:8 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
            <input id="dc-name" placeholder="Name" style={inp} onKeyDown={e=>e.key==="Enter"&&addContact()} />
            <input id="dc-email" placeholder="Email" style={inp} onKeyDown={e=>e.key==="Enter"&&addContact()} />
            <input id="dc-phone" placeholder="Phone" style={inp} onKeyDown={e=>e.key==="Enter"&&addContact()} />
            <input id="dc-role" placeholder="Role (e.g. Sales, Production)" style={inp} onKeyDown={e=>e.key==="Enter"&&addContact()} />
          </div>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={addContact} style={{ background:T.green, border:"none", borderRadius:4, color:"#fff", fontSize:10, fontWeight:600, padding:"4px 10px", cursor:"pointer" }}>Save</button>
            <button onClick={()=>setAdding(false)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:4, color:T.muted, fontSize:10, padding:"4px 8px", cursor:"pointer" }}>Cancel</button>
          </div>
        </div>
      )}
      {contacts.length === 0 && !adding && <div style={{ fontSize:11, color:T.faint, fontFamily:font, padding:"4px 0" }}>No contacts yet</div>}
      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
        {contacts.map((c: any, i: number) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", background:T.surface, borderRadius:6 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{c.name||c.email} {c.role && <span style={{ fontWeight:400, color:T.muted, fontSize:10 }}>· {c.role}</span>}</div>
              <div style={{ fontSize:10, color:T.muted }}>{[c.email, c.phone].filter(Boolean).join(" · ")}</div>
            </div>
            <button onClick={()=>removeContact(i)} style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:11 }}
              onMouseEnter={e=>e.currentTarget.style.color=T.red}
              onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
          </div>
        ))}
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
                    {[((d as any).contacts_list||[]).length > 0 ? `${(d as any).contacts_list.length} contact${(d as any).contacts_list.length>1?"s":""}` : (d.contact_email||d.email), [d.city, d.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No details yet"}
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
                      <SectionHead title="Company Info" />
                      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
                        <Field label="Company name" value={d.name||""} onChange={v=>upd({name:v})} placeholder="ICON Printing" />
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                          <Field label="Short code" value={d.short_code||""} onChange={v=>upd({short_code:v.toUpperCase()})} placeholder="ICON" isMono />
                          <Field label="Lead time (days)" value={String(d.lead_time_days||"")} onChange={v=>upd({lead_time_days:parseInt(v)||null} as any)} placeholder="7" isMono />
                        </div>
                      </div>
                      <DecoratorContacts contacts={(d as any).contacts_list||[]} onChange={list=>upd({contacts_list:list} as any)} />
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
                        <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
                          <button onClick={() => upd({pricing_data: EMPTY_PRICING} as any)}
                            style={{ background:T.accent, border:"none", borderRadius:7, color:"#fff", fontSize:12, fontFamily:font, fontWeight:600, padding:"7px 16px", cursor:"pointer" }}>
                            Start from scratch
                          </button>
                          {(() => {
                            const key = d.short_code || d.name;
                            const legacy = FALLBACK_PRINTERS[key] || FALLBACK_PRINTERS[key.toUpperCase()];
                            if (!legacy) return null;
                            return (
                              <button onClick={() => upd({pricing_data: JSON.parse(JSON.stringify(legacy))} as any)}
                                style={{ background:T.green, border:"none", borderRadius:7, color:"#fff", fontSize:12, fontFamily:font, fontWeight:600, padding:"7px 16px", cursor:"pointer" }}>
                                Load existing pricing
                              </button>
                            );
                          })()}
                        </div>
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
