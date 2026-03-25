"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { CostingTabWrapper } from "./CostingTab";
import { POTab } from "./POTab.jsx";
import { BuySheetTab } from "./BuySheetTab";
import { ProductionTab } from "./ProductionTab";
import { WarehouseTab } from "./WarehouseTab";
import { ArtTab } from "./ArtTab";
import { T, font, sortSizes } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/Skeleton";

function JobSkeleton() {
  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"2rem 0 3rem"}}>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <Skeleton width={100} height={12} style={{marginBottom:16}} />
      <Skeleton width="40%" height={24} style={{marginBottom:8}} />
      <Skeleton width="25%" height={14} style={{marginBottom:32}} />
      <div style={{display:"flex",gap:24}}>
        <div style={{width:140,display:"flex",flexDirection:"column",gap:6}}>
          {Array.from({length:7}).map((_,i)=><Skeleton key={i} height={32} />)}
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:12}}>
          <Skeleton height={120} radius={10} />
          <Skeleton height={180} radius={10} />
          <Skeleton height={100} radius={10} />
        </div>
      </div>
    </div>
  );
}
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
const tQty = (q: Record<string,number>) => Object.values(q||{}).reduce((a,v)=>a+v,0);

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
  const saveBuySheetRef = useRef<(() => Promise<void>) | null>(null);
  const saveCostingRef = useRef<(() => Promise<void>) | null>(null);
  const [job, setJob] = useState<Job|null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<string|null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveErrorTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const handleSaveStatus = useCallback((s: string) => {
    if (s === "error") {
      setSaveError(true);
      if (saveErrorTimer.current) clearTimeout(saveErrorTimer.current);
      saveErrorTimer.current = setTimeout(() => setSaveError(false), 5000);
    } else {
      setSaveError(false);
    }
  }, []);
  const [rxData, setRxData] = useState<Record<string,any>>({});
  const [shipStage, setShipStage] = useState<string|null>(null);
  const [shipNotes, setShipNotes] = useState("");


  useEffect(() => {
    loadData();
  }, [params.id]);

  async function loadData() {
    setLoading(true);
    const [jobRes, itemsRes, paymentsRes, contactsRes] = await Promise.all([
      supabase.from("jobs").select("*, clients(name)").eq("id", params.id).single(),
      supabase.from("items").select("*, decorator_assignments(pipeline_stage, decoration_type, decorators(name)), buy_sheet_lines(size, qty_ordered, qty_shipped_from_vendor, qty_received_at_hpd)").eq("job_id", params.id).order("sort_order"),
      supabase.from("payment_records").select("*").eq("job_id", params.id).order("created_at"),
      supabase.from("job_contacts").select("*, contacts(*)").eq("job_id", params.id),
    ]);
    if (jobRes.data) {
      setJob(jobRes.data as Job);
      const meta = jobRes.data.type_meta || {};
      if (meta.ship_stage) setShipStage(meta.ship_stage);
      if (meta.ship_notes) setShipNotes(meta.ship_notes);
    }
    if (itemsRes.data) {
      const rxInit: Record<string,any> = {};
      const mapped = itemsRes.data.map((it: any) => {
        const lines = it.buy_sheet_lines || [];
        const sizes = sortSizes(lines.map((l: any) => l.size));
        const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
        const assignment = it.decorator_assignments?.[0];
        // Hydrate receiving data from DB
        if (it.receiving_data) {
          rxInit[it.id] = it.receiving_data;
        } else {
          // Check if any buy_sheet_lines have shipped/received qtys
          const hasRxData = lines.some((l: any) => (l.qty_shipped_from_vendor || 0) > 0 || (l.qty_received_at_hpd || 0) > 0);
          if (hasRxData) {
            rxInit[it.id] = {
              shipped: Object.fromEntries(lines.map((l: any) => [l.size, l.qty_shipped_from_vendor || 0])),
              received: Object.fromEntries(lines.map((l: any) => [l.size, l.qty_received_at_hpd || 0])),
            };
          }
        }
        return {
          ...it,
          sizes, qtys,
          decorator: assignment?.decorators?.name || null,
          decoration_type: assignment?.decoration_type || null,
          pipeline_stage: it.pipeline_stage || assignment?.pipeline_stage || "blanks_ordered",
          decorator_assignment_id: assignment?.id || null,
          blankCosts: it.blank_costs || null,
          pipeline_timestamps: it.pipeline_timestamps || {},
        };
      });
      setItems(mapped);
      if (Object.keys(rxInit).length > 0) setRxData(rxInit);
    }
    if (paymentsRes.data) setPayments(paymentsRes.data as Payment[]);
    if (contactsRes.data) {
      setContacts(contactsRes.data.map((jc: any) => ({
        ...jc.contacts, role_on_job: jc.role_on_job,
      })));
    }
    setLoading(false);
    initialLoadDone.current = true;
  }

  const jobSaveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  function saveJob(updates: Partial<Job>) {
    if (!job) return;
    // Debounce DB write — local state already updated by upd()
    if (jobSaveTimer.current) clearTimeout(jobSaveTimer.current);
    jobSaveTimer.current = setTimeout(async () => {
      await supabase.from("jobs").update(updates).eq("id", job.id);
    }, 800);
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
    if (updates.pipeline_stage !== undefined) {
      dbUpdates.pipeline_stage = updates.pipeline_stage;
      // Record timestamp for this stage transition
      const existing = items.find(it => it.id === id);
      const timestamps = (existing as any)?.pipeline_timestamps || {};
      timestamps[updates.pipeline_stage] = new Date().toISOString();
      dbUpdates.pipeline_timestamps = timestamps;
      setItems(prev => prev.map(it => it.id === id ? {...it, pipeline_timestamps: timestamps} : it));
    }
    if (Object.keys(dbUpdates).length > 0) {
      await supabase.from("items").update(dbUpdates).eq("id", id);
    }
    if (updates.pipeline_stage !== undefined && (updates as any).decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: updates.pipeline_stage }).eq("id", (updates as any).decorator_assignment_id);
    }
    if (updates.qtys) {
      for (const [size, qty] of Object.entries(updates.qtys)) {
        await supabase.from("buy_sheet_lines").upsert({ item_id: id, size, qty_ordered: qty }, { onConflict: "item_id,size" });
      }
    }
  }

  const upd = (k: string, v: any) => { if (!job) return; const u = {...job, [k]:v} as Job; setJob(u); saveJob({[k]:v}); };
  const updItem = (id: string, p: Partial<Item>) => saveItem(id, p);

  if (loading && !initialLoadDone.current) return React.createElement(JobSkeleton, null);
  if (!job) return React.createElement("div", {style:{padding:"2rem",color:T.muted,fontSize:13}}, "Project not found.");

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

  const ic = {width:"100%",padding:"6px 10px",border:`1px solid ${T.border}`,borderRadius:6,background:T.surface,color:T.text,fontSize:"13px",fontFamily:font,boxSizing:"border-box" as const};
  const lc = {fontSize:"12px",color:T.muted,marginBottom:"4px",display:"block"};
  const card = {background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"1rem 1.25rem"};

  return (
    <div style={{fontFamily:"var(--font-sans)",color:T.text,maxWidth:1100,margin:"0 auto",paddingBottom:"3rem"}}>
      {/* Back */}
      <button onClick={async ()=>{
        if (tab==="costing" && saveCostingRef.current) {
          try { await saveCostingRef.current(); } catch(e) {
            if (!window.confirm("Costing data could not be auto-saved. Leave anyway?")) return;
          }
        }
        router.push("/jobs");
      }} style={{background:"none",border:"none",color:T.muted,fontSize:12,cursor:"pointer",marginBottom:12,padding:0,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>
        ← All projects
      </button>

      {/* Header */}
      <div style={{marginBottom:"1.5rem"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
              <span style={{fontSize:11,color:T.muted,fontFamily:"'IBM Plex Mono',monospace"}}>{job.job_number}</span>
              <span style={{padding:"2px 9px",borderRadius:99,fontSize:11,fontWeight:600,background:phaseColor.bg,color:phaseColor.text}}>
                {job.phase.replace(/_/g," ")}
              </span>
              {job.priority==="high"&&<span style={{padding:"2px 9px",borderRadius:99,fontSize:11,fontWeight:600,background:"#3d2a08",color:"#f5a623"}}>High priority</span>}
              {job.priority==="urgent"&&<span style={{padding:"2px 9px",borderRadius:99,fontSize:11,fontWeight:600,background:"#3d1212",color:"#f05353"}}>Urgent</span>}
              {saving&&<span style={{fontSize:11,color:T.muted}}>Saving...</span>}
            </div>
            <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 3px",letterSpacing:"-0.02em",color:T.text,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>{(job.clients as any)?.name||"No client"}</h1>
            <div style={{fontSize:16,color:T.muted,marginBottom:6}}>{job.title}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.muted}}>
              <span style={{textTransform:"capitalize"}}>{job.job_type}</span>
              <span style={{color:T.faint}}>·</span>
              <span>{totalUnits.toLocaleString()} units</span>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
            <button onClick={async()=>{
              if(!window.confirm(`Duplicate "${job.title}" with all items and costing?`)) return;
              const {data:newJob}=await supabase.from("jobs").insert({
                title:job.title+" (Copy)",job_type:job.job_type,phase:"intake",priority:job.priority,
                payment_terms:job.payment_terms,target_ship_date:null,
                type_meta:job.type_meta||{},notes:job.notes,client_id:job.client_id,job_number:"",
                costing_data:job.costing_data||null,costing_summary:job.costing_summary||null,
              }).select("id").single();
              if(!newJob) return;
              // Copy items + buy sheet lines
              const idMap:Record<string,string>={};
              for(const item of items){
                const {data:ni}=await supabase.from("items").insert({
                  job_id:newJob.id,name:item.name,blank_vendor:item.blank_vendor,blank_sku:item.blank_sku,
                  cost_per_unit:item.cost_per_unit,sell_per_unit:item.sell_per_unit,status:"tbd",
                  artwork_status:"not_started",sort_order:item.sort_order,blank_costs:item.blankCosts||null,
                }).select("id").single();
                if(ni){
                  idMap[item.id]=ni.id;
                  if(item.sizes?.length){
                    await supabase.from("buy_sheet_lines").insert(
                      item.sizes.map((sz:string)=>({item_id:ni.id,size:sz,qty_ordered:item.qtys?.[sz]||0,qty_shipped_from_vendor:0,qty_received_at_hpd:0,qty_shipped_to_customer:0}))
                    );
                  }
                }
              }
              // Remap costing_data item IDs
              if(newJob && job.costing_data?.costProds){
                const remapped=job.costing_data.costProds.map((cp:any)=>({...cp,id:idMap[cp.id]||cp.id}));
                await supabase.from("jobs").update({costing_data:{...job.costing_data,costProds:remapped}}).eq("id",newJob.id);
              }
              // Copy contacts
              for(const c of contacts){
                await supabase.from("job_contacts").insert({job_id:newJob.id,contact_id:c.id,role_on_job:c.role_on_job});
              }
              router.push(`/jobs/${newJob.id}`);
            }} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,fontSize:11,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",padding:"5px 12px",cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.color=T.text}
              onMouseLeave={e=>e.currentTarget.style.color=T.muted}>
              Duplicate project
            </button>
            {daysLeft!==null&&(
              <>
                <div style={{fontSize:22,fontWeight:700,color:daysLeft<0?"#f05353":daysLeft<=3?"#f5a623":T.text,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>
                  {daysLeft<0?Math.abs(daysLeft)+"d overdue":daysLeft===0?"Ships today":daysLeft+"d to ship"}
                </div>
                <div style={{fontSize:12,color:T.muted,marginTop:2}}>
                  {new Date(job.target_ship_date!).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginTop:16}}>
          {[
            {label:"Revenue",value:totalRev>0?"$"+Math.round(totalRev).toLocaleString():totalCost>0?"$"+Math.round(totalCost*1.43).toLocaleString():"—",color:T.accent},
            {label:"Cost",value:totalCost>0?"$"+Math.round(totalCost).toLocaleString():"—"},
            {label:"Net profit",value:totalCost>0?"$"+Math.round((totalRev||totalCost*1.43)-totalCost).toLocaleString():"—",color:"#34c97a"},
            {label:"Margin",value:totalCost>0?(((totalRev||totalCost*1.43)-totalCost)/(totalRev||totalCost*1.43)*100).toFixed(1)+"%":"—",color:(()=>{const m=totalCost>0?(((totalRev||totalCost*1.43)-totalCost)/(totalRev||totalCost*1.43)*100):0;return m>=30?"#34c97a":m>=20?"#f5a623":"#f05353";})()},
          ].map(s=>(
            <div key={s.label} style={{background:T.surface,border:"1px solid #2a3050",borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:12,color:T.muted,marginBottom:4}}>{s.label}</div>
              <div style={{fontSize:16,fontWeight:500,color:(s as any).color||T.text,textTransform:(s as any).cap?"capitalize":"none"}}>{s.value}</div>
              {(s as any).sub&&<div style={{fontSize:11,color:T.muted,marginTop:2}}>{(s as any).sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Layout: vertical tab nav + content */}
      <div style={{display:"flex",gap:20}}>
        {/* Vertical tab nav */}
        <div style={{width:160,flexShrink:0}}>
          <div style={{position:"sticky",top:16,display:"flex",flexDirection:"column",gap:2,padding:4,background:T.surface,borderRadius:8}}>
            {[{id:"overview",label:"Overview"},{id:"buysheet",label:"Buy Sheet"},{id:"art",label:"Art Files"},{id:"costing",label:"Costing"},{id:"quote",label:"Client Quote"},{id:"po",label:"Purchase Order"},{id:"production",label:"Production"},{id:"warehouse",label:"Warehouse"}].map(t=>(
              <button key={t.id} onClick={async ()=>{
                if (tab==="buysheet" && t.id!=="buysheet" && saveBuySheetRef.current) { try { await saveBuySheetRef.current(); } catch(e) {} }
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
                style={{padding:"7px 12px",fontSize:13,fontWeight:tab===t.id?600:400,background:tab===t.id?T.accent:"transparent",color:tab===t.id?"#fff":T.muted,border:"none",borderRadius:6,cursor:"pointer",fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",textAlign:"left",width:"100%"}}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div style={{flex:1,minWidth:0}}>
      {/* OVERVIEW */}
                  {tab==="overview"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>

          {/* Two columns */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,alignItems:"start"}}>

            {/* Left */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>

              <div style={{background:T.card,border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Project info</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Client</label>
                    <input style={ic} value={(job.clients as any)?.name||""} readOnly placeholder="No client assigned"/>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Project title</label>
                    <input style={ic} value={job.title} onChange={e=>upd("title",e.target.value)}/>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Type</label>
                    <select style={ic} value={job.job_type} onChange={e=>upd("job_type",e.target.value)}>
                      {["tour","webstore","drop_ship"].map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
                    </select>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Priority</label>
                    <select style={ic} value={job.priority} onChange={e=>upd("priority",e.target.value)}>
                      {["normal","high","urgent"].map(p=><option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Phase</label>
                    <select style={ic} value={job.phase} onChange={e=>upd("phase",e.target.value)}>
                      {["intake","pre_production","production","receiving","shipping","complete","on_hold","cancelled"].map(p=><option key={p} value={p}>{p.replace(/_/g," ")}</option>)}
                    </select>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Contract</label>
                    <select style={ic} value={job.contract_status} onChange={e=>upd("contract_status",e.target.value)}>
                      {["not_sent","sent","signed","waived"].map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
                    </select>
                  </div>
                  <div style={{gridColumn:"1/-1"}}><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Project notes</label>
                    <textarea style={{...ic,minHeight:60,resize:"vertical",lineHeight:1.4}} value={job.notes||""} onChange={e=>upd("notes",e.target.value)}/>
                  </div>
                </div>
              </div>

              <div style={{background:T.card,border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Payment records</div>
                  <button onClick={()=>setJob(j=>j?{...j,_addPayment:!(j as any)._addPayment} as any:j)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:10,padding:"2px 8px",cursor:"pointer"}}>+ Add</button>
                </div>
                {(job as any)._addPayment&&(
                  <div style={{background:T.surface,border:`1px solid ${T.accent}44`,borderRadius:8,padding:10,marginBottom:8}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:6}}>
                      <select id="pm-type" style={ic}>
                        <option value="deposit">Deposit</option>
                        <option value="balance">Balance</option>
                        <option value="full_payment">Full Payment</option>
                        <option value="refund">Refund</option>
                      </select>
                      <input id="pm-amount" type="text" inputMode="decimal" placeholder="Amount" style={ic}/>
                      <input id="pm-invoice" placeholder="Invoice #" style={ic}/>
                      <input id="pm-due" type="date" style={ic}/>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={async()=>{
                        const type=(document.getElementById("pm-type") as HTMLSelectElement).value;
                        const amount=parseFloat((document.getElementById("pm-amount") as HTMLInputElement).value)||0;
                        if(!amount) return;
                        const invoice_number=(document.getElementById("pm-invoice") as HTMLInputElement).value.trim()||null;
                        const due_date=(document.getElementById("pm-due") as HTMLInputElement).value||null;
                        await supabase.from("payment_records").insert({job_id:job.id,type,amount,invoice_number,due_date,status:"draft"});
                        setJob(j=>j?{...j,_addPayment:false} as any:j);
                        loadData();
                      }} style={{background:T.green,border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:600,padding:"5px 12px",cursor:"pointer"}}>Save</button>
                      <button onClick={()=>setJob(j=>j?{...j,_addPayment:false} as any:j)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:11,padding:"5px 10px",cursor:"pointer"}}>Cancel</button>
                    </div>
                  </div>
                )}
                {payments.length===0&&!(job as any)._addPayment&&<p style={{fontSize:12,color:T.muted}}>No payments recorded yet.</p>}
                {payments.length>0&&(
                  <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
                    <thead><tr style={{borderBottom:"1px solid #2a3050"}}>
                      {["Invoice","Type","Amount","Due","Status",""].map(h=><th key={h} style={{textAlign:"left",padding:"3px 6px",color:T.muted,fontWeight:500}}>{h}</th>)}
                    </tr></thead>
                    <tbody>{payments.map(p=>{
                      const statuses=["draft","sent","viewed","partial","paid","overdue","void"];
                      const nextStatus=()=>{const idx=statuses.indexOf(p.status);return statuses[(idx+1)%statuses.length];};
                      return(
                      <tr key={p.id} style={{borderBottom:"1px solid #2a3050"}}>
                        <td style={{padding:"6px",fontFamily:"var(--font-mono)",color:T.muted}}>{p.invoice_number||"—"}</td>
                        <td style={{padding:"6px",textTransform:"capitalize"}}>{p.type.replace(/_/g," ")}</td>
                        <td style={{padding:"6px",fontWeight:600}}>${p.amount.toLocaleString()}</td>
                        <td style={{padding:"6px",color:T.muted}}>{p.due_date?new Date(p.due_date).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"—"}</td>
                        <td style={{padding:"6px"}}>
                          <button onClick={async()=>{
                            const ns=nextStatus();
                            await supabase.from("payment_records").update({status:ns,paid_date:ns==="paid"?new Date().toISOString().split("T")[0]:null}).eq("id",p.id);
                            loadData();
                          }} style={{padding:"1px 7px",borderRadius:99,fontSize:10,fontWeight:600,border:"none",cursor:"pointer",
                            background:p.status==="paid"?"#0e3d24":p.status==="overdue"?"#3d1212":"#3d2a08",
                            color:p.status==="paid"?"#34c97a":p.status==="overdue"?"#f05353":"#f5a623"}}>{p.status}</button>
                        </td>
                        <td style={{padding:"6px"}}>
                          <button onClick={()=>setConfirmDeletePayment(p.id)} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:11}}
                            onMouseEnter={e=>e.currentTarget.style.color=T.red}
                            onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                        </td>
                      </tr>);
                    })}</tbody>
                  </table>
                )}
              </div>

              <div style={{background:T.card,border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Activity</div>
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:T.accent,flexShrink:0,marginTop:4}}/>
                    <div><div style={{fontSize:12}}>Project created</div><div style={{fontSize:10,color:T.muted}}>{new Date(job.created_at||Date.now()).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div></div>
                  </div>
                  {items.length>0&&(
                    <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:"#34c97a",flexShrink:0,marginTop:4}}/>
                      <div><div style={{fontSize:12}}>{items.length} item{items.length!==1?"s":""} on buy sheet</div><div style={{fontSize:10,color:T.muted}}>{totalUnits.toLocaleString()} total units</div></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Delete project */}
              <button
                onClick={() => setConfirmDeleteProject(true)}
                style={{width:"100%",padding:"8px",background:"transparent",border:"1px solid #3d1212",borderRadius:8,color:"#f05353",fontSize:12,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",fontWeight:500,cursor:"pointer",textAlign:"center"}}
                onMouseEnter={e=>(e.currentTarget.style.background="#3d1212")}
                onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                Delete project
              </button>

            </div>

            {/* Right */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>

              <div style={{background:T.card,border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Contacts</div>
                  <button onClick={()=>setJob(j=>j?{...j,_addContact:!(j as any)._addContact} as any:j)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:10,padding:"2px 8px",cursor:"pointer"}}>+ Add</button>
                </div>
                {(job as any)._addContact&&(
                  <div style={{background:T.surface,border:`1px solid ${T.accent}44`,borderRadius:8,padding:10,marginBottom:8}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                      <input id="ct-name" placeholder="Name" style={ic}/>
                      <input id="ct-email" placeholder="Email" style={ic}/>
                      <input id="ct-phone" placeholder="Phone" style={ic}/>
                      <select id="ct-role" style={ic}>
                        <option value="primary">Primary</option>
                        <option value="billing">Billing</option>
                        <option value="creative">Creative</option>
                        <option value="logistics">Logistics</option>
                        <option value="cc">CC</option>
                      </select>
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={async()=>{
                        const name=(document.getElementById("ct-name") as HTMLInputElement).value.trim();
                        if(!name) return;
                        const email=(document.getElementById("ct-email") as HTMLInputElement).value.trim();
                        const phone=(document.getElementById("ct-phone") as HTMLInputElement).value.trim();
                        const role=(document.getElementById("ct-role") as HTMLSelectElement).value;
                        // Check for duplicate on this job
                        if(email && contacts.some(c=>c.email?.toLowerCase()===email.toLowerCase())){
                          alert(`${email} is already on this project.`);
                          return;
                        }
                        // Find or create contact
                        let contactId:string;
                        if(email){
                          const {data:existing}=await supabase.from("contacts").select("id").eq("email",email).single();
                          if(existing) contactId=existing.id;
                          else {const {data:nc}=await supabase.from("contacts").insert({name,email,phone:phone||null,client_id:job.client_id}).select("id").single();contactId=nc!.id;}
                        } else {
                          const {data:nc}=await supabase.from("contacts").insert({name,email:null,phone:phone||null,client_id:job.client_id}).select("id").single();contactId=nc!.id;
                        }
                        await supabase.from("job_contacts").insert({job_id:job.id,contact_id:contactId,role_on_job:role});
                        setJob(j=>j?{...j,_addContact:false} as any:j);
                        loadData();
                      }} style={{background:T.green,border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:600,padding:"5px 12px",cursor:"pointer"}}>Save</button>
                      <button onClick={()=>setJob(j=>j?{...j,_addContact:false} as any:j)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:11,padding:"5px 10px",cursor:"pointer"}}>Cancel</button>
                    </div>
                  </div>
                )}
                {contacts.length===0&&!(job as any)._addContact&&<p style={{fontSize:12,color:T.muted}}>No contacts assigned.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {contacts.map((c,i)=>(
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,paddingBottom:i<contacts.length-1?6:0,borderBottom:i<contacts.length-1?"1px solid #2a3050":"none"}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:"#1e3a6e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:T.accent,flexShrink:0}}>
                        {c.name.split(" ").map((n:string)=>n[0]).join("").slice(0,2)}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,fontWeight:600}}>{c.name} <span style={{fontWeight:400,color:T.muted,fontSize:11}}>· {c.role_label} · {c.role_on_job}</span></div>
                        {c.email&&<div style={{fontSize:10,color:T.accent}}>{c.email}</div>}
                      </div>
                      <button onClick={async()=>{
                        await supabase.from("job_contacts").delete().eq("job_id",job.id).eq("contact_id",c.id);
                        loadData();
                      }} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:11,padding:"0 2px"}}
                        onMouseEnter={e=>e.currentTarget.style.color=T.red}
                        onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{background:T.card,border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Shipping details</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Target ship date</label><input style={ic} type="date" value={job.target_ship_date||""} onChange={e=>{
                    upd("target_ship_date",e.target.value);
                    // Auto-suggest in-hands = ship date + 3 days if not already set
                    const inHands = job.type_meta?.in_hands_date || job.type_meta?.show_date;
                    if(!inHands && e.target.value){
                      const d=new Date(e.target.value); d.setDate(d.getDate()+3);
                      const ih=d.toISOString().split("T")[0];
                      upd("type_meta",{...job.type_meta,in_hands_date:ih});
                    }
                  }}/></div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>In hands date</label><input style={ic} type="date" value={job.type_meta?.in_hands_date||job.type_meta?.show_date||""} onChange={e=>upd("type_meta",{...job.type_meta,in_hands_date:e.target.value})}/></div>
                  <div style={{gridColumn:"1/-1"}}><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Location name</label><input style={ic} value={job.type_meta?.venue_name||""} onChange={e=>upd("type_meta",{...job.type_meta,venue_name:e.target.value})}/></div>
                  <div style={{gridColumn:"1/-1"}}><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Delivery address</label><input style={ic} value={job.type_meta?.venue_address||""} onChange={e=>upd("type_meta",{...job.type_meta,venue_address:e.target.value})}/></div>
                  <div style={{gridColumn:"1/-1"}}><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Shipping notes</label><input style={ic} value={job.type_meta?.shipping_notes||""} onChange={e=>upd("type_meta",{...job.type_meta,shipping_notes:e.target.value})} placeholder="Carrier, dock info, on-site contact..."/></div>
                </div>
              </div>

              <div style={{background:T.card,border:"1px solid #2a3050",borderRadius:10,padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Items</div>
                  <span style={{fontSize:10,color:T.muted}}>{items.length} items · {totalUnits.toLocaleString()} units</span>
                </div>
                {items.length===0&&<p style={{fontSize:12,color:T.muted}}>No items yet. Add items in the Buy Sheet tab.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {items.map(item=>{
                    const qty=tQty(item.qtys||{});
                    const dc=(item as any).decoration_type;
                    const decoColors: Record<string,{bg:string,text:string}> = {
                      screen_print:{bg:"#1e3a6e",text:T.accent},
                      embroidery:{bg:"#2d1f5e",text:"#a78bfa"},
                      patch:{bg:"#3d2a08",text:"#f5a623"},
                    };
                    const deco = dc?decoColors[dc]||decoColors.screen_print:null;
                    return (
                      <div key={item.id} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",background:T.surface,borderRadius:6}}>
                        <div style={{flex:1,minWidth:0}}>
                          <span style={{fontSize:12,fontWeight:600,color:T.text}}>{item.name}</span>
                          <span style={{fontSize:10,color:T.muted,marginLeft:7}}>{item.blank_vendor} {item.blank_sku}{qty>0?` · ${qty.toLocaleString()} units`:""}</span>
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
      {tab==="art"&&(
        <ArtTab project={job} items={items} />
      )}
      {tab==="buysheet"&&(
        <BuySheetTab
          items={items}
          jobId={params.id}
          onRegisterSave={(fn: () => Promise<void>) => { saveBuySheetRef.current = fn; }}
          onSaveStatus={(s: string) => handleSaveStatus(s)}
          onSaved={(resolved: any[]) => {
            // Optimistic update — no loadData() call, no flash
            const mapped = resolved.map((it: any) => ({
              ...it,
              sizes: it.sizes || [],
              qtys: it.qtys || {},
              totalQty: it.totalQty || Object.values(it.qtys || {}).reduce((a: number, v: number) => a + v, 0),
            }));
            setItems(mapped);
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
          onSaveStatus={(s: string) => handleSaveStatus(s)}
          onSaved={(data: any) => setJob(j => j ? {...j, ...data} : j)}
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
          onSaveStatus={(s: string) => handleSaveStatus(s)}
          onSaved={(data: any) => setJob(j => j ? {...j, ...data} : j)}
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
        <ProductionTab items={items} onUpdateItem={updItem} />
      )}

      {tab==="warehouse"&&(
        <WarehouseTab
          items={items}
          job={job}
          rxData={rxData}
          shipStage={shipStage}
          shipNotes={shipNotes}
          onRxDataChange={(next: Record<string,any>) => setRxData(next)}
          onShipChange={(stage: string|null, notes: string) => {
            setShipStage(stage);
            setShipNotes(notes);
            setJob(j => j ? {...j, type_meta: {...(j.type_meta||{}), ship_stage: stage, ship_notes: notes}} : j);
          }}
        />
      )}
        </div>{/* end tab content */}
      </div>{/* end flex layout */}

      {/* Error-only save indicator */}
      {saveError && (
        <div style={{
          position:"fixed", bottom:20, right:20, zIndex:100,
          padding:"8px 16px", borderRadius:8,
          background:T.redDim, border:`1px solid ${T.red}`,
          color:T.red, fontSize:12, fontWeight:600, fontFamily:font,
        }}>
          Save failed — check your connection
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeletePayment}
        title="Delete payment"
        message="This will permanently remove this payment record."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmDeletePayment) return;
          await supabase.from("payment_records").delete().eq("id", confirmDeletePayment);
          setConfirmDeletePayment(null);
          loadData();
        }}
        onCancel={() => setConfirmDeletePayment(null)}
      />

      <ConfirmDialog
        open={confirmDeleteProject}
        title="Delete project"
        message={`Are you sure you want to delete "${job?.title}"? This will remove all items, payments, and contacts. This cannot be undone.`}
        confirmLabel="Delete project"
        onConfirm={async () => {
          for (const item of items) {
            await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id);
            await supabase.from("decorator_assignments").delete().eq("item_id", item.id);
            await supabase.from("items").delete().eq("id", item.id);
          }
          await supabase.from("payment_records").delete().eq("job_id", params.id);
          await supabase.from("job_contacts").delete().eq("job_id", params.id);
          await supabase.from("jobs").delete().eq("id", params.id);
          router.push("/jobs");
        }}
        onCancel={() => setConfirmDeleteProject(false)}
      />
    </div>
  );
}
