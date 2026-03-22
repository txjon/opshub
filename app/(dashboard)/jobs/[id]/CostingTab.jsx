"use client";
import React, { useState, useEffect, useMemo } from "react";

const T = {
  bg:"#0f1117", surface:"#181c27", card:"#1e2333", border:"#2a3050",
  accent:"#4f8ef7", accentDim:"#1e3a6e",
  green:"#34c97a", greenDim:"#0e3d24",
  amber:"#f5a623", amberDim:"#3d2a08",
  red:"#f05353", redDim:"#3d1212",
  purple:"#a78bfa", purpleDim:"#2d1f5e",
  text:"#e8eaf2", muted:"#7a82a0", faint:"#3a4060",
};
const font = `'IBM Plex Sans','Helvetica Neue',Arial,sans-serif`;
const mono = `'IBM Plex Mono','Courier New',monospace`;

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
const MARGIN_TIERS = {"10%":1.15,"15%":1.26,"20%":1.33,"25%":1.43,"30%":1.53};
const PRINTERS = {
  "STOKED":{qtys:[48,72,101,144,221,300,400,500,750,1000,2000,2500,5000,10000],prices:{1:[1.75,1.27,1.14,0.93,0.86,0.74,0.72,0.70,0.68,0.58,0.58,0.55,0.51,0.51],2:[2.51,1.84,1.63,1.23,1.14,0.94,0.91,0.83,0.81,0.69,0.67,0.56,0.51,0.51],3:[3.27,2.42,2.15,1.54,1.41,1.14,1.08,0.98,0.94,0.79,0.77,0.57,0.51,0.51],4:[4.03,2.99,2.65,1.86,1.69,1.34,1.27,1.12,1.07,0.89,0.87,0.58,0.54,0.53],5:[4.80,3.58,3.17,2.15,1.96,1.50,1.42,1.26,1.21,0.99,0.97,0.59,0.54,0.54],6:[6.02,4.50,4.02,2.64,2.41,1.81,1.72,1.51,1.45,1.18,1.15,0.64,0.56,0.56],7:[6.59,4.98,4.42,2.82,2.55,1.93,1.82,1.61,1.54,1.23,1.20,0.64,0.57,0.56],8:[7.09,5.31,4.69,3.07,2.78,2.06,1.94,1.69,1.61,1.30,1.26,0.65,0.57,0.56],9:[8.49,5.87,5.18,3.37,3.04,2.25,2.12,1.82,1.74,1.40,1.35,0.66,0.57,0.57],10:[9.88,6.44,5.68,3.72,3.36,2.44,2.30,1.97,1.86,1.50,1.45,0.66,0.58,0.57],11:[11.26,7.00,6.18,4.08,3.68,2.62,2.47,2.12,2.01,1.60,1.54,0.74,0.65,0.64],12:[12.50,7.46,6.56,4.68,4.25,2.82,2.65,2.26,2.14,1.70,1.64,0.76,0.65,0.64]},tagPrices:[0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55],finishing:{Tee:0.55,Longsleeve:0.55,Fleece:0.55},setup:{Screens:0,TagScreens:0,Seps:20,InkChange:15},specialty:{HangTag:0.25,HemTag:0.50,Applique:0.75,WaterBase:0.35,Glow:0.30,Shimmer:0.25,Metallic:0.75,Puff:0.50,HighDensity:0.50,Reflective:0.40,Foil:1.50}},
  "TEELAND":{qtys:[48,72,101,144,221,300,400,500,750,1000,2000,2500,5000,10000],prices:{1:[1.75,1.27,1.14,0.93,0.86,0.74,0.72,0.70,0.68,0.58,0.58,0.55,0.51,0.51],2:[2.51,1.84,1.63,1.23,1.14,0.94,0.91,0.83,0.81,0.69,0.67,0.56,0.51,0.51],3:[3.27,2.42,2.15,1.54,1.41,1.14,1.08,0.98,0.94,0.79,0.77,0.57,0.51,0.51],4:[4.03,2.99,2.65,1.86,1.69,1.34,1.27,1.12,1.07,0.89,0.87,0.58,0.54,0.53],5:[4.80,3.58,3.17,2.15,1.96,1.50,1.42,1.26,1.21,0.99,0.97,0.59,0.54,0.54],6:[6.02,4.50,4.02,2.64,2.41,1.81,1.72,1.51,1.45,1.18,1.15,0.64,0.56,0.56],7:[6.59,4.98,4.42,2.82,2.55,1.93,1.82,1.61,1.54,1.23,1.20,0.64,0.57,0.56],8:[7.09,5.31,4.69,3.07,2.78,2.06,1.94,1.69,1.61,1.30,1.26,0.65,0.57,0.56],9:[8.49,5.87,5.18,3.37,3.04,2.25,2.12,1.82,1.74,1.40,1.35,0.66,0.57,0.57],10:[9.88,6.44,5.68,3.72,3.36,2.44,2.30,1.97,1.86,1.50,1.45,0.66,0.58,0.57],11:[11.26,7.00,6.18,4.08,3.68,2.62,2.47,2.12,2.01,1.60,1.54,0.74,0.65,0.64],12:[12.50,7.46,6.56,4.68,4.25,2.82,2.65,2.26,2.14,1.70,1.64,0.76,0.65,0.64]},tagPrices:[0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55],finishing:{Tee:0.55,Longsleeve:0.55,Fleece:0.55},setup:{Screens:0,TagScreens:0,Seps:20,InkChange:15},specialty:{HangTag:0.25,HemTag:0.50,Applique:0.75,WaterBase:0.35,Glow:0.30,Shimmer:0.25,Metallic:0.75,Puff:0.50,HighDensity:0.50,Reflective:0.40,Foil:1.50}},
  "ICON":{qtys:[96,144,216,288,500,1000,3000],prices:{1:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],2:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],3:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],4:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],5:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],6:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],7:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],8:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],9:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],10:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],11:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],12:[1.10,1.00,1.00,0.85,0.75,0.65,0.60]},tagPrices:[0.50,0.50,0.50,0.45,0.45,0.40,0.40],finishing:{Tee:0.40,Longsleeve:0.50,Fleece:0.50},setup:{Screens:20,TagScreens:10,Seps:20,InkChange:20},specialty:{HangTag:0.10,HemTag:0.30,Applique:0.50,WaterBase:0.10,Glow:0.80,Shimmer:0.60,Metallic:0.60,Puff:0.75,HighDensity:0.65,Reflective:0.80,Foil:1.25}},
  "PACIFIC":{qtys:[96,144,216,288,500,1000,3000],prices:{},tagPrices:[],finishing:{},setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0},specialty:{}},
  "TEELAND EMB":{qtys:[96,144,216,288,500,1000,3000],prices:{},tagPrices:[],finishing:{},setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0},specialty:{}},
  "SHARON":{qtys:[96,144,216,288,500,1000,3000],prices:{},tagPrices:[],finishing:{},setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0},specialty:{}},
  "MERCH BROS":{qtys:[96,144,216,288,500,1000,3000],prices:{},tagPrices:[],finishing:{},setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0},specialty:{}},
};

function lookupPrintPrice(pk,qty,colors){
  const p=PRINTERS[pk]; if(!p||!p.qtys.length)return 0;
  let idx=0; for(let i=0;i<p.qtys.length;i++){if(qty>=p.qtys[i])idx=i;}
  const c=Math.min(Math.max(Math.round(colors),1),12);
  return p.prices[c]?.[idx]??0;
}
function lookupTagPrice(pk,qty){
  const p=PRINTERS[pk]; if(!p||!p.tagPrices.length)return 0;
  let idx=0; for(let i=0;i<p.qtys.length;i++){if(qty>=p.qtys[i])idx=i;}
  return p.tagPrices[idx]??0;
}
function applyMargin(cost,mk){return cost*(MARGIN_TIERS[mk]??1.53);}

function calcCostProduct(p,margin,inclShip,inclCC,allProds=[]){
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
  for(let loc=1;loc<=6;loc++){
    const ld=p.printLocations?.[loc];
    const printer=ld?.printer||p.printVendor;
    if(printer&&ld?.screens>0){
      const isShared=!!(ld.shared)&&ld.location;
      const sharedQty=isShared?allProds.reduce((sum,cp)=>{
        const match=Object.values(cp.printLocations||{}).find(l=>l.location&&l.location.trim().toLowerCase()===ld.location.trim().toLowerCase()&&l.screens>0);
        return sum+(match?cp.totalQty||0:0);
      },0):0;
      const effectiveQty=isShared&&sharedQty>0?sharedQty:qty;
      printTotal+=lookupPrintPrice(printer,effectiveQty,ld.screens);
    }
  }
  if(p.tagPrint&&p.printVendor) printTotal+=lookupTagPrice(p.printVendor,qty);
  let finUnitRate=0;
  if(p.finishingQtys&&p.printVendor){
    const pr=PRINTERS[p.printVendor];
    const activeLocs=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length||0;
    if(pr){
      if(p.finishingQtys["Packaging_on"]){const variant=p.isFleece?"Fleece":(p.finishingQtys["Packaging_variant"]||"Tee");finUnitRate+=(pr.finishing?.[variant]||0);}
      if(p.finishingQtys["HangTag_on"]){finUnitRate+=(pr.specialty?.HangTag||0);}
      if(p.finishingQtys["HemTag_on"]){finUnitRate+=(pr.specialty?.HemTag||0);}
      if(p.finishingQtys["Applique_on"]){finUnitRate+=(pr.specialty?.Applique||0);}
      if(p.isFleece){const locs=activeLocs+(p.tagPrint?1:0);finUnitRate+=(pr.finishing?.Tee||0)*locs;}
    }
  }
  let specUnitRate=0;
  if(p.specialtyQtys&&p.printVendor){
    const pr=PRINTERS[p.printVendor];
    if(pr){
      const activeLocs=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length||0;
      ["WaterBase","Glow","Shimmer","Metallic","Puff","HighDensity","Reflective","Foil"].forEach(key=>{
        if(p.specialtyQtys[key+"_on"]){specUnitRate+=(pr.specialty?.[key]||0)*activeLocs;}
      });
    }
  }
  let setupTotal=0;
  if(p.setupFees){
    const pr=PRINTERS[p.printVendor||p.setupFees?.printer];
    const autoScreens=[1,2,3,4,5,6].reduce((a,loc)=>a+(parseFloat(p.printLocations?.[loc]?.screens)||0),0);
    if(pr) setupTotal+=(pr.setup.Screens||0)*autoScreens;
    const activeSizes=(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).length;
    if(pr&&!p.tagRepeat) setupTotal+=(pr.setup.TagScreens||0)*(p.tagPrint?activeSizes:(p.setupFees?.tagSizes||0));
    if(pr) setupTotal+=(pr.setup.Seps||0)*(p.setupFees.seps||0);
    if(pr) setupTotal+=(pr.setup.InkChange||0)*(p.setupFees.inkChanges||0);
    if(p.setupFees.manualCost>0) setupTotal+=p.setupFees.manualCost;
  }
  const customTotal=(p.customCosts||[]).reduce((a,c)=>a+(c.amount||0),0);
  const perUnitPORate=printTotal+finUnitRate+specUnitRate;
  const poTotal=perUnitPORate*qty+setupTotal+customTotal;
  const shipping=inclShip?qty*(p.isFleece?1.50:0.65):0;
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
const EMPTY_COST_PRODUCT=()=>({id:Date.now()+Math.random(),name:"",style:"",color:"",sizes:[],qtys:{},blankCosts:{},totalQty:0,unitPrice:0,sellOverride:null,isFleece:false,printVendor:"",printCount:4,printLocations:{},tagPrint:false,tagRepeat:false,tagPrintPrinter:"",specialtyQtys:{},finishingQtys:{},customCosts:[],finishingType:"",finishingPrinter:"",finishingCostOverride:0,specialties:[],setupFees:{printer:"",screens:0,tagSizes:0,seps:0,inkChanges:0,manualCost:0}});

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

const CostingTab=({project,buyItems=[],onUpdateBuyItems,costProds,setCostProds,costMargin,setCostMargin,inclShip,setInclShip,inclCC,setInclCC,orderInfo,setOrderInfo,costingDirty,onSave})=>{
  const [costTab,setCostTab]=useState("calc");
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

  useEffect(()=>{
    if(!buyItems.length) return;
    setCostProds(prev=>{
      const existingIds=new Set(prev.map(p=>p.id));
      const newItems=buyItems.filter(bi=>!existingIds.has(bi.id)).map(it=>{
        const styleKey=(it.style||"").split("–")[0].trim().replace(/\s+/g,"");
        const blankCosts=seedBlankCosts(styleKey,it.color||"",it.sizes||[]);
        return{...EMPTY_COST_PRODUCT(),id:it.id,name:it.name||"",style:it.style||"",color:it.color||"",sizes:it.sizes||[],qtys:it.qtys||{},blankCosts,totalQty:it.totalQty||0};
      });
      const updated=prev.map(cp=>{
        const bi=buyItems.find(b=>b.id===cp.id);
        if(!bi) return cp;
        return{...cp,qtys:bi.qtys||cp.qtys,totalQty:bi.totalQty||cp.totalQty,sizes:bi.sizes||cp.sizes,name:bi.name||cp.name||""};
      });
      const buyIds=new Set(buyItems.map(b=>b.id));
      const filtered=updated.filter(cp=>buyIds.has(cp.id));
      const result=newItems.length>0?[...filtered,...newItems]:filtered;
      return result;
    });
  },[buyItems]);

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
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginTop:-20}}>
        <div style={{display:"flex",gap:4,background:T.surface,padding:4,borderRadius:8}}>
          {[["calc","Calculator"],["quote","Client Quote"],["po","Purchase Order"]].map(([k,l])=>(
            <button key={k} onClick={()=>setCostTab(k)}
              style={{background:costTab===k?T.accent:"transparent",color:costTab===k?"#fff":T.muted,border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,fontFamily:font,fontWeight:600,cursor:"pointer"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {costingDirty&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:T.amberDim,border:"1px solid "+T.amber+"66",borderRadius:8,padding:"8px 14px",marginTop:-8}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:T.amber,flexShrink:0,display:"inline-block"}}/>
            <span style={{fontSize:12,color:T.amber,fontFamily:font,fontWeight:600}}>Unsaved changes — your cost and pricing data will be lost if you navigate away without saving.</span>
          </div>
          <button onClick={async()=>await onSave()} style={{background:T.amber,border:"none",borderRadius:6,color:"#fff",fontSize:12,fontFamily:font,fontWeight:700,padding:"5px 14px",cursor:"pointer",flexShrink:0}}>Save now</button>
        </div>
      )}
      {results.length>0&&(
        <div style={{display:"flex",gap:20,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 16px",flexWrap:"wrap",alignItems:"center"}}>
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
                  style={{background:costMargin===m?T.accent:"transparent",color:costMargin===m?"#fff":T.muted,border:"none",borderRadius:4,padding:"2px 8px",fontSize:11,fontFamily:mono,cursor:"pointer"}}>{m}</button>
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
              const isCollapsed=!!collapsed[p.id];
              const headerBB=isCollapsed?"none":"1px solid "+T.border;
              const bodyDisplay=isCollapsed?"none":"grid";
              const chevron=isCollapsed?"v":"^";
              return(
                <div key={p.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:10,overflow:"hidden"}}>
                  <div onClick={()=>toggleCollapse(p.id)} style={{padding:"12px 16px",borderBottom:headerBB,display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}>
                    <span style={{width:24,height:24,borderRadius:5,background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.accent,fontFamily:mono,flexShrink:0}}>{String.fromCharCode(64+i+1)}</span>
                    <div style={{flex:1}}>
                      <span style={{color:T.text,fontFamily:font,fontSize:13,fontWeight:600}}>{p.name||("Product "+(i+1))}</span>
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
                  <div style={{padding:14,display:bodyDisplay,gridTemplateColumns:"380px 1fr",gap:0,alignItems:"start"}}>
                    {/* BLANKS PANEL */}
                    <div style={{display:"flex",flexDirection:"column",gap:12,paddingRight:16,borderRight:"1px solid "+T.border,width:380,flexShrink:0}}>
                      {/* BLANKS HEADER */}
                      <div style={{fontSize:10,fontWeight:700,color:T.accent,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.1em",paddingBottom:6,borderBottom:`1px solid ${T.border}`}}>Blanks</div>

                      {/* Line 1: Supplier + All button */}
                      <div style={{marginBottom:0}}>
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Supplier</div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{flex:1}}>
                          {p.supplier==="New"||p._newSupplier?(
                            <div style={{display:"flex",gap:4}}>
                              <input autoFocus value={p._newSupplierVal||""} placeholder="Enter supplier…"
                                onChange={e=>updateProd(i,{...p,_newSupplierVal:e.target.value})}
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
                        <button onClick={()=>setCostProds(prev=>prev.map((cp,ci)=>ci>i?{...cp,supplier:p.supplier,_newSupplier:false,_newSupplierVal:""}:cp))}
                          style={{fontSize:10,color:T.accent,fontFamily:font,background:T.accentDim,border:`1px solid ${T.accent}44`,borderRadius:5,cursor:"pointer",padding:"4px 10px",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>↓ All</button>
                      </div>
                      </div>

                      {/* Line 2: Style / Color / Fleece on same line */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end"}}>
                        <CInput label="Style / model" value={p.style||""} onChange={v=>updateProd(i,{...p,style:v})}/>
                        <CInput label="Color" value={p.color||""} onChange={v=>updateProd(i,{...p,color:v})}/>
                        <div>
                          <div style={{fontSize:10,color:T.muted,fontFamily:font,marginBottom:4}}>Fleece</div>
                          <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1px solid ${T.border}`}}>
                            {["Yes","No"].map(opt=>{
                              const sel=(p.isFleece?"Yes":"No")===opt;
                              return(
                                <button key={opt} onClick={()=>updateProd(i,{...p,isFleece:opt==="Yes"})}
                                  style={{padding:"5px 12px",fontSize:12,fontFamily:font,fontWeight:600,border:"none",cursor:"pointer",background:sel?(opt==="Yes"?T.accent:T.surface):T.card,color:sel?(opt==="Yes"?"#fff":T.text):T.faint,transition:"all 0.12s"}}>
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      {/* Collapsible size grid */}
                      <div onClick={()=>updateProd(i,{...p,_blankOpen:!p._blankOpen})} style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",padding:"6px 8px",borderRadius:6,background:p._blankOpen?T.accentDim:T.surface,border:"1px solid "+(p._blankOpen?T.accent+"44":T.border),marginBottom:p._blankOpen?8:0,transition:"all 0.15s"}}>
                        <div style={{fontSize:10,fontWeight:700,color:p._blankOpen?T.accent:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Size breakdown</div>
                        <div style={{display:"flex",alignItems:"center",gap:12}}>
                          {!p._blankOpen&&p.totalQty>0&&<span style={{fontSize:11,color:T.muted,fontFamily:mono}}>{(p.totalQty||0).toLocaleString()} units</span>}
                          {!p._blankOpen&&Object.keys(p.blankCosts||{}).length>0&&<span style={{fontSize:11,color:T.accent,fontFamily:mono}}>{fmtD(Object.entries(p.blankCosts||{}).reduce((a,[sz,bc])=>a+bc*(p.qtys?.[sz]||0)*1.035,0))}</span>}
                          <span style={{fontSize:11,color:p._blankOpen?T.accent:T.faint,display:"inline-block",transform:p._blankOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.15s"}}>v</span>
                        </div>
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
                                        style={{width:60,textAlign:"left",background:"transparent",border:"none",outline:"none",color:qty>0?T.text:T.faint,fontSize:12,fontFamily:mono}}/>
                                    </td>
                                    <td style={{padding:"3px 8px",textAlign:"left",borderRight:`1px solid ${T.border}`}}>
                                      <div style={{display:"flex",alignItems:"center",justifyContent:"flex-start",gap:2}}>
                                        <span style={{fontSize:11,color:T.faint,fontFamily:mono}}>$</span>
                                        <input type="text" inputMode="decimal" value={getCostDisplay(p.id,sz,bc)} placeholder="0.00"
                                          onChange={e=>{ const raw=e.target.value; if(/^\d*\.?\d*$/.test(raw)) setCostLocal(p.id,sz,raw); }}
                                          onBlur={()=>commitCost(i,p,sz)}
                                          data-costfield onKeyDown={e=>{if(e.key==="Enter"){commitCost(i,p,sz);focusNext(e,false);}if(e.key==="Tab"){commitCost(i,p,sz);focusNext(e,e.shiftKey);}if(e.key==="ArrowDown"){e.preventDefault();commitCost(i,p,sz);focusNext({...e,key:"Tab",shiftKey:false},false);}if(e.key==="ArrowUp"){e.preventDefault();commitCost(i,p,sz);focusNext({...e,key:"Tab",shiftKey:true},true);}}}
                                          style={{width:60,textAlign:"left",background:"transparent",border:"none",outline:"none",color:bc>0?T.text:T.faint,fontSize:12,fontFamily:mono}}/>
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
                        <textarea value={p.itemNotes||""} onChange={e=>updateProd(i,{...p,itemNotes:e.target.value})} placeholder="Internal notes for this item..."
                          style={{width:"100%",background:T.surface,border:"1px solid "+T.border,borderRadius:6,color:T.text,fontFamily:font,fontSize:12,padding:"7px 10px",resize:"vertical",outline:"none",minHeight:52,boxSizing:"border-box"}}/>
                      </div>
                      {r&&(
                        <div style={{borderRadius:8,border:"1px solid "+T.border,padding:"8px",marginTop:4,background:T.surface}}>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:6}}>
                            {[
                              ["Revenue", r.grossRev>0?fmtD(r.grossRev):"$0.00", T.accent],
                              ["Blank Cost",    fmtD(r.blankCost),                     T.text],
                              ["PO Total",      fmtD(r.poTotal),                       T.text],
                              ["Total Cost",    fmtD(r.totalCost),                     T.text],
                            ].map(([l,v,c])=>(
                              <div key={l} style={{background:"#181c27",border:"1px solid #2a3050",borderRadius:6,padding:"6px 8px"}}>
                                <div style={{fontSize:8,color:"#5a6285",fontFamily:font,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:2}}>{l}</div>
                                <div style={{fontSize:12,fontWeight:700,color:c,fontFamily:mono}}>{v}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                            {[
                              ["Net Profit",       fmtD(r.netProfit),                     mc2],
                              ["Profit Margin",    fmtP(r.margin_pct),                    mc2],
                              ["Profit per piece", "$"+r.profitPerPiece.toFixed(2),       mc2],
                            ].map(([l,v,c])=>(
                              <div key={l} style={{background:mc2===T.green?"#0e3d24":mc2===T.amber?"#3d2a08":"#3d1212",border:"1px solid "+mc2+"44",borderRadius:6,padding:"6px 8px"}}>
                                <div style={{fontSize:8,color:mc2+"99",fontFamily:font,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:2}}>{l}</div>
                                <div style={{fontSize:12,fontWeight:700,color:mc2,fontFamily:mono}}>{v}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>{/* end blanks panel */}
                    {/* DECORATION PANEL */}
                    <div style={{display:"flex",flexDirection:"column",gap:12,paddingLeft:16}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingBottom:6,borderBottom:"1px solid "+T.border}}>
                        <div style={{fontSize:10,fontWeight:700,color:T.amber,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.1em"}}>Decoration</div>
                        {i>0&&costProds[i-1]&&<button onClick={()=>{const prev=costProds[i-1];updateProd(i,{...p,printVendor:prev.printVendor,printLocations:JSON.parse(JSON.stringify(prev.printLocations||{})),printCount:prev.printCount||4,tagPrint:prev.tagPrint,tagRepeat:prev.tagRepeat,setupFees:{...prev.setupFees}});}}
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
                        <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Print Locations</div>
                        <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <thead>
                              <tr style={{background:T.surface}}>
                                <th style={{padding:"6px 10px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"16%"}}/>
                                <th style={{padding:"6px 10px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"34%"}}>Location</th>
                                <th style={{padding:"6px 10px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"16%"}}>Screens</th>
                                <th style={{padding:"6px 10px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`,width:"16%"}}>Shared</th>
                                <th style={{padding:"6px 10px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",width:"18%"}}>Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from({length:p.printCount||4},(_,idx)=>idx+1).map((loc,idx)=>{
                                const ld=p.printLocations?.[loc]||{};
                                const effectivePrinter=ld.printer||p.printVendor||"";
                                const active=effectivePrinter&&ld.screens>0;
                                const isShared=!!(ld.shared);
                                const sharedQty=isShared&&ld.location?costProds.reduce((sum,cp)=>{
                                  const match=Object.values(cp.printLocations||{}).find(l=>l.location&&l.location.trim().toLowerCase()===ld.location.trim().toLowerCase()&&(l.screens>0||l.location));
                                  return sum+(match?cp.totalQty||0:0);
                                },0):0;
                                const effectiveQty=isShared?sharedQty:(p.totalQty||0);
                                const unitCost=active?lookupPrintPrice(effectivePrinter,effectiveQty||p.totalQty||0,ld.screens):0;
                                const isLast=idx===(p.printCount||4)-1;
                                return(
                                  <tr key={loc} style={{borderBottom:isLast?"none":`1px solid ${T.border}22`,background:active?T.accentDim:T.card}}>
                                    <td style={{padding:"5px 10px",borderRight:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>
                                      <span style={{fontSize:11,fontWeight:700,color:active?T.accent:T.faint,fontFamily:font}}>Print {loc}</span>
                                    </td>
                                    <td style={{padding:"4px 6px",borderRight:`1px solid ${T.border}`}}>
                                      <input value={ld.location||""} onChange={e=>updateProd(i,{...p,printLocations:{...(p.printLocations||{}),[loc]:{...ld,location:e.target.value,printer:ld.printer||p.printVendor||""}}})}
                                        placeholder="Front / Back / Sleeve…"
                                        data-costfield
                                        onKeyDown={e=>{
                                          if(e.key==="Enter"||e.key==="Tab"){focusNext(e,e.shiftKey);}
                                          if(e.key==="ArrowDown"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:false},false);}
                                          if(e.key==="ArrowUp"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:true},true);}
                                        }}
                                        style={{width:"100%",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:font,padding:"2px 4px"}}/>
                                    </td>
                                    <td style={{padding:"4px 6px",borderRight:`1px solid ${T.border}`,textAlign:"center"}}>
                                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={ld.screens||""} placeholder="0"
                                        onChange={e=>updateProd(i,{...p,printLocations:{...(p.printLocations||{}),[loc]:{...ld,screens:parseFloat(e.target.value)||0,printer:ld.printer||p.printVendor||""}}})}
                                        data-costfield onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab")focusNext(e,e.shiftKey);if(e.key==="ArrowDown"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:false},false);}if(e.key==="ArrowUp"){e.preventDefault();focusNext({...e,key:"Tab",shiftKey:true},true);}}}
                                        style={{width:50,textAlign:"center",background:"transparent",border:"none",outline:"none",color:ld.screens?T.text:T.faint,fontSize:12,fontFamily:mono}}/>
                                    </td>
                                    <td style={{padding:"4px 8px",borderRight:`1px solid ${T.border}`,textAlign:"center"}}>
                                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                                        <div style={{display:"flex",borderRadius:4,overflow:"hidden",border:`1px solid ${isShared?T.accent:T.border}`}}>
                                          {["Y","N"].map(opt=>{
                                            const sel=(isShared?"Y":"N")===opt;
                                            return <button key={opt} onClick={()=>updateProd(i,{...p,printLocations:{...(p.printLocations||{}),[loc]:{...ld,shared:opt==="Y"}}})}
                                              style={{padding:"2px 8px",fontSize:10,fontFamily:mono,fontWeight:700,border:"none",cursor:"pointer",background:sel?(opt==="Y"?T.accent:T.surface):T.card,color:sel?(opt==="Y"?"#fff":T.text):T.faint,transition:"all 0.1s"}}>{opt}</button>;
                                          })}
                                        </div>
                                        {isShared&&sharedQty>0&&<span style={{fontSize:9,color:T.accent,fontFamily:mono}}>{sharedQty} total</span>}
                                      </div>
                                    </td>
                                    <td style={{padding:"5px 10px",textAlign:"center",fontFamily:mono,fontSize:12,fontWeight:active?700:400,color:active?T.green:T.faint}}>
                                      {active?fmtD(unitCost):null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {/* Tag Print row */}
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12,borderTop:`2px solid ${T.border}`}}>
                            <tbody>
                              <tr style={{background:p.tagPrint?T.accentDim:T.card,verticalAlign:"top"}}>
                                <td style={{padding:"10px 10px",borderRight:`1px solid ${T.border}`,width:"16%"}}>
                                  <span style={{fontSize:11,fontWeight:700,color:p.tagPrint?T.accent:T.faint,fontFamily:font}}>Tag Print</span>
                                </td>
                                <td style={{padding:"8px 8px",borderRight:`1px solid ${T.border}`,width:"34%"}}>
                                  <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-start"}}>
                                    <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1px solid ${p.tagPrint?T.accent:T.border}`}}>
                                      {["Yes","No"].map(opt=>{
                                        const sel=(p.tagPrint?"Yes":"No")===opt;
                                        return(
                                          <button key={opt} onClick={()=>{
                                            const isYes=opt==="Yes";
                                            const sizeCount=(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).length;
                                            updateProd(i,{...p,tagPrint:isYes,tagRepeat:false,setupFees:{...(p.setupFees||{}),tagSizes:isYes?sizeCount:0}});
                                          }}
                                            style={{padding:"5px 16px",fontSize:12,fontFamily:font,fontWeight:600,border:"none",cursor:"pointer",background:sel?(opt==="Yes"?T.accent:T.surface):T.card,color:sel?(opt==="Yes"?"#fff":T.text):T.faint,transition:"all 0.12s"}}>
                                            {opt}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    {p.tagPrint&&(
                                      <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1px solid ${p.tagRepeat?T.amber:T.border}`}}>
                                        {["New","Repeat"].map(opt=>{
                                          const sel=p.tagRepeat?(opt==="Repeat"):(opt==="New");
                                          return(
                                            <button key={opt} onClick={()=>updateProd(i,{...p,tagRepeat:opt==="Repeat"})}
                                              style={{padding:"4px 14px",fontSize:11,fontFamily:font,fontWeight:600,border:"none",cursor:"pointer",background:sel?(opt==="Repeat"?T.amber:T.surface):T.card,color:sel?(opt==="Repeat"?"#fff":T.text):T.faint,transition:"all 0.12s"}}>
                                              {opt}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td style={{padding:"10px 10px",borderRight:`1px solid ${T.border}`,textAlign:"center",width:"16%"}}>
                                  {p.tagPrint&&(
                                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                                      <span style={{fontSize:14,fontWeight:700,color:p.tagRepeat?T.faint:T.text,fontFamily:mono,textDecoration:p.tagRepeat?"line-through":"none"}}>
                                        {(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).length}
                                      </span>
                                      {p.tagRepeat&&<span style={{fontSize:12,fontWeight:700,color:T.amber,fontFamily:mono}}>0</span>}
                                    </div>
                                  )}
                                </td>
                                <td style={{padding:"10px 10px",borderRight:`1px solid ${T.border}`,textAlign:"center",width:"16%"}}/>
                                <td style={{padding:"10px 10px",textAlign:"center",width:"18%"}}>
                                  {p.tagPrint&&(
                                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                                      <span style={{fontSize:13,fontWeight:700,color:T.green,fontFamily:mono}}>
                                        {fmtD(lookupTagPrice(p.printVendor||"",p.totalQty||0))}
                                      </span>
                                      {p.tagRepeat&&<span style={{fontSize:9,color:T.amber,fontFamily:font}}>screens $0</span>}
                                    </div>
                                  )}
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
                      {/* Finishing & Packaging */}
                      <div>
                        <div onClick={()=>updateProd(i,{...p,_finOpen:!p._finOpen})}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",padding:"6px 8px",borderRadius:6,background:p._finOpen?T.accentDim:T.surface,border:`1px solid ${p._finOpen?T.accent+"44":T.border}`,marginBottom:p._finOpen?8:0,transition:"all 0.15s"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:p._finOpen?T.accent:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Finishing & Packaging</div>
                            {!p._finOpen&&!!(p.finishingQtys?.Packaging_on||p.finishingQtys?.HangTag_on||p.finishingQtys?.HemTag_on||p.finishingQtys?.Applique_on||p.isFleece)&&<span style={{fontSize:11,color:T.green}}>✓</span>}
                          </div>
                          <span style={{fontSize:11,color:p._finOpen?T.accent:T.faint,display:"inline-block",transform:p._finOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.15s"}}>v</span>
                        </div>
                        {p._finOpen&&<div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                            <tbody>
                              {[
                                {label:"Packaging", key:"Packaging", col3:"variant", col4:"finishing_variant"},
                                {label:"Hang Tag", key:"HangTag", col3:"blank", col4:"specialty"},
                                {label:"Hem Tag", key:"HemTag", col3:"blank", col4:"specialty"},
                                {label:"Applique", key:"Applique", col3:"blank", col4:"specialty"},
                                {label:"Fleece Upcharge", key:"FleeceUpcharge", col3:"print_count", col4:"finishing_fleece"},
                              ].map(({label,key,col3,col4},idx,arr)=>{
                                const pr=PRINTERS[p.printVendor];
                                const active=key==="FleeceUpcharge"?p.isFleece:!!(p.finishingQtys?.[key+"_on"]);
                                const totalPrints=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length||0;
                                const fleecePrintCount=p.isFleece?(totalPrints+(p.tagPrint?1:0)):0;
                                const packagingVariant=p.finishingQtys?.["Packaging_variant"]||"Tee";
                                const unitCost=col4==="finishing_variant"?(pr?.finishing?.[packagingVariant]||0):col4==="specialty"?(pr?.specialty?.[key]||0):col4==="finishing_fleece"?(pr?.finishing?.Tee||0):0;
                                const qty=col3==="print_count"?fleecePrintCount:col3==="blank"?(p.finishingQtys?.[key+"_qty"]||0):col3==="variant"?(p.totalQty||0):totalPrints;
                                const total=active?(col3==="variant"||col3==="blank"?unitCost:unitCost*(col3==="print_count"?fleecePrintCount:qty)):0;
                                const isLast=idx===arr.length-1;
                                return(
                                  <tr key={label} style={{borderBottom:isLast?"none":`1px solid ${T.border}22`,background:active?T.accentDim:idx%2===0?T.card:T.surface}}>
                                    <td style={{padding:"7px 14px",fontFamily:font,fontSize:12,fontWeight:600,color:active?T.accent:T.muted,borderRight:`1px solid ${T.border}`,width:"30%"}}>{label}</td>
                                    <td style={{padding:"5px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"20%"}}>
                                      {key==="FleeceUpcharge"?(
                                        <div style={{display:"flex",borderRadius:5,overflow:"hidden",border:`1px solid ${T.border}`,width:"fit-content",margin:"0 auto",opacity:0.8}}>
                                          {["Yes","No"].map(opt=>{
                                            const sel=(p.isFleece?"Yes":"No")===opt;
                                            return <div key={opt} style={{padding:"3px 10px",fontSize:11,fontFamily:font,fontWeight:600,background:sel?(opt==="Yes"?T.accent:T.surface):T.card,color:sel?(opt==="Yes"?"#fff":T.text):T.faint}}>{opt}</div>;
                                          })}
                                        </div>
                                      ):(
                                        <div style={{display:"flex",borderRadius:5,overflow:"hidden",border:`1px solid ${T.border}`,width:"fit-content",margin:"0 auto"}}>
                                          {["Yes","No"].map(opt=>{
                                            const sel=(active?"Yes":"No")===opt;
                                            return(
                                              <button key={opt} onClick={()=>updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),[key+"_on"]:opt==="Yes"?1:0}})}
                                                style={{padding:"3px 10px",fontSize:11,fontFamily:font,fontWeight:600,border:"none",cursor:"pointer",background:sel?(opt==="Yes"?T.accent:T.surface):T.card,color:sel?(opt==="Yes"?"#fff":T.text):T.faint,transition:"all 0.12s"}}>
                                                {opt}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{padding:"5px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"25%"}}>
                                      {col3==="blank"?null:col3==="variant"?(
                                        <select
                                          value={p.isFleece?"Fleece":(p.finishingQtys?.["Packaging_variant"]||"Tee")}
                                          disabled={!active}
                                          onChange={e=>updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),Packaging_variant:e.target.value}})}
                                          style={{background:active?T.surface:T.card,border:`1px solid ${active?T.border:T.faint+"44"}`,borderRadius:5,color:active?T.text:T.faint,fontFamily:font,fontSize:11,padding:"3px 6px",outline:"none",cursor:active?"pointer":"default",opacity:active?1:0.5}}>
                                          {["Tee","Longsleeve","Fleece"].map(v=><option key={v} value={v}>{v}</option>)}
                                        </select>
                                      ):col3==="print_count"?(
                                        <span style={{fontSize:12,fontWeight:p.isFleece&&active?700:400,color:p.isFleece&&active?T.text:T.faint,fontFamily:mono}}>{p.isFleece?fleecePrintCount:null}</span>
                                      ):(
                                        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                                          <span style={{fontSize:12,fontWeight:active?700:400,color:active?T.text:T.faint,fontFamily:mono}}>{active?totalPrints:null}</span>
                                          {active&&<span style={{fontSize:9,color:T.faint,fontFamily:font}}>auto</span>}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{padding:"7px 14px",textAlign:"right",fontFamily:mono,fontSize:12,fontWeight:total>0?700:400,color:total>0?T.green:T.faint,width:"25%"}}>
                                      {active&&total>0?fmtD(total):(unitCost>0&&!active?<span style={{fontSize:10,color:T.faint}}>{fmtD(unitCost)} ea</span>:null)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>}
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
                          const autoScreens=[1,2,3,4,5,6].reduce((a,loc)=>a+(parseFloat(p.printLocations?.[loc]?.screens)||0),0);
                          const tagScreenCount=p.tagPrint&&!p.tagRepeat?(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).length:0;
                          const rows=[
                            {label:"Screens", qty:autoScreens, auto:true, unitCost:pr?.setup?.Screens||0, field:"screens"},
                            {label:"Tag Screens", qty:tagScreenCount, auto:p.tagPrint, unitCost:p.tagRepeat?0:(pr?.setup?.TagScreens||0), field:"tagSizes"},
                            {label:"Seps", qty:p.setupFees?.seps||0, auto:false, unitCost:pr?.setup?.Seps||0, field:"seps"},
                            {label:"Ink Change", qty:p.setupFees?.inkChanges||0, auto:false, unitCost:pr?.setup?.InkChange||0, field:"inkChanges"},
                          ];
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
                                        <td style={{padding:"4px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"30%"}}>
                                          {row.auto?(
                                            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                                              <span style={{fontSize:13,fontWeight:700,color:row.qty>0?T.text:T.faint,fontFamily:mono}}>{row.qty||null}</span>
                                              <span style={{fontSize:9,color:T.faint,fontFamily:font}}>auto</span>
                                            </div>
                                          ):(
                                            <input type="number" min="0" value={p.setupFees?.[row.field]||""} placeholder="0"
                                              onChange={e=>updateProd(i,{...p,setupFees:{...(p.setupFees||{}),[row.field]:parseInt(e.target.value)||0}})}
                                              data-costfield onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab")focusNext(e,e.shiftKey);}}
                                              style={{width:60,textAlign:"center",background:"transparent",border:"none",outline:"none",color:row.qty>0?T.text:T.faint,fontSize:13,fontFamily:mono}}/>
                                          )}
                                        </td>
                                        <td style={{padding:"7px 12px",textAlign:"right",fontFamily:mono,fontSize:12,fontWeight:total>0?700:400,color:total>0?T.green:T.faint,width:"35%"}}>
                                          {row.unitCost>0?(total>0?fmtD(total):(fmtD(row.unitCost)+" ea")):null}
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
                      {/* Specialty */}
                      <div>
                        <div onClick={()=>updateProd(i,{...p,_specOpen:!p._specOpen})}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",padding:"6px 8px",borderRadius:6,background:p._specOpen?T.accentDim:T.surface,border:`1px solid ${p._specOpen?T.accent+"44":T.border}`,marginBottom:p._specOpen?8:0,transition:"all 0.15s"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:p._specOpen?T.accent:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Specialty</div>
                            {!p._specOpen&&Object.keys(p.specialtyQtys||{}).some(k=>k.endsWith("_on")&&p.specialtyQtys[k])&&<span style={{fontSize:11,color:T.green}}>✓</span>}
                          </div>
                          <span style={{fontSize:11,color:p._specOpen?T.accent:T.faint,transition:"transform 0.15s",display:"inline-block",transform:p._specOpen?"rotate(180deg)":"rotate(0deg)"}}>v</span>
                        </div>
                        {p._specOpen&&<div>
                          <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                            <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                              <tbody>
                                {["Water Base","Glow","Shimmer","Metallic","Puff","High Density","Reflective","Foil"].map((label,idx,arr)=>{
                                  const key=label.replace(/\s+/g,"");
                                  const pr=PRINTERS[p.printVendor];
                                  const unitCost=pr?.specialty?.[key]||0;
                                  const activePrintCount=[1,2,3,4,5,6].filter(loc=>{const ld=p.printLocations?.[loc];return ld?.location||ld?.screens>0;}).length||0;
                                  const active=!!(p.specialtyQtys?.[key+"_on"]);
                                  const total=active?unitCost*activePrintCount:0;
                                  const isLast=idx===arr.length-1;
                                  return(
                                    <tr key={label} style={{borderBottom:isLast?"none":`1px solid ${T.border}22`,background:active?T.accentDim:idx%2===0?T.card:T.surface}}>
                                      <td style={{padding:"7px 14px",fontFamily:font,fontSize:12,fontWeight:600,color:active?T.accent:T.muted,borderRight:`1px solid ${T.border}`,width:"30%"}}>{label}</td>
                                      <td style={{padding:"5px 8px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"20%"}}>
                                        <div style={{display:"flex",borderRadius:5,overflow:"hidden",border:`1px solid ${T.border}`,width:"fit-content",margin:"0 auto"}}>
                                          {["Yes","No"].map(opt=>{
                                            const sel=(active?"Yes":"No")===opt;
                                            return(
                                              <button key={opt} onClick={()=>updateProd(i,{...p,specialtyQtys:{...(p.specialtyQtys||{}),[key+"_on"]:opt==="Yes"?1:0}})}
                                                style={{padding:"3px 10px",fontSize:11,fontFamily:font,fontWeight:600,border:"none",cursor:"pointer",background:sel?(opt==="Yes"?T.accent:T.surface):T.card,color:sel?(opt==="Yes"?"#fff":T.text):T.faint,transition:"all 0.12s"}}>
                                                {opt}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </td>
                                      <td style={{padding:"7px 14px",textAlign:"center",borderRight:`1px solid ${T.border}`,width:"25%"}}>
                                        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                                          <span style={{fontSize:12,fontWeight:active?700:400,color:active?T.text:T.faint,fontFamily:mono}}>{active?activePrintCount:null}</span>
                                          {active&&<span style={{fontSize:9,color:T.faint,fontFamily:font}}>prints</span>}
                                        </div>
                                      </td>
                                      <td style={{padding:"7px 14px",textAlign:"right",fontFamily:mono,fontSize:12,fontWeight:total>0?700:400,color:total>0?T.green:T.faint,width:"25%"}}>
                                        {active&&unitCost>0?fmtD(total):(unitCost>0&&!active?<span style={{fontSize:10,color:T.faint}}>{fmtD(unitCost)} ea</span>:null)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>}
                      </div>
                      {/* Custom Costs */}
                      <div>
                        <div onClick={()=>updateProd(i,{...p,_customOpen:!p._customOpen})}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",padding:"6px 8px",borderRadius:6,background:p._customOpen?T.accentDim:T.surface,border:`1px solid ${p._customOpen?T.accent+"44":T.border}`,marginBottom:p._customOpen?8:0,transition:"all 0.15s"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:p._customOpen?T.accent:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom Costs</div>
                            {!p._customOpen&&(p.customCosts||[]).some(c=>c.amount>0||c.desc)&&<span style={{fontSize:11,color:T.green}}>✓</span>}
                          </div>
                          <span style={{fontSize:11,color:p._customOpen?T.accent:T.faint,display:"inline-block",transform:p._customOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.15s"}}>v</span>
                        </div>
                        {p._customOpen&&<div>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom Costs</div>
                            <button onClick={()=>updateProd(i,{...p,customCosts:[...(p.customCosts||[]),{desc:"",amount:0}]})}
                              style={{fontSize:11,color:T.accent,fontFamily:font,background:"none",border:`1px solid ${T.accent}44`,borderRadius:5,cursor:"pointer",padding:"2px 10px"}}>+ Add</button>
                          </div>
                          {(p.customCosts||[]).length>0&&(
                            <div style={{borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
                              <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
                                <tbody>
                                  {(p.customCosts||[]).map((cc,ci)=>(
                                    <tr key={ci} style={{borderBottom:ci<p.customCosts.length-1?`1px solid ${T.border}22`:"none",background:ci%2===0?T.card:T.surface}}>
                                      <td style={{padding:"5px 8px",borderRight:`1px solid ${T.border}`,width:"60%"}}>
                                        <input value={cc.desc||""} placeholder="Description…"
                                          onChange={e=>{const c=[...p.customCosts];c[ci]={...c[ci],desc:e.target.value};updateProd(i,{...p,customCosts:c});}}
                                          style={{width:"100%",background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:font}}/>
                                      </td>
                                      <td style={{padding:"5px 8px",borderRight:`1px solid ${T.border}`,width:"25%",textAlign:"center"}}>
                                        <div style={{display:"flex",alignItems:"center",gap:2,justifyContent:"center"}}>
                                          <span style={{fontSize:11,color:T.faint,fontFamily:mono}}>$</span>
                                          <input type="number" step="0.01" value={cc.amount||""} placeholder="0.00"
                                            onChange={e=>{const c=[...p.customCosts];c[ci]={...c[ci],amount:parseFloat(e.target.value)||0};updateProd(i,{...p,customCosts:c});}}
                                            style={{width:70,background:"transparent",border:"none",outline:"none",color:T.text,fontSize:12,fontFamily:mono,textAlign:"center"}}/>
                                        </div>
                                      </td>
                                      <td style={{padding:"5px 8px",textAlign:"center",width:"15%"}}>
                                        <button onClick={()=>{const c=p.customCosts.filter((_,j)=>j!==ci);updateProd(i,{...p,customCosts:c});}}
                                          style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:12}}
                                          onMouseEnter={e=>e.currentTarget.style.color=T.red}
                                          onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>}
                      </div>
                    </div>{/* end decoration panel */}
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
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Quote details</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
                <CInput label="Quote #" value={orderInfo.invoiceNum} onChange={v=>setOrderInfo(o=>({...o,invoiceNum:v}))}/>
                <CInput label="Valid until" value={orderInfo.validUntil} onChange={v=>setOrderInfo(o=>({...o,validUntil:v}))} placeholder="Apr 15, 2026"/>
                <CInput label="Ship date" value={orderInfo.shipDate} onChange={v=>setOrderInfo(o=>({...o,shipDate:v}))} placeholder="Apr 30, 2026"/>
                <CInput label="Ship method" value={orderInfo.shipMethod} onChange={v=>setOrderInfo(o=>({...o,shipMethod:v}))} placeholder="UPS Ground"/>
                <CInput label="Notes" value={orderInfo.notes} onChange={v=>setOrderInfo(o=>({...o,notes:v}))} placeholder="Quote notes..."/>
              </div>
            </div>
            <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{fontSize:12,color:T.muted,fontFamily:font,flex:1}}>Preview — this is what your client sees</div>
              <button onClick={()=>window.print()} style={{background:T.accent,color:"#fff",border:"none",borderRadius:7,padding:"6px 16px",fontSize:12,fontFamily:font,fontWeight:600,cursor:"pointer"}}>⬇ Download PDF</button>
            </div>
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #e5e7eb",overflow:"hidden",fontFamily:"Georgia, serif",color:"#111"}}>
              <div style={{padding:"32px 36px 24px",borderBottom:"3px solid #111"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontSize:22,fontWeight:900,letterSpacing:"-0.03em",marginBottom:3,fontFamily:"system-ui, sans-serif"}}>HOUSE PARTY DISTRO</div>
                    <div style={{fontSize:11,color:"#666",lineHeight:1.7,fontFamily:"system-ui, sans-serif"}}>
                      3945 W Reno Ave, Suite A<br/>Las Vegas, NV 89118<br/>jon@housepartydistro.com
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#999",letterSpacing:"0.15em",textTransform:"uppercase",fontFamily:"system-ui, sans-serif",marginBottom:6}}>Quote</div>
                    <div style={{fontSize:28,fontWeight:900,letterSpacing:"-0.03em",fontFamily:"system-ui, sans-serif",marginBottom:8}}>
                      {orderInfo.invoiceNum?"#"+orderInfo.invoiceNum:"#—"}
                    </div>
                    <div style={{fontSize:11,color:"#666",lineHeight:1.8,fontFamily:"system-ui, sans-serif"}}>
                      <div><span style={{fontWeight:600}}>Date:</span> {today}</div>
                      {orderInfo.validUntil&&<div><span style={{fontWeight:600}}>Valid until:</span> {orderInfo.validUntil}</div>}
                    </div>
                  </div>
                </div>
              </div>
              {orderInfo.clientName&&(
                <div style={{padding:"18px 36px",background:"#f9fafb",borderBottom:"1px solid #e5e7eb"}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#999",letterSpacing:"0.12em",textTransform:"uppercase",fontFamily:"system-ui, sans-serif",marginBottom:5}}>Prepared for</div>
                  <div style={{fontSize:16,fontWeight:700,fontFamily:"system-ui, sans-serif"}}>{orderInfo.clientName}</div>
                </div>
              )}
              <div style={{padding:"24px 36px"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui, sans-serif"}}>
                  <thead>
                    <tr style={{borderBottom:"2px solid #111"}}>
                      <th style={{padding:"6px 0",fontSize:10,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"left",paddingBottom:10}}>Item</th>
                      <th style={{padding:"6px 0",fontSize:10,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"left",paddingBottom:10}}>Sizes</th>
                      <th style={{padding:"6px 0",fontSize:10,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"center",paddingBottom:10}}>Qty</th>
                      <th style={{padding:"6px 0",fontSize:10,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"right",paddingBottom:10}}>Price/Unit</th>
                      <th style={{padding:"6px 0",fontSize:10,fontWeight:700,color:"#999",textTransform:"uppercase",letterSpacing:"0.1em",textAlign:"right",paddingBottom:10}}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quoteProds.map((p,pi)=>{
                      const r2=calcCostProduct(p,costMargin,inclShip,inclCC,costProds);
                      const lineTotal=r2?.grossRev||0;
                      const unitPrice=r2?.sellPerUnit||0;
                      return(
                        <tr key={pi} style={{borderBottom:"1px solid #f0f0f0"}}>
                          <td style={{padding:"14px 12px 14px 0",verticalAlign:"top"}}>
                            <div style={{fontSize:14,fontWeight:700}}>{p.name||("Item "+(pi+1))}</div>
                            {p.color&&<div style={{fontSize:11,color:"#666",marginTop:2}}>{p.color}</div>}
                          </td>
                          <td style={{padding:"14px 12px",verticalAlign:"top"}}>
                            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                              {(p.sizes||[]).filter(sz=>(p.qtys?.[sz]||0)>0).map(sz=>(
                                <span key={sz} style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 7px",fontFamily:"monospace"}}>
                                  {sz}: {p.qtys[sz]}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{padding:"14px 12px",textAlign:"center",fontFamily:"monospace",fontSize:13,verticalAlign:"top",fontWeight:600}}>{(p.totalQty||0).toLocaleString()}</td>
                          <td style={{padding:"14px 12px",textAlign:"right",fontFamily:"monospace",fontSize:13,verticalAlign:"top"}}>{unitPrice>0?fmtD(unitPrice):"—"}</td>
                          <td style={{padding:"14px 0 14px 12px",textAlign:"right",fontFamily:"monospace",fontSize:13,verticalAlign:"top",fontWeight:700}}>{lineTotal>0?fmtD(lineTotal):"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
                  <div style={{width:240}}>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"12px 0",borderTop:"3px solid #111"}}>
                      <span style={{fontSize:15,fontWeight:700,fontFamily:"system-ui, sans-serif"}}>Order Total</span>
                      <span style={{fontSize:16,fontWeight:900,fontFamily:"monospace"}}>{fmtD(quoteTotal)}</span>
                    </div>
                  </div>
                </div>
                {orderInfo.notes&&(
                  <div style={{marginTop:20,padding:"14px 16px",background:"#fffbf0",borderRadius:8,border:"1px solid #fde68a",fontSize:12,color:"#555",lineHeight:1.7,fontFamily:"system-ui, sans-serif",whiteSpace:"pre-line"}}>
                    {orderInfo.notes}
                  </div>
                )}
              </div>
              <div style={{padding:"24px 36px",background:"#f9fafb",borderTop:"1px solid #e5e7eb"}}>
                {approved?(
                  <div style={{textAlign:"center",padding:"16px",background:"#f0fdf4",borderRadius:8,border:"1px solid #bbf7d0"}}>
                    <div style={{fontSize:16,fontWeight:700,color:"#16a34a",fontFamily:"system-ui, sans-serif",marginBottom:4}}>✓ Quote Approved</div>
                    <div style={{fontSize:12,color:"#555",fontFamily:"system-ui, sans-serif"}}>Status: {project.prodStatus}</div>
                  </div>
                ):(
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:13,color:"#555",fontFamily:"system-ui, sans-serif",marginBottom:16,lineHeight:1.6}}>
                      By approving this quote, you authorize House Party Distro to proceed with production upon receipt of deposit.<br/>
                      <span style={{fontWeight:600}}>Estimated turnaround: 10 business days from deposit.</span>
                    </div>
                    <button
                      onClick={()=>{if(window.confirm("Ready to approve this quote and proceed to deposit? This will move your project to Awaiting Deposit status.")){onSave&&onSave({...project,prodStatus:"Awaiting Deposit"});}}}
                      style={{background:"#111",color:"#fff",border:"none",borderRadius:8,padding:"14px 40px",fontSize:15,fontFamily:"system-ui, sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:"0.02em"}}>
                      Approve and Pay Deposit
                    </button>
                    <div style={{fontSize:10,color:"#aaa",marginTop:10,fontFamily:"system-ui, sans-serif"}}>
                      Quote #{orderInfo.invoiceNum||"—"} · Valid until {orderInfo.validUntil||"30 days from issue"}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* PO */}
      {costTab==="po"&&(
        <div style={{background:"white",color:"#1a1a2e",fontFamily:font,padding:36,borderRadius:10,maxWidth:740}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
            <div><div style={{fontSize:11,color:"#888",marginBottom:3}}>BILL TO</div><div style={{fontSize:13,fontWeight:600}}>HOUSE PARTY DISTRO</div><div style={{fontSize:11,color:"#666",lineHeight:1.6}}>JON@HOUSEPARTYDISTRO.COM<br/>3945 W RENO AVE, STE A · LAS VEGAS, NV 89118</div></div>
            <div>
              <div style={{fontSize:17,fontWeight:800,color:"#5b7cf6",marginBottom:10}}>PURCHASE ORDER</div>
              <table style={{fontSize:11,borderCollapse:"collapse"}}><tbody>
                {[["DATE",today],["PO #",(orderInfo.invoiceNum||"—")+" - A"],["SHIP DATE",orderInfo.shipDate||"—"],["SHIP METHOD",orderInfo.shipMethod||"—"]].map(([k,v])=>(
                  <tr key={k}><td style={{padding:"2px 14px 2px 0",fontWeight:700,color:"#555"}}>{k}</td><td style={{padding:"2px 0"}}>{v}</td></tr>
                ))}
              </tbody></table>
            </div>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",marginBottom:16,fontSize:11}}>
            <thead><tr style={{background:"#f0f2fb"}}>{["CLIENT","DESIGN","MODEL","COLOR","QTY","TOTAL"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",fontWeight:700,color:"#555",borderBottom:"2px solid #d0d4f0"}}>{h}</th>)}</tr></thead>
            <tbody>
              {costProds.filter(p=>(p.totalQty||0)>0).map((p,pi)=>(
                <tr key={pi} style={{borderBottom:"1px solid #f0f2fb"}}>
                  <td style={{padding:"8px 10px"}}>{orderInfo.clientName||"—"}</td>
                  <td style={{padding:"8px 10px"}}>{p.name||"—"}</td>
                  <td style={{padding:"8px 10px"}}>{p.style||"—"}</td>
                  <td style={{padding:"8px 10px"}}>{p.color||"—"}</td>
                  <td style={{padding:"8px 10px",fontFamily:mono}}>{p.totalQty||0}</td>
                  <td style={{padding:"8px 10px",fontFamily:mono,fontWeight:600}}>{fmtD((p.blankCostPerUnit||0)*1.035*(p.totalQty||0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:20,paddingTop:12,borderTop:"1px solid #e0e4f8",fontSize:9,color:"#aaa",lineHeight:1.6}}>HOUSE PARTY DISTRO MUST BE NOTIFIED OF ANY BLANK SHORTAGES WITHIN 24 HOURS OF RECEIPT. PACKING LISTS AND TRACKING NUMBERS MUST BE SUPPLIED IMMEDIATELY AFTER SHIPMENT. INVOICES DUE WITHIN 30 DAYS OF PO DATE.</div>
        </div>
      )}
    </div>
  );
};


export { CostingTab };

export function CostingTabWrapper({ project, buyItems = [], onUpdateBuyItems, onRegisterSave }) {
  // Load saved costing state from project.costing_data if available
  const savedData = project?.costing_data || null;
  const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
  const sortSizesW = (sizes) => [...(sizes||[])].sort((a,b) => {
    const ai=SIZE_ORDER.indexOf(a), bi=SIZE_ORDER.indexOf(b);
    if(ai===-1&&bi===-1) return a.localeCompare(b);
    if(ai===-1) return 1; if(bi===-1) return -1;
    return ai-bi;
  });
  // If we have saved costing data, merge it with current buy items
  const initItems = (buyItems || []).map(it => {
    const saved = savedData?.costProds?.find((p) => p.id === it.id);
    if (saved) return { ...saved, sizes: sortSizesW(it.sizes), qtys: it.qtys || saved.qtys || {} };
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
    return {
      ...EMPTY_COST_PRODUCT(),
      id: it.id,
      name: it.name || "",
      style: it.blank_vendor || "",
      color: it.blank_sku || "",
      sizes: sortSizesW(it.sizes),
      qtys: it.qtys || {},
      blankCosts,
      blankCostPerUnit,
      totalQty: Object.values(it.qtys || {}).reduce((a, v) => a + v, 0),
    };
  });
  const [costProds, setCostProds] = useState(initItems.length > 0 ? initItems : [EMPTY_COST_PRODUCT()]);
  const [savedCostProds, setSavedCostProds] = useState(initItems.length > 0 ? initItems : [EMPTY_COST_PRODUCT()]);
  const [costMargin, setCostMargin] = useState(savedData?.costMargin || "30%");
  const [inclShip, setInclShip] = useState(savedData?.inclShip !== undefined ? savedData.inclShip : true);
  const [inclCC, setInclCC] = useState(savedData?.inclCC !== undefined ? savedData.inclCC : true);
  const [orderInfo, setOrderInfo] = useState(savedData?.orderInfo || {
    clientName: project?.clients?.name || "",
    clientEmail: "",
    invoiceNum: project?.job_number || "",
    validUntil: "",
    shipDate: project?.target_ship_date || "",
    vendorId: "", shipMethod: "",
    notes: project?.notes || "",
    productionNotes: "", finishingNotes: "",
  });
  const [savedOrderInfo, setSavedOrderInfo] = useState({ ...orderInfo });
  const costingDirty = JSON.stringify(costProds) !== JSON.stringify(savedCostProds) || JSON.stringify(orderInfo) !== JSON.stringify(savedOrderInfo);

  // Warn on page close/refresh if unsaved
  useEffect(() => {
    const handler = (e) => {
      if (costingDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [costingDirty]);

  // When buyItems change (e.g. name edit), sync savedCostProds so dirty flag stays clean
  useEffect(() => {
    setSavedCostProds(prev => {
      // Only sync if the change came from buyItems (not user edits)
      // We detect this by checking if names differ but nothing else meaningful changed
      const synced = prev.map(sp => {
        const bi = (buyItems||[]).find(b => b.id === sp.id);
        if (bi && bi.name && bi.name !== sp.name) return {...sp, name: bi.name};
        return sp;
      });
      return synced;
    });
  }, [buyItems]);

  // Register save function with parent so tab switching can auto-save
  useEffect(() => {
    if (typeof onRegisterSave === 'function') {
      onRegisterSave(async () => { await onSave(); });
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
        for (const r of results) {
          if (r.qty > 0 && r.sellPerUnit > 0) {
            await supabase.from("items").update({ sell_per_unit: r.sellPerUnit })
              .eq("id", costProds.find(p => calcCostProduct(p, costMargin, inclShip, inclCC, costProds)?.sellPerUnit === r.sellPerUnit)?.id || "");
          }
        }
      } catch(e) { console.error("Failed to save costing data", e); }
    }
  };
  return (
    <CostingTab
      project={project} buyItems={buyItems} onUpdateBuyItems={onUpdateBuyItems}
      costProds={costProds} setCostProds={setCostProds}
      costMargin={costMargin} setCostMargin={setCostMargin}
      inclShip={inclShip} setInclShip={setInclShip}
      inclCC={inclCC} setInclCC={setInclCC}
      orderInfo={orderInfo} setOrderInfo={setOrderInfo}
      costingDirty={costingDirty} onSave={onSave}
    />
  );
}
