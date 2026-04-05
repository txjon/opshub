"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, SIZE_ORDER } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";
// dates — milestones removed, ship date is set manually

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

const SHIP_METHODS = ["UPS Ground","UPS 2-Day","UPS Next Day","FedEx Ground","FedEx Express","USPS Priority","Freight / LTL","Will Call","Decorator Drop Ship"];

export function POTab({project,items,costingData,onRecalcPhase,onUpdateJob}) {
  const supabase = createClient();
  const [decorators,setDecorators] = useState([]);
  const [shipMethods,setShipMethods] = useState(project?.type_meta?.po_ship_methods || {});
  const [poShipTo,setPoShipTo] = useState(project?.type_meta?.po_ship_to || {});
  const [selectedVendor,setSelectedVendor] = useState("");

  const HPD_WAREHOUSE = "House Party Distro\n4670 W Silverado Ranch Blvd. STE 120\nLas Vegas, NV 89118";
  const clientAddress = project?.type_meta?.venue_address || "";
  const shippingRoute = project?.shipping_route || "ship_through";
  const defaultShipTo = shippingRoute === "drop_ship" ? clientAddress : HPD_WAREHOUSE;
  const [itemFields,setItemFields] = useState({});
  const [saving,setSaving] = useState({});
  const [showPreview,setShowPreview] = useState(false);
  const [showModal,setShowModal] = useState(false);
  const [showSendEmail,setShowSendEmail] = useState(false);

  useEffect(()=>{
    supabase.from("decorators").select("*").order("name").then(({data})=>setDecorators(data||[]));
  },[]);

  useEffect(()=>{
    setItemFields(prev => {
      const fields = {...prev};
      items.forEach(it=>{
        if (!fields[it.id]) {
          fields[it.id] = {
            packing_notes: it.packing_notes||"",
            drive_link: it.drive_link||"",
            incoming_goods: it.incoming_goods || it.blanks_order_number || "",
            production_notes_po: it.production_notes_po||"",
          };
        }
      });
      return fields;
    });
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
  const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
  const shipDate = project?.target_ship_date
    ? new Date(project.target_ship_date+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})
    : "—";

  function updateItemField(itemId, field, val) {
    setItemFields(p=>({...p,[itemId]:{...p[itemId],[field]:val}}));
  }
  async function saveItemField(itemId, field, val) {
    setSaving(p=>({...p,[itemId+"_"+field]:true}));
    await supabase.from("items").update({[field]:val}).eq("id",itemId);
    setSaving(p=>({...p,[itemId+"_"+field]:false}));
  }
  async function copyFieldToAll(sourceItemId, field) {
    const val = itemFields[sourceItemId]?.[field] || "";
    if (!val) return;
    const updates = {};
    for (const it of vItems) {
      if (it.id === sourceItemId) continue;
      updates[it.id] = {...(itemFields[it.id]||{}), [field]: val};
      const { error } = await supabase.from("items").update({[field]:val}).eq("id",it.id);
      if (error) console.error("Copy to all save error:", it.id, field, error);
    }
    setItemFields(p=>({...p,...updates}));
  }

  const ready = !!active;
  const allFilled = vItems.every(it=>itemFields[it.id]?.packing_notes?.trim());

  // Blanks gate: check if all items for current vendor have blanks ordered
  const blanksNotOrdered = vItems.filter(it => !it.blanks_order_number && it.garment_type !== "accessory");

  // PO sent tracker: stored in job type_meta
  const poSentVendors = project?.type_meta?.po_sent_vendors || [];
  const isPoSent = poSentVendors.includes(active);
  const allVendorsPoSent = vendors.length > 0 && vendors.every(v => poSentVendors.includes(v));

  return (
    <div style={{fontFamily:font,color:T.text,display:"flex",flexDirection:"column",gap:12}}>

      <div style={{background:T.card,border:"1px solid "+T.border,borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
        {/* Row 1: Vendor buttons */}
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
        {/* Row 2: Ship method + Ship to (left) | Items ready + buttons (right) */}
        <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>
          {/* Left: ship method + address */}
          <div style={{display:"flex",gap:12,alignItems:"flex-start",flex:"0 0 auto",maxWidth:480}}>
            <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:180}}>
              <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship method</div>
              <select value={shipMethods[active]||""} onChange={async e=>{
                const val=e.target.value;
                const updated={...shipMethods,[active]:val};
                setShipMethods(updated);
                const { data: fresh } = await supabase.from("jobs").select("type_meta").eq("id", project.id).single();
                const meta = { ...(fresh?.type_meta || {}), po_ship_methods: updated };
                await supabase.from("jobs").update({ type_meta: meta }).eq("id", project.id);
                if(onUpdateJob) onUpdateJob({type_meta:meta});
              }}
                style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:shipMethods[active]?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer"}}>
                <option value="">— select —</option>
                {SHIP_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,width:260}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship to</span>
                <span style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:shippingRoute==="drop_ship"?T.greenDim:T.accentDim,color:shippingRoute==="drop_ship"?T.green:T.accent}}>
                  {shippingRoute==="drop_ship"?"Client address":"HPD warehouse"}
                </span>
              </div>
              <textarea value={poShipTo[active]||defaultShipTo} onChange={async e=>{
                const val=e.target.value;
                const updated={...poShipTo,[active]:val};
                setPoShipTo(updated);
                const { data: fresh } = await supabase.from("jobs").select("type_meta").eq("id", project.id).single();
                const meta = { ...(fresh?.type_meta || {}), po_ship_to: updated };
                await supabase.from("jobs").update({ type_meta: meta }).eq("id", project.id);
                if(onUpdateJob) onUpdateJob({type_meta:meta});
              }}
                style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:11,padding:"8px 10px",outline:"none",resize:"vertical",minHeight:110,lineHeight:1.4}}/>
            </div>
          </div>
          {/* Right: items ready + buttons */}
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
            {ready&&(
              <div style={{fontSize:14,fontWeight:600,color:allFilled?T.green:T.amber}}>
                {vItems.filter(it=>itemFields[it.id]?.packing_notes?.trim()).length}/{vItems.length} items ready
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:6,width:170}}>
              <button onClick={()=>setShowSendEmail(!showSendEmail)} disabled={!ready} style={{background:ready?T.purple:T.surface,border:"1px solid "+(ready?T.purple:T.border),borderRadius:7,color:ready?"#fff":T.faint,fontFamily:font,fontSize:12,fontWeight:600,padding:"7px 16px",cursor:ready?"pointer":"default",opacity:ready?1:0.5,width:"100%"}}>
                Send to Decorator
              </button>
              <button onClick={()=>{ if(ready) window.open(`/api/pdf/po/${project.id}${active?`?vendor=${encodeURIComponent(active)}`:""}`,"_blank"); }} disabled={!ready}
                style={{background:ready?T.accent:T.surface,border:"1px solid "+(ready?T.accent:T.border),borderRadius:7,color:ready?"#fff":T.faint,fontFamily:font,fontSize:12,fontWeight:600,padding:"7px 16px",cursor:ready?"pointer":"default",opacity:ready?1:0.5,width:"100%"}}>
                Preview
              </button>
            </div>
          </div>
        </div>
      </div>
      {showSendEmail&&(
        <SendEmailDialog
          type="po"
          jobId={project.id}
          vendor={active}
          contacts={getDec(active)?.contacts_list||[]}
          defaultEmail={getDec(active)?.contact_email||""}
          defaultSubject={`PO ${project.type_meta?.qb_invoice_number || project.job_number || ""} — ${(project.clients?.name||project.title||"")} — ${active}`}
          onClose={()=>setShowSendEmail(false)}
          onSent={async()=>{
            logJobActivity(project.id, `PO sent to ${active} (${vItems.length} items)`);
            // Track which vendors have received POs
            const updatedVendors = [...new Set([...(project.type_meta?.po_sent_vendors||[]), active])];
            const meta = {...(project.type_meta||{}), po_sent_vendors: updatedVendors, po_ship_methods: shipMethods};
            await supabase.from("jobs").update({type_meta:meta}).eq("id",project.id);
            if(onUpdateJob) onUpdateJob({type_meta:meta});
            if(onRecalcPhase) setTimeout(onRecalcPhase, 300);
          }}
        />
      )}

      {/* Warnings and status */}
      {active && blanksNotOrdered.length > 0 && (
        <div style={{background:T.amberDim,border:`1px solid ${T.amber}44`,borderRadius:8,padding:"10px 14px",fontSize:12,color:T.amber}}>
          {blanksNotOrdered.length} item{blanksNotOrdered.length!==1?"s":""} without blanks ordered — complete the Blanks tab first
        </div>
      )}

      {/* PO sent tracker */}
      {vendors.length > 0 && (
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:10,color:T.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>PO Status:</span>
          {vendors.map(v=>(
            <span key={v} style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:99,
              background:poSentVendors.includes(v)?T.greenDim:T.surface,
              color:poSentVendors.includes(v)?T.green:T.faint}}>
              {v} {poSentVendors.includes(v)?"✓ Sent":"— Not sent"}
            </span>
          ))}
          {allVendorsPoSent && <span style={{fontSize:10,color:T.green,fontWeight:600}}>All POs sent</span>}
        </div>
      )}

      {active&&(
        <div style={{background:T.card,border:"1px solid "+T.border,borderRadius:10,overflow:"hidden"}}>
          {vItems.map((item,i)=>{
            const idx = sorted.findIndex(it=>it.id===item.id);
            const f = itemFields[item.id]||{};
            const isSaving = Object.keys(saving).some(k=>k.startsWith(item.id)&&saving[k]);
            const fieldInput = (field, placeholder, opts={}) => (
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{fontSize:8,color:T.faint,textTransform:"uppercase",letterSpacing:"0.07em"}}>{opts.label||field.replace(/_/g," ")}</div>
                  {vItems.length>1&&(f[field]||"").trim()&&(
                    <button onClick={()=>copyFieldToAll(item.id,field)}
                      style={{fontSize:8,color:T.accent,fontFamily:font,background:"none",border:"none",cursor:"pointer",padding:0}}
                      onMouseEnter={e=>e.currentTarget.style.color=T.green}
                      onMouseLeave={e=>e.currentTarget.style.color=T.accent}>↓ Copy to all</button>
                  )}
                </div>
                {opts.multiline ? (
                  <textarea value={f[field]||""} placeholder={placeholder}
                    onChange={e=>updateItemField(item.id,field,e.target.value)}
                    onBlur={e=>saveItemField(item.id,field,e.target.value)}
                    rows={2}
                    style={{background:T.surface,border:"1px solid "+T.border,borderRadius:5,color:T.text,fontFamily:font,fontSize:11,padding:"5px 8px",outline:"none",resize:"none",lineHeight:1.4,width:"100%",boxSizing:"border-box"}}
                  />
                ) : (
                  <input type="text" value={f[field]||""} placeholder={placeholder}
                    onChange={e=>updateItemField(item.id,field,e.target.value)}
                    onBlur={e=>saveItemField(item.id,field,e.target.value)}
                    style={{background:T.surface,border:"1px solid "+T.border,borderRadius:5,color:T.text,fontFamily:opts.mono?mono:font,fontSize:11,padding:"5px 8px",outline:"none",width:"100%",boxSizing:"border-box"}}
                  />
                )}
              </div>
            );
            return (
              <div key={item.id} style={{borderBottom:i<vItems.length-1?"1px solid "+T.border:"none",padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{width:22,height:22,borderRadius:5,background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:T.accent,fontFamily:mono,flexShrink:0}}>
                    {String.fromCharCode(65+idx)}
                  </span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.text}}>{item.name}</div>
                    <div style={{fontSize:10,color:T.muted,marginTop:1}}>{[item.blank_vendor,item.style,item.color].filter(Boolean).join(" · ")} · {totalQty(item.buy_sheet_lines||[])} units</div>
                  </div>
                  <div style={{fontSize:11,color:T.muted,fontFamily:mono}}>{getCostProd(item.id)?.printVendor||"—"}</div>
                  {isSaving&&<div style={{fontSize:9,color:T.amber}}>saving…</div>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {fieldInput("drive_link","https://drive.google.com/...",{label:"Production files link",mono:true})}
                  {fieldInput("incoming_goods","e.g. Blanks from S&S — PO #12345",{label:"Incoming goods"})}
                  {fieldInput("production_notes_po","Special instructions for decorator",{label:"Production notes",multiline:true})}
                  {fieldInput("packing_notes","e.g. Fewest boxes, label all contents",{label:"Packing / shipping notes",multiline:true})}
                </div>
              </div>
            );
          })}
        </div>
      )}



      {showModal&&ready&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.75)",zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",padding:"40px 20px"}} onClick={e=>{if(e.target===e.currentTarget)setShowModal(false)}}>
          <div style={{width:"100%",maxWidth:860,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{project?.clients?.name} — {active} PO</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{const a=document.createElement("a");a.href=`/api/pdf/po/${project.id}?download=1${active?`&vendor=${encodeURIComponent(active)}`:""}`;a.download="po.pdf";a.click();}} style={{background:T.green,border:"none",borderRadius:7,color:"#fff",fontFamily:font,fontSize:12,fontWeight:600,padding:"7px 16px",cursor:"pointer"}}>Export PDF</button>
                <button onClick={()=>setShowModal(false)} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,color:"#fff",fontFamily:font,fontSize:12,padding:"7px 14px",cursor:"pointer"}}>Close</button>
              </div>
            </div>
            <iframe
              src={`/api/pdf/po/${project.id}${active?`?vendor=${encodeURIComponent(active)}`:""}`}
              style={{width:"100%",height:"80vh",border:"none",borderRadius:8,background:"#fff"}}
              title="PO Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}
