"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { clientShippingRoutes } from "@/lib/tenants";
import { useIsMobile } from "@/lib/useIsMobile";
import { JobDetailV2 } from "./JobDetailV2";
import { T, mono, sortSizes } from "@/lib/theme";
import { Skeleton } from "@/components/Skeleton";
import { JobActivityPanel, logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { calculatePhase } from "@/lib/lifecycle";
import { loadJobPhase, type JobPhaseView } from "@/lib/item-state";
import { poSentToItem } from "@/lib/item-status";

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
  size_subs?: Record<string,{label?:string;color?:string;note?:string}>|null;
  sizeSubs?: Record<string,{label?:string;color?:string;note?:string}>;
  costing_data: Record<string,any>|null;
  costing_summary: {grossRev:number,totalCost:number,netProfit:number,margin:number,avgPerUnit:number,totalQty:number}|null;
  decorator?: string; decoration_type?: string; pipeline_stage?: string;
  sizes?: string[]; qtys?: Record<string,number>;
  client_eta?: string|null; client_eta_set_at?: string|null; client_eta_note?: string|null;
};
type Payment = { id:string; type:string; amount:number; status:string; due_date:string|null; invoice_number:string|null; };
type Contact = { id:string; name:string; email:string|null; role_label:string|null; role_on_job:string; };
type Job = {
  id:string; title:string; job_type:string; phase:string; priority:string;
  payment_terms:string|null; contract_status:string; notes:string|null;
  target_ship_date:string|null; type_meta:Record<string,string>; job_number:string;
  client_id:string|null; clients?:{name:string}|null; is_inventory?:boolean;
};

// Overview drill-in modal — a tile's summary opens this; the existing section
// editor renders inside untouched. Click backdrop or × to close.
function OvModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9998, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bg, borderRadius: 14, width: "100%", maxWidth: 1100, boxShadow: "0 16px 48px rgba(0,0,0,0.45)", marginBottom: 40 }}>
        <div style={{ position: "sticky", top: 0, background: T.bg, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${T.border}`, borderRadius: "14px 14px 0 0", zIndex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Hub-grammar overview helpers (Jon, Jul 22: "missing the client hub skin
// and feel"). The client-space vocabulary — uppercase section heads with the
// trailing period + a faint hint; a hairline KPI strip — brought onto the job
// so both sides of the glass read the same. See components/hub/theme + the
// client space at /clients/[id]. T already equals the hub palette H.
function OvSec({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "30px 0 13px", flexWrap: "wrap" }}>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", color: T.text }}>{title}</h2>
      {hint && <span style={{ fontSize: 10.5, color: T.faint }}>{hint}</span>}
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}
function Kpi({ value, label, color, sub }: { value: React.ReactNode; label: string; color?: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "clamp(19px,2.5vw,27px)", fontWeight: 900, lineHeight: 1, color: color || T.text, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: T.faint, marginTop: 6 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: T.muted, fontFamily: mono, marginTop: 3, whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

export default function JobDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("tab");
      // "proofs" merged into the Quote + Proofs surface (tab "quote").
      if (p === "proofs") return "quote";
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
  const saveBlanksRef = useRef<(() => Promise<void>) | null>(null);
  // Costing header actions — wrapper registers these so the project
  // header can drive Pull from PSDs / Request Pricing / Unlock to revise
  // without keeping a duplicate toolbar inside the costing tab itself.
  const costingActionsRef = useRef<{pullFromPsds?: () => Promise<void>; openRfqModal?: () => void}>({});
  const [costingPull, setCostingPull] = useState<{pulling: boolean; result: string | null}>({pulling: false, result: null});
  // Stable ref so CostingTabWrapper's notify effect doesn't see a new callback
  // every render (which fed the stuck-in-project render loop).
  const handleCostingPull = useCallback((pulling: boolean, result: string | null) => setCostingPull({ pulling, result }), []);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const autoSelectedRef = useRef(false);
  const [job, setJob] = useState<Job|null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  // Overview section chip — reflows the dense Overview into God Mode / Reports
  // style: hero band + facts always on, heavy detail behind chips.
  const [ovSection, setOvSection] = useState<null|"details"|"billing"|"items"|"activity">(null);
  const [ovItemsVendor, setOvItemsVendor] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  // NEW phase model (additive display) — computed from the ledger by loadJobPhase.
  // Shown alongside; the legacy jobs.phase write path (recalcPhase) is untouched.
  const [phaseView, setPhaseView] = useState<JobPhaseView|null>(null);
  // Live inbound boxes (EasyPost-fed) — one status line per vendor in the
  // Production strip. Boxes are decorator-scoped, so scope through
  // shipment_lines by job_id and dedupe. Carrier signals only; delivered is
  // NOT received — counting stays on /receiving2.
  const [inboundBoxes, setInboundBoxes] = useState<any[]>([]);
  useEffect(() => {
    if (!params.id) return;
    createClient().from("shipment_lines")
      .select("shipment_id, shipments(id, decorator_id, direction, status, tracking, pickup, carrier_status, est_delivery_date, delivered_at, decorators(name, short_code))")
      .eq("job_id", params.id)
      .then(({ data }) => {
        const seen = new Map<string, any>();
        for (const l of (data || []) as any[]) {
          const s = l.shipments;
          if (s && s.direction === "inbound") seen.set(s.id, s);
        }
        setInboundBoxes(Array.from(seen.values()));
      });
  }, [params.id]);
  const initialLoadDone = useRef(false);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<string|null>(null);
  const [pdfPreview, setPdfPreview] = useState<{src:string;title:string;downloadHref:string}|null>(null);
  const [showArtFiles, setShowArtFiles] = useState(false);
  // Frozen forward packing slips = this job's outbound shipments (v2 shipping).
  const [forwardSlips, setForwardSlips] = useState<{ id: string; tracking: string | null; createdAt: string }[]>([]);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [confirmCancelVoid, setConfirmCancelVoid] = useState(false);
  const [confirmSendBack, setConfirmSendBack] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [ovMenu, setOvMenu] = useState(false);
  const [thumbByItem, setThumbByItem] = useState<Record<string, string>>({});
  const [peekItem, setPeekItem] = useState<any | null>(null);
  const [sendingQP, setSendingQP] = useState(false);
  const [qpErr, setQpErr] = useState("");
  const [qpSendOpen, setQpSendOpen] = useState(false);
  const [qpSelected, setQpSelected] = useState<Record<number, boolean>>({});
  const [editingValidUntil, setEditingValidUntil] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [teamProfiles, setTeamProfiles] = useState<Record<string,string>>({});
  const [proofStatus, setProofStatus] = useState<Record<string,{allApproved:boolean;proofState?:"approved"|"revision"|"pending"|"none";note?:string}>>({});
  // Single source for an item's gallery status — art must clear before "in production".
  const iStatus = (it:any):{s:string;c:string} => {
    if(it.forwarded_at) return {s:"Forwarded",c:T.green};
    if(it.received_at_hpd) return {s:"Received",c:T.green};
    if(it.pipeline_stage==="shipped") return {s:"Shipped from vendor",c:T.blue};
    const pf=proofStatus[it.id]?.proofState;
    if(pf==="revision") return {s:"Proof — revision",c:T.red};
    if(pf==="pending") return {s:"Awaiting proof",c:T.amber};
    if(it.pipeline_stage==="in_production") return {s:"In production",c:T.amber};
    if(it.blanks_order_cost!=null||it.blanks_order_number) return {s:"Blanks ordered",c:T.muted};
    return {s:"In setup",c:T.faint};
  };
  const [allClients, setAllClients] = useState<{id:string,name:string}[]>([]);
  const [clientQuery, setClientQuery] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [portalCopied, setPortalCopied] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  // Back-button + tab-switch UX guard. Promise.all on the four
  // tab-flush refs has no upper bound — if any one save stalls,
  // navigation never fires. We race against a 1.5s timeout so the
  // user always gets out; stragglers continue in the background.
  const [navigating, setNavigating] = useState(false);
  // Hard-navigation escape hatch. If the client router wedges (a stalled RSC
  // fetch or a render-loop bail-out), router.push() silently no-ops, the page
  // never unmounts, and the back button is trapped on "Saving…" forever — the
  // only way out is the URL bar. This timer fires a full document navigation
  // (which CANNOT be blocked by React/the client router) if we're still mounted
  // shortly after a push. Cleared on unmount when the SPA nav succeeds, so the
  // happy path never triggers a full reload.
  const navFallbackTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(() => () => { if (navFallbackTimer.current) clearTimeout(navFallbackTimer.current); }, []);
  const escapeTo = useCallback((href: string) => {
    if (navFallbackTimer.current) clearTimeout(navFallbackTimer.current);
    navFallbackTimer.current = setTimeout(() => { window.location.href = href; }, 1200);
  }, []);
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

  // Ref always pointing at the current items array, so the drag
  // handler doesn't depend on its render-time closure.
  const itemsRef = useRef<Item[]>(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  // recalcPhase reads job/payments/proofStatus from refs so it can be a
  // STABLE callback (empty deps). Without this it was recreated on every
  // render, the recalc effect listing it as a dep re-ran every render, and
  // once it wrote a phase it recreated itself → re-ran → wrote again =
  // infinite render loop ("Maximum update depth exceeded") that wedged the
  // page (back button stuck on "Saving…").
  const jobRef = useRef<Job|null>(job);
  useEffect(() => { jobRef.current = job; }, [job]);
  const paymentsRef = useRef<Payment[]>(payments);
  useEffect(() => { paymentsRef.current = payments; }, [payments]);
  const proofStatusRef = useRef(proofStatus);
  useEffect(() => { proofStatusRef.current = proofStatus; }, [proofStatus]);

  // Drag-to-reorder items in the sidebar. Updates local state
  // optimistically, persists items.sort_order in the background.
  //
  // Why not setItems(prev => splice…)?
  // React StrictMode double-invokes state updater functions in dev
  // to surface non-idempotent updates. A naïve splice updater isn't
  // idempotent: the second call mutates the already-reordered array
  // and produces garbage. Reading from itemsRef + passing a plain
  // value to setItems sidesteps that entirely.
  const onSidebarDragEnd = useCallback(async (result: any) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const current = itemsRef.current;
    if (!current || result.source.index >= current.length || result.destination.index > current.length) return;
    const reordered = [...current];
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setItems(reordered);
    itemsRef.current = reordered;
    const sb = createClient();
    await Promise.all(reordered.map((it, i) => {
      const id = it.id;
      if (typeof id === "string" && id.length > 20) {
        return (sb as any).from("items").update({ sort_order: i }).eq("id", id);
      }
      return Promise.resolve();
    }));
  }, []);

  // Light reload — just items, doesn't reset tab or loading state
  async function reloadItems() {
    const { data } = await supabase.from("items").select("*, decorator_assignments(pipeline_stage, decoration_type, decorator_id, decorators(id, name, short_code)), buy_sheet_lines(size, qty_ordered, qty_shipped_from_vendor, qty_received_at_hpd)").eq("job_id", params.id).order("sort_order");
    if (data) {
      const mapped = data.map((it: any) => {
        const lines = it.buy_sheet_lines || [];
        const sizes = sortSizes(lines.map((l: any) => l.size));
        const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
        const totalQty = lines.reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0);
        const assignment = it.decorator_assignments?.[0];
        return {
          ...it,
          sizes, qtys, totalQty,
          decorator: assignment?.decorators?.name || null,
          decoration_type: assignment?.decoration_type || null,
          // Assignment stage heals PO-send race drift, but ONLY for real v2 stage
          // values — legacy assignment markers (blanks_ordered) must never leak
          // into item stage (they read as "shipped" downstream).
          pipeline_stage: it.pipeline_stage || (["in_production", "shipped"].includes(assignment?.pipeline_stage) ? assignment.pipeline_stage : null),
          decorator_assignment_id: assignment?.id || null,
          blankCosts: it.blank_costs || null,
          sizeSubs: it.size_subs || {},
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
      supabase.from("items").select("*, decorator_assignments(pipeline_stage, decoration_type, decorator_id, decorators(id, name, short_code)), buy_sheet_lines(size, qty_ordered, qty_shipped_from_vendor, qty_received_at_hpd)").eq("job_id", params.id).order("sort_order"),
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
        const totalQty = lines.reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0);
        const assignment = it.decorator_assignments?.[0];
        return {
          ...it,
          sizes, qtys, totalQty,
          decorator: assignment?.decorators?.name || null,
          decoration_type: assignment?.decoration_type || null,
          // Assignment stage heals PO-send race drift, but ONLY for real v2 stage
          // values — legacy assignment markers (blanks_ordered) must never leak
          // into item stage (they read as "shipped" downstream).
          pipeline_stage: it.pipeline_stage || (["in_production", "shipped"].includes(assignment?.pipeline_stage) ? assignment.pipeline_stage : null),
          decorator_assignment_id: assignment?.id || null,
          blankCosts: it.blank_costs || null,
          sizeSubs: it.size_subs || {},
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
        const { data: allFiles } = await supabase.from("item_files").select("item_id, stage, approval, drive_file_id, notes").in("item_id", ids).is("superseded_at", null);
        // Outbound shipments for this job = the frozen forward packing slips.
        const { data: obLines } = await supabase.from("shipment_lines").select("shipment_id, shipments(id, tracking, created_at, direction)").eq("job_id", params.id);
        const slipMap = new Map<string, { id: string; tracking: string | null; createdAt: string }>();
        for (const l of obLines || []) {
          const s: any = (l as any).shipments;
          if (s?.direction === "outbound" && !slipMap.has(s.id)) slipMap.set(s.id, { id: s.id, tracking: s.tracking, createdAt: s.created_at });
        }
        setForwardSlips(Array.from(slipMap.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
        const ps: Record<string, { allApproved: boolean; proofState?: "approved" | "revision" | "pending" | "none"; note?: string }> = {};
        const filesPerItem: Record<string, boolean> = {};
        const thumbPerItem: Record<string, string | null> = {};
        for (const id of ids) {
          const item = itemsRes.data.find((it: any) => it.id === id);
          const manualApproved = item?.artwork_status === "approved";
          const proofs = (allFiles || []).filter((f: any) => f.item_id === id && f.stage === "proof");
          const itemFiles = (allFiles || []).filter((f: any) => f.item_id === id);
          // proofState feeds the gallery: an unapproved proof blocks "in production".
          const proofState: "approved" | "revision" | "pending" | "none" =
            manualApproved ? "approved"
            : proofs.some((f: any) => f.approval === "revision_requested") ? "revision"
            : (proofs.length > 0 && proofs.every((f: any) => f.approval === "approved")) ? "approved"
            : proofs.length > 0 ? "pending"
            : "none";
          const revNote = proofState === "revision" ? (proofs.find((f: any) => f.approval === "revision_requested")?.notes || null) : null;
          ps[id] = { allApproved: proofState === "approved", proofState, note: revNote || undefined };
          filesPerItem[id] = itemFiles.length > 0;
          const mock = itemFiles.find((f: any) => f.stage === "mockup") || itemFiles.find((f: any) => f.stage === "proof") || itemFiles.find((f: any) => f.stage === "print_ready");
          thumbPerItem[id] = mock?.drive_file_id || null;
        }
        setProofStatus(ps);
        // Persist gallery thumbnails in their own map so reloadItems() can't drop them.
        setThumbByItem(Object.fromEntries(Object.entries(thumbPerItem).filter(([, v]) => v)) as Record<string, string>);
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
      // If the memo (title) was edited and the project already has
      // a Drive folder, rename it in place so the next upload doesn't
      // create a sibling folder under the new name. No-op when the
      // job has no drive_folder_id yet.
      if (typeof (u as any).title === "string") {
        try {
          await fetch("/api/drive/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity: "job", id: job.id, name: (u as any).title }),
          });
        } catch { /* non-fatal */ }
      }
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

  // Swap all client-tied fields on the job when the client changes
  // (e.g. duplicated job → reassigned to test client). Without this,
  // Send Quote/Invoice/PO emails the wrong contacts AND ships to the
  // wrong address because job_contacts + venue_address still point at
  // the original client.
  //
  // Replaces: job_contacts, type_meta.venue_address, payment_terms.
  // Clears:   type_meta.po_ship_to (per-vendor overrides reference the
  //           old client's destination, no longer valid).
  // Leaves alone: QB invoice fields (those need explicit re-generation
  //               on the Invoice tab; we don't auto-clear them here so
  //               the user notices the mismatch instead of silently
  //               losing the invoice link).
  async function swapJobContactsForClient(newClientId: string) {
    if (!job) return;
    // 1. Contacts
    await supabase.from("job_contacts").delete().eq("job_id", job.id);
    const { data: clientContacts } = await supabase
      .from("contacts")
      .select("id, is_primary, name, email, phone, role_label")
      .eq("client_id", newClientId);
    if (clientContacts?.length) {
      await supabase.from("job_contacts").insert(
        clientContacts.map((c: any) => ({
          job_id: job.id, contact_id: c.id,
          role_on_job: c.is_primary ? "primary" : "cc",
        }))
      );
      setContacts(clientContacts.map((c: any) => ({
        ...c, role_on_job: c.is_primary ? "primary" : "cc",
      })) as any);
    } else {
      setContacts([]);
    }

    // 2. Address + payment terms — pull from new client's profile.
    const { data: newClientRow } = await supabase
      .from("clients")
      .select("shipping_address, default_terms")
      .eq("id", newClientId)
      .single();
    const newAddress = (newClientRow as any)?.shipping_address || null;
    const newTerms = (newClientRow as any)?.default_terms || null;

    // 3. type_meta — overwrite venue_address, clear po_ship_to.
    const newMeta = { ...((job as any).type_meta || {}) };
    if (newAddress) newMeta.venue_address = newAddress;
    else delete newMeta.venue_address;
    delete newMeta.po_ship_to;

    const updates: any = { type_meta: newMeta };
    if (newTerms) updates.payment_terms = newTerms;
    await supabase.from("jobs").update(updates).eq("id", job.id);

    // Reflect in local state so the Overview shipping panel updates
    // immediately without a reload.
    setJob(j => j ? ({ ...j, type_meta: newMeta, ...(newTerms ? { payment_terms: newTerms } : {}) } as any) : j);
  }

  // Centralized tab switch — flushes ALL pending saves before navigating
  // Flush every registered pending save (job + buy sheet + costing +
  // blanks) but bound the wait at 1.5s. If any save hangs (Supabase
  // round-trip stalls, registered fn returns a promise that never
  // resolves), we still navigate — autosave debounces already covered
  // most blur/typing events and the beforeunload guard catches what
  // didn't. Without this bound the back button + tab switches feel
  // broken on a flaky network.
  async function flushAllSavesWithTimeout(ms = 1500) {
    // Each save is wrapped so a SYNCHRONOUS throw (e.g. a registered ref fn
    // that blows up before returning a promise) becomes a rejection caught
    // below — instead of escaping this function entirely. The old version
    // only raced against hangs, so a sync throw bypassed the timeout, the
    // caller's await rejected, navigation never fired, and the back button
    // stuck on "Saving…" forever. Never let this function throw.
    const safe = (fn?: () => any) => { try { return Promise.resolve(fn?.()); } catch (e) { return Promise.reject(e); } };
    const flushAll = Promise.all([
      safe(() => flushJobSave()),
      safe(() => saveBuySheetRef.current?.()),
      safe(() => saveCostingRef.current?.()),
      safe(() => saveBlanksRef.current?.()),
    ]).catch(e => { console.error("Save flush failed:", e); });
    const timeout = new Promise<void>(resolve => setTimeout(resolve, ms));
    await Promise.race([flushAll, timeout]);
  }

  async function switchTab(t: string) {
    await flushAllSavesWithTimeout();
    // Refresh data for tabs that read from DB
    if (["quote","overview","proofs","invoice"].includes(t)) {
      const { data: fresh } = await supabase.from("jobs").select("quote_approved, quote_approved_at, type_meta").eq("id", job!.id).single();
      if (fresh) setJob(j => j ? {...j, quote_approved: fresh.quote_approved, quote_approved_at: fresh.quote_approved_at, type_meta: {...(j as any).type_meta, ...fresh.type_meta}} as any : j);
      if (t === "proofs" || t === "overview" || t === "invoice") {
        const { data: freshPay } = await supabase.from("payment_records").select("*").eq("job_id", job!.id).order("created_at");
        if (freshPay) setPayments(freshPay);
      }
      // The Overview production strip groups by items' decorator_assignments join.
      // A costing vendor change rewrites that join in the DB, but onUpdateBuyItems
      // only refreshes item fields — not the join. Re-query items here (post-flush,
      // so there are no in-flight edits to clobber) so the strip reflects the
      // current vendor without needing a hard refresh.
      if (t === "overview") await reloadItems();
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
    if ((updates as any).sizeSubs !== undefined) dbUpdates.size_subs = (updates as any).sizeSubs || {};
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
    // Read live state from refs (not closure) so this callback stays stable.
    const job = jobRef.current;
    const items = itemsRef.current;
    const payments = paymentsRef.current;
    const proofStatus = proofStatusRef.current;
    if (!job || job.phase === "on_hold" || job.phase === "cancelled") return;
    const costProds = (job as any).costing_data?.costProds || [];
    const poSentVendors = (job as any).type_meta?.po_sent_vendors || [];
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
        po_sent: poSentToItem({
          printVendor: costProds.find((cp: any) => cp.id === it.id)?.printVendor,
          decoratorName: (it as any).decorator_assignments?.[0]?.decorators?.name,
          decoratorShortCode: (it as any).decorator_assignments?.[0]?.decorators?.short_code,
          poSentVendors,
        }),
        blanks_order_number: (it as any).blanks_order_number || null,
        blanks_order_cost: (it as any).blanks_order_cost ?? null,
        ship_tracking: (it as any).ship_tracking || null,
        received_at_hpd: (it as any).received_at_hpd || false,
        artwork_status: (it as any).artwork_status || null,
        garment_type: (it as any).garment_type || null,
        shipping_route: (it as any).shipping_route || null,
        webstore_entered_at: (it as any).webstore_entered_at || null,
        forwarded_at: (it as any).forwarded_at || null,
        archived_at: (it as any).archived_at || null,
      })),
      payments: payments.map(p => ({ amount: p.amount, status: p.status })),
      proofStatus,
      poSentVendors,
      costingVendors: [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))],
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
    // Stable callback — all live state is read from refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Run lifecycle recalc after data loads and on state changes
  useEffect(() => {
    if (initialLoadDone.current && job && items.length > 0) {
      recalcPhase();
    }
  }, [job?.quote_approved, items.length, payments.length, proofStatus, recalcPhase]);

  // Load the NEW phase model (additive) — ledger-derived, read-only. Same triggers
  // as the legacy recalc so it stays in step without touching jobs.phase.
  useEffect(() => {
    if (!job || items.length === 0) { setPhaseView(null); return; }
    let cancelled = false;
    loadJobPhase(supabase, job.id).then(v => { if (!cancelled) setPhaseView(v); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, (job as any)?.quote_approved, job?.phase, items.length, payments.length, proofStatus]);

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
  // Shipping routes this tenant may pick (DMD = ship_through only).
  const allowedRoutes = clientShippingRoutes();
  const updItem = (id: string, p: Partial<Item>) => saveItem(id, p);

  if (loading && !initialLoadDone.current) return React.createElement(JobSkeleton, null);
  if (!job) return React.createElement("div", {style:{padding:"2rem",color:T.muted,fontSize:13}}, "Project not found.");

  // CLASSIC DECOMMISSIONED (Sep 5 2026) — V2 has been the only daily driver
  // since the Jul 28 cutover; DMD (the cut-and-sew tenant the classic
  // fallback guarded) has zero jobs ever. ?classic=1 / ?v2=1 params retired.
  return <JobDetailV2 job={job} items={items} payments={payments} contacts={contacts} thumbByItem={thumbByItem} />;
}
