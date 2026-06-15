"use client";
import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { parseSizeMatrix, splitColHead } from "@/lib/size-grid";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";
import { DecorationPanel } from "./DecorationPanel";
import { SettingsModal } from "./SettingsModal";
import { DriveThumb } from "@/components/DriveThumb";
import { PdfCanvasPreview } from "@/components/PdfCanvasPreview";
import { calcCostProduct as sharedCalcCostProduct, lookupPrintPrice as sharedLookupPrintPrice, lookupTagPrice as sharedLookupTagPrice, buildPrintersMap } from "@/lib/pricing";
import { useClientBranding } from "@/lib/branding-client";
import { useIsMobile } from "@/lib/useIsMobile";

const BLANK_COSTS = {
  "NL6210_White":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72,"5XL":8.75,"6XL":9.17},
  "NL6210_Black":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72,"5XL":8.75,"6XL":9.17},
  "NL6210_Apple Green":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Banana Cream":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Bondi Blue":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Cardinal":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Charcoal":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72,"5XL":8.75,"6XL":9.17},
  "NL6210_Cream":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Dark Heather Grey":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72,"5XL":8.75,"6XL":9.17},
  "NL6210_Espresso":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Columbia Blue":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Cool Blue":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Forest Green":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Heavy Metal":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Light Pink":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Maroon":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Mauve":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Redwood":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Seafoam":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Shiitake":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Slate Blue":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Heather Tan":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Ice Blue":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Indigo":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72},
  "NL6210_Kelly Green":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72},
  "NL6210_Light Olive":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72,"5XL":8.75,"6XL":9.17},
  "NL6210_Midnight Navy":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72,"5XL":8.75,"6XL":9.17},
  "NL6210_Military Green":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72},
  "NL6210_Mint":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Neon Heather Green":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Neon Yellow":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Orange":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72},
  "NL6210_Purple Rush":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72},
  "NL6210_Red":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72,"5XL":8.75,"6XL":9.17},
  "NL6210_Royal":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39,"4XL":7.72,"5XL":8.75,"6XL":9.17},
  "NL6210_Sand":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Silk":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Stone Grey":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Storm":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Tahiti Blue":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"3XL":6.39},
  "NL6210_Teal":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"6XL":9.17},
  "NL6210_Turquoise":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"6XL":9.17},
  "NL6210_Warm Grey":{"XS":3.55,"S":3.55,"M":3.55,"L":3.55,"XL":3.55,"2XL":5.0,"6XL":9.17},
};

// Look up blank cost by style key + color + size
function lookupBlankCost(styleKey, color, size) {
  const key = styleKey + "_" + color;
  return BLANK_COSTS[key]?.[size] ?? 0;
}
// Seed blank costs for a product given its style key, color, and sizes
function seedBlankCosts(styleKey, color, sizes) {
  // styleKey might be "6210" but BLANK_COSTS keys are "NL6210_{color}"
  // Find the matching key by checking if any BLANK_COSTS key contains the style code and color
  const exactKey = styleKey + "_" + color;
  const fuzzyKey = Object.keys(BLANK_COSTS).find(k => k.endsWith("_" + color) && k.includes(styleKey));
  const resolvedKey = BLANK_COSTS[exactKey] ? exactKey : (fuzzyKey || null);
  const costs = {};
  (sizes||[]).forEach(sz => { costs[sz] = resolvedKey ? (BLANK_COSTS[resolvedKey]?.[sz] ?? 0) : 0; });
  return costs;
}


// --- PRICING ENGINE ---
const LOCATION_PRESETS = ["Front","Back","Left Sleeve","Right Sleeve","Left Chest","Right Chest","Neck","Hood","Pocket"];
const MARGIN_TIERS = {"10%":1.15,"15%":1.26,"20%":1.33,"25%":1.43,"30%":1.53};

// Active pricing map — populated from DB decorators on load
export let PRINTERS = {};

// Build PRINTERS from decorator records (called on load)
export function loadPricingFromDecorators(decorators) {
  const map = {};
  for (const d of decorators) {
    const key = d.short_code || d.name;
    if (d.pricing_data) {
      map[key] = { ...d.pricing_data, capabilities: d.capabilities || [] };
    } else {
      // Decorator exists but no pricing — add with empty structure so it shows in dropdown
      map[key] = { qtys:[], prices:{}, tagPrices:[], finishing:{}, setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0}, specialty:{}, capabilities: d.capabilities || [] };
    }
  }
  PRINTERS = map;
  return map;
}

export function lookupPrintPrice(pk,qty,colors){
  return sharedLookupPrintPrice(PRINTERS, pk, qty, colors);
}
export function lookupTagPrice(pk,qty){
  return sharedLookupTagPrice(PRINTERS, pk, qty);
}

export function calcCostProduct(p,margin,inclShip,inclCC,allProds=[]){
  return sharedCalcCostProduct(p, margin, inclShip, inclCC, allProds, PRINTERS);
}
const fmtD=(n)=>"$"+Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtP=(n)=>((Number(n||0)*100).toFixed(1)+"%");


// --- COSTING COMPONENTS ---
const EMPTY_COST_PRODUCT=()=>({id:Date.now()+Math.random(),name:"",style:"",color:"",sizes:[],qtys:{},blankCosts:{},totalQty:0,unitPrice:0,sellOverride:null,isFleece:false,printVendor:"",printCount:4,printLocations:{},tagPrint:false,tagRepeat:false,tagShared:false,tagShareGroup:"",tagPrintPrinter:"",specialtyQtys:{},finishingQtys:{},customCosts:[],finishingType:"",finishingPrinter:"",finishingCostOverride:0,specialties:[],setupFees:{printer:"",screens:0,tagSizes:0,seps:0,inkChanges:0,manualCost:0}});

const CInput=({label,value,onChange,type="text",prefix,suffix,options,placeholder,small})=>{
  const base={background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:T.text,fontFamily:type==="number"?mono:font,fontSize:12,padding:small?"6px 10px":"8px 12px",outline:"none",width:"100%",boxSizing:"border-box"};
  if(options) return(
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {label&&<span style={{fontSize:10,color:T.muted,fontFamily:font}}>{label}</span>}
      <select value={value} onChange={e=>onChange(e.target.value)} style={{...base,cursor:"pointer"}}>
        <option value="">— select —</option>
        {options.map(o=><option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
  return(
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {label&&<span style={{fontSize:10,color:T.muted,fontFamily:font}}>{label}</span>}
      <div style={{position:"relative",display:"flex",alignItems:"center"}}>
        {prefix&&<span style={{position:"absolute",left:8,color:T.muted,fontSize:12,fontFamily:mono}}>{prefix}</span>}
        <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
          style={{...base,paddingLeft:prefix?"22px":undefined,paddingRight:suffix?"32px":undefined}}/>
        {suffix&&<span style={{position:"absolute",right:8,color:T.muted,fontSize:11}}>{suffix}</span>}
      </div>
    </div>
  );
};

const CToggle=({label,value,onChange})=>(
  <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>onChange(!value)}>
    <div style={{width:32,height:18,borderRadius:9,background:value?T.accent:T.surface,border:`1px solid ${value?T.accent:T.border}`,position:"relative",transition:"all 0.2s"}}>
      <div style={{position:"absolute",top:2,left:value?14:2,width:12,height:12,borderRadius:"50%",background:"white",transition:"all 0.2s"}}/>
    </div>
    <span style={{fontSize:12,color:T.muted,fontFamily:font}}>{label}</span>
  </div>
);

// Quick-create modal opened from any vendor dropdown via the "+ Add
// decorator" sentinel option. Minimal fields — name (required) and
// optional short code. Pricing / contacts / addresses are filled in
// later on /decorators; the goal here is to not break the costing
// flow when a new vendor enters the mix.
function AddDecoratorModal({ open, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setName(""); setShortCode(""); setError(""); setSaving(false); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const payload = { name: trimmedName, short_code: shortCode.trim() || null };
      const { data, error: err } = await supabase.from("decorators").insert(payload).select("id, name, short_code").single();
      if (err) { setError(err.message || "Save failed"); setSaving(false); return; }
      await onSaved(data);
    } catch (e) {
      setError(e?.message || "Save failed");
      setSaving(false);
    }
  }

  return (
    <div onClick={() => !saving && onClose()}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"20px 22px",width:420,maxWidth:"calc(100vw - 32px)",boxShadow:"0 12px 36px rgba(0,0,0,0.5)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div style={{fontSize:15,fontWeight:800,color:T.text}}>Add decorator</div>
          <button onClick={()=>!saving && onClose()}
            style={{background:"none",border:"none",color:T.faint,fontSize:20,cursor:"pointer",padding:"0 4px",lineHeight:1}}>×</button>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label style={{display:"block",fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Name *</label>
            <input value={name} autoFocus disabled={saving}
              onChange={e=>setName(e.target.value)}
              onKeyDown={e=>{ if (e.key === "Enter") save(); }}
              placeholder="e.g. Forward Observations Group"
              style={{width:"100%",padding:"8px 10px",fontSize:13,background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:T.text,outline:"none",fontFamily:font,boxSizing:"border-box"}}/>
          </div>
          <div>
            <label style={{display:"block",fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Short code</label>
            <input value={shortCode} disabled={saving}
              onChange={e=>setShortCode(e.target.value)}
              onKeyDown={e=>{ if (e.key === "Enter") save(); }}
              placeholder="Optional · e.g. FOG"
              style={{width:"100%",padding:"8px 10px",fontSize:13,background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:T.text,outline:"none",fontFamily:font,boxSizing:"border-box"}}/>
            <div style={{fontSize:10,color:T.faint,marginTop:4}}>Used on PO/RFQ shorthand. Leave blank to default to the full name.</div>
          </div>

          {error && <div style={{fontSize:11,color:T.red,padding:"6px 8px",background:T.redDim||"rgba(255,80,80,0.12)",borderRadius:4}}>{error}</div>}

          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:6}}>
            <button onClick={()=>!saving && onClose()} disabled={saving}
              style={{padding:"7px 14px",fontSize:12,fontWeight:600,color:T.muted,background:"none",border:`1px solid ${T.border}`,borderRadius:6,cursor:saving?"default":"pointer",fontFamily:font}}>
              Cancel
            </button>
            <button onClick={save} disabled={saving || !name.trim()}
              style={{padding:"7px 14px",fontSize:12,fontWeight:700,color:"#fff",background:(!saving && name.trim())?T.accent:T.faint,border:"none",borderRadius:6,cursor:(saving || !name.trim())?"default":"pointer",fontFamily:font,opacity:(saving || !name.trim())?0.7:1}}>
              {saving ? "Saving…" : "Add decorator"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CostingTab=({project,buyItems=[],contacts=[],onUpdateBuyItems,costProds,setCostProds,costMargin,setCostMargin,inclShip,setInclShip,inclCC,setInclCC,orderInfo,setOrderInfo,decoratorRecords=[],onRefreshDecorators,costingDirty,onSave,saveStatus,initialTab,hideSubTabs,selectedItemId,onSelectItem,onUpdateProject,onPullFromPsds,pullingPsds,pullResult,hideToolbar=false,openRfqRef})=>{
  const branding=useClientBranding();
  const isMobile=useIsMobile();
  // Effective lock = manual "Lock In Pricing" OR archived phase.
  // Complete/cancelled projects are historic records — costing stays
  // viewable but read-only, with no unlock. The raw type_meta flag is
  // still what the Lock/Unlock toggle flips (hidden when archived).
  const isArchivedJob=project?.phase==="complete"||project?.phase==="cancelled";
  const costingLocked=!!project?.type_meta?.costing_locked||isArchivedJob;
  const [costTab,setCostTab]=useState(initialTab||"calc");
  // Portal target for the right rail. Resolved after mount so the
  // host page (which renders the rail in its outer flex) has had a
  // chance to commit it to the DOM. While null, the rail renders
  // in-flow inside the costing inner flex.
  const [totalsRailEl, setTotalsRailEl] = useState(null);
  useEffect(() => {
    const find = () => setTotalsRailEl(document.getElementById("costing-totals-rail"));
    find();
    // Re-resolve after the next frame in case the rail mounts in a
    // sibling render pass (parent conditional on `tab === "costing"`).
    const raf = requestAnimationFrame(find);
    return () => cancelAnimationFrame(raf);
  }, []);
  const [showSendEmail,setShowSendEmail]=useState(false);
  const [showRfqModal,setShowRfqModal]=useState(false);
  const [rfqVendor,setRfqVendor]=useState("");
  const [rfqSelected,setRfqSelected]=useState({});         // { itemId: bool }
  const [rfqRecipientSel,setRfqRecipientSel]=useState({}); // { contactIdx: bool }
  const [rfqExtraEmail,setRfqExtraEmail]=useState("");
  const [rfqSubject,setRfqSubject]=useState("");
  const [rfqBody,setRfqBody]=useState("");
  const [rfqSending,setRfqSending]=useState(false);
  const [rfqError,setRfqError]=useState("");
  const [rfqSent,setRfqSent]=useState(false);
  const [rfqShowPreview,setRfqShowPreview]=useState(false);
  const rfqHistory = project?.type_meta?.rfq_history || [];
  const getDecRecord = (vendorKey) => decoratorRecords.find(d => d.short_code === vendorKey || d.name === vendorKey);

  // "+ Add decorator" modal — opened from any vendor dropdown when the
  // user picks the sentinel option. Records which cost product index
  // triggered it so we can auto-select the new vendor after save.
  const [addDecoratorTargetIdx, setAddDecoratorTargetIdx] = useState(null);
  const handleDecoratorCreated = async (newRow) => {
    if (onRefreshDecorators) await onRefreshDecorators();
    const newKey = newRow.short_code || newRow.name;
    if (addDecoratorTargetIdx != null && costProds[addDecoratorTargetIdx]) {
      const cur = costProds[addDecoratorTargetIdx];
      const updated = {};
      [1,2,3,4,5,6].forEach(loc => {
        const ld = cur.printLocations?.[loc] || {};
        if (ld.location || ld.screens) updated[loc] = { ...ld, printer: newKey };
        else updated[loc] = { ...ld };
      });
      updateProd(addDecoratorTargetIdx, { ...cur, printVendor: newKey, printLocations: updated });
    }
    setAddDecoratorTargetIdx(null);
  };
  // Latest RFQ entry referencing this item (or empty array if none).
  const latestRfqForItem = (itemId) => {
    let latest = null;
    for (const e of rfqHistory) {
      if (Array.isArray(e.item_ids) && e.item_ids.includes(itemId)) {
        if (!latest || new Date(e.sent_at) > new Date(latest.sent_at)) latest = e;
      }
    }
    return latest;
  };
  const fmtAgo = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const days = Math.floor(ms / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "1d ago";
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };
  const RfqBadge = ({ itemId }) => {
    const e = latestRfqForItem(itemId);
    if (!e) return null;
    return (
      <span title={`Quote requested from ${e.vendor} on ${new Date(e.sent_at).toLocaleString()}`}
        style={{fontSize:10,fontWeight:700,color:T.amber,letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:font,whiteSpace:"nowrap"}}>
        RFQ → {e.vendor} · {fmtAgo(e.sent_at)}
      </span>
    );
  };
  // When vendor changes: auto-check items going to that vendor + auto-check
  // all decorator contacts that have an email + reset the subject.
  React.useEffect(() => {
    if (!rfqVendor) {
      setRfqSelected({});
      setRfqRecipientSel({});
      return;
    }
    const itemsNext = {};
    (costProds || []).forEach(p => {
      if ((p.totalQty || 0) > 0 && p.printVendor === rfqVendor) itemsNext[p.id] = true;
    });
    setRfqSelected(itemsNext);
    const dec = getDecRecord(rfqVendor);
    const contactsNext = {};
    (dec?.contacts_list || []).forEach((c, i) => { if (c?.email) contactsNext[i] = true; });
    setRfqRecipientSel(contactsNext);
    setRfqSubject(`Quote request — ${project?.job_number || ""} — ${project?.clients?.name || project?.title || ""}`.trim());
  }, [rfqVendor]);
  const openRfqModal = () => {
    setRfqVendor("");
    setRfqSelected({});
    setRfqRecipientSel({});
    setRfqExtraEmail("");
    setRfqSubject("");
    setRfqBody("");
    setRfqError("");
    setRfqSent(false);
    setRfqShowPreview(false);
    setShowRfqModal(true);
  };
  // Expose openRfqModal to the wrapper so the project header toolbar
  // can trigger it without owning RFQ state.
  useEffect(() => {
    if (openRfqRef) openRfqRef.current = openRfqModal;
  }, [openRfqRef]);
  const sendRfq = async () => {
    setRfqError("");
    const dec = getDecRecord(rfqVendor);
    const contactList = dec?.contacts_list || [];
    const recipients = [
      ...contactList.filter((c, i) => rfqRecipientSel[i] && c?.email).map(c => c.email),
      ...(rfqExtraEmail.trim() ? [rfqExtraEmail.trim()] : []),
    ];
    const dedupRecipients = [...new Set(recipients)];
    if (dedupRecipients.length === 0) { setRfqError("Pick at least one recipient."); return; }
    const itemIds = Object.keys(rfqSelected).filter(id => rfqSelected[id]);
    if (itemIds.length === 0) { setRfqError("Pick at least one item."); return; }
    setRfqSending(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "rfq",
          jobId: project.id,
          vendor: rfqVendor,
          recipientEmail: dedupRecipients[0],
          ccEmails: dedupRecipients.slice(1),
          subject: rfqSubject.trim(),
          customBody: rfqBody.trim() || undefined,
          rfqItemIds: itemIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setRfqError(data.error || "Failed to send"); setRfqSending(false); return; }
      setRfqSent(true);
      setRfqSending(false);
      // Optimistic local update so the inline RFQ badge appears immediately.
      if (onUpdateProject) {
        const newEntry = { vendor: rfqVendor, item_ids: itemIds, recipient: dedupRecipients[0], cc: dedupRecipients.slice(1), sent_at: new Date().toISOString() };
        onUpdateProject({ type_meta: { ...(project?.type_meta || {}), rfq_history: [...rfqHistory, newEntry] } });
      }
      setTimeout(() => setShowRfqModal(false), 1500);
    } catch (e) {
      setRfqError("Network error");
      setRfqSending(false);
    }
  };
  const [collapsed,setCollapsed]=useState(()=>{ const c={}; (costProds||[]).forEach(p=>{ c[p.id]=true; }); return c; });
  const [localCosts,setLocalCosts]=useState({});
  const getCostDisplay=(pid,sz,val)=>{ const k=pid+"_"+sz; return localCosts[k]!==undefined?localCosts[k]:val>0?String(val):""; };
  const setCostLocal=(pid,sz,raw)=>setLocalCosts(p=>({...p,[pid+"_"+sz]:raw}));
  const commitCost=(i,p,sz)=>{
    const k=p.id+"_"+sz;
    if(localCosts[k]===undefined) return;
    const parsed=parseFloat(localCosts[k])||0;
    setLocalCosts(p2=>{const n={...p2};delete n[k];return n;});
    const newBlankCosts={...(p.blankCosts||{}),[sz]:parsed};
    updateProd(i,{...p,blankCosts:newBlankCosts});
    // Mirror the qty-edit pattern (see the qty input's onChange): push the
    // refined cost back to buyItems too. Without this, the buyItems→costProds
    // sync sees the buy item's stale blankCosts differ from this edit and
    // reverts it on the next sync (e.g. when a qty changes). Keeping the two
    // copies equal is what makes a Costing cost edit actually stick.
    if(onUpdateBuyItems){onUpdateBuyItems(prev=>prev.map(bi=>bi.id===p.id?{...bi,blankCosts:newBlankCosts}:bi));}
  };
  const toggleCollapse=(id)=>setCollapsed(p=>({...p,[id]:!p[id]}));
  // Click handler for the item strip header. Prefers the page-level
  // selection model (single-item-at-a-time, mirrors left sidebar) when
  // available; falls back to the inline collapse toggle otherwise.
  const headerClick = (id) => {
    if (onSelectItem) onSelectItem(id);
    else toggleCollapse(id);
  };

  // Mockup thumbnails for visual reference
  const [mockupMap, setMockupMap] = useState({}); // { itemId: { driveFileId, driveLink } }
  React.useEffect(() => {
    const ids = (costProds || []).map(p => p.id).filter(Boolean);
    if (ids.length === 0) return;
    createClient().from("item_files").select("item_id, drive_file_id, drive_link").in("item_id", ids).eq("stage", "mockup").then(({ data }) => {
      const m = {};
      for (const f of (data || [])) m[f.item_id] = { driveFileId: f.drive_file_id, driveLink: f.drive_link };
      setMockupMap(m);
    });
  }, [costProds?.length]);

  // Note: buyItems sync is handled by CostingTabWrapper (updates both costProds + savedCostProds)

  const rawResults=costProds.map(p=>calcCostProduct(p,costMargin,inclShip,inclCC,costProds)).filter(Boolean);
  // Round sellPerUnit to cent (same as what gets saved to items.sell_per_unit) so display matches PDFs
  const results=rawResults.map(r=>({...r, sellPerUnit: Math.round(r.sellPerUnit*100)/100, grossRev: Math.round(Math.round(r.sellPerUnit*100)/100 * r.qty * 100)/100 }));
  const totGross=results.reduce((a,r)=>a+r.grossRev,0);
  const totProfit=totGross - results.reduce((a,r)=>a+r.totalCost,0);
  const netMarg=totGross>0?totProfit/totGross:0;
  const mc=netMarg>=0.30?T.green:netMarg>=0.20?T.amber:T.red;

  const updateProd=(i,d)=>setCostProds(p=>p.map((x,j)=>j===i?d:x));
  const focusNext=(e,reverse=false)=>{
    e.preventDefault();
    const all=Array.from(document.querySelectorAll("[data-costfield]"));
    const idx=all.indexOf(e.currentTarget);
    const next=all[reverse?idx-1:idx+1];
    if(next) next.focus();
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {!hideSubTabs && (
      <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap",marginTop:-20,borderBottom:`1px solid ${T.border}`,paddingBottom:6}}>
        {[["calc","Calculator"],["quote","Client Quote"]].map(([k,l])=>{
          const active = costTab===k;
          return (
            <button key={k} onClick={()=>setCostTab(k)}
              style={{background:"transparent",border:"none",padding:"4px 0",cursor:"pointer",fontFamily:font,fontSize:13,fontWeight:active?800:600,color:active?T.text:T.muted,borderBottom:active?`2px solid ${T.accent}`:"2px solid transparent",marginBottom:-7,transition:"color 0.15s"}}>
              {l}
            </button>
          );
        })}
      </div>
      )}

      {/* margin/toggles moved to project totals sidebar */}

      {/* Lock In Pricing — hidden when the project header is rendering
          the unified toolbar (hideToolbar prop). Kept inline as a
          fallback for any caller that still mounts the tab without
          piping through actionsRef/onPullStateChange. */}
      {costTab==="calc"&&!hideToolbar&&(
        <div style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",justifyContent:"space-between",gap:isMobile?10:0,marginBottom:12,paddingBottom:8,borderBottom:`1px solid ${T.border}`}}>
          <div>
            <span style={{fontSize:isMobile?10:11,fontWeight:700,color:costingLocked?T.green:T.amber,letterSpacing:"0.06em",textTransform:"uppercase"}}>
              {isArchivedJob?"Historic record":costingLocked?"Pricing locked":"Pricing not locked"}
            </span>
            {!isMobile && (
              <span style={{fontSize:11,color:T.muted,marginLeft:10}}>
                {isArchivedJob?`This project is ${project?.phase==="cancelled"?"cancelled":"complete"} — pricing is read-only`:costingLocked?"Ready to quote":"Lock in pricing when all items are costed"}
              </span>
            )}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {/* Pull from PSDs — re-runs the auto-detect that fires on
                tab mount, but on-demand. Useful when art lands AFTER
                the user opened Costing (the initial auto-run found
                nothing and won't re-fire). Skips items that already
                have print locations set so it's safe to click any
                time. */}
            {/* Action group — same height/padding/radius across all
                three so they read as a coherent toolbar.
                Tertiary (Pull) = ghost; Secondary (Request) = outlined;
                Primary (Lock) = filled. */}
            {onPullFromPsds && (
              <button onClick={onPullFromPsds} disabled={pullingPsds}
                style={{height:34,padding:isMobile?0:"0 14px",borderRadius:8,fontSize:isMobile?11:12,fontWeight:600,cursor:pullingPsds?"default":"pointer",background:"transparent",border:`1px solid ${T.border}`,color:T.muted,fontFamily:font,opacity:pullingPsds?0.6:1,display:"inline-flex",alignItems:"center",justifyContent:"center",flex:isMobile?1:"none"}}
                title="Re-scan items' PSD files in Art Files and populate empty print locations">
                {pullingPsds ? "Pulling…" : (isMobile ? "Pull PSDs" : "Pull from PSDs")}
              </button>
            )}
            {pullResult && !isMobile && (
              <span style={{fontSize:11,color:T.muted,fontFamily:font}}>{pullResult}</span>
            )}
            <button onClick={openRfqModal}
              style={{height:34,padding:isMobile?0:"0 14px",borderRadius:8,fontSize:isMobile?11:12,fontWeight:600,cursor:"pointer",background:"transparent",border:`1px solid ${T.accent}`,color:T.accent,fontFamily:font,display:"inline-flex",alignItems:"center",justifyContent:"center",flex:isMobile?1:"none"}}
              title="Send a quote request to a decorator for selected items">
              {isMobile ? "Request" : "Request Pricing"}
            </button>
            {/* Lock toggle flips the raw type_meta flag — hidden on
                archived jobs where the lock is forced + permanent. */}
            {!isArchivedJob && <button onClick={async ()=>{
              if (onSave) await onSave();
              const { createClient: cc } = await import("@/lib/supabase/client");
              const sb = cc();
              const newVal = !project?.type_meta?.costing_locked;
              const meta = {...(project?.type_meta||{}), costing_locked: newVal, costing_locked_at: newVal ? new Date().toISOString() : null};
              await sb.from("jobs").update({type_meta: meta}).eq("id", project.id);
              if (onUpdateProject) onUpdateProject({ type_meta: meta });
            }}
              style={{height:34,padding:isMobile?0:"0 16px",borderRadius:8,fontSize:isMobile?11:12,fontWeight:700,cursor:"pointer",border:"none",fontFamily:font,display:"inline-flex",alignItems:"center",justifyContent:"center",flex:isMobile?1:"none",
                background:project?.type_meta?.costing_locked?T.surface:T.green,
                color:project?.type_meta?.costing_locked?T.muted:"#fff"}}>
              {project?.type_meta?.costing_locked?(isMobile?"Unlock":"Unlock Pricing"):(isMobile?"Lock In":"Lock In Pricing")}
            </button>}
          </div>
        </div>
      )}

      {costTab==="calc"&&(
        <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:isMobile?12:16,alignItems:isMobile?"stretch":"flex-start"}}>
          <div style={{flex:1,minWidth:0}}>
            {costProds.map((p,i)=>{
              // If a sidebar item is selected, only render that item
              if (selectedItemId && p.id !== selectedItemId) return null;
              const r=calcCostProduct(p,costMargin,inclShip,inclCC,costProds);
              const mc2=r?(r.margin_pct>=0.30?T.green:r.margin_pct>=0.20?T.amber:T.red):T.faint;

              // ── Non-garment slim card (accessories, patches, stickers, etc.) ──
              const NON_GARMENT = ["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"];
              if (NON_GARMENT.includes(p.garment_type)) {
                const accTotal = (p.customCosts||[]).reduce((a,cc) => a + (cc.flat ? (parseFloat(cc.perUnit)||parseFloat(cc.amount)||0) : (parseFloat(cc.perUnit)||parseFloat(cc.amount)||0) * (p.totalQty||0)), 0);
                // List view always shows strips when the page-level
                // selection model is wired up (clicking a strip opens
                // the full card via onSelectItem, not via inline expand).
                const isCollapsed = selectedItemId ? false : (onSelectItem ? true : !!collapsed[p.id]);
                const headerBB = isCollapsed ? "none" : `1px solid ${T.border}`;
                const bodyDisplay = isCollapsed ? "none" : "block";
                const chevron = onSelectItem ? "›" : (isCollapsed ? "v" : "^");
                return (
                  <div key={p.id} id={`item-${p.id}`} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:10,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                    {/* Header: Letter + Name + Qty + Sell $/unit override */}
                    <div onClick={()=>headerClick(p.id)} style={{padding:"12px 16px",borderBottom:headerBB,display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",gap:isMobile?12:10,cursor:"pointer",userSelect:"none"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,flex:isMobile?"0 0 auto":1,minWidth:0}}>
                        <span style={{width:24,height:24,borderRadius:5,background:T.purpleDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.purple,fontFamily:mono,flexShrink:0}}>{String.fromCharCode(64+i+1)}</span>
                        <div style={{flex:1,display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",minWidth:0}}>
                          <span style={{color:T.text,fontFamily:font,fontSize:13,fontWeight:600}}>{p.name||"Accessory"}</span>
                          <span style={{fontSize:10,color:T.purple,fontWeight:600}}>Accessory</span>
                          <RfqBadge itemId={p.id} />
                        </div>
                        {isMobile && !selectedItemId && <span style={{fontSize:14,color:T.faint,marginLeft:6,flexShrink:0,lineHeight:1}}>›</span>}
                      </div>
                      <div style={{display:"flex",gap:0,alignItems:"center",justifyContent:isMobile?"space-between":"flex-start"}}>
                        <div style={{textAlign:isMobile?"left":"right",width:isMobile?"auto":70,flexShrink:0,marginRight:isMobile?0:16}}>
                          <div style={{fontSize:9,color:T.faint,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em"}}>Qty</div>
                          <div style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:mono}}>{(p.totalQty||0).toLocaleString()}</div>
                        </div>
                        {!isMobile && <div style={{width:1,height:28,background:T.border,marginRight:12,flexShrink:0}}/>}
                        <div style={{display:"flex",alignItems:"center",gap:8,...(costingLocked?{pointerEvents:"none",opacity:0.6}:{})}} onClick={e=>e.stopPropagation()}>
                          <div style={{display:"flex",flexDirection:isMobile?"row":"column",gap:isMobile?4:2,flexShrink:0}}>
                            {p._sellOverride?(
                              <>
                                <button onClick={()=>updateProd(i,{...p,sellOverride:(()=>{const _v=parseFloat(p._sellOverrideVal);return Number.isNaN(_v)?null:_v;})(),_sellOverride:false})}
                                  style={{background:T.green,border:"none",borderRadius:4,color:"#fff",cursor:"pointer",padding:"3px 0",fontSize:9,fontFamily:font,fontWeight:700,width:52,textAlign:"center"}}>save</button>
                                <button onClick={()=>updateProd(i,{...p,_sellOverride:false,_sellOverrideVal:null})}
                                  style={{background:"none",border:"1px solid "+T.border,borderRadius:4,color:T.muted,cursor:"pointer",padding:"2px 0",fontSize:9,fontFamily:font,width:52,textAlign:"center"}}>cancel</button>
                              </>
                            ):(()=>{
                              const isOverride = p.sellOverride != null;
                              // Amber for override-active, T.text for auto-active —
                              // mirrors the apparel card so the visual signal that
                              // "this price is manual" is consistent across types.
                              const overrideActiveStyle = {background:T.amber,border:"none",borderRadius:4,color:"#fff",cursor:"pointer",padding:"3px 0",fontSize:9,fontFamily:font,fontWeight:700,width:52,textAlign:"center"};
                              const autoActiveStyle = {background:T.text,border:"none",borderRadius:4,color:"#fff",cursor:"pointer",padding:"3px 0",fontSize:9,fontFamily:font,fontWeight:700,width:52,textAlign:"center"};
                              const offStyle = {background:"none",border:"1px solid "+T.border,borderRadius:4,color:T.muted,cursor:"pointer",padding:"2px 0",fontSize:9,fontFamily:font,fontWeight:500,width:52,textAlign:"center"};
                              return (
                                <>
                                  <button onClick={()=>updateProd(i,{...p,_sellOverride:true,_sellOverrideVal:p.sellOverride??r?.sellPerUnit?.toFixed(2)??""})}
                                    style={isOverride?overrideActiveStyle:offStyle}>override</button>
                                  <button onClick={()=>updateProd(i,{...p,sellOverride:null})}
                                    style={!isOverride?autoActiveStyle:offStyle}>auto</button>
                                </>
                              );
                            })()}
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:9,color:T.faint,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Sell $/unit</div>
                            {p._sellOverride?(
                              <div style={{background:T.surface,border:"1px solid "+T.text,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:2,width:76,boxSizing:"border-box"}}>
                                <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                                <input type="number" step="0.01" value={p._sellOverrideVal??r?.sellPerUnit?.toFixed(2)??""} autoFocus
                                  disabled={costingLocked}
                                  onFocus={e=>e.target.select()}
                                  onChange={e=>updateProd(i,{...p,_sellOverrideVal:e.target.value})}
                                  style={{width:"100%",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontWeight:700,fontFamily:mono,textAlign:"left"}}/>
                              </div>
                            ):(
                              <div onClick={()=>{ if(costingLocked) return; updateProd(i,{...p,_sellOverride:true,_sellOverrideVal:p.sellOverride??r?.sellPerUnit?.toFixed(2)??""}); }}
                                title="Click to override"
                                style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:2,width:76,boxSizing:"border-box",cursor:costingLocked?"default":"pointer"}}>
                                <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                                <span style={{fontSize:12,fontWeight:700,color:(p.sellOverride!=null||r?.sellPerUnit>0)?T.text:T.faint,fontFamily:mono}}>{p.sellOverride!=null?p.sellOverride.toFixed(2):r?.sellPerUnit>0?r.sellPerUnit.toFixed(2):"—"}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {!selectedItemId && !isMobile && <span style={{fontSize:11,color:T.muted,marginLeft:8,flexShrink:0}}>{chevron}</span>}
                    </div>
                    {/* Vendor selector + Cost line items */}
                    <div style={{padding:"12px 16px",display:bodyDisplay,...(costingLocked?{pointerEvents:"none",opacity:0.6}:{})}}>
                      {/* Vendor / Decorator selector */}
                      <div style={{marginBottom:12}}>
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Vendor</div>
                        <select value={p.printVendor||""} onChange={e=>{
                          if (e.target.value === "__add__") { setAddDecoratorTargetIdx(i); return; }
                          updateProd(i,{...p,printVendor:e.target.value});
                        }}
                          style={{background:T.surface,border:`1px solid ${p.printVendor?T.accent+"66":T.border}`,borderRadius:6,color:p.printVendor?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer",minWidth:180}}>
                          <option value="">— select vendor —</option>
                          {decoratorRecords.map(d=>{
                            const key=d.short_code||d.name;
                            return <option key={d.id} value={key}>{d.name}</option>;
                          })}
                          <option value="__add__">+ Add decorator</option>
                        </select>
                      </div>

                      {/* Size breakdown — compact qty editor for accessories with sizes (e.g. gloves S/M/L). No per-size cost since accessories are priced via custom costs. */}
                      {(p.sizes||[]).length > 0 && (
                        <div style={{marginBottom:12,padding:"8px 10px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:6}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                            <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Size breakdown</div>
                            <div style={{fontSize:10,color:T.muted,fontFamily:mono}}>{(p.totalQty||0).toLocaleString()} total</div>
                          </div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                            {(p.sizes||[]).map(sz=>(
                              <div key={sz} style={{display:"flex",alignItems:"center",gap:5,background:T.card,border:`1px solid ${T.border}`,borderRadius:5,padding:"3px 6px"}}>
                                <span style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:mono,minWidth:24}}>{sz}</span>
                                <input type="text" inputMode="numeric" pattern="[0-9]*" value={p.qtys?.[sz]||""} placeholder="0"
                                  onChange={e=>{
                                    const q=parseInt(e.target.value)||0;
                                    const newQtys={...(p.qtys||{}),[sz]:q};
                                    const newTotal=Object.values(newQtys).reduce((a,v)=>a+v,0);
                                    updateProd(i,{...p,qtys:newQtys,totalQty:newTotal});
                                    if(onUpdateBuyItems){onUpdateBuyItems(prev=>prev.map(bi=>bi.id===p.id?{...bi,qtys:newQtys,totalQty:newTotal}:bi));}
                                  }}
                                  onFocus={e=>e.target.select()}
                                  style={{width:48,textAlign:"center",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:13,fontWeight:700,fontFamily:mono,padding:"2px 4px"}}/>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:12,alignItems:"start"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      <div style={{borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                        <div style={{padding:"6px 10px",background:T.surface,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <span style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom Costs</span>
                          <span style={{fontSize:10,color:T.faint}}>{(p.customCosts||[]).length}/6</span>
                        </div>
                        <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:4}}>
                          {(p.customCosts||[]).map((cc,ci)=>{
                            const isFlat=!!cc.flat;
                            const costVal=parseFloat(cc.perUnit)||parseFloat(cc.amount)||0;
                            const total=isFlat?costVal:costVal*(p.totalQty||0);
                            return(
                              <div key={ci} style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
                                <input value={cc.desc||""} placeholder="Description" onChange={e=>{const c=[...p.customCosts];c[ci]={...c[ci],desc:e.target.value};updateProd(i,{...p,customCosts:c});}}
                                  style={{flex:1,minWidth:0,background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,padding:"3px 6px",outline:"none",fontFamily:font}}/>
                                <div style={{display:"flex",gap:2,flexShrink:0}}>
                                  {[{label:"/ unit",flat:false},{label:"flat",flat:true}].map(opt=>{
                                    const sel=cc.flat===opt.flat;
                                    return <button key={opt.label} onClick={()=>{const c=[...p.customCosts];c[ci]={...c[ci],flat:opt.flat};updateProd(i,{...p,customCosts:c});}}
                                      style={{padding:"2px 6px",fontSize:8,fontWeight:600,border:`1px solid ${sel?T.accent:T.border}`,borderRadius:4,cursor:"pointer",background:sel?T.accent:"transparent",color:sel?"#fff":T.faint}}>{opt.label}</button>;
                                  })}
                                </div>
                                <div style={{display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
                                  <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                                  <input type="text" inputMode="decimal" value={cc.perUnit===0?"":(cc.perUnit??cc.amount??"")} placeholder="0"
                                    onChange={e=>{
                                      const raw=e.target.value;
                                      if(raw!==""&&!/^[0-9]*\.?[0-9]*$/.test(raw)) return;
                                      // Keep the raw string during edit so "16." and "16.0"
                                      // survive without parseFloat eating trailing zeros or
                                      // the decimal point itself. onBlur normalizes to a number.
                                      const c=[...p.customCosts];
                                      c[ci]={...c[ci],perUnit:raw};
                                      updateProd(i,{...p,customCosts:c});
                                    }}
                                    onBlur={e=>{const c=[...p.customCosts];c[ci]={...c[ci],perUnit:parseFloat(e.target.value)||0};updateProd(i,{...p,customCosts:c});}}
                                    onFocus={e=>e.target.select()}
                                    style={{width:50,background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,fontFamily:mono,textAlign:"center",outline:"none",padding:"3px 4px"}}/>
                                </div>
                                <button onClick={()=>{const c=p.customCosts.filter((_,j)=>j!==ci);updateProd(i,{...p,customCosts:c});}}
                                  style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:11,flexShrink:0}}
                                  onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                              </div>
                            );
                          })}
                          {(p.customCosts||[]).length < 6 && (
                            <button onClick={()=>updateProd(i,{...p,customCosts:[...(p.customCosts||[]),{desc:"",perUnit:0,flat:false}]})}
                              style={{width:"100%",padding:"6px",borderRadius:4,border:`1px solid ${T.border}`,background:"transparent",color:T.muted,fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:font}}>+ Add cost</button>
                          )}
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Production notes</div>
                        <textarea value={p.itemNotes||""} onChange={e=>updateProd(i,{...p,itemNotes:e.target.value})} placeholder="Item note on PO" rows={1}
                          style={{width:"100%",background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"7px 10px",resize:"vertical",outline:"none",minHeight:32,boxSizing:"border-box",lineHeight:1.4}}/>
                      </div>
                      </div>
                      {/* Item summary — table format matching Project Totals sidebar */}
                      {r&&(
                        <div style={{background:T.card,borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                          <div style={{padding:"6px 10px",background:T.surface,fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em",borderBottom:`1px solid ${T.border}`}}>Item Summary</div>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
                            <tbody>
                              {[
                                ["Revenue",    fmtD(r.grossRev),       T.accent],
                                ["Blanks",     fmtD(r.blankCost),      T.text],
                                ["PO Total",   fmtD(r.poTotal),        T.text],
                                ...(r.shipping>0?[["Shipping", fmtD(r.shipping), T.text]]:[]),
                                ...(r.ccFees>0?[["CC Fees", fmtD(r.ccFees), T.text]]:[]),
                                ["Net Profit", fmtD(r.netProfit),      mc2],
                                ["Margin",     fmtP(r.margin_pct),     mc2],
                                ["Per Piece",  fmtD(r.profitPerPiece), mc2],
                              ].map(([l,v,c],idx)=>{
                                const isProfit=["Net Profit","Margin","Per Piece"].includes(l);
                                return (
                                <tr key={l} style={{background:T.card,borderTop:l==="Net Profit"?`1px solid ${T.border}`:"none",borderBottom:`1px solid ${T.border}22`}}>
                                  <td style={{padding:"3px 10px",color:T.muted,fontFamily:font,fontWeight:500}}>{l}</td>
                                  <td style={{padding:"3px 10px",color:c,fontFamily:mono,fontWeight:700,textAlign:"right"}}>{v}</td>
                                </tr>
                              );})}
                            </tbody>
                          </table>
                        </div>
                      )}
                      </div>
                    </div>
                  </div>
                );
              }

              // ── Apparel full card ──
              // Same selection-model rule as the slim card above: when
              // onSelectItem is wired, list view stays as strips and a
              // click navigates rather than expanding inline.
              const isCollapsed = selectedItemId ? false : (onSelectItem ? true : !!collapsed[p.id]);
              const headerBB=isCollapsed?"none":"1px solid "+T.border;
              const bodyDisplay=isCollapsed?"none":"grid";
              const chevron = onSelectItem ? "›" : (isCollapsed?"v":"^");
              return(
                <div key={p.id} id={`item-${p.id}`} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:10,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                  <div onClick={()=>headerClick(p.id)} style={{padding:"12px 16px",borderBottom:headerBB,display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",gap:isMobile?12:10,cursor:"pointer",userSelect:"none"}}>
                    {/* Identity row — letter + name + style. On mobile
                        this is its own line; on desktop it shares the
                        row with the controls and chevron. */}
                    <div style={{display:"flex",alignItems:"center",gap:10,flex:isMobile?"0 0 auto":1,minWidth:0}}>
                      <span style={{width:24,height:24,borderRadius:5,background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.accent,fontFamily:mono,flexShrink:0}}>{String.fromCharCode(64+i+1)}</span>
                      <div style={{flex:1,display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",minWidth:0}}>
                        <span style={{color:T.text,fontFamily:font,fontSize:13,fontWeight:600}}>{p.name||("Product "+(i+1))}</span>
                        {(p.style||p.color)&&<span style={{fontSize:11,color:T.muted,fontFamily:font}}>{p.style}{p.color?` · ${p.color}`:""}</span>}
                        <RfqBadge itemId={p.id} />
                      </div>
                      {isMobile && !selectedItemId && <span style={{fontSize:14,color:T.faint,marginLeft:6,flexShrink:0,lineHeight:1}}>›</span>}
                    </div>
                    <div style={{display:"flex",gap:0,alignItems:"center",justifyContent:isMobile?"space-between":"flex-start"}}>
                      <div style={{textAlign:isMobile?"left":"right",width:isMobile?"auto":70,flexShrink:0,marginRight:isMobile?0:16}}>
                        <div style={{fontSize:9,color:T.faint,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em"}}>Qty</div>
                        <div style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:mono}}>{(p.totalQty||0).toLocaleString()}</div>
                      </div>
                      {!isMobile && <div style={{width:1,height:28,background:T.border,marginRight:12,flexShrink:0}}/>}
                      <div style={{display:"flex",alignItems:"center",gap:8,...(costingLocked?{pointerEvents:"none",opacity:0.6}:{})}} onClick={e=>e.stopPropagation()}>
                        <div style={{display:"flex",flexDirection:isMobile?"row":"column",gap:isMobile?4:2,flexShrink:0}}>
                          {p._sellOverride?(
                            <>
                              <button onClick={()=>updateProd(i,{...p,sellOverride:(()=>{const _v=parseFloat(p._sellOverrideVal);return Number.isNaN(_v)?null:_v;})(),_sellOverride:false})}
                                style={{background:T.green,border:"none",borderRadius:4,color:"#fff",cursor:"pointer",padding:"3px 0",fontSize:9,fontFamily:font,fontWeight:700,width:52,textAlign:"center"}}>save</button>
                              <button onClick={()=>updateProd(i,{...p,_sellOverride:false,_sellOverrideVal:null})}
                                style={{background:"none",border:"1px solid "+T.border,borderRadius:4,color:T.muted,cursor:"pointer",padding:"2px 0",fontSize:9,fontFamily:font,width:52,textAlign:"center"}}>cancel</button>
                            </>
                          ):(()=>{
                            const isOverride = p.sellOverride != null;
                            // Amber when the override is applied — signals the
                            // calculated sell price has been manually replaced.
                            // Auto-mode active stays neutral dark.
                            const overrideActiveStyle = {background:T.amber,border:"none",borderRadius:4,color:"#fff",cursor:"pointer",padding:"3px 0",fontSize:9,fontFamily:font,fontWeight:700,width:52,textAlign:"center"};
                            const autoActiveStyle = {background:T.text,border:"none",borderRadius:4,color:"#fff",cursor:"pointer",padding:"3px 0",fontSize:9,fontFamily:font,fontWeight:700,width:52,textAlign:"center"};
                            const offStyle = {background:"none",border:"1px solid "+T.border,borderRadius:4,color:T.muted,cursor:"pointer",padding:"2px 0",fontSize:9,fontFamily:font,fontWeight:500,width:52,textAlign:"center"};
                            return (
                              <>
                                <button onClick={()=>updateProd(i,{...p,_sellOverride:true,_sellOverrideVal:p.sellOverride??r?.sellPerUnit?.toFixed(2)??""})}
                                  style={isOverride?overrideActiveStyle:offStyle}>override</button>
                                <button onClick={()=>updateProd(i,{...p,sellOverride:null})}
                                  style={!isOverride?autoActiveStyle:offStyle}>auto</button>
                              </>
                            );
                          })()}
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:9,color:T.faint,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Sell $/unit</div>
                          {p._sellOverride?(
                            <div style={{background:T.surface,border:"1px solid "+T.text,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:2,width:76,boxSizing:"border-box"}}>
                              <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                              <input type="number" step="0.01" value={p._sellOverrideVal??r?.sellPerUnit?.toFixed(2)??""} autoFocus
                                onFocus={e=>e.target.select()}
                                onChange={e=>updateProd(i,{...p,_sellOverrideVal:e.target.value})}
                                style={{width:"100%",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontWeight:700,fontFamily:mono,textAlign:"left"}}/>
                            </div>
                          ):(
                            <div onClick={()=>{ if(costingLocked) return; updateProd(i,{...p,_sellOverride:true,_sellOverrideVal:p.sellOverride??r?.sellPerUnit?.toFixed(2)??""}); }}
                              title="Click to override"
                              style={{background:T.surface,border:"1px solid "+T.border,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:2,width:76,boxSizing:"border-box",cursor:costingLocked?"default":"pointer"}}>
                              <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                              <span style={{fontSize:12,fontWeight:700,color:(p.sellOverride!=null||r?.sellPerUnit>0)?T.text:T.faint,fontFamily:mono}}>{p.sellOverride!=null?p.sellOverride.toFixed(2):r?.sellPerUnit>0?r.sellPerUnit.toFixed(2):"—"}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {!selectedItemId && !isMobile && <span style={{fontSize:11,color:T.muted,marginLeft:8,flexShrink:0}}>{chevron}</span>}
                  </div>
                  <div style={{padding:16,display:bodyDisplay,flexDirection:"column",gap:14,alignItems:"stretch",position:"relative"}}>
                    {/* DECORATION PANEL — full width on top. This is
                        where the work happens (vendor, locations,
                        colors, finishing) so it gets the wide stage. */}
                    <DecorationPanel p={p} i={i} costProds={costProds} PRINTERS={PRINTERS} decoratorRecords={decoratorRecords} onAddDecorator={()=>setAddDecoratorTargetIdx(i)} updateProd={updateProd} setCostProds={setCostProds} lookupPrintPrice={lookupPrintPrice} lookupTagPrice={lookupTagPrice} costingLocked={costingLocked} />

                    {/* BLANKS — summary chip by default, expands on
                        click to reveal the full editable panel. Keeps
                        the supplier / fleece / size / cost / notes
                        controls accessible without competing with
                        Decoration for column space. */}
                    {(() => {
                      const blanksExpanded = !!p._blanksExpanded;
                      // Many-variant (dimensional) blanks would enumerate 60+ size:qty pairs and
                      // overflow the strip. Summarize instead — fits + active size count; the full
                      // breakdown is one click away in the modal grid. Simple sizes keep the list.
                      const __dimM = parseSizeMatrix(p.sizes, p.qtys);
                      const __activeSizes = (p.sizes || []).filter(sz => (p.qtys?.[sz] || 0) > 0);
                      const sizeSummary = __dimM
                        ? [__dimM.groups.map(g => g.name).filter(Boolean).join(", "), `${__activeSizes.length} sizes`].filter(Boolean).join(" · ")
                        : __activeSizes.map(sz => `${sz}:${p.qtys[sz]}`).join(" · ");
                      const marginColor = r ? (r.margin_pct >= 0.30 ? T.green : r.margin_pct >= 0.20 ? T.amber : T.red) : T.muted;
                      return (
                    <div style={{display:"flex",flexDirection:"column",gap:6,paddingLeft:isMobile?0:20,...(costingLocked?{pointerEvents:"none",opacity:0.6}:{})}}>
                      {/* Section label above the chip, matching Tag
                          Print / Packaging / Finishing headers. */}
                      <div style={{fontSize:9,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Blanks</div>
                      {/* Summary chip — click opens the editor in a
                          centered modal so the page height stays
                          constant. Same data, same edit surface,
                          just floating over instead of pushing the
                          page down. */}
                      <div onClick={()=>updateProd(i,{...p,_blanksExpanded:true})}
                        style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",gap:isMobile?4:14,padding:"8px 12px",borderRadius:10,background:T.surface,border:`1px solid ${T.border}`,cursor:"pointer",transition:"all 0.15s"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent+"55";}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;}}>
                        {/* Row 1: supplier · style · color · chevron */}
                        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:isMobile?"0 0 auto":1}}>
                          <div style={{flex:1,minWidth:0,display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                            <span style={{fontSize:13,fontWeight:700,color:T.text}}>{p.supplier || "— supplier —"}</span>
                            {(p.style || p.color) && (
                              <span style={{fontSize:11,color:T.muted}}>
                                {[p.style, p.color].filter(Boolean).join(" · ")}
                              </span>
                            )}
                            {p.isFleece && <span style={{fontSize:9,fontWeight:700,color:T.accent,letterSpacing:"0.06em",textTransform:"uppercase"}}>Fleece</span>}
                          </div>
                          {isMobile && <span style={{fontSize:12,color:T.faint,flexShrink:0,lineHeight:1}}>›</span>}
                        </div>
                        {/* Sizes — on mobile sits on its own row below the
                            identity; on desktop stays inline to the right. */}
                        {sizeSummary && <span style={{fontSize:isMobile?11:12,color:isMobile?T.muted:T.text,fontFamily:mono,fontWeight:isMobile?500:700,flexShrink:1,minWidth:0,whiteSpace:isMobile?"normal":"nowrap",overflow:isMobile?"visible":"hidden",textOverflow:isMobile?"clip":"ellipsis"}}>{sizeSummary}</span>}
                        {!isMobile && <span style={{fontSize:12,color:T.faint,flexShrink:0,lineHeight:1}}>›</span>}
                      </div>

                      {/* Editor opens in a centered modal. Size
                          breakdown is forced open inside since the
                          modal handles the height and there's no
                          point in a nested collapsible. */}
                      <SettingsModal
                        open={blanksExpanded}
                        onClose={()=>updateProd(i,{...p,_blanksExpanded:false})}
                        title={`Blanks — ${p.name || "Item"}`}
                        summary={[p.supplier, p.style, p.color].filter(Boolean).join(" · ") || "Configure blank"}
                        width={620}>
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>

                      {/* Line 1: Supplier + All button */}
                      <div style={{marginBottom:0}}>
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Supplier</div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{flex:1}}>
                          {p.supplier==="New"||p._newSupplier?(
                            <div style={{display:"flex",gap:4}}>
                              <input autoFocus value={p._newSupplierVal||""}                                onChange={e=>updateProd(i,{...p,_newSupplierVal:e.target.value})}
                                onKeyDown={e=>{if(e.key==="Enter"&&p._newSupplierVal?.trim()){updateProd(i,{...p,supplier:p._newSupplierVal.trim(),_newSupplier:false,_newSupplierVal:""});}if(e.key==="Escape"){updateProd(i,{...p,supplier:"",_newSupplier:false,_newSupplierVal:""});}}}
                                style={{flex:1,background:T.surface,border:`1px solid ${T.accent}`,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none"}}/>
                              <button onClick={()=>{if(p._newSupplierVal?.trim())updateProd(i,{...p,supplier:p._newSupplierVal.trim(),_newSupplier:false,_newSupplierVal:""}); }}
                                style={{background:T.accent,border:"none",borderRadius:6,color:"#fff",cursor:"pointer",padding:"0 10px",fontSize:12}}>✓</button>
                              <button onClick={()=>updateProd(i,{...p,supplier:"",_newSupplier:false,_newSupplierVal:""})}
                                style={{background:"none",border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,cursor:"pointer",padding:"0 8px",fontSize:11}}>✕</button>
                            </div>
                          ):(
                            (() => {
                              const defaults=["S&S","AS Colour","Sanmar","LA Apparel","Otto"];
                              const fromOthers=(costProds||[]).map(x=>x?.supplier).filter(s=>s&&s!=="New"&&!defaults.includes(s));
                              const customs=Array.from(new Set([...fromOthers, ...(p.supplier&&p.supplier!=="New"&&!defaults.includes(p.supplier)?[p.supplier]:[])]));
                              return (
                                <select value={p.supplier||""} onChange={e=>e.target.value==="New"?updateProd(i,{...p,supplier:"New",_newSupplier:true,_newSupplierVal:""}):updateProd(i,{...p,supplier:e.target.value})}
                                  style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:p.supplier?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",width:"100%",cursor:"pointer"}}>
                                  <option value="">— select supplier —</option>
                                  {defaults.map(s=><option key={s}>{s}</option>)}
                                  {customs.map(s=><option key={s}>{s}</option>)}
                                  <option value="New">＋ New supplier…</option>
                                </select>
                              );
                            })()
                          )}
                        </div>
                        {/* Fleece flag now lives on the item (Product
                            Builder is the canonical edit surface).
                            Shown here as a read-only tag so costers see
                            it but don't toggle it from this surface. */}
                        {p.isFleece && (
                          <span style={{fontSize:9,fontWeight:700,color:T.accent,letterSpacing:"0.08em",textTransform:"uppercase",border:`1px solid ${T.accent}66`,borderRadius:5,padding:"3px 8px",flexShrink:0}}>Fleece</span>
                        )}
                      </div>
                      </div>
                      {/* Size breakdown — always expanded inside the
                          modal. The collapsible chrome was only there to
                          save space when this lived inline; modal owns
                          the height now so the grid renders directly. */}
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Size breakdown</div>
                      {(() => { const __m = parseSizeMatrix(p.sizes, null); if(!__m) return (
                      <div style={{borderRadius:8,border:"1px solid "+T.border,overflow:"hidden"}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <thead>
                              <tr style={{background:T.surface}}>
                                <th style={{padding:"4px 6px",textAlign:"left",fontSize:9,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:36}}>Size</th>
                                <th style={{padding:"4px 6px",textAlign:"right",fontSize:9,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:44}}>Qty</th>
                                <th style={{padding:"4px 6px",textAlign:"right",fontSize:9,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:56}}>Cost</th>
                                <th style={{padding:"4px 6px",textAlign:"right",fontSize:9,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",width:60}}>Sub</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(p.sizes||[]).map((sz,si)=>{
                                const qty=p.qtys?.[sz]||0;
                                const bc=p.blankCosts?.[sz]||0;
                                const subtotal=bc*qty*1.035;
                                const isLast=si===p.sizes.length-1;
                                return(
                                  <tr key={sz} style={{borderBottom:isLast?"none":`1px solid ${T.border}22`,background:qty>0?T.surface:T.card}}>
                                    <td style={{padding:"2px 6px",fontFamily:mono,fontSize:11,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`}}>{sz}</td>
                                    <td style={{padding:"2px 4px",textAlign:"right",borderRight:`1px solid ${T.border}`}}>
                                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={qty||""} placeholder="0"
                                        onChange={e=>{const q=parseInt(e.target.value)||0;const newQtys={...(p.qtys||{}),[sz]:q};const newTotal=Object.values(newQtys).reduce((a,v)=>a+v,0);updateProd(i,{...p,qtys:newQtys,totalQty:newTotal});if(onUpdateBuyItems){onUpdateBuyItems(prev=>prev.map(bi=>bi.id===p.id?{...bi,qtys:newQtys,totalQty:newTotal}:bi));}}}
                                        data-costfield onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab")focusNext(e,e.shiftKey);if(e.key==="ArrowDown"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:false},false);}if(e.key==="ArrowUp"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:true},true);}}}
                                        style={{width:36,textAlign:"right",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:11,fontFamily:mono}}/>
                                    </td>
                                    <td style={{padding:"2px 4px",textAlign:"right",borderRight:`1px solid ${T.border}`}}>
                                      <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:1}}>
                                        <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                                        <input type="text" inputMode="decimal" value={getCostDisplay(p.id,sz,bc)} placeholder="0.00"
                                          onChange={e=>{ const raw=e.target.value; if(/^\d*\.?\d*$/.test(raw)) setCostLocal(p.id,sz,raw); }}
                                          onBlur={()=>commitCost(i,p,sz)}
                                          data-costfield onKeyDown={e=>{if(e.key==="Enter"){commitCost(i,p,sz);focusNext(e,false);}if(e.key==="Tab"){commitCost(i,p,sz);focusNext(e,e.shiftKey);}if(e.key==="ArrowDown"){e.preventDefault();commitCost(i,p,sz);focusNext({...e,key:"Tab",shiftKey:false},false);}if(e.key==="ArrowUp"){e.preventDefault();commitCost(i,p,sz);focusNext({...e,key:"Tab",shiftKey:true},true);}}}
                                          style={{width:44,textAlign:"right",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:11,fontFamily:mono}}/>
                                      </div>
                                    </td>
                                    <td style={{padding:"2px 6px",textAlign:"right",fontFamily:mono,fontSize:11,fontWeight:subtotal>0?600:400,color:subtotal>0?T.text:T.faint}}>{subtotal>0?fmtD(subtotal):"—"}</td>
                                  </tr>
                                );
                              })}
                              {p.sizes&&p.sizes.length>1&&(
                                <tr style={{background:T.surface,borderTop:`1px solid ${T.border}`}}>
                                  <td style={{padding:"4px 6px",fontSize:9,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`}}>Total</td>
                                  <td style={{padding:"4px 6px",textAlign:"right",fontFamily:mono,fontWeight:700,fontSize:11,color:T.text,borderRight:`1px solid ${T.border}`}}>{p.totalQty||0}</td>
                                  <td style={{borderRight:`1px solid ${T.border}`}}/>
                                  <td style={{padding:"4px 6px",textAlign:"right",fontFamily:mono,fontWeight:700,fontSize:11,color:T.accent}}>{fmtD(Object.entries(p.blankCosts||{}).reduce((a,[sz,bc])=>a+bc*(p.qtys?.[sz]||0)*1.035,0))}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                      </div>
                      );
                      // Dimensional pants → cut-ticket cost grid (qty reference + editable $ per cell).
                      const __lk = {};
                      (p.sizes||[]).forEach(sz=>{const q=String(sz).split(" / ").map(s=>s.trim()); if(q.length>=3)__lk[`${q[0]}~${q[1]}~${q.slice(2).join(" / ")}`]=sz; else if(q.length===2)__lk[`~${q[0]}~${q[1]}`]=sz;});
                      const __costs=(p.sizes||[]).map(sz=>getCostDisplay(p.id,sz,p.blankCosts?.[sz]||0));
                      const __allVal=(__costs.length>0&&__costs.every(c=>c===__costs[0]))?__costs[0]:"";
                      const __grandCost=Object.entries(p.blankCosts||{}).reduce((a,[sz,bc])=>a+bc*(p.qtys?.[sz]||0)*1.035,0);
                      const GH={padding:"3px 7px",fontSize:9,fontWeight:700,color:T.muted,textAlign:"center",borderBottom:`1px solid ${T.border}`,whiteSpace:"nowrap",fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em"};
                      return (
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                            <span style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em"}}>Cost / all sizes</span>
                            <span style={{display:"flex",alignItems:"center",gap:2}}>
                              <span style={{fontSize:11,color:T.faint,fontFamily:mono}}>$</span>
                              <input type="text" inputMode="decimal" value={__allVal} placeholder="0.00"
                                onChange={e=>{const raw=e.target.value; if(/^\d*\.?\d*$/.test(raw)) (p.sizes||[]).forEach(sz=>setCostLocal(p.id,sz,raw));}}
                                onBlur={()=>(p.sizes||[]).forEach(sz=>commitCost(i,p,sz))}
                                style={{width:64,textAlign:"right",background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:"4px 8px",color:T.text,fontSize:12,fontFamily:mono}}/>
                            </span>
                            <span style={{fontSize:10,color:T.faint}}>fills every cell; override individually below</span>
                          </div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:18,alignItems:"flex-start",overflowX:"auto"}}>
                            {__m.groups.map((g,gi)=>(
                              <div key={gi}>
                                {g.name&&<div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:T.muted,marginBottom:3}}>{g.name}</div>}
                                <table style={{borderCollapse:"collapse"}}>
                                  <thead><tr>
                                    <th style={{...GH,textAlign:"left"}}>Waist</th>
                                    {g.cols.map((c,ci)=>{const sc=splitColHead(c);return <th key={ci} style={GH}>{sc[0]}{sc[1]&&<div style={{fontSize:7.5,fontWeight:600,color:T.faint}}>{sc[1]}</div>}</th>;})}
                                  </tr></thead>
                                  <tbody>
                                    {g.rows.map((r,ri)=>(
                                      <tr key={ri}>
                                        <td style={{padding:"2px 8px",fontSize:11,fontWeight:700,fontFamily:mono,color:T.text,borderRight:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>{r.label}</td>
                                        {g.cols.map((c,ci)=>{const label=__lk[`${g.name??""}~${r.label}~${c}`]; if(!label) return <td key={ci} style={{padding:"2px 4px",textAlign:"center",color:T.faint,fontSize:11}}>·</td>; const qty=p.qtys?.[label]||0; const bc=p.blankCosts?.[label]||0; return (
                                          <td key={ci} style={{padding:"2px 4px"}}>
                                            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                                              <span style={{fontSize:8.5,color:T.faint,fontFamily:mono,lineHeight:1}}>{qty||"·"}</span>
                                              <span style={{display:"flex",alignItems:"center",gap:1}}>
                                                <span style={{fontSize:9,color:T.faint,fontFamily:mono}}>$</span>
                                                <input type="text" inputMode="decimal" value={getCostDisplay(p.id,label,bc)} placeholder="0.00"
                                                  onChange={e=>{const raw=e.target.value; if(/^\d*\.?\d*$/.test(raw)) setCostLocal(p.id,label,raw);}}
                                                  onBlur={()=>commitCost(i,p,label)}
                                                  data-costfield onKeyDown={e=>{if(e.key==="Enter"){commitCost(i,p,label);focusNext(e,false);}if(e.key==="Tab"){commitCost(i,p,label);focusNext(e,e.shiftKey);}}}
                                                  style={{width:40,textAlign:"right",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:11,fontFamily:mono}}/>
                                              </span>
                                            </div>
                                          </td>
                                        );})}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:10,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                            <span style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em"}}>Total</span>
                            <span style={{fontSize:13,fontWeight:800,fontFamily:mono,color:T.text}}>{p.totalQty||0}</span><span style={{fontSize:10,color:T.muted}}>units</span>
                            <span style={{flex:1}}/>
                            <span style={{fontSize:13,fontWeight:800,fontFamily:mono,color:T.accent}}>{fmtD(__grandCost)}</span><span style={{fontSize:10,color:T.muted}}>blanks</span>
                          </div>
                        </div>
                      );
                      })()}
                      </div>
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Production notes</div>
                        <textarea value={p.itemNotes||""} onChange={e=>updateProd(i,{...p,itemNotes:e.target.value})} placeholder="Item note on PO" rows={1}
                          style={{width:"100%",background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"7px 10px",resize:"vertical",outline:"none",minHeight:32,boxSizing:"border-box",lineHeight:1.4}}/>
                      </div>
                    </div>
                      </SettingsModal>
                    </div>
                      );
                    })()}
                    {/* KPI strip — 6 chips across the bottom of the item.
                        Revenue accent, profit trio colored by margin tier. */}
                    {r && (
                      <div style={{paddingLeft:isMobile?0:20,marginTop:2}}>
                        <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(3, minmax(0, 1fr))":"repeat(6, minmax(0, 1fr))",gap:8}}>
                          {[
                            ["Revenue",    fmtD(r.grossRev),       T.accent],
                            ["Blanks",     fmtD(r.blankCost),      T.text],
                            ["PO Total",   fmtD(r.poTotal),        T.text],
                            ["Net Profit", fmtD(r.netProfit),      mc2],
                            ["Margin",     fmtP(r.margin_pct),     mc2],
                            ["Per Piece",  fmtD(r.profitPerPiece), mc2],
                          ].map(([l,v,c])=>(
                            <div key={l} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                              <div style={{fontSize:9,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{l}</div>
                              <div style={{fontSize:13,fontWeight:700,color:c,fontFamily:mono,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Project totals — portaled into the page-level right rail
              when the host page provides a #costing-totals-rail target.
              Living outside the costing scroll context keeps the rail
              fixed regardless of which item is selected. Falls back to
              in-flow sticky render when the target isn't mounted. */}
          {results.length>0&&(()=>{
            const totBlank=results.reduce((a,r)=>a+r.blankCost,0);
            const totPO=results.reduce((a,r)=>a+r.poTotal,0);
            const totShip=results.reduce((a,r)=>a+r.shipping,0);
            const totQty=results.reduce((a,r)=>a+r.qty,0);
            const totActualBlanks=buyItems.reduce((a,bi)=>a+(bi.blanks_order_cost?parseFloat(bi.blanks_order_cost):0),0);
            const profitPc=totQty>0?totProfit/totQty:0;
            // PO totals by vendor
            const poByVendor={};
            costProds.forEach((cp,i)=>{
              if(!cp.printVendor||!results[i]) return;
              poByVendor[cp.printVendor]=(poByVendor[cp.printVendor]||0)+results[i].poTotal;
            });
            const vendorEntries=Object.entries(poByVendor).sort((a,b)=>b[1]-a[1]);
            const portalTarget = totalsRailEl;
            // Portal exists on desktop only (page-level rail). On mobile
            // the right column falls inline and stacks below items as
            // full-width — sticky doesn't apply there.
            const widthStyle = portalTarget
              ? {width:"100%"}
              : isMobile
                ? {width:"100%"}
                : {width:200,flexShrink:0,position:"sticky",top:20};
            const rightCol = (
            <div style={{...widthStyle,display:"flex",flexDirection:"column",gap:6}}>
              <div style={{display:"flex",gap:2,background:T.surface,borderRadius:6,padding:2}}>
                {["10%","15%","20%","25%","30%"].map(m=>(
                  <button key={m} onClick={()=>setCostMargin(m)}
                    style={{background:costMargin===m?T.amber:"transparent",color:costMargin===m?"#fff":T.muted,border:"none",borderRadius:4,padding:"2px 6px",fontSize:10,fontFamily:mono,cursor:"pointer",flex:1}}>{m}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:8}}>
                <CToggle label="Shipping" value={inclShip} onChange={setInclShip}/>
                <CToggle label="CC Fees" value={inclCC} onChange={setInclCC}/>
              </div>
              <div style={{background:T.card,borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden",marginTop:8}}>
                <div style={{padding:"4px 10px",background:T.surface,fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em",borderBottom:`1px solid ${T.border}`}}>Project Totals</div>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
                  <tbody>
                    {[
                      ["Revenue",    fmtD(totGross),    T.accent],
                      ["Blanks",     fmtD(totBlank),    T.text],
                      ["PO Total",   fmtD(totPO),       T.text],
                      ...vendorEntries.map(([v,t])=>["  "+v, fmtD(t), T.faint]),
                      ...(inclShip?[["Shipping", fmtD(totShip), T.text]]:[]),
                      ...(inclCC?[["CC Fees", fmtD(results.reduce((a,r)=>a+(r.ccFees||0),0)), T.text]]:[]),
                      ["Net Profit", fmtD(totProfit),   mc],
                      ["Margin",     fmtP(netMarg),     mc],
                      ["Per Piece",  fmtD(profitPc),    mc],
                      ...(totActualBlanks>0?[["Actual Blanks", fmtD(totActualBlanks), totActualBlanks>totBlank?T.red:T.green]]:[]),
                    ].map(([l,v,c],idx)=>{
                      const isProfit=["Net Profit","Margin","Per Piece"].includes(l);
                      const isVendorSub=l.startsWith("  ");
                      return (
                      <tr key={l+idx} style={{background:T.card,borderTop:l==="Net Profit"?`1px solid ${T.border}`:"none"}}>
                        <td style={{padding:isVendorSub?"1px 10px 1px 18px":"2px 10px",color:isVendorSub?T.faint:T.muted,fontFamily:font,fontWeight:isVendorSub?400:500,fontSize:isVendorSub?10:11,lineHeight:1.25}}>{l}</td>
                        <td style={{padding:isVendorSub?"1px 10px":"2px 10px",color:c,fontFamily:mono,fontWeight:isVendorSub?500:700,textAlign:"right",fontSize:isVendorSub?10:11,lineHeight:1.25}}>{v}</td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
              {/* Mockup thumbnail — shows for selected item */}
              {selectedItemId && mockupMap[selectedItemId]?.driveFileId && (()=>{
                const selectedProd = costProds.find(p=>p.id===selectedItemId);
                return (
                  <div style={{borderRadius:8,overflow:"hidden",border:`1px solid ${T.border}`}}>
                    <DriveThumb
                      driveFileId={mockupMap[selectedItemId].driveFileId}
                      enlargeable
                      title={selectedProd?.name ? `${selectedProd.name} — mockup` : "Mockup"}
                      driveLink={mockupMap[selectedItemId].driveLink || null}
                      style={{width:"100%",display:"block",objectFit:"contain"}}
                    />
                  </div>
                );
              })()}
            </div>
            );
            return portalTarget ? createPortal(rightCol, portalTarget) : rightCol;
          })()}
        </div>
      )}

      {/* Client Quote */}
      {costTab==="quote"&&(()=>{
        const quoteProds=costProds.filter(p=>(p.totalQty||0)>0);
        const quoteTotal=quoteProds.reduce((a,p)=>{const r2=calcCostProduct(p,costMargin,inclShip,inclCC,costProds);if(!r2) return a; const spu=Math.round(r2.sellPerUnit*100)/100; return a+Math.round(spu*r2.qty*100)/100;},0);
        const approved=project.prodStatus==="Awaiting Deposit"||project.prodStatus==="Ready for Production"||project.prodStatus==="Bulk Production";
        const rejectionNotes = project?.quote_rejection_notes || null;
        const clearRejectionNotes = async () => {
          await createClient().from("jobs").update({ quote_rejection_notes: null }).eq("id", project.id);
          if (onUpdateProject) onUpdateProject({ quote_rejection_notes: null });
          logJobActivity(project.id, "Quote feedback marked as handled");
        };
        return(
          <div style={{width:"100%"}}>
            {/* Client feedback banner — appears when the client rejected
                the quote with notes via the portal. Dashboard "Quote
                feedback" alert deep-links here. Cleared automatically
                when a new quote is sent (email send route nulls the
                column) or manually via Mark handled. */}
            {rejectionNotes && !approved && (
              <div style={{
                background: T.redDim, border: `1px solid ${T.red}66`, borderRadius: 10,
                padding: "12px 14px", marginBottom: 14,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.red, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Client feedback — quote rejected
                  </div>
                  <button onClick={clearRejectionNotes}
                    style={{ background: "transparent", border: `1px solid ${T.red}66`, color: T.red, fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 5, cursor: "pointer", fontFamily: font, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Mark handled
                  </button>
                </div>
                <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {rejectionNotes}
                </div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>
                  Sending a revised quote below clears this automatically.
                </div>
              </div>
            )}

            {/* Quote details card with the Send Quote action pinned
                inside as the card's primary footer button. Single
                place for everything quote-related on this tab. */}
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px",marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Quote details</div>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,marginBottom:14}}>
                <CInput label="Quote #" value={orderInfo.invoiceNum} onChange={v=>setOrderInfo(o=>({...o,invoiceNum:v}))}/>
                <CInput label="Valid until" type="date" value={orderInfo.validUntil} onChange={v=>setOrderInfo(o=>({...o,validUntil:v}))}/>
              </div>
              <button onClick={()=>setShowSendEmail(true)}
                style={{display:"block",background:T.blue,color:"#fff",border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,fontFamily:font,cursor:"pointer",width:"100%",boxSizing:"border-box",boxShadow:"0 1px 2px rgba(0,0,0,0.06)"}}>
                Send Quote →
              </button>
            </div>
            {showSendEmail && (
              <div style={{position:"fixed",inset:0,background:"#fff",zIndex:100,display:"flex",flexDirection:"column",fontFamily:font}}>
                {/* Header — title left, close right, matches ProofModal */}
                <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:14,fontWeight:700,color:T.text}}>Send Quote{orderInfo.invoiceNum?` · #${orderInfo.invoiceNum}`:""}</span>
                    <span style={{fontSize:11,color:T.muted}}>{project.clients?.name||project.title||""}</span>
                  </div>
                  <button onClick={()=>setShowSendEmail(false)} aria-label="Close" style={{background:"none",border:"none",color:T.muted,fontSize:20,cursor:"pointer",padding:"4px 8px",lineHeight:1}}>×</button>
                </div>
                {/* Body: send form on the left (380px rail), PDF preview
                    on the right. Mobile stacks: form on top, preview
                    below. */}
                <div style={{flex:1,display:"flex",flexDirection:isMobile?"column":"row",overflow:"hidden",minHeight:0}}>
                  <div style={{width:isMobile?"auto":380,flexShrink:0,display:"flex",flexDirection:"column",overflow:"hidden",borderRight:isMobile?"none":`1px solid ${T.border}`,borderBottom:isMobile?`1px solid ${T.border}`:"none"}}>
                    <div style={{flex:1,overflowY:"auto",padding:"14px 18px"}}>
                      <SendEmailDialog
                        type="quote"
                        jobId={project.id}
                        contacts={(contacts||[]).map(c=>({name:c.name||c.full_name||"",email:c.email||""}))}
                        defaultEmail={orderInfo.clientEmail||""}
                        defaultSubject={`Quote${orderInfo.invoiceNum?" #"+orderInfo.invoiceNum:""} — ${project.clients?.name||project.title||"House Party Distro"}`}
                        onClose={()=>setShowSendEmail(false)}
                        onSent={()=>logJobActivity(project.id, "Quote sent to client")}
                      />
                    </div>
                  </div>
                  <div style={{flex:1,background:T.surface,overflow:"hidden",minHeight:isMobile?280:0,display:"flex"}}>
                    <PdfCanvasPreview src={`/api/pdf/quote/${project.id}`} />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* PO */}

      {/* RFQ — step 1: pick decorator + items */}
      {showRfqModal && (() => {
        const eligible = (costProds || []).filter(p => (p.totalQty || 0) > 0);
        const selectedIds = Object.keys(rfqSelected).filter(id => rfqSelected[id]);
        const selectedCount = selectedIds.length;
        const dec = getDecRecord(rfqVendor);
        const contactList = dec?.contacts_list || [];
        const recipientCount =
          contactList.filter((c, i) => rfqRecipientSel[i] && c?.email).length +
          (rfqExtraEmail.trim() ? 1 : 0);
        const canSend = !!rfqVendor && selectedCount > 0 && recipientCount > 0 && !rfqSending;
        const inp = { width:"100%", padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, background:T.surface, color:T.text, fontSize:13, fontFamily:font, outline:"none", boxSizing:"border-box" };
        const sectionLabel = { fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:5 };
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>!rfqSending && setShowRfqModal(false)}>
            <div style={{background:T.card,borderRadius:12,width:"95vw",maxWidth:680,maxHeight:"90vh",overflow:"auto",padding:0}} onClick={e=>e.stopPropagation()}>

              {/* Header */}
              <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:T.text,fontFamily:font}}>Request Pricing</div>
                  <div style={{fontSize:11,color:T.muted,marginTop:2}}>Send a quote request to a decorator</div>
                </div>
                <button onClick={()=>!rfqSending && setShowRfqModal(false)} style={{background:"none",border:"none",color:T.faint,fontSize:18,cursor:"pointer",padding:"0 4px"}}>×</button>
              </div>

              {/* Sent confirmation */}
              {rfqSent && (
                <div style={{padding:"24px 20px",display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:T.green,fontFamily:font,fontSize:14,fontWeight:600}}>
                  <span style={{fontSize:18}}>✓</span> Quote request sent to {rfqVendor}
                </div>
              )}

              {!rfqSent && (
              <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:14}}>

                {/* Decorator */}
                <div>
                  <div style={sectionLabel}>Decorator</div>
                  <select value={rfqVendor} onChange={e=>setRfqVendor(e.target.value)}
                    style={{...inp, cursor:"pointer", borderColor: rfqVendor ? T.accent+"66" : T.border, color: rfqVendor ? T.text : T.muted}}>
                    <option value="">— select decorator —</option>
                    {decoratorRecords.map(d => (
                      <option key={d.id} value={d.short_code || d.name}>{d.name}{d.short_code ? ` (${d.short_code})` : ""}</option>
                    ))}
                  </select>
                </div>

                {/* Items */}
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                    <div style={sectionLabel}>Items</div>
                    {eligible.length > 0 && (
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>{ const all={}; eligible.forEach(p=>{all[p.id]=true;}); setRfqSelected(all); }}
                          style={{fontSize:10,color:T.accent,background:"none",border:"none",cursor:"pointer",fontFamily:font}}>Select all</button>
                        <button onClick={()=>setRfqSelected({})}
                          style={{fontSize:10,color:T.faint,background:"none",border:"none",cursor:"pointer",fontFamily:font}}>Clear</button>
                      </div>
                    )}
                  </div>
                  {eligible.length === 0 ? (
                    <div style={{padding:"12px",fontSize:11,color:T.faint,textAlign:"center",border:`1px dashed ${T.border}`,borderRadius:6}}>
                      No items with quantities yet — add items in the Buy Sheet first.
                    </div>
                  ) : (
                    <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:200,overflow:"auto"}}>
                      {eligible.map((p,idx) => {
                        const checked = !!rfqSelected[p.id];
                        const itemVendor = p.printVendor || "";
                        const matchesVendor = rfqVendor && itemVendor === rfqVendor;
                        return (
                          <label key={p.id}
                            style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",background:checked?T.accentDim:T.surface,border:`1px solid ${checked?T.accent+"66":T.border}`,borderRadius:6,cursor:"pointer"}}>
                            <input type="checkbox" checked={checked}
                              onChange={e=>setRfqSelected(prev=>({...prev,[p.id]:e.target.checked}))}
                              style={{accentColor:T.accent,flexShrink:0}} />
                            <span style={{width:20,height:20,borderRadius:4,background:T.purpleDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:T.purple,fontFamily:mono,flexShrink:0}}>
                              {String.fromCharCode(65+idx)}
                            </span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:600,color:T.text}}>{p.name || "—"}</div>
                              <div style={{fontSize:10,color:T.muted}}>
                                {(p.totalQty || 0).toLocaleString()} units
                                {p.style ? ` · ${p.style}` : ""}
                                {p.color ? ` · ${p.color}` : ""}
                              </div>
                            </div>
                            <div style={{fontSize:10,color:matchesVendor?T.green:itemVendor?T.muted:T.faint,fontFamily:mono,flexShrink:0}}>
                              {itemVendor || "no vendor"}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Recipients (contacts + manual add) */}
                {rfqVendor && (
                  <div>
                    <div style={sectionLabel}>To {recipientCount > 1 && <span style={{color:T.faint,fontWeight:500,marginLeft:4,textTransform:"none",letterSpacing:0}}>· first recipient is To, others are CC</span>}</div>
                    {contactList.length === 0 && !dec?.contact_email ? (
                      <div style={{fontSize:11,color:T.amber,marginBottom:6}}>No contacts on file for {dec?.name || rfqVendor}. Add an email below.</div>
                    ) : (
                      <div style={{display:"flex",flexDirection:"column",gap:4}}>
                        {contactList.map((c, i) => (
                          <label key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background: rfqRecipientSel[i] ? T.accentDim : T.surface, border: `1px solid ${rfqRecipientSel[i] ? T.accent+"66" : T.border}`, borderRadius:6, cursor: c?.email ? "pointer" : "default", opacity: c?.email ? 1 : 0.5}}>
                            <input type="checkbox" checked={!!rfqRecipientSel[i]} disabled={!c?.email}
                              onChange={e=>setRfqRecipientSel(prev=>({...prev, [i]: e.target.checked}))}
                              style={{accentColor:T.accent}} />
                            <div style={{flex:1,minWidth:0}}>
                              <span style={{fontSize:12,fontWeight:600,color:T.text}}>{c?.name || "Unnamed"}</span>
                              {c?.role && <span style={{fontSize:10,color:T.muted,marginLeft:6}}>{c.role}</span>}
                            </div>
                            <span style={{fontSize:11,color:T.muted,fontFamily:mono}}>{c?.email || "no email"}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div style={{marginTop:6}}>
                      <input value={rfqExtraEmail} onChange={e=>setRfqExtraEmail(e.target.value)}
                        placeholder="+ Add another email"
                        style={{...inp, fontSize:11, padding:"5px 10px"}} />
                    </div>
                  </div>
                )}

                {/* Subject */}
                {rfqVendor && (
                  <div>
                    <div style={sectionLabel}>Subject</div>
                    <input value={rfqSubject} onChange={e=>setRfqSubject(e.target.value)} style={inp} />
                  </div>
                )}

                {/* Custom message */}
                {rfqVendor && (
                  <div>
                    <div style={sectionLabel}>Your message <span style={{color:T.faint,fontWeight:500,marginLeft:4,textTransform:"none",letterSpacing:0}}>· optional · added to standard email</span></div>
                    <textarea value={rfqBody} onChange={e=>setRfqBody(e.target.value)} rows={3}
                      placeholder="Anything specific you want them to know? Tight deadline, multiple decorators bidding, special technique, etc."
                      style={{...inp, resize:"vertical", lineHeight:1.5}} />
                  </div>
                )}

                {/* Automated email preview (collapsible) */}
                {rfqVendor && (
                  <div style={{border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
                    <button type="button" onClick={()=>setRfqShowPreview(s=>!s)}
                      style={{width:"100%",padding:"7px 10px",background:T.surface,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:font}}>
                      <span style={{fontSize:11,fontWeight:600,color:T.muted}}>Standard email body {rfqShowPreview ? "▾" : "▸"}</span>
                      <span style={{fontSize:10,color:T.faint}}>What we'll always send</span>
                    </button>
                    {rfqShowPreview && (
                      <div style={{padding:"10px 14px",fontSize:12,color:T.text,lineHeight:1.55,background:T.card,fontFamily:font}}>
                        <div style={{fontWeight:600,marginBottom:4}}>Hi {rfqVendor || "{Vendor}"},</div>
                        <div style={{marginBottom:6}}>
                          Can you please provide pricing for the item(s) in the attachment? The PDF lays out each item — please reply with: pricing, setup fees, and estimated shipping cost. In addition, we need realistic production lead time and post-production transit time.
                        </div>
                        {rfqBody.trim() && (
                          <div style={{marginTop:8,padding:"8px 10px",background:T.surface,borderLeft:`3px solid ${T.accent}`,borderRadius:3,whiteSpace:"pre-wrap"}}>
                            {rfqBody.trim()}
                          </div>
                        )}
                        <div style={{marginTop:8,fontSize:11,color:T.muted,fontStyle:"italic"}}>
                          Reach out if anything in the spec is unclear or if you need additional info — we'll send through whatever you need.
                        </div>
                        <div style={{marginTop:8}}>Thanks,<br/>House Party Distro</div>
                      </div>
                    )}
                  </div>
                )}

                {rfqError && (
                  <div style={{fontSize:12,color:T.red,fontFamily:font}}>{rfqError}</div>
                )}
              </div>
              )}

              {/* Footer */}
              {!rfqSent && (
                <div style={{padding:"12px 20px",borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{fontSize:11,color:T.muted}}>
                    {selectedCount} item{selectedCount !== 1 ? "s" : ""} · {recipientCount} recipient{recipientCount !== 1 ? "s" : ""}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>!rfqSending && setShowRfqModal(false)}
                      style={{background:"none",border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,padding:"7px 14px",fontSize:12,fontFamily:font,cursor:"pointer"}}>
                      Cancel
                    </button>
                    <button disabled={!canSend} onClick={sendRfq}
                      style={{background:canSend?T.accent:T.surface,border:"none",borderRadius:6,color:canSend?"#fff":T.faint,padding:"7px 16px",fontSize:12,fontFamily:font,fontWeight:700,cursor:canSend?"pointer":"default",opacity:canSend?1:0.6}}>
                      {rfqSending ? "Sending…" : "Send Request"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <AddDecoratorModal
        open={addDecoratorTargetIdx != null}
        onClose={()=>setAddDecoratorTargetIdx(null)}
        onSaved={handleDecoratorCreated}
      />

    </div>
  );
};


export { CostingTab };

export function CostingTabWrapper({ project, buyItems = [], contacts = [], onUpdateBuyItems, onRegisterSave, onSaveStatus, onSaved, initialTab = "calc", hideSubTabs = false, selectedItemId, onSelectItem, onUpdateProject, hideToolbar = false, actionsRef, onPullStateChange }) {
  // Archived (complete/cancelled) = read-only historic record. Blocks
  // the PSD auto-pull mount effect and hard-gates onSave so nothing
  // writes costing_data / items / buy_sheet_lines on an archived job —
  // opening the tab to view history must never mutate it.
  const isArchivedJob = project?.phase === "complete" || project?.phase === "cancelled";
  const effectiveLock = !!project?.type_meta?.costing_locked || isArchivedJob;
  const [pricingReady, setPricingReady] = useState(false);
  const [decoratorRecords, setDecoratorRecords] = useState([]);
  const vendorIdMapRef = React.useRef({});
  const lastBuyItemsRef = React.useRef("");

  // Load decorator pricing + IDs from DB on mount.
  // Also keep the full records around (with contacts_list) so the
  // RFQ modal can populate vendor + contact dropdowns without re-fetching.
  // Exposed via onRefreshDecorators so the inline "Add Decorator" modal
  // can re-pull after creating a new row.
  const refreshDecorators = React.useCallback(async () => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data } = await supabase.from("decorators").select("id, name, short_code, pricing_data, contacts_list, contact_email").order("name");
      if (data) {
        loadPricingFromDecorators(data);
        const idMap = {};
        data.forEach(d => { idMap[d.short_code || d.name] = d.id; });
        vendorIdMapRef.current = idMap;
        setDecoratorRecords(data);
      }
    } catch(e) { console.error("Failed to load decorator pricing", e); }
  }, []);
  useEffect(() => {
    refreshDecorators().finally(() => setPricingReady(true));
  }, [refreshDecorators]);

  const savedData = project?.costing_data || null;

  const initItems = (buyItems || []).map(it => {
    const saved = savedData?.costProds?.find((p) => p.id === it.id);
    if (saved) {
      const updates = { sizes: sortSizes(it.sizes || []), qtys: it.qtys || saved.qtys || {}, garment_type: it.garment_type || saved.garment_type || null };
      if (it.blank_vendor && it.blank_vendor !== saved.style) { updates.style = it.blank_vendor; updates.color = it.blank_sku || saved.color; }
      if (it.blankCosts && Object.keys(it.blankCosts).length > 0 && (!saved.blankCosts || Object.keys(saved.blankCosts).length === 0)) { updates.blankCosts = it.blankCosts; updates.blankCostPerUnit = Object.values(it.blankCosts).filter(v=>v>0).reduce((a,v,_,arr)=>a+v/arr.length,0); }
      // Production notes — items.production_notes_po is source of truth.
      // Falls back to legacy costing_data.itemNotes for jobs created before
      // the consolidation. Tab unmounts on switch (autosave flushes), so
      // POTab edits are picked up on next mount.
      updates.itemNotes = it.production_notes_po || saved.itemNotes || "";
      // Fleece flag — items.is_fleece is the canonical value (set in
      // Product Builder). Old jobs that had isFleece on the costing run
      // keep their flag via the saved.isFleece fallback so existing
      // pricing math stays correct.
      updates.isFleece = !!(it.is_fleece || saved.isFleece);
      return { ...saved, ...updates };
    }
    let blankCosts = {};
    if (it.blankCosts && Object.keys(it.blankCosts).length > 0) {
      blankCosts = it.blankCosts;
    } else if (it.cost_per_unit > 0) {
      (it.sizes||[]).forEach(sz => { blankCosts[sz] = it.cost_per_unit; });
    } else {
      blankCosts = seedBlankCosts(it.blank_vendor || "", it.blank_sku || "", it.sizes || []);
    }
    const blankCostPerUnit = it.cost_per_unit > 0 ? it.cost_per_unit
      : (Object.values(blankCosts).filter(v=>v>0).reduce((a,v,_,arr)=>a+v/arr.length,0));
    // Auto-detect supplier from blank_vendor
    const vendor = it.blank_vendor || "";
    const detectedSupplier = (() => {
      const v = vendor.toLowerCase();
      if (v.startsWith("as colour") || v.startsWith("as color")) return "AS Colour";
      if (v.startsWith("la apparel") || v.startsWith("los angeles")) return "LA Apparel";
      if (v.startsWith("sanmar") || v.startsWith("port ") || v.startsWith("sport-tek") || v.startsWith("district")) return "Sanmar";
      // S&S brands: Comfort Colors, Gildan, Bella+Canvas, Next Level, Tultex, Hanes, Champion, etc.
      const ssBrands = ["comfort colors","gildan","bella","next level","tultex","hanes","champion","jerzees","fruit of the loom","independent trading","alternative","allmade","american apparel","rabbit skins","lat ","m&o ","augusta","badger","boxercraft"];
      if (ssBrands.some(b => v.startsWith(b))) return "S&S";
      return "";
    })();
    return {
      ...EMPTY_COST_PRODUCT(),
      id: it.id,
      name: it.name || "",
      style: vendor,
      color: it.blank_sku || "",
      supplier: detectedSupplier,
      sizes: sortSizes(it.sizes || []),
      qtys: it.qtys || {},
      blankCosts,
      blankCostPerUnit,
      totalQty: Object.values(it.qtys || {}).reduce((a, v) => a + v, 0),
      garment_type: it.garment_type || null,
      isFleece: !!it.is_fleece,
      itemNotes: it.production_notes_po || "",
      ...((()=>{ const NG=["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"]; return NG.includes(it.garment_type) && !saved ? { customCosts: [{desc:"",perUnit:0,flat:false},{desc:"",perUnit:0,flat:false}] } : {}; })()),
    };
  });

  const [costProds, setCostProds] = useState(initItems.length > 0 ? initItems : [EMPTY_COST_PRODUCT()]);
  const [savedCostProds, setSavedCostProds] = useState(initItems.length > 0 ? initItems : [EMPTY_COST_PRODUCT()]);
  const [costMargin, setCostMargin] = useState(savedData?.costMargin || "30%");
  const [inclShip, setInclShip] = useState(savedData?.inclShip !== undefined ? savedData.inclShip : true);
  const [inclCC, setInclCC] = useState(savedData?.inclCC !== undefined ? savedData.inclCC : true);
  const defaultValidUntil = (() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().split("T")[0]; })();
  const [orderInfo, setOrderInfo] = useState(savedData?.orderInfo ? { ...savedData.orderInfo, validUntil: savedData.orderInfo.validUntil || defaultValidUntil } : {
    clientEmail: "",
    invoiceNum: project?.job_number || "",
    validUntil: defaultValidUntil,
    shipMethod: "",
    vendorId: "",
    productionNotes: "", finishingNotes: "",
  });
  const [savedOrderInfo, setSavedOrderInfo] = useState(savedData?.orderInfo ? { ...savedData.orderInfo, validUntil: savedData.orderInfo.validUntil || defaultValidUntil } : {
    clientEmail: "",
    invoiceNum: project?.job_number || "",
    validUntil: defaultValidUntil,
    shipMethod: "",
    vendorId: "",
    productionNotes: "", finishingNotes: "",
  });
  const [saveStatus, setSaveStatus] = useState("saved");
  const onSaveRef = React.useRef(null);
  const costingDirty = JSON.stringify(costProds) !== JSON.stringify(savedCostProds) ||
    JSON.stringify(orderInfo) !== JSON.stringify(savedOrderInfo);

  // Save on unmount if dirty
  const costingDirtyRef = React.useRef(false);
  costingDirtyRef.current = costingDirty;
  useEffect(() => {
    const handler = (e) => { if (costingDirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      if (costingDirtyRef.current && onSaveRef.current) onSaveRef.current();
    };
  }, []);

  // Auto-detect print locations from PSD files. Runs once on mount
  // (the ref guard below) AND on-demand via the "Pull from PSDs"
  // button in the calc header — same logic, same skip rule
  // (won't overwrite items that already have locations set), so it's
  // safe to click any time.
  const [pullingPsds, setPullingPsds] = useState(false);
  const [pullResult, setPullResult] = useState(null);
  const detectFromPsds = React.useCallback(async () => {
    const itemsNeedingPsd = costProds.filter(cp => {
      if (cp.garment_type === "accessory") return false;
      const locs = cp.printLocations || {};
      const hasLocations = Object.values(locs).some(l => l?.location);
      return !hasLocations;
    });
    if (itemsNeedingPsd.length === 0) return { scanned: 0, populated: 0 };

    setPullingPsds(true);
    let populated = 0;
    let psdFiles = null;
    let queryError = null;
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const ids = itemsNeedingPsd.map(cp => cp.id);
      const queryRes = await supabase.from("item_files")
        .select("item_id, drive_file_id, file_name, notes")
        .in("item_id", ids)
        .ilike("file_name", "%.psd");
      psdFiles = queryRes.data;
      queryError = queryRes.error;
      console.log("[Pull from PSDs] scanned", itemsNeedingPsd.length, "items, found", psdFiles?.length || 0, "PSDs", queryError ? `(error: ${queryError.message})` : "");
      if (!psdFiles || psdFiles.length === 0) return { scanned: itemsNeedingPsd.length, populated: 0, foundFiles: 0, error: queryError?.message };

      const psdByItem = {};
      for (const f of psdFiles) { if (!psdByItem[f.item_id]) psdByItem[f.item_id] = f; }

      const PLACEMENT_MAP = { 'Front':'Full Front','Full Front':'Full Front','Back':'Full Back','Full Back':'Full Back','Left Chest':'Left Chest','Right Chest':'Right Chest','Left Sleeve':'Left Sleeve','Right Sleeve':'Right Sleeve','Neck':'Neck','Hood':'Hood','Pocket':'Pocket' };
      const SKIP_GROUPS = ['Shirt Color','Shadows','Highlights','Mask','Client Art'];

      for (const [itemId, psdFile] of Object.entries(psdByItem)) {
        try {
          let cachedData = null;
          try { cachedData = psdFile.notes ? JSON.parse(psdFile.notes) : null; } catch {}
          if (cachedData?.psd_locations) {
            const newLocations = {};
            let locIdx = 1;
            for (const loc of cachedData.psd_locations) {
              newLocations[String(locIdx)] = { location: PLACEMENT_MAP[loc.placement] || loc.placement, screens: loc.colorCount || 0, printer: "" };
              locIdx++;
            }
            for (let padIdx = locIdx; padIdx <= 6; padIdx++) newLocations[String(padIdx)] = {};
            setCostProds(prev => prev.map(cp => {
              if (cp.id !== itemId) return cp;
              const hasExisting = Object.values(cp.printLocations || {}).some(l => l?.location);
              if (hasExisting) return cp;
              populated++;
              return { ...cp, printLocations: newLocations, printCount: locIdx - 1, tagPrint: cachedData.psd_has_tag || cp.tagPrint };
            }));
            continue;
          }

          // dl=1 is critical: the thumbnail endpoint serves Drive's PNG
          // thumb for non-browser-renderable mimes (PSD/AI/EPS) by
          // default. We need the actual PSD bytes for ag-psd to parse,
          // so force the full-file path here.
          const res = await fetch(`/api/files/thumbnail?id=${psdFile.drive_file_id}&dl=1`);
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          const { readPsd } = await import("ag-psd");
          const psd = readPsd(new Uint8Array(buf));
          const groups = [...(psd.children || [])].reverse();

          const newLocations = {};
          let locIdx = 1;
          let hasTag = false;

          for (const group of groups) {
            if (SKIP_GROUPS.includes(group.name)) continue;
            const isTag = (group.name || "").toLowerCase() === "tag" || (group.name || "").toLowerCase() === "tags";
            if (isTag) { hasTag = true; continue; }
            if (!group.children || group.children.length === 0) continue;

            const colorCount = group.children.filter(l => !SKIP_GROUPS.includes(l.name) && l.name).length;
            const locName = PLACEMENT_MAP[group.name] || group.name;

            newLocations[String(locIdx)] = { location: locName, screens: colorCount, printer: "" };
            locIdx++;
          }
          for (let i = locIdx; i <= 6; i++) newLocations[String(i)] = {};

          setCostProds(prev => prev.map(cp => {
            if (cp.id !== itemId) return cp;
            const hasExisting = Object.values(cp.printLocations || {}).some(l => l?.location);
            if (hasExisting) return cp;
            populated++;
            return { ...cp, printLocations: newLocations, printCount: locIdx - 1, tagPrint: hasTag || cp.tagPrint };
          }));
        } catch (e) {
          console.error("PSD detect error for item", itemId, e);
        }
      }
    } finally {
      setPullingPsds(false);
    }
    return { scanned: itemsNeedingPsd.length, populated, foundFiles: psdFiles?.length || 0 };
  }, [costProds]);

  const handlePullFromPsds = React.useCallback(async () => {
    const result = await detectFromPsds();
    if (result.populated > 0) {
      setPullResult(`Pulled print locations from ${result.populated} item${result.populated !== 1 ? "s" : ""}.`);
    } else if (result.scanned === 0) {
      setPullResult("All items already have print locations set.");
    } else if (result.error) {
      setPullResult(`Query error: ${result.error}`);
    } else if (result.foundFiles > 0) {
      setPullResult(`Scanned ${result.scanned} items, found ${result.foundFiles} PSDs but none had readable print layers.`);
    } else {
      setPullResult(`Scanned ${result.scanned} items — no PSDs in item_files. Check Art Files / browser console.`);
    }
    setTimeout(() => setPullResult(null), 10000);
  }, [detectFromPsds]);

  // Project header toolbar registration. The wrapper owns pull state +
  // PSD logic; the inner CostingTab owns the RFQ modal. Both register
  // their handler onto the shared actionsRef so the header can fire
  // either without a duplicate toolbar.
  const openRfqRef = React.useRef(null);
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      pullFromPsds: handlePullFromPsds,
      openRfqModal: () => openRfqRef.current?.(),
    };
  }, [actionsRef, handlePullFromPsds]);
  useEffect(() => {
    if (onPullStateChange) onPullStateChange(pullingPsds, pullResult);
  }, [pullingPsds, pullResult, onPullStateChange]);

  // First-load auto-run — same behavior as before, just delegates to
  // the shared function now.
  const psdDetectedRef = React.useRef(false);
  useEffect(() => {
    // Never auto-mutate print locations while pricing is locked or the
    // job is archived — viewing must be side-effect free. (The manual
    // Pull button stays available on live jobs.)
    if (psdDetectedRef.current || effectiveLock) return;
    psdDetectedRef.current = true;
    const itemsNeedingPsd = costProds.filter(cp => {
      if (cp.garment_type === "accessory") return false;
      const locs = cp.printLocations || {};
      const hasLocations = Object.values(locs).some(l => l?.location);
      return !hasLocations;
    });
    if (itemsNeedingPsd.length === 0) return;
    detectFromPsds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync buy item changes (name, sizes, qtys, adds, removes) into both costProds AND savedCostProds
  // Only runs when buyItems actually changes (compared by serialized snapshot)
  useEffect(() => {
    if (!buyItems.length) return;
    const snapshot = JSON.stringify(buyItems.map(b => ({ id:b.id, name:b.name, sizes:b.sizes, qtys:b.qtys, totalQty:b.totalQty, garment_type:b.garment_type, blank_vendor:b.blank_vendor, blankCosts:b.blankCosts })));
    if (snapshot === lastBuyItemsRef.current) return;
    lastBuyItemsRef.current = snapshot;

    const applySync = (prev) => {
      const existingIds = new Set(prev.map(p => p.id));
      const buyIds = new Set(buyItems.map(b => b.id));
      // Add new items
      const newItems = buyItems.filter(bi => !existingIds.has(bi.id)).map(it => {
        const styleKey = (it.style || it.blank_vendor || "").split("–")[0].trim().replace(/\s+/g, "");
        const blankCosts = it.blankCosts && Object.keys(it.blankCosts).length > 0 ? it.blankCosts : seedBlankCosts(styleKey, it.color || it.blank_sku || "", it.sizes || []);
        const vnd = (it.blank_vendor || "").toLowerCase();
        const autoSupplier = vnd.startsWith("as colour")||vnd.startsWith("as color")?"AS Colour":vnd.startsWith("la apparel")||vnd.startsWith("los angeles")?"LA Apparel":vnd.startsWith("sanmar")||vnd.startsWith("port ")||vnd.startsWith("sport-tek")||vnd.startsWith("district")?"Sanmar":["comfort colors","gildan","bella","next level","tultex","hanes","champion","jerzees","fruit of the loom","independent trading","alternative","allmade","american apparel","rabbit skins","lat ","m&o ","augusta","badger","boxercraft"].some(b=>vnd.startsWith(b))?"S&S":"";
        const newItem = { ...EMPTY_COST_PRODUCT(), id: it.id, name: it.name || "", style: it.blank_vendor || "", color: it.blank_sku || "", sizes: sortSizes(it.sizes || []), qtys: it.qtys || {}, blankCosts, totalQty: it.totalQty || Object.values(it.qtys || {}).reduce((a, v) => a + v, 0), garment_type: it.garment_type || null, supplier: autoSupplier };
        { const NG=["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"]; if (NG.includes(it.garment_type)) newItem.customCosts = [{desc:"",perUnit:0,flat:false},{desc:"",perUnit:0,flat:false}]; }
        return newItem;
      });
      // Update existing + remove deleted
      const updated = prev.filter(cp => buyIds.has(cp.id)).map(cp => {
        const bi = buyItems.find(b => b.id === cp.id);
        if (!bi) return cp;
        // Only override cp.qtys when buyItems actually has buy_sheet_lines
        // for this item. Empty {} (no rows in DB) MUST NOT wipe qtys that
        // were entered via Costing's per-size grid — that's how the data
        // got lost on refresh before this guard was here.
        const biHasQtyKeys = bi.qtys && Object.keys(bi.qtys).length > 0;
        const totalQty = biHasQtyKeys
          ? (bi.totalQty || Object.values(bi.qtys).reduce((a, v) => a + v, 0))
          : cp.totalQty;
        const updates = { name: bi.name || cp.name, sizes: sortSizes(bi.sizes || []), garment_type: bi.garment_type || cp.garment_type || null };
        if (biHasQtyKeys) {
          updates.qtys = bi.qtys;
          updates.totalQty = totalQty;
        }
        // Sync blank info if assigned/changed on buy sheet. Pull the catalog
        // costs ONLY when the blank itself was (re)assigned — NOT on every
        // difference. Costing is the authority for cost *refinements* on an
        // unchanged blank; overwriting on any diff is what reverted edited
        // costs back to the catalog value (the per-item revert bug).
        const blankReassigned = (bi.blank_vendor && bi.blank_vendor !== cp.style) || (bi.blank_sku && bi.blank_sku !== cp.color);
        if (bi.blank_vendor && bi.blank_vendor !== cp.style) { updates.style = bi.blank_vendor; updates.color = bi.blank_sku || cp.color; }
        if (blankReassigned && bi.blankCosts && Object.keys(bi.blankCosts).length > 0) { updates.blankCosts = bi.blankCosts; updates.blankCostPerUnit = Object.values(bi.blankCosts).filter(v=>v>0).reduce((a,v,_,arr)=>a+v/arr.length,0); }
        return { ...cp, ...updates };
      });
      return newItems.length > 0 ? [...updated, ...newItems] : updated;
    };
    setCostProds(applySync);
    // Do NOT also reset savedCostProds here. The sync fires whenever
    // buyItems changes — including when Costing's own qty edit calls
    // onUpdateBuyItems. Resetting savedCostProds in that case marks
    // the in-memory state as "matches DB" while the actual write
    // hasn't happened yet, killing costingDirty and skipping the
    // autosave. Costs persist because cost edits don't propagate
    // through buyItems; qtys do, which is why qtys silently dropped.
    // The autosave's own setSavedCostProds (after writing) is the only
    // legit path to "saved". Buy-Sheet-originated changes will trigger
    // a redundant Costing save on next tick — minor cost, correctness wins.
  }, [buyItems]);

  // Debounced auto-save — fires 1.5s after any change
  useEffect(() => {
    if (!costingDirty) return;
    setSaveStatus("saving"); if(onSaveStatus) onSaveStatus("saving");
    const t = setTimeout(async () => {
      await onSaveRef.current?.();
      setSaveStatus("saved"); if(onSaveStatus) onSaveStatus("saved");
    }, 800);
    return () => clearTimeout(t);
  }, [costProds, costMargin, inclShip, inclCC, orderInfo]);

  // Register save with parent for tab-switch saves
  useEffect(() => {
    if (typeof onRegisterSave === "function") {
      onRegisterSave(async () => { await onSaveRef.current?.(); });
    }
  }, []);

  const costingSaveInFlight = React.useRef(false);
  const onSave = async () => {
    // Hard write-gate for historic records. Gated on archived only —
    // NOT on costing_locked, because the Lock/Unlock toggle calls
    // onSave() while still locked as part of its own flow.
    if (isArchivedJob) return;
    if (costingSaveInFlight.current) return;
    costingSaveInFlight.current = true;
    setSavedCostProds(JSON.parse(JSON.stringify(costProds)));
    setSavedOrderInfo(JSON.parse(JSON.stringify(orderInfo)));
    if (project?.id) {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const rawResults = costProds.map((p, idx) => { const r = calcCostProduct(p, costMargin, inclShip, inclCC, costProds); return r ? { ...r, _idx: idx } : null; }).filter(Boolean);
        // Round sellPerUnit to cent first, then derive grossRev — matches what gets saved to items.sell_per_unit
        const results = rawResults.map(r => ({ ...r, sellPerUnit: Math.round(r.sellPerUnit * 100) / 100, grossRev: Math.round(Math.round(r.sellPerUnit * 100) / 100 * r.qty * 100) / 100 }));
        const grossRev = results.reduce((a, r) => a + r.grossRev, 0);
        const totalCost = Math.round(results.reduce((a,r) => a + r.totalCost, 0) * 100) / 100;
        const netProfit = Math.round((grossRev - totalCost) * 100) / 100;
        const totalQty = results.reduce((a,r) => a + r.qty, 0);
        const margin = grossRev > 0 ? netProfit / grossRev * 100 : 0;
        const avgPerUnit = totalQty > 0 ? grossRev / totalQty : 0;
        await supabase.from("jobs").update({
          costing_data: { costProds, costMargin, inclShip, inclCC, orderInfo },
          costing_summary: { grossRev, totalCost, netProfit, margin, avgPerUnit, totalQty }
        }).eq("id", project.id);
        if (onSaved) onSaved({ costing_data: { costProds, costMargin, inclShip, inclCC, orderInfo }, costing_summary: { grossRev, totalCost, netProfit, margin, avgPerUnit, totalQty } });
        // Write refined blank costs + decorator assignments back to items
        // Use the already-calculated results array (same data, no second calcCostProduct call)
        for (let cpIdx = 0; cpIdx < costProds.length; cpIdx++) {
          const cp = costProds[cpIdx];
          const r2 = results.find(r => r._idx === cpIdx);
          const itemUpdates = {};
          if (cp.blankCosts && Object.keys(cp.blankCosts).length > 0) {
            const costValues = Object.values(cp.blankCosts).filter(v => v > 0);
            itemUpdates.blank_costs = cp.blankCosts;
            itemUpdates.cost_per_unit = costValues.length > 0 ? Math.round(costValues.reduce((a, v) => a + v, 0) / costValues.length * 100) / 100 : null;
          }
          // Save the calculated sell_per_unit when either (a) there's an
          // explicit override (including $0 — replacements at no charge),
          // or (b) the auto-calc produced a positive value. Without the
          // explicit-override branch, $0 overrides would be skipped here
          // and items.sell_per_unit would keep its stale prior value.
          if (r2 && (cp.sellOverride != null || r2.sellPerUnit > 0)) {
            itemUpdates.sell_per_unit = Math.round((r2.sellPerUnit ?? 0) * 100) / 100;
          }
          // Per-item fully-loaded cost: blanks + decoration + setup + specialty +
          // finishing + packaging, allocated across units. Source of truth for
          // exact per-item margin (god-mode, reporting).
          if (r2 && r2.qty > 0 && r2.totalCost >= 0) {
            itemUpdates.cost_per_unit_all_in = Math.round((r2.totalCost / r2.qty) * 100) / 100;
          }
          // Production notes — single source of truth on items, mirrors
          // the field exposed on POTab. Always written so PO tab sees the
          // latest from costing without waiting on a separate save.
          itemUpdates.production_notes_po = (cp.itemNotes || "").trim() || null;
          if (Object.keys(itemUpdates).length > 0) {
            await supabase.from("items").update(itemUpdates).eq("id", cp.id);
          }
          // Persist per-size qtys to buy_sheet_lines (the source of truth
          // every other surface reads — PO PDF, Quote PDF, portal,
          // Production, Warehouse). Without this, qty edits in the Blanks
          // grid only land in jobs.costing_data and get wiped by the next
          // sync from empty buy_sheet_lines on refresh.
          if (cp.qtys && Object.keys(cp.qtys).length > 0) {
            const rows = Object.entries(cp.qtys).map(([size, qty]) => ({
              item_id: cp.id, size, qty_ordered: Number(qty) || 0,
            }));
            if (rows.length > 0) {
              await supabase.from("buy_sheet_lines").upsert(rows, { onConflict: "item_id,size" });
            }
          }
          // Auto-create/update decorator assignment when vendor is selected
          if (cp.printVendor && vendorIdMapRef.current[cp.printVendor]) {
            const decoratorId = vendorIdMapRef.current[cp.printVendor];
            const { data: existing } = await supabase.from("decorator_assignments").select("id").eq("item_id", cp.id).limit(1).single();
            const decoType = cp.decorationType || "screen_print";
            if (existing) {
              await supabase.from("decorator_assignments").update({ decorator_id: decoratorId, decoration_type: decoType }).eq("id", existing.id);
            } else {
              await supabase.from("decorator_assignments").insert({ item_id: cp.id, decorator_id: decoratorId, decoration_type: decoType, pipeline_stage: "blanks_ordered" });
            }
          }
        }
        // Update parent items with decorator names + sell_per_unit so sidebar and progress bar stay current
        if (onUpdateBuyItems) {
          const itemMap = {};
          for (let cpIdx = 0; cpIdx < costProds.length; cpIdx++) {
            const cp = costProds[cpIdx];
            const r2 = results.find(r => r._idx === cpIdx);
            const updates = {};
            if (cp.printVendor) updates.decorator = cp.printVendor;
            if (r2?.sellPerUnit > 0) updates.sell_per_unit = r2.sellPerUnit;
            if (Object.keys(updates).length > 0) itemMap[cp.id] = updates;
          }
          if (Object.keys(itemMap).length > 0) {
            onUpdateBuyItems(prev => prev.map(bi => itemMap[bi.id] ? {...bi, ...itemMap[bi.id]} : bi));
          }
        }
      } catch(e) { console.error("Failed to save costing data", e); setSaveStatus("error"); if(onSaveStatus) onSaveStatus("error"); }
      finally { costingSaveInFlight.current = false; }
    } else { costingSaveInFlight.current = false; }
  };
  onSaveRef.current = onSave;
  if (!pricingReady) return <div style={{padding:"2rem",color:T.muted,fontSize:13}}>Loading pricing...</div>;
  return (
    <CostingTab
      project={project} buyItems={buyItems} contacts={contacts} onUpdateBuyItems={onUpdateBuyItems}
      costProds={costProds} setCostProds={setCostProds}
      costMargin={costMargin} setCostMargin={setCostMargin}
      inclShip={inclShip} setInclShip={setInclShip}
      inclCC={inclCC} setInclCC={setInclCC}
      orderInfo={orderInfo} setOrderInfo={setOrderInfo}
      decoratorRecords={decoratorRecords}
      onRefreshDecorators={refreshDecorators}
      costingDirty={costingDirty} onSave={onSave} saveStatus={saveStatus} initialTab={initialTab} hideSubTabs={hideSubTabs} selectedItemId={selectedItemId} onSelectItem={onSelectItem} onUpdateProject={onUpdateProject}
      onPullFromPsds={handlePullFromPsds} pullingPsds={pullingPsds} pullResult={pullResult}
      hideToolbar={hideToolbar} openRfqRef={openRfqRef}
    />
  );
}
