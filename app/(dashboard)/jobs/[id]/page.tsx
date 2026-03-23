"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { CostingTabWrapper } from "./CostingTab";
import { POTab } from "./POTab.jsx";
import { BuySheetTab } from "./BuySheetTab";

const PIPELINE_STAGES = [
  { id:"blanks_ordered", label:"Blanks Ordered", pct:10 },
  { id:"blanks_shipped", label:"Blanks Shipped", pct:25 },
  { id:"blanks_received", label:"Blanks Received", pct:40 },
  { id:"strikeoff_approval", label:"Strike-off", pct:55, gate:true },
  { id:"in_production", label:"In Production", pct:75 },
  { id:"shipped", label:"Shipped", pct:100 },
];
const SHIP_STAGES = [
  { id:"allocated", label:"Allocated / Staged", color:"#BA7517" },
  { id:"instation", label:"In ShipStation", color:"#534AB7" },
  { id:"complete", label:"Fulfillment Complete", color:"#3B6D11" },
];
const PHASE_COLORS: Record<string,{bg:string,text:string}> = {
  intake:{bg:"var(--color-background-secondary)",text:"var(--color-text-secondary)"},
  pre_production:{bg:"#EEEDFE",text:"#3C3489"},
  production:{bg:"#E6F1FB",text:"#0C447C"},
  receiving:{bg:"#FAEEDA",text:"#633806"},
  shipping:{bg:"#EAF3DE",text:"#27500A"},
  complete:{bg:"#EAF3DE",text:"#27500A"},
  on_hold:{bg:"#FCEBEB",text:"#791F1F"},
  cancelled:{bg:"var(--color-background-secondary)",text:"var(--color-text-secondary)"},
};
const DECO_COLORS: Record<string,{bg:string,text:string}> = {
  screen_print:{bg:"#E6F1FB",text:"#0C447C"},
  embroidery:{bg:"#EEEDFE",text:"#3C3489"},
  patch:{bg:"#FAEEDA",text:"#633806"},
  cut_sew:{bg:"#E1F5EE",text:"#085041"},
};
const tQty = (q: Record<string,number>) => Object.values(q||{}).reduce((a,v)=>a+v,0);
const getPct = (s: string) => (PIPELINE_STAGES.find(p=>p.id===s)||{pct:0}).pct;

type Item = {
  id: string; job_id: string; name: string; blank_vendor: string|null; blank_sku: string|null;
  drive_link: string|null; incoming_goods: string|null; production_notes_po: string|null; packing_notes: string|null;
  garment_type: string|null; status: string; artwork_status: string; notes: string|null;
  cost_per_unit: number|null; sell_per_unit: number|null; sort_order: number;
  blank_costs: Record<string,number>|null;
  costing_data: Record<string,any>|null;
  costing_summary: {grossRev:number,totalCost:number,netProfit:number,margin:number,avgPerUnit:number,totalQty:number}|null;
  decorator?: string; decoration_type?: string; pipeline_stage?: string;
  sizes?: string[]; qtys?: Record<string,number>;
};
type Payment = { id:string; type:string; amount:number; status:string; due_date:string|null; invoice_number:string|null; };
type Contact = { id:string; name:string; email:string|null; role_label:string|null; role_on_job:string; };
type Job = {
  id:string; title:string; job_type:string; phase:string; priority:string;
  payment_terms:string|null; contract_status:string; notes:string|null;
  target_ship_date:string|null; type_meta:Record<string,string>; job_number:string;
  client_id:string|null; clients?:{name:string}|null;
};

export default function JobDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supabase = createClient();
  const [tab, setTab] = useState("overview");
  const saveCostingRef = useRef<(() => Promise<void>) | null>(null);
  const [job, setJob] = useState<Job|null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [costingSaveStatus, setCostingSaveStatus] = useState("");
  const [rxExp, setRxExp] = useState<Record<string,boolean>>({});
  const [rxData, setRxData] = useState<Record<string,any>>({});
  const [shipStage, setShipStage] = useState<string|null>(null);
  const [shipNotes, setShipNotes] = useState("");

  const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
  const sortSizes = (sizes: string[]) => [...sizes].sort((a,b) => {
    const ai=SIZE_ORDER.indexOf(a), bi=SIZE_ORDER.indexOf(b);
    if(ai===-1&&bi===-1) return a.localeCompare(b);
    if(ai===-1) return 1; if(bi===-1) return -1;
    return ai-bi;
  });

  useEffect(() => {
    loadData();
  }, [params.id]);

  async function loadData() {
    setLoading(true);
    const [jobRes, itemsRes, paymentsRes, contactsRes] = await Promise.all([
      supabase.from("jobs").select("*, clients(name)").eq("id", params.id).single(),
      supabase.from("items").select("*, decorator_assignments(pipeline_stage, decoration_type, decorators(name)), buy_sheet_lines(size, qty_ordered)").eq("job_id", params.id).order("sort_order"),
      supabase.from("payment_records").select("*").eq("job_id", params.id).order("created_at"),
      supabase.from("job_contacts").select("*, contacts(*)").eq("job_id", params.id),
    ]);
    if (jobRes.data) setJob(jobRes.data as Job);
    if (itemsRes.data) {
      const mapped = itemsRes.data.map((it: any) => {
        const lines = it.buy_sheet_lines || [];
        const sizes = sortSizes(lines.map((l: any) => l.size));
        const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
        const assignment = it.decorator_assignments?.[0];
        return {
          ...it,
          sizes, qtys,
          decorator: assignment?.decorators?.name || null,
          decoration_type: assignment?.decoration_type || null,
          pipeline_stage: assignment?.pipeline_stage || "blanks_ordered",
          decorator_assignment_id: assignment?.id || null,
          blankCosts: it.blank_costs || null,
        };
      });
      setItems(mapped);
    }
    if (paymentsRes.data) setPayments(paymentsRes.data as Payment[]);
    if (contactsRes.data) {
      setContacts(contactsRes.data.map((jc: any) => ({
        ...jc.contacts, role_on_job: jc.role_on_job,
      })));
    }
    setLoading(false);
  }

  async function saveJob(updates: Partial<Job>) {
    if (!job) return;
    setSaving(true);
    await supabase.from("jobs").update(updates).eq("id", job.id);
    setJob(j => j ? {...j, ...updates} : j);
    setSaving(false);
  }

  async function saveItem(id: string, updates: Partial<Item>) {
    setItems(prev => prev.map(it => it.id === id ? {...it, ...updates} : it));
    const { cost_per_unit, sell_per_unit, status, artwork_status, name, notes } = updates;
    const dbUpdates: any = {};
    if (cost_per_unit !== undefined) dbUpdates.cost_per_unit = cost_per_unit;
    if ((updates as any).blankCosts !== undefined) dbUpdates.blank_costs = (updates as any).blankCosts || null;
    if (sell_per_unit !== undefined) dbUpdates.sell_per_unit = sell_per_unit;
    if (status !== undefined) dbUpdates.status = status;
    if (artwork_status !== undefined) dbUpdates.artwork_status = artwork_status;
    if (name !== undefined) dbUpdates.name = name;
    if (notes !== undefined) dbUpdates.notes = notes;
    if (Object.keys(dbUpdates).length > 0) {
      await supabase.from("items").update(dbUpdates).eq("id", id);
    }
    if (updates.pipeline_stage !== undefined && updates.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: updates.pipeline_stage }).eq("id", updates.decorator_assignment_id);
    }
    if (updates.qtys) {
      for (const [size, qty] of Object.entries(updates.qtys)) {
        await supabase.from("buy_sheet_lines").upsert({ item_id: id, size, qty_ordered: qty }, { onConflict: "item_id,size" });
      }
    }
  }

  const upd = (k: string, v: any) => { if (!job) return; const u = {...job, [k]:v} as Job; setJob(u); saveJob({[k]:v}); };
  const updItem = (id: string, p: Partial<Item>) => saveItem(id, p);
  const updRx = (id: string, p: any) => setRxData(prev => ({...prev, [id]:{...prev[id],...p}}));
  const updRxNested = (id: string, key: string, sz: string, val: number) =>
    setRxData(prev => ({...prev, [id]:{...prev[id],[key]:{...(prev[id]?.[key]||{}),[sz]:val}}}));

  if (loading) return React.createElement("div", {style:{padding:"2rem",color:"#7a82a0",fontSize:13}}, "Loading...");
  if (!job) return React.createElement("div", {style:{padding:"2rem",color:"#7a82a0",fontSize:13}}, "Job not found.");

  // Use costing_summary if available (set when costing tab is saved), fallback to item calculations
  const cs = job.costing_summary ? (typeof job.costing_summary === 'string' ? JSON.parse(job.costing_summary) : job.costing_summary) : null;
  const totalRev = cs?.grossRev || items.reduce((a,it)=>a+tQty(it.qtys||{})*((it.sell_per_unit)||0),0);
  const totalCost = cs?.totalCost || items.reduce((a,it)=>a+tQty(it.qtys||{})*((it.cost_per_unit)||0),0);
  const totalUnits = items.reduce((a,it)=>a+tQty(it.qtys||{}),0);
  const margin = totalRev>0?((totalRev-totalCost)/totalRev*100):0;
  const totalPaid = payments.filter(p=>p.status==="paid").reduce((a,p)=>a+p.amount,0);
  const totalDue = payments.filter(p=>p.status!=="paid"&&p.status!=="void").reduce((a,p)=>a+p.amount,0);
  const phaseColor = PHASE_COLORS[job.phase]||PHASE_COLORS.intake;
  const daysLeft = job.target_ship_date ? Math.ceil((new Date(job.target_ship_date).getTime()-Date.now())/(1000*60*60*24)) : null;

  const T = {surface:"#181c27",card:"#1e2333",border:"#2a3050",text:"#e8eaf2",muted:"#7a82a0",faint:"#3a4060",accent:"#4f8ef7"};
  const font = `'IBM Plex Sans','Helvetica Neue',Arial,sans-serif`;
  const ic = {width:"100%",padding:"6px 10px",border:`1px solid ${T.border}`,borderRadius:6,background:T.surface,color:T.text,fontSize:"13px",fontFamily:font,boxSizing:"border-box" as const};
  const lc = {fontSize:"12px",color:T.muted,marginBottom:"4px",display:"block"};
  const card = {background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"1rem 1.25rem"};

  return (
    <div style={{fontFamily:"var(--font-sans)",color:"#e8eaf2",maxWidth:1100,margin:"0 auto",paddingBottom:"3rem"}}>
      {/* Back */}
      <button onClick={async ()=>{
        if (tab==="costing" && saveCostingRef.current) {
          try { await saveCostingRef.current(); } catch(e) {
            if (!window.confirm("Costing data could not be auto-saved. Leave anyway?")) return;
          }
        }
        router.push("/jobs");
      }} style={{background:"none",border:"none",color:"#7a82a0",fontSize:12,cursor:"pointer",marginBottom:12,padding:0,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>
        ← All projects
      </button>

      {/* Header */}
      <div style={{marginBottom:"1.5rem"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
              <span style={{fontSize:11,color:"#7a82a0",fontFamily:"'IBM Plex Mono',monospace"}}>{job.job_number}</span>
              <span style={{padding:"2px 9px",borderRadius:99,fontSize:11,fontWeight:600,background:phaseColor.bg,color:phaseColor.text}}>
                {job.phase.replace(/_/g," ")}
              </span>
              {job.priority==="high"&&<span style={{padding:"2px 9px",borderRadius:99,fontSize:11,fontWeight:600,background:"#3d2a08",color:"#f5a623"}}>High priority</span>}
              {job.priority==="urgent"&&<span style={{padding:"2px 9px",borderRadius:99,fontSize:11,fontWeight:600,background:"#3d1212",color:"#f05353"}}>Urgent</span>}
              {saving&&<span style={{fontSize:11,color:"#7a82a0"}}>Saving...</span>}
            </div>
            <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 3px",letterSpacing:"-0.02em",color:"#e8eaf2",fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>{(job.clients as any)?.name||"No client"}</h1>
            <div style={{fontSize:16,color:"#7a82a0",marginBottom:6}}>{job.title}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#7a82a0"}}>
              <span style={{textTransform:"capitalize"}}>{job.job_type}</span>
              <span style={{color:"#3a4060"}}>·</span>
              <span>{totalUnits.toLocaleString()} units</span>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            {daysLeft!==null&&(
              <>
                <div style={{fontSize:22,fontWeight:700,color:daysLeft<0?"#f05353":daysLeft<=3?"#f5a623":"#e8eaf2",fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>
                  {daysLeft<0?Math.abs(daysLeft)+"d overdue":daysLeft===0?"Ships today":daysLeft+"d to ship"}
                </div>
                <div style={{fontSize:12,color:"#7a82a0",marginTop:2}}>
                  {new Date(job.target_ship_date!).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginTop:16}}>
          {[
            {label:"Revenue",value:totalRev>0?"$"+Math.round(totalRev).toLocaleString():totalCost>0?"$"+Math.round(totalCost*1.43).toLocaleString():"—",color:"#4f8ef7"},
            {label:"Cost",value:totalCost>0?"$"+Math.round(totalCost).toLocaleString():"—"},
            {label:"Net profit",value:totalCost>0?"$"+Math.round((totalRev||totalCost*1.43)-totalCost).toLocaleString():"—",color:"#34c97a"},
            {label:"Margin",value:totalCost>0?(((totalRev||totalCost*1.43)-totalCost)/(totalRev||totalCost*1.43)*100).toFixed(1)+"%":"—",color:(()=>{const m=totalCost>0?(((totalRev||totalCost*1.43)-totalCost)/(totalRev||totalCost*1.43)*100):0;return m>=30?"#34c97a":m>=20?"#f5a623":"#f05353";})()},
          ].map(s=>(
            <div key={s.label} style={{background:"#181c27",border:"1px solid #2a3050",borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:12,color:"#7a82a0",marginBottom:4}}>{s.label}</div>
              <div style={{fontSize:16,fontWeight:500,color:(s as any).color||"#e8eaf2",textTransform:(s as any).cap?"capitalize":"none"}}>{s.value}</div>
              {(s as any).sub&&<div style={{fontSize:11,color:"#7a82a0",marginTop:2}}>{(s as any).sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:"1.5rem",padding:4,background:"#181c27",borderRadius:8,width:"fit-content",alignItems:"center"}}>
        {[{id:"overview",label:"Overview"},{id:"buysheet",label:"Buy Sheet"},{id:"costing",label:"Costing"},{id:"quote",label:"Client Quote"},{id:"po",label:"Purchase Order"},{id:"production",label:"Production"},{id:"warehouse",label:"Warehouse"}].map(t=>(
          <button key={t.id} onClick={async ()=>{
            if ((tab==="costing" || tab==="quote") && t.id!=="costing" && t.id!=="quote") {
              if (saveCostingRef.current) {
                try {
                  await saveCostingRef.current();
                } catch(e) {
                  if (!window.confirm("Costing data could not be auto-saved. Leave anyway?")) return;
                }
              }
            }
            setTab(t.id);
          }}
            style={{padding:"7px 16px",fontSize:13,fontWeight:tab===t.id?600:400,background:tab===t.id?"#4f8ef7":"transparent",color:tab===t.id?"#fff":"#7a82a0",border:"none",borderRadius:6,cursor:"pointer",fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>
            {t.label}
          </button>
        ))}
        <span style={{fontSize:11,fontFamily:"IBM Plex Sans,Helvetica Neue,Arial,sans-serif",marginLeft:8,color:costingSaveStatus==="saving"?"#f5a623":costingSaveStatus==="saved"?"#34c97a":"#f05353"}}>{costingSaveStatus==="saving"?"Saving…":costingSaveStatus==="saved"?"Saved ✓":"Unsaved"}</span>
      </div>      {/* OVERVIEW */}
                  {tab==="overview"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>

          {/* Stats */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
            {[
              {label:"Projected revenue",value:totalRev>0?"$"+Math.round(totalRev).toLocaleString():"$"+Math.round(totalCost*1.43).toLocaleString(),color:"#4f8ef7"},
              {label:"Projected cost",value:"$"+Math.round(totalCost).toLocaleString()},
              {label:"Projected profit",value:totalCost>0?"$"+Math.round((totalRev||totalCost*1.43)-totalCost).toLocaleString():"—",color:"#34c97a"},
              {label:"Projected margin",value:totalCost>0?(((totalRev||totalCost*1.43)-totalCost)/(totalRev||totalCost*1.43)*100).toFixed(1)+"%":"—",color:(()=>{const m=totalCost>0?(((totalRev||totalCost*1.43)-totalCost)/(totalRev||totalCost*1.43)*100):0;return m>=30?"#34c97a":m>=20?"#f5a623":"#f05353";})()},
            ].map(s=>(
              <div key={s.label} style={{background:"#1e2333",border:"1px solid #2a3050",borderRadius:8,padding:"8px 12px"}}>
                <div style={{fontSize:10,color:"#7a82a0",marginBottom:2}}>{s.label}</div>
                <div style={{fontSize:15,fontWeight:600,color:s.color||"#e8eaf2"}}>{s.value}</div>
              </div>
            ))}
          </div>


          {/* Two columns */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,alignItems:"start"}}>

            {/* Left */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>

              <div style={{background:"#1e2333",border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:"#7a82a0",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Project info</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  <div><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Client</label>
                    <input style={ic} value={(job.clients as any)?.name||""} readOnly placeholder="No client assigned"/>
                  </div>
                  <div><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Project title</label>
                    <input style={ic} value={job.title} onChange={e=>upd("title",e.target.value)}/>
                  </div>
                  <div><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Type</label>
                    <select style={ic} value={job.job_type} onChange={e=>upd("job_type",e.target.value)}>
                      {["tour","webstore","corporate","brand"].map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Priority</label>
                    <select style={ic} value={job.priority} onChange={e=>upd("priority",e.target.value)}>
                      {["normal","high","urgent"].map(p=><option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Phase</label>
                    <select style={ic} value={job.phase} onChange={e=>upd("phase",e.target.value)}>
                      {["intake","pre_production","production","receiving","shipping","complete","on_hold","cancelled"].map(p=><option key={p} value={p}>{p.replace(/_/g," ")}</option>)}
                    </select>
                  </div>
                  <div><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Contract</label>
                    <select style={ic} value={job.contract_status} onChange={e=>upd("contract_status",e.target.value)}>
                      {["not_sent","sent","signed","waived"].map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
                    </select>
                  </div>
                  <div style={{gridColumn:"1/-1"}}><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Project notes</label>
                    <textarea style={{...ic,minHeight:60,resize:"vertical",lineHeight:1.4}} value={job.notes||""} onChange={e=>upd("notes",e.target.value)}/>
                  </div>
                </div>
              </div>

              <div style={{background:"#1e2333",border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:"#7a82a0",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Payment records</div>
                {payments.length===0&&<p style={{fontSize:12,color:"#7a82a0"}}>No payments recorded yet.</p>}
                {payments.length>0&&(
                  <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
                    <thead><tr style={{borderBottom:"1px solid #2a3050"}}>
                      {["Invoice","Type","Amount","Due","Status"].map(h=><th key={h} style={{textAlign:"left",padding:"3px 6px",color:"#7a82a0",fontWeight:500}}>{h}</th>)}
                    </tr></thead>
                    <tbody>{payments.map(p=>(
                      <tr key={p.id} style={{borderBottom:"1px solid #2a3050"}}>
                        <td style={{padding:"6px",fontFamily:"var(--font-mono)",color:"#7a82a0"}}>{p.invoice_number||"—"}</td>
                        <td style={{padding:"6px",textTransform:"capitalize"}}>{p.type.replace(/_/g," ")}</td>
                        <td style={{padding:"6px",fontWeight:600}}>${p.amount.toLocaleString()}</td>
                        <td style={{padding:"6px",color:"#7a82a0"}}>{p.due_date?new Date(p.due_date).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"—"}</td>
                        <td style={{padding:"6px"}}>
                          <span style={{padding:"1px 7px",borderRadius:99,fontSize:10,fontWeight:600,
                            background:p.status==="paid"?"#0e3d24":p.status==="overdue"?"#3d1212":"#3d2a08",
                            color:p.status==="paid"?"#34c97a":p.status==="overdue"?"#f05353":"#f5a623"}}>{p.status}</span>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>

              <div style={{background:"#1e2333",border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:"#7a82a0",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Activity</div>
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:"#4f8ef7",flexShrink:0,marginTop:4}}/>
                    <div><div style={{fontSize:12}}>Project created</div><div style={{fontSize:10,color:"#7a82a0"}}>{new Date(job.created_at||Date.now()).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div></div>
                  </div>
                  {items.length>0&&(
                    <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:"#34c97a",flexShrink:0,marginTop:4}}/>
                      <div><div style={{fontSize:12}}>{items.length} item{items.length!==1?"s":""} on buy sheet</div><div style={{fontSize:10,color:"#7a82a0"}}>{totalUnits.toLocaleString()} total units</div></div>
                    </div>
                  )}
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:"#3a4060",flexShrink:0}}/>
                    <input style={ic} placeholder="Add a note..."/>
                  </div>
                </div>
              </div>

              {/* Delete project */}
              <button
                onClick={async () => {
                  if (!window.confirm(`Are you sure you want to delete "${job.title}"? This cannot be undone.`)) return;
                  for (const item of items) {
                    await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id);
                    await supabase.from("items").delete().eq("id", item.id);
                  }
                  await supabase.from("jobs").delete().eq("id", params.id);
                  router.push("/jobs");
                }}
                style={{width:"100%",padding:"8px",background:"transparent",border:"1px solid #3d1212",borderRadius:8,color:"#f05353",fontSize:12,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",fontWeight:500,cursor:"pointer",textAlign:"center"}}
                onMouseEnter={e=>(e.currentTarget.style.background="#3d1212")}
                onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                Delete project
              </button>

            </div>

            {/* Right */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>

              <div style={{background:"#1e2333",border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:"#7a82a0",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Contacts</div>
                {contacts.length===0&&<p style={{fontSize:12,color:"#7a82a0"}}>No contacts assigned.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {contacts.map((c,i)=>(
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,paddingBottom:i<contacts.length-1?6:0,borderBottom:i<contacts.length-1?"1px solid #2a3050":"none"}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:"#1e3a6e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:"#4f8ef7",flexShrink:0}}>
                        {c.name.split(" ").map((n:string)=>n[0]).join("").slice(0,2)}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,fontWeight:600}}>{c.name} <span style={{fontWeight:400,color:"#7a82a0",fontSize:11}}>· {c.role_label} · {c.role_on_job}</span></div>
                        {c.email&&<div style={{fontSize:10,color:"#4f8ef7"}}>{c.email}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{background:"#1e2333",border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:"#7a82a0",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Shipping details</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  <div><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Target ship date</label><input style={ic} type="date" value={job.target_ship_date||""} onChange={e=>upd("target_ship_date",e.target.value)}/></div>
                  <div><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>In hands date</label><input style={ic} type="date" value={job.type_meta?.show_date||""} onChange={e=>upd("type_meta",{...job.type_meta,show_date:e.target.value})}/></div>
                  <div style={{gridColumn:"1/-1"}}><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Location name</label><input style={ic} value={job.type_meta?.venue_name||""} onChange={e=>upd("type_meta",{...job.type_meta,venue_name:e.target.value})}/></div>
                  <div style={{gridColumn:"1/-1"}}><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Delivery address</label><input style={ic} value={job.type_meta?.venue_address||""} onChange={e=>upd("type_meta",{...job.type_meta,venue_address:e.target.value})}/></div>
                  <div style={{gridColumn:"1/-1"}}><label style={{fontSize:11,color:"#7a82a0",marginBottom:3,display:"block"}}>Shipping notes</label><input style={ic} value={job.type_meta?.shipping_notes||""} onChange={e=>upd("type_meta",{...job.type_meta,shipping_notes:e.target.value})} placeholder="Carrier, dock info, on-site contact..."/></div>
                </div>
              </div>

              <div style={{background:"#1e2333",border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:600,color:"#7a82a0",textTransform:"uppercase",letterSpacing:"0.07em"}}>Items</div>
                  <span style={{fontSize:10,color:"#7a82a0"}}>{items.length} items · {totalUnits.toLocaleString()} units</span>
                </div>
                {items.length===0&&<p style={{fontSize:12,color:"#7a82a0"}}>No items yet. Add items in the Buy Sheet tab.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {items.map(item=>{
                    const qty=tQty(item.qtys||{});
                    const dc=(item as any).decoration_type;
                    const decoColors: Record<string,{bg:string,text:string}> = {
                      screen_print:{bg:"#1e3a6e",text:"#4f8ef7"},
                      embroidery:{bg:"#2d1f5e",text:"#a78bfa"},
                      patch:{bg:"#3d2a08",text:"#f5a623"},
                    };
                    const deco = dc?decoColors[dc]||decoColors.screen_print:null;
                    return (
                      <div key={item.id} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",background:"#181c27",borderRadius:6}}>
                        <div style={{flex:1,minWidth:0}}>
                          <span style={{fontSize:12,fontWeight:600,color:"#e8eaf2"}}>{item.name}</span>
                          <span style={{fontSize:10,color:"#7a82a0",marginLeft:7}}>{item.blank_vendor} {item.blank_sku}{qty>0?` · ${qty.toLocaleString()} units`:""}</span>
                        </div>
                        <span style={{padding:"1px 7px",borderRadius:99,fontSize:10,fontWeight:600,whiteSpace:"nowrap",
                          background:item.status==="confirmed"?"#0e3d24":"#3d2a08",
                          color:item.status==="confirmed"?"#34c97a":"#f5a623"}}>{item.status}</span>
                        {deco&&<span style={{padding:"1px 7px",borderRadius:99,fontSize:10,fontWeight:600,whiteSpace:"nowrap",background:deco.bg,color:deco.text}}>{dc.replace(/_/g," ")}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* BUYSHEET */}
      {tab==="buysheet"&&(
        <BuySheetTab
          items={items}
          onUpdateItems={async (newItems:any[]) => {
            const deleted = items.filter(i => !newItems.find((ni:any) => ni.id === i.id));
            for (const item of deleted) {
              await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id);
              await supabase.from("items").delete().eq("id", item.id);
            }
            const added = newItems.filter((ni:any) => !items.find(i => i.id === ni.id));
            for (const item of added) {
              const { data } = await supabase.from("items").insert({
                job_id: params.id, name: item.name,
                blank_vendor: item.blank_vendor || null,
                blank_sku: item.blank_sku || null,
                cost_per_unit: item.cost_per_unit || null,
                blank_costs: item.blankCosts && Object.keys(item.blankCosts).length > 0 ? item.blankCosts : null,
                status: "tbd", artwork_status: "not_started", sort_order: items.length,
              }).select("id").single();
              if (data && item.sizes?.length > 0) {
                await supabase.from("buy_sheet_lines").insert(
                  item.sizes.map((sz:string) => ({ item_id: data.id, size: sz, qty_ordered: item.qtys?.[sz] || 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }))
                );
              }
            }
            const updated = newItems.filter((ni:any) => items.find(i => i.id === ni.id));
            for (let idx = 0; idx < updated.length; idx++) {
              const item = updated[idx];
              const newSortOrder = newItems.findIndex((ni:any) => ni.id === item.id);
              await saveItem(item.id, { qtys: item.qtys, cost_per_unit: item.cost_per_unit, name: item.name, sort_order: newSortOrder } as any);
            }
            await loadData();
          }}
        />
      )}

      {/* COSTING */}
            {tab==="costing"&&(
        <CostingTabWrapper
          key={items.map(i=>i.id).join(',')}
          project={job}
          buyItems={items}
          onUpdateBuyItems={setItems}
          onRegisterSave={(fn: () => Promise<void>) => { saveCostingRef.current = fn; }}
          onSaveStatus={(s: string) => setCostingSaveStatus(s)}
          initialTab="calc"
          hideSubTabs={true}
        />
      )}

      {tab==="quote"&&(
        <CostingTabWrapper
          key={"quote-"+items.map(i=>i.id).join(',')}
          project={job}
          buyItems={items}
          onUpdateBuyItems={setItems}
          onRegisterSave={(fn: () => Promise<void>) => { saveCostingRef.current = fn; }}
          onSaveStatus={(s: string) => setCostingSaveStatus(s)}
          initialTab="quote"
          hideSubTabs={true}
        />
      )}
      {tab==="po"&&(
        <POTab
          project={job}
          items={items}
          costingData={job.costing_data}
        />
      )}
      {tab==="production"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {items.length===0&&<div style={{...card,textAlign:"center",color:"#7a82a0",padding:"2rem",fontSize:13}}>No items yet.</div>}
          {items.map(item=>{
            const si=PIPELINE_STAGES.findIndex(s=>s.id===item.pipeline_stage);
            const pct=getPct(item.pipeline_stage||"blanks_ordered");
            const dc=DECO_COLORS[item.decoration_type||"screen_print"]||DECO_COLORS.screen_print;
            return (
              <div key={item.id} style={{...card,padding:0,overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:"1px solid #2a3050"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:13,fontWeight:500}}>{item.name}</span>
                      {item.decoration_type&&<span style={{padding:"1px 7px",borderRadius:6,fontSize:11,fontWeight:500,background:dc.bg,color:dc.text}}>{item.decoration_type.replace(/_/g," ")}</span>}
                      {item.status==="tbd"&&<span style={{padding:"1px 7px",borderRadius:6,fontSize:11,fontWeight:500,background:"#FAEEDA",color:"#633806"}}>TBD</span>}
                    </div>
                    <div style={{fontSize:11,color:"#7a82a0",marginTop:2}}>{item.decorator||"No decorator"} · {tQty(item.qtys||{}).toLocaleString()} units</div>
                  </div>
                  <div style={{fontSize:13,fontWeight:500,color:pct===100?"#3B6D11":"#0C447C"}}>{pct}%</div>
                </div>
                <div style={{height:3,background:"#181c27"}}>
                  <div style={{height:"100%",width:pct+"%",background:pct===100?"#639922":"#378ADD",transition:"width 0.3s"}}/>
                </div>
                <div style={{padding:"10px 14px",display:"flex",gap:6,flexWrap:"wrap"}}>
                  {PIPELINE_STAGES.map((stage,idx)=>{
                    const done=si>=idx, active=item.pipeline_stage===stage.id;
                    return (
                      <button key={stage.id}
                        onClick={()=>{
                          const newStage=stage.gate&&si===idx?PIPELINE_STAGES[idx+1]?.id||stage.id:stage.id;
                          updItem(item.id,{pipeline_stage:newStage,decorator_assignment_id:(item as any).decorator_assignment_id});
                        }}
                        style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:6,fontSize:11,fontWeight:active?500:400,cursor:"pointer",border:"0.5px solid "+(done?"#185FA5":"var(--color-border-tertiary)"),background:active?"#E6F1FB":done?"#E6F1FB66":"transparent",color:done?"#0C447C":"var(--color-text-secondary)"}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:done?"#378ADD":"var(--color-border-secondary)",flexShrink:0}}/>
                        {stage.label}
                        {stage.gate&&active&&<span style={{fontSize:10,background:"#FAEEDA",color:"#854F0B",padding:"1px 5px",borderRadius:6,marginLeft:2}}>Approve</span>}
                      </button>
                    );
                  })}
                </div>
                {item.pipeline_stage==="shipped"&&(
                  <div style={{margin:"0 14px 10px",padding:"8px 12px",background:"#EAF3DE",border:"0.5px solid #C0DD97",borderRadius:6,fontSize:12,color:"#27500A"}}>
                    Handed off to Receiving — log inbound details in the Warehouse tab
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* WAREHOUSE */}
      {tab==="warehouse"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div>
            <div style={{fontSize:11,fontWeight:500,color:"#7a82a0",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Receiving</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {items.filter(it=>it.pipeline_stage==="shipped"||rxData[it.id]).length===0&&(
                <div style={{...card,textAlign:"center",fontSize:13,color:"#7a82a0",padding:"2rem"}}>
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
                        <span style={{fontSize:11,color:"#7a82a0",marginLeft:8}}>{item.blank_sku}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                        {isRxd?<span style={{color:"#3B6D11",fontWeight:500}}>Received {rx.receivedAt}</span>:<span style={{color:"#7a82a0"}}>{ordered.toLocaleString()} expected</span>}
                        {rx.location&&<span style={{background:"#181c27",padding:"1px 7px",borderRadius:6,fontSize:11}}>{rx.location}</span>}
                        <span style={{fontSize:10,color:"#7a82a0"}}>{isExp?"▲":"▼"}</span>
                      </div>
                    </div>
                    {isExp&&(
                      <div style={{borderTop:"0.5px solid var(--color-border-tertiary)",padding:"12px 14px",display:"flex",flexDirection:"column",gap:12}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                          <div><label style={lc}>Carrier</label><input style={ic} value={rx.carrier||""} onChange={e=>updRx(item.id,{carrier:e.target.value})} placeholder="UPS, FedEx..."/></div>
                          <div><label style={lc}>Tracking #</label><input style={ic} value={rx.trackingNum||""} onChange={e=>updRx(item.id,{trackingNum:e.target.value})} placeholder="1Z999AA1..."/></div>
                          <div><label style={lc}>Storage location</label><input style={ic} value={rx.location||""} onChange={e=>updRx(item.id,{location:e.target.value})} placeholder="Rack B, Shelf 3"/></div>
                        </div>
                        <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",border:"1px solid #2a3050"}}>
                          <thead><tr style={{background:"#181c27"}}>
                            {["Size","Ordered","Shipped","Var 1","Received","Var 2"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"center",fontSize:11,fontWeight:500,color:"#7a82a0",borderRight:"0.5px solid var(--color-border-tertiary)"}}>{h}</th>)}
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
                                <td style={{padding:"6px 10px",textAlign:"center",fontFamily:"var(--font-mono)",color:"#7a82a0",borderRight:"0.5px solid var(--color-border-tertiary)"}}>{oq}</td>
                                <td style={{padding:"4px 6px",textAlign:"center",borderRight:"0.5px solid var(--color-border-tertiary)"}}><input type="number" min="0" value={sq??oq} onChange={e=>updRxNested(item.id,"shipped",sz,parseInt(e.target.value)||0)} style={{width:50,textAlign:"center",padding:"3px",border:"1px solid #2a3050",borderRadius:6,background:"var(--color-background-primary)",color:v1!==null&&v1<0?"#A32D2D":"var(--color-text-primary)",fontSize:12,fontFamily:"var(--font-mono)"}}/></td>
                                <td style={{padding:"6px 10px",textAlign:"center",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:500,color:v1===null?"var(--color-text-secondary)":v1<0?"#A32D2D":v1>0?"#3B6D11":"var(--color-text-secondary)",borderRight:"0.5px solid var(--color-border-tertiary)"}}>{v1===null?"—":v1===0?"—":(v1>0?"+":"")+v1}</td>
                                <td style={{padding:"4px 6px",textAlign:"center",borderRight:"0.5px solid var(--color-border-tertiary)"}}><input type="number" min="0" value={rq??(sq??oq)} onChange={e=>updRxNested(item.id,"received",sz,parseInt(e.target.value)||0)} style={{width:50,textAlign:"center",padding:"3px",border:"1px solid #2a3050",borderRadius:6,background:"var(--color-background-primary)",color:v2!==null&&v2<0?"#A32D2D":"var(--color-text-primary)",fontSize:12,fontFamily:"var(--font-mono)"}}/></td>
                                <td style={{padding:"6px 10px",textAlign:"center",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:500,color:v2===null?"var(--color-text-secondary)":v2<0?"#A32D2D":v2>0?"#3B6D11":"var(--color-text-secondary)"}}>{v2===null?"—":v2===0?"—":(v2>0?"+":"")+v2}</td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontSize:12,color:"#7a82a0"}}>Condition:</span>
                          {["Good","Damaged"].map(opt=>(
                            <button key={opt} onClick={()=>updRx(item.id,{condition:opt})} style={{padding:"4px 12px",borderRadius:6,fontSize:12,cursor:"pointer",border:"1px solid #2a3050",background:rx.condition===opt?(opt==="Good"?"#EAF3DE":"#FAEEDA"):"var(--color-background-primary)",color:rx.condition===opt?(opt==="Good"?"#27500A":"#854F0B"):"var(--color-text-secondary)"}}>{opt}</button>
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
            <div style={{fontSize:11,fontWeight:500,color:"#7a82a0",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Shipping</div>
            <div style={{...card,display:"flex",flexDirection:"column",gap:12}}>
              {Object.keys(rxData).length>0&&(
                <div>
                  <div style={{fontSize:12,fontWeight:500,color:"#7a82a0",marginBottom:8}}>Receiving handoff</div>
                  <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                    <thead><tr style={{borderBottom:"1px solid #2a3050"}}>
                      {["Item","Location","Ordered","Received","Status"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:["Ordered","Received"].includes(h)?"center":"left",color:"#7a82a0",fontWeight:500}}>{h}</th>)}
                    </tr></thead>
                    <tbody>{Object.entries(rxData).map(([id,rx]:any)=>{
                      const item=items.find(it=>it.id===id);
                      if(!item)return null;
                      const ord=tQty(item.qtys||{});
                      const rec=Object.values(rx.received||{}).reduce((a:number,v:any)=>a+v,0)||ord;
                      const short=(rec as number)<ord;
                      return (
                        <tr key={id} style={{borderBottom:"1px solid #2a3050"}}>
                          <td style={{padding:"8px 10px",fontWeight:500}}>{item.name}</td>
                          <td style={{padding:"8px 10px",color:"#7a82a0"}}>{rx.location||"—"}</td>
                          <td style={{padding:"8px 10px",textAlign:"center",fontFamily:"var(--font-mono)"}}>{ord}</td>
                          <td style={{padding:"8px 10px",textAlign:"center",fontFamily:"var(--font-mono)",color:short?"#A32D2D":"#3B6D11",fontWeight:500}}>{rec as number}</td>
                          <td style={{padding:"8px 10px"}}>
                            <span style={{padding:"2px 8px",borderRadius:6,fontSize:11,fontWeight:500,background:rx.condition==="Damaged"?"#FAEEDA":short?"#FAEEDA":"#EAF3DE",color:rx.condition==="Damaged"?"#854F0B":short?"#854F0B":"#27500A"}}>
                              {rx.condition==="Damaged"?"Damage":short?((rec as number)-ord)+" short":"OK"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              )}
              <div>
                <div style={{fontSize:12,fontWeight:500,color:"#7a82a0",marginBottom:8}}>Fulfillment status</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                  {SHIP_STAGES.map((stage,idx)=>{
                    const si=SHIP_STAGES.findIndex(s=>s.id===shipStage);
                    const done=si>=idx, active=shipStage===stage.id;
                    return (
                      <button key={stage.id} onClick={()=>setShipStage(stage.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:6,fontSize:12,fontWeight:active?500:400,cursor:"pointer",border:"0.5px solid "+(done?stage.color+"88":"var(--color-border-tertiary)"),background:active?stage.color+"22":done?stage.color+"11":"transparent",color:done?stage.color:"#7a82a0"}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:done?stage.color:"var(--color-border-secondary)"}}/>
                        {stage.label}
                      </button>
                    );
                  })}
                </div>
                <textarea value={shipNotes} onChange={e=>setShipNotes(e.target.value)} placeholder="Internal notes..." style={{...ic,minHeight:60,resize:"vertical",lineHeight:1.5}}/>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
