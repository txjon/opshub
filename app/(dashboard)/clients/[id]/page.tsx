"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkeletonRows } from "@/components/Skeleton";
import { QBCustomerChooser, type QBCurrent } from "@/components/QBCustomerChooser";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { effectiveRevenue } from "@/lib/revenue";
import { logJobActivity } from "@/components/JobActivityPanel";
import { resolveItemStatus, STATE_LABELS, type ItemState } from "@/lib/item-status";

type Client = { id:string; name:string; client_type:string|null; default_terms:string|null; notes:string|null; website:string|null; billing_address:string|null; shipping_address:string|null; tax_exempt:boolean; allow_cc?:boolean; allow_ach?:boolean; qb_customer_id?:string|null; client_hub_enabled?:boolean; portal_token?:string|null; company_id?:string|null; };
type Contact = { id:string; name:string; email:string|null; phone:string|null; role_label:string|null; is_primary:boolean; };
type ClientFile = { id:string; file_name:string; drive_file_id:string|null; drive_link:string|null; mime_type:string|null; file_size:number|null; kind:string; notes:string|null; created_at:string; };
type Job = { id:string; title:string; job_number:string; phase:string; target_ship_date:string|null; costing_summary:any; items:any[]; payment_records:any[]; };

const PHASE_COLORS: Record<string,{bg:string,text:string}> = {
  intake:{bg:T.accentDim,text:T.accent}, pending:{bg:T.amberDim,text:"#a07008"},
  ready:{bg:T.amberDim,text:"#a07008"}, production:{bg:T.blueDim,text:"#3a8a9e"},
  receiving:{bg:T.blueDim,text:"#3a8a9e"}, fulfillment:{bg:T.purpleDim,text:"#c4207a"},
  complete:{bg:T.greenDim,text:T.green}, on_hold:{bg:T.redDim,text:T.red},
  cancelled:{bg:T.faint,text:T.muted},
};
const ic = {width:"100%",padding:"6px 10px",border:`1px solid ${T.border}`,borderRadius:6,background:T.surface,color:T.text,fontSize:"13px",fontFamily:font,boxSizing:"border-box" as const,outline:"none"};

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const router = useRouter();
  const [client, setClient] = useState<Client|null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addingContact, setAddingContact] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Contact|null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<ClientFile|null>(null);
  const [previewFile, setPreviewFile] = useState<ClientFile|null>(null);
  const [itemThumbs, setItemThumbs] = useState<Record<string, string>>({});
  const [historyView, setHistoryView] = useState<"projects"|"items">("projects");
  const [itemViewMode, setItemViewMode] = useState<"list"|"tiles">("list");
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [workingExpanded, setWorkingExpanded] = useState(true);
  const [workingTab, setWorkingTab] = useState<"setup"|"in_production"|"shipped"|"in_stock"|"complete"|"archived">("in_production");
  const [workingRowExpanded, setWorkingRowExpanded] = useState<string|null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const itemSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [portalCopied, setPortalCopied] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  // QB customer link state. Loaded once per page render so the row can
  // show the current QB DisplayName instead of a raw id; the chooser
  // dialog uses its own GET when opened so search re-queries don't
  // round-trip through this state.
  const [qbLinked, setQbLinked] = useState<QBCurrent | "loading">("loading");
  const [qbChooserOpen, setQbChooserOpen] = useState(false);
  const [qbBusy, setQbBusy] = useState(false);
  const [qbMsg, setQbMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Active tenant's payment provider — gates QB-specific UI on this
  // page (QuickBooks customer link + QB-branded payment toggles).
  // Stripe-backed tenants (IHM) hide those entirely; the allow_cc/ach
  // toggles still apply to Stripe but are surfaced under generic
  // "Online Payment Methods" copy.
  const [paymentProvider, setPaymentProvider] = useState<"quickbooks" | "stripe" | null>(null);

  useEffect(() => { load(); }, [params.id]);

  useEffect(() => {
    (async () => {
      if (!client?.company_id) return;
      const { data } = await supabase
        .from("companies")
        .select("default_payment_provider")
        .eq("id", (client as any).company_id)
        .single();
      setPaymentProvider(((data as any)?.default_payment_provider as any) || "quickbooks");
    })();
  }, [(client as any)?.company_id]);

  async function loadQbLink() {
    if (paymentProvider && paymentProvider !== "quickbooks") {
      setQbLinked(null);
      return;
    }
    setQbLinked("loading");
    try {
      const res = await fetch(`/api/qb/link-customer?clientId=${params.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Lookup failed");
      setQbLinked(data.current ?? null);
    } catch {
      setQbLinked(null);
    }
  }
  useEffect(() => { loadQbLink(); }, [params.id, paymentProvider]);

  async function handleQbAction(a: { type: "select"; qbCustomerId: string; displayName: string } | { type: "create_new" } | { type: "unlink" }) {
    if (qbBusy) return;
    setQbBusy(true); setQbMsg(null);
    try {
      if (a.type === "select") {
        const res = await fetch("/api/qb/link-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: params.id, qbCustomerId: a.qbCustomerId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Link failed");
        setQbLinked(data.current ?? null);
        setQbChooserOpen(false);
        setQbMsg({ ok: true, text: `Linked to "${data.current?.displayName || a.displayName}".` });
      } else if (a.type === "create_new") {
        const res = await fetch("/api/qb/link-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: params.id, createNew: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Create failed");
        setQbLinked(data.current ?? null);
        setQbChooserOpen(false);
        setQbMsg({ ok: true, text: `Created new QuickBooks customer "${data.current?.displayName}".` });
      } else if (a.type === "unlink") {
        const res = await fetch("/api/qb/link-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: params.id, qbCustomerId: null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Unlink failed");
        setQbLinked(null);
        setQbMsg({ ok: true, text: "Unlinked. Next push will re-run the smart match." });
      }
    } catch (e: any) {
      setQbMsg({ ok: false, text: e.message || "Operation failed" });
    } finally {
      setQbBusy(false);
    }
  }

  useEffect(() => {
    if (!previewFile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPreviewFile(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewFile]);

  async function load() {
    setLoading(true);
    const [cRes, ctRes, jRes] = await Promise.all([
      supabase.from("clients").select("*").eq("id", params.id).single(),
      supabase.from("contacts").select("*").eq("client_id", params.id).order("name"),
      supabase.from("jobs").select("*, costing_summary, type_meta, shipping_route, phase_timestamps, items(id, name, blank_vendor, blank_sku, cost_per_unit, sell_per_unit, blank_costs, sort_order, pipeline_stage, working_status, client_retail_per_unit, client_eta, notes, received_at_hpd, blanks_order_cost, archived_at, completed_at, decorator_assignments(decorators(name, short_code)), buy_sheet_lines(size, qty_ordered)), payment_records(amount, status, due_date)").eq("client_id", params.id).order("created_at", { ascending: false }),
    ]);
    if (cRes.data) setClient(cRes.data);
    if (ctRes.data) setContacts(ctRes.data as Contact[]);
    if (jRes.data) setJobs(jRes.data as Job[]);
    setLoading(false);
    loadFiles();
    // Item thumbnails for the Working Sheet — mirrors the portal items
    // API's resolution order (mockup > proof > print_ready, newest of
    // each, non-superseded). Ranked so the most-client-presentable
    // image wins per item.
    if (jRes.data) {
      const itemIds = (jRes.data as Job[]).flatMap(j => (j.items || []).map((it: any) => it.id));
      if (itemIds.length > 0) {
        supabase.from("item_files")
          .select("item_id, stage, drive_file_id, created_at")
          .in("item_id", itemIds)
          .in("stage", ["mockup", "proof", "print_ready"])
          .is("superseded_at", null)
          .not("drive_file_id", "is", null)
          .order("created_at", { ascending: false })
          .then(({ data }) => {
            const rank: Record<string, number> = { mockup: 3, proof: 2, print_ready: 1 };
            const bestRank: Record<string, number> = {};
            const best: Record<string, string> = {};
            for (const f of (data || []) as any[]) {
              const r = rank[f.stage] || 0;
              if (r > (bestRank[f.item_id] || 0)) {
                bestRank[f.item_id] = r;
                best[f.item_id] = f.drive_file_id;
              }
            }
            setItemThumbs(best);
          });
      }
    }
  }

  async function loadFiles() {
    try {
      const r = await fetch(`/api/clients/${params.id}/files`);
      if (!r.ok) return;
      const d = await r.json();
      setFiles(d.files || []);
    } catch {}
  }

  async function uploadFile(file: File, kind: string) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const r = await fetch(`/api/clients/${params.id}/files`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Upload failed");
      } else {
        loadFiles();
      }
    } catch (e: any) {
      alert(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deleteFile(fileId: string) {
    try {
      await fetch(`/api/clients/${params.id}/files?fileId=${fileId}`, { method: "DELETE" });
      loadFiles();
    } catch {}
  }

  const pendingClientUpdates = useRef<Partial<Client>>({});
  function updateClient(updates: Partial<Client>) {
    setClient(c => c ? {...c, ...updates} : c);
    pendingClientUpdates.current = {...pendingClientUpdates.current, ...updates};
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const merged = pendingClientUpdates.current;
      pendingClientUpdates.current = {};
      try { await supabase.from("clients").update(merged).eq("id", params.id); }
      catch (e) { console.error("Client save failed:", e); }
      // If client name was edited and a Drive folder exists, rename
      // it in place so future uploads stay in the same folder.
      if (typeof (merged as any).name === "string") {
        try {
          await fetch("/api/drive/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity: "client", id: params.id, name: (merged as any).name }),
          });
        } catch { /* non-fatal */ }
      }
    }, 1500);
  }

  // Toggle the client portal access. Mints a portal_token if missing
  // when enabling for the first time. Saves immediately (no debounce).
  async function togglePortal() {
    if (!client) return;
    const enabling = !client.client_hub_enabled;
    const updates: any = { client_hub_enabled: enabling };
    let token = client.portal_token || null;
    if (enabling && !token) {
      token = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
      updates.portal_token = token;
    }
    setClient(c => c ? { ...c, client_hub_enabled: enabling, portal_token: token } : c);
    await supabase.from("clients").update(updates).eq("id", client.id);
  }

  async function copyPortalLink() {
    if (!client?.portal_token) return;
    const url = `${window.location.origin}/portal/client/${client.portal_token}`;
    await navigator.clipboard.writeText(url);
    setPortalCopied(true);
    setTimeout(() => setPortalCopied(false), 2000);
  }

  if (loading) return (
    <div style={{padding:"2rem"}}>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <SkeletonRows rows={4} />
    </div>
  );
  if (!client) return <div style={{padding:"2rem",color:T.muted,fontSize:13}}>Client not found.</div>;

  const totalRev = jobs.reduce((a,j) => a + effectiveRevenue(j), 0);
  const totalUnits = jobs.reduce((a,j) => a + (j.items||[]).reduce((b: number,it: any) => b + (it.buy_sheet_lines||[]).reduce((c: number,l: any) => c + (l.qty_ordered||0), 0), 0), 0);
  const activeJobs = jobs.filter(j => !["complete","cancelled"].includes(j.phase));

  // Financial summary across all projects
  const allPayments = jobs.flatMap(j => (j.payment_records || []).map((p: any) => ({ ...p, job_title: j.title })));
  const totalInvoiced = allPayments.reduce((a: number, p: any) => a + (p.amount || 0), 0);
  const totalPaid = allPayments.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + (p.amount || 0), 0);
  const totalOutstanding = allPayments.filter((p: any) => !["paid","void"].includes(p.status)).reduce((a: number, p: any) => a + (p.amount || 0), 0);
  const now = new Date();
  const overdue = allPayments.filter((p: any) => p.due_date && new Date(p.due_date) < now && !["paid","void"].includes(p.status));
  const totalOverdue = overdue.reduce((a: number, p: any) => a + (p.amount || 0), 0);

  // Item history — flatten all items across all jobs. We carry every
  // input the canonical status resolver needs (lib/item-status):
  //   - pipeline_stage, received_at_hpd, archived_at: per-item state signals
  //   - jobPhase, shippingRoute, jobCompletedAt: job-level context (route
  //     branching, complete + grace → archived)
  //   - poSent: did a PO go out to this item's decorator? Computed by
  //     intersecting jobs.type_meta.po_sent_vendors (case-insensitive)
  //     with the item's decorator name. Without this, items priced but
  //     still pre-PO would wrongly land In Production once any other
  //     item on the same job had a PO sent (the job moves to phase
  //     "production" once ANY item is POd).
  const allItems = jobs.flatMap(j => {
    const tm = (j as any).type_meta || {};
    const sentRaw: string[] = Array.isArray(tm.po_sent_vendors) ? tm.po_sent_vendors : [];
    const sentLower = new Set(sentRaw.map((s: string) => (s || "").toLowerCase().trim()).filter(Boolean));
    return (j.items || []).map((it: any) => {
      const assignment = it.decorator_assignments?.[0];
      const decoratorName: string | null = assignment?.decorators?.name || null;
      const decoratorShort: string | null = assignment?.decorators?.short_code || null;
      const poSent = !!(
        (decoratorName && sentLower.has(decoratorName.toLowerCase())) ||
        (decoratorShort && sentLower.has(decoratorShort.toLowerCase()))
      );
      return {
        ...it,
        jobId: j.id,
        jobTitle: j.title,
        jobNumber: tm.qb_invoice_number || j.job_number,
        jobDate: j.target_ship_date || j.created_at,
        jobPhase: j.phase,
        shippingRoute: (j as any).shipping_route || null,
        quoteApprovedAt: (j as any).quote_approved_at || null,
        jobCompletedAt: ((j as any).phase_timestamps || {}).complete || null,
        pipelineStage: it.pipeline_stage || null,
        archivedAt: it.archived_at || null,
        completedAt: it.completed_at || null,
        receivedAtHpd: !!it.received_at_hpd,
        blanksOrderCost: it.blanks_order_cost != null ? Number(it.blanks_order_cost) : 0,
        decoratorName,
        poSent,
        totalQty: (it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0),
        sizes: (it.buy_sheet_lines || []).map((l: any) => l.size),
        qtys: Object.fromEntries((it.buy_sheet_lines || []).map((l: any) => [l.size, l.qty_ordered])),
      };
    });
  });

  // Stage chip resolver — what to show next to each item instance.
  // Job phase drives it; pipeline_stage refines within production
  // (in_production vs shipped). Mirrors the colors used in the
  // Projects list above for consistency.
  function instanceStage(inst: any): { label: string; color: { bg: string; text: string } } {
    const phase = inst.jobPhase as string;
    const ps = inst.pipelineStage as string | null;
    if (phase === "complete") return { label: "Delivered", color: PHASE_COLORS.complete };
    if (phase === "cancelled") return { label: "Cancelled", color: PHASE_COLORS.cancelled };
    if (phase === "on_hold") return { label: "On Hold", color: PHASE_COLORS.on_hold };
    if (phase === "fulfillment") return { label: "Fulfillment", color: PHASE_COLORS.fulfillment };
    if (phase === "receiving") return { label: "Receiving", color: PHASE_COLORS.receiving };
    if (phase === "production") {
      if (ps === "shipped") return { label: "Shipped", color: PHASE_COLORS.receiving };
      return { label: "Production", color: PHASE_COLORS.production };
    }
    if (phase === "ready") return { label: "Ready", color: PHASE_COLORS.ready };
    if (phase === "pending") return { label: "Pending", color: PHASE_COLORS.pending };
    return { label: "Setup", color: PHASE_COLORS.intake };
  }

  // Sort order for the flat list view — active stages first so what's
  // happening now floats to the top; terminal stages drop to the
  // bottom. Within each bucket, most-recent ship/created date first.
  const PHASE_PRIORITY: Record<string, number> = {
    production: 1, receiving: 2, fulfillment: 3, ready: 4, pending: 5, intake: 6,
    on_hold: 8, complete: 10, cancelled: 11,
  };
  const allItemsForList = [...allItems].sort((a, b) => {
    const pa = PHASE_PRIORITY[a.jobPhase] ?? 9;
    const pb = PHASE_PRIORITY[b.jobPhase] ?? 9;
    if (pa !== pb) return pa - pb;
    const da = new Date(a.jobDate || 0).getTime();
    const db = new Date(b.jobDate || 0).getTime();
    return db - da;
  });

  // Group by item identity (name + blank_vendor + blank_sku)
  const itemGroups: Record<string, any[]> = {};
  for (const it of allItems) {
    const key = `${it.name}||${it.blank_vendor || ""}||${it.blank_sku || ""}`;
    if (!itemGroups[key]) itemGroups[key] = [];
    itemGroups[key].push(it);
  }
  const sortedItemGroups = Object.entries(itemGroups).sort((a, b) => b[1].length - a[1].length);

  // Working Sheet — debounced auto-save for inline edits. Updates the
  // jobs state optimistically so the UI reflects the change immediately
  // (and the KPI rollup recomputes), then writes to the items table
  // after 600ms of idle. Empty string → null so we don't write "" to
  // numeric columns.
  //
  // Reliability: awaits the supabase response + checks for an error.
  // If the write fails we (a) console.error so the cause is debuggable
  // and (b) push the error message into saveErrors so the row can
  // surface a red banner. Silent failures here lost a bunch of retail
  // values once; never again.
  async function persistItemField(itemId: string, field: string, value: any) {
    const dbValue = value === "" ? null : value;
    const { error } = await supabase.from("items").update({ [field]: dbValue }).eq("id", itemId);
    const key = `${itemId}_${field}`;
    if (error) {
      console.error(`[worksheet] failed to save ${field} on item ${itemId}:`, error);
      setSaveErrors(prev => ({ ...prev, [key]: error.message }));
    } else {
      setSaveErrors(prev => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function saveItemField(itemId: string, field: string, value: any) {
    setJobs(prev => prev.map(j => ({
      ...j,
      items: (j.items || []).map((it: any) => it.id === itemId ? { ...it, [field]: value } : it),
    } as Job)));
    const key = `${itemId}_${field}`;
    if (itemSaveTimers.current[key]) clearTimeout(itemSaveTimers.current[key]);
    itemSaveTimers.current[key] = setTimeout(() => persistItemField(itemId, field, value), 600);
  }

  // Flush — fires the save immediately, used on blur so nothing
  // hangs in a debounce timer when focus moves away.
  function flushItemField(itemId: string, field: string, value: any) {
    const key = `${itemId}_${field}`;
    if (itemSaveTimers.current[key]) {
      clearTimeout(itemSaveTimers.current[key]);
      delete itemSaveTimers.current[key];
    }
    return persistItemField(itemId, field, value);
  }

  // Worksheet-originated activity logging. Keeps an audit trail when
  // Jon adjusts price / retail / status from the worksheet so future
  // "wait, why is this $X?" questions have an answer. Wraps
  // logJobActivity with the "(worksheet)" suffix so the source is
  // distinguishable from edits made on the project pages.
  function logWorksheet(jobId: string, message: string) {
    if (!jobId) return;
    logJobActivity(jobId, `${message} (worksheet)`);
  }

  async function reorderItem(item: any) {
    // Create a new job with this item pre-filled
    const { data: newJob } = await supabase.from("jobs").insert({
      title: `${client!.name} — Reorder`,
      job_type: "corporate",
      phase: "intake",
      priority: "normal",
      shipping_route: "ship_through",
      payment_terms: client!.default_terms || null,
      client_id: client!.id,
      job_number: "",
    }).select("id").single();
    if (!newJob) return;

    // Create the item
    const { data: newItem } = await supabase.from("items").insert({
      job_id: newJob.id,
      name: item.name,
      blank_vendor: item.blank_vendor || null,
      blank_sku: item.blank_sku || null,
      cost_per_unit: item.cost_per_unit || null,
      blank_costs: item.blank_costs || null,
      status: "tbd",
      artwork_status: "not_started",
      sort_order: 0,
    }).select("id").single();

    // Copy sizes with zero qtys
    if (newItem && item.sizes?.length > 0) {
      await supabase.from("buy_sheet_lines").insert(
        item.sizes.map((sz: string) => ({ item_id: newItem.id, size: sz, qty_ordered: 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }))
      );
    }

    // Add client contacts
    const { data: clientContacts } = await supabase.from("contacts").select("id, is_primary").eq("client_id", client!.id);
    if (clientContacts?.length) {
      await supabase.from("job_contacts").insert(
        clientContacts.map((c: any) => ({ job_id: newJob.id, contact_id: c.id, role_on_job: c.is_primary ? "primary" : "cc" }))
      );
    }

    router.push(`/jobs/${newJob.id}`);
  }

  return (
    <div style={{fontFamily:font,color:T.text,maxWidth:900,margin:"0 auto",paddingBottom:"3rem"}}>
      <button onClick={()=>router.push("/clients")} style={{background:"none",border:"none",color:T.muted,fontSize:12,cursor:"pointer",marginBottom:12,padding:0,fontFamily:font}}>
        ← All clients
      </button>

      {/* Header */}
      <div style={{marginBottom:16,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 6px",letterSpacing:"-0.02em"}}>{client.name}</h1>
          <div style={{display:"flex",gap:16,fontSize:12,color:T.muted}}>
            <span>{jobs.length} project{jobs.length!==1?"s":""}</span>
            <span>{activeJobs.length} active</span>
            <span>{totalUnits.toLocaleString()} total units</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {/* Client portal — enables the client-facing /portal/client/[token]
              experience. Off by default; toggle per-client. Copy button
              appears once enabled and a token is minted. */}
          {client.client_hub_enabled && client.portal_token ? (
            <button onClick={copyPortalLink}
              title={`${typeof window !== "undefined" ? window.location.origin : ""}/portal/client/${client.portal_token}`}
              style={{padding:"7px 12px",borderRadius:7,background:portalCopied ? T.greenDim : T.surface,color:portalCopied ? T.green : T.text,border:`1px solid ${portalCopied ? T.green : T.border}`,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:font}}>
              {portalCopied ? "✓ Link copied" : "Copy portal link"}
            </button>
          ) : null}
          <button onClick={togglePortal}
            title={client.client_hub_enabled ? "Disable the client portal for this client" : "Enable the client portal — mints an access token"}
            style={{padding:"7px 12px",borderRadius:7,background:"transparent",color:client.client_hub_enabled ? T.muted : T.faint,border:`1px solid ${T.border}`,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:font}}>
            {client.client_hub_enabled ? "Portal: on" : "Enable portal"}
          </button>
          {/* + New Project — pre-fills this client on the new project form. */}
          <a href={`/jobs/new?client=${client.id}`}
            style={{padding:"7px 14px",borderRadius:7,background:T.accent,color:"#fff",fontSize:12,fontWeight:700,textDecoration:"none",fontFamily:font}}>
            + New Project
          </a>
        <button onClick={async()=>{
          const jobCount = jobs.length;
          const msg = jobCount > 0
            ? `Delete "${client.name}" and all ${jobCount} project${jobCount!==1?"s":""}, items, contacts, and related data? This cannot be undone.`
            : `Delete "${client.name}" and all associated contacts? This cannot be undone.`;
          if(!window.confirm(msg)) return;
          // Cascade: delete job children first, then jobs, then client data
          const jobIds = jobs.map(j=>j.id);
          if(jobIds.length > 0){
            // Trash each project's Drive folder before deleting the row.
            // Uses the stashed drive_folder_id so it works even after a
            // memo rename. Non-fatal — Drive trash is recoverable for 30
            // days, so a failed trash never blocks the DB cleanup.
            for (const jId of jobIds) {
              try {
                await fetch("/api/files/cleanup", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "archive-project", jobId: jId }),
                });
              } catch {}
            }
            const itemIds = (jobs.flatMap((j:any)=>(j.items||[]).map((it:any)=>it.id))).filter(Boolean);
            if(itemIds.length > 0){
              await supabase.from("buy_sheet_lines").delete().in("item_id",itemIds);
              await supabase.from("item_files").delete().in("item_id",itemIds);
              await supabase.from("decorator_assignments").delete().in("item_id",itemIds);
              await supabase.from("items").delete().in("id",itemIds);
            }
            await supabase.from("job_contacts").delete().in("job_id",jobIds);
            await supabase.from("job_activity").delete().in("job_id",jobIds);
            await supabase.from("payment_records").delete().in("job_id",jobIds);
            await supabase.from("jobs").delete().in("id",jobIds);
          }
          await supabase.from("contacts").delete().eq("client_id",client.id);
          await supabase.from("clients").delete().eq("id",client.id);
          router.push("/clients");
        }}
          style={{background:"none",border:`1px solid ${T.border}`,borderRadius:6,color:T.faint,fontSize:11,padding:"6px 12px",cursor:"pointer",fontFamily:font}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.red;e.currentTarget.style.color=T.red;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.faint;}}>
          Delete Client
        </button>
        </div>
      </div>

      {/* Financial summary */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
        {[
          {label:"Total Revenue",value:totalRev>0?"$"+Math.round(totalRev).toLocaleString():"—",color:T.accent},
          {label:"Total Paid",value:totalPaid>0?"$"+Math.round(totalPaid).toLocaleString():"—",color:T.green},
          {label:"Outstanding",value:totalOutstanding>0?"$"+Math.round(totalOutstanding).toLocaleString():"$0",color:totalOutstanding>0?T.amber:T.faint},
          {label:"Overdue",value:totalOverdue>0?"$"+Math.round(totalOverdue).toLocaleString():"$0",color:totalOverdue>0?T.red:T.faint},
        ].map(s=>(
          <div key={s.label} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:18,fontWeight:700,color:s.color,fontFamily:mono}}>{s.value}</div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {/* Client info + Contacts — single card, 2 columns. Collapsible
            because the form fields take a lot of vertical space and most
            of the time we're just opening a client to look at projects /
            items, not edit their billing address. Default collapsed; the
            summary line keeps the most-scanned facts in view. */}
        {(() => {
          const primary = contacts.find(c => c.is_primary);
          const summaryParts: string[] = [];
          if (client.client_type) summaryParts.push(client.client_type.charAt(0).toUpperCase() + client.client_type.slice(1));
          if (client.default_terms) summaryParts.push(client.default_terms.replace(/_/g, " "));
          summaryParts.push(`${contacts.length} contact${contacts.length===1?"":"s"}`);
          if (primary) summaryParts.push(`primary: ${primary.name}`);
          const summary = summaryParts.join(" · ");
          return (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
          <button
            type="button"
            onClick={() => setInfoExpanded(v => !v)}
            style={{
              width:"100%", display:"flex", alignItems:"center", gap:10,
              background:"transparent", border:"none", padding:0,
              cursor:"pointer", textAlign:"left", fontFamily:font, color:T.text,
            }}
          >
            {infoExpanded ? <ChevronDown size={16} color={T.muted} /> : <ChevronRight size={16} color={T.muted} />}
            <span style={{fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>
              Client Info
            </span>
            {!infoExpanded && summary && (
              <span style={{fontSize:11,color:T.faint,marginLeft:"auto",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {summary}
              </span>
            )}
          </button>
          {infoExpanded && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,alignItems:"start",marginTop:12}}>
            {/* Left — Client info */}
            <div>
              <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Client Info</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div>
                  <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Name</label>
                  <input style={ic} value={client.name} onChange={e=>updateClient({name:e.target.value})}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Payment terms</label>
                    <select style={ic} value={client.default_terms||""} onChange={e=>updateClient({default_terms:e.target.value||null})}>
                      <option value="">—</option>
                      {["net_15","net_30","deposit_balance","prepaid"].map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Website</label>
                    <input style={ic} value={client.website||""} onChange={e=>updateClient({website:e.target.value||null})}/>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Billing address</label>
                    <textarea style={{...ic,minHeight:90,resize:"vertical",lineHeight:1.4}} value={client.billing_address||""} onChange={e=>updateClient({billing_address:e.target.value||null})}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Shipping address</label>
                    <textarea style={{...ic,minHeight:90,resize:"vertical",lineHeight:1.4}} value={client.shipping_address||""} onChange={e=>updateClient({shipping_address:e.target.value||null})}/>
                  </div>
                </div>
                <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:600,color:T.text,cursor:"pointer",padding:"6px 10px",background:T.surface,borderRadius:6,width:"fit-content"}}>
                  <input type="checkbox" checked={client.tax_exempt||false} onChange={e=>updateClient({tax_exempt:e.target.checked} as any)} style={{accentColor:T.accent,width:18,height:18}}/>
                  Tax Exempt
                </label>

                {/* Tax documents — resale certs, non-profit determinations,
                    W9s, MSAs. Files live in Drive under
                    OpsHub Files / Clients / {Client Name} / {Tax Documents | W9 | MSAs | Other} */}
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Tax Documents</div>
                    <label style={{cursor:uploading?"default":"pointer",fontSize:10,padding:"3px 9px",borderRadius:5,background:uploading?T.faint:T.accent,color:"#fff",fontWeight:600,opacity:uploading?0.7:1}}>
                      {uploading ? "Uploading…" : "+ Upload"}
                      <input type="file" style={{display:"none"}} disabled={uploading} onChange={async e => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        await uploadFile(f, "tax_exempt");
                        e.target.value = "";
                      }}/>
                    </label>
                  </div>
                  {files.length === 0 && <div style={{fontSize:11,color:T.faint,padding:"8px 10px",background:T.surface,borderRadius:6,textAlign:"center"}}>No documents on file.</div>}
                  {files.length > 0 && (
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {files.map(f => {
                        const sizeKb = f.file_size ? f.file_size / 1024 : 0;
                        const sizeStr = sizeKb >= 1024 ? `${(sizeKb/1024).toFixed(1)} MB` : sizeKb >= 1 ? `${Math.round(sizeKb)} KB` : "";
                        return (
                          <div key={f.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:T.surface,borderRadius:6}}>
                            <button onClick={()=>setPreviewFile(f)} style={{flex:1,minWidth:0,fontSize:12,color:T.text,textAlign:"left",background:"none",border:"none",padding:0,cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:font}}
                              onMouseEnter={(e:any)=>e.currentTarget.style.color=T.accent}
                              onMouseLeave={(e:any)=>e.currentTarget.style.color=T.text}>
                              {f.file_name}
                            </button>
                            {sizeStr && <span style={{fontSize:10,color:T.faint,fontFamily:mono,flexShrink:0}}>{sizeStr}</span>}
                            <button onClick={()=>setConfirmDeleteFile(f)} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:11,padding:0,lineHeight:1}}
                              onMouseEnter={e=>e.currentTarget.style.color=T.red}
                              onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* QuickBooks customer link — only shown for QB-backed
                    tenants. Caches in clients.qb_customer_id and is
                    the single source of truth used by every QB push.
                    Stripe-backed tenants (IHM) hide this entirely;
                    Stripe matches customers by email automatically on
                    invoice push. */}
                {paymentProvider === "quickbooks" && (<>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginTop:6,marginBottom:6}}>QuickBooks Customer</div>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:T.surface,borderRadius:6,border:`1px solid ${T.border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      {qbLinked === "loading" ? (
                        <div style={{fontSize:12,color:T.muted}}>Loading…</div>
                      ) : qbLinked ? (
                        <>
                          <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {qbLinked.displayName || <span style={{color:T.red,fontStyle:"italic"}}>QB id {qbLinked.id} (not found in QB)</span>}
                            {qbLinked.displayName && qbLinked.active === false && (
                              <span style={{marginLeft:6,fontSize:10,color:T.muted}}>(inactive)</span>
                            )}
                          </div>
                          <div style={{fontSize:10,color:T.faint,fontFamily:mono,marginTop:2}}>QB id {qbLinked.id}</div>
                        </>
                      ) : (
                        <div style={{fontSize:12,color:T.muted}}>
                          Not linked — first invoice push will auto-match by name.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={()=>setQbChooserOpen(true)}
                      disabled={qbBusy}
                      style={{padding:"5px 10px",borderRadius:5,border:`1px solid ${T.border}`,background:T.card,color:T.text,fontSize:11,fontWeight:600,cursor:qbBusy?"default":"pointer",fontFamily:font,opacity:qbBusy?0.6:1,whiteSpace:"nowrap"}}
                    >
                      {qbLinked && qbLinked !== "loading" ? "Re-link" : "Link to QB"}
                    </button>
                  </div>
                  {qbMsg && (
                    <div style={{marginTop:6,padding:"6px 10px",borderRadius:5,fontSize:11,background:qbMsg.ok?T.greenDim:T.redDim,color:qbMsg.ok?T.green:T.red,border:`1px solid ${qbMsg.ok?T.green+"55":T.red+"55"}`}}>
                      {qbMsg.text}
                    </div>
                  )}
                  <div style={{fontSize:10,color:T.faint,marginTop:6,lineHeight:1.4}}>
                    Re-link if invoices have been landing on the wrong QB customer (e.g. a duplicate created from a name mismatch). Existing invoices in QB stay where they are — merge duplicates inside QuickBooks.
                  </div>
                </div>
                </>)}

                {/* Online payment-method toggles. Apply to whichever
                    provider this tenant uses (QB or Stripe). Default
                    true so existing behavior matches; flip off per
                    client if they should only see one option on the
                    hosted payment page. */}
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginTop:6,marginBottom:6}}>Online Payment Methods</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.text,cursor:"pointer",padding:"6px 10px",background:T.surface,borderRadius:6}}>
                      <input type="checkbox" checked={client.allow_cc !== false} onChange={e=>updateClient({allow_cc:e.target.checked} as any)} style={{accentColor:T.accent,width:16,height:16}}/>
                      <span style={{fontWeight:600}}>Accept credit card</span>
                      <span style={{fontSize:10,color:T.faint,marginLeft:"auto"}}>{paymentProvider === "stripe" ? "2.9% + 30¢" : "2.99% per txn"}</span>
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.text,cursor:"pointer",padding:"6px 10px",background:T.surface,borderRadius:6}}>
                      <input type="checkbox" checked={client.allow_ach !== false} onChange={e=>updateClient({allow_ach:e.target.checked} as any)} style={{accentColor:T.accent,width:16,height:16}}/>
                      <span style={{fontWeight:600}}>Accept bank transfer (ACH)</span>
                      <span style={{fontSize:10,color:T.faint,marginLeft:"auto"}}>{paymentProvider === "stripe" ? "0.8%, max $5" : "1%, max $20"}</span>
                    </label>
                  </div>
                  <div style={{fontSize:10,color:T.faint,marginTop:6,lineHeight:1.4}}>
                    {paymentProvider === "stripe"
                      ? "Applied when the next Stripe invoice is created. Existing invoices keep whatever was set when they were sent until re-issued."
                      : "Pushed to QB on the next Update QB Invoice. Existing invoices keep whatever was set when they were created until re-pushed."}
                  </div>
                </div>
              </div>
            </div>

            {/* Right — Contacts + Notes */}
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Contacts</div>
                <button onClick={()=>setAddingContact(!addingContact)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:10,padding:"2px 8px",cursor:"pointer"}}>+ Add</button>
              </div>
              {addingContact&&(
                <div style={{background:T.surface,border:`1px solid ${T.accent}44`,borderRadius:8,padding:10,marginBottom:8}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                    <input id="cc-name" placeholder="Name" style={ic}/>
                    <input id="cc-email" placeholder="Email" style={ic}/>
                    <input id="cc-phone" placeholder="Phone" style={ic}/>
                    <input id="cc-role" placeholder="Role (e.g. Manager)" style={ic}/>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={async()=>{
                      const name=(document.getElementById("cc-name") as HTMLInputElement).value.trim();
                      if(!name) return;
                      const email=(document.getElementById("cc-email") as HTMLInputElement).value.trim()||null;
                      const phone=(document.getElementById("cc-phone") as HTMLInputElement).value.trim()||null;
                      const role_label=(document.getElementById("cc-role") as HTMLInputElement).value.trim()||null;
                      await supabase.from("contacts").insert({name,email,phone,role_label,client_id:params.id});
                      setAddingContact(false);
                      load();
                    }} style={{background:T.green,border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:600,padding:"5px 12px",cursor:"pointer"}}>Save</button>
                    <button onClick={()=>setAddingContact(false)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:11,padding:"5px 10px",cursor:"pointer"}}>Cancel</button>
                  </div>
                </div>
              )}
              {contacts.length===0&&!addingContact&&<p style={{fontSize:12,color:T.muted}}>No contacts yet.</p>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {contacts.map(c=>(
                  <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:T.surface,borderRadius:6}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:T.accent,flexShrink:0}}>
                      {c.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:600}}>{c.name} {c.role_label&&<span style={{fontWeight:400,color:T.muted,fontSize:10}}>· {c.role_label}</span>}</div>
                      <div style={{fontSize:10,color:T.muted}}>{[c.email,c.phone].filter(Boolean).join(" · ")}</div>
                    </div>
                    <button onClick={()=>setConfirmRemove(c)} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:11}}
                      onMouseEnter={e=>e.currentTarget.style.color=T.red}
                      onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                  </div>
                ))}
              </div>
              {/* Notes */}
              <div style={{marginTop:12}}>
                <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Notes</label>
                <textarea style={{...ic,minHeight:80,resize:"vertical",lineHeight:1.4}} value={client.notes||""} onChange={e=>updateClient({notes:e.target.value})}/>
              </div>
            </div>
          </div>
          )}
        </div>
          );
        })()}

        {/* History */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:8,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{display:"flex",gap:2,background:T.surface,borderRadius:6,padding:2}}>
                {(["projects","items"] as const).map(v=>(
                  <button key={v} onClick={()=>setHistoryView(v)}
                    style={{padding:"3px 10px",borderRadius:4,fontSize:10,fontWeight:600,border:"none",cursor:"pointer",
                      background:historyView===v?T.accent:"transparent",color:historyView===v?"#fff":T.muted}}>
                    {v==="projects"?"Projects":"Items"}
                  </button>
                ))}
              </div>
              {historyView==="items"&&(
                <div style={{display:"flex",gap:2,background:T.surface,borderRadius:6,padding:2}}>
                  {(["list","tiles"] as const).map(v=>(
                    <button key={v} onClick={()=>setItemViewMode(v)}
                      style={{padding:"3px 10px",borderRadius:4,fontSize:10,fontWeight:600,border:"none",cursor:"pointer",
                        background:itemViewMode===v?T.text:"transparent",color:itemViewMode===v?"#fff":T.muted}}>
                      {v==="list"?"List":"Tiles"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span style={{fontSize:10,color:T.faint}}>{historyView==="projects"?`${jobs.length} projects`:`${allItems.length} items`}</span>
          </div>

          {historyView==="projects"&&(
            <>
              {jobs.length===0&&<p style={{fontSize:12,color:T.muted}}>No projects yet.</p>}
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {jobs.map(j=>{
                  const phase = PHASE_COLORS[j.phase]||PHASE_COLORS.intake;
                  const rev = effectiveRevenue(j);
                  const units = (j.items||[]).reduce((a: number,it: any) => a + (it.buy_sheet_lines||[]).reduce((b: number,l: any) => b + (l.qty_ordered||0), 0), 0);
                  return(
                    <Link key={j.id} href={`/jobs/${j.id}`} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:T.surface,borderRadius:6,textDecoration:"none",color:T.text,transition:"background 0.1s"}}
                      onMouseEnter={(e:any)=>e.currentTarget.style.background=T.accentDim}
                      onMouseLeave={(e:any)=>e.currentTarget.style.background=T.surface}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{j.title}</div>
                        <div style={{fontSize:10,color:T.muted,marginTop:1}}>{(j as any).type_meta?.qb_invoice_number || j.job_number} {units>0&&`· ${units.toLocaleString()} units`} {rev>0&&`· $${Math.round(rev).toLocaleString()}`}</div>
                      </div>
                      <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:phase.text,whiteSpace:"nowrap",flexShrink:0}}>{j.phase.replace(/_/g," ")}</span>
                      {j.target_ship_date&&<span style={{fontSize:10,color:T.muted,fontFamily:mono,flexShrink:0}}>{new Date(j.target_ship_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>}
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          {historyView==="items"&&itemViewMode==="list"&&(
            <>
              {allItemsForList.length===0&&<p style={{fontSize:12,color:T.muted}}>No items yet.</p>}
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {allItemsForList.map((inst: any, i: number)=>{
                  const stg = instanceStage(inst);
                  return(
                    <Link key={inst.id+":"+i} href={`/jobs/${inst.jobId}`}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:T.surface,borderRadius:6,textDecoration:"none",color:T.text,transition:"background 0.1s"}}
                      onMouseEnter={(e:any)=>e.currentTarget.style.background=T.accentDim}
                      onMouseLeave={(e:any)=>e.currentTarget.style.background=T.surface}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{inst.name}</div>
                        <div style={{fontSize:10,color:T.muted,marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          <span style={{fontFamily:mono}}>{inst.jobNumber}</span>
                          {inst.jobTitle&&<> · {inst.jobTitle}</>}
                          {[inst.blank_vendor,inst.blank_sku].filter(Boolean).length>0&&<> · {[inst.blank_vendor,inst.blank_sku].filter(Boolean).join(" ")}</>}
                        </div>
                      </div>
                      <span style={{fontSize:11,fontFamily:mono,color:T.muted,flexShrink:0}}>{inst.totalQty.toLocaleString()} units</span>
                      <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:stg.color.text,whiteSpace:"nowrap",flexShrink:0}}>{stg.label}</span>
                      <span style={{fontSize:10,color:T.muted,fontFamily:mono,flexShrink:0,minWidth:62,textAlign:"right"}}>{inst.jobDate?new Date(inst.jobDate).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"}):""}</span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          {historyView==="items"&&itemViewMode==="tiles"&&(
            <>
              {sortedItemGroups.length===0&&<p style={{fontSize:12,color:T.muted}}>No items yet.</p>}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {sortedItemGroups.map(([key, instances])=>{
                  const first = instances[0];
                  const isRepeat = instances.length > 1;
                  return(
                    <div key={key} style={{background:T.surface,borderRadius:8,padding:"8px 10px",border:isRepeat?`1px solid ${T.accent}33`:`1px solid transparent`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:isRepeat?6:0}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                            <span style={{fontSize:12,fontWeight:600}}>{first.name}</span>
                            {isRepeat&&<span style={{fontSize:10,fontFamily:mono,fontWeight:600,color:T.muted}}>×{instances.length}</span>}
                            {/* Distinct stage chips at the header level — so a
                                grouped repeat with mixed stages (e.g. one
                                delivered + one in production) reads as two
                                chips, and an all-delivered 5x reads as a
                                single chip. The per-instance chips appear
                                in the expandable rows below. */}
                            {(() => {
                              const seen = new Set<string>();
                              const chips: { label: string; color: { bg: string; text: string } }[] = [];
                              for (const inst of instances) {
                                const stg = instanceStage(inst);
                                if (!seen.has(stg.label)) { seen.add(stg.label); chips.push(stg); }
                              }
                              return chips.map((stg, i) => (
                                <span key={`chip-${stg.label}-${i}`} style={{fontSize:9,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:stg.color.text,whiteSpace:"nowrap"}}>{stg.label}</span>
                              ));
                            })()}
                          </div>
                          <div style={{fontSize:10,color:T.muted,marginTop:1}}>{[first.blank_vendor,first.blank_sku].filter(Boolean).join(" · ")}</div>
                        </div>
                        <button onClick={()=>reorderItem(first)}
                          style={{fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:6,background:T.accent,color:"#fff",border:"none",cursor:"pointer"}}>
                          Reorder
                        </button>
                      </div>
                      {isRepeat&&(
                        <div style={{display:"flex",flexDirection:"column",gap:2,marginTop:4}}>
                          {instances.map((inst: any,i: number)=>{
                            const stg = instanceStage(inst);
                            return(
                              <Link key={inst.id+i} href={`/jobs/${inst.jobId}`} style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:T.muted,textDecoration:"none",padding:"2px 0"}}
                                onMouseEnter={(e:any)=>e.currentTarget.style.color=T.accent}
                                onMouseLeave={(e:any)=>e.currentTarget.style.color=T.muted}>
                                <span style={{fontFamily:mono}}>{inst.jobNumber}</span>
                                <span>{inst.jobTitle}</span>
                                <span style={{fontFamily:mono}}>{inst.totalQty} units</span>
                                <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:stg.color.text,whiteSpace:"nowrap"}}>{stg.label}</span>
                                <span style={{marginLeft:"auto"}}>{new Date(inst.jobDate).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                      {!isRepeat&&(
                        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:T.faint,marginTop:2}}>
                          <span style={{fontFamily:mono}}>{first.jobNumber}</span>
                          <span>{first.jobTitle}</span>
                          <span style={{fontFamily:mono}}>{first.totalQty} units</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Working Sheet — back-office financial worksheet, separate
            from the operational production flow. Carries over the value
            of the old /staging tool: per-item cost/retail tracking,
            manual status buckets, ETAs, and notes — all in one place
            across every job for this client. Inline edits to sell_per_unit
            propagate to OpsHub's quote/invoice/portal surfaces (pricing
            source of truth); client_retail_per_unit is private to this
            view. */}
        {(() => {
          const fmtMoney = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const fmtMoneyShort = (n: number) => "$" + Math.round(n || 0).toLocaleString();

          // Canonical status via the shared lib — every surface in OpsHub
          // uses the same compute function, so the worksheet matches what
          // the client portal, production page, and project overview all
          // show for the same item. The 5 active/historical states are:
          //
          //   setup           pre-PO (costing, art, blanks, payments)
          //   in_production   PO sent, decorator hasn't shipped
          //   shipped         left decorator, HPD outbound pending
          //                   (drop-ship skips this state)
          //   complete        HPD's last shipping action taken
          //   archived        Complete + grace period elapsed,
          //                   manually archived, or job cancelled
          const wsItems = allItems.map((it: any) => ({
            ...it,
            _ws: resolveItemStatus({
              archived_at: it.archivedAt,
              completed_at: it.completedAt,
              pipeline_stage: it.pipelineStage,
              received_at_hpd: it.receivedAtHpd,
              sell_per_unit: it.sell_per_unit,
              blanks_order_cost: it.blanksOrderCost,
              po_sent: it.poSent,
              job_phase: it.jobPhase,
              job_shipping_route: it.shippingRoute,
              job_completed_at: it.jobCompletedAt,
            }) as ItemState,
          }));
          const paidJobIds = new Set(
            jobs.filter(j => ((j as any).payment_records || []).some((p: any) => p.status === "paid")).map(j => j.id)
          );
          const rollup = (list: any[]) => {
            let count = 0, qty = 0, cost = 0, gross = 0;
            for (const it of list) {
              const c = Number(it.sell_per_unit) || 0;
              const r = Number(it.client_retail_per_unit) || 0;
              count++; qty += it.totalQty;
              cost += c * it.totalQty;
              gross += r * it.totalQty;
            }
            return { count, qty, cost, gross, profit: gross - cost };
          };
          type TabKey = "setup" | "in_production" | "shipped" | "in_stock" | "complete" | "archived";
          const byStatus: Record<TabKey, any[]> = {
            setup: wsItems.filter((it: any) => it._ws === "setup"),
            in_production: wsItems.filter((it: any) => it._ws === "in_production"),
            shipped: wsItems.filter((it: any) => it._ws === "shipped"),
            in_stock: wsItems.filter((it: any) => it._ws === "in_stock"),
            complete: wsItems.filter((it: any) => it._ws === "complete"),
            archived: wsItems.filter((it: any) => it._ws === "archived" || it._ws === "cancelled"),
          };
          const activeWsItems = wsItems.filter((it: any) => it._ws !== "archived" && it._ws !== "cancelled");
          const rollups = {
            setup: rollup(byStatus.setup),
            in_production: rollup(byStatus.in_production),
            shipped: rollup(byStatus.shipped),
            in_stock: rollup(byStatus.in_stock),
            complete: rollup(byStatus.complete),
            archived: rollup(byStatus.archived),
            active_total: rollup(activeWsItems),
          };
          const currentItems = byStatus[workingTab];

          // Tabs across the worksheet — 5 active + an Archived toggle.
          // Teal "In Stock" sits between purple "Shipped" and green
          // "Complete" — distinct from both visually.
          const STATUS_OPTS: { value: TabKey; label: string; color: string }[] = [
            { value: "setup", label: STATE_LABELS.setup, color: T.muted },
            { value: "in_production", label: STATE_LABELS.in_production, color: T.accent },
            { value: "shipped", label: STATE_LABELS.shipped, color: T.purple },
            { value: "in_stock", label: STATE_LABELS.in_stock, color: "#14b8a6" },
            { value: "complete", label: STATE_LABELS.complete, color: T.green },
          ];

          return (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
          <button
            type="button"
            onClick={() => setWorkingExpanded(v => !v)}
            style={{
              width:"100%", display:"flex", alignItems:"center", gap:10,
              background:"transparent", border:"none", padding:0,
              cursor:"pointer", textAlign:"left", fontFamily:font, color:T.text,
            }}
          >
            {workingExpanded ? <ChevronDown size={16} color={T.muted} /> : <ChevronRight size={16} color={T.muted} />}
            <span style={{fontSize:10,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>
              Working Sheet
            </span>
            {!workingExpanded && wsItems.length > 0 && (
              <span style={{fontSize:11,color:T.faint,marginLeft:"auto",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {activeWsItems.length} active · {fmtMoneyShort(rollups.active_total.gross)} gross · {fmtMoneyShort(rollups.active_total.profit)} profit
              </span>
            )}
          </button>

          {workingExpanded && (
            <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:12}}>
              {/* KPI rollup — 4 rows × 6 cols. Total row uses a darker
                  background to anchor the eye. */}
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:580}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${T.border}`}}>
                      {["Phase","Items","Qty","Cost","Gross","Profit"].map((h,i) => (
                        <th key={h} style={{padding:"6px 10px",fontSize:9,fontWeight:700,color:T.faint,textTransform:"uppercase",letterSpacing:"0.07em",textAlign:i===0?"left":"right"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {STATUS_OPTS.map(opt => {
                      const r = rollups[opt.value as Exclude<TabKey, "archived">];
                      return (
                        <tr key={opt.value}>
                          <td style={{padding:"6px 10px",fontSize:11,fontWeight:700,color:opt.color,textTransform:"uppercase",letterSpacing:"0.07em"}}>{opt.label}</td>
                          <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.muted,textAlign:"right"}}>{r.count}</td>
                          <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.text,textAlign:"right"}}>{r.qty.toLocaleString()}</td>
                          <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.text,textAlign:"right"}}>{fmtMoneyShort(r.cost)}</td>
                          <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.text,textAlign:"right"}}>{fmtMoneyShort(r.gross)}</td>
                          <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,fontWeight:600,color:T.green,textAlign:"right"}}>{fmtMoneyShort(r.profit)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{borderTop:`1px solid ${T.border}`,background:T.surface}}>
                      <td style={{padding:"8px 10px",fontSize:11,fontWeight:700,color:T.text,textTransform:"uppercase",letterSpacing:"0.07em"}}>Total (active)</td>
                      <td style={{padding:"8px 10px",fontSize:13,fontFamily:mono,fontWeight:700,color:T.text,textAlign:"right"}}>{rollups.active_total.count}</td>
                      <td style={{padding:"8px 10px",fontSize:13,fontFamily:mono,fontWeight:700,color:T.text,textAlign:"right"}}>{rollups.active_total.qty.toLocaleString()}</td>
                      <td style={{padding:"8px 10px",fontSize:13,fontFamily:mono,fontWeight:700,color:T.text,textAlign:"right"}}>{fmtMoneyShort(rollups.active_total.cost)}</td>
                      <td style={{padding:"8px 10px",fontSize:13,fontFamily:mono,fontWeight:700,color:T.text,textAlign:"right"}}>{fmtMoneyShort(rollups.active_total.gross)}</td>
                      <td style={{padding:"8px 10px",fontSize:13,fontFamily:mono,fontWeight:800,color:T.green,textAlign:"right"}}>{fmtMoneyShort(rollups.active_total.profit)}</td>
                    </tr>
                    {showArchived && byStatus.archived.length > 0 && (
                      <tr style={{background:T.surface,opacity:0.7}}>
                        <td style={{padding:"6px 10px",fontSize:11,fontWeight:700,color:T.faint,textTransform:"uppercase",letterSpacing:"0.07em"}}>Archived</td>
                        <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.muted,textAlign:"right"}}>{rollups.archived.count}</td>
                        <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.muted,textAlign:"right"}}>{rollups.archived.qty.toLocaleString()}</td>
                        <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.muted,textAlign:"right"}}>{fmtMoneyShort(rollups.archived.cost)}</td>
                        <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.muted,textAlign:"right"}}>{fmtMoneyShort(rollups.archived.gross)}</td>
                        <td style={{padding:"6px 10px",fontSize:12,fontFamily:mono,color:T.muted,textAlign:"right"}}>{fmtMoneyShort(rollups.archived.profit)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Tabs — Setup · In Production · Shipped · Complete (+ Archived toggle) */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <div style={{display:"flex",gap:2,background:T.surface,borderRadius:6,padding:2,width:"fit-content"}}>
                  {STATUS_OPTS.map(opt => {
                    const isActive = workingTab === opt.value;
                    const count = byStatus[opt.value].length;
                    return (
                      <button key={opt.value} onClick={() => setWorkingTab(opt.value)}
                        style={{padding:"4px 12px",borderRadius:4,fontSize:11,fontWeight:700,border:"none",cursor:"pointer",
                          background:isActive?T.accent:"transparent",color:isActive?"#fff":T.muted,fontFamily:font}}>
                        {opt.label} <span style={{opacity:0.7,marginLeft:4}}>{count}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !showArchived;
                    setShowArchived(next);
                    if (next && byStatus.archived.length > 0) setWorkingTab("archived");
                    else if (!next && workingTab === "archived") setWorkingTab("in_production");
                  }}
                  style={{
                    fontSize:11,fontWeight:600,color:showArchived?T.text:T.muted,
                    background:showArchived?T.surface:"transparent",
                    border:`1px solid ${T.border}`,borderRadius:6,
                    padding:"4px 12px",cursor:"pointer",fontFamily:font,
                  }}
                  title="Archived items (Complete > 30 days, manually archived, or cancelled)">
                  {showArchived ? "Hide" : "Show"} archived ({byStatus.archived.length})
                </button>
              </div>

              {/* Item list */}
              {currentItems.length === 0 ? (
                <div style={{fontSize:12,color:T.faint,padding:"20px",textAlign:"center",background:T.surface,borderRadius:8}}>
                  No items in this bucket.
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {/* Column header — gridTemplateColumns also used on each row below */}
                  <div style={{display:"grid",gridTemplateColumns:"minmax(0, 1fr) 60px 76px 76px 80px 110px 78px 44px",gap:8,padding:"4px 10px",fontSize:9,fontWeight:700,color:T.faint,textTransform:"uppercase",letterSpacing:"0.07em"}}>
                    <div>Item</div>
                    <div style={{textAlign:"right"}}>Qty</div>
                    <div style={{textAlign:"right"}}>Cost</div>
                    <div style={{textAlign:"right"}}>Retail</div>
                    <div style={{textAlign:"right"}}>Profit</div>
                    <div>Status</div>
                    <div>ETA</div>
                    <div style={{textAlign:"center"}}>Paid</div>
                  </div>
                  {(() => {
                    const STATE_COLORS: Record<ItemState, string> = {
                      setup: T.muted,
                      in_production: T.accent,
                      shipped: T.purple,
                      in_stock: "#14b8a6",
                      complete: T.green,
                      archived: T.faint,
                      on_hold: T.amber,
                      cancelled: T.red,
                    };
                    return currentItems.map((it: any) => {
                    const isOpen = workingRowExpanded === it.id;
                    const cost = Number(it.sell_per_unit) || 0;
                    const retail = Number(it.client_retail_per_unit) || 0;
                    const profit = (retail - cost) * it.totalQty;
                    const isPaid = paidJobIds.has(it.jobId);
                    const stateLabel = STATE_LABELS[it._ws as ItemState] || "—";
                    const stateColor = STATE_COLORS[it._ws as ItemState] || T.muted;
                    const isArchived = it.archivedAt != null || it._ws === "archived" || it._ws === "cancelled";
                    return (
                      <div key={it.id} style={{background:T.surface,borderRadius:8,overflow:"hidden"}}>
                        <button
                          type="button"
                          onClick={() => setWorkingRowExpanded(isOpen ? null : it.id)}
                          style={{
                            width:"100%",display:"grid",
                            gridTemplateColumns:"minmax(0, 1fr) 60px 76px 76px 80px 110px 78px 44px",
                            gap:8,padding:"10px",alignItems:"center",
                            background:"transparent",border:"none",cursor:"pointer",textAlign:"left",fontFamily:font,color:T.text,
                          }}
                        >
                          <div style={{minWidth:0,display:"flex",alignItems:"center",gap:10}}>
                            <div style={{
                              width:36,height:36,flexShrink:0,
                              background:"#fff",borderRadius:6,overflow:"hidden",
                              display:"flex",alignItems:"center",justifyContent:"center",
                              border:`1px solid ${T.border}`,
                            }}>
                              {itemThumbs[it.id] ? (
                                <img src={`/api/files/thumbnail?id=${itemThumbs[it.id]}&thumb=1`}
                                  alt="" referrerPolicy="no-referrer" loading="lazy"
                                  style={{width:"100%",height:"100%",objectFit:"contain"}}
                                  onError={(e: any) => { e.target.style.display = "none"; }}/>
                              ) : (
                                <span style={{color:T.faint,fontSize:8}}>—</span>
                              )}
                            </div>
                            <div style={{minWidth:0,flex:1}}>
                              <div style={{
                                fontSize:12,fontWeight:600,lineHeight:1.3,
                                display:"-webkit-box",
                                WebkitBoxOrient:"vertical",
                                WebkitLineClamp:2,
                                overflow:"hidden",
                                wordBreak:"break-word",
                              }}>{it.name}</div>
                              <div style={{fontSize:10,color:T.muted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                <span style={{fontFamily:mono}}>{it.jobNumber}</span>
                                {it.jobTitle && <> · {it.jobTitle}</>}
                              </div>
                            </div>
                          </div>
                          <div style={{fontSize:12,fontFamily:mono,color:T.text,textAlign:"right"}}>{it.totalQty.toLocaleString()}</div>
                          <div style={{fontSize:12,fontFamily:mono,color:T.text,textAlign:"right"}}>{cost > 0 ? fmtMoney(cost) : "—"}</div>
                          <div style={{fontSize:12,fontFamily:mono,color:retail > 0 ? T.text : T.faint,textAlign:"right"}}>{retail > 0 ? fmtMoney(retail) : "—"}</div>
                          <div style={{fontSize:12,fontFamily:mono,fontWeight:600,color:profit > 0 ? T.green : T.faint,textAlign:"right"}}>{profit !== 0 ? fmtMoneyShort(profit) : "—"}</div>
                          <div style={{fontSize:10,fontWeight:700,color:stateColor,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                            {stateLabel}
                          </div>
                          <div style={{fontSize:11,fontFamily:mono,color:T.muted}}>
                            {it.client_eta ? new Date(it.client_eta).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"}) : "—"}
                          </div>
                          <div style={{textAlign:"center",fontSize:14,color:isPaid ? T.green : T.faint}}>
                            {isPaid ? "✓" : "—"}
                          </div>
                        </button>

                        {/* Expanded editor */}
                        {isOpen && (
                          <div style={{padding:"0 14px 14px",borderTop:`1px solid ${T.border}`,marginTop:0}}>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(4, 1fr)",gap:10,marginTop:12}}>
                              <div>
                                <label style={{fontSize:10,color:T.faint,marginBottom:3,display:"block",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Qty (read-only)</label>
                                <input value={it.totalQty} disabled style={{...ic,background:T.surface,color:T.faint,fontFamily:mono}}/>
                              </div>
                              <div>
                                <label style={{fontSize:10,color:T.faint,marginBottom:3,display:"block",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Unit Cost <span style={{color:T.amber}}>·</span> sell_per_unit</label>
                                <input
                                  type="number" step="0.01" min="0"
                                  value={it.sell_per_unit ?? ""}
                                  onChange={e => saveItemField(it.id, "sell_per_unit", e.target.value === "" ? null : Number(e.target.value))}
                                  onBlur={e => {
                                    const v = e.target.value === "" ? null : Number(e.target.value);
                                    flushItemField(it.id, "sell_per_unit", v);
                                    if (v !== (Number(it.sell_per_unit) || null)) {
                                      logWorksheet(it.jobId, `Unit cost set to ${v == null ? "—" : "$" + Number(v).toFixed(2)} — ${it.name}`);
                                    }
                                  }}
                                  style={{...ic,fontFamily:mono}}/>
                                {saveErrors[`${it.id}_sell_per_unit`] && (
                                  <div style={{fontSize:9,color:T.red,marginTop:4,lineHeight:1.4,fontWeight:600}}>
                                    Save failed: {saveErrors[`${it.id}_sell_per_unit`]}
                                  </div>
                                )}
                                {it.quoteApprovedAt && (
                                  <div style={{fontSize:9,color:T.amber,marginTop:4,lineHeight:1.4}}>
                                    Quote approved {new Date(it.quoteApprovedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})}. Changes apply to future invoices only.
                                  </div>
                                )}
                              </div>
                              <div>
                                <label style={{fontSize:10,color:T.faint,marginBottom:3,display:"block",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Retail (manual)</label>
                                <input
                                  type="number" step="0.01" min="0"
                                  value={it.client_retail_per_unit ?? ""}
                                  onChange={e => saveItemField(it.id, "client_retail_per_unit", e.target.value === "" ? null : Number(e.target.value))}
                                  onBlur={e => {
                                    const v = e.target.value === "" ? null : Number(e.target.value);
                                    flushItemField(it.id, "client_retail_per_unit", v);
                                    if (v !== (Number(it.client_retail_per_unit) || null)) {
                                      logWorksheet(it.jobId, `Retail set to ${v == null ? "—" : "$" + Number(v).toFixed(2)} — ${it.name}`);
                                    }
                                  }}
                                  style={{...ic,fontFamily:mono}}/>
                                {saveErrors[`${it.id}_client_retail_per_unit`] && (
                                  <div style={{fontSize:9,color:T.red,marginTop:4,lineHeight:1.4,fontWeight:600}}>
                                    Save failed: {saveErrors[`${it.id}_client_retail_per_unit`]}
                                  </div>
                                )}
                              </div>
                              <div>
                                <label style={{fontSize:10,color:T.faint,marginBottom:3,display:"block",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Status</label>
                                <div style={{padding:"8px 10px",border:`1px solid ${T.border}`,borderRadius:6,background:T.surface,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                                  <span style={{fontSize:11,fontWeight:700,color:stateColor,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                                    {stateLabel}
                                  </span>
                                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                                    {/* Manual In Stock → Complete release. Stays manual
                                        until fulfillment products are wired up. The
                                        canonical resolver treats completed_at as an
                                        override that wins over pipeline_stage. */}
                                    {it._ws === "in_stock" && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          saveItemField(it.id, "completed_at", new Date().toISOString());
                                          logWorksheet(it.jobId, `Marked Complete — ${it.name}`);
                                        }}
                                        style={{
                                          fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:4,
                                          background:T.green,border:"none",color:"#fff",
                                          cursor:"pointer",fontFamily:font,
                                        }}
                                        title="Manually move from In Stock to Complete (e.g., released to retail)">
                                        ✓ Mark Complete
                                      </button>
                                    )}
                                    {it.completedAt && it._ws === "complete" && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          saveItemField(it.id, "completed_at", null);
                                          logWorksheet(it.jobId, `Reopened (Complete → In Stock) — ${it.name}`);
                                        }}
                                        style={{
                                          fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:4,
                                          background:"transparent",border:`1px solid ${T.border}`,color:T.muted,
                                          cursor:"pointer",fontFamily:font,
                                        }}
                                        title="Clear the manual completion — item reverts to whatever the underlying data says">
                                        ↻ Reopen
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = isArchived ? null : new Date().toISOString();
                                        saveItemField(it.id, "archived_at", next);
                                        logWorksheet(it.jobId, isArchived ? `Unarchived — ${it.name}` : `Archived — ${it.name}`);
                                      }}
                                      style={{
                                        fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:4,
                                        background:"transparent",border:`1px solid ${T.border}`,color:T.muted,
                                        cursor:"pointer",fontFamily:font,
                                      }}
                                      title="Archived items are hidden from active views">
                                      {isArchived ? "Unarchive" : "Archive"}
                                    </button>
                                  </div>
                                </div>
                                <div style={{fontSize:9,color:T.faint,marginTop:4,lineHeight:1.4}}>
                                  {it.completedAt
                                    ? "Manually completed. Reopen to fall back to underlying data."
                                    : "Derived from OpsHub. Mark Complete on In Stock items to release them manually."}
                                </div>
                              </div>
                              <div>
                                <label style={{fontSize:10,color:T.faint,marginBottom:3,display:"block",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>ETA</label>
                                <input
                                  type="date"
                                  value={it.client_eta || ""}
                                  onChange={e => saveItemField(it.id, "client_eta", e.target.value || null)}
                                  style={{...ic,fontFamily:mono}}/>
                              </div>
                              <div style={{gridColumn:"span 3"}}>
                                <label style={{fontSize:10,color:T.faint,marginBottom:3,display:"block",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Notes</label>
                                <input
                                  value={it.notes || ""}
                                  onChange={e => saveItemField(it.id, "notes", e.target.value)}
                                  style={ic}/>
                              </div>
                            </div>
                            <div style={{display:"flex",gap:10,marginTop:10,alignItems:"center",justifyContent:"space-between"}}>
                              <Link href={`/jobs/${it.jobId}`} style={{fontSize:11,color:T.accent,textDecoration:"none"}}>
                                Open project →
                              </Link>
                              <span style={{fontSize:10,color:T.faint}}>
                                Cost reads from sell_per_unit (changes propagate to quote/invoice/portal). Retail is private to this view.
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
          );
        })()}
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove contact"
        message={confirmRemove ? `Remove ${confirmRemove.name} from this client? Also unassigns them from any project they're on.` : ""}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!confirmRemove) return;
          // job_contacts.contact_id has no ON DELETE CASCADE so we
          // unassign first; otherwise the contacts delete fails
          // silently when the contact is on any job.
          const jc = await supabase.from("job_contacts").delete().eq("contact_id", confirmRemove.id);
          if (jc.error) { alert(`Couldn't unassign from projects: ${jc.error.message}`); return; }
          const c = await supabase.from("contacts").delete().eq("id", confirmRemove.id);
          if (c.error) { alert(`Couldn't delete contact: ${c.error.message}`); return; }
          setConfirmRemove(null);
          load();
        }}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        open={!!confirmDeleteFile}
        title="Delete document"
        message={confirmDeleteFile ? `Delete "${confirmDeleteFile.file_name}"? This removes it from Drive too.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmDeleteFile) return;
          const id = confirmDeleteFile.id;
          setConfirmDeleteFile(null);
          await deleteFile(id);
        }}
        onCancel={() => setConfirmDeleteFile(null)}
      />

      {previewFile && (
        <div onClick={()=>setPreviewFile(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",flexDirection:"column",padding:32}}>
          <div onClick={e=>e.stopPropagation()}
            style={{flex:1,display:"flex",flexDirection:"column",background:T.card,borderRadius:10,overflow:"hidden",border:`1px solid ${T.border}`,minHeight:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${T.border}`,background:T.surface,flexShrink:0}}>
              <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {previewFile.file_name}
              </div>
              {previewFile.drive_link && (
                <a href={previewFile.drive_link} target="_blank" rel="noopener noreferrer"
                  style={{fontSize:11,color:T.muted,textDecoration:"none",padding:"4px 10px",borderRadius:5,border:`1px solid ${T.border}`,fontFamily:font}}
                  onMouseEnter={(e:any)=>{e.currentTarget.style.color=T.text;e.currentTarget.style.borderColor=T.accent;}}
                  onMouseLeave={(e:any)=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border;}}>
                  Open in Drive
                </a>
              )}
              <button onClick={()=>setPreviewFile(null)}
                style={{background:"none",border:"none",fontSize:18,color:T.muted,cursor:"pointer",lineHeight:1,padding:"0 6px"}}
                onMouseEnter={e=>e.currentTarget.style.color=T.text}
                onMouseLeave={e=>e.currentTarget.style.color=T.muted}>✕</button>
            </div>
            {previewFile.drive_file_id ? (
              (previewFile.mime_type || "").startsWith("image/") ? (
                // Render image directly via the service-account proxy — no
                // Drive iframe chrome (i.e. that pop-out icon Google bakes
                // into /preview). Public Drive thumbnail URLs don't work
                // here because the service account doesn't share files.
                <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:"#000",minHeight:0,padding:8}}>
                  <img src={`/api/files/thumbnail?id=${previewFile.drive_file_id}`}
                    alt={previewFile.file_name}
                    style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>
                </div>
              ) : (
                // PDFs / docs / etc — Drive iframe is the cleanest cross-format
                // preview, but it ships its own pop-out icon top-right.
                // Cover it with a small overlay matching the iframe bg.
                <div style={{flex:1,position:"relative",background:"#525659",minHeight:0}}>
                  <iframe src={`https://drive.google.com/file/d/${previewFile.drive_file_id}/preview`}
                    style={{position:"absolute",inset:0,width:"100%",height:"100%",border:"none"}}/>
                  <div style={{position:"absolute",top:0,right:0,width:56,height:56,background:"#525659",pointerEvents:"none"}}/>
                </div>
              )
            ) : (
              <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:T.muted,fontSize:13}}>
                File not available — Drive link missing.
              </div>
            )}
          </div>
        </div>
      )}

      <QBCustomerChooser
        open={qbChooserOpen}
        mode="link"
        clientId={params.id}
        searchedName={client?.name || ""}
        current={qbLinked === "loading" ? undefined : qbLinked}
        busy={qbBusy}
        onAction={handleQbAction}
        onClose={()=>setQbChooserOpen(false)}
      />
    </div>
  );
}
