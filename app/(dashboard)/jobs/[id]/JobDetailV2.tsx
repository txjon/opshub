"use client";
// ── JOB DETAIL V2 (parallel scaffold, Jul 25 2026) ────────────────────────────
// A tabless, stage-ordered job canvas — the Track-2 rebuild. Reached via ?v2=1 on
// the job detail so it's fully isolated from the live page (page.tsx branches to
// it after the data is loaded; same job/items/payments/contacts, new shell).
//
// Model: header (state + money + route/address/created) → spine → 4 workflow
// blocks (Products gallery · Client · Production · Logistics). Tapping a gallery
// card opens the ITEM WORKSHEET — a proof-editor-style overlay you flip between
// items with ‹ › (mount-one-show-one, never unmounts), with the task you came to
// do (Build · Cost · Art · Blank) as sub-tabs. Editing panels are read views in
// this scaffold; the real editors (ProductBuilder / CostingTab / ArtTab) wire in
// next. See memory: project_cost_qty_single_source_plan.
import React, { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { isCostingLocked } from "@/lib/costing-lock";
import { logJobActivity } from "@/components/JobActivityPanel";
import { calcCostProduct, buildPrintersMap, lookupPrintPrice as sharedLookupPrintPrice, lookupTagPrice as sharedLookupTagPrice } from "@/lib/pricing";
import { DecorationPanel as DecorationPanelRaw } from "./DecorationPanel";
import { sendQuoteAndProofs, defaultRecipient } from "@/lib/job/quote-actions";
import { pushInvoiceToQB, recordPayment } from "@/lib/job/invoice-actions";
const DecorationPanel: any = DecorationPanelRaw; // .jsx — bypass narrow inferred prop types

const fmtMoney = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const fmtDT = (iso: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
// thumbByItem holds a Drive file_id (not a URL) — build the thumbnail endpoint URL.
const thumbSrc = (id: string, full = false) => id ? `/api/files/thumbnail?id=${id}${full ? "" : "&thumb=1"}` : "";
const sumQ = (o: any) => Object.values(o || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
const qtyOf = (it: any) => Number(it?.totalQty) || sumQ(it?.qtys);

const PHASE_HERO: Record<string, { eyebrow: string; title: string; sub: string }> = {
  intake:      { eyebrow: "In intake",       title: "Setting up",         sub: "Building the order — products, sizes, and pricing." },
  pending:     { eyebrow: "With the client", title: "Waiting on client",  sub: "Quote and proofs are out. Production starts once approved and paid." },
  ready:       { eyebrow: "Cleared to make", title: "Ready to make",      sub: "Approved and paid. Order blanks and send the POs." },
  production:  { eyebrow: "At the presses",  title: "In production",      sub: "At the vendor. The House watches the clocks; the dock takes it at landing." },
  receiving:   { eyebrow: "Inbound",         title: "Coming to the dock", sub: "Shipped from the vendor — receiving confirms quantities." },
  fulfillment: { eyebrow: "On the floor",    title: "Fulfillment",        sub: "Received at HPD — staging, packing, shipping." },
  complete:    { eyebrow: "Closed",          title: "Complete",           sub: "Delivered." },
  on_hold:     { eyebrow: "Locked",          title: "On hold",            sub: "Manually held. Resume to recalculate the phase." },
};
const ROUTE_LABEL: Record<string, string> = { drop_ship: "Drop ship", ship_through: "Ship-through", stage: "Stage" };
const ROUTE_SUB: Record<string, string> = { drop_ship: "Vendor → client", ship_through: "→ HPD → client", stage: "→ HPD → fulfillment" };
// Blank purchasing is a job-level action — it lives in Purchasing & Production
// (per-item or bulk), not per-item here. The modal is per-product work only.
const TASKS = [["build", "Build"], ["cost", "Cost"], ["art", "Art"]] as const;

export function JobDetailV2({ job: jobProp, items: itemsProp = [], payments: paymentsProp = [], contacts = [], thumbByItem = {} }: any) {
  // Local state so edits reflect live; reseeds if the parent reloads. Note:
  // costing_data mutations are shown via the decoState overlay (not job here),
  // so cpFor(job) stays the DB baseline — don't mutate job.costing_data locally.
  const [job, setJob] = useState<any>(jobProp);
  useEffect(() => { setJob(jobProp); }, [jobProp]);
  const [items, setItems] = useState<any[]>(itemsProp);
  useEffect(() => { setItems(itemsProp); }, [itemsProp]);
  const [payments, setPayments] = useState<any[]>(paymentsProp);
  useEffect(() => { setPayments(paymentsProp); }, [paymentsProp]);
  const locked = isCostingLocked(job);

  // Decorator pricing → printers map, for the shared cost engine (decoration cost).
  const [printers, setPrinters] = useState<Record<string, any>>({});
  const [decoratorRecords, setDecoratorRecords] = useState<any[]>([]);
  useEffect(() => {
    createClient().from("decorators").select("*").order("name").then(({ data }: any) => { if (data) { setPrinters(buildPrintersMap(data)); setDecoratorRecords(data); } });
  }, []);
  const lookupPrint = (pk: string, qty: number, colors: number) => sharedLookupPrintPrice(printers, pk, qty, colors);
  const lookupTag = (pk: string, qty: number) => sharedLookupTagPrice(printers, pk, qty);

  // Decoration edits (vendor, print locations, share groups, finishing/setup/
  // specialty) live in costing_data.costProds. decoState overlays the DB copy so
  // edits show instantly; the debounced flush writes them back surgically +
  // recomputes items.sell_per_unit. Never touches qty/blankCost drift-wise —
  // those come from buy_sheet_lines / items via the assembler.
  const [decoState, setDecoState] = useState<Record<string, any>>({});
  const persistTimer = React.useRef<any>(null);
  const pendingRef = React.useRef<Record<string, any>>({});
  // Refs mirror live state so the debounced flush (a stale render closure) reads
  // the CURRENT deco edits + items, not the snapshot from when it was scheduled.
  const decoStateRef = React.useRef(decoState); decoStateRef.current = decoState;
  const itemsRef = React.useRef(items); itemsRef.current = items;

  // Job activity feed (read-only).
  const [activity, setActivity] = useState<any[]>([]);
  useEffect(() => {
    if (!job?.id) return;
    createClient().from("job_activity").select("message, created_at, type").eq("job_id", job.id).order("created_at", { ascending: false }).limit(40).then(({ data }: any) => { if (data) setActivity(data); });
  }, [job?.id]);

  // Item files (art / mockups / proofs / print-ready) for the Art tab — live
  // (non-superseded) only, grouped by item.
  const [filesByItem, setFilesByItem] = useState<Record<string, any[]>>({});
  useEffect(() => {
    const ids = (itemsProp || []).map((i: any) => i.id).filter(Boolean);
    if (!ids.length) return;
    createClient().from("item_files").select("item_id, file_name, stage, drive_file_id, approval, created_at").in("item_id", ids).is("superseded_at", null).order("created_at").then(({ data }: any) => {
      if (!data) return;
      const m: Record<string, any[]> = {};
      data.forEach((f: any) => { (m[f.item_id] ||= []).push(f); });
      setFilesByItem(m);
    });
  }, [itemsProp]);

  // Art upload → Google Drive via /api/files (per item, per stage). On success,
  // re-pull the item's files so the grid updates.
  const [uploadStage, setUploadStage] = useState("mockup");
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const uploadArt = async (item: any, stage: string, file: File) => {
    if (!file) return;
    setUploadingItem(item.id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("itemId", item.id);
      fd.append("stage", stage);
      fd.append("clientName", job?.clients?.name || "");
      fd.append("projectTitle", job?.title || "");
      fd.append("itemName", item.name || "");
      const res = await fetch("/api/files", { method: "POST", body: fd });
      if (!res.ok) { console.error("[JobV2] art upload failed", await res.text().catch(() => "")); return; }
      const { data }: any = await createClient().from("item_files").select("item_id, file_name, stage, drive_file_id, approval, created_at").eq("item_id", item.id).is("superseded_at", null).order("created_at");
      setFilesByItem(m => ({ ...m, [item.id]: data || [] }));
    } catch (e) { console.error("[JobV2] art upload error", e); }
    finally { setUploadingItem(null); }
  };

  const [wsIndex, setWsIndex] = useState<number | null>(null);   // open item worksheet index (null = closed)
  const [wsTask, setWsTask] = useState<string>("build");
  const [open, setOpen] = useState<Record<string, boolean>>({ products: true, client: false, production: true, logistics: false });
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  // Client transaction actions (send quote/proofs, approve, send invoice, record payment).
  const [clientAction, setClientAction] = useState<null | "quote" | "invoice" | "payment">(null);
  const [recips, setRecips] = useState<Record<string, boolean>>({});
  const [actBusy, setActBusy] = useState(false);
  const [actErr, setActErr] = useState("");
  const [payForm, setPayForm] = useState<{ type: string; amount: string; paid_date: string }>({ type: "full_payment", amount: "", paid_date: "" });

  // Save a single size's qty to buy_sheet_lines (the qty source of truth) and
  // reflect it locally. Blur-triggered, so flipping items never loses an edit.
  const saveQty = async (item: any, size: string, raw: string) => {
    if (isCostingLocked(job)) return;
    const q = parseInt(raw) || 0;
    if (q === Number(item.qtys?.[size] ?? 0)) return; // unchanged
    const newQtys = { ...(item.qtys || {}), [size]: q };
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: newQtys, totalQty: sumQ(newQtys) } : x));
    try {
      await (createClient().from("buy_sheet_lines") as any).upsert({ item_id: item.id, size, qty_ordered: q }, { onConflict: "item_id,size" });
    } catch (e) { console.error("[JobV2] qty save failed", e); }
  };

  // Record a blank purchase total → items.blanks_order_cost. Per-item. (The S&S
  // order # field was dropped — we log the credit-card purchase total only.)
  const saveBlankCost = async (item: any, raw: string) => {
    const val = raw === "" ? null : parseFloat(String(raw).replace(/[^0-9.]/g, "")) || 0;
    if (val === (item.blanks_order_cost ?? null)) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, blanks_order_cost: val } : x));
    try {
      await (createClient().from("items") as any).update({ blanks_order_cost: val }).eq("id", item.id);
    } catch (e) { console.error("[JobV2] blank cost save failed", e); }
  };

  // Bulk blank purchase — one CC total split across SELECTED items, proportional
  // to each item's calc cost (cost_per_unit × qty); equal split when calc is
  // missing; last item absorbs rounding drift so the row sum matches the total
  // exactly. Faithful port of BlanksTab.applyBulkOrder.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTotal, setBulkTotal] = useState("");
  const toggleSel = (id: string) => setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const applyBulk = async () => {
    const total = parseFloat(String(bulkTotal).replace(/[^0-9.\-]/g, ""));
    if (bulkTotal === "" || isNaN(total) || total < 0) return;
    const targets = items.filter((it: any) => selectedIds.has(it.id));
    if (!targets.length) return;
    const calcs = targets.map((it: any) => { const q = sumQ(it.qtys); const cpu = Number(it.cost_per_unit); return cpu > 0 && q > 0 ? cpu * q : null; });
    const calcSum = calcs.reduce((a: number, v: any) => a + (v || 0), 0);
    const allKnown = calcs.every((v: any) => v != null && v > 0);
    const cents = Math.round(total * 100);
    const shares = targets.map((_: any, i: number) => allKnown && calcSum > 0 ? Math.round((calcs[i]! / calcSum) * cents) : Math.round(cents / targets.length));
    shares[shares.length - 1] += cents - shares.reduce((a: number, v: number) => a + v, 0);
    const supabase = createClient();
    const summaries: string[] = [];
    await Promise.all(targets.map(async (it: any, i: number) => {
      const dollars = shares[i] / 100;
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, blanks_order_cost: dollars } : x));
      await (supabase.from("items") as any).update({ blanks_order_cost: dollars }).eq("id", it.id);
      summaries.push(`${it.name} · $${dollars.toFixed(2)}`);
    }));
    try { logJobActivity(job.id, `Bulk blanks order: $${total.toFixed(2)} across ${targets.length} item${targets.length !== 1 ? "s" : ""} — ${summaries.join(", ")}`); } catch {}
    setBulkTotal(""); setSelectedIds(new Set());
  };

  // Esc + arrow keys for the worksheet — the proof-editor feel.
  useEffect(() => {
    if (wsIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWsIndex(null);
      if (e.key === "ArrowLeft") setWsIndex(i => i === null ? i : (i - 1 + items.length) % items.length);
      if (e.key === "ArrowRight") setWsIndex(i => i === null ? i : (i + 1) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wsIndex, items.length]);

  const client = job?.clients?.name || "";
  const units = items.reduce((a: number, it: any) => a + qtyOf(it), 0);
  const orderTotal = items.reduce((a: number, it: any) => a + (Number(it.sell_per_unit) || 0) * qtyOf(it), 0);
  const tm = job?.type_meta || {};
  const invoiced = Number(tm.qb_total_with_tax) || 0;
  const invNum = tm.qb_invoice_number || tm.stripe_invoice_number || "";
  const paid = payments.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
  const toInvoice = Math.round((orderTotal - invoiced) * 100) / 100;
  const route = job?.shipping_route || "";
  const address = tm.venue_address || job?.clients?.shipping_address || "";
  const created = job?.created_at ? new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const inHands = job?.target_ship_date ? new Date(job.target_ship_date + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const hero = PHASE_HERO[job?.phase] || PHASE_HERO.intake;

  // ── client-action handlers (reuse the shared libs) ──
  const flatContacts = (contacts || []).map((c: any) => ({ email: c.contacts?.email || c.email, name: c.contacts?.name || c.name || "", role_on_job: c.role_on_job })).filter((c: any) => c.email);
  const openSend = (kind: "quote" | "invoice") => {
    const { to, cc } = defaultRecipient(flatContacts);
    const sel: Record<string, boolean> = {};
    flatContacts.forEach((c: any) => { sel[c.email] = c.email === to || cc.includes(c.email); });
    setRecips(sel); setActErr(""); setClientAction(kind);
  };
  const selectedEmails = () => flatContacts.filter((c: any) => recips[c.email]).map((c: any) => c.email);
  const refetchTypeMeta = async () => { const { data }: any = await createClient().from("jobs").select("type_meta, quote_approved, quote_approved_at").eq("id", job.id).single(); if (data) setJob((j: any) => ({ ...j, quote_approved: data.quote_approved, quote_approved_at: data.quote_approved_at, type_meta: { ...j.type_meta, ...data.type_meta } })); };
  const doSendQuote = async () => {
    const emails = selectedEmails(); if (!emails.length) { setActErr("Select a recipient."); return; }
    setActBusy(true); setActErr("");
    try {
      const [to, ...cc] = emails;
      const hasReady = items.some((it: any) => it.proof_spec);
      await sendQuoteAndProofs(job, { to, cc, includeProofs: hasReady, proofsOnly: !!job.quote_approved });
      const readyIds = items.filter((it: any) => it.proof_spec && !it.proof_sent_at).map((it: any) => it.id);
      if (readyIds.length) { const nowP = new Date().toISOString(); await (createClient().from("items") as any).update({ proof_sent_at: nowP }).in("id", readyIds); setItems(prev => prev.map(x => readyIds.includes(x.id) ? { ...x, proof_sent_at: nowP } : x)); }
      await refetchTypeMeta();
      setClientAction(null);
    } catch (e: any) { setActErr(e.message || "Send failed"); } finally { setActBusy(false); }
  };
  const doSendInvoice = async () => {
    const emails = selectedEmails(); if (!emails.length) { setActErr("Select a recipient."); return; }
    setActBusy(true); setActErr("");
    try {
      await pushInvoiceToQB(job);
      const [to, ...cc] = emails;
      const r = await fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "invoice", jobId: job.id, recipientEmail: to, ccEmails: cc }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Invoice email failed");
      await refetchTypeMeta();
      setClientAction(null);
    } catch (e: any) { setActErr(e.message || "Invoice send failed"); } finally { setActBusy(false); }
  };
  const doApprove = async () => {
    const now = new Date().toISOString();
    await (createClient().from("jobs") as any).update({ quote_approved: true, quote_approved_at: now }).eq("id", job.id);
    setJob((j: any) => ({ ...j, quote_approved: true, quote_approved_at: now }));
    try { logJobActivity(job.id, "Quote approved (internal)"); } catch {}
  };
  const doRevoke = async () => {
    await (createClient().from("jobs") as any).update({ quote_approved: false, quote_approved_at: null }).eq("id", job.id);
    setJob((j: any) => ({ ...j, quote_approved: false, quote_approved_at: null }));
    try { logJobActivity(job.id, "Quote approval revoked"); } catch {}
  };
  const doRecordPayment = async () => {
    const amt = parseFloat(String(payForm.amount).replace(/[^0-9.]/g, "")) || 0;
    if (amt <= 0) { setActErr("Enter an amount."); return; }
    setActBusy(true); setActErr("");
    try {
      await recordPayment(job, { type: payForm.type, amount: amt, invoice_number: invNum || null, paid_date: payForm.paid_date || new Date().toISOString().slice(0, 10) });
      const { data: freshPay }: any = await createClient().from("payment_records").select("*").eq("job_id", job.id).order("created_at");
      if (freshPay) setPayments(freshPay);
      setPayForm({ type: "full_payment", amount: "", paid_date: "" });
      setClientAction(null);
    } catch (e: any) { setActErr(e.message || "Failed"); } finally { setActBusy(false); }
  };

  // ── spine ──
  const phase = job?.phase || "intake";
  const beyond = (p: string, list: string[]) => list.includes(p);
  const flags = {
    quoted: !!tm.quote_sent_at,
    approved: !!job?.quote_approved,
    invoiced: !!invNum,
    grew: invoiced > 0 && toInvoice > 0.5,
    paid: invoiced > 0 && paid >= invoiced - 0.5,
    po: Array.isArray(tm.po_sent_vendors) && tm.po_sent_vendors.length > 0,
  };
  const spine = [
    { cap: "Quoted", state: flags.quoted ? "done" : "todo" },
    { cap: "Approved", state: flags.approved ? "done" : "todo" },
    { cap: "Invoiced", state: flags.grew ? "warn" : flags.invoiced ? "done" : "todo" },
    { cap: "Paid", state: flags.paid ? "done" : "todo" },
    { cap: "PO · Blanks", state: flags.po ? "done" : "todo" },
    { cap: "Production", state: phase === "production" ? "now" : beyond(phase, ["receiving", "fulfillment", "complete"]) ? "done" : "todo" },
    { cap: "Receiving", state: phase === "receiving" ? "now" : beyond(phase, ["fulfillment", "complete"]) ? "done" : "todo" },
    { cap: "Staging", state: phase === "fulfillment" ? "now" : phase === "complete" ? "done" : "todo" },
  ];
  const segBg = (s: string) => s === "done" ? T.green : s === "warn" ? T.amber : s === "now" ? "transparent" : T.border;

  // ── art / production summaries ──
  const artApproved = items.filter((it: any) => it.artwork_status === "approved").length;
  const inProd = items.filter((it: any) => it.pipeline_stage === "in_production").length;
  const shipped = items.filter((it: any) => it.pipeline_stage === "shipped").length;
  const blanksOrdered = items.filter((it: any) => it.blanks_order_number || it.blanks_order_cost != null).length;

  // ── order gates (mirror BlanksTab): quote approved · payment (terms-specific)
  // · all proofs approved. All three must be met before ordering blanks / POs. ──
  const terms = (job?.payment_terms || "").toLowerCase();
  const paymentGate = /^net/.test(terms) ? flags.approved : terms === "deposit_balance" ? payments.some((p: any) => p.status === "paid") : flags.paid;
  const proofGate = items.length > 0 && artApproved === items.length;
  const canOrder = flags.approved && paymentGate && proofGate;

  // ── per-vendor PO grouping. Group by the costing printVendor (what the PO PDF
  // route filters on with ?vendor=), matching the current PO tab. costing_data
  // rides on `job`. Fall back to the decorator assignment name. ──
  const poSentVendors: string[] = Array.isArray(tm.po_sent_vendors) ? tm.po_sent_vendors : [];
  const costProds: any[] = job?.costing_data?.costProds || [];
  const cpFor = (item: any) => costProds.find(cp => cp.id === item.id)
    || costProds.find(cp => (cp.name || "").trim().toLowerCase() === (item.name || "").trim().toLowerCase());
  const calcBlank = (item: any) => (Number(item.cost_per_unit) || 0) * sumQ({ ...(item.qtys || {}) });
  const vendorGroups: Record<string, any[]> = {};
  for (const item of items) {
    const v = cpFor(item)?.printVendor || item.decorator || "Unassigned";
    (vendorGroups[v] ||= []).push(item);
  }

  // ── THE ASSEMBLER (Track-2 core) ──────────────────────────────────────────
  // One place that joins the three homes into the `p` the shared cost engine
  // eats: qty ← buy_sheet_lines (single source), blank cost ← items (raw), the
  // rest of the pricing (vendor, print locations, margin, override) ← costing_data.
  // Every V2 cost read/calc goes through this — never costProds.qtys directly.
  const costMargin = job?.costing_data?.costMargin || "30%";
  const inclShip = job?.costing_data?.inclShip !== false;
  const inclCC = job?.costing_data?.inclCC !== false;
  const assemble = (item: any) => {
    const cp = decoState[item.id] || cpFor(item) || {};          // decoState overlays unsaved decoration edits
    const bslQtys = { ...(item.qtys || {}) };                    // items.qtys is built from buy_sheet_lines upstream
    const blankCosts = (item.blank_costs && Object.keys(item.blank_costs).length) ? item.blank_costs : (cp.blankCosts || {});
    return { ...cp, id: item.id, name: item.name, qtys: bslQtys, totalQty: sumQ(bslQtys), blankCosts, blank_vendor: item.blank_vendor, garment_type: item.garment_type };
  };
  const allAssembled = items.map(assemble);

  // Debounced flush of decoration edits → costing_data (surgical) + recomputed
  // items.sell_per_unit. Reads via refs (assembleNow) so a stale timer closure
  // still sees the current edits. Fresh read-modify-write so nothing is clobbered.
  const flushDeco = async () => {
    const ids = Object.keys(pendingRef.current); pendingRef.current = {};
    if (!ids.length) return;
    const ds = decoStateRef.current;
    const its = itemsRef.current;
    const assembleNow = (item: any) => {
      const cp = ds[item.id] || cpFor(item) || {};
      const q = { ...(item.qtys || {}) };
      const bc = (item.blank_costs && Object.keys(item.blank_costs).length) ? item.blank_costs : (cp.blankCosts || {});
      return { ...cp, id: item.id, name: item.name, qtys: q, totalQty: sumQ(q), blankCosts: bc, blank_vendor: item.blank_vendor, garment_type: item.garment_type };
    };
    const supabase = createClient();
    try {
      const { data: fresh }: any = await supabase.from("jobs").select("costing_data").eq("id", job.id).single();
      const cd = fresh?.costing_data || job.costing_data || { costProds: [] };
      const cps = (Array.isArray(cd.costProds) ? cd.costProds : []).map((c: any) => ({ ...c }));
      const allNow = its.map(assembleNow);
      const sellUpdates: { id: string; sell: number }[] = [];
      for (const id of ids) {
        const item = its.find((x: any) => x.id === id); if (!item) continue;
        const p = assembleNow(item);
        let idx = cps.findIndex((c: any) => c.id === id);
        if (idx < 0) idx = cps.findIndex((c: any) => (c.name || "").trim().toLowerCase() === (item.name || "").trim().toLowerCase());
        if (idx >= 0) cps[idx] = { ...cps[idx], ...p }; else cps.push(p);
        if (Object.keys(printers).length) { try { const r: any = calcCostProduct(p, costMargin, inclShip, inclCC, allNow, printers); if (r) sellUpdates.push({ id, sell: Math.round((r.sellPerUnit || 0) * 100) / 100 }); } catch {} }
      }
      await (supabase.from("jobs") as any).update({ costing_data: { ...cd, costProds: cps } }).eq("id", job.id);
      for (const u of sellUpdates) await (supabase.from("items") as any).update({ sell_per_unit: u.sell }).eq("id", u.id);
      if (sellUpdates.length) setItems(prev => prev.map(x => { const u = sellUpdates.find(s => s.id === x.id); return u ? { ...x, sell_per_unit: u.sell } : x; }));
    } catch (e) { console.error("[JobV2] deco flush failed", e); }
  };
  const schedulePersist = (item: any, newP: any) => {
    pendingRef.current[item.id] = newP;
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(flushDeco, 700);
  };
  // DecorationPanel's edit hooks. updateProd = one item; setCostProds = fn over
  // the whole array (copy-to-all / apply-vendor-below).
  const updateProd = (i: number, newP: any) => {
    const item = items[i]; if (!item) return;
    setDecoState(s => ({ ...s, [item.id]: newP }));
    schedulePersist(item, newP);
  };
  const setCostProdsFn = (fn: any) => {
    const next = fn(allAssembled);
    setDecoState(s => { const m = { ...s }; next.forEach((np: any, idx: number) => { const it = items[idx]; if (it) m[it.id] = np; }); return m; });
    next.forEach((np: any, idx: number) => { const it = items[idx]; if (it) schedulePersist(it, np); });
  };
  const calcFor = (item: any) => {
    if (!Object.keys(printers).length) return null;             // wait for decorator pricing
    try { return calcCostProduct(assemble(item), costMargin, inclShip, inclCC, allAssembled, printers); }
    catch { return null; }
  };

  // Edit the RAW blank cost per unit → items.blank_costs (spread across sizes) +
  // cost_per_unit, then recompute + persist sell_per_unit via the SAME engine
  // (respects an existing sellOverride — calcCostProduct keeps it). items-table
  // only; never touches costing_data, so no drift can be introduced.
  const saveBlankPerUnit = async (item: any, raw: string) => {
    if (isCostingLocked(job)) return;
    const per = raw === "" ? 0 : parseFloat(String(raw).replace(/[^0-9.]/g, "")) || 0;
    const sizes = Object.keys(item.qtys || {});
    if (!sizes.length) return;
    const blank_costs: Record<string, number> = {};
    sizes.forEach(sz => { blank_costs[sz] = per; });
    const nextItem = { ...item, blank_costs, cost_per_unit: per };
    // recompute sell with the new blank cost, through the assembler + shared engine
    const r = Object.keys(printers).length ? (() => { try { return calcCostProduct(assemble(nextItem), costMargin, inclShip, inclCC, items.map(x => x.id === item.id ? assemble(nextItem) : assemble(x)), printers); } catch { return null; } })() : null;
    const sell = r ? Math.round((r.sellPerUnit || 0) * 100) / 100 : item.sell_per_unit;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, blank_costs, cost_per_unit: per, sell_per_unit: sell } : x));
    try {
      const upd: any = { blank_costs, cost_per_unit: per };
      if (r) upd.sell_per_unit = sell;
      await (createClient().from("items") as any).update(upd).eq("id", item.id);
    } catch (e) { console.error("[JobV2] blank cost save failed", e); }
  };

  // Set / clear the per-item sell OVERRIDE — the single invoice-truth control.
  // Override has no home but costing_data.costProds[i].sellOverride, so this is
  // a SURGICAL read-modify-write: fetch fresh costing_data, change ONLY this
  // item's sellOverride, write back (qtys/blankCosts untouched → no drift), then
  // persist the resulting items.sell_per_unit (override value, or recomputed auto).
  const saveOverride = async (item: any, raw: string) => {
    if (isCostingLocked(job)) return;
    const supabase = createClient();
    const trimmed = (raw || "").trim();
    const override = trimmed === "" ? null : (parseFloat(trimmed.replace(/[^0-9.]/g, "")) || 0);
    let sell = Number(item.sell_per_unit) || 0;
    if (override != null) {
      sell = Math.round(override * 100) / 100;
    } else if (Object.keys(printers).length) {
      // cleared → recompute the auto sell via the engine with override removed
      const pAuto: any = { ...assemble(item) }; delete pAuto.sellOverride;
      try { const rr: any = calcCostProduct(pAuto, costMargin, inclShip, inclCC, items.map(x => x.id === item.id ? pAuto : assemble(x)), printers); if (rr) sell = Math.round((rr.sellPerUnit || 0) * 100) / 100; } catch {}
    }
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, sell_per_unit: sell } : x));
    // reflect the override in the overlay so the Cost tab shows it immediately
    setDecoState(s => ({ ...s, [item.id]: { ...(s[item.id] || cpFor(item) || {}), sellOverride: override } }));
    try {
      const { data: fresh }: any = await supabase.from("jobs").select("costing_data").eq("id", job.id).single();
      const cd = fresh?.costing_data || job.costing_data || { costProds: [] };
      const cps = (Array.isArray(cd.costProds) ? cd.costProds : []).map((c: any) => ({ ...c }));
      let idx = cps.findIndex((c: any) => c.id === item.id);
      if (idx < 0) idx = cps.findIndex((c: any) => (c.name || "").trim().toLowerCase() === (item.name || "").trim().toLowerCase());
      if (idx >= 0) { if (override == null) delete cps[idx].sellOverride; else cps[idx].sellOverride = override; }
      await (supabase.from("jobs") as any).update({ costing_data: { ...cd, costProds: cps } }).eq("id", job.id);
      await (supabase.from("items") as any).update({ sell_per_unit: sell }).eq("id", item.id);
    } catch (e) { console.error("[JobV2] override save failed", e); }
  };

  const lbl: React.CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.faint };
  const previewBtn: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: T.text, textDecoration: "none", padding: "8px 15px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card };
  const actBtn: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "#0a0a0a", background: T.accent, border: "none", borderRadius: 999, padding: "9px 16px", cursor: "pointer", fontFamily: font };
  const ghostBtn: React.CSSProperties = { ...previewBtn, cursor: "pointer", fontFamily: font };
  const field: React.CSSProperties = { padding: "9px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13.5, fontFamily: font, outline: "none", boxSizing: "border-box", width: "100%" };
  const block = (id: string, tick: "done" | "now" | "todo", title: string, summary: string, body: React.ReactNode, dim = false) => (
    <div id={id} style={{ border: `1px solid ${T.border}`, borderRadius: 16, background: T.card, marginTop: 14, overflow: "hidden", opacity: dim && !open[id] ? 0.6 : 1 }}>
      <div onClick={() => toggle(id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", cursor: "pointer" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
          background: tick === "done" ? T.greenDim : tick === "now" ? "rgba(107,176,232,.14)" : "transparent",
          color: tick === "done" ? T.green : tick === "now" ? "#6bb0e8" : T.faint,
          border: `1px solid ${tick === "done" ? T.green + "66" : tick === "now" ? "#6bb0e880" : T.border}` }}>{tick === "done" ? "✓" : tick === "now" ? "◉" : "○"}</span>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase" }}>{title}</span>
        <span style={{ flex: 1, fontSize: 12.5, color: T.muted, fontFamily: mono, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span style={{ color: T.faint, fontSize: 13, transform: open[id] ? "none" : "rotate(-90deg)", transition: "transform .2s" }}>▾</span>
      </div>
      {open[id] && <div style={{ padding: "4px 20px 20px", borderTop: `1px solid ${T.border}55` }}>{body}</div>}
    </div>
  );

  const it = wsIndex !== null ? items[wsIndex] : null;

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 1120, margin: "0 auto", padding: "0 20px 80px" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0 6px", fontSize: 13 }}>
        <a href="/projects" style={{ color: T.muted, fontWeight: 700, textDecoration: "none" }}>‹ Projects</a>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, letterSpacing: "0.1em", textTransform: "uppercase" }}>V2 preview</span>
          <a href={`/jobs/${job?.id}`} style={{ fontSize: 11, fontWeight: 700, color: T.muted, textDecoration: "none", padding: "5px 11px", borderRadius: 999, border: `1px solid ${T.border}` }}>Classic view ›</a>
        </div>
      </div>

      {/* title */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "2px 0 16px" }}>
        <h1 style={{ fontSize: "clamp(26px,4vw,40px)", fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1.02, margin: 0 }}>{client || job?.title}</h1>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 800, color: T.muted }}>{invNum || job?.job_number}</div>
          {invNum && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>{job?.job_number}</div>}
        </div>
      </div>

      {/* HERO + next action */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: "22px 24px", display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
        <div>
          <div style={{ color: "#6bb0e8", fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>{hero.eyebrow}</div>
          <h2 style={{ fontSize: "clamp(28px,5vw,48px)", fontWeight: 900, letterSpacing: "-0.02em", margin: "6px 0 8px", lineHeight: 0.98 }}>{hero.title}</h2>
          <p style={{ color: T.muted, fontSize: 14, maxWidth: "44ch", margin: 0 }}>{hero.sub}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignSelf: "center" }}>
          {flags.grew && (
            <a href="#client" onClick={() => setOpen(o => ({ ...o, client: true }))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 12, border: `1px solid ${T.amber}80`, background: T.amberDim, textDecoration: "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.amber, flexShrink: 0 }} />
              <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: T.text }}>Order grew {fmtMoney(toInvoice)} since invoicing</span><span style={{ fontSize: 12, color: T.muted }}>Re-invoice the addition · Inv {invNum} was {fmtMoney(invoiced)}</span></span>
              <span style={{ color: T.faint, fontSize: 16 }}>›</span>
            </a>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6bb0e8", flexShrink: 0 }} />
            <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: T.text }}>{inProd + shipped} of {items.length} items moving</span><span style={{ fontSize: 12, color: T.muted }}>{inProd} in production · {blanksOrdered}/{items.length} blanks ordered</span></span>
          </div>
        </div>
      </div>

      {/* money + logistics strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-end", padding: "18px 4px 4px", marginTop: 14, borderTop: `1px solid ${T.border}55` }}>
        {[
          ["Order total", fmtMoney(orderTotal), `${units.toLocaleString()} units`, T.text],
          ["Invoiced", invNum ? fmtMoney(invoiced) : "—", invNum ? "Inv " + invNum : "not sent", T.text],
          ["Paid", fmtMoney(paid), job?.payment_terms ? String(job.payment_terms).replace(/_/g, " ") : "", T.green],
          ...(flags.grew ? [["To invoice", "+" + fmtMoney(toInvoice), "order grew", T.amber]] : []),
        ].map(([l, v, s, c]: any) => (
          <div key={l}><div style={lbl}>{l}</div><div style={{ fontFamily: mono, fontSize: 22, fontWeight: 800, marginTop: 3, color: c }}>{v}</div><div style={{ fontSize: 11, color: T.faint, marginTop: 2, fontFamily: mono }}>{s}</div></div>
        ))}
        <div style={{ minWidth: 200, flex: 1 }}>
          <div style={lbl}>Ship-to · {ROUTE_LABEL[route] || route || "route not set"}</div>
          <div style={{ fontSize: 13, color: address ? T.text : T.faint, marginTop: 4, lineHeight: 1.4 }}>{address || "No address set"}</div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>{ROUTE_SUB[route] || ""}</div>
        </div>
        <div><div style={lbl}>Created</div><div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, marginTop: 3, color: T.muted }}>{created}</div></div>
        <div><div style={lbl}>In-hands</div><div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, marginTop: 3, color: inHands === "—" ? T.faint : T.text }}>{inHands}</div></div>
      </div>

      {/* spine */}
      <div style={{ display: "flex", gap: 0, margin: "20px 0 8px", overflowX: "auto" }}>
        {spine.map((s, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1, minWidth: 74 }}>
            <div style={{ height: 5, width: "100%", borderRadius: 3, background: segBg(s.state), border: s.state === "now" ? "1px solid #6bb0e866" : "none", backgroundImage: s.state === "now" ? "repeating-linear-gradient(45deg,#6bb0e8,#6bb0e8 5px,transparent 5px,transparent 10px)" : "none" }} />
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap", color: s.state === "now" ? "#6bb0e8" : s.state === "todo" ? T.faint : T.muted }}>{s.cap}</div>
          </div>
        ))}
      </div>

      {/* jump nav */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(10,10,10,0.82)", backdropFilter: "blur(10px)", display: "flex", gap: 8, padding: "12px 0", margin: "8px 0 6px", borderBottom: `1px solid ${T.border}55`, overflowX: "auto" }}>
        {[["products", "Products & Costing"], ["client", "Client"], ["production", "Purchasing & Production"], ["logistics", "Logistics"]].map(([id, label]) => (
          <a key={id} href={"#" + id} onClick={() => setOpen(o => ({ ...o, [id]: true }))} style={{ fontSize: 12, fontWeight: 700, color: T.muted, textDecoration: "none", padding: "7px 13px", borderRadius: 999, border: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{label}</a>
        ))}
      </div>

      {/* PRODUCTS gallery */}
      {block("products", "done", "Products & Costing", `${items.length} items · ${units.toLocaleString()} units · ${fmtMoney(orderTotal)}`, (
        <>
          <div style={{ fontSize: 11.5, color: T.faint, padding: "8px 0 12px" }}>Tap a product for its worksheet — sizes, blank cost, decoration, vendor &amp; margin.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(max(210px, calc((100% - 36px) / 4)), 1fr))", gap: 12 }}>
            {items.map((item: any, i: number) => {
              const thumb = thumbByItem[item.id];
              const q = qtyOf(item);
              const line = (Number(item.sell_per_unit) || 0) * q;
              return (
                <div key={item.id} onClick={() => { setWsIndex(i); setWsTask("build"); }} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", cursor: "pointer" }}>
                  <div style={{ aspectRatio: "1/1", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44 }}>
                    {thumb ? <img src={thumbSrc(thumb)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : "👕"}
                  </div>
                  <div style={{ padding: "11px 13px 13px" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", lineHeight: 1.25 }}>{item.name}</div>
                    <div style={{ fontFamily: mono, fontSize: 10.5, color: T.faint, marginTop: 4 }}>{item.blank_vendor || ""} {item.blank_sku || ""}</div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 9, gap: 8 }}>
                      <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{q.toLocaleString()}u · ${(Number(item.sell_per_unit) || 0).toFixed(2)}</span>
                      <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 800 }}>{fmtMoney(line)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 9, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${T.border}55`, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      <span style={{ color: item.artwork_status === "approved" ? T.green : T.faint }}>Art {item.artwork_status === "approved" ? "✓" : "…"}</span>
                      <span style={{ color: item.pipeline_stage === "in_production" ? "#6bb0e8" : item.pipeline_stage === "shipped" ? T.green : T.faint }}>{item.pipeline_stage === "in_production" ? "Printing" : item.pipeline_stage === "shipped" ? "Shipped" : "—"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ))}

      {/* CLIENT */}
      {block("client", flags.approved ? "done" : "todo", "Client",
        `${flags.approved ? "Approved" : flags.quoted ? "Quote sent" : "Not sent"} · ${invNum ? "Inv " + invNum : "no invoice"} · ${fmtMoney(paid)} paid${flags.grew ? " · ⚠ re-invoice" : ""}`, (
        <div>
          {/* client transaction actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button onClick={() => openSend("quote")} style={actBtn}>{job.quote_approved ? "Send proofs" : "Send quote & proofs"}</button>
            {job.quote_approved
              ? <button onClick={doRevoke} style={ghostBtn}>Approved ✓ · revoke</button>
              : <button onClick={doApprove} style={ghostBtn}>Mark approved</button>}
            <button onClick={() => openSend("invoice")} style={ghostBtn}>Send invoice</button>
            <button onClick={() => { setActErr(""); setClientAction("payment"); }} style={ghostBtn}>+ Record payment</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <a href={`/api/pdf/quote/${job.id}`} target="_blank" rel="noreferrer" style={previewBtn}>Preview quote</a>
            {invNum && <a href={`/api/pdf/invoice/${job.id}`} target="_blank" rel="noreferrer" style={previewBtn}>Preview invoice</a>}
            {job?.portal_token && <a href={`/portal/${job.portal_token}`} target="_blank" rel="noreferrer" style={{ ...previewBtn, background: "transparent" }}>Client hub ›</a>}
          </div>
          {[["Quote", flags.approved ? "Sent · Approved" : flags.quoted ? "Sent" : "Not sent"],
            ["Proofs", `${artApproved}/${items.length} approved`],
            ["Invoice", invNum ? `${invNum} · sent` : "not sent"],
            ["Paid", `${fmtMoney(paid)} of ${fmtMoney(invoiced || orderTotal)}`],
            ...(flags.grew ? [["Outstanding", `${fmtMoney(toInvoice)} added since invoicing — re-invoice`]] : []),
            ["Contacts", (contacts || []).map((c: any) => c.contacts?.name).filter(Boolean).join(", ") || "none on job"]].map(([l, v]: any) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.border}55`, fontSize: 13 }}>
              <span style={{ color: T.muted }}>{l}</span><span style={{ fontWeight: 700, color: l === "Outstanding" ? T.amber : T.text }}>{v}</span>
            </div>
          ))}
        </div>
      ))}

      {/* PRODUCTION */}
      {block("production", phase === "production" ? "now" : beyond(phase, ["receiving", "fulfillment", "complete"]) ? "done" : "todo", "Purchasing & Production",
        `${blanksOrdered}/${items.length} blanks · ${Object.keys(vendorGroups).filter(v => poSentVendors.includes(v)).length}/${Object.keys(vendorGroups).length} POs sent`, (
        <div>
          {/* GATES — cleared to order? */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "8px 12px", marginTop: 6, marginBottom: 16, borderRadius: 10, background: canOrder ? T.greenDim : T.surface, border: `1px solid ${canOrder ? T.green + "44" : T.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: canOrder ? T.green : T.amber }}>{canOrder ? "Cleared to order" : "Not cleared yet"}</span>
            {[["Quote", flags.approved], ["Payment", paymentGate], ["Proofs", proofGate]].map(([g, ok]: any) => (
              <span key={g} style={{ fontSize: 12, color: T.muted }}>{ok ? <b style={{ color: T.green }}>✓</b> : <b style={{ color: T.faint }}>○</b>} {g}</span>
            ))}
          </div>

          {/* BLANKS — credit-card purchases, per item */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span style={lbl}>Blanks · credit-card purchases · {blanksOrdered}/{items.length} logged</span>
            <button onClick={() => setSelectedIds(s => s.size === items.length ? new Set() : new Set(items.map((i: any) => i.id)))}
              style={{ fontSize: 11, fontWeight: 700, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 999, padding: "4px 11px", cursor: "pointer", fontFamily: font }}>
              {selectedIds.size === items.length ? "Clear all" : "Select all"}
            </button>
          </div>
          {items.map((item: any) => {
            const calc = calcBlank(item);
            const ordered = item.blanks_order_cost != null && item.blanks_order_cost !== "";
            const actual = ordered ? Number(item.blanks_order_cost) : null;
            const sel = selectedIds.has(item.id);
            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.border}44`, flexWrap: "wrap" }}>
                <input type="checkbox" checked={sel} onChange={() => toggleSel(item.id)} style={{ width: 15, height: 15, accentColor: T.accent, cursor: "pointer" }} />
                <span style={{ flex: 1, minWidth: 150, fontSize: 13, fontWeight: 600 }}>{item.name}<span style={{ color: T.faint, fontWeight: 400, marginLeft: 8, fontSize: 11 }}>{item.blank_vendor} {item.blank_sku}</span></span>
                <span style={{ fontSize: 11, color: T.faint, fontFamily: mono, width: 74, textAlign: "right" }}>est {fmtMoney(calc)}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 11, color: T.faint }}>$</span>
                  <input key={item.id + ":c:" + (item.blanks_order_cost ?? "")} defaultValue={actual != null ? actual.toFixed(2) : ""} placeholder="total paid" inputMode="decimal" onBlur={e => saveBlankCost(item, e.target.value)}
                    style={{ width: 84, padding: "6px 8px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: mono, outline: "none" }} />
                </div>
                <span style={{ width: 62, textAlign: "right", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: ordered ? (actual! > calc ? T.red : T.green) : T.faint }}>{ordered ? (actual! > calc ? "over" : "logged ✓") : "—"}</span>
              </div>
            );
          })}
          {/* Bulk purchase — one CC total split across selected items */}
          {selectedIds.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12, padding: "11px 13px", borderRadius: 10, background: T.surface, border: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.muted }}>{selectedIds.size} selected · split one purchase total:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 12, color: T.faint }}>$</span>
                <input value={bulkTotal} onChange={e => setBulkTotal(e.target.value)} placeholder="0.00" inputMode="decimal"
                  onKeyDown={e => { if (e.key === "Enter") applyBulk(); }}
                  style={{ width: 100, padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontFamily: mono, outline: "none" }} />
              </div>
              <button onClick={applyBulk} disabled={!bulkTotal.trim()}
                style={{ fontSize: 12, fontWeight: 800, color: bulkTotal.trim() ? "#0a0a0a" : T.faint, background: bulkTotal.trim() ? T.accent : "transparent", border: `1px solid ${bulkTotal.trim() ? T.accent : T.border}`, borderRadius: 999, padding: "7px 16px", cursor: bulkTotal.trim() ? "pointer" : "default", fontFamily: font }}>Apply to selected</button>
              <span style={{ fontSize: 11, color: T.faint }}>split proportional to each item's estimate</span>
            </div>
          )}

          {/* PURCHASE ORDERS — per vendor */}
          <div style={{ ...lbl, margin: "22px 0 10px" }}>Purchase orders · bill-later vendors</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(vendorGroups).map(([vendor, vitems]) => {
              const sent = poSentVendors.includes(vendor);
              const vUnits = vitems.reduce((a: number, it: any) => a + qtyOf(it), 0);
              const allBlanks = vitems.every((it: any) => it.blanks_order_cost != null && it.blanks_order_cost !== "");
              return (
                <div key={vendor} style={{ border: `1px solid ${T.border}`, borderRadius: 12, background: T.surface, padding: "13px 15px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 800, flex: 1, minWidth: 120 }}>{vendor}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: sent ? T.green : T.faint }}>{sent ? "✓ Sent" : "— Not sent"}</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 4, fontFamily: mono }}>{vitems.map((it: any) => it.name).join(" · ")} · {vUnits.toLocaleString()} u</div>
                  {!allBlanks && <div style={{ fontSize: 11, color: T.amber, marginTop: 6 }}>⚠ Not all blanks ordered for this vendor.</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                    <a href={`/api/pdf/po/${job.id}?vendor=${encodeURIComponent(vendor)}${sent ? "&revised=1" : ""}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, fontWeight: 800, color: T.text, textDecoration: "none", padding: "8px 15px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card }}>Preview PO</a>
                    <span title="Send flow (email + ship details) wires in next" style={{ fontSize: 12, fontWeight: 800, color: T.faint, padding: "8px 15px", borderRadius: 999, border: `1px dashed ${T.border}`, cursor: "not-allowed" }}>{sent ? "Re-send" : "Send PO"} · next</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* LOGISTICS */}
      {block("logistics", beyond(phase, ["receiving", "fulfillment", "complete"]) ? "now" : "todo", "Logistics",
        `${ROUTE_LABEL[route] || "route not set"} — ${phase === "receiving" ? "receiving" : phase === "fulfillment" ? "fulfillment" : "waiting on production"}`, (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.border}55`, fontSize: 13 }}>
            <span style={{ color: T.muted }}>Route</span><span style={{ fontWeight: 700 }}>{ROUTE_LABEL[route] || "—"} · {ROUTE_SUB[route] || ""}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 13 }}>
            <span style={{ color: T.muted }}>Ship-to</span><span style={{ fontWeight: 700, textAlign: "right", maxWidth: "60%" }}>{address || "—"}</span>
          </div>
        </div>
      ), true)}

      {/* ACTIVITY */}
      {block("activity", "done", "Activity",
        activity.slice(0, 3).map((a: any) => a.message).join(" · ") || "no activity yet",
        activity.length === 0 ? <div style={{ fontSize: 13, color: T.faint }}>No activity yet.</div> : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {activity.map((a: any, i: number) => (
              <div key={i} style={{ fontSize: 12.5, color: T.muted, padding: "7px 0", borderBottom: `1px solid ${T.border}44`, lineHeight: 1.4 }}>
                <span style={{ fontFamily: mono, color: T.faint, fontSize: 11, marginRight: 8 }}>{fmtDT(a.created_at)}</span>{a.message}
              </div>
            ))}
          </div>
        ))}

      {/* ── ITEM WORKSHEET (proof-editor style: flip between items, never unmount) ── */}
      {it && (
        <div onClick={e => { if (e.target === e.currentTarget) setWsIndex(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 14px", overflowY: "auto" }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, width: "100%", maxWidth: 640, overflow: "hidden" }}>
            {/* nav strip */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}55` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setWsIndex((wsIndex! - 1 + items.length) % items.length)} aria-label="Previous item" style={navBtn}>‹</button>
                <button onClick={() => setWsIndex((wsIndex! + 1) % items.length)} aria-label="Next item" style={navBtn}>›</button>
                <span style={{ fontFamily: mono, fontSize: 12, color: T.faint, marginLeft: 6 }}>{wsIndex! + 1} / {items.length}</span>
              </div>
              <button onClick={() => setWsIndex(null)} aria-label="Close" style={{ ...navBtn, background: T.surface }}>×</button>
            </div>
            {/* item head */}
            <div style={{ display: "flex", gap: 14, padding: "16px 18px", alignItems: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: 10, background: "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
                {thumbByItem[it.id] ? <img src={thumbSrc(thumbByItem[it.id])} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 10 }} /> : "👕"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.01em" }}>{it.name}</div>
                <div style={{ fontFamily: mono, fontSize: 11.5, color: T.faint, marginTop: 3 }}>{it.blank_vendor || ""} {it.blank_sku || ""} · {qtyOf(it).toLocaleString()} u · ${(Number(it.sell_per_unit) || 0).toFixed(2)}</div>
              </div>
            </div>
            {/* task tabs — "click the task you're there to do" */}
            <div style={{ display: "flex", gap: 6, padding: "0 18px 4px" }}>
              {TASKS.map(([k, label]) => (
                <button key={k} onClick={() => setWsTask(k)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${wsTask === k ? T.accent : T.border}`, background: wsTask === k ? T.accent : "transparent", color: wsTask === k ? "#0a0a0a" : T.muted, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: font }}>{label}</button>
              ))}
            </div>
            {/* task panel (scaffold: real data read; real editors wire in next) */}
            <div style={{ padding: "14px 18px 22px", minHeight: 180 }}>
              {wsTask === "build" && (() => {
                const sizes = Object.keys(it.qtys || {});
                return (
                  <div>
                    {sizes.length === 0 ? (
                      <div style={{ fontSize: 13, color: T.faint }}>No sizes on this item yet.</div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {sizes.map(sz => (
                          <label key={it.id + "_" + sz} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>{sz}</span>
                            <input type="text" inputMode="numeric" defaultValue={String(it.qtys?.[sz] ?? 0)} readOnly={locked}
                              onFocus={e => e.target.select()}
                              onBlur={e => saveQty(it, sz, e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              style={{ width: 56, textAlign: "center", padding: "7px 6px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                          </label>
                        ))}
                        <label style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>TOTAL</span>
                          <div style={{ width: 64, textAlign: "center", padding: "7px 6px", fontSize: 15, fontWeight: 800, fontFamily: mono }}>{qtyOf(it).toLocaleString()}</div>
                        </label>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 22, marginTop: 14, fontSize: 12.5, color: T.muted }}>
                      <span>Garment <b style={{ color: T.text }}>{it.garment_type || "—"}</b></span>
                      <span>Blank <b style={{ color: T.text }}>{`${it.blank_vendor || ""} ${it.blank_sku || ""}`.trim() || "—"}</b></span>
                    </div>
                    <div style={{ fontSize: 11, color: locked ? T.amber : T.faint, marginTop: 12 }}>
                      {locked ? "🔒 Pricing is locked — unlock in Costing to change quantities." : "Saves to the buy sheet (the single source). Totals update live."}
                    </div>
                  </div>
                );
              })()}
              {wsTask === "cost" && (() => {
                const r: any = calcFor(it);
                const cp = decoState[it.id] || cpFor(it) || {};  // overlay so override/deco edits show live
                const overridden = cp.sellOverride != null && cp.sellOverride !== "";
                // Revenue/sell = items.sell_per_unit (the INVOICE truth), so this tab
                // can never disagree with the client's bill. The engine (r) supplies
                // only the COST components; profit/margin derive from the two.
                const q = qtyOf(it);
                const sell = Number(it.sell_per_unit) || 0;
                const grossRev = Math.round(sell * q * 100) / 100;
                const ccFees = inclCC ? Math.round(grossRev * 0.03 * 100) / 100 : 0;
                const totalCost = r ? Math.round(((r.blankCost || 0) + (r.poTotal || 0) + (r.shipping || 0) + ccFees) * 100) / 100 : 0;
                const netProfit = Math.round((grossRev - totalCost) * 100) / 100;
                const marginPct = grossRev > 0 ? netProfit / grossRev : 0;
                const marginColor = marginPct >= 0.30 ? T.green : marginPct >= 0.20 ? T.amber : T.red;
                return (
                  <div>
                    {!Object.keys(printers).length ? (
                      <div style={{ fontSize: 13, color: T.faint, padding: "20px 0" }}>Loading decorator pricing…</div>
                    ) : !r ? (
                      <div style={{ fontSize: 13, color: T.faint, padding: "20px 0" }}>No quantities yet — set them in Build.</div>
                    ) : (
                      <>
                        {/* revenue from the invoice truth; cost from the assembler + shared engine */}
                        {[["Revenue", fmtMoney(grossRev), T.text],
                          ["Blank cost", fmtMoney(r.blankCost), T.muted],
                          ["Decoration / PO", fmtMoney(r.poTotal), T.muted],
                          ...(inclShip ? [["Shipping (buffer)", fmtMoney(r.shipping), T.muted]] : []),
                          ...(inclCC ? [["CC fees", fmtMoney(ccFees), T.muted]] : []),
                          ["Net profit", fmtMoney(netProfit), marginColor],
                          ["Margin", (marginPct * 100).toFixed(1) + "%", marginColor]].map(([l, v, c]: any) => (
                          <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.border}44`, fontSize: 13 }}>
                            <span style={{ color: T.muted }}>{l}</span><span style={{ fontWeight: 700, fontFamily: mono, color: c }}>{v}</span>
                          </div>
                        ))}
                        {/* sell / unit — the invoice truth (items.sell_per_unit) */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0 8px", marginTop: 4, borderTop: `1px solid ${T.border}` }}>
                          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: T.text }}>Sell / unit {overridden && <span style={{ color: T.amber, fontWeight: 700, marginLeft: 6 }}>· override</span>}</span>
                          <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 800 }}>${sell.toFixed(2)}</span>
                        </div>

                        {/* decoration engine — the real DecorationPanel, fed the full assembled
                            array so share groups (A–J / T1–T10) + qty tiers compute across items. */}
                        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}44` }}>
                          <div style={{ ...lbl, marginBottom: 10 }}>Decoration</div>
                          <DecorationPanel p={allAssembled[wsIndex!]} i={wsIndex!} costProds={allAssembled} PRINTERS={printers} decoratorRecords={decoratorRecords} updateProd={updateProd} setCostProds={setCostProdsFn} lookupPrintPrice={lookupPrint} lookupTagPrice={lookupTag} costingLocked={locked} />
                        </div>

                        {/* raw blank-cost editor — the one thing you edit here (writes items only) */}
                        <label style={{ display: "block", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}44` }}>
                          <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Blank cost / unit (raw — buffer applied in calc)</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 13, color: T.faint }}>$</span>
                            <input key={it.id + ":bcu:" + (it.cost_per_unit ?? "")} defaultValue={it.cost_per_unit != null ? Number(it.cost_per_unit).toFixed(2) : ""} placeholder="0.00" inputMode="decimal" readOnly={locked}
                              onBlur={e => saveBlankPerUnit(it, e.target.value)}
                              style={{ flex: 1, padding: "9px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                          </div>
                        </label>
                        <div style={{ fontSize: 11, color: locked ? T.amber : T.faint, marginTop: 10 }}>
                          {locked ? "🔒 Locked — unlock in Costing to change the blank cost." : "Spreads across all sizes → items.blank_costs; sell recomputes and saves."}
                        </div>

                        {/* sell override — the invoice-truth manual control */}
                        <label style={{ display: "block", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}44` }}>
                          <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Sell override / unit <span style={{ color: T.faint, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· blank = auto from margin</span></span>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 13, color: T.faint }}>$</span>
                            <input key={it.id + ":ovr:" + (cp.sellOverride ?? "")} defaultValue={cp.sellOverride != null && cp.sellOverride !== "" ? Number(cp.sellOverride).toFixed(2) : ""} placeholder={"auto · $" + sell.toFixed(2)} inputMode="decimal" readOnly={locked}
                              onBlur={e => saveOverride(it, e.target.value)}
                              style={{ flex: 1, padding: "9px 11px", borderRadius: 8, border: `1px solid ${overridden ? T.amber + "88" : T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                          </div>
                        </label>
                        <div style={{ fontSize: 11, color: T.faint, marginTop: 10 }}>
                          {overridden ? "Manual price — clear the field to return to the auto (margin) price. This is the invoice truth." : "Auto price from cost + margin. Type a value to override; it becomes the invoice truth."}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
              {wsTask === "art" && (() => {
                const files = filesByItem[it.id] || [];
                const art = it.artwork_status || "not_started";
                const artColor = art === "approved" ? T.green : art === "revision_requested" ? T.amber : T.muted;
                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={lbl}>Files · {files.length}</span>
                      <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: artColor }}>{art.replace(/_/g, " ")}</span>
                    </div>
                    {files.length === 0 ? (
                      <div style={{ fontSize: 13, color: T.faint, padding: "16px 0" }}>No files on this item yet.</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 10 }}>
                        {files.map((f: any) => {
                          const ap = f.approval === "approved" ? T.green : f.approval === "revision_requested" ? T.amber : T.faint;
                          return (
                            <a key={f.drive_file_id + f.file_name} href={thumbSrc(f.drive_file_id, true)} target="_blank" rel="noreferrer" title={f.file_name} style={{ textDecoration: "none" }}>
                              <div style={{ aspectRatio: "1 / 1", background: "#fff", borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${T.border}` }}>
                                <img src={thumbSrc(f.drive_file_id)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                              </div>
                              <div style={{ fontSize: 10, color: T.muted, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</div>
                              <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: ap }}>{(f.stage || "").replace(/_/g, " ")}{f.approval === "approved" ? " ✓" : ""}</div>
                            </a>
                          );
                        })}
                      </div>
                    )}
                    {/* upload — per stage */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}44`, flexWrap: "wrap" }}>
                      <select value={uploadStage} onChange={e => setUploadStage(e.target.value)}
                        style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12.5, fontFamily: font, outline: "none" }}>
                        <option value="client_art">Client art</option>
                        <option value="vector">Vector</option>
                        <option value="mockup">Mockup</option>
                        <option value="proof">Proof</option>
                        <option value="print_ready">Print-ready</option>
                      </select>
                      <label style={{ ...previewBtn, cursor: uploadingItem === it.id ? "default" : "pointer", opacity: uploadingItem === it.id ? 0.6 : 1 }}>
                        {uploadingItem === it.id ? "Uploading…" : "+ Upload file"}
                        <input type="file" style={{ display: "none" }} disabled={uploadingItem === it.id}
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadArt(it, uploadStage, f); e.currentTarget.value = ""; }} />
                      </label>
                    </div>
                    <div style={{ fontSize: 11, color: T.faint, marginTop: 12 }}>Files open full-size in a new tab. Proofs are sent &amp; approved in the Client section.</div>
                  </div>
                );
              })()}
              <div style={{ fontSize: 11, color: T.faint, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}55` }}>Flip between items with ‹ › or ← →.</div>
            </div>
          </div>
        </div>
      )}

      {/* ── client transaction modal (send quote/proofs · send invoice · record payment) ── */}
      {clientAction && (
        <div onClick={e => { if (e.target === e.currentTarget && !actBusy) setClientAction(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 320, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, width: "100%", maxWidth: 420, padding: "20px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginBottom: 14 }}>
              {clientAction === "quote" ? (job.quote_approved ? "Send proofs" : "Send quote & proofs") : clientAction === "invoice" ? "Send invoice" : "Record payment"}
            </div>
            {clientAction === "payment" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <select value={payForm.type} onChange={e => setPayForm(f => ({ ...f, type: e.target.value }))} style={field}>
                  <option value="full_payment">Full payment</option>
                  <option value="deposit">Deposit</option>
                  <option value="balance">Balance</option>
                </select>
                <input value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} placeholder="Amount" inputMode="decimal" style={field} />
                <input type="date" value={payForm.paid_date} onChange={e => setPayForm(f => ({ ...f, paid_date: e.target.value }))} style={field} />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ ...lbl, marginBottom: 4 }}>Recipients</div>
                {flatContacts.length === 0 ? <div style={{ fontSize: 13, color: T.faint }}>No contacts with an email on this job.</div> :
                  flatContacts.map((c: any) => (
                    <label key={c.email} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.text, padding: "4px 0" }}>
                      <input type="checkbox" checked={!!recips[c.email]} onChange={() => setRecips(r => ({ ...r, [c.email]: !r[c.email] }))} style={{ accentColor: T.accent }} />
                      <span>{c.name || c.email}<span style={{ color: T.faint }}> · {c.email}{c.role_on_job ? " · " + c.role_on_job : ""}</span></span>
                    </label>
                  ))}
              </div>
            )}
            {actErr && <div style={{ color: T.red, fontSize: 12, marginTop: 10 }}>{actErr}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button disabled={actBusy} onClick={clientAction === "payment" ? doRecordPayment : clientAction === "invoice" ? doSendInvoice : doSendQuote}
                style={{ ...actBtn, opacity: actBusy ? 0.6 : 1 }}>{actBusy ? "Working…" : clientAction === "payment" ? "Record payment" : "Send"}</button>
              <button disabled={actBusy} onClick={() => setClientAction(null)} style={ghostBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 36, height: 36, borderRadius: 999, border: "none", background: "rgba(255,255,255,0.08)", color: T.text, fontSize: 20, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

function WsRows({ rows }: { rows: any[] }) {
  return (
    <div>
      {rows.map(([l, v], i) => (
        <div key={l + i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${T.border}44`, fontSize: 13 }}>
          <span style={{ color: l.startsWith("  ") ? T.faint : T.muted, fontFamily: l.startsWith("  ") ? mono : font, paddingLeft: l.startsWith("  ") ? 8 : 0 }}>{l.trim()}</span>
          <span style={{ fontWeight: 700, fontFamily: mono }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
