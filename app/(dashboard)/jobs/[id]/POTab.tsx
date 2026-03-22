"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const T = {
  bg:"#0f1117", surface:"#181c27", card:"#1e2333", border:"#2a3050",
  text:"#e8eaf2", muted:"#7a82a0", faint:"#3a4060",
  accent:"#4f8ef7", accentDim:"#1e3a6e",
  green:"#34c97a", greenDim:"#0e3d24",
  amber:"#f5a623", amberDim:"#3d2a08",
  red:"#f05353",
};
const font = `'IBM Plex Sans','Helvetica Neue',Arial,sans-serif`;
const mono = `'IBM Plex Mono','Courier New',monospace`;

type Item = {
  id: string;
  name: string;
  style?: string;
  color?: string;
  sort_order?: number;
  blank_vendor?: string;
  drive_link?: string;
  incoming_goods?: string;
  production_notes_po?: string;
  packing_notes?: string;
  buy_sheet_lines?: { size: string; qty_ordered: number }[];
};

type Decorator = {
  id: string;
  name: string;
  short_code: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

type ShipMethod = {
  id: string;
  name: string;
  account_number: string;
};

type CostingData = {
  costProds?: any[];
};

const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];

function sortSizes(lines: {size:string;qty_ordered:number}[]) {
  return [...lines].sort((a,b) => {
    const ai = SIZE_ORDER.indexOf(a.size); const bi = SIZE_ORDER.indexOf(b.size);
    return (ai===-1?99:ai) - (bi===-1?99:bi);
  }).filter(l => l.qty_ordered > 0);
}

function fmtD(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function EditableField({ label, value, onChange, placeholder, textarea }: {
  label: string; value: string; onChange:(v:string)=>void; placeholder?:string; textarea?:boolean;
}) {
  const base = { background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:font, fontSize:12, padding:"6px 10px", outline:"none", width:"100%", resize:"vertical" as const };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      <div style={{ fontSize:9, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>{label}</div>
      {textarea
        ? <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{...base, minHeight:56}} />
        : <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={base} />
      }
    </div>
  );
}

export function POTab({ project, items, costingData }: {
  project: any;
  items: Item[];
  costingData: CostingData | null;
}) {
  const supabase = createClient();
  const [decorators, setDecorators] = useState<Decorator[]>([]);
  const [shipMethods, setShipMethods] = useState<ShipMethod[]>([]);
  const [selectedShipMethod, setSelectedShipMethod] = useState<string>("");
  const [itemFields, setItemFields] = useState<Record<string, {drive_link:string; incoming_goods:string; production_notes_po:string; packing_notes:string}>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const poRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const [{ data: decs }, { data: ships }] = await Promise.all([
        supabase.from("decorators").select("*").order("name"),
        supabase.from("ship_methods").select("*").order("name"),
      ]);
      setDecorators(decs || []);
      setShipMethods(ships || []);
    }
    load();
  }, []);

  useEffect(() => {
    const fields: typeof itemFields = {};
    items.forEach(it => {
      const cp = costingData?.costProds?.find((p:any) => p.id === it.id);
      // Auto-populate incoming_goods from supplier if not already set
      const autoIncoming = cp?.supplier ? `Blanks from ${cp.supplier}` : "";
      fields[it.id] = {
        drive_link: it.drive_link || "",
        incoming_goods: it.incoming_goods || autoIncoming,
        production_notes_po: it.production_notes_po || "",
        packing_notes: it.packing_notes || "",
      };
    });
    setItemFields(fields);
  }, [items, costingData]);

  // Decorator is resolved per-item from costing data printVendor
  const getDecoratorByName = (name: string) => decorators.find(d => d.name === name || d.short_code === name);
  const shipMethod = shipMethods.find(s => s.id === selectedShipMethod);

  const sortedItems = [...items].sort((a,b) => (a.sort_order||0)-(b.sort_order||0));

  // Get costing data per item
  function getCostingForItem(itemId: string) {
    return costingData?.costProds?.find((p:any) => p.id === itemId);
  }

  function getTotalUnits(lines?: {size:string;qty_ordered:number}[]) {
    return (lines||[]).reduce((a,l) => a+(l.qty_ordered||0), 0);
  }

  async function saveItemFields() {
    setSaving(true);
    for (const [id, fields] of Object.entries(itemFields)) {
      await supabase.from("items").update(fields).eq("id", id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function getItemLetter(idx: number) {
    return String.fromCharCode(65 + idx);
  }

  const today = new Date().toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
  const shipDate = project?.target_ship_date
    ? new Date(project.target_ship_date).toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" })
    : "—";

  const totalUnitsAll = sortedItems.reduce((a,it) => a + getTotalUnits(it.buy_sheet_lines), 0);

  // Build PO number from job number
  const poNumber = project?.job_number || "—";

  const sec = (label: string) => (
    <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:T.muted, marginBottom:4, paddingBottom:3, borderBottom:`0.5px solid ${T.border}` }}>{label}</div>
  );

  return (
    <div style={{ fontFamily:font, color:T.text, display:"flex", flexDirection:"column", gap:16 }}>

      {/* PO Setup - decorator comes from costing tab per item, ship method set here */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:14 }}>
        <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase" as const, letterSpacing:"0.08em", marginBottom:12 }}>PO Setup</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <div style={{ fontSize:9, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>Ship method</div>
            <select value={selectedShipMethod} onChange={e=>setSelectedShipMethod(e.target.value)}
              style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:selectedShipMethod?T.text:T.muted, fontFamily:font, fontSize:12, padding:"6px 10px", outline:"none", cursor:"pointer" }}>
              <option value="">— select method —</option>
              {shipMethods.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <div style={{ fontSize:9, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>Ship acct. no.</div>
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:shipMethod?.account_number?T.text:T.faint, fontFamily:mono, fontSize:12, padding:"6px 10px" }}>
              {shipMethod?.account_number || "—"}
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            <div style={{ fontSize:9, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>Decorators on this PO</div>
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:font, fontSize:12, padding:"6px 10px" }}>
              {[...new Set((costingData?.costProds||[]).map((p:any)=>p.printVendor).filter(Boolean))].join(", ") || "—"}
            </div>
          </div>
        </div>
        {(costingData?.costProds||[]).some((p:any)=>!p.printVendor) && (
          <div style={{ marginTop:10, fontSize:11, color:T.amber, background:T.amberDim, borderRadius:6, padding:"6px 10px" }}>
            Some items don't have a decorator assigned. Go to the Costing tab and select a vendor for each item.
          </div>
        )}
      </div>

      {/* Item fields */}
      {sortedItems.map((item, idx) => (
        <div key={item.id} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
          <div style={{ background:"#2a2f42", padding:"8px 14px", display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ background:T.accentDim, color:T.accent, fontFamily:mono, fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:5 }}>{getItemLetter(idx)}</span>
            <span style={{ fontSize:13, fontWeight:600 }}>{item.name}</span>
            <span style={{ fontSize:11, color:T.muted, marginLeft:4 }}>{[item.style, item.color].filter(Boolean).join(" · ")}</span>
            {getCostingForItem(item.id)?.printVendor && (
              <span style={{ marginLeft:"auto", fontSize:10, color:T.accent, background:T.accentDim, padding:"2px 8px", borderRadius:4, fontFamily:mono }}>
                {getCostingForItem(item.id)?.printVendor}
              </span>
            )}
          </div>
          <div style={{ padding:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <EditableField label="Google Drive link" value={itemFields[item.id]?.drive_link||""} onChange={v=>setItemFields(p=>({...p,[item.id]:{...p[item.id],drive_link:v}}))} placeholder="https://drive.google.com/..." />
            <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ fontSize:9, color:T.muted, fontFamily:font, textTransform:"uppercase" as const, letterSpacing:"0.07em" }}>Incoming goods</div>
                {getCostingForItem(item.id)?.supplier && <span style={{ fontSize:9, color:T.accent, fontFamily:font }}>auto from costing</span>}
              </div>
              <input value={itemFields[item.id]?.incoming_goods||""} onChange={e=>setItemFields(p=>({...p,[item.id]:{...p[item.id],incoming_goods:e.target.value}}))} placeholder="e.g. Blanks from S&S"
                style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, color:T.text, fontFamily:font, fontSize:12, padding:"6px 10px", outline:"none", width:"100%" }} />
            </div>
            <EditableField label="Production notes" value={itemFields[item.id]?.production_notes_po||""} onChange={v=>setItemFields(p=>({...p,[item.id]:{...p[item.id],production_notes_po:v}}))} placeholder="e.g. Photo proof required" textarea />
            <EditableField label="Packing / shipping notes" value={itemFields[item.id]?.packing_notes||""} onChange={v=>setItemFields(p=>({...p,[item.id]:{...p[item.id],packing_notes:v}}))} placeholder="e.g. Consolidate into fewest boxes" textarea />
          </div>
        </div>
      ))}

      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <button onClick={saveItemFields} disabled={saving}
          style={{ background:T.green, border:"none", borderRadius:7, color:"#fff", fontSize:12, fontFamily:font, fontWeight:600, padding:"7px 16px", cursor:"pointer", opacity:saving?0.6:1 }}>
          {saving ? "Saving..." : "Save fields"}
        </button>
        {saved && <span style={{ fontSize:11, color:T.green }}>Saved</span>}
      </div>

      {/* PO Preview */}
      {selectedShipMethod && (
        <>
          <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase" as const, letterSpacing:"0.08em", marginTop:4 }}>PO Preview</div>
          <div ref={poRef} style={{ background:"#fff", color:"#1a1a1a", borderRadius:10, padding:"36px 40px", fontFamily:"'Helvetica Neue',Arial,sans-serif", fontSize:11, lineHeight:1.5 }}>

            {/* Doc header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", paddingBottom:18, borderBottom:"2px solid #1a1a1a", marginBottom:18 }}>
              <div style={{ fontSize:20, fontWeight:800, letterSpacing:-1, lineHeight:1.1 }}>house party<br/><span style={{ color:"#aaa", fontWeight:300 }}>distro</span></div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:20, fontWeight:700, letterSpacing:2 }}>PURCHASE ORDER</div>
                <div style={{ fontSize:10, color:"#888", marginTop:2 }}>{project?.clients?.name || ""} · {[...new Set((costingData?.costProds||[]).map((p:any)=>p.printVendor).filter(Boolean))].join(", ")}</div>
              </div>
            </div>

            {/* PO Meta */}
            <div style={{ display:"flex", gap:0, border:"0.5px solid #ccc", marginBottom:16 }}>
              {[
                ["Date", today],
                ["PO #", poNumber],
                ["Ship date", shipDate],
                ["Vendor ID", [...new Set((costingData?.costProds||[]).map((p:any)=>p.printVendor).filter(Boolean))].join(", ") || "—"],
                ["Ship method", shipMethod?.name || "—"],
                ["Ship acct.", shipMethod?.account_number || "—"],
              ].map(([k,v], i, arr) => (
                <div key={k} style={{ flex:1, padding:"5px 8px", borderRight:i<arr.length-1?"0.5px solid #ccc":"none" }}>
                  <div style={{ fontSize:7.5, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#aaa", marginBottom:2 }}>{k}</div>
                  <div style={{ fontSize:10, fontWeight:600, color:"#1a1a1a" }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Addresses */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:16 }}>
              <div>
                <div style={{ fontSize:8, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#aaa", marginBottom:6 }}>Bill to</div>
                <div style={{ fontSize:10, lineHeight:1.7, color:"#1a1a1a" }}>House Party Distro<br/>jon@housepartydistro.com<br/>3945 W Reno Ave, Ste A<br/>Las Vegas, NV 89118</div>
              </div>
              {(() => {
                const vendorNames = [...new Set((costingData?.costProds||[]).map((p:any)=>p.printVendor).filter(Boolean))];
                const dec = vendorNames.length === 1 ? getDecoratorByName(vendorNames[0]) : null;
                return dec ? (
                  <div>
                    <div style={{ fontSize:8, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#aaa", marginBottom:6 }}>Ship to / Decorator</div>
                    <div style={{ fontSize:10, lineHeight:1.7, color:"#1a1a1a" }}>
                      {dec.name}<br/>
                      {dec.email && <>{dec.email}<br/></>}
                      {dec.address && <>{dec.address}<br/></>}
                      {[dec.city, dec.state, dec.zip].filter(Boolean).join(", ")}
                    </div>
                  </div>
                ) : vendorNames.length > 1 ? (
                  <div>
                    <div style={{ fontSize:8, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#aaa", marginBottom:6 }}>Decorators</div>
                    <div style={{ fontSize:10, lineHeight:1.7, color:"#1a1a1a" }}>{vendorNames.join(", ")}</div>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Client strip */}
            <div style={{ background:"#222", color:"#fff", padding:"5px 10px", display:"flex", gap:24, fontSize:9.5, marginBottom:16 }}>
              <div><span style={{ opacity:.6, marginRight:4, fontSize:8.5, letterSpacing:"0.05em", textTransform:"uppercase" as const }}>Client</span>{project?.clients?.name}</div>
              <div><span style={{ opacity:.6, marginRight:4, fontSize:8.5, letterSpacing:"0.05em", textTransform:"uppercase" as const }}>Items</span>{sortedItems.length}</div>
              <div><span style={{ opacity:.6, marginRight:4, fontSize:8.5, letterSpacing:"0.05em", textTransform:"uppercase" as const }}>Total units</span>{totalUnitsAll.toLocaleString()}</div>
            </div>

            {/* Items */}
            {sortedItems.map((item, idx) => {
              const cp = getCostingForItem(item.id);
              const lines = sortSizes(item.buy_sheet_lines || []);
              const totalUnits = getTotalUnits(item.buy_sheet_lines);
              const fields = itemFields[item.id] || {};

              // Build cost sections from costing data
              const printLines: {desc:string; qty?:number; unit?:number; total?:number}[] = [];
              const finishingLines: {desc:string; qty?:number; unit?:number; total?:number}[] = [];
              const specialtyLines: {desc:string; qty?:number; unit?:number; total?:number}[] = [];
              const setupLines: {desc:string; total:number}[] = [];

              if (cp) {
                const PRINTERS: Record<string,any> = {
                  "ICON": { screenRate:20, printRate:0.065 },
                  "Pacific": { screenRate:22, printRate:0.07 },
                };
                const pr = PRINTERS[cp.printVendor] || { screenRate:20, printRate:0.065 };

                // Print locations
                [1,2,3,4,5,6].forEach(loc => {
                  const ld = cp.printLocations?.[loc];
                  if (ld?.location && ld?.screens > 0) {
                    const cost = (ld.screens * pr.printRate + (ld.shared ? 0 : 0)) * totalUnits;
                    printLines.push({ desc:`${ld.location} — ${ld.screens} color${ld.screens!==1?'s':''}${ld.shared?' (shared)':''}`, qty:totalUnits, unit:ld.screens*pr.printRate, total:cost });
                  }
                });
                if (cp.tagPrint) {
                  const tagCost = 0.40 * totalUnits;
                  printLines.push({ desc:`Tag print — ${cp.tagRepeat?'repeat':'new'} tag`, qty:totalUnits, unit:0.40, total:tagCost });
                }

                // Finishing
                const FIN_RATES: Record<string,number> = { Packaging_on:2.35, HangTag_on:0.65, HemTag_on:0.45 };
                Object.entries(cp.finishingQtys||{}).forEach(([k,v]) => {
                  if (v && FIN_RATES[k]) {
                    const label = k.replace("_on","").replace("HangTag","Hang tag").replace("HemTag","Hem tag").replace("Packaging","Polybag");
                    finishingLines.push({ desc:label, qty:totalUnits, unit:FIN_RATES[k], total:FIN_RATES[k]*totalUnits });
                  }
                });

                // Setup fees
                if (cp.setupFees?.screens > 0) setupLines.push({ desc:`${cp.setupFees.screens} screen${cp.setupFees.screens!==1?'s':''}`, total:cp.setupFees.screens * pr.screenRate });
                if (cp.setupFees?.manualCost > 0) setupLines.push({ desc:"Additional setup", total:cp.setupFees.manualCost });
              }

              const hasCosts = printLines.length > 0 || finishingLines.length > 0 || specialtyLines.length > 0 || setupLines.length > 0;

              return (
                <div key={item.id} style={{ borderLeft:"3px solid #1a1a1a", paddingLeft:16, marginBottom:24 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{getItemLetter(idx)} — {item.name}</div>
                    <div style={{ fontSize:10, color:"#888" }}>{[item.style, item.color].filter(Boolean).join(" · ")} · {totalUnits} units</div>
                  </div>

                  {lines.length > 0 && (
                    <div style={{ fontSize:10, color:"#555", padding:"5px 10px", background:"#f7f7f7", borderRadius:3, marginBottom:8 }}>
                      <span style={{ fontSize:8, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.08em", color:"#aaa", marginRight:6 }}>Size breakdown</span>
                      {lines.map(l=>`${l.size} ${l.qty_ordered}`).join(" · ")}
                    </div>
                  )}

                  {fields.drive_link && (
                    <div style={{ fontSize:9.5, marginBottom:10, padding:"4px 10px", background:"#f0f5ff", borderRadius:3 }}>
                      <span style={{ fontSize:8, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.08em", color:"#888", marginRight:6 }}>Production files</span>
                      <a href={fields.drive_link} style={{ color:"#1a56db" }}>{fields.drive_link}</a>
                    </div>
                  )}

                  {hasCosts && (
                    <div style={{ marginBottom:10 }}>
                      {printLines.length > 0 && (
                        <div style={{ marginBottom:8 }}>
                          <div style={{ fontSize:8, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#aaa", marginBottom:4, paddingBottom:3, borderBottom:"0.5px solid #eee" }}>Print</div>
                          {printLines.map((l,i) => (
                            <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"0.5px solid #f5f5f5", fontSize:10 }}>
                              <div style={{ flex:1, color:"#333" }}>{l.desc}</div>
                              {l.qty && l.unit ? <div style={{ color:"#aaa", fontSize:9, margin:"0 12px" }}>{l.qty.toLocaleString()} × {fmtD(l.unit)}</div> : null}
                              <div style={{ fontWeight:600, color:"#1a1a1a" }}>{l.total?fmtD(l.total):"—"}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {finishingLines.length > 0 && (
                        <div style={{ marginBottom:8 }}>
                          <div style={{ fontSize:8, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#aaa", marginBottom:4, paddingBottom:3, borderBottom:"0.5px solid #eee" }}>Finishing &amp; packaging</div>
                          {finishingLines.map((l,i) => (
                            <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"0.5px solid #f5f5f5", fontSize:10 }}>
                              <div style={{ flex:1, color:"#333" }}>{l.desc}</div>
                              {l.qty && l.unit ? <div style={{ color:"#aaa", fontSize:9, margin:"0 12px" }}>{l.qty.toLocaleString()} × {fmtD(l.unit)}</div> : null}
                              <div style={{ fontWeight:600, color:"#1a1a1a" }}>{l.total?fmtD(l.total):"—"}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {setupLines.length > 0 && (
                        <div style={{ marginBottom:8 }}>
                          <div style={{ fontSize:8, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#aaa", marginBottom:4, paddingBottom:3, borderBottom:"0.5px solid #eee" }}>Setup fees</div>
                          {setupLines.map((l,i) => (
                            <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"0.5px solid #f5f5f5", fontSize:10 }}>
                              <div style={{ flex:1, color:"#333" }}>{l.desc}</div>
                              <div style={{ color:"#aaa", fontSize:9, margin:"0 12px" }}>flat</div>
                              <div style={{ fontWeight:600, color:"#1a1a1a" }}>{fmtD(l.total)}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginTop:8, paddingTop:6, borderTop:"1px solid #1a1a1a" }}>
                        <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.08em", color:"#888" }}>Item {getItemLetter(idx)} total</div>
                        <div style={{ fontSize:13, fontWeight:700 }}>
                          {fmtD([...printLines,...finishingLines,...specialtyLines].reduce((a,l)=>a+(l.total||0),0) + setupLines.reduce((a,l)=>a+l.total,0))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginTop:8 }}>
                    {fields.incoming_goods && (
                      <div style={{ background:"#f9f9f9", padding:"7px 10px", borderRadius:3 }}>
                        <div style={{ fontSize:7.5, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#bbb", marginBottom:3 }}>Incoming goods</div>
                        <div style={{ fontSize:9.5, color:"#444", lineHeight:1.5 }}>{fields.incoming_goods}</div>
                      </div>
                    )}
                    {fields.production_notes_po && (
                      <div style={{ background:"#f9f9f9", padding:"7px 10px", borderRadius:3 }}>
                        <div style={{ fontSize:7.5, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#bbb", marginBottom:3 }}>Production notes</div>
                        <div style={{ fontSize:9.5, color:"#444", lineHeight:1.5 }}>{fields.production_notes_po}</div>
                      </div>
                    )}
                    {fields.packing_notes && (
                      <div style={{ background:"#f9f9f9", padding:"7px 10px", borderRadius:3 }}>
                        <div style={{ fontSize:7.5, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.1em", color:"#bbb", marginBottom:3 }}>Packing / shipping</div>
                        <div style={{ fontSize:9.5, color:"#444", lineHeight:1.5 }}>{fields.packing_notes}</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* PO Total */}
            <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:20, paddingTop:8, borderTop:"0.5px solid #ddd" }}>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.12em", color:"#aaa", marginBottom:4 }}>PO Total</div>
                <div style={{ fontSize:24, fontWeight:700, letterSpacing:-1, color:"#1a1a1a" }}>
                  {fmtD(sortedItems.reduce((a,item) => {
                    const cp = getCostingForItem(item.id);
                    return a + (cp?.poTotal || 0);
                  }, 0))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ borderTop:"0.5px solid #ddd", paddingTop:10, fontSize:7.5, color:"#aaa", lineHeight:1.6 }}>
              <strong style={{ fontSize:8, fontWeight:700, color:"#888", display:"block", marginBottom:3 }}>House Party Distro Purchase Order Conditions</strong>
              House Party Distro must be notified of any blank shortages or discrepancies within 24 hours of receipt of goods. Outbound shipping is at the sole direction of House Party Distro. Packing lists and tracking numbers must be supplied to House Party Distro immediately after the order has shipped. House Party Distro must be invoiced for any charges within 30 days of the PO date. This PO and any documents, files, or previous e-mails may contain confidential information that is legally privileged. If you are not the intended recipient, or a person responsible for delivering it to the intended recipient, you are hereby notified that any disclosure, copying, distribution or use of any of the information contained in or attached to this transmission is strictly prohibited.
            </div>

          </div>

          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => window.print()}
              style={{ background:T.accent, border:"none", borderRadius:7, color:"#fff", fontSize:12, fontFamily:font, fontWeight:600, padding:"8px 18px", cursor:"pointer" }}>
              Export PDF
            </button>
          </div>
        </>
      )}

    </div>
  );
}
