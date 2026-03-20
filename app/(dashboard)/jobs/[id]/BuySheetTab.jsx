"use client";
import { useState } from "react";

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

const DInput = ({label,value,onChange,type="text",readOnly,small,placeholder}) => (
  <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {label&&<Lbl>{label}</Lbl>}
    <input type={type} value={value||""} onChange={onChange} readOnly={readOnly} placeholder={placeholder}
      style={{fontFamily:font,fontSize:small?12:13,color:readOnly?T.muted:T.text,background:T.surface,
        border:`1px solid ${T.border}`,borderRadius:6,padding:small?"4px 8px":"7px 10px",
        outline:"none",width:"100%",boxSizing:"border-box",cursor:readOnly?"default":"text"}}/>
  </div>
);
const DSelect = ({label,value,onChange,options}) => (
  <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {label&&<Lbl>{label}</Lbl>}
    <select value={value} onChange={onChange} style={{fontFamily:font,fontSize:13,background:T.surface,
      border:`1px solid ${T.border}`,color:T.text,padding:"7px 10px",borderRadius:6,outline:"none",cursor:"pointer"}}>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);
const Btn = ({children,onClick,variant="ghost",small,disabled}) => {
  const [h,sh]=useState(false);
  const v={primary:{bg:T.accent,color:"#fff",border:"none"},ghost:{bg:h?T.accentDim:"transparent",color:T.accent,border:`1px solid ${T.accentDim}`},outline:{bg:"transparent",color:T.muted,border:`1px solid ${T.faint}`},danger:{bg:h?T.redDim:"transparent",color:T.red,border:`1px solid ${T.redDim}`},success:{bg:T.green,color:"#fff",border:"none"}}[variant]||{};
  return <button onClick={onClick} disabled={disabled} onMouseEnter={()=>sh(true)} onMouseLeave={()=>sh(false)}
    style={{fontFamily:font,fontWeight:600,fontSize:small?11:12,cursor:disabled?"not-allowed":"pointer",
      padding:small?"4px 10px":"7px 16px",borderRadius:6,background:v.bg,color:disabled?T.muted:v.color,
      border:v.border,transition:"all 0.12s",whiteSpace:"nowrap",opacity:disabled?0.5:1}}>{children}</button>;
};

// --- Style Picker ---

const StylePicker = ({catalog,onAdd,onUpdateCatalog,requireQty=true,onCollapse}) => {
  const [sB,setSB]=useState(null),[sS,setSS]=useState(null),[sC,setSC]=useState(null);
  const [sizes,setSizes]=useState({}),[name,setName]=useState("");
  const [aB,setAB]=useState(false),[aS,setAS]=useState(false),[aC,setAC]=useState(false);
  const [nv,setNv]=useState(""),[ns,setNs]=useState("");
  const brands=Object.keys(catalog),styles=sB?Object.keys(catalog[sB]):[],colors=sS?Object.keys(catalog[sB][sS]):[],szList=sC?catalog[sB][sS][sC]:[];
  const canAdd=sB&&sS&&sC&&Object.keys(sizes).length>0&&name.trim();
  const toggleSz=(sz)=>setSizes(p=>{const n={...p};if(n[sz]!==undefined)delete n[sz];else n[sz]=1;return n;});
  const doAdd=()=>{
    const selectedSizes=Object.keys(sizes);
    onAdd({id:Date.now(),brand:sB,style:sS,color:sC,name,variants:selectedSizes.map(sz=>({size:sz,qty:0})),totalQty:0,category:CATEGORY(sB),blank:0,decoration:0,freight:0,duty:0,wh:0,fulfillment:0,margin:45});
    setSizes({});setName("");setSC(null);setSS(null);setSB(null);
    if(onCollapse) onCollapse();
  };
  const addBrand=()=>{if(!nv.trim())return;onUpdateCatalog({...catalog,[nv.trim()]:{}}); setSB(nv.trim());setSS(null);setSC(null);setAB(false);setNv("");};
  const addStyle=()=>{if(!nv.trim()||!sB)return;onUpdateCatalog({...catalog,[sB]:{...catalog[sB],[nv.trim()]:{}}}); setSS(nv.trim());setSC(null);setAS(false);setNv("");};
  const addColor=()=>{if(!nv.trim()||!sB||!sS)return;const sz=ns.split(",").map(s=>s.trim()).filter(Boolean);onUpdateCatalog({...catalog,[sB]:{...catalog[sB],[sS]:{...catalog[sB][sS],[nv.trim()]:sz.length?sz:["OSFA"]}}}); setSC(nv.trim());setAC(false);setNv("");setNs("");};
  const col=(active)=>({padding:"8px 11px",cursor:"pointer",fontSize:11,fontFamily:font,display:"flex",justifyContent:"space-between",alignItems:"center",background:active?T.accent:"transparent",color:active?"#fff":T.text,borderBottom:`1px solid ${T.border}`,transition:"background 0.1s"});
  const AR=({onSave,ph,extra,onCancel})=>(
    <div style={{padding:"7px 9px",borderTop:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:5}}>
      <input autoFocus value={nv} onChange={e=>setNv(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onSave()} placeholder={ph}
        style={{fontFamily:font,fontSize:11,color:T.text,background:T.card,border:`1px solid ${T.border}`,borderRadius:5,padding:"3px 7px",outline:"none"}}/>
      {extra&&<input value={ns} onChange={e=>setNs(e.target.value)} placeholder="Sizes: S,M,L,XL…"
        style={{fontFamily:font,fontSize:11,color:T.text,background:T.card,border:`1px solid ${T.border}`,borderRadius:5,padding:"3px 7px",outline:"none"}}/>}
      <div style={{display:"flex",gap:4}}><Btn onClick={onSave} variant="primary" small>Add</Btn><Btn onClick={onCancel} variant="outline" small>Cancel</Btn></div>
    </div>
  );
  const ColHead=({title})=><div style={{padding:"5px 11px",background:T.surface,borderBottom:`1px solid ${T.border}`,fontSize:9,fontWeight:700,color:T.muted,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:font}}>{title}</div>;
  const AddBtn=({onClick})=><div onClick={onClick} style={{padding:"5px 11px",fontSize:10,color:T.accent,cursor:"pointer",borderTop:`1px solid ${T.border}`,fontFamily:font,fontWeight:600}}>+ Add</div>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
        <div style={{flex:1}}>
          <DInput label="Item display name" value={name} onChange={e=>setName(e.target.value)}
            placeholder={sB&&sS&&sC?`e.g. ${sB} ${sS} – ${sC}`:"Select brand, style & color first"} small/>
        </div>
        <Btn onClick={doAdd} variant="primary" disabled={!canAdd}>Add to project →</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden",background:T.card,minHeight:200}}>
        <div style={{borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column"}}>
          <ColHead title="Brand"/>
          <div style={{flex:1,overflowY:"auto"}}>{brands.map(b=><div key={b} onClick={()=>{setSB(b);setSS(null);setSC(null);setSizes({});}} style={col(sB===b)} onMouseEnter={e=>{if(sB!==b)e.currentTarget.style.background=T.surface;}} onMouseLeave={e=>{if(sB!==b)e.currentTarget.style.background="transparent";}}><span>{b}</span><span style={{fontSize:8,color:sB===b?"rgba(255,255,255,0.6)":CAT_COLOR[CATEGORY(b)]}}>{CATEGORY(b)}</span></div>)}</div>
          {aB?<AR onSave={addBrand} ph="Brand name…" onCancel={()=>{setAB(false);setNv("");}}/> :<AddBtn onClick={()=>setAB(true)}/>}
        </div>
        <div style={{borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column"}}>
          <ColHead title="Style"/>
          <div style={{flex:1,overflowY:"auto"}}>{!sB?<div style={{padding:"14px 11px",fontSize:10,color:T.faint,fontFamily:font}}>← Brand</div>:styles.map(s=><div key={s} onClick={()=>{setSS(s);setSC(null);setSizes({});}} style={col(sS===s)} onMouseEnter={e=>{if(sS!==s)e.currentTarget.style.background=T.surface;}} onMouseLeave={e=>{if(sS!==s)e.currentTarget.style.background="transparent";}}><span>{s}</span></div>)}</div>
          {sB&&(aS?<AR onSave={addStyle} ph="Style name & number…" onCancel={()=>{setAS(false);setNv("");}}/> :<AddBtn onClick={()=>setAS(true)}/>)}
        </div>
        <div style={{borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column"}}>
          <ColHead title="Color"/>
          <div style={{flex:1,overflowY:"auto"}}>{!sS?<div style={{padding:"14px 11px",fontSize:10,color:T.faint,fontFamily:font}}>← Style</div>:colors.map(c=><div key={c} onClick={()=>{setSC(c);setSizes({});}} style={col(sC===c)} onMouseEnter={e=>{if(sC!==c)e.currentTarget.style.background=T.surface;}} onMouseLeave={e=>{if(sC!==c)e.currentTarget.style.background="transparent";}}><span>{c}</span></div>)}</div>
          {sS&&(aC?<AR onSave={addColor} ph="Color name…" extra onCancel={()=>{setAC(false);setNv("");setNs("");}}/> :<AddBtn onClick={()=>setAC(true)}/>)}
        </div>
        <div style={{display:"flex",flexDirection:"column"}}>
          <ColHead title="Sizes"/>
          <div style={{flex:1,overflowY:"auto",padding:"8px"}}>
            {!sC?<div style={{padding:"6px 2px",fontSize:10,color:T.faint,fontFamily:font}}>← Color</div>
              :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                {szList.map(sz=>{
                  const on=sizes[sz]!==undefined;
                  return(
                    <div key={sz} onClick={()=>toggleSz(sz)}
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",borderRadius:7,cursor:"pointer",border:`1px solid ${on?T.accent:T.border}`,background:on?T.accent:T.surface,transition:"all 0.12s",userSelect:"none"}}>
                      <span style={{fontSize:13,fontWeight:700,color:on?"#fff":T.muted,fontFamily:mono}}>{sz}</span>
                      {on&&<span style={{fontSize:11,color:"rgba(255,255,255,0.8)"}}>✓</span>}
                    </div>
                  );
                })}
              </div>
            }
          </div>
          {sC&&Object.keys(sizes).length>0&&(
            <div style={{padding:"6px 10px",borderTop:`1px solid ${T.border}`,fontSize:10,fontFamily:font,color:T.muted}}>
              {Object.keys(sizes).length} size{Object.keys(sizes).length!==1?"s":""} selected
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- BUY SHEET ENGINE ---
const SIZE_ORDER=["OSFA","XS","S","M","L","XL","2XL","3XL","4XL","5XL","YXS","YS","YM","YL","YXL"];
const sortSizes=(sizes)=>[...sizes].sort((a,b)=>{const ai=SIZE_ORDER.indexOf(a),bi=SIZE_ORDER.indexOf(b);if(ai===-1&&bi===-1)return a.localeCompare(b);if(ai===-1)return 1;if(bi===-1)return -1;return ai-bi;});
const DEFAULT_CURVE={S:5.13,M:20.57,L:38.14,XL:25.90,"2XL":7.69,"3XL":2.56};
function distribute(total,sizes,curve){
  const relevant=sizes.filter(sz=>curve[sz]!==undefined);
  const total_pct=relevant.reduce((a,sz)=>a+(curve[sz]||0),0);
  const result={};sizes.forEach(sz=>{result[sz]=0;});
  if(total_pct===0||relevant.length===0)return result;
  let assigned=0;
  relevant.forEach(sz=>{const n=Math.ceil(total*(curve[sz]||0)/total_pct);result[sz]=n;assigned+=n;});
  const over=assigned-total;
  if(over>0){const sorted=[...relevant].sort((a,b)=>(curve[b]||0)-(curve[a]||0));for(let i=0;i<over;i++){result[sorted[i%sorted.length]]--;}}
  return result;
}

// --- BUY SHEET COMPONENT ---
const BuySheetTab = ({items,onUpdateItems,catalog,onUpdateCatalog}) => {
  const [focused,setFocused]=useState(null);
  const [distRow,setDistRow]=useState(null);
  const [distTotal,setDistTotal]=useState("");
  const [showPicker,setShowPicker]=useState(false);
  const removeItem=(id)=>onUpdateItems(items.filter(x=>x.id!==id));
  const updateQty=(rowIdx,sz,val)=>{
    const parsed=parseInt(val)||0;
    const newItems=items.map((it,i)=>{
      if(i!==rowIdx)return it;
      const newQtys={...it.qtys,[sz]:parsed};
      return{...it,qtys:newQtys,totalQty:Object.values(newQtys).reduce((a,v)=>a+v,0)};
    });
    onUpdateItems(newItems);
  };
  const handleDist=(rowIdx)=>{
    const total=parseInt(distTotal); if(!total||total<=0)return;
    const item=items[rowIdx];
    const dist=distribute(total,item.sizes,item.curve||DEFAULT_CURVE);
    onUpdateItems(items.map((it,i)=>i!==rowIdx?it:{...it,qtys:dist,totalQty:Object.values(dist).reduce((a,v)=>a+v,0)}));
    setDistRow(null);setDistTotal("");
  };
  const grandTotal=items.reduce((a,it)=>a+(it.totalQty||0),0);

  if(items.length===0&&!showPicker) return (
    <div style={{textAlign:"center",padding:40}}>
      <div style={{color:T.faint,fontSize:13,fontFamily:font,marginBottom:16}}>No items yet — add products to start your buy sheet.</div>
      <button onClick={()=>setShowPicker(true)} style={{background:T.accent,color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontFamily:font,fontWeight:600,cursor:"pointer"}}>+ Add Product</button>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {showPicker&&(
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:font}}>Add Product</span>
            <button onClick={()=>setShowPicker(false)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:14}}>✕</button>
          </div>
          <StylePicker catalog={catalog} onUpdateCatalog={onUpdateCatalog} requireQty={false} onCollapse={()=>setShowPicker(false)} onAdd={(item)=>{
            const sizes=item.variants?.length>0?item.variants.map(v=>v.size):(catalog[item.brand]?.[item.style]?.[item.color]||["S","M","L","XL"]);
            const sortedSizes=sortSizes([...new Set(sizes)]);
            const newItem={...item,id:Date.now(),sizes:sortedSizes,curve:DEFAULT_CURVE,qtys:{}};
            sortedSizes.forEach(sz=>{newItem.qtys[sz]=0;});
            newItem.totalQty=0;
            onUpdateItems([...items,newItem]);
          }}/>
        </div>
      )}
      {items.length>0&&(
        <>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <button onClick={()=>setShowPicker(!showPicker)} style={{background:T.accent,color:"#fff",border:"none",borderRadius:7,padding:"6px 14px",fontSize:12,fontFamily:font,fontWeight:600,cursor:"pointer"}}>+ Add Product</button>
            {grandTotal>0&&<span style={{fontSize:12,color:T.green,fontFamily:mono,fontWeight:600}}>{grandTotal.toLocaleString()} units total</span>}
            <div style={{marginLeft:"auto",display:"flex",gap:12}}>
              {[["↑↓←→","Nav"],["Enter","↓"],["Tab","→"]].map(([k,l])=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:4,padding:"1px 6px",fontSize:9,fontFamily:mono,color:T.accent}}>{k}</span>
                  <span style={{fontSize:9,color:T.faint,fontFamily:font}}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{borderRadius:10,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <table style={{borderCollapse:"collapse",fontSize:12,width:"100%"}}>
              <thead>
                <tr style={{background:T.surface}}>
                  <th style={{padding:"8px 14px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,letterSpacing:"0.06em",textTransform:"uppercase",borderRight:`1px solid ${T.border}`,width:"28%"}}>Item</th>
                  <th style={{padding:"8px 14px",textAlign:"left",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,letterSpacing:"0.06em",textTransform:"uppercase",borderRight:`1px solid ${T.border}`}}>Sizes & Qty</th>
                  <th style={{padding:"8px 14px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,letterSpacing:"0.06em",textTransform:"uppercase",borderRight:`1px solid ${T.border}`,width:"80px"}}>Total</th>
                  <th style={{padding:"8px 14px",textAlign:"center",fontSize:10,fontWeight:700,color:T.muted,fontFamily:font,letterSpacing:"0.06em",textTransform:"uppercase",width:"100px"}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item,rowIdx)=>{
                  const sizes=item.sizes||[];
                  const isLast=rowIdx===items.length-1;
                  return(
                    <tr key={item.id} style={{borderBottom:isLast?"none":`1px solid ${T.border}`,background:T.card}}>
                      <td style={{padding:"10px 14px",verticalAlign:"middle",borderRight:`1px solid ${T.border}`}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <button onClick={()=>removeItem(item.id)}
                            style={{flexShrink:0,background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.4)",fontSize:13,lineHeight:1,padding:"1px 2px",borderRadius:3,transition:"color 0.12s"}}
                            onMouseEnter={e=>e.currentTarget.style.color=T.red}
                            onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.4)"}>✕</button>
                          <div>
                            <div style={{fontSize:12,fontWeight:600,color:"#fff",fontFamily:font}}>{item.name}</div>
                            <div style={{fontSize:10,color:"rgba(255,255,255,0.7)",fontFamily:font,marginTop:1}}>{item.style} · {item.color}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{padding:"8px 10px",borderRight:`1px solid ${T.border}`,verticalAlign:"middle"}}>
                        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                          {sizes.map((sz,szIdx)=>{
                            const qty=item.qtys?.[sz]??0;
                            const isFocused=focused?.row===rowIdx&&focused?.col===szIdx;
                            return(
                              <div key={sz} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"4px 6px",borderRadius:6,border:`1px solid ${isFocused?T.accent:qty>0?T.accent+"66":T.border}`,background:isFocused?T.accentDim:qty>0?T.surface:T.card,minWidth:44,transition:"all 0.1s"}}>
                                <span style={{fontSize:9,fontWeight:700,color:qty>0?T.accent:T.muted,fontFamily:mono,letterSpacing:"0.04em"}}>{sz}</span>
                                <input type="text" inputMode="numeric" pattern="[0-9]*" value={qty||""} placeholder="0"
                                  onFocus={()=>setFocused({row:rowIdx,col:szIdx})}
                                  onChange={e=>updateQty(rowIdx,sz,e.target.value)}
                                  onKeyDown={e=>{
                                    if(e.key==="ArrowRight"||(e.key==="Tab"&&!e.shiftKey)){e.preventDefault();const nc=szIdx+1;if(nc<sizes.length)setFocused({row:rowIdx,col:nc});else if(rowIdx<items.length-1)setFocused({row:rowIdx+1,col:0});}
                                    if(e.key==="ArrowLeft"||(e.key==="Tab"&&e.shiftKey)){e.preventDefault();const nc=szIdx-1;if(nc>=0)setFocused({row:rowIdx,col:nc});else if(rowIdx>0)setFocused({row:rowIdx-1,col:items[rowIdx-1].sizes.length-1});}
                                    if(e.key==="ArrowDown"||e.key==="Enter"){e.preventDefault();if(rowIdx<items.length-1)setFocused({row:rowIdx+1,col:szIdx<items[rowIdx+1].sizes.length?szIdx:0});}
                                    if(e.key==="ArrowUp"){e.preventDefault();if(rowIdx>0)setFocused({row:rowIdx-1,col:szIdx<items[rowIdx-1].sizes.length?szIdx:0});}
                                  }}
                                  style={{width:36,textAlign:"center",background:"transparent",border:"none",outline:"none",color:qty>0?T.text:T.faint,fontSize:12,fontFamily:mono,padding:"0"}}/>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td style={{padding:"10px 14px",textAlign:"center",fontFamily:mono,fontSize:13,fontWeight:700,color:(item.totalQty||0)>0?T.green:T.faint,borderRight:`1px solid ${T.border}`}}>
                        {(item.totalQty||0)||null}
                      </td>
                      <td style={{padding:"8px",textAlign:"center",verticalAlign:"middle"}}>
                        {distRow===rowIdx?(
                          <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"center"}}>
                            <input type="text" inputMode="numeric" pattern="[0-9]*" value={distTotal} onChange={e=>setDistTotal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")handleDist(rowIdx);}} placeholder="Total" autoFocus
                              style={{width:70,background:T.surface,border:`1px solid ${T.border}`,borderRadius:5,color:T.text,fontSize:12,fontFamily:mono,padding:"3px 6px",outline:"none",textAlign:"center"}}/>
                            <div style={{display:"flex",gap:3}}>
                              <button onClick={()=>handleDist(rowIdx)} style={{background:T.accent,color:"#fff",border:"none",borderRadius:4,padding:"3px 8px",fontSize:11,cursor:"pointer",fontFamily:font,fontWeight:600}}>Fill</button>
                              <button onClick={()=>{setDistRow(null);setDistTotal("");}} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:4,color:T.muted,cursor:"pointer",fontSize:11,padding:"3px 6px"}}>✕</button>
                            </div>
                          </div>
                        ):(
                          <button onClick={()=>setDistRow(rowIdx)}
                            style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,cursor:"pointer",padding:"4px 8px",fontSize:10,fontFamily:font,whiteSpace:"nowrap"}}
                            onMouseEnter={e=>{e.currentTarget.style.background=T.accentDim;e.currentTarget.style.color=T.accent;}}
                            onMouseLeave={e=>{e.currentTarget.style.background=T.surface;e.currentTarget.style.color=T.muted;}}>
                            ⟳ Dist
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {items.length>1&&(
                  <tr style={{background:T.surface,borderTop:`2px solid ${T.border}`}}>
                    <td style={{padding:"8px 14px",fontWeight:700,fontSize:11,color:T.muted,fontFamily:font,textTransform:"uppercase",letterSpacing:"0.06em",borderRight:`1px solid ${T.border}`}}>Grand Total</td>
                    <td style={{borderRight:`1px solid ${T.border}`}}/>
                    <td style={{padding:"8px 14px",textAlign:"center",fontFamily:mono,fontSize:14,fontWeight:700,color:T.green,borderRight:`1px solid ${T.border}`}}>{grandTotal.toLocaleString()}</td>
                    <td/>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};



export { BuySheetTab };
