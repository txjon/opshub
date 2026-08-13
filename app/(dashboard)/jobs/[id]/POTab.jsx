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
import { SHIP_METHODS } from "@/lib/ship-methods";
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
    <div style={{background:T.bg,padding:"7px 10px",borderRadius:3}}>
      <div style={{fontSize:"7.5px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.faint,marginBottom:3}}>{label}</div>
      <div style={{fontSize:"9.5px",color:T.muted,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{text}</div>
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
    const activeSizes = ((cp.sizes&&cp.sizes.length?cp.sizes:Object.keys(cp.qtys||{}))).filter((sz)=>(cp.qtys?.[sz]||0)>0).length; // V2 cps: qtys yes, sizes no
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
  const [shipModalVendor,setShipModalVendor] = useState(null); // vendor whose pre-send ship modal is open
  const shipDefaultsAppliedRef = useRef({}); // per-vendor: defaults auto-applied once

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
  // Ship method: explicit override → per-vendor default → HPD-bound fallback.
  const effectiveShipMethod = shipMethods[active] || getDec(active)?.default_ship_method || (activeVendorShipsToHpd ? "Vendor's Choice" : "");
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
  // Gate BOTH now (Jon 2026-07-19): a PO can't send without a ship-by date AND
  // a ship method. The pre-send modal enforces both before the email step.
  const methodSet = !!effectiveShipMethod;
  const canSend = ready && shipBySet && methodSet;
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

  // Auto-populate ship defaults when a vendor's pre-send modal opens: ship-by
  // date from the decorator's lead time, ship method from its default. Applied
  // ONCE per vendor (ref-guarded) so it never clobbers a manual overwrite.
  useEffect(() => {
    const v = shipModalVendor;
    if (!v || active !== v || shipDefaultsAppliedRef.current[v]) return;
    shipDefaultsAppliedRef.current[v] = true;
    const dec = getDec(v);
    const lead = Number(dec?.lead_time_days) || 0;
    if (!poShipDates[v] && lead > 0) setShipDateForVendor(addDays(todayIso, lead));
    if (!shipMethods[v] && dec?.default_ship_method) setShipMethodForVendor(dec.default_ship_method);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipModalVendor, active]);
  const openShipModal = (v) => { setSelectedVendor(v); setShipModalVendor(v); };
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

      {/* ── Per-vendor peek cards (Overview DETAILS style) — click opens the ship + send modal ── */}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fit,minmax(300px,1fr))",gap:10}}>
        {vendors.length===0 && <div style={{fontSize:12,color:T.faint,padding:"14px 16px",background:T.card,border:`1px solid ${T.border}`,borderRadius:12}}>No vendors assigned</div>}
        {vendors.map(v=>{
          const sent=poSentVendors.includes(v);
          const vit=sorted.filter(it=>getCostProd(it.id)?.printVendor===v);
          const readyN=vit.filter(it=>itemFields[it.id]?.packing_notes?.trim()).length;
          const allR=vit.length>0&&readyN===vit.length;
          const vRoute=isDropShipJob?(getDec(v)?.default_shipping_route||""):"";
          const vShipsClient=vit.length>0&&vit.every(it=>((itemRoutes[it.id]??it.shipping_route)||vRoute||shippingRoute)==="drop_ship");
          const vHpdBound=!!vRoute&&vRoute!=="drop_ship";
          const dateV=poShipDates[v]==="ASAP"?"ASAP":(poShipDates[v]?fmtShortDate(poShipDates[v]):null);
          const methodV=shipMethods[v]||getDec(v)?.default_ship_method||(vHpdBound?"Vendor's Choice":"")||null;
          const shipToV=(poShipTo[v]||"").trim()?"Custom":(vShipsClient?"Client":"HPD warehouse");
          const Fact=({label,value,color})=>(<div style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}><span style={{fontSize:8.5,color:T.faint,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>{label}</span><span style={{fontSize:13,fontWeight:600,color:color||T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value}</span></div>);
          return (
            <button key={v} onClick={()=>openShipModal(v)}
              onMouseEnter={e=>e.currentTarget.style.borderColor=T.accent} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}
              style={{textAlign:"left",background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px",cursor:"pointer",fontFamily:font,boxShadow:"0 1px 2px rgba(16,18,32,0.05)",transition:"all 0.12s"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11,gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                  <span style={{fontSize:14,fontWeight:800,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
                  <span style={{fontSize:9,fontWeight:800,letterSpacing:"0.05em",textTransform:"uppercase",color:sent?T.green:T.amber,flexShrink:0}}>{sent?"✓ Sent":"Not sent"}</span>
                </div>
                <span style={{fontSize:15,color:T.faint,lineHeight:1,flexShrink:0}}>›</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
                <Fact label="Ship by" value={dateV||"Not set"} color={dateV?undefined:T.amber} />
                <Fact label="Method" value={methodV||"Not set"} color={methodV?undefined:T.amber} />
                <Fact label="Ship to" value={shipToV} />
                <Fact label="Ready" value={`${readyN}/${vit.length}`} color={allR?T.green:T.amber} />
              </div>
            </button>
          );
        })}
      </div>
      {/* ── Pre-send ship modal (V2) — gated: date + method required before send ── */}
      {shipModalVendor && active===shipModalVendor && (
        <div onClick={()=>setShipModalVendor(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:120,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"6vh 16px",overflowY:"auto",fontFamily:font}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,width:"100%",maxWidth:560,boxShadow:"0 16px 48px rgba(0,0,0,0.3)",overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${T.border}`}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:15,fontWeight:800}}>Send PO — {active}</div>
                <div style={{fontSize:11.5,color:T.muted,marginTop:2}}>Confirm ship details before sending. Vendor defaults are pre-filled — edit as needed.</div>
              </div>
              <button onClick={()=>setShipModalVendor(null)} aria-label="Close" style={{background:"none",border:"none",color:T.muted,fontSize:22,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>
            </div>
            <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:16}}>
              {/* Ship by date */}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <div style={{fontSize:10,fontWeight:800,color:shipBySet?T.muted:T.amber,textTransform:"uppercase",letterSpacing:"0.06em"}}>Ship by date <span style={{color:T.red}}>*</span></div>
                {poShipDates[active]==="ASAP" ? (
                  <div style={{display:"flex",alignItems:"center",gap:6,background:T.amberDim,border:`1px solid ${T.amber}66`,borderRadius:7,padding:"9px 12px"}}>
                    <span style={{flex:1,fontSize:12,fontWeight:700,color:T.amber,letterSpacing:"0.06em",textTransform:"uppercase"}}>ASAP</span>
                    <button onClick={()=>setShipDateForVendor("")} title="Clear" style={{background:"none",border:"none",color:T.amber,cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>
                  </div>
                ) : (
                  <>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <input type="date" value={poShipDates[active]||""} onChange={e=>setShipDateForVendor(e.target.value)}
                        style={{flex:1,background:T.surface,border:`1px solid ${poShipDates[active]?T.accent:T.border}`,borderRadius:7,color:poShipDates[active]?T.text:T.muted,fontFamily:font,fontSize:13,padding:"9px 12px",outline:"none",cursor:"pointer",boxSizing:"border-box"}} />
                      <button onClick={()=>setShipDateForVendor("ASAP")} title="Ship as soon as possible"
                        style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:7,color:T.amber,fontFamily:font,fontSize:11,fontWeight:700,letterSpacing:"0.05em",padding:"0 12px",height:38,cursor:"pointer",flexShrink:0}}>ASAP</button>
                    </div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {activeLeadDays>0 && !poShipDates[active] && (
                        <button onClick={()=>setShipDateForVendor(addDays(todayIso,activeLeadDays))} title={`${active}'s saved lead time`}
                          style={{background:T.accentDim,border:`1px solid ${T.accent}66`,borderRadius:6,color:T.accent,fontFamily:font,fontSize:10.5,fontWeight:700,padding:"4px 9px",cursor:"pointer"}}>
                          Use {active} default · +{activeLeadDays}d → {fmtShortDate(addDays(todayIso,activeLeadDays))}
                        </button>
                      )}
                      {QUICK_OFFSETS.map(d=>(
                        <button key={d} onClick={()=>applyDateOffset(d)} title={`${d} business days from today`}
                          style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,fontFamily:font,fontSize:10.5,fontWeight:600,padding:"4px 9px",cursor:"pointer"}}>+{d}d</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {/* Ship method */}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <div style={{fontSize:10,fontWeight:800,color:methodSet?T.muted:T.amber,textTransform:"uppercase",letterSpacing:"0.06em"}}>Ship method <span style={{color:T.red}}>*</span></div>
                <select value={shipMethods[active]||effectiveShipMethod||""} onChange={e=>setShipMethodForVendor(e.target.value)}
                  style={{background:T.surface,border:`1px solid ${(shipMethods[active]||effectiveShipMethod)?T.accent:T.border}`,borderRadius:7,color:(shipMethods[active]||effectiveShipMethod)?T.text:T.muted,fontFamily:font,fontSize:13,padding:"9px 12px",outline:"none",cursor:"pointer",width:"100%",boxSizing:"border-box"}}>
                  <option value="">— select —</option>
                  {SHIP_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {/* Ship to */}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:10,fontWeight:800,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Ship to</span>
                  <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:(poShipTo[active]||"").trim()?T.amber:(activeShipsToClient?T.green:T.accent)}}>
                    {(poShipTo[active]||"").trim()?"Custom":(activeShipsToClient?"Client address":"HPD warehouse")}
                  </span>
                </div>
                <textarea value={poShipTo[active]||""} placeholder={activeDefaultShipTo + "\n\n(default — type to override)"}
                  onChange={e=>setShipToForVendor(e.target.value)} onBlur={commitShipToRevision}
                  style={{background:T.surface,border:`1px solid ${(poShipTo[active]||"").trim()?T.amber+"66":T.border}`,borderRadius:7,color:T.text,fontFamily:font,fontSize:12,padding:"9px 12px",outline:"none",resize:"vertical",minHeight:96,lineHeight:1.4,boxSizing:"border-box"}} />
              </div>
            </div>
            <div style={{padding:"14px 20px",borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10}}>
              <div style={{flex:1,fontSize:11.5,fontWeight:600,color:canSend?T.green:T.amber}}>
                {canSend ? "✓ Ready to send" : !ready ? "Fill packing notes on all items first" : !shipBySet ? "Set a ship-by date (or ASAP)" : !methodSet ? "Pick a ship method" : ""}
              </div>
              <button onClick={()=>{ if(!active) return; window.open(`/api/pdf/po/${project.id}?vendor=${encodeURIComponent(active)}${isRevised?"&revised=1":""}&download=1`,"_blank"); }}
                style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.muted,fontFamily:font,fontSize:13,padding:"9px 15px",cursor:"pointer"}}>Download PDF</button>
              <button onClick={()=>setShipModalVendor(null)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.muted,fontFamily:font,fontSize:13,padding:"9px 15px",cursor:"pointer"}}>Cancel</button>
              <button onClick={()=>{ setShipModalVendor(null); setShowSendEmail(true); }} disabled={!canSend}
                style={{background:canSend?(isRevised?T.amber:T.accent):T.surface,color:canSend?"#0a0a0a":T.faint,border:"none",borderRadius:8,fontFamily:font,fontSize:13,fontWeight:800,padding:"9px 20px",cursor:canSend?"pointer":"default",opacity:canSend?1:0.6}}>
                Continue to send →
              </button>
            </div>
          </div>
        </div>
      )}
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
            // Freeze this vendor's expected costs at send (Tier 2 snapshot) —
            // baselines stop floating with later rate-card edits.
            fetch(`/api/jobs/${project.id}/snapshot-po`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: active }) }).catch(()=>{});
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
                fetch(`/api/jobs/${project.id}/snapshot-po`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: v }) }).catch(()=>{});
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
