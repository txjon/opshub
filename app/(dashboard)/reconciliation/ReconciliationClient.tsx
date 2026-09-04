"use client";

// Phase 1 — Cost Reconciliation Inbox (AP). Assistant enters a vendor invoice
// line (vendor, their invoice #, PO ref, amount, type); the PO ref auto-resolves
// the job + client and shows expected decorator cost vs actual (variance).
// Unmatched refs drop to a queue for a manual job-pick. No QB writes (Phase 3).
// See memory: opshub-cost-reconciliation.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { useConfirm } from "@/components/useConfirm";
import { buildPoRefIndex, resolvePoRef, type JobLite } from "@/lib/po-ref-match";
import { buildPrintersMap, calcCostProduct } from "@/lib/pricing";
import { computeBillingQueue } from "@/lib/billing-queue";
import { VarianceView } from "./VarianceView";
import { ShippingView } from "./ShippingView";
import { ContractorHoursView } from "./ContractorHoursView";
import { isFreightSource } from "@/lib/ups-freight";

const supabase = createClient();

const money0 = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

const CHARGE_TYPES = [
  { v: "production", label: "Production" },
  { v: "setup_mold", label: "Setup / Mold" },
  { v: "sample", label: "Sample" },
  { v: "freight", label: "Freight" },
  { v: "other", label: "Other" },
];

type Vendor = { id: string; name: string; kind: string; decorator_id: string | null; match_keys?: string[] | null; default_bill_method?: string };
type Entry = {
  id: string; vendor_id: string | null; vendor_name: string | null; vendor_invoice_number: string | null;
  po_ref: string | null; job_id: string | null; amount: number; expected_amount: number | null;
  charge_type: string; status: string; not_job_specific: boolean; notes: string | null; created_at: string; bill_method?: string; qb_bill_id?: string | null; qb_paid_at?: string | null; bill_group_id?: string | null; hpd_bill_number?: string | null;
};
const BILL_METHODS = [
  { v: "invoice", label: "Invoice" },
  { v: "credit_card", label: "Credit card" },
  { v: "other", label: "Other" },
];
// how a logged line's reference reads, by method
const refLabel = (e: { bill_method?: string; vendor_invoice_number: string | null }) => {
  const r = e.vendor_invoice_number;
  if (e.bill_method === "credit_card") return r ? `CC · ${r}` : "CC charge";
  if (e.bill_method === "other") return r ? `ref ${r}` : "—";
  return `inv ${r || "—"}`;
};

// Disposition when marking a vendor fully billed — separates "$X to chase" from
// "$X that's fine" on the board.
const REASONS: { v: string; label: string }[] = [
  { v: "matches", label: "Fully billed — matches" },
  { v: "under", label: "Came in under (saved)" },
  { v: "over_accept", label: "Over — accepted" },
  { v: "over_dispute", label: "Over — disputing" },
  { v: "qb_addition", label: "Added in QB (pre-revise)" },
  { v: "costing_miss", label: "Costing miss" },
  { v: "other", label: "Other" },
];
const reasonLabel = (r: string | null) => REASONS.find(x => x.v === r)?.label || "Complete";
// Asymmetric variance band — mirrors lib/billing-queue.ts: accept up to 10% UNDER
// (savings / damage-short credits) but only 3% OVER (catch overcharges), $50 floor.
const inTol = (billed: number, expected: number) => {
  const d = billed - expected;
  return d >= 0 ? d <= Math.max(50, expected * 0.03) : -d <= Math.max(50, expected * 0.10);
};
const autoReason = (billed: number, expected: number) => {
  if (inTol(billed, expected)) return "matches";
  return billed > expected ? "over_accept" : "under";
};

// Parse a PO ref into its job digits + item letters. "4313-F" → {4313,[F]};
// "4313ABCDEFGHIJKLMNOPQR" → {4313,[A..R]} (a vendor billing many items in one line).
const parsePoRef = (ref: string | null | undefined): { digits: string | null; letters: string[] } => {
  const m = (ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^(\d{3,4})([A-Z]*)$/);
  if (!m) return { digits: null, letters: [] };
  return { digits: m[1], letters: m[2] ? m[2].split("") : [] };
};

const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Tolerate "$7,627.20" / "7,627.20" pasted straight from an invoice.
const parseAmount = (s: string) => parseFloat(String(s).replace(/[^0-9.]/g, "")) || 0;

export default function ReconciliationClient({ companyId, billingOnly = false }: { companyId: string; billingOnly?: boolean }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [freightEntries, setFreightEntries] = useState<any[]>([]); // UPS inbound freight — separate pipeline
  const [decorators, setDecorators] = useState<any[]>([]);
  const [jobItems, setJobItems] = useState<any[]>([]); // items (blanks_order_cost) for the Variances tab
  const [jobsRaw, setJobsRaw] = useState<Record<string, any>>({});
  const [marks, setMarks] = useState<{ job_id: string; vendor_id: string; reason: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  // add-form state
  const [vendorId, setVendorId] = useState("");
  const [invoiceNum, setInvoiceNum] = useState("");
  const [poRef, setPoRef] = useState("");
  const [amount, setAmount] = useState("");
  const [chargeType, setChargeType] = useState("production");
  const [saving, setSaving] = useState(false);

  // unmatched manual-assign search
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignQuery, setAssignQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // expanded job / job×vendor rows
  const toggle = (k: string) => setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const [qFilter, setQFilter] = useState<"open" | "complete" | "all">("open");
  const [vendorFilter, setVendorFilter] = useState<string>(""); // "" = all vendors
  const [showForm, setShowForm] = useState(false);
  const [showByVendor, setShowByVendor] = useState(false);
  const [search, setSearch] = useState("");
  const [billVendorFilter, setBillVendorFilter] = useState(""); // vendor select for the bills list (189 rows and counting)
  const [view, setView] = useState<"queue" | "history" | "variances" | "shipping" | "hours">("queue");
  const [confirm, confirmEl] = useConfirm();
  // (inline bill entry removed — all bill creation goes through the New Bill form)
  // New Bill modal (QB-style entry, job-aware)
  const [showBill, setShowBill] = useState(false);
  const [nbVendor, setNbVendor] = useState("");
  const [nbVendorSearch, setNbVendorSearch] = useState(""); // vendor typeahead
  const [nbVendorOpen, setNbVendorOpen] = useState(false);
  const [nbBillNumber, setNbBillNumber] = useState(""); // HPD Bill Number (auto, job-number style) → QB Bill no.
  // Editable rows — add blank rows, then fill PO / invoice # / amount down each
  // column (spreadsheet-style batch entry). resolved fills in as the PO resolves.
  type NbResolved = { poRef: string; job_id: string; job_number: string; client_name: string | null; itemName: string; projected: number; apVendorId: string | null };
  const [nbLines, setNbLines] = useState<{ id: string; poInput: string; invoiceNumber: string; amount: string; resolved: NbResolved | null }[]>([]);
  const [nbBillGroupId, setNbBillGroupId] = useState("");      // groups a bill's lines + attachments
  const [nbAttachments, setNbAttachments] = useState<any[]>([]);
  const [nbUploading, setNbUploading] = useState(false);
  const [nbSaving, setNbSaving] = useState(false);
  const [nbSavedIds, setNbSavedIds] = useState<string[] | null>(null); // entry ids after Save → unlocks Push to QB
  const [nbPushedId, setNbPushedId] = useState<string | null>(null);
  const [nbPushing, setNbPushing] = useState(false);
  const [nbNotified, setNbNotified] = useState(false);

  async function loadAll() {
    const [v, j, e, d, m, itm] = await Promise.all([
      supabase.from("ap_vendors").select("id, name, kind, decorator_id, match_keys, default_bill_method").eq("active", true).order("name"),
      supabase.from("jobs").select("id, job_number, phase, type_meta, client_id, clients(name), costing_data, costing_summary").eq("company_id", companyId).order("created_at", { ascending: false }),
      supabase.from("cost_entries").select("*").order("created_at", { ascending: false }),
      supabase.from("decorators").select("id, name, short_code, pricing_data, capabilities, contacts_list"),
      supabase.from("cost_vendor_status").select("job_id, vendor_id, reason"),
      supabase.from("items").select("id, job_id, name, sort_order, blank_costs, blanks_order_cost, blanks_order_number, buy_sheet_lines(size, qty_ordered)"),
    ]);
    setMarks((m.data as any) || []);
    setVendors((v.data as any) || []);
    const jrows = ((j.data as any) || []);
    const jl: JobLite[] = jrows.map((x: any) => ({
      id: x.id, job_number: x.job_number, qb_invoice_number: x.type_meta?.qb_invoice_number || null,
      client_id: x.client_id, client_name: x.clients?.name || null,
    }));
    setJobs(jl);
    setJobsRaw(Object.fromEntries(jrows.map((x: any) => [x.id, x])));
    // Scope entries to this company's jobs (jobs are company-filtered above); keep
    // vendor-level / not-job-specific entries (null job_id). Removes other tenants'
    // bills from totals + Bill History.
    const jobIdSet = new Set(jrows.map((x: any) => x.id));
    // Exclude UPS inbound-freight imports — those live entirely in the Shipping
    // (Inbound Freight) tab, never the PO-bill queue / Billed KPI / variance.
    setEntries((((e.data as any) || []) as any[]).filter(en => !isFreightSource(en.source) && (!en.job_id || jobIdSet.has(en.job_id))));
    setFreightEntries((((e.data as any) || []) as any[]).filter(en => isFreightSource(en.source)));
    setDecorators((d.data as any) || []);
    setJobItems((((itm.data as any) || []) as any[]).filter(it => jobIdSet.has(it.job_id))); // for blank variance
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  const idx = useMemo(() => buildPoRefIndex(jobs), [jobs]);
  const printers = useMemo(() => buildPrintersMap(decorators), [decorators]);
  const jobById = useMemo(() => Object.fromEntries(jobs.map(j => [j.id, j])), [jobs]);
  // vendor_id → the costProd.printVendor key(s) this AP vendor's invoices cover.
  // One payable vendor can span several costing vendors (e.g. Teeland Screen +
  // Embroidery), so this is a SET of keys (from ap_vendors.match_keys; falls back
  // to the linked decorator's short_code||name for any vendor without keys set).
  const vendorKeys = useMemo(() => {
    const dById = Object.fromEntries(decorators.map(d => [d.id, d]));
    const m: Record<string, string[]> = {};
    for (const v of vendors) {
      if (v.match_keys && v.match_keys.length) { m[v.id] = v.match_keys.map(k => (k || "").toUpperCase()); continue; }
      const d = v.decorator_id ? dById[v.decorator_id] : null;
      if (d) m[v.id] = [(d.short_code || d.name || "").toUpperCase()];
    }
    return m;
  }, [vendors, decorators]);

  // Expected decorator cost for a job × vendor = sum of costProd.poTotal for that
  // vendor's items. poTotal is the decorator charge (independent of margin/ship).
  function expectedVendorCost(jobId: string, vId: string | null): number | null {
    if (!jobId || !vId) return null;
    const keys = vendorKeys[vId];
    const jr = jobsRaw[jobId];
    if (!keys || !keys.length || !jr?.costing_data?.costProds) return null;
    const keySet = new Set(keys);
    const cps = jr.costing_data.costProds;
    const margin = String(jr.costing_data?.margin ?? jr.costing_summary?.margin ?? 0);
    let total = 0; let hit = false;
    for (const cp of cps) {
      if (!keySet.has((cp.printVendor || "").toUpperCase())) continue;
      const r = calcCostProduct(cp, margin, false, false, cps, printers);
      if (r) { total += r.poTotal || 0; hit = true; }
    }
    return hit ? Math.round(total * 100) / 100 : null;
  }

  const resolved = useMemo(() => resolvePoRef(poRef, idx), [poRef, idx]);
  const formExpected = useMemo(() => resolved ? expectedVendorCost(resolved.id, vendorId) : null, [resolved, vendorId, jobsRaw, printers, vendorKeys]); // eslint-disable-line
  // already-entered total for this job × vendor, so the readout is cumulative
  const priorForForm = (resolved && vendorId)
    ? entries.filter(e => e.job_id === resolved.id && e.vendor_id === vendorId && !e.not_job_specific).reduce((s, e) => s + Number(e.amount || 0), 0)
    : 0;

  async function addEntry() {
    const amt = parseAmount(amount);
    if (!vendorId || !amt) return;
    setSaving(true);
    const job = resolved;
    const expected = job ? expectedVendorCost(job.id, vendorId) : null;
    const vendorName = vendors.find(v => v.id === vendorId)?.name || null;
    const { error } = await supabase.from("cost_entries").insert({
      source: chargeType === "freight" ? "freight" : "decorator_invoice",
      vendor_id: vendorId, vendor_name: vendorName,
      vendor_invoice_number: invoiceNum.trim() || null,
      po_ref: poRef.trim() || null,
      job_id: job?.id || null,
      amount: amt, expected_amount: expected,
      charge_type: chargeType,
      status: job ? "matched" : "unmatched",
      bill_method: vendorMethod(vendorId),
    } as any);
    setSaving(false);
    if (!error) { setInvoiceNum(""); setPoRef(""); setAmount(""); loadAll(); }
  }

  async function assignJob(entryId: string, job: JobLite) {
    const e = entries.find(x => x.id === entryId);
    const expected = e ? expectedVendorCost(job.id, e.vendor_id) : null;
    await supabase.from("cost_entries").update({ job_id: job.id, status: "matched", expected_amount: expected }).eq("id", entryId);
    setAssignFor(null); setAssignQuery(""); loadAll();
  }
  async function markNotJobSpecific(entryId: string) {
    await supabase.from("cost_entries").update({ not_job_specific: true, status: "matched" }).eq("id", entryId);
    loadAll();
  }
  async function removeEntry(entryId: string) {
    // hard delete with no trace — the bare × buttons used to fire this
    // instantly, silently changing Billed/Open-PO numbers (incl. QB-pushed
    // history rows). Confirm matches this file's other destructive flows.
    if (!await confirm({ title: "Delete this cost entry?", message: "This is permanent — it changes Billed / Open-PO totals and cannot be undone.", confirmLabel: "Delete" })) return;
    await supabase.from("cost_entries").delete().eq("id", entryId);
    loadAll();
  }
  // Push a logged bill (a group of cost_entries) to QuickBooks as an AP Bill —
  // vendor + COGS lines + the job's client pre-assigned on each line.
  const [pushingBill, setPushingBill] = useState<string | null>(null);
  async function pushBillToQb(bKey: string, entryIds: string[]) {
    setPushingBill(bKey);
    try {
      const res = await fetch("/api/qb/bill", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Push to QB failed: ${data.error || res.status}`); return; }
      const noCust = data.lines - data.customersLinked;
      alert(`Pushed to QuickBooks — Bill #${data.billId} · ${data.lines} line${data.lines !== 1 ? "s" : ""}, ${data.customersLinked} customer-linked${noCust > 0 ? ` (${noCust} without a QB customer)` : ""}.`);
      loadAll();
    } catch (e: any) {
      alert(`Push to QB failed: ${e?.message || "network error"}`);
    } finally {
      setPushingBill(null);
    }
  }
  // Send the vendor remittance for a logged bill, from Bill History.
  // Remittance recipient picker — shared by the modal + Bill History.
  const [notifyFor, setNotifyFor] = useState<{ entryIds: string[]; vendorName: string; contacts: any[]; chosen: string; source: "modal" | "history" } | null>(null);
  const [notifySending, setNotifySending] = useState(false);
  function vendorContacts(vendorId: string | null) {
    const v = vendors.find(x => x.id === vendorId);
    const d = v?.decorator_id ? decorators.find(dd => dd.id === v.decorator_id) : null;
    return (((d?.contacts_list as any[]) || [])).filter(c => c?.email);
  }
  function autoPickEmail(contacts: any[]) {
    const roleName = /bill|account|finance|payable|remit|\bap\b/i;
    const emailLocal = /^(bill|account|finance|ap|payable|remit|invoice)/i;
    const m = contacts.find(c => roleName.test(c.role || "") || roleName.test(c.name || "") || emailLocal.test(String(c.email).split("@")[0]));
    return (m || contacts[0])?.email || "";
  }
  function openNotify(entryIds: string[], vendorId: string | null, vendorName: string, source: "modal" | "history") {
    const contacts = vendorContacts(vendorId);
    if (!contacts.length) { alert(`No email on file for ${vendorName}. Add a contact with an email on the decorator record, then notify.`); return; }
    setNotifyFor({ entryIds, vendorName, contacts, chosen: autoPickEmail(contacts), source });
  }
  async function sendNotify() {
    if (!notifyFor) return;
    setNotifySending(true);
    try {
      const res = await fetch("/api/qb/bill/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryIds: notifyFor.entryIds, recipientEmail: notifyFor.chosen }) });
      const d = await res.json();
      if (!res.ok) { alert(`Notify failed: ${d.error || res.status}`); return; }
      alert(`Remittance emailed to ${d.sentTo} — ${d.invoices} invoice${d.invoices !== 1 ? "s" : ""}, ${money(d.total)}. You're CC'd.`);
      if (notifyFor.source === "modal") setNbNotified(true);
      setNotifyFor(null);
    } catch (e: any) { alert(`Notify failed: ${e?.message || "network error"}`); }
    finally { setNotifySending(false); }
  }

  const vendorMethod = (apVendorId: string | null) => vendors.find(v => v.id === apVendorId)?.default_bill_method || "invoice";
  // Next HPD Bill Number — job-number style {PREFIX}-B-YYMM-NNN, sequential per
  // month, derived from existing entries. Prefix follows the company's job
  // numbers (e.g. "HPD"). Computed at modal open; stamped on save → QB Bill no.
  function computeNextBillNumber() {
    const prefix = (jobs.find(j => j.job_number)?.job_number || "HPD-").split("-")[0] || "HPD";
    const dt = new Date();
    const yymm = `${String(dt.getFullYear()).slice(2)}${String(dt.getMonth() + 1).padStart(2, "0")}`;
    const base = `${prefix}-B-${yymm}-`;
    let max = 0;
    for (const e of entries) {
      const n = e.hpd_bill_number;
      if (n && n.startsWith(base)) { const num = parseInt(n.slice(base.length), 10); if (num > max) max = num; }
    }
    return `${base}${String(max + 1).padStart(3, "0")}`;
  }
  // Inline bill entry removed — all bill creation goes through the New Bill form.

  const unmatched = entries.filter(e => e.status === "unmatched" && !e.not_job_specific);
  const notJobSpecific = entries.filter(e => e.not_job_specific);

  // BILLING QUEUE — the spine. Driven by costing + PO-sent (not by logged
  // invoices): every job × PO-sent vendor → expected (costing) vs billed (entries),
  // gap = outstanding; summed = OPEN PO COMMITMENT. See lib/billing-queue.ts.
  const itemsByJob = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const it of jobItems as any[]) (m[it.job_id] = m[it.job_id] || []).push(it);
    for (const list of Object.values(m)) list.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    return m;
  }, [jobItems]);
  const queue = useMemo(() => computeBillingQueue({
    jobs: Object.values(jobsRaw), printers, apVendors: vendors as any, entries: entries as any, marks, itemsByJob,
  }), [jobsRaw, printers, vendors, entries, marks, itemsByJob]);
  const sq = search.trim().toLowerCase();
  const vendorOptions = useMemo(() => Array.from(new Set(queue.jobs.flatMap(j => j.vendors.map(v => v.name)))).sort(), [queue]);
  const filteredQueue = queue.jobs
    .filter(j => !vendorFilter || j.vendors.some(v => v.name === vendorFilter))
    .filter(j => qFilter === "all" ? true : qFilter === "complete" ? j.costComplete : !j.costComplete)
    .filter(j => !sq || (j.qb_invoice_number || "").toLowerCase().includes(sq) || (j.job_number || "").toLowerCase().includes(sq) || (j.client_name || "").toLowerCase().includes(sq) || j.vendors.some(v => v.name.toLowerCase().includes(sq)));
  // PO ref → line detail, for the New Bill lookup (type a PO #, get job/client/projected)
  const poIndex = useMemo(() => {
    const m: Record<string, { poRef: string; job_id: string; job_number: string; qb: string | null; client_name: string | null; vendorName: string; apVendorId: string | null; itemName: string; projected: number }> = {};
    for (const j of queue.jobs) for (const v of j.vendors) for (const it of v.items) {
      m[it.poRef.toUpperCase().replace(/[^A-Z0-9]/g, "")] = { poRef: it.poRef, job_id: j.id, job_number: j.job_number, qb: j.qb_invoice_number, client_name: j.client_name, vendorName: v.name, apVendorId: v.apVendorId, itemName: it.name, projected: it.expected };
    }
    return m;
  }, [queue]);
  // Amount already billed on each PO (across existing cost entries), so New Bill can
  // show CUMULATIVE variance — a revised/additional charge on an already-billed PO is
  // normal, and the variance must be (prior + this line) vs projected, not this line alone.
  const billedPoTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) {
      const k = (e.po_ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (k) m[k] = Math.round(((m[k] || 0) + Number(e.amount || 0)) * 100) / 100;
    }
    return m;
  }, [entries]);
  // Deposit-aware prior (Aug 25 2026 — FCX balance entry flagged −$34K
  // because the deposit was logged job-level, ref "4191", never matching
  // key "4191B"): when a vendor has exactly ONE PO line on a job, every
  // bill on that job×vendor unambiguously belongs to that line — prior =
  // the vendor-level total. Multi-line vendors keep exact-key matching
  // (a job-level bill can't be attributed per-letter there).
  const vendorLineCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const j of queue.jobs) for (const v of j.vendors) m[`${j.id}::${v.apVendorId}`] = v.items.length;
    return m;
  }, [queue]);
  const billedJobVendorTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) {
      if (!e.job_id || !e.vendor_id || e.not_job_specific) continue;
      const k = `${e.job_id}::${e.vendor_id}`;
      m[k] = Math.round(((m[k] || 0) + Number(e.amount || 0)) * 100) / 100;
    }
    return m;
  }, [entries]);
  const priorBilledFor = (resolved: NbResolved | null): number => {
    if (!resolved) return 0;
    const poKey = resolved.poRef.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const jvKey = `${resolved.job_id}::${resolved.apVendorId}`;
    if ((vendorLineCount[jvKey] || 0) === 1) return billedJobVendorTotals[jvKey] || billedPoTotals[poKey] || 0;
    return billedPoTotals[poKey] || 0;
  };
  const billedPoAmounts = useMemo(() => {
    const m: Record<string, number[]> = {};
    for (const e of entries) {
      const k = (e.po_ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (k) (m[k] = m[k] || []).push(Number(e.amount || 0));
    }
    return m;
  }, [entries]);
  // A same-amount re-entry on a PO is the real double-bill signal (vs a legit
  // additional charge, which has a different amount). Only this hard-blocks on save.
  const isExactDup = (poRef: string, amt: number) => {
    const k = poRef.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return amt > 0 && (billedPoAmounts[k] || []).some(a => Math.abs(a - amt) < 0.005);
  };
  // Resolve a typed PO ref to a New Bill line — a single item, OR a multi-item ref
  // (one line covering several POs, summed projection), matching how vendors invoice.
  const resolveNbPo = (input: string) => {
    const norm = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (poIndex[norm]) { const h = poIndex[norm]; return { ...h, multi: false, multiVendor: false }; }
    const { digits, letters } = parsePoRef(input);
    if (!digits || letters.length < 2) return null;
    const items = letters.map(L => poIndex[digits + L]).filter(Boolean);
    if (!items.length) return null;
    const first = items[0];
    const vendorIds = [...new Set(items.map(i => i.apVendorId))];
    return {
      poRef: norm, job_id: first.job_id, job_number: first.job_number, qb: first.qb, client_name: first.client_name,
      vendorName: first.vendorName, apVendorId: vendorIds.length === 1 ? vendorIds[0] : null,
      itemName: `${items.length} items · ${letters.join("")}`,
      projected: Math.round(items.reduce((s, i) => s + i.projected, 0) * 100) / 100,
      multi: true, multiVendor: vendorIds.length > 1,
    };
  };
  // Bill history — group entries into bills (vendor + invoice #, or a save batch
  // for no-invoice/CC), newest first, filtered by the same search box.
  const bills = useMemo(() => {
    const g: Record<string, { key: string; groupId: string | null; hpdNumber: string | null; vendor_id: string | null; vendor_name: string | null; invoice: string | null; method?: string; lines: Entry[] }> = {};
    for (const e of entries) {
      // Prefer the explicit bill_group_id (a bill saved as one unit); fall back to
      // vendor + invoice # for older entries that predate grouping.
      const batch = e.vendor_invoice_number || `b:${(e.created_at || "").slice(0, 16)}`;
      const key = e.bill_group_id || `${e.vendor_id}|${batch}`;
      (g[key] = g[key] || { key, groupId: e.bill_group_id || null, hpdNumber: e.hpd_bill_number || null, vendor_id: e.vendor_id, vendor_name: e.vendor_name, invoice: e.vendor_invoice_number, method: e.bill_method, lines: [] }).lines.push(e);
    }
    const arr = Object.values(g).map(b => ({
      ...b,
      total: Math.round(b.lines.reduce((s, e) => s + Number(e.amount || 0), 0) * 100) / 100,
      date: b.lines.reduce((d, e) => ((e.created_at || "") > d ? (e.created_at || "") : d), ""),
    }));
    arr.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return arr;
  }, [entries]);
  const filteredBills = bills.filter(b => {
    if (billVendorFilter && (b.vendor_name || "") !== billVendorFilter) return false;
    if (!sq) return true;
    if ((b.vendor_name || "").toLowerCase().includes(sq) || (b.invoice || "").toLowerCase().includes(sq)) return true;
    return b.lines.some(e => (e.po_ref || "").toLowerCase().includes(sq) || (e.job_id ? (jobById[e.job_id]?.client_name || "").toLowerCase().includes(sq) : false));
  });
  // open PO broken down by vendor — "who do we owe"
  const openByVendor = (() => {
    const m: Record<string, { name: string; outstanding: number; jobs: number }> = {};
    for (const j of queue.jobs) for (const v of j.vendors) {
      if (v.outstanding <= 0) continue;
      (m[v.name] = m[v.name] || { name: v.name, outstanding: 0, jobs: 0 });
      m[v.name].outstanding += v.outstanding; m[v.name].jobs++;
    }
    return Object.values(m).sort((a, b) => b.outstanding - a.outstanding);
  })();
  // entries for a job × vendor, for the drill-down under a vendor row
  const entriesFor = (jobId: string, vId: string | null) => entries.filter(e => e.job_id === jobId && e.vendor_id === vId && !e.not_job_specific);
  const STATE_META: Record<string, { label: string; color: string }> = {
    awaiting: { label: "Awaiting invoice", color: T.faint },
    partial: { label: "Partial", color: T.amber },
    billed: { label: "Billed", color: T.green },
    over: { label: "Over", color: T.red },
    nobaseline: { label: "No baseline", color: T.faint },
    complete: { label: "✓ Complete", color: T.green },
  };
  async function markComplete(jobId: string, apVendorId: string | null, reason: string) {
    if (!apVendorId) return;
    await supabase.from("cost_vendor_status").upsert({ job_id: jobId, vendor_id: apVendorId, status: "complete", reason }, { onConflict: "job_id,vendor_id" } as any);
    loadAll();
  }
  // Pre-OpsHub close-out (Jon, Sep 4): marking "fully billed" with ZERO bills
  // logged used to close the vendor at $0 — the decorator then read as FREE
  // in margin and variance claimed the full PO as phantom savings. These are
  // real early POs billed before AP existed, so record the bill AT the PO
  // amount: source "pre_opshub" (never pushed to QB — the money settled
  // years ago), matched, then mark complete as a clean match.
  const [preOpsArm, setPreOpsArm] = useState<string | null>(null); // `${jobId}::${vendorId}` two-tap
  async function markFullyBilledPreOps(jobId: string, v: any) {
    if (!v.apVendorId) return;
    await supabase.from("cost_entries").insert({
      source: "pre_opshub",
      vendor_id: v.apVendorId, vendor_name: v.name,
      vendor_invoice_number: null,
      po_ref: null,
      job_id: jobId,
      amount: v.expected, expected_amount: v.expected,
      charge_type: "production",
      status: "matched",
      bill_method: vendorMethod(v.apVendorId),
    } as any);
    await markComplete(jobId, v.apVendorId, "matches");
    setPreOpsArm(null);
  }
  async function reopenVendor(jobId: string, apVendorId: string | null) {
    if (!apVendorId) return;
    await supabase.from("cost_vendor_status").delete().eq("job_id", jobId).eq("vendor_id", apVendorId);
    loadAll();
  }
  const [queueJobId, setQueueJobId] = useState<string | null>(null); // job whose full breakdown modal is open

  // Full per-job breakdown — all vendors expanded (PO lines, bill entry, mark-complete).
  // Rendered inside the job modal so the queue list stays a clean summary.
  function renderJobDetail(j: any) {
    return (
      <div>
        {j.vendors.map((v: any) => {
          const vKey = `${j.id}::${v.apVendorId}`;
          // Card-at-order vendors (default_bill_method credit_card): no
          // invoice is ever coming — the row's verb is "confirm the charge",
          // one click, amount prefilled with the outstanding commitment.
          const isCardVendor = vendors.find(x => x.id === v.apVendorId)?.default_bill_method === "credit_card";
          const meta = isCardVendor && v.state === "awaiting"
            ? { label: "Card — confirm charge", color: T.amber }
            : STATE_META[v.state];
          const lines = entriesFor(j.id, v.apVendorId);
          const vLetters = new Set(v.items.map((it: any) => parsePoRef(it.poRef).letters[0]).filter(Boolean));
          const exactByLetter: Record<string, Entry[]> = {};
          const coveringEntries: Entry[] = [];
          const trueOther: Entry[] = [];
          for (const e of lines) {
            const p = parsePoRef(e.po_ref);
            if (p.digits && p.letters.length === 1 && vLetters.has(p.letters[0])) (exactByLetter[p.letters[0]] = exactByLetter[p.letters[0]] || []).push(e);
            else if (p.digits && p.letters.length > 1 && p.letters.some(L => vLetters.has(L))) coveringEntries.push(e);
            else trueOther.push(e);
          }
          return (
            <div key={vKey} style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", fontSize: 12, background: T.surface, borderBottom: `1px solid ${T.border}55` }}>
                <span style={{ flex: 1, color: T.text, fontWeight: 700 }}>{v.name}{v.items.length > 1 ? <span style={{ color: T.faint, fontWeight: 400 }}> · {v.items.length} POs</span> : ""}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.color + "1f", padding: "2px 9px", borderRadius: 20 }}>{meta.label}</span>
                <span style={{ width: 150, textAlign: "right", fontFamily: mono, color: T.text }}>{money(v.billed)} <span style={{ color: T.faint }}>of {money(v.expected)}</span></span>
                <span style={{ width: 90, textAlign: "right", fontFamily: mono, fontWeight: 700, color: v.outstanding > 0 ? T.amber : T.green }}>{v.outstanding > 0 ? money(v.outstanding) : "—"}</span>
                {isCardVendor && v.outstanding > 0 && !v.complete && (
                  <ConfirmCardCharge vendor={v} jobId={j.id} onDone={loadAll} />
                )}
              </div>
              <div style={{ background: T.bg }}>
                {v.items.map((it: any) => {
                  const myLetter = parsePoRef(it.poRef).letters[0];
                  const poLines = exactByLetter[myLetter] || [];
                  const billedPo = Math.round(poLines.reduce((s, e) => s + Number(e.amount || 0), 0) * 100) / 100;
                  const isBilled = poLines.length > 0;
                  const covering = !isBilled ? coveringEntries.find(e => parsePoRef(e.po_ref).letters.includes(myLetter)) : null;
                  const isCovered = !!covering;
                  const exp = it.expected;
                  const diff = isBilled ? Math.round((billedPo - exp) * 100) / 100 : 0;
                  const lstate = isBilled ? (inTol(billedPo, exp) ? "ok" : diff < 0 ? "under" : "over") : isCovered ? "covered" : "await";
                  const dot = lstate === "await" ? T.border : lstate === "over" ? T.red : lstate === "under" ? T.amber : T.green;
                  const amtColor = lstate === "over" ? T.red : lstate === "under" ? T.amber : T.green;
                  const filled = isBilled || isCovered;
                  return (
                    <div key={it.poRef}>
                      <div className="bq-row" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 38, padding: "5px 14px", borderTop: `1px solid ${T.border}22`, borderLeft: `2px solid ${filled ? dot : "transparent"}` }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: filled ? dot : "transparent", border: filled ? "none" : `1.5px solid ${T.border}` }} />
                        <span className="bq-mono" style={{ width: 92, fontFamily: mono, fontSize: 12, color: T.text, fontWeight: 600 }}>{it.poRef}</span>
                        <span style={{ flex: 1, fontSize: 12.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</span>
                        <div style={{ width: 170, textAlign: "right" }}>
                          {isBilled ? <>
                            <div className="bq-mono" style={{ fontFamily: mono, fontSize: 12.5, color: amtColor, fontWeight: 600, lineHeight: 1.25 }}>{money(billedPo)}</div>
                            {diff !== 0 && <div className="bq-mono" style={{ fontFamily: mono, fontSize: 9.5, color: T.faint, lineHeight: 1.25 }}>proj {money(exp)} · <span style={{ color: diff > 0 ? T.red : T.muted, fontWeight: 600 }}>{diff < 0 ? "−" : "+"}{money(Math.abs(diff))}</span></div>}
                          </> : isCovered ? <>
                            <div className="bq-mono" style={{ fontFamily: mono, fontSize: 12.5, color: T.muted }}>{money(exp)}</div>
                            <div style={{ fontSize: 9.5, color: T.green, lineHeight: 1.25, fontWeight: 600 }}>covered · {refLabel(covering!)}</div>
                          </> : <span className="bq-mono" style={{ fontFamily: mono, fontSize: 12.5, color: T.muted }}>{money(exp)}</span>}
                        </div>
                        <span style={{ width: 50 }} />
                      </div>
                      {poLines.map(e => (
                        <div key={e.id} className="bq-row" style={{ display: "flex", alignItems: "center", gap: 12, height: 28, padding: "0 14px 0 30px", borderTop: `1px solid ${T.border}14` }}>
                          <span style={{ flex: 1, fontSize: 11.5, color: T.faint, fontFamily: mono }}>{refLabel(e)}</span>
                          <span className="bq-mono" style={{ width: 150, textAlign: "right", fontFamily: mono, fontSize: 11.5, color: T.muted }}>{money(e.amount)}</span>
                          <span className="bq-act" style={{ width: 50, display: "flex", justifyContent: "flex-end" }}><button onClick={ev => { ev.stopPropagation(); removeEntry(e.id); }} className="bq-x">×</button></span>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {coveringEntries.length > 0 && <div style={{ padding: "8px 14px 2px", fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green }}>Bills covering these POs</div>}
                {coveringEntries.map(e => (
                  <div key={e.id} className="bq-row" style={{ display: "flex", alignItems: "center", gap: 12, height: 30, padding: "0 14px", borderTop: `1px solid ${T.border}14`, borderLeft: `2px solid ${T.green}` }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: T.green }} />
                    <span className="bq-mono" style={{ width: 200, fontFamily: mono, fontSize: 11.5, color: T.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.po_ref || "—"}</span>
                    <span style={{ flex: 1, fontSize: 11.5, color: T.faint, fontFamily: mono }}>{refLabel(e)}</span>
                    <span className="bq-mono" style={{ width: 150, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.text, fontWeight: 600 }}>{money(e.amount)}</span>
                    <span className="bq-act" style={{ width: 50, display: "flex", justifyContent: "flex-end" }}><button onClick={ev => { ev.stopPropagation(); removeEntry(e.id); }} className="bq-x">×</button></span>
                  </div>
                ))}
                {trueOther.length > 0 && <div style={{ padding: "8px 14px 2px", fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.faint }}>Other bills</div>}
                {trueOther.map(e => (
                  <div key={e.id} className="bq-row" style={{ display: "flex", alignItems: "center", gap: 12, height: 30, padding: "0 14px", borderTop: `1px solid ${T.border}14` }}>
                    <span style={{ width: 7, flexShrink: 0 }} />
                    <span className="bq-mono" style={{ width: 92, fontFamily: mono, fontSize: 12, color: T.text }}>{e.po_ref || "—"}</span>
                    <span style={{ flex: 1, fontSize: 11.5, color: T.faint, fontFamily: mono }}>{refLabel(e)}</span>
                    <span className="bq-mono" style={{ width: 150, textAlign: "right", fontFamily: mono, fontSize: 12, color: T.text }}>{money(e.amount)}</span>
                    <span className="bq-act" style={{ width: 50, display: "flex", justifyContent: "flex-end" }}><button onClick={ev => { ev.stopPropagation(); removeEntry(e.id); }} className="bq-x">×</button></span>
                  </div>
                ))}
                {!billingOnly && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: `1px solid ${T.border}33` }}>
                  {v.complete ? <>
                    <span style={{ fontSize: 11.5, color: T.green, fontWeight: 700 }}>✓ Fully billed</span>
                    <select value={v.reason || "other"} onChange={e => markComplete(j.id, v.apVendorId, e.target.value)} style={{ padding: "4px 8px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 11.5, fontFamily: font, outline: "none" }}>
                      {REASONS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                    </select>
                    <button onClick={() => reopenVendor(j.id, v.apVendorId)} className="bq-ghost">Reopen</button>
                  </> : <>
                    {v.billed <= 0.01 ? (
                      // No bills logged — an early PO billed before OpsHub AP.
                      // Two-tap: records the bill AT the PO amount (pre_opshub,
                      // never pushed to QB) so margin stays honest, then closes.
                      <button onClick={() => {
                        const key = `${j.id}::${v.apVendorId}`;
                        if (preOpsArm !== key) { setPreOpsArm(key); return; }
                        markFullyBilledPreOps(j.id, v);
                      }}
                        style={{ background: preOpsArm === `${j.id}::${v.apVendorId}` ? T.amber : T.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                        {preOpsArm === `${j.id}::${v.apVendorId}` ? `Tap again — record ${money(v.expected)} bill (billed before OpsHub) + close` : "Mark fully billed"}
                      </button>
                    ) : (
                      <button onClick={() => markComplete(j.id, v.apVendorId, autoReason(v.billed, v.expected))} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Mark fully billed</button>
                    )}
                    <span style={{ fontSize: 11, color: T.faint }}>{v.billed <= 0.01 ? "no bills logged — records it as billed at the PO amount" : "confirm no more invoices coming"}{v.outstanding > 0 && v.billed > 0.01 ? ` · clears ${money(v.outstanding)} from Open PO` : ""}</span>
                  </>}
                </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function openNewBill() { setShowBill(true); setNbVendor(""); setNbVendorSearch(""); setNbVendorOpen(false); setNbBillNumber(computeNextBillNumber()); setNbLines(Array.from({ length: 5 }, () => ({ id: crypto.randomUUID(), poInput: "", invoiceNumber: "", amount: "", resolved: null as NbResolved | null }))); setNbSavedIds(null); setNbPushedId(null); setNbNotified(false); setNbBillGroupId(crypto.randomUUID()); setNbAttachments([]); }
  function closeBill() { setShowBill(false); setNbSavedIds(null); setNbPushedId(null); setNbNotified(false); setNbAttachments([]); }
  async function uploadAttachments(files: FileList | File[]) {
    if (!nbBillGroupId) return;
    setNbUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append("file", file); fd.append("billGroupId", nbBillGroupId);
      const res = await fetch("/api/bill-attachment", { method: "POST", body: fd });
      const d = await res.json();
      if (res.ok && d.attachment) setNbAttachments(prev => [...prev, d.attachment]);
      else alert(`Upload failed: ${d.error || res.status}`);
    }
    setNbUploading(false);
  }
  async function removeAttachment(id: string) {
    await fetch(`/api/bill-attachment?id=${id}`, { method: "DELETE" });
    setNbAttachments(prev => prev.filter(a => a.id !== id));
  }
  // Bill History attachments, loaded per bill_group_id when a bill is expanded.
  const [billAttach, setBillAttach] = useState<Record<string, any[]>>({});
  async function loadBillAttachments(groupId: string) {
    const res = await fetch(`/api/bill-attachment?billGroupId=${groupId}`);
    const d = await res.json();
    if (res.ok) setBillAttach(prev => ({ ...prev, [groupId]: d.attachments || [] }));
  }
  // Open the remittance recipient picker for the just-saved bill.
  function notifyVendor() {
    if (!nbSavedIds?.length) return;
    openNotify(nbSavedIds, nbVendor, vendors.find(v => v.id === nbVendor)?.name || "Vendor", "modal");
  }
  // Guard against losing entered lines to a stray backdrop/✕ click.
  async function tryCloseBill() {
    const dirty = !nbSavedIds && nbLines.some(l => l.poInput.trim() || l.amount.trim() || l.invoiceNumber.trim());
    if (dirty && !await confirm({ title: "Discard this bill?", message: "Your entered lines will be lost.", confirmLabel: "Discard" })) return;
    closeBill();
  }
  async function pushSavedBill() {
    if (!nbSavedIds?.length) return;
    setNbPushing(true);
    try {
      const res = await fetch("/api/qb/bill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryIds: nbSavedIds }) });
      const d = await res.json();
      if (!res.ok) { alert(`Push to QB failed: ${d.error || res.status}`); return; }
      setNbPushedId(d.billId);
      const noCust = d.lines - d.customersLinked;
      if (noCust > 0) alert(`Pushed — but ${noCust} line${noCust !== 1 ? "s" : ""} had no QB customer linked. Check the client is in QuickBooks.`);
      loadAll();
    } catch (e: any) { alert(`Push to QB failed: ${e?.message || "network error"}`); }
    finally { setNbPushing(false); }
  }
  function addRows(n = 1) {
    setNbLines(prev => [...prev, ...Array.from({ length: n }, () => ({ id: crypto.randomUUID(), poInput: "", invoiceNumber: "", amount: "", resolved: null as NbResolved | null }))]);
  }
  function updateLine(id: string, patch: Partial<{ poInput: string; invoiceNumber: string; amount: string }>) {
    setNbLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      if ("poInput" in patch) {
        const r = resolveNbPo(next.poInput);
        next.resolved = r ? { poRef: r.poRef, job_id: r.job_id, job_number: r.job_number, client_name: r.client_name, itemName: r.itemName, projected: r.projected, apVendorId: r.apVendorId } : null;
      }
      return next; // amount is manual (entered from the invoice); variance computes only once a value is in
    }));
  }
  function removeLine(id: string) { setNbLines(prev => prev.filter(l => l.id !== id)); }
  const nbValidLines = () => nbLines.filter(l => l.resolved && parseAmount(l.amount) > 0);
  async function saveBill() {
    const valid = nbValidLines();
    if (!valid.length || !nbVendor) return; // vendor must be chosen intentionally
    const dups = valid.filter(l => isExactDup(l.resolved!.poRef, parseAmount(l.amount)));
    if (dups.length && !await confirm({ title: "Possible double-bill", message: `${dups.length} line${dups.length !== 1 ? "s" : ""} (${dups.map(l => l.resolved!.poRef).join(", ")}) ${dups.length !== 1 ? "have" : "has"} the SAME amount already billed on that PO. Save anyway?`, confirmLabel: "Save anyway", confirmColor: T.amber })) return;
    const vId = nbVendor;
    setNbSaving(true);
    const vendorName = vendors.find(v => v.id === vId)?.name || null;
    const rows = valid.map(l => ({
      source: "decorator_invoice", vendor_id: vId, vendor_name: vendorName,
      vendor_invoice_number: l.invoiceNumber.trim() || null, po_ref: l.resolved!.poRef, job_id: l.resolved!.job_id,
      amount: parseAmount(l.amount), expected_amount: l.resolved!.projected, charge_type: "production", status: "matched", bill_method: vendorMethod(vId), bill_group_id: nbBillGroupId, hpd_bill_number: nbBillNumber,
    }));
    const { data, error } = await supabase.from("cost_entries").insert(rows as any).select("id");
    setNbSaving(false);
    if (!error) { setNbSavedIds(((data as any) || []).map((r: any) => r.id)); loadAll(); } // keep modal open → Push to QB step
  }

  const lbl = { fontSize: 9, fontWeight: 700 as const, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: T.faint };
  const inp = { padding: "7px 9px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 13, fontFamily: font, outline: "none" };

  if (loading) return <div style={{ padding: 24, color: T.muted, fontFamily: font }}>Loading…</div>;

  return (
    <div style={{ padding: "22px 26px", fontFamily: font, maxWidth: 1180, margin: "0 auto" }}>
      {confirmEl}
      <style>{`
        .bq-mono { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
        .bq-ghost { background: transparent; border: 1px solid ${T.border}; color: ${T.muted}; border-radius: 6px; padding: 4px 11px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: ${font}; transition: background .12s, color .12s, border-color .12s; white-space: nowrap; }
        .bq-ghost:hover { background: ${T.accent}; color: #0a0a0a; border-color: ${T.accent}; }
        .bq-ghost.on { background: ${T.green}; color: #fff; border-color: ${T.green}; }
        .bq-act { opacity: 0; transition: opacity .12s; }
        .bq-row:hover .bq-act { opacity: 1; }
        .bq-x { background: transparent; border: none; color: ${T.faint}; cursor: pointer; font-size: 14px; line-height: 1; padding: 3px 7px; border-radius: 5px; transition: background .12s, color .12s; }
        .bq-x:hover { background: ${T.redDim}; color: ${T.red}; }
      `}</style>

      {notifyFor && (
        <div onClick={() => !notifySending && setNotifyFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 130, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "16vh" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 12, width: 460, maxWidth: "92vw", padding: "18px 20px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", fontFamily: font }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>Send remittance — {notifyFor.vendorName}</div>
            <div style={{ fontSize: 12, color: T.muted, margin: "4px 0 14px" }}>A branded “payment processed” email + PDF, CC’d to you. Only send if the bill has been paid.</div>
            <div style={lbl}>Send to</div>
            <select value={notifyFor.chosen} onChange={e => setNotifyFor({ ...notifyFor, chosen: e.target.value })} style={{ ...inp, width: "100%", marginTop: 4 } as any}>
              {notifyFor.contacts.map((c: any) => <option key={c.email} value={c.email}>{c.name}{c.role ? ` · ${c.role}` : ""} — {c.email}</option>)}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
              <button onClick={sendNotify} disabled={notifySending} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: notifySending ? "default" : "pointer", fontFamily: font, opacity: notifySending ? 0.6 : 1 }}>{notifySending ? "Sending…" : "Send remittance"}</button>
              <button onClick={() => setNotifyFor(null)} disabled={notifySending} className="bq-ghost" style={{ marginLeft: "auto" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showBill && (
        <div onClick={tryCloseBill} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "8vh" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 12, width: 1040, maxWidth: "94vw", maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", fontFamily: font }}>
            <div style={{ padding: "15px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>New Bill</div>
              <button onClick={tryCloseBill} className="bq-x" style={{ fontSize: 18 }}>×</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", gap: 12, justifyContent: "space-between" }}>
              <div style={{ width: 300 }}>
                <div style={lbl}>Vendor</div>
                <div style={{ position: "relative", marginTop: 4 }}>
                  <input
                    value={nbVendor ? (vendors.find(v => v.id === nbVendor)?.name || "") : nbVendorSearch}
                    onChange={e => { setNbVendor(""); setNbVendorSearch(e.target.value); setNbVendorOpen(true); }}
                    onFocus={() => setNbVendorOpen(true)}
                    onBlur={() => setTimeout(() => setNbVendorOpen(false), 150)}
                    placeholder="Search vendor…"
                    style={{ ...inp, width: "100%" } as any} />
                  {nbVendorOpen && (() => {
                    const q = nbVendorSearch.trim().toLowerCase();
                    const filtered = vendors.filter(v => !q || v.name.toLowerCase().includes(q));
                    return (
                      <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
                        {filtered.length === 0 ? <div style={{ padding: "8px 11px", fontSize: 12, color: T.faint }}>No vendor matches</div>
                          : filtered.map(v => (
                            <div key={v.id} onMouseDown={e => e.preventDefault()} onClick={() => { setNbVendor(v.id); setNbVendorSearch(""); setNbVendorOpen(false); }}
                              className="bq-row" style={{ padding: "7px 11px", fontSize: 13, cursor: "pointer", color: T.text }}>{v.name}</div>
                          ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div style={{ width: 190 }}>
                <div style={lbl}>HPD Bill Number</div>
                <input value={nbBillNumber} readOnly style={{ ...inp, width: "100%", marginTop: 4, fontFamily: mono, background: T.surface, color: T.muted } as any} />
              </div>
            </div>
            <div style={{ padding: "4px 20px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={lbl}>Lines — add rows, then fill PO / invoice # / amount down each column</div>
                {!nbSavedIds && <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => addRows(1)} className="bq-ghost">+ Add line</button>
                  <button onClick={() => addRows(5)} className="bq-ghost">+5</button>
                  <button onClick={() => addRows(10)} className="bq-ghost">+10</button>
                </div>}
              </div>
              <div style={{ display: "flex", gap: 8, padding: "0 24px 4px 0" }}>
                <span style={{ ...lbl, flex: 1.5, minWidth: 0 }}>PO #</span>
                <span style={{ ...lbl, width: 110, flexShrink: 0 }}>Vendor inv #</span>
                <span style={{ ...lbl, width: 96, flexShrink: 0 }}>Amount</span>
                <span style={{ ...lbl, flex: 2, minWidth: 0 }}>Job · client</span>
                <span style={{ ...lbl, width: 104, flexShrink: 0, textAlign: "right" }}>Variance</span>
              </div>
              <div style={{ maxHeight: "48vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                {nbLines.length === 0 && <div style={{ padding: "10px 0", fontSize: 12, color: T.faint }}>No lines — click “+ Add line” (or +5/+10), then fill each column down.</div>}
                {nbLines.map(l => {
                  const amt = parseAmount(l.amount);
                  const poKey = l.resolved ? l.resolved.poRef.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
                  // Saved → read-only confirmation. This line is now in billedPoTotals, so variance
                  // = total billed on the PO − projected (do NOT re-add this line, and no dup alerts:
                  // it would flag itself). Empty rows are dropped from the saved summary.
                  if (nbSavedIds) {
                    if (!(l.resolved && amt > 0)) return null;
                    const dv = Math.round((priorBilledFor(l.resolved) - l.resolved.projected) * 100) / 100;
                    const ro = { fontSize: 12, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", padding: "6px 2px" };
                    return (
                      <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span className="bq-mono" style={{ ...ro, flex: 1.5, minWidth: 0, fontFamily: mono, color: T.text }}>{l.poInput}</span>
                        <span className="bq-mono" style={{ ...ro, width: 110, flexShrink: 0, fontFamily: mono, color: T.muted }}>{l.invoiceNumber || "—"}</span>
                        <span className="bq-mono" style={{ ...ro, width: 96, flexShrink: 0, fontFamily: mono, color: T.text }}>{money(amt)}</span>
                        <span style={{ ...ro, flex: 2, minWidth: 0, fontSize: 11.5, color: T.muted }}><strong className="bq-mono" style={{ fontFamily: mono, color: T.text }}>{l.resolved.job_number}</strong> · {l.resolved.client_name || "—"}</span>
                        <span className="bq-mono" style={{ width: 104, flexShrink: 0, textAlign: "right", fontSize: 11.5, fontFamily: mono, fontWeight: 700, color: dv === 0 ? T.green : dv > 0 ? T.red : T.amber }}>{dv === 0 ? "✓ match" : `${dv < 0 ? "−" : "+"}${money(Math.abs(dv))}`}</span>
                        <span style={{ width: 18, flexShrink: 0 }} />
                      </div>
                    );
                  }
                  const prior = priorBilledFor(l.resolved); // already billed on this PO (deposit-aware)
                  // Variance is CUMULATIVE: everything billed on this PO (prior + this line) vs projected.
                  const d = l.resolved && amt > 0 ? Math.round((prior + amt - l.resolved.projected) * 100) / 100 : 0;
                  const mism = nbVendor && l.resolved && l.resolved.apVendorId !== nbVendor;
                  const exactDup = isExactDup(poKey, amt); // same amount already billed → likely a real double-bill
                  return (
                    <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input value={l.poInput} disabled={!!nbSavedIds} onChange={e => updateLine(l.id, { poInput: e.target.value })} style={{ ...inp, flex: 1.5, minWidth: 0, fontFamily: mono, padding: "6px 8px", borderColor: exactDup ? T.red : (prior > 0 ? T.amber : (T.border as any)) } as any} />
                      <input value={l.invoiceNumber} disabled={!!nbSavedIds} onChange={e => updateLine(l.id, { invoiceNumber: e.target.value })} style={{ ...inp, width: 110, flexShrink: 0, fontFamily: mono, padding: "6px 8px" } as any} />
                      <input value={l.amount} disabled={!!nbSavedIds} onChange={e => updateLine(l.id, { amount: e.target.value })} inputMode="decimal" style={{ ...inp, width: 96, flexShrink: 0, fontFamily: mono, padding: "6px 8px", color: amt <= 0 ? T.text : d > 0 ? T.red : d < 0 ? T.amber : T.text } as any} />
                      <span style={{ flex: 2, minWidth: 0, fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: mism ? T.red : T.muted }}>
                        {l.poInput.trim() === "" ? <span style={{ color: T.faint }}>—</span>
                          : l.resolved ? <>{exactDup ? <span style={{ color: T.red, fontWeight: 700 }}>⚠ same amount already billed · </span>
                              : prior > 0 ? <span style={{ color: T.amber, fontWeight: 700 }}>{money(prior)} already billed · </span>
                              : mism ? "⚠ " : ""}<strong className="bq-mono" style={{ fontFamily: mono, color: T.text }}>{l.resolved.job_number}</strong> · {l.resolved.client_name || "—"}</>
                          : <span style={{ color: T.amber }}>⚠ no match</span>}
                      </span>
                      <span className="bq-mono" style={{ width: 104, flexShrink: 0, textAlign: "right", fontSize: 11.5, fontFamily: mono, fontWeight: 700, color: amt <= 0 ? T.faint : d === 0 ? T.green : d > 0 ? T.red : T.amber }}>{l.resolved && amt > 0 ? (d === 0 ? "✓ match" : `${d < 0 ? "−" : "+"}${money(Math.abs(d))}`) : ""}</span>
                      {!nbSavedIds && <button onClick={() => removeLine(l.id)} className="bq-x" style={{ width: 18, flexShrink: 0 }}>×</button>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: "10px 20px 4px", borderTop: `1px solid ${T.border}` }}>
              <div style={lbl}>Vendor invoice files <span style={{ color: T.faint, fontWeight: 400 }}>(stored in OpsHub)</span></div>
              <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) uploadAttachments(e.dataTransfer.files); }}
                onClick={() => document.getElementById("nb-file-input")?.click()}
                style={{ marginTop: 6, border: `1px dashed ${T.border}`, borderRadius: 8, padding: "12px", textAlign: "center", fontSize: 12, color: T.faint, cursor: "pointer", background: T.surface }}>
                {nbUploading ? "Uploading…" : "Drag invoice PDFs here, or click to choose"}
                <input id="nb-file-input" type="file" multiple accept="application/pdf,image/*" style={{ display: "none" }} onChange={e => { if (e.target.files?.length) uploadAttachments(e.target.files); (e.target as HTMLInputElement).value = ""; }} />
              </div>
              {nbAttachments.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {nbAttachments.map(a => (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: "none" }}>📎 {a.file_name}</a>
                      <button onClick={() => removeAttachment(a.id)} className="bq-x">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 14 }}>
              {!nbSavedIds ? <>
                {(() => { const n = nbValidLines().length; const ok = n > 0 && !!nbVendor; return (
                <button onClick={saveBill} disabled={nbSaving || !ok} title={!nbVendor ? "Choose a vendor first" : ""} style={{ background: ok ? T.green : T.surface, color: ok ? "#fff" : T.faint, border: "none", borderRadius: 6, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: ok ? "pointer" : "default", fontFamily: font }}>{nbSaving ? "Saving…" : `Save bill · ${n} line${n !== 1 ? "s" : ""}`}</button>
                ); })()}
                <span style={{ fontSize: 13, color: T.muted }}>Total <strong className="bq-mono" style={{ fontFamily: mono, color: T.text }}>{money(nbLines.reduce((s, l) => s + parseAmount(l.amount), 0))}</strong></span>
                <button onClick={tryCloseBill} className="bq-ghost" style={{ marginLeft: "auto" }}>Cancel</button>
              </> : <>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.green }}>✓ Saved · {nbSavedIds.length} line{nbSavedIds.length !== 1 ? "s" : ""}</span>
                {nbPushedId
                  ? <span title={`QuickBooks internal Bill ID ${nbPushedId}`} style={{ fontSize: 11, fontWeight: 700, color: T.green, background: T.green + "1f", padding: "4px 11px", borderRadius: 20 }}>✓ in QuickBooks · {nbBillNumber}</span>
                  : <button onClick={pushSavedBill} disabled={nbPushing} style={{ background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 6, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: nbPushing ? "default" : "pointer", fontFamily: font, opacity: nbPushing ? 0.6 : 1 }}>{nbPushing ? "Pushing…" : "Push to QB"}</button>}
                {nbPushedId && (nbNotified
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: T.green, background: T.green + "1f", padding: "4px 11px", borderRadius: 20 }}>✓ Vendor notified</span>
                  : <button onClick={notifyVendor} style={{ background: T.surface, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Notify vendor</button>)}
                <button onClick={closeBill} className="bq-ghost" style={{ marginLeft: "auto" }}>Done</button>
              </>}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>{billingOnly ? "Bills" : "Bills · Cost Reconciliation"}</h1>
          <div style={{ display: "flex", gap: 3, background: T.surface, borderRadius: 8, padding: 3 }}>
            {(([["queue", "Billing Queue"], ["history", "Bill History"], ["shipping", "Freight"], ["hours", "Contractor Hours"], ["variances", "Variances"]] as const).filter(([k]) => !billingOnly || k !== "variances")).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} style={{ background: view === k ? T.card : "transparent", color: view === k ? T.text : T.muted, border: "none", borderRadius: 6, padding: "5px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: font, boxShadow: view === k ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>{label}</button>
            ))}
          </div>
        </div>
        <button onClick={openNewBill} style={{ background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font }}>+ New bill</button>
      </div>

      {view === "queue" && (<>
      {/* Open PO hero + stats — owner aggregate KPIs, hidden in billing-only */}
      {!billingOnly && (
      <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ background: T.accent, color: "#0a0a0a", borderRadius: 12, padding: "16px 22px", minWidth: 240 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>Open PO Commitment</div>
          <div style={{ fontSize: 30, fontWeight: 800, fontFamily: mono, margin: "5px 0 3px" }}>{money0(queue.openPO)}</div>
          <div style={{ fontSize: 10.5, opacity: 0.75 }}>committed, not yet billed/paid · {queue.stats.openJobs} open job{queue.stats.openJobs !== 1 ? "s" : ""}</div>
        </div>
        {([
          ["Expected", money0(queue.stats.expected), T.text],
          ["Billed", money0(queue.stats.billed), T.green],
          ["Cost-complete", `${queue.stats.costComplete} / ${queue.stats.jobs}`, T.text],
          ["Awaiting invoices", String(queue.stats.awaitingVendors), T.faint],
        ] as const).map(([k, v, c]) => (
          <div key={k} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 18px", minWidth: 130 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.faint }}>{k}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: mono, color: c, marginTop: 5 }}>{v}</div>
          </div>
        ))}
      </div>
      )}

      {/* Open PO by vendor — owner aggregate, hidden in billing-only */}
      {!billingOnly && openByVendor.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <button onClick={() => setShowByVendor(s => !s)} style={{ background: "none", border: "none", color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: font, padding: 0 }}>{showByVendor ? "▾" : "▸"} Open PO by vendor ({openByVendor.length})</button>
          {showByVendor && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", marginTop: 8, display: "flex", flexDirection: "column", gap: 7 }}>
              {openByVendor.map(v => {
                const pct = Math.round((100 * v.outstanding) / (openByVendor[0].outstanding || 1));
                return (
                  <div key={v.name} onClick={() => setVendorFilter(f => f === v.name ? "" : v.name)} title={vendorFilter === v.name ? "Clear vendor filter" : `Filter queue to ${v.name}`}
                    style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, cursor: "pointer", borderRadius: 6, padding: "2px 6px", margin: "-2px -6px", background: vendorFilter === v.name ? T.amber + "1f" : "transparent" }}>
                    <span style={{ width: 170, color: T.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</span>
                    <div style={{ flex: 1, height: 8, background: T.surface, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: T.amber }} />
                    </div>
                    <span style={{ width: 50, textAlign: "right", color: T.faint, fontSize: 11 }}>{v.jobs} job{v.jobs !== 1 ? "s" : ""}</span>
                    <span style={{ width: 90, textAlign: "right", fontFamily: mono, fontWeight: 700, color: T.text }}>{money0(v.outstanding)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add form (collapsible) */}
      {showForm && <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr 1fr", gap: 10, alignItems: "end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Vendor</span>
            <select value={vendorId} onChange={e => setVendorId(e.target.value)} style={inp as any}>
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.kind !== "decorator" ? ` (${v.kind})` : ""}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Vendor Invoice #</span>
            <input value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} placeholder="74579" style={inp as any} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>PO Ref</span>
            <input value={poRef} onChange={e => setPoRef(e.target.value)} placeholder="4308-A" style={{ ...inp, fontFamily: mono } as any} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Amount</span>
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={{ ...inp, fontFamily: mono } as any} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={lbl}>Type</span>
            <select value={chargeType} onChange={e => setChargeType(e.target.value)} style={inp as any}>
              {CHARGE_TYPES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>
        </div>
        {/* live resolution */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, minHeight: 24 }}>
          <div style={{ fontSize: 12 }}>
            {poRef.trim() === "" ? <span style={{ color: T.faint }}>Enter a PO ref to resolve the job.</span>
              : resolved ? <span style={{ color: T.text }}>→ <strong>{resolved.job_number}</strong> · {resolved.client_name || "—"}
                  {formExpected != null && (() => {
                    const running = priorForForm + parseAmount(amount);
                    const delta = running - formExpected;
                    const ok = inTol(running, formExpected);
                    const col = ok ? T.green : delta > 0 ? T.red : T.amber;
                    return <span style={{ color: T.muted }}>  ·  {vendors.find(v => v.id === vendorId)?.name} expected {money(formExpected)}
                      {parseAmount(amount) > 0 && <> · <span style={{ color: col, fontWeight: 700 }}>{money(running)} of {money(formExpected)}{ok ? " ✓" : delta > 0 ? ` (+${money(delta)} over)` : ` (${money(-delta)} to go)`}</span>{priorForForm > 0 && <span style={{ color: T.faint }}> · {money(priorForForm)} already entered</span>}</>}
                    </span>;
                  })()}
                  {formExpected == null && <span style={{ color: T.faint }}>  ·  no costing baseline</span>}
                </span>
              : <span style={{ color: T.amber }}>⚠ No job matched — will go to the unmatched queue.</span>}
          </div>
          <button onClick={addEntry} disabled={saving || !vendorId || !parseAmount(amount)}
            style={{ background: (!vendorId || !parseAmount(amount)) ? T.surface : T.accent, color: (!vendorId || !parseAmount(amount)) ? T.faint : "#0a0a0a", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: (!vendorId || !parseAmount(amount)) ? "default" : "pointer", fontFamily: font }}>
            {saving ? "Saving…" : "Add entry"}
          </button>
        </div>
      </div>}

      {/* Unmatched queue */}
      {unmatched.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ ...lbl, color: T.amber, marginBottom: 8 }}>Unmatched · {unmatched.length}</div>
          <div style={{ border: `1px solid ${T.amber}55`, borderRadius: 10, overflow: "hidden" }}>
            {unmatched.map(e => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: T.amberDim, borderBottom: `1px solid ${T.border}44`, fontSize: 12, position: "relative" }}>
                <span style={{ width: 130, color: T.text, fontWeight: 600 }}>{e.vendor_name || "—"}</span>
                <span style={{ width: 90, fontFamily: mono, color: T.muted }}>{e.vendor_invoice_number || "—"}</span>
                <span style={{ width: 90, fontFamily: mono, color: T.text }}>{e.po_ref || "—"}</span>
                <span style={{ flex: 1, fontFamily: mono, textAlign: "right", color: T.text }}>{money(e.amount)}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8, position: "relative" }}>
                  <button onClick={() => { setAssignFor(assignFor === e.id ? null : e.id); setAssignQuery(""); }} style={miniBtn(T.accent)}>Assign job</button>
                  <button onClick={() => markNotJobSpecific(e.id)} style={miniBtn(T.faint)}>Not job-specific</button>
                  <button onClick={() => removeEntry(e.id)} style={miniBtn(T.faint)}>✕</button>
                  {assignFor === e.id && (
                    <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, marginTop: 4, width: 280, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
                      <input autoFocus value={assignQuery} onChange={ev => setAssignQuery(ev.target.value)} placeholder="Search job # / client…" style={{ ...inp, width: "100%", border: "none", borderBottom: `1px solid ${T.border}`, borderRadius: 0 } as any} />
                      <div style={{ maxHeight: 220, overflowY: "auto" }}>
                        {jobs.filter(j => { const q = assignQuery.trim().toLowerCase(); return q && ((j.job_number || "").toLowerCase().includes(q) || (j.client_name || "").toLowerCase().includes(q) || String(j.qb_invoice_number || "").includes(q)); }).slice(0, 10).map(j => (
                          <div key={j.id} onClick={() => assignJob(e.id, j)} style={{ padding: "7px 10px", cursor: "pointer", fontSize: 12, borderBottom: `1px solid ${T.border}44` }}
                            onMouseEnter={ev => ev.currentTarget.style.background = T.surface} onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                            <strong>{j.job_number}</strong> <span style={{ color: T.muted }}>· {j.client_name}</span> {j.qb_invoice_number && <span style={{ color: T.faint, fontFamily: mono }}>· {j.qb_invoice_number}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing queue — job × PO-sent vendor */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO # / QB invoice · client · vendor…"
            style={{ width: "100%", padding: "7px 30px 7px 11px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: T.faint, fontSize: 14, cursor: "pointer", padding: 0 }}>×</button>}
        </div>
        <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}
          style={{ padding: "7px 10px", border: `1px solid ${vendorFilter ? T.amber : T.border}`, borderRadius: 6, background: T.card, color: vendorFilter ? T.text : T.muted, fontSize: 12.5, fontFamily: font, outline: "none", maxWidth: 190, cursor: "pointer" }}>
          <option value="">All vendors</option>
          {vendorOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{ display: "flex", gap: 6 }}>
          {([["open", "Open", queue.stats.openJobs], ["complete", "Cost-complete", queue.stats.costComplete], ["all", "All", queue.stats.jobs]] as const).map(([k, label, n]) => (
            <button key={k} onClick={() => setQFilter(k)} style={{ background: qFilter === k ? T.accent : T.card, color: qFilter === k ? "#0a0a0a" : T.muted, border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>{label} · {n}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filteredQueue.length === 0 ? <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 14px", color: T.faint, fontSize: 12 }}>No jobs in this view.</div> : filteredQueue.map(j => {
          // Vendor-filtered rows show THAT vendor’s slice, not whole-job totals.
          const vs = vendorFilter ? j.vendors.find((v: any) => v.name === vendorFilter) : null;
          const rBilled = vs ? vs.billed : j.billed;
          const rExpected = vs ? vs.expected : j.expected;
          const rOutstanding = vs ? vs.outstanding : j.outstanding;
          const rComplete = vs ? vs.outstanding <= 0 : j.costComplete;
          const rPct = rExpected > 0 ? Math.min(100, Math.round(100 * rBilled / rExpected)) : 0;
          return (
            <div key={j.id} style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => setQueueJobId(j.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", cursor: "pointer", background: T.card }}>
                <span style={{ color: T.faint, fontSize: 12, width: 10 }}>›</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{j.qb_invoice_number ? <span style={{ fontFamily: mono }}>{j.qb_invoice_number}</span> : j.job_number} <span style={{ color: T.muted, fontWeight: 400 }}>· {j.client_name || "—"}</span></div>
                  <div style={{ fontSize: 11, color: T.faint, textTransform: "capitalize" }}>{vs ? <span style={{ textTransform: "none", color: T.amber, fontWeight: 700 }}>{vs.name}</span> : `${j.vendors.length} vendor${j.vendors.length !== 1 ? "s" : ""}`} · {(j.phase || "—").replace(/_/g, " ")}{j.qb_invoice_number ? <span style={{ textTransform: "none" }}> · {j.job_number}</span> : ""}</div>
                </div>
                <div style={{ width: 80, height: 6, background: T.surface, borderRadius: 3, overflow: "hidden" }} title={`${rPct}% billed`}>
                  <div style={{ width: `${rPct}%`, height: "100%", background: rComplete ? T.green : T.amber }} />
                </div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: 12.5, color: T.text, width: 150 }}>
                  {money0(rBilled)} <span style={{ color: T.faint }}>of {money0(rExpected)}</span>
                </div>
                <div style={{ width: 120, display: "flex", justifyContent: "flex-end" }}>
                  {rComplete
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: T.green, background: T.green + "1f", padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>{vs ? "Billed" : "Cost-complete"}</span>
                    : <span style={{ fontSize: 11, fontWeight: 700, color: T.amber, background: T.amber + "1f", padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>{money0(rOutstanding)} open</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {notJobSpecific.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ ...lbl, marginBottom: 8 }}>Not job-specific · {notJobSpecific.length}</div>
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            {notJobSpecific.map(e => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", fontSize: 12, borderBottom: `1px solid ${T.border}33` }}>
                <span style={{ width: 130, color: T.text, fontWeight: 600 }}>{e.vendor_name || "—"}</span>
                <span style={{ width: 90, fontFamily: mono, color: T.muted }}>{e.vendor_invoice_number || "—"}</span>
                <span style={{ flex: 1, color: T.faint, textTransform: "capitalize" }}>{e.charge_type.replace(/_/g, " ")}</span>
                <span style={{ width: 90, textAlign: "right", fontFamily: mono, color: T.text }}>{money(e.amount)}</span>
                <button onClick={() => removeEntry(e.id)} style={{ ...miniBtn(T.faint), width: 28 }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
      </>)}

      {/* Full per-job breakdown modal — all vendors expanded */}
      {queueJobId && (() => {
        const mj = queue.jobs.find(x => x.id === queueJobId);
        if (!mj) return null;
        return (
          <div onClick={() => setQueueJobId(null)} style={{ position: "fixed", inset: 0, background: "rgba(16,18,32,0.55)", backdropFilter: "blur(3px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, width: "min(860px, 94vw)", height: "min(840px, 90vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 70px rgba(16,18,32,0.4)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{mj.qb_invoice_number ? <span style={{ fontFamily: mono }}>{mj.qb_invoice_number}</span> : mj.job_number} <span style={{ color: T.muted, fontWeight: 400 }}>· {mj.client_name || "—"}</span></div>
                  <div style={{ fontSize: 11.5, color: T.faint, textTransform: "capitalize" }}>{mj.vendors.length} vendor{mj.vendors.length !== 1 ? "s" : ""} · {(mj.phase || "—").replace(/_/g, " ")}{mj.qb_invoice_number ? <span style={{ textTransform: "none" }}> · {mj.job_number}</span> : ""}</div>
                </div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: 13, color: T.text }}>{money0(mj.billed)} <span style={{ color: T.faint }}>of {money0(mj.expected)}</span></div>
                {mj.costComplete
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: T.green, background: T.green + "1f", padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>Cost-complete</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, color: T.amber, background: T.amber + "1f", padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap" }}>{money0(mj.outstanding)} open</span>}
                <button onClick={() => setQueueJobId(null)} style={{ background: "transparent", border: "none", color: T.faint, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
              </div>
              <div style={{ padding: "16px 18px", flex: 1, overflowY: "auto" }}>{renderJobDetail(mj)}</div>
            </div>
          </div>
        );
      })()}

      {view === "history" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative", maxWidth: 360, flex: "1 1 240px" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor · invoice # · PO · client…"
                style={{ width: "100%", padding: "7px 30px 7px 11px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.card, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
              {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: T.faint, fontSize: 14, cursor: "pointer", padding: 0 }}>×</button>}
            </div>
            {/* vendor select — white-box bold per DESIGN.md filter convention */}
            <select value={billVendorFilter} onChange={e => setBillVendorFilter(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontWeight: 700, fontFamily: font, outline: "none", cursor: "pointer" }}>
              <option value="">All vendors</option>
              {(Array.from(new Set(bills.map(b => b.vendor_name).filter(Boolean))) as string[]).sort().map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div style={{ ...lbl, marginBottom: 8 }}>{filteredBills.length} bill{filteredBills.length !== 1 ? "s" : ""}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {filteredBills.length === 0 ? <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 14px", color: T.faint, fontSize: 12 }}>No bills.</div> : filteredBills.map(b => {
              const bKey = "bill:" + b.key;
              const isOpen = expanded.has(bKey);
              const ref = b.hpdNumber || (b.invoice ? (b.method === "credit_card" ? `CC · ${b.invoice}` : b.invoice) : (b.method === "credit_card" ? "CC charge" : "—"));
              return (
                <div key={b.key} style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div className="bq-row" onClick={() => { toggle(bKey); if (b.groupId && !billAttach[b.groupId]) loadBillAttachments(b.groupId); }} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px", cursor: "pointer", background: T.card }}>
                    <span style={{ color: T.faint, fontSize: 10, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                    <span style={{ width: 170, fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.vendor_name || "—"}</span>
                    <span className="bq-mono" style={{ flex: 1, fontFamily: mono, fontSize: 12, color: T.muted }}>{ref}</span>
                    {b.groupId && (billAttach[b.groupId]?.length ?? 0) > 0 && <span title={`${billAttach[b.groupId!].length} invoice file(s)`} style={{ fontSize: 11, color: T.muted }}>📎 {billAttach[b.groupId].length}</span>}
                    <span style={{ fontSize: 11, color: T.faint }}>{b.lines.length} line{b.lines.length !== 1 ? "s" : ""}</span>
                    <span style={{ fontSize: 11, color: T.faint, width: 80, textAlign: "right" }}>{(b.date || "").slice(0, 10)}</span>
                    {(() => {
                      const pushed = b.lines.find(e => e.qb_bill_id)?.qb_bill_id;
                      const ids = b.lines.map(e => e.id);
                      const busy = pushingBill === bKey;
                      return <>
                        {pushed
                          ? (() => {
                              // BillPayment webhook stamps qb_paid_at (mig 126) — the chip
                              // graduates from "in QB" (pushed, awaiting payment) to PAID.
                              const paidAt = b.lines.find(e => e.qb_paid_at)?.qb_paid_at;
                              // 'paid-verified' = Jon-attested legacy history (no QB bill
                              // link, date unknown) → plain PAID, no date shown.
                              const verifiedOnly = pushed === "paid-verified";
                              return paidAt
                                ? <span title={verifiedOnly ? "Marked paid — legacy batch history, verified by Jon" : `Paid in QuickBooks ${paidAt.slice(0, 10)} · Bill #${pushed}`} style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: T.green, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>✓ PAID{verifiedOnly ? "" : " " + paidAt.slice(5, 10)}</span>
                                : <span title={`QuickBooks Bill #${pushed} — awaiting payment`} style={{ fontSize: 10.5, fontWeight: 700, color: T.green, background: T.green + "1f", padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>✓ in QB</span>;
                            })()
                          : <button onClick={ev => { ev.stopPropagation(); if (!busy) pushBillToQb(bKey, ids); }} disabled={busy} className="bq-ghost" style={{ whiteSpace: "nowrap" }}>{busy ? "Pushing…" : "Push to QB"}</button>}
                        <button onClick={ev => { ev.stopPropagation(); openNotify(ids, b.vendor_id, b.vendor_name || "Vendor", "history"); }} className="bq-ghost" style={{ whiteSpace: "nowrap" }}>Notify</button>
                      </>;
                    })()}
                    <span className="bq-mono" style={{ width: 110, textAlign: "right", fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.text }}>{money(b.total)}</span>
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${T.border}55`, background: T.surface }}>
                      {b.groupId && (billAttach[b.groupId]?.length ?? 0) > 0 && (
                        <div style={{ padding: "8px 16px 8px 40px", borderBottom: `1px solid ${T.border}22`, display: "flex", flexWrap: "wrap", gap: 12 }}>
                          {billAttach[b.groupId].map((a: any) => (
                            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" }}>📎 {a.file_name}</a>
                          ))}
                        </div>
                      )}
                      {b.lines.map(e => {
                        const jb = e.job_id ? jobById[e.job_id] : null;
                        return (
                          <div key={e.id} className="bq-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 16px 7px 40px", fontSize: 11.5, borderTop: `1px solid ${T.border}22` }}>
                            <span className="bq-mono" style={{ width: 96, fontFamily: mono, color: T.text, fontWeight: 600 }}>{e.po_ref || "—"}</span>
                            <span className="bq-mono" style={{ width: 120, fontFamily: mono, color: T.muted }}>{jb?.qb_invoice_number || jb?.job_number || (e.not_job_specific ? "not job-specific" : "—")}</span>
                            <span style={{ flex: 1, color: T.faint }}>{jb?.client_name || ""}</span>
                            <span className="bq-mono" style={{ width: 110, textAlign: "right", fontFamily: mono, color: T.text }}>{money(e.amount)}</span>
                            <span className="bq-act"><button onClick={ev => { ev.stopPropagation(); removeEntry(e.id); }} className="bq-x">×</button></span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {view === "shipping" && <ShippingView companyId={companyId} billingOnly={billingOnly} />}
      {view === "hours" && <ContractorHoursView />}
      {!billingOnly && view === "variances" && (
        <VarianceView queue={queue} jobsRaw={jobsRaw} items={jobItems} printers={printers} freightEntries={freightEntries} />
      )}
    </div>
  );
}

function miniBtn(color: string) {
  return { background: "none", border: `1px solid ${T.border}`, color, borderRadius: 5, padding: "4px 9px", fontSize: 11, fontWeight: 600 as const, cursor: "pointer", fontFamily: font };
}

// One-click card-charge confirm (card-at-order vendors, Aug 23 2026).
// Inserts the cost entry that resolves the row — bill_method credit_card so
// the QB push guard refuses it (the expense reaches QB via the card feed).
// Amount prefilled with the outstanding commitment, editable when the real
// charge differed; the difference rides the normal variance machinery.
function ConfirmCardCharge({ vendor, jobId, onDone }: { vendor: any; jobId: string; onDone: () => void }) {
  const supabase = createClient();
  const [openC, setOpenC] = useState(false);
  const [amt, setAmt] = useState<string>(String(vendor.outstanding ?? ""));
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function confirm() {
    const amount = Math.round((parseFloat(amt) || 0) * 100) / 100;
    if (amount <= 0) return;
    setBusy(true); setErr("");
    const poRef = (vendor.items || []).map((it: any) => it.poRef).join(", ").slice(0, 120) || null;
    const { error } = await supabase.from("cost_entries").insert({
      source: "decorator_invoice",
      vendor_id: vendor.apVendorId, vendor_name: vendor.name,
      vendor_invoice_number: ref.trim() || null,
      po_ref: poRef, job_id: jobId,
      amount, expected_amount: vendor.expected ?? null,
      // charge_type check constraint (mig 098): production/setup_mold/
      // sample/freight/other — "decoration" bounced, silently. Never again:
      // errors surface inline.
      charge_type: "production", status: "matched",
      bill_method: "credit_card",
      notes: "Card charge confirmed at reconciliation",
    } as any);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOpenC(false); onDone();
  }
  if (!openC) {
    return (
      <button onClick={() => { setAmt(String(vendor.outstanding ?? "")); setOpenC(true); }}
        style={{ background: T.amber, color: "#0a0a0a", border: "none", borderRadius: 6, padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}>
        Confirm card charge
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>$
        <input value={amt} onChange={e => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus
          onKeyDown={e => { if (e.key === "Enter") confirm(); if (e.key === "Escape") setOpenC(false); }}
          style={{ width: 78, padding: "5px 7px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontFamily: mono, fontSize: 12, outline: "none" }} />
      </span>
      <input value={ref} onChange={e => setRef(e.target.value)} placeholder="ref (optional)"
        style={{ width: 92, padding: "5px 7px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 11, outline: "none", fontFamily: font }} />
      <button disabled={busy} onClick={confirm}
        style={{ background: T.green, color: "#0a0a0a", border: "none", borderRadius: 6, padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font, opacity: busy ? 0.6 : 1 }}>✓</button>
      <button onClick={() => setOpenC(false)} style={{ background: "none", border: "none", color: T.faint, fontSize: 12, cursor: "pointer", fontFamily: font }}>✕</button>
      {err && <span style={{ fontSize: 10.5, color: T.red, fontWeight: 700 }}>{err}</span>}
    </span>
  );
}
