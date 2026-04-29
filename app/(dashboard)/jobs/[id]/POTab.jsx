"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, SIZE_ORDER } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";
import { PdfPreviewModal } from "@/components/PdfPreviewModal";
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

export function POTab({project,items,costingData,onRecalcPhase,onUpdateJob,selectedItemId}) {
  const supabase = createClient();
  const [decorators,setDecorators] = useState([]);
  const [shipMethods,setShipMethods] = useState(project?.type_meta?.po_ship_methods || {});
  const [poShipDates,setPoShipDates] = useState(project?.type_meta?.po_ship_dates || {});
  const [poShipTo,setPoShipTo] = useState(project?.type_meta?.po_ship_to || {});
  const [selectedVendor,setSelectedVendor] = useState("");

  // Debounced type_meta save — prevents race conditions when changing ship date, method, ship-to rapidly
  const metaSaveTimer = useRef(null);
  const pendingMeta = useRef({});
  const saveTypeMeta = useCallback((updates) => {
    pendingMeta.current = { ...pendingMeta.current, ...updates };
    if (metaSaveTimer.current) clearTimeout(metaSaveTimer.current);
    metaSaveTimer.current = setTimeout(async () => {
      const changes = pendingMeta.current;
      pendingMeta.current = {};
      const { data: fresh } = await supabase.from("jobs").select("type_meta").eq("id", project.id).single();
      const meta = { ...(fresh?.type_meta || {}), ...changes };
      await supabase.from("jobs").update({ type_meta: meta }).eq("id", project.id);
      if (onUpdateJob) onUpdateJob({ type_meta: meta });
    }, 500);
  }, [project?.id]);

  const HPD_WAREHOUSE = "House Party Distro\n4670 W Silverado Ranch Blvd. STE 120\nLas Vegas, NV 89139";
  const clientAddress = project?.type_meta?.venue_address || "";
  const shippingRoute = project?.shipping_route || "ship_through";
  const defaultShipTo = shippingRoute === "drop_ship" ? clientAddress : HPD_WAREHOUSE;
  const [itemFields,setItemFields] = useState({});
  const [saving,setSaving] = useState({});
  const [showPreview,setShowPreview] = useState(false); // unused legacy, kept to minimize diff
  const [previewingPO, setPreviewingPO] = useState(false); // opens PdfPreviewModal for the active vendor's PO
  const [showSendEmail,setShowSendEmail] = useState(false);

  useEffect(()=>{
    supabase.from("decorators").select("*").order("name").then(({data})=>setDecorators(data||[]));
  },[]);

  // Default suggestion for packing/shipping notes — pre-filled when no
  // value is set so the decorator gets sensible instructions even on
  // a quick send. User can edit; blur saves whatever's in the field.
  const DEFAULT_PACKING_NOTES = "Bulk pack in cartons by size. Label each carton with item name, color, and size. Include packing slip in carton #1.";

  useEffect(()=>{
    setItemFields(prev => {
      const fields = {...prev};
      items.forEach(it=>{
        if (!fields[it.id]) {
          fields[it.id] = {
            packing_notes: it.packing_notes || DEFAULT_PACKING_NOTES,
            drive_link: it.drive_link||"",
            incoming_goods: it.incoming_goods || it.blanks_order_number || "",
            production_notes_po: it.production_notes_po||"",
          };
        }
      });
      return fields;
    });

    // Persist the default packing note to DB for items that don't have
    // one yet — so the PO PDF carries the suggestion even if the user
    // sends without touching the field.
    items.forEach(it => {
      if (!it.packing_notes && typeof it.id === "string" && it.id.length > 20) {
        supabase.from("items").update({ packing_notes: DEFAULT_PACKING_NOTES }).eq("id", it.id);
      }
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
  // Items still missing a blanks order. Same NON_GARMENT list used
  // elsewhere — patches/stickers/etc. are priced via custom-cost lines
  // and don't have a blanks order at all.
  const NON_GARMENT_PO = ["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"];
  const blanksNotOrdered = vItems.filter(it => (it.blanks_order_cost ?? 0) <= 0 && !NON_GARMENT_PO.includes(it.garment_type));

  // PO sent tracker: stored in job type_meta
  const poSentVendors = project?.type_meta?.po_sent_vendors || [];
  const isPoSent = poSentVendors.includes(active);
  const allVendorsPoSent = vendors.length > 0 && vendors.every(v => poSentVendors.includes(v));

  return (
    <div style={{fontFamily:font,color:T.text,display:"flex",flexDirection:"column",gap:12}}>

      {/* In-hands date notice */}
      {project.target_ship_date && (
        <div style={{display:"flex",alignItems:"center",gap:8,paddingBottom:8,borderBottom:`1px solid ${T.border}`}}>
          <span style={{fontSize:10,fontWeight:700,color:T.amber,letterSpacing:"0.06em",textTransform:"uppercase"}}>Client in-hands</span>
          <span style={{fontSize:11,color:T.text,fontWeight:600}}>{new Date(project.target_ship_date+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</span>
        </div>
      )}

      <div style={{background:T.card,border:"1px solid "+T.border,borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
        {/* Single row: Vendor | Ship Method | Ship Date | Ship To | Actions */}
        <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>
          {/* Vendor */}
          <div style={{display:"flex",flexDirection:"column",gap:4,alignSelf:"center"}}>
            <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Vendor</div>
            <div style={{display:"flex",gap:6}}>
              {vendors.length===0&&<div style={{fontSize:11,color:T.faint,padding:"6px 0"}}>No vendors assigned</div>}
              {vendors.map(v=>(
                <button key={v} onClick={()=>setSelectedVendor(v)}
                  style={{background:active===v?T.accent:T.surface,border:"1px solid "+(active===v?T.accent:T.border),borderRadius:6,color:active===v?"#fff":T.muted,fontFamily:font,fontSize:11,fontWeight:600,padding:"5px 12px",cursor:"pointer"}}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          {/* Ship By Date — per vendor */}
          <div style={{display:"flex",flexDirection:"column",gap:4,alignSelf:"center"}}>
            <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship by date</div>
            <input type="date" value={poShipDates[active]||""} onClick={e=>e.target.showPicker?.()}
              onChange={e=>{
                const val=e.target.value;
                const updated={...poShipDates,[active]:val};
                setPoShipDates(updated);
                saveTypeMeta({ po_ship_dates: updated });
              }}
              style={{background:T.surface,border:`1px solid ${poShipDates[active]?T.accent+"66":T.border}`,borderRadius:6,color:poShipDates[active]?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer"}} />
          </div>
          {/* Ship Method */}
          <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:180,alignSelf:"center"}}>
            <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship method</div>
            <select value={shipMethods[active]||""} onChange={e=>{
              const val=e.target.value;
              const updated={...shipMethods,[active]:val};
              setShipMethods(updated);
              saveTypeMeta({ po_ship_methods: updated });
            }}
              style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:shipMethods[active]?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer"}}>
              <option value="">— select —</option>
              {SHIP_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {/* Ship To */}
          <div style={{display:"flex",flexDirection:"column",gap:4,flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship to</span>
              <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:shippingRoute==="drop_ship"?T.green:T.accent}}>
                {shippingRoute==="drop_ship"?"Client address":"HPD warehouse"}
              </span>
            </div>
            <textarea value={poShipTo[active]||defaultShipTo} onChange={e=>{
              const val=e.target.value;
              const updated={...poShipTo,[active]:val};
              setPoShipTo(updated);
              saveTypeMeta({ po_ship_to: updated });
            }}
              style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:11,padding:"8px 10px",outline:"none",resize:"vertical",minHeight:110,lineHeight:1.4}}/>
          </div>
          {/* Items ready + buttons */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8,flexShrink:0}}>
            {ready&&(
              <div style={{fontSize:14,fontWeight:600,color:allFilled?T.green:T.amber}}>
                {vItems.filter(it=>itemFields[it.id]?.packing_notes?.trim()).length}/{vItems.length} items ready
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:6,width:170}}>
              <button onClick={()=>setShowSendEmail(!showSendEmail)} disabled={!ready} style={{background:ready?T.blue:T.surface,border:"1px solid "+(ready?T.blue:T.border),borderRadius:8,color:ready?"#fff":T.faint,fontFamily:font,fontSize:13,fontWeight:700,padding:"10px 16px",cursor:ready?"pointer":"default",opacity:ready?1:0.5,width:"100%"}}>
                Send to Decorator
              </button>
              <button onClick={()=>setPreviewingPO(true)}
                style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,color:T.muted,fontFamily:font,fontSize:12,fontWeight:600,padding:"8px 16px",cursor:"pointer",width:"100%"}}>
                Preview PDF
              </button>
            </div>
          </div>
        </div>
      </div>
      {previewingPO && (
        <PdfPreviewModal
          src={`/api/pdf/po/${project.id}${active?`?vendor=${encodeURIComponent(active)}`:""}`}
          title={`PO${active?` · ${active}`:""}`}
          downloadHref={`/api/pdf/po/${project.id}?download=1${active?`&vendor=${encodeURIComponent(active)}`:""}`}
          onClose={()=>setPreviewingPO(false)}
        />
      )}
      {showSendEmail&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowSendEmail(false)}>
        <div style={{background:T.card,borderRadius:12,width:"95vw",maxWidth:600,maxHeight:"90vh",overflow:"auto",padding:0}} onClick={e=>e.stopPropagation()}>
        <SendEmailDialog
          type="po"
          jobId={project.id}
          vendor={active}
          contacts={getDec(active)?.contacts_list||[]}
          defaultEmail={getDec(active)?.contact_email||""}
          defaultSubject={`HPD PO# ${project.type_meta?.qb_invoice_number || project.job_number || ""}${vItems.map(it=>String.fromCharCode(65+(it.sort_order||0))).join("")} — ${(project.clients?.name||project.title||"")} — ${active}`}
          onClose={()=>setShowSendEmail(false)}
          onSent={async()=>{
            logJobActivity(project.id, `PO sent to ${active} (${vItems.length} items)`);
            // Track which vendors have received POs + when
            const updatedVendors = [...new Set([...(project.type_meta?.po_sent_vendors||[]), active])];
            const poSentDates = { ...(project.type_meta?.po_sent_dates||{}), [active]: new Date().toISOString() };
            const meta = {...(project.type_meta||{}), po_sent_vendors: updatedVendors, po_sent_dates: poSentDates, po_ship_methods: shipMethods, po_ship_dates: poShipDates};
            await supabase.from("jobs").update({type_meta:meta}).eq("id",project.id);
            if(onUpdateJob) onUpdateJob({type_meta:meta});
            // Also set decorator_assignments.sent_to_decorator_date so it's queryable
            for (const it of vItems) {
              try {
                const { data: da } = await supabase.from("decorator_assignments").select("id").eq("item_id", it.id).limit(1).single();
                if (da) await supabase.from("decorator_assignments").update({ sent_to_decorator_date: new Date().toISOString().slice(0, 10) }).eq("id", da.id);
              } catch {}
            }
            // Advance items for this vendor to in_production
            for (const it of vItems) {
              if (it.pipeline_stage === "blanks_ordered" || !it.pipeline_stage) {
                await supabase.from("items").update({ pipeline_stage: "in_production", pipeline_timestamps: { ...(it.pipeline_timestamps || {}), in_production: new Date().toISOString() } }).eq("id", it.id);
              }
              const costProd = costingData?.costProds?.find(cp => cp.id === it.id);
              if (costProd?.printVendor) {
                const { data: da } = await supabase.from("decorator_assignments").select("id").eq("item_id", it.id).limit(1).single();
                if (da) await supabase.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("id", da.id);
              }
            }
            if(onRecalcPhase) setTimeout(onRecalcPhase, 300);
          }}
        />
        </div>
        </div>
      )}

      {/* Warnings and status */}
      {active && blanksNotOrdered.length > 0 && (
        <div style={{display:"flex",alignItems:"center",gap:8,paddingBottom:8,borderBottom:`1px solid ${T.border}`}}>
          <span style={{fontSize:10,fontWeight:700,color:T.amber,letterSpacing:"0.06em",textTransform:"uppercase"}}>Blanks pending</span>
          <span style={{fontSize:11,color:T.muted}}>{blanksNotOrdered.length} item{blanksNotOrdered.length!==1?"s":""} without blanks ordered — complete the Blanks tab first</span>
        </div>
      )}

      {/* PO sent tracker */}
      {vendors.length > 0 && (
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:10,color:T.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>PO Status:</span>
          {vendors.map(v=>{
            const sent = poSentVendors.includes(v);
            return (
            <button key={v} onClick={async()=>{
              const supabase = createClient();
              if (sent) {
                // Un-mark as sent
                const updated = poSentVendors.filter(x=>x!==v);
                const meta = {...(project.type_meta||{}), po_sent_vendors: updated};
                await supabase.from("jobs").update({type_meta:meta}).eq("id",project.id);
                if(onUpdateJob) onUpdateJob({type_meta:meta});
                logJobActivity(project.id, `PO for ${v} unmarked as sent`);
              } else {
                // Mark as sent + advance items to in_production
                const updated = [...new Set([...poSentVendors, v])];
                const meta = {...(project.type_meta||{}), po_sent_vendors: updated};
                await supabase.from("jobs").update({type_meta:meta}).eq("id",project.id);
                if(onUpdateJob) onUpdateJob({type_meta:meta});
                const vendorItems = items.filter(it=>{
                  const cp = costingData?.costProds?.find(cp=>cp.id===it.id);
                  return cp?.printVendor===v;
                });
                for (const it of vendorItems) {
                  if (it.pipeline_stage === "blanks_ordered" || !it.pipeline_stage) {
                    await supabase.from("items").update({ pipeline_stage: "in_production", pipeline_timestamps: { ...(it.pipeline_timestamps || {}), in_production: new Date().toISOString() } }).eq("id", it.id);
                  }
                  const costProd = costingData?.costProds?.find(cp => cp.id === it.id);
                  if (costProd?.printVendor) {
                    const { data: da } = await supabase.from("decorator_assignments").select("id").eq("item_id", it.id).limit(1).single();
                    if (da) await supabase.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("id", da.id);
                  }
                }
                logJobActivity(project.id, `PO for ${v} manually marked as sent (${vendorItems.length} items)`);
                if(onRecalcPhase) setTimeout(onRecalcPhase, 300);
              }
            }}
              style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:6,cursor:"pointer",border:`1px solid ${sent?T.green:T.border}`,
                background:"transparent",
                color:sent?T.green:T.muted,fontFamily:font}}>
              {v} <span style={{fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",fontSize:9,marginLeft:4}}>{sent?"✓ Sent":"Not sent"}</span>
            </button>
          );})}
          {allVendorsPoSent && <span style={{fontSize:10,fontWeight:700,color:T.green,letterSpacing:"0.06em",textTransform:"uppercase"}}>All POs sent</span>}
        </div>
      )}

      {active&&(
        <div style={{background:T.card,border:"1px solid "+T.border,borderRadius:10,overflow:"hidden"}}>
          {vItems.map((item,i)=>{
            if (selectedItemId && item.id !== selectedItemId) return null;
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



    </div>
  );
}
