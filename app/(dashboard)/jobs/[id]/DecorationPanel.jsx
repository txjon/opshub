"use client";
import { useState } from "react";
import { T, font, mono } from "@/lib/theme";
import { calcDecorationLines } from "@/lib/pricing";
import { SettingsModal } from "./SettingsModal";
import { useIsMobile } from "@/lib/useIsMobile";

const LOCATION_PRESETS = ["Front","Back","Left Sleeve","Right Sleeve","Left Chest","Right Chest","Neck","Hood","Pocket"];
const SHARE_GROUPS = ["A","B","C","D","E","F","G","H","I","J"];
const TAG_SHARE_GROUPS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10"];

export function DecorationPanel({ p, i, costProds, PRINTERS, decoratorRecords = [], onAddDecorator, updateProd, setCostProds, lookupPrintPrice, lookupTagPrice, costingLocked = false }) {
  const isMobile = useIsMobile();
  const pr = PRINTERS[p.printVendor] || {};
  const [forceExpanded, setForceExpanded] = useState(false);
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

  // Locked summary view — read-only scannable digest of every decoration cost.
  // Sourced from calcDecorationLines so the breakdown matches what's been
  // costed. Grouped into sections so it's easy to scan.
  if (costingLocked && !forceExpanded) {
    const lines = calcDecorationLines(p, costProds, PRINTERS) || [];
    const qty = p.totalQty || 0;
    const fleecePresent = !!p.isFleece;

    // Categorize lines by source so we can render section headers
    const activeLocLabels = new Set(
      Object.values(p.printLocations||{})
        .filter(l => l?.location && l?.screens > 0)
        .map(l => l.location)
    );
    const finishingKeys = new Set(Object.keys(pr.finishing || {}));
    const specialtyKeys = new Set(Object.keys(pr.specialty || {}));

    const locLines = [];
    const tagLines = [];
    const pkgLines = [];
    const finLines = [];
    const specLines = [];
    const setupLines = [];
    const customLines = [];

    // Custom-cost labels (the user-typed descriptions) for matching
    const customDescs = new Set(
      (p.customCosts || [])
        .filter(c => (parseFloat(c.perUnit)||parseFloat(c.amount)||0) > 0)
        .map(c => (c.desc || c.label || "Custom"))
    );

    for (const ln of lines) {
      if (activeLocLabels.has(ln.label)) locLines.push(ln);
      else if (ln.label === "Tag print") tagLines.push(ln);
      else if (ln.label.startsWith("Packaging")) pkgLines.push(ln);
      else if (finishingKeys.has(ln.label)) finLines.push(ln);
      else if (specialtyKeys.has(ln.label) || ln.label === "Fleece Upcharge") specLines.push(ln);
      else if (/^Screen fees|^Tag screen fees|\([\d]+( [a-z]+)?\)$/.test(ln.label) || ln.label === "Setup (manual)") setupLines.push(ln);
      else if (customDescs.has(ln.label)) customLines.push({ ...ln, isFlat: ln.qty === 1 });
      else customLines.push({ ...ln, isFlat: ln.qty === 1 });
    }

    const sumLines = arr => arr.reduce((a, l) => a + (l.total || 0), 0);
    const fmtMoney = n => `$${(n || 0).toFixed(2)}`;
    const perUnit = n => qty > 0 ? n / qty : 0;

    const LineRow = ({ left, right, sublabel }) => (
      <div style={{display:"flex",alignItems:"baseline",gap:8,fontSize:12,padding:"5px 0",borderBottom:`1px solid ${T.border}33`}}>
        <span style={{color:T.text,fontWeight:500,flex:1,minWidth:0}}>
          {left}
          {sublabel && <span style={{fontSize:11,color:T.faint,marginLeft:6}}>{sublabel}</span>}
        </span>
        <span style={{color:T.text,fontFamily:mono,fontWeight:700,flexShrink:0}}>{right}</span>
      </div>
    );

    const headerRow = (label, value, valueMono) => (
      <div style={{display:"flex",alignItems:"baseline",gap:12,padding:"4px 0"}}>
        <span style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em",minWidth:70,flexShrink:0}}>{label}</span>
        <span style={{fontSize:13,color:T.text,fontFamily:valueMono?mono:font,fontWeight:600}}>{value || "—"}</span>
      </div>
    );

    const decorationTotal = sumLines(lines);

    return (
      <div style={{display:"flex",flexDirection:"column",gap:0,paddingLeft:isMobile?0:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingBottom:8,borderBottom:`2px solid ${T.text}`,marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:800,color:T.text,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Decoration · Locked</div>
          <button onClick={()=>setForceExpanded(true)}
            style={{fontSize:10,fontFamily:font,fontWeight:600,color:T.muted,background:"none",border:`1px solid ${T.border}`,borderRadius:5,cursor:"pointer",padding:"3px 10px"}}
            onMouseEnter={e=>{e.currentTarget.style.color=T.text;e.currentTarget.style.borderColor=T.accent;}}
            onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border;}}>
            Expand details
          </button>
        </div>

        {/* Vendor / type — compact header strip */}
        <div style={{marginBottom:10}}>
          {headerRow("Vendor", p.printVendor || "Not set")}
          {p.decorationType && headerRow("Type", p.decorationType)}
          {fleecePresent && headerRow("Fleece", "Yes")}
        </div>

        {/* Flat line list — every cost in one read, no section chrome */}
        <div style={{display:"flex",flexDirection:"column",marginBottom:6}}>
          {locLines.map((ln, idx) => {
            const matchingLoc = Object.values(p.printLocations || {}).find(l => l?.location === ln.label);
            const screens = matchingLoc?.screens || 0;
            const shareGroup = matchingLoc?.shared && matchingLoc?.shareGroup ? matchingLoc.shareGroup : null;
            const sub = `${screens} ${screens===1?"color":"colors"}` + (shareGroup ? ` · Group ${shareGroup}` : "");
            return <LineRow key={"loc"+idx} left={ln.label} sublabel={sub} right={fmtMoney(ln.rate)} />;
          })}
          {tagLines.map((ln, idx) => (
            <LineRow key={"tag"+idx} left={`Tag${p.tagRepeat ? " (Repeat)" : ""}`} sublabel={p.tagShareGroup ? `Group ${p.tagShareGroup}` : null} right={fmtMoney(ln.rate)} />
          ))}
          {pkgLines.map((ln, idx) => <LineRow key={"pkg"+idx} left={ln.label} right={fmtMoney(ln.rate)} />)}
          {finLines.map((ln, idx) => <LineRow key={"fin"+idx} left={ln.label} right={fmtMoney(ln.rate)} />)}
          {specLines.map((ln, idx) => <LineRow key={"spec"+idx} left={ln.label} right={fmtMoney(ln.rate)} />)}
          {setupLines.map((ln, idx) => <LineRow key={"setup"+idx} left={ln.label} right={fmtMoney(ln.total)} />)}
          {customLines.map((ln, idx) => (
            <LineRow key={"cust"+idx} left={ln.label} sublabel={ln.isFlat ? "flat" : `${fmtMoney(ln.rate)} / unit`} right={fmtMoney(ln.total)} />
          ))}
        </div>

        {/* Grand total */}
        <div style={{marginTop:6,paddingTop:10,borderTop:`2px solid ${T.text}`,display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
          <span style={{fontSize:11,fontWeight:800,color:T.text,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Decoration Total</span>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:1}}>
            <span style={{fontSize:14,fontWeight:800,color:T.text,fontFamily:mono}}>{fmtMoney(decorationTotal)}</span>
            {qty > 0 && <span style={{fontSize:10,color:T.muted,fontFamily:mono}}>{fmtMoney(decorationTotal / qty)} / unit · {qty.toLocaleString()} units</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10,paddingLeft:isMobile?0:20,...(costingLocked?{pointerEvents:"none",opacity:0.6}:{})}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingBottom:8,borderBottom:"2px solid "+T.text}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:11,fontWeight:800,color:T.text,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.08em"}}>Decoration</div>
          {costingLocked && (
            <button onClick={()=>setForceExpanded(false)}
              style={{fontSize:10,fontFamily:font,fontWeight:600,color:T.muted,background:"none",border:`1px solid ${T.border}`,borderRadius:5,cursor:"pointer",padding:"3px 10px",pointerEvents:"auto"}}>
              ← Collapse
            </button>
          )}
        </div>
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
          if (v === "__add__") { if (onAddDecorator) onAddDecorator(); return; }
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
          {decoratorRecords.map(d=>{
            const key=d.short_code||d.name;
            return <option key={d.id} value={key}>{d.name}</option>;
          })}
          {onAddDecorator && <option value="__add__">+ Add decorator</option>}
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
          // "Minimum not met" guard. When the decorator has no minimum
          // charge configured AND the effective qty is below their first
          // tier, lookupPrintPrice silently returns the first-tier rate —
          // which would let the user quote at the bulk rate without ever
          // hitting the tier. Surface it as a warning instead of a price.
          const vendorPricing = PRINTERS[p.printVendor] || {};
          const firstTierQty = vendorPricing.qtys?.[0] || 0;
          const minimumPrint = vendorPricing.minimums?.print || 0;
          const belowMinimum = isActive && firstTierQty > 0 && effectiveQty < firstTierQty && minimumPrint <= 0;

          const hasLocation = !!(ld.location && ld.location.trim());
          // Single-row layout — Location · # colors · (optional puff) ·
          // Share/Group controls · qty/$ · clear. All data on one
          // line, ~40px tall, table-like alignment across multiple
          // print locations.
          const puffActive = isActive && p.specialtyQtys && Object.keys(p.specialtyQtys).some(k=>k.toLowerCase().includes("puff")&&k.endsWith("_on")&&p.specialtyQtys[k]);
          return (
            <div key={loc} style={{background:isActive?T.surface:"transparent",border:`1px solid ${isActive?T.border:T.border+"66"}`,borderRadius:8,padding:"6px 10px",display:"flex",alignItems:"center",gap:10,minHeight:38}}>
              {/* Location name — fixed-width column so colors below
                  line up across all rows. */}
              <div style={{width:170,flexShrink:0,position:"relative"}}>
                <input value={ld.location||""} onChange={e=>updateLoc(loc,{location:e.target.value,printer:p.printVendor})}
                  list={`loc-presets-${i}-${loc}`}
                  style={{background:"transparent",border:"none",outline:"none",color:T.text,fontSize:13,fontWeight:700,fontFamily:font,width:"100%",padding:0}}
                  placeholder="Location..." />
                <datalist id={`loc-presets-${i}-${loc}`}>{LOCATION_PRESETS.map(l=><option key={l} value={l}/>)}</datalist>
              </div>

              {/* Colors — anchored right next to the location name so
                  the value column stays aligned across multiple rows. */}
              {hasLocation && (
                <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                  <input type="text" inputMode="numeric" value={ld.screens||""} onChange={e=>updateLoc(loc,{screens:parseInt(e.target.value)||0,printer:p.printVendor})}
                    placeholder="0"
                    style={{width:34,textAlign:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontSize:13,fontWeight:700,fontFamily:mono,outline:"none",padding:"3px 4px"}}/>
                  <span style={{fontSize:10,color:T.muted}}>colors</span>
                </div>
              )}

              {/* Puff colors — only when puff specialty active */}
              {puffActive && (
                <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                  <input type="text" inputMode="numeric" value={ld.puffColors||""} onChange={e=>updateLoc(loc,{puffColors:parseInt(e.target.value)||0})}
                    placeholder="0"
                    style={{width:34,textAlign:"center",background:T.card,border:`1px solid ${T.amber}44`,borderRadius:5,color:T.amber,fontSize:13,fontWeight:700,fontFamily:mono,outline:"none",padding:"3px 4px"}}/>
                  <span style={{fontSize:10,color:T.amber}}>puff</span>
                </div>
              )}

              {/* Share / Group control — single dropdown that opens
                  directly to group choices. Both states (Share / B)
                  share the same dimensions so the chip doesn't shrink
                  when a group is selected. */}
              {hasLocation && (() => {
                const sharedSelected = isShared && shareGroup;
                // Locked dimensions across both states so selecting a
                // group doesn't shrink the chip.
                const baseStyle = {
                  width: 64, height: 24,
                  padding: "0 18px 0 10px",
                  fontSize: 11, fontWeight: 700,
                  borderRadius: 4, cursor: "pointer",
                  outline: "none", appearance: "none", WebkitAppearance: "none",
                  textAlign: "center",
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center",
                  boxSizing: "border-box",
                };
                return (
                  <div style={{width:84,flexShrink:0,display:"flex",alignItems:"center",gap:4}}>
                    {sharedSelected ? (
                      <>
                        <select value={SHARE_GROUPS.includes(shareGroup) ? shareGroup : ""} onChange={e=>updateLoc(loc,{shareGroup:e.target.value})}
                          style={{
                            ...baseStyle, fontFamily: mono,
                            border: `1px solid ${SHARE_GROUPS.includes(shareGroup)?T.accent:T.red}`,
                            backgroundColor: SHARE_GROUPS.includes(shareGroup) ? T.accent : T.red,
                            backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23ffffff' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
                            color: "#fff",
                          }}>
                          {!SHARE_GROUPS.includes(shareGroup) && <option value="" disabled>?</option>}
                          {SHARE_GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                        </select>
                        <button onClick={()=>updateLoc(loc,{shared:false,shareGroup:""})}
                          title="Stop sharing"
                          style={{fontSize:11,color:T.faint,background:"none",border:"none",cursor:"pointer",padding:"0 2px",lineHeight:1}}
                          onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                      </>
                    ) : (
                      <select value="" onChange={e=>{ if (e.target.value) updateLoc(loc,{shared:true,shareGroup:e.target.value}); }}
                        style={{
                          ...baseStyle, fontFamily: font, fontWeight: 600,
                          border: `1px solid ${T.border}`,
                          backgroundColor: "transparent",
                          backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23999' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
                          color: T.muted,
                        }}
                        onFocus={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.color=T.accent;}}
                        onBlur={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.muted;}}>
                        <option value="" disabled>Share</option>
                        {SHARE_GROUPS.map(g=><option key={g} value={g}>Group {g}</option>)}
                      </select>
                    )}
                  </div>
                );
              })()}

              {/* Spacer — pushes the cost column to the far right
                  edge while everything else stays anchored on the
                  left in stable columns. */}
              <div style={{flex:1,minWidth:0}} />

              {/* Effective qty + per-unit cost, right-aligned. Shows
                  "Minimum not met" in red when below first tier and
                  the decorator has no minimum charge configured —
                  avoids leaking a misleading bulk-tier price. */}
              {isActive && (
                <div style={{display:"flex",alignItems:"baseline",gap:6,flexShrink:0}}>
                  {isShared&&shareGroup&&<span style={{fontSize:10,fontWeight:500,color:T.faint,fontFamily:mono}}>({effectiveQty})</span>}
                  {belowMinimum ? (
                    <span title={`Below the decorator's first tier (${firstTierQty}). Either share with other items to combine qty, or set a minimum charge on this decorator.`}
                      style={{fontSize:11,fontWeight:700,color:T.red,fontFamily:font,letterSpacing:"0.02em"}}>
                      Minimum not met
                    </span>
                  ) : (
                    <span style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:mono}}>
                      ${unitCost>0?unitCost.toFixed(2):"—"}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })})()}

      </div>

      {/* ── Tag · Packaging · Finishing — one horizontal row with
          subtle uppercase labels, no nested card chrome. Each section
          flows side by side; on narrow widths they wrap. Saves
          ~150pt of vertical space vs. the old stacked cards. */}
      {(() => {
        const sectionLabel = { fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 };
        const toggleBtn = (on, opts = {}) => ({
          padding: "5px 12px", fontSize: 12, fontWeight: 700, fontFamily: font,
          borderRadius: 6, cursor: "pointer", border: "none", minHeight: 30,
          background: on ? T.green : (opts.subtle ? T.card : T.surface),
          color: on ? "#fff" : T.text,
          ...(opts.outlined && !on ? { border: `1px solid ${T.border}`, background: "transparent" } : {}),
        });
        const hasPackaging = p.printVendor && pr.packaging && Object.keys(pr.packaging).length > 0;
        const hasFinishing = p.printVendor && pr.finishing && Object.keys(pr.finishing).length > 0;
        return (
          <div style={{display:"flex",gap:24,flexWrap:"wrap",alignItems:"flex-start",padding:"4px 0"}}>
            {/* Tag */}
            <div style={{display:"flex",flexDirection:"column",gap:0,minWidth:140}}>
              <div style={sectionLabel}>Tag print</div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <button onClick={()=>updateProd(i,{...p,tagPrint:!p.tagPrint,tagRepeat:p.tagPrint?false:p.tagRepeat})}
                  style={toggleBtn(p.tagPrint)}>
                  {p.tagPrint?"Tag":"Tag?"}
                </button>
                {p.tagPrint && (
                  <button onClick={()=>updateProd(i,{...p,tagRepeat:!p.tagRepeat})}
                    style={toggleBtn(p.tagRepeat)}>
                    Repeat
                  </button>
                )}
                {p.tagPrint && (() => {
                  // Tag share — unified single dropdown matching the
                  // print-location share UX. Picking a group sets both
                  // tagShared and tagShareGroup in one update.
                  const sharedSelected = p.tagShared && p.tagShareGroup;
                  const baseStyle = { width: 64, height: 24, padding: "0 18px 0 10px", fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: "pointer", outline: "none", appearance: "none", WebkitAppearance: "none", textAlign: "center", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center", boxSizing: "border-box" };
                  return (
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      {sharedSelected ? (
                        <>
                          <select value={TAG_SHARE_GROUPS.includes(p.tagShareGroup) ? p.tagShareGroup : ""} onChange={e=>updateProd(i,{...p,tagShareGroup:e.target.value})}
                            style={{...baseStyle, fontFamily: mono, border:`1px solid ${TAG_SHARE_GROUPS.includes(p.tagShareGroup)?T.amber:T.red}`, backgroundColor: TAG_SHARE_GROUPS.includes(p.tagShareGroup) ? T.amber : T.red, backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23ffffff' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, color: "#fff"}}>
                            {!TAG_SHARE_GROUPS.includes(p.tagShareGroup) && <option value="" disabled>?</option>}
                            {TAG_SHARE_GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                          </select>
                          <button onClick={()=>updateProd(i,{...p,tagShared:false,tagShareGroup:""})}
                            title="Stop sharing"
                            style={{fontSize:11,color:T.faint,background:"none",border:"none",cursor:"pointer",padding:"0 2px",lineHeight:1}}
                            onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                        </>
                      ) : (
                        <select value="" onChange={e=>{ if (e.target.value) updateProd(i,{...p,tagShared:true,tagShareGroup:e.target.value}); }}
                          style={{...baseStyle, fontFamily: font, fontWeight: 600, border:`1px solid ${T.border}`, backgroundColor: "transparent", backgroundImage:`url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%23999' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`, color: T.muted}}>
                          <option value="" disabled>Share</option>
                          {TAG_SHARE_GROUPS.map(g=><option key={g} value={g}>Group {g}</option>)}
                        </select>
                      )}
                      <span style={{fontSize:11,color:T.muted,fontFamily:mono,fontWeight:600}}>
                        ${p.printVendor ? (lookupTagPrice(p.printVendor, p.tagShareGroup ? getTagSharedQty() : (p.totalQty||0)) || 0).toFixed(2) : "—"}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Packaging */}
            {hasPackaging && (
              <div style={{display:"flex",flexDirection:"column",gap:0,minWidth:140}}>
                <div style={sectionLabel}>Packaging</div>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  {Object.keys(pr.packaging).map(k=>{
                    const on = p.finishingQtys?.Packaging_on>0 && p.finishingQtys?.Packaging_variant===k;
                    return (
                      <button key={k} onClick={()=>{
                        if (on) updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),Packaging_on:0,Packaging_variant:""}});
                        else updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),Packaging_on:1,Packaging_variant:k}});
                      }}
                        style={toggleBtn(on)}>
                        {k}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Finishing */}
            {hasFinishing && (
              <div style={{display:"flex",flexDirection:"column",gap:0,minWidth:140}}>
                <div style={sectionLabel}>Finishing</div>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  {Object.keys(pr.finishing).map(key=>{
                    const on = p.finishingQtys?.[key+"_on"]>0;
                    return (
                      <button key={key} onClick={()=>updateProd(i,{...p,finishingQtys:{...(p.finishingQtys||{}),[key+"_on"]:on?0:1}})}
                        style={toggleBtn(on)}>
                        {key}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Setup Fees — collapsible */}
      {/* ── Setup Fees · Specialty · Custom Costs — 3-column grid
          so the collapsed summaries sit side-by-side instead of
          stacking down the page. Each card expands inline when
          tapped; on narrow viewports the grid wraps. */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(0, 1fr))",gap:8,alignItems:"start"}}>
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
          <button onClick={()=>updateProd(i,{...p,_setupOpen:true})}
            style={{width:"100%",padding:"6px 10px",background:T.surface,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:font}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <span style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Setup Fees</span>
              <span style={{fontSize:9,color:activeSetup.length>0?T.accent:T.faint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{setupSummary}</span>
            </div>
            <span style={{fontSize:10,color:T.faint}}>›</span>
          </button>
          <SettingsModal open={!!p._setupOpen} onClose={()=>updateProd(i,{...p,_setupOpen:false})} title="Setup Fees" summary={activeSetup.length>0?activeSetup.join(" · "):"None applied"} width={520}>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
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
          </SettingsModal>
        </div>
        );
      })()}

      {/* Specialty — column 2 of the grid */}
      {p.printVendor && pr.specialty && Object.keys(pr.specialty).length>0 ? (()=>{
        const activeSpecs = Object.entries(pr.specialty).filter(([key])=>{
          const isFleece = key.toLowerCase().includes("fleece");
          return isFleece ? p.isFleece : (p.specialtyQtys?.[key+"_on"]>0);
        }).map(([key])=>key);
        const specSummary = activeSpecs.length>0 ? activeSpecs.join(", ") : "None";
        return (
        <div style={{borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden"}}>
          <button onClick={()=>updateProd(i,{...p,_specOpen:true})}
            style={{width:"100%",padding:"6px 10px",background:T.surface,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:font}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <span style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Specialty</span>
              <span style={{fontSize:9,color:activeSpecs.length>0?T.accent:T.faint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{specSummary}</span>
            </div>
            <span style={{fontSize:10,color:T.faint}}>›</span>
          </button>
          <SettingsModal open={!!p._specOpen} onClose={()=>updateProd(i,{...p,_specOpen:false})} title="Specialty" summary={activeSpecs.length>0?activeSpecs.join(" · "):"None applied"} width={460}>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
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
          </SettingsModal>
        </div>
        );
      })() : null}

      {/* Custom Costs */}
      {(()=>{
        const activeCosts = (p.customCosts||[]).filter(c=>c.desc);
        const customSummary = activeCosts.length>0 ? activeCosts.map(c=>c.desc).join(", ") : "None";
        return (
        <div style={{borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden",minWidth:0}}>
          <button onClick={()=>updateProd(i,{...p,_customOpen:true})}
            style={{width:"100%",padding:"6px 10px",background:T.surface,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:font}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <span style={{fontSize:9,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom Costs</span>
              <span style={{fontSize:9,color:activeCosts.length>0?T.accent:T.faint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{customSummary}</span>
            </div>
            <span style={{fontSize:10,color:T.faint}}>›</span>
          </button>
          <SettingsModal open={!!p._customOpen} onClose={()=>updateProd(i,{...p,_customOpen:false})} title="Custom Costs" summary={activeCosts.length>0?activeCosts.map(c=>c.desc).join(" · "):"None applied"} width={520}>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
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
                style={{fontSize:11,color:T.muted,background:"none",border:`1px dashed ${T.border}`,borderRadius:6,padding:"8px",cursor:"pointer",fontFamily:font,textAlign:"center",minHeight:36}}
                onMouseEnter={e=>e.currentTarget.style.color=T.accent} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>
                + Add cost
              </button>
            </div>
          </SettingsModal>
        </div>
        );
      })()}
      </div>
      </>}
    </div>
  );
}
