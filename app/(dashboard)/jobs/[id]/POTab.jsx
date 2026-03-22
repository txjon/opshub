"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const T = {
  card:"#1e2333", surface:"#181c27", border:"#2a3050",
  text:"#e8eaf2", muted:"#7a82a0", faint:"#3a4060",
  accent:"#4f8ef7", accentDim:"#1e3a6e",
  green:"#34c97a", greenDim:"#0e3d24",
  amber:"#f5a623", amberDim:"#3d2a08",
};
const font = "'IBM Plex Sans','Helvetica Neue',Arial,sans-serif";
const mono = "'IBM Plex Mono','Courier New',monospace";
const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];

function fmtD(n) {
  return "$"+Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function sortedLines(lines) {
  return [...lines].sort((a,b)=>{
    const ai=SIZE_ORDER.indexOf(a.size); const bi=SIZE_ORDER.indexOf(b.size);
    return (ai===-1?99:ai)-(bi===-1?99:bi);
  }).filter(l=>l.qty_ordered>0);
}
function totalQty(lines) {
  return lines.reduce((a,l)=>a+(l.qty_ordered||0),0);
}

function NoteBox({label,text}) {
  if (!text) return null;
  return (
    <div style={{background:"#f9f9f9",padding:"7px 10px",borderRadius:3}}>
      <div style={{fontSize:"7.5px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#bbb",marginBottom:3}}>{label}</div>
      <div style={{fontSize:"9.5px",color:"#444",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{text}</div>
    </div>
  );
}

function buildLineItems(cp, allProds) {
  if (!cp) return { printLines:[], finLines:[], specLines:[], setupLines:[] };
  const qty = cp.totalQty||0;
  const pr = (cp)._printerData || null;

  const printLines = [];
  const finLines = [];
  const specLines = [];
  const setupLines = [];

  // Print locations — use same logic as calcCostProduct
  for (let loc=1; loc<=6; loc++) {
    const ld = cp.printLocations?.[loc];
    const printer = ld?.printer || cp.printVendor;
    if (printer && ld?.screens > 0 && ld?.location) {
      const isShared = !!(ld.shared) && ld.location;
      const sharedQty = isShared ? allProds.reduce((sum,p)=>{
        const match = Object.values(p.printLocations||{}).find((l)=>l.location&&l.location.trim().toLowerCase()===ld.location.trim().toLowerCase()&&l.screens>0);
        return sum+(match?(p.totalQty||0):0);
      },0) : 0;
      const effectiveQty = isShared && sharedQty > 0 ? sharedQty : qty;
      const unitCost = ld.screens * 0.065;
      printLines.push({
        desc:`${ld.location} — ${ld.screens} color${ld.screens!==1?"s":""}${isShared?" (shared)":""}`,
        qty, unit:unitCost, total:unitCost*qty
      });
    }
  }
  if (cp.tagPrint && cp.printVendor) {
    const unitCost = 0.40;
    printLines.push({desc:`Tag print — ${cp.tagRepeat?"repeat":"new"} tag`, qty, unit:unitCost, total:unitCost*qty});
  }

  // Finishing
  if (cp.finishingQtys && pr) {
    if (cp.finishingQtys["Packaging_on"]) {
      const variant = cp.isFleece?"Fleece":(cp.finishingQtys["Packaging_variant"]||"Tee");
      const rate = pr.finishing?.[variant]||0;
      if (rate > 0) finLines.push({desc:`${variant} polybag`, qty, unit:rate, total:rate*qty});
    }
    if (cp.finishingQtys["HangTag_on"]) {
      const rate = pr.specialty?.HangTag||0;
      if (rate > 0) finLines.push({desc:"Hang tag", qty, unit:rate, total:rate*qty});
    }
    if (cp.finishingQtys["HemTag_on"]) {
      const rate = pr.specialty?.HemTag||0;
      if (rate > 0) finLines.push({desc:"Hem tag", qty, unit:rate, total:rate*qty});
    }
    if (cp.finishingQtys["Applique_on"]) {
      const rate = pr.specialty?.Applique||0;
      if (rate > 0) finLines.push({desc:"Applique", qty, unit:rate, total:rate*qty});
    }
    if (cp.isFleece) {
      const activeLocs = [1,2,3,4,5,6].filter(loc=>{const ld=cp.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length;
      const locs = activeLocs+(cp.tagPrint?1:0);
      const rate = (pr.finishing?.Tee||0)*locs;
      if (rate > 0) finLines.push({desc:"Fleece upcharge", qty, unit:rate, total:rate*qty});
    }
  }

  // Specialty
  if (cp.specialtyQtys && pr) {
    const activeLocs = [1,2,3,4,5,6].filter(loc=>{const ld=cp.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length;
    ["WaterBase","Glow","Shimmer","Metallic","Puff","HighDensity","Reflective","Foil"].forEach(key=>{
      if (cp.specialtyQtys[key+"_on"]) {
        const rate = (pr.specialty?.[key]||0)*activeLocs;
        if (rate > 0) specLines.push({desc:key.replace(/([A-Z])/g," $1").trim(), qty, unit:rate, total:rate*qty});
      }
    });
  }

  // Setup fees
  if (cp.setupFees && pr) {
    const autoScreens = [1,2,3,4,5,6].reduce((a,loc)=>a+(parseFloat(cp.printLocations?.[loc]?.screens)||0),0);
    if (autoScreens > 0 && (pr.setup?.Screens||0) > 0) {
      setupLines.push({desc:`${autoScreens} screen${autoScreens!==1?"s":""}`, total:(pr.setup.Screens||0)*autoScreens});
    }
    const activeSizes = (cp.sizes||[]).filter((sz)=>(cp.qtys?.[sz]||0)>0).length;
    if (!cp.tagRepeat && cp.tagPrint && (pr.setup?.TagScreens||0) > 0) {
      setupLines.push({desc:`Tag screens (${activeSizes} sizes)`, total:(pr.setup.TagScreens||0)*activeSizes});
    }
    if ((cp.setupFees.seps||0) > 0 && (pr.setup?.Seps||0) > 0) {
      setupLines.push({desc:`Seps (${cp.setupFees.seps})`, total:(pr.setup.Seps||0)*cp.setupFees.seps});
    }
    if ((cp.setupFees.inkChanges||0) > 0 && (pr.setup?.InkChange||0) > 0) {
      setupLines.push({desc:`Ink changes (${cp.setupFees.inkChanges})`, total:(pr.setup.InkChange||0)*cp.setupFees.inkChanges});
    }
    if ((cp.setupFees.manualCost||0) > 0) {
      setupLines.push({desc:"Additional setup", total:cp.setupFees.manualCost});
    }
  }

  // Custom costs
  (cp.customCosts||[]).forEach((c)=>{
    if (c.amount > 0) setupLines.push({desc:c.name||"Custom cost", total:c.amount});
  });

  return { printLines, finLines, specLines, setupLines };
}

export function POTab({project,items,costingData}) {
  const supabase = createClient();
  const [decorators,setDecorators] = useState([]);
  const [shipMethods,setShipMethods] = useState([]);
  const [selectedShipMethod,setSelectedShipMethod] = useState("");
  const [selectedVendor,setSelectedVendor] = useState("");
  const [packingNotes,setPackingNotes] = useState({});
  const [saving,setSaving] = useState({});
  const [showPreview,setShowPreview] = useState(false);
  const [showModal,setShowModal] = useState(false);

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
    const notes = {};
    items.forEach(it=>{ notes[it.id] = it.packing_notes||""; });
    setPackingNotes(notes);
  },[items]);

  const costProds = costingData?.costProds||[];
  const costMargin = costingData?.costMargin||"30%";
  const inclShip = costingData?.inclShip!==undefined ? costingData.inclShip : true;
  const inclCC = costingData?.inclCC!==undefined ? costingData.inclCC : true;

  function getCostProd(id) {
    return costProds.find((p)=>p.id===id);
  }
  function getResult(id) {
    const cp = getCostProd(id);
    if (!cp) return null;
    // Use poTotal directly from costing data if available
    return { poTotal: cp._poTotal || 0 };
  }
  function getDec(name) {
    return decorators.find(d=>d.name===name||d.short_code===name);
  }

  const sorted = [...items].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const vendors = [...new Set(costProds.map((p)=>p.printVendor).filter(Boolean))];
  const active = selectedVendor||vendors[0]||"";
  const vItems = sorted.filter(it=>getCostProd(it.id)?.printVendor===active);
  const ship = shipMethods.find(s=>s.id===selectedShipMethod);

  const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
  const shipDate = project?.target_ship_date
    ? new Date(project.target_ship_date).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})
    : "—";

  async function savePackingNote(itemId, val) {
    setSaving(p=>({...p,[itemId]:true}));
    await supabase.from("items").update({packing_notes:val}).eq("id",itemId);
    setSaving(p=>({...p,[itemId]:false}));
  }

  const ready = selectedShipMethod && active;
  const allFilled = vItems.every(it=>packingNotes[it.id]?.trim());

  return (
    <div style={{fontFamily:font,color:T.text,display:"flex",flexDirection:"column",gap:12}}>

      <div style={{background:T.card,border:"1px solid "+T.border,borderRadius:10,padding:"12px 14px",display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
        <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:180}}>
          <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship method</div>
          <select value={selectedShipMethod} onChange={e=>setSelectedShipMethod(e.target.value)}
            style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:selectedShipMethod?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer"}}>
            <option value="">— select —</option>
            {shipMethods.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Acct. no.</div>
          <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:ship?.account_number?T.text:T.faint,fontFamily:mono,fontSize:12,padding:"6px 10px",minWidth:90}}>
            {ship?.account_number||"—"}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Vendor</div>
          <div style={{display:"flex",gap:6}}>
            {vendors.length===0&&<div style={{fontSize:11,color:T.faint,padding:"6px 0"}}>No vendors assigned in costing</div>}
            {vendors.map(v=>(
              <button key={v} onClick={()=>setSelectedVendor(v)}
                style={{background:active===v?T.accent:T.surface,border:"1px solid "+(active===v?T.accent:T.border),borderRadius:6,color:active===v?"#fff":T.muted,fontFamily:font,fontSize:11,fontWeight:600,padding:"5px 12px",cursor:"pointer"}}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {ready&&(
            <div style={{fontSize:11,color:allFilled?T.green:T.amber}}>
              {vItems.filter(it=>packingNotes[it.id]?.trim()).length}/{vItems.length} items ready
            </div>
          )}
          <button onClick={()=>setShowModal(true)} disabled={!ready}
            style={{background:ready?T.accent:T.surface,border:"1px solid "+(ready?T.accent:T.border),borderRadius:7,color:ready?"#fff":T.faint,fontFamily:font,fontSize:12,fontWeight:600,padding:"7px 16px",cursor:ready?"pointer":"default",opacity:ready?1:0.5}}>
            Preview PO
          </button>
        </div>
      </div>

      {active&&(
        <div style={{background:T.card,border:"1px solid "+T.border,borderRadius:10,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"40px 1fr 120px 1fr",background:T.surface,borderBottom:"1px solid "+T.border}}>
            {["","Item","Vendor","Packing / shipping notes"].map((h,i)=>(
              <div key={i} style={{padding:"7px 12px",fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",borderRight:i<3?"1px solid "+T.border:"none"}}>{h}</div>
            ))}
          </div>
          {vItems.map((item,i)=>{
            const idx = sorted.findIndex(it=>it.id===item.id);
            const filled = !!packingNotes[item.id]?.trim();
            return (
              <div key={item.id} style={{display:"grid",gridTemplateColumns:"40px 1fr 120px 1fr",borderBottom:i<vItems.length-1?"1px solid "+T.border:"none",alignItems:"center"}}>
                <div style={{padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"center",borderRight:"1px solid "+T.border}}>
                  <span style={{width:22,height:22,borderRadius:5,background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:T.accent,fontFamily:mono}}>
                    {String.fromCharCode(65+idx)}
                  </span>
                </div>
                <div style={{padding:"10px 12px",borderRight:"1px solid "+T.border}}>
                  <div style={{fontSize:12,fontWeight:600,color:T.text}}>{item.name}</div>
                  <div style={{fontSize:10,color:T.muted,marginTop:2}}>{[item.blank_vendor,item.style,item.color].filter(Boolean).join(" · ")} · {totalQty(item.buy_sheet_lines||[])} units</div>
                </div>
                <div style={{padding:"10px 12px",borderRight:"1px solid "+T.border,fontSize:11,color:T.muted,fontFamily:mono}}>
                  {getCostProd(item.id)?.printVendor||"—"}
                </div>
                <div style={{padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
                  <textarea value={packingNotes[item.id]||""} placeholder="e.g. Fewest boxes, label all contents"
                    onChange={e=>setPackingNotes(p=>({...p,[item.id]:e.target.value}))}
                    onBlur={e=>savePackingNote(item.id,e.target.value)}
                    rows={2}
                    style={{flex:1,background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:11,padding:"5px 8px",outline:"none",resize:"none",lineHeight:1.4}}
                  />
                  <div style={{width:8,height:8,borderRadius:"50%",background:filled?T.green:T.faint,flexShrink:0}} />
                  {saving[item.id]&&<div style={{fontSize:9,color:T.muted,flexShrink:0}}>saving</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}



      {showModal&&ready&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.75)",zIndex:1000,overflowY:"auto",padding:"40px 20px"}} onClick={e=>{if(e.target===e.currentTarget)setShowModal(false)}}>
          <div style={{maxWidth:820,margin:"0 auto",position:"relative"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{project?.clients?.name} — {active} PO</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>window.print()} style={{background:T.green,border:"none",borderRadius:7,color:"#fff",fontFamily:font,fontSize:12,fontWeight:600,padding:"7px 16px",cursor:"pointer"}}>Export PDF</button>
                <button onClick={()=>setShowModal(false)} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,color:"#fff",fontFamily:font,fontSize:12,padding:"7px 14px",cursor:"pointer"}}>Close</button>
              </div>
            </div>
        <div style={{background:"#fff",color:"#1a1a1a",borderRadius:10,padding:"36px 40px",fontFamily:"'Helvetica Neue',Arial,sans-serif",fontSize:11,lineHeight:1.5}}>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",paddingBottom:18,borderBottom:"2px solid #1a1a1a",marginBottom:18}}>
            <div style={{fontSize:20,fontWeight:800,letterSpacing:-1,lineHeight:1.1}}>
              house party<br/><span style={{color:"#aaa",fontWeight:300}}>distro</span>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:20,fontWeight:700,letterSpacing:2}}>PURCHASE ORDER</div>
              <div style={{fontSize:10,color:"#888",marginTop:2}}>{project?.clients?.name} · {active}</div>
            </div>
          </div>

          <div style={{display:"flex",gap:0,border:"0.5px solid #ccc",marginBottom:16}}>
            {[["Date",today],["PO #",project?.job_number||"—"],["Ship date",shipDate],["Vendor ID",getDec(active)?.short_code||active],["Ship method",ship?.name||"—"],["Ship acct.",ship?.account_number||"—"]].map(([k,v],i,arr)=>(
              <div key={k} style={{flex:1,padding:"5px 8px",borderRight:i<arr.length-1?"0.5px solid #ccc":"none"}}>
                <div style={{fontSize:"7.5px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:2}}>{k}</div>
                <div style={{fontSize:10,fontWeight:600,color:"#1a1a1a"}}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:16}}>
            <div>
              <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:6}}>Bill to</div>
              <div style={{fontSize:10,lineHeight:1.7}}>House Party Distro<br/>jon@housepartydistro.com<br/>3945 W Reno Ave, Ste A<br/>Las Vegas, NV 89118</div>
            </div>
            <div>
              <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:6}}>Ship to / Decorator</div>
              {getDec(active) ? (
                <div style={{fontSize:10,lineHeight:1.7}}>
                  {getDec(active)?.name}<br/>
                  {getDec(active)?.email&&<span>{getDec(active)?.email}<br/></span>}
                  {getDec(active)?.address&&<span>{getDec(active)?.address}<br/></span>}
                  {[getDec(active)?.city,getDec(active)?.state,getDec(active)?.zip].filter(Boolean).join(", ")}
                </div>
              ) : (
                <div style={{fontSize:10,color:"#888"}}>{active}<br/><span style={{fontSize:9,color:"#aaa"}}>Add address in Decorators page</span></div>
              )}
            </div>
          </div>

          <div style={{background:"#222",color:"#fff",padding:"5px 10px",display:"flex",gap:24,fontSize:"9.5px",marginBottom:16}}>
            <div><span style={{opacity:.6,marginRight:4,textTransform:"uppercase",fontSize:"8.5px",letterSpacing:"0.05em"}}>Client</span>{project?.clients?.name}</div>
            <div><span style={{opacity:.6,marginRight:4,textTransform:"uppercase",fontSize:"8.5px",letterSpacing:"0.05em"}}>Items</span>{vItems.length}</div>
            <div><span style={{opacity:.6,marginRight:4,textTransform:"uppercase",fontSize:"8.5px",letterSpacing:"0.05em"}}>Total units</span>{vItems.reduce((a,it)=>a+totalQty(it.buy_sheet_lines||[]),0).toLocaleString()}</div>
          </div>

          {vItems.map((item)=>{
            const idx = sorted.findIndex(it=>it.id===item.id);
            const cp = getCostProd(item.id);
            const r = getResult(item.id);
            const lines = sortedLines(item.buy_sheet_lines||[]);
            const units = totalQty(item.buy_sheet_lines||[]);
            const {printLines,finLines,specLines,setupLines} = buildLineItems(cp, costProds);
            const incoming = item.incoming_goods||(cp?.supplier?"Blanks from "+cp.supplier:"");
            const prodNotes = item.production_notes_po||cp?.itemNotes||"";
            const packing = packingNotes[item.id]||"";

            return (
              <div key={item.id} style={{borderLeft:"3px solid #1a1a1a",paddingLeft:16,marginBottom:24}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                  <div style={{fontSize:13,fontWeight:700}}>{String.fromCharCode(65+idx)} — {item.name}</div>
                  <div style={{fontSize:10,color:"#888"}}>{units} units</div>
                </div>
                <div style={{display:"flex",gap:16,marginBottom:8,fontSize:10,color:"#555"}}>
                  {item.blank_vendor&&<div><span style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#bbb",marginRight:4}}>Brand</span>{item.blank_vendor}</div>}
                  {item.style&&<div><span style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#bbb",marginRight:4}}>Style</span>{item.style}</div>}
                  {item.color&&<div><span style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#bbb",marginRight:4}}>Color</span>{item.color}</div>}
                </div>
                {lines.length>0&&(
                  <div style={{fontSize:10,color:"#555",padding:"5px 10px",background:"#f7f7f7",borderRadius:3,marginBottom:8}}>
                    <span style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#aaa",marginRight:6}}>Sizes</span>
                    {lines.map(l=>l.size+" "+l.qty_ordered).join(" · ")}
                  </div>
                )}
                {item.drive_link&&(
                  <div style={{fontSize:"9.5px",marginBottom:10,padding:"4px 10px",background:"#f0f5ff",borderRadius:3}}>
                    <span style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#888",marginRight:6}}>Production files</span>
                    <a href={item.drive_link} style={{color:"#1a56db"}}>{item.drive_link}</a>
                  </div>
                )}
                {printLines.length>0&&(
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:4,paddingBottom:3,borderBottom:"0.5px solid #eee"}}>Print</div>
                    {printLines.map((l,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"0.5px solid #f5f5f5",fontSize:10}}>
                        <div style={{flex:1,color:"#333"}}>{l.desc}</div>
                        <div style={{color:"#aaa",fontSize:9,margin:"0 12px"}}>{l.qty.toLocaleString()}×{fmtD(l.unit)}</div>
                        <div style={{fontWeight:600}}>{fmtD(l.total)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {finLines.length>0&&(
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:4,paddingBottom:3,borderBottom:"0.5px solid #eee"}}>Finishing & packaging</div>
                    {finLines.map((l,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"0.5px solid #f5f5f5",fontSize:10}}>
                        <div style={{flex:1,color:"#333"}}>{l.desc}</div>
                        <div style={{color:"#aaa",fontSize:9,margin:"0 12px"}}>{l.qty.toLocaleString()}×{fmtD(l.unit)}</div>
                        <div style={{fontWeight:600}}>{fmtD(l.total)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {specLines.length>0&&(
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:4,paddingBottom:3,borderBottom:"0.5px solid #eee"}}>Specialty</div>
                    {specLines.map((l,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"0.5px solid #f5f5f5",fontSize:10}}>
                        <div style={{flex:1,color:"#333"}}>{l.desc}</div>
                        <div style={{color:"#aaa",fontSize:9,margin:"0 12px"}}>{l.qty.toLocaleString()}×{fmtD(l.unit)}</div>
                        <div style={{fontWeight:600}}>{fmtD(l.total)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {setupLines.length>0&&(
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:4,paddingBottom:3,borderBottom:"0.5px solid #eee"}}>Setup fees</div>
                    {setupLines.map((l,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"0.5px solid #f5f5f5",fontSize:10}}>
                        <div style={{flex:1,color:"#333"}}>{l.desc}</div>
                        <div style={{color:"#aaa",fontSize:9,margin:"0 12px"}}>flat</div>
                        <div style={{fontWeight:600}}>{fmtD(l.total)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {r&&r.poTotal>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:8,paddingTop:6,borderTop:"1px solid #1a1a1a"}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#888"}}>Item {String.fromCharCode(65+idx)} total</div>
                    <div style={{fontSize:13,fontWeight:700}}>{fmtD(r.poTotal)}</div>
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:10}}>
                  <NoteBox label="Incoming goods" text={incoming} />
                  <NoteBox label="Production notes" text={prodNotes} />
                  <NoteBox label="Packing / shipping" text={packing} />
                </div>
              </div>
            );
          })}

          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20,paddingTop:8,borderTop:"0.5px solid #ddd"}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.12em",color:"#aaa",marginBottom:4}}>PO Total</div>
              <div style={{fontSize:24,fontWeight:700,letterSpacing:-1}}>
                {fmtD(vItems.reduce((a,it)=>a+(getResult(it.id)?.poTotal||0),0))}
              </div>
            </div>
          </div>

          <div style={{borderTop:"0.5px solid #ddd",paddingTop:10,fontSize:"7.5px",color:"#aaa",lineHeight:1.6}}>
            <strong style={{fontSize:8,fontWeight:700,color:"#888",display:"block",marginBottom:3}}>House Party Distro Purchase Order Conditions</strong>
            House Party Distro must be notified of any blank shortages or discrepancies within 24 hours of receipt of goods. Outbound shipping is at the sole direction of House Party Distro. Packing lists and tracking numbers must be supplied to House Party Distro immediately after the order has shipped. House Party Distro must be invoiced for any charges within 30 days of the PO date. This PO and any documents, files, or previous e-mails may contain confidential information that is legally privileged. If you are not the intended recipient, you are hereby notified that any disclosure, copying, distribution or use of any of the information contained in or attached to this transmission is strictly prohibited.
          </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
