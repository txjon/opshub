"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, SIZE_ORDER } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";
import { applyPoSentToVendorItems, revertPoSentFromVendorItems } from "@/lib/po-actions";
import { useClientBranding } from "@/lib/branding-client";
import { shippingRoutesForSlug } from "@/lib/tenants";
import { useIsMobile } from "@/lib/useIsMobile";
import { PdfCanvasPreview } from "@/components/PdfCanvasPreview";
import { addBusinessDays, addDays, fmtDay } from "@/lib/dates";
import { poSendAllowed } from "@/lib/date-chain";
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

const SHIP_METHODS = ["UPS Ground","UPS 2-Day","UPS Next Day","UPS Next Day Air Saver","Freight / LTL","Ocean","Pick Up","Vendor's Choice"];

export function POTab({project,items,costingData,onRecalcPhase,onUpdateJob,selectedItemId}) {
  const supabase = createClient();
  const branding = useClientBranding();
  const isMobile = useIsMobile();
  // Per-item route override is limited to the tenant's allowed routes
  // (DMD = ship_through only — importer of record).
  const allowedRoutes = shippingRoutesForSlug(branding.slug);
  // Derive "HPD" / "IHM" from the company name initials so PO subjects
  // match the tenant the user is acting on. Falls back to HPD until the
  // companies row finishes loading.
  const poPrefix = ((branding.name || "House Party Distro")
    .split(/\s+/).filter(Boolean)
    .map(w => (w[0] || "").toUpperCase()).join("")) || "HPD";
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
  const [itemRoutes,setItemRoutes] = useState({}); // local mirror of items.shipping_route for instant UI on select change
  const [saving,setSaving] = useState({});
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
    // Seed the route mirror with whatever's on the DB so the select
    // reflects the saved value on initial render.
    setItemRoutes(prev => {
      const next = {...prev};
      items.forEach(it => { if (!(it.id in next)) next[it.id] = it.shipping_route || ""; });
      return next;
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
  // Per-vendor ship-to: a vendor whose items resolve to ship_through/stage
  // (manual override → vendor default → job route) ships to OUR warehouse, even
  // on a drop-ship job. Only when all the vendor's items are drop_ship does the
  // PO go to the client address.
  // Vendor default route only overrides DROP-SHIP jobs (stage/ship_through
  // already route to HPD). Inert on non-drop-ship jobs.
  const isDropShipJob = shippingRoute === "drop_ship";
  const activeVendorRoute = isDropShipJob ? (getDec(active)?.default_shipping_route || "") : "";
  const routeOfItem = (it) => ((itemRoutes[it.id] ?? it.shipping_route) || activeVendorRoute || shippingRoute);
  const activeShipsToClient = vItems.length > 0 && vItems.every(it => routeOfItem(it) === "drop_ship");
  const activeDefaultShipTo = activeShipsToClient ? clientAddress : HPD_WAREHOUSE;
  // Bulk-to-HPD vendors (a vendor default route that ships to us) default their
  // PO ship method to "Vendor's Choice" — they pick the carrier. Explicit pick
  // still wins.
  const activeVendorShipsToHpd = !!activeVendorRoute && activeVendorRoute !== "drop_ship";
  const effectiveShipMethod = shipMethods[active] || (activeVendorShipsToHpd ? "Vendor's Choice" : "");
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
  // R1 — the one gate (locked 2026-07-15): a PO needs a ship-by date or a
  // deliberate ASAP before it can send. Blank used to sail through.
  const shipBySet = poSendAllowed(poShipDates[active]);
  const canSend = ready && shipBySet;
  const allFilled = vItems.every(it=>itemFields[it.id]?.packing_notes?.trim());

  // Blanks gate: check if all items for current vendor have blanks ordered
  // Items still missing a blanks order. Same NON_GARMENT list used
  // elsewhere — patches/stickers/etc. are priced via custom-cost lines
  // and don't have a blanks order at all.
  const NON_GARMENT_PO = ["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"];
  const blanksNotOrdered = vItems.filter(it => it.blanks_order_cost == null && !NON_GARMENT_PO.includes(it.garment_type));

  // PO sent tracker: stored in job type_meta
  const poSentVendors = project?.type_meta?.po_sent_vendors || [];
  const isPoSent = poSentVendors.includes(active);
  const allVendorsPoSent = vendors.length > 0 && vendors.every(v => poSentVendors.includes(v));

  // Revision detection — a "revised" send happens when this vendor has
  // already received a PO. Drives the button label, the email subject
  // suffix, the (Revised) banner on the PDF, and the per-item NEW chips
  // for items added since the original send (those have no
  // decorator_assignments.sent_to_decorator_date yet).
  const isRevised = isPoSent;
  const originalSentDate = project?.type_meta?.po_sent_dates?.[active] || null;

  // Active decorator's saved lead time (business days). Powers the
  // "Apply default" suggestion next to the empty Ship-by date input.
  const activeDecorator = getDec(active);
  const activeLeadDays = Number(activeDecorator?.lead_time_days) || 0;
  const todayIso = new Date().toISOString().slice(0, 10);
  // Common quick-set offsets exposed as small buttons under the date
  // input. Business-day math via addBusinessDays so they skip
  // weekends; matches the in-hands → priority calc used elsewhere.
  const QUICK_OFFSETS = [10, 30, 60, 90];
  function fmtShortDate(iso) {
    return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  // Central writer for po_ship_dates[active]. Anything that changes
  // the ship-by date (typed input, ASAP toggle, quick-offset buttons,
  // decorator default) routes through here so the revision log fires
  // consistently. newVal: ISO date string, "ASAP", or "" (cleared).
  function setShipDateForVendor(newVal) {
    if (!active) return;
    const prev = poShipDates[active] || "";
    const next = newVal || "";
    const updated = { ...poShipDates, [active]: next };
    setPoShipDates(updated);
    saveTypeMeta({ po_ship_dates: updated });
    // Audit trail — only fires when the PO has already been sent to
    // this vendor AND the value actually changed. Pre-send tweaks are
    // setup noise; post-send changes are real revisions worth logging.
    if (isPoSent && prev !== next) {
      const fmt = (v) => !v ? "—" : v === "ASAP" ? "ASAP" : fmtShortDate(v);
      logJobActivity(project.id, `Ship date for ${active} revised — ${fmt(prev)} → ${fmt(next)}`);
    }
  }
  function applyDateOffset(days) {
    setShipDateForVendor(addBusinessDays(todayIso, days));
  }
  // Mirror the date helper for ship method + ship-to. Same gate: only
  // log when the PO has been sent AND the value actually changed.
  // ShipTo is multi-line; we collapse to a single line for the log
  // entry so the activity feed doesn't get blown out.
  function setShipMethodForVendor(newVal) {
    if (!active) return;
    const prev = shipMethods[active] || "";
    const next = newVal || "";
    if (prev === next) return;
    const updated = { ...shipMethods, [active]: next };
    setShipMethods(updated);
    saveTypeMeta({ po_ship_methods: updated });
    if (isPoSent) {
      const fmt = (v) => v || "—";
      logJobActivity(project.id, `Ship method for ${active} revised — ${fmt(prev)} → ${fmt(next)}`);
    }
  }
  // Ship-to is a textarea so onChange fires per keystroke. We split
  // the write (every keystroke, for autosave) from the audit log
  // (commit only) so the activity feed gets one entry per real change,
  // not one per character. shipToBaseline holds the value at the last
  // commit boundary so blur knows whether anything actually changed.
  function setShipToForVendor(newVal) {
    if (!active) return;
    const updated = { ...poShipTo, [active]: newVal || "" };
    setPoShipTo(updated);
    saveTypeMeta({ po_ship_to: updated });
  }
  const shipToBaseline = useRef({});
  useEffect(() => {
    // Seed baseline whenever the active vendor changes — captures the
    // value Drake landed on, not the value typed mid-edit.
    if (active && !(active in shipToBaseline.current)) {
      shipToBaseline.current[active] = poShipTo[active] || "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  function commitShipToRevision() {
    if (!active || !isPoSent) return;
    const prev = (shipToBaseline.current[active] || "").trim();
    const next = (poShipTo[active] || "").trim();
    if (prev === next) return;
    const oneLine = (v) => v ? v.split("\n").map(l => l.trim()).filter(Boolean).join(", ") : "default";
    logJobActivity(project.id, `Ship-to for ${active} revised — ${oneLine(prev)} → ${oneLine(next)}`);
    shipToBaseline.current[active] = poShipTo[active] || "";
  }

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
        {/* Single row: Vendor | Ship Method | Ship Date | Ship To | Actions
            On mobile the row stacks — Ship To and the Send button get
            full width so they're tappable + don't horizontal-scroll. */}
        <div style={{display:"flex",gap:isMobile?12:16,alignItems:"flex-start",flexDirection:isMobile?"column":"row"}}>
          {/* Vendor */}
          <div style={{display:"flex",flexDirection:"column",gap:4,alignSelf:isMobile?"stretch":"center",width:isMobile?"100%":undefined}}>
            <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Vendor</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {vendors.length===0&&<div style={{fontSize:11,color:T.faint,padding:"6px 0"}}>No vendors assigned</div>}
              {vendors.map(v=>(
                <button key={v} onClick={()=>setSelectedVendor(v)}
                  style={{background:active===v?T.accent:T.surface,border:"1px solid "+(active===v?T.accent:T.border),borderRadius:6,color:active===v?"#fff":T.muted,fontFamily:font,fontSize:11,fontWeight:600,padding:"5px 12px",cursor:"pointer"}}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          {/* Ship by date + Ship method — stacked next to Ship To.
              Desktop: fixed 200px width so the column sizes uniformly
              and sits flush against Ship To. Mobile: full-width inputs
              and the stack itself stretches. */}
          <div style={{display:"flex",flexDirection:"column",gap:10,alignSelf:isMobile?"stretch":"flex-start",flexShrink:0,width:isMobile?"100%":undefined}}>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship by date</div>
              {/* ASAP and a date are mutually exclusive — both write to the
                  same po_ship_dates[vendor] slot. PDF route detects the
                  "ASAP" sentinel and renders it as-is instead of parsing
                  it as a date. */}
              {poShipDates[active] === "ASAP" ? (
                <div style={{display:"flex",alignItems:"center",gap:6,width:isMobile?"100%":200,height:32,background:T.amberDim,border:`1px solid ${T.amber}66`,borderRadius:6,padding:"0 10px",boxSizing:"border-box"}}>
                  <span style={{flex:1,fontSize:11,fontWeight:700,color:T.amber,letterSpacing:"0.06em",textTransform:"uppercase"}}>ASAP</span>
                  <button onClick={()=>setShipDateForVendor("")} title="Clear"
                    style={{background:"transparent",border:"none",color:T.amber,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
                </div>
              ) : (
                <>
                <div style={{display:"flex",gap:4,alignItems:"center",width:isMobile?"100%":undefined}}>
                  <input type="date" value={poShipDates[active]||""} onClick={e=>e.target.showPicker?.()}
                    onChange={e=>setShipDateForVendor(e.target.value)}
                    style={{flex:1,background:T.surface,border:`1px solid ${poShipDates[active]?T.accent+"66":T.border}`,borderRadius:6,color:poShipDates[active]?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer",width:isMobile?"auto":152,boxSizing:"border-box"}} />
                  <button onClick={()=>setShipDateForVendor("ASAP")} title="Ship as soon as possible"
                    style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:T.amber,fontFamily:font,fontSize:10,fontWeight:700,letterSpacing:"0.05em",padding:"0 8px",height:32,cursor:"pointer",boxSizing:"border-box",flexShrink:0}}>ASAP</button>
                </div>
                {/* Decorator-default suggestion — only when the field
                    is empty AND the active decorator has a saved lead
                    time. One tap applies (today + leadDays business
                    days). Hidden once the date is set so it stops
                    nagging. */}
                {!poShipDates[active] && activeLeadDays > 0 && (() => {
                  // lead times are CALENDAR days (vendors quote "6 weeks"),
                  // matching the date-chain derivation — not business days
                  const suggested = addDays(todayIso, activeLeadDays);
                  return (
                    <button onClick={()=>setShipDateForVendor(suggested)}
                      title={`${active}'s saved lead time is ${activeLeadDays} days`}
                      style={{alignSelf:"flex-start",background:T.accentDim,border:`1px solid ${T.accent}66`,borderRadius:5,color:T.accent,fontFamily:font,fontSize:10,fontWeight:600,padding:"3px 8px",cursor:"pointer",marginTop:2}}>
                      Use {active} default · +{activeLeadDays}d → {fmtShortDate(suggested)}
                    </button>
                  );
                })()}
                {/* Quick-set offsets — visible only when the date is
                    empty so they don't crowd the row once it's filled.
                    Business-day math so weekends are skipped. */}
                {!poShipDates[active] && (
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:2}}>
                    {QUICK_OFFSETS.map(d => (
                      <button key={d} onClick={()=>applyDateOffset(d)}
                        title={`${d} business days from today → ${fmtShortDate(addBusinessDays(todayIso, d))}`}
                        style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontFamily:font,fontSize:10,fontWeight:600,padding:"3px 8px",cursor:"pointer"}}>
                        +{d}d
                      </button>
                    ))}
                  </div>
                )}
                </>
              )}
              {/* Mid-flight slip (edited in-line on /production2). The PO's
                  agreed date above is never rewritten — the live date rides
                  on the chain (type_meta.po_ship_live, locked R3). */}
              {(() => {
                const live = project?.type_meta?.po_ship_live?.[active]?.date;
                const agreed = poShipDates[active];
                if (!live || !agreed || agreed === "ASAP" || live === agreed) return null;
                const slip = Math.round((new Date(live + "T12:00:00").getTime() - new Date(agreed + "T12:00:00").getTime()) / 86400000);
                return (
                  <div style={{fontSize:10,fontWeight:700,color:T.amber,marginTop:2}}>
                    now {fmtDay(live)} ({slip > 0 ? "+" : ""}{slip}d vs plan)
                  </div>
                );
              })()}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship method</div>
              <select value={effectiveShipMethod} onChange={e=>setShipMethodForVendor(e.target.value)}
              style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:effectiveShipMethod?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer",width:isMobile?"100%":200,boxSizing:"border-box"}}>
              <option value="">— select —</option>
              {SHIP_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
            </div>
          </div>
          {/* Ship To — empty = use the job-route default. The textarea
              shows that default as placeholder so it's obvious the
              field is editable for one-off addresses (e.g. an item
              going from decorator A to decorator B). The PO PDF
              renderer applies the same fallback. */}
          <div style={{display:"flex",flexDirection:"column",gap:4,flex:1,width:isMobile?"100%":undefined,alignSelf:isMobile?"stretch":undefined}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:9,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Ship to</span>
              <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:(poShipTo[active]||"").trim()?T.amber:(activeShipsToClient?T.green:T.accent)}}>
                {(poShipTo[active]||"").trim()?"Custom":(activeShipsToClient?"Client address":"HPD warehouse")}
              </span>
              {(poShipTo[active]||"").trim()&&(
                <button onClick={()=>{
                  // Reset = explicit commit to "default". Log directly
                  // here so we don't fight React's state-update batching
                  // — commitShipToRevision reads from state, which the
                  // setShipToForVendor call above hasn't applied yet.
                  if (isPoSent) {
                    const prev = (shipToBaseline.current[active] || "").trim();
                    if (prev) {
                      const oneLine = (v) => v ? v.split("\n").map(l => l.trim()).filter(Boolean).join(", ") : "default";
                      logJobActivity(project.id, `Ship-to for ${active} revised — ${oneLine(prev)} → default`);
                    }
                  }
                  shipToBaseline.current[active] = "";
                  setShipToForVendor("");
                }}
                  style={{fontSize:9,color:T.faint,fontFamily:font,background:"none",border:"none",cursor:"pointer",padding:0,textDecoration:"underline"}}
                  title="Clear override — fall back to the job-route default">
                  reset
                </button>
              )}
            </div>
            <textarea value={poShipTo[active]||""} placeholder={activeDefaultShipTo + "\n\n(default — type to override)"}
              onChange={e=>setShipToForVendor(e.target.value)}
              onBlur={commitShipToRevision}
              style={{background:T.surface,border:"1px solid "+((poShipTo[active]||"").trim()?T.amber+"66":T.border),borderRadius:6,color:T.text,fontFamily:font,fontSize:11,padding:"8px 10px",outline:"none",resize:"vertical",minHeight:110,lineHeight:1.4}}/>
          </div>
          {/* Items ready + buttons */}
          <div style={{display:"flex",flexDirection:"column",alignItems:isMobile?"stretch":"flex-end",gap:8,flexShrink:0,width:isMobile?"100%":undefined}}>
            {ready&&(
              <div style={{fontSize:14,fontWeight:600,color:allFilled?T.green:T.amber,textAlign:isMobile?"left":"right"}}>
                {vItems.filter(it=>itemFields[it.id]?.packing_notes?.trim()).length}/{vItems.length} items ready
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:6,width:isMobile?"100%":170}}>
              <button onClick={()=>setShowSendEmail(!showSendEmail)} disabled={!canSend}
                title={!ready ? "Fill in packing notes on all vendor items first" : !shipBySet ? "Set the vendor ship-by date (or ASAP) first — the PO can't send without one" : (isRevised ? "Send a revised PO that supersedes the original" : "Preview + send to decorator in one screen")}
                style={{background:canSend?(isRevised?T.amber:T.blue):T.surface,border:"1px solid "+(canSend?(isRevised?T.amber:T.blue):T.border),borderRadius:8,color:canSend?"#fff":T.faint,fontFamily:font,fontSize:13,fontWeight:700,padding:"10px 16px",cursor:canSend?"pointer":"default",opacity:canSend?1:0.5,width:"100%"}}>
                {isRevised ? "Send Revised PO" : "Send to Decorator"}
              </button>
              {/* Download without emailing (Jon, 2026-07-17): emailing a revised
                  PO breaks the vendor's original thread — their de-facto activity
                  log. Download here, drop it into the existing thread yourself. */}
              <button onClick={()=>{ if(!active) return; window.open(`/api/pdf/po/${project.id}?vendor=${encodeURIComponent(active)}${isRevised?"&revised=1":""}&download=1`,"_blank"); }}
                disabled={!active}
                title={isRevised ? "Download the revised PDF without emailing — keeps the vendor's original email thread intact" : "Download the PO PDF without emailing"}
                style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,color:active?T.muted:T.faint,fontFamily:font,fontSize:12,fontWeight:600,padding:"8px 12px",cursor:active?"pointer":"default",width:"100%"}}>
                {isRevised ? "Download Revised PDF" : "Download PDF"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showSendEmail&&(
        <div style={{position:"fixed",inset:0,background:"#fff",zIndex:100,display:"flex",flexDirection:"column",fontFamily:font}}>
          {/* Header */}
          <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:14,fontWeight:700,color:T.text}}>
                Send PO{active?` · ${active}`:""}
              </span>
              <span style={{fontSize:11,color:T.muted}}>
                {project.clients?.name||project.title||""}{vItems.length?` · ${vItems.length} item${vItems.length!==1?"s":""}`:""}
              </span>
            </div>
            <button onClick={()=>setShowSendEmail(false)} aria-label="Close" style={{background:"none",border:"none",color:T.muted,fontSize:20,cursor:"pointer",padding:"4px 8px",lineHeight:1}}>×</button>
          </div>
          {/* Body: send form left (380px rail), PDF preview right.
              Mobile stacks: form on top, preview below. */}
          <div style={{flex:1,display:"flex",flexDirection:isMobile?"column":"row",overflow:"hidden",minHeight:0}}>
            <div style={{width:isMobile?"auto":380,flexShrink:0,display:"flex",flexDirection:"column",overflow:"hidden",borderRight:isMobile?"none":`1px solid ${T.border}`,borderBottom:isMobile?`1px solid ${T.border}`:"none"}}>
              <div style={{flex:1,overflowY:"auto",padding:"14px 18px"}}>
        <SendEmailDialog
          type="po"
          jobId={project.id}
          vendor={active}
          contacts={getDec(active)?.contacts_list||[]}
          defaultEmail={getDec(active)?.contact_email||""}
          extraPayload={isRevised ? { revised: true } : undefined}
          defaultSubject={(() => {
            const rawNum = project.type_meta?.qb_invoice_number || project.job_number || "";
            // Strip the tenant prefix from job_number-style refs
            // (HPD-2605-002 → 2605-002) so the prefix only appears once
            // in the subject: "PO# IHM 2605-002ABC". QB-style invoice
            // numbers (e.g. 4283) pass through unchanged.
            const numCore = poPrefix && rawNum.startsWith(poPrefix + "-")
              ? rawNum.slice(poPrefix.length + 1)
              : rawNum;
            const letters = vItems.map(it => String.fromCharCode(65 + (it.sort_order || 0))).join("");
            const clientName = (project.clients?.name || project.title || "");
            const base = `PO# ${poPrefix} ${numCore}${letters} — ${clientName} — ${active}`;
            return isRevised ? `${base} (Revised)` : base;
          })()}
          onClose={()=>setShowSendEmail(false)}
          onSent={async()=>{
            // Determine the item delta BEFORE stamping dates, so the
            // activity log can name which items are new on a revision.
            // sent_to_decorator_date is the marker — null = never sent.
            let newItemNames = [];
            if (isRevised) {
              const itemIds = vItems.map(it => it.id);
              const { data: existingAssignments } = await supabase
                .from("decorator_assignments")
                .select("item_id, sent_to_decorator_date")
                .in("item_id", itemIds);
              const sentMap = Object.fromEntries((existingAssignments || []).map(a => [a.item_id, a.sent_to_decorator_date]));
              newItemNames = vItems
                .filter(it => !sentMap[it.id])
                .map(it => it.name);
            }
            if (isRevised) {
              const addedCount = newItemNames.length;
              logJobActivity(project.id,
                addedCount > 0
                  ? `Revised PO sent to ${active} — ${vItems.length} items total, ${addedCount} new (${newItemNames.join(", ")})`
                  : `Revised PO re-sent to ${active} (${vItems.length} items)`);
            } else {
              logJobActivity(project.id, `PO sent to ${active} (${vItems.length} items)`);
            }
            // Track which vendors have received POs + when. po_sent_dates
            // preserves the ORIGINAL send date — resending the same PO
            // (e.g., follow-up email) doesn't overwrite the first send.
            const updatedVendors = [...new Set([...(project.type_meta?.po_sent_vendors||[]), active])];
            const existingSentDates = project.type_meta?.po_sent_dates || {};
            const poSentDates = existingSentDates[active]
              ? existingSentDates  // already stamped — leave alone
              : { ...existingSentDates, [active]: new Date().toISOString() };
            const meta = {...(project.type_meta||{}), po_sent_vendors: updatedVendors, po_sent_dates: poSentDates, po_ship_methods: shipMethods, po_ship_dates: poShipDates};
            await supabase.from("jobs").update({type_meta:meta}).eq("id",project.id);
            if(onUpdateJob) onUpdateJob({type_meta:meta});
            // Stamp sent_to_decorator_date + advance this vendor's items to
            // in_production — from FRESH DB data so a stale in-memory snapshot
            // can't silently miss an item (lib/po-actions; same vendor matcher
            // the read side uses, so write/read can't disagree).
            await applyPoSentToVendorItems(supabase, project.id, active);
            if(onRecalcPhase) setTimeout(onRecalcPhase, 300);
          }}
        />
              </div>
            </div>
            <div style={{flex:1,background:T.surface,overflow:"hidden",minHeight:isMobile?280:0,display:"flex"}}>
              <PdfCanvasPreview src={`/api/pdf/po/${project.id}${active?`?vendor=${encodeURIComponent(active)}${isRevised?"&revised=1":""}`:""}`} />
            </div>
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
                // Un-mark as sent. Revert the items that the mark
                // advanced — set pipeline_stage back to null for
                // any item that's currently "in_production" under
                // this vendor (matches the inverse of the mark-sent
                // logic above). Items that progressed further
                // (shipped, received_at_hpd) are NOT rewound — a
                // revoke shouldn't pull a shipped item back to
                // pre-PO. Without this revert the canonical status
                // resolver still reads in_production from
                // pipeline_stage and the client hub stays stuck.
                const updated = poSentVendors.filter(x=>x!==v);
                const meta = {...(project.type_meta||{}), po_sent_vendors: updated};
                await supabase.from("jobs").update({type_meta:meta}).eq("id",project.id);
                if(onUpdateJob) onUpdateJob({type_meta:meta});
                const reverted = await revertPoSentFromVendorItems(supabase, project.id, v);
                logJobActivity(project.id, `PO for ${v} unmarked as sent — ${reverted} item${reverted===1?"":"s"} reverted to pre-PO`);
                if(onRecalcPhase) onRecalcPhase();
              } else {
                // Mark as sent + advance items to in_production. Stamp
                // po_sent_dates if no date exists yet — keeps the
                // original send date when re-toggled later.
                const updated = [...new Set([...poSentVendors, v])];
                const existingSentDates = project.type_meta?.po_sent_dates || {};
                const poSentDates = existingSentDates[v]
                  ? existingSentDates
                  : { ...existingSentDates, [v]: new Date().toISOString() };
                const meta = {...(project.type_meta||{}), po_sent_vendors: updated, po_sent_dates: poSentDates};
                await supabase.from("jobs").update({type_meta:meta}).eq("id",project.id);
                if(onUpdateJob) onUpdateJob({type_meta:meta});
                const sentCount = await applyPoSentToVendorItems(supabase, project.id, v);
                logJobActivity(project.id, `PO for ${v} manually marked as sent (${sentCount} items)`);
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
            const itemRoute = itemRoutes[item.id] ?? (item.shipping_route || "");
            const routeLabel = (r) => r === "drop_ship" ? "Drop ship" : r === "ship_through" ? "Ship through HPD" : r === "stage" ? "Stage at HPD" : "";
            // Vendor default route — applied to this item on PO send when it has
            // no manual override. Shown here so the effective route is visible
            // BEFORE sending.
            const vendorDefault = isDropShipJob ? (getDec(getCostProd(item.id)?.printVendor)?.default_shipping_route || "") : "";
            return (
              <div key={item.id} style={{borderBottom:i<vItems.length-1?"1px solid "+T.border:"none",padding:"12px 14px"}}>
                {/* Two-column card: left = item meta + route/vendor, right =
                    the field grid. Side-by-side keeps each item compact. Stacks
                    on mobile. */}
                <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:isMobile?10:16,alignItems:"flex-start"}}>
                  {/* Left meta column */}
                  <div style={{width:isMobile?"100%":340,flexShrink:0,display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                      <span style={{width:22,height:22,borderRadius:5,background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:T.accent,fontFamily:mono,flexShrink:0}}>
                        {String.fromCharCode(65+idx)}
                      </span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text,wordBreak:"break-word"}}>{item.name}</div>
                        <div style={{fontSize:10,color:T.muted,marginTop:1}}>{[item.blank_vendor,item.style,item.color].filter(Boolean).join(" · ")} · {totalQty(item.buy_sheet_lines||[])} units</div>
                      </div>
                    </div>
                    {/* Per-item route override + vendor. Default = job route;
                        set when one item takes a different path. Drives the
                        status resolver (drop_ship auto-completes on shipped;
                        ship_through/stage expects HPD receive). */}
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <select value={itemRoute}
                        onChange={async e=>{
                          const v = e.target.value || null;
                          setItemRoutes(prev => ({ ...prev, [item.id]: v || "" }));
                          const { error } = await supabase.from("items").update({ shipping_route: v }).eq("id", item.id);
                          if (error) console.error("Save shipping_route error:", error);
                          if (onRecalcPhase) onRecalcPhase();
                        }}
                        title={itemRoute ? `Override: ${routeLabel(itemRoute)}` : vendorDefault ? `Vendor default: ${routeLabel(vendorDefault)} — applied on PO send` : `Default: ${routeLabel(shippingRoute) || "—"}`}
                        style={{background:itemRoute?T.amber+"22":vendorDefault?T.blue+"22":T.surface,border:`1px solid ${itemRoute?T.amber+"66":vendorDefault?T.blue+"66":T.border}`,borderRadius:5,color:itemRoute?T.amber:vendorDefault?T.text:T.muted,fontFamily:font,fontSize:10,padding:"3px 6px",outline:"none",cursor:"pointer",minWidth:0}}>
                        <option value="">{vendorDefault ? `${routeLabel(vendorDefault)} · via vendor` : "Route: job default"}</option>
                        {allowedRoutes.includes("drop_ship") && <option value="drop_ship">Drop ship</option>}
                        {allowedRoutes.includes("ship_through") && <option value="ship_through">Ship through HPD</option>}
                        {allowedRoutes.includes("stage") && <option value="stage">Stage at HPD</option>}
                      </select>
                      <div style={{fontSize:11,color:T.muted,fontFamily:mono}}>{getCostProd(item.id)?.printVendor||"—"}</div>
                      {isSaving&&<div style={{fontSize:9,color:T.amber}}>saving…</div>}
                    </div>
                  </div>
                  {/* Right fields column */}
                  <div style={{flex:1,minWidth:0,width:isMobile?"100%":undefined,display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:8}}>
                    {fieldInput("drive_link","https://drive.google.com/...",{label:"Production files link",mono:true})}
                    {fieldInput("incoming_goods","e.g. Blanks from S&S — PO #12345",{label:"Incoming goods"})}
                    {fieldInput("production_notes_po","Special instructions for decorator",{label:"Production notes",multiline:true})}
                    {fieldInput("packing_notes","e.g. Fewest boxes, label all contents",{label:"Packing / shipping notes",multiline:true})}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}



    </div>
  );
}
