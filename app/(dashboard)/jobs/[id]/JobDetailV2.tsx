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
import { T, font, mono, sortSizes } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { isCostingLocked } from "@/lib/costing-lock";
import { logJobActivity } from "@/components/JobActivityPanel";
import { resolveRecipientEmails } from "@/lib/recipients";
import { calcCostProduct, buildPrintersMap, lookupPrintPrice as sharedLookupPrintPrice, lookupTagPrice as sharedLookupTagPrice, effectiveShipRate } from "@/lib/pricing";
import { DecorationPanel as DecorationPanelRaw } from "./DecorationPanel";
import { ProofModal as ProofModalRaw } from "./ArtTab";
import {
  SSPicker as SSPickerRaw, ASColourPicker as ASColourPickerRaw, LAApparelPicker as LAApparelPickerRaw,
  FavoritesPicker as FavoritesPickerRaw, OtherPicker as OtherPickerRaw, CottonCollectivePicker as CottonCollectivePickerRaw,
  applyBlankToItem, fleeceFlag, FLEECE_GARMENTS, distribute, DEFAULT_CURVE,
} from "./BuySheetTab";
import { parsePsd } from "./ProcessingTab";
import { EditSizesModal as EditSizesModalRaw } from "./ProductBuilder";
import SizeGrid from "@/components/SizeGrid";
import RfqModalRaw from "@/components/RfqModal";
import ArtRequestModal from "@/components/ArtRequestModal";
import MoveItemDialog from "@/components/MoveItemDialog";
import { parseSizeMatrix } from "@/lib/size-grid";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { sendQuoteAndProofs, defaultRecipient } from "@/lib/job/quote-actions";
import { pushInvoiceToQB, recordPayment, cyclePaymentStatus, deletePayment, refreshPayLink, unlinkQBCustomer } from "@/lib/job/invoice-actions";
import { QBCustomerChooser } from "@/components/QBCustomerChooser";
import { InvoiceVarianceReviewModal } from "@/components/InvoiceVarianceReviewModal";
import { deriveInvoice } from "@/lib/job/invoice-derive";
import { applyPoSentToVendorItems, revertPoSentFromVendorItems } from "@/lib/po-actions";
import { recalcJobPhase } from "@/lib/job-phase-recalc";
import { PROOF_RENDERER_VERSION } from "@/lib/proof-client";
import { clientShippingRoutes } from "@/lib/tenants";
import { useIsMobile } from "@/lib/useIsMobile";
import { calculatePriority } from "@/lib/dates";
import { SHIP_METHODS } from "@/lib/ship-methods";
const DecorationPanel: any = DecorationPanelRaw; // .jsx — bypass narrow inferred prop types
const ProofModal: any = ProofModalRaw;           // .jsx — same
const EditSizesModal: any = EditSizesModalRaw;   // .jsx — same
const RfqModal: any = RfqModalRaw;               // .jsx — same
const SSPicker: any = SSPickerRaw, ASColourPicker: any = ASColourPickerRaw, LAApparelPicker: any = LAApparelPickerRaw,
  FavoritesPicker: any = FavoritesPickerRaw, OtherPicker: any = OtherPickerRaw, CottonCollectivePicker: any = CottonCollectivePickerRaw;
// Same source labels/colors as the classic add-item modal (ProductBuilder).
const PICKER_SOURCES: [string, string, string, string][] = [
  ["ss", "S&S Activewear", "#b65722", "#fff"], ["as", "AS Colour", "#000", "#fff"], ["la", "LA Apparel", "#fff", "#000"],
  ["cc", "Cotton Collective", "#2d6b4f", "#fff"], ["fav", "House Party Favorites", "", ""], ["other", "Other", "", ""],
];

// Money shows CENTS — internal totals must read identical to QB/the hub
// (whole-dollar rounding made matching numbers look like mismatches).
const fmtMoney = (n: number) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
// Full garment-type list — classic ProductBuilder's dropdown + accessory
// (all valid per mig 020; drives the QB Product/Service mapping).
const GARMENT_TYPES = ["accessory", "bandana", "banner", "beanie", "crewneck", "custom", "flag", "hat", "hoodie", "jacket", "koozie", "lighter", "longsleeve", "pants", "patch", "pin", "poster", "samples", "shorts", "socks", "sticker", "tee", "tote", "towel", "water_bottle"];
const ADD_GARMENTS: [string, string][] = GARMENT_TYPES.map(t => [t, t.replace(/_/g, " ")]);

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
  const [localContacts, setLocalContacts] = useState<any[]>(contacts);
  // The contacts PROP is the classic page's FLAT shape ({...contact, role_on_job})
  // — no job_contacts id, so × can't target the join row and the list renders
  // "no email". Re-hydrate the nested shape (jc row + contacts(*)) on mount;
  // addContact already refreshes in this same shape.
  useEffect(() => {
    if (!job?.id) return;
    createClient().from("job_contacts").select("*, contacts(*)").eq("job_id", job.id).then(({ data }: any) => { if (data) setLocalContacts(data); });
  }, [job?.id]);
  useEffect(() => { setLocalContacts(contacts); }, [contacts]);
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
  const [pullingPsds, setPullingPsds] = useState(false);
  const psdAutoRan = React.useRef(false);
  const persistTimer = React.useRef<any>(null);
  const pendingRef = React.useRef<Record<string, any>>({});
  // Refs mirror live state so the debounced flush (a stale render closure) reads
  // the CURRENT deco edits + items, not the snapshot from when it was scheduled.
  const decoStateRef = React.useRef(decoState); decoStateRef.current = decoState;
  const isMobile = useIsMobile();
  // ── GUIDE MODE (Jon, for the team cutover): every section explains itself
  // on first landing. 'Got it' hides all guides; the ? pill in the header
  // brings them back any time. Persisted per browser.
  const [guide, setGuide] = useState(true);
  useEffect(() => { try { if (localStorage.getItem("jobv2_guide") === "off") setGuide(false); } catch {} }, []);
  const setGuidePersist = (on: boolean) => { setGuide(on); try { localStorage.setItem("jobv2_guide", on ? "on" : "off"); } catch {} };
  const tip = (text: React.ReactNode) => guide ? (
    <div style={{ borderLeft: `3px solid ${T.border}`, padding: "6px 12px", margin: "2px 0 14px", fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>{text}</div>
  ) : null;
  const itemsRef = React.useRef(items); itemsRef.current = items;

  // ── NO SILENT SAVE FAILURES (house rule): every write path surfaces a red
  // toast on error. Saves stay silent on success. ──
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const saveErrTimer = React.useRef<any>(null);
  const failed = (msg: string, e?: any) => {
    console.error("[JobV2] " + msg, e);
    setSaveErr(msg);
    clearTimeout(saveErrTimer.current);
    saveErrTimer.current = setTimeout(() => setSaveErr(null), 6000);
  };

  // Job activity feed (read-only).
  const [activity, setActivity] = useState<any[]>([]);
  useEffect(() => {
    if (!job?.id) return;
    createClient().from("job_activity").select("message, created_at, type").eq("job_id", job.id).order("created_at", { ascending: false }).limit(40).then(({ data }: any) => { if (data) setActivity(data); });
  }, [job?.id]);

  // Item files (art / mockups / proofs / print-ready) for the Art tab — live
  // (non-superseded) only, grouped by item. Full rows: ProofModal needs id /
  // mime_type / drive_link; the revised-proof nudge needs revision_pending_send.
  const FILE_COLS = "id, item_id, file_name, stage, drive_file_id, drive_link, mime_type, approval, revision_pending_send, created_at";
  const [filesByItem, setFilesByItem] = useState<Record<string, any[]>>({});
  const reloadAllFiles = () => {
    // Read CURRENT items (ref), not itemsProp — items created this session
    // (PSD drop / pickers) must keep their files across reloads.
    const ids = (itemsRef.current || itemsProp || []).map((i: any) => i.id).filter(Boolean);
    if (!ids.length) return;
    createClient().from("item_files").select(FILE_COLS).in("item_id", ids).is("superseded_at", null).order("created_at").then(({ data }: any) => {
      if (!data) return;
      const m: Record<string, any[]> = {};
      data.forEach((f: any) => { (m[f.item_id] ||= []).push(f); });
      setFilesByItem(m);
    });
  };
  useEffect(() => { reloadAllFiles(); }, [itemsProp]);

  // Frozen forward packing slips = this job's outbound shipments (v2 shipping).
  const [forwardSlips, setForwardSlips] = useState<{ id: string; tracking: string | null; createdAt: string }[]>([]);
  useEffect(() => {
    if (!job?.id) return;
    createClient().from("shipment_lines").select("shipment_id, shipments(id, tracking, created_at, direction)").eq("job_id", job.id).then(({ data }: any) => {
      const m = new Map<string, any>();
      (data || []).forEach((l: any) => { const s = l.shipments; if (s?.direction === "outbound" && !m.has(s.id)) m.set(s.id, { id: s.id, tracking: s.tracking, createdAt: s.created_at }); });
      setForwardSlips(Array.from(m.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
    });
  }, [job?.id]);

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
      // Chunked Drive session upload (same path as PSD drops) — the old
      // single-POST /api/files hit Vercel's ~4.5MB body cap, so any real
      // print file failed with "Art upload failed" on prod (Taylor, Jul 29).
      // /api/drive/register keeps full /api/files parity: same-stage
      // supersede, proof approval carry, item drive_link auto-set.
      const driveFile: any = await (uploadToDrive as any)({
        blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream",
        itemId: item.id, clientName: job?.clients?.name || "", projectTitle: job?.title || "", itemName: item.name || "",
      });
      await registerFileInDb({
        ...driveFile, itemId: item.id, stage,
        fileName: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size,
      });
      const { data }: any = await createClient().from("item_files").select(FILE_COLS).eq("item_id", item.id).is("superseded_at", null).order("created_at");
      setFilesByItem(m => ({ ...m, [item.id]: data || [] }));
    } catch (e) { failed("Art upload failed", e); }
    finally { setUploadingItem(null); }
  };
  // Delete a file from the worksheet strip — removes the item_files row and the
  // Drive file (the API keeps the Drive copy if another item still references
  // it, e.g. duplicated items sharing art).
  const deleteFile = async (item: any, f: any) => {
    if (!window.confirm(`Delete "${f.file_name}" from this item? It's removed from the Drive folder too.`)) return;
    try {
      const res = await fetch("/api/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: f.id, driveFileId: f.drive_file_id }) });
      if (!res.ok) { failed("File delete failed", await res.text().catch(() => "")); return; }
      const { data }: any = await createClient().from("item_files").select(FILE_COLS).eq("item_id", item.id).is("superseded_at", null).order("created_at");
      setFilesByItem(m => ({ ...m, [item.id]: data || [] }));
    } catch (e) { failed("File delete error", e); }
  };

  const [wsIndex, setWsIndex] = useState<number | null>(null);   // open item worksheet index (null = closed)
  const [wsTask, setWsTask] = useState<string>("build");
  // Proof editor (reuses the classic ProofModal — methods/locations/colors/crop/bake).
  const [proofItemId, setProofItemId] = useState<string | null>(null);
  const [proofMode, setProofMode] = useState<"edit" | "preview">("edit");
  // Send-time proof bake: hidden ProofModals mount for stale/never-baked
  // proofs; the send continues once every one reports baked (or timeout).
  const [bakeIds, setBakeIds] = useState<string[] | null>(null);
  const bakeRemainRef = React.useRef<Set<string>>(new Set());
  const bakeResolveRef = React.useRef<(() => void) | null>(null);
  // Bakes run ONE at a time — firing the whole queue at Browserless
  // concurrently rate-limits (429) and every proof past the first few
  // silently never lands (the 12-proof Kill Em case, Aug 7).
  const bakeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const armBakeValve = () => {
    if (bakeTimerRef.current) clearTimeout(bakeTimerRef.current);
    // Valve = 60s of NO PROGRESS (re-armed on every finished bake), so a
    // long queue gets all the time it needs but a wedged render can't
    // stall the send. Firing is LOUD: the gap lands in job activity.
    bakeTimerRef.current = setTimeout(() => {
      if (!bakeResolveRef.current) return;
      const left = bakeRemainRef.current.size;
      console.warn(`[JobV2] proof bake stalled — continuing send without ${left} PDF(s)`);
      try { logJobActivity(job.id, `⚠ ${left} proof PDF${left === 1 ? "" : "s"} failed to bake during send — Drive links may be missing them; use "Bake to Drive" on Approvals & Billing`); } catch {}
      const r = bakeResolveRef.current; bakeResolveRef.current = null; setBakeIds(null); r();
    }, 60000);
  };
  const bakeProofPdfs = (ids: string[]) => new Promise<void>(resolve => {
    if (!ids.length) return resolve();
    bakeRemainRef.current = new Set(ids);
    bakeResolveRef.current = resolve;
    setBakeIds(ids);
    armBakeValve();
  });
  // Leaving mid-bake kills the remaining renders SILENTLY (the renderers
  // live in this tab). Guard both exits while a bake runs: beforeunload
  // for close/refresh, and a capture-phase click trap for in-app links —
  // those get a styled confirm instead of a quiet half-done state.
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!bakeIds) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClickCapture = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target === "_blank" || a.hasAttribute("download")) return; // new-tab/downloads don't unload
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return;
      e.preventDefault(); e.stopPropagation();
      setLeaveTarget(href);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); document.removeEventListener("click", onClickCapture, true); };
  }, [bakeIds]);
  const confirmLeave = () => {
    const left = bakeRemainRef.current.size;
    try { logJobActivity(job.id, `⚠ Left the page with ${left} proof PDF${left === 1 ? "" : "s"} still baking — Drive is missing them; finish with "Bake to Drive" on Approvals & Billing`); } catch {}
    const href = leaveTarget; setLeaveTarget(null);
    if (href) window.location.assign(href);
  };
  const handleBaked = (id: string) => {
    bakeRemainRef.current.delete(id);
    if (bakeRemainRef.current.size === 0 && bakeResolveRef.current) {
      if (bakeTimerRef.current) clearTimeout(bakeTimerRef.current);
      const r = bakeResolveRef.current; bakeResolveRef.current = null; setBakeIds(null); r();
    } else if (bakeResolveRef.current) {
      armBakeValve();
      // Advance the serial queue — state change mounts the next renderer.
      setBakeIds(prev => prev ? prev.filter(x => bakeRemainRef.current.has(x)) : prev);
    }
  };
  // Catalog picker overlay ("src" = source chooser, else picker key) + assign target.
  const [pickerSrc, setPickerSrc] = useState<string | null>(null);
  const [assignTargetId, setAssignTargetId] = useState<string | null>(null);
  const [clientMenu, setClientMenu] = useState(false); // ⋯ previews/hub menu in the Client block
  // Cost request (RFQ to a decorator / art pricing to a designer) + item ⋯ menu
  const [costReqMenu, setCostReqMenu] = useState(false);
  const [rfqOpen, setRfqOpen] = useState(false);
  const [artReqOpen, setArtReqOpen] = useState(false);
  const [wsMenu, setWsMenu] = useState(false);
  const [moveItem, setMoveItem] = useState<{ id: string; name: string; mode: "move" | "copy" } | null>(null);
  // Revised-proof re-send (classic nudge: item_files.revision_pending_send).
  const [revisedOpen, setRevisedOpen] = useState(false);
  const [revisedNote, setRevisedNote] = useState("");
  const [revisedSel, setRevisedSel] = useState<Record<string, boolean>>({});
  const [revisedBusy, setRevisedBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ products: true, client: false, production: true, logistics: false });
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  // Recent projects — feed the hub sidebar's RECENT list.
  useEffect(() => {
    if (!job?.id) return;
    try {
      const list = (JSON.parse(localStorage.getItem("opshub_recent_jobs") || "[]") as any[]).filter(r => r.id !== job.id);
      list.unshift({ id: job.id, label: job?.clients?.name || job?.title || "Untitled", num: job?.job_number || "" });
      localStorage.setItem("opshub_recent_jobs", JSON.stringify(list.slice(0, 8)));
    } catch {}
  }, [job?.id]);

  // ── Legacy ?tab= deep links (emails, notifications, bookmarks) — map the
  // classic tab names onto V2 blocks: open the block and scroll to it. Old
  // links keep working forever without touching any sender. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (!tab) return;
    const map: Record<string, string> = {
      quote: "client", proofs: "client", invoice: "client",
      po: "production", blanks: "production", production: "production",
      builder: "products", costing: "products", art: "products",
    };
    const block = map[tab];
    if (!block) return;
    setOpen(o => ({ ...o, [block]: true }));
    setTimeout(() => document.getElementById(block)?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
  }, []);

  // Client transaction actions (send quote/proofs, approve, send invoice, record payment).
  const [clientAction, setClientAction] = useState<null | "quote" | "invoice" | "payment">(null);
  const [recips, setRecips] = useState<Record<string, boolean>>({});
  // Manual one-off recipients (Jon, Aug 1) — an invoice sometimes goes to an
  // address that isn't a job contact (client's bookkeeper etc.).
  const [manualEmails, setManualEmails] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [actBusy, setActBusy] = useState(false);
  const [actErr, setActErr] = useState("");
  const [payForm, setPayForm] = useState<{ type: string; amount: string; paid_date: string }>({ type: "full_payment", amount: "", paid_date: "" });
  const [poVendor, setPoVendor] = useState<string | null>(null);
  const [poShipDate, setPoShipDate] = useState("");
  const [poMethod, setPoMethod] = useState("");
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [contactForm, setContactForm] = useState<{ name: string; email: string; phone: string; role: string } | null>(null);
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
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("Qty save failed — not saved", e); }
  };

  // Distribute a total across the item's sizes by its curve (classic
  // distribute() from BuySheetTab) — one upsert per size, sell recomputed once.
  const distributeTotal = async (item: any, raw: string) => {
    if (isCostingLocked(job)) return;
    const total = parseInt(raw) || 0;
    if (!total) return;
    const sizes = Object.keys(item.qtys || {});
    if (!sizes.length) return;
    const newQtys = distribute(total, sizes, item.curve || DEFAULT_CURVE);
    const updated = { ...item, qtys: newQtys, totalQty: sumQ(newQtys) };
    const sell = Object.keys(printers).length ? (() => {
      try { const r: any = calcCostProduct(assemble(updated), costMargin, inclShip, inclCC, items.map(x => x.id === item.id ? assemble(updated) : assemble(x)), printers); return r ? Math.round((r.sellPerUnit || 0) * 100) / 100 : null; } catch { return null; }
    })() : null;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: newQtys, totalQty: sumQ(newQtys), ...(sell != null ? { sell_per_unit: sell } : {}) } : x));
    try {
      const supabase = createClient();
      for (const [size, q] of Object.entries(newQtys)) {
        await (supabase.from("buy_sheet_lines") as any).upsert({ item_id: item.id, size, qty_ordered: q }, { onConflict: "item_id,size" });
      }
      if (sell != null) await (supabase.from("items") as any).update({ sell_per_unit: sell }).eq("id", item.id);
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("Distribute failed — not saved", e); }
  };

  // Full size editor (classic EditSizesModal: adult/youth/one-size + the
  // waist×inseam cut-ticket grid). Saves via targeted prune + upsert so
  // ship/receive counters survive, then recomputes sell once.
  const [editSizesFor, setEditSizesFor] = useState<string | null>(null);
  const saveSizesQtys = async (item: any, nextSizes: string[], nextQtysRaw: Record<string, any>) => {
    if (isCostingLocked(job)) return;
    const nextQtys: Record<string, number> = Object.fromEntries(nextSizes.map(sz => [sz, Number(nextQtysRaw?.[sz]) || 0]));
    const updated = { ...item, qtys: nextQtys, totalQty: sumQ(nextQtys) };
    const sell = Object.keys(printers).length ? (() => {
      try { const r: any = calcCostProduct(assemble(updated), costMargin, inclShip, inclCC, items.map(x => x.id === item.id ? assemble(updated) : assemble(x)), printers); return r ? Math.round((r.sellPerUnit || 0) * 100) / 100 : null; } catch { return null; }
    })() : null;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: nextQtys, totalQty: sumQ(nextQtys), ...(sell != null ? { sell_per_unit: sell } : {}) } : x));
    setEditSizesFor(null);
    try {
      const supabase = createClient();
      const keep = new Set(Object.keys(nextQtys));
      const { data: existing }: any = await supabase.from("buy_sheet_lines").select("size").eq("item_id", item.id);
      const stale = (existing || []).map((r: any) => r.size).filter((s: string) => !keep.has(s));
      if (stale.length) await (supabase.from("buy_sheet_lines") as any).delete().eq("item_id", item.id).in("size", stale);
      for (const [size, q] of Object.entries(nextQtys)) {
        await (supabase.from("buy_sheet_lines") as any).upsert({ item_id: item.id, size, qty_ordered: q }, { onConflict: "item_id,size" });
      }
      if (sell != null) await (supabase.from("items") as any).update({ sell_per_unit: sell }).eq("id", item.id);
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("Size save failed — not saved", e); }
  };

  // Build-tab edits: rename, add/remove a size, remove the product from the job.
  const renameItem = async (item: any, name: string) => {
    const n = name.trim(); if (!n || n === item.name) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, name: n } : x));
    try {
      await (createClient().from("items") as any).update({ name: n }).eq("id", item.id);
      // Rename the Drive folder in place (classic doSave did this) —
      // otherwise the next upload creates a SIBLING folder under the new
      // name and print files/proofs split across two locations.
      if (typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id)) {
        fetch("/api/drive/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: "item", id: item.id, name: n }) }).catch(() => {});
      }
    } catch (e) { failed("Rename failed — not saved", e); }
  };
  const saveItemField = async (item: any, fieldK: "garment_type" | "blank_vendor" | "blank_sku", value: string) => {
    const v = (value || "").trim() || null;
    if (v === (item[fieldK] ?? null)) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, [fieldK]: v } : x));
    try { await (createClient().from("items") as any).update({ [fieldK]: v }).eq("id", item.id); } catch (e) { failed("Item field save failed — not saved", e); }
  };
  // Garment-type change sets AND clears is_fleece (classic dropdown behavior —
  // fleece drives the decorator upcharge + fleece packaging in costing).
  const saveGarmentType = async (item: any, value: string) => {
    const v = value || null;
    if (v === (item.garment_type ?? null)) return;
    const isFleece = !!(v && FLEECE_GARMENTS.includes(v));
    // Garment type sets the shipping buffer (effectiveShipRate reads garment_type)
    // and the fleece flag — persist both onto the costProd + recompute sell via the
    // deco flush, so the summary isn't left computing on the old garment's numbers.
    const p = { ...assemble({ ...item, garment_type: v }), garment_type: v, isFleece };
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, garment_type: v, is_fleece: isFleece } : x));
    setDecoState(s => ({ ...s, [item.id]: p }));
    schedulePersist(item, p);
    try { await (createClient().from("items") as any).update({ garment_type: v, is_fleece: isFleece }).eq("id", item.id); } catch (e) { failed("Garment type save failed — not saved", e); }
  };
  const toggleFleece = async (item: any) => {
    const next = !item.is_fleece;
    // Fleece drives the vendor upcharge (calcCostProduct reads costProd.isFleece)
    // and the garment shipping buffer — route it through the deco flush like
    // saveShipRate so the costProd, sell_per_unit and summary all move with it.
    const p = { ...assemble(item), isFleece: next };
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, is_fleece: next } : x));
    setDecoState(s => ({ ...s, [item.id]: p }));
    schedulePersist(item, p);
    try { await (createClient().from("items") as any).update({ is_fleece: next }).eq("id", item.id); } catch (e) { failed("Fleece toggle failed — not saved", e); }
  };
  const addSize = async (item: any, sz: string) => {
    if (item.qtys && sz in item.qtys) return;
    const newQtys = { ...(item.qtys || {}), [sz]: 0 };
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: newQtys, totalQty: sumQ(newQtys) } : x));
    try { await (createClient().from("buy_sheet_lines") as any).upsert({ item_id: item.id, size: sz, qty_ordered: 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }, { onConflict: "item_id,size" }); } catch (e) { failed("AddSize failed — not saved", e); }
  };
  const removeSize = async (item: any, sz: string) => {
    const newQtys = { ...(item.qtys || {}) }; delete newQtys[sz];
    const updated = { ...item, qtys: newQtys, totalQty: sumQ(newQtys) };
    // Dropping a populated size lowers qty (and can cross a rate tier) → recompute
    // sell + refresh the summary, same as saveQty, so no dollar total lags behind.
    const sell = Object.keys(printers).length ? (() => {
      try { const r: any = calcCostProduct(assemble(updated), costMargin, inclShip, inclCC, items.map(x => x.id === item.id ? assemble(updated) : assemble(x)), printers); return r ? Math.round((r.sellPerUnit || 0) * 100) / 100 : null; } catch { return null; }
    })() : null;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: newQtys, totalQty: sumQ(newQtys), ...(sell != null ? { sell_per_unit: sell } : {}) } : x));
    try {
      const supabase = createClient();
      await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id).eq("size", sz);
      if (sell != null) await (supabase.from("items") as any).update({ sell_per_unit: sell }).eq("id", item.id);
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("RemoveSize failed — not saved", e); }
  };
  // ── Client assignment (classic swapJobContactsForClient port) ──
  const [clientPick, setClientPick] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientList, setClientList] = useState<any[]>([]);
  const [clientBusy, setClientBusy] = useState(false);
  useEffect(() => {
    if (!clientPick || clientList.length) return;
    createClient().from("clients").select("id, name").order("name").then(({ data }: any) => setClientList(data || []));
  }, [clientPick]);
  const assignClient = async (clientId: string, clientName: string) => {
    if (clientBusy) return;
    if (!window.confirm(`Reassign this project to "${clientName}"? Contacts, delivery address, and payment terms swap to the new client. The QB invoice link is left as-is.`)) return;
    setClientBusy(true);
    const supabase = createClient();
    try {
      await (supabase.from("jobs") as any).update({ client_id: clientId }).eq("id", job.id);
      // Contacts: replace the job's contacts with the new client's.
      await supabase.from("job_contacts").delete().eq("job_id", job.id);
      const { data: cc }: any = await supabase.from("contacts").select("id, is_primary").eq("client_id", clientId);
      if (cc?.length) await (supabase.from("job_contacts") as any).insert(cc.map((c: any) => ({ job_id: job.id, contact_id: c.id, role_on_job: c.is_primary ? "primary" : "cc" })));
      const { data: freshJc }: any = await supabase.from("job_contacts").select("*, contacts(*)").eq("job_id", job.id);
      setLocalContacts(freshJc || []);
      // Address + terms from the new client's profile; stale po_ship_to cleared.
      const { data: row }: any = await supabase.from("clients").select("shipping_address, default_terms").eq("id", clientId).single();
      const meta = { ...(job.type_meta || {}) };
      if (row?.shipping_address) meta.venue_address = row.shipping_address; else delete meta.venue_address;
      delete meta.po_ship_to;
      const updates: any = { type_meta: meta };
      if (row?.default_terms) updates.payment_terms = row.default_terms;
      await (supabase.from("jobs") as any).update(updates).eq("id", job.id);
      setJob((j: any) => ({ ...j, client_id: clientId, clients: { ...(j.clients || {}), id: clientId, name: clientName }, type_meta: meta, ...(row?.default_terms ? { payment_terms: row.default_terms } : {}) }));
      logJobActivity(job.id, `Project reassigned to client: ${clientName}`);
      if (row?.default_terms) recalcPhase(); // new client's terms may move the payment gate
      setClientPick(false); setClientQuery("");
    } catch (e) { failed("Client reassign failed — not saved", e); }
    finally { setClientBusy(false); }
  };
  const createNewClient = async (name: string) => {
    const n = name.trim(); if (!n || clientBusy) return;
    setClientBusy(true);
    try {
      const { data: c, error }: any = await (createClient().from("clients") as any).insert({ name: n }).select("id, name").single();
      if (error) throw new Error(error.message);
      setClientList(prev => [...prev, c].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      setClientBusy(false);
      await assignClient(c.id, c.name);
    } catch (e) { setClientBusy(false); failed("Client create failed — not saved", e); }
  };
  // Pull any client contacts not yet on this job (classic Sync contacts).
  const syncContacts = async () => {
    const supabase = createClient();
    try {
      const { data: cc }: any = await supabase.from("contacts").select("id, is_primary").eq("client_id", job.client_id);
      const have = new Set((localContacts || []).map((jc: any) => jc.contact_id || jc.contacts?.id));
      const missing = (cc || []).filter((c: any) => !have.has(c.id));
      if (!missing.length) { alert("All client contacts are already on this project."); return; }
      await (supabase.from("job_contacts") as any).insert(missing.map((c: any) => ({ job_id: job.id, contact_id: c.id, role_on_job: c.is_primary ? "primary" : "cc" })));
      const { data: freshJc }: any = await supabase.from("job_contacts").select("*, contacts(*)").eq("job_id", job.id);
      setLocalContacts(freshJc || []);
    } catch (e) { failed("Contact sync failed — not saved", e); }
  };

  // ── Job-level (Overview parity) ──
  const saveJobCol = async (col: string, value: any) => {
    setJob((j: any) => ({ ...j, [col]: value }));
    try { await (createClient().from("jobs") as any).update({ [col]: value }).eq("id", job.id); } catch (e) { failed("Save failed — not saved", e); }
    // payment_terms is a phase gate (net auto-meets it; prepaid/deposit need a
    // payment) — recompute so switching terms opens/closes "ready" immediately.
    if (col === "payment_terms") recalcPhase();
  };
  const saveTypeMeta = async (patch: Record<string, any>) => {
    const meta = { ...(job.type_meta || {}), ...patch };
    setJob((j: any) => ({ ...j, type_meta: meta }));
    try { await (createClient().from("jobs") as any).update({ type_meta: meta }).eq("id", job.id); } catch (e) { failed("SaveTypeMeta failed — not saved", e); }
    // invoice_extra_lines feed costing_summary (feeRevenue / passthruTotal) —
    // refresh so KPIs don't lag additional-charge edits. Scoped to that key;
    // other type_meta keys (venue, PO#, notes) don't touch the summary.
    if ("invoice_extra_lines" in patch) fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
  };
  // Recalc jobs.phase after any gate-changing action (payment, approval, PO,
  // blanks) — the boards/dashboard key off phase; without this V2 actions
  // left it stale. Fire-and-forget; refreshes the hero when it lands.
  const recalcPhase = async () => {
    try {
      const sb = createClient();
      await recalcJobPhase(sb, job.id);
      const { data }: any = await sb.from("jobs").select("phase, phase_timestamps").eq("id", job.id).single();
      if (data?.phase) setJob((j: any) => ({ ...j, phase: data.phase, phase_timestamps: data.phase_timestamps }));
    } catch (e) { failed("Phase recalc failed — not saved", e); }
  };
  const setPhase = async (phase: string, recalc = false) => {
    setJob((j: any) => ({ ...j, phase }));
    try { await (createClient().from("jobs") as any).update({ phase }).eq("id", job.id); logJobActivity(job.id, `Phase → ${phase}`); } catch (e) { failed("Phase change failed — not saved", e); }
    setMenuOpen(false);
  };
  const duplicateJob = async () => {
    setMenuOpen(false);
    if (!window.confirm("Duplicate this project (items, costing, contacts)?")) return;
    try { const r = await fetch(`/api/jobs/${job.id}/duplicate`, { method: "POST" }); const d = await r.json(); const nid = d?.jobId || d?.id; if (r.ok && nid) window.location.href = `/jobs/${nid}?v2=1`; else alert(d?.error || "Duplicate failed"); } catch (e: any) { alert(e.message || "Duplicate failed"); }
  };
  const deleteJob = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${job.title}" and everything in it? This cannot be undone.`)) return;
    const supabase = createClient();
    try {
      // Archive the whole project's Drive folder first (classic parity). Non-fatal.
      try { await fetch("/api/files/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive-project", clientName: job?.clients?.name || "", projectTitle: job?.title || "", jobId: job.id }) }); } catch {}
      const ids = items.map((i: any) => i.id);
      if (ids.length) { await supabase.from("buy_sheet_lines").delete().in("item_id", ids); await supabase.from("item_files").delete().in("item_id", ids); await supabase.from("decorator_assignments").delete().in("item_id", ids); }
      await supabase.from("items").delete().eq("job_id", job.id);
      await supabase.from("payment_records").delete().eq("job_id", job.id);
      await supabase.from("job_contacts").delete().eq("job_id", job.id);
      await supabase.from("jobs").delete().eq("id", job.id);
      window.location.href = "/projects";
    } catch (e: any) { alert(e.message || "Delete failed"); }
  };
  const cancelVoid = async () => {
    setMenuOpen(false);
    if (paid > 0) { alert("Can't void — a payment is recorded. Refund/adjust in QB first."); return; }
    if (!window.confirm("Cancel this project and void its QuickBooks invoice?")) return;
    try { const r = await fetch("/api/qb/void-invoice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Void failed"); await setPhase("cancelled"); } catch (e: any) { alert(e.message || "Void failed"); }
  };
  const addContact = async () => {
    if (!contactForm) return;
    const email = contactForm.email.trim().toLowerCase(); const name = contactForm.name.trim();
    if (!email && !name) { setContactForm(null); return; }
    const supabase = createClient();
    try {
      let contactId: string | null = null;
      if (email) { const { data: existing }: any = await supabase.from("contacts").select("id").eq("client_id", job.client_id).eq("email", email).limit(1).maybeSingle(); contactId = existing?.id || null; }
      if (!contactId) { const { data: c }: any = await (supabase.from("contacts") as any).insert({ client_id: job.client_id, name, email: email || null, phone: contactForm.phone.trim() || null }).select("id").single(); contactId = c?.id; }
      await (supabase.from("job_contacts") as any).insert({ job_id: job.id, contact_id: contactId, role_on_job: contactForm.role });
      const { data: fresh }: any = await supabase.from("job_contacts").select("*, contacts(*)").eq("job_id", job.id);
      if (fresh) setLocalContacts(fresh);
      setContactForm(null);
    } catch (e: any) { failed("AddContact failed — not saved", e); }
  };
  const removeContact = async (jcId: string) => {
    try { await createClient().from("job_contacts").delete().eq("id", jcId); setLocalContacts(prev => prev.filter((c: any) => c.id !== jcId)); } catch (e) { failed("Contact remove failed — not saved", e); }
  };
  const cyclePay = async (p: any) => {
    try { const next = await cyclePaymentStatus(job, p); const { data: fresh }: any = await createClient().from("payment_records").select("*").eq("job_id", job.id).order("created_at"); if (fresh) setPayments(fresh); else setPayments(prev => prev.map(x => x.id === p.id ? { ...x, status: next } : x)); recalcPhase(); } catch (e) { failed("Payment status change failed — not saved", e); }
  };
  const delPay = async (id: string) => {
    if (!window.confirm("Delete this payment record?")) return;
    try { await deletePayment(id); setPayments(prev => prev.filter(x => x.id !== id)); recalcPhase(); } catch (e) { failed("Payment delete failed — not saved", e); }
  };

  const saveRoute = async (route: string) => {
    if (route === (job.shipping_route || "")) return;
    setJob((j: any) => ({ ...j, shipping_route: route }));
    try {
      await (createClient().from("jobs") as any).update({ shipping_route: route }).eq("id", job.id);
      logJobActivity(job.id, `Shipping route set to ${ROUTE_LABEL[route] || route}`);
      recalcPhase(); // route drives receiving vs drop-ship-complete gating
    } catch (e) { failed("Route save failed — not saved", e); }
  };
  const removeProduct = async (item: any) => {
    if (!window.confirm(`Remove "${item.name}" from this job? This deletes the product and its files.`)) return;
    const supabase = createClient();
    try {
      // Archive the item's Drive folder BEFORE deleting rows (classic parity —
      // otherwise the folder orphans in Drive). Non-fatal.
      try { await fetch("/api/files/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive-item", clientName: job?.clients?.name || "", projectTitle: job?.title || "", itemName: item.name, itemId: item.id }) }); } catch {}
      await supabase.from("buy_sheet_lines").delete().eq("item_id", item.id);
      await supabase.from("item_files").delete().eq("item_id", item.id);
      await supabase.from("decorator_assignments").delete().eq("item_id", item.id);
      await supabase.from("items").delete().eq("id", item.id);
      // Prune the item's costProd from costing_data too — a ghost entry keeps
      // feeding share-group quantities into rate lookups on the PO. Fresh
      // read-modify-write so nothing else is clobbered.
      try {
        const { data: fresh }: any = await supabase.from("jobs").select("costing_data").eq("id", job.id).single();
        const cd = fresh?.costing_data;
        if (cd?.costProds?.some((p: any) => p.id === item.id)) {
          await (supabase.from("jobs") as any).update({ costing_data: { ...cd, costProds: cd.costProds.filter((p: any) => p.id !== item.id), _savedAt: new Date().toISOString() } }).eq("id", job.id);
        }
      } catch (e) { console.error("[JobV2] costProd prune failed", e); }
      setItems(prev => prev.filter(x => x.id !== item.id));
      setWsIndex(null);
      try { logJobActivity(job.id, `Product removed: ${item.name}`); } catch {}
      recalcPhase();
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("Remove product failed — not saved", e); }
  };

  // Record a blank purchase total → items.blanks_order_cost. Per-item. (The S&S
  // order # field was dropped — we log the credit-card purchase total only.)
  const saveBlankCost = async (item: any, raw: string) => {
    const val = raw === "" ? null : parseFloat(String(raw).replace(/[^0-9.]/g, "")) || 0;
    if (val === (item.blanks_order_cost ?? null)) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, blanks_order_cost: val } : x));
    try {
      await (createClient().from("items") as any).update({ blanks_order_cost: val }).eq("id", item.id);
      recalcPhase();
    } catch (e) { failed("Blank cost save failed — not saved", e); }
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
    recalcPhase();
  };

  // Esc + arrow keys for the worksheet — the proof-editor feel. Suspended while
  // the ProofModal is open on top (it owns the keyboard then).
  useEffect(() => {
    if (wsIndex === null || proofItemId || pickerSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWsIndex(null);
      if (e.key === "ArrowLeft") setWsIndex(i => i === null || !items.length ? i : (i - 1 + items.length) % items.length);
      if (e.key === "ArrowRight") setWsIndex(i => i === null || !items.length ? i : (i + 1) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wsIndex, items.length, proofItemId, pickerSrc]);

  const client = job?.clients?.name || "";
  const units = items.reduce((a: number, it: any) => a + qtyOf(it), 0);
  // Order value = Σ sell×qty + invoice extra lines — the SAME billable formula
  // as scripts/qb-reconcile.cjs, so the grew/re-invoice signal matches it.
  const extraLines: any[] = Array.isArray(job?.type_meta?.invoice_extra_lines) ? job.type_meta.invoice_extra_lines : [];
  const extrasTotal = extraLines.reduce((a, l: any) => a + (Number(l?.amount) || 0), 0);
  const orderTotal = items.reduce((a: number, it: any) => a + (Number(it.sell_per_unit) || 0) * qtyOf(it), 0) + extrasTotal;
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
  const flatContacts = (localContacts || []).map((c: any) => ({ email: c.contacts?.email || c.email, name: c.contacts?.name || c.name || "", role_on_job: c.role_on_job, doc_routing: c.contacts?.doc_routing || null })).filter((c: any) => c.email);
  const openSend = (kind: "quote" | "invoice") => {
    // Pre-check the ROUTED contacts for this document category (Aug 3):
    // quote & proofs → Approvals people, invoice → Invoices people.
    // Unrouted contacts are admins and stay checked; still fully editable.
    const routed = new Set(resolveRecipientEmails(kind === "quote" ? "approvals" : "invoices", flatContacts));
    const sel: Record<string, boolean> = {};
    flatContacts.forEach((c: any) => { sel[c.email] = routed.has(String(c.email).toLowerCase()); });
    setRecips(sel); setManualEmails([]); setManualInput(""); setActErr(""); setClientAction(kind);
  };
  const selectedEmails = () => [
    ...flatContacts.filter((c: any) => recips[c.email]).map((c: any) => c.email),
    ...manualEmails,
  ];
  const addManualEmail = () => {
    const v = manualInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setActErr("That doesn't look like an email address."); return; }
    if (!manualEmails.includes(v)) setManualEmails(m => [...m, v]);
    setManualInput(""); setActErr("");
  };
  const refetchTypeMeta = async () => { const { data }: any = await createClient().from("jobs").select("type_meta, quote_approved, quote_approved_at").eq("id", job.id).single(); if (data) setJob((j: any) => ({ ...j, quote_approved: data.quote_approved, quote_approved_at: data.quote_approved_at, type_meta: { ...j.type_meta, ...data.type_meta } })); };
  const doSendQuote = async () => {
    const emails = selectedEmails(); if (!emails.length) { setActErr("Select a recipient."); return; }
    setActBusy(true); setActErr("");
    try {
      const [to, ...cc] = emails;
      const hasReady = items.some((it: any) => it.proof_spec);
      // Bake stale/never-baked proof PDFs into Drive BEFORE the send — the
      // vendor folder + portal + client hub all read that file.
      const needBake = items.filter((it: any) => it.proof_spec && ((it.proof_spec.bakedRendererVersion == null) || it.proof_spec.bakedRendererVersion < PROOF_RENDERER_VERSION)).map((x: any) => x.id);
      if (needBake.length) await bakeProofPdfs(needBake);
      await sendQuoteAndProofs(job, { to, cc, includeProofs: hasReady, proofsOnly: !!job.quote_approved });
      const readyIds = items.filter((it: any) => it.proof_spec && !it.proof_sent_at).map((it: any) => it.id);
      if (readyIds.length) { const nowP = new Date().toISOString(); await (createClient().from("items") as any).update({ proof_sent_at: nowP }).in("id", readyIds); setItems(prev => prev.map(x => readyIds.includes(x.id) ? { ...x, proof_sent_at: nowP } : x)); }
      await refetchTypeMeta();
      setClientAction(null);
      recalcPhase();
    } catch (e: any) { setActErr(e.message || "Send failed"); } finally { setActBusy(false); }
  };
  const doSendInvoice = async (pushOpts: { qbCustomerId?: string; forceCreate?: boolean } = {}) => {
    const emails = selectedEmails(); if (!emails.length) { setActErr("Select a recipient."); return; }
    setActBusy(true); setActErr("");
    try {
      // Ambiguous QB customer match (409) → chooser; its action re-runs this
      // with the picked id / forceCreate. Same flow as classic InvoiceSurface.
      const pr = await pushInvoiceToQB(job, pushOpts);
      if (!pr.ok) { setChooserCandidates(pr.ambiguous); setChooserOpen(true); setActBusy(false); return; }
      const [to, ...cc] = emails;
      const r = await fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "invoice", jobId: job.id, recipientEmail: to, ccEmails: cc }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Invoice email failed");
      await refetchTypeMeta();
      setClientAction(null);
    } catch (e: any) { setActErr(e.message || "Invoice send failed"); } finally { setActBusy(false); }
  };
  // QB customer chooser (opened on ambiguous push) + pay-link refresh.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserCandidates, setChooserCandidates] = useState<any>(undefined);
  const [refreshingLink, setRefreshingLink] = useState(false);
  const [showVariance, setShowVariance] = useState(false); // reconcile-at-ship review modal
  const [reopenArm, setReopenArm] = useState(false); // two-tap un-finalize
  const [linkErr, setLinkErr] = useState("");
  const doRefreshLink = async () => {
    if (refreshingLink) return;
    setRefreshingLink(true); setLinkErr("");
    try {
      const link = await refreshPayLink(job);
      const meta = { ...(job.type_meta || {}), qb_payment_link: link };
      setJob((j: any) => ({ ...j, type_meta: meta }));
    } catch (e: any) { setLinkErr(e.message || "Refresh failed"); }
    finally { setRefreshingLink(false); }
  };
  const handleChooserAction = async (a: any) => {
    if (a.type === "select") { setChooserOpen(false); await doSendInvoice({ qbCustomerId: a.qbCustomerId }); return; }
    if (a.type === "create_new") { setChooserOpen(false); await doSendInvoice({ forceCreate: true }); return; }
    if (a.type === "unlink") {
      try { await unlinkQBCustomer(job); } catch (e: any) { setActErr(e.message || "Unlink failed"); }
    }
  };
  const doApprove = async () => {
    if (actBusy) return; setActBusy(true);
    try {
      const now = new Date().toISOString();
      await (createClient().from("jobs") as any).update({ quote_approved: true, quote_approved_at: now }).eq("id", job.id);
      setJob((j: any) => ({ ...j, quote_approved: true, quote_approved_at: now }));
      try { logJobActivity(job.id, "Quote approved (internal)"); } catch {}
      recalcPhase();
    } finally { setActBusy(false); }
  };
  // Re-sync QB — push current pricing/qtys to the EXISTING QB invoice in place,
  // no client email (the QB half of Send revised invoice). Until now the only
  // way to clear a stale invoice was to re-send it. ⋯ menu item.
  const doResyncQb = async () => {
    if (actBusy) return; setActBusy(true); setActErr(""); setClientMenu(false);
    try {
      const pr = await pushInvoiceToQB(job);
      if (!pr.ok) { setActErr("Multiple QB customers match — run Send invoice once to pick, or resolve in QB."); return; }
      await refetchTypeMeta();
    } catch (e: any) { setActErr(e?.message || "QB re-sync failed"); } finally { setActBusy(false); }
  };
  // Quiet QB create — mints the invoice NUMBER only (no pay link, zero
  // emails, no AR row); Send invoice later makes it real. ⋯ menu item.
  const doQuietQb = async () => {
    if (actBusy) return; setActBusy(true); setActErr(""); setClientMenu(false);
    try {
      const r = await fetch("/api/qb/invoice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, quiet: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error || j.needsCustomerChoice) {
        setActErr(j.needsCustomerChoice ? "Multiple QB customers match — run Send invoice once to pick, or resolve in QB." : (j.error || "QB create failed"));
        return;
      }
      await refetchTypeMeta();
    } catch (e: any) { setActErr(e?.message || "QB create failed"); } finally { setActBusy(false); }
  };
  const doRevoke = async () => {
    if (actBusy) return; setActBusy(true);
    try {
      await (createClient().from("jobs") as any).update({ quote_approved: false, quote_approved_at: null }).eq("id", job.id);
      setJob((j: any) => ({ ...j, quote_approved: false, quote_approved_at: null }));
      try { logJobActivity(job.id, "Quote approval revoked"); } catch {}
      recalcPhase();
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
      recalcPhase();
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

  // ── Catalog pickers (classic S&S / AS / LA / CC / Favorites / Other) — two
  // modes: add a new product, or assign/swap the blank on an existing item.
  // (pickerSrc/assignTargetId state is declared up with the worksheet state —
  // the worksheet key handler's dep array reads it.) ──
  const [favorites, setFavorites] = useState<any[]>([]);
  useEffect(() => { createClient().from("favorites").select("*").order("style_name").then(({ data }: any) => setFavorites(data || [])); }, []);
  const isFav = (supplier: string, styleCode: string) => favorites.some((f: any) => f.supplier === supplier && f.style_code === styleCode);
  const toggleFav = async (supplier: string, styleCode: string, styleName: string, sourceCategory: string) => {
    const supabase = createClient();
    if (isFav(supplier, styleCode)) {
      await supabase.from("favorites").delete().eq("supplier", supplier).eq("style_code", styleCode);
      setFavorites(f => f.filter((x: any) => !(x.supplier === supplier && x.style_code === styleCode)));
    } else {
      const { data }: any = await (supabase.from("favorites") as any).insert({ supplier, style_code: styleCode, style_name: styleName, category: sourceCategory || "Other" }).select().single();
      if (data) setFavorites(f => [...f, data]);
    }
  };
  const closePicker = () => { setPickerSrc(null); setAssignTargetId(null); };
  // Assign/swap: shared classic transform → persist. Targeted line prune +
  // upsert (never delete-all — ship/receive counters live on those rows).
  const persistBlankAssign = async (item: any, blankData: any) => {
    const patch = applyBlankToItem({ ...item, qtys: item.qtys || {}, sizes: item.sizes || Object.keys(item.qtys || {}) }, blankData);
    // New blank cost → recompute sell through the engine (respects override),
    // same as every other cost-edit path — sell_per_unit must never lag.
    const nextItem = { ...item, ...patch, blank_costs: patch.blankCosts && Object.keys(patch.blankCosts).length ? patch.blankCosts : null };
    const rSell = Object.keys(printers).length ? (() => { try { return calcCostProduct(assemble(nextItem), costMargin, inclShip, inclCC, items.map((x: any) => x.id === item.id ? assemble(nextItem) : assemble(x)), printers); } catch { return null; } })() : null;
    const sell = rSell ? Math.round(((rSell as any).sellPerUnit || 0) * 100) / 100 : null;
    const supabase = createClient();
    try {
      await (supabase.from("items") as any).update({
        blank_vendor: patch.blank_vendor || null, blank_sku: patch.blank_sku || null,
        cost_per_unit: patch.cost_per_unit || null,
        blank_costs: patch.blankCosts && Object.keys(patch.blankCosts).length ? patch.blankCosts : null,
        garment_type: patch.garment_type || null, is_fleece: !!(item.is_fleece || patch.is_fleece),
        ...(sell != null ? { sell_per_unit: sell } : {}),
      }).eq("id", item.id);
      const currentSizes = new Set(Object.keys(patch.qtys || {}));
      const { data: existing }: any = await supabase.from("buy_sheet_lines").select("size").eq("item_id", item.id);
      const stale = (existing || []).map((r: any) => r.size).filter((s: string) => !currentSizes.has(s));
      if (stale.length) await (supabase.from("buy_sheet_lines") as any).delete().eq("item_id", item.id).in("size", stale);
      for (const [size, qty] of Object.entries(patch.qtys || {})) {
        await (supabase.from("buy_sheet_lines") as any).upsert({ item_id: item.id, size, qty_ordered: qty }, { onConflict: "item_id,size" });
      }
      // Local mirror must update blank_costs (snake) — the per-size grid and
      // the assembler read item.blank_costs, not the transform's blankCosts.
      setItems(prev => prev.map((x: any) => x.id === item.id ? { ...x, ...patch, is_fleece: !!(item.is_fleece || patch.is_fleece), blankCosts: patch.blankCosts, blank_costs: patch.blankCosts && Object.keys(patch.blankCosts).length ? patch.blankCosts : null, ...(sell != null ? { sell_per_unit: sell } : {}) } : x));
      logJobActivity(job.id, `Blank assigned to ${item.name}: ${patch.blank_vendor || ""} ${patch.blank_sku || ""}`.trim());
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("PersistBlankAssign failed — not saved", e); }
  };
  // Add a new product straight from a picker payload.
  const createProductFromPicker = async (pi: any) => {
    const supabase = createClient();
    try {
      const maxSort = items.reduce((m, it: any) => Math.max(m, Number(it.sort_order) || 0), 0);
      const { data: item, error }: any = await (supabase.from("items") as any).insert({
        job_id: job.id, name: pi.name, blank_vendor: pi.blank_vendor || null, blank_sku: pi.blank_sku || null,
        cost_per_unit: pi.cost_per_unit || null,
        blank_costs: pi.blankCosts && Object.keys(pi.blankCosts).length ? pi.blankCosts : null,
        garment_type: pi.garment_type || null, is_fleece: !!fleeceFlag(pi.garment_type).is_fleece,
        status: "tbd", artwork_status: "not_started", sort_order: maxSort + 10,
      }).select("*").single();
      if (error) throw new Error(error.message);
      if (pi.sizes?.length) await (supabase.from("buy_sheet_lines") as any).insert(
        pi.sizes.map((sz: string) => ({ item_id: item.id, size: sz, qty_ordered: pi.qtys?.[sz] || 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 })));
      const qtys = Object.fromEntries((pi.sizes || []).map((sz: string) => [sz, pi.qtys?.[sz] || 0]));
      setItems(prev => [...prev, { ...item, qtys, totalQty: sumQ(qtys), blankCosts: pi.blankCosts || {} }]);
      logJobActivity(job.id, `Product added: ${pi.name}`);
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e: any) { failed("CreateProductFromPicker failed — not saved", e); alert(e.message || "Failed to add product"); }
  };
  const handlePickerAdd = (pi: any) => {
    const target = assignTargetId ? items.find((x: any) => x.id === assignTargetId) : null;
    if (target) { persistBlankAssign(target, pi); }
    else { createProductFromPicker(pi); }
    closePicker();
  };

  // ── PSD / mockup drop → items (classic processFileDrop, adapted to V2 state).
  // Groups files by base name; PSD parses print locations → print_ready file,
  // matching image → mockup. Item created per group. ──
  const [psdProcessing, setPsdProcessing] = useState<any>(null);
  const [localThumbs, setLocalThumbs] = useState<Record<string, string>>({});
  const thumbOf = (id: string) => localThumbs[id] || thumbByItem[id];
  // Letter designator — canonical across surfaces: position in the full
  // sort_order-ordered list (items state is already in that order).
  const letterOf = (id: string) => { const i = items.findIndex((x: any) => x.id === id); return i >= 0 ? String.fromCharCode(65 + i) : "?"; };
  const baseNameOf = (fileName: string) => fileName
    .replace(/\.psd$/i, "").replace(/[-_ ]?mockup[-_ ]?/i, "").replace(/[-_ ]?mock[-_ ]?/i, "")
    .replace(/\.(png|jpg|jpeg|gif|webp)$/i, "").trim().toLowerCase();
  const processFileDrop = async (fileList: FileList | File[]) => {
    if (isCostingLocked(job)) return;
    const allF = Array.from(fileList);
    const psds = allF.filter(f => f.name.toLowerCase().endsWith(".psd"));
    const images = allF.filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name));
    if (!psds.length && !images.length) { setActErr(""); setAddOpen(true); return; }
    const groups: Record<string, any> = {};
    for (const f of psds) {
      const base = baseNameOf(f.name);
      if (!groups[base]) groups[base] = { psd: null, mockup: null, displayName: f.name.replace(/\.psd$/i, "").trim() };
      groups[base].psd = f;
    }
    for (const f of images) {
      const base = baseNameOf(f.name);
      if (groups[base]) groups[base].mockup = f;
      else {
        const displayName = f.name.replace(/[-_ ]?mockup[-_ ]?/i, "").replace(/\.(png|jpg|jpeg|gif|webp)$/i, "").trim();
        groups[base] = { psd: null, mockup: f, displayName: displayName || f.name };
      }
    }
    const groupList = Object.values(groups);
    setPsdProcessing({ status: `Processing ${groupList.length} item${groupList.length !== 1 ? "s" : ""}…`, done: 0, total: groupList.length });
    const supabase = createClient();
    const clientName = job?.clients?.name || "Unknown Client";
    const projectTitle = job?.title || job?.job_number || "Untitled Project";
    const failed: string[] = [];
    let maxSort = items.reduce((m, it: any) => Math.max(m, Number(it.sort_order) || 0), 0);
    for (let g = 0; g < groupList.length; g++) {
      const group: any = groupList[g];
      const itemName = group.displayName;
      setPsdProcessing({ status: `${g + 1}/${groupList.length} — ${itemName}`, done: g, total: groupList.length });
      try {
        let locations: any[] = []; let hasTag = false;
        if (group.psd) {
          try { const parsed: any = await parsePsd(await group.psd.arrayBuffer()); locations = parsed.locations; hasTag = parsed.hasTag; }
          catch (e) { console.warn("PSD parse error:", e); }
        }
        maxSort += 10;
        const { data: newItem, error }: any = await (supabase.from("items") as any).insert({
          job_id: job.id, name: itemName, status: "tbd", artwork_status: "not_started", sort_order: maxSort,
        }).select("*").single();
        if (error) throw new Error(error.message);
        if (group.psd) {
          const driveFile: any = await uploadToDrive({ blob: group.psd, fileName: group.psd.name, mimeType: "application/octet-stream", itemId: newItem.id, clientName, projectTitle, itemName, onProgress: undefined });
          await registerFileInDb({ ...driveFile, itemId: newItem.id, stage: "print_ready", notes: JSON.stringify({ psd_locations: locations, psd_has_tag: hasTag }) });
        }
        if (group.mockup) {
          const driveFile: any = await uploadToDrive({ blob: group.mockup, fileName: group.mockup.name, mimeType: group.mockup.type || "image/png", itemId: newItem.id, clientName, projectTitle, itemName, onProgress: undefined });
          await registerFileInDb({ ...driveFile, itemId: newItem.id, stage: "mockup" });
          if (driveFile?.fileId) setLocalThumbs(t => ({ ...t, [newItem.id]: driveFile.fileId }));
        }
        setItems(prev => [...prev, { ...newItem, qtys: {}, totalQty: 0 }]);
        const { data: nf }: any = await supabase.from("item_files").select(FILE_COLS).eq("item_id", newItem.id).is("superseded_at", null).order("created_at");
        setFilesByItem(m => ({ ...m, [newItem.id]: nf || [] }));
        const parts: string[] = [];
        if (group.psd) parts.push(`PSD: ${locations.length} location${locations.length !== 1 ? "s" : ""}${hasTag ? " + tag" : ""}`);
        if (group.mockup) parts.push("mockup");
        logJobActivity(job.id, `Item "${itemName}" created — ${parts.join(", ") || "no files"}`);
      } catch (err) { console.error("File drop error:", err); failed.push(itemName); }
    }
    if (failed.length) {
      // A partial/aborted upload must NOT look like success — the item + Drive
      // folder may already exist empty. Same rule as classic.
      setPsdProcessing({ error: `${failed.length} upload${failed.length !== 1 ? "s" : ""} didn't finish: ${failed.join(", ")}. Those items may have empty folders — delete and re-drop.` });
    } else setPsdProcessing(null);
  };

  // ── Drag-reorder gallery cards → items.sort_order ──
  const [dragId, setDragId] = useState<string | null>(null);
  const dropOnCard = async (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const arr = [...items];
    const from = arr.findIndex((x: any) => x.id === dragId);
    const to = arr.findIndex((x: any) => x.id === targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    const renumbered = arr.map((x: any, i: number) => ({ ...x, sort_order: (i + 1) * 10 }));
    setItems(renumbered);
    setDragId(null);
    try {
      const supabase = createClient();
      for (let i = 0; i < renumbered.length; i++) {
        if (arr[i].sort_order !== renumbered[i].sort_order) await (supabase.from("items") as any).update({ sort_order: renumbered[i].sort_order }).eq("id", renumbered[i].id);
      }
    } catch (e) { failed("Reorder save failed — not saved", e); }
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
    setPoMethod((job.type_meta?.po_ship_methods || {})[vendor] || decFor(vendor)?.default_ship_method || "");
    setActErr(""); setPoVendor(vendor);
  };
  // Per-item PO fields (items table).
  const saveItemPO = async (item: any, fieldK: "drive_link" | "incoming_goods" | "production_notes_po" | "packing_notes", value: string) => {
    const v = (value || "").trim() || null;
    if (v === (item[fieldK] ?? null)) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, [fieldK]: v } : x));
    try { await (createClient().from("items") as any).update({ [fieldK]: v }).eq("id", item.id); } catch (e) { failed("SaveItemPO failed — not saved", e); }
  };
  const copyPOToAll = async (vendor: string, fieldK: string, value: string) => {
    const targets = (vendorGroups[vendor] || []);
    setItems(prev => prev.map(x => targets.some((t: any) => t.id === x.id) ? { ...x, [fieldK]: value } : x));
    const supabase = createClient();
    for (const t of targets) { try { await (supabase.from("items") as any).update({ [fieldK]: value }).eq("id", t.id); } catch (e) { failed("Copy-to-all failed — not saved", e); } }
  };
  const saveItemRoute = async (item: any, route: string) => {
    const v = route || null;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, shipping_route: v } : x));
    try { await (createClient().from("items") as any).update({ shipping_route: v }).eq("id", item.id); recalcPhase(); } catch (e) { failed("Route save failed — not saved", e); }
  };
  // Manual mark / unmark a vendor's PO sent (no email) — mirrors classic chips.
  const markPoSent = async (vendor: string) => {
    const supabase = createClient();
    try {
      await applyPoSentToVendorItems(supabase, job.id, vendor);
      const meta = { ...(job.type_meta || {}), po_sent_vendors: Array.from(new Set([...(job.type_meta?.po_sent_vendors || []), vendor])), po_sent_dates: { ...(job.type_meta?.po_sent_dates || {}), [vendor]: new Date().toISOString().slice(0, 10) } };
      await (supabase.from("jobs") as any).update({ type_meta: meta }).eq("id", job.id);
      setJob((j: any) => ({ ...j, type_meta: { ...j.type_meta, ...meta } }));
      setItems(prev => prev.map(x => (cpFor(x)?.printVendor || x.decorator || "Unassigned") === vendor && x.pipeline_stage !== "shipped" ? { ...x, pipeline_stage: "in_production" } : x));
      logJobActivity(job.id, `PO for ${vendor} manually marked sent`);
      recalcPhase();
    } catch (e) { failed("MarkPoSent failed — not saved", e); }
  };
  const unmarkPoSent = async (vendor: string) => {
    const supabase = createClient();
    try {
      await revertPoSentFromVendorItems(supabase, job.id, vendor);
      const meta = { ...(job.type_meta || {}), po_sent_vendors: (job.type_meta?.po_sent_vendors || []).filter((v: string) => v !== vendor) };
      await (supabase.from("jobs") as any).update({ type_meta: meta }).eq("id", job.id);
      setJob((j: any) => ({ ...j, type_meta: meta }));
      setItems(prev => prev.map(x => (cpFor(x)?.printVendor || x.decorator || "Unassigned") === vendor && x.pipeline_stage === "in_production" ? { ...x, pipeline_stage: null } : x));
      logJobActivity(job.id, `PO for ${vendor} unmarked`);
      recalcPhase();
    } catch (e) { failed("UnmarkPoSent failed — not saved", e); }
  };
  // Send revised proofs — classic flow: /api/email/notify type proof_revised;
  // the server clears revision_pending_send flags, reload drops the nudge.
  const sendRevised = async () => {
    const recipients = Object.keys(revisedSel).filter(e => revisedSel[e]);
    if (!recipients.length) return;
    setRevisedBusy(true);
    try {
      await fetch("/api/email/notify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, type: "proof_revised", recipients, note: revisedNote.trim() || undefined }) });
      logJobActivity(job.id, `Revised proof(s) sent to client (${recipients.length} recipient${recipients.length === 1 ? "" : "s"})`);
      setRevisedOpen(false);
      reloadAllFiles();
    } catch (e) { failed("SendRevised failed — not saved", e); }
    setRevisedBusy(false);
  };
  const doSendPO = async () => {
    if (!poVendor) return;
    const cl = decFor(poVendor)?.contacts_list || [];
    const emails = cl.filter((c: any) => c.email && recips[c.email]).map((c: any) => c.email);
    if (!emails.length) { setActErr("Select a recipient (or add contacts on the decorator)."); return; }
    if (!poShipDate) { setActErr("Set a ship date."); return; }
    setActBusy(true); setActErr("");
    try {
      // Bake any unbaked proof PDFs for this vendor's items into Drive FIRST —
      // the folder the PO links to must hold the proof docs the client approved.
      // Same send-time bake as the quote path (90s valve inside bakeProofPdfs);
      // was the deferred "decorator PDF bake" on the proof-flow punch list.
      const vendorItems = vendorGroups[poVendor] || [];
      const poNeedBake = vendorItems.filter((it: any) => it.proof_spec && ((it.proof_spec.bakedRendererVersion == null) || it.proof_spec.bakedRendererVersion < PROOF_RENDERER_VERSION)).map((x: any) => x.id);
      if (poNeedBake.length) await bakeProofPdfs(poNeedBake);
      const supabase = createClient();
      const [to, ...cc] = emails;
      const alreadySent = ((job.type_meta?.po_sent_vendors) || []).includes(poVendor);
      const meta = { ...(job.type_meta || {}), po_ship_dates: { ...(job.type_meta?.po_ship_dates || {}), [poVendor]: poShipDate }, po_ship_methods: { ...(job.type_meta?.po_ship_methods || {}), [poVendor]: poMethod || null } };
      await (supabase.from("jobs") as any).update({ type_meta: meta }).eq("id", job.id);
      const r = await fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "po", jobId: job.id, vendor: poVendor, recipientEmail: to, ccEmails: cc, revised: alreadySent }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "PO email failed");
      await applyPoSentToVendorItems(supabase, job.id, poVendor);
      try { await fetch(`/api/jobs/${job.id}/snapshot-po`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: poVendor }) }); } catch {}
      const sentVendors = Array.from(new Set([...(job.type_meta?.po_sent_vendors || []), poVendor]));
      const meta2 = { ...meta, po_sent_vendors: sentVendors, po_sent_dates: { ...(job.type_meta?.po_sent_dates || {}), [poVendor]: new Date().toISOString().slice(0, 10) } };
      await (supabase.from("jobs") as any).update({ type_meta: meta2 }).eq("id", job.id);
      setJob((j: any) => ({ ...j, type_meta: { ...j.type_meta, ...meta2 } }));
      setItems(prev => prev.map(x => (cpFor(x)?.printVendor || x.decorator || "Unassigned") === poVendor && x.pipeline_stage !== "shipped" ? { ...x, pipeline_stage: "in_production" } : x));
      setPoVendor(null);
      recalcPhase();
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
  // Archived items are closed out — never surface them as a PO group (an
  // archived item with no vendor produced a phantom "Unassigned" PO on 047).
  for (const item of items) {
    if (item.archived_at) continue;
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
    // items.is_fleece is canonical (saved cp as legacy fallback) — without
    // this overlay every assemble-based persist rebuilt the costProd
    // fleece-less and calcCostProduct priced WITHOUT the upcharge whenever
    // the blob lacked the flag (the Ops Health fleece tripwire, 2608-004).
    return { ...cp, id: item.id, name: item.name, qtys: bslQtys, totalQty: sumQ(bslQtys), blankCosts, blank_vendor: item.blank_vendor, garment_type: item.garment_type, isFleece: !!(item.is_fleece || cp.isFleece) };
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
      return { ...cp, id: item.id, name: item.name, qtys: q, totalQty: sumQ(q), blankCosts: bc, blank_vendor: item.blank_vendor, garment_type: item.garment_type, isFleece: !!(item.is_fleece || cp.isFleece) };
    };
    const supabase = createClient();
    try {
      const { data: fresh }: any = await supabase.from("jobs").select("costing_data").eq("id", job.id).single();
      const cd = fresh?.costing_data || job.costing_data || { costProds: [] };
      const cps = (Array.isArray(cd.costProds) ? cd.costProds : []).map((c: any) => ({ ...c }));
      const allNow = its.map(assembleNow);
      const sellUpdates: { id: string; sell: number }[] = [];
      const flushedById: Record<string, any> = {};
      for (const id of ids) {
        const item = its.find((x: any) => x.id === id); if (!item) continue;
        const p = assembleNow(item);
        flushedById[id] = p;
        let idx = cps.findIndex((c: any) => c.id === id);
        if (idx < 0) idx = cps.findIndex((c: any) => (c.name || "").trim().toLowerCase() === (item.name || "").trim().toLowerCase());
        // Apply ONLY decoration fields from p; keep the DB's qtys/blankCosts/name
        // (those are owned by buy_sheet_lines / items — don't let a deco edit touch them).
        if (idx >= 0) cps[idx] = { ...cps[idx], ...p, qtys: cps[idx].qtys ?? p.qtys, blankCosts: cps[idx].blankCosts ?? p.blankCosts, name: cps[idx].name ?? p.name };
        else cps.push(p);
        if (Object.keys(printers).length) { try { const r: any = calcCostProduct(p, costMargin, inclShip, inclCC, allNow, printers); if (r) sellUpdates.push({ id, sell: Math.round((r.sellPerUnit || 0) * 100) / 100 }); } catch {} }
      }
      await (supabase.from("jobs") as any).update({ costing_data: { ...cd, costProds: cps, _savedAt: new Date().toISOString() } }).eq("id", job.id);
      for (const u of sellUpdates) await (supabase.from("items") as any).update({ sell_per_unit: u.sell }).eq("id", u.id);
      // Auto-create/update decorator assignments for flushed items with a
      // vendor — classic CostingTab did this on save; the vendor portal, PO
      // sent-date tracking, and boards all key off decorator_assignments.
      for (const id of ids) {
        const p = flushedById[id]; if (!p?.printVendor) continue;
        const dec: any = decoratorRecords.find((d: any) => d.short_code === p.printVendor || d.name === p.printVendor);
        if (!dec) continue;
        const decoType = p.decorationType || "screen_print";
        const { data: existing }: any = await supabase.from("decorator_assignments").select("id").eq("item_id", id).limit(1).maybeSingle();
        if (existing) await (supabase.from("decorator_assignments") as any).update({ decorator_id: dec.id, decoration_type: decoType }).eq("id", existing.id);
        // pipeline_stage starts NULL on insert (PO send sets in_production).
        else await (supabase.from("decorator_assignments") as any).insert({ item_id: id, decorator_id: dec.id, decoration_type: decoType, pipeline_stage: null });
      }
      if (sellUpdates.length) setItems(prev => prev.map(x => { const u = sellUpdates.find(s => s.id === x.id); return u ? { ...x, sell_per_unit: u.sell } : x; }));
      // Keep costing_summary (Reports / God Mode KPIs) in step — same
      // fire-and-forget classic ProductBuilder uses after item mutations.
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("Deco flush failed — not saved", e); }
  };
  const schedulePersist = (item: any, newP: any) => {
    pendingRef.current[item.id] = newP;
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(flushDeco, 700);
  };
  // Unload guard — deco edits flush on a 700ms debounce; leaving the page
  // inside that window must warn (beforeunload) and best-effort flush
  // (pagehide). flushRef so the handlers always call the CURRENT closure.
  const flushRef = React.useRef(flushDeco); flushRef.current = flushDeco;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (Object.keys(pendingRef.current).length) { e.preventDefault(); e.returnValue = ""; } };
    const onPageHide = () => { if (Object.keys(pendingRef.current).length) { clearTimeout(persistTimer.current); flushRef.current(); } };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); window.removeEventListener("pagehide", onPageHide); };
  }, []);
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
  // ── Pull print data from PSDs (ported from classic CostingTab, Jul 28 —
  // Taylor: V2 cost tab wasn't seeding print locations). Fast path = the
  // psd_locations cached on item_files.notes at upload; fallback = parse the
  // PSD with ag-psd. Seeds ONLY items with no print locations yet, and writes
  // through the normal deco overlay + debounced flush (fresh RMW + _savedAt
  // stamp + sell recompute + refresh-financials — the guarded path). ──
  const pullFromPsds = async () => {
    if (isCostingLocked(job) || pullingPsds) return 0;
    const needs = items.filter((it: any) => {
      const cp = decoState[it.id] || cpFor(it) || {};
      return !Object.values(cp.printLocations || {}).some((l: any) => l?.location);
    });
    if (!needs.length) return 0;
    setPullingPsds(true);
    let populated = 0;
    try {
      const supabase = createClient();
      const { data: psdFiles } = await supabase.from("item_files")
        .select("item_id, drive_file_id, file_name, notes")
        .in("item_id", needs.map((it: any) => it.id))
        .ilike("file_name", "%.psd");
      if (!psdFiles?.length) return 0;
      const psdByItem: Record<string, any> = {};
      for (const f of psdFiles as any[]) { if (!psdByItem[f.item_id]) psdByItem[f.item_id] = f; }
      const PLACEMENT_MAP: Record<string, string> = { Front: "Full Front", "Full Front": "Full Front", Back: "Full Back", "Full Back": "Full Back", "Left Chest": "Left Chest", "Right Chest": "Right Chest", "Left Sleeve": "Left Sleeve", "Right Sleeve": "Right Sleeve", Neck: "Neck", Hood: "Hood", Pocket: "Pocket" };
      const SKIP_GROUPS = ["Shirt Color", "Shadows", "Highlights", "Mask", "Client Art"];
      for (const [itemId, psdFile] of Object.entries(psdByItem)) {
        const item = needs.find((x: any) => x.id === itemId); if (!item) continue;
        try {
          let locs: { placement: string; colorCount: number }[] | null = null;
          let hasTag = false;
          let cached: any = null;
          try { cached = psdFile.notes ? JSON.parse(psdFile.notes) : null; } catch {}
          if (cached?.psd_locations) { locs = cached.psd_locations; hasTag = !!cached.psd_has_tag; }
          else {
            // dl=1: the thumbnail endpoint serves Drive's PNG for PSD mimes by
            // default — we need the real bytes for ag-psd.
            const res = await fetch(`/api/files/thumbnail?id=${psdFile.drive_file_id}&dl=1`);
            if (!res.ok) continue;
            const { readPsd } = await import("ag-psd");
            const psd = readPsd(new Uint8Array(await res.arrayBuffer()));
            const groups = [...(psd.children || [])].reverse();
            locs = [];
            for (const g of groups) {
              if (SKIP_GROUPS.includes(g.name as string)) continue;
              const isTag = (g.name || "").toLowerCase() === "tag" || (g.name || "").toLowerCase() === "tags";
              if (isTag) { hasTag = true; continue; }
              if (!g.children?.length) continue;
              locs.push({ placement: (g.name || "") as string, colorCount: g.children.filter((l: any) => !SKIP_GROUPS.includes(l.name) && l.name).length });
            }
          }
          if (!locs?.length && !hasTag) continue;
          const newLocations: Record<string, any> = {};
          let locIdx = 1;
          for (const loc of locs || []) {
            newLocations[String(locIdx)] = { location: PLACEMENT_MAP[loc.placement] || loc.placement, screens: loc.colorCount || 0, printer: "" };
            locIdx++;
          }
          for (let pad = locIdx; pad <= 6; pad++) newLocations[String(pad)] = {};
          const next: any = { ...assemble(item), printLocations: newLocations, printCount: locIdx - 1 };
          if (hasTag) next.tagPrint = true;
          setDecoState(s => ({ ...s, [itemId]: next }));
          schedulePersist(item, next);
          populated++;
        } catch (e) { console.warn("[Pull from PSDs] item failed:", itemId, e); }
      }
      if (populated > 0) logJobActivity(job.id, `Print data pulled from PSDs on ${populated} item${populated === 1 ? "" : "s"}`);
    } finally { setPullingPsds(false); }
    return populated;
  };
  // Auto-seed once per visit (classic fired its auto-detect on load) — only
  // un-costed items are touched, so an already-priced job is never rewritten.
  useEffect(() => {
    // Wait for decorator pricing so the flush can compute sells for what we seed.
    if (psdAutoRan.current || !items.length || !job?.id || !Object.keys(printers).length) return;
    psdAutoRan.current = true;
    pullFromPsds();
    // eslint-disable-next-line
  }, [items.length, job?.id, Object.keys(printers).length]);

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
      const cd = { ...(fresh?.costing_data || job.costing_data || {}), costMargin: nextMargin, inclShip: nextInclShip, inclCC: nextInclCC, _savedAt: new Date().toISOString() };
      await (supabase.from("jobs") as any).update({ costing_data: cd }).eq("id", job.id);
      for (const [id, sell] of Object.entries(sells)) await (supabase.from("items") as any).update({ sell_per_unit: sell }).eq("id", id);
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("Recompute-all failed — not saved", e); }
  };
  const toggleUnlock = async () => {
    const unlocked = !job?.type_meta?.costing_unlocked;
    const meta = { ...(job.type_meta || {}), costing_unlocked: unlocked };
    setJob((j: any) => ({ ...j, type_meta: meta }));
    try { await (createClient().from("jobs") as any).update({ type_meta: meta }).eq("id", job.id); logJobActivity(job.id, unlocked ? "Costing unlocked to revise" : "Costing re-locked"); } catch (e) { failed("Lock toggle failed — not saved", e); }
  };
  const calcFor = (item: any) => {
    if (!Object.keys(printers).length) return null;             // wait for decorator pricing
    try { return calcCostProduct(assemble(item), costMargin, inclShip, inclCC, allAssembled, printers); }
    catch { return null; }
  };

  // Per-SIZE blank cost (2XL/3XL upcharges) — refines items.blank_costs one
  // size at a time; cost_per_unit re-derives as the avg of the >0 per-size
  // costs (same formula as CostingTab save + applyBlankToItem).
  const saveBlankSizeCost = async (item: any, sz: string, raw: string) => {
    if (isCostingLocked(job)) return;
    const val = raw === "" ? 0 : parseFloat(String(raw).replace(/[^0-9.]/g, "")) || 0;
    const prevVal = Number((item.blank_costs || {})[sz] ?? item.cost_per_unit ?? 0);
    if (val === prevVal) return;
    const blank_costs: Record<string, number> = {};
    Object.keys(item.qtys || {}).forEach(s => { blank_costs[s] = Number((item.blank_costs || {})[s] ?? item.cost_per_unit ?? 0); });
    blank_costs[sz] = val;
    const costVals = Object.values(blank_costs).filter(v => v > 0);
    const cost_per_unit = costVals.length ? Math.round(costVals.reduce((a, v) => a + v, 0) / costVals.length * 100) / 100 : 0;
    const nextItem = { ...item, blank_costs, cost_per_unit };
    const r = Object.keys(printers).length ? (() => { try { return calcCostProduct(assemble(nextItem), costMargin, inclShip, inclCC, items.map(x => x.id === item.id ? assemble(nextItem) : assemble(x)), printers); } catch { return null; } })() : null;
    const sell = r ? Math.round(((r as any).sellPerUnit || 0) * 100) / 100 : item.sell_per_unit;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, blank_costs, cost_per_unit, sell_per_unit: sell } : x));
    try {
      const upd: any = { blank_costs, cost_per_unit };
      if (r) upd.sell_per_unit = sell;
      await (createClient().from("items") as any).update(upd).eq("id", item.id);
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("Per-size cost save failed — not saved", e); }
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
      await (supabase.from("jobs") as any).update({ costing_data: { ...cd, costProds: cps, _savedAt: new Date().toISOString() } }).eq("id", job.id);
      await (supabase.from("items") as any).update({ sell_per_unit: sell }).eq("id", item.id);
      fetch(`/api/jobs/${job.id}/refresh-financials`, { method: "POST", keepalive: true }).catch(() => {});
    } catch (e) { failed("Override save failed — not saved", e); }
  };

  const lbl: React.CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.faint };
  const previewBtn: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: T.text, textDecoration: "none", padding: "8px 15px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card };
  const actBtn: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "#0a0a0a", background: T.accent, border: "none", borderRadius: 999, padding: "9px 16px", cursor: "pointer", fontFamily: font };
  const ghostBtn: React.CSSProperties = { ...previewBtn, cursor: "pointer", fontFamily: font };
  // colorScheme dark → native controls (date-picker calendar icon, selects)
  // render their glyphs white instead of black-on-dark.
  const field: React.CSSProperties = { padding: "9px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13.5, fontFamily: font, outline: "none", boxSizing: "border-box", width: "100%", colorScheme: "dark" };
  const block = (id: string, tick: "done" | "now" | "todo" | "warn", title: string, summary: string, body: React.ReactNode, dim = false) => (
    <div id={id} style={{ border: `1px solid ${tick === "warn" ? T.amber + "88" : T.border}`, borderRadius: 16, background: tick === "warn" ? `${T.amber}0d` : T.card, marginTop: 14, overflow: "hidden", opacity: dim && !open[id] ? 0.6 : 1 }}>
      <div onClick={() => toggle(id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", cursor: "pointer" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
          background: tick === "done" ? T.greenDim : tick === "now" ? "rgba(107,176,232,.14)" : tick === "warn" ? `${T.amber}22` : "transparent",
          color: tick === "done" ? T.green : tick === "now" ? "#6bb0e8" : tick === "warn" ? T.amber : T.faint,
          border: `1px solid ${tick === "done" ? T.green + "66" : tick === "now" ? "#6bb0e880" : tick === "warn" ? T.amber + "88" : T.border}` }}>{tick === "done" ? "✓" : tick === "now" ? "◉" : tick === "warn" ? "!" : "○"}</span>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase" }}>{title}</span>
        <span style={{ flex: 1, fontSize: 12.5, color: tick === "warn" ? T.amber : T.muted, fontFamily: mono, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: tick === "warn" ? 700 : 400 }}>{summary}</span>
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
          <button onClick={() => setGuidePersist(!guide)} title="Show or hide the guides that explain each section" style={{ fontSize: 11, fontWeight: 800, color: guide ? "#0a0a0a" : T.muted, background: guide ? T.accent : "none", padding: "5px 11px", borderRadius: 999, border: `1px solid ${guide ? T.accent : T.border}`, cursor: "pointer", fontFamily: font }}>? Guide</button>
          <button onClick={() => setDetailsOpen(true)} style={{ fontSize: 11, fontWeight: 700, color: T.muted, background: "none", padding: "5px 11px", borderRadius: 999, border: `1px solid ${T.border}`, cursor: "pointer", fontFamily: font }}>Job details</button>
          <a href={`/jobs/${job?.id}?classic=1`} style={{ fontSize: 11, fontWeight: 700, color: T.muted, textDecoration: "none", padding: "5px 11px", borderRadius: 999, border: `1px solid ${T.border}` }}>Classic ›</a>
          <button onClick={() => setMenuOpen(v => !v)} aria-label="More" style={{ width: 30, height: 30, borderRadius: 999, border: `1px solid ${T.border}`, background: "none", color: T.muted, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>⋯</button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: 36, right: 0, zIndex: 41, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, minWidth: 190, padding: 5, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
                {(() => {
                  const item = (label: string, onClick: () => void, danger = false) => (
                    <button key={label} onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: danger ? T.red : T.text, borderRadius: 7 }}>{label}</button>
                  );
                  const rows = [];
                  if (job.phase === "on_hold") rows.push(item("Resume", async () => { await setPhase("intake"); recalcPhase(); }));
                  else if (job.phase !== "cancelled") rows.push(item("Place on hold", () => setPhase("on_hold")));
                  if (job.phase === "cancelled") rows.push(item("Reactivate", () => setPhase("intake")));
                  rows.push(item("Duplicate project", duplicateJob));
                  if (job.type_meta?.qb_invoice_number && job.phase !== "cancelled") rows.push(item("Cancel & void invoice", cancelVoid, true));
                  rows.push(item("Delete project", deleteJob, true));
                  return rows;
                })()}
              </div>
            </>
          )}
        </div>
      </div>

      {/* title */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "2px 0 16px", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "clamp(26px,4vw,40px)", fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1.02, margin: 0 }}>{client || job?.title}</h1>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 800, color: T.muted }}>{invNum || job?.job_number}</div>
          {invNum && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>{job?.job_number}</div>}
        </div>
      </div>

      {/* HERO + next action */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: isMobile ? "18px 16px" : "22px 24px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: isMobile ? 14 : 24 }}>
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 16 : 28, alignItems: "flex-end", padding: "18px 4px 4px", marginTop: 14, borderTop: `1px solid ${T.border}55` }}>
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

      {/* jump nav — solid bg (T.bg) so stuck-state fully blacks out the
          content scrolling underneath; buttons on card bg + white text so
          they read as controls, not ghost outlines. */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: T.bg, boxShadow: `0 -28px 0 0 ${T.bg}`, display: "flex", gap: 8, padding: "12px 0", margin: "8px 0 6px", borderBottom: `1px solid ${T.border}`, overflowX: "auto" }}>
        {[["products", "Products & Costing"], ["client", "Approvals & Billing"], ["production", "Purchasing & Production"], ["logistics", "Logistics"]].map(([id, label]) => (
          <a key={id} href={"#" + id} onClick={() => setOpen(o => ({ ...o, [id]: true }))}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.surface; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.card; }}
            style={{ fontSize: 12.5, fontWeight: 800, color: T.text, textDecoration: "none", padding: "9px 16px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card, whiteSpace: "nowrap", transition: "border-color 0.15s, background 0.15s" }}>{label}</a>
        ))}
      </div>

      {/* page guide — how this page works (first landing) */}
      {guide && (
        <div style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: 12, padding: "13px 16px", margin: "10px 0 4px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.6, flex: 1 }}>
              <b style={{ color: T.text }}>How this page works:</b> the sections below follow the job in order — build the products, get the client approved and paid, buy blanks and send POs, then ship. Inside each section, the <b style={{ color: T.text }}>filled white button is always your next step</b>. Tap any product card to open its worksheet (sizes, pricing, art in one place). Amber anywhere means something needs a human.
            </div>
            <button onClick={() => setGuidePersist(false)} style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#0a0a0a", background: T.accent, border: "none", borderRadius: 999, padding: "6px 14px", cursor: "pointer", fontFamily: font }}>Got it — hide guides</button>
          </div>
        </div>
      )}

      {/* PRODUCTS gallery */}
      {block("products", "done", "Products & Costing", `${items.length} items · ${units.toLocaleString()} units · ${fmtMoney(orderTotal)}`, (
        <>
          {tip(<><b style={{ color: T.text }}>Everything about the products lives here.</b> The margin buttons and toggles reprice every item instantly — the price each item sells at is what lands on the quote and invoice. Tap a card for its worksheet: <b style={{ color: T.text }}>Build</b> (name, blank, sizes and quantities), <b style={{ color: T.text }}>Cost</b> (decoration, share groups, sell price), <b style={{ color: T.text }}>Art</b> (files and the proof editor). Add products from the catalogs with + Add product, drop PSDs or mockups anywhere on the grid to create items, and drag cards to reorder. Once a quote is sent, pricing locks — Unlock to revise.</>)}
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
                  <div style={{ position: "relative" }}>
                    <button onClick={() => setCostReqMenu(m => !m)} style={{ fontSize: 11, fontWeight: 700, padding: "6px 13px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card, color: T.text, cursor: "pointer", fontFamily: font }}>Cost request ▾</button>
                    {costReqMenu && (
                      <>
                        <div onClick={() => setCostReqMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                        <div style={{ position: "absolute", top: 32, right: 0, zIndex: 41, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, minWidth: 210, padding: 5, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
                          <button onClick={() => { setCostReqMenu(false); setRfqOpen(true); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: T.text, borderRadius: 7 }}>Decorator quote (RFQ)</button>
                          <button onClick={() => { setCostReqMenu(false); setArtReqOpen(true); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: T.text, borderRadius: 7 }}>Art pricing request</button>
                        </div>
                      </>
                    )}
                  </div>
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
          <div style={{ fontSize: 11.5, color: T.faint, padding: "8px 0 12px" }}>Tap a product for its worksheet — sizes, blank cost, decoration, vendor &amp; margin. Drag cards to reorder · drop PSDs/mockups anywhere here to create items.</div>
          {/* auto-FILL (not -fit): empty tracks stay, so one product renders as
              one quarter-width card instead of a full-page banner (Jon, Jul 29) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(max(210px, calc((100% - 36px) / 4)), 1fr))", gap: 12 }}
            onDragOver={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
            onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); processFileDrop(e.dataTransfer.files); } }}>
            {items.map((item: any, i: number) => {
              const thumb = thumbOf(item.id);
              const q = qtyOf(item);
              const line = (Number(item.sell_per_unit) || 0) * q;
              return (
                <div key={item.id} onClick={() => { setWsIndex(i); setWsTask("build"); }}
                  draggable={!locked}
                  onDragStart={e => { setDragId(item.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={e => { if (dragId) { e.preventDefault(); e.stopPropagation(); } }}
                  onDrop={e => { if (dragId) { e.preventDefault(); e.stopPropagation(); dropOnCard(item.id); } }}
                  style={{ background: T.surface, border: `1px solid ${dragId === item.id ? T.accent : T.border}`, borderRadius: 14, overflow: "hidden", cursor: "pointer", opacity: dragId === item.id ? 0.55 : 1 }}>
                  <div style={{ aspectRatio: "1/1", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, position: "relative" }}>
                    {/* letter designator — canonical: position in the full sort_order list */}
                    <span style={{ position: "absolute", top: 6, left: 6, width: 20, height: 20, borderRadius: "50%", background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#0a0a0a", fontFamily: mono, boxShadow: "0 1px 2px rgba(0,0,0,0.12)", border: "1px solid rgba(0,0,0,0.12)" }}>{String.fromCharCode(65 + i)}</span>
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
      {block("client", tm.change_request || flags.grew ? "warn" : flags.approved ? "done" : "todo", "Approvals & Billing",
        `${flags.approved ? "Approved" : flags.quoted ? "Quote sent" : "Not sent"} · ${invNum ? "Inv " + invNum : "no invoice"} · ${fmtMoney(paid)} paid${(invoiced || orderTotal) - paid > 0.01 ? ` · ${fmtMoney((invoiced || orderTotal) - paid)} due` : ""}${flags.grew ? " · ⚠ re-invoice" : ""}${tm.change_request ? " · ⚠ changes requested" : ""}`, (
        <div>
          {tip(<><b style={{ color: T.text }}>The client transaction, start to finish.</b> Send quote &amp; proofs = one email with one portal link where the client reviews and approves everything together. Once approved, Send invoice creates the QuickBooks invoice and emails it with a pay link; if the order changes later the button turns amber (<b style={{ color: T.text }}>Send revised invoice</b>) and updates the same QB invoice in place. Record payment logs money received (prefilled with the balance). The green <b style={{ color: T.text }}>✓ QB IN SYNC</b> badge means our numbers match QuickBooks to the cent; after shipping, Reconcile bills the actual quantities. Previews and the client hub live under ⋯.</>)}
          {/* client change request (portal) — the note + tagged items, until
              dismissed here or cleared by the next approval */}
          {tm.change_request && (() => {
            const cr = tm.change_request;
            return (
              <div style={{ border: `1px solid ${T.amber}66`, background: `${T.amber}12`, borderRadius: 10, padding: "11px 14px", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.amber }}>Client requested changes</span>
                  <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>{fmtDT(cr.at)}</span>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => saveTypeMeta({ change_request: null })} title="Clear once handled — re-sending proofs and the next approval also clear it"
                    style={{ fontSize: 11, fontWeight: 700, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 999, padding: "4px 12px", cursor: "pointer", fontFamily: font }}>Dismiss</button>
                </div>
                {cr.note && <div style={{ fontSize: 13, color: T.text, marginTop: 7, lineHeight: 1.45 }}>&ldquo;{cr.note}&rdquo;</div>}
                {(cr.itemIds || []).length > 0 && (
                  <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6 }}>
                    On: {(cr.itemIds || []).map((id: string) => { const it = items.find((x: any) => x.id === id); return it ? `${letterOf(id)} · ${it.name}` : null; }).filter(Boolean).join("  ·  ") || (cr.itemNames || []).join(" · ")}
                    <span style={{ color: T.faint }}> — art gates reopened; rework in the worksheet, then send revised proofs.</span>
                  </div>
                )}
              </div>
            );
          })()}
          {/* missing proof PDFs — proofs built but never baked to Drive
              (classic-era sends never baked). Runs the send-time bake pass
              WITHOUT sending anything. */}
          {(() => {
            const needBake = items.filter((it: any) => it.proof_spec && ((it.proof_spec.bakedRendererVersion == null) || it.proof_spec.bakedRendererVersion < PROOF_RENDERER_VERSION));
            if (!needBake.length || bakeIds) return null;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: `1px solid ${T.border}`, background: T.surface, borderRadius: 10, padding: "9px 13px", marginBottom: 12 }}>
                <span style={{ fontSize: 12.5, color: T.muted, flex: 1, minWidth: 180 }}>{needBake.length} proof PDF{needBake.length === 1 ? "" : "s"} not in Drive yet (built before send-time baking).</span>
                <button onClick={() => bakeProofPdfs(needBake.map((x: any) => x.id))} style={ghostBtn}>Bake to Drive — no emails</button>
              </div>
            );
          })()}
          {/* revised-proof nudge — revised proofs re-uploaded but not re-sent */}
          {(() => {
            const revisedItems = items.filter((it: any) => (filesByItem[it.id] || []).some((f: any) => f.stage === "proof" && f.revision_pending_send));
            if (!revisedItems.length) return null;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: `1px solid ${T.amber}55`, background: `${T.amber}12`, borderRadius: 10, padding: "10px 13px", marginBottom: 12 }}>
                <span style={{ fontSize: 12.5, color: T.text, flex: 1, minWidth: 180 }}>
                  <span style={{ fontWeight: 800, color: T.amber }}>{revisedItems.length} revised proof{revisedItems.length === 1 ? "" : "s"}</span> not yet sent — {revisedItems.map((it: any) => it.name).join(", ")}
                </span>
                <button onClick={() => { const sel: Record<string, boolean> = {}; flatContacts.forEach((c: any) => { sel[c.email] = true; }); setRevisedSel(sel); setRevisedNote(""); setRevisedOpen(true); }}
                  style={{ ...actBtn, background: T.amber, color: "#fff" }}>Send revised proofs</button>
              </div>
            );
          })()}
          {/* client transaction actions — the FILLED button is always the next
              step: send quote → send invoice → record payment. */}
          {(() => {
            // Out of sync with QB (order changed since invoicing) → the next
            // action is a REVISED invoice send, and it says so.
            const needsRevise = !!invNum && Math.abs(toInvoice) > 0.01;
            const primary = !flags.approved ? "quote" : (!invNum || needsRevise) ? "invoice" : paid < orderTotal ? "payment" : null;
            return (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <button onClick={() => openSend("quote")} style={primary === "quote" ? actBtn : ghostBtn}>{job.quote_approved ? "Send proofs" : "Send quote & proofs"}</button>
                {job.quote_approved
                  ? <button onClick={doRevoke} disabled={actBusy} style={ghostBtn}>Approved ✓ · revoke</button>
                  : <button onClick={doApprove} disabled={actBusy} style={ghostBtn}>Mark approved</button>}
                <button onClick={() => openSend("invoice")} style={primary === "invoice" ? (needsRevise ? { ...actBtn, background: T.amber, color: "#fff" } : actBtn) : ghostBtn}>{needsRevise ? "Send revised invoice" : "Send invoice"}</button>
                <button onClick={() => { setActErr(""); const bal = Math.max(0, (invoiced || orderTotal) - paid); setPayForm(f => ({ ...f, amount: f.amount || (bal > 0 ? bal.toFixed(2) : "") })); setClientAction("payment"); }} style={primary === "payment" ? actBtn : ghostBtn}>+ Record payment</button>
                {/* previews + hub — tucked into ⋯ */}
                <div style={{ position: "relative" }}>
                  <button onClick={() => setClientMenu(m => !m)} title="Previews & hub" style={{ ...ghostBtn, padding: "9px 13px", fontWeight: 900 }}>⋯</button>
                  {clientMenu && (
                    <>
                      <div onClick={() => setClientMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                      <div style={{ position: "absolute", top: 40, right: 0, zIndex: 41, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, minWidth: 175, padding: 5, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
                        {[
                          ["Preview quote", `/api/pdf/quote/${job.id}`],
                          ...(invNum ? [["Preview invoice", `/api/pdf/invoice/${job.id}`]] : []),
                          ...(job?.portal_token ? [["Client hub ›", `/portal/${job.portal_token}`]] : []),
                        ].map(([label, href]) => (
                          <a key={label} href={href} target="_blank" rel="noreferrer" onClick={() => setClientMenu(false)}
                            style={{ display: "block", padding: "9px 12px", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: T.text, borderRadius: 7, textDecoration: "none" }}>{label}</a>
                        ))}
                        {invNum && (
                          <button onClick={doResyncQb} disabled={actBusy} title={needsRevise ? `Order changed by $${Math.abs(toInvoice).toFixed(2)} — update QB #${invNum} without emailing the client` : `Push current pricing to QB #${invNum} without emailing the client`}
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: needsRevise ? T.amber : T.muted, borderRadius: 7, background: "none", border: "none", cursor: actBusy ? "default" : "pointer" }}>
                            {actBusy ? "Syncing QB…" : needsRevise ? `Re-sync QB #${invNum} · don’t send` : "Re-sync QuickBooks"}
                          </button>
                        )}
                        {!invNum && (
                          <button onClick={doQuietQb} disabled={actBusy}
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: T.muted, borderRadius: 7, background: "none", border: "none", cursor: actBusy ? "default" : "pointer" }}>
                            {actBusy ? "Creating in QB…" : "Create QB invoice · don’t send"}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {actErr && <div style={{ width: "100%", color: T.red, fontSize: 12 }}>{actErr}</div>}
              </div>
            );
          })()}
          {/* ── ORDER + BILLING — two compact columns; label sits NEXT to its
              value (full-width justified rows were unscannable). ── */}
          {(() => {
            const row = (l: string, v: React.ReactNode) => (
              <div key={l} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 13, alignItems: "baseline" }}>
                <span style={{ color: T.faint, width: 86, flexShrink: 0 }}>{l}</span>
                <span style={{ fontWeight: 700, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>{v}</span>
              </div>
            );
            const balDue = (invoiced || orderTotal) - paid;
            return (
              <div style={{ display: "flex", gap: 44, flexWrap: "wrap", padding: "6px 0 4px" }}>
                <div style={{ flex: "0 1 auto", minWidth: 220 }}>
                  <div style={{ ...lbl, marginBottom: 4 }}>Order</div>
                  {row("Quote", flags.approved ? "Sent · Approved" : flags.quoted ? "Sent" : "Not sent")}
                  {row("Proofs", `${artApproved}/${items.length} approved`)}
                </div>
                <div style={{ flex: "1 1 auto", minWidth: 260 }}>
                  <div style={{ ...lbl, marginBottom: 4 }}>Billing</div>
                  {row("Invoice", invNum ? (
                    <>
                      <span>{invNum} · sent</span>
                      {Math.abs(toInvoice) <= 0.01
                        ? <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: T.green }}>✓ QB in sync</span>
                        : <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: T.amber }} title={`OpsHub order ${fmtMoney(orderTotal)} vs QB ${fmtMoney(invoicedSub)} (pre-tax). Send invoice re-pushes.`}>⚠ off {fmtMoney(Math.abs(toInvoice))} vs QB</span>}
                    </>
                  ) : "not sent")}
                  {tm.qb_invoice_id && row("Pay link", (
                    <>
                      {tm.qb_payment_link
                        ? <a href={tm.qb_payment_link} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: T.green, textDecoration: "none" }}>Open ↗</a>
                        : <span style={{ color: linkErr ? T.red : T.faint }}>{linkErr || "none"}</span>}
                      <button onClick={doRefreshLink} disabled={refreshingLink} style={{ background: "none", border: "none", color: T.accent, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font, padding: 0 }}>
                        {refreshingLink ? "Refreshing…" : tm.qb_payment_link ? "Refresh" : "Create"}
                      </button>
                    </>
                  ))}
                  {flags.grew && row("Outstanding", <span style={{ color: T.amber }}>{fmtMoney(toInvoice)} added since invoicing — re-invoice</span>)}
                  {invNum && row("Balance", balDue > 0.01
                    ? <span style={{ fontWeight: 800, color: T.amber, fontFamily: mono }}>{fmtMoney(balDue)} due</span>
                    : <span style={{ color: T.green }}>Paid in full</span>)}
                  {/* reconcile at ship — bill ACTUAL qtys; also the heal path
                      for direct-in-QB edits (Re-review). Classic InvoiceSurface flow. */}
                  {invNum && (() => {
                    const s: any = deriveInvoice(job, items, payments);
                    if (s.variancePushedAt) return row("Reconcile", (
                      <>
                        <span style={{ color: T.green }}>✓ finalized {fmtDT(s.variancePushedAt)}</span>
                        <button onClick={() => setShowVariance(true)} style={{ background: "none", border: `1px solid ${T.border}`, color: T.muted, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, cursor: "pointer", fontFamily: font }}>Re-review</button>
                        {/* 1e fix (c): un-finalize — clears the variance stamp so
                            staleness checks + the reconcile step come back live.
                            Two-tap arm instead of browser confirm (DESIGN.md). */}
                        <button onClick={async () => {
                          if (!reopenArm) { setReopenArm(true); setTimeout(() => setReopenArm(false), 4000); return; }
                          setReopenArm(false);
                          const tm = { ...(job.type_meta || {}) };
                          delete tm.qb_variance_pushed_at; delete tm.qb_variance_total; delete tm.qb_variance_tax; delete tm.qb_variance_billable_qtys;
                          await (createClient().from("jobs") as any).update({ type_meta: tm }).eq("id", job.id);
                          setJob((j: any) => ({ ...j, type_meta: tm }));
                          try { logJobActivity(job.id, "Invoice reconcile reopened — finalization cleared"); } catch {}
                          refetchTypeMeta();
                        }} style={{ background: "none", border: "none", color: reopenArm ? T.red : T.faint, fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                          {reopenArm ? "tap again to reopen" : "Reopen"}
                        </button>
                      </>
                    ));
                    if (s.step === "reconcile") return row("Reconcile", (
                      <>
                        <span style={{ color: T.amber }}>⚠ shipped — bill actual qtys</span>
                        <button onClick={() => setShowVariance(true)} style={{ background: T.amber, border: "none", color: "#fff", fontSize: 11, fontWeight: 800, padding: "4px 12px", borderRadius: 999, cursor: "pointer", fontFamily: font }}>Review &amp; finalize</button>
                      </>
                    ));
                    return row("Reconcile", <span style={{ color: T.faint, fontWeight: 500 }}>after ship</span>);
                  })()}
                </div>
              </div>
            );
          })()}

          {/* Additional charges — invoice extra lines (same shape as classic:
              rides the quote PDF + billable total; QB push is Phase 2). */}
          <div style={{ padding: "12px 0", borderBottom: `1px solid ${T.border}55` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: extraLines.length ? 8 : 0 }}>
              <span style={lbl}>Additional charges{extrasTotal ? ` · ${fmtMoney(extrasTotal)}` : ""}</span>
              <button onClick={() => saveTypeMeta({ invoice_extra_lines: [...extraLines, { id: `xl_${Date.now()}`, description: "", amount: 0, qb_item: "Service Fee", type: "fee" }] })}
                style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.text, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: font }}>+ Add line</button>
            </div>
            {extraLines.map((l: any) => (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 100px 24px", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <input defaultValue={l.description} placeholder="e.g. Rush fee" onBlur={e => saveTypeMeta({ invoice_extra_lines: extraLines.map((x: any) => x.id === l.id ? { ...x, description: e.target.value } : x) })}
                  style={{ ...field, padding: "6px 8px", fontSize: 12 }} />
                <input defaultValue={l.amount} inputMode="decimal" placeholder="0.00" onBlur={e => saveTypeMeta({ invoice_extra_lines: extraLines.map((x: any) => x.id === l.id ? { ...x, amount: parseFloat(e.target.value) || 0 } : x) })}
                  style={{ ...field, padding: "6px 8px", fontSize: 12, fontFamily: mono, textAlign: "right" }} />
                <select value={l.type || "fee"} onChange={e => saveTypeMeta({ invoice_extra_lines: extraLines.map((x: any) => x.id === l.id ? { ...x, type: e.target.value } : x) })}
                  style={{ ...field, padding: "6px 8px", fontSize: 12 }}>
                  {["fee", "passthru", "charge", "discount"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={() => saveTypeMeta({ invoice_extra_lines: extraLines.filter((x: any) => x.id !== l.id) })} title="Remove"
                  style={{ background: "transparent", border: "none", color: T.faint, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>

          {/* payments — terms + records (click status to cycle, × to delete) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 8px", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...lbl, display: "flex", alignItems: "center", gap: 8 }}>Payments · {fmtMoney(paid)} paid of {fmtMoney(invoiced || orderTotal)}{(invoiced || orderTotal) - paid > 0.01 && <span style={{ color: T.amber }}>· {fmtMoney((invoiced || orderTotal) - paid)} due</span>}
              <button onClick={() => { setActErr(""); const bal = Math.max(0, (invoiced || orderTotal) - paid); setPayForm(f => ({ ...f, amount: f.amount || (bal > 0 ? bal.toFixed(2) : "") })); setClientAction("payment"); }}
                style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.text, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 6, cursor: "pointer", fontFamily: font, letterSpacing: 0, textTransform: "none" }}>+ Record</button>
            </span>
            <select value={job.payment_terms || ""} onChange={e => saveJobCol("payment_terms", e.target.value)} style={{ ...field, width: "auto", padding: "6px 9px", fontSize: 12 }}>
              <option value="">Terms…</option>
              <option value="prepaid">Prepaid</option>
              <option value="deposit_balance">50% Deposit / Balance</option>
              <option value="net_15">Net 15</option>
              <option value="net_30">Net 30</option>
            </select>
          </div>
          {payments.length === 0 ? <div style={{ fontSize: 12.5, color: T.faint, paddingBottom: 4 }}>No payments recorded.</div> : payments.map((p: any) => {
            const sc = p.status === "paid" ? T.green : p.status === "partial" ? T.amber : p.status === "overdue" ? T.red : p.status === "void" ? T.faint : T.muted;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 13 }}>
                <span style={{ fontFamily: mono, fontWeight: 700, minWidth: 86, textAlign: "right" }}>{fmtMoney(p.amount)}</span>
                <button onClick={() => cyclePay(p)} title="Click to cycle status" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: sc, background: "none", border: `1px solid ${sc}55`, borderRadius: 999, padding: "3px 9px", cursor: "pointer", fontFamily: font }}>{p.status || "draft"}</button>
                <span style={{ color: T.muted }}>{String(p.type || "").replace(/_/g, " ")}{p.invoice_number ? ` · #${p.invoice_number}` : ""}{p.paid_date ? ` · ${p.paid_date}` : ""}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => delPay(p.id)} title="Delete" style={{ background: "none", border: "none", color: T.faint, fontSize: 14, cursor: "pointer" }}>×</button>
              </div>
            );
          })}

          {/* contacts — add / remove */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 8px", paddingTop: 12, borderTop: `1px solid ${T.border}44` }}>
            <span style={lbl}>Contacts</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button onClick={syncContacts} title="Pull in any client contacts not yet on this project" style={{ ...ghostBtn, padding: "5px 11px", fontSize: 11 }}>Sync</button>
              {!contactForm && <button onClick={() => setContactForm({ name: "", email: "", phone: "", role: "cc" })} style={{ ...ghostBtn, padding: "5px 11px", fontSize: 11 }}>+ Add</button>}
            </span>
          </div>
          {localContacts.length === 0 && !contactForm ? <div style={{ fontSize: 12.5, color: T.faint }}>No contacts on this job.</div> : localContacts.map((c: any) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.border}44`, fontSize: 13 }}>
              <span style={{ flex: 1 }}>{c.contacts?.name || c.contacts?.email}<span style={{ color: T.faint }}> · {c.contacts?.email || "no email"}{c.role_on_job ? " · " + c.role_on_job : ""}</span></span>
              <button onClick={() => removeContact(c.id)} title="Remove" style={{ background: "none", border: "none", color: T.faint, fontSize: 14, cursor: "pointer" }}>×</button>
            </div>
          ))}
          {contactForm && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              <input value={contactForm.name} onChange={e => setContactForm(f => f && { ...f, name: e.target.value })} placeholder="Name" style={{ ...field, flex: "1 1 120px", width: "auto" }} />
              <input value={contactForm.email} onChange={e => setContactForm(f => f && { ...f, email: e.target.value })} placeholder="Email" style={{ ...field, flex: "1 1 140px", width: "auto" }} />
              <select value={contactForm.role} onChange={e => setContactForm(f => f && { ...f, role: e.target.value })} style={{ ...field, width: "auto" }}>
                {["primary", "billing", "creative", "logistics", "cc"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={addContact} style={actBtn}>Add</button>
              <button onClick={() => setContactForm(null)} style={ghostBtn}>Cancel</button>
            </div>
          )}
        </div>
      ))}

      {/* PRODUCTION */}
      {block("production", phase === "production" ? "now" : beyond(phase, ["receiving", "fulfillment", "complete"]) ? "done" : "todo", "Purchasing & Production",
        `${blanksOrdered}/${items.length} blanks · ${Object.keys(vendorGroups).filter(v => poSentVendors.includes(v)).length}/${Object.keys(vendorGroups).length} POs sent`, (
        <div>
          {tip(<><b style={{ color: T.text }}>Buy blanks, then send POs.</b> The gate strip goes green when the quote is approved, payment is covered for the terms, and all proofs are approved — order nothing before that. Each blanks row is a read-out for the supplier order: PO reference, brand/style/color, and per-size counts to type into the supplier cart, then log the <b style={{ color: T.text }}>total paid</b> (select several rows to split one card charge across them). Below, each vendor card previews and sends the PO email — sending moves the items into production and starts vendor tracking. Item details holds the per-item PO notes and links.</>)}
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
          {/* Each row is a READ-OUT for manual supplier entry (OpsHub in one
              window, the supplier cart in the other): PO ref with letter,
              brand/style/color big, and the per-size counts in clear view.
              Logging = just the total paid (ordered ⇢ cost logged). */}
          {items.map((item: any) => {
            const calc = calcBlank(item);
            const ordered = item.blanks_order_cost != null && item.blanks_order_cost !== "";
            const actual = ordered ? Number(item.blanks_order_cost) : null;
            const sel = selectedIds.has(item.id);
            const sizes = sortSizes(Object.keys(item.qtys || {})).filter(sz => (item.qtys?.[sz] || 0) > 0);
            return (
              <div key={item.id} style={{ display: "flex", gap: 14, padding: "13px 0", borderBottom: `1px solid ${T.border}44`, flexWrap: "wrap", alignItems: "flex-start" }}>
                <input type="checkbox" checked={sel} onChange={() => toggleSel(item.id)} style={{ width: 15, height: 15, accentColor: T.accent, cursor: "pointer", marginTop: 5 }} />
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    {/* Purchasing reference = QB invoice number (matches how vendor
                        invoices tie back to invoiced jobs — same DELIBERATE rule as
                        the vendor portal PO number). Job number only pre-invoice. */}
                    <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 800, color: T.text }}>{(tm.qb_invoice_number || job.job_number)}-{letterOf(item.id)}</span>
                    <span style={{ fontSize: 12, color: T.faint }}>{item.name}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
                    {item.blank_vendor || <span style={{ color: T.amber }}>No blank assigned</span>}
                    {item.blank_sku && <span style={{ color: T.muted, fontWeight: 700 }}> · {item.blank_sku}</span>}
                  </div>
                  {sizes.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                      {sizes.map(sz => (
                        <span key={sz} style={{ display: "inline-flex", alignItems: "baseline", gap: 5, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 7, padding: "4px 9px" }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>{sz}</span>
                          <span style={{ fontSize: 14, fontWeight: 800, fontFamily: mono }}>{item.qtys[sz]}</span>
                        </span>
                      ))}
                      <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, color: T.faint, fontFamily: mono, paddingLeft: 4 }}>= {qtyOf(item).toLocaleString()} u</span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>est {fmtMoney(calc)}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <span style={{ fontSize: 11, color: T.faint }}>$</span>
                    <input key={item.id + ":c:" + (item.blanks_order_cost ?? "")} defaultValue={actual != null ? actual.toFixed(2) : ""} placeholder="total paid" inputMode="decimal" onBlur={e => saveBlankCost(item, e.target.value)}
                      style={{ width: 84, padding: "6px 8px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: mono, outline: "none" }} />
                  </div>
                  <span style={{ width: 108, textAlign: "right", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: ordered ? (actual! > calc + 0.005 ? T.red : T.green) : T.faint }}>
                    {!ordered ? "—"
                      : Math.abs(actual! - calc) < 0.005 ? "logged ✓ exact"
                      : actual! > calc ? `+${fmtMoney(actual! - calc)} over`
                      : `−${fmtMoney(calc - actual!)} under`}
                  </span>
                </div>
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
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 4, fontFamily: mono }}>{vitems.map((it: any) => `${letterOf(it.id)} · ${it.name}`).join("  ·  ")} · {vUnits.toLocaleString()} u{(job.type_meta?.po_ship_methods || {})[vendor] ? ` · ${(job.type_meta.po_ship_methods)[vendor]}` : ""}</div>
                  {!allBlanks && <div style={{ fontSize: 11, color: T.amber, marginTop: 6 }}>⚠ Not all blanks ordered for this vendor.</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
                    <a href={`/api/pdf/po/${job.id}?vendor=${encodeURIComponent(vendor)}${sent ? "&revised=1" : ""}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, fontWeight: 800, color: T.text, textDecoration: "none", padding: "8px 15px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card }}>Preview PO</a>
                    <button onClick={() => openPoSend(vendor)} style={sent ? ghostBtn : actBtn}>{sent ? "Re-send PO" : "Send PO"}</button>
                    {sent ? <button onClick={() => unmarkPoSent(vendor)} style={ghostBtn}>Unmark</button> : <button onClick={() => markPoSent(vendor)} style={ghostBtn}>Mark sent</button>}
                    <button onClick={() => setExpandedVendor(v => v === vendor ? null : vendor)} style={ghostBtn}>{expandedVendor === vendor ? "Hide items ▴" : "Item details ▾"}</button>
                  </div>
                  {expandedVendor === vendor && (
                    <div style={{ marginTop: 12, borderTop: `1px solid ${T.border}44`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                      {vitems.map((item: any) => {
                        const poField = (fieldK: "drive_link" | "incoming_goods" | "production_notes_po" | "packing_notes", label: string, area = false) => (
                          <label style={{ flex: area ? "1 1 100%" : "1 1 45%", minWidth: 150 }}>
                            <span style={{ ...lbl, display: "flex", justifyContent: "space-between", marginBottom: 4 }}>{label}{vitems.length > 1 && item[fieldK] && <button onClick={() => copyPOToAll(vendor, fieldK, item[fieldK])} style={{ background: "none", border: "none", color: T.accent, fontSize: 9, fontWeight: 700, cursor: "pointer", letterSpacing: 0, textTransform: "none" }}>↓ all</button>}</span>
                            {area
                              ? <textarea key={item.id + fieldK + (item[fieldK] || "")} defaultValue={item[fieldK] || ""} onBlur={e => saveItemPO(item, fieldK, e.target.value)} rows={2} style={{ ...field, resize: "vertical", fontSize: 12 }} />
                              : <input key={item.id + fieldK + (item[fieldK] || "")} defaultValue={item[fieldK] || ""} onBlur={e => saveItemPO(item, fieldK, e.target.value)} style={{ ...field, fontSize: 12 }} />}
                          </label>
                        );
                        return (
                          <div key={item.id} style={{ background: T.card, borderRadius: 10, padding: "10px 12px" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 700 }}><span style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 800, color: T.faint, marginRight: 7 }}>{letterOf(item.id)}</span>{item.name}</span>
                              <select value={item.shipping_route || ""} onChange={e => saveItemRoute(item, e.target.value)} title="Per-item route (blank = job route)" style={{ ...field, width: "auto", padding: "5px 8px", fontSize: 11 }}>
                                <option value="">route: job default</option>
                                {clientShippingRoutes().map(r => <option key={r} value={r}>{r.replace(/_/g, "-")}</option>)}
                                {item.shipping_route && !clientShippingRoutes().includes(item.shipping_route) && <option value={item.shipping_route}>{item.shipping_route}</option>}
                              </select>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                              {poField("drive_link", "Production files link")}
                              {poField("incoming_goods", "Incoming goods")}
                              {poField("production_notes_po", "Production notes", true)}
                              {poField("packing_notes", "Packing notes", true)}
                            </div>
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
      ))}

      {/* LOGISTICS */}
      {block("logistics", beyond(phase, ["receiving", "fulfillment", "complete"]) ? "now" : "todo", "Logistics",
        `${ROUTE_LABEL[route] || "route not set"} — ${phase === "receiving" ? "receiving" : phase === "fulfillment" ? "fulfillment" : "waiting on production"}`, (
        <div>
          {tip(<><b style={{ color: T.text }}>Where the goods go after the decorator.</b> The route decides the ship-to on every PO: drop ship goes straight to the client, ship-through and stage come to the HPD warehouse first (some vendors always ship to us regardless — set on the decorator). Receiving, staging, and outbound shipping happen on the warehouse boards; this section shows the truth of where things stand plus the packing slips.</>)}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.border}55`, fontSize: 13, gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: T.muted }}>Shipping route</span>
            <select value={route || ""} onChange={e => saveRoute(e.target.value)} style={{ ...field, width: "auto", minWidth: 260 }}>
              <option value="">— set route —</option>
              {/* tenant allow-list (DMD = ship_through only) — same as classic */}
              {clientShippingRoutes().includes("drop_ship") && <option value="drop_ship">Drop ship · vendor → client</option>}
              {clientShippingRoutes().includes("ship_through") && <option value="ship_through">Ship-through · → HPD → client</option>}
              {clientShippingRoutes().includes("stage") && <option value="stage">Stage · → HPD → fulfillment</option>}
              {route && !clientShippingRoutes().includes(route) && <option value={route}>{route}</option>}
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
          {/* packing slips — frozen per outbound shipment, or the live job-level slip */}
          {(() => {
            const hasShipping = items.some((x: any) => x.ship_tracking || x.received_at_hpd || x.pipeline_stage === "shipped");
            if (!forwardSlips.length && !hasShipping) return null;
            return (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${T.border}44` }}>
                <span style={{ ...lbl }}>Packing slips</span>
                {forwardSlips.length > 0
                  ? forwardSlips.map((s, i) => (
                    <a key={s.id} href={`/api/pdf/packing-slip/${job.id}?shipment=${s.id}`} target="_blank" rel="noreferrer" style={previewBtn}>
                      Slip · {s.tracking || i + 1}
                    </a>))
                  : <a href={`/api/pdf/packing-slip/${job.id}`} target="_blank" rel="noreferrer" style={previewBtn}>Packing slip</a>}
              </div>
            );
          })()}
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
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: isMobile ? "8px 4px" : "24px 14px", overflowY: "auto" }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: isMobile ? 12 : 16, width: "100%", maxWidth: 820, overflow: "hidden" }}>
            {/* nav strip */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}55` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setWsIndex((wsIndex! - 1 + items.length) % items.length)} aria-label="Previous item" style={navBtn}>‹</button>
                <button onClick={() => setWsIndex((wsIndex! + 1) % items.length)} aria-label="Next item" style={navBtn}>›</button>
                <span style={{ fontFamily: mono, fontSize: 12, color: T.faint, marginLeft: 6 }}>{wsIndex! + 1} / {items.length}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!locked && <><div style={{ position: "relative", display: "inline-flex" }}>
                  <button onClick={() => setWsMenu(m => !m)} title="More item actions" style={{ ...ghostBtn, padding: "6px 11px", fontWeight: 900 }}>⋯</button>
                  {wsMenu && (
                    <>
                      <div onClick={() => setWsMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                      <div style={{ position: "absolute", top: 34, right: 0, zIndex: 41, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, minWidth: 200, padding: 5, boxShadow: "0 12px 40px rgba(0,0,0,0.4)" }}>
                        <button onClick={async () => { setWsMenu(false); if (!window.confirm(`Duplicate "${it.name}" on this job? Files are shared; blank and decoration carry over.`)) return; try { const r = await fetch(`/api/items/${it.id}/duplicate`, { method: "POST" }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Duplicate failed"); window.location.reload(); } catch (e: any) { failed("Item duplicate failed", e); } }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: T.text, borderRadius: 7 }}>Duplicate item</button>
                        <button onClick={() => { setWsMenu(false); setMoveItem({ id: it.id, name: it.name, mode: "copy" }); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: T.text, borderRadius: 7 }}>Copy to another job…</button>
                        <button onClick={() => { setWsMenu(false); setMoveItem({ id: it.id, name: it.name, mode: "move" }); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: T.text, borderRadius: 7 }}>Move to another job…</button>
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => removeProduct(it)} title="Remove product from job" style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 999, color: T.muted, fontSize: 11, fontWeight: 700, padding: "6px 12px", cursor: "pointer", fontFamily: font }}>Remove</button></>}
                <button onClick={() => setWsIndex(null)} aria-label="Close" style={{ ...navBtn, background: T.surface }}>×</button>
              </div>
            </div>
            {/* item head */}
            <div style={{ display: "flex", gap: 14, padding: "16px 18px", alignItems: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: 10, background: "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
                {thumbOf(it.id) ? <img src={thumbSrc(thumbOf(it.id))} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 10 }} /> : "👕"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: T.accent, color: "#0a0a0a", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, fontFamily: mono, flexShrink: 0 }}>{String.fromCharCode(65 + wsIndex!)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                </div>
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
                const sizes = sortSizes(Object.keys(it.qtys || {}));
                const avail = ADD_SIZES.filter(s => !(it.qtys && s in it.qtys));
                const dimensional = !!parseSizeMatrix(sizes, it.qtys || null);
                return (
                  <div>
                    {/* name */}
                    <label style={{ display: "block", marginBottom: 12 }}>
                      <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Product name</span>
                      <input key={it.id + ":name:" + it.name} defaultValue={it.name || ""} readOnly={locked} onBlur={e => renameItem(it, e.target.value)} style={field} />
                    </label>
                    {tip(<>Name, product type, and quantities live here. The blank itself comes from <b style={{ color: T.text }}>Pick/Swap blank</b> (full supplier catalogs) so costs always match a real product. Type a total into <b style={{ color: T.text }}>→ CURVE</b> to spread it across sizes automatically, or Edit sizes for youth, one-size, and pants grids.</>)}
                    {/* garment + blank (editable text; full catalog picker is separate) */}
                    <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                      <label style={{ flex: "1 1 130px" }}>
                        <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Product type</span>
                        <select value={it.garment_type || ""} disabled={locked} onChange={e => saveGarmentType(it, e.target.value)} style={field}>
                          <option value="">— type —</option>
                          {ADD_GARMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          {it.garment_type && !ADD_GARMENTS.some(([v]) => v === it.garment_type) && <option value={it.garment_type}>{it.garment_type.replace(/_/g, " ")}</option>}
                        </select>
                      </label>
                      <label style={{ flex: "0 1 120px" }}>
                        {/* Client retail = what THEIR shop charges. Powers release
                            planning + re-run prefills; not part of costing math,
                            so no financial refresh and never locked. */}
                        <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Client retail</span>
                        <input key={it.id + ":retail:" + (it.client_retail_per_unit ?? "")} defaultValue={it.client_retail_per_unit ?? ""}
                          inputMode="decimal" placeholder="$"
                          onBlur={async e => {
                            const raw = e.target.value.replace(/[^0-9.]/g, "");
                            const v = raw === "" ? null : Math.round(Number(raw) * 100) / 100;
                            if (v === (it.client_retail_per_unit ?? null)) return;
                            await (createClient().from("items") as any).update({ client_retail_per_unit: v }).eq("id", it.id);
                            setItems(prev => prev.map((x: any) => x.id === it.id ? { ...x, client_retail_per_unit: v } : x));
                          }} style={field} />
                      </label>
                      {!locked && (
                        <div style={{ flex: "0 0 auto" }}>
                          {/* hidden caption keeps the button on the same
                              baseline as the labeled columns beside it */}
                          <span style={{ ...lbl, display: "block", marginBottom: 5, visibility: "hidden" }}>Fleece</span>
                          <button onClick={() => toggleFleece(it)} title="Fleece applies the decorator's per-print fleece upcharge + fleece packaging"
                            style={{ display: "block", fontSize: 10, fontWeight: 700, padding: "10px 12px", borderRadius: 8, border: `1px solid ${it.is_fleece ? T.green : T.border}`, background: it.is_fleece ? T.green : T.card, color: it.is_fleece ? "#fff" : T.muted, cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: font, lineHeight: "17.5px", boxSizing: "border-box" }}>
                            {it.is_fleece ? "Fleece ✓" : "Fleece?"}
                          </button>
                        </div>
                      )}
                      {/* Blank + color are READ-ONLY here — the picker owns them
                          (Pick/Swap blank), same ownership rule as classic. */}
                      <div style={{ flex: "1 1 130px" }}>
                        <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Blank</span>
                        <div style={{ padding: "10px 0", fontSize: 13.5, fontWeight: 700, color: it.blank_vendor ? T.text : T.faint }}>{it.blank_vendor || "—"}</div>
                      </div>
                      <div style={{ flex: "1 1 110px" }}>
                        <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Color</span>
                        <div style={{ padding: "10px 0", fontSize: 13.5, fontWeight: 700, color: it.blank_sku ? T.text : T.faint }}>{it.blank_sku || "—"}</div>
                      </div>
                      {!locked && (
                        <button onClick={() => { setAssignTargetId(it.id); setPickerSrc("src"); }}
                          style={{ ...ghostBtn, alignSelf: "flex-end", whiteSpace: "nowrap" }}>{it.blank_vendor ? "Swap blank ▸" : "Pick blank ▸"}</button>
                      )}
                    </div>
                    {/* sizes + qty with remove + add */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={lbl}>Sizes &amp; quantities</span>
                      {!locked && <button onClick={() => setEditSizesFor(it.id)} style={{ ...ghostBtn, padding: "4px 11px", fontSize: 11 }}>Edit sizes ▸</button>}
                    </div>
                    {dimensional ? (
                      /* waist×inseam runs: the shared cut-ticket read-out; edits
                         go through the full editor (flat inputs would be soup) */
                      <div>
                        <SizeGrid labels={sizes} qtys={it.qtys || {}} palette={{ text: T.text, muted: T.muted, faint: T.faint, border: T.border, surface: T.surface }} mono={mono} />
                        <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>{qtyOf(it).toLocaleString()} units · Edit sizes ▸ opens the grid editor.</div>
                      </div>
                    ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                      {sizes.map(sz => (
                        <div key={it.id + "_" + sz + ":" + (it.qtys?.[sz] ?? "")} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", position: "relative" }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>{sz}</span>
                          <input type="text" inputMode="numeric" defaultValue={String(it.qtys?.[sz] ?? 0)} readOnly={locked}
                            onFocus={e => e.target.select()} onBlur={e => saveQty(it, sz, e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            style={{ width: 56, textAlign: "center", padding: "7px 6px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                          {/* tabIndex -1: tabbing runs qty→qty for fast entry — the × stays mouse-only (Jon, Jul 28) */}
                          {!locked && <button onClick={() => removeSize(it, sz)} title="Remove size" tabIndex={-1} style={{ position: "absolute", top: 10, right: -4, width: 15, height: 15, borderRadius: 999, border: "none", background: T.surface, color: T.faint, fontSize: 11, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>}
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
                      {!locked && sizes.length > 1 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", justifyContent: "flex-end", marginLeft: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }} title="Type a total — spreads across sizes by the sell-through curve">→ CURVE</span>
                          <input type="text" inputMode="numeric" placeholder="total" key={it.id + ":dist:" + qtyOf(it)}
                            onFocus={e => e.target.select()}
                            onBlur={e => { if (e.target.value.trim()) { distributeTotal(it, e.target.value); e.target.value = ""; } }}
                            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            style={{ width: 60, textAlign: "center", padding: "7px 6px", borderRadius: 8, border: `1px dashed ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                        </div>
                      )}
                    </div>
                    )}
                    <div style={{ fontSize: 11, color: locked ? T.amber : T.faint, marginTop: 14 }}>
                      {locked ? "🔒 Pricing is locked — unlock in Costing to edit." : "Saves to the buy sheet. Pick blank ▸ opens the full catalog (S&S, AS Colour, LA Apparel, Cotton Collective, Favorites)."}
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
                        {tip(<><b style={{ color: T.text }}>Sell/unit is the number the client is billed</b> — auto-calculated from costs + margin, or type an override. Decoration below drives the cost: vendor, print locations and colors, share groups (same art shared across items combines quantities for better rates and one set of screens). Blank cost by size holds 2XL/3XL upcharges. Everything saves as you go.</>)}
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

                        {/* decoration engine — DecorationPanel fed the full assembled array so
                            share groups (A–J / T1–T10) + qty tiers compute across items. */}
                        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.border}44` }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                            <span style={lbl}>Decoration</span>
                            {!locked && <button onClick={() => pullFromPsds()} disabled={pullingPsds} title="Seed print locations + color counts from uploaded PSDs (only items with no locations yet)"
                              style={{ ...ghostBtn, opacity: pullingPsds ? 0.6 : 1 }}>{pullingPsds ? "Pulling…" : "Pull from PSDs"}</button>}
                          </div>
                          <DecorationPanel p={allAssembled[wsIndex!]} i={wsIndex!} costProds={allAssembled} PRINTERS={printers} decoratorRecords={decoratorRecords} updateProd={updateProd} setCostProds={setCostProdsFn} lookupPrintPrice={lookupPrint} lookupTagPrice={lookupTag} costingLocked={locked} hideVendorApplyAll />
                        </div>

                        {/* raw blank-cost + shipping-buffer editors — bottom of the sheet
                            (writes items / costProd.shipRate) */}
                        {/* blank cost by size — THE blank-cost override surface
                            (single source: items.blank_costs; avg → cost_per_unit) */}
                        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end", marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.border}44` }}>
                          <div style={{ flex: "1 1 auto" }}>
                            <div style={{ ...lbl, marginBottom: 6 }}>Blank cost by size <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: T.faint }}>· avg ${Number(it.cost_per_unit || 0).toFixed(2)}/u</span></div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {sortSizes(Object.keys(it.qtys || {})).map(sz => {
                                const v = Number((it.blank_costs || {})[sz] ?? it.cost_per_unit ?? 0);
                                return (
                                  <div key={it.id + ":bcs:" + sz + ":" + v} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                                    <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>{sz}</span>
                                    <input type="text" inputMode="decimal" defaultValue={v ? v.toFixed(2) : ""} placeholder="0.00" readOnly={locked}
                                      onFocus={e => e.target.select()} onBlur={e => saveBlankSizeCost(it, sz, e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                      style={{ width: 62, textAlign: "center", padding: "7px 5px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 12.5, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                                  </div>
                                );
                              })}
                              {!Object.keys(it.qtys || {}).length && <span style={{ fontSize: 12, color: T.faint }}>No sizes yet — set them in Build.</span>}
                            </div>
                          </div>
                          <label style={{ flex: "0 1 190px" }}>
                            <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Shipping buffer / unit <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: T.faint }}>· blank = auto by garment</span></span>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 13, color: T.faint }}>$</span>
                              <input key={it.id + ":sr:" + (cp.shipRate ?? "")} defaultValue={cp.shipRate != null && cp.shipRate !== "" ? Number(cp.shipRate).toFixed(2) : ""} placeholder={"auto · $" + effectiveShipRate(allAssembled[wsIndex!]).toFixed(2)} inputMode="decimal" readOnly={locked}
                                onBlur={e => saveShipRate(it, e.target.value)}
                                style={{ flex: 1, padding: "9px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                            </div>
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
              {wsTask === "art" && (() => {
                // Packing slips attach per-item in the DB (receiving/notify need
                // them) but they're logistics paperwork, not art — keep them out
                // of the art strip (Jon, Jul 29). In Drive they live in the job
                // folder's "Packing Slips", not the item folders.
                const files = (filesByItem[it.id] || []).filter((f: any) => f.stage !== "packing_slip");
                const art = it.artwork_status || "not_started";
                const artColor = art === "approved" ? T.green : art === "revision_requested" ? T.amber : T.muted;
                // Internal approval toggle (parity with classic ApprovalsTab peek modal):
                // for verbal/email approvals — same artwork_status the client hub writes,
                // so the Blanks/PO gate and phase engine see it identically.
                const markInternal = async () => {
                  const newStatus = art === "approved" ? "not_started" : "approved";
                  try {
                    await (createClient().from("items") as any).update({ artwork_status: newStatus }).eq("id", it.id);
                    setItems(prev => prev.map(x => x.id === it.id ? { ...x, artwork_status: newStatus } : x));
                    if (newStatus === "approved") logJobActivity(job.id, `${it.name} approved internally`);
                    else logJobActivity(job.id, `${it.name} internal approval removed`);
                    recalcPhase();
                  } catch (e) { failed("Approval not saved", e); }
                };
                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={lbl}>Files · {files.length}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: artColor }}>{art.replace(/_/g, " ")}</span>
                        <button onClick={markInternal} title={art === "approved" ? "Clear the approval (back to not started)" : "Approve without a client click — for approvals given verbally or by email"}
                          style={ghostBtn}>{art === "approved" ? "Undo approval" : "Mark approved"}</button>
                      </span>
                    </div>
                    {tip(<>Upload art by stage (mockup, proof, print-ready). A mockup unlocks <b style={{ color: T.text }}>Generate proof</b> — the proof editor that clients approve and vendors print from. Files land in this item&apos;s Drive folder automatically.</>)}
                    {files.length === 0 ? (
                      <div style={{ fontSize: 13, color: T.faint, padding: "16px 0" }}>No files on this item yet.</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 10 }}>
                        {files.map((f: any) => {
                          const ap = f.approval === "approved" ? T.green : f.approval === "revision_requested" ? T.amber : T.faint;
                          return (
                            <a key={f.drive_file_id + f.file_name} href={thumbSrc(f.drive_file_id, true)} target="_blank" rel="noreferrer" title={f.file_name} style={{ textDecoration: "none", position: "relative", display: "block" }}>
                              <button title="Delete file" onClick={e => { e.preventDefault(); e.stopPropagation(); deleteFile(it, f); }}
                                style={{ position: "absolute", top: 4, right: 4, zIndex: 1, width: 20, height: 20, borderRadius: 999, border: "none", background: "rgba(10,10,10,0.6)", color: "#fff", fontSize: 11, lineHeight: "20px", textAlign: "center", padding: 0, cursor: "pointer" }}>✕</button>
                              {/* button (an <a> can't nest in the tile's <a>) — dl=1 serves the
                                  full file with attachment disposition, so navigation stays put */}
                              <button title={`Download ${f.file_name}`}
                                onClick={e => { e.preventDefault(); e.stopPropagation(); window.location.href = `/api/files/thumbnail?id=${f.drive_file_id}&dl=1`; }}
                                style={{ position: "absolute", top: 4, left: 4, zIndex: 1, width: 20, height: 20, borderRadius: 999, border: "none", background: "rgba(10,10,10,0.6)", color: "#fff", fontSize: 11, lineHeight: "20px", textAlign: "center", padding: 0, cursor: "pointer" }}>⬇</button>
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
                    {/* proof editor — reuses the classic ProofModal (methods/locations/colors/crop/bake) */}
                    {(() => {
                      const mockupFile = files.find((f: any) => f.stage === "mockup") || files.find((f: any) => f.file_name?.toLowerCase().includes("mockup"));
                      const hasProof = !!it.proof_spec;
                      // No spec but a baked proof PDF exists (older copied items) —
                      // offer the PDF itself, and don't push "Generate": a fresh
                      // draft here won't match the already-approved document.
                      const proofPdf = !hasProof ? files.find((f: any) => f.stage === "proof") : null;
                      const revisedPend = files.some((f: any) => f.stage === "proof" && f.revision_pending_send);
                      return (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}44`, flexWrap: "wrap" }}>
                          <span style={lbl}>Proof</span>
                          {hasProof && <button onClick={() => { setProofMode("preview"); setProofItemId(it.id); }} style={ghostBtn}>View</button>}
                          {proofPdf && proofPdf.drive_link && <button onClick={() => window.open(proofPdf.drive_link, "_blank")} style={ghostBtn}>View proof PDF</button>}
                          {mockupFile && <button onClick={() => { setProofMode("edit"); setProofItemId(it.id); }}
                            style={hasProof || proofPdf ? ghostBtn : { ...actBtn, background: T.amber, color: "#fff" }}>{hasProof ? "Edit proof" : "Generate proof"}</button>}
                          {!mockupFile && <span style={{ fontSize: 12, color: T.faint }}>Upload a mockup first — the proof is built on it.</span>}
                          {hasProof && !it.proof_sent_at && !revisedPend && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: T.muted }}>Ready · not sent</span>}
                          {revisedPend && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: T.amber }}>Revised · send</span>}
                        </div>
                      );
                    })()}
                    <div style={{ fontSize: 11, color: T.faint, marginTop: 12 }}>Files open full-size in a new tab. Proofs are sent from the Client section; the client approves in their hub — or use <b style={{ color: T.muted }}>Mark approved</b> above when they&apos;ve okayed it verbally.</div>
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
              {clientAction === "quote" ? (job.quote_approved ? "Send proofs" : "Send quote & proofs") : clientAction === "invoice" ? (invNum && Math.abs(toInvoice) > 0.01 ? "Send revised invoice" : "Send invoice") : "Record payment"}
            </div>
            {clientAction === "invoice" && invNum && Math.abs(toInvoice) > 0.01 && (
              <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5, marginBottom: 12, padding: "9px 12px", background: `${T.amber}12`, border: `1px solid ${T.amber}44`, borderRadius: 8 }}>
                Updates QB invoice <b>#{invNum}</b> in place ({fmtMoney(invoicedSub)} → {fmtMoney(orderTotal)} pre-tax; QB recalculates tax), then emails the revised invoice. Same invoice number, same pay link.
              </div>
            )}
            {clientAction === "payment" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12.5, color: T.muted }}>Balance due: <span style={{ fontFamily: mono, fontWeight: 800, color: T.text }}>{fmtMoney(Math.max(0, (invoiced || orderTotal) - paid))}</span>{invoiced ? <span style={{ color: T.faint }}> (incl. tax)</span> : null}</div>
                <select value={payForm.type} onChange={e => setPayForm(f => ({ ...f, type: e.target.value }))} style={field}>
                  <option value="full_payment">Full payment</option>
                  <option value="deposit">Deposit</option>
                  <option value="balance">Balance</option>
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 13, color: T.faint }}>$</span>
                  <input value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} placeholder="Amount" inputMode="decimal" style={field} />
                </div>
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
                {manualEmails.map(m => (
                  <label key={m} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.text, padding: "4px 0" }}>
                    <input type="checkbox" checked onChange={() => setManualEmails(x => x.filter(e => e !== m))} style={{ accentColor: T.accent }} />
                    <span>{m}<span style={{ color: T.faint }}> · added</span></span>
                  </label>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <input value={manualInput} onChange={e => setManualInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addManualEmail(); } }}
                    placeholder="Add another email…" type="email"
                    style={{ flex: 1, padding: "8px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
                  <button onClick={addManualEmail} disabled={!manualInput.trim()} style={{ ...ghostBtn, opacity: manualInput.trim() ? 1 : 0.5 }}>Add</button>
                </div>
              </div>
            )}
            {actErr && <div style={{ color: T.red, fontSize: 12, marginTop: 10 }}>{actErr}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button disabled={actBusy} onClick={() => { clientAction === "payment" ? doRecordPayment() : clientAction === "invoice" ? doSendInvoice() : doSendQuote(); }}
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
              <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <label style={{ flex: "1 1 150px" }}>
                  <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Ship date (required)</span>
                  <input type="date" value={poShipDate} onChange={e => setPoShipDate(e.target.value)} style={field} />
                </label>
                <label style={{ flex: "1 1 150px" }}>
                  <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Ship method</span>
                  <select value={poMethod} onChange={e => setPoMethod(e.target.value)} style={field}>
                    <option value="">— select —</option>
                    {SHIP_METHODS.map((m: string) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ ...lbl, marginBottom: 4 }}>Recipients</div>
              {cl.length === 0 ? (
                <div style={{ fontSize: 13, color: T.amber }}>No contacts on this decorator — add them on the Decorators page first.</div>
              ) : cl.map((c: any) => (
                <label key={c.email} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.text, padding: "4px 0" }}>
                  <input type="checkbox" checked={!!recips[c.email]} onChange={() => setRecips(r => ({ ...r, [c.email]: !r[c.email] }))} style={{ accentColor: T.accent }} />
                  <span>{c.name || c.email}<span style={{ color: T.faint }}> · {c.email}{c.role ? " · " + c.role : ""}</span></span>
                </label>
              ))}
              {(() => {
                // Proof-less warning (HPD-2607-032: PO went out with only PSD +
                // mockup in the folders). Soft nudge, not a gate — some runs
                // legitimately skip proofs, but never silently. An item with no
                // spec but a baked proof PDF (reorder copies) is NOT proof-less:
                // the folder the vendor gets already holds that PDF.
                const noProof = (vendorGroups[poVendor] || []).filter((it: any) =>
                  !it.proof_spec && !(filesByItem[it.id] || []).some((f: any) => f.stage === "proof"));
                return noProof.length > 0 ? (
                  <div style={{ fontSize: 12.5, color: T.amber, marginTop: 10 }}>
                    No proofs drafted for {noProof.length === (vendorGroups[poVendor] || []).length ? "these items" : noProof.map((x: any) => x.name).join(", ")} — the vendor folder will only have art files.
                  </div>
                ) : null;
              })()}
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
            {/* catalog sources — the classic pickers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {PICKER_SOURCES.map(([k, label, bg, color]) => (
                <button key={k} onClick={() => { setAddOpen(false); setAssignTargetId(null); setPickerSrc(k); }}
                  style={{ padding: "11px 10px", borderRadius: 9, border: bg ? "none" : `1px solid ${T.border}`, background: bg || T.surface, color: color || T.text, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: font }}>
                  {label}{k === "fav" && favorites.length > 0 ? ` · ${favorites.length}` : ""}
                </button>
              ))}
            </div>
            <div style={{ ...lbl, marginBottom: 10 }}>Or quick manual entry</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input value={newProd.name} onChange={e => setNewProd(p => ({ ...p, name: e.target.value }))} placeholder="Product name" style={field} />
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

      {/* ── job details editor ── */}
      {detailsOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) setDetailsOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 320, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 14px", overflowY: "auto" }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, width: "100%", maxWidth: 460, padding: "20px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginBottom: 14 }}>Job details</div>
            {/* client — display + change/create (classic swap semantics) */}
            <div style={{ marginBottom: 12, padding: "10px 12px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ ...lbl }}>Client</span>
                <span style={{ fontSize: 13.5, fontWeight: 800, flex: 1 }}>{job?.clients?.name || "No client"}</span>
                <button onClick={() => setClientPick(p => !p)} style={{ background: "none", border: `1px solid ${T.border}`, color: T.muted, fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 999, cursor: "pointer", fontFamily: font }}>{clientPick ? "Cancel" : "Change"}</button>
              </div>
              {clientPick && (
                <div style={{ marginTop: 10 }}>
                  <input autoFocus value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Search clients…" style={{ ...field, marginBottom: 6 }} />
                  <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
                    {clientList.filter((c: any) => !clientQuery.trim() || (c.name || "").toLowerCase().includes(clientQuery.trim().toLowerCase())).slice(0, 30).map((c: any) => (
                      <button key={c.id} disabled={clientBusy} onClick={() => assignClient(c.id, c.name)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 11px", background: c.id === job.client_id ? T.card : "none", border: "none", borderBottom: `1px solid ${T.border}44`, cursor: "pointer", fontFamily: font, fontSize: 12.5, fontWeight: 600, color: T.text }}>
                        {c.name}{c.id === job.client_id ? "  · current" : ""}
                      </button>
                    ))}
                    {clientQuery.trim() && !clientList.some((c: any) => (c.name || "").toLowerCase() === clientQuery.trim().toLowerCase()) && (
                      <button disabled={clientBusy} onClick={() => createNewClient(clientQuery)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 11px", background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 12.5, fontWeight: 700, color: T.accent }}>
                        + Create &ldquo;{clientQuery.trim()}&rdquo;
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: T.faint, marginTop: 6 }}>Reassigning swaps contacts, delivery address, and payment terms to the new client.</div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label><span style={{ ...lbl, display: "block", marginBottom: 5 }}>Project name</span>
                <input key={"jt:" + job.title} defaultValue={job.title || ""} onBlur={e => { const v = e.target.value.trim(); if (!v || v === job.title) return; saveJobCol("title", v); fetch("/api/drive/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: "job", id: job.id, name: v }) }).catch(() => {}); }} style={field} /></label>
              <label><span style={{ ...lbl, display: "block", marginBottom: 5 }}>Requested in-hands date</span>
                <input type="date" key={"jd:" + (job.target_ship_date || "")} defaultValue={job.target_ship_date || ""} onChange={e => { const v = e.target.value || null; saveJobCol("target_ship_date", v); if (v) saveJobCol("priority", calculatePriority(v)); }} style={field} /></label>
              <label><span style={{ ...lbl, display: "block", marginBottom: 5 }}>Client delivery address</span>
                <textarea key={"jv:" + (tm.venue_address || "")} defaultValue={tm.venue_address || ""} onBlur={e => saveTypeMeta({ venue_address: e.target.value.trim() || null })} rows={2} style={{ ...field, resize: "vertical" }} /></label>
              <label><span style={{ ...lbl, display: "block", marginBottom: 5 }}>Client PO #</span>
                <input key={"jp:" + (tm.client_po_number || "")} defaultValue={tm.client_po_number || ""} onBlur={e => saveTypeMeta({ client_po_number: e.target.value.trim() || null })} style={field} /></label>
              <label><span style={{ ...lbl, display: "block", marginBottom: 5 }}>Project notes</span>
                <textarea key={"jn:" + (job.notes || "")} defaultValue={job.notes || ""} onBlur={e => saveJobCol("notes", e.target.value.trim() || null)} rows={2} style={{ ...field, resize: "vertical" }} /></label>
              <label><span style={{ ...lbl, display: "block", marginBottom: 5 }}>Shipping notes</span>
                <textarea key={"js:" + (tm.shipping_notes || "")} defaultValue={tm.shipping_notes || ""} onBlur={e => saveTypeMeta({ shipping_notes: e.target.value.trim() || null })} rows={2} style={{ ...field, resize: "vertical" }} /></label>
              <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.text }}>
                <input type="checkbox" checked={!!job.is_inventory} onChange={e => saveJobCol("is_inventory", e.target.checked)} style={{ accentColor: T.accent }} />
                Inventory / stock buy (not a client order)
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setDetailsOpen(false)} style={actBtn}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── proof editor — classic ProofModal, lifted above the worksheet
          (z 400 > 300). Mount-all-show-one across every proofable item with
          ‹ › flip chrome (same pattern as classic generate-all). Flipping
          also moves the worksheet index behind, so you always exit onto the
          design you were just looking at. ── */}
      {proofItemId && (() => {
        const proofables = items.filter((x: any) => {
          const fs = filesByItem[x.id] || [];
          return x.proof_spec || fs.some((f: any) => f.stage === "mockup" || f.file_name?.toLowerCase().includes("mockup"));
        });
        const list = proofables.some((x: any) => x.id === proofItemId) ? proofables : items.filter((x: any) => x.id === proofItemId);
        const idx = list.findIndex((x: any) => x.id === proofItemId);
        if (idx < 0) return null;
        const flip = (d: number) => {
          const target: any = list[(idx + d + list.length) % list.length];
          setProofItemId(target.id);
          const wi = items.findIndex((x: any) => x.id === target.id);
          if (wi >= 0 && wsIndex !== null) setWsIndex(wi);
        };
        return (
          <div style={{ position: "relative", zIndex: 400 }}>
            {list.map((pItem: any) => {
              const pFiles = filesByItem[pItem.id] || [];
              const mockupFile = pFiles.find((f: any) => f.stage === "mockup") || pFiles.find((f: any) => f.file_name?.toLowerCase().includes("mockup"));
              return (
                <ProofModal
                  key={pItem.id}
                  hidden={pItem.id !== proofItemId}
                  item={pItem}
                  clientName={client}
                  projectTitle={job.title}
                  mockupFile={mockupFile}
                  files={pFiles}
                  costingData={{ ...(job.costing_data || {}), costProds: allAssembled }} /* live overlay — proofs read current costing, not the page-load baseline (Taylor, Jul 28) */
                  initialMode={pItem.id === proofItemId ? proofMode : (pItem.proof_spec ? "preview" : "edit")}
                  onClose={() => setProofItemId(null)}
                  onSaved={reloadAllFiles}
                  onUpdateItem={(id: string, updates: any) => setItems(prev => prev.map((x: any) => x.id === id ? { ...x, ...updates } : x))}
                />
              );
            })}
            {list.length > 1 && (
              <>
                <button onClick={() => flip(-1)} aria-label="Previous proof"
                  style={{ position: "fixed", left: 14, top: "50%", transform: "translateY(-50%)", zIndex: 450, width: 46, height: 46, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 22, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", fontFamily: font, lineHeight: 1 }}>‹</button>
                <button onClick={() => flip(1)} aria-label="Next proof"
                  style={{ position: "fixed", right: 14, top: "50%", transform: "translateY(-50%)", zIndex: 450, width: 46, height: 46, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 22, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", fontFamily: font, lineHeight: 1 }}>›</button>
                <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 450, background: T.card, border: `1px solid ${T.border}`, borderRadius: 9, padding: "7px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", display: "flex", alignItems: "baseline", gap: 10, maxWidth: "80vw" }}>
                  <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 800, color: T.text, whiteSpace: "nowrap" }}>{letterOf(proofItemId)} · {idx + 1} / {list.length}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(list[idx] as any).name}</span>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── save-failure toast (house rule: silent saves, VISIBLE failures) ── */}
      {saveErr && (
        <div style={{ position: "fixed", bottom: 22, right: 22, zIndex: 600, background: T.card, border: `1px solid ${T.red}`, borderRadius: 12, padding: "12px 16px", maxWidth: 380, boxShadow: "0 8px 28px rgba(0,0,0,0.45)", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ fontSize: 12.5, color: T.red, fontWeight: 700, lineHeight: 1.45, flex: 1 }}>⚠ {saveErr}. Check your connection and retry the edit.</div>
          <button onClick={() => setSaveErr(null)} style={{ background: "none", border: "none", color: T.faint, fontSize: 15, cursor: "pointer", lineHeight: 1, padding: 0 }}>✕</button>
        </div>
      )}

      {/* ── PSD/mockup drop progress toast ── */}
      {psdProcessing && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 500, background: T.card, border: `1px solid ${psdProcessing.error ? T.red : T.border}`, borderRadius: 12, padding: "13px 18px", maxWidth: 480, boxShadow: "0 8px 28px rgba(0,0,0,0.45)" }}>
          {psdProcessing.error ? (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ fontSize: 12.5, color: T.red, lineHeight: 1.45, flex: 1 }}>{psdProcessing.error}</div>
              <button onClick={() => setPsdProcessing(null)} style={{ background: "none", border: "none", color: T.faint, fontSize: 15, cursor: "pointer", lineHeight: 1, padding: 0 }}>✕</button>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: T.text, fontWeight: 700 }}>⏳ {psdProcessing.status}</div>
          )}
        </div>
      )}

      {/* ── send-time proof bake: hidden ProofModals render + bake to Drive ── */}
      {bakeIds && bakeIds.filter(id => bakeRemainRef.current.has(id)).slice(0, 1).map(id => {
        const pItem = items.find((x: any) => x.id === id); if (!pItem) return null;
        const pFiles = filesByItem[id] || [];
        const mockupFile = pFiles.find((f: any) => f.stage === "mockup") || pFiles.find((f: any) => f.file_name?.toLowerCase().includes("mockup"));
        return (
          <ProofModal key={"bake-" + id} hidden autoBake item={pItem} clientName={client} projectTitle={job.title}
            mockupFile={mockupFile} files={pFiles} costingData={{ ...(job.costing_data || {}), costProds: allAssembled }} /* live overlay — proofs read current costing, not the page-load baseline (Taylor, Jul 28) */ initialMode="preview"
            onClose={() => {}} onSaved={reloadAllFiles} onBaked={handleBaked}
            onUpdateItem={(iid: string, updates: any) => setItems(prev => prev.map((x: any) => x.id === iid ? { ...x, ...updates } : x))} />
        );
      })}
      {bakeIds && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 500, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "13px 18px", boxShadow: "0 8px 28px rgba(0,0,0,0.45)", textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: T.text, fontWeight: 700 }}>⏳ Preparing proof PDFs… ({bakeIds.length} to go)</div>
          <div style={{ fontSize: 10.5, color: T.muted, marginTop: 3 }}>Keep this page open — each PDF saves as it finishes</div>
        </div>
      )}
      {leaveTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={e => { if (e.target === e.currentTarget) setLeaveTarget(null); }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "22px 24px", maxWidth: 440, fontFamily: font }}>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 8 }}>Proofs are still baking</div>
            <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
              {bakeRemainRef.current.size} PDF{bakeRemainRef.current.size === 1 ? "" : "s"} left. Leave now and the rest stop — this job&rsquo;s Drive links stay incomplete until someone runs &ldquo;Bake to Drive&rdquo; again. Finished ones are already saved.
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setLeaveTarget(null)} style={{ background: T.text, color: T.bg, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: font }}>Stay and finish</button>
              <button onClick={confirmLeave} style={{ background: "none", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 9, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Leave anyway</button>
            </div>
          </div>
        </div>
      )}

      {/* ── full size editor (classic EditSizesModal: adult/youth/one-size +
          waist×inseam grid) — z 420 over the worksheet ── */}
      {editSizesFor && (() => {
        const target = items.find((x: any) => x.id === editSizesFor); if (!target) return null;
        return (
          <EditSizesModal zIndex={420}
            item={{ ...target, sizes: sortSizes(Object.keys(target.qtys || {})), qtys: target.qtys || {} }}
            onClose={() => setEditSizesFor(null)}
            onSave={(nextSizes: string[], nextQtys: Record<string, any>) => saveSizesQtys(target, nextSizes, nextQtys)} />
        );
      })()}

      {/* ── cost request modals (shared with classic) ── */}
      {rfqOpen && (
        <RfqModal job={job} costProds={allAssembled} decoratorRecords={decoratorRecords}
          onClose={() => setRfqOpen(false)}
          onSent={(entry: any) => { const meta = { ...(job.type_meta || {}), rfq_history: [...(job.type_meta?.rfq_history || []), entry] }; setJob((j: any) => ({ ...j, type_meta: meta })); logJobActivity(job.id, `Quote request sent to ${entry.vendor}`); }} />
      )}
      <ArtRequestModal open={artReqOpen} onClose={() => setArtReqOpen(false)} project={job}
        onSent={() => { logJobActivity(job.id, "Art pricing request sent"); }} />
      {moveItem && (
        <MoveItemDialog itemId={moveItem.id} itemName={moveItem.name} open={true} mode={moveItem.mode}
          onClose={() => setMoveItem(null)}
          onMoved={(result: any) => {
            if (moveItem.mode === "move") setItems(prev => prev.filter((x: any) => x.id !== moveItem.id));
            setMoveItem(null); setWsIndex(null);
            if (result?.to?.id && typeof window !== "undefined") window.location.href = `/jobs/${result.to.id}?v2=1`;
          }} />
      )}

      {/* ── invoice variance review (reconcile-at-ship / QB heal) ── */}
      {showVariance && (
        <InvoiceVarianceReviewModal jobId={job.id} shippingRoute={job.shipping_route} jobTitle={job.title} clientName={client}
          onClose={() => setShowVariance(false)}
          onApproved={() => { logJobActivity(job.id, "QB invoice updated with actual qtys — revised invoice emailed to client"); setShowVariance(false); refetchTypeMeta(); recalcPhase(); }} />
      )}

      {/* ── QB customer chooser (ambiguous invoice push → pick/create/unlink) ── */}
      <QBCustomerChooser open={chooserOpen} mode="push" clientId={job.client_id} searchedName={client}
        candidates={chooserCandidates} current={undefined} busy={actBusy} onAction={handleChooserAction} onClose={() => setChooserOpen(false)} />

      {/* ── catalog picker overlay (classic pickers; z 340 > worksheet 300) ── */}
      {pickerSrc && (() => {
        const target = assignTargetId ? items.find((x: any) => x.id === assignTargetId) : null;
        const assignName = target?.name || "";
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 340, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
            onClick={closePicker}>
            <div onClick={e => e.stopPropagation()} style={{ width: "95vw", maxWidth: pickerSrc === "src" ? 440 : 1000, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
              <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => { if (pickerSrc === "src") closePicker(); else setPickerSrc("src"); }}
                  style={{ background: T.text, border: "none", borderRadius: 6, color: "#0a0a0a", fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: "pointer", fontFamily: font }}>
                  ← {pickerSrc === "src" ? "Close" : "Sources"}
                </button>
                {target && <span style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>Assigning blank to {assignName}</span>}
              </div>
              {pickerSrc === "src" && (
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "18px 20px" }}>
                  <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", marginBottom: 12 }}>{target ? "Pick a blank source" : "Add from catalog"}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {PICKER_SOURCES.map(([k, label, bg, color]) => (
                      <button key={k} onClick={() => setPickerSrc(k)}
                        style={{ padding: "12px 10px", borderRadius: 9, border: bg ? "none" : `1px solid ${T.border}`, background: bg || T.surface, color: color || T.text, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: font }}>
                        {label}{k === "fav" && favorites.length > 0 ? ` · ${favorites.length}` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {pickerSrc === "ss" && <SSPicker onAdd={handlePickerAdd} onClose={closePicker} isFav={isFav} toggleFav={toggleFav} assignMode={!!target} defaultItemName={assignName} />}
              {pickerSrc === "as" && <ASColourPicker onAdd={handlePickerAdd} onClose={closePicker} isFav={isFav} toggleFav={toggleFav} assignMode={!!target} defaultItemName={assignName} />}
              {pickerSrc === "la" && <LAApparelPicker onAdd={handlePickerAdd} onClose={closePicker} isFav={isFav} toggleFav={toggleFav} assignMode={!!target} defaultItemName={assignName} />}
              {pickerSrc === "cc" && <CottonCollectivePicker onAdd={handlePickerAdd} onClose={closePicker} assignMode={!!target} defaultItemName={assignName} />}
              {pickerSrc === "fav" && <FavoritesPicker favorites={favorites} setFavorites={setFavorites} onAdd={handlePickerAdd} onClose={closePicker} toggleFav={toggleFav} assignMode={!!target} defaultItemName={assignName} />}
              {pickerSrc === "other" && <OtherPicker onAdd={handlePickerAdd} onClose={closePicker} assignMode={!!target} defaultItemName={assignName} />}
            </div>
          </div>
        );
      })()}

      {/* ── send revised proofs modal — contacts + optional note ── */}
      {revisedOpen && (
        <div onClick={e => { if (e.target === e.currentTarget && !revisedBusy) setRevisedOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 320, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, width: "100%", maxWidth: 420, padding: "20px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginBottom: 14 }}>Send revised proofs</div>
            <div style={{ ...lbl, marginBottom: 4 }}>Recipients</div>
            {flatContacts.length === 0 ? (
              <div style={{ fontSize: 13, color: T.amber }}>No contacts with an email on this job.</div>
            ) : flatContacts.map((c: any) => (
              <label key={c.email} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.text, padding: "4px 0" }}>
                <input type="checkbox" checked={!!revisedSel[c.email]} onChange={() => setRevisedSel(r => ({ ...r, [c.email]: !r[c.email] }))} style={{ accentColor: T.accent }} />
                <span>{c.name || c.email}<span style={{ color: T.faint }}> · {c.email}{c.role_on_job ? " · " + c.role_on_job : ""}</span></span>
              </label>
            ))}
            <label style={{ display: "block", marginTop: 12 }}>
              <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Note (optional)</span>
              <textarea value={revisedNote} onChange={e => setRevisedNote(e.target.value)} rows={3} placeholder="Anything the client should know about the revision…" style={{ ...field, resize: "vertical" }} />
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button disabled={revisedBusy || !Object.values(revisedSel).some(Boolean)} onClick={sendRevised}
                style={{ ...actBtn, background: T.amber, color: "#fff", opacity: revisedBusy || !Object.values(revisedSel).some(Boolean) ? 0.6 : 1 }}>{revisedBusy ? "Sending…" : "Send"}</button>
              <button disabled={revisedBusy} onClick={() => setRevisedOpen(false)} style={ghostBtn}>Cancel</button>
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
