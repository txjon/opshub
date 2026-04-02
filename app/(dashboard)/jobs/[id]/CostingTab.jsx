"use client";
import React, { useState, useEffect, useMemo } from "react";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";
import { DecorationPanel } from "./DecorationPanel";

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
  const p=PRINTERS[pk]; if(!p||!p.qtys.length)return 0;
  // Below minimum qty: apply minimum charge per location / qty
  const minQty=p.qtys[0]||0;
  if(qty<minQty&&p.minimums?.print>0){
    return p.minimums.print/qty;
  }
  let idx=0; for(let i=0;i<p.qtys.length;i++){if(qty>=p.qtys[i])idx=i;}
  const c=Math.min(Math.max(Math.round(colors),1),12);
  return p.prices[c]?.[idx]??0;
}
export function lookupTagPrice(pk,qty){
  const p=PRINTERS[pk]; if(!p||!p.tagPrices.length)return 0;
  // Below minimum qty: apply tag print minimum / qty
  const minQty=p.qtys[0]||0;
  if(qty<minQty&&p.minimums?.tagPrint>0){
    return p.minimums.tagPrint/qty;
  }
  let idx=0; for(let i=0;i<p.qtys.length;i++){if(qty>=p.qtys[i])idx=i;}
  return p.tagPrices[idx]??0;
}
function applyMargin(cost,mk){return cost*(MARGIN_TIERS[mk]??1.53);}

export function calcCostProduct(p,margin,inclShip,inclCC,allProds=[]){
  const qty=p.totalQty||0; if(qty===0)return null;
  const blankCost=(()=>{
    if(p.blankCosts&&Object.keys(p.blankCosts).length>0){
      let total=0;
      Object.entries(p.blankCosts).forEach(([sz,cost])=>{total+=(cost||0)*(p.qtys?.[sz]||0)*1.035;});
      return total;
    }
    return (p.blankCostPerUnit||0)*qty*1.035;
  })();
  let printTotal=0;
  let sharedScreensToSkip=0;
  const seenShareGroups={};// track first location per share group on this item
  for(let loc=1;loc<=6;loc++){
    const ld=p.printLocations?.[loc];
    const printer=ld?.printer||p.printVendor;
    if(printer&&ld?.screens>0){
      const isShared=!!(ld.shared)&&ld.shareGroup;
      const groupKey=isShared?ld.shareGroup.trim().toLowerCase():"";
      let sharedQty=0;
      if(isShared){
        // Count shared locations per item (same group on same item = multiply qty)
        sharedQty=allProds.reduce((sum,cp)=>{
          const matchingLocs=Object.values(cp.printLocations||{}).filter(l=>l.shared&&l.shareGroup&&l.shareGroup.trim().toLowerCase()===groupKey&&l.screens>0);
          return sum+(matchingLocs.length>0?(cp.totalQty||0)*matchingLocs.length:0);
        },0);
      }
      // Skip screen fees if not the first location in the share group (across all items AND within same item)
      if(isShared){
        if(seenShareGroups[groupKey]){
          // Not the first location on this item with this group — skip screens
          sharedScreensToSkip+=(parseFloat(ld.screens)||0);
        } else {
          seenShareGroups[groupKey]=true;
          // Check if another item earlier in the list has this group
          const firstIdx=allProds.findIndex(cp=>Object.values(cp.printLocations||{}).some(l=>l.shared&&l.shareGroup&&l.shareGroup.trim().toLowerCase()===groupKey&&l.screens>0));
          const myIdx=allProds.findIndex(cp=>cp.id===p.id);
          if(firstIdx>=0&&myIdx>firstIdx) sharedScreensToSkip+=(parseFloat(ld.screens)||0);
        }
      }
      const effectiveQty=isShared&&sharedQty>0?sharedQty:qty;
      printTotal+=lookupPrintPrice(printer,effectiveQty,ld.screens);
    }
  }
  if(p.tagPrint&&p.printVendor){
    const tagGroup=p.tagShareGroup||"";
    let tagEffQty=qty;
    if(tagGroup&&allProds){
      tagEffQty=allProds.reduce((sum,cp)=>{
        if(cp.tagPrint&&cp.tagShareGroup&&cp.tagShareGroup.trim().toLowerCase()===tagGroup.trim().toLowerCase()) return sum+(cp.totalQty||0);
        return sum;
      },0)||qty;
    }
    printTotal+=lookupTagPrice(p.printVendor,tagEffQty);
  }
  let finUnitRate=0;
  if(p.finishingQtys&&p.printVendor){
    const pr=PRINTERS[p.printVendor];
    const activeLocs=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length||0;
    if(pr){
      if(p.finishingQtys["Packaging_on"]){const variant=p.isFleece?"Fleece":(p.finishingQtys["Packaging_variant"]||"Tee");finUnitRate+=(pr.packaging?.[variant]||pr.finishing?.[variant]||0);}
      // Dynamic finishing items from decorator pricing
      Object.keys(p.finishingQtys||{}).forEach(fk=>{
        if(fk.endsWith("_on")&&p.finishingQtys[fk]){
          const key=fk.replace("_on","");
          if(key!=="Packaging"){finUnitRate+=(pr.specialty?.[key]||pr.finishing?.[key]||0);}
        }
      });
    }
  }
  let specUnitRate=0;
  if(p.specialtyQtys&&p.printVendor){
    const pr=PRINTERS[p.printVendor];
    if(pr){
      const seenSG={};const activeLocsDeduped=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];if(!ld?.location&&!ld?.screens) return false;if(ld.shared&&ld.shareGroup){const gk=ld.shareGroup.trim().toLowerCase();if(seenSG[gk]) return false;seenSG[gk]=true;}return true;}).length||0;
      const activeLocsRaw=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length||0;
      Object.keys(pr.specialty||{}).forEach(key=>{
        const isFleece=key==="Fleece Upcharge";
        const isOn=isFleece?p.isFleece:p.specialtyQtys[key+"_on"];
        if(isOn){
          const storedCount=p.specialtyQtys[key+"_count"]||0;
          const count=isFleece?(activeLocsRaw+(p.tagPrint?1:0)):(storedCount>0&&storedCount<activeLocsDeduped?storedCount:activeLocsDeduped);
          specUnitRate+=(pr.specialty?.[key]||0)*count;
        }
      });
    }
  }
  let setupTotal=0;
  if(p.setupFees){
    const pr=PRINTERS[p.printVendor||p.setupFees?.printer];
    if(pr){
      const autoScreens=Math.max(0,[1,2,3,4,5,6].reduce((a,loc)=>a+(parseFloat(p.printLocations?.[loc]?.screens)||0),0)-sharedScreensToSkip);
      const activeSizes=(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).length;
      const sg2={};const activeLocsDeduped=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];if(!ld?.location&&!ld?.screens) return false;if(ld.shared&&ld.shareGroup){const gk=ld.shareGroup.trim().toLowerCase();if(sg2[gk]) return false;sg2[gk]=true;}return true;}).length||0;
      const isScreensKey=(k)=>k==="Screens"||k.toLowerCase()==="screens";
      const isTagScreensKey=(k)=>k==="TagScreens"||k==="Tag Screens"||k.toLowerCase().replace(/\s/g,"")==="tagscreens";
      const getSpecCountCalc=(setupKey)=>{
        const skLower=setupKey.toLowerCase();
        const specOnKeys=Object.keys(p.specialtyQtys||{}).filter(sk=>sk.endsWith("_on")&&p.specialtyQtys[sk]);
        for(const sk of specOnKeys){
          const specName=sk.replace("_on","").toLowerCase();
          if(skLower.includes(specName)){const sc=p.specialtyQtys?.[sk.replace("_on","_count")]||0;return sc>0&&sc<activeLocsDeduped?sc:activeLocsDeduped;}
        }
        return null;
      };
      Object.keys(pr.setup||{}).forEach(k=>{
        if(isScreensKey(k)) setupTotal+=(pr.setup[k]||0)*autoScreens;
        else if(isTagScreensKey(k)&&!p.tagRepeat) setupTotal+=(pr.setup[k]||0)*(p.tagPrint?activeSizes:(p.setupFees?.tagSizes||0));
        else {
          const specCount=getSpecCountCalc(k);
          if(specCount!==null) setupTotal+=(pr.setup[k]||0)*specCount;
          else setupTotal+=(pr.setup[k]||0)*(p.setupFees?.[k]||0);
        }
      });
    }
    if(p.setupFees.manualCost>0) setupTotal+=p.setupFees.manualCost;
  }
  const customTotal=(p.customCosts||[]).reduce((a,c)=>{const v=c.perUnit||c.amount||0;return a+(c.flat?v:v*qty);},0);
  const perUnitPORate=printTotal+finUnitRate+specUnitRate;
  const poTotal=perUnitPORate*qty+setupTotal+customTotal;
  const shipping=inclShip&&p.garment_type!=="accessory"?qty*(p.isFleece?1.50:0.65):0;
  const totalCost=blankCost+poTotal+shipping;
  const marginPct=(parseFloat((margin||"30%").replace("%",""))/100)||0.30;
  const ccRate=inclCC?0.03:0;
  const divisor=1-marginPct-ccRate;
  const autoGrossRev=divisor>0?(totalCost/divisor):0;
  const grossRevFinal=p.sellOverride?p.sellOverride*qty:autoGrossRev;
  const sellPerUnitFinal=qty>0?grossRevFinal/qty:0;
  const ccFees=grossRevFinal*ccRate;
  const totalCostWithCC=totalCost+ccFees;
  const netProfit=grossRevFinal-totalCostWithCC;
  return{qty,blankCost,printTotal:printTotal*qty,finTotal:finUnitRate*qty,specTotal:specUnitRate,setupTotal,poTotal,shipping,ccFees,grossRev:grossRevFinal,totalCost:totalCostWithCC,netProfit,sellPerUnit:sellPerUnitFinal,margin_pct:grossRevFinal>0?netProfit/grossRevFinal:0,profitPerPiece:qty>0?netProfit/qty:0};
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

const CostingTab=({project,buyItems=[],contacts=[],onUpdateBuyItems,costProds,setCostProds,costMargin,setCostMargin,inclShip,setInclShip,inclCC,setInclCC,orderInfo,setOrderInfo,costingDirty,onSave,saveStatus,initialTab,hideSubTabs})=>{
  const [costTab,setCostTab]=useState(initialTab||"calc");
  const [showSendEmail,setShowSendEmail]=useState(false);
  const [collapsed,setCollapsed]=useState(()=>{ const c={}; (costProds||[]).forEach(p=>{ c[p.id]=true; }); return c; });
  const [localCosts,setLocalCosts]=useState({});
  const getCostDisplay=(pid,sz,val)=>{ const k=pid+"_"+sz; return localCosts[k]!==undefined?localCosts[k]:val>0?String(val):""; };
  const setCostLocal=(pid,sz,raw)=>setLocalCosts(p=>({...p,[pid+"_"+sz]:raw}));
  const commitCost=(i,p,sz)=>{
    const k=p.id+"_"+sz;
    if(localCosts[k]===undefined) return;
    const parsed=parseFloat(localCosts[k])||0;
    setLocalCosts(p2=>{const n={...p2};delete n[k];return n;});
    updateProd(i,{...p,blankCosts:{...(p.blankCosts||{}),[sz]:parsed}});
  };
  const toggleCollapse=(id)=>setCollapsed(p=>({...p,[id]:!p[id]}));

  // Note: buyItems sync is handled by CostingTabWrapper (updates both costProds + savedCostProds)

  const results=costProds.map(p=>calcCostProduct(p,costMargin,inclShip,inclCC,costProds)).filter(Boolean);
  const totGross=results.reduce((a,r)=>a+r.grossRev,0);
  const totProfit=results.reduce((a,r)=>a+r.netProfit,0);
  const netMarg=totGross>0?totProfit/totGross:0;
  const mc=netMarg>=0.30?T.green:netMarg>=0.20?T.amber:T.red;
  const today=new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});

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
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginTop:-20}}>
        <div style={{display:"flex",gap:4,background:T.surface,padding:4,borderRadius:8}}>
          {[["calc","Calculator"],["quote","Client Quote"]].map(([k,l])=>(
            <button key={k} onClick={()=>setCostTab(k)}
              style={{background:costTab===k?T.accent:"transparent",color:costTab===k?"#fff":T.muted,border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,fontFamily:font,fontWeight:600,cursor:"pointer"}}>
              {l}
            </button>
          ))}
        </div>
      </div>
      )}

      {results.length>0&&costTab!=="quote"&&(        <div style={{display:"flex",gap:20,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 16px",flexWrap:"wrap",alignItems:"center"}}>
          {[[fmtD(totGross),"Revenue",T.accent],[fmtD(totProfit),"Net Profit",mc],[fmtP(netMarg),"Net Margin",mc]].map(([v,l,c])=>(
            <div key={l}><div style={{fontSize:9,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div><div style={{fontSize:15,fontWeight:700,color:c,fontFamily:mono}}>{v}</div></div>
          ))}
          {(()=>{
            const totalQty=results.reduce((a,r)=>a+r.qty,0);
            const avgSell=totalQty>0?totGross/totalQty:0;
            return avgSell>0?(
              <div style={{display:"flex",alignItems:"center",gap:8,paddingLeft:16,borderLeft:`1px solid ${T.border}`}}>
                <div>
                  <div style={{fontSize:9,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em"}}>Avg $/unit</div>
                  <div style={{fontSize:15,fontWeight:700,color:T.green,fontFamily:mono}}>{fmtD(avgSell)}</div>
                </div>
              </div>
            ):null;
          })()}
          <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end"}}>
            <div style={{display:"flex",gap:2,background:T.surface,borderRadius:6,padding:2}}>
              {["10%","15%","20%","25%","30%"].map(m=>(
                <button key={m} onClick={()=>setCostMargin(m)}
                  style={{background:costMargin===m?T.amber:"transparent",color:costMargin===m?"#fff":T.muted,border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontFamily:mono,cursor:"pointer"}}>{m}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <CToggle label="Shipping" value={inclShip} onChange={setInclShip}/>
              <CToggle label="CC Fees" value={inclCC} onChange={setInclCC}/>
            </div>
          </div>
        </div>
      )}

      {costTab==="calc"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div>
            {costProds.map((p,i)=>{
              const r=calcCostProduct(p,costMargin,inclShip,inclCC,costProds);
              const mc2=r?(r.margin_pct>=0.30?T.green:r.margin_pct>=0.20?T.amber:T.red):T.faint;

              // ── Accessory slim card ──
              if (p.garment_type === "accessory") {
                return (
                  <div key={p.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:10,overflow:"hidden",width:"50%"}}>
                    <div onClick={()=>toggleCollapse(p.id)} style={{padding:"14px 16px",borderBottom:collapsed[p.id]?"none":`1px solid ${T.border}`,cursor:"pointer",userSelect:"none"}}>
                      {/* Row 1: Letter + Name + Accessory badge + Chevron */}
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                        <span style={{width:24,height:24,borderRadius:5,background:T.purpleDim||"#2d1f5e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.purple,fontFamily:mono,flexShrink:0}}>{String.fromCharCode(64+i+1)}</span>
                        <div style={{flex:1}}>
                          <span style={{color:T.text,fontFamily:font,fontSize:13,fontWeight:600}}>{p.name||"Accessory"}</span>
                          <span style={{fontSize:10,color:T.purple,marginLeft:8,fontWeight:600}}>Accessory</span>
                        </div>
                        <span style={{fontSize:11,color:collapsed[p.id]?T.faint:T.accent,display:"inline-block",transform:collapsed[p.id]?"rotate(0deg)":"rotate(180deg)",transition:"transform 0.15s"}}>v</span>
                      </div>
                      {/* Row 2: Vendor + Qty + Sell */}
                      <div style={{display:"flex",alignItems:"center",gap:10,paddingLeft:34}}>
                        <div style={{marginRight:12}} onClick={e=>e.stopPropagation()}>
                          <div style={{fontSize:9,color:T.faint,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Vendor</div>
                          <select value={p.printVendor||""} onChange={e=>updateProd(i,{...p,printVendor:e.target.value})}
                            style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:p.printVendor?T.text:T.muted,fontFamily:font,fontSize:11,padding:"3px 8px",outline:"none",cursor:"pointer"}}>
                            <option value="">— select —</option>
                            {Object.keys(PRINTERS).map(k=><option key={k} value={k}>{k}</option>)}
                          </select>
                        </div>
                        <div style={{textAlign:"right",marginRight:16}}>
                          <div style={{fontSize:9,color:T.faint,textTransform:"uppercase",letterSpacing:"0.06em"}}>Qty</div>
                          <div style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:mono}}>{(p.totalQty||0).toLocaleString()}</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:0,flexDirection:"row-reverse"}} onClick={e=>e.stopPropagation()}>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:9,color:T.faint,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Sell $/unit</div>
                          {p._sellOverride?(
                            <div style={{display:"flex",alignItems:"center",gap:4,flexDirection:"row-reverse"}}>
                              <div style={{background:T.surface,border:"1px solid "+T.amber,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:2}}>
                                <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                                <input type="number" step="0.01" value={p._sellOverrideVal??r?.sellPerUnit?.toFixed(2)??""} autoFocus
                                  onChange={e=>updateProd(i,{...p,_sellOverrideVal:e.target.value})}
                                  style={{width:50,background:"transparent",border:"none",outline:"none",color:T.amber,fontSize:12,fontWeight:700,fontFamily:mono,textAlign:"left"}}/>
                              </div>
                              <div style={{display:"flex",gap:4,marginRight:6}}>
                                <button onClick={()=>updateProd(i,{...p,sellOverride:parseFloat(p._sellOverrideVal)||null,_sellOverride:false})}
                                  style={{background:T.green,border:"none",borderRadius:5,color:"#fff",cursor:"pointer",padding:"3px 8px",fontSize:10,fontFamily:font,fontWeight:700}}>✓</button>
                                <button onClick={()=>updateProd(i,{...p,_sellOverride:false,sellOverride:null,_sellOverrideVal:null})}
                                  style={{background:"none",border:"1px solid "+T.border,borderRadius:5,color:T.muted,cursor:"pointer",padding:"3px 6px",fontSize:10}}>✕</button>
                              </div>
                            </div>
                          ):(
                            <div style={{display:"flex",alignItems:"center",gap:6,flexDirection:"row-reverse"}}>
                              <div style={{background:T.surface,border:"1px solid "+(p.sellOverride?T.amber:T.border),borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:2}}>
                                <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                                <span style={{fontSize:12,fontWeight:700,color:p.sellOverride?T.amber:r?.sellPerUnit>0?T.green:T.faint,fontFamily:mono}}>{p.sellOverride?p.sellOverride.toFixed(2):r?.sellPerUnit>0?r.sellPerUnit.toFixed(2):"—"}</span>
                              </div>
                              <div style={{display:"flex",gap:4,marginRight:6}}>
                                <button onClick={()=>updateProd(i,{...p,_sellOverride:true,_sellOverrideVal:p.sellOverride??r?.sellPerUnit?.toFixed(2)??""})}
                                  style={{fontSize:9,color:T.amber,fontFamily:font,background:"none",border:"1px solid "+T.amber+"44",borderRadius:4,cursor:"pointer",padding:"2px 7px"}}>override</button>
                                {p.sellOverride&&<button onClick={()=>updateProd(i,{...p,sellOverride:null})}
                                  style={{fontSize:9,color:T.faint,fontFamily:font,background:"none",border:"1px solid "+T.border,borderRadius:4,cursor:"pointer",padding:"2px 7px"}}>auto</button>}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      </div>
                    </div>
                    {!collapsed[p.id] && <div style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`}}>
                      {/* Custom costs */}
                      <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Costs</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                        <span style={{fontSize:11,color:T.faint}}>{(p.customCosts||[]).length}/6 line items</span>
                        {(p.customCosts||[]).length < 6 && <button onClick={()=>updateProd(i,{...p,customCosts:[...(p.customCosts||[]),{desc:"",perUnit:0,flat:false}]})}
                          style={{fontSize:11,color:T.accent,fontFamily:font,background:"none",border:`1px solid ${T.accent}44`,borderRadius:5,cursor:"pointer",padding:"2px 10px"}}>+ Add</button>}
                      </div>
                      {(p.customCosts||[]).length>0&&(
                        <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden",marginBottom:10}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <thead><tr style={{background:T.surface}}>
                              <th style={{padding:"4px 8px",textAlign:"left",fontSize:10,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`,width:"40%"}}>Description</th>
                              <th style={{padding:"4px 8px",textAlign:"center",fontSize:10,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`,width:"15%"}}>Cost</th>
                              <th style={{padding:"4px 8px",textAlign:"center",fontSize:10,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`,width:"15%"}}>Type</th>
                              <th style={{padding:"4px 8px",textAlign:"center",fontSize:10,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`,width:"18%"}}>Total</th>
                              <th style={{width:"12%"}}/>
                            </tr></thead>
                            <tbody>
                              {(p.customCosts||[]).map((cc,ci)=>{
                                const isFlat=!!cc.flat;
                                const costVal=cc.perUnit||cc.amount||0;
                                const total=isFlat?costVal:costVal*(p.totalQty||0);
                                return(
                                  <tr key={ci} style={{borderBottom:ci<p.customCosts.length-1?`1px solid ${T.border}`:"none",background:ci%2===0?T.card:T.surface}}>
                                    <td style={{padding:"5px 8px",borderRight:`1px solid ${T.border}`}}>
                                      <input value={cc.desc||""} onChange={e=>{const c=[...p.customCosts];c[ci]={...c[ci],desc:e.target.value};updateProd(i,{...p,customCosts:c});}}
                                        style={{width:"100%",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:font}}/>
                                    </td>
                                    <td style={{padding:"5px 8px",borderRight:`1px solid ${T.border}`,textAlign:"center"}}>
                                      <div style={{display:"flex",alignItems:"center",gap:2,justifyContent:"center"}}>
                                        <span style={{fontSize:11,color:T.faint,fontFamily:mono}}>$</span>
                                        <input type="text" inputMode="decimal" value={cc.perUnit||cc.amount||""} placeholder="0.00"
                                          onChange={e=>{const raw=e.target.value;if(raw===""||/^[0-9]*\.?[0-9]*$/.test(raw)){const c=[...p.customCosts];c[ci]={...c[ci],perUnit:raw===""?0:raw.endsWith(".")?raw:parseFloat(raw)||0};updateProd(i,{...p,customCosts:c});}}}
                                          onBlur={e=>{const c=[...p.customCosts];c[ci]={...c[ci],perUnit:parseFloat(e.target.value)||0};updateProd(i,{...p,customCosts:c});}}
                                          onFocus={e=>e.target.select()}
                                          style={{width:60,background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:mono,textAlign:"center"}}/>
                                      </div>
                                    </td>
                                    <td style={{padding:"3px 4px",borderRight:`1px solid ${T.border}`,textAlign:"center"}}>
                                      <button onClick={()=>{const c=[...p.customCosts];c[ci]={...c[ci],flat:!isFlat};updateProd(i,{...p,customCosts:c});}}
                                        style={{padding:"2px 10px",fontSize:9,fontFamily:font,fontWeight:600,border:`1px solid ${T.border}`,borderRadius:99,cursor:"pointer",background:isFlat?T.amberDim:T.surface,color:isFlat?T.amber:T.muted}}>{isFlat?"flat":"/ unit"}</button>
                                    </td>
                                    <td style={{padding:"5px 8px",borderRight:`1px solid ${T.border}`,textAlign:"center",fontFamily:mono,fontSize:12,fontWeight:total>0?700:400,color:total>0?T.green:T.faint}}>
                                      {total>0?fmtD(total):"—"}
                                    </td>
                                    <td style={{padding:"5px 8px",textAlign:"center"}}>
                                      <button onClick={()=>{const c=p.customCosts.filter((_,j)=>j!==ci);updateProd(i,{...p,customCosts:c});}}
                                        style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:12}}
                                        onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {/* Item summary */}
                      {r&&(
                        <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <tbody>
                              {[
                                ["Revenue",        fmtD(r.grossRev),        T.accent],
                                ["Total Cost",     fmtD(r.totalCost),       T.text],
                                ["Net Profit",     fmtD(r.netProfit),       mc2],
                                ["Margin",         fmtP(r.margin_pct),      mc2],
                                ["Profit / Piece", fmtD(r.profitPerPiece),  mc2],
                              ].map(([l,v,c],idx)=>(
                                <tr key={l} style={{borderBottom:idx<4?`1px solid ${T.border}22`:"none",background:idx>=2?(mc2===T.green?T.greenDim:mc2===T.amber?T.amberDim:T.redDim):T.surface}}>
                                  <td style={{padding:"6px 12px",fontSize:11,fontWeight:500,color:T.muted,fontFamily:font,width:"50%"}}>{l}</td>
                                  <td style={{padding:"6px 12px",fontSize:13,fontWeight:700,color:c,fontFamily:mono,textAlign:"right"}}>{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>}
                  </div>
                );
              }

              // ── Apparel full card ──
              const isCollapsed=!!collapsed[p.id];
              const headerBB=isCollapsed?"none":"1px solid "+T.border;
              const bodyDisplay=isCollapsed?"none":"grid";
              const chevron=isCollapsed?"v":"^";
              return(
                <div key={p.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:10,overflow:"hidden",maxWidth:828}}>
                  <div onClick={()=>toggleCollapse(p.id)} style={{padding:"12px 16px",borderBottom:headerBB,display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}>
                    <span style={{width:24,height:24,borderRadius:5,background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.accent,fontFamily:mono,flexShrink:0}}>{String.fromCharCode(64+i+1)}</span>
                    <div style={{flex:1,display:"flex",alignItems:"baseline",gap:8}}>
                      <span style={{color:T.text,fontFamily:font,fontSize:13,fontWeight:600}}>{p.name||("Product "+(i+1))}</span>
                      {(p.style||p.color)&&<span style={{fontSize:11,color:T.muted,fontFamily:font}}>{p.style}{p.color?` · ${p.color}`:""}</span>}
                    </div>
                    <div style={{display:"flex",gap:0,alignItems:"center"}}>
                      <div style={{textAlign:"right",width:70,flexShrink:0,marginRight:16}}>
                        <div style={{fontSize:9,color:"#5a6285",fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em"}}>Qty</div>
                        <div style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:mono}}>{(p.totalQty||0).toLocaleString()}</div>
                      </div>
                      <div style={{width:1,height:28,background:T.border,marginRight:12,flexShrink:0}}/>
                      <div style={{display:"flex",alignItems:"center",gap:0,flexDirection:"row-reverse"}} onClick={e=>e.stopPropagation()}>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:9,color:"#5a6285",fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Sell $/unit</div>
                          {p._sellOverride?(
                            <div style={{display:"flex",alignItems:"center",gap:4,flexDirection:"row-reverse"}}>
                              <div style={{background:T.surface,border:"1px solid "+T.amber,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:2}}>
                                <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                                <input type="number" step="0.01" value={p._sellOverrideVal??r?.sellPerUnit?.toFixed(2)??""} autoFocus
                                  onChange={e=>updateProd(i,{...p,_sellOverrideVal:e.target.value})}
                                  style={{width:50,background:"transparent",border:"none",outline:"none",color:T.amber,fontSize:12,fontWeight:700,fontFamily:mono,textAlign:"left"}}/>
                              </div>
                              <div style={{display:"flex",gap:4,marginRight:6}}>
                                <button onClick={()=>updateProd(i,{...p,sellOverride:parseFloat(p._sellOverrideVal)||null,_sellOverride:false})}
                                  style={{background:T.green,border:"none",borderRadius:5,color:"#fff",cursor:"pointer",padding:"3px 8px",fontSize:10,fontFamily:font,fontWeight:700}}>✓</button>
                                <button onClick={()=>updateProd(i,{...p,_sellOverride:false,sellOverride:null,_sellOverrideVal:null})}
                                  style={{background:"none",border:"1px solid "+T.border,borderRadius:5,color:T.muted,cursor:"pointer",padding:"3px 6px",fontSize:10}}>✕</button>
                              </div>
                            </div>
                          ):(
                            <div style={{display:"flex",alignItems:"center",gap:6,flexDirection:"row-reverse"}}>
                              <div style={{background:T.surface,border:"1px solid "+(p.sellOverride?T.amber:T.border),borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:2}}>
                                <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>$</span>
                                <span style={{fontSize:12,fontWeight:700,color:p.sellOverride?T.amber:r?.sellPerUnit>0?T.green:T.faint,fontFamily:mono}}>{p.sellOverride?p.sellOverride.toFixed(2):r?.sellPerUnit>0?r.sellPerUnit.toFixed(2):"—"}</span>
                              </div>
                              <div style={{display:"flex",gap:4,marginRight:6}}>
                                <button onClick={()=>updateProd(i,{...p,_sellOverride:true,_sellOverrideVal:p.sellOverride??r?.sellPerUnit?.toFixed(2)??""})}
                                  style={{fontSize:9,color:T.amber,fontFamily:font,background:"none",border:"1px solid "+T.amber+"44",borderRadius:4,cursor:"pointer",padding:"2px 7px"}}>override</button>
                                {p.sellOverride&&<button onClick={()=>updateProd(i,{...p,sellOverride:null})}
                                  style={{fontSize:9,color:T.faint,fontFamily:font,background:"none",border:"1px solid "+T.border,borderRadius:4,cursor:"pointer",padding:"2px 7px"}}>auto</button>}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <span style={{fontSize:11,color:T.muted,marginLeft:8,flexShrink:0}}>{chevron}</span>
                  </div>
                  <div style={{padding:14,display:bodyDisplay,gridTemplateColumns:"400px 400px",gap:0,alignItems:"start",width:"fit-content"}}>
                    {/* BLANKS PANEL */}
                    <div style={{display:"flex",flexDirection:"column",gap:12,paddingRight:16,borderRight:"1px solid "+T.border,flexShrink:0}}>
                      {/* BLANKS HEADER */}
                      <div style={{fontSize:10,fontWeight:700,color:T.accent,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.1em",paddingBottom:6,borderBottom:`1px solid ${T.border}`}}>Blanks</div>

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
                            </div>
                          ):(
                            <select value={p.supplier||""} onChange={e=>e.target.value==="New"?updateProd(i,{...p,supplier:"New",_newSupplier:true,_newSupplierVal:""}):updateProd(i,{...p,supplier:e.target.value})}
                              style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:p.supplier?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",width:"100%",cursor:"pointer"}}>
                              <option value="">— select supplier —</option>
                              {["S&S","AS Colour","Sanmar","LA Apparel","Otto"].map(s=><option key={s}>{s}</option>)}
                              <option value="New">＋ New supplier…</option>
                            </select>
                          )}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                          <span style={{fontSize:10,color:T.muted,fontFamily:font}}>Fleece</span>
                          <div style={{display:"flex",borderRadius:5,overflow:"hidden",border:`1px solid ${T.border}`}}>
                            {["Yes","No"].map(opt=>{
                              const sel=(p.isFleece?"Yes":"No")===opt;
                              return(
                                <button key={opt} onClick={()=>updateProd(i,{...p,isFleece:opt==="Yes"})}
                                  style={{padding:"4px 10px",fontSize:11,fontFamily:font,fontWeight:600,border:"none",cursor:"pointer",background:sel?(opt==="Yes"?T.accent:T.surface):T.card,color:sel?(opt==="Yes"?"#fff":T.text):T.faint,transition:"all 0.12s"}}>
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      </div>
                      {/* Collapsible size grid */}
                      <div onClick={()=>updateProd(i,{...p,_blankOpen:!p._blankOpen})} style={{cursor:"pointer",padding:"12px 8px",borderRadius:6,background:p._blankOpen?T.accentDim:T.surface,border:"1px solid "+(p._blankOpen?T.accent+"44":T.border),marginBottom:p._blankOpen?8:0,transition:"all 0.15s"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:!p._blankOpen&&(p.sizes||[]).some(sz=>(p.qtys?.[sz]||0)>0)?6:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:10,fontWeight:700,color:p._blankOpen?T.accent:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Size breakdown</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            {!p._blankOpen&&(()=>{const total=(p.sizes||[]).reduce((a,sz)=>{const q=p.qtys?.[sz]||0;const c=p.blankCosts?.[sz]||0;return a+q*c;},0);return total>0?<span style={{fontSize:12,fontWeight:600,color:T.text,fontFamily:mono}}>${total.toFixed(2)}</span>:null;})()}
                            <span style={{fontSize:11,color:p._blankOpen?T.accent:T.faint,display:"inline-block",transform:p._blankOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.15s"}}>v</span>
                          </div>
                        </div>
                        {!p._blankOpen&&(p.sizes||[]).some(sz=>(p.qtys?.[sz]||0)>0)&&(
                          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                            {(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).map(sz=><span key={sz} style={{fontSize:11,color:T.text,fontFamily:mono}}>{sz}: {p.qtys[sz]}</span>)}
                          </div>
                        )}
                      </div>
                      {p._blankOpen&&<div style={{borderRadius:8,border:"1px solid "+T.border,overflow:"hidden"}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <thead>
                              <tr style={{background:T.surface}}>
                                <th style={{padding:"4px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"20%"}}>Size</th>
                                <th style={{padding:"6px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"20%"}}>Qty</th>
                                <th style={{padding:"6px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"25%"}}>Cost</th>
                                <th style={{padding:"6px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",width:"35%"}}>Subtotal</th>
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
                                    <td style={{padding:"3px 12px",fontFamily:mono,fontSize:12,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`}}>{sz}</td>
                                    <td style={{padding:"3px 8px",textAlign:"left",borderRight:`1px solid ${T.border}`}}>
                                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={qty||""} placeholder="0"
                                        onChange={e=>{const q=parseInt(e.target.value)||0;const newQtys={...(p.qtys||{}),[sz]:q};const newTotal=Object.values(newQtys).reduce((a,v)=>a+v,0);updateProd(i,{...p,qtys:newQtys,totalQty:newTotal});if(onUpdateBuyItems){onUpdateBuyItems(prev=>prev.map(bi=>bi.id===p.id?{...bi,qtys:newQtys,totalQty:newTotal}:bi));}}}
                                        data-costfield onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab")focusNext(e,e.shiftKey);if(e.key==="ArrowDown"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:false},false);}if(e.key==="ArrowUp"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:true},true);}}}
                                        style={{width:60,textAlign:"left",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:mono}}/>
                                    </td>
                                    <td style={{padding:"3px 8px",textAlign:"left",borderRight:`1px solid ${T.border}`}}>
                                      <div style={{display:"flex",alignItems:"center",justifyContent:"flex-start",gap:2}}>
                                        <span style={{fontSize:11,color:T.faint,fontFamily:mono}}>$</span>
                                        <input type="text" inputMode="decimal" value={getCostDisplay(p.id,sz,bc)} placeholder="0.00"
                                          onChange={e=>{ const raw=e.target.value; if(/^\d*\.?\d*$/.test(raw)) setCostLocal(p.id,sz,raw); }}
                                          onBlur={()=>commitCost(i,p,sz)}
                                          data-costfield onKeyDown={e=>{if(e.key==="Enter"){commitCost(i,p,sz);focusNext(e,false);}if(e.key==="Tab"){commitCost(i,p,sz);focusNext(e,e.shiftKey);}if(e.key==="ArrowDown"){e.preventDefault();commitCost(i,p,sz);focusNext({...e,key:"Tab",shiftKey:false},false);}if(e.key==="ArrowUp"){e.preventDefault();commitCost(i,p,sz);focusNext({...e,key:"Tab",shiftKey:true},true);}}}
                                          style={{width:60,textAlign:"left",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:mono}}/>
                                      </div>
                                    </td>
                                    <td style={{padding:"3px 12px",textAlign:"left",fontFamily:mono,fontSize:12,fontWeight:subtotal>0?600:400,color:subtotal>0?T.text:T.faint}}>{subtotal>0?fmtD(subtotal):"—"}</td>
                                  </tr>
                                );
                              })}
                              {p.sizes&&p.sizes.length>1&&(
                                <tr style={{background:T.surface,borderTop:`1px solid ${T.border}`}}>
                                  <td style={{padding:"6px 12px",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`}}>Total</td>
                                  <td style={{padding:"6px 12px",textAlign:"left",fontFamily:mono,fontWeight:700,color:T.text,borderRight:`1px solid ${T.border}`}}>{p.totalQty||0}</td>
                                  <td style={{borderRight:`1px solid ${T.border}`}}/>
                                  <td style={{padding:"6px 12px",textAlign:"left",fontFamily:mono,fontWeight:700,color:T.accent}}>{fmtD(Object.entries(p.blankCosts||{}).reduce((a,[sz,bc])=>a+bc*(p.qtys?.[sz]||0)*1.035,0))}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                      </div>}
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Item notes</div>
                        <textarea value={p.itemNotes||""} onChange={e=>updateProd(i,{...p,itemNotes:e.target.value})}                          style={{width:"100%",background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"7px 10px",resize:"vertical",outline:"none",minHeight:72,boxSizing:"border-box"}}/>
                      </div>
                      {r&&(
                        <div style={{borderRadius:8,border:"1px solid "+T.border,overflow:"hidden",marginTop:4}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <tbody>
                              {[
                                ["Revenue",        fmtD(r.grossRev),        T.accent],
                                ["Blanks Cost",    fmtD(r.blankCost),       T.text],
                                ["PO Total",       fmtD(r.poTotal),         T.text],
                                ["Shipping",       fmtD(r.shipping),        T.text],
                                ["Net Profit",     fmtD(r.netProfit),       mc2],
                                ["Margin",         fmtP(r.margin_pct),      mc2],
                                ["Profit / Piece", fmtD(r.profitPerPiece),  mc2],
                              ].map(([l,v,c],idx)=>(
                                <tr key={l} style={{borderBottom:idx<5?`1px solid ${T.border}22`:"none",background:idx>=3?(mc2===T.green?T.greenDim:mc2===T.amber?T.amberDim:T.redDim):T.surface}}>
                                  <td style={{padding:"6px 12px",fontSize:11,fontWeight:500,color:T.muted,fontFamily:font,width:"50%"}}>{l}</td>
                                  <td style={{padding:"6px 12px",fontSize:13,fontWeight:700,color:c,fontFamily:mono,textAlign:"right"}}>{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>{/* end blanks panel */}
                    {/* DECORATION PANEL */}
                    <DecorationPanel p={p} i={i} costProds={costProds} PRINTERS={PRINTERS} updateProd={updateProd} setCostProds={setCostProds} lookupPrintPrice={lookupPrintPrice} lookupTagPrice={lookupTagPrice} />
                    {false && <div style={{display:"flex",flexDirection:"column",gap:12,paddingLeft:16}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingBottom:6,borderBottom:"1px solid "+T.border}}>
                        <div style={{fontSize:10,fontWeight:700,color:T.amber,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.1em"}}>Decoration</div>
                        {i>0&&costProds[i-1]&&<button onClick={()=>{const prev=costProds[i-1];updateProd(i,{...p,printVendor:prev.printVendor,printLocations:JSON.parse(JSON.stringify(prev.printLocations||{})),printCount:prev.printCount||4,tagPrint:prev.tagPrint,tagRepeat:prev.tagRepeat,tagShared:prev.tagShared,tagShareGroup:prev.tagShareGroup,setupFees:{...prev.setupFees}});}}
                          style={{fontSize:10,color:T.accent,fontFamily:font,background:T.accentDim,border:"1px solid "+T.accent+"44",borderRadius:5,cursor:"pointer",padding:"2px 10px",fontWeight:600}}>⎘ Copy from previous</button>}
                      </div>
                      {/* Print Locations */}
                      <div>
                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Vendor</div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <select value={p.printVendor||""} onChange={e=>{
                              const v=e.target.value;
                              const updated={};
                              [1,2,3,4,5,6].forEach(loc=>{
                                const ld=p.printLocations?.[loc]||{};
                                if(ld.location||ld.screens) updated[loc]={...ld,printer:v};
                                else updated[loc]={...ld};
                              });
                              updateProd(i,{...p,printVendor:v,printLocations:updated});
                            }}
                              style={{flex:1,background:T.surface,border:"1px solid "+(p.printVendor?T.accent+"66":T.border),borderRadius:6,color:p.printVendor?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer"}}>
                              <option value="">— select vendor —</option>
                              {Object.keys(PRINTERS).map(pr=><option key={pr} value={pr}>{pr}</option>)}
                            </select>
                            <button onClick={()=>setCostProds(prev=>prev.map((cp,ci)=>ci>i?{...cp,printVendor:p.printVendor,printLocations:Object.fromEntries(Object.entries(cp.printLocations||{}).map(([k,v])=>([k,{...v,printer:p.printVendor}])))}:cp))}
                              style={{fontSize:10,color:T.amber,fontFamily:font,background:T.accentDim,border:"1px solid "+T.amber+"44",borderRadius:5,cursor:"pointer",padding:"6px 12px",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>↓ All</button>
                          </div>
                        </div>
                        {p.printVendor&&PRINTERS[p.printVendor]?.capabilities?.length>0&&(
                          <div style={{marginBottom:10}}>
                            <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Decoration Type</div>
                            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                              {PRINTERS[p.printVendor].capabilities.map(cap=>{
                                const sel=(p.decorationType||"")===cap;
                                return <button key={cap} onClick={()=>updateProd(i,{...p,decorationType:cap})}
                                  style={{padding:"3px 12px",borderRadius:99,fontSize:11,fontWeight:600,cursor:"pointer",
                                    border:`1px solid ${sel?T.accent:T.border}`,
                                    background:sel?T.accent:"transparent",
                                    color:sel?"#fff":T.muted}}>
                                  {cap}
                                </button>;
                              })}
                            </div>
                          </div>
                        )}
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Print Locations</div>
                        <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <thead>
                              <tr style={{background:T.surface}}>
                                <th style={{padding:"6px 10px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"15%"}}/>
                                <th style={{padding:"6px 10px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"40%"}}>Location</th>
                                <th style={{padding:"6px 10px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"15%"}}>Screens</th>
                                <th style={{padding:"6px 10px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"15%"}}>Share</th>
                                <th style={{padding:"6px 10px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",width:"15%"}}>Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from({length:p.printCount||4},(_,idx)=>idx+1).map((loc,idx)=>{
                                const ld=p.printLocations?.[loc]||{};
                                const effectivePrinter=ld.printer||p.printVendor||"";
                                const active=effectivePrinter&&ld.screens>0;
                                const isShared=!!(ld.shared);
                                const shareGroup=ld.shareGroup||"";
                                const sharedQty=isShared&&shareGroup?costProds.reduce((sum,cp)=>{
                                  const match=Object.values(cp.printLocations||{}).find(l=>l.shared&&l.shareGroup&&l.shareGroup.trim().toLowerCase()===shareGroup.trim().toLowerCase()&&l.screens>0);
                                  return sum+(match?cp.totalQty||0:0);
                                },0):0;
                                // Screen fees: only count on first item in the share group
                                const isFirstInGroup=isShared&&shareGroup?costProds.findIndex(cp=>Object.values(cp.printLocations||{}).some(l=>l.shared&&l.shareGroup&&l.shareGroup.trim().toLowerCase()===shareGroup.trim().toLowerCase()&&l.screens>0))===i:true;
                                const effectiveQty=isShared&&sharedQty>0?sharedQty:(p.totalQty||0);
                                const unitCost=active?lookupPrintPrice(effectivePrinter,effectiveQty||p.totalQty||0,ld.screens):0;
                                const isLast=idx===(p.printCount||4)-1;
                                return(
                                  <tr key={loc} style={{borderBottom:isLast?"none":`1px solid ${T.border}`,background:active?T.accentDim:T.card}}>
                                    <td style={{padding:"5px 10px",borderRight:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>
                                      <span style={{fontSize:11,fontWeight:700,color:active?T.accent:T.faint,fontFamily:font}}>Print {loc}</span>
                                    </td>
                                    <td style={{padding:"4px 6px",borderRight:`1px solid ${T.border}`,position:"relative"}}>
                                      <input value={ld.location||""} onChange={e=>updateProd(i,{...p,printLocations:{...(p.printLocations||{}),[loc]:{...ld,location:e.target.value,printer:ld.printer||p.printVendor||""}}})}
                                                                               list={`loc-opts-${i}-${loc}`}
                                        data-costfield
                                        onFocus={e=>e.target.select()}
                                        onKeyDown={e=>{
                                          if(e.key==="Enter"||e.key==="Tab"){focusNext(e,e.shiftKey);}
                                          if(e.key==="ArrowDown"&&!e.target.list){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:false},false);}
                                          if(e.key==="ArrowUp"&&!e.target.list){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:true},true);}
                                        }}
                                        style={{width:"100%",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:font,padding:"2px 4px"}}/>
                                      <datalist id={`loc-opts-${i}-${loc}`}>
                                        {LOCATION_PRESETS.map(l=><option key={l} value={l}/>)}
                                      </datalist>
                                    </td>
                                    <td style={{padding:"4px 6px",borderRight:`1px solid ${T.border}`,textAlign:"center",cursor:"text"}} onClick={e=>{const input=e.currentTarget.querySelector("input");if(input){input.focus();input.select();}}}>
                                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={ld.screens||""} placeholder="0"
                                        onChange={e=>updateProd(i,{...p,printLocations:{...(p.printLocations||{}),[loc]:{...ld,screens:parseFloat(e.target.value)||0,printer:ld.printer||p.printVendor||""}}})}
                                        onFocus={e=>e.target.select()}
                                        data-costfield onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab")focusNext(e,e.shiftKey);if(e.key==="ArrowDown"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:false},false);}if(e.key==="ArrowUp"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:true},true);}}}
                                        style={{width:"100%",textAlign:"center",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:mono}}/>
                                    </td>
                                    <td style={{padding:"4px 6px",borderRight:`1px solid ${T.border}`,textAlign:"center"}}>
                                      {isShared?(
                                        <div style={{display:"flex",alignItems:"center",gap:2,justifyContent:"center"}}>
                                          <div style={{display:"inline-flex",borderRadius:4,overflow:"hidden"}}>
                                            {["A","B","C","D"].map((g,gi)=>{
                                              const sel=shareGroup===g;
                                              return <button key={g} onClick={()=>updateProd(i,{...p,printLocations:{...(p.printLocations||{}),[loc]:{...ld,shareGroup:g}}})}
                                                style={{padding:"2px 6px",fontSize:10,fontFamily:mono,fontWeight:700,border:`1px solid ${sel?T.accent:T.text}`,marginLeft:gi>0?-1:0,cursor:"pointer",background:sel?T.accent:"transparent",color:sel?"#fff":T.text,borderRadius:gi===0?"4px 0 0 4px":gi===3?"0 4px 4px 0":"0",position:"relative",zIndex:sel?1:0}}>{g}</button>;
                                            })}
                                          </div>
                                          <button onClick={()=>updateProd(i,{...p,printLocations:{...(p.printLocations||{}),[loc]:{...ld,shared:false,shareGroup:""}}})}
                                            style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:9,marginLeft:2}}
                                            onMouseEnter={e=>e.currentTarget.style.color=T.red}
                                            onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                                        </div>
                                      ):(
                                        <button onClick={()=>updateProd(i,{...p,printLocations:{...(p.printLocations||{}),[loc]:{...ld,shared:true,shareGroup:""}}})}
                                          style={{fontSize:9,color:T.text,fontFamily:font,background:"none",border:`1px solid ${T.text}`,borderRadius:3,padding:"2px 6px",cursor:"pointer",opacity:0.7}}
                                          onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.color=T.accent;e.currentTarget.style.borderColor=T.accent;}}
                                          onMouseLeave={e=>{e.currentTarget.style.opacity="0.7";e.currentTarget.style.color=T.text;e.currentTarget.style.borderColor=T.text;}}>Share</button>
                                      )}
                                    </td>
                                    <td style={{padding:"5px 10px",textAlign:"center",fontFamily:mono,fontSize:12,fontWeight:active?700:400,color:active?T.green:T.faint}}>
                                      {active?fmtD(unitCost):null}
                                    </td>
                                  </tr>
                                );
                              })}
                              {/* Tag Print row */}
                              <tr style={{background:p.tagPrint?T.accentDim:T.card,verticalAlign:"middle",borderTop:`2px solid ${T.border}`}}>
                                <td style={{padding:"8px 10px",borderRight:`1px solid ${T.border}`,width:"15%"}}>
                                  <span style={{fontSize:11,fontWeight:700,color:p.tagPrint?T.accent:T.faint,fontFamily:font}}>Tag</span>
                                </td>
                                <td style={{padding:"6px 6px",borderRight:`1px solid ${T.border}`,width:"40%"}}>
                                  {(()=>{
                                    const opts=["No","Yes","Repeat"];
                                    return <div style={{display:"inline-flex",borderRadius:6,overflow:"hidden"}}>
                                      {opts.map((opt,oi)=>{
                                        const active=opt==="No"?!p.tagPrint:opt==="Yes"?(p.tagPrint&&!p.tagRepeat):(p.tagPrint&&p.tagRepeat);
                                        const bg=active?(opt==="Repeat"?T.amber:opt==="Yes"?T.accent:T.surface):T.card;
                                        const fg=active?(opt==="No"?T.text:"#fff"):T.faint;
                                        const borderColor=p.tagPrint?(p.tagRepeat?T.amber:T.accent):T.border;
                                        return(
                                          <button key={opt} onClick={()=>{
                                            const sizeCount=(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).length;
                                            if(opt==="No") updateProd(i,{...p,tagPrint:false,tagRepeat:false,setupFees:{...(p.setupFees||{}),tagSizes:0}});
                                            else if(opt==="Yes") updateProd(i,{...p,tagPrint:true,tagRepeat:false,setupFees:{...(p.setupFees||{}),tagSizes:sizeCount}});
                                            else updateProd(i,{...p,tagPrint:true,tagRepeat:true,setupFees:{...(p.setupFees||{}),tagSizes:sizeCount}});
                                          }}
                                            style={{padding:"5px 14px",fontSize:12,fontFamily:font,fontWeight:600,border:`1px solid ${borderColor}`,borderRight:oi<opts.length-1?`1px solid ${borderColor}`:`1px solid ${borderColor}`,marginLeft:oi>0?-1:0,cursor:"pointer",background:bg,color:fg,transition:"all 0.12s",borderRadius:oi===0?"6px 0 0 6px":oi===opts.length-1?"0 6px 6px 0":"0",position:"relative",zIndex:active?1:0}}>
                                            {opt}
                                          </button>
                                        );
                                      })}
                                    </div>;
                                  })()}
                                </td>
                                <td style={{padding:"6px 6px",borderRight:`1px solid ${T.border}`,textAlign:"center",width:"15%"}}>
                                  {p.tagPrint&&(
                                    <span style={{fontSize:13,fontWeight:700,color:p.tagRepeat?T.amber:T.text,fontFamily:mono}}>
                                      {p.tagRepeat?0:(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).length}
                                    </span>
                                  )}
                                </td>
                                <td style={{padding:"6px 6px",borderRight:`1px solid ${T.border}`,textAlign:"center",width:"15%"}}>
                                  {p.tagPrint&&(
                                    p.tagShared?(
                                      <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
                                        <input value={p.tagShareGroup||""} onChange={e=>updateProd(i,{...p,tagShareGroup:e.target.value.toUpperCase()})}
                                                                                   style={{width:32,textAlign:"center",background:T.surface,border:`1px solid ${T.accent}`,borderRadius:3,color:T.accent,fontFamily:mono,fontSize:10,fontWeight:700,padding:"2px",outline:"none"}}/>
                                        <button onClick={()=>updateProd(i,{...p,tagShared:false,tagShareGroup:""})}
                                          style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:9}}
                                          onMouseEnter={e=>e.currentTarget.style.color=T.red}
                                          onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                                        {(()=>{const g=p.tagShareGroup||"";if(!g)return null;const sq=costProds.reduce((sum,cp)=>cp.tagPrint&&cp.tagShared&&cp.tagShareGroup&&cp.tagShareGroup.trim().toLowerCase()===g.trim().toLowerCase()?sum+(cp.totalQty||0):sum,0);return sq>0?<span style={{fontSize:8,color:T.accent,fontFamily:mono}}>{sq}</span>:null;})()}
                                      </div>
                                    ):(
                                      <button onClick={()=>{
                                        const updated=costProds.map((cp,ci)=>cp.tagPrint?{...cp,tagShared:true,tagShareGroup:"Tag"}:cp);
                                        updated.forEach((cp,ci)=>{if(cp.tagPrint)updateProd(ci,cp);});
                                      }}
                                        style={{fontSize:9,color:T.faint,fontFamily:font,background:"none",border:`1px solid ${T.border}`,borderRadius:3,padding:"2px 6px",cursor:"pointer"}}
                                        onMouseEnter={e=>{e.currentTarget.style.color=T.accent;e.currentTarget.style.borderColor=T.accent;}}
                                        onMouseLeave={e=>{e.currentTarget.style.color=T.faint;e.currentTarget.style.borderColor=T.border;}}>Share</button>
                                    )
                                  )}
                                </td>
                                <td style={{padding:"6px 10px",textAlign:"center",width:"15%"}}>
                                  {p.tagPrint&&(()=>{
                                    const tagGroup=p.tagShareGroup||"";
                                    let tagEffQty=p.totalQty||0;
                                    if(p.tagShared&&tagGroup){
                                      tagEffQty=costProds.reduce((sum,cp)=>cp.tagPrint&&cp.tagShared&&cp.tagShareGroup&&cp.tagShareGroup.trim().toLowerCase()===tagGroup.trim().toLowerCase()?sum+(cp.totalQty||0):sum,0)||tagEffQty;
                                    }
                                    return <span style={{fontSize:13,fontWeight:700,color:T.green,fontFamily:mono}}>
                                      {fmtD(lookupTagPrice(p.printVendor||"",tagEffQty))}
                                    </span>;
                                  })()}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          {(p.printCount||4)<6&&(
                            <button onClick={()=>updateProd(i,{...p,printCount:(p.printCount||4)+1})}
                              style={{width:"100%",background:"transparent",border:"none",borderTop:`1px solid ${T.border}`,padding:"6px",fontSize:11,color:T.muted,fontFamily:font,cursor:"pointer",textAlign:"center"}}
                              onMouseEnter={e=>{e.currentTarget.style.background=T.surface;e.currentTarget.style.color=T.accent;}}
                              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=T.muted;}}>
                              + Add print location
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Finishing & Packaging — always visible */}
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Finishing & Packaging</div>
                        <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <tbody>
                              {(()=>{
                                const pr=PRINTERS[p.printVendor]||{};
                                const rows=[
                                  {label:"Packaging",key:"Packaging",col3:"variant",col4:"packaging_variant"},
                                  ...Object.keys(pr.finishing||{}).map(k=>({label:k,key:k,col3:"blank",col4:"finishing_item"})),
                                ];
                                return rows;
                              })().map(({label,key,col3,col4},idx,arr)=>{
                                const pr=PRINTERS[p.printVendor];
                                const active=key==="FleeceUpcharge"?true:!!(p.finishingQtys?.[key+"_on"]);
                                const totalPrints=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length||0;
                                const fleecePrintCount=totalPrints+(p.tagPrint?1:0);
                                const packagingVariant=p.isFleece?"Fleece":(p.finishingQtys?.["Packaging_variant"]||"Tee");
                                const unitCost=col4==="packaging_variant"?(pr?.packaging?.[packagingVariant]||0):col4==="finishing_item"?(pr?.finishing?.[key]||0):col4==="finishing_fleece"?(pr?.finishing?.Fleece||0):0;
                                const qty=col3==="print_count"?fleecePrintCount:col3==="blank"?(p.finishingQtys?.[key+"_qty"]||0):col3==="variant"?(p.totalQty||0):totalPrints;
                                const total=active?(col3==="variant"||col3==="blank"?unitCost:unitCost*fleecePrintCount):0;
                                const isLast=idx===arr.length-1;
                                return(
                                  <tr key={label} style={{borderBottom:isLast?"none":`1px solid ${T.border}22`,background:active?T.accentDim:idx%2===0?T.card:T.surface}}>
                                    <td style={{padding:"7px 12px",fontFamily:font,fontSize:12,fontWeight:600,color:active?T.accent:T.muted,borderRight:`1px solid ${T.border}`,width:"28%"}}>{label}</td>
                                    <td style={{padding:"5px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"28%"}}>
                                      {key==="FleeceUpcharge"?(
                                        <span style={{fontSize:10,color:T.amber,fontFamily:font,fontWeight:600}}>auto</span>
                                      ):key==="Packaging"?(
                                        (()=>{
                                          const pkgOpts=["No",...Object.keys(pr?.packaging||{Tee:"",Longsleeve:"",Fleece:""})];
                                          const currentVariant=p.isFleece?"Fleece":(p.finishingQtys?.["Packaging_variant"]||"Tee");
                                          return <div style={{display:"inline-flex",borderRadius:6,overflow:"hidden"}}>
                                            {pkgOpts.map((opt,oi)=>{
                                              const isActive=opt==="No"?!active:(active&&currentVariant===opt);
                                              const borderColor=active?T.accent:T.border;
                                              return(
                                                <button key={opt} onClick={()=>{
                                                  if(opt==="No") updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),Packaging_on:0}});
                                                  else updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),Packaging_on:1,Packaging_variant:opt}});
                                                }}
                                                  style={{padding:"3px 10px",fontSize:11,fontFamily:font,fontWeight:600,border:`1px solid ${borderColor}`,marginLeft:oi>0?-1:0,cursor:"pointer",background:isActive?(opt==="No"?T.surface:T.accent):T.card,color:isActive?(opt==="No"?T.text:"#fff"):T.faint,transition:"all 0.12s",borderRadius:oi===0?"6px 0 0 6px":oi===pkgOpts.length-1?"0 6px 6px 0":"0",position:"relative",zIndex:isActive?1:0}}>
                                                  {opt}
                                                </button>
                                              );
                                            })}
                                          </div>;
                                        })()
                                      ):(
                                        <div style={{display:"flex",borderRadius:6,overflow:"hidden"}}>
                                          {["Yes","No"].map((opt,oi)=>{
                                            const sel=(active?"Yes":"No")===opt;
                                            const borderColor=active?T.accent:T.border;
                                            return(
                                              <button key={opt} onClick={()=>updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),[key+"_on"]:opt==="Yes"?1:0}})}
                                                style={{flex:1,padding:"3px 10px",fontSize:11,fontFamily:font,fontWeight:600,border:`1px solid ${borderColor}`,marginLeft:oi>0?-1:0,cursor:"pointer",background:sel?(opt==="Yes"?T.accent:T.surface):T.card,color:sel?(opt==="Yes"?"#fff":T.text):T.faint,transition:"all 0.12s",borderRadius:oi===0?"6px 0 0 6px":"0 6px 6px 0",position:"relative",zIndex:sel?1:0}}>
                                                {opt}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{padding:"5px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"29%"}}>
                                      {col3==="blank"?null:col3==="variant"?null:col3==="print_count"?(
                                        <span style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:mono}}>{fleecePrintCount} <span style={{fontSize:9,color:T.faint,fontFamily:font}}>prints</span></span>
                                      ):(
                                        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                                          <span style={{fontSize:12,fontWeight:active?700:400,color:active?T.text:T.faint,fontFamily:mono}}>{active?totalPrints:null}</span>
                                          {active&&<span style={{fontSize:9,color:T.faint,fontFamily:font}}>auto</span>}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{padding:"7px 10px",textAlign:"center",fontFamily:mono,fontSize:12,fontWeight:total>0?700:400,color:total>0?T.green:T.faint,width:"15%"}}>
                                      {active&&total>0?fmtD(total):(unitCost>0&&!active?<span style={{fontSize:10,color:T.faint}}>{fmtD(unitCost)} ea</span>:null)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      {/* Setup Fees */}
                      <div>
                        <div onClick={()=>updateProd(i,{...p,_setupOpen:!p._setupOpen})}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",padding:"6px 8px",borderRadius:6,background:p._setupOpen?T.accentDim:T.surface,border:`1px solid ${p._setupOpen?T.accent+"44":T.border}`,marginBottom:p._setupOpen?8:0,transition:"all 0.15s"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:p._setupOpen?T.accent:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Setup Fees</div>
                            {!p._setupOpen&&!!([1,2,3,4,5,6].some(loc=>p.printLocations?.[loc]?.screens>0)||(p.tagPrint&&!p.tagRepeat)||p.setupFees?.seps>0||p.setupFees?.inkChanges>0||p.setupFees?.manualCost>0)&&<span style={{fontSize:11,color:T.green}}>✓</span>}
                          </div>
                          <span style={{fontSize:11,color:p._setupOpen?T.accent:T.faint,display:"inline-block",transform:p._setupOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.15s"}}>v</span>
                        </div>
                        {p._setupOpen&&(()=>{
                          const pr=PRINTERS[p.printVendor];
                          // Subtract shared screens if this item is not the first in any share group
                          const sharedSkip=[1,2,3,4,5,6].reduce((a,loc)=>{
                            const ld2=p.printLocations?.[loc];
                            if(!ld2?.shared||!ld2?.shareGroup||!ld2?.screens) return a;
                            const firstIdx=costProds.findIndex(cp=>Object.values(cp.printLocations||{}).some(l=>l.shared&&l.shareGroup&&l.shareGroup.trim().toLowerCase()===ld2.shareGroup.trim().toLowerCase()&&l.screens>0));
                            return (firstIdx>=0&&costProds.indexOf(p)>firstIdx)?a+(parseFloat(ld2.screens)||0):a;
                          },0);
                          const autoScreens=Math.max(0,[1,2,3,4,5,6].reduce((a,loc)=>a+(parseFloat(p.printLocations?.[loc]?.screens)||0),0)-sharedSkip);
                          const tagScreenCount=p.tagPrint&&!p.tagRepeat?(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).length:0;
                          const setupKeys=Object.keys(pr?.setup||{});
                          const isScreensKey=(k)=>k==="Screens"||k.toLowerCase()==="screens";
                          const isTagScreensKey=(k)=>k==="TagScreens"||k==="Tag Screens"||k.toLowerCase().replace(/\s/g,"")==="tagscreens";
                          // Find specialty keys that have a matching setup fee (e.g. "Puff" specialty → "Puff Screen Up Charge" setup)
                          const getSpecialtyCount=(setupKey)=>{
                            const skLower=setupKey.toLowerCase();
                            const specKeys=Object.keys(p.specialtyQtys||{}).filter(sk=>sk.endsWith("_on")&&p.specialtyQtys[sk]);
                            for(const sk of specKeys){
                              const specName=sk.replace("_on","").toLowerCase();
                              if(skLower.includes(specName)) return p.specialtyQtys?.[sk.replace("_on","_count")]||0;
                            }
                            return null;
                          };
                          const rows=setupKeys.map(k=>{
                            if(isScreensKey(k)) return {label:"Screens",qty:autoScreens,auto:true,unitCost:pr.setup[k]||0,field:"screens"};
                            if(isTagScreensKey(k)) return {label:"Tag Screens",qty:tagScreenCount,auto:p.tagPrint,unitCost:p.tagRepeat?0:(pr.setup[k]||0),field:"tagSizes"};
                            // Check if this setup fee links to an active specialty
                            const specCount=getSpecialtyCount(k);
                            if(specCount!==null) return {label:k,qty:specCount,auto:true,unitCost:pr.setup[k]||0,field:k};
                            // All other setup fees are manual input
                            return {label:k,qty:p.setupFees?.[k]||0,auto:false,unitCost:pr.setup[k]||0,field:k};
                          });
                          return(
                            <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                              <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                                <tbody>
                                  {rows.map((row,ri)=>{
                                    const total=row.qty*row.unitCost;
                                    const isLast=ri===rows.length-1;
                                    return(
                                      <tr key={row.label} style={{borderBottom:isLast?"none":`1px solid ${T.border}22`,background:row.qty>0?T.surface:T.card}}>
                                        <td style={{padding:"7px 12px",fontSize:12,fontWeight:600,color:T.muted,fontFamily:font,borderRight:`1px solid ${T.border}`,width:"35%"}}>{row.label}</td>
                                        <td style={{padding:"4px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"30%",position:"relative"}}>
                                          {row.auto?(
                                            <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
                                              <span style={{fontSize:13,fontWeight:700,color:row.qty>0?T.text:T.faint,fontFamily:mono,textAlign:"center",width:"100%"}}>{row.qty||null}</span>
                                              <span style={{fontSize:9,color:T.faint,fontFamily:font,position:"absolute",right:8}}>auto</span>
                                            </div>
                                          ):(
                                            <input type="text" inputMode="decimal" value={p.setupFees?.[row.field]||""} placeholder="0"
                                              onChange={e=>{const raw=e.target.value;if(raw===""||/^[0-9]*\.?[0-9]*$/.test(raw))updateProd(i,{...p,setupFees:{...(p.setupFees||{}),[row.field]:raw===""?0:raw.endsWith(".")?raw:parseFloat(raw)||0}});}}
                                              onBlur={e=>updateProd(i,{...p,setupFees:{...(p.setupFees||{}),[row.field]:parseFloat(e.target.value)||0}})}
                                              data-costfield onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab")focusNext(e,e.shiftKey);}}
                                              style={{width:"100%",textAlign:"center",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:13,fontFamily:mono}}/>
                                          )}
                                        </td>
                                        <td style={{padding:"7px 12px",textAlign:"right",fontFamily:mono,fontSize:12,fontWeight:total>0?700:400,color:total>0?T.green:T.faint,width:"35%"}}>
                                          {row.label==="Tag Screens"&&p.tagRepeat?(
                                            <span style={{fontSize:11,fontWeight:700,color:T.amber,fontFamily:font}}>$0 (repeat)</span>
                                          ):row.unitCost>0?(total>0?fmtD(total):(fmtD(row.unitCost)+" ea")):null}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </div>
                      {/* Specialty — collapsible, dynamic from decorator */}
                      <div>
                        <div onClick={()=>updateProd(i,{...p,_specOpen:!p._specOpen})}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",padding:"6px 8px",borderRadius:6,background:p._specOpen?T.accentDim:T.surface,border:`1px solid ${p._specOpen?T.accent+"44":T.border}`,marginBottom:p._specOpen?8:0,transition:"all 0.15s"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:p._specOpen?T.accent:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Specialty</div>
                            {!p._specOpen&&Object.keys(p.specialtyQtys||{}).some(k=>k.endsWith("_on")&&p.specialtyQtys[k])&&<span style={{fontSize:11,color:T.green}}>✓</span>}
                          </div>
                          <span style={{fontSize:11,color:p._specOpen?T.accent:T.faint,transition:"transform 0.15s",display:"inline-block",transform:p._specOpen?"rotate(180deg)":"rotate(0deg)"}}>v</span>
                        </div>
                        {p._specOpen&&(()=>{
                          const pr=PRINTERS[p.printVendor]||{};
                          const specKeys=Object.keys(pr.specialty||{});
                          if(specKeys.length===0) return <div style={{fontSize:11,color:T.faint,fontFamily:font,padding:"4px 8px"}}>No specialty options for this vendor</div>;
                          return(
                          <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                            <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                              <tbody>
                                {specKeys.map((key,idx)=>{
                                  const label=key;
                                  const unitCost=pr.specialty[key]||0;
                                  const isFleece=key==="Fleece Upcharge";
                                  const allPrintCount=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length||0;
                                  const active=isFleece?!!p.isFleece:!!(p.specialtyQtys?.[key+"_on"]);
                                  const printCount=active?(isFleece?(allPrintCount+(p.tagPrint?1:0)):(p.specialtyQtys?.[key+"_count"]!==undefined?p.specialtyQtys[key+"_count"]:allPrintCount)):0;
                                  const total=active?unitCost*printCount:0;
                                  const isLast=idx===specKeys.length-1;
                                  return(
                                    <tr key={key} style={{borderBottom:isLast?"none":`1px solid ${T.border}22`,background:active?T.accentDim:idx%2===0?T.card:T.surface}}>
                                      <td style={{padding:"7px 12px",fontFamily:font,fontSize:12,fontWeight:600,color:active?T.accent:T.muted,borderRight:`1px solid ${T.border}`,width:"28%"}}>{label}</td>
                                      <td style={{padding:"5px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"28%"}}>
                                        {isFleece?(
                                          <span style={{fontSize:10,color:active?T.amber:T.faint,fontFamily:font,fontWeight:600}}>{active?"auto":"off"}</span>
                                        ):(
                                        <div style={{display:"flex",borderRadius:5,overflow:"hidden",border:`1px solid ${T.border}`,width:"fit-content",margin:"0 auto"}}>
                                          {["Yes","No"].map(opt=>{
                                            const sel=(active?"Yes":"No")===opt;
                                            return(
                                              <button key={opt} onClick={()=>{
                                                const updates={...(p.specialtyQtys||{}),[key+"_on"]:opt==="Yes"?1:0};
                                                if(opt==="Yes"&&!updates[key+"_count"]) updates[key+"_count"]=allPrintCount;
                                                updateProd(i,{...p,specialtyQtys:updates});
                                              }}
                                                style={{padding:"3px 10px",fontSize:11,fontFamily:font,fontWeight:600,border:"none",cursor:"pointer",background:sel?(opt==="Yes"?T.accent:T.surface):T.card,color:sel?(opt==="Yes"?"#fff":T.text):T.faint,transition:"all 0.12s"}}>
                                                {opt}
                                              </button>
                                            );
                                          })}
                                        </div>
                                        )}
                                      </td>
                                      <td style={{padding:"4px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"29%"}}>
                                        {active?(
                                          isFleece?(
                                            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                                              <span style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:mono}}>{printCount}</span>
                                              <span style={{fontSize:9,color:T.faint,fontFamily:font}}>prints</span>
                                            </div>
                                          ):(
                                          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                                            <input type="text" inputMode="numeric" value={p.specialtyQtys?.[key+"_count"]!==undefined?p.specialtyQtys[key+"_count"]:allPrintCount}
                                              onChange={e=>{const v=parseInt(e.target.value)||0;updateProd(i,{...p,specialtyQtys:{...(p.specialtyQtys||{}),[key+"_count"]:v}});}}
                                              style={{width:30,textAlign:"center",background:T.surface,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontFamily:mono,fontSize:12,padding:"2px",outline:"none"}}/>
                                            <span style={{fontSize:9,color:T.faint,fontFamily:font}}>prints</span>
                                          </div>
                                          )
                                        ):null}
                                      </td>
                                      <td style={{padding:"7px 10px",textAlign:"center",fontFamily:mono,fontSize:12,fontWeight:total>0?700:400,color:total>0?T.green:T.faint,width:"15%"}}>
                                        {active&&unitCost>0?fmtD(total):(unitCost>0&&!active?<span style={{fontSize:10,color:T.faint}}>{fmtD(unitCost)} ea</span>:null)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>);
                        })()}
                      </div>
                      {/* Custom Costs */}
                      <div>
                        <div onClick={()=>updateProd(i,{...p,_customOpen:!p._customOpen})}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",padding:"6px 8px",borderRadius:6,background:p._customOpen?T.accentDim:T.surface,border:`1px solid ${p._customOpen?T.accent+"44":T.border}`,marginBottom:p._customOpen?8:0,transition:"all 0.15s"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:p._customOpen?T.accent:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom Costs</div>
                            {!p._customOpen&&(p.customCosts||[]).some(c=>(c.perUnit||c.amount||0)>0||c.desc)&&<span style={{fontSize:11,color:T.green}}>✓</span>}
                          </div>
                          <span style={{fontSize:11,color:p._customOpen?T.accent:T.faint,display:"inline-block",transform:p._customOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.15s"}}>v</span>
                        </div>
                        {p._customOpen&&<div>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom Costs</div>
                            <button onClick={()=>updateProd(i,{...p,customCosts:[...(p.customCosts||[]),{desc:"",perUnit:0,flat:false}]})}
                              style={{fontSize:11,color:T.accent,fontFamily:font,background:"none",border:`1px solid ${T.accent}44`,borderRadius:5,cursor:"pointer",padding:"2px 10px"}}>+ Add</button>
                          </div>
                          {(p.customCosts||[]).length>0&&(
                            <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                              <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                                <thead><tr style={{background:T.surface}}>
                                  <th style={{padding:"4px 8px",textAlign:"left",fontSize:10,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`,width:"35%"}}>Description</th>
                                  <th style={{padding:"4px 8px",textAlign:"center",fontSize:10,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`,width:"18%"}}>Type</th>
                                  <th style={{padding:"4px 8px",textAlign:"center",fontSize:10,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`,width:"18%"}}>Cost</th>
                                  <th style={{padding:"4px 8px",textAlign:"center",fontSize:10,fontWeight:600,color:T.muted,borderRight:`1px solid ${T.border}`,width:"18%"}}>Total</th>
                                  <th style={{width:"11%"}}/>
                                </tr></thead>
                                <tbody>
                                  {(p.customCosts||[]).map((cc,ci)=>{
                                    const isFlat=!!cc.flat;
                                    const costVal=cc.perUnit||cc.amount||0;
                                    const total=isFlat?costVal:costVal*(p.totalQty||0);
                                    return(
                                    <tr key={ci} style={{borderBottom:ci<p.customCosts.length-1?`1px solid ${T.border}`:"none",background:ci%2===0?T.card:T.surface}}>
                                      <td style={{padding:"5px 8px",borderRight:`1px solid ${T.border}`}}>
                                        <input value={cc.desc||""}                                          onChange={e=>{const c=[...p.customCosts];c[ci]={...c[ci],desc:e.target.value};updateProd(i,{...p,customCosts:c});}}
                                          style={{width:"100%",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:font}}/>
                                      </td>
                                      <td style={{padding:"3px 4px",borderRight:`1px solid ${T.border}`,textAlign:"center"}}>
                                        <div style={{display:"inline-flex",borderRadius:4,overflow:"hidden"}}>
                                          {[{id:false,label:"/ unit"},{id:true,label:"flat"}].map((opt,oi)=>{
                                            const sel=isFlat===opt.id;
                                            return <button key={oi} onClick={()=>{const c=[...p.customCosts];c[ci]={...c[ci],flat:opt.id};updateProd(i,{...p,customCosts:c});}}
                                              style={{padding:"2px 8px",fontSize:9,fontFamily:font,fontWeight:600,border:`1px solid ${sel?T.accent:T.border}`,marginLeft:oi>0?-1:0,cursor:"pointer",background:sel?T.accent:T.card,color:sel?"#fff":T.faint,borderRadius:oi===0?"4px 0 0 4px":"0 4px 4px 0",position:"relative",zIndex:sel?1:0}}>{opt.label}</button>;
                                          })}
                                        </div>
                                      </td>
                                      <td style={{padding:"5px 8px",borderRight:`1px solid ${T.border}`,textAlign:"center"}}>
                                        <div style={{display:"flex",alignItems:"center",gap:2,justifyContent:"center"}}>
                                          <span style={{fontSize:11,color:T.faint,fontFamily:mono}}>$</span>
                                          <input type="text" inputMode="decimal" value={cc.perUnit||cc.amount||""} placeholder="0.00"
                                            onChange={e=>{const raw=e.target.value;if(raw===""||/^[0-9]*\.?[0-9]*$/.test(raw)){const c=[...p.customCosts];c[ci]={...c[ci],perUnit:raw===""?0:raw.endsWith(".")?raw:parseFloat(raw)||0};updateProd(i,{...p,customCosts:c});}}}
                                            onBlur={e=>{const c=[...p.customCosts];c[ci]={...c[ci],perUnit:parseFloat(e.target.value)||0};updateProd(i,{...p,customCosts:c});}}
                                            onFocus={e=>e.target.select()}
                                            style={{width:60,background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:mono,textAlign:"center"}}/>
                                        </div>
                                      </td>
                                      <td style={{padding:"5px 8px",borderRight:`1px solid ${T.border}`,textAlign:"center",fontFamily:mono,fontSize:12,fontWeight:total>0?700:400,color:total>0?T.green:T.faint}}>
                                        {total>0?fmtD(total):"—"}
                                      </td>
                                      <td style={{padding:"5px 8px",textAlign:"center"}}>
                                        <button onClick={()=>{const c=p.customCosts.filter((_,j)=>j!==ci);updateProd(i,{...p,customCosts:c});}}
                                          style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:12}}
                                          onMouseEnter={e=>e.currentTarget.style.color=T.red}
                                          onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                                      </td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>}
                      </div>
                    </div>}{/* end old decoration panel */}
                  </div>
                </div>
              );
            })}

          </div>
        </div>
      )}

      {/* Client Quote */}
      {costTab==="quote"&&(()=>{
        const quoteProds=costProds.filter(p=>(p.totalQty||0)>0);
        const quoteTotal=quoteProds.reduce((a,p)=>{const r2=calcCostProduct(p,costMargin,inclShip,inclCC,costProds);return a+(r2?.grossRev||0);},0);
        const approved=project.prodStatus==="Awaiting Deposit"||project.prodStatus==="Ready for Production"||project.prodStatus==="Bulk Production";
        return(
          <div style={{maxWidth:680,margin:"0 auto"}}>
            {/* Quote details */}
            <div style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-start"}}>
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px",flex:1}}>
                <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Quote details</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <CInput label="Quote #" value={orderInfo.invoiceNum} onChange={v=>setOrderInfo(o=>({...o,invoiceNum:v}))}/>
                  <CInput label="Valid until" type="date" value={orderInfo.validUntil} onChange={v=>setOrderInfo(o=>({...o,validUntil:v}))}/>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <button onClick={()=>setShowSendEmail(!showSendEmail)} style={{background:T.purple,color:"#fff",border:"none",borderRadius:7,padding:"6px 16px",fontSize:12,fontFamily:font,fontWeight:600,cursor:"pointer",width:"100%"}}>Send to Client</button>
                <button onClick={()=>{const a=document.createElement("a");a.href=`/api/pdf/quote/${project.id}`;a.download="quote.pdf";a.click();}} style={{background:T.accent,color:"#fff",border:"none",borderRadius:7,padding:"6px 16px",fontSize:12,fontFamily:font,fontWeight:600,cursor:"pointer",width:"100%"}}>Download</button>
              </div>
            </div>
            <div style={{fontSize:12,color:T.muted,fontFamily:font,marginBottom:10}}>Preview — this is what your client sees</div>
            {showSendEmail&&(
              <div style={{marginBottom:14}}>
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
            )}
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #e5e7eb",overflow:"hidden",fontFamily:"Georgia, serif",color:"#111"}}>
              <div style={{padding:"32px 36px 24px",borderBottom:"3px solid #111"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <svg id="Layer_1" style={{height:32,display:"block",marginBottom:10}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227.14 28.53">   <g> <path fill="#3c4e7f" d="M104.44,128.29c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25-.2.16-.35.43-.47.8-.11.37-.19.85-.24,1.44-.05.6-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23s.16,1.01.29,1.32c.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.93.08-.4.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.1-.57,1.55-.28.44-.67.79-1.17,1.04-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.27c-.29-.56-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.77.13-2.54.27-1.44.56-2c.29-.56.71-.99,1.25-1.3.54-.31,1.28-.47,2.19-.47s1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41s.09.98.09,1.42h-2.45c0-.88-.1-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M108.27,126.12h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M115.59,129.65c.08-.78.27-1.44.56-2s.71-.99,1.25-1.3c.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47c.54.31.96.75,1.25,1.3s.48,1.22.56,2,.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99s-.71.98-1.25,1.27-1.28.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.27s-.48-1.22-.56-1.99c-.08-.77-.13-1.62-.13-2.55s.04-1.77.13-2.54ZM117.97,134.28c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M126.72,134.83c0,.28.02.54.07.77.04.23.13.43.25.59.12.16.29.28.5.37.21.09.47.14.79.14.37,0,.71-.12,1.01-.37.3-.24.45-.62.45-1.13,0-.27-.04-.51-.11-.71-.07-.2-.2-.38-.37-.54s-.39-.3-.67-.43c-.28-.13-.62-.26-1.03-.4-.54-.18-1.01-.38-1.41-.6-.4-.22-.73-.47-1-.76-.27-.29-.46-.62-.59-1-.12-.38-.19-.82-.19-1.32,0-1.2.33-2.1,1-2.69.67-.59,1.59-.88,2.75-.88.54,0,1.05.06,1.5.18.46.12.86.31,1.19.58.33.27.59.61.78,1.02.19.41.28.91.28,1.49v.34h-2.35c0-.58-.1-1.02-.31-1.33-.2-.31-.54-.47-1.02-.47-.27,0-.5.04-.68.12-.18.08-.33.18-.43.31-.11.13-.18.28-.22.45s-.06.35-.06.53c0,.37.08.69.24.94.16.26.5.49,1.02.71l1.89.82c.46.2.84.42,1.14.64s.53.46.71.71c.18.26.3.54.37.84.07.31.1.65.1,1.02,0,1.28-.37,2.21-1.11,2.8-.74.58-1.78.88-3.1.88s-2.37-.3-2.97-.9-.89-1.46-.89-2.58v-.49h2.45v.36Z"/> <path fill="#3c4e7f" d="M139.93,128.13h-4.33v2.86h4.08v2.01h-4.08v3.26h4.5v2.01h-6.95v-12.14h6.78v2.01Z"/> <path fill="#3c4e7f" d="M145.03,126.12c.85,0,1.54.14,2.06.42.52.28.93.67,1.21,1.19.29.52.48,1.14.59,1.86.1.73.15,1.54.15,2.43,0,1.07-.07,1.99-.2,2.78-.13.79-.35,1.44-.67,1.95-.32.51-.74.89-1.28,1.14-.53.25-1.21.37-2.02.37h-3.86v-12.14h4.01ZM144.55,136.46c.43,0,.78-.07,1.04-.22.26-.15.47-.39.62-.73.15-.34.25-.79.31-1.34.05-.56.08-1.25.08-2.07,0-.69-.02-1.3-.07-1.82-.04-.52-.14-.95-.28-1.3s-.35-.61-.63-.78c-.28-.18-.65-.26-1.11-.26h-1.04v8.53h1.09Z"/> <path fill="#3c4e7f" d="M160.36,128.13h-2.65v10.13h-2.45v-10.13h-2.65v-2.01h7.75v2.01Z"/> <path fill="#3c4e7f" d="M160.86,129.65c.08-.78.27-1.44.56-2s.71-.99,1.25-1.3c.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47c.54.31.96.75,1.25,1.3.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.27s-1.28.44-2.19.44-1.65-.15-2.19-.44-.96-.72-1.25-1.27-.48-1.22-.56-1.99c-.08-.77-.13-1.62-.13-2.55s.04-1.77.13-2.54ZM163.24,134.28c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.66-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M177.95,126.12c.62,0,1.15.1,1.57.31.43.21.77.48,1.03.82.26.34.45.73.56,1.16.11.44.17.88.17,1.33,0,.62-.09,1.17-.28,1.63-.19.46-.45.84-.78,1.14-.33.29-.74.52-1.21.66-.48.15-1,.22-1.58.22h-1.31v4.85h-2.45v-12.14h4.28ZM177.21,131.61c.49,0,.88-.15,1.18-.44.3-.29.45-.75.45-1.38s-.13-1.08-.39-1.39-.7-.48-1.31-.48h-1.02v3.69h1.09Z"/> <path fill="#3c4e7f" d="M184.36,134.59c0,.31.02.59.06.84.04.25.11.48.22.66.11.19.25.33.44.44.19.11.42.16.71.16s.53-.05.71-.16c.18-.11.33-.25.43-.44.11-.19.18-.41.22-.66s.06-.54.06-.84v-8.47h2.45v8.47c0,.77-.11,1.41-.32,1.91-.22.5-.5.9-.87,1.2-.36.29-.78.49-1.24.6-.46.1-.95.15-1.44.15s-.98-.04-1.45-.14c-.46-.09-.88-.27-1.24-.55-.36-.28-.65-.67-.87-1.18-.21-.51-.32-1.17-.32-1.99v-8.47h2.45v8.47Z"/> <path fill="#3c4e7f" d="M194.89,126.12c.5,0,.96.05,1.38.15.43.1.79.27,1.1.51.31.24.54.56.71.95.17.4.26.88.26,1.46,0,.66-.15,1.22-.46,1.69-.31.47-.77.79-1.38.96v.03c.68.09,1.22.38,1.62.87s.6,1.14.6,1.95c0,.48-.06.93-.19,1.36s-.34.81-.64,1.13c-.3.32-.69.58-1.17.77-.48.19-1.08.29-1.79.29h-4.13v-12.14h4.1ZM193.93,131.1c.68,0,1.18-.12,1.49-.37s.47-.65.47-1.23-.14-.99-.42-1.22c-.28-.24-.73-.36-1.34-.36h-.88v3.18h.7ZM194.19,136.46c.59,0,1.07-.13,1.43-.39.36-.26.54-.74.54-1.45,0-.35-.05-.64-.14-.88-.1-.23-.23-.42-.39-.56-.16-.14-.36-.24-.59-.3-.23-.06-.48-.08-.75-.08h-1.05v3.66h.95Z"/> <path fill="#3c4e7f" d="M199.82,126.12h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M207.38,126.12h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M216.09,128.29c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25-.2.16-.35.43-.47.8s-.19.85-.24,1.44c-.05.6-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.93s.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.1-.57,1.55s-.67.79-1.17,1.04c-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.27-.48-1.22-.56-1.99c-.08-.77-.13-1.62-.13-2.55s.04-1.77.13-2.54.27-1.44.56-2,.71-.99,1.25-1.3c.54-.31,1.27-.47,2.19-.47s1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41.06.5.09.98.09,1.42h-2.45c0-.88-.11-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M118.74,154.84h.03v-8.31h2.24v12.14h-2.79l-2.99-8.5h-.03v8.5h-2.24v-12.14h2.82l2.96,8.31Z"/> <path fill="#3c4e7f" d="M122.17,150.05c.08-.78.27-1.44.56-2,.29-.55.71-.99,1.25-1.3.54-.31,1.28-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.28s-1.27.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.28-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54ZM124.55,154.68c.04.57.12,1.04.24,1.39.12.36.29.62.51.78s.51.25.88.25.65-.08.88-.25.39-.42.51-.78c.12-.36.2-.82.24-1.39s.06-1.27.06-2.08-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79s-.51-.25-.88-.25-.66.08-.88.25-.39.43-.51.79c-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M136.95,155.23c0,.28.02.54.07.77.04.23.13.43.25.59.12.16.29.28.5.37s.47.14.79.14c.37,0,.71-.12,1.01-.37.3-.24.45-.62.45-1.13,0-.27-.04-.51-.11-.71-.07-.2-.2-.38-.37-.54-.17-.16-.39-.3-.67-.43-.28-.13-.62-.26-1.03-.4-.54-.18-1.01-.38-1.41-.59-.4-.22-.73-.47-1-.76-.27-.29-.46-.62-.59-1-.12-.38-.19-.82-.19-1.32,0-1.2.33-2.1,1-2.69.67-.59,1.59-.88,2.75-.88.54,0,1.05.06,1.5.18s.86.31,1.19.58c.33.27.59.61.78,1.02.19.41.28.91.28,1.49v.34h-2.35c0-.58-.1-1.02-.31-1.33s-.54-.47-1.02-.47c-.27,0-.5.04-.68.12s-.33.18-.43.31c-.11.13-.18.28-.22.45-.04.17-.06.35-.06.53,0,.37.08.69.24.94.16.25.5.49,1.02.71l1.89.82c.46.2.84.42,1.14.64s.53.46.71.71.3.54.37.84c.07.31.1.65.1,1.02,0,1.28-.37,2.21-1.11,2.8s-1.78.88-3.1.88-2.37-.3-2.97-.9-.89-1.46-.89-2.58v-.49h2.45v.36Z"/> <path fill="#3c4e7f" d="M143.25,150.05c.08-.78.27-1.44.56-2,.29-.55.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.28s-1.28.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.28-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54ZM145.63,154.68c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M152.4,146.52h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M159.97,146.52h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M168.68,148.69c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25s-.35.43-.47.8-.19.85-.24,1.44c-.05.6-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.94s.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.11-.57,1.55-.28.44-.67.79-1.17,1.04-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.28c-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54.27-1.44.56-2c.29-.55.71-.99,1.25-1.3s1.27-.47,2.19-.47,1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41.06.5.09.98.09,1.42h-2.45c0-.88-.11-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M172.63,146.52h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M183.58,148.53h-2.65v10.13h-2.45v-10.13h-2.65v-2.01h7.75v2.01Z"/> <path fill="#3c4e7f" d="M184.33,146.52h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M193.95,154.84h.03v-8.31h2.24v12.14h-2.79l-2.99-8.5h-.03v8.5h-2.24v-12.14h2.82l2.96,8.31Z"/> <path fill="#3c4e7f" d="M202.82,149.43c-.05-.24-.13-.46-.25-.65s-.26-.36-.43-.49c-.18-.13-.39-.2-.64-.2-.59,0-1.01.33-1.27.99s-.39,1.75-.39,3.26c0,.73.02,1.38.07,1.97.04.59.13,1.09.25,1.5.12.41.29.73.51.95.22.22.51.33.86.33.15,0,.31-.04.48-.12s.34-.2.49-.36c.15-.16.28-.36.38-.6.1-.24.15-.53.15-.86v-1.24h-1.62v-1.8h3.96v6.54h-1.8v-1.12h-.03c-.29.48-.65.81-1.06,1.01s-.91.3-1.49.3c-.75,0-1.36-.13-1.83-.39-.47-.26-.84-.66-1.11-1.21s-.44-1.22-.54-2.01-.14-1.73-.14-2.78.06-1.92.2-2.69c.13-.77.35-1.41.67-1.93s.74-.9,1.26-1.17c.52-.26,1.17-.39,1.95-.39,1.34,0,2.3.33,2.89.99.59.66.88,1.61.88,2.85h-2.35c0-.23-.03-.46-.08-.7Z"/> </g> <rect fill="gold" x="-39.05" y="129.12" width="396" height="612" transform="translate(594.07 276.17) rotate(90)"/> <g> <path fill="#3c4e7f" d="M104.49,517.76c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25s-.35.43-.47.8c-.11.37-.19.85-.24,1.45-.05.59-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44s.24-.53.32-.93c.08-.4.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.1-.57,1.55-.28.44-.67.79-1.17,1.04-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.27c-.29-.56-.48-1.22-.56-1.99s-.13-1.62-.13-2.55.04-1.77.13-2.54.27-1.44.56-2c.29-.56.71-.99,1.25-1.3s1.28-.47,2.19-.47,1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41.06.5.09.98.09,1.42h-2.45c0-.88-.1-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M108.32,515.59h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M115.64,519.12c.08-.78.27-1.44.56-2,.29-.56.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.55.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55-.27,1.43-.56,1.99c-.29.55-.71.98-1.25,1.27s-1.28.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.27-.29-.56-.48-1.22-.56-1.99s-.13-1.62-.13-2.55.04-1.77.13-2.54ZM118.02,523.74c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.17.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M126.77,524.3c0,.28.02.54.07.77.04.23.13.43.25.59.12.16.29.28.5.37.21.09.47.14.79.14.37,0,.71-.12,1.01-.37.3-.24.45-.62.45-1.13,0-.27-.04-.51-.11-.71-.07-.2-.2-.38-.37-.54-.17-.16-.39-.3-.67-.43-.28-.13-.62-.26-1.03-.4-.54-.18-1.01-.38-1.41-.59-.4-.22-.73-.47-1-.76-.27-.29-.46-.62-.59-1-.12-.38-.19-.82-.19-1.32,0-1.2.33-2.1,1-2.69.67-.59,1.59-.88,2.75-.88.54,0,1.05.06,1.5.18s.86.31,1.19.58c.33.27.59.61.78,1.02.19.41.28.91.28,1.49v.34h-2.35c0-.58-.1-1.02-.31-1.33-.2-.31-.54-.47-1.02-.47-.27,0-.5.04-.68.12-.18.08-.33.18-.43.31-.11.13-.18.28-.22.45s-.06.35-.06.53c0,.37.08.69.24.94.16.26.5.49,1.02.71l1.89.82c.46.2.84.42,1.14.64.29.22.53.46.71.71.18.26.3.54.37.84.07.31.1.65.1,1.02,0,1.28-.37,2.21-1.11,2.8-.74.58-1.78.88-3.1.88s-2.37-.3-2.97-.9-.89-1.46-.89-2.58v-.49h2.45v.36Z"/> <path fill="#3c4e7f" d="M139.98,517.6h-4.33v2.86h4.08v2.01h-4.08v3.26h4.5v2.01h-6.95v-12.14h6.78v2.01Z"/> <path fill="#3c4e7f" d="M145.08,515.59c.85,0,1.54.14,2.06.42.52.28.93.67,1.21,1.19s.48,1.14.59,1.86c.1.73.15,1.54.15,2.43,0,1.07-.07,1.99-.2,2.78-.13.79-.35,1.44-.67,1.95s-.74.89-1.28,1.14c-.53.25-1.21.37-2.02.37h-3.86v-12.14h4.01ZM144.6,525.93c.43,0,.78-.07,1.04-.22s.47-.39.62-.73.25-.79.31-1.34c.05-.56.08-1.25.08-2.07,0-.69-.02-1.3-.07-1.82-.04-.52-.14-.95-.28-1.3-.14-.35-.35-.61-.63-.78-.28-.18-.65-.26-1.11-.26h-1.04v8.53h1.09Z"/> <path fill="#3c4e7f" d="M160.41,517.6h-2.65v10.13h-2.45v-10.13h-2.65v-2.01h7.75v2.01Z"/> <path fill="#3c4e7f" d="M160.91,519.12c.08-.78.27-1.44.56-2,.29-.56.71-.99,1.25-1.3s1.27-.47,2.19-.47,1.65.16,2.19.47.96.75,1.25,1.3c.29.55.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55-.27,1.43-.56,1.99c-.29.55-.71.98-1.25,1.27s-1.28.44-2.19.44-1.65-.15-2.19-.44-.96-.72-1.25-1.27c-.29-.56-.48-1.22-.56-1.99s-.13-1.62-.13-2.55.04-1.77.13-2.54ZM163.29,523.74c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.17.51.25.88.25s.66-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79s-.51-.25-.88-.25-.65.08-.88.25-.39.43-.51.79c-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M178.01,515.59c.62,0,1.15.1,1.57.31.43.21.77.48,1.03.82.26.34.45.73.56,1.17s.17.88.17,1.33c0,.62-.09,1.17-.28,1.63-.19.46-.45.84-.78,1.14s-.74.52-1.21.66c-.48.15-1,.22-1.58.22h-1.31v4.84h-2.45v-12.14h4.28ZM177.26,521.08c.49,0,.88-.15,1.18-.44.3-.29.45-.75.45-1.38s-.13-1.08-.39-1.39-.7-.48-1.31-.48h-1.02v3.69h1.09Z"/> <path fill="#3c4e7f" d="M184.42,524.06c0,.31.02.59.06.84.04.25.11.48.22.66.11.19.25.33.44.44.19.11.42.16.71.16s.53-.05.71-.16c.18-.11.33-.25.43-.44.11-.19.18-.41.22-.66s.06-.54.06-.84v-8.47h2.45v8.47c0,.77-.11,1.41-.32,1.91-.22.5-.5.9-.87,1.2s-.78.49-1.24.59-.95.15-1.44.15-.98-.04-1.45-.14c-.46-.09-.88-.27-1.24-.55-.36-.28-.65-.67-.87-1.18-.21-.51-.32-1.17-.32-1.99v-8.47h2.45v8.47Z"/> <path fill="#3c4e7f" d="M194.94,515.59c.5,0,.96.05,1.38.15.43.1.79.27,1.1.51.31.24.54.56.71.95.17.4.26.88.26,1.46,0,.66-.15,1.22-.46,1.69-.31.47-.77.79-1.38.96v.03c.68.09,1.22.38,1.62.87s.6,1.14.6,1.96c0,.48-.06.93-.19,1.36s-.34.81-.64,1.13c-.3.32-.69.58-1.17.77-.48.19-1.08.29-1.79.29h-4.13v-12.14h4.1ZM193.99,520.57c.68,0,1.18-.12,1.49-.37.31-.24.47-.65.47-1.23s-.14-.99-.42-1.22c-.28-.24-.73-.36-1.34-.36h-.88v3.18h.7ZM194.24,525.93c.59,0,1.07-.13,1.43-.39.36-.26.54-.74.54-1.45,0-.35-.05-.64-.14-.88-.1-.23-.23-.42-.39-.56s-.36-.24-.59-.3c-.23-.06-.48-.08-.75-.08h-1.05v3.66h.95Z"/> <path fill="#3c4e7f" d="M199.87,515.59h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M207.43,515.59h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M216.15,517.76c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25s-.35.43-.47.8-.19.85-.24,1.45c-.05.59-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.93s.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.1-.57,1.55-.28.44-.67.79-1.17,1.04s-1.16.37-1.96.37c-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.27c-.29-.56-.48-1.22-.56-1.99s-.13-1.62-.13-2.55.04-1.77.13-2.54.27-1.44.56-2c.29-.56.71-.99,1.25-1.3s1.27-.47,2.19-.47,1.56.14,2.07.42c.5.28.88.64,1.13,1.08s.41.91.47,1.41c.06.5.09.98.09,1.42h-2.45c0-.88-.11-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M118.8,544.31h.03v-8.31h2.24v12.14h-2.79l-2.99-8.5h-.03v8.5h-2.24v-12.14h2.82l2.96,8.31Z"/> <path fill="#3c4e7f" d="M122.22,539.52c.08-.78.27-1.44.56-2,.29-.55.71-.99,1.25-1.3s1.28-.47,2.19-.47,1.65.16,2.19.47.96.75,1.25,1.3c.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.28s-1.27.44-2.19.44-1.65-.15-2.19-.44-.96-.72-1.25-1.28c-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54ZM124.6,544.14c.04.57.12,1.04.24,1.39.12.36.29.62.51.78s.51.25.88.25.65-.08.88-.25.39-.42.51-.78c.12-.36.2-.82.24-1.39s.06-1.27.06-2.08-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79s-.51-.25-.88-.25-.66.08-.88.25-.39.43-.51.79c-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M137,544.7c0,.28.02.54.07.77.04.23.13.43.25.59.12.16.29.28.5.37s.47.14.79.14c.37,0,.71-.12,1.01-.37.3-.24.45-.62.45-1.13,0-.27-.04-.51-.11-.71-.07-.2-.2-.38-.37-.54-.17-.16-.39-.3-.67-.43-.28-.13-.62-.26-1.03-.4-.54-.18-1.01-.38-1.41-.59-.4-.22-.73-.47-1-.76-.27-.29-.46-.62-.59-1-.12-.38-.19-.82-.19-1.32,0-1.2.33-2.1,1-2.69.67-.59,1.59-.88,2.75-.88.54,0,1.05.06,1.5.18s.86.31,1.19.58c.33.27.59.61.78,1.02.19.41.28.91.28,1.49v.34h-2.35c0-.58-.1-1.02-.31-1.33s-.54-.47-1.02-.47c-.27,0-.5.04-.68.12s-.33.18-.43.31c-.11.13-.18.28-.22.45-.04.17-.06.35-.06.53,0,.37.08.69.24.94.16.25.5.49,1.02.71l1.89.82c.46.2.84.42,1.14.64s.53.46.71.71.3.54.37.84c.07.31.1.65.1,1.02,0,1.28-.37,2.21-1.11,2.8s-1.78.88-3.1.88-2.37-.3-2.97-.9-.89-1.46-.89-2.58v-.49h2.45v.36Z"/> <path fill="#3c4e7f" d="M143.3,539.52c.08-.78.27-1.44.56-2,.29-.55.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.28s-1.28.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.28-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54ZM145.68,544.14c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M152.46,535.99h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M160.02,535.99h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M168.73,538.16c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25s-.35.43-.47.8-.19.85-.24,1.44c-.05.6-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.94s.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.11-.57,1.55-.28.44-.67.79-1.17,1.04-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.28c-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54.27-1.44.56-2c.29-.55.71-.99,1.25-1.3s1.27-.47,2.19-.47,1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41.06.5.09.98.09,1.42h-2.45c0-.88-.11-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M172.69,535.99h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M183.63,538h-2.65v10.13h-2.45v-10.13h-2.65v-2.01h7.75v2.01Z"/> <path fill="#3c4e7f" d="M184.38,535.99h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M194,544.31h.03v-8.31h2.24v12.14h-2.79l-2.99-8.5h-.03v8.5h-2.24v-12.14h2.82l2.96,8.31Z"/> <path fill="#3c4e7f" d="M202.87,538.9c-.05-.24-.13-.46-.25-.65s-.26-.36-.43-.49c-.18-.13-.39-.2-.64-.2-.59,0-1.01.33-1.27.99s-.39,1.75-.39,3.26c0,.73.02,1.38.07,1.97.04.59.13,1.09.25,1.5.12.41.29.73.51.95.22.22.51.33.86.33.15,0,.31-.04.48-.12s.34-.2.49-.36c.15-.16.28-.36.38-.6.1-.24.15-.53.15-.86v-1.24h-1.62v-1.8h3.96v6.54h-1.8v-1.12h-.03c-.29.48-.65.81-1.06,1.01s-.91.3-1.49.3c-.75,0-1.36-.13-1.83-.39-.47-.26-.84-.66-1.11-1.21s-.44-1.22-.54-2.01-.14-1.73-.14-2.78.06-1.92.2-2.69c.13-.77.35-1.41.67-1.93s.74-.9,1.26-1.17c.52-.26,1.17-.39,1.95-.39,1.34,0,2.3.33,2.89.99.59.66.88,1.61.88,2.85h-2.35c0-.23-.03-.46-.08-.7Z"/> </g> <g> <path fill="#3c4e7f" d="M162.71,376.77l-.93-.91-53.35-52.08-8.02-7.84-1.13-1.09-.47-.45-.46.45-9.13,8.91-53.37,52.09-.1.1-.64.63-.2.2v99.83h15.08s91.41,0,91.41,0h.67v-99.84H55.76v79.36h65.48v-59.02h-44.62v43.94h-5.78v-49.2h56.16v69.68H49.99v-79.76l48.83-47.67,49,47.84v94.67h15.08v-99.65l-.2-.2ZM91.69,441.05v-28.86h14.46v28.86h-14.46Z"/> <g> <g> <path fill="#3c4e7f" d="M192.07,394.64v13.11c0,.21-.17.37-.37.37h-6.95c-.2,0-.37-.17-.37-.37v-12.75c0-.86-.05-1.86-.41-2.66-.17-.34-.39-.62-.65-.83-.44-.34-1-.51-1.72-.51-1.34,0-2.38.46-2.71,1.2-.38.81-.38,1.91-.38,2.79v12.75c0,.2-.17.37-.37.37h-6.95c-.21,0-.37-.17-.37-.37v-29.9c0-.21.17-.37.37-.37h6.51c.21,0,.37.17.37.37v7.97c0,.15.17.24.29.15,5.25-3.61,10.36.4,10.41.44.19.15.36.3.52.46h0c2.38,2.39,2.78,4.33,2.78,7.76Z"/> <path fill="#3c4e7f" d="M216.84,396.66c0,6.73-5.55,12.2-12.37,12.2s-12.37-5.47-12.37-12.2,5.55-12.2,12.37-12.2,12.37,5.47,12.37,12.2ZM209.86,396.66c0-2.93-2.42-5.32-5.39-5.32s-5.39,2.39-5.39,5.32,2.42,5.32,5.39,5.32,5.39-2.39,5.39-5.32Z"/> <path fill="#3c4e7f" d="M238.11,385.2v22.56c0,.21-.17.37-.37.37h-6.51c-.21,0-.37-.17-.37-.37v-.63c0-.15-.17-.24-.29-.15-1.63,1.12-3.24,1.51-4.69,1.51-3.24,0-5.68-1.92-5.72-1.95-.19-.15-.36-.3-.52-.46h0c-2.38-2.39-2.78-4.33-2.78-7.76v-13.11c0-.21.17-.37.37-.37h6.95c.2,0,.37.17.37.37v12.75c0,.86.05,1.86.41,2.66.17.34.39.62.65.83.44.34,1,.51,1.72.51,1.34,0,2.38-.46,2.71-1.2.38-.81.38-1.91.38-2.79v-12.75c0-.21.17-.37.37-.37h6.95c.2,0,.37.17.37.37Z"/> <path fill="#3c4e7f" d="M257.12,401.18c-.06.82-.27,1.68-.63,2.58-1.39,2.97-4.62,4.73-8.62,4.73-.55,0-1.12-.03-1.69-.1-1.8-.21-3.38-.69-4.69-1.43-1.34-.91-2.37-2.18-3.06-3.79-.09-.22.03-.47.26-.51l6.39-1.37c.15-.03.3.03.39.16.45.67,1.21.99,1.62,1.04.98.12,1.48-.15,1.74-.39.26-.24.37-.57.33-.93-.1-.81-.59-1.18-3.06-2.36h-.03c-.49-.25-1.1-.54-1.79-.88-.47-.2-.93-.42-1.36-.66l-.04-.02c-.06-.04-.12-.07-.19-.11-2.21-1.27-3.51-2.82-3.84-4.6-.48-2.54,1.16-4.7,1.49-5.11.49-.56,1.07-1.05,1.71-1.46,1.94-1.24,4.44-1.75,7.04-1.44,1.56.18,2.97.6,4.2,1.25.59.31,1.13.67,1.61,1.08.33.3,1.38,1.33,1.7,2.91.04.2-.09.4-.29.44l-6.28,1.27c-.18.04-.35-.07-.42-.23-.18-.44-.56-.88-1.39-.97-.55-.07-1.05.1-1.37.45-.24.27-.34.6-.26.87.12.42.55,1.08,2.89,2.04.47.18.89.35,1.32.52.55.2,1.08.41,1.57.62h0c1.49.7,4.94,2.72,4.74,6.39Z"/> <path fill="#3c4e7f" d="M281.45,396.66c0,.67-.08,1.46-.2,2.17-.03.18-.19.31-.37.31h-16.32c-.29,0-.47.32-.32.57,1,1.7,2.8,2.76,4.78,2.76,1.69,0,3.26-.74,4.38-2.17.09-.11.22-.17.36-.14l6.25,1.12c.24.04.38.31.27.53-.14.29-.32.66-.42.84h0s-.1.17-.1.17c-.1.16-.19.32-.31.5-.15.22-.28.41-.41.59l-.08.11h0c-.04.06-.09.11-.13.17l-.07.09c-.09.11-.17.21-.25.31l-.07.09c-.14.16-.28.31-.43.46l-.08.09c-.1.1-.2.2-.3.29l-.03.03c-.11.1-.22.2-.34.3l-.12.11-.14-.12.12.14c-.17.15-.34.28-.5.4l-.14.1c-.19.14-.39.28-.59.41l-.06.04c-.23.15-.46.29-.7.42l-.07.04c-.06.03-.11.06-.17.09l-.04.02c-.11.06-.21.11-.3.15l-.06.03c-.22.11-.43.2-.63.28l-.04.02c-.14.06-.26.1-.39.15l-.15.05c-.15.05-.31.11-.46.15h-.03c-.17.06-.34.11-.54.16l-.14.04c-.36.09-.71.16-1.06.22l-.13.02c-.38.05-.75.09-1.12.11h-.14c-.22.02-.4.02-.57.02s-.36,0-.57-.01c-.04,0-.09,0-.13,0h-.04c-.14-.01-.28-.02-.42-.03h-.04s-.08-.01-.12-.01c-.2-.02-.38-.04-.54-.07h0s0,0,0,0l-.1-.02c-.15-.02-.3-.05-.45-.08l-.16-.03c-.13-.03-.27-.06-.4-.09h-.04s-.08-.03-.12-.04c-.2-.05-.37-.1-.53-.15-.18-.05-.35-.11-.52-.17-.04-.01-.08-.03-.12-.04h-.03c-.13-.06-.25-.11-.37-.16h-.03s-.08-.04-.12-.06c-.17-.07-.33-.14-.49-.22h-.02c-.15-.08-.31-.16-.46-.24-.04-.02-.07-.04-.11-.06l-.03-.02c-.12-.06-.23-.13-.34-.2l-.14-.08c-.15-.09-.3-.19-.45-.28-1.48-.98-2.74-2.29-3.67-3.79-.08-.13-.15-.25-.23-.38l-.03-.06c-.07-.12-.13-.25-.2-.38l-.04-.07s-.04-.08-.06-.11c-.23-.47-.44-.98-.62-1.51-.1-.29-.17-.54-.23-.77-.05-.19-.1-.39-.14-.59-.12-.6-.2-1.22-.23-1.83-.01-.21-.02-.42-.02-.63s0-.42.02-.63c.06-1.08.26-2.16.61-3.19.11-.34.23-.65.35-.93.07-.16.15-.33.22-.49.02-.04.04-.08.06-.11l.05-.09s.04-.08.06-.11c.02-.04.04-.08.06-.12l.11-.2c.09-.15.17-.31.27-.46.92-1.5,2.19-2.81,3.67-3.79.15-.1.3-.19.45-.28l.14-.08c.11-.07.23-.13.34-.2l.03-.02s.07-.04.11-.06c.16-.08.32-.16.48-.24.16-.08.33-.15.49-.22.04-.02.08-.03.12-.05h.03c.12-.06.25-.11.37-.16h.04s.08-.04.12-.06c.17-.06.34-.12.52-.17.18-.05.35-.1.53-.15.04,0,.08-.02.12-.03h.04c.13-.04.27-.07.4-.1l.09-.02c.16-.03.43-.08.59-.11h.03s0,0,0,0h0c.16-.03.34-.05.54-.07.04,0,.08,0,.12-.01h.04c.14-.02.28-.03.42-.03h.03s.09,0,.14-.01c.21,0,.4-.01.57-.01s.35,0,.57.01h.14c.38.03.75.07,1.11.12l.15.02c.35.06.71.13,1.05.21l.15.04c.2.05.37.1.53.15h.03c.16.06.31.11.47.17.05.02.09.03.14.05.14.05.26.1.39.15l.06.02c.2.08.41.18.63.28l.05.03c.11.05.2.1.3.15l.03.02-.08.17.1-.16c.06.03.12.06.17.09.21.12.55.32.75.45l.03.02c.21.14.42.28.61.42l.03.02s.08.06.12.09c.17.13.33.26.51.41l.1.08c.13.11.26.22.38.34l.03.03c.1.09.2.19.3.29l.07.08c.16.16.3.31.43.46l-.12.14.14-.12.07.08c.08.1.17.2.25.29l.08.1c.09.12.19.24.28.36v.02c.09.1.16.2.23.3l.13.2c.06.09.12.18.17.27l.23.38h0c.46.81.83,1.66,1.09,2.53.33,1.12.5,2.28.5,3.45ZM274.15,393.56c-.29-1.72-2.28-3.06-4.8-3.06-2.3,0-4.48,1.33-4.8,3.05-.04.23.13.44.37.44h8.87c.23,0,.41-.21.37-.44Z"/> </g> <path fill="#3c4e7f" d="M198.72,429.29c0,7.21-5.95,13.07-13.26,13.07-2.32,0-4.58-.59-6.58-1.73-.13-.08-.3.02-.3.17v8.63c0,.22-.18.4-.4.4h-6.98c-.22,0-.4-.18-.4-.4v-32.43c0-.22.18-.4.4-.4h6.98c.22,0,.4.18.4.4v.76c0,.15.17.25.3.17,2-1.13,4.26-1.72,6.58-1.72,7.31,0,13.26,5.86,13.26,13.07ZM190.35,429.29c0-3.31-2.73-6-6.08-6s-5.68,2.69-5.68,6,2.33,6,5.68,6,6.08-2.69,6.08-6Z"/> <path fill="#3c4e7f" d="M226.68,417v24.17c0,.22-.18.4-.4.4h-6.98c-.22,0-.4-.18-.4-.4v-.37c0-.15-.17-.25-.3-.17-2,1.13-4.26,1.73-6.58,1.73-7.31,0-13.26-5.86-13.26-13.07s5.95-13.07,13.26-13.07c2.32,0,4.58.59,6.58,1.72.13.08.3-.02.3-.17v-.76c0-.22.18-.4.4-.4h6.98c.22,0,.4.18.4.4ZM218.91,429.28c0-3.31-2.33-6-5.68-6s-6.08,2.69-6.08,6,2.73,6,6.08,6,5.68-2.69,5.68-6Z"/> <path fill="#3c4e7f" d="M241.14,417.03l-.24,5.84c0,.23-.21.4-.43.38-.68-.06-2.05-.15-2.85.04-.9.22-1.42.91-1.57,1.24-.4.86-.4,1.63-.4,2.6v14.05c0,.22-.18.4-.4.4h-7.45c-.22,0-.4-.18-.4-.4v-24.17c0-.22.18-.4.4-.4h6.98c.22,0,.4.18.4.4v.7c0,.16.17.25.3.17,1.65-1.03,3.61-1.24,5.26-1.26.23,0,.41.19.4.42Z"/> <path fill="#3c4e7f" d="M256.53,435.55l-.89,5.91c-.03.19-.18.33-.37.34-.86.05-3.14.18-3.84.18-.06,0-.1,0-.13,0-4.24-.22-6.48-2.4-6.48-6.29v-11.99c0-.22-.18-.4-.4-.4h-2.59c-.22,0-.4-.18-.4-.4v-5.91c0-.22.18-.4.4-.4h2.59c.22,0,.4-.18.4-.4v-6.85c0-.22.18-.4.4-.4h6.98c.22,0,.4.18.4.4v6.85c0,.22.18.4.4.4h2.59c.22,0,.4.18.4.4v5.91c0,.22-.18.4-.4.4h-2.59c-.22,0-.4.18-.4.4,0,2.07,0,8.2,0,8.26v.17c-.03.76-.07,1.8.54,2.42.36.36.91.55,1.65.55h1.36c.24,0,.43.22.39.46Z"/> <path fill="#3c4e7f" d="M281.42,417.14l-7.86,21.84-3.66,10.39c-.06.16-.21.27-.38.27h-7.75c-.27,0-.47-.27-.38-.53l3.04-9c.03-.09.03-.18,0-.26l-8.31-22.7c-.1-.26.1-.54.37-.54h6.95c.17,0,.32.1.37.26l4.55,12.3c.13.35.63.35.75,0l4.19-12.28c.06-.16.21-.27.38-.27h7.35c.28,0,.47.27.37.53Z"/> <path fill="#3c4e7f" d="M198.29,442.9v32.5c0,.22-.18.41-.4.41h-7.08c-.22,0-.4-.18-.4-.41v-.37c0-.16-.17-.25-.3-.17-2.03,1.15-4.32,1.75-6.67,1.75-7.42,0-13.45-5.95-13.45-13.26s6.03-13.26,13.45-13.26c2.35,0,4.64.6,6.67,1.75.14.08.3-.02.3-.17v-8.75c0-.22.18-.4.4-.4h7.08c.22,0,.4.18.4.4ZM190.4,463.34c0-3.35-2.36-6.08-5.76-6.08s-6.17,2.73-6.17,6.08,2.77,6.08,6.17,6.08,5.76-2.73,5.76-6.08Z"/> <path fill="#3c4e7f" d="M206.39,450.49h-7.08c-.23,0-.4.18-.4.4v24.52c0,.22.18.4.4.4h7.08c.23,0,.4-.18.4-.4v-24.52c0-.23-.18-.4-.4-.4ZM206.7,442.66s-.01-.03-.03-.03c-2.39-.17-7.73,3.34-7.66,5.73,0,.01.02.02.03.03.07.07.16.1.27.1h7.08c.23,0,.4-.18.4-.4v-5.17c0-.1-.04-.19-.09-.26Z"/> <path fill="#3c4e7f" d="M226.87,468.26c-.06.89-.29,1.83-.68,2.81-1.52,3.23-5.02,5.15-9.37,5.15-.6,0-1.22-.04-1.84-.11-1.96-.23-3.67-.75-5.09-1.55-1.46-.99-2.58-2.37-3.33-4.12-.1-.23.04-.51.29-.56l6.94-1.49c.16-.04.33.03.42.17.49.73,1.31,1.08,1.76,1.13,1.06.13,1.61-.16,1.89-.42.28-.26.41-.62.36-1.01-.11-.88-.64-1.29-3.32-2.57l-.03-.02c-.53-.26-1.2-.57-1.94-.94-.51-.22-1.01-.46-1.48-.71l-.04-.02c-.07-.04-.13-.08-.2-.12-2.41-1.38-3.81-3.06-4.18-5-.52-2.76,1.26-5.11,1.62-5.55.54-.61,1.16-1.14,1.86-1.59,2.11-1.34,4.82-1.9,7.65-1.57,1.69.2,3.23.66,4.57,1.36.64.33,1.23.73,1.75,1.17.36.32,1.5,1.45,1.85,3.16.04.22-.1.43-.32.47l-6.83,1.38c-.19.04-.38-.07-.45-.25-.19-.48-.61-.95-1.51-1.06-.6-.07-1.14.11-1.49.49-.26.29-.37.65-.29.95.13.45.6,1.18,3.15,2.21.51.2.97.38,1.44.57.59.21,1.17.44,1.7.68h0c1.62.76,5.37,2.95,5.15,6.95Z"/> <path fill="#3c4e7f" d="M241.5,469.7l-.91,5.99c-.03.19-.18.33-.38.34-.87.05-3.19.18-3.9.18-.06,0-.1,0-.14,0-4.3-.23-6.58-2.43-6.58-6.38v-12.16c0-.22-.18-.4-.4-.4h-2.63c-.22,0-.4-.18-.4-.4v-5.99c0-.22.18-.4.4-.4h2.63c.22,0,.4-.18.4-.4v-6.95c0-.22.18-.41.41-.41h7.08c.22,0,.4.18.4.41v6.95c0,.22.18.4.4.4h2.63c.22,0,.4.18.4.4v5.99c0,.22-.18.4-.4.4h-2.63c-.22,0-.4.18-.4.4,0,2.1,0,8.32,0,8.38v.17c-.03.77-.07,1.82.55,2.45.36.37.93.56,1.68.56h1.38c.25,0,.44.22.4.47Z"/> <path fill="#3c4e7f" d="M255.81,450.91l-.24,5.93c0,.23-.21.41-.44.39-.69-.07-2.08-.16-2.9.04-.91.22-1.44.92-1.59,1.26-.41.88-.41,1.65-.41,2.63v14.26c0,.22-.18.4-.4.4h-7.55c-.22,0-.41-.18-.41-.4v-24.52c0-.22.18-.4.41-.4h7.08c.22,0,.4.18.4.4v.71c0,.16.17.26.31.17,1.68-1.04,3.66-1.26,5.33-1.28.23,0,.42.19.41.42Z"/> <path fill="#3c4e7f" d="M281.45,463.35c0,7.31-6.03,13.26-13.45,13.26s-13.45-5.95-13.45-13.26,6.03-13.26,13.45-13.26,13.45,5.95,13.45,13.26ZM273.86,463.35c0-3.19-2.63-5.78-5.86-5.78s-5.86,2.59-5.86,5.78,2.63,5.78,5.86,5.78,5.86-2.59,5.86-5.78Z"/> </g> </g> <g> <polygon fill="gold" points="-522.87 -65.43 -530.78 -73.07 -590.37 -14.89 -593.96 -11.36 -593.96 86.06 -467.37 86.06 -467.37 -11.22 -522.87 -65.43"/> <path fill="#3c4e7f" d="M-476.92-7.44l-.78-.77-44.94-43.87-6.76-6.6-.95-.92-.39-.38-.39.38-7.69,7.51-44.96,43.88-.08.08-.54.53-.17.16v84.1h12.7s77.01,0,77.01,0h.56V-7.44h-72.72V59.42h55.16V9.7h-37.59v37.02h-4.87V5.26h47.31v58.7h-64.87V-3.22l41.14-40.16L-489.45-3.08v79.75h12.7V-7.27l-.17-.17ZM-536.75,46.71v-24.31h12.19v24.31h-12.19Z"/> <g> <g> <path fill="#3c4e7f" d="M-438.28,5.32v13.1c0,.21-.17.37-.37.37h-6.94c-.2,0-.37-.17-.37-.37V5.69c0-.86-.05-1.85-.41-2.65-.17-.34-.39-.62-.65-.83-.43-.34-1-.51-1.72-.51-1.34,0-2.38.46-2.71,1.2-.38.81-.38,1.9-.38,2.79v12.73c0,.2-.17.37-.37.37h-6.94c-.21,0-.37-.17-.37-.37V-11.44c0-.21.17-.37.37-.37h6.5c.21,0,.37.17.37.37V-3.48c0,.15.17.24.29.15,5.24-3.61,10.35.4,10.4.44.19.15.36.3.52.46h0c2.37,2.39,2.77,4.32,2.77,7.75Z"/> <path fill="#3c4e7f" d="M-413.54,7.34c0,6.72-5.54,12.19-12.36,12.19s-12.36-5.47-12.36-12.19,5.54-12.19,12.36-12.19,12.36,5.47,12.36,12.19ZM-420.51,7.34c0-2.93-2.42-5.31-5.39-5.31s-5.39,2.38-5.39,5.31,2.42,5.31,5.39,5.31,5.39-2.38,5.39-5.31Z"/> <path fill="#3c4e7f" d="M-392.29-4.11v22.53c0,.21-.17.37-.37.37h-6.5c-.21,0-.37-.17-.37-.37v-.63c0-.15-.17-.24-.29-.15-1.63,1.12-3.24,1.5-4.69,1.5-3.23,0-5.67-1.92-5.71-1.95-.19-.15-.36-.3-.52-.46h0c-2.37-2.39-2.77-4.32-2.77-7.75V-4.11c0-.21.17-.37.37-.37h6.94c.2,0,.37.17.37.37v12.73c0,.86.05,1.85.41,2.65.17.34.39.62.65.83.43.34,1,.51,1.72.51,1.34,0,2.38-.46,2.71-1.2.38-.81.38-1.9.38-2.79V-4.11c0-.21.17-.37.37-.37h6.94c.2,0,.37.17.37.37Z"/> <path fill="#3c4e7f" d="M-373.3,11.85c-.06.81-.27,1.68-.62,2.58-1.39,2.97-4.61,4.73-8.61,4.73-.55,0-1.12-.03-1.69-.1-1.8-.21-3.38-.69-4.68-1.42-1.34-.91-2.37-2.18-3.06-3.78-.09-.22.03-.46.26-.51l6.38-1.37c.15-.03.3.03.39.16.45.67,1.21.99,1.62,1.04.98.12,1.48-.14,1.73-.39.26-.24.37-.57.33-.93-.1-.81-.59-1.18-3.05-2.36h-.03c-.49-.25-1.1-.54-1.78-.88-.47-.2-.93-.42-1.36-.65l-.04-.02c-.06-.04-.12-.07-.19-.11-2.21-1.27-3.5-2.81-3.84-4.59-.48-2.54,1.16-4.7,1.49-5.1.49-.56,1.07-1.05,1.71-1.46,1.93-1.23,4.43-1.75,7.03-1.44,1.56.18,2.97.6,4.2,1.25.58.31,1.13.67,1.61,1.08.33.3,1.38,1.33,1.7,2.91.04.2-.09.4-.29.44l-6.28,1.27c-.18.04-.35-.06-.42-.23-.18-.44-.56-.88-1.39-.97-.55-.06-1.05.1-1.37.45-.24.27-.34.6-.26.87.12.42.55,1.08,2.89,2.03.47.18.89.35,1.32.52.55.19,1.07.4,1.57.62h0c1.49.7,4.94,2.71,4.73,6.39Z"/> <path fill="#3c4e7f" d="M-349,7.34c0,.67-.08,1.46-.2,2.16-.03.18-.19.31-.37.31h-16.3c-.29,0-.47.32-.32.56,1,1.7,2.8,2.76,4.78,2.76,1.68,0,3.26-.74,4.37-2.17.09-.11.22-.17.36-.14l6.24,1.12c.24.04.38.3.27.53-.14.29-.32.66-.42.84h0s-.1.17-.1.17c-.1.16-.19.32-.31.5-.15.22-.28.41-.41.59l-.08.11h0c-.04.06-.09.11-.13.17l-.07.09c-.09.11-.17.21-.25.3l-.07.09c-.14.16-.27.3-.43.46l-.08.09c-.1.1-.2.19-.3.29l-.03.03c-.11.1-.22.2-.33.3l-.12.11-.14-.12.12.14c-.17.15-.34.28-.5.4l-.14.1c-.19.14-.39.28-.59.41l-.06.04c-.23.15-.46.29-.7.42l-.07.04c-.06.03-.11.06-.17.09l-.04.02c-.11.06-.21.11-.3.15l-.06.03c-.22.11-.43.2-.63.28l-.04.02c-.14.06-.26.1-.39.15l-.15.05c-.15.05-.31.11-.46.15h-.03c-.17.06-.34.11-.54.16l-.14.04c-.36.09-.71.16-1.06.22l-.13.02c-.37.05-.75.09-1.11.11h-.14c-.22.02-.4.02-.57.02s-.36,0-.57-.01c-.04,0-.09,0-.13,0h-.04c-.14-.01-.28-.02-.42-.03h-.04s-.08-.01-.12-.01c-.2-.02-.38-.04-.54-.07h0s0,0,0,0l-.1-.02c-.15-.02-.3-.05-.45-.08l-.16-.03c-.13-.03-.27-.06-.4-.09h-.04s-.08-.03-.12-.04c-.2-.05-.37-.1-.53-.15-.18-.05-.35-.11-.52-.17-.04-.01-.08-.03-.12-.04h-.03c-.13-.06-.25-.11-.37-.16h-.03s-.08-.04-.12-.06c-.17-.07-.33-.14-.49-.22h-.02c-.15-.08-.31-.16-.46-.24-.04-.02-.07-.04-.11-.06l-.03-.02c-.12-.06-.23-.13-.34-.19l-.14-.08c-.15-.09-.3-.19-.45-.28-1.47-.98-2.74-2.29-3.66-3.79-.08-.13-.15-.25-.23-.38l-.03-.06c-.07-.12-.13-.25-.2-.38l-.04-.07s-.04-.08-.06-.11c-.23-.47-.44-.98-.62-1.5-.1-.29-.17-.54-.23-.77-.05-.19-.1-.39-.14-.59-.12-.6-.2-1.21-.23-1.83-.01-.21-.02-.42-.02-.63s0-.42.02-.63c.06-1.08.26-2.15.61-3.19.11-.34.23-.65.35-.93.07-.16.15-.32.22-.48.02-.04.04-.08.06-.11l.05-.09s.04-.08.06-.11c.02-.04.04-.08.06-.12l.11-.2c.09-.15.17-.31.27-.46.92-1.5,2.19-2.81,3.66-3.79.15-.1.3-.19.45-.28l.14-.08c.11-.07.23-.13.34-.2l.03-.02s.07-.04.11-.06c.16-.08.32-.16.48-.24.16-.08.33-.15.49-.22.04-.02.08-.03.12-.05h.03c.12-.06.25-.11.37-.16h.04s.08-.04.12-.06c.17-.06.34-.12.52-.17.18-.05.35-.1.53-.15.04,0,.08-.02.12-.03h.04c.13-.04.27-.07.4-.1l.09-.02c.16-.03.42-.08.59-.11h.03s0,0,0,0h0c.16-.03.34-.05.54-.07.04,0,.08,0,.12-.01h.04c.14-.02.28-.03.42-.03h.03s.09,0,.14-.01c.21,0,.4-.01.57-.01s.35,0,.56.01h.14c.37.03.75.07,1.11.12l.15.02c.35.06.71.13,1.05.21l.15.04c.2.05.37.1.53.15h.03c.16.06.31.11.47.17.05.02.09.03.14.05.14.05.26.1.39.15l.06.02c.2.08.41.18.63.28l.05.03c.11.05.2.1.3.15l.03.02-.08.17.1-.16c.06.03.12.06.17.09.21.12.55.32.75.45l.03.02c.21.14.42.28.61.42l.03.02s.08.06.12.09c.17.13.33.26.51.41l.1.08c.13.11.26.22.38.34l.03.03c.1.09.2.19.3.29l.07.08c.16.16.3.31.42.46l-.12.14.14-.12.06.08c.08.1.17.19.25.29l.08.1c.09.12.19.24.28.36v.02c.09.1.16.2.23.3l.13.2c.06.09.12.18.17.27l.23.38h0c.46.81.83,1.66,1.09,2.53.33,1.12.5,2.28.5,3.44ZM-356.29,4.25c-.29-1.71-2.27-3.05-4.8-3.05-2.29,0-4.47,1.33-4.8,3.05-.04.23.13.44.37.44h8.86c.23,0,.41-.21.37-.44Z"/> </g> <path fill="#3c4e7f" d="M-431.64,39.93c0,7.2-5.94,13.06-13.24,13.06-2.32,0-4.57-.59-6.57-1.72-.13-.08-.3.02-.3.17v8.62c0,.22-.18.4-.4.4h-6.97c-.22,0-.4-.18-.4-.4V27.67c0-.22.18-.4.4-.4h6.97c.22,0,.4.18.4.4v.76c0,.15.17.25.3.17,2-1.13,4.26-1.72,6.57-1.72,7.3,0,13.24,5.86,13.24,13.06ZM-440,39.93c0-3.3-2.72-5.99-6.07-5.99s-5.67,2.69-5.67,5.99,2.33,5.99,5.67,5.99,6.07-2.69,6.07-5.99Z"/> <path fill="#3c4e7f" d="M-403.71,27.65v24.14c0,.22-.18.4-.4.4h-6.97c-.22,0-.4-.18-.4-.4v-.37c0-.15-.17-.25-.3-.17-2,1.13-4.26,1.72-6.57,1.72-7.3,0-13.24-5.86-13.24-13.06s5.94-13.06,13.24-13.06c2.32,0,4.57.59,6.57,1.72.13.08.3-.02.3-.17v-.76c0-.22.18-.4.4-.4h6.97c.22,0,.4.18.4.4ZM-411.47,39.92c0-3.3-2.33-5.99-5.68-5.99s-6.07,2.69-6.07,5.99,2.72,5.99,6.07,5.99,5.68-2.69,5.68-5.99Z"/> <path fill="#3c4e7f" d="M-389.26,27.69l-.24,5.83c0,.23-.21.4-.43.38-.68-.06-2.05-.15-2.85.04-.9.22-1.42.91-1.56,1.24-.4.86-.4,1.63-.4,2.59v14.04c0,.22-.18.4-.4.4h-7.44c-.22,0-.4-.18-.4-.4v-24.15c0-.22.18-.4.4-.4h6.97c.22,0,.4.18.4.4v.7c0,.16.17.25.3.17,1.65-1.03,3.61-1.24,5.25-1.26.23,0,.41.19.4.41Z"/> <path fill="#3c4e7f" d="M-373.89,46.19l-.89,5.9c-.03.19-.18.33-.37.34-.86.05-3.14.18-3.84.18-.06,0-.1,0-.13,0-4.23-.22-6.47-2.4-6.47-6.28v-11.97c0-.22-.18-.4-.4-.4h-2.59c-.22,0-.4-.18-.4-.4v-5.9c0-.22.18-.4.4-.4h2.59c.22,0,.4-.18.4-.4v-6.84c0-.22.18-.4.4-.4h6.97c.22,0,.4.18.4.4v6.84c0,.22.18.4.4.4h2.59c.22,0,.4.18.4.4v5.9c0,.22-.18.4-.4.4h-2.59c-.22,0-.4.18-.4.4,0,2.07,0,8.19,0,8.25v.17c-.03.76-.07,1.8.54,2.42.36.36.91.55,1.65.55h1.36c.24,0,.43.22.39.46Z"/> <path fill="#3c4e7f" d="M-349.03,27.8l-7.85,21.82-3.65,10.38c-.06.16-.21.27-.38.27h-7.75c-.27,0-.47-.27-.38-.53l3.03-8.99c.03-.09.03-.18,0-.26l-8.3-22.68c-.1-.26.1-.54.37-.54h6.94c.17,0,.32.1.37.26l4.55,12.29c.13.35.63.35.75,0l4.19-12.27c.06-.16.21-.27.38-.27h7.34c.28,0,.47.27.37.53Z"/> <path fill="#3c4e7f" d="M-432.07,53.53v32.46c0,.22-.18.4-.4.4h-7.07c-.22,0-.4-.18-.4-.4v-.37c0-.16-.17-.25-.3-.17-2.03,1.15-4.32,1.75-6.67,1.75-7.41,0-13.44-5.94-13.44-13.25s6.03-13.25,13.44-13.25c2.35,0,4.64.6,6.67,1.75.14.08.3-.02.3-.17v-8.74c0-.22.18-.4.4-.4h7.07c.22,0,.4.18.4.4ZM-439.95,73.95c0-3.35-2.36-6.08-5.76-6.08s-6.16,2.73-6.16,6.08,2.76,6.08,6.16,6.08,5.76-2.73,5.76-6.08Z"/> <path fill="#3c4e7f" d="M-423.98,61.11h-7.07c-.23,0-.4.18-.4.4v24.5c0,.22.18.4.4.4h7.07c.23,0,.4-.18.4-.4v-24.5c0-.23-.18-.4-.4-.4ZM-423.67,53.29s-.01-.03-.03-.03c-2.38-.17-7.72,3.34-7.65,5.73,0,.01.02.02.03.03.07.07.16.1.27.1h7.07c.23,0,.4-.18.4-.4v-5.17c0-.1-.04-.19-.09-.26Z"/> <path fill="#3c4e7f" d="M-403.52,78.87c-.06.89-.29,1.83-.68,2.8-1.51,3.22-5.01,5.14-9.36,5.14-.6,0-1.22-.04-1.84-.11-1.96-.23-3.67-.75-5.09-1.55-1.46-.99-2.57-2.37-3.32-4.11-.1-.23.04-.51.29-.56l6.93-1.49c.16-.04.33.03.42.17.49.73,1.31,1.08,1.76,1.13,1.06.13,1.61-.16,1.89-.42.28-.26.4-.62.36-1.01-.11-.88-.64-1.28-3.32-2.56l-.03-.02c-.53-.26-1.2-.57-1.94-.94-.51-.22-1.01-.46-1.48-.71l-.04-.02c-.07-.04-.13-.08-.2-.12-2.41-1.38-3.81-3.06-4.17-4.99-.52-2.76,1.26-5.11,1.62-5.55.54-.61,1.16-1.14,1.86-1.58,2.1-1.34,4.82-1.9,7.64-1.57,1.69.2,3.23.65,4.56,1.36.64.33,1.22.73,1.75,1.17.36.32,1.5,1.44,1.84,3.16.04.22-.1.43-.32.47l-6.82,1.38c-.19.04-.38-.07-.45-.25-.19-.48-.61-.95-1.51-1.06-.6-.07-1.14.11-1.48.49-.26.29-.37.65-.29.95.13.45.6,1.17,3.14,2.21.51.2.97.38,1.44.57.59.21,1.17.44,1.7.68h0c1.62.76,5.37,2.95,5.14,6.94Z"/> <path fill="#3c4e7f" d="M-388.9,80.3l-.91,5.99c-.03.19-.18.33-.38.34-.87.05-3.19.18-3.89.18-.06,0-.1,0-.14,0-4.3-.23-6.57-2.43-6.57-6.38v-12.15c0-.22-.18-.4-.4-.4h-2.63c-.22,0-.4-.18-.4-.4v-5.99c0-.22.18-.4.4-.4h2.63c.22,0,.4-.18.4-.4v-6.94c0-.22.18-.4.4-.4h7.07c.22,0,.4.18.4.4v6.94c0,.22.18.4.4.4h2.63c.22,0,.4.18.4.4v5.99c0,.22-.18.4-.4.4h-2.63c-.22,0-.4.18-.4.4,0,2.1,0,8.31,0,8.37v.17c-.03.77-.07,1.82.55,2.45.36.37.92.56,1.67.56h1.38c.25,0,.44.22.4.46Z"/> <path fill="#3c4e7f" d="M-374.62,61.53l-.24,5.92c0,.23-.21.41-.44.39-.69-.06-2.08-.16-2.89.04-.91.22-1.44.92-1.59,1.26-.41.88-.41,1.65-.41,2.63v14.24c0,.22-.18.4-.4.4h-7.55c-.22,0-.4-.18-.4-.4v-24.5c0-.22.18-.4.4-.4h7.07c.22,0,.4.18.4.4v.71c0,.16.17.26.31.17,1.68-1.04,3.66-1.26,5.33-1.28.23,0,.42.19.41.42Z"/> <path fill="#3c4e7f" d="M-349,73.96c0,7.31-6.03,13.25-13.43,13.25s-13.44-5.94-13.44-13.25,6.03-13.25,13.44-13.25,13.43,5.94,13.43,13.25ZM-356.58,73.96c0-3.18-2.63-5.78-5.86-5.78s-5.86,2.59-5.86,5.78,2.63,5.78,5.86,5.78,5.86-2.59,5.86-5.78Z"/> </g> </g> <g> <path fill="#3c4e7f" d="M-525.94,128.29c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25-.2.16-.35.43-.47.8-.11.37-.19.85-.24,1.44s-.07,1.32-.07,2.18c0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.22,0,.42-.04.6-.11s.35-.22.48-.44c.14-.22.24-.53.32-.93.08-.4.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87s-.29,1.1-.57,1.55-.67.79-1.17,1.04c-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44-.54-.29-.96-.72-1.25-1.27-.29-.56-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.77.13-2.54c.08-.78.27-1.44.56-2,.29-.56.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41.06.5.09.98.09,1.42h-2.45c0-.88-.1-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M-522.11,126.12h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M-514.79,129.65c.08-.78.27-1.44.56-2,.29-.56.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47c.54.31.96.75,1.25,1.3s.48,1.22.56,2,.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99s-.71.98-1.25,1.27-1.27.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.27-.29-.56-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.77.13-2.54ZM-512.41,134.28c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M-503.66,134.83c0,.28.02.54.07.77.04.23.13.43.25.59.12.16.29.28.5.37.21.09.47.14.79.14.37,0,.71-.12,1.01-.37.3-.24.45-.62.45-1.13,0-.27-.04-.51-.11-.71-.07-.2-.2-.38-.37-.54s-.39-.3-.67-.43-.62-.26-1.03-.4c-.54-.18-1.01-.38-1.41-.6-.4-.22-.73-.47-.99-.76s-.46-.62-.59-1c-.12-.38-.19-.82-.19-1.32,0-1.2.33-2.1,1-2.69.67-.59,1.59-.88,2.75-.88.54,0,1.05.06,1.5.18.46.12.86.31,1.19.58.33.27.59.61.78,1.02.19.41.28.91.28,1.49v.34h-2.35c0-.58-.1-1.02-.31-1.33-.2-.31-.54-.47-1.02-.47-.27,0-.5.04-.68.12-.18.08-.33.18-.43.31-.11.13-.18.28-.22.45-.04.17-.06.35-.06.53,0,.37.08.69.24.94.16.26.5.49,1.02.71l1.89.82c.46.2.84.42,1.14.64s.53.46.71.71c.18.26.3.54.37.84.07.31.1.65.1,1.02,0,1.28-.37,2.21-1.11,2.8-.74.58-1.78.88-3.1.88s-2.37-.3-2.97-.9c-.6-.6-.89-1.46-.89-2.58v-.49h2.45v.36Z"/> <path fill="#3c4e7f" d="M-490.45,128.13h-4.33v2.86h4.08v2.01h-4.08v3.26h4.51v2.01h-6.95v-12.14h6.78v2.01Z"/> <path fill="#3c4e7f" d="M-485.35,126.12c.85,0,1.54.14,2.06.42.52.28.93.67,1.22,1.19.29.52.48,1.14.59,1.86.1.73.15,1.54.15,2.43,0,1.07-.07,1.99-.2,2.78s-.35,1.44-.67,1.95c-.32.51-.74.89-1.27,1.14-.53.25-1.21.37-2.02.37h-3.86v-12.14h4.01ZM-485.83,136.46c.43,0,.78-.07,1.04-.22.26-.15.47-.39.62-.73.15-.34.25-.79.31-1.34.05-.56.08-1.25.08-2.07,0-.69-.02-1.3-.07-1.82-.05-.52-.14-.95-.28-1.3s-.35-.61-.63-.78-.65-.26-1.11-.26h-1.04v8.53h1.09Z"/> <path fill="#3c4e7f" d="M-470.02,128.13h-2.65v10.13h-2.45v-10.13h-2.65v-2.01h7.75v2.01Z"/> <path fill="#3c4e7f" d="M-469.52,129.65c.08-.78.27-1.44.56-2s.71-.99,1.25-1.3c.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47c.54.31.96.75,1.25,1.3.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.27s-1.28.44-2.19.44-1.65-.15-2.19-.44-.96-.72-1.25-1.27-.48-1.22-.56-1.99c-.08-.77-.13-1.62-.13-2.55s.04-1.77.13-2.54ZM-467.14,134.28c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.66-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M-452.43,126.12c.62,0,1.15.1,1.57.31.43.21.77.48,1.03.82.26.34.45.73.56,1.16.11.44.17.88.17,1.33,0,.62-.09,1.17-.28,1.63-.19.46-.45.84-.78,1.14-.33.29-.74.52-1.21.66-.48.15-1,.22-1.58.22h-1.31v4.85h-2.45v-12.14h4.28ZM-453.17,131.61c.49,0,.88-.15,1.18-.44.3-.29.45-.75.45-1.38s-.13-1.08-.39-1.39-.7-.48-1.31-.48h-1.02v3.69h1.09Z"/> <path fill="#3c4e7f" d="M-446.02,134.59c0,.31.02.59.06.84.04.25.11.48.22.66.11.19.25.33.44.44.19.11.42.16.71.16s.53-.05.71-.16c.18-.11.33-.25.43-.44.11-.19.18-.41.22-.66s.06-.54.06-.84v-8.47h2.45v8.47c0,.77-.11,1.41-.32,1.91-.22.5-.5.9-.87,1.2-.36.29-.78.49-1.24.6-.46.1-.95.15-1.44.15s-.98-.04-1.45-.14c-.46-.09-.88-.27-1.24-.55-.36-.28-.65-.67-.87-1.18-.21-.51-.32-1.17-.32-1.99v-8.47h2.45v8.47Z"/> <path fill="#3c4e7f" d="M-435.49,126.12c.5,0,.96.05,1.38.15.43.1.79.27,1.1.51.31.24.54.56.71.95.17.4.26.88.26,1.46,0,.66-.15,1.22-.46,1.69-.31.47-.77.79-1.38.96v.03c.68.09,1.22.38,1.62.87s.6,1.14.6,1.95c0,.48-.06.93-.19,1.36s-.34.81-.64,1.13c-.3.32-.69.58-1.17.77-.48.19-1.08.29-1.79.29h-4.13v-12.14h4.1ZM-436.45,131.1c.68,0,1.18-.12,1.49-.37s.47-.65.47-1.23-.14-.99-.42-1.22c-.28-.24-.73-.36-1.34-.36h-.88v3.18h.7ZM-436.19,136.46c.59,0,1.07-.13,1.43-.39.36-.26.54-.74.54-1.45,0-.35-.05-.64-.14-.88-.1-.23-.23-.42-.39-.56-.16-.14-.36-.24-.59-.3-.23-.06-.48-.08-.75-.08h-1.05v3.66h.95Z"/> <path fill="#3c4e7f" d="M-430.56,126.12h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M-423,126.12h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M-414.29,128.29c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25-.2.16-.35.43-.47.8s-.19.85-.24,1.44c-.05.6-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.93s.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.1-.57,1.55s-.67.79-1.17,1.04c-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.27-.48-1.22-.56-1.99c-.08-.77-.13-1.62-.13-2.55s.04-1.77.13-2.54.27-1.44.56-2,.71-.99,1.25-1.3c.54-.31,1.27-.47,2.19-.47s1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41.06.5.09.98.09,1.42h-2.45c0-.88-.11-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M-511.64,154.84h.03v-8.31h2.24v12.14h-2.79l-2.99-8.5h-.03v8.5h-2.24v-12.14h2.82l2.96,8.31Z"/> <path fill="#3c4e7f" d="M-508.21,150.05c.08-.78.27-1.44.56-2,.29-.55.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.28s-1.27.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.28-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54ZM-505.83,154.68c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M-493.43,155.23c0,.28.02.54.07.77.04.23.13.43.25.59.12.16.29.28.5.37.21.09.47.14.79.14.37,0,.71-.12,1.01-.37.3-.24.45-.62.45-1.13,0-.27-.04-.51-.11-.71s-.2-.38-.37-.54c-.17-.16-.39-.3-.67-.43s-.62-.26-1.03-.4c-.54-.18-1.01-.38-1.41-.59-.4-.22-.73-.47-.99-.76s-.46-.62-.59-1c-.12-.38-.19-.82-.19-1.32,0-1.2.33-2.1,1-2.69.67-.59,1.59-.88,2.75-.88.54,0,1.05.06,1.5.18s.86.31,1.19.58c.33.27.59.61.78,1.02.19.41.28.91.28,1.49v.34h-2.35c0-.58-.1-1.02-.31-1.33-.2-.31-.54-.47-1.02-.47-.27,0-.5.04-.68.12-.18.08-.33.18-.43.31-.11.13-.18.28-.22.45-.04.17-.06.35-.06.53,0,.37.08.69.24.94s.5.49,1.02.71l1.89.82c.46.2.84.42,1.14.64s.53.46.71.71.3.54.37.84c.07.31.1.65.1,1.02,0,1.28-.37,2.21-1.11,2.8s-1.78.88-3.1.88-2.37-.3-2.97-.9c-.6-.6-.89-1.46-.89-2.58v-.49h2.45v.36Z"/> <path fill="#3c4e7f" d="M-487.13,150.05c.08-.78.27-1.44.56-2,.29-.55.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.28s-1.27.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.28-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54ZM-484.75,154.68c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#3c4e7f" d="M-477.98,146.52h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#3c4e7f" d="M-470.41,146.52h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M-461.7,148.69c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25s-.35.43-.47.8-.19.85-.24,1.44c-.05.6-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.94s.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.11-.57,1.55-.28.44-.67.79-1.17,1.04-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.28c-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54.27-1.44.56-2c.29-.55.71-.99,1.25-1.3s1.27-.47,2.19-.47,1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41.06.5.09.98.09,1.42h-2.45c0-.88-.11-1.53-.31-1.93Z"/> <path fill="#3c4e7f" d="M-457.75,146.52h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M-446.8,148.53h-2.65v10.13h-2.45v-10.13h-2.65v-2.01h7.75v2.01Z"/> <path fill="#3c4e7f" d="M-446.05,146.52h2.45v12.14h-2.45v-12.14Z"/> <path fill="#3c4e7f" d="M-436.43,154.84h.03v-8.31h2.24v12.14h-2.79l-2.99-8.5h-.03v8.5h-2.24v-12.14h2.82l2.96,8.31Z"/> <path fill="#3c4e7f" d="M-427.56,149.43c-.05-.24-.13-.46-.25-.65s-.26-.36-.43-.49c-.18-.13-.39-.2-.64-.2-.59,0-1.01.33-1.27.99s-.39,1.75-.39,3.26c0,.73.02,1.38.07,1.97.04.59.13,1.09.25,1.5.12.41.29.73.51.95.22.22.51.33.86.33.15,0,.31-.04.48-.12s.34-.2.49-.36c.15-.16.28-.36.38-.6.1-.24.15-.53.15-.86v-1.24h-1.62v-1.8h3.96v6.54h-1.8v-1.12h-.03c-.29.48-.65.81-1.06,1.01s-.91.3-1.49.3c-.75,0-1.36-.13-1.83-.39-.47-.26-.84-.66-1.11-1.21s-.44-1.22-.54-2.01-.14-1.73-.14-2.78.06-1.92.2-2.69c.13-.77.35-1.41.67-1.93s.74-.9,1.26-1.17c.52-.26,1.17-.39,1.95-.39,1.34,0,2.3.33,2.89.99.59.66.88,1.61.88,2.85h-2.35c0-.23-.03-.46-.08-.7Z"/> </g> <rect fill="#3c4e7f" x="-669.43" y="129.12" width="396" height="612" transform="translate(-36.31 906.55) rotate(90)"/> <g> <path fill="#ffffff" d="M-525.89,517.76c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25s-.35.43-.47.8c-.11.37-.19.85-.24,1.45-.05.59-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.22,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.93.08-.4.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.1-.57,1.55-.28.44-.67.79-1.17,1.04s-1.16.37-1.96.37c-.92,0-1.65-.15-2.19-.44-.54-.29-.96-.72-1.25-1.27-.29-.56-.48-1.22-.56-1.99s-.13-1.62-.13-2.55.04-1.77.13-2.54.27-1.44.56-2c.29-.56.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.56.14,2.07.42c.5.28.88.64,1.13,1.08s.41.91.47,1.41c.06.5.09.98.09,1.42h-2.45c0-.88-.1-1.53-.31-1.93Z"/> <path fill="#ffffff" d="M-522.06,515.59h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#ffffff" d="M-514.74,519.12c.08-.78.27-1.44.56-2,.29-.56.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.55.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55-.27,1.43-.56,1.99c-.29.55-.71.98-1.25,1.27s-1.27.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.27-.29-.56-.48-1.22-.56-1.99s-.13-1.62-.13-2.55.04-1.77.13-2.54ZM-512.36,523.74c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.17.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#ffffff" d="M-503.61,524.3c0,.28.02.54.07.77.04.23.13.43.25.59.12.16.29.28.5.37.21.09.47.14.79.14.37,0,.71-.12,1.01-.37.3-.24.45-.62.45-1.13,0-.27-.04-.51-.11-.71-.07-.2-.2-.38-.37-.54-.17-.16-.39-.3-.67-.43-.28-.13-.62-.26-1.03-.4-.54-.18-1.01-.38-1.41-.59-.4-.22-.73-.47-.99-.76s-.46-.62-.59-1c-.12-.38-.19-.82-.19-1.32,0-1.2.33-2.1,1-2.69.67-.59,1.59-.88,2.75-.88.54,0,1.05.06,1.5.18s.86.31,1.19.58c.33.27.59.61.78,1.02.19.41.28.91.28,1.49v.34h-2.35c0-.58-.1-1.02-.31-1.33-.2-.31-.54-.47-1.02-.47-.27,0-.5.04-.68.12-.18.08-.33.18-.43.31-.11.13-.18.28-.22.45-.04.17-.06.35-.06.53,0,.37.08.69.24.94.16.26.5.49,1.02.71l1.89.82c.46.2.84.42,1.14.64.29.22.53.46.71.71.18.26.3.54.37.84.07.31.1.65.1,1.02,0,1.28-.37,2.21-1.11,2.8-.74.58-1.78.88-3.1.88s-2.37-.3-2.97-.9c-.6-.6-.89-1.46-.89-2.58v-.49h2.45v.36Z"/> <path fill="#ffffff" d="M-490.4,517.6h-4.33v2.86h4.08v2.01h-4.08v3.26h4.51v2.01h-6.95v-12.14h6.78v2.01Z"/> <path fill="#ffffff" d="M-485.3,515.59c.85,0,1.54.14,2.06.42.52.28.93.67,1.22,1.19s.48,1.14.59,1.86c.1.73.15,1.54.15,2.43,0,1.07-.07,1.99-.2,2.78-.13.79-.35,1.44-.67,1.95s-.74.89-1.27,1.14c-.53.25-1.21.37-2.02.37h-3.86v-12.14h4.01ZM-485.78,525.93c.43,0,.78-.07,1.04-.22s.47-.39.62-.73c.15-.34.25-.79.31-1.34.05-.56.08-1.25.08-2.07,0-.69-.02-1.3-.07-1.82-.05-.52-.14-.95-.28-1.3s-.35-.61-.63-.78-.65-.26-1.11-.26h-1.04v8.53h1.09Z"/> <path fill="#ffffff" d="M-469.97,517.6h-2.65v10.13h-2.45v-10.13h-2.65v-2.01h7.75v2.01Z"/> <path fill="#ffffff" d="M-469.47,519.12c.08-.78.27-1.44.56-2,.29-.56.71-.99,1.25-1.3s1.27-.47,2.19-.47,1.65.16,2.19.47c.54.31.96.75,1.25,1.3.29.55.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55-.27,1.43-.56,1.99c-.29.55-.71.98-1.25,1.27-.54.29-1.28.44-2.19.44s-1.65-.15-2.19-.44-.96-.72-1.25-1.27c-.29-.56-.48-1.22-.56-1.99s-.13-1.62-.13-2.55.04-1.77.13-2.54ZM-467.09,523.74c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.17.51.25.88.25s.66-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79s-.51-.25-.88-.25-.65.08-.88.25-.39.43-.51.79c-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#ffffff" d="M-452.37,515.59c.62,0,1.15.1,1.57.31.43.21.77.48,1.03.82.26.34.45.73.56,1.17s.17.88.17,1.33c0,.62-.09,1.17-.28,1.63-.19.46-.45.84-.78,1.14s-.74.52-1.21.66c-.48.15-1,.22-1.58.22h-1.31v4.84h-2.45v-12.14h4.28ZM-453.12,521.08c.49,0,.88-.15,1.18-.44.3-.29.45-.75.45-1.38s-.13-1.08-.39-1.39-.7-.48-1.31-.48h-1.02v3.69h1.09Z"/> <path fill="#ffffff" d="M-445.96,524.06c0,.31.02.59.06.84.04.25.11.48.22.66.11.19.25.33.44.44.19.11.42.16.71.16s.53-.05.71-.16c.18-.11.33-.25.43-.44.11-.19.18-.41.22-.66s.06-.54.06-.84v-8.47h2.45v8.47c0,.77-.11,1.41-.32,1.91-.22.5-.5.9-.87,1.2s-.78.49-1.24.59-.95.15-1.44.15-.98-.04-1.45-.14c-.46-.09-.88-.27-1.24-.55-.36-.28-.65-.67-.87-1.18-.21-.51-.32-1.17-.32-1.99v-8.47h2.45v8.47Z"/> <path fill="#ffffff" d="M-435.44,515.59c.5,0,.96.05,1.38.15.43.1.79.27,1.1.51.31.24.54.56.71.95.17.4.26.88.26,1.46,0,.66-.15,1.22-.46,1.69-.31.47-.77.79-1.38.96v.03c.68.09,1.22.38,1.62.87s.6,1.14.6,1.96c0,.48-.06.93-.19,1.36s-.34.81-.64,1.13c-.3.32-.69.58-1.17.77-.48.19-1.08.29-1.79.29h-4.13v-12.14h4.1ZM-436.39,520.57c.68,0,1.18-.12,1.49-.37.31-.24.47-.65.47-1.23s-.14-.99-.42-1.22c-.28-.24-.73-.36-1.34-.36h-.88v3.18h.7ZM-436.14,525.93c.59,0,1.07-.13,1.43-.39.36-.26.54-.74.54-1.45,0-.35-.05-.64-.14-.88-.1-.23-.23-.42-.39-.56s-.36-.24-.59-.3c-.23-.06-.48-.08-.75-.08h-1.05v3.66h.95Z"/> <path fill="#ffffff" d="M-430.51,515.59h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#ffffff" d="M-422.95,515.59h2.45v12.14h-2.45v-12.14Z"/> <path fill="#ffffff" d="M-414.23,517.76c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25-.2.16-.35.43-.47.8s-.19.85-.24,1.45c-.05.59-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.93s.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.1-.57,1.55-.28.44-.67.79-1.17,1.04s-1.16.37-1.96.37c-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.27c-.29-.56-.48-1.22-.56-1.99s-.13-1.62-.13-2.55.04-1.77.13-2.54.27-1.44.56-2c.29-.56.71-.99,1.25-1.3s1.27-.47,2.19-.47,1.56.14,2.07.42c.5.28.88.64,1.13,1.08s.41.91.47,1.41c.06.5.09.98.09,1.42h-2.45c0-.88-.11-1.53-.31-1.93Z"/> <path fill="#ffffff" d="M-511.58,544.31h.03v-8.31h2.24v12.14h-2.79l-2.99-8.5h-.03v8.5h-2.24v-12.14h2.82l2.96,8.31Z"/> <path fill="#ffffff" d="M-508.16,539.52c.08-.78.27-1.44.56-2,.29-.55.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.28s-1.27.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.28-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54ZM-505.78,544.14c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#ffffff" d="M-493.38,544.7c0,.28.02.54.07.77.04.23.13.43.25.59.12.16.29.28.5.37.21.09.47.14.79.14.37,0,.71-.12,1.01-.37.3-.24.45-.62.45-1.13,0-.27-.04-.51-.11-.71s-.2-.38-.37-.54c-.17-.16-.39-.3-.67-.43s-.62-.26-1.03-.4c-.54-.18-1.01-.38-1.41-.59-.4-.22-.73-.47-.99-.76s-.46-.62-.59-1c-.12-.38-.19-.82-.19-1.32,0-1.2.33-2.1,1-2.69.67-.59,1.59-.88,2.75-.88.54,0,1.05.06,1.5.18s.86.31,1.19.58c.33.27.59.61.78,1.02.19.41.28.91.28,1.49v.34h-2.35c0-.58-.1-1.02-.31-1.33-.2-.31-.54-.47-1.02-.47-.27,0-.5.04-.68.12-.18.08-.33.18-.43.31-.11.13-.18.28-.22.45-.04.17-.06.35-.06.53,0,.37.08.69.24.94s.5.49,1.02.71l1.89.82c.46.2.84.42,1.14.64s.53.46.71.71.3.54.37.84c.07.31.1.65.1,1.02,0,1.28-.37,2.21-1.11,2.8s-1.78.88-3.1.88-2.37-.3-2.97-.9c-.6-.6-.89-1.46-.89-2.58v-.49h2.45v.36Z"/> <path fill="#ffffff" d="M-487.08,539.52c.08-.78.27-1.44.56-2,.29-.55.71-.99,1.25-1.3.54-.31,1.27-.47,2.19-.47s1.65.16,2.19.47.96.75,1.25,1.3c.29.56.48,1.22.56,2s.13,1.62.13,2.54-.04,1.78-.13,2.55c-.08.77-.27,1.43-.56,1.99-.29.56-.71.98-1.25,1.28s-1.27.44-2.19.44-1.65-.15-2.19-.44c-.54-.29-.96-.72-1.25-1.28-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54ZM-484.7,544.14c.04.57.12,1.04.24,1.39.12.36.29.62.51.78.22.16.51.25.88.25s.65-.08.88-.25c.22-.16.39-.42.51-.78.12-.36.2-.82.24-1.39.04-.57.06-1.27.06-2.08s-.02-1.51-.06-2.07c-.04-.57-.12-1.03-.24-1.39-.12-.36-.29-.63-.51-.79-.22-.16-.51-.25-.88-.25s-.65.08-.88.25c-.22.16-.39.43-.51.79-.12.36-.2.83-.24,1.39-.04.57-.06,1.26-.06,2.07s.02,1.51.06,2.08Z"/> <path fill="#ffffff" d="M-477.92,535.99h2.45v10.13h4.33v2.01h-6.78v-12.14Z"/> <path fill="#ffffff" d="M-470.36,535.99h2.45v12.14h-2.45v-12.14Z"/> <path fill="#ffffff" d="M-461.65,538.16c-.21-.4-.59-.6-1.15-.6-.31,0-.56.08-.76.25s-.35.43-.47.8-.19.85-.24,1.44c-.05.6-.07,1.32-.07,2.18,0,.92.03,1.66.09,2.23.06.57.16,1.01.29,1.32.13.31.29.52.49.63.2.11.43.16.69.16.21,0,.42-.04.6-.11.19-.07.35-.22.48-.44.14-.22.24-.53.32-.94s.12-.93.12-1.59h2.45c0,.66-.05,1.28-.15,1.87-.1.59-.29,1.11-.57,1.55-.28.44-.67.79-1.17,1.04-.5.25-1.16.37-1.96.37-.92,0-1.65-.15-2.19-.44s-.96-.72-1.25-1.28c-.29-.55-.48-1.22-.56-1.99-.08-.77-.13-1.62-.13-2.55s.04-1.76.13-2.54.27-1.44.56-2c.29-.55.71-.99,1.25-1.3s1.27-.47,2.19-.47,1.56.14,2.07.42c.5.28.88.64,1.13,1.08.25.44.41.91.47,1.41.06.5.09.98.09,1.42h-2.45c0-.88-.11-1.53-.31-1.93Z"/> <path fill="#ffffff" d="M-457.69,535.99h2.45v12.14h-2.45v-12.14Z"/> <path fill="#ffffff" d="M-446.75,538h-2.65v10.13h-2.45v-10.13h-2.65v-2.01h7.75v2.01Z"/> <path fill="#ffffff" d="M-446,535.99h2.45v12.14h-2.45v-12.14Z"/> <path fill="#ffffff" d="M-436.38,544.31h.03v-8.31h2.24v12.14h-2.79l-2.99-8.5h-.03v8.5h-2.24v-12.14h2.82l2.96,8.31Z"/> <path fill="#ffffff" d="M-427.51,538.9c-.05-.24-.13-.46-.25-.65s-.26-.36-.43-.49c-.18-.13-.39-.2-.64-.2-.59,0-1.01.33-1.27.99s-.39,1.75-.39,3.26c0,.73.02,1.38.07,1.97.04.59.13,1.09.25,1.5.12.41.29.73.51.95.22.22.51.33.86.33.15,0,.31-.04.48-.12s.34-.2.49-.36c.15-.16.28-.36.38-.6.1-.24.15-.53.15-.86v-1.24h-1.62v-1.8h3.96v6.54h-1.8v-1.12h-.03c-.29.48-.65.81-1.06,1.01s-.91.3-1.49.3c-.75,0-1.36-.13-1.83-.39-.47-.26-.84-.66-1.11-1.21s-.44-1.22-.54-2.01-.14-1.73-.14-2.78.06-1.92.2-2.69c.13-.77.35-1.41.67-1.93s.74-.9,1.26-1.17c.52-.26,1.17-.39,1.95-.39,1.34,0,2.3.33,2.89.99.59.66.88,1.61.88,2.85h-2.35c0-.23-.03-.46-.08-.7Z"/> </g> <g> <path fill="#ffffff" d="M-467.67,376.77l-.93-.91-53.35-52.08-8.02-7.84-1.13-1.09-.47-.45-.46.45-9.13,8.91-53.37,52.09-.1.1-.64.63-.2.2v99.83h15.08s91.41,0,91.41,0h.67v-99.84h-86.32v79.36h65.48v-59.02h-44.62v43.94h-5.78v-49.2h56.16v69.68h-77v-79.76l48.83-47.67,49,47.84v94.67h15.08v-99.65l-.2-.2ZM-538.69,441.05v-28.86h14.46v28.86h-14.46Z"/> <g> <g> <path fill="#ffffff" d="M-438.31,394.64v13.11c0,.21-.17.37-.37.37h-6.95c-.2,0-.37-.17-.37-.37v-12.75c0-.86-.05-1.86-.41-2.66-.17-.34-.39-.62-.65-.83-.44-.34-1-.51-1.72-.51-1.34,0-2.38.46-2.71,1.2-.38.81-.38,1.91-.38,2.79v12.75c0,.2-.17.37-.37.37h-6.95c-.21,0-.37-.17-.37-.37v-29.9c0-.21.17-.37.37-.37h6.51c.21,0,.37.17.37.37v7.97c0,.15.17.24.29.15,5.25-3.61,10.36.4,10.41.44.19.15.36.3.52.46h0c2.38,2.39,2.78,4.33,2.78,7.76Z"/> <path fill="#ffffff" d="M-413.54,396.66c0,6.73-5.55,12.2-12.37,12.2s-12.37-5.47-12.37-12.2,5.55-12.2,12.37-12.2,12.37,5.47,12.37,12.2ZM-420.52,396.66c0-2.93-2.42-5.32-5.39-5.32s-5.39,2.39-5.39,5.32,2.42,5.32,5.39,5.32,5.39-2.39,5.39-5.32Z"/> <path fill="#ffffff" d="M-392.27,385.2v22.56c0,.21-.17.37-.37.37h-6.51c-.21,0-.37-.17-.37-.37v-.63c0-.15-.17-.24-.29-.15-1.63,1.12-3.24,1.51-4.69,1.51-3.24,0-5.68-1.92-5.72-1.95-.19-.15-.36-.3-.52-.46h0c-2.38-2.39-2.78-4.33-2.78-7.76v-13.11c0-.21.17-.37.37-.37h6.95c.2,0,.37.17.37.37v12.75c0,.86.05,1.86.41,2.66.17.34.39.62.65.83.44.34,1,.51,1.72.51,1.34,0,2.38-.46,2.71-1.2.38-.81.38-1.91.38-2.79v-12.75c0-.21.17-.37.37-.37h6.95c.2,0,.37.17.37.37Z"/> <path fill="#ffffff" d="M-373.26,401.18c-.06.82-.27,1.68-.63,2.58-1.39,2.97-4.62,4.73-8.62,4.73-.55,0-1.12-.03-1.69-.1-1.8-.21-3.38-.69-4.69-1.43-1.34-.91-2.37-2.18-3.06-3.79-.09-.22.03-.47.26-.51l6.39-1.37c.15-.03.3.03.39.16.45.67,1.21.99,1.62,1.04.98.12,1.48-.15,1.74-.39.26-.24.37-.57.33-.93-.1-.81-.59-1.18-3.06-2.36h-.03c-.49-.25-1.1-.54-1.79-.88-.47-.2-.93-.42-1.36-.66l-.04-.02c-.06-.04-.12-.07-.19-.11-2.21-1.27-3.51-2.82-3.84-4.6-.48-2.54,1.16-4.7,1.49-5.11.49-.56,1.07-1.05,1.71-1.46,1.94-1.24,4.44-1.75,7.03-1.44,1.56.18,2.97.6,4.2,1.25.59.31,1.13.67,1.61,1.08.33.3,1.38,1.33,1.7,2.91.04.2-.09.4-.29.44l-6.28,1.27c-.18.04-.35-.07-.42-.23-.18-.44-.56-.88-1.39-.97-.55-.07-1.05.1-1.37.45-.24.27-.34.6-.26.87.12.42.55,1.08,2.89,2.04.47.18.89.35,1.32.52.55.2,1.08.41,1.57.62h0c1.49.7,4.94,2.72,4.74,6.39Z"/> <path fill="#ffffff" d="M-348.94,396.66c0,.67-.08,1.46-.2,2.17-.03.18-.19.31-.37.31h-16.32c-.29,0-.47.32-.32.57,1,1.7,2.8,2.76,4.78,2.76,1.69,0,3.26-.74,4.38-2.17.09-.11.22-.17.36-.14l6.25,1.12c.24.04.38.31.27.53-.14.29-.32.66-.42.84h0s-.1.17-.1.17c-.1.16-.19.32-.31.5-.15.22-.28.41-.41.59l-.08.11h0c-.04.06-.09.11-.13.17l-.07.09c-.09.11-.17.21-.25.31l-.07.09c-.14.16-.28.31-.43.46l-.08.09c-.1.1-.2.2-.3.29l-.03.03c-.11.1-.22.2-.33.3l-.12.11-.14-.12.12.14c-.17.15-.34.28-.5.4l-.14.1c-.19.14-.39.28-.59.41l-.06.04c-.23.15-.46.29-.7.42l-.07.04c-.06.03-.11.06-.17.09l-.04.02c-.11.06-.21.11-.3.15l-.06.03c-.22.11-.43.2-.63.28l-.04.02c-.14.06-.26.1-.39.15l-.15.05c-.15.05-.31.11-.46.15h-.03c-.17.06-.34.11-.54.16l-.14.04c-.36.09-.71.16-1.06.22l-.13.02c-.38.05-.75.09-1.12.11h-.14c-.22.02-.4.02-.57.02s-.36,0-.57-.01c-.04,0-.09,0-.13,0h-.04c-.14-.01-.28-.02-.42-.03h-.04s-.08-.01-.12-.01c-.2-.02-.38-.04-.54-.07h0s0,0,0,0l-.1-.02c-.15-.02-.3-.05-.45-.08l-.16-.03c-.13-.03-.27-.06-.4-.09h-.04s-.08-.03-.12-.04c-.2-.05-.37-.1-.53-.15-.18-.05-.35-.11-.52-.17-.04-.01-.08-.03-.12-.04h-.03c-.13-.06-.25-.11-.37-.16h-.03s-.08-.04-.12-.06c-.17-.07-.33-.14-.49-.22h-.02c-.15-.08-.31-.16-.46-.24-.04-.02-.07-.04-.11-.06l-.03-.02c-.12-.06-.23-.13-.34-.2l-.14-.08c-.15-.09-.3-.19-.45-.28-1.48-.98-2.74-2.29-3.67-3.79-.08-.13-.15-.25-.23-.38l-.03-.06c-.07-.12-.13-.25-.2-.38l-.04-.07s-.04-.08-.06-.11c-.23-.47-.44-.98-.62-1.51-.1-.29-.17-.54-.23-.77-.05-.19-.1-.39-.14-.59-.12-.6-.2-1.22-.23-1.83-.01-.21-.02-.42-.02-.63s0-.42.02-.63c.06-1.08.26-2.16.61-3.19.11-.34.23-.65.35-.93.07-.16.15-.33.22-.49.02-.04.04-.08.06-.11l.05-.09s.04-.08.06-.11c.02-.04.04-.08.06-.12l.11-.2c.09-.15.17-.31.27-.46.92-1.5,2.19-2.81,3.67-3.79.15-.1.3-.19.45-.28l.14-.08c.11-.07.23-.13.34-.2l.03-.02s.07-.04.11-.06c.16-.08.32-.16.48-.24.16-.08.33-.15.49-.22.04-.02.08-.03.12-.05h.03c.12-.06.25-.11.37-.16h.04s.08-.04.12-.06c.17-.06.34-.12.52-.17.18-.05.35-.1.53-.15.04,0,.08-.02.12-.03h.04c.13-.04.27-.07.4-.1l.09-.02c.16-.03.43-.08.59-.11h.03s0,0,0,0h0c.16-.03.34-.05.54-.07.04,0,.08,0,.12-.01h.04c.14-.02.28-.03.42-.03h.03s.09,0,.14-.01c.21,0,.4-.01.57-.01s.35,0,.57.01h.14c.38.03.75.07,1.11.12l.15.02c.35.06.71.13,1.05.21l.15.04c.2.05.37.1.53.15h.03c.16.06.31.11.47.17.05.02.09.03.14.05.14.05.26.1.39.15l.06.02c.2.08.41.18.63.28l.05.03c.11.05.2.1.3.15l.03.02-.08.17.1-.16c.06.03.12.06.17.09.21.12.55.32.75.45l.03.02c.21.14.42.28.61.42l.03.02s.08.06.12.09c.17.13.33.26.51.41l.1.08c.13.11.26.22.38.34l.03.03c.1.09.2.19.3.29l.07.08c.16.16.3.31.43.46l-.12.14.14-.12.07.08c.08.1.17.2.25.29l.08.1c.09.12.19.24.28.36v.02c.09.1.16.2.23.3l.13.2c.06.09.12.18.17.27l.23.38h0c.46.81.83,1.66,1.09,2.53.33,1.12.5,2.28.5,3.45ZM-356.23,393.56c-.29-1.72-2.28-3.06-4.8-3.06-2.3,0-4.48,1.33-4.8,3.05-.04.23.13.44.37.44h8.87c.23,0,.41-.21.37-.44Z"/> </g> <path fill="#ffffff" d="M-431.66,429.29c0,7.21-5.95,13.07-13.26,13.07-2.32,0-4.58-.59-6.58-1.73-.13-.08-.3.02-.3.17v8.63c0,.22-.18.4-.4.4h-6.98c-.22,0-.4-.18-.4-.4v-32.43c0-.22.18-.4.4-.4h6.98c.22,0,.4.18.4.4v.76c0,.15.17.25.3.17,2-1.13,4.26-1.72,6.58-1.72,7.31,0,13.26,5.86,13.26,13.07ZM-440.03,429.29c0-3.31-2.73-6-6.08-6s-5.68,2.69-5.68,6,2.33,6,5.68,6,6.08-2.69,6.08-6Z"/> <path fill="#ffffff" d="M-403.7,417v24.17c0,.22-.18.4-.4.4h-6.98c-.22,0-.4-.18-.4-.4v-.37c0-.15-.17-.25-.3-.17-2,1.13-4.26,1.73-6.58,1.73-7.31,0-13.26-5.86-13.26-13.07s5.95-13.07,13.26-13.07c2.32,0,4.58.59,6.58,1.72.13.08.3-.02.3-.17v-.76c0-.22.18-.4.4-.4h6.98c.22,0,.4.18.4.4ZM-411.47,429.28c0-3.31-2.33-6-5.68-6s-6.08,2.69-6.08,6,2.73,6,6.08,6,5.68-2.69,5.68-6Z"/> <path fill="#ffffff" d="M-389.24,417.03l-.24,5.84c0,.23-.21.4-.43.38-.68-.06-2.05-.15-2.85.04-.9.22-1.42.91-1.57,1.24-.4.86-.4,1.63-.4,2.6v14.05c0,.22-.18.4-.4.4h-7.45c-.22,0-.4-.18-.4-.4v-24.17c0-.22.18-.4.4-.4h6.98c.22,0,.4.18.4.4v.7c0,.16.17.25.3.17,1.65-1.03,3.61-1.24,5.26-1.26.23,0,.41.19.4.42Z"/> <path fill="#ffffff" d="M-373.85,435.55l-.89,5.91c-.03.19-.18.33-.37.34-.86.05-3.14.18-3.84.18-.06,0-.1,0-.13,0-4.24-.22-6.48-2.4-6.48-6.29v-11.99c0-.22-.18-.4-.4-.4h-2.59c-.22,0-.4-.18-.4-.4v-5.91c0-.22.18-.4.4-.4h2.59c.22,0,.4-.18.4-.4v-6.85c0-.22.18-.4.4-.4h6.98c.22,0,.4.18.4.4v6.85c0,.22.18.4.4.4h2.59c.22,0,.4.18.4.4v5.91c0,.22-.18.4-.4.4h-2.59c-.22,0-.4.18-.4.4,0,2.07,0,8.2,0,8.26v.17c-.03.76-.07,1.8.54,2.42.36.36.91.55,1.65.55h1.36c.24,0,.43.22.39.46Z"/> <path fill="#ffffff" d="M-348.96,417.14l-7.86,21.84-3.66,10.39c-.06.16-.21.27-.38.27h-7.75c-.27,0-.47-.27-.38-.53l3.04-9c.03-.09.03-.18,0-.26l-8.31-22.7c-.1-.26.1-.54.37-.54h6.95c.17,0,.32.1.37.26l4.55,12.3c.13.35.63.35.75,0l4.19-12.28c.06-.16.21-.27.38-.27h7.35c.28,0,.47.27.37.53Z"/> <path fill="#ffffff" d="M-432.09,442.9v32.5c0,.22-.18.41-.4.41h-7.08c-.22,0-.4-.18-.4-.41v-.37c0-.16-.17-.25-.3-.17-2.03,1.15-4.32,1.75-6.67,1.75-7.42,0-13.45-5.95-13.45-13.26s6.03-13.26,13.45-13.26c2.35,0,4.64.6,6.67,1.75.14.08.3-.02.3-.17v-8.75c0-.22.18-.4.4-.4h7.08c.22,0,.4.18.4.4ZM-439.98,463.34c0-3.35-2.36-6.08-5.76-6.08s-6.17,2.73-6.17,6.08,2.77,6.08,6.17,6.08,5.76-2.73,5.76-6.08Z"/> <path fill="#ffffff" d="M-423.99,450.49h-7.08c-.23,0-.4.18-.4.4v24.52c0,.22.18.4.4.4h7.08c.23,0,.4-.18.4-.4v-24.52c0-.23-.18-.4-.4-.4ZM-423.68,442.66s-.01-.03-.03-.03c-2.39-.17-7.73,3.34-7.66,5.73,0,.01.02.02.03.03.07.07.16.1.27.1h7.08c.23,0,.4-.18.4-.4v-5.17c0-.1-.04-.19-.09-.26Z"/> <path fill="#ffffff" d="M-403.51,468.26c-.06.89-.29,1.83-.68,2.81-1.52,3.23-5.02,5.15-9.37,5.15-.6,0-1.22-.04-1.84-.11-1.96-.23-3.67-.75-5.09-1.55-1.46-.99-2.58-2.37-3.33-4.12-.1-.23.04-.51.29-.56l6.94-1.49c.16-.04.33.03.42.17.49.73,1.31,1.08,1.76,1.13,1.06.13,1.61-.16,1.89-.42.28-.26.41-.62.36-1.01-.11-.88-.64-1.29-3.32-2.57l-.03-.02c-.53-.26-1.2-.57-1.94-.94-.51-.22-1.01-.46-1.48-.71l-.04-.02c-.07-.04-.13-.08-.2-.12-2.41-1.38-3.81-3.06-4.18-5-.52-2.76,1.26-5.11,1.62-5.55.54-.61,1.16-1.14,1.86-1.59,2.11-1.34,4.82-1.9,7.65-1.57,1.69.2,3.23.66,4.57,1.36.64.33,1.23.73,1.75,1.17.36.32,1.5,1.45,1.85,3.16.04.22-.1.43-.32.47l-6.83,1.38c-.19.04-.38-.07-.45-.25-.19-.48-.61-.95-1.51-1.06-.6-.07-1.14.11-1.49.49-.26.29-.37.65-.29.95.13.45.6,1.18,3.15,2.21.51.2.97.38,1.44.57.59.21,1.17.44,1.7.68h0c1.62.76,5.37,2.95,5.15,6.95Z"/> <path fill="#ffffff" d="M-388.88,469.7l-.91,5.99c-.03.19-.18.33-.38.34-.87.05-3.19.18-3.9.18-.06,0-.1,0-.14,0-4.3-.23-6.57-2.43-6.57-6.38v-12.16c0-.22-.18-.4-.4-.4h-2.63c-.22,0-.4-.18-.4-.4v-5.99c0-.22.18-.4.4-.4h2.63c.22,0,.4-.18.4-.4v-6.95c0-.22.18-.41.41-.41h7.08c.22,0,.4.18.4.41v6.95c0,.22.18.4.4.4h2.63c.22,0,.4.18.4.4v5.99c0,.22-.18.4-.4.4h-2.63c-.22,0-.4.18-.4.4,0,2.1,0,8.32,0,8.38v.17c-.03.77-.07,1.82.55,2.45.36.37.93.56,1.68.56h1.38c.25,0,.44.22.4.47Z"/> <path fill="#ffffff" d="M-374.58,450.91l-.24,5.93c0,.23-.21.41-.44.39-.69-.07-2.08-.16-2.9.04-.91.22-1.44.92-1.59,1.26-.41.88-.41,1.65-.41,2.63v14.26c0,.22-.18.4-.4.4h-7.55c-.22,0-.41-.18-.41-.4v-24.52c0-.22.18-.4.41-.4h7.08c.22,0,.4.18.4.4v.71c0,.16.17.26.31.17,1.68-1.04,3.66-1.26,5.33-1.28.23,0,.42.19.41.42Z"/> <path fill="#ffffff" d="M-348.94,463.35c0,7.31-6.03,13.26-13.45,13.26s-13.45-5.95-13.45-13.26,6.03-13.26,13.45-13.26,13.45,5.95,13.45,13.26ZM-356.52,463.35c0-3.19-2.63-5.78-5.86-5.78s-5.86,2.59-5.86,5.78,2.63,5.78,5.86,5.78,5.86-2.59,5.86-5.78Z"/> </g> </g> <g> <g> <path d="M15.48,14.1v8.5c0,.13-.11.24-.24.24h-4.51c-.13,0-.24-.11-.24-.24v-8.27c0-.56-.03-1.2-.27-1.72-.11-.22-.25-.4-.42-.54-.28-.22-.65-.33-1.12-.33-.87,0-1.54.3-1.76.78-.24.52-.24,1.24-.24,1.81v8.27c0,.13-.11.24-.24.24H1.93c-.13,0-.24-.11-.24-.24V3.21c0-.13.11-.24.24-.24h4.22c.13,0,.24.11.24.24v5.17c0,.1.11.15.19.1,3.4-2.34,6.72.26,6.75.29.12.09.24.2.34.3h0c1.54,1.55,1.8,2.81,1.8,5.03Z"/> <path d="M31.55,15.4c0,4.36-3.6,7.91-8.02,7.91s-8.02-3.55-8.02-7.91,3.6-7.91,8.02-7.91,8.02,3.55,8.02,7.91ZM27.02,15.4c0-1.9-1.57-3.45-3.5-3.45s-3.5,1.55-3.5,3.45,1.57,3.45,3.5,3.45,3.5-1.55,3.5-3.45Z"/> <path d="M45.34,7.97v14.63c0,.13-.11.24-.24.24h-4.22c-.13,0-.24-.11-.24-.24v-.41c0-.1-.11-.15-.19-.1-1.06.73-2.1.98-3.04.98-2.1,0-3.68-1.24-3.71-1.26-.12-.09-.24-.2-.34-.3h0c-1.54-1.55-1.8-2.81-1.8-5.03V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24v8.27c0,.56.03,1.2.27,1.72.11.22.25.4.42.54.28.22.65.33,1.12.33.87,0,1.54-.3,1.76-.78.24-.52.24-1.24.24-1.81V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24Z"/> <path d="M57.67,18.33c-.04.53-.17,1.09-.41,1.67-.9,1.93-2.99,3.07-5.59,3.07-.36,0-.73-.02-1.1-.07-1.17-.14-2.19-.45-3.04-.92-.87-.59-1.54-1.42-1.99-2.46-.06-.14.02-.3.17-.33l4.14-.89c.1-.02.2.02.25.1.29.43.78.64,1.05.68.63.08.96-.09,1.13-.25.17-.16.24-.37.21-.6-.07-.52-.38-.77-1.98-1.53h-.02c-.32-.16-.72-.35-1.16-.57-.31-.13-.6-.28-.88-.42h-.02s-.08-.06-.12-.08c-1.44-.82-2.28-1.83-2.49-2.98-.31-1.65.75-3.05.97-3.31.32-.36.69-.68,1.11-.95,1.26-.8,2.88-1.13,4.56-.94,1.01.12,1.93.39,2.73.81.38.2.73.43,1.05.7.22.19.89.86,1.1,1.89.03.13-.06.26-.19.28l-4.07.82c-.12.02-.23-.04-.27-.15-.11-.28-.37-.57-.9-.63-.36-.04-.68.06-.89.29-.16.17-.22.39-.17.56.08.27.36.7,1.88,1.32.3.12.58.23.86.34.35.13.7.26,1.02.4h0c.97.45,3.21,1.76,3.07,4.15Z"/> <path d="M73.45,15.4c0,.44-.05.95-.13,1.4-.02.12-.12.2-.24.2h-10.58c-.19,0-.3.2-.21.37.65,1.1,1.81,1.79,3.1,1.79,1.09,0,2.11-.48,2.84-1.41.06-.07.15-.11.23-.09l4.05.73c.16.03.24.2.18.34-.09.19-.21.43-.27.54h0s-.07.11-.07.11c-.06.1-.13.21-.2.32-.09.14-.18.27-.27.38l-.05.07h0s-.06.07-.09.11l-.05.06c-.06.07-.11.13-.17.2l-.05.06c-.09.1-.18.2-.28.3l-.05.06c-.06.06-.13.13-.19.19l-.02.02c-.07.07-.14.13-.22.2l-.08.07-.09-.08.08.09c-.11.1-.22.18-.33.26l-.09.07c-.12.09-.25.18-.38.26l-.04.02c-.15.1-.3.19-.45.27l-.04.02s-.07.04-.11.06h-.03c-.07.05-.13.08-.2.11l-.04.02c-.14.07-.28.13-.41.18h-.03c-.09.05-.17.08-.25.11l-.1.04c-.1.04-.2.07-.3.1h-.02c-.11.04-.22.07-.35.11l-.09.02c-.23.06-.46.1-.69.14h-.09c-.24.05-.48.07-.72.09h-.09c-.14.01-.26.01-.37.01s-.23,0-.37,0c-.03,0-.06,0-.08,0h-.03c-.09,0-.18-.01-.27-.02h-.03s-.05,0-.08,0c-.13-.01-.25-.03-.35-.04h0s0,0,0,0h-.06c-.1-.03-.2-.04-.29-.06l-.1-.02c-.09-.02-.17-.04-.26-.06h-.03s-.05-.02-.08-.03c-.13-.03-.24-.06-.34-.1-.11-.04-.23-.07-.34-.11-.03,0-.05-.02-.08-.03h-.02c-.08-.04-.16-.07-.24-.1h-.02s-.05-.03-.07-.04c-.11-.05-.21-.09-.32-.14h-.01c-.1-.05-.2-.1-.3-.16-.02-.01-.05-.03-.07-.04h-.02c-.08-.05-.15-.09-.22-.14l-.09-.05c-.1-.06-.2-.12-.29-.18-.96-.64-1.78-1.49-2.38-2.46-.05-.08-.1-.16-.15-.25l-.02-.04c-.04-.08-.09-.16-.13-.24l-.02-.05s-.03-.05-.04-.07c-.15-.31-.29-.64-.4-.98-.06-.19-.11-.35-.15-.5-.03-.12-.06-.25-.09-.38-.08-.39-.13-.79-.15-1.19,0-.13-.01-.27-.01-.41s0-.27.01-.41c.04-.7.17-1.4.39-2.07.07-.22.15-.42.23-.6.05-.11.09-.21.14-.31.01-.02.02-.05.04-.07l.03-.06s.02-.05.04-.07c.01-.03.03-.05.04-.07l.07-.13c.06-.1.11-.2.17-.3.6-.97,1.42-1.82,2.38-2.46.1-.06.19-.12.29-.18l.09-.05c.07-.04.15-.09.22-.13h.02s.05-.04.07-.05c.1-.05.21-.11.31-.16.11-.05.21-.1.32-.14.02-.01.05-.02.07-.03h.02c.08-.04.16-.07.24-.1h.02s.05-.03.08-.04c.11-.04.22-.08.33-.11.11-.04.23-.07.34-.1.02,0,.05-.01.08-.02h.03c.09-.03.17-.05.26-.07h.06c.1-.03.28-.07.38-.08h.02s0,0,0,0h0c.11-.02.22-.03.35-.04.03,0,.05,0,.08,0h.03c.09-.01.18-.02.27-.02h.02s.06,0,.09,0c.14,0,.26,0,.37,0s.23,0,.37,0h.09c.24.02.48.04.72.08h.1c.23.05.46.1.68.15l.1.03c.13.03.24.07.34.1h.02c.11.04.2.07.3.11.03.01.06.02.09.03.09.03.17.07.25.1l.04.02c.13.05.27.12.41.18l.04.02c.07.03.13.07.19.1h.02s-.05.12-.05.12l.06-.1s.07.04.11.06c.14.08.36.21.49.29h.02c.14.1.27.19.4.28l.02.02s.05.04.08.06c.11.08.22.17.33.26l.06.05c.08.07.17.15.25.22l.02.02c.06.06.13.12.19.19l.05.05c.1.1.19.2.28.3l-.08.09.09-.08.04.05c.05.06.11.13.16.19l.05.06c.06.08.12.15.18.23h0c.05.07.09.14.14.21l.09.13c.04.06.08.12.11.18l.15.25h0c.3.52.54,1.08.7,1.64.22.73.33,1.48.33,2.23ZM68.72,13.4c-.19-1.11-1.48-1.98-3.11-1.98-1.49,0-2.9.86-3.11,1.98-.03.15.09.29.24.29h5.75c.15,0,.26-.14.24-.28Z"/> </g> <path d="M96.76,14.82c0,4.68-3.86,8.48-8.6,8.48-1.5,0-2.97-.39-4.27-1.12-.09-.05-.19.01-.19.11v5.59c0,.14-.12.26-.26.26h-4.52c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.49c0,.1.11.16.19.11,1.3-.73,2.76-1.12,4.27-1.12,4.74,0,8.6,3.8,8.6,8.48ZM91.33,14.82c0-2.14-1.77-3.89-3.94-3.89s-3.68,1.74-3.68,3.89,1.51,3.89,3.68,3.89,3.94-1.74,3.94-3.89Z"/> <path d="M114.9,6.85v15.68c0,.14-.12.26-.26.26h-4.53c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.19-.11-1.3.73-2.76,1.12-4.27,1.12-4.74,0-8.6-3.8-8.6-8.48s3.86-8.48,8.6-8.48c1.5,0,2.97.39,4.27,1.12.09.05.19-.01.19-.11v-.49c0-.14.12-.26.26-.26h4.53c.14,0,.26.12.26.26ZM109.86,14.82c0-2.14-1.51-3.89-3.68-3.89s-3.94,1.74-3.94,3.89,1.77,3.89,3.94,3.89,3.68-1.74,3.68-3.89Z"/> <path d="M124.28,6.87l-.15,3.79c0,.15-.13.26-.28.25-.44-.04-1.33-.1-1.85.03-.58.14-.92.59-1.02.81-.26.56-.26,1.06-.26,1.68v9.11c0,.14-.12.26-.26.26h-4.83c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.45c0,.1.11.16.2.11,1.07-.67,2.34-.81,3.41-.82.15,0,.27.12.26.27Z"/> <path d="M134.26,18.88l-.58,3.83c-.02.12-.12.21-.24.22-.56.03-2.04.12-2.49.12-.04,0-.07,0-.09,0-2.75-.14-4.2-1.56-4.2-4.08v-7.77c0-.14-.12-.26-.26-.26h-1.68c-.14,0-.26-.12-.26-.26v-3.83c0-.14.12-.26.26-.26h1.68c.14,0,.26-.12.26-.26V1.88c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v4.44c0,.14.12.26.26.26h1.68c.14,0,.26.12.26.26v3.83c0,.14-.12.26-.26.26h-1.68c-.14,0-.26.11-.26.26,0,1.34,0,5.32,0,5.36v.11c-.02.49-.04,1.17.35,1.57.23.24.59.36,1.07.36h.88c.16,0,.28.14.26.3Z"/> <path d="M150.4,6.95l-5.1,14.17-2.37,6.74c-.04.1-.13.17-.24.17h-5.03c-.18,0-.3-.17-.25-.34l1.97-5.84c.02-.06.02-.12,0-.17l-5.39-14.72c-.06-.17.06-.35.24-.35h4.51c.11,0,.21.07.24.17l2.95,7.98c.08.23.41.22.49,0l2.72-7.97c.04-.1.13-.18.25-.18h4.77c.18,0,.3.18.24.35Z"/> <path d="M171.26,1.54v21.08c0,.15-.12.26-.26.26h-4.59c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.2-.11-1.32.74-2.8,1.14-4.33,1.14-4.81,0-8.72-3.86-8.72-8.6s3.91-8.6,8.72-8.6c1.53,0,3.01.39,4.33,1.13.09.05.2-.01.2-.11V1.54c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26ZM166.14,14.79c0-2.18-1.53-3.95-3.74-3.95s-4,1.77-4,3.95,1.79,3.95,4,3.95,3.74-1.77,3.74-3.95Z"/> <path d="M176.51,6.46h-4.59c-.15,0-.26.12-.26.26v15.9c0,.14.12.26.26.26h4.59c.15,0,.26-.12.26-.26V6.72c0-.15-.12-.26-.26-.26ZM176.71,1.38s0-.02-.02-.02c-1.55-.11-5.01,2.17-4.97,3.72,0,0,.01.01.02.02.04.04.11.07.17.07h4.59c.15,0,.26-.12.26-.26V1.54c0-.06-.02-.12-.06-.17Z"/> <path d="M189.79,17.99c-.04.57-.19,1.19-.44,1.82-.98,2.09-3.25,3.34-6.08,3.34-.39,0-.79-.02-1.19-.07-1.27-.15-2.38-.49-3.3-1.01-.95-.64-1.67-1.54-2.16-2.67-.07-.15.02-.33.19-.36l4.5-.97c.11-.02.21.02.27.11.32.47.85.7,1.14.73.69.08,1.05-.1,1.22-.27.18-.17.26-.4.23-.66-.07-.57-.41-.83-2.15-1.66h-.02c-.35-.18-.78-.38-1.26-.62-.33-.14-.66-.3-.96-.46l-.03-.02s-.09-.05-.13-.08c-1.56-.9-2.47-1.99-2.71-3.24-.34-1.79.82-3.31,1.05-3.6.35-.39.75-.74,1.21-1.03,1.37-.87,3.13-1.23,4.96-1.02,1.1.13,2.1.43,2.96.88.41.22.8.47,1.14.76.24.21.97.94,1.2,2.05.03.14-.07.28-.21.31l-4.43.9c-.13.02-.25-.05-.29-.16-.12-.31-.4-.62-.98-.69-.39-.05-.74.07-.96.32-.17.19-.24.42-.19.61.08.29.39.76,2.04,1.44.33.13.63.24.93.37.38.14.76.29,1.11.44h0c1.05.49,3.48,1.92,3.34,4.51Z"/> <path d="M199.29,18.92l-.59,3.89c-.02.12-.12.22-.24.22-.56.03-2.07.12-2.53.12-.04,0-.07,0-.09,0-2.79-.15-4.26-1.58-4.26-4.14v-7.89c0-.14-.12-.26-.26-.26h-1.71c-.14,0-.26-.12-.26-.26v-3.89c0-.14.12-.26.26-.26h1.71c.14,0,.26-.12.26-.26V1.67c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26v4.51c0,.14.12.26.26.26h1.71c.14,0,.26.12.26.26v3.89c0,.14-.12.26-.26.26h-1.71c-.14,0-.26.12-.26.26,0,1.36,0,5.39,0,5.44v.11c-.02.5-.04,1.18.36,1.59.23.24.6.36,1.09.36h.89c.16,0,.28.14.26.3Z"/> <path d="M208.56,6.73l-.16,3.84c0,.15-.14.26-.29.25-.45-.04-1.35-.1-1.88.03-.59.14-.93.6-1.03.82-.27.57-.27,1.07-.27,1.71v9.25c0,.14-.12.26-.26.26h-4.9c-.15,0-.26-.12-.26-.26V6.72c0-.14.12-.26.26-.26h4.59c.15,0,.26.12.26.26v.46c0,.1.11.17.2.11,1.09-.68,2.38-.82,3.46-.83.15,0,.27.12.27.27Z"/> <path d="M225.19,14.8c0,4.74-3.91,8.6-8.72,8.6s-8.72-3.86-8.72-8.6,3.91-8.6,8.72-8.6,8.72,3.86,8.72,8.6ZM220.27,14.8c0-2.07-1.71-3.75-3.8-3.75s-3.8,1.68-3.8,3.75,1.71,3.75,3.8,3.75,3.8-1.68,3.8-3.75Z"/> </g> </svg>
                    <div style={{fontSize:11,color:"#666",lineHeight:1.7,fontFamily:"system-ui, sans-serif"}}>
                      3945 W Reno Ave, Suite A<br/>Las Vegas, NV 89118<br/>jon@housepartydistro.com
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:18,fontWeight:700,letterSpacing:"-0.01em",fontFamily:"system-ui, sans-serif",marginBottom:8}}>
                      {orderInfo.invoiceNum?"QUOTE #"+orderInfo.invoiceNum:"QUOTE #—"}
                    </div>
                    <div style={{fontSize:11,color:"#666",lineHeight:1.8,fontFamily:"system-ui, sans-serif"}}>
                      <div><span style={{fontWeight:600}}>Date:</span> {today}</div>
                      {orderInfo.validUntil&&<div><span style={{fontWeight:600}}>Valid until:</span> {orderInfo.validUntil}</div>}
                    </div>
                  </div>
                </div>
              </div>
              {/* Meta strip */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:"0.5px solid #e5e7eb",fontFamily:"system-ui, sans-serif"}}>
                {[
                  ["Date", today],
                  ["Valid until", orderInfo.validUntil||"30 days from issue"],
                  ["Est. ship date", project?.target_ship_date ? new Date(project.target_ship_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "TBD"],
                  ["Prepared for", project?.clients?.name||"—"],
                ].map(([k,v],i,arr)=>(
                  <div key={k} style={{padding:"8px 12px",borderRight:i<arr.length-1?"0.5px solid #e5e7eb":"none"}}>
                    <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:2}}>{k}</div>
                    <div style={{fontSize:11,fontWeight:600,color:"#1a1a1a"}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Items table */}
              <div style={{padding:"24px 36px"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui, sans-serif"}}>
                  <thead>
                    <tr style={{borderBottom:"1.5px solid #1a1a1a"}}>
                      <th style={{fontSize:9,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"left",padding:"6px 0 10px",width:"38%"}}>Item</th>
                      <th style={{fontSize:9,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"left",padding:"6px 0 10px"}}>Sizes</th>
                      <th style={{fontSize:9,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"right",padding:"6px 0 10px",width:60}}>Qty</th>
                      <th style={{fontSize:9,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"right",padding:"6px 0 10px",width:80}}>Unit price</th>
                      <th style={{fontSize:9,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"right",padding:"6px 0 10px",width:90}}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quoteProds.map((p,pi)=>{
                      const r2=calcCostProduct(p,costMargin,inclShip,inclCC,costProds);
                      const lineTotal=r2?.grossRev||0;
                      const unitPrice=r2?.sellPerUnit||0;
                      return(
                        <tr key={pi} style={{borderBottom:"0.5px solid #eeeeee"}}>
                          <td style={{padding:"12px 12px 12px 0",verticalAlign:"top"}}>
                            <div style={{display:"flex",alignItems:"baseline",gap:7}}>
                              <span style={{fontSize:10,fontWeight:700,color:"#bbb",fontFamily:"monospace",flexShrink:0}}>{String.fromCharCode(65+pi)}</span>
                              <span style={{fontSize:13,fontWeight:700,color:"#1a1a1a"}}>{p.name||("Item "+(pi+1))}</span>
                            </div>
                            {(p.style||p.blankCostPerUnit!==undefined)&&(
                              <div style={{fontSize:10,color:"#555",marginTop:2,paddingLeft:17}}>{[p.style].filter(Boolean).join("")}</div>
                            )}
                            {p.color&&<div style={{fontSize:10,color:"#888",paddingLeft:17}}>{p.color}</div>}
                          </td>
                          <td style={{padding:"12px 8px",verticalAlign:"top"}}>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(52px, 1fr))",gap:"3px 6px"}}>
                              {(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).map(sz=>(
                                <div key={sz} style={{fontSize:10,color:"#444",fontFamily:"monospace",whiteSpace:"nowrap"}}>
                                  <span style={{color:"#999",marginRight:3}}>{sz}</span>{p.qtys[sz].toLocaleString()}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td style={{padding:"12px 8px",textAlign:"right",fontFamily:"monospace",fontSize:12,verticalAlign:"top",fontWeight:600,color:"#1a1a1a"}}>{(p.totalQty||0).toLocaleString()}</td>
                          <td style={{padding:"12px 8px",textAlign:"right",fontFamily:"monospace",fontSize:12,verticalAlign:"top",color:"#666"}}>{unitPrice>0?fmtD(unitPrice):"—"}</td>
                          <td style={{padding:"12px 0 12px 8px",textAlign:"right",fontFamily:"monospace",fontSize:12,verticalAlign:"top",fontWeight:700,color:"#1a1a1a"}}>{lineTotal>0?fmtD(lineTotal):"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Order total */}
                <div style={{display:"flex",justifyContent:"flex-end",paddingTop:14,borderTop:"1.5px solid #1a1a1a",marginTop:4}}>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.12em",color:"#aaa",marginBottom:4,fontFamily:"system-ui, sans-serif"}}>Order total</div>
                    <div style={{fontSize:26,fontWeight:800,letterSpacing:"-0.03em",fontFamily:"system-ui, sans-serif",color:"#1a1a1a"}}>{fmtD(quoteTotal)}</div>
                  </div>
                </div>

                {/* Notes */}
                {project?.notes&&(
                  <div style={{marginTop:20,padding:"12px 16px",background:"#f9f9f9",borderRadius:6,fontSize:11,color:"#555",lineHeight:1.7,fontFamily:"system-ui, sans-serif",whiteSpace:"pre-line"}}>
                    <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:6}}>Notes</div>
                    {project.notes}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{padding:"20px 36px",borderTop:"0.5px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"flex-end",fontFamily:"system-ui, sans-serif"}}>
                <div>
                  <div style={{fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#aaa",marginBottom:6}}>House Party Distro</div>
                  <div style={{fontSize:10,color:"#666",lineHeight:1.8}}>jon@housepartydistro.com<br/>3945 W Reno Ave, Ste A<br/>Las Vegas, NV 89118</div>
                </div>
                {approved?(
                  <div style={{textAlign:"center",padding:"10px 20px",background:"#f0fdf4",borderRadius:8,border:"1px solid #bbf7d0"}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#16a34a",marginBottom:2}}>✓ Quote Approved</div>
                    <div style={{fontSize:11,color:"#555"}}>Status: {project.prodStatus}</div>
                  </div>
                ):(
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <button
                      onClick={()=>{if(window.confirm("Approve this quote and proceed to deposit?")){onSave&&onSave({...project,prodStatus:"Awaiting Deposit"});}}}
                      style={{background:"#1a1a1a",color:"#fff",border:"none",borderRadius:5,padding:"9px 22px",fontSize:12,fontFamily:"system-ui, sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:"0.04em"}}>
                      Approve quote
                    </button>
                    <button style={{background:"transparent",color:"#555",border:"1px solid #ccc",borderRadius:5,padding:"9px 16px",fontSize:12,fontFamily:"system-ui, sans-serif",cursor:"pointer"}}>
                      Request changes
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* PO */}

    </div>
  );
};


export { CostingTab };

export function CostingTabWrapper({ project, buyItems = [], contacts = [], onUpdateBuyItems, onRegisterSave, onSaveStatus, onSaved, initialTab = "calc", hideSubTabs = false }) {
  const [pricingReady, setPricingReady] = useState(false);
  const vendorIdMapRef = React.useRef({});
  const lastBuyItemsRef = React.useRef("");

  // Load decorator pricing + IDs from DB on mount
  useEffect(() => {
    async function loadPricing() {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data } = await supabase.from("decorators").select("id, name, short_code, pricing_data").order("name");
        if (data) {
          loadPricingFromDecorators(data);
          const idMap = {};
          data.forEach(d => { idMap[d.short_code || d.name] = d.id; });
          vendorIdMapRef.current = idMap;
        }
      } catch(e) { console.error("Failed to load decorator pricing", e); }
      setPricingReady(true);
    }
    loadPricing();
  }, []);

  const savedData = project?.costing_data || null;

  const initItems = (buyItems || []).map(it => {
    const saved = savedData?.costProds?.find((p) => p.id === it.id);
    if (saved) return { ...saved, sizes: sortSizes(it.sizes || []), qtys: it.qtys || saved.qtys || {}, garment_type: it.garment_type || saved.garment_type || null };
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
      ...(it.garment_type === "accessory" && !saved ? { customCosts: [{desc:it.blank_vendor||"",perUnit:0,flat:false},{desc:"",perUnit:0,flat:true},{desc:"",perUnit:0,flat:true}] } : {}),
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

  // Auto-detect print locations from PSD files (runs once on load)
  const psdDetectedRef = React.useRef(false);
  useEffect(() => {
    if (psdDetectedRef.current) return;
    psdDetectedRef.current = true;
    // Only process items with no print locations set
    const itemsNeedingPsd = costProds.filter(cp => {
      if (cp.garment_type === "accessory") return false;
      const locs = cp.printLocations || {};
      const hasLocations = Object.values(locs).some(l => l?.location);
      return !hasLocations;
    });
    if (itemsNeedingPsd.length === 0) return;

    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const ids = itemsNeedingPsd.map(cp => cp.id);
      const { data: psdFiles } = await supabase.from("item_files").select("item_id, drive_file_id, file_name").in("item_id", ids).ilike("file_name", "%.psd");
      if (!psdFiles || psdFiles.length === 0) return;

      // Take first PSD per item
      const psdByItem = {};
      for (const f of psdFiles) { if (!psdByItem[f.item_id]) psdByItem[f.item_id] = f; }

      const PLACEMENT_MAP = { 'Front':'Full Front','Full Front':'Full Front','Back':'Full Back','Full Back':'Full Back','Left Chest':'Left Chest','Right Chest':'Right Chest','Left Sleeve':'Left Sleeve','Right Sleeve':'Right Sleeve','Neck':'Neck','Hood':'Hood','Pocket':'Pocket' };
      const SKIP_GROUPS = ['Shirt Color','Shadows','Highlights','Mask','Client Art'];

      for (const [itemId, psdFile] of Object.entries(psdByItem)) {
        try {
          const res = await fetch(`/api/files/thumbnail?id=${psdFile.drive_file_id}`);
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

            newLocations[String(locIdx)] = {
              location: locName,
              screens: colorCount,
              printer: "",
            };
            locIdx++;
          }

          // Pad remaining slots empty
          for (let i = locIdx; i <= 6; i++) newLocations[String(i)] = {};

          setCostProds(prev => prev.map(cp => {
            if (cp.id !== itemId) return cp;
            const hasExisting = Object.values(cp.printLocations || {}).some(l => l?.location);
            if (hasExisting) return cp; // Don't overwrite if user already set locations
            return {
              ...cp,
              printLocations: newLocations,
              printCount: locIdx - 1,
              tagPrint: hasTag || cp.tagPrint,
            };
          }));
        } catch (e) {
          console.error("PSD auto-detect error for item", itemId, e);
        }
      }
    })();
  }, []);

  // Sync buy item changes (name, sizes, qtys, adds, removes) into both costProds AND savedCostProds
  // Only runs when buyItems actually changes (compared by serialized snapshot)
  useEffect(() => {
    if (!buyItems.length) return;
    const snapshot = JSON.stringify(buyItems.map(b => ({ id:b.id, name:b.name, sizes:b.sizes, qtys:b.qtys, totalQty:b.totalQty, garment_type:b.garment_type })));
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
        if (it.garment_type === "accessory") newItem.customCosts = [{desc:it.blank_vendor||"",perUnit:0,flat:false},{desc:"",perUnit:0,flat:true},{desc:"",perUnit:0,flat:true}];
        return newItem;
      });
      // Update existing + remove deleted
      const updated = prev.filter(cp => buyIds.has(cp.id)).map(cp => {
        const bi = buyItems.find(b => b.id === cp.id);
        if (!bi) return cp;
        const totalQty = bi.totalQty || Object.values(bi.qtys || {}).reduce((a, v) => a + v, 0);
        return { ...cp, name: bi.name || cp.name, sizes: sortSizes(bi.sizes || []), qtys: bi.qtys || cp.qtys, totalQty, garment_type: bi.garment_type || cp.garment_type || null };
      });
      return newItems.length > 0 ? [...updated, ...newItems] : updated;
    };
    setCostProds(applySync);
    setSavedCostProds(applySync);
  }, [buyItems]);

  // Debounced auto-save — fires 1.5s after any change
  useEffect(() => {
    if (!costingDirty) return;
    setSaveStatus("saving"); if(onSaveStatus) onSaveStatus("saving");
    const t = setTimeout(async () => {
      await onSaveRef.current?.();
      setSaveStatus("saved"); if(onSaveStatus) onSaveStatus("saved");
      if(onSaveStatus) onSaveStatus("saved");
    }, 800);
    return () => clearTimeout(t);
  }, [costProds, costMargin, inclShip, inclCC, orderInfo]);

  // Register save with parent for tab-switch saves
  useEffect(() => {
    if (typeof onRegisterSave === "function") {
      onRegisterSave(async () => { await onSaveRef.current?.(); });
    }
  }, [costProds, costMargin, inclShip, inclCC, orderInfo]);

  const onSave = async () => {
    setSavedCostProds(JSON.parse(JSON.stringify(costProds)));
    setSavedOrderInfo(JSON.parse(JSON.stringify(orderInfo)));
    if (project?.id) {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const results = costProds.map(p => calcCostProduct(p, costMargin, inclShip, inclCC, costProds)).filter(Boolean);
        const grossRev = results.reduce((a,r) => a + r.grossRev, 0);
        const totalCost = results.reduce((a,r) => a + r.totalCost, 0);
        const netProfit = results.reduce((a,r) => a + r.netProfit, 0);
        const totalQty = results.reduce((a,r) => a + r.qty, 0);
        const margin = grossRev > 0 ? netProfit / grossRev * 100 : 0;
        const avgPerUnit = totalQty > 0 ? grossRev / totalQty : 0;
        await supabase.from("jobs").update({
          costing_data: { costProds, costMargin, inclShip, inclCC, orderInfo },
          costing_summary: { grossRev, totalCost, netProfit, margin, avgPerUnit, totalQty }
        }).eq("id", project.id);
        if (onSaved) onSaved({ costing_data: { costProds, costMargin, inclShip, inclCC, orderInfo }, costing_summary: { grossRev, totalCost, netProfit, margin, avgPerUnit, totalQty } });
        // Write refined blank costs + decorator assignments back to items
        for (const cp of costProds) {
          const r2 = calcCostProduct(cp, costMargin, inclShip, inclCC, costProds);
          const itemUpdates = {};
          if (cp.blankCosts && Object.keys(cp.blankCosts).length > 0) {
            const costValues = Object.values(cp.blankCosts).filter(v => v > 0);
            itemUpdates.blank_costs = cp.blankCosts;
            itemUpdates.cost_per_unit = costValues.length > 0 ? costValues.reduce((a, v) => a + v, 0) / costValues.length : null;
          }
          if (r2?.sellPerUnit > 0) {
            itemUpdates.sell_per_unit = Math.round(r2.sellPerUnit * 100) / 100;
          }
          if (Object.keys(itemUpdates).length > 0) {
            await supabase.from("items").update(itemUpdates).eq("id", cp.id);
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
        // Update parent items with decorator names so progress bar reflects costing status
        if (onUpdateBuyItems) {
          const decMap = {};
          for (const cp of costProds) { if (cp.printVendor) decMap[cp.id] = cp.printVendor; }
          if (Object.keys(decMap).length > 0) {
            onUpdateBuyItems(prev => prev.map(bi => decMap[bi.id] ? {...bi, decorator: decMap[bi.id]} : bi));
          }
        }
      } catch(e) { console.error("Failed to save costing data", e); }
    }
  };
  onSaveRef.current = onSave;
  if (!pricingReady) return <div style={{padding:"2rem",color:"#7a82a0",fontSize:13}}>Loading pricing...</div>;
  return (
    <CostingTab
      project={project} buyItems={buyItems} contacts={contacts} onUpdateBuyItems={onUpdateBuyItems}
      costProds={costProds} setCostProds={setCostProds}
      costMargin={costMargin} setCostMargin={setCostMargin}
      inclShip={inclShip} setInclShip={setInclShip}
      inclCC={inclCC} setInclCC={setInclCC}
      orderInfo={orderInfo} setOrderInfo={setOrderInfo}
      costingDirty={costingDirty} onSave={onSave} saveStatus={saveStatus} initialTab={initialTab} hideSubTabs={hideSubTabs}
    />
  );
}
