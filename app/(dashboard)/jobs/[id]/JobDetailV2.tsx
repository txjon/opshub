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
import { calcCostProduct, buildPrintersMap, lookupPrintPrice as sharedLookupPrintPrice, lookupTagPrice as sharedLookupTagPrice, effectiveShipRate } from "@/lib/pricing";
import { DecorationPanel as DecorationPanelRaw } from "./DecorationPanel";
import { sendQuoteAndProofs, defaultRecipient } from "@/lib/job/quote-actions";
import { pushInvoiceToQB, recordPayment } from "@/lib/job/invoice-actions";
import { applyPoSentToVendorItems } from "@/lib/po-actions";
const DecorationPanel: any = DecorationPanelRaw; // .jsx — bypass narrow inferred prop types

const fmtMoney = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const fmtDT = (iso: string) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
// thumbByItem holds a Drive file_id (not a URL) — build the thumbnail endpoint URL.
const thumbSrc = (id: string, full = false) => id ? `/api/files/thumbnail?id=${id}${full ? "" : "&thumb=1"}` : "";
// Stack an address into mailing-label lines: name / street+suite / city, ST ZIP.
// Respects existing newlines; also splits a one-line comma address on the trailing "ST ZIP".
const addrLines = (addr: string): string[] => {
  if (!addr) return [];
  const out: string[] = [];
  for (let raw of (addr.includes("\n") ? addr.split("\n") : [addr])) {
    raw = raw.trim(); if (!raw) continue;
    const parts = raw.split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3 && /^[A-Za-z]{2}\s+\d{5}/.test(parts[parts.length - 1])) {
      const stateZip = parts.pop(); const city = parts.pop();
      out.push(parts.join(", ")); out.push(`${city}, ${stateZip}`);
    } else out.push(raw);
  }
  return out;
};
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
// Minimal add-product options (manual entry; full catalog pickers stay in the Studio/classic).
const ADD_SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "OSFA"];
const ADD_GARMENTS: [string, string][] = [["tee", "Tee"], ["longsleeve", "Long sleeve"], ["hoodie", "Hoodie"], ["crewneck", "Crewneck"], ["hat", "Hat"], ["beanie", "Beanie"], ["tote", "Tote"], ["shorts", "Shorts"], ["jacket", "Jacket"]];

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

  // Tenant warehouse address (ship-to for ship_through/stage routes).
  const [warehouseAddr, setWarehouseAddr] = useState("");
  useEffect(() => {
    if (!job?.company_id) return;
    createClient().from("companies").select("name, warehouse_address").eq("id", job.company_id).single().then(({ data }: any) => {
      if (data?.warehouse_address) setWarehouseAddr((data.name ? data.name + "\n" : "") + data.warehouse_address);
    });
  }, [job?.company_id]);

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
  const [poVendor, setPoVendor] = useState<string | null>(null);
  const [poShipDate, setPoShipDate] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newProd, setNewProd] = useState<{ name: string; garment_type: string; blank_vendor: string; blank_sku: string; cost: string; qtys: Record<string, string> }>({ name: "", garment_type: "tee", blank_vendor: "", blank_sku: "", cost: "", qtys: {} });

  // Save a single size's qty to buy_sheet_lines (the qty source of truth) and
  // reflect it locally. Blur-triggered, so flipping items never loses an edit.
  const saveQty = async (item: any, size: string, raw: string) => {
    if (isCostingLocked(job)) return;
    const q = parseInt(raw) || 0;
    if (q === Number(item.qtys?.[size] ?? 0)) return; // unchanged
    const newQtys = { ...(item.qtys || {}), [size]: q };
    const updated = { ...item, qtys: newQtys, totalQty: sumQ(newQtys) };
    // qty crosses decoration qty-tiers → recompute + persist sell through the same
    // engine (respects an override) so the stored price never lags the qty.
    const sell = Object.keys(printers).length ? (() => {
      try { const r: any = calcCostProduct(assemble(updated), costMargin, inclShip, inclCC, items.map(x => x.id === item.id ? assemble(updated) : assemble(x)), printers); return r ? Math.round((r.sellPerUnit || 0) * 100) / 100 : null; } catch { return null; }
    })() : null;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: newQtys, totalQty: sumQ(newQtys), ...(sell != null ? { sell_per_unit: sell } : {}) } : x));
    try {
      await (createClient().from("buy_sheet_lines") as any).upsert({ item_id: item.id, size, qty_ordered: q }, { onConflict: "item_id,size" });
      if (sell != null) await (createClient().from("items") as any).update({ sell_per_unit: sell }).eq("id", item.id);
    } catch (e) { console.error("[JobV2] qty save failed", e); }
  };

  // Build-tab edits: rename, add/remove a size, remove the product from the job.
  const renameItem = async (item: any, name: string) => {
    const n = name.trim(); if (!n || n === item.name) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, name: n } : x));
    try { await (createClient().from("items") as any).update({ name: n }).eq("id", item.id); } catch (e) { console.error("[JobV2] rename failed", e); }
  };
  const saveItemField = async (item: any, fieldK: "garment_type" | "blank_vendor" | "blank_sku", value: string) => {
    const v = (value || "").trim() || null;
    if (v === (item[fieldK] ?? null)) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, [fieldK]: v } : x));
    try { await (createClient().from("items") as any).update({ [fieldK]: v }).eq("id", item.id); } catch (e) { console.error("[JobV2] item field save failed", e); }
  };
  const addSize = async (item: any, sz: string) => {
    if (item.qtys && sz in item.qtys) return;
    const newQtys = { ...(item.qtys || {}), [sz]: 0 };
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: newQtys, totalQty: sumQ(newQtys) } : x));
    try { await (createClient().from("buy_sheet_lines") as any).upsert({ item_id: item.id, size: sz, qty_ordered: 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }, { onConflict: "item_id,size" }); } catch (e) { console.error("[JobV2] addSize failed", e); }
  };
  const removeSize = async (item: any, sz: string) => {
    const newQtys = { ...(item.qtys || {}) }; delete newQtys[sz];
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: newQtys, totalQty: sumQ(newQtys) } : x));
    try { await createClient().from("buy_sheet_lines").delete().eq("item_id", item.id).eq("size", sz); } catch (e) { console.error("[JobV2] removeSize failed", e); }
  };
  const saveRoute = async (route: string) => {
    if (route === (job.shipping_route || "")) return;
    setJob((j: any) => ({ ...j, shipping_route: route }));
    try {
      await (createClient().from("jobs") as any).update({ shipping_route: route }).eq("id", job.id);
      logJobActivity(job.id, `Shipping route set to ${ROUTE_LABEL[route] || route}`);
    } catch (e) { console.error("[JobV2] route save failed", e); }
  };
  const removeProduct = async (item: any) => {
    if (!window.confirm(`Remove "${item.name}" from this job? This deletes the product and its files.`)) return;
    const supabase = createClient();
    try {
      await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id);
      await supabase.from("item_files").delete().eq("item_id", item.id);
      await supabase.from("decorator_assignments").delete().eq("item_id", item.id);
      await supabase.from("items").delete().eq("id", item.id);
      setItems(prev => prev.filter(x => x.id !== item.id));
      setWsIndex(null);
      try { logJobActivity(job.id, `Product removed: ${item.name}`); } catch {}
    } catch (e) { console.error("[JobV2] remove product failed", e); }
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
      if (e.key === "ArrowLeft") setWsIndex(i => i === null || !items.length ? i : (i - 1 + items.length) % items.length);
      if (e.key === "ArrowRight") setWsIndex(i => i === null || !items.length ? i : (i + 1) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wsIndex, items.length]);

  const client = job?.clients?.name || "";
  const units = items.reduce((a: number, it: any) => a + qtyOf(it), 0);
  const orderTotal = items.reduce((a: number, it: any) => a + (Number(it.sell_per_unit) || 0) * qtyOf(it), 0);
  const tm = job?.type_meta || {};
  // invoiced total incl. tax (QB or Stripe). invoicedSub = pre-tax, to compare
  // against orderTotal (also pre-tax) for the "order grew" delta.
  const invoiced = Number(tm.qb_total_with_tax) || (Number(tm.stripe_total_cents) ? Number(tm.stripe_total_cents) / 100 : 0);
  const invoicedSub = Math.max(0, invoiced - (Number(tm.qb_tax_amount) || 0));
  const invNum = tm.qb_invoice_number || tm.stripe_invoice_number || "";
  const paid = payments.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
  const toInvoice = Math.round((orderTotal - invoicedSub) * 100) / 100;
  const route = job?.shipping_route || "";
  // Ship-to resolves by route: drop_ship → client; ship_through/stage → HPD
  // warehouse (goods land with us first). Per-vendor defaults can still route
  // individual vendors to HPD on a drop_ship job — the PO handles that per vendor.
  const clientAddr = tm.venue_address || job?.clients?.shipping_address || "";
  const address = route === "drop_ship" ? clientAddr : (route ? (warehouseAddr || "HPD warehouse") : clientAddr);
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
    if (actBusy) return; setActBusy(true);
    try {
      const now = new Date().toISOString();
      await (createClient().from("jobs") as any).update({ quote_approved: true, quote_approved_at: now }).eq("id", job.id);
      setJob((j: any) => ({ ...j, quote_approved: true, quote_approved_at: now }));
      try { logJobActivity(job.id, "Quote approved (internal)"); } catch {}
    } finally { setActBusy(false); }
  };
  const doRevoke = async () => {
    if (actBusy) return; setActBusy(true);
    try {
      await (createClient().from("jobs") as any).update({ quote_approved: false, quote_approved_at: null }).eq("id", job.id);
      setJob((j: any) => ({ ...j, quote_approved: false, quote_approved_at: null }));
      try { logJobActivity(job.id, "Quote approval revoked"); } catch {}
    } finally { setActBusy(false); }
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

  // Create a product on this job (minimal manual entry) → items + buy_sheet_lines.
  const createProduct = async () => {
    if (!newProd.name.trim()) { setActErr("Name is required."); return; }
    setActBusy(true); setActErr("");
    try {
      const cost = parseFloat(String(newProd.cost).replace(/[^0-9.]/g, "")) || 0;
      const sizes = Object.entries(newProd.qtys).filter(([, q]) => (parseInt(q) || 0) > 0);
      const blank_costs = Object.fromEntries(sizes.map(([sz]) => [sz, cost]));
      const supabase = createClient();
      const maxSort = items.reduce((m, it: any) => Math.max(m, Number(it.sort_order) || 0), 0);
      const { data: item, error }: any = await (supabase.from("items") as any).insert({
        job_id: job.id, name: newProd.name.trim(), blank_vendor: newProd.blank_vendor.trim() || null, blank_sku: newProd.blank_sku.trim() || null,
        garment_type: newProd.garment_type, blank_costs: sizes.length ? blank_costs : null, cost_per_unit: cost || null,
        sort_order: maxSort + 10, status: "tbd", artwork_status: "not_started",
      }).select("*").single();
      if (error) throw new Error(error.message);
      if (sizes.length) await (supabase.from("buy_sheet_lines") as any).insert(sizes.map(([size, q]) => ({ item_id: item.id, size, qty_ordered: parseInt(q) || 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 })));
      const qtys = Object.fromEntries(sizes.map(([sz, q]) => [sz, parseInt(q) || 0]));
      setItems(prev => [...prev, { ...item, qtys, totalQty: sumQ(qtys), blankCosts: blank_costs }]);
      try { logJobActivity(job.id, `Product added: ${newProd.name.trim()}`); } catch {}
      setNewProd({ name: "", garment_type: "tee", blank_vendor: "", blank_sku: "", cost: "", qtys: {} });
      setAddOpen(false);
    } catch (e: any) { setActErr(e.message || "Failed to add product."); } finally { setActBusy(false); }
  };

  // ── PO send (per vendor) — reuses the working classic flow: email the per-vendor
  // PO PDF, then applyPoSentToVendorItems (advance items → in_production + sent
  // date), and record the vendor in type_meta.po_sent_vendors. ──
  const decFor = (vendor: string) => decoratorRecords.find((d: any) => d.name === vendor || d.short_code === vendor);
  const openPoSend = (vendor: string) => {
    const cl = decFor(vendor)?.contacts_list || [];
    const sel: Record<string, boolean> = {};
    cl.forEach((c: any) => { if (c.email) sel[c.email] = true; });
    setRecips(sel);
    setPoShipDate((job.type_meta?.po_ship_dates || {})[vendor] || "");
    setActErr(""); setPoVendor(vendor);
  };
  const doSendPO = async () => {
    if (!poVendor) return;
    const cl = decFor(poVendor)?.contacts_list || [];
    const emails = cl.filter((c: any) => c.email && recips[c.email]).map((c: any) => c.email);
    if (!emails.length) { setActErr("Select a recipient (or add contacts on the decorator)."); return; }
    if (!poShipDate) { setActErr("Set a ship date."); return; }
    setActBusy(true); setActErr("");
    try {
      const supabase = createClient();
      const [to, ...cc] = emails;
      const alreadySent = ((job.type_meta?.po_sent_vendors) || []).includes(poVendor);
      const meta = { ...(job.type_meta || {}), po_ship_dates: { ...(job.type_meta?.po_ship_dates || {}), [poVendor]: poShipDate } };
      await (supabase.from("jobs") as any).update({ type_meta: meta }).eq("id", job.id);
      const r = await fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "po", jobId: job.id, vendor: poVendor, recipientEmail: to, ccEmails: cc, revised: alreadySent }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "PO email failed");
      await applyPoSentToVendorItems(supabase, job.id, poVendor);
      const sentVendors = Array.from(new Set([...(job.type_meta?.po_sent_vendors || []), poVendor]));
      const meta2 = { ...meta, po_sent_vendors: sentVendors, po_sent_dates: { ...(job.type_meta?.po_sent_dates || {}), [poVendor]: new Date().toISOString().slice(0, 10) } };
      await (supabase.from("jobs") as any).update({ type_meta: meta2 }).eq("id", job.id);
      setJob((j: any) => ({ ...j, type_meta: { ...j.type_meta, ...meta2 } }));
      setItems(prev => prev.map(x => (cpFor(x)?.printVendor || x.decorator || "Unassigned") === poVendor && x.pipeline_stage !== "shipped" ? { ...x, pipeline_stage: "in_production" } : x));
      setPoVendor(null);
    } catch (e: any) { setActErr(e.message || "Send failed"); } finally { setActBusy(false); }
  };

  // ── spine ──
  const phase = job?.phase || "intake";
  const beyond = (p: string, list: string[]) => list.includes(p);
  const flags = {
    quoted: !!tm.quote_sent_at,
    approved: !!job?.quote_approved,
    invoiced: !!invNum,
    grew: invoicedSub > 0 && toInvoice > 0.5,
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
        // Apply ONLY decoration fields from p; keep the DB's qtys/blankCosts/name
        // (those are owned by buy_sheet_lines / items — don't let a deco edit touch them).
        if (idx >= 0) cps[idx] = { ...cps[idx], ...p, qtys: cps[idx].qtys ?? p.qtys, blankCosts: cps[idx].blankCosts ?? p.blankCosts, name: cps[idx].name ?? p.name };
        else cps.push(p);
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
  // Per-item shipping buffer override (costProd.shipRate) — rides the same deco
  // overlay + flush (which recomputes sell). Blank = auto by garment type.
  const saveShipRate = (item: any, raw: string) => {
    if (isCostingLocked(job)) return;
    const v = raw === "" ? null : (parseFloat(String(raw).replace(/[^0-9.]/g, "")) || 0);
    const next: any = { ...assemble(item) };
    if (v == null) delete next.shipRate; else next.shipRate = v;
    setDecoState(s => ({ ...s, [item.id]: next }));
    schedulePersist(item, next);
  };
  // Job-level margin / shipping / CC change → recompute + persist EVERY item's
  // sell through the shared engine (respects per-item overrides), + costing_data.
  const recomputeAllSells = async (patch: { costMargin?: string; inclShip?: boolean; inclCC?: boolean }) => {
    if (isCostingLocked(job)) return;
    const nextMargin = patch.costMargin ?? costMargin;
    const nextInclShip = patch.inclShip ?? inclShip;
    const nextInclCC = patch.inclCC ?? inclCC;
    setJob((j: any) => ({ ...j, costing_data: { ...(j.costing_data || {}), costMargin: nextMargin, inclShip: nextInclShip, inclCC: nextInclCC } }));
    const supabase = createClient();
    const sells: Record<string, number> = {};
    if (Object.keys(printers).length) {
      const allA = items.map(assemble);
      items.forEach((it: any) => { try { const r: any = calcCostProduct(assemble(it), nextMargin, nextInclShip, nextInclCC, allA, printers); if (r) sells[it.id] = Math.round((r.sellPerUnit || 0) * 100) / 100; } catch {} });
    }
    if (Object.keys(sells).length) setItems(prev => prev.map(x => sells[x.id] != null ? { ...x, sell_per_unit: sells[x.id] } : x));
    try {
      const { data: fresh }: any = await supabase.from("jobs").select("costing_data").eq("id", job.id).single();
      const cd = { ...(fresh?.costing_data || job.costing_data || {}), costMargin: nextMargin, inclShip: nextInclShip, inclCC: nextInclCC };
      await (supabase.from("jobs") as any).update({ costing_data: cd }).eq("id", job.id);
      for (const [id, sell] of Object.entries(sells)) await (supabase.from("items") as any).update({ sell_per_unit: sell }).eq("id", id);
    } catch (e) { console.error("[JobV2] recompute-all failed", e); }
  };
  const toggleUnlock = async () => {
    const unlocked = !job?.type_meta?.costing_unlocked;
    const meta = { ...(job.type_meta || {}), costing_unlocked: unlocked };
    setJob((j: any) => ({ ...j, type_meta: meta }));
    try { await (createClient().from("jobs") as any).update({ type_meta: meta }).eq("id", job.id); logJobActivity(job.id, unlocked ? "Costing unlocked to revise" : "Costing re-locked"); } catch (e) { console.error(e); }
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
        <div style={{ minWidth: 200, flex: 1, cursor: "pointer" }} onClick={() => { setOpen(o => ({ ...o, logistics: true })); const el = document.getElementById("logistics"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }} title="Edit route in Logistics">
          <div style={lbl}>Ship-to · {ROUTE_LABEL[route] || route || "route not set"} <span style={{ color: T.faint, fontWeight: 500 }}>· edit ›</span></div>
          <div style={{ fontSize: 13, color: address ? T.text : T.faint, marginTop: 4, lineHeight: 1.35 }}>
            {address ? addrLines(address).map((l, i) => <div key={i}>{l}</div>) : "No address set"}
          </div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>{ROUTE_SUB[route] || ""}</div>
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
          {/* job-level costing controls + project totals */}
          {(() => {
            let rev = 0, blank = 0, po = 0, ship = 0;
            items.forEach((it: any) => { const r: any = calcFor(it); const q = qtyOf(it); rev += (Number(it.sell_per_unit) || 0) * q; if (r) { blank += r.blankCost || 0; po += r.poTotal || 0; ship += r.shipping || 0; } });
            const cc = inclCC ? rev * 0.03 : 0;
            const cost = blank + po + ship + cc;
            const profit = rev - cost;
            const margin = rev > 0 ? profit / rev : 0;
            const marginColor = margin >= 0.30 ? T.green : margin >= 0.20 ? T.amber : T.red;
            const actualBlanks = items.reduce((a: number, it: any) => a + (Number(it.blanks_order_cost) || 0), 0);
            const isCommitted = !!(job.quote_approved || job.type_meta?.quote_sent_at);
            const tog = (on: boolean, label: string, onClick: () => void) => (
              <button onClick={() => !locked && onClick()} disabled={locked} style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: locked ? "default" : "pointer", fontFamily: font, opacity: locked ? 0.6 : 1 }}>
                <span style={{ width: 30, height: 17, borderRadius: 9, background: on ? T.accent : T.card, border: `1px solid ${on ? T.accent : T.border}`, position: "relative" }}><span style={{ position: "absolute", top: 2, left: on ? 14 : 2, width: 11, height: 11, borderRadius: "50%", background: on ? T.bg : "#fff" }} /></span>
                <span style={{ fontSize: 12, color: T.muted }}>{label}</span>
              </button>
            );
            return (
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={lbl}>Margin</span>
                    <div style={{ display: "flex", gap: 2, background: T.card, borderRadius: 6, padding: 2 }}>
                      {["10%", "15%", "20%", "25%", "30%"].map(m => (
                        <button key={m} onClick={() => !locked && recomputeAllSells({ costMargin: m })} disabled={locked}
                          style={{ background: costMargin === m ? T.amber : "transparent", color: costMargin === m ? "#0a0a0a" : T.muted, border: "none", borderRadius: 4, padding: "3px 8px", fontSize: 11, fontFamily: mono, cursor: locked ? "default" : "pointer" }}>{m}</button>
                      ))}
                    </div>
                  </div>
                  {tog(inclShip, "Shipping", () => recomputeAllSells({ inclShip: !inclShip }))}
                  {tog(inclCC, "CC fees", () => recomputeAllSells({ inclCC: !inclCC }))}
                  <div style={{ flex: 1 }} />
                  {isCommitted && (
                    <button onClick={toggleUnlock} style={{ fontSize: 11, fontWeight: 800, padding: "6px 13px", borderRadius: 999, border: `1px solid ${locked ? T.border : T.amber}`, background: locked ? T.card : T.amber, color: locked ? T.text : "#0a0a0a", cursor: "pointer", fontFamily: font }}>{locked ? "🔒 Unlock to revise" : "Re-lock"}</button>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  {([["Revenue", fmtMoney(rev), T.text], ["Blanks", fmtMoney(blank), T.muted], ["Decoration", fmtMoney(po), T.muted], ...(inclShip ? [["Shipping", fmtMoney(ship), T.muted]] : []), ...(inclCC ? [["CC", fmtMoney(cc), T.muted]] : []), ["Net profit", fmtMoney(profit), marginColor], ["Margin", (margin * 100).toFixed(1) + "%", marginColor], ...(actualBlanks > 0 ? [["Actual blanks", fmtMoney(actualBlanks), actualBlanks > blank ? T.red : T.green]] : [])] as any[]).map(([l, v, c]: any, i: number, arr: any[]) => (
                    <div key={l} style={{ flex: "1 1 auto", minWidth: 74, paddingRight: 12, marginRight: 12, borderRight: i < arr.length - 1 ? `1px solid ${T.border}44` : "none" }}>
                      <div style={lbl}>{l}</div>
                      <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 800, color: c, marginTop: 3 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
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
            {!locked && (
              <button onClick={() => { setActErr(""); setAddOpen(true); }}
                style={{ border: `1px dashed ${T.border}`, borderRadius: 14, background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: T.faint, fontSize: 12, fontWeight: 700, minHeight: 120, cursor: "pointer", fontFamily: font }}>
                <span style={{ fontSize: 26, fontWeight: 300, lineHeight: 1 }}>+</span>Add product
              </button>
            )}
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
              ? <button onClick={doRevoke} disabled={actBusy} style={ghostBtn}>Approved ✓ · revoke</button>
              : <button onClick={doApprove} disabled={actBusy} style={ghostBtn}>Mark approved</button>}
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
                    <button onClick={() => openPoSend(vendor)} style={sent ? ghostBtn : actBtn}>{sent ? "Re-send PO" : "Send PO"}</button>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.border}55`, fontSize: 13, gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: T.muted }}>Shipping route</span>
            <select value={route || ""} onChange={e => saveRoute(e.target.value)} style={{ ...field, width: "auto", minWidth: 260 }}>
              <option value="">— set route —</option>
              <option value="drop_ship">Drop ship · vendor → client</option>
              <option value="ship_through">Ship-through · → HPD → client</option>
              <option value="stage">Stage · → HPD → fulfillment</option>
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 13 }}>
            <span style={{ color: T.muted }}>Vendor ships to</span><span style={{ fontWeight: 700, textAlign: "right", maxWidth: "60%", lineHeight: 1.35 }}>{address ? addrLines(address).map((l, i) => <div key={i}>{l}</div>) : "—"}</span>
          </div>
          {(route === "ship_through" || route === "stage") && clientAddr && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 13, borderTop: `1px solid ${T.border}44` }}>
              <span style={{ color: T.muted }}>Final destination (client)</span><span style={{ fontWeight: 700, textAlign: "right", maxWidth: "60%", lineHeight: 1.35 }}>{clientAddr ? addrLines(clientAddr).map((l, i) => <div key={i}>{l}</div>) : "—"}</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: T.faint, marginTop: 6 }}>
            {route === "drop_ship" ? "Vendor ships direct to the client — but vendors with a default route to HPD still land with us (set per decorator)." : route ? "Goods land at HPD first, then ship to the client." : "Set the route to determine the ship-to and post-decorator flow."}
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
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, width: "100%", maxWidth: 820, overflow: "hidden" }}>
            {/* nav strip */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}55` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setWsIndex((wsIndex! - 1 + items.length) % items.length)} aria-label="Previous item" style={navBtn}>‹</button>
                <button onClick={() => setWsIndex((wsIndex! + 1) % items.length)} aria-label="Next item" style={navBtn}>›</button>
                <span style={{ fontFamily: mono, fontSize: 12, color: T.faint, marginLeft: 6 }}>{wsIndex! + 1} / {items.length}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!locked && <button onClick={() => removeProduct(it)} title="Remove product from job" style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 999, color: T.muted, fontSize: 11, fontWeight: 700, padding: "6px 12px", cursor: "pointer", fontFamily: font }}>Remove</button>}
                <button onClick={() => setWsIndex(null)} aria-label="Close" style={{ ...navBtn, background: T.surface }}>×</button>
              </div>
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
                const avail = ADD_SIZES.filter(s => !(it.qtys && s in it.qtys));
                return (
                  <div>
                    {/* name */}
                    <label style={{ display: "block", marginBottom: 12 }}>
                      <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Product name</span>
                      <input key={it.id + ":name:" + it.name} defaultValue={it.name || ""} readOnly={locked} onBlur={e => renameItem(it, e.target.value)} style={field} />
                    </label>
                    {/* garment + blank (editable text; full catalog picker is separate) */}
                    <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                      <label style={{ flex: "1 1 130px" }}>
                        <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Garment type</span>
                        <select value={it.garment_type || "tee"} disabled={locked} onChange={e => saveItemField(it, "garment_type", e.target.value)} style={field}>
                          {ADD_GARMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          {it.garment_type && !ADD_GARMENTS.some(([v]) => v === it.garment_type) && <option value={it.garment_type}>{it.garment_type}</option>}
                        </select>
                      </label>
                      <label style={{ flex: "1 1 130px" }}>
                        <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Blank</span>
                        <input key={it.id + ":bv:" + it.blank_vendor} defaultValue={it.blank_vendor || ""} readOnly={locked} onBlur={e => saveItemField(it, "blank_vendor", e.target.value)} placeholder="e.g. Next Level 6210" style={field} />
                      </label>
                      <label style={{ flex: "1 1 110px" }}>
                        <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Color</span>
                        <input key={it.id + ":bs:" + it.blank_sku} defaultValue={it.blank_sku || ""} readOnly={locked} onBlur={e => saveItemField(it, "blank_sku", e.target.value)} placeholder="Color" style={field} />
                      </label>
                    </div>
                    {/* sizes + qty with remove + add */}
                    <div style={{ ...lbl, marginBottom: 6 }}>Sizes &amp; quantities</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                      {sizes.map(sz => (
                        <div key={it.id + "_" + sz + ":" + (it.qtys?.[sz] ?? "")} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", position: "relative" }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>{sz}</span>
                          <input type="text" inputMode="numeric" defaultValue={String(it.qtys?.[sz] ?? 0)} readOnly={locked}
                            onFocus={e => e.target.select()} onBlur={e => saveQty(it, sz, e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            style={{ width: 56, textAlign: "center", padding: "7px 6px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                          {!locked && <button onClick={() => removeSize(it, sz)} title="Remove size" style={{ position: "absolute", top: 10, right: -4, width: 15, height: 15, borderRadius: 999, border: "none", background: T.surface, color: T.faint, fontSize: 11, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>}
                        </div>
                      ))}
                      {!locked && avail.length > 0 && (
                        <select value="" onChange={e => { if (e.target.value) addSize(it, e.target.value); }} style={{ ...field, width: 68, height: 34, alignSelf: "flex-end" }}>
                          <option value="">+ size</option>
                          {avail.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", justifyContent: "flex-end", marginLeft: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>TOTAL</span>
                        <div style={{ width: 64, textAlign: "center", padding: "7px 6px", fontSize: 15, fontWeight: 800, fontFamily: mono }}>{qtyOf(it).toLocaleString()}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: locked ? T.amber : T.faint, marginTop: 14 }}>
                      {locked ? "🔒 Pricing is locked — unlock in Costing to edit." : "Saves to the buy sheet. Full S&S/catalog blank picker is separate (Studio/classic)."}
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
                        {/* SELL + override — top, prominent (the invoice truth) */}
                        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", paddingBottom: 14, borderBottom: `1px solid ${T.border}` }}>
                          <div>
                            <div style={{ ...lbl, marginBottom: 4 }}>Sell / unit {overridden && <span style={{ color: T.amber }}>· override</span>}</div>
                            <div style={{ fontFamily: mono, fontSize: 27, fontWeight: 900, lineHeight: 1 }}>${sell.toFixed(2)}</div>
                          </div>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
                            <span style={{ ...lbl }}>Override / unit <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: T.faint }}>· blank = auto</span></span>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 13, color: T.faint }}>$</span>
                              <input key={it.id + ":ovr:" + (cp.sellOverride ?? "")} defaultValue={cp.sellOverride != null && cp.sellOverride !== "" ? Number(cp.sellOverride).toFixed(2) : ""} placeholder="auto" inputMode="decimal" readOnly={locked}
                                onBlur={e => saveOverride(it, e.target.value)}
                                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${overridden ? T.amber + "88" : T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                            </div>
                          </label>
                        </div>

                        {/* condensed KPI strip */}
                        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 12 }}>
                          {([["Revenue", fmtMoney(grossRev), T.text],
                            ["Blank", fmtMoney(r.blankCost), T.muted],
                            ["Decoration", fmtMoney(r.poTotal), T.muted],
                            ...(inclShip ? [["Ship", fmtMoney(r.shipping), T.muted]] : []),
                            ...(inclCC ? [["CC", fmtMoney(ccFees), T.muted]] : []),
                            ["Net profit", fmtMoney(netProfit), marginColor],
                            ["Margin", (marginPct * 100).toFixed(1) + "%", marginColor]] as any[]).map(([l, v, c]: any, i: number, arr: any[]) => (
                            <div key={l} style={{ flex: "1 1 auto", minWidth: 76, paddingRight: 12, marginRight: 12, borderRight: i < arr.length - 1 ? `1px solid ${T.border}44` : "none" }}>
                              <div style={lbl}>{l}</div>
                              <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 800, color: c, marginTop: 3 }}>{v}</div>
                            </div>
                          ))}
                        </div>

                        {/* raw blank-cost + shipping-buffer editors (writes items / costProd.shipRate) */}
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.border}44` }}>
                          <label style={{ flex: "1 1 190px" }}>
                            <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Blank cost / unit <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: T.faint }}>· raw</span></span>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 13, color: T.faint }}>$</span>
                              <input key={it.id + ":bcu:" + (it.cost_per_unit ?? "")} defaultValue={it.cost_per_unit != null ? Number(it.cost_per_unit).toFixed(2) : ""} placeholder="0.00" inputMode="decimal" readOnly={locked}
                                onBlur={e => saveBlankPerUnit(it, e.target.value)}
                                style={{ flex: 1, padding: "9px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                            </div>
                          </label>
                          <label style={{ flex: "1 1 190px" }}>
                            <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Shipping buffer / unit <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: T.faint }}>· blank = auto by garment</span></span>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 13, color: T.faint }}>$</span>
                              <input key={it.id + ":sr:" + (cp.shipRate ?? "")} defaultValue={cp.shipRate != null && cp.shipRate !== "" ? Number(cp.shipRate).toFixed(2) : ""} placeholder={"auto · $" + effectiveShipRate(allAssembled[wsIndex!]).toFixed(2)} inputMode="decimal" readOnly={locked}
                                onBlur={e => saveShipRate(it, e.target.value)}
                                style={{ flex: 1, padding: "9px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                            </div>
                          </label>
                        </div>

                        {/* decoration engine — DecorationPanel fed the full assembled array so
                            share groups (A–J / T1–T10) + qty tiers compute across items. */}
                        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.border}44` }}>
                          <div style={{ ...lbl, marginBottom: 10 }}>Decoration</div>
                          <DecorationPanel p={allAssembled[wsIndex!]} i={wsIndex!} costProds={allAssembled} PRINTERS={printers} decoratorRecords={decoratorRecords} updateProd={updateProd} setCostProds={setCostProdsFn} lookupPrintPrice={lookupPrint} lookupTagPrice={lookupTag} costingLocked={locked} />
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

      {/* ── PO send modal (per vendor) ── */}
      {poVendor && (() => {
        const cl = (decFor(poVendor)?.contacts_list || []).filter((c: any) => c.email);
        return (
          <div onClick={e => { if (e.target === e.currentTarget && !actBusy) setPoVendor(null); }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 320, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, width: "100%", maxWidth: 420, padding: "20px 22px" }}>
              <div style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginBottom: 14 }}>Send PO · {poVendor}</div>
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Ship date (required)</span>
                <input type="date" value={poShipDate} onChange={e => setPoShipDate(e.target.value)} style={field} />
              </label>
              <div style={{ ...lbl, marginBottom: 4 }}>Recipients</div>
              {cl.length === 0 ? (
                <div style={{ fontSize: 13, color: T.amber }}>No contacts on this decorator — add them on the Decorators page first.</div>
              ) : cl.map((c: any) => (
                <label key={c.email} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.text, padding: "4px 0" }}>
                  <input type="checkbox" checked={!!recips[c.email]} onChange={() => setRecips(r => ({ ...r, [c.email]: !r[c.email] }))} style={{ accentColor: T.accent }} />
                  <span>{c.name || c.email}<span style={{ color: T.faint }}> · {c.email}{c.role ? " · " + c.role : ""}</span></span>
                </label>
              ))}
              {actErr && <div style={{ color: T.red, fontSize: 12, marginTop: 10 }}>{actErr}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button disabled={actBusy || cl.length === 0} onClick={doSendPO} style={{ ...actBtn, opacity: actBusy || cl.length === 0 ? 0.6 : 1 }}>{actBusy ? "Sending…" : "Send PO"}</button>
                <button disabled={actBusy} onClick={() => setPoVendor(null)} style={ghostBtn}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── add product modal (minimal manual entry) ── */}
      {addOpen && (
        <div onClick={e => { if (e.target === e.currentTarget && !actBusy) setAddOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 320, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 14px", overflowY: "auto" }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, width: "100%", maxWidth: 460, padding: "20px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginBottom: 14 }}>Add product</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input autoFocus value={newProd.name} onChange={e => setNewProd(p => ({ ...p, name: e.target.value }))} placeholder="Product name" style={field} />
              <div style={{ display: "flex", gap: 10 }}>
                <select value={newProd.garment_type} onChange={e => setNewProd(p => ({ ...p, garment_type: e.target.value }))} style={{ ...field, flex: 1 }}>
                  {ADD_GARMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: 3, flex: 1 }}>
                  <span style={{ fontSize: 13, color: T.faint }}>$</span>
                  <input value={newProd.cost} onChange={e => setNewProd(p => ({ ...p, cost: e.target.value }))} placeholder="blank cost/unit" inputMode="decimal" style={field} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <input value={newProd.blank_vendor} onChange={e => setNewProd(p => ({ ...p, blank_vendor: e.target.value }))} placeholder="Blank (e.g. Next Level 6210)" style={{ ...field, flex: 1 }} />
                <input value={newProd.blank_sku} onChange={e => setNewProd(p => ({ ...p, blank_sku: e.target.value }))} placeholder="Color" style={{ ...field, flex: 1 }} />
              </div>
              <div>
                <div style={{ ...lbl, marginBottom: 6 }}>Sizes &amp; quantities</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ADD_SIZES.map(sz => (
                    <label key={sz} style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>{sz}</span>
                      <input value={newProd.qtys[sz] || ""} onChange={e => setNewProd(p => ({ ...p, qtys: { ...p.qtys, [sz]: e.target.value } }))} placeholder="0" inputMode="numeric"
                        style={{ width: 48, textAlign: "center", padding: "7px 4px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {actErr && <div style={{ color: T.red, fontSize: 12, marginTop: 10 }}>{actErr}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button disabled={actBusy} onClick={createProduct} style={{ ...actBtn, opacity: actBusy ? 0.6 : 1 }}>{actBusy ? "Adding…" : "Add product"}</button>
              <button disabled={actBusy} onClick={() => setAddOpen(false)} style={ghostBtn}>Cancel</button>
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
