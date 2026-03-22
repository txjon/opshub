"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const T = {
  card:"#1e2333", surface:"#181c27", border:"#2a3050",
  text:"#e8eaf2", muted:"#7a82a0", faint:"#3a4060",
  accent:"#4f8ef7", accentDim:"#1e3a6e",
  green:"#34c97a", amber:"#f5a623", amberDim:"#3d2a08",
};
const font = "'IBM Plex Sans','Helvetica Neue',Arial,sans-serif";
const mono = "'IBM Plex Mono','Courier New',monospace";
const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL"];

function fmtD(n: number) {
  return "$" + n.toLocaleString("en-US", {minimumFractionDigits:2,maximumFractionDigits:2});
}
function sortedLines(lines:{size:string;qty_ordered:number}[]) {
  return [...lines].sort((a,b)=>(SIZE_ORDER.indexOf(a.size)??99)-(SIZE_ORDER.indexOf(b.size)??99)).filter(l=>l.qty_ordered>0);
}
function totalQty(lines:{size:string;qty_ordered:number}[]) {
  return lines.reduce((a,l)=>a+(l.qty_ordered||0),0);
}

function NoteBox({label,text}:{label:string;text:string}) {
  if (!text) return null;
  return (
    <div style={{background:"#f9f9f9",padding:"7px 10px",borderRadius:3}}>
      <div style={{fontSize:"7.5px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#bbb",marginBottom:3}}>{label}</div>
      <div style={{fontSize:"9.5px",color:"#444",lineHeight:1.5}}>{text}</div>
    </div>
  );
}

export function POTab({project,items,costingData}:{project:any;items:any[];costingData:any}) {
  const supabase = createClient();
  const [decorators,setDecorators] = useState<any[]>([]);
  const [shipMethods,setShipMethods] = useState<any[]>([]);
  const [selectedShipMethod,setSelectedShipMethod] = useState("");
  const [selectedVendor,setSelectedVendor] = useState("");
  const [itemFields,setItemFields] = useState<Record<string,{drive_link:string;incoming_goods:string;production_notes_po:string;packing_notes:string}>>({});
  const [saving,setSaving] = useState(false);
  const [saved,setSaved] = useState(false);

  useEffect(()=>{
    async function load() {
      const [{data:decs},{data:ships}] = await Promise.all([
        supabase.from("decorators").select("*").order("name"),
        supabase.from("ship_methods").select("*").order("name"),
      ]);
      setDecorators(decs||[]);
      setShipMethods(ships||[]);
    }
    load();
  },[]);

  useEffect(()=>{
    const fields:Record<string,{drive_link:string;incoming_goods:string;production_notes_po:string;packing_notes:string}> = {};
    items.forEach(it=>{
      const cp = (costingData?.costProds||[]).find((p:any)=>p.id===it.id);
      const auto = cp?.supplier ? ("Blanks from "+cp.supplier) : "";
      fields[it.id] = {
        drive_link: it.drive_link||"",
        incoming_goods: it.incoming_goods||auto,
        production_notes_po: it.production_notes_po||"",
        packing_notes: it.packing_notes||"",
      };
    });
    setItemFields(fields);
  },[items,costingData]);

  function getCostProd(id:string) {
    return (costingData?.costProds||[]).find((p:any)=>p.id===id);
  }
  function getDec(name:string) {
    return decorators.find(d=>d.name===name||d.short_code===name);
  }

  const sorted = [...items].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const vendors:string[] = [...new Set((costingData?.costProds||[]).map((p:any)=>p.printVendor).filter(Boolean))] as string[];
  const active = selectedVendor || vendors[0] || "";
  const vItems = sorted.filter(it=>getCostProd(it.id)?.printVendor===active);
  const ship = shipMethods.find(s=>s.id===selectedShipMethod);

  async function saveFields() {
    setSaving(true);
    for (const [id,f] of Object.entries(itemFields)) {
      await supabase.from("items").update(f).eq("id",id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(()=>setSaved(false),3000);
  }

  const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
  const shipDate = project?.target_ship_date
    ? new Date(project.target_ship_date).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})
    : "—";

  return (
    <div style={{fontFamily:font,color:T.text,display:"flex",flexDirection:"column",gap:16}}>

      <div style={{background:T.card,border:"1px solid "+T.border,borderRadius:10,padding:14}}>
        <div style={{fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.08em",marginBottom:12}}>PO Setup</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>

          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <div style={{fontSize:9,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.07em"}}>Ship method</div>
            <select value={selectedShipMethod} onChange={e=>setSelectedShipMethod(e.target.value)}
              style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:selectedShipMethod?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer"}}>
              <option value="">— select method —</option>
              {shipMethods.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <div style={{fontSize:9,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.07em"}}>Ship acct. no.</div>
            <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:ship?.account_number?T.text:T.faint,fontFamily:mono,fontSize:12,padding:"6px 10px"}}>
              {ship?.account_number||"—"}
            </div>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <div style={{fontSize:9,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.07em"}}>View PO for vendor</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap" as const}}>
              {vendors.length===0 && <div style={{fontSize:11,color:T.faint}}>No vendors in costing tab</div>}
              {vendors.map(v=>(
                <button key={v} onClick={()=>setSelectedVendor(v)}
                  style={{background:active===v?T.accent:T.surface,border:"1px solid "+(active===v?T.accent:T.border),borderRadius:6,color:active===v?"#fff":T.muted,fontFamily:font,fontSize:11,fontWeight:600,padding:"4px 10px",cursor:"pointer"}}>
                  {v}
                </button>
              ))}
            </div>
          </div>

        </div>
        {(costingData?.costProds||[]).some((p:any)=>!p.printVendor) && (
          <div style={{marginTop:10,fontSize:11,color:T.amber,background:T.amberDim,borderRadius:6,padding:"6px 10px"}}>
            Some items have no decorator — go to Costing tab and assign a vendor.
          </div>
        )}
      </div>

      {vItems.map((item,idx)=>(
        <div key={item.id} style={{background:T.card,border:"1px solid "+T.border,borderRadius:10,overflow:"hidden"}}>
          <div style={{background:"#2a2f42",padding:"8px 14px",display:"flex",alignItems:"center",gap:10}}>
            <span style={{background:T.accentDim,color:T.accent,fontFamily:mono,fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:5}}>{String.fromCharCode(65+idx)}</span>
            <span style={{fontSize:13,fontWeight:600}}>{item.name}</span>
            <span style={{fontSize:11,color:T.muted}}>{[item.style,item.color].filter(Boolean).join(" · ")}</span>
            <span style={{marginLeft:"auto",fontSize:10,color:T.accent,background:T.accentDim,padding:"2px 8px",borderRadius:4,fontFamily:mono}}>
              {getCostProd(item.id)?.printVendor||"—"}
            </span>
          </div>
          <div style={{padding:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <div style={{fontSize:9,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.07em"}}>Google Drive link</div>
              <input value={itemFields[item.id]?.drive_link||""} onChange={e=>setItemFields(p=>({...p,[item.id]:{...p[item.id],drive_link:e.target.value}}))}
                style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",width:"100%"}} />
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontSize:9,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.07em"}}>Incoming goods</div>
                {getCostProd(item.id)?.supplier && <span style={{fontSize:9,color:T.accent}}>auto</span>}
              </div>
              <input value={itemFields[item.id]?.incoming_goods||""} onChange={e=>setItemFields(p=>({...p,[item.id]:{...p[item.id],incoming_goods:e.target.value}}))}
                style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",width:"100%"}} />
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <div style={{fontSize:9,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.07em"}}>Production notes</div>
              <textarea value={itemFields[item.id]?.production_notes_po||""} onChange={e=>setItemFields(p=>({...p,[item.id]:{...p[item.id],production_notes_po:e.target.value}}))}
                style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",width:"100%",minHeight:52,resize:"vertical" as const}} />
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <div style={{fontSize:9,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.07em"}}>Packing / shipping notes</div>
              <textarea value={itemFields[item.id]?.packing_notes||""} onChange={e=>setItemFields(p=>({...p,[item.id]:{...p[item.id],packing_notes:e.target.value}}))}
                style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",width:"100%",minHeight:52,resize:"vertical" as const}} />
            </div>
          </div>
        </div>
      ))}

      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <button onClick={saveFields} disabled={saving}
          style={{background:T.green,border:"none",borderRadius:7,color:"#fff",fontSize:12,fontFamily:font,fontWeight:600,padding:"7px 16px",cursor:"pointer",opacity:saving?0.6:1}}>
          {saving?"Saving...":"Save fields"}
        </button>
        {saved && <span style={{fontSize:11,color:T.green}}>Saved</span>}
      </div>

      {selectedShipMethod && active && (
        <div>
          <div style={{fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase" as const,letterSpacing:"0.08em",marginBottom:8}}>
            PO Preview — {active} ({vItems.length} item{vItems.length!==1?"s":""})
          </div>

          <div style={{background:"#fff",color:"#1a1a1a",borderRadius:10,padding:"36px 40px",fontFamily:"'Helvetica Neue',Arial,sans-serif",fontSize:11,lineHeight:1.5}}>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",paddingBottom:18,borderBottom:"2px solid #1a1a1a",marginBottom:18}}>
              <div style={{fontSize:20,fontWeight:800,letterSpacing:-1,lineHeight:1.1}}>
                house party<br /><span style={{color:"#aaa",fontWeight:300}}>distro</span>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:20,fontWeight:700,letterSpacing:2}}>PURCHASE ORDER</div>
                <div style={{fontSize:10,color:"#888",marginTop:2}}>{project?.clients?.name} · {active}</div>
              </div>
            </div>

            <div style={{display:"flex",gap:0,border:"0.5px solid #ccc",marginBottom:16}}>
              {[["Date",today],["PO #",project?.job_number||"—"],["Ship date",shipDate],["Vendor ID",getDec(active)?.short_code||active],["Ship method",ship?.name||"—"],["Ship acct.",ship?.account_number||"—"]].map(([k,v],i,arr)=>(
                <div key={k} style={{flex:1,padding:"5px 8px",borderRight:i<arr.length-1?"0.5px solid #ccc":"none"}}>
                  <div style={{fontSize:"7.5px",fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.1em",color:"#aaa",marginBottom:2}}>{k}</div>
                  <div style={{fontSize:10,fontWeight:600,color:"#1a1a1a"}}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:16}}>
              <div>
                <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.1em",color:"#aaa",marginBottom:6}}>Bill to</div>
                <div style={{fontSize:10,lineHeight:1.7}}>House Party Distro<br />jon@housepartydistro.com<br />3945 W Reno Ave, Ste A<br />Las Vegas, NV 89118</div>
              </div>
              <div>
                <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.1em",color:"#aaa",marginBottom:6}}>Ship to / Decorator</div>
                {getDec(active) ? (
                  <div style={{fontSize:10,lineHeight:1.7}}>
                    {getDec(active)!.name}<br />
                    {getDec(active)!.email||""}{getDec(active)!.email&&<br />}
                    {getDec(active)!.address||""}{getDec(active)!.address&&<br />}
                    {[getDec(active)!.city,getDec(active)!.state,getDec(active)!.zip].filter(Boolean).join(", ")}
                  </div>
                ) : (
                  <div style={{fontSize:10,color:"#888"}}>{active}<br /><span style={{fontSize:9,color:"#aaa"}}>Add address in Decorators page</span></div>
                )}
              </div>
            </div>

            <div style={{background:"#222",color:"#fff",padding:"5px 10px",display:"flex",gap:24,fontSize:"9.5px",marginBottom:16}}>
              <div><span style={{opacity:.6,marginRight:4,textTransform:"uppercase" as const,fontSize:"8.5px",letterSpacing:"0.05em"}}>Client</span>{project?.clients?.name}</div>
              <div><span style={{opacity:.6,marginRight:4,textTransform:"uppercase" as const,fontSize:"8.5px",letterSpacing:"0.05em"}}>Items</span>{vItems.length}</div>
              <div><span style={{opacity:.6,marginRight:4,textTransform:"uppercase" as const,fontSize:"8.5px",letterSpacing:"0.05em"}}>Total units</span>{vItems.reduce((a,it)=>a+totalQty(it.buy_sheet_lines||[]),0).toLocaleString()}</div>
            </div>

            {vItems.map((item,idx)=>{
              const cp = getCostProd(item.id);
              const lines = sortedLines(item.buy_sheet_lines||[]);
              const units = totalQty(item.buy_sheet_lines||[]);
              const f = itemFields[item.id]||{drive_link:"",incoming_goods:"",production_notes_po:"",packing_notes:""};
              const printL:{desc:string;qty?:number;unit?:number;total?:number}[] = [];
              const finL:{desc:string;qty?:number;unit?:number;total?:number}[] = [];
              const setupL:{desc:string;total:number}[] = [];
              if (cp) {
                [1,2,3,4,5,6].forEach(loc=>{
                  const ld = cp.printLocations?.[loc];
                  if (ld?.location&&ld?.screens>0) {
                    printL.push({desc:ld.location+" — "+ld.screens+" color"+(ld.screens!==1?"s":"")+(ld.shared?" (shared)":""),qty:units,unit:ld.screens*0.065,total:ld.screens*0.065*units});
                  }
                });
                if (cp.tagPrint) printL.push({desc:"Tag print — "+(cp.tagRepeat?"repeat":"new")+" tag",qty:units,unit:0.40,total:0.40*units});
                const FR:Record<string,{label:string;rate:number}> = {Packaging_on:{label:"Polybag",rate:2.35},HangTag_on:{label:"Hang tag",rate:0.65},HemTag_on:{label:"Hem tag",rate:0.45}};
                Object.entries(cp.finishingQtys||{}).forEach(([k,v])=>{ if(v&&FR[k]) finL.push({desc:FR[k].label,qty:units,unit:FR[k].rate,total:FR[k].rate*units}); });
                if (cp.setupFees?.screens>0) setupL.push({desc:cp.setupFees.screens+" screen"+(cp.setupFees.screens!==1?"s":""),total:cp.setupFees.screens*20});
                if (cp.setupFees?.manualCost>0) setupL.push({desc:"Additional setup",total:cp.setupFees.manualCost});
              }
              const itemTotal = [...printL,...finL].reduce((a,l)=>a+(l.total||0),0)+setupL.reduce((a,l)=>a+l.total,0);
              return (
                <div key={item.id} style={{borderLeft:"3px solid #1a1a1a",paddingLeft:16,marginBottom:24}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                    <div style={{fontSize:13,fontWeight:700}}>{String.fromCharCode(65+idx)} — {item.name}</div>
                    <div style={{fontSize:10,color:"#888"}}>{units} units</div>
                  </div>
                  <div style={{display:"flex",gap:16,marginBottom:8,fontSize:10,color:"#555"}}>
                    {item.blank_vendor&&<div><span style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.08em",color:"#bbb",marginRight:4}}>Brand</span>{item.blank_vendor}</div>}
                    {item.style&&<div><span style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.08em",color:"#bbb",marginRight:4}}>Style</span>{item.style}</div>}
                    {item.color&&<div><span style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.08em",color:"#bbb",marginRight:4}}>Color</span>{item.color}</div>}
                  </div>
                  {lines.length>0&&(
                    <div style={{fontSize:10,color:"#555",padding:"5px 10px",background:"#f7f7f7",borderRadius:3,marginBottom:8}}>
                      <span style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.08em",color:"#aaa",marginRight:6}}>Sizes</span>
                      {lines.map(l=>l.size+" "+l.qty_ordered).join(" · ")}
                    </div>
                  )}
                  {f.drive_link&&(
                    <div style={{fontSize:"9.5px",marginBottom:10,padding:"4px 10px",background:"#f0f5ff",borderRadius:3}}>
                      <span style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.08em",color:"#888",marginRight:6}}>Production files</span>
                      <a href={f.drive_link} style={{color:"#1a56db"}}>{f.drive_link}</a>
                    </div>
                  )}
                  {printL.length>0&&(
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.1em",color:"#aaa",marginBottom:4,paddingBottom:3,borderBottom:"0.5px solid #eee"}}>Print</div>
                      {printL.map((l,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"0.5px solid #f5f5f5",fontSize:10}}>
                          <div style={{flex:1,color:"#333"}}>{l.desc}</div>
                          {l.qty&&l.unit?<div style={{color:"#aaa",fontSize:9,margin:"0 12px"}}>{l.qty.toLocaleString()}{"×"}{fmtD(l.unit)}</div>:null}
                          <div style={{fontWeight:600}}>{l.total?fmtD(l.total):"—"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {finL.length>0&&(
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.1em",color:"#aaa",marginBottom:4,paddingBottom:3,borderBottom:"0.5px solid #eee"}}>Finishing & packaging</div>
                      {finL.map((l,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"0.5px solid #f5f5f5",fontSize:10}}>
                          <div style={{flex:1,color:"#333"}}>{l.desc}</div>
                          {l.qty&&l.unit?<div style={{color:"#aaa",fontSize:9,margin:"0 12px"}}>{l.qty.toLocaleString()}{"×"}{fmtD(l.unit)}</div>:null}
                          <div style={{fontWeight:600}}>{l.total?fmtD(l.total):"—"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {setupL.length>0&&(
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.1em",color:"#aaa",marginBottom:4,paddingBottom:3,borderBottom:"0.5px solid #eee"}}>Setup fees</div>
                      {setupL.map((l,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"0.5px solid #f5f5f5",fontSize:10}}>
                          <div style={{flex:1,color:"#333"}}>{l.desc}</div>
                          <div style={{color:"#aaa",fontSize:9,margin:"0 12px"}}>flat</div>
                          <div style={{fontWeight:600}}>{fmtD(l.total)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {itemTotal>0&&(
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:8,paddingTop:6,borderTop:"1px solid #1a1a1a"}}>
                      <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.08em",color:"#888"}}>Item {String.fromCharCode(65+idx)} total</div>
                      <div style={{fontSize:13,fontWeight:700}}>{fmtD(itemTotal)}</div>
                    </div>
                  )}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:10}}>
                    <NoteBox label="Incoming goods" text={f.incoming_goods} />
                    <NoteBox label="Production notes" text={f.production_notes_po} />
                    <NoteBox label="Packing / shipping" text={f.packing_notes} />
                  </div>
                </div>
              );
            })}

            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20,paddingTop:8,borderTop:"0.5px solid #ddd"}}>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:"0.12em",color:"#aaa",marginBottom:4}}>PO Total</div>
                <div style={{fontSize:24,fontWeight:700,letterSpacing:-1}}>{fmtD(vItems.reduce((a,it)=>a+(getCostProd(it.id)?.poTotal||0),0))}</div>
              </div>
            </div>

            <div style={{borderTop:"0.5px solid #ddd",paddingTop:10,fontSize:"7.5px",color:"#aaa",lineHeight:1.6}}>
              <strong style={{fontSize:8,fontWeight:700,color:"#888",display:"block",marginBottom:3}}>House Party Distro Purchase Order Conditions</strong>
              House Party Distro must be notified of any blank shortages or discrepancies within 24 hours of receipt of goods. Outbound shipping is at the sole direction of House Party Distro. Packing lists and tracking numbers must be supplied to House Party Distro immediately after the order has shipped. House Party Distro must be invoiced for any charges within 30 days of the PO date. This PO and any documents, files, or previous e-mails may contain confidential information that is legally privileged.
            </div>

          </div>

          <div style={{marginTop:10}}>
            <button onClick={()=>window.print()}
              style={{background:T.accent,border:"none",borderRadius:7,color:"#fff",fontSize:12,fontFamily:font,fontWeight:600,padding:"8px 18px",cursor:"pointer"}}>
              Export PDF
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
