"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clientShippingRoutes } from "@/lib/tenants";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { CostingTabWrapper } from "./CostingTab";
import { POTab } from "./POTab.jsx";
import { BlanksTab } from "./BlanksTab";
import { PaymentTab } from "./PaymentTab";
import { ApprovalsTab } from "./ApprovalsTab";
import { JobItemsList } from "./JobItemsList.jsx";
import { useIsMobile } from "@/lib/useIsMobile";
import { ProductBuilder } from "./ProductBuilder";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/Skeleton";
import { JobFlowBar } from "@/components/JobFlowBar";
import { PdfPreviewModal } from "@/components/PdfPreviewModal";
import { JobActivityPanel, logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { calculatePhase } from "@/lib/lifecycle";
import { effectiveRevenue } from "@/lib/revenue";
import { loadJobPhase, type JobPhaseView } from "@/lib/item-state";
import { CLIENT_LABEL, LEGACY_TO_NEW_PHASE } from "@/lib/phase-model";
import { poSentToItem } from "@/lib/item-status";
import { calculatePriority, businessDaysFromNow, fmtDay, daysUntilDay } from "@/lib/dates";
import { appBaseUrlSync } from "@/lib/public-url";

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
  const saveBlanksRef = useRef<(() => Promise<void>) | null>(null);
  // Costing header actions — wrapper registers these so the project
  // header can drive Pull from PSDs / Request Pricing / Lock In Pricing
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
  const [ovMenu, setOvMenu] = useState(false);
  const [thumbByItem, setThumbByItem] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState(false);
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
          pipeline_stage: it.pipeline_stage || assignment?.pipeline_stage || null,
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
          pipeline_stage: it.pipeline_stage || assignment?.pipeline_stage || null,
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
        const { data: allFiles } = await supabase.from("item_files").select("item_id, stage, approval, drive_file_id").in("item_id", ids).is("superseded_at", null);
        // Outbound shipments for this job = the frozen forward packing slips.
        const { data: obLines } = await supabase.from("shipment_lines").select("shipment_id, shipments(id, tracking, created_at, direction)").eq("job_id", params.id);
        const slipMap = new Map<string, { id: string; tracking: string | null; createdAt: string }>();
        for (const l of obLines || []) {
          const s: any = (l as any).shipments;
          if (s?.direction === "outbound" && !slipMap.has(s.id)) slipMap.set(s.id, { id: s.id, tracking: s.tracking, createdAt: s.created_at });
        }
        setForwardSlips(Array.from(slipMap.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
        const ps: Record<string, { allApproved: boolean }> = {};
        const filesPerItem: Record<string, boolean> = {};
        const thumbPerItem: Record<string, string | null> = {};
        for (const id of ids) {
          const item = itemsRes.data.find((it: any) => it.id === id);
          const manualApproved = item?.artwork_status === "approved";
          const proofs = (allFiles || []).filter((f: any) => f.item_id === id && f.stage === "proof");
          const itemFiles = (allFiles || []).filter((f: any) => f.item_id === id);
          ps[id] = { allApproved: manualApproved || (proofs.length > 0 && proofs.every((f: any) => f.approval === "approved")) };
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
    if (["quote","overview","proofs"].includes(t)) {
      const { data: fresh } = await supabase.from("jobs").select("quote_approved, quote_approved_at, type_meta").eq("id", job!.id).single();
      if (fresh) setJob(j => j ? {...j, quote_approved: fresh.quote_approved, quote_approved_at: fresh.quote_approved_at, type_meta: {...(j as any).type_meta, ...fresh.type_meta}} as any : j);
      if (t === "proofs" || t === "overview") {
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

  // Revenue + cost KPIs reflect the CURRENT costing state. Source of
  // truth: costing_summary (refreshed every time the costing tab saves
  // — which is after every add/remove/edit). The QB-billed total is
  // surfaced separately on the Invoice block; using it here would
  // pin the chip to the moment QB was pushed and ignore any items
  // added later after an unlock (which is exactly what Jon hit).
  const cs = job.costing_summary ? (typeof job.costing_summary === 'string' ? JSON.parse(job.costing_summary) : job.costing_summary) : null;
  // ONE revenue formula app-wide (lib/revenue): variance-billed > costing
  // grossRev+fees > QB net of passthrough. The items fallback below only
  // covers pre-costing intake jobs (effectiveRevenue returns 0 there).
  const totalRev = effectiveRevenue({ ...job, costing_summary: cs }) || items.reduce((a,it)=>a+tQty(it.qtys||{})*((it.sell_per_unit)||0),0);
  const totalCost = cs?.totalCost || items.reduce((a,it)=>a+tQty(it.qtys||{})*((it.cost_per_unit)||0),0);
  const totalUnits = items.reduce((a,it)=>a+tQty(it.qtys||{}),0);
  const margin = totalRev>0?((totalRev-totalCost)/totalRev*100):0;
  const totalPaid = payments.filter(p=>p.status==="paid").reduce((a,p)=>a+p.amount,0);
  const totalDue = payments.filter(p=>p.status!=="paid"&&p.status!=="void").reduce((a,p)=>a+p.amount,0);
  const phaseColor = PHASE_COLORS[job.phase]||PHASE_COLORS.intake;
  const daysLeft = job.target_ship_date ? daysUntilDay(job.target_ship_date) : null;

  const ic = {width:"100%",padding:"6px 10px",border:`1px solid ${T.border}`,borderRadius:6,background:T.surface,color:T.text,fontSize:"13px",fontFamily:font,boxSizing:"border-box" as const};
  const lc = {fontSize:"12px",color:T.muted,marginBottom:"4px",display:"block"};
  const card = {background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"1rem 1.25rem"};

  return (
    <div style={{fontFamily:font,color:T.text,maxWidth:1100,margin:"0 auto",paddingBottom:"3rem"}}>
      {/* ── Project detail header ──
          Compact 3-row layout, client name primary:
            Row 1: Back chevron · ship countdown (one line, right-aligned)
            Row 2: Client name (H1) · project title inline subtitle
            Row 3: Quiet metadata strip (job # · units · phase · priority)
          Same hierarchy on desktop + mobile; only the countdown drops
          to its own line on narrow widths.
          Smaller H1 (20pt mobile / 22pt desktop) than the previous
          take so this header actually shrinks vs. the original. */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, marginBottom: 6, flexWrap: "wrap",
      }}>
        <button onClick={async ()=>{
          if (navigating) return;
          setNavigating(true);
          // Guarantee navigation even if the flush rejects — otherwise a
          // failed save leaves the button stuck on "Saving…" with no way out.
          try { await flushAllSavesWithTimeout(); } catch (e) { console.error("nav flush failed:", e); }
          router.push("/jobs");
          escapeTo("/jobs");
        }} disabled={navigating}
          style={{background:"transparent",border:"none",color:T.accent,fontSize:14,fontWeight:600,cursor:navigating?"default":"pointer",padding:"4px 8px 4px 0",fontFamily:font,display:"inline-flex",alignItems:"center",gap:2,minHeight:36,marginLeft:-4,opacity:navigating?0.55:1,transition:"opacity 0.12s"}}
          onMouseEnter={(e:any)=>{ if (!navigating) e.currentTarget.style.opacity="0.75";}}
          onMouseLeave={(e:any)=>{ if (!navigating) e.currentTarget.style.opacity="1";}}>
          <span style={{fontSize:20,lineHeight:1,marginRight:2}}>‹</span> {navigating ? "Saving…" : "Projects"}
        </button>
        <div style={{position:"relative"}}>
          <button onClick={()=>setOvMenu(m=>!m)} style={{border:`1px solid ${T.border}`,background:T.card,color:T.muted,borderRadius:8,padding:"5px 12px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:font,lineHeight:1}}>⋯</button>
          {ovMenu && (
            <div style={{position:"absolute",top:"100%",right:0,marginTop:6,background:T.card,border:`1px solid ${T.border}`,borderRadius:10,boxShadow:"0 10px 30px rgba(0,0,0,.16)",zIndex:40,minWidth:196,overflow:"hidden"}}>
              <button onClick={async()=>{setOvMenu(false);await switchTab("overview");setOvSection("activity");}} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 13px",background:"none",border:"none",cursor:"pointer",fontFamily:font,fontSize:12.5,fontWeight:600,color:T.text}}>Activity log</button>
              {job.phase!=="on_hold"&&job.phase!=="cancelled"&&<button onClick={()=>{setOvMenu(false);upd("phase","on_hold");}} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 13px",background:"none",border:"none",cursor:"pointer",fontFamily:font,fontSize:12.5,fontWeight:600,color:T.text}}>Place on hold</button>}
              {job.phase==="on_hold"&&<button onClick={async()=>{setOvMenu(false);await supabase.from("jobs").update({phase:"intake"}).eq("id",job.id);setJob(j=>j?{...j,phase:"intake"} as any:j);setTimeout(recalcPhase,300);}} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 13px",background:"none",border:"none",cursor:"pointer",fontFamily:font,fontSize:12.5,fontWeight:600,color:T.green}}>Resume</button>}
              <button onClick={async()=>{setOvMenu(false);if(!window.confirm(`Duplicate "${job.title}" as a re-order? Items, costing, contacts, art, and approved proofs carry over.`))return;try{const res=await fetch(`/api/jobs/${job.id}/duplicate`,{method:"POST"});const data=await res.json();if(!res.ok)throw new Error(data?.error||"Duplication failed");if(!data?.jobId)throw new Error("No new job id returned");router.push(`/jobs/${data.jobId}`);}catch(e:any){alert(`Duplicate failed: ${e?.message||"Unknown error"}`);}}} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 13px",background:"none",border:"none",cursor:"pointer",fontFamily:font,fontSize:12.5,fontWeight:600,color:T.text}}>Duplicate</button>
              {job.phase!=="cancelled"&&(job as any).type_meta?.qb_invoice_number&&<button onClick={()=>{setOvMenu(false);setConfirmCancelVoid(true);}} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 13px",background:"none",border:"none",cursor:"pointer",fontFamily:font,fontSize:12.5,fontWeight:600,color:T.amber}}>Cancel &amp; void invoice</button>}
              <button onClick={()=>{setOvMenu(false);setConfirmDeleteProject(true);}} style={{display:"block",width:"100%",textAlign:"left",padding:"9px 13px",background:"none",border:"none",cursor:"pointer",fontFamily:font,fontSize:12.5,fontWeight:600,color:T.red}}>Delete project</button>
            </div>
          )}
        </div>
      </div>

      <div style={{marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
      <div style={{minWidth:0}}>
        {/* H1 row — client name dominates, project title trails as
            subtitle. Inline on desktop; project title drops to a
            second line on mobile so the client name has full width. */}
        <div style={{display:"flex",alignItems:"baseline",gap:isMobile?6:10,flexWrap:"wrap"}}>
          {job.client_id ? (
            <Link href={`/clients/${job.client_id}`}
              style={{fontSize:isMobile?20:22,fontWeight:800,color:T.text,letterSpacing:"-0.02em",lineHeight:1.15,textDecoration:"none",display:"inline-flex",alignItems:"baseline",gap:4}}
              onMouseEnter={(e:any)=>e.currentTarget.style.color=T.accent}
              onMouseLeave={(e:any)=>e.currentTarget.style.color=T.text}
              title="View in client hub">
              {(job.clients as any)?.name||"No client"}
            </Link>
          ) : (
            <span style={{fontSize:isMobile?20:22,fontWeight:800,color:T.faint,letterSpacing:"-0.02em",lineHeight:1.15}}>No client</span>
          )}
          {/* Costing actions — only relevant on Product Builder + Costing
              tabs. Pull from PSDs and Request Pricing operate on costing
              state, so when triggered from Builder we jump to Costing
              first; Lock In Pricing toggles the job directly. */}
          {(tab === "builder" || tab === "costing") && !isMobile && (() => {
            // Archived = historic record. Lock is forced + permanent
            // (mirrors ProductBuilder/CostingTab), so the toolbar
            // collapses to a status label — no Pull / Request / Lock.
            const archived = job.phase === "complete" || job.phase === "cancelled";
            const locked = !!(job as any).type_meta?.costing_locked;
            const ensureCosting = async () => {
              if (tab !== "costing") {
                await switchTab("costing");
                await new Promise(r => setTimeout(r, 80));
              }
            };
            const onPull = async () => {
              await ensureCosting();
              await costingActionsRef.current?.pullFromPsds?.();
            };
            const onRequest = async () => {
              await ensureCosting();
              setTimeout(() => costingActionsRef.current?.openRfqModal?.(), 40);
            };
            const onLock = async () => {
              try { await saveCostingRef.current?.(); } catch {}
              const newVal = !locked;
              const meta = {...((job as any).type_meta || {}), costing_locked: newVal, costing_locked_at: newVal ? new Date().toISOString() : null};
              await supabase.from("jobs").update({type_meta: meta}).eq("id", job.id);
              setJob(j => j ? {...j, type_meta: meta} as any : j);
            };
            if (archived) {
              return (
                <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",alignItems:"flex-end",lineHeight:1.2}}>
                  <span style={{fontSize:10,fontWeight:700,color:T.green,letterSpacing:"0.06em",textTransform:"uppercase"}}>
                    Historic record
                  </span>
                  <span style={{fontSize:10,color:T.muted}}>
                    {job.phase === "cancelled" ? "Cancelled" : "Complete"} — read-only
                  </span>
                </div>
              );
            }
            return (
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",lineHeight:1.2}}>
                  <span style={{fontSize:10,fontWeight:700,color:locked?T.green:T.amber,letterSpacing:"0.06em",textTransform:"uppercase"}}>
                    {locked?"Pricing locked":"Pricing not locked"}
                  </span>
                  <span style={{fontSize:10,color:T.muted}}>
                    {locked?"Ready to quote":"Lock in when all items are costed"}
                  </span>
                </div>
                <button onClick={onPull} disabled={costingPull.pulling}
                  style={{height:30,padding:"0 12px",borderRadius:7,fontSize:11,fontWeight:600,cursor:costingPull.pulling?"default":"pointer",background:"transparent",border:`1px solid ${T.border}`,color:T.muted,fontFamily:font,opacity:costingPull.pulling?0.6:1}}
                  title="Re-scan items' PSD files and populate empty print locations">
                  {costingPull.pulling ? "Pulling…" : "Pull from PSDs"}
                </button>
                <button onClick={onRequest}
                  style={{height:30,padding:"0 12px",borderRadius:7,fontSize:11,fontWeight:600,cursor:"pointer",background:"transparent",border:`1px solid ${T.accent}`,color:T.accent,fontFamily:font}}
                  title="Send a quote request to a decorator">
                  Request Pricing
                </button>
                <button onClick={onLock}
                  style={{height:30,padding:"0 14px",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",border:"none",fontFamily:font,background:locked?T.surface:T.green,color:locked?T.muted:"#fff"}}>
                  {locked?"Unlock Pricing":"Lock In Pricing"}
                </button>
              </div>
            );
          })()}
        </div>

        {/* Quiet metadata strip — single line, wraps if needed. */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:6,flexWrap:"wrap",fontSize:11,color:T.muted}}>
          {/* Phase (and its detail) now live in the status bar — dropped from the metadata line. */}
          {job.priority==="rush" && <span style={{fontSize:10,fontWeight:700,color:T.amber,letterSpacing:"0.06em",textTransform:"uppercase"}}>Rush</span>}
          {job.priority==="hot" && <span style={{fontSize:10,fontWeight:700,color:T.red,letterSpacing:"0.06em",textTransform:"uppercase"}}>Hot</span>}
        </div>
      </div>
      <div style={{textAlign:"right",flexShrink:0}}>
        <div style={{fontFamily:mono,fontSize:isMobile?20:22,fontWeight:800,color:T.text,lineHeight:1.15,letterSpacing:"-0.02em"}}>{(job as any).type_meta?.qb_invoice_number || job.job_number}</div>
        {(job as any).type_meta?.qb_invoice_number && (
          <div style={{fontFamily:mono,fontSize:11,color:T.faint,marginTop:2}}>{job.job_number}</div>
        )}
      </div>
      </div>

      {/* V2 nav: status bar + build tabs. Drives switchTab (the save-and-navigate
          gate) so the costing save contract is preserved untouched. Gates map to
          the flow tabs; the warehouse tail routes to its pages. */}
      <JobFlowBar job={job} items={items} payments={payments} phaseView={phaseView} activeTab={tab}
        onGate={(k) => {
          const tabFor: Record<string, string> = { quote_sent: "quote", quote_appr: "proofs", invoice: "quote", paid: "proofs", order: "po" };
          const pageFor: Record<string, string> = { production: "/production", receiving: "/receiving", shipping: "/shipping", fulfillment: "/staging2" };
          if (tabFor[k]) switchTab(tabFor[k]); else if (pageFor[k]) router.push(pageFor[k]);
        }}
        onBuild={(t) => switchTab(t)} />

      {/* ── Sidebar + Content Layout (Y axis: items | content) ── */}
      <div style={{display:"flex",gap:0,minHeight:"calc(100vh - 240px)"}}>

        {/* ── Left Sidebar: Items list (only on builder + costing, hidden on mobile since editing is desktop-only) ──
            Sticky so a 26-item list stays in view while the user scrolls
            through a long costing card on the right. alignSelf:
            flex-start is required — default stretch defeats sticky. */}
        {!isMobile && (tab === "builder" || tab === "costing") && <div style={{width:220,flexShrink:0,borderRight:`1px solid ${T.border}`,background:T.card,alignSelf:"flex-start"}}>
          <div style={{padding:"8px 16px 6px",fontSize:9,fontWeight:700,color:T.faint,textTransform:"uppercase",letterSpacing:"0.08em"}}>
            Items ({items.length})
          </div>
          {/* Drag-to-reorder lives in the sidebar now (the right-side
              list was retired with the master-detail rework). Drag
              handle is the small grip on the left of each row; the
              rest of the row remains tappable to select the item.
              tab === "costing" doesn't disable drag — sort_order is
              the single source of truth across builder + costing. */}
          <DragDropContext onDragEnd={onSidebarDragEnd}>
            <Droppable droppableId="sidebar-items">
              {(dropProvided) => (
                <div ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
                  {items.map((item: any, i: number) => {
                    const proofOk = proofStatus[item.id]?.allApproved || item.artwork_status === "approved";
                    const hasBlanks = (item as any).blanks_order_cost != null;
                    const stage = item.pipeline_stage;
                    const isSelected = selectedItemId === item.id;
                    return (
                      <Draggable key={String(item.id)} draggableId={String(item.id)} index={i}>
                        {(dragProvided, snapshot) => (
                          <div ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            style={{
                              ...dragProvided.draggableProps.style,
                              background: snapshot.isDragging ? T.surface : (isSelected ? T.bg : T.card),
                              borderBottom: `1px solid ${T.border}`,
                              borderLeft: isSelected ? `3px solid ${T.accent}` : "3px solid transparent",
                              boxShadow: snapshot.isDragging ? "0 6px 16px rgba(0,0,0,0.12)" : "none",
                            }}>
                            <div
                              {...dragProvided.dragHandleProps}
                              onClick={() => { if (!snapshot.isDragging) setSelectedItemId(prev => prev === item.id ? null : item.id); }}
                              style={{
                                padding:"8px 12px 8px 16px", fontSize:12, display:"flex", alignItems:"center", gap:8,
                                cursor: snapshot.isDragging ? "grabbing" : "pointer",
                                userSelect: "none",
                              }}>
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
                              {/* Stage label + at-a-glance state dots — Blank · Art · Qtys.
                                  Green when satisfied, faint when missing. Lets the user
                                  scan the sidebar and see which items still need
                                  configuration without opening each one. */}
                              <div style={{fontSize:10,color:T.faint,marginTop:1,display:"flex",gap:8,alignItems:"center"}}>
                                <span>{stage === "shipped" ? "Shipped" : stage === "in_production" ? "At decorator" : proofOk && hasBlanks ? "Ready" : !item.blank_vendor ? "No blank" : (item.totalQty||0) === 0 ? "No qty" : proofOk ? "Proofs approved" : "Setup"}</span>
                                {(() => {
                                  const ok = (b: boolean) => ({ width:6, height:6, borderRadius:"50%", background: b ? T.green : T.border, flexShrink: 0 });
                                  const okB = !!item.blank_vendor;
                                  const okA = !!(item as any).hasFiles || stage === "in_production" || stage === "shipped" || proofOk;
                                  const okQ = ((item as any).totalQty || 0) > 0;
                                  return (
                                    <span title={`Blank ${okB ? "✓" : "—"}  ·  Art ${okA ? "✓" : "—"}  ·  Qtys ${okQ ? "✓" : "—"}`}
                                      style={{display:"inline-flex",alignItems:"center",gap:4}}>
                                      <span style={ok(okB)} />
                                      <span style={ok(okA)} />
                                      <span style={ok(okQ)} />
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                            {proofOk && <span style={{width:6,height:6,borderRadius:3,background:T.green,flexShrink:0}} />}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {dropProvided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>}

        {/* ── Content area ── */}
        <div style={{flex:1,minWidth:0,overflowY:"auto",padding:"0 20px 40px"}}>
      {/* Mobile editing-notice banner — every tab now has a mobile
          treatment, so the warning has nothing to gate on. Kept the
          dead branch as a comment so the next "this tab isn't mobile-
          friendly yet" case has an obvious place to land. */}
      {/* OVERVIEW */}
                  {tab==="overview"&&(
        <div style={{fontFamily:"'IBM Plex Sans','Helvetica Neue',Arial,sans-serif"}}>

          {/* ⋯ actions moved to the header top-right. */}

          {/* Money summary lives on the Costing tab — no KPI/costing strip on the overview. */}

          {/* Section tiles — command-center style, packed with as much live
              summary as fits so you rarely open them. Click opens the OvModal
              editor. These sit above the production strip. */}
          {(() => {
            const tm:any = (job as any).type_meta||{};
            const route = (job as any).shipping_route||"ship_through";
            const routeLabel = route==="drop_ship"?"Drop ship":route==="stage"?"Stage":"Ship-through";
            const termsLabel = job.payment_terms ? job.payment_terms.replace(/_/g," ").replace(/\b\w/g,(c:string)=>c.toUpperCase()) : "—";
            const priLabel = (job.priority||"normal").toUpperCase();
            const priColor = job.priority==="hot"?T.red:job.priority==="rush"?T.amber:T.green;
            const shipRaw = job.target_ship_date||null;
            let shipLabel="—", shipSub:string|null=null, shipColor:string=T.muted;
            if (job.phase==="complete"){shipLabel="Complete";shipColor=T.green;}
            else if (job.phase==="cancelled"){shipLabel="Cancelled";shipColor=T.red;}
            else if (["fulfillment","shipping","receiving"].includes(job.phase)){shipLabel="At HPD";shipColor=T.green;}
            else if (shipRaw){const days=daysUntilDay(shipRaw) ?? 0;shipSub=fmtDay(shipRaw);shipLabel=days<0?`${Math.abs(days)}d over`:days===0?"Today":`In ${days}d`;shipColor=days<0?T.red:days<=3?T.amber:T.text;}
            const invoiceTotal=Number(tm.qb_total_with_tax)||(Number((job as any)?.costing_summary?.grossRev)+Number((job as any)?.costing_summary?.passthruTotal||0))||0;
            const paidSum=(payments||[]).filter((p:any)=>p.status==="paid"||p.status==="partial").reduce((a:number,p:any)=>a+(Number(p.amount)||0),0);
            const balance=Math.max(0,invoiceTotal-paidSum);
            const payState=paidSum>0.01&&balance<=0.01?"Paid":paidSum>0.01?"Partial":invoiceTotal>0?"Unpaid":"No invoice";
            const payColor=payState==="Paid"?T.green:payState==="Partial"?T.amber:invoiceTotal>0?T.red:T.muted;
            const units=items.reduce((a:number,it:any)=>a+tQty(it.qtys||{}),0);
            const gcolor=(s:string)=>["#243b6b","#3a9a22","#9a9aa2","#c0392b","#d4930f","#1a1a1a","#3a97ad","#7b4fb5"][(s||"x").split("").reduce((a:number,c:string)=>a+c.charCodeAt(0),0)%8];
            const iStatus=(it:any)=> it.forwarded_at?{s:"Forwarded",c:T.green}:it.received_at_hpd?{s:"Received",c:T.green}:it.pipeline_stage==="shipped"?{s:"Shipped from vendor",c:T.blue}:it.pipeline_stage==="in_production"?{s:"In production",c:T.amber}:((it as any).blanks_order_cost!=null||(it as any).blanks_order_number)?{s:"Blanks ordered",c:T.muted}:{s:"In setup",c:T.faint};
            const money=(n:number)=>"$"+Math.round(n||0).toLocaleString();
            const panelBtn:React.CSSProperties={textAlign:"left",background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px",cursor:"pointer",fontFamily:font,boxShadow:"0 1px 2px rgba(16,18,32,0.05)",transition:"all 0.12s"};
            const hov=(e:any,on:boolean)=>{e.currentTarget.style.borderColor=on?T.accent:T.border;};
            const Fact=({label,value,color}:{label:string;value:any;color?:string})=>(<div style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}><span style={{fontSize:8.5,color:T.faint,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>{label}</span><span style={{fontSize:13,fontWeight:600,color:color||T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value}</span></div>);
            return (
              // column-reverse so Details + Billing render ABOVE the gallery.
              <div style={{display:"flex",flexDirection:"column-reverse"}}>
                {/* What's in this job — the gallery. Click an item → the Items worksheet editor. */}
                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px",marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
                    <span style={{fontSize:14,fontWeight:800}}>What&apos;s in this job</span>
                    <span style={{fontSize:12,color:T.muted}}>{items.length} item{items.length!==1?"s":""} · {units.toLocaleString()} units</span>
                  </div>
                  {items.length===0 ? <div style={{fontSize:13,color:T.muted}}>No items yet.</div> :
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                    {items.map((it:any)=>{const st=iStatus(it);const gc=gcolor(it.garment_type||it.name);return (
                      <div key={it.id} onClick={()=>{setOvSection("items");setOvItemsVendor(null);}} style={{border:`1px solid ${T.border}`,borderRadius:11,overflow:"hidden",background:T.card,cursor:"pointer"}}>
                        <div style={{aspectRatio:"1",background:"#f2f2f4",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                          {thumbByItem[it.id]
                            ? <img src={`/api/files/thumbnail?id=${thumbByItem[it.id]}&thumb=1`} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />
                            : <div style={{width:"62%",height:"62%",borderRadius:14,background:gc,boxShadow:"0 2px 8px rgba(0,0,0,.12)"}} />}
                        </div>
                        <div style={{padding:"9px 11px 11px"}}>
                          <div style={{fontSize:12.5,fontWeight:800,lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{it.name||"Untitled"}</div>
                          <div style={{fontSize:10.5,color:T.muted,marginTop:3,fontFamily:mono}}>{tQty(it.qtys||{})} · {(it as any).sell_per_unit?money((it as any).sell_per_unit):"—"}/unit</div>
                          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.04em",color:st.c,marginTop:3}}>{st.s}</div>
                        </div>
                      </div>
                    );})}
                  </div>}
                </div>
                {/* Details + Billing & Contacts — open the same editors as before */}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(2,1fr)",gap:10,marginBottom:10}}>
                  <button onClick={()=>setOvSection("details")} style={panelBtn} onMouseEnter={e=>hov(e,true)} onMouseLeave={e=>hov(e,false)}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}><span style={{fontSize:9.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:T.faint}}>Details</span><span style={{fontSize:15,color:T.faint,lineHeight:1}}>›</span></div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
                      <Fact label="Ships" value={shipLabel+(shipSub?` · ${shipSub}`:"")} color={shipColor} />
                      <Fact label="Route" value={routeLabel} />
                      <Fact label="Terms" value={termsLabel} />
                      <Fact label="Priority" value={priLabel} color={priColor} />
                    </div>
                  </button>
                  <button onClick={()=>setOvSection("billing")} style={panelBtn} onMouseEnter={e=>hov(e,true)} onMouseLeave={e=>hov(e,false)}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}><span style={{fontSize:9.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:T.faint}}>Billing &amp; Contacts</span><span style={{fontSize:15,color:T.faint,lineHeight:1}}>›</span></div>
                    <div style={{fontSize:16,fontWeight:800,color:payColor,marginBottom:8}}>{payState}{invoiceTotal>0 && <span style={{fontSize:12,fontWeight:600,color:T.muted}}> · ${Math.round(paidSum).toLocaleString()} / ${Math.round(invoiceTotal).toLocaleString()}</span>}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {contacts.length===0 && <span style={{fontSize:12,color:T.muted}}>No contacts</span>}
                      {contacts.slice(0,3).map((c:any)=>(
                        <div key={c.id} style={{display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                          <span style={{fontWeight:600,color:T.text,fontSize:12.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}{(c.role_on_job==="primary"||c.role_on_job==="billing") && <span style={{fontWeight:400,color:T.faint,textTransform:"capitalize"}}> · {c.role_on_job}</span>}</span>
                          {c.email && <span style={{fontSize:11.5,color:T.accent,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.email}</span>}
                        </div>
                      ))}
                      {contacts.length>3 && <span style={{fontSize:11,color:T.faint}}>+{contacts.length-3} more</span>}
                    </div>
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Production strip — mirrors the per-project row on /production.
              Same visual + decorator chip behavior; clicking a chip
              deep-links to /production with the modal pre-opened on this
              project + vendor. Only renders when the job is actually in
              production / receiving / fulfillment phases. */}
          {(() => {
            // Visibility mirrors /production page — active phases plus
            // shipping (ship_through outbound) and recently complete so
            // the chips stay visible as a quick-jump from shipped jobs.
            if (!job || !["production","receiving","fulfillment","shipping","complete"].includes(job.phase)) return null;
            // Group items by decorator (matches shapeProjectGroup in /production).
            type DG = { decoratorId: string|null; decoratorName: string; shortCode: string; items: any[]; inProduction: number; shipped: number; totalUnits: number; };
            const poSentVendors = (job as any).type_meta?.po_sent_vendors || [];
            const costProds = (job as any).costing_data?.costProds || [];
            const groups: DG[] = [];
            for (const it of items) {
              const assignment = (it as any).decorator_assignments?.[0];
              // Include PO-sent items even if pipeline_stage drifted null (the
              // stage advance is racy — see project_pipeline_stage_po_sent_drift).
              // Mirrors the /production page so the strip never silently hides a
              // vendor that's actually in production.
              const poSent = poSentToItem({ printVendor: costProds.find((c: any) => c?.id === it.id)?.printVendor, decoratorName: assignment?.decorators?.name, decoratorShortCode: assignment?.decorators?.short_code, poSentVendors });
              if (it.pipeline_stage !== "in_production" && it.pipeline_stage !== "shipped" && !poSent) continue;
              const decName = assignment?.decorators?.name || it.decorator || "Unassigned";
              const decId = assignment?.decorator_id || assignment?.decorators?.id || null;
              const shortCode = assignment?.decorators?.short_code || "";
              const decKey = decId || decName;
              let g = groups.find(x => (x.decoratorId || x.decoratorName) === decKey);
              if (!g) { g = { decoratorId: decId, decoratorName: decName, shortCode, items: [], inProduction: 0, shipped: 0, totalUnits: 0 }; groups.push(g); }
              const totalUnits = Object.values(it.qtys || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
              g.items.push(it);
              g.totalUnits += totalUnits;
              if (it.pipeline_stage === "shipped") g.shipped++; else g.inProduction++;
            }
            if (groups.length === 0) return null;
            const allShipped = groups.every(g => g.items.every((it: any) => it.pipeline_stage === "shipped"));

            return (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Production</div>
                  {allShipped && <div style={{ fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase" }}>All Shipped</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {groups.map(g => {
                    const decKey = g.decoratorId || g.decoratorName;
                    // A fully-shipped vendor has nothing actionable on
                    // the production page — clicking would land on a
                    // blank list (items filtered out). Render it as a
                    // muted, non-clickable chip; the data is still
                    // visible (item / shipped counts) for context.
                    const fullyShipped = g.inProduction === 0 && g.shipped > 0;
                    if (fullyShipped) {
                      return (
                        <div key={decKey}
                          title="All items shipped from this vendor"
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "7px 14px", borderRadius: 6, background: T.surface,
                            fontSize: 11, border: `1px solid ${T.border}`, cursor: "default",
                            fontFamily: font, opacity: 0.65,
                          }}>
                          <span style={{ fontWeight: 600, color: T.text }}>{g.shortCode || g.decoratorName}</span>
                          <span style={{ color: T.muted }}>{g.items.length} item{g.items.length !== 1 ? "s" : ""}</span>
                          <span style={{ color: T.faint }}>·</span>
                          <span style={{ color: T.green }}>{g.shipped} shipped</span>
                        </div>
                      );
                    }
                    return (
                      <button key={decKey}
                        onClick={() => { setOvSection("items"); setOvItemsVendor(g.decoratorName); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "7px 14px", borderRadius: 6, background: T.surface,
                          fontSize: 11, border: `1px solid ${T.border}`, cursor: "pointer",
                          fontFamily: font, transition: "all 0.12s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = T.accentDim; e.currentTarget.style.borderColor = T.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.background = T.surface; e.currentTarget.style.borderColor = T.border; }}>
                        <span style={{ fontWeight: 600, color: T.text }}>{g.shortCode || g.decoratorName}</span>
                        <span style={{ color: T.muted }}>{g.items.length} item{g.items.length !== 1 ? "s" : ""}</span>
                        <span style={{ color: T.faint }}>·</span>
                        {g.inProduction > 0 && <span style={{ color: T.accent }}>{g.inProduction} active</span>}
                        {g.shipped > 0 && <span style={{ color: T.green }}>{g.shipped} shipped</span>}
                      </button>
                    );
                  })}
                </div>
                {/* Inbound boxes — live carrier status per vendor (EasyPost,
                    Phase 3). Flat text, no pills. delivered ≠ received. */}
                {inboundBoxes.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10, paddingTop: 9, borderTop: `1px solid ${T.border}` }}>
                    {(() => {
                      const byDec = new Map<string, any[]>();
                      for (const b of inboundBoxes) { const k = b.decorator_id || "?"; if (!byDec.has(k)) byDec.set(k, []); byDec.get(k)!.push(b); }
                      return Array.from(byDec.values()).map((boxes) => {
                        const vName = boxes[0]?.decorators?.short_code || boxes[0]?.decorators?.name || "Vendor";
                        const received = boxes.filter(b => b.status === "received").length;
                        const dock = boxes.filter(b => b.status !== "received" && b.delivered_at);
                        const transit = boxes.filter(b => b.status !== "received" && !b.delivered_at);
                        const nextEta = transit.map(b => b.est_delivery_date).filter(Boolean).sort()[0] || null;
                        const oldestDock = dock.map(b => b.delivered_at).sort()[0];
                        const dockAgeH = oldestDock ? (Date.now() - new Date(oldestDock).getTime()) / 36e5 : 0;
                        const dockColor = dockAgeH >= 48 ? T.red : T.amber;
                        return (
                          <div key={boxes[0]?.decorator_id || vName} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                            <span style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>Boxes · {vName}:</span>
                            <span style={{ color: T.muted, fontWeight: 600 }}>{boxes.length} box{boxes.length !== 1 ? "es" : ""}</span>
                            {received > 0 && <span style={{ color: T.green, fontWeight: 700 }}>· {received} received ✓</span>}
                            {dock.length > 0 && <span style={{ color: dockColor, fontWeight: 700 }} title="Carrier says delivered — nobody has counted these in yet">· {dock.length} on the dock — not received</span>}
                            {transit.length > 0 && <span style={{ color: T.muted, fontWeight: 600 }}>· {transit.length} in transit{nextEta ? ` · next est ${fmtDay(nextEta)}` : ""}</span>}
                            <Link href="/receiving2" style={{ color: T.blue, fontWeight: 700, textDecoration: "none" }}>Receiving →</Link>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Documents — always-visible action row (Quote / Invoice / Packing
              Slip / Art / PO / Portal). Sits below the production strip. */}
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Documents</div>
            {(()=>{
              const docVendors = [...new Set(((job as any).costing_data?.costProds||[]).map((p:any)=>p.printVendor).filter(Boolean))] as string[];
              const qbInvNum = (job as any).type_meta?.qb_invoice_number;
              const hasItems = items.length > 0;
              const hasShipping = items.some((it:any)=>it.ship_tracking||it.received_at_hpd||it.pipeline_stage==="shipped");
              const docBtn = (label: string, src: string|null, available: boolean, onClickOverride?: () => void) => (
                <button key={label}
                  onClick={()=>{ if (onClickOverride) { onClickOverride(); return; } if(available && src) setPdfPreview({src,title:label,downloadHref:src+(src.includes("?")?"&":"?")+"download=1"}); }}
                  disabled={!available}
                  title={available?undefined:"Not available yet"}
                  style={{padding:"7px 14px",borderRadius:6,border:`1px solid ${T.border}`,background:available?T.surface:T.bg,color:available?T.text:T.faint,fontSize:11,fontWeight:600,fontFamily:font,cursor:available?"pointer":"default",whiteSpace:"nowrap"}}
                  onMouseEnter={e=>{if(available){e.currentTarget.style.borderColor=T.accent;}}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;}}>
                  {label}
                </button>
              );
              return (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
                  {docBtn("Quote", `/api/pdf/quote/${job.id}`, hasItems)}
                  {docBtn(qbInvNum?`Invoice #${qbInvNum}`:"Invoice", `/api/pdf/invoice/${job.id}`, hasItems)}
                  {forwardSlips.length > 0
                    ? forwardSlips.map((s, i) => docBtn(`Packing Slip · ${s.tracking || (i + 1)}`, `/api/pdf/packing-slip/${job.id}?shipment=${s.id}`, true))
                    : docBtn("Packing Slip", `/api/pdf/packing-slip/${job.id}`, hasShipping)}
                  {docBtn("Art Files", null, true, () => setShowArtFiles(true))}
                  {docVendors.length === 0 && docBtn("PO", null, false)}
                  {docVendors.map(v => docBtn(`PO — ${v}`, `/api/pdf/po/${job.id}?vendor=${encodeURIComponent(v)}`, hasItems))}
                  {(job as any).portal_token && (
                    <button onClick={()=>setPortalOpen(true)}
                      style={{marginLeft:"auto",padding:"6px 14px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,fontSize:11,fontFamily:font,fontWeight:600,cursor:"pointer"}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.color=T.accent;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.muted;}}>
                      Client Portal
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {ovSection==="details" && (<OvModal title="Details" onClose={()=>setOvSection(null)}>
          {/* Shipping + Project info — 3 equal columns. Project info
              on the left (what + who); From-client middle; HPD plan
              right. Contacts swapped out to its own card below the
              Documents row so it sits next to Payments. */}
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:14,alignItems:"start"}}>
              {/* Col 1: Project info (stacked — Client, Memo, Notes) */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Project info</div>
                <div style={{position:"relative"}} ref={clientDropdownRef}>
                  <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Client</label>
                  <input style={ic} value={clientQuery} onChange={e=>{setClientQuery(e.target.value);setShowClientDropdown(true);}}
                    onFocus={()=>setShowClientDropdown(true)} placeholder="Search or assign client..."/>
                  {showClientDropdown&&clientQuery.trim().length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,maxHeight:200,overflowY:"auto",marginTop:4}}>
                      {clientResults.map(c=>(
                        <div key={c.id} onClick={async()=>{
                          await supabase.from("jobs").update({client_id:c.id}).eq("id",job.id);
                          await swapJobContactsForClient(c.id);
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
                          await swapJobContactsForClient(newClient.id);
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
                <div>
                  <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Project memo <span style={{color:T.faint,fontWeight:400}}>(Client PO, etc)</span></label>
                  <input style={ic} value={job.title} placeholder="Optional description..." onChange={e=>upd("title",e.target.value)}/>
                </div>
                <div>
                  <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Project notes</label>
                  <textarea style={{...ic,minHeight:54,resize:"vertical",lineHeight:1.4}} value={job.notes||""} onChange={e=>upd("notes",e.target.value)}/>
                </div>
              </div>

              {/* Col 2: Client-provided info — When + Where */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:0}}>From client</div>
                <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Requested in-hands date <span style={{color:T.faint,fontWeight:400}}>(internal)</span></label><input style={{...ic,height:34,cursor:"pointer",colorScheme:"dark",display:"block",WebkitAppearance:"none",MozAppearance:"none",appearance:"none"}} type="date" value={job.target_ship_date||""} onClick={e=>(e.target as HTMLInputElement).showPicker?.()} onChange={e=>{
                  const ship = e.target.value;
                  const updates: any = { target_ship_date: ship };
                  if (ship) updates.priority = calculatePriority(ship);
                  setJob(j => j ? {...j, ...updates} : j);
                  saveJob(updates);
                }}/></div>
                <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Client delivery address</label>
                  <textarea style={{...ic,minHeight:90,resize:"vertical",lineHeight:1.4}} value={job.type_meta?.venue_address||""} onChange={e=>upd("type_meta",{...job.type_meta,venue_address:e.target.value})}/>
                </div>
              </div>

              {/* Col 3: HPD-side decisions — How + Extras */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:0}}>HPD plan</div>
                <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Shipping route</label>
                  <select style={{...ic,height:34}} value={(job as any).shipping_route||"ship_through"} onChange={e=>upd("shipping_route",e.target.value)}>
                    {allowedRoutes.includes("drop_ship") && <option value="drop_ship">Drop ship (direct to client)</option>}
                    {allowedRoutes.includes("ship_through") && <option value="ship_through">Ship-through (forward from HPD)</option>}
                    {allowedRoutes.includes("stage") && <option value="stage">Stage (fulfillment from HPD)</option>}
                  </select>
                </div>
                <div><label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Shipping notes</label>
                  <textarea style={{...ic,minHeight:90,resize:"vertical",lineHeight:1.4}} value={job.type_meta?.shipping_notes||""} onChange={e=>upd("type_meta",{...job.type_meta,shipping_notes:e.target.value})}/>
                </div>
                <div style={{display:"flex",alignItems:"flex-start",gap:7,marginTop:2}}>
                  <input type="checkbox" checked={!!(job as any).is_inventory} onChange={e=>upd("is_inventory",e.target.checked)} style={{marginTop:2,cursor:"pointer",flexShrink:0}}/>
                  <span style={{fontSize:11,color:T.muted,lineHeight:1.35}}>Inventory / stock buy <span style={{color:T.faint,fontWeight:400}}>(bulk blanks for future jobs). Excluded from revenue &amp; margin; cost rides the jobs that sell them.</span></span>
                </div>
              </div>
            </div>
          </div>

          </OvModal>)}

          {ovSection==="billing" && (<OvModal title="Billing & Contacts" onClose={()=>setOvSection(null)}>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,alignItems:"stretch"}}>
            {/* Left column: Contacts (moved from the top 3-col block
                so it sits next to Payments — Project info now lives
                above with the From-client + HPD-plan group). */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",flex:1}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:6}}>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Contacts</div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={async()=>{
                      if(!job?.client_id) return;
                      const {data:clientContacts} = await supabase.from("contacts").select("id, is_primary").eq("client_id",job.client_id);
                      const have = new Set(contacts.map((c:any)=>c.id));
                      const missing = (clientContacts||[]).filter((c:any)=>!have.has(c.id));
                      if(missing.length===0){alert("All client contacts are already on this project.");return;}
                      const {error} = await supabase.from("job_contacts").insert(missing.map((c:any)=>({job_id:job.id,contact_id:c.id,role_on_job:c.is_primary?"primary":"cc"})));
                      if(error){alert(`Couldn't sync contacts: ${error.message}`);return;}
                      loadData();
                    }} title="Pull in any client contacts that aren't yet on this project" style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:10,padding:"2px 8px",cursor:"pointer"}}>Sync</button>
                    <button onClick={()=>setJob(j=>j?{...j,_addContact:!(j as any)._addContact} as any:j)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:10,padding:"2px 8px",cursor:"pointer"}}>+ Add</button>
                  </div>
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
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {contacts.map((c,i)=>(
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,paddingBottom:i<contacts.length-1?8:0,borderBottom:i<contacts.length-1?`1px solid ${T.border}`:"none"}}>
                      <div style={{width:34,height:34,borderRadius:"50%",background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:T.accent,flexShrink:0}}>
                        {c.name.split(" ").map((n:string)=>n[0]).join("").slice(0,2)}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name} <span style={{fontWeight:400,color:T.muted,fontSize:12}}>· {c.role_label} · {c.role_on_job}</span></div>
                        {c.email&&<div style={{fontSize:12,color:T.accent,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.email}</div>}
                      </div>
                      <button onClick={async()=>{
                        await supabase.from("job_contacts").delete().eq("job_id",job.id).eq("contact_id",c.id);
                        loadData();
                      }} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:13,padding:"0 4px"}}
                        onMouseEnter={e=>e.currentTarget.style.color=T.red}
                        onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Right column: Contacts, Email, Items */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>

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
                    || (Number((job as any)?.costing_summary?.grossRev) + Number((job as any)?.costing_summary?.passthruTotal || 0))
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

            </div>
          </div>
          </OvModal>)}

          {ovSection==="items" && (<OvModal title="Items" onClose={()=>setOvSection(null)}>
          {/* Items — worksheet-style row (name · qty · status · ETA).
              ETA writes to items.client_eta — the same column the
              client-detail worksheet, ProductionTab, and /production
              all edit. All four surfaces stay in sync via that column. */}
          <JobItemsList items={items} job={job} isMobile={isMobile} onChange={reloadItems} vendorFilter={ovItemsVendor} onClearVendor={()=>setOvItemsVendor(null)} />
          </OvModal>)}

          {/* Action row moved to the ⋯ menu at the top of the overview. */}

          {/* Activity — collapsed into a modal, opened by the Activity Log
              button in the action row above. (The outbound-email test panel was
              removed; email events already post to this activity feed.) */}
          {ovSection==="activity" && (<OvModal title="Activity" onClose={()=>setOvSection(null)}>
            <JobActivityPanel jobId={job.id} currentUserId={currentUserId} profiles={teamProfiles} />
          </OvModal>)}

          {/* Client portal preview modal — iframes the client's
              read-only view of this job so you can see exactly what
              they see + copy/open the live URL without leaving. */}
          {portalOpen && (job as any).portal_token && (
            <div onClick={()=>setPortalOpen(false)}
              style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
              <div onClick={e=>e.stopPropagation()}
                style={{background:T.card,borderRadius:12,width:"100%",maxWidth:760,height:"90vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 16px 48px rgba(0,0,0,0.5)"}}>
                <div style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexShrink:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text}}>Client Portal</div>
                    <div style={{fontSize:11,color:T.faint,fontFamily:mono,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {`${appBaseUrlSync()}/portal/${(job as any).portal_token}`}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                    <button onClick={()=>{
                      navigator.clipboard.writeText(`${appBaseUrlSync()}/portal/${(job as any).portal_token}`);
                      setPortalCopied(true);
                      setTimeout(()=>setPortalCopied(false),2000);
                    }}
                      style={{padding:"4px 10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,color:portalCopied?T.green:T.muted,fontSize:11,fontFamily:font,fontWeight:600,cursor:"pointer"}}>
                      {portalCopied?"Copied":"Copy link"}
                    </button>
                    <a href={`${appBaseUrlSync()}/portal/${(job as any).portal_token}`} target="_blank" rel="noopener noreferrer"
                      style={{padding:"4px 10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,fontSize:11,fontFamily:font,fontWeight:600,cursor:"pointer",textDecoration:"none"}}>
                      Open in tab
                    </a>
                    <button onClick={()=>setPortalOpen(false)}
                      style={{padding:"4px 10px",background:"transparent",border:"none",color:T.muted,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>
                  </div>
                </div>
                <iframe
                  src={`${appBaseUrlSync()}/portal/${(job as any).portal_token}`}
                  style={{flex:1,width:"100%",border:"none"}}
                />
              </div>
            </div>
          )}

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
          hideToolbar={!isMobile}
          actionsRef={costingActionsRef}
          onPullStateChange={handleCostingPull}
          selectedItemId={selectedItemId}
          onSelectItem={(id: string) => setSelectedItemId(prev => prev === id ? null : id)}
          onUpdateProject={(updates: any) => setJob(j => j ? {...j, ...updates} : j)}
        />
      )}

      {tab==="quote"&&(
        <>
        <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:12,alignItems:"flex-start",maxWidth:1080,margin:"0 auto"}}>
        {/* Step 1: Quote details + Send Quote — comes first since you
            send to the client before they can approve. */}
        <div style={{flex:isMobile?"0 0 auto":"2 1 460px",minWidth:0,width:isMobile?"100%":undefined}}>
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
        </div>
        {/* Step 2: Approve Quote — internal confirmation once the
            client signs off on the sent quote. */}
        <div style={{flex:isMobile?"0 0 auto":"1 1 380px",minWidth:0,width:isMobile?"100%":undefined}}>
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
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
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
              }} style={{display:"block",fontSize:13,fontWeight:700,color:"#fff",background:T.green,border:"none",borderRadius:8,padding:"10px 22px",cursor:"pointer",width:"100%",boxSizing:"border-box",boxShadow:"0 1px 2px rgba(0,0,0,0.06)"}}>Approve Quote</button>
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
        </div>
        </>
      )}
      {tab==="blanks"&&(
        <BlanksTab items={items} job={job} payments={payments} onRecalcPhase={recalcPhase} onUpdateItem={(id: string, updates: any) => setItems(prev => prev.map(it => it.id === id ? {...it, ...updates} : it))} onTabClick={switchTab} onRegisterSave={(fn: () => Promise<void>) => { saveBlanksRef.current = fn; }} onItemsChanged={reloadItems} />
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
        </div>{/* end tab content */}
        {/* ── Right rail: Project Totals (costing only) ──
            Sits at the outer flex level so it never moves with item
            selection or center-column scrolling. CostingTab portals
            its totals JSX into this container via #costing-totals-rail. */}
        {!isMobile && tab === "costing" && (
          <div style={{width:220,flexShrink:0,borderLeft:`1px solid ${T.border}`,background:T.card,alignSelf:"flex-start",position:"sticky",top:0}}>
            <div style={{padding:"8px 16px 6px",fontSize:9,fontWeight:700,color:T.faint,textTransform:"uppercase",letterSpacing:"0.08em"}}>
              Margin
            </div>
            <div id="costing-totals-rail" style={{padding:"0 12px 12px"}} />
          </div>
        )}
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
        open={confirmCancelVoid}
        title="Cancel & void invoice"
        message={`Cancel "${job?.title}" and void QB invoice ${(job as any)?.type_meta?.qb_invoice_number ? "#" + (job as any).type_meta.qb_invoice_number : ""} in QuickBooks? The invoice is kept at $0 in QB's records. Blocked if any payment is recorded.`}
        confirmLabel={cancelling ? "Voiding…" : "Cancel & void"}
        onConfirm={async () => {
          if (cancelling) return;
          setCancelling(true);
          try {
            const res = await fetch("/api/qb/void-invoice", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobId: params.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to cancel & void");
            setJob(j => j ? ({ ...j, phase: "cancelled" } as any) : j);
            setConfirmCancelVoid(false);
          } catch (e: any) {
            alert(e?.message || "Failed to cancel & void");
          } finally {
            setCancelling(false);
          }
        }}
        onCancel={() => { if (!cancelling) setConfirmCancelVoid(false); }}
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
          escapeTo("/jobs");
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
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {loading && <div style={{ fontSize: 12, color: T.muted, textAlign: "center", padding: 30 }}>Loading…</div>}
          {!loading && items.length === 0 && (
            <div style={{ fontSize: 12, color: T.faint, textAlign: "center", padding: 30 }}>No items on this project.</div>
          )}
          {!loading && items.map(it => {
            const files = (filesByItem[it.id] || []).filter((f: any) => f.stage === "mockup" || f.stage === "proof" || f.stage === "print_ready");
            if (files.length === 0) return null;
            return (
              <div key={it.id} style={{ marginBottom: 26 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12, textAlign: "center" }}>{it.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, 220px)", justifyContent: "center", gap: 14 }}>
                  {files.map((f: any) => (
                    <div key={f.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                      <a href={`/api/files/thumbnail?id=${f.drive_file_id}`} target="_blank" rel="noopener noreferrer"
                        title="Open preview"
                        style={{ background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", height: 170, overflow: "hidden", textDecoration: "none" }}>
                        <img src={`/api/files/thumbnail?id=${f.drive_file_id}&thumb=1`} alt={f.file_name}
                          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/>
                      </a>
                      <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: `1px solid ${T.border}` }}>
                        <span style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{f.stage.replace(/_/g, " ")}</span>
                        <a href={`/api/files/thumbnail?id=${f.drive_file_id}&dl=1`} download
                          title="Download file"
                          style={{ fontSize: 10, fontWeight: 700, color: T.accent, textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                          ↓ Download
                        </a>
                      </div>
                    </div>
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
