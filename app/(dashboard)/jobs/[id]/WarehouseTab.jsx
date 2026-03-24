"use client";
import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font } from "@/lib/theme";

const SHIP_STAGES = [
  { id:"allocated", label:"Allocated / Staged", color:"#BA7517" },
  { id:"instation", label:"In ShipStation", color:"#534AB7" },
  { id:"complete", label:"Fulfillment Complete", color:"#3B6D11" },
];
const tQty = (q) => Object.values(q||{}).reduce((a,v)=>a+v,0);

export function WarehouseTab({ items, job, rxData: initialRxData, shipStage: initialShipStage, shipNotes: initialShipNotes, onRxDataChange, onShipChange }) {
  const supabase = createClient();
  const [rxData, setRxData] = useState(initialRxData || {});
  const [rxExp, setRxExp] = useState({});
  const [shipStage, setShipStage] = useState(initialShipStage);
  const [shipNotes, setShipNotes] = useState(initialShipNotes || "");
  const rxSaveTimer = useRef(null);
  const shipSaveTimer = useRef(null);

  const ic = {width:"100%",padding:"6px 10px",border:`1px solid ${T.border}`,borderRadius:6,background:T.surface,color:T.text,fontSize:"13px",fontFamily:font,boxSizing:"border-box"};
  const lc = {fontSize:"12px",color:T.muted,marginBottom:"4px",display:"block"};
  const card = {background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"1rem 1.25rem"};

  // ── Receiving: debounce save to DB ──────────────────────────────────────
  const saveRxToDb = useCallback(async (itemId, data) => {
    await supabase.from("items").update({ receiving_data: data }).eq("id", itemId);
    if (data.shipped) {
      for (const [size, qty] of Object.entries(data.shipped)) {
        await supabase.from("buy_sheet_lines").update({ qty_shipped_from_vendor: qty }).eq("item_id", itemId).eq("size", size);
      }
    }
    if (data.received) {
      for (const [size, qty] of Object.entries(data.received)) {
        await supabase.from("buy_sheet_lines").update({ qty_received_at_hpd: qty }).eq("item_id", itemId).eq("size", size);
      }
    }
  }, [supabase]);

  const updRx = (id, p) => {
    setRxData(prev => {
      const next = {...prev, [id]:{...prev[id],...p}};
      if (rxSaveTimer.current) clearTimeout(rxSaveTimer.current);
      rxSaveTimer.current = setTimeout(() => saveRxToDb(id, next[id]), 800);
      if (onRxDataChange) onRxDataChange(next);
      return next;
    });
  };
  const updRxNested = (id, key, sz, val) => {
    setRxData(prev => {
      const next = {...prev, [id]:{...prev[id],[key]:{...(prev[id]?.[key]||{}),[sz]:val}}};
      if (rxSaveTimer.current) clearTimeout(rxSaveTimer.current);
      rxSaveTimer.current = setTimeout(() => saveRxToDb(id, next[id]), 800);
      if (onRxDataChange) onRxDataChange(next);
      return next;
    });
  };

  // ── Shipping: persist to job.type_meta ──────────────────────────────────
  const saveShipToDb = useCallback(async (stage, notes) => {
    if (!job) return;
    const meta = {...(job.type_meta || {}), ship_stage: stage, ship_notes: notes};
    await supabase.from("jobs").update({ type_meta: meta }).eq("id", job.id);
    if (onShipChange) onShipChange(stage, notes);
  }, [job, supabase, onShipChange]);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div>
        <div style={{fontSize:11,fontWeight:500,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Receiving</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {items.filter(it=>it.pipeline_stage==="shipped"||rxData[it.id]).length===0&&(
            <div style={{...card,textAlign:"center",fontSize:13,color:T.muted,padding:"2rem"}}>
              No items shipped yet. Mark items as Shipped in the Production tab.
            </div>
          )}
          {items.filter(it=>it.pipeline_stage==="shipped"||rxData[it.id]).map(item=>{
            const rx=rxData[item.id]||{};
            const isExp=rxExp[item.id];
            const isRxd=!!rx.receivedAt;
            const ordered=tQty(item.qtys||{});
            return (
              <div key={item.id} style={{...card,padding:0,overflow:"hidden",border:"0.5px solid "+(isRxd?"#C0DD97":"var(--color-border-tertiary)")}}>
                <div onClick={()=>setRxExp(p=>({...p,[item.id]:!p[item.id]}))} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",cursor:"pointer",background:isRxd?"#EAF3DE44":"transparent"}}>
                  <div style={{flex:1}}>
                    <span style={{fontSize:13,fontWeight:500}}>{item.name}</span>
                    <span style={{fontSize:11,color:T.muted,marginLeft:8}}>{item.blank_sku}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                    {isRxd?<span style={{color:"#3B6D11",fontWeight:500}}>Received {rx.receivedAt}</span>:<span style={{color:T.muted}}>{ordered.toLocaleString()} expected</span>}
                    {rx.location&&<span style={{background:T.surface,padding:"1px 7px",borderRadius:6,fontSize:11}}>{rx.location}</span>}
                    <span style={{fontSize:10,color:T.muted}}>{isExp?"▲":"▼"}</span>
                  </div>
                </div>
                {isExp&&(
                  <div style={{borderTop:"0.5px solid var(--color-border-tertiary)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                      <div><label style={lc}>Carrier</label><input style={ic} value={rx.carrier||""} onChange={e=>updRx(item.id,{carrier:e.target.value})} placeholder="UPS, FedEx..."/></div>
                      <div><label style={lc}>Tracking #</label><input style={ic} value={rx.trackingNum||""} onChange={e=>updRx(item.id,{trackingNum:e.target.value})} placeholder="1Z999AA1..."/></div>
                      <div><label style={lc}>Storage location</label><input style={ic} value={rx.location||""} onChange={e=>updRx(item.id,{location:e.target.value})} placeholder="Rack B, Shelf 3"/></div>
                    </div>
                    <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",border:`1px solid ${T.border}`}}>
                      <thead><tr style={{background:T.surface}}>
                        {["Size","Ordered","Shipped","Var 1","Received","Var 2"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"center",fontSize:11,fontWeight:500,color:T.muted,borderRight:"0.5px solid var(--color-border-tertiary)"}}>{h}</th>)}
                      </tr></thead>
                      <tbody>{(item.sizes||[]).map((sz,si)=>{
                        const oq=(item.qtys||{})[sz]||0;
                        const sq=rx.shipped?.[sz]??null;
                        const rq=rx.received?.[sz]??null;
                        const v1=sq!==null?sq-oq:null;
                        const v2=sq!==null&&rq!==null?rq-sq:null;
                        return (
                          <tr key={sz} style={{borderBottom:si<(item.sizes||[]).length-1?"0.5px solid var(--color-border-tertiary)":"none"}}>
                            <td style={{padding:"6px 10px",textAlign:"center",fontWeight:500,borderRight:"0.5px solid var(--color-border-tertiary)"}}>{sz}</td>
                            <td style={{padding:"6px 10px",textAlign:"center",fontFamily:"var(--font-mono)",color:T.muted,borderRight:"0.5px solid var(--color-border-tertiary)"}}>{oq}</td>
                            <td style={{padding:"4px 6px",textAlign:"center",borderRight:"0.5px solid var(--color-border-tertiary)"}}><input type="number" min="0" value={sq??oq} onChange={e=>updRxNested(item.id,"shipped",sz,parseInt(e.target.value)||0)} style={{width:50,textAlign:"center",padding:"3px",border:`1px solid ${T.border}`,borderRadius:6,background:"var(--color-background-primary)",color:v1!==null&&v1<0?"#A32D2D":"var(--color-text-primary)",fontSize:12,fontFamily:"var(--font-mono)"}}/></td>
                            <td style={{padding:"6px 10px",textAlign:"center",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:500,color:v1===null?"var(--color-text-secondary)":v1<0?"#A32D2D":v1>0?"#3B6D11":"var(--color-text-secondary)",borderRight:"0.5px solid var(--color-border-tertiary)"}}>{v1===null?"—":v1===0?"—":(v1>0?"+":"")+v1}</td>
                            <td style={{padding:"4px 6px",textAlign:"center",borderRight:"0.5px solid var(--color-border-tertiary)"}}><input type="number" min="0" value={rq??(sq??oq)} onChange={e=>updRxNested(item.id,"received",sz,parseInt(e.target.value)||0)} style={{width:50,textAlign:"center",padding:"3px",border:`1px solid ${T.border}`,borderRadius:6,background:"var(--color-background-primary)",color:v2!==null&&v2<0?"#A32D2D":"var(--color-text-primary)",fontSize:12,fontFamily:"var(--font-mono)"}}/></td>
                            <td style={{padding:"6px 10px",textAlign:"center",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:500,color:v2===null?"var(--color-text-secondary)":v2<0?"#A32D2D":v2>0?"#3B6D11":"var(--color-text-secondary)"}}>{v2===null?"—":v2===0?"—":(v2>0?"+":"")+v2}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:12,color:T.muted}}>Condition:</span>
                      {["Good","Damaged"].map(opt=>(
                        <button key={opt} onClick={()=>updRx(item.id,{condition:opt})} style={{padding:"4px 12px",borderRadius:6,fontSize:12,cursor:"pointer",border:`1px solid ${T.border}`,background:rx.condition===opt?(opt==="Good"?"#EAF3DE":"#FAEEDA"):"var(--color-background-primary)",color:rx.condition===opt?(opt==="Good"?"#27500A":"#854F0B"):"var(--color-text-secondary)"}}>{opt}</button>
                      ))}
                    </div>
                    {!isRxd&&(
                      <div style={{display:"flex",justifyContent:"flex-end"}}>
                        <button onClick={()=>updRx(item.id,{receivedAt:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})})} style={{padding:"7px 20px",borderRadius:6,background:"#639922",color:"#fff",border:"none",fontSize:12,fontWeight:500,cursor:"pointer"}}>Mark Received</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{fontSize:11,fontWeight:500,color:T.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Shipping</div>
        <div style={{...card,display:"flex",flexDirection:"column",gap:12}}>
          {Object.keys(rxData).length>0&&(
            <div>
              <div style={{fontSize:12,fontWeight:500,color:T.muted,marginBottom:8}}>Receiving handoff</div>
              <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                <thead><tr style={{borderBottom:`1px solid ${T.border}`}}>
                  {["Item","Location","Ordered","Received","Status"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:["Ordered","Received"].includes(h)?"center":"left",color:T.muted,fontWeight:500}}>{h}</th>)}
                </tr></thead>
                <tbody>{Object.entries(rxData).map(([id,rx])=>{
                  const item=items.find(it=>it.id===id);
                  if(!item)return null;
                  const ord=tQty(item.qtys||{});
                  const rec=Object.values(rx.received||{}).reduce((a,v)=>a+v,0)||ord;
                  const short=rec<ord;
                  return (
                    <tr key={id} style={{borderBottom:`1px solid ${T.border}`}}>
                      <td style={{padding:"8px 10px",fontWeight:500}}>{item.name}</td>
                      <td style={{padding:"8px 10px",color:T.muted}}>{rx.location||"—"}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",fontFamily:"var(--font-mono)"}}>{ord}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",fontFamily:"var(--font-mono)",color:short?"#A32D2D":"#3B6D11",fontWeight:500}}>{rec}</td>
                      <td style={{padding:"8px 10px"}}>
                        <span style={{padding:"2px 8px",borderRadius:6,fontSize:11,fontWeight:500,background:rx.condition==="Damaged"?"#FAEEDA":short?"#FAEEDA":"#EAF3DE",color:rx.condition==="Damaged"?"#854F0B":short?"#854F0B":"#27500A"}}>
                          {rx.condition==="Damaged"?"Damage":short?(rec-ord)+" short":"OK"}
                        </span>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          <div>
            <div style={{fontSize:12,fontWeight:500,color:T.muted,marginBottom:8}}>Fulfillment status</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
              {SHIP_STAGES.map((stage,idx)=>{
                const si=SHIP_STAGES.findIndex(s=>s.id===shipStage);
                const done=si>=idx, active=shipStage===stage.id;
                return (
                  <button key={stage.id} onClick={()=>{setShipStage(stage.id); saveShipToDb(stage.id, shipNotes);}} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:6,fontSize:12,fontWeight:active?500:400,cursor:"pointer",border:"0.5px solid "+(done?stage.color+"88":"var(--color-border-tertiary)"),background:active?stage.color+"22":done?stage.color+"11":"transparent",color:done?stage.color:T.muted}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:done?stage.color:"var(--color-border-secondary)"}}/>
                    {stage.label}
                  </button>
                );
              })}
            </div>
            <textarea value={shipNotes} onChange={e=>{
              setShipNotes(e.target.value);
              if (shipSaveTimer.current) clearTimeout(shipSaveTimer.current);
              shipSaveTimer.current = setTimeout(() => saveShipToDb(shipStage, e.target.value), 800);
            }} placeholder="Internal notes..." style={{...ic,minHeight:60,resize:"vertical",lineHeight:1.5}}/>
          </div>
        </div>
      </div>
    </div>
  );
}
