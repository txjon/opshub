"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { CostingTabWrapper } from "./CostingTab";
import { POTab } from "./POTab.jsx";
import { BlanksTab } from "./BlanksTab";
import { PaymentTab } from "./PaymentTab";
import { ApprovalsTab } from "./ApprovalsTab";
import { DocumentsTab } from "./DocumentsTab";
import { useIsMobile } from "@/lib/useIsMobile";
import { EmailThread } from "@/components/EmailThread";
import { ProductBuilder } from "./ProductBuilder";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/Skeleton";
import { ProjectProgress } from "@/components/ProjectProgress";
import { PdfPreviewModal } from "@/components/PdfPreviewModal";
import { JobActivityPanel, logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { calculatePhase } from "@/lib/lifecycle";
import { calculatePriority, businessDaysFromNow } from "@/lib/dates";
import { appBaseUrl } from "@/lib/public-url";

function JobSkeleton() {
  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"2rem 0 3rem"}}>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <Skeleton width={100} height={12} style={{marginBottom:16}} />
      <Skeleton width="40%" height={24} style={{marginBottom:8}} />
      <Skeleton width="25%" height={14} style={{marginBottom:32}} />
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {Array.from({length:8}).map((_,i)=><Skeleton key={i} width={90} height={32} radius={6} />)}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Skeleton height={120} radius={10} />
        <Skeleton height={180} radius={10} />
        <Skeleton height={100} radius={10} />
      </div>
    </div>
  );
}
const PHASE_COLORS: Record<string,{bg:string,text:string}> = {
  intake:{bg:T.accentDim,text:T.accent},
  pending:{bg:T.amberDim,text:"#a07008"},
  ready:{bg:T.amberDim,text:"#a07008"},
  pre_production:{bg:T.blueDim,text:"#3a8a9e"},
  production:{bg:T.blueDim,text:"#3a8a9e"},
  receiving:{bg:T.blueDim,text:"#3a8a9e"},
  shipping:{bg:T.blueDim,text:"#3a8a9e"},
  fulfillment:{bg:T.purpleDim,text:"#c4207a"},
  shipped:{bg:T.greenDim,text:"#2a9e5c"},
  complete:{bg:T.greenDim,text:"#2a9e5c"},
  on_hold:{bg:T.redDim,text:T.red},
  cancelled:{bg:T.accentDim,text:T.muted},
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
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("tab");
      if (p) return p;
    }
    return "overview";
  });

  // useState initializer doesn't re-read on hydration (window is undefined
  // on SSR), so deep-links like /jobs/{id}?tab=proofs would otherwise land
  // on overview. Sync tab from the URL once on mount.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    if (p && p !== tab) setTab(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveBuySheetRef = useRef<(() => Promise<void>) | null>(null);
  const saveCostingRef = useRef<(() => Promise<void>) | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const autoSelectedRef = useRef(false);
  const [job, setJob] = useState<Job|null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<string|null>(null);
  const [pdfPreview, setPdfPreview] = useState<{src:string;title:string;downloadHref:string}|null>(null);
  const [showArtFiles, setShowArtFiles] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [teamProfiles, setTeamProfiles] = useState<Record<string,string>>({});
  const [proofStatus, setProofStatus] = useState<Record<string,{allApproved:boolean}>>({});
  const [allClients, setAllClients] = useState<{id:string,name:string}[]>([]);
  const [clientQuery, setClientQuery] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [portalCopied, setPortalCopied] = useState(false);
  const saveErrorTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const saveOkTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const handleSaveStatus = useCallback((s: string) => {
    if (s === "error") {
      setSaveError(true);
      setSaveOk(false);
      if (saveErrorTimer.current) clearTimeout(saveErrorTimer.current);
      saveErrorTimer.current = setTimeout(() => setSaveError(false), 5000);
    } else if (s === "saved") {
      setSaveError(false);
      setSaveOk(true);
      if (saveOkTimer.current) clearTimeout(saveOkTimer.current);
      saveOkTimer.current = setTimeout(() => setSaveOk(false), 1500);
    } else {
      setSaveError(false);
    }
  }, []);


  useEffect(() => {
    loadData();
    supabase.auth.getUser().then(({data:{user}})=>{ if(user) setCurrentUserId(user.id); });
    supabase.from("clients").select("id, name").order("name").then(({data})=>setAllClients(data||[]));
    supabase.from("profiles").select("id, full_name").then(({data})=>{
      const map: Record<string,string>={};
      (data||[]).forEach((p:any)=>{ map[p.id]=p.full_name||"Team"; });
      setTeamProfiles(map);
    });
  }, [params.id]);

  // Light reload — just items, doesn't reset tab or loading state
  async function reloadItems() {
    const { data } = await supabase.from("items").select("*, decorator_assignments(pipeline_stage, decoration_type, decorators(name)), buy_sheet_lines(size, qty_ordered, qty_shipped_from_vendor, qty_received_at_hpd)").eq("job_id", params.id).order("sort_order");
    if (data) {
      const mapped = data.map((it: any) => {
        const lines = it.buy_sheet_lines || [];
        const sizes = sortSizes(lines.map((l: any) => l.size));
        const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
        const assignment = it.decorator_assignments?.[0];
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
    }
  }

  async function loadData() {
    setLoading(true);
    const [jobRes, itemsRes, paymentsRes, contactsRes] = await Promise.all([
      supabase.from("jobs").select("*, clients(name, shipping_address)").eq("id", params.id).single(),
      supabase.from("items").select("*, decorator_assignments(pipeline_stage, decoration_type, decorators(name)), buy_sheet_lines(size, qty_ordered, qty_shipped_from_vendor, qty_received_at_hpd)").eq("job_id", params.id).order("sort_order"),
      supabase.from("payment_records").select("*").eq("job_id", params.id).order("created_at"),
      supabase.from("job_contacts").select("*, contacts(*)").eq("job_id", params.id),
    ]);
    if (jobRes.data) {
      const j = jobRes.data as any;
      // Auto-fill shipping address from client profile if not set
      if (!j.type_meta?.venue_address && j.clients?.shipping_address) {
        j.type_meta = { ...(j.type_meta || {}), venue_address: j.clients.shipping_address };
      }
      setJob(j as Job);
    }
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
          pipeline_stage: it.pipeline_stage || assignment?.pipeline_stage || "blanks_ordered",
          decorator_assignment_id: assignment?.id || null,
          blankCosts: it.blank_costs || null,
          pipeline_timestamps: it.pipeline_timestamps || {},
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
    // Load proof status for lifecycle
    if (itemsRes.data) {
      const ids = itemsRes.data.map((it: any) => it.id);
      if (ids.length > 0) {
        const { data: allFiles } = await supabase.from("item_files").select("item_id, stage, approval").in("item_id", ids).is("superseded_at", null);
        const ps: Record<string, { allApproved: boolean }> = {};
        const filesPerItem: Record<string, boolean> = {};
        for (const id of ids) {
          const item = itemsRes.data.find((it: any) => it.id === id);
          const manualApproved = item?.artwork_status === "approved";
          const proofs = (allFiles || []).filter((f: any) => f.item_id === id && f.stage === "proof");
          const itemFiles = (allFiles || []).filter((f: any) => f.item_id === id);
          ps[id] = { allApproved: manualApproved || (proofs.length > 0 && proofs.every((f: any) => f.approval === "approved")) };
          filesPerItem[id] = itemFiles.length > 0;
        }
        setProofStatus(ps);
        // Mark items with files
        setItems(prev => prev.map(it => ({ ...it, hasFiles: filesPerItem[it.id] || false })));
      }
    }
    setLoading(false);
    initialLoadDone.current = true;
    // Auto-select first item for sidebar
    // Don't auto-select — show all items collapsed so drag reorder works
  }

  const jobSaveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const pendingJobUpdates = useRef<Partial<Job>>({});
  function saveJob(updates: Partial<Job>) {
    if (!job) return;
    pendingJobUpdates.current = {...pendingJobUpdates.current, ...updates};
    if (jobSaveTimer.current) clearTimeout(jobSaveTimer.current);
    jobSaveTimer.current = setTimeout(async () => {
      const u = pendingJobUpdates.current;
      pendingJobUpdates.current = {};
      await supabase.from("jobs").update(u).eq("id", job.id);
    }, 800);
  }
  async function flushJobSave() {
    if (jobSaveTimer.current) {
      clearTimeout(jobSaveTimer.current);
      jobSaveTimer.current = null;
      const u = pendingJobUpdates.current;
      pendingJobUpdates.current = {};
      if (Object.keys(u).length > 0) await supabase.from("jobs").update(u).eq("id", job.id);
    }
  }

  // Centralized tab switch — flushes ALL pending saves before navigating
  async function switchTab(t: string) {
    try {
      // Flush all pending saves in parallel
      await Promise.all([
        flushJobSave(),
        saveBuySheetRef.current?.(),
        saveCostingRef.current?.(),
      ]);
    } catch (e) {
      console.error("Save flush failed on tab switch:", e);
      // Still switch — data is in local state and will retry
    }
    // Refresh data for tabs that read from DB
    if (["quote","overview","proofs"].includes(t)) {
      const { data: fresh } = await supabase.from("jobs").select("quote_approved, quote_approved_at, type_meta").eq("id", job!.id).single();
      if (fresh) setJob(j => j ? {...j, quote_approved: fresh.quote_approved, quote_approved_at: fresh.quote_approved_at, type_meta: {...(j as any).type_meta, ...fresh.type_meta}} as any : j);
      if (t === "proofs" || t === "overview") {
        const { data: freshPay } = await supabase.from("payment_records").select("*").eq("job_id", job!.id).order("created_at");
        if (freshPay) setPayments(freshPay);
      }
    }
    setTab(t);
    window.history.replaceState(null, "", `?tab=${t}`);
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
      const stageName = updates.pipeline_stage.replace(/_/g, " ");
      const itemName = existing?.name || "Item";
      if (job) logJobActivity(job.id, `${itemName} → ${stageName}`);
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

  const recalcPhase = useCallback(async () => {
    if (!job || job.phase === "on_hold" || job.phase === "cancelled") return;
    const result = calculatePhase({
      job: {
        job_type: job.job_type,
        shipping_route: (job as any).shipping_route || "ship_through",
        payment_terms: job.payment_terms,
        quote_approved: (job as any).quote_approved || false,
        phase: job.phase,
        fulfillment_status: (job as any).fulfillment_status || null,
      },
      items: items.map(it => ({
        id: it.id,
        pipeline_stage: it.pipeline_stage || null,
        blanks_order_number: (it as any).blanks_order_number || null,
        blanks_order_cost: (it as any).blanks_order_cost ?? null,
        ship_tracking: (it as any).ship_tracking || null,
        received_at_hpd: (it as any).received_at_hpd || false,
        artwork_status: (it as any).artwork_status || null,
        garment_type: (it as any).garment_type || null,
      })),
      payments: payments.map(p => ({ amount: p.amount, status: p.status })),
      proofStatus,
      poSentVendors: (job as any).type_meta?.po_sent_vendors || [],
      costingVendors: [...new Set(((job as any).costing_data?.costProds || []).map((cp: any) => cp.printVendor).filter(Boolean))],
    });
    if (result.phase !== job.phase) {
      const timestamps = (job as any).phase_timestamps || {};
      timestamps[result.phase] = new Date().toISOString();
      await supabase.from("jobs").update({ phase: result.phase, phase_timestamps: timestamps }).eq("id", job.id);
      setJob(j => j ? { ...j, phase: result.phase, phase_timestamps: timestamps } as any : j);

      // Handoff notifications on phase transitions
      const clientName = (job.clients as any)?.name || "";
      const label = `${clientName} — ${job.title}`;
      const handoffs: Record<string, string> = {
        pending: `${label} → Waiting on client (payment/proofs)`,
        ready: `${label} → Ready to order blanks & send POs`,
        production: `${label} → Items at decorator`,
        receiving: `${label} → Items incoming to warehouse`,
        shipping: `${label} → All items received — ready to forward to client`,
        fulfillment: `${label} → All items received — ready for fulfillment`,
        complete: `${label} → Project complete`,
      };
      if (handoffs[result.phase]) {
        notifyTeam(handoffs[result.phase], result.phase === "complete" ? "alert" : "production", job.id, "job");
        logJobActivity(job.id, `Phase → ${result.phase.replace(/_/g, " ")}`);
      }
    }
  }, [job, items, payments, proofStatus, supabase]);

  // Run lifecycle recalc after data loads and on state changes
  useEffect(() => {
    if (initialLoadDone.current && job && items.length > 0) {
      recalcPhase();
    }
  }, [job?.quote_approved, items.length, payments.length, proofStatus, recalcPhase]);

  // Client search
  const clientResults = clientQuery.trim().length > 0 ? allClients.filter(c => c.name.toLowerCase().includes(clientQuery.trim().toLowerCase())) : [];
  useEffect(() => {
    if (job && !clientQuery) setClientQuery((job.clients as any)?.name || "");
  }, [job?.client_id]);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) setShowClientDropdown(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const upd = (k: string, v: any) => { if (!job) return; setJob(prev => { if (!prev) return prev; const u = {...prev, [k]:v} as Job; saveJob({[k]:v}); return u; }); };
  const updItem = (id: string, p: Partial<Item>) => saveItem(id, p);

  if (loading && !initialLoadDone.current) return React.createElement(JobSkeleton, null);
  if (!job) return React.createElement("div", {style:{padding:"2rem",color:T.muted,fontSize:13}}, "Project not found.");

  // Use costing_summary if available (set when costing tab is saved), fallback to item calculations.
  // For revenue: effectiveRevenue picks QB-billed amount when an invoice has been pushed
  // (covers variance-review adjustments), otherwise costing_summary.grossRev.
  const cs = job.costing_summary ? (typeof job.costing_summary === 'string' ? JSON.parse(job.costing_summary) : job.costing_summary) : null;
  const qbTotal = (job.type_meta as any)?.qb_total_with_tax;
  const qbTax = (job.type_meta as any)?.qb_tax_amount || 0;
  const billedRev = qbTotal && qbTotal > 0 ? Math.max(0, qbTotal - qbTax) : null;
  const totalRev = billedRev ?? cs?.grossRev ?? items.reduce((a,it)=>a+tQty(it.qtys||{})*((it.sell_per_unit)||0),0);
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
        try { await Promise.all([flushJobSave(), saveBuySheetRef.current?.(), saveCostingRef.current?.()]); } catch(e) {}
        router.push("/jobs");
      }} style={{background:"none",border:"none",color:T.faint,fontSize:11,cursor:"pointer",marginBottom:8,padding:0,fontFamily:font}}>
        ← All projects
      </button>

      {/* Header — compact single row */}
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",alignItems:isMobile?"flex-start":"center",justifyContent:"space-between",gap:12,flexDirection:isMobile?"column":"row"}}>
          {/* Left: identifiers + name */}
          <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0,width:isMobile?"100%":"auto"}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:11,color:T.muted,fontFamily:mono}}>{(job as any).type_meta?.qb_invoice_number || job.job_number}</span>
                {(job as any).type_meta?.qb_invoice_number && <span style={{fontSize:10,color:T.faint,fontFamily:mono}}>{job.job_number}</span>}
                <span style={{fontSize:10,fontWeight:700,color:phaseColor.text,letterSpacing:"0.06em",textTransform:"uppercase"}}>{job.phase.replace(/_/g," ")}</span>
                {job.priority==="rush"&&<span style={{fontSize:10,fontWeight:700,color:T.amber,letterSpacing:"0.06em",textTransform:"uppercase"}}>Rush</span>}
                {job.priority==="hot"&&<span style={{fontSize:10,fontWeight:700,color:T.red,letterSpacing:"0.06em",textTransform:"uppercase"}}>Hot</span>}
                {saving&&<span style={{fontSize:10,color:T.muted}}>Saving...</span>}
              </div>
              <div style={{display:"flex",alignItems:"baseline",gap:8,marginTop:2,flexWrap:"wrap"}}>
                <span style={{fontSize:isMobile?16:18,fontWeight:800,color:T.text,letterSpacing:"-0.02em"}}>{(job.clients as any)?.name||"No client"}</span>
                <span style={{fontSize:13,color:T.muted}}>{job.title}</span>
                <span style={{fontSize:11,color:T.faint}}>{totalUnits.toLocaleString()} units</span>
              </div>
            </div>
          </div>

          {/* Right: ship date + actions */}
          <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0,flexWrap:"wrap"}}>
            {(() => {
              const isComplete = job.phase === "complete";
              const isCancelled = job.phase === "cancelled";
              if (isComplete || isCancelled) {
                const ts = (job as any).phase_timestamps?.[isComplete ? "complete" : "cancelled"];
                const dateStr = ts
                  ? new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
                  : null;
                return (
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:16,fontWeight:700,color:isCancelled?T.red:T.green}}>
                      {isComplete?"Completed":"Cancelled"}
                    </div>
                    {dateStr && <div style={{fontSize:10,color:T.muted}}>{dateStr}</div>}
                  </div>
                );
              }
              if (daysLeft === null) return null;
              return (
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:700,color:daysLeft<0?T.red:daysLeft<=3?T.amber:T.text}}>
                    {daysLeft<0?Math.abs(daysLeft)+"d overdue":daysLeft===0?"Ships today":daysLeft+"d to ship"}
                  </div>
                  <div style={{fontSize:10,color:T.muted}}>{new Date(job.target_ship_date!).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                </div>
              );
            })()}
            {(job as any).portal_token && (
              <button onClick={()=>{
                navigator.clipboard.writeText(`${appBaseUrl()}/portal/${(job as any).portal_token}`);
                setPortalCopied(true);
                setTimeout(()=>setPortalCopied(false),2000);
              }} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:10,fontWeight:600,color:portalCopied?T.green:T.muted}}>
                {portalCopied?"Copied!":"Portal Link"}
              </button>
            )}
            <button onClick={async()=>{
              if(!window.confirm(`Duplicate "${job.title}" with all items and costing?`)) return;
              const {data:newJob}=await supabase.from("jobs").insert({
                title:job.title+" (Copy)",job_type:job.job_type,phase:"intake",priority:job.priority,
                payment_terms:job.payment_terms,target_ship_date:null,
                type_meta:(()=>{const m={...(job.type_meta||{})}; delete m.qb_invoice_id; delete m.qb_invoice_number; delete m.qb_payment_link; delete m.qb_tax_amount; delete m.qb_total_with_tax; delete m.po_sent_vendors; return m;})(),
                notes:job.notes,client_id:job.client_id,job_number:"",
                costing_data:job.costing_data||null,costing_summary:null,
                quote_approved:false,quote_approved_at:null,
              }).select("id").single();
              if(!newJob) return;
              // Copy items + buy sheet lines
              const idMap:Record<string,string>={};
              for(const item of items){
                const {data:ni}=await supabase.from("items").insert({
                  job_id:newJob.id,name:item.name,blank_vendor:item.blank_vendor,blank_sku:item.blank_sku,
                  cost_per_unit:item.cost_per_unit,sell_per_unit:item.sell_per_unit,status:"tbd",
                  artwork_status:"not_started",sort_order:item.sort_order,
                  blank_costs:(item as any).blank_costs||null,
                  garment_type:(item as any).garment_type||null,
                  drive_link:(item as any).drive_link||null,
                }).select("id").single();
                if(ni){
                  idMap[item.id]=ni.id;
                  if(item.sizes?.length){
                    await supabase.from("buy_sheet_lines").insert(
                      item.sizes.map((sz:string)=>({item_id:ni.id,size:sz,qty_ordered:item.qtys?.[sz]||0,qty_shipped_from_vendor:0,qty_received_at_hpd:0,qty_shipped_to_customer:0}))
                    );
                  }
                  // Copy artwork/mockups/proofs (same Drive files, new item IDs)
                  const {data:files}=await supabase.from("item_files").select("*").eq("item_id",item.id);
                  if(files?.length){
                    await supabase.from("item_files").insert(
                      files.map((f:any)=>({
                        item_id:ni.id,file_name:f.file_name,stage:f.stage,
                        drive_file_id:f.drive_file_id,drive_link:f.drive_link,
                        approval:f.stage==="proof"?"pending":f.approval,
                        approved_at:null,
                      }))
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
            }} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,fontSize:10,padding:"4px 10px",cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.color=T.text}
              onMouseLeave={e=>e.currentTarget.style.color=T.muted}>
              Duplicate
            </button>
          </div>
        </div>
        {/* KPI strip — compact */}
        {/* When the job has been intentionally priced (costing saved OR
            any item.sell_per_unit set) trust totalRev even if it's 0 —
            don't fake a "~1.43× cost" estimate. The estimate is only for
            jobs that haven't been priced yet (no costing_summary, all
            sell_per_unit null). */}
        {(() => { const displayRev = totalRev; return null; })()}
        <div style={{display:"flex",gap:6,marginTop:8}}>
          {(() => {
            const pricingKnown = !!cs || items.some((it:any) => it.sell_per_unit != null);
            const estRev = !pricingKnown && totalCost > 0 ? totalCost * 1.43 : null;
            const effRev = totalRev > 0 ? totalRev : (estRev ?? totalRev);
            const showRev = totalRev > 0 || pricingKnown || estRev != null;
            const profit = totalCost > 0 ? effRev - totalCost : 0;
            const marginPct = effRev > 0 ? (profit / effRev * 100) : 0;
            // Show full cents — Math.round() was hiding the .46 on
            // an $80.46 invoice, which led Taylor to mark a partial
            // $80 payment as "Full Payment" because $80 looked like
            // the total.
            const fmt$ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return [
              { label: "Revenue", value: showRev ? fmt$(effRev) : "—", color: T.text },
              { label: "Cost", value: totalCost > 0 ? fmt$(totalCost) : "—" },
              { label: "Profit", value: totalCost > 0 ? fmt$(profit) : "—", color: profit >= 0 ? T.green : T.red },
              { label: "Margin", value: totalCost > 0 && effRev > 0 ? marginPct.toFixed(1) + "%" : "—", color: marginPct >= 30 ? T.green : marginPct >= 20 ? T.amber : T.red },
            ];
          })().map(s=>(
            <div key={s.label} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 12px",flex:1}}>
              <div style={{fontSize:9,color:T.faint,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.label}</div>
              <div style={{fontSize:14,fontWeight:700,color:(s as any).color||T.text,fontFamily:mono}}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress checklist — horizontal tabs (X axis) */}
      <ProjectProgress job={job} items={items} payments={payments} proofStatus={proofStatus} activeTab={tab} onTabClick={switchTab} />

      {/* ── Sidebar + Content Layout (Y axis: items | content) ── */}
      <div style={{display:"flex",gap:0,minHeight:"calc(100vh - 240px)"}}>

        {/* ── Left Sidebar: Items list (only on builder + costing, hidden on mobile since editing is desktop-only) ── */}
        {!isMobile && (tab === "builder" || tab === "costing") && <div style={{width:220,flexShrink:0,borderRight:`1px solid ${T.border}`,background:T.card,overflowY:"auto"}}>
          <div style={{padding:"8px 16px 6px",fontSize:9,fontWeight:700,color:T.faint,textTransform:"uppercase",letterSpacing:"0.08em"}}>
            Items ({items.length})
          </div>
          {items.map((item: any, i: number) => {
            const proofOk = proofStatus[item.id]?.allApproved || item.artwork_status === "approved";
            const hasBlanks = ((item as any).blanks_order_cost ?? 0) > 0;
            const stage = item.pipeline_stage;
            const isSelected = selectedItemId === item.id;
            return (
              <div key={item.id}
                onClick={() => { setSelectedItemId(prev => prev === item.id ? null : item.id); }}
                style={{padding:"8px 12px 8px 16px",fontSize:12,display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${T.border}`,cursor:"pointer",
                  background:isSelected?T.bg:"transparent",borderLeft:isSelected?`3px solid ${T.accent}`:"3px solid transparent",transition:"background 0.1s"}}>
                <span style={{width:18,height:18,borderRadius:4,background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:T.accent,fontFamily:mono,flexShrink:0}}>
                  {String.fromCharCode(65+i)}
                </span>
                <div style={{flex:1,minWidth:0}}
                  onDoubleClick={e => {
                    e.stopPropagation();
                    const input = e.currentTarget.querySelector("input");
                    if (input) { input.style.display = "block"; input.focus(); }
                  }}>
                  <div style={{fontSize:12,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name||"Untitled"}</div>
                  <input value={item.name||""} onChange={e => { e.stopPropagation(); setItems((prev: any[]) => prev.map((it: any) => it.id === item.id ? {...it, name: e.target.value} : it)); }}
                    onClick={e => e.stopPropagation()}
                    onBlur={async e => {
                      e.target.style.display = "none";
                      const newName = e.target.value.trim();
                      const oldName = (item as any)._prevName || item.name;
                      if (newName && newName !== oldName) {
                        const { createClient: cc } = await import("@/lib/supabase/client");
                        cc().from("items").update({ name: newName }).eq("id", item.id).then(() => {});
                        fetch("/api/files/cleanup", { method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "rename-item", clientName: (job?.clients as any)?.name || "", projectTitle: job?.title || "", itemName: oldName, newName }),
                        }).catch(() => {});
                      }
                    }}
                    onFocus={e => { (item as any)._prevName = e.target.value; e.target.select(); }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    style={{display:"none",fontSize:12,fontWeight:600,color:T.text,background:T.surface,border:`1px solid ${T.accent}`,outline:"none",width:"100%",padding:"2px 4px",borderRadius:4,marginTop:2}}
                  />
                  <div style={{fontSize:10,color:T.faint,marginTop:1,display:"flex",gap:6,alignItems:"center"}}>
                    <span>{stage === "shipped" ? "Shipped" : stage === "in_production" ? "At decorator" : proofOk && hasBlanks ? "Ready" : !item.blank_vendor ? "No blank" : (item.totalQty||0) === 0 ? "No qty" : proofOk ? "Proofs approved" : "Setup"}</span>
                    {item.sell_per_unit > 0 && <span style={{fontFamily:mono,color:T.muted,fontWeight:600}}>${Number(item.sell_per_unit).toFixed(2)}</span>}
                  </div>
                </div>
                {proofOk && <span style={{width:6,height:6,borderRadius:3,background:T.green,flexShrink:0}} />}
              </div>
            );
          })}
        </div>}

        {/* ── Content area ── */}
        <div style={{flex:1,minWidth:0,overflowY:"auto",padding:"0 20px 40px"}}>
      {/* Mobile editing-notice banner */}
      {isMobile && ["builder","costing","quote","blanks","po","proofs"].includes(tab) && (
        <div style={{background:T.amberDim,color:T.amber,border:`1px solid ${T.amber}44`,borderRadius:8,padding:"8px 12px",fontSize:11,fontWeight:600,marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
          <span>Use a laptop to edit — this tab is designed for a larger screen.</span>
        </div>
      )}
      {/* OVERVIEW */}
                  {tab==="overview"&&(
        <div style={{fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>

          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,alignItems:"start"}}>
            {/* Left column: Project info + Shipping details */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{background:T.card,border:"1px solid ${T.border}",borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column"}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Project info</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  <div style={{position:"relative"}} ref={clientDropdownRef}><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Client</label>
                    <input style={ic} value={clientQuery} onChange={e=>{setClientQuery(e.target.value);setShowClientDropdown(true);}}
                      onFocus={()=>setShowClientDropdown(true)} placeholder="Search or assign client..."/>
                    {showClientDropdown&&clientQuery.trim().length>0&&(
                      <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,maxHeight:200,overflowY:"auto",marginTop:4}}>
                        {clientResults.map(c=>(
                          <div key={c.id} onClick={async()=>{
                            await supabase.from("jobs").update({client_id:c.id}).eq("id",job.id);
                            setJob(j=>j?{...j,client_id:c.id,clients:{name:c.name}} as any:j);
                            setClientQuery(c.name);
                            setShowClientDropdown(false);
                          }} style={{padding:"8px 12px",fontSize:12,cursor:"pointer",borderBottom:`1px solid ${T.border}`}}
                            onMouseEnter={e=>(e.currentTarget.style.background=T.surface)}
                            onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                            {c.name}
                          </div>
                        ))}
                        {clientResults.length===0&&<div style={{padding:"8px 12px",fontSize:11,color:T.faint}}>No matching clients</div>}
                        <div onClick={async()=>{
                          const name=clientQuery.trim();
                          if(!name) return;
                          const {data:newClient}=await supabase.from("clients").insert({name}).select("id,name").single();
                          if(newClient){
                            await supabase.from("jobs").update({client_id:newClient.id}).eq("id",job.id);
                            setJob(j=>j?{...j,client_id:newClient.id,clients:{name:newClient.name}} as any:j);
                            setAllClients(prev=>[...prev,newClient].sort((a,b)=>a.name.localeCompare(b.name)));
                            setClientQuery(newClient.name);
                            setShowClientDropdown(false);
                          }
                        }} style={{padding:"8px 12px",fontSize:11,fontWeight:600,color:T.accent,cursor:"pointer",borderTop:`1px solid ${T.border}`}}
                          onMouseEnter={e=>(e.currentTarget.style.background=T.surface)}
                          onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                          + Create "{clientQuery.trim()}"
                        </div>
                      </div>
                    )}
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Project memo</label>
                    <input style={ic} value={job.title} placeholder="Optional description..." onChange={e=>upd("title",e.target.value)}/>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Priority</label>
                    <div style={{padding:"6px 10px",borderRadius:6,fontSize:12,fontWeight:600,textAlign:"center",
                      background:job.priority==="hot"?T.redDim:job.priority==="rush"?T.amberDim:T.greenDim,
                      color:job.priority==="hot"?T.red:job.priority==="rush"?T.amber:T.green}}>
                      {(job.priority||"normal").toUpperCase()}
                    </div>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Phase</label>
                    <div style={{...ic,background:T.card,display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:10,fontWeight:700,color:phaseColor.text,letterSpacing:"0.06em",textTransform:"uppercase"}}>{job.phase.replace(/_/g," ")}</span>
                      {(()=>{
                        const r=calculatePhase({
                          job:{job_type:job.job_type,shipping_route:(job as any).shipping_route||"ship_through",payment_terms:job.payment_terms,quote_approved:(job as any).quote_approved||false,phase:job.phase,fulfillment_status:(job as any).fulfillment_status||null},
                          items:items.map(it=>({id:it.id,pipeline_stage:it.pipeline_stage||null,blanks_order_number:(it as any).blanks_order_number||null,blanks_order_cost:(it as any).blanks_order_cost ?? null,ship_tracking:(it as any).ship_tracking||null,received_at_hpd:(it as any).received_at_hpd||false,artwork_status:(it as any).artwork_status||null,garment_type:(it as any).garment_type||null})),
                          payments:payments.map(p=>({amount:p.amount,status:p.status})),
                          proofStatus,
                          poSentVendors:(job as any).type_meta?.po_sent_vendors||[],
                          costingVendors:[...new Set(((job as any).costing_data?.costProds||[]).map((cp:any)=>cp.printVendor).filter(Boolean))],
                        });
                        return r.itemProgress?<span style={{fontSize:10,color:T.muted}}>{r.itemProgress}</span>:null;
                      })()}
                    </div>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Project notes</label>
                    <textarea style={{...ic,minHeight:90,resize:"vertical",lineHeight:1.4}} value={job.notes||""} onChange={e=>upd("notes",e.target.value)}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Documents</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {(()=>{
                        const docVendors = [...new Set(((job as any).costing_data?.costProds||[]).map((p:any)=>p.printVendor).filter(Boolean))] as string[];
                        const qbInvNum = (job as any).type_meta?.qb_invoice_number;
                        const hasItems = items.length > 0;
                        const hasShipping = items.some((it:any)=>it.ship_tracking||it.received_at_hpd||it.pipeline_stage==="shipped");
                        const docBtn = (label: string, src: string|null, available: boolean) => (
                          <button key={label}
                            onClick={()=>{ if(available && src) setPdfPreview({src,title:label,downloadHref:src+"?download=1"}); }}
                            disabled={!available}
                            title={available?undefined:"Not available yet"}
                            style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${T.border}`,background:available?T.surface:T.bg,color:available?T.text:T.faint,fontSize:11,fontWeight:600,fontFamily:font,cursor:available?"pointer":"default"}}
                            onMouseEnter={e=>{if(available){e.currentTarget.style.borderColor=T.accent;}}}
                            onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;}}>
                            {label}
                          </button>
                        );
                        return (
                          <>
                            {docBtn("Quote", `/api/pdf/quote/${job.id}`, hasItems)}
                            {docBtn(qbInvNum?`Invoice #${qbInvNum}`:"Invoice", `/api/pdf/invoice/${job.id}`, hasItems)}
                            {docBtn("Packing Slip", `/api/pdf/packing-slip/${job.id}`, hasShipping)}
                            {docVendors.length === 0 && docBtn("PO", null, false)}
                            {docVendors.map(v => docBtn(`PO — ${v}`, `/api/pdf/po/${job.id}?vendor=${encodeURIComponent(v)}`, hasItems))}
                            <button onClick={()=>setShowArtFiles(true)}
                              style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontSize:11,fontWeight:600,fontFamily:font,cursor:"pointer"}}
                              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;}}
                              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;}}>
                              Art Files
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Shipping details */}
              <div style={{background:T.card,border:"1px solid ${T.border}",borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column"}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Shipping details</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Requested in-hands date</label><input style={{...ic,cursor:"pointer",colorScheme:"dark"}} type="date" value={job.target_ship_date||""} onClick={e=>(e.target as HTMLInputElement).showPicker?.()} onChange={e=>{
                    const ship = e.target.value;
                    const updates: any = { target_ship_date: ship };
                    if (ship) updates.priority = calculatePriority(ship);
                    setJob(j => j ? {...j, ...updates} : j);
                    saveJob(updates);
                  }}/></div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Shipping route</label>
                    <select style={ic} value={(job as any).shipping_route||"ship_through"} onChange={e=>upd("shipping_route",e.target.value)}>
                      <option value="drop_ship">Drop ship (direct to client)</option>
                      <option value="ship_through">Ship-through (forward from HPD)</option>
                      <option value="stage">Stage (fulfillment from HPD)</option>
                    </select>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:7}}>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Client delivery address</label>
                    <textarea style={{...ic,minHeight:130,resize:"vertical",lineHeight:1.4}} value={job.type_meta?.venue_address||""} onChange={e=>upd("type_meta",{...job.type_meta,venue_address:e.target.value})}/>
                  </div>
                  <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Shipping notes</label>
                    <textarea style={{...ic,minHeight:130,resize:"vertical",lineHeight:1.4}} value={job.type_meta?.shipping_notes||""} onChange={e=>upd("type_meta",{...job.type_meta,shipping_notes:e.target.value})}/>
                  </div>
                </div>
              </div>

              {/* Project Summary */}
              <div style={{background:T.card,border:"1px solid ${T.border}",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>Project Summary</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                    <span style={{color:T.muted}}>Created</span>
                    <span>{new Date((job as any).created_at||Date.now()).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span>
                  </div>
                  {(()=>{
                    const costProds=(job as any).costing_data?.costProds||[];
                    const suppliers=[...new Set(costProds.map((cp:any)=>cp.supplier).filter(Boolean))];
                    return suppliers.length>0?(
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,alignItems:"flex-start"}}>
                        <span style={{color:T.muted,flexShrink:0}}>Blank Suppliers</span>
                        <span style={{textAlign:"right"}}>{suppliers.join(", ")}</span>
                      </div>
                    ):null;
                  })()}
                  {(()=>{
                    const costProds=(job as any).costing_data?.costProds||[];
                    const vendors=[...new Set(costProds.map((cp:any)=>cp.printVendor).filter(Boolean))];
                    return vendors.length>0?(
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,alignItems:"flex-start"}}>
                        <span style={{color:T.muted,flexShrink:0}}>Decorators</span>
                        <span style={{textAlign:"right"}}>{vendors.join(", ")}</span>
                      </div>
                    ):null;
                  })()}
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                    <span style={{color:T.muted}}>Items</span>
                    <span>{items.length} items · {totalUnits.toLocaleString()} units</span>
                  </div>
                  {(()=>{
                    const r=calculatePhase({
                      job:{job_type:job.job_type,shipping_route:(job as any).shipping_route||"ship_through",payment_terms:job.payment_terms,quote_approved:(job as any).quote_approved||false,phase:job.phase,fulfillment_status:(job as any).fulfillment_status||null},
                      items:items.map(it=>({id:it.id,pipeline_stage:it.pipeline_stage||null,blanks_order_number:(it as any).blanks_order_number||null,blanks_order_cost:(it as any).blanks_order_cost ?? null,ship_tracking:(it as any).ship_tracking||null,received_at_hpd:(it as any).received_at_hpd||false,artwork_status:(it as any).artwork_status||null,garment_type:(it as any).garment_type||null})),
                      payments:payments.map(p=>({amount:p.amount,status:p.status})),
                      proofStatus,
                      poSentVendors:(job as any).type_meta?.po_sent_vendors||[],
                    });
                    return r.itemProgress?(
                      <div style={{borderTop:`1px solid ${T.border}`,paddingTop:8,marginTop:2}}>
                        <div style={{fontSize:10,color:T.muted,marginBottom:3}}>NEXT STEP</div>
                        <div style={{fontSize:12,fontWeight:600,color:T.accent}}>{r.itemProgress}</div>
                      </div>
                    ):null;
                  })()}
                </div>
              </div>

              {/* Hold + Delete */}
              <div style={{display:"flex",gap:8}}>
                {job.phase!=="on_hold"&&job.phase!=="cancelled"&&(
                  <button onClick={()=>{upd("phase","on_hold");}}
                    style={{flex:1,padding:"8px",background:"transparent",border:`1px solid ${T.amber}`,borderRadius:8,color:T.amber,fontSize:12,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",fontWeight:500,cursor:"pointer",textAlign:"center"}}
                    onMouseEnter={e=>(e.currentTarget.style.background=T.amberDim)}
                    onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                    Place on Hold
                  </button>
                )}
                {job.phase==="on_hold"&&(
                  <button onClick={async()=>{
                    await supabase.from("jobs").update({phase:"intake"}).eq("id",job.id);
                    setJob(j=>j?{...j,phase:"intake"} as any:j);
                    setTimeout(recalcPhase, 300);
                  }}
                    style={{flex:1,padding:"8px",background:T.greenDim,border:`1px solid ${T.green}44`,borderRadius:8,color:T.green,fontSize:12,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",fontWeight:500,cursor:"pointer",textAlign:"center"}}
                    onMouseEnter={e=>(e.currentTarget.style.opacity="0.8")}
                    onMouseLeave={e=>(e.currentTarget.style.opacity="1")}>
                    Resume
                  </button>
                )}
                <button
                  onClick={() => setConfirmDeleteProject(true)}
                  style={{flex:1,padding:"8px",background:"transparent",border:`1px solid ${T.red}`,borderRadius:8,color:T.red,fontSize:12,fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",fontWeight:500,cursor:"pointer",textAlign:"center"}}
                  onMouseEnter={e=>(e.currentTarget.style.background=T.redDim)}
                  onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                  Delete project
                </button>
              </div>
            </div>

            {/* Right column: Contacts, Email, Items */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>

              {/* Contacts */}
              <div style={{background:T.card,border:"1px solid ${T.border}",borderRadius:10,padding:"12px 14px"}}>
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
                        if(email && contacts.some(c=>c.email?.toLowerCase()===email.toLowerCase())){
                          alert(`${email} is already on this project.`);
                          return;
                        }
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
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,paddingBottom:i<contacts.length-1?6:0,borderBottom:i<contacts.length-1?"1px solid ${T.border}":"none"}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:T.accent,flexShrink:0}}>
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

              {/* Payment summary */}
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Payments</div>
                  <button onClick={()=>switchTab("proofs")} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.accent,fontSize:10,padding:"2px 8px",cursor:"pointer"}}>Manage →</button>
                </div>
                <div style={{marginBottom:8}}>
                  <label style={{fontSize:10,color:T.muted,marginBottom:3,display:"block"}}>Payment terms</label>
                  <select style={ic} value={job.payment_terms||""} onChange={e=>upd("payment_terms",e.target.value||null)}>
                    <option value="">— select —</option>
                    <option value="prepaid">Prepaid</option>
                    <option value="deposit_balance">Deposit / Balance</option>
                    <option value="net_15">Net 15</option>
                    <option value="net_30">Net 30</option>
                  </select>
                </div>
                {payments.length===0&&<p style={{fontSize:12,color:T.muted}}>No payments recorded yet.</p>}
                {payments.length>0&&(() => {
                  const invoiceTotal = Number((job as any)?.type_meta?.qb_total_with_tax)
                    || Number((job as any)?.costing_summary?.grossRev)
                    || 0;
                  const paidSum = (payments || [])
                    .filter(p => p.status === "paid" || p.status === "partial")
                    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
                  const balance = Math.max(0, invoiceTotal - paidSum);
                  const isPaid = paidSum > 0.01 && balance <= 0.01;
                  const isPartial = paidSum > 0.01 && balance > 0.01;
                  const stateColor = isPaid ? T.green : isPartial ? T.amber : T.muted;
                  const stateLabel = isPaid ? "Paid" : isPartial ? "Partial Paid" : "Unpaid";
                  const fmt = (n:number) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  const showStrip = !(invoiceTotal <= 0.01 && paidSum <= 0.01);
                  // When the project as a whole is partial, individual paid
                  // rows mirror that amber "Partial Paid" label so the row
                  // pill doesn't visually contradict the aggregate above.
                  const rowLabel = (rowStatus: string) => {
                    if (rowStatus === "paid" && isPartial) return "partial paid";
                    return rowStatus;
                  };
                  const rowPillFg = (rowStatus: string) => {
                    if (rowStatus === "paid" && isPartial) return T.amber;
                    if (rowStatus === "paid") return T.green;
                    if (rowStatus === "void") return T.red;
                    return T.amber;
                  };
                  return (
                    <>
                      {showStrip && (
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 9px", marginBottom: 8, background: T.surface, borderRadius: 6, border: `1px solid ${T.border}`, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: stateColor }}>{stateLabel}</span>
                          <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>
                            <strong style={{ color: T.text }}>{fmt(paidSum)}</strong> of <strong style={{ color: T.text }}>{fmt(invoiceTotal)}</strong>
                            {isPartial && <> · <span style={{ color: T.amber }}>{fmt(balance)} due</span></>}
                          </span>
                        </div>
                      )}
                      <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
                        <thead><tr style={{borderBottom:`1px solid ${T.border}`}}>
                          {["Invoice","Type","Amount","Status"].map(h=><th key={h} style={{textAlign:"left",padding:"3px 6px",color:T.muted,fontWeight:500}}>{h}</th>)}
                        </tr></thead>
                        <tbody>{payments.map(p=>(
                          <tr key={p.id} style={{borderBottom:`1px solid ${T.border}`}}>
                            <td style={{padding:"6px",fontFamily:mono,color:T.muted}}>{p.invoice_number||"—"}</td>
                            <td style={{padding:"6px",textTransform:"capitalize"}}>{p.type.replace(/_/g," ")}</td>
                            <td style={{padding:"6px",fontWeight:600}}>${p.amount.toLocaleString()}</td>
                            <td style={{padding:"6px"}}>
                              <span style={{fontSize:10,fontWeight:700,color:rowPillFg(p.status),letterSpacing:"0.06em",textTransform:"uppercase"}}>{rowLabel(p.status)}</span>
                            </td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </>
                  );
                })()}
              </div>

              {/* Items */}
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Items</div>
                  <span style={{fontSize:10,color:T.muted}}>{items.length} items · {totalUnits.toLocaleString()} units</span>
                </div>
                {items.length===0&&<p style={{fontSize:12,color:T.muted}}>No items yet. Add items in the Buy Sheet tab.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {items.map(item=>{
                    const qty=tQty(item.qtys||{});
                    const dc=(item as any).decoration_type;
                    const isAccessory=(item as any).garment_type==="accessory";
                    return (
                      <div key={item.id} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",background:T.surface,borderRadius:6}}>
                        <div style={{flex:1,minWidth:0}}>
                          <span style={{fontSize:12,fontWeight:600,color:T.text}}>{item.name}</span>
                          <span style={{fontSize:10,color:T.muted,marginLeft:7}}>{item.blank_vendor} {item.blank_sku}{qty>0?` · ${qty.toLocaleString()} units`:""}</span>
                        </div>
                        {!isAccessory&&dc&&<span style={{fontSize:10,fontWeight:700,color:T.accent,letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{dc.replace(/_/g," ")}</span>}
                        {isAccessory&&<span style={{fontSize:10,fontWeight:700,color:T.purple,letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap"}}>Accessory</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>

          {/* Email history — outbound only. Inbound routing via a shared
               reply-to is unreliable (replies get tagged to the wrong job),
               so we suppress inbound here until per-job reply addressing is
               rebuilt. Replies still land in Gmail as today. */}
          <div style={{ marginTop: 18 }}>
            <EmailThread jobId={job.id} title="Emails sent from OpsHub" outboundOnly />
          </div>
        </div>
      )}

      {/* PRODUCT BUILDER (unified Processing + Buy Sheet + Art) */}
      {tab==="builder"&&(
        <ProductBuilder
          project={job}
          items={items}
          contacts={contacts}
          onItemsChanged={reloadItems}
          onRegisterSave={(fn: () => Promise<void>) => { saveBuySheetRef.current = fn; }}
          onSaveStatus={(s: string) => handleSaveStatus(s)}
          onSaved={(resolved: any[]) => {
            setItems(prev => {
              const prevMap = Object.fromEntries(prev.map(it => [it.id, it]));
              return resolved.map((it: any) => ({
                ...(prevMap[it.id] || {}),
                ...it,
                sizes: it.sizes || [],
                qtys: it.qtys || {},
                totalQty: it.totalQty || Object.values(it.qtys || {}).reduce((a: number, v: number) => a + v, 0),
              }));
            });
          }}
          onUpdateItem={(id: string, updates: any) => setItems(prev => prev.map(it => it.id === id ? {...it, ...updates} : it))}
          selectedItemId={selectedItemId}
        />
      )}

      {tab==="proofs"&&(
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"3fr 2fr",gap:20,alignItems:"start"}}>
          <ApprovalsTab
            job={job}
            items={items}
            contacts={contacts}
            proofStatus={proofStatus}
            onUpdateItem={(id: string, updates: any) => {
              setItems(prev => prev.map(it => it.id === id ? {...it, ...updates} : it));
              // Keep proofStatus in sync when artwork_status changes (manual approval)
              if ("artwork_status" in updates) {
                setProofStatus(prev => {
                  const next = { ...prev };
                  const existing = next[id] || { allApproved: false };
                  next[id] = { ...existing, allApproved: updates.artwork_status === "approved" || existing.allApproved };
                  return next;
                });
              }
            }}
            onRecalcPhase={recalcPhase}
          />
          <PaymentTab
            job={job}
            items={items}
            contacts={contacts}
            payments={payments}
            onReload={loadData}
            onRecalcPhase={recalcPhase}
            onUpdateJob={(updates: any) => setJob(j => j ? {...j, ...updates} : j)}
          />
        </div>
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
          selectedItemId={selectedItemId}
          onUpdateProject={(updates: any) => setJob(j => j ? {...j, ...updates} : j)}
        />
      )}

      {tab==="quote"&&(
        <>
        <div style={{marginBottom:12}}>
          {(job as any).quote_approved ? (
            <div style={{background:T.greenDim,border:`1px solid ${T.green}44`,borderRadius:8,padding:"10px 14px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:T.green}}>Quote approved</div>
                  {(job as any).quote_approved_at && <div style={{fontSize:10,color:T.muted,marginTop:2}}>Approved {new Date((job as any).quote_approved_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>}
                </div>
                <button onClick={async()=>{
                  await supabase.from("jobs").update({quote_approved:false,quote_approved_at:null}).eq("id",job.id);
                  setJob(j=>j?{...j,quote_approved:false,quote_approved_at:null} as any:j);
                  logJobActivity(job.id, "Quote approval revoked");
                  recalcPhase();
                }} style={{fontSize:10,color:T.faint,background:"none",border:`1px solid ${T.border}`,borderRadius:5,padding:"3px 10px",cursor:"pointer"}}>Revoke</button>
              </div>
              <div style={{display:"flex",gap:6,fontSize:11}}>
                <span style={{color:T.muted}}>Next:</span>
                <button onClick={()=>switchTab("proofs")} style={{color:T.accent,background:"none",border:"none",cursor:"pointer",fontSize:11,fontWeight:600,textDecoration:"underline",padding:0}}>Send Proofs & Invoice</button>
              </div>
            </div>
          ) : (
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:T.text}}>Quote pending approval</div>
                <div style={{fontSize:10,color:T.muted,marginTop:2}}>Approve to advance project to pre-production</div>
              </div>
              <button onClick={async()=>{
                const now=new Date().toISOString();
                await supabase.from("jobs").update({quote_approved:true,quote_approved_at:now}).eq("id",job.id);
                setJob(j=>j?{...j,quote_approved:true,quote_approved_at:now} as any:j);
                logJobActivity(job.id, "Quote approved");
                notifyTeam(`Quote approved — ${(job.clients as any)?.name || ""} · ${job.title}`, "approval", job.id, "job");
                recalcPhase();
              }} style={{fontSize:12,fontWeight:600,color:"#fff",background:T.green,border:"none",borderRadius:7,padding:"7px 20px",cursor:"pointer"}}>Approve Quote</button>
            </div>
          )}
          {/* Quote sent log */}
          {(job as any).type_meta?.quote_sent_at && (
            <div style={{marginTop:8,padding:"6px 12px",background:T.surface,borderRadius:6,fontSize:11,color:T.muted,display:"flex",alignItems:"center",gap:6}}>
              <span style={{color:T.green,fontWeight:600}}>Sent</span>
              <span>Quote emailed {new Date((job as any).type_meta.quote_sent_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})} at {new Date((job as any).type_meta.quote_sent_at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</span>
            </div>
          )}
        </div>
        <CostingTabWrapper
          key={"quote-"+items.map(i=>i.id).join(',')}
          project={job}
          buyItems={items}
          contacts={contacts}
          onUpdateBuyItems={setItems}
          onRegisterSave={(fn: () => Promise<void>) => { saveCostingRef.current = fn; }}
          onSaveStatus={(s: string) => handleSaveStatus(s)}
          onSaved={(data: any) => setJob(j => j ? {...j, ...data} : j)}
          initialTab="quote"
          hideSubTabs={true}
        />
        </>
      )}
      {tab==="blanks"&&(
        <BlanksTab items={items} job={job} payments={payments} onRecalcPhase={recalcPhase} onUpdateItem={(id: string, updates: any) => setItems(prev => prev.map(it => it.id === id ? {...it, ...updates} : it))} onTabClick={switchTab} />
      )}
      {tab==="po"&&(
        <POTab
          project={job}
          items={items}
          costingData={job.costing_data}
          onRecalcPhase={recalcPhase}
          onUpdateJob={(updates: any) => setJob(j => j ? {...j, ...updates} : j)}
        />
      )}
      {tab==="documents"&&(
        <DocumentsTab job={job} items={items} />
      )}

        </div>{/* end tab content */}
      </div>{/* end flex layout */}

      {/* Save indicator */}
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
      {saveOk && !saveError && (
        <div style={{
          position:"fixed", bottom:20, right:20, zIndex:100,
          padding:"6px 14px", borderRadius:8,
          background:T.greenDim, border:`1px solid ${T.green}`,
          color:T.green, fontSize:11, fontWeight:600, fontFamily:font,
          opacity:0.9, transition:"opacity 0.3s",
        }}>
          Saved
        </div>
      )}

      {pdfPreview && (
        <PdfPreviewModal src={pdfPreview.src} title={pdfPreview.title} downloadHref={pdfPreview.downloadHref}
          onClose={()=>setPdfPreview(null)} />
      )}

      {showArtFiles && (
        <ArtFilesModal job={job} items={items} onClose={()=>setShowArtFiles(false)} />
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
          // Archive Drive folder before deleting
          try {
            await fetch("/api/files/cleanup", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "archive-project", clientName: (job?.clients as any)?.name || "", projectTitle: job?.title || "", jobId: params.id }),
            });
          } catch {} // Non-fatal
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

// Art Files quick-view modal — grid of mockup/proof thumbnails per item.
// Click a thumbnail to open it full-size in a new tab.
function ArtFilesModal({ job, items, onClose }: { job: any; items: any[]; onClose: () => void }) {
  const supabase = createClient();
  const [filesByItem, setFilesByItem] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = items.map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
    if (ids.length === 0) { setLoading(false); return; }
    let cancelled = false;
    supabase.from("item_files")
      .select("id, item_id, stage, file_name, drive_file_id, drive_link, mime_type, approval, created_at")
      .in("item_id", ids)
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }: any) => {
        if (cancelled) return;
        const grouped: Record<string, any[]> = {};
        for (const f of (data || [])) {
          (grouped[f.item_id] ||= []).push(f);
        }
        setFilesByItem(grouped);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [items.map(it => it.id).join(",")]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, width: "100%", maxWidth: 900, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: T.text }}>Art Files · {job?.title || "Project"}</div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 6px" }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {loading && <div style={{ fontSize: 12, color: T.muted, textAlign: "center", padding: 30 }}>Loading…</div>}
          {!loading && items.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint, textAlign: "center", padding: 30 }}>No items on this project.</div>
          )}
          {!loading && items.map(it => {
            const files = (filesByItem[it.id] || []).filter((f: any) => f.stage === "mockup" || f.stage === "proof" || f.stage === "print_ready");
            if (files.length === 0) return null;
            return (
              <div key={it.id} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{it.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                  {files.map((f: any) => (
                    <a key={f.id} href={`/api/files/thumbnail?id=${f.drive_file_id}`} target="_blank" rel="noopener noreferrer"
                      style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden", textDecoration: "none", color: T.text, display: "flex", flexDirection: "column" }}>
                      <div style={{ background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", height: 120, overflow: "hidden" }}>
                        <img src={`/api/files/thumbnail?id=${f.drive_file_id}&thumb=1`} alt={f.file_name}
                          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/>
                      </div>
                      <div style={{ padding: "6px 8px", fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                        {f.stage.replace(/_/g, " ")}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
