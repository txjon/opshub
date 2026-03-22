"use client";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect } from "react";

const T = {
  bg:"#0f1117", surface:"#181c27", card:"#1e2333", border:"#2a3050",
  text:"#e8eaf2", muted:"#7a82a0", faint:"#3a4060",
  accent:"#4f8ef7", accentDim:"#1e3a6e",
  green:"#34c97a", amber:"#f5a623", red:"#f05353",
};
const font = `'IBM Plex Sans','Helvetica Neue',Arial,sans-serif`;
const mono = `'IBM Plex Mono','Courier New',monospace`;

type Decorator = {
  id: string;
  name: string;
  short_code: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

const EMPTY: Omit<Decorator,"id"> = {
  name:"", short_code:"", email:"", address:"", city:"", state:"", zip:"", notes:""
};

function Field({ label, value, onChange, placeholder, mono: isMono }: {
  label: string; value: string; onChange: (v:string)=>void; placeholder?: string; mono?: boolean;
}) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <div style={{ fontSize:10, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>{label}</div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background:T.surface, border:`1px solid ${T.border}`, borderRadius:6,
          color:T.text, fontFamily:isMono?mono:font, fontSize:12,
          padding:"7px 10px", outline:"none", width:"100%"
        }}
      />
    </div>
  );
}

export default function DecoratorsPage() {
  const supabase = createClient();
  const [decorators, setDecorators] = useState<Decorator[]>([]);
  const [editing, setEditing] = useState<string|null>(null);
  const [form, setForm] = useState<Omit<Decorator,"id">>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from("decorators").select("*").order("name");
    setDecorators(data || []);
  }

  async function save() {
    setSaving(true);
    if (editing) {
      await supabase.from("decorators").update(form).eq("id", editing);
    } else {
      await supabase.from("decorators").insert(form);
    }
    setSaving(false);
    setEditing(null);
    setAdding(false);
    setForm(EMPTY);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this decorator?")) return;
    await supabase.from("decorators").delete().eq("id", id);
    load();
  }

  function startEdit(d: Decorator) {
    setEditing(d.id);
    setForm({ name:d.name, short_code:d.short_code||"", email:d.email||"", address:d.address||"", city:d.city||"", state:d.state||"", zip:d.zip||"", notes:d.notes||"" });
    setAdding(false);
  }

  function startAdd() {
    setAdding(true);
    setEditing(null);
    setForm(EMPTY);
  }

  function cancel() {
    setEditing(null);
    setAdding(false);
    setForm(EMPTY);
  }

  const showForm = adding || editing !== null;

  return (
    <div style={{ fontFamily:font, color:T.text, display:"flex", flexDirection:"column", gap:16 }}>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700 }}>Decorators</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{decorators.length} vendors</div>
        </div>
        {!showForm && (
          <button onClick={startAdd} style={{ background:T.accent, border:"none", borderRadius:7, color:"#fff", fontSize:12, fontFamily:font, fontWeight:600, padding:"7px 16px", cursor:"pointer" }}>
            + Add decorator
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background:T.card, border:`1px solid ${T.accent}44`, borderRadius:10, padding:16 }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:14 }}>{editing ? "Edit decorator" : "New decorator"}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:12 }}>
            <Field label="Name" value={form.name} onChange={v=>setForm(p=>({...p,name:v}))} placeholder="ICON Printing" />
            <Field label="Short code" value={form.short_code} onChange={v=>setForm(p=>({...p,short_code:v.toUpperCase()}))} placeholder="ICON" mono />
            <Field label="Email" value={form.email} onChange={v=>setForm(p=>({...p,email:v}))} placeholder="orders@iconprinting.com" />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", gap:12, marginBottom:12 }}>
            <Field label="Address" value={form.address} onChange={v=>setForm(p=>({...p,address:v}))} placeholder="123 Print Ave" />
            <Field label="City" value={form.city} onChange={v=>setForm(p=>({...p,city:v}))} placeholder="Las Vegas" />
            <Field label="State" value={form.state} onChange={v=>setForm(p=>({...p,state:v.toUpperCase()}))} placeholder="NV" />
            <Field label="Zip" value={form.zip} onChange={v=>setForm(p=>({...p,zip:v}))} placeholder="89101" mono />
          </div>
          <div style={{ marginBottom:14 }}>
            <Field label="Notes" value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} placeholder="Any notes about this decorator..." />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={save} disabled={!form.name || saving} style={{ background:T.green, border:"none", borderRadius:7, color:"#fff", fontSize:12, fontFamily:font, fontWeight:600, padding:"7px 16px", cursor:"pointer", opacity:!form.name||saving?0.5:1 }}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button onClick={cancel} style={{ background:"transparent", border:`1px solid ${T.border}`, borderRadius:7, color:T.muted, fontSize:12, fontFamily:font, padding:"7px 14px", cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {decorators.length === 0 && !showForm && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:32, textAlign:"center" as const, color:T.muted, fontSize:13 }}>
          No decorators yet. Add your first one to start generating POs.
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {decorators.map(d => (
          <div key={d.id} style={{ background:T.card, border:`1px solid ${editing===d.id?T.accent:T.border}`, borderRadius:10, padding:"12px 16px", display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ width:40, height:40, borderRadius:8, background:T.accentDim, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:mono, fontSize:11, fontWeight:700, color:T.accent, flexShrink:0 }}>
              {(d.short_code||d.name.slice(0,3)).toUpperCase()}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{d.name}</div>
              <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>
                {[d.email, [d.city, d.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
              </div>
            </div>
            {d.notes && (
              <div style={{ fontSize:10, color:T.muted, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{d.notes}</div>
            )}
            <div style={{ display:"flex", gap:6, flexShrink:0 }}>
              <button onClick={()=>startEdit(d)} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, fontSize:11, fontFamily:font, padding:"4px 12px", cursor:"pointer" }}>Edit</button>
              <button onClick={()=>remove(d.id)} style={{ background:"transparent", border:`1px solid ${T.border}`, borderRadius:6, color:T.red, fontSize:11, fontFamily:font, padding:"4px 12px", cursor:"pointer" }}>Delete</button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
