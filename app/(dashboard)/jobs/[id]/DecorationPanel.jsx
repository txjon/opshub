"use client";
import { useState } from "react";
import { T, font, mono } from "@/lib/theme";

const LOCATION_PRESETS = ["Front","Back","Left Sleeve","Right Sleeve","Left Chest","Right Chest","Neck","Hood","Pocket"];
const SHARE_GROUPS = ["A","B","C","D","E","F","G","H","I","J"];
const TAG_SHARE_GROUPS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10"];

export function DecorationPanel({ p, i, costProds, PRINTERS, updateProd, setCostProds, lookupPrintPrice, lookupTagPrice }) {
  const pr = PRINTERS[p.printVendor] || {};
  const activeLocsRaw = Object.values(p.printLocations||{}).filter(l=>l?.location&&l?.screens>0).length;
  // Deduplicated: shared locations in same group count as one
  const activeLocsDeduped = (()=>{
    const seen = {};
    let count = 0;
    for (const l of Object.values(p.printLocations||{})) {
      if (!l?.location || !l?.screens) continue;
      if (l.shared && l.shareGroup) {
        const gk = l.shareGroup.trim().toLowerCase();
        if (seen[gk]) continue;
        seen[gk] = true;
      }
      count++;
    }
    return count;
  })();
  const activeLocs = activeLocsDeduped;
  const allPrintCount = activeLocs + (p.tagPrint?1:0);

  // Shared qty calculation for a location (counts multiple shared locs on same item)
  const getSharedQty = (shareGroup) => {
    if (!shareGroup) return 0;
    const groupKey = shareGroup.trim().toLowerCase();
    return costProds.reduce((sum, cp) => {
      const matchingLocs = Object.values(cp.printLocations||{}).filter(l => l.shared && l.shareGroup && l.shareGroup.trim().toLowerCase() === groupKey && l.screens > 0);
      return sum + (matchingLocs.length > 0 ? (cp.totalQty||0) * matchingLocs.length : 0);
    }, 0);
  };

  const getTagSharedQty = () => {
    if (!p.tagShareGroup) return p.totalQty;
    return costProds.reduce((sum, cp) => {
      if (cp.tagPrint && cp.tagShareGroup?.trim().toLowerCase() === p.tagShareGroup.trim().toLowerCase()) return sum + (cp.totalQty||0);
      return sum;
    }, 0);
  };

  const updateLoc = (loc, updates) => {
    const newLocs = {...(p.printLocations||{})};
    newLocs[loc] = {...(newLocs[loc]||{}), ...updates};
    updateProd(i, {...p, printLocations: newLocs});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10,paddingLeft:20}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingBottom:8,borderBottom:"2px solid "+T.text}}>
        <div style={{fontSize:11,fontWeight:800,color:T.text,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Decoration</div>
        {i>0&&costProds[i-1]&&<button onClick={()=>{const prev=costProds[i-1];updateProd(i,{...p,
          printVendor:prev.printVendor,
          decorationType:prev.decorationType||"",
          printLocations:JSON.parse(JSON.stringify(prev.printLocations||{})),
          printCount:prev.printCount||4,
          tagPrint:prev.tagPrint, tagRepeat:prev.tagRepeat, tagShared:prev.tagShared, tagShareGroup:prev.tagShareGroup,
          finishingQtys:prev.finishingQtys?{...prev.finishingQtys}:{},
          setupFees:{...(prev.setupFees||{})},
          specialtyQtys:prev.specialtyQtys?{...prev.specialtyQtys}:{},
          isFleece:!!prev.isFleece,
          customCosts:prev.customCosts?JSON.parse(JSON.stringify(prev.customCosts)):[]
        });}}
          style={{fontSize:10,color:T.accent,fontFamily:font,background:T.accentDim,border:"1px solid "+T.accent+"44",borderRadius:5,cursor:"pointer",padding:"2px 10px",fontWeight:600}}>⎘ Copy from previous</button>}
      </div>

      {/* Vendor + Decoration Type — single row */}
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <select value={p.printVendor||""} onChange={e=>{
          const v=e.target.value;
          const updated={};
          [1,2,3,4,5,6].forEach(loc=>{
            const ld=p.printLocations?.[loc]||{};
            if(ld.location||ld.screens) updated[loc]={...ld,printer:v};
            else updated[loc]={...ld};
          });
          const vendorPr = PRINTERS[v] || {};
          const hasNoPricing = !vendorPr.qtys || vendorPr.qtys.length === 0;
          const needsDefaultRows = hasNoPricing && (!p.customCosts || p.customCosts.length === 0);
          const customCosts = needsDefaultRows ? [{desc:"",perUnit:0,flat:false},{desc:"",perUnit:0,flat:false},{desc:"",perUnit:0,flat:false}] : (p.customCosts||[]);
          updateProd(i,{...p,printVendor:v,printLocations:updated,customCosts});
        }}
          style={{background:T.surface,border:"1px solid "+(p.printVendor?T.accent+"66":T.border),borderRadius:6,color:p.printVendor?T.text:T.muted,fontFamily:font,fontSize:12,padding:"6px 10px",outline:"none",cursor:"pointer",minWidth:140}}>
          <option value="">Vendor</option>
          {Object.keys(PRINTERS).map(pr=><option key={pr} value={pr}>{pr}</option>)}
        </select>
        <button onClick={()=>setCostProds(prev=>prev.map((cp,ci)=>ci>i?{...cp,printVendor:p.printVendor,printLocations:Object.fromEntries(Object.entries(cp.printLocations||{}).map(([k,v])=>([k,{...v,printer:p.printVendor}])))}:cp))}
          title="Set this vendor on every item below"
          style={{fontSize:11,fontFamily:font,fontWeight:600,color:T.muted,background:"none",border:`1px solid ${T.border}`,borderRadius:6,cursor:"pointer",padding:"6px 14px",flexShrink:0,whiteSpace:"nowrap"}}
          onMouseEnter={e=>{e.currentTarget.style.color=T.text;e.currentTarget.style.borderColor=T.accent;}}
          onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border;}}>↓ Apply to all</button>
        {p.printVendor&&pr.capabilities?.length>0&&(
          <div style={{display:"flex",gap:4,marginLeft:4}}>
            {pr.capabilities.map(cap=>{
              const sel=(p.decorationType||"")===cap;
              return <button key={cap} onClick={()=>updateProd(i,{...p,decorationType:cap})}
                style={{padding:"4px 10px",borderRadius:6,fontSize:10,fontWeight:600,cursor:"pointer",border:`1px solid ${sel?T.accent:T.border}`,background:sel?T.accent:"transparent",color:sel?"#fff":T.faint}}>
                {cap}
              </button>;
            })}
          </div>
        )}
      </div>

      {/* No vendor selected */}
      {!p.printVendor && (
        <div style={{padding:"16px 0",textAlign:"center",fontSize:11,color:T.faint}}>Select a vendor to set up decoration</div>
      )}

      {/* Vendor without pricing — simple custom cost rows */}
      {p.printVendor && (!pr.qtys || pr.qtys.length === 0) && (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <div style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Decoration Costs</div>
          {(p.customCosts||[]).map((cc,ci)=>(
            <div key={ci} style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
              <input value={cc.desc||""} onChange={e=>{const c=[...(p.customCosts||[])];c[ci]={...c[ci],desc:e.target.value};updateProd(i,{...p,customCosts:c});}}
                style={{flex:1,background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,padding:"3px 6px",outline:"none",fontFamily:font}}/>
              <div style={{display:"flex",gap:2}}>
                {[{label:"/ unit",flat:false},{label:"flat",flat:true}].map(opt=>{
                  const sel=cc.flat===opt.flat;
                  return <button key={opt.label} onClick={()=>{const c=[...(p.customCosts||[])];c[ci]={...c[ci],flat:opt.flat};updateProd(i,{...p,customCosts:c});}}
                    style={{padding:"2px 6px",fontSize:8,fontWeight:600,border:`1px solid ${sel?T.accent:T.border}`,borderRadius:4,cursor:"pointer",background:sel?T.accent:"transparent",color:sel?"#fff":T.faint}}>{opt.label}</button>;
                })}
              </div>
              <div style={{display:"flex",alignItems:"center"}}>
                <span style={{fontSize:9,color:T.faint,marginRight:1}}>$</span>
                <input type="text" inputMode="decimal" value={cc.perUnit||cc.amount||""} onChange={e=>{const c=[...(p.customCosts||[])];c[ci]={...c[ci],perUnit:e.target.value,amount:e.target.value};updateProd(i,{...p,customCosts:c});}}
                  onBlur={e=>{const v=parseFloat(e.target.value)||0;const c=[...(p.customCosts||[])];c[ci]={...c[ci],perUnit:v,amount:v};updateProd(i,{...p,customCosts:c});}}
                  style={{width:50,textAlign:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,fontFamily:mono,outline:"none",padding:"2px"}}/>
              </div>
              <button onClick={()=>{const c=(p.customCosts||[]).filter((_,j)=>j!==ci);updateProd(i,{...p,customCosts:c});}}
                style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:10}}
                onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
            </div>
          ))}
          {(p.customCosts||[]).length < 6 && (
            <button onClick={()=>updateProd(i,{...p,customCosts:[...(p.customCosts||[]),{desc:"",perUnit:0,flat:false}]})}
              style={{fontSize:10,color:T.faint,background:"none",border:`1px dashed ${T.border}`,borderRadius:4,padding:"6px",cursor:"pointer",fontFamily:font,textAlign:"center"}}
              onMouseEnter={e=>e.currentTarget.style.color=T.accent} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>
              + Add cost
            </button>
          )}
        </div>
      )}

      {/* Full pricing panel — only when vendor has pricing data */}
      {p.printVendor && pr.qtys?.length > 0 && <>

      {/* Print Location Cards */}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {(()=>{
          // Show filled slots + one empty slot for next entry, min 2
          const allSlots = [1,2,3,4,5,6];
          const highestFilled = allSlots.reduce((max,loc)=>{const ld=p.printLocations?.[loc]||{};return (ld.location||ld.screens)?loc:max;},0);
          const showUpTo = Math.max(Math.min((highestFilled||0)+1, 6), 2);
          return allSlots.filter(loc=>loc<=showUpTo).map(loc=>{
          const ld = p.printLocations?.[loc]||{};
          const isShared = !!ld.shared;
          const shareGroup = ld.shareGroup||"";
          const effectiveQty = isShared && shareGroup ? getSharedQty(shareGroup) : (p.totalQty||0);
          const unitCost = ld.screens>0 && p.printVendor ? lookupPrintPrice(p.printVendor, effectiveQty, ld.screens) : 0;
          const isActive = ld.location && ld.screens > 0;

          return (
            <div key={loc} style={{background:isActive?T.surface:"transparent",border:`1px solid ${isActive?T.border:T.border+"66"}`,borderRadius:8,padding:"8px 10px",display:"flex",flexDirection:"column",gap:6}}>
              {/* Row 1: Location name (left) + Share controls (right) */}
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{flex:1,position:"relative"}}>
                  <input value={ld.location||""} onChange={e=>updateLoc(loc,{location:e.target.value,printer:p.printVendor})}
                    list={`loc-presets-${i}-${loc}`}
                    style={{background:"transparent",border:"none",outline:"none",color:T.text,fontSize:13,fontWeight:700,fontFamily:font,width:"100%",padding:0}}
                    placeholder="Location..." />
                  <datalist id={`loc-presets-${i}-${loc}`}>{LOCATION_PRESETS.map(l=><option key={l} value={l}/>)}</datalist>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
                  {!isShared ? (
                    <button onClick={()=>updateLoc(loc,{shared:true,shareGroup:""})}
                      style={{fontSize:9,color:T.faint,background:"none",border:`1px solid ${T.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontFamily:font}}
                      onMouseEnter={e=>e.currentTarget.style.color=T.accent} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>Share</button>
                  ) : shareGroup ? (
                    <>
                      <select value={SHARE_GROUPS.includes(shareGroup) ? shareGroup : ""} onChange={e=>updateLoc(loc,{shareGroup:e.target.value})}
                        style={{padding:"2px 4px",fontSize:10,fontFamily:mono,fontWeight:700,border:`1px solid ${SHARE_GROUPS.includes(shareGroup)?T.accent:T.red}`,borderRadius:4,cursor:"pointer",background:SHARE_GROUPS.includes(shareGroup)?T.accent:T.red,color:"#fff",outline:"none",appearance:"none",WebkitAppearance:"none",textAlign:"center",width:28}}>
                        {!SHARE_GROUPS.includes(shareGroup) && <option value="" disabled>?</option>}
                        {SHARE_GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                      </select>
                      <button onClick={()=>updateLoc(loc,{shared:false,shareGroup:""})}
                        style={{fontSize:10,color:T.faint,background:"none",border:"none",cursor:"pointer",padding:"0 2px"}}
                        onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                    </>
                  ) : (
                    <>
                      <select value="" onChange={e=>updateLoc(loc,{shareGroup:e.target.value})}
                        style={{padding:"2px 4px",fontSize:10,fontFamily:font,border:`1px solid ${T.border}`,borderRadius:4,cursor:"pointer",background:"transparent",color:T.muted,outline:"none"}}>
                        <option value="" disabled>Group</option>
                        {SHARE_GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                      </select>
                      <button onClick={()=>updateLoc(loc,{shared:false,shareGroup:""})}
                        style={{fontSize:10,color:T.faint,background:"none",border:"none",cursor:"pointer",padding:"0 2px"}}
                        onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                    </>
                  )}
                </div>
              </div>

              {/* Row 2: colors + puff + cost */}
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {/* Color/screen count */}
                <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                  <input type="text" inputMode="numeric" value={ld.screens||""} onChange={e=>updateLoc(loc,{screens:parseInt(e.target.value)||0,printer:p.printVendor})}
                    style={{width:38,textAlign:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontSize:14,fontWeight:700,fontFamily:mono,outline:"none",padding:"4px 6px"}}/>
                  <span style={{fontSize:10,color:T.muted}}>colors</span>
                </div>

                {/* Puff colors — only shown when puff specialty is active and location has screens */}
                {isActive && p.specialtyQtys && Object.keys(p.specialtyQtys).some(k=>k.toLowerCase().includes("puff")&&k.endsWith("_on")&&p.specialtyQtys[k]) && (
                  <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                    <input type="text" inputMode="numeric" value={ld.puffColors||""} onChange={e=>updateLoc(loc,{puffColors:parseInt(e.target.value)||0})}
                      style={{width:38,textAlign:"center",background:T.card,border:`1px solid ${T.amber}44`,borderRadius:5,color:T.amber,fontSize:14,fontWeight:700,fontFamily:mono,outline:"none",padding:"4px 6px"}}/>
                    <span style={{fontSize:10,color:T.amber}}>puff</span>
                  </div>
                )}

                {/* Cost */}
                {isActive && (
                  <span style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:mono,flexShrink:0,marginLeft:"auto",textAlign:"right"}}>
                    {isShared&&shareGroup&&<span style={{fontSize:11,fontWeight:500,color:T.faint,marginRight:4}}>({effectiveQty})</span>}
                    ${unitCost>0?unitCost.toFixed(2):"—"}
                  </span>
                )}
              </div>
            </div>
          );
        })})()}

      </div>

      {/* Tag Print — inline row */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}>
        <span style={{fontSize:11,fontWeight:600,color:T.text,fontFamily:font,minWidth:30}}>Tag</span>
        <div style={{display:"flex",gap:2}}>
          {[{label:"No",val:()=>({tagPrint:false,tagRepeat:false})},{label:"Yes",val:()=>({tagPrint:true,tagRepeat:false})},{label:"Repeat",val:()=>({tagPrint:true,tagRepeat:true})}].map(opt=>{
            const sel = opt.label==="No"?!p.tagPrint : opt.label==="Yes"?(p.tagPrint&&!p.tagRepeat) : (p.tagPrint&&p.tagRepeat);
            return <button key={opt.label} onClick={()=>updateProd(i,{...p,...opt.val()})}
              style={{padding:"2px 8px",fontSize:10,fontWeight:600,borderRadius:4,cursor:"pointer",border:`1px solid ${sel?T.accent:T.border}`,background:sel?T.accent:"transparent",color:sel?"#fff":T.faint}}>{opt.label}</button>;
          })}
        </div>
        {p.tagPrint && (
          <>
            <div style={{display:"flex",alignItems:"center",gap:2,marginLeft:"auto"}}>
              {!p.tagShared ? (
                <button onClick={()=>updateProd(i,{...p,tagShared:true,tagShareGroup:""})}
                  style={{fontSize:9,color:T.faint,background:"none",border:`1px solid ${T.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontFamily:font}}>Share</button>
              ) : (
                <>
                  {p.tagShareGroup ? (
                    <select value={TAG_SHARE_GROUPS.includes(p.tagShareGroup) ? p.tagShareGroup : ""} onChange={e=>updateProd(i,{...p,tagShareGroup:e.target.value})}
                      style={{padding:"2px 4px",fontSize:10,fontFamily:mono,fontWeight:700,border:`1px solid ${TAG_SHARE_GROUPS.includes(p.tagShareGroup)?T.amber:T.red}`,borderRadius:4,cursor:"pointer",background:TAG_SHARE_GROUPS.includes(p.tagShareGroup)?T.amber:T.red,color:"#fff",outline:"none",appearance:"none",WebkitAppearance:"none",textAlign:"center",width:34}}>
                      {!TAG_SHARE_GROUPS.includes(p.tagShareGroup) && <option value="" disabled>?</option>}
                      {TAG_SHARE_GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                    </select>
                  ) : (
                    <select value="" onChange={e=>updateProd(i,{...p,tagShareGroup:e.target.value})}
                      style={{padding:"2px 4px",fontSize:10,fontFamily:font,border:`1px solid ${T.border}`,borderRadius:4,cursor:"pointer",background:"transparent",color:T.muted,outline:"none"}}>
                      <option value="" disabled>Group</option>
                      {TAG_SHARE_GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                    </select>
                  )}
                  <button onClick={()=>updateProd(i,{...p,tagShared:false,tagShareGroup:""})}
                    style={{fontSize:10,color:T.faint,background:"none",border:"none",cursor:"pointer"}}
                    onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                </>
              )}
            </div>
            <span style={{fontSize:10,color:T.muted,fontFamily:mono}}>
              ${p.printVendor ? (lookupTagPrice(p.printVendor, p.tagShareGroup ? getTagSharedQty() : (p.totalQty||0)) || 0).toFixed(2) : "—"}
            </span>
          </>
        )}
      </div>

      {/* Finishing & Packaging — compact inline */}
      {p.printVendor && (pr.finishing || pr.packaging) && (
        <div style={{padding:"8px 10px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}>
          <div style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Packaging & Finishing</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            {/* Packaging */}
            {pr.packaging && Object.keys(pr.packaging).map(k=>{
              const on = p.finishingQtys?.Packaging_on>0 && p.finishingQtys?.Packaging_variant===k;
              return (
                <button key={k} onClick={()=>{
                  if (on) updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),Packaging_on:0,Packaging_variant:""}});
                  else updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),Packaging_on:1,Packaging_variant:k}});
                }}
                  style={{padding:"2px 8px",fontSize:10,fontWeight:on?600:400,borderRadius:4,cursor:"pointer",border:`1px solid ${on?T.accent:T.border}`,background:on?T.accentDim:"transparent",color:on?T.accent:T.faint,fontFamily:font}}>
                  {k}
                </button>
              );
            })}
            {/* Finishing items */}
            {pr.finishing && Object.keys(pr.finishing).map(key=>{
              const on = p.finishingQtys?.[key+"_on"]>0;
              return (
                <button key={key} onClick={()=>updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),[key+"_on"]:on?0:1}})}
                  style={{padding:"2px 8px",fontSize:10,fontWeight:on?600:400,borderRadius:4,cursor:"pointer",border:`1px solid ${on?T.accent:T.border}`,background:on?T.accentDim:"transparent",color:on?T.accent:T.faint,fontFamily:font}}>
                  {key}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Setup Fees — collapsible */}
      {p.printVendor && pr.setup && (()=>{
        const activeSetup = Object.keys(pr.setup).filter(key => {
          const isScreens = key.toLowerCase().replace(/\s/g,"") === "screens";
          const isTagScreens = key.toLowerCase().replace(/\s/g,"") === "tagscreens";
          const specialtyMatch = Object.keys(pr.specialty||{}).find(sk=>key.toLowerCase().includes(sk.toLowerCase()));
          if (isScreens) return Object.values(p.printLocations||{}).reduce((sum,l)=>sum+(l?.screens||0),0) > 0;
          if (isTagScreens) return p.tagPrint && !p.tagRepeat;
          if (specialtyMatch) return p.specialtyQtys?.[specialtyMatch+"_on"] > 0;
          return (p.setupFees?.[key]||0) > 0;
        });
        if ((p.setupFees?.manualCost||0) > 0) activeSetup.push("Manual");
        const setupSummary = activeSetup.length > 0 ? activeSetup.join(", ") : "None";
        return (
        <div style={{borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden"}}>
          <button onClick={()=>updateProd(i,{...p,_setupOpen:!p._setupOpen})}
            style={{width:"100%",padding:"6px 10px",background:T.surface,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:font}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Setup Fees</span>
              {!p._setupOpen && <span style={{fontSize:9,color:activeSetup.length>0?T.accent:T.faint}}>{setupSummary}</span>}
            </div>
            <span style={{fontSize:10,color:T.faint}}>{p._setupOpen?"▲":"▼"}</span>
          </button>
          {p._setupOpen && (
            <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:4}}>
              {Object.keys(pr.setup).map(key=>{
                const isScreens = key.toLowerCase().replace(/\s/g,"") === "screens";
                const isTagScreens = key.toLowerCase().replace(/\s/g,"") === "tagscreens";
                const specialtyMatch = Object.keys(pr.specialty||{}).find(sk=>key.toLowerCase().includes(sk.toLowerCase()));
                const isAuto = isScreens || isTagScreens || !!specialtyMatch;

                let autoVal = 0;
                if (isScreens) {
                  // Sum screens minus shared duplicates (within item + across items)
                  const seenGroups = {};
                  const myIdx = costProds.findIndex(cp => cp.id === p.id);
                  autoVal = Object.values(p.printLocations||{}).reduce((sum,l)=>{
                    if (!l?.screens) return sum;
                    if (l.shared && l.shareGroup) {
                      const gk = l.shareGroup.trim().toLowerCase();
                      if (seenGroups[gk]) return sum; // skip within-item duplicate
                      seenGroups[gk] = true;
                      // Skip if another item earlier has this group (cross-item)
                      const firstIdx = costProds.findIndex(cp => Object.values(cp.printLocations||{}).some(cl => cl.shared && cl.shareGroup && cl.shareGroup.trim().toLowerCase() === gk && cl.screens > 0));
                      if (firstIdx >= 0 && myIdx > firstIdx) return sum;
                    }
                    return sum + (l.screens||0);
                  }, 0);
                } else if (isTagScreens) {
                  autoVal = (p.tagPrint && !p.tagRepeat) ? (p.sizes||[]).length : 0;
                } else if (specialtyMatch) {
                  const isPuffScreen = key.toLowerCase().includes("puff") && key.toLowerCase().includes("screen");
                  if (isPuffScreen && p.specialtyQtys?.[specialtyMatch+"_on"]) {
                    // Puff screen up charge = sum of puffColors per location (deduped for share groups)
                    const seenPG = {};
                    autoVal = Object.values(p.printLocations||{}).reduce((sum,l)=>{
                      if (!l?.location || !l?.screens || !l.puffColors) return sum;
                      if (l.shared && l.shareGroup) { const gk = l.shareGroup.trim().toLowerCase(); if (seenPG[gk]) return sum; seenPG[gk]=true; }
                      return sum + (l.puffColors||0);
                    }, 0);
                  } else {
                    const rawCount = p.specialtyQtys?.[specialtyMatch+"_count"]||0;
                    autoVal = p.specialtyQtys?.[specialtyMatch+"_on"] ? (rawCount>0&&rawCount<activeLocs?rawCount:activeLocs) : 0;
                  }
                }
                const val = isAuto ? autoVal : (p.setupFees?.[key]||0);
                const unitCost = pr.setup[key]||0;

                return (
                  <div key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
                    <span style={{flex:1,color:T.muted}}>{key}</span>
                    {isAuto ? (
                      <span style={{fontFamily:mono,color:T.text,fontSize:11}}>{val} <span style={{fontSize:8,color:T.faint}}>auto</span></span>
                    ) : (
                      <input type="text" inputMode="decimal" value={p.setupFees?.[key]||""} onChange={e=>updateProd(i,{...p,setupFees:{...(p.setupFees||{}),[key]:parseFloat(e.target.value)||0}})}
                        style={{width:40,textAlign:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,fontFamily:mono,outline:"none",padding:"2px"}}/>
                    )}
                    <span style={{fontFamily:mono,color:T.faint,fontSize:10,minWidth:50,textAlign:"right"}}>${(val*unitCost).toFixed(2)}</span>
                  </div>
                );
              })}
              {/* Manual cost */}
              <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,borderTop:`1px solid ${T.border}`,paddingTop:4}}>
                <span style={{flex:1,color:T.muted}}>Manual cost</span>
                <div style={{display:"flex",alignItems:"center"}}>
                  <span style={{fontSize:10,color:T.faint,marginRight:1}}>$</span>
                  <input type="text" inputMode="decimal" value={p.setupFees?.manualCost||""} onChange={e=>updateProd(i,{...p,setupFees:{...(p.setupFees||{}),manualCost:parseFloat(e.target.value)||0}})}
                    style={{width:50,textAlign:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,fontFamily:mono,outline:"none",padding:"2px"}}/>
                </div>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* Specialty + Custom Costs — stacked, full width */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {p.printVendor && pr.specialty && Object.keys(pr.specialty).length>0 ? (()=>{
        const activeSpecs = Object.entries(pr.specialty).filter(([key])=>{
          const isFleece = key.toLowerCase().includes("fleece");
          return isFleece ? p.isFleece : (p.specialtyQtys?.[key+"_on"]>0);
        }).map(([key])=>key);
        const specSummary = activeSpecs.length>0 ? activeSpecs.join(", ") : "None";
        return (
        <div style={{borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden"}}>
          <button onClick={()=>updateProd(i,{...p,_specOpen:!p._specOpen})}
            style={{width:"100%",padding:"6px 10px",background:T.surface,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:font}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Specialty</span>
              {!p._specOpen && <span style={{fontSize:9,color:activeSpecs.length>0?T.accent:T.faint}}>{specSummary}</span>}
            </div>
            <span style={{fontSize:10,color:T.faint}}>{p._specOpen?"▲":"▼"}</span>
          </button>
          {p._specOpen && (
            <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:4}}>
              {Object.entries(pr.specialty).map(([key,rate])=>{
                const isFleece = key.toLowerCase().includes("fleece");
                const on = isFleece ? p.isFleece : (p.specialtyQtys?.[key+"_on"]>0);
                const stored = p.specialtyQtys?.[key+"_count"]||0;
                const count = isFleece ? allPrintCount : (stored > 0 && stored < activeLocs ? stored : activeLocs);

                return (
                  <div key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
                    <button onClick={()=>{
                      if (isFleece) return;
                      const newOn = !on;
                      const newQtys = {...(p.specialtyQtys||{}), [key+"_on"]:newOn?1:0};
                      if (newOn && !newQtys[key+"_count"]) newQtys[key+"_count"] = activeLocs;
                      updateProd(i,{...p,specialtyQtys:newQtys});
                    }}
                      style={{padding:"2px 8px",fontSize:10,fontWeight:on?600:400,borderRadius:4,cursor:isFleece?"default":"pointer",border:`1px solid ${on?T.accent:T.border}`,background:on?T.accentDim:"transparent",color:on?T.accent:T.faint,fontFamily:font}}>
                      {key}
                    </button>
                    {on && !isFleece && (
                      <input type="text" inputMode="numeric" value={count||""} onChange={e=>updateProd(i,{...p,specialtyQtys:{...(p.specialtyQtys||{}),[key+"_count"]:parseInt(e.target.value)||0}})}
                        style={{width:30,textAlign:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,fontFamily:mono,outline:"none",padding:"2px"}}/>
                    )}
                    {isFleece && on && <span style={{fontSize:9,color:T.faint,fontFamily:mono}}>{count}</span>}
                    <span style={{fontFamily:mono,color:on?T.text:T.faint,fontSize:10}}>${on?(rate*count).toFixed(2):"—"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        );
      })() : null}

      {/* Custom Costs */}
      {(()=>{
        const activeCosts = (p.customCosts||[]).filter(c=>c.desc);
        const customSummary = activeCosts.length>0 ? activeCosts.map(c=>c.desc).join(", ") : "None";
        return (
        <div style={{borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden",minWidth:0}}>
          <button onClick={()=>updateProd(i,{...p,_customOpen:!p._customOpen})}
            style={{width:"100%",padding:"6px 10px",background:T.surface,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:font}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom Costs</span>
              {!p._customOpen && <span style={{fontSize:9,color:activeCosts.length>0?T.accent:T.faint}}>{customSummary}</span>}
            </div>
            <span style={{fontSize:10,color:T.faint}}>{p._customOpen?"▲":"▼"}</span>
          </button>
          {p._customOpen && (
            <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:4}}>
              {(p.customCosts||[]).map((cc,ci)=>(
                <div key={ci} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,minWidth:0,flexWrap:"wrap"}}>
                  <input value={cc.desc||""} onChange={e=>{const c=[...p.customCosts];c[ci]={...c[ci],desc:e.target.value};updateProd(i,{...p,customCosts:c});}}
                    style={{flex:"1 1 140px",minWidth:80,background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,padding:"3px 6px",outline:"none",fontFamily:font}}/>
                  <div style={{display:"flex",gap:2,flexShrink:0}}>
                    {[{label:"/ unit",flat:false},{label:"flat",flat:true}].map(opt=>{
                      const sel=cc.flat===opt.flat;
                      return <button key={opt.label} onClick={()=>{const c=[...p.customCosts];c[ci]={...c[ci],flat:opt.flat};updateProd(i,{...p,customCosts:c});}}
                        style={{padding:"2px 6px",fontSize:8,fontWeight:600,border:`1px solid ${sel?T.accent:T.border}`,borderRadius:4,cursor:"pointer",background:sel?T.accent:"transparent",color:sel?"#fff":T.faint}}>{opt.label}</button>;
                    })}
                  </div>
                  <div style={{display:"flex",alignItems:"center",flexShrink:0}}>
                    <span style={{fontSize:9,color:T.faint,marginRight:1}}>$</span>
                    <input type="text" inputMode="decimal" value={cc.perUnit||cc.amount||""} onChange={e=>{const c=[...p.customCosts];c[ci]={...c[ci],perUnit:e.target.value,amount:e.target.value};updateProd(i,{...p,customCosts:c});}}
                      style={{width:44,textAlign:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:10,fontFamily:mono,outline:"none",padding:"2px"}}/>
                  </div>
                  <button onClick={()=>{const c=p.customCosts.filter((_,j)=>j!==ci);updateProd(i,{...p,customCosts:c});}}
                    style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:10,flexShrink:0}}
                    onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                </div>
              ))}
              <button onClick={()=>updateProd(i,{...p,customCosts:[...(p.customCosts||[]),{desc:"",perUnit:0,flat:false}]})}
                style={{fontSize:10,color:T.faint,background:"none",border:`1px dashed ${T.border}`,borderRadius:4,padding:"4px",cursor:"pointer",fontFamily:font,textAlign:"center"}}
                onMouseEnter={e=>e.currentTarget.style.color=T.accent} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>
                + Add cost
              </button>
            </div>
          )}
        </div>
        );
      })()}
      </div>
      </>}
    </div>
  );
}
