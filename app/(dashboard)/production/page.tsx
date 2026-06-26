"use client";
import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { shipItemFromDecorator } from "@/lib/po-actions";
import { NotifyShipmentDialog } from "@/components/NotifyShipmentDialog";
import { MockupPeek } from "@/components/MockupPeek";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);

// One ad-hoc "pull a sample" instruction on an item. Free-form — there is no
// fixed catalog of pulls. Entered on Production at ship time, then checked off
// on Receiving (pulled flips true, which feeds sample_qtys per size).
//   qtys   — per-size counts to pull, e.g. { L: 1 } or { S:1, M:1, L:1 } for a run
//   for    — who the sample is for
//   to     — where it needs to go
//   pulled — set true on Receiving when the warehouse pulls it
type SamplePull = { qtys: Record<string, number>; for: string; to: string; pulled?: boolean };

// Tolerant read of the JSONB. Handles the in-development single-size shape
// ({ qty, size }) so early test rows don't read as empty after the model
// moved to a per-size qtys map.
function normalizePulls(raw: any): SamplePull[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p: any) => ({
    qtys: p && p.qtys && typeof p.qtys === "object"
      ? p.qtys
      : (p && p.size ? { [p.size]: parseInt(p.qty, 10) || 1 } : {}),
    for: (p && p.for) || "",
    to: (p && p.to) || "",
    pulled: !!(p && p.pulled),
  }));
}
const pullTotal = (p: SamplePull) => Object.values(p.qtys || {}).reduce((a, n) => a + (n || 0), 0);

type ProdItem = {
  id: string; name: string; job_id: string; letter: string;
  pipeline_stage: string | null; ship_tracking: string | null;
  pickup_ready: boolean;
  pipeline_timestamps: Record<string, string> | null;
  blank_vendor: string | null; blank_sku: string | null;
  decorator_name: string | null; decorator_short_code: string | null;
  decorator_id: string | null; decorator_assignment_id: string | null;
  target_ship_date: string | null; total_units: number;
  garment_type: string | null;
  shipping_route: string | null;
  sizes: string[]; qtys: Record<string, number>;
  ship_qtys: Record<string, number>; ship_notes: string;
  client_eta: string | null; client_eta_note: string | null;
  expected_arrival: string | null;
  sample_pulls: SamplePull[];
};

// Per-item shipping_route (migration 076) wins over the job's route in every
// status/notify/address surface. Null on the item = fall back to the job route.
const resolveRoute = (itemRoute?: string | null, jobRoute?: string | null) =>
  itemRoute || jobRoute || "ship_through";

type ShipmentNotificationRecord = {
  type: string;
  decoratorId: string | null;
  decoratorName: string | null;
  sentAt: string;
  recipients: string[];
  tracking: string | null;
  resend?: boolean;
};

type ProjectGroup = {
  jobId: string; jobNumber: string; invoiceNumber: string | null; jobTitle: string; clientName: string;
  shipDate: string | null; phase: string; completedAt: string | null;
  priority: string | null;
  decoratorGroups: DecoratorGroup[];
  totalItems: number; totalUnits: number;
  shippingNotifications: ShipmentNotificationRecord[];
  /** Stashed from the job for the print-count KPI. Only present for
   *  active jobs (not completed) since prints are an "in-flight" stat. */
  costingData?: any;
  /** Shipping context for resolving per-vendor ship-to in the
   *  vendor modal header. Mirrors the PO PDF's resolution order:
   *  type_meta.po_ship_to[vendorName] → drop_ship venue_address →
   *  HPD warehouse default. */
  shippingRoute: string | null;
  venueAddress: string;
  poShipTo: Record<string, string>;
};

type DecoratorGroup = {
  decoratorId: string | null; decoratorName: string; shortCode: string; transitDays: number | null;
  items: ProdItem[];
  inProduction: number; shipped: number; totalUnits: number;
  contacts: { name: string; email: string | null }[];
};

// Vendor transit buffer (business days) when a decorator has none set.
const DEFAULT_TRANSIT_DAYS = 5;
function addBusinessDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) added++; }
  return d.toISOString().slice(0, 10);
}
// Expected arrival at HPD (the ASN). drop_ship goes direct (= the ship date);
// HPD-routed (ship_through/stage) adds the vendor's transit buffer. ASAP/empty
// pass through unchanged. A per-item expected_arrival override wins upstream.
function computeArrivalEta(route: string, shipDate: string | null, transitDays: number | null): string | null {
  if (!shipDate || shipDate === "ASAP") return shipDate || null;
  if (route === "drop_ship") return shipDate;
  return addBusinessDays(shipDate, transitDays ?? DEFAULT_TRANSIT_DAYS);
}

export default function ProductionPage() {
  const supabase = createClient();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterDecorator, setFilterDecorator] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterStalled, setFilterStalled] = useState(false);
  const [modalProject, setModalProject] = useState<ProjectGroup | null>(null);
  // Which decorator the modal is focused on. Vendor chip click sets
  // this; modal renders only that decorator group. Will get richer
  // (per-vendor actions) as the modal grows.
  const [modalDecoratorKey, setModalDecoratorKey] = useState<string | null>(null);
  // Item selection inside the modal — for bulk actions. Reset on
  // modal close. Toggle by clicking the per-item checkbox.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  // Per-item ship sub-modal. Click "Ship" on a row → opens this with
  // tracking + notes inputs + confirm. Inline row no longer carries
  // those inputs, so the row stays compact.
  const [shipDetailItem, setShipDetailItem] = useState<ProdItem | null>(null);
  // Batch ship sub-modal. Click "Ship Selected · N" → opens with one
  // tracking + notes input + packing slip upload that get applied to
  // every selected item. Vendors typically ship one box with a single
  // tracking number for multiple items, so this saves copy-pasting.
  const [batchShipState, setBatchShipState] = useState<
    { items: ProdItem[]; project: ProjectGroup; dg: DecoratorGroup } | null
  >(null);
  const [batchTracking, setBatchTracking] = useState("");
  const [batchNotes, setBatchNotes] = useState("");
  // Drag highlight target for the slip dropzones. Either modal's
  // upload area can be the active drop zone at a time.
  const [slipDragOver, setSlipDragOver] = useState<"ship" | "batch" | null>(null);
  // Notify Recipient picker dialog. Opened from the per-item or batch
  // ship sub-modal after Mark Shipped flips items, OR from the inline
  // Send-update button on shipped rows. Lazy-loads contacts on first
  // open per job. Spec: memory/project_notify_recipient_on_ship.md
  const [notifyState, setNotifyState] = useState<{
    jobId: string;
    decoratorId: string | null;
    decoratorName: string;
    tracking: string;
    qbInvoiceNumber: string;
    clientName: string;
    jobTitle: string;
    route: string;
    contacts: Array<{ name: string; email: string; role: string }>;
  } | null>(null);
  const [contactsByJob, setContactsByJob] = useState<Record<string, Array<{ name: string; email: string; role: string }>>>({});
  // Per-decorator expand state inside the modal. Reset on modal change
  // so a fresh project always opens with everything collapsed (Jon
  // wants the multi-vendor view quiet on first open).
  const [expandedDecorators, setExpandedDecorators] = useState<Set<string>>(new Set());
  const [packingSlips, setPackingSlips] = useState<Record<string, { id: string; file_name: string; drive_link: string; folder_link?: string }[]>>({});
  const [uploadingSlip, setUploadingSlip] = useState<string | null>(null);
  const [slipProgress, setSlipProgress] = useState(0);
  const [slipStatus, setSlipStatus] = useState<string | null>(null);
  const [viewingSlips, setViewingSlips] = useState<{ files: { file_name: string; drive_link: string }[]; index: number; title: string } | null>(null);
  const shipModalSlipInputRef = useRef<HTMLInputElement | null>(null);
  const batchModalSlipInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimers = useRef<Record<string, any>>({});
  // Latest unsaved sample-pulls array per item, so onBlur can flush the
  // pending debounced write immediately (same bulletproof-save pattern as
  // the text fields, but the payload is a whole array not a string).
  const pendingSamplePulls = useRef<Record<string, SamplePull[]>>({});
  const now = new Date();

  useEffect(() => { loadAll(); }, []);

  // Escape closes the full-page project modal.
  useEffect(() => {
    if (!modalProject) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeModalRespectReturn(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalProject]);

  // Keep the open modal in sync when projects state refreshes (e.g.,
  // after a tracking edit / mark-shipped) — find the same job id and
  // swap in the fresh ProjectGroup so handlers see the latest items.
  useEffect(() => {
    if (!modalProject) return;
    const fresh = projects.find(p => p.jobId === modalProject.jobId);
    if (fresh && fresh !== modalProject) setModalProject(fresh);
  }, [projects, modalProject]);

  // Reset decorator expansion state + active decorator key when the
  // modal CLOSES. On open, vendor-chip click pre-seeds both before
  // setting modalProject; we don't want to wipe that.
  useEffect(() => {
    if (!modalProject) {
      setExpandedDecorators(new Set());
      setModalDecoratorKey(null);
      setSelectedItemIds(new Set());
    }
  }, [modalProject?.jobId]);

  // Deep-link auto-open: callers (currently the Overview tab strip
  // on /jobs/[id]) navigate here with `?openProject=<jobId>` and an
  // optional `&decorator=<decKey>` to land directly in the per-project
  // modal focused on a specific vendor. We fire once after projects
  // load, then strip the query params via history.replaceState so a
  // refresh doesn't re-trigger and Back behavior stays clean.
  //
  // returnTo=overview tells closeModal() to navigate back to the source
  // /jobs/[id] instead of leaving the user stranded on /production.
  // Stored in a ref because it survives across renders without
  // re-triggering the auto-open effect.
  const autoOpenedRef = useRef(false);
  const returnToRef = useRef<{ kind: string; jobId: string } | null>(null);
  useEffect(() => {
    if (autoOpenedRef.current || projects.length === 0) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const target = url.searchParams.get("openProject");
    if (!target) return;
    const project = projects.find(p => p.jobId === target);
    if (!project) return;
    autoOpenedRef.current = true;
    const decKey = url.searchParams.get("decorator");
    if (decKey) {
      // Caller (Overview tab chip on /jobs/[id]) may pass either the
      // decorator UUID or the decorator name — its DB query doesn't
      // always select decorator_id. Resolve to whatever the group
      // considers canonical (decoratorId || decoratorName) so the
      // filter + expansion checks downstream actually match. Without
      // this the modal opens with a blank body when the chip's job
      // record has an assignment without decorator_id loaded.
      const matchingGroup = project.decoratorGroups.find(
        (dg: any) => dg.decoratorId === decKey || dg.decoratorName === decKey
      );
      const canonical = matchingGroup
        ? (matchingGroup.decoratorId || matchingGroup.decoratorName)
        : decKey;
      setModalDecoratorKey(canonical);
      setExpandedDecorators(new Set([canonical]));
    }
    const returnTo = url.searchParams.get("returnTo");
    if (returnTo === "overview") returnToRef.current = { kind: "overview", jobId: target };
    setModalProject(project);
    url.searchParams.delete("openProject");
    url.searchParams.delete("decorator");
    url.searchParams.delete("returnTo");
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  }, [projects]);

  // Close path that honors the returnTo marker. Used by the X button
  // and Esc; "View Project →" already navigates to /jobs/[id] so it
  // doesn't need this. After firing, the ref clears so subsequent
  // organic modal opens on the same /production session stay put.
  function closeModalRespectReturn() {
    const ret = returnToRef.current;
    setModalProject(null);
    if (ret?.kind === "overview" && ret.jobId) {
      returnToRef.current = null;
      router.push(`/jobs/${ret.jobId}`);
    }
  }

  function toggleItemSelected(itemId: string) {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  function toggleDecorator(key: string) {
    setExpandedDecorators(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function loadAll() {
    setLoading(true);
    // Active jobs + recently completed (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const [activeRes, completedRes] = await Promise.all([
      supabase.from("jobs").select("id, title, job_number, phase, priority, type_meta, costing_data, shipping_route, clients(name)").in("phase", ["production", "receiving", "fulfillment"]),
      supabase.from("jobs").select("id, title, job_number, phase, priority, type_meta, phase_timestamps, shipping_route, clients(name)").eq("phase", "complete").gte("updated_at", thirtyDaysAgo),
    ]);
    const jobs = [...(activeRes.data || []), ...(completedRes.data || [])];

    if (!jobs?.length) { setProjects([]); setLoading(false); return; }

    const jobIds = jobs.map(j => j.id);
    const jobMap: Record<string, any> = {};
    jobs.forEach(j => { jobMap[j.id] = j; });

    const { data: allItems } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered), decorator_assignments(id, pipeline_stage, decoration_type, decorator_id, decorators(id, name, short_code, contacts_list, transit_days))")
      .in("job_id", jobIds)
      .order("sort_order");

    // Group items by job, then by decorator within each job
    const projectMap: Record<string, ProjectGroup> = {};

    for (const it of (allItems || [])) {
      const job = jobMap[it.job_id];
      if (!job) continue;

      // Production page surfaces items that have actually been pushed to
      // the decorator. An item counts as in-production if its
      // pipeline_stage says so, OR a PO was sent to its vendor — sending a
      // PO records the vendor in type_meta.po_sent_vendors but doesn't
      // reliably write pipeline_stage, so a PO-sent item can sit at a null
      // stage and would otherwise vanish here (e.g. HPD-2606-012 "Pepper").
      // Mirrors computeItemStatus' po_sent rule so this page agrees with
      // the project list + client/portal views.
      const _tm = (job as any).type_meta || {};
      const _poSentVendors = new Set<string>(((_tm.po_sent_vendors || []) as string[]).map(s => (s || "").toLowerCase().trim()));
      const _asg = it.decorator_assignments?.[0];
      const _cp = ((job as any)?.costing_data?.costProds || []).find((cp: any) => cp?.id === it.id);
      const _vendorKeys = [_asg?.decorators?.name, _asg?.decorators?.short_code, _cp?.printVendor]
        .filter(Boolean).map((s: string) => s.toLowerCase().trim());
      const poSentToVendor = _vendorKeys.some(v => _poSentVendors.has(v));
      if (it.pipeline_stage !== "in_production" && it.pipeline_stage !== "shipped" && !poSentToVendor) continue;
      // Once an item has been received at HPD, it has moved past the
      // production stage from this vendor's POV (it's in receiving /
      // fulfillment / outbound now). Drop it so the decorator chip
      // clears when all of that vendor's items are received.
      if (it.received_at_hpd) continue;

      const assignment = it.decorator_assignments?.[0];
      const decName = assignment?.decorators?.name || "Unassigned";
      const decId = assignment?.decorator_id || assignment?.decorators?.id || null;
      const shortCode = assignment?.decorators?.short_code || "";
      const contacts = assignment?.decorators?.contacts_list || [];
      const lines = it.buy_sheet_lines || [];
      const sizes = sortSizes(lines.map((l: any) => l.size));
      const qtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
      const totalUnits = lines.reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0);

      // Ship date is set per-vendor on the PO tab, stored in
      // type_meta.po_ship_dates. Key is cp.printVendor (costing-side),
      // not necessarily decorator.name — try printVendor first, then
      // fall back to decoratorName / shortCode.
      const tm = (job as any).type_meta || {};
      const poShipDates = (tm.po_ship_dates || {}) as Record<string, string>;
      const itemCp = ((job as any)?.costing_data?.costProds || []).find((cp: any) => cp?.id === it.id);
      const printVendor: string | undefined = itemCp?.printVendor;
      const ciKey = (k: string | null | undefined) => (k || "").toLowerCase().trim();
      const ciDates: Record<string, string> = {};
      for (const [k, v] of Object.entries(poShipDates)) {
        if (typeof v === "string" && v) ciDates[ciKey(k)] = v;
      }
      const vendorShipDate =
        (printVendor && poShipDates[printVendor]) ||
        poShipDates[decName] ||
        ciDates[ciKey(printVendor)] ||
        ciDates[ciKey(decName)] ||
        null;

      // Same key resolution for the PO ship METHOD — auto-detect local pickup
      // (PO method "Pick Up") so the checkbox pre-checks. Manual toggle wins.
      const poShipMethods = (tm.po_ship_methods || {}) as Record<string, string>;
      const ciMethods: Record<string, string> = {};
      for (const [k, v] of Object.entries(poShipMethods)) { if (typeof v === "string" && v) ciMethods[ciKey(k)] = v; }
      const vendorShipMethod =
        (printVendor && poShipMethods[printVendor]) || poShipMethods[decName] ||
        ciMethods[ciKey(printVendor)] || ciMethods[ciKey(decName)] || ciMethods[ciKey(shortCode)] || "";
      const pickupFromPO = /pick\s*-?\s*up/i.test(vendorShipMethod);

      const prodItem: ProdItem = {
        id: it.id, name: it.name, job_id: it.job_id, letter: String.fromCharCode(65 + (it.sort_order ?? 0)),
        pipeline_stage: it.pipeline_stage === "shipped" ? "shipped" : "in_production",
        ship_tracking: it.ship_tracking,
        pickup_ready: !!it.pickup_ready || pickupFromPO,
        pipeline_timestamps: it.pipeline_timestamps || {},
        blank_vendor: it.blank_vendor, blank_sku: it.blank_sku,
        decorator_name: decName, decorator_short_code: shortCode,
        decorator_id: decId,
        decorator_assignment_id: assignment?.id || null,
        target_ship_date: vendorShipDate,
        total_units: totalUnits, sizes, qtys,
        garment_type: it.garment_type ?? null,
        shipping_route: it.shipping_route || null,
        ship_qtys: it.ship_qtys || {}, ship_notes: it.ship_notes || "",
        client_eta: it.client_eta || null, client_eta_note: it.client_eta_note || null,
        expected_arrival: it.expected_arrival || null,
        sample_pulls: normalizePulls(it.sample_pulls),
      };

      if (!projectMap[it.job_id]) {
        // Project-level ship date = earliest active vendor PO ship date.
        const vDates = Object.values(poShipDates).filter(Boolean) as string[];
        const earliestShipDate = vDates.length > 0 ? vDates.sort()[0] : null;
        projectMap[it.job_id] = {
          jobId: job.id, jobNumber: job.job_number,
          // Provider-agnostic — IHM uses Stripe, HPD uses QB.
          invoiceNumber: tm.qb_invoice_number || tm.stripe_invoice_number || null,
          jobTitle: job.title,
          clientName: job.clients?.name || "",
          shipDate: earliestShipDate,
          phase: job.phase, completedAt: (job as any).phase_timestamps?.complete || null,
          priority: (job as any).priority || null,
          decoratorGroups: [], totalItems: 0, totalUnits: 0,
          shippingNotifications: Array.isArray(tm.shipping_notifications) ? tm.shipping_notifications : [],
          costingData: (job as any).costing_data,
          shippingRoute: (job as any).shipping_route || null,
          venueAddress: (tm.venue_address as string) || "",
          poShipTo: (tm.po_ship_to && typeof tm.po_ship_to === "object") ? (tm.po_ship_to as Record<string, string>) : {},
        };
      }
      projectMap[it.job_id].totalItems++;
      projectMap[it.job_id].totalUnits += totalUnits;

      // Find or create decorator group
      const decKey = decId || decName;
      let decGroup = projectMap[it.job_id].decoratorGroups.find(
        g => (g.decoratorId || g.decoratorName) === decKey
      );
      if (!decGroup) {
        decGroup = {
          decoratorId: decId, decoratorName: decName, shortCode,
          transitDays: assignment?.decorators?.transit_days ?? null,
          items: [], inProduction: 0, shipped: 0, totalUnits: 0,
          contacts: (contacts || []).map((c: any) => ({ name: c.name, email: c.email })),
        };
        projectMap[it.job_id].decoratorGroups.push(decGroup);
      }
      decGroup.items.push(prodItem);
      decGroup.totalUnits += totalUnits;
      if (prodItem.pipeline_stage === "shipped") decGroup.shipped++;
      else decGroup.inProduction++;
    }

    // Recompute each project's shipDate to be the earliest PO ship
    // date among vendors that still have unshipped items. Done after
    // the items loop because we need full decoratorGroups visibility
    // to know which vendors have remaining work. If everything has
    // shipped, shipDate becomes null (no remaining commitment).
    //
    // Key matching: po_ship_dates is keyed by cp.printVendor (the
    // costing-side label), not necessarily decorator.name. Look up
    // each item's costProd to get the canonical key, then check
    // po_ship_dates with both that key AND decoratorName as fallback.
    for (const p of Object.values(projectMap)) {
      const job = jobMap[p.jobId];
      const tmAll = (job as any)?.type_meta || {};
      const poShipDatesAll = (tmAll.po_ship_dates || {}) as Record<string, string>;
      const costProds = ((job as any)?.costing_data?.costProds || []) as any[];
      const cpById: Record<string, any> = {};
      for (const cp of costProds) cpById[cp.id] = cp;
      // Case-insensitive lookup table for resilience against case drift
      // between costing's printVendor and PO tab's stored key.
      const poDatesByLowerKey: Record<string, string> = {};
      for (const [k, v] of Object.entries(poShipDatesAll)) {
        if (typeof v === "string" && v) poDatesByLowerKey[k.toLowerCase().trim()] = v;
      }
      const lookupDate = (...keys: (string | undefined | null)[]) => {
        for (const k of keys) {
          if (!k) continue;
          const direct = poShipDatesAll[k];
          if (direct) return direct;
          const ci = poDatesByLowerKey[k.toLowerCase().trim()];
          if (ci) return ci;
        }
        return null;
      };

      const activeVendorDates: string[] = [];
      for (const dg of p.decoratorGroups) {
        const hasUnshipped = dg.items.some(it => it.pipeline_stage !== "shipped");
        if (!hasUnshipped) continue;
        // Pull the printVendor key from any item in this decorator group.
        let printVendor: string | undefined;
        for (const it of dg.items) {
          const cp = cpById[it.id];
          if (cp?.printVendor) { printVendor = cp.printVendor; break; }
        }
        const d = lookupDate(printVendor, dg.decoratorName, dg.shortCode);
        if (d) activeVendorDates.push(d);
      }
      p.shipDate = activeVendorDates.length > 0 ? activeVendorDates.sort()[0] : null;
    }

    // Sort projects by ship date
    const sorted = Object.values(projectMap).sort((a, b) => {
      if (!a.shipDate) return 1;
      if (!b.shipDate) return -1;
      return new Date(a.shipDate).getTime() - new Date(b.shipDate).getTime();
    });

    setProjects(sorted);

    // Load packing slip files for all items
    const allItemIds = (allItems || []).map((it: any) => it.id);
    if (allItemIds.length > 0) {
      const { data: slipFiles } = await supabase.from("item_files").select("id, item_id, file_name, drive_link, notes").eq("stage", "packing_slip").in("item_id", allItemIds);
      const slipMap: Record<string, { id: string; file_name: string; drive_link: string; folder_link?: string }[]> = {};
      for (const f of (slipFiles || [])) {
        if (!slipMap[f.item_id]) slipMap[f.item_id] = [];
        slipMap[f.item_id].push({ id: f.id, file_name: f.file_name, drive_link: f.drive_link, folder_link: f.notes || undefined });
      }
      setPackingSlips(slipMap);
      // Mockups for the item-click peek modal (List view).
      const { data: mockupFiles } = await supabase.from("item_files").select("item_id, drive_file_id, drive_link, created_at").eq("stage", "mockup").is("superseded_at", null).in("item_id", allItemIds).order("created_at", { ascending: false });
      const mMap: Record<string, { driveFileId: string | null; driveLink: string | null }> = {};
      for (const f of ((mockupFiles || []) as any[])) { if (!mMap[f.item_id]) mMap[f.item_id] = { driveFileId: f.drive_file_id, driveLink: f.drive_link }; }
      setMockupMap(mMap);
    }

    setLoading(false);
  }

  // ── Item actions ──
  // markShipped flips the item to shipped + writes downstream side
  // effects, then triggers a full reload. The batch flow loops over
  // items and would otherwise reload N times — pass `skipReload: true`
  // for each item in the loop and call loadAll() once at the end.
  async function markShipped(item: ProdItem, opts?: { skipReload?: boolean }) {
    // Flush ALL pending debounces for this item so the latest tracking / qtys
    // are on the item object before the write.
    for (const key of Object.keys(saveTimers.current).filter(k => k.includes(item.id))) {
      clearTimeout(saveTimers.current[key]);
      delete saveTimers.current[key];
    }
    // Canonical ship effect lives in lib/po-actions (shared with the job
    // Overview items modal) so the two surfaces can never drift.
    await shipItemFromDecorator(supabase, item);
    if (!opts?.skipReload) loadAll();
  }

  // Manually fire a shipment-update email to the client for a single
  // tracking-number batch. The notify route dedups on
  // (jobId + decoratorId + trackingNumber) so hitting this twice is safe.
  async function sendShipmentUpdate(args: {
    jobId: string;
    decoratorId: string | null;
    decoratorName: string | null;
    trackingNumber: string | null;
  }) {
    const { jobId, decoratorId, decoratorName, trackingNumber } = args;
    try {
      const res = await fetch("/api/email/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order_shipped_vendor",
          jobId,
          decoratorId,
          vendorName: decoratorName,
          trackingNumber,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.skipped === "already_sent") {
        logJobActivity(jobId, `Shipment update already sent for this tracking — skipped`);
      } else {
        logJobActivity(jobId, `Shipment update email sent to client${trackingNumber ? ` — tracking ${trackingNumber}` : ""}`);
      }
      loadAll();
    } catch (e) {
      console.error("sendShipmentUpdate failed", e);
    }
  }

  // Notifications table deprecated — bell UI was removed. No-op kept so
  // existing callers compile. Variance review still surfaces in the PaymentTab
  // "Pricing changed — click to update" banner.
  async function createInvoiceReadyNotification(_jobId: string, _jobTitle: string, _clientName: string) {
    return;
  }

  async function undoShipped(item: ProdItem) {
    const timestamps = { ...(item.pipeline_timestamps || {}) };
    delete timestamps.shipped;
    await supabase.from("items").update({
      pipeline_stage: "in_production", pipeline_timestamps: timestamps,
      received_at_hpd: false, received_at_hpd_at: null, received_qtys: null,
    }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: "in_production" }).eq("id", item.decorator_assignment_id);
    }
    loadAll();
  }

  // Lazy-load + cache job contacts for the Notify Recipient dialog.
  // The production page query intentionally skips contacts to keep the
  // initial fetch light — this only runs when the user actually opens
  // the dialog. Cached per-jobId for the session so subsequent opens
  // are instant.
  async function loadJobContacts(jobId: string): Promise<Array<{ name: string; email: string; role: string }>> {
    if (contactsByJob[jobId]) return contactsByJob[jobId];
    const { data } = await supabase
      .from("job_contacts")
      .select("role_on_job, contacts(name, email)")
      .eq("job_id", jobId);
    const list = ((data as any[]) || [])
      .map(r => ({
        name: r.contacts?.name || "Unnamed",
        email: r.contacts?.email || "",
        role: r.role_on_job || "",
      }))
      .filter(c => c.email);
    setContactsByJob(prev => ({ ...prev, [jobId]: list }));
    return list;
  }

  // Open the Notify Recipient dialog. Pulls latest project + item state
  // so the dialog renders with current tracking + invoice number.
  async function openNotifyDialog(args: {
    project: ProjectGroup;
    decoratorId: string | null;
    decoratorName: string;
    tracking: string;
    route?: string;
  }) {
    const { project, decoratorId, decoratorName, tracking } = args;
    const route = args.route || project.shippingRoute || "ship_through";
    const contacts = route === "drop_ship" ? await loadJobContacts(project.jobId) : [];
    setNotifyState({
      jobId: project.jobId,
      decoratorId,
      decoratorName,
      tracking,
      qbInvoiceNumber: project.invoiceNumber || "",
      clientName: project.clientName || "",
      jobTitle: project.jobTitle || "",
      route,
      contacts,
    });
  }

  // Persist a single field write to items + log any error. Centralised
  // so updateField (debounced) and flushField (blur, immediate) share
  // one error-checked save path. Fire-and-forget without an error check
  // is how we silently lost retail values in the worksheet before —
  // every write goes through here so it gets logged.
  async function persistField(itemId: string, field: string, value: string) {
    const payload: Record<string, any> = { [field]: value || null };
    if (field === "client_eta") {
      payload.client_eta_set_at = value ? new Date().toISOString() : null;
    }
    const { error } = await supabase.from("items").update(payload).eq("id", itemId);
    if (error) console.error("[production save error]", { itemId, field, value, error });
  }

  function updateField(itemId: string, field: string, value: string) {
    setProjects(prev => prev.map(p => ({
      ...p, decoratorGroups: p.decoratorGroups.map(dg => ({
        ...dg, items: dg.items.map(it => it.id === itemId ? { ...it, [field]: value } : it)
      }))
    })));
    const key = `${field}_${itemId}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => { persistField(itemId, field, value); }, 800);
  }

  // Immediate save (no debounce) — called from input onBlur so closing
  // the modal / navigating away never strands an unsaved edit.
  function flushField(itemId: string, field: string, value: string) {
    const key = `${field}_${itemId}`;
    if (saveTimers.current[key]) { clearTimeout(saveTimers.current[key]); delete saveTimers.current[key]; }
    persistField(itemId, field, value);
  }

  // pickup_ready is a NOT-NULL boolean — never route through persistField's
  // value||null coercion. Update local tree + write the boolean directly.
  function setPickupReady(itemId: string, checked: boolean) {
    setProjects(prev => prev.map(p => ({
      ...p, decoratorGroups: p.decoratorGroups.map(dg => ({
        ...dg, items: dg.items.map(it => it.id === itemId ? { ...it, pickup_ready: checked } : it)
      }))
    })));
    supabase.from("items").update({ pickup_ready: checked }).eq("id", itemId);
  }

  // Sample pulls are a whole-array JSONB write, so they get their own save
  // path. updateField is string-only. Local state updates immediately; the
  // array persists debounced, and onBlur flushes the pending write.
  async function persistSamplePulls(itemId: string, pulls: SamplePull[]) {
    const { error } = await supabase.from("items").update({ sample_pulls: pulls }).eq("id", itemId);
    if (error) console.error("[production sample_pulls save error]", { itemId, error });
  }
  function saveSamplePulls(itemId: string, pulls: SamplePull[]) {
    setProjects(prev => prev.map(p => ({
      ...p, decoratorGroups: p.decoratorGroups.map(dg => ({
        ...dg, items: dg.items.map(it => it.id === itemId ? { ...it, sample_pulls: pulls } : it)
      }))
    })));
    pendingSamplePulls.current[itemId] = pulls;
    const key = `sample_pulls_${itemId}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      persistSamplePulls(itemId, pulls);
      delete pendingSamplePulls.current[itemId];
    }, 800);
  }
  function flushSamplePulls(itemId: string) {
    const key = `sample_pulls_${itemId}`;
    if (saveTimers.current[key]) { clearTimeout(saveTimers.current[key]); delete saveTimers.current[key]; }
    const pending = pendingSamplePulls.current[itemId];
    if (pending) { persistSamplePulls(itemId, pending); delete pendingSamplePulls.current[itemId]; }
  }

  // Per-item sample-pulls editor (Production list rows). Each pull is a row in
  // a per-size grid: type a qty under each size, then who it's for and where it
  // goes. One row covers a single garment ({ L: 1 }) or a full size run.
  function samplePullsEditor(item: ProdItem) {
    const pulls = item.sample_pulls || [];
    const sizes = item.sizes.length > 0 ? item.sizes : ["OS"];
    const cell = { padding: "3px 5px", fontSize: 11 } as const;
    const setText = (idx: number, field: "for" | "to", value: string) =>
      saveSamplePulls(item.id, pulls.map((p, i) => i === idx ? { ...p, [field]: value } : p));
    const setQty = (idx: number, sz: string, value: string) => {
      const n = parseInt(value, 10);
      saveSamplePulls(item.id, pulls.map((p, i) => {
        if (i !== idx) return p;
        const q = { ...p.qtys };
        if (!n || n <= 0) delete q[sz]; else q[sz] = n;
        return { ...p, qtys: q };
      }));
    };
    const cols = `repeat(${sizes.length}, 34px) minmax(70px,1fr) minmax(84px,1.3fr) 16px`;
    return (
      <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%", maxWidth: 540, overflowX: "auto" }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Sample pulls (internal)</span>
        {pulls.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center" }}>
            {/* header */}
            {sizes.map(sz => (
              <span key={`h-${sz}`} style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", textAlign: "center", fontFamily: mono }}>{sz}</span>
            ))}
            <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", paddingLeft: 2 }}>For</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", paddingLeft: 2 }}>To</span>
            <span />
            {/* rows */}
            {pulls.map((p, idx) => (
              <Fragment key={idx}>
                {sizes.map(sz => {
                  const v = p.qtys?.[sz];
                  return (
                    <input key={sz} value={v ? String(v) : ""} placeholder="·" inputMode="numeric"
                      onChange={e => setQty(idx, sz, e.target.value)} onBlur={() => flushSamplePulls(item.id)}
                      style={{ ...ic, ...cell, width: 34, textAlign: "center", fontFamily: mono, color: v ? T.amber : T.faint, borderColor: v ? T.amber : T.border }} />
                  );
                })}
                <input value={p.for || ""} placeholder="for who"
                  onChange={e => setText(idx, "for", e.target.value)} onBlur={() => flushSamplePulls(item.id)}
                  style={{ ...ic, ...cell, minWidth: 0 }} />
                <input value={p.to || ""} placeholder="where to"
                  onChange={e => setText(idx, "to", e.target.value)} onBlur={() => flushSamplePulls(item.id)}
                  style={{ ...ic, ...cell, minWidth: 0 }} />
                <button onClick={() => { saveSamplePulls(item.id, pulls.filter((_, i) => i !== idx)); flushSamplePulls(item.id); }}
                  title="Remove pull"
                  style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
              </Fragment>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => saveSamplePulls(item.id, [...pulls, { qtys: {}, for: "", to: "" }])}
            style={{ fontSize: 11, fontWeight: 600, color: T.accent, background: "none", border: `1px dashed ${T.border}`, borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontFamily: font }}>
            + Add pull
          </button>
          {item.sizes.length > 1 && (
            <button onClick={() => saveSamplePulls(item.id, [...pulls, { qtys: Object.fromEntries(item.sizes.map(sz => [sz, 1])), for: "", to: "" }])}
              title="Adds a pull with one of every size"
              style={{ fontSize: 11, fontWeight: 600, color: T.muted, background: "none", border: `1px dashed ${T.border}`, borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontFamily: font }}>
              + Size run
            </button>
          )}
        </div>
      </div>
    );
  }

  async function handlePackingSlipUpload(input: File | File[] | FileList, project: ProjectGroup, dgItems: ProdItem[]) {
    const files: File[] = input instanceof File ? [input] : Array.from(input as any);
    if (files.length === 0) return;
    const key = project.jobId + "_" + (dgItems[0]?.decorator_id || "");
    setUploadingSlip(key);
    setSlipProgress(0);
    setSlipStatus(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const prefix = files.length > 1 ? `(${i + 1}/${files.length}) ` : "";
        setSlipStatus(`${prefix}Uploading ${file.name}...`);
        setSlipProgress(0);
        const result = await uploadToDrive({
          blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream",
          clientName: project.clientName, projectTitle: project.jobTitle, itemName: "Packing Slips",
          onProgress: (pct: number) => setSlipProgress(pct),
        });
        setSlipStatus(`${prefix}Registering ${dgItems.length} item${dgItems.length === 1 ? "" : "s"}...`);
        for (const item of dgItems) {
          await registerFileInDb({
            fileId: result.fileId, webViewLink: result.webViewLink, folderLink: result.folderLink,
            fileName: file.name, mimeType: file.type, fileSize: file.size,
            itemId: item.id, stage: "packing_slip", notes: result.folderLink,
          });
          setPackingSlips(prev => ({
            ...prev,
            [item.id]: [...(prev[item.id] || []), { id: result.fileId, file_name: file.name, drive_link: result.webViewLink, folder_link: result.folderLink }],
          }));
        }
      }
      setSlipStatus(files.length > 1 ? `Uploaded ${files.length} files` : "Uploaded");
      setTimeout(() => setSlipStatus(null), 2000);
    } catch (err: any) {
      alert("Packing slip error: " + err.message);
    }
    setUploadingSlip(null);
    setSlipProgress(0);
    setSlipStatus(null);
  }

  // ── Stats ──
  // Filter option lists — only vendors/clients that currently have items IN
  // PRODUCTION (a non-shipped item on a live job), so the dropdowns stay
  // relevant to the board, not every decorator/client ever.
  const { decorators, clients } = useMemo(() => {
    const decSet = new Set<string>();
    const cliSet = new Set<string>();
    for (const p of projects) {
      if (p.phase === "complete" || p.phase === "cancelled") continue;
      let clientHasInProd = false;
      for (const dg of p.decoratorGroups) {
        if (dg.items.some((it: any) => it.pipeline_stage !== "shipped")) {
          if (dg.decoratorName) decSet.add(dg.decoratorName);
          clientHasInProd = true;
        }
      }
      if (clientHasInProd && p.clientName) cliSet.add(p.clientName);
    }
    return { decorators: [...decSet].sort(), clients: [...cliSet].sort() };
  }, [projects]);

  // Vanity KPIs for items still at the decorator. Once an item ships
  // from the decorator (pipeline_stage = "shipped"), production is done
  // for that item — those units belong to Receiving, not here.
  // Recently-completed jobs are loaded for the list below but never
  // contribute to KPI counts.
  const productionKpis = useMemo(() => {
    const NON_GARMENT = new Set(["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"]);

    let items = 0;
    let units = 0;
    let prints = 0;

    for (const p of projects) {
      if (p.phase === "complete") continue;
      const costProds = (p.costingData?.costProds || []) as any[];
      // Match costProds to items by garment_type. costProd
      // print locations + tag give the per-piece decoration count
      // for items of that garment type. Multiplied by the item's
      // own qty (not the costProd's aggregate totalQty) so shipped
      // items don't get their prints counted again.
      const cpByGarment: Record<string, any> = {};
      for (const cp of costProds) {
        if (cp?.garment_type) cpByGarment[cp.garment_type] = cp;
      }
      for (const dg of p.decoratorGroups) {
        for (const it of dg.items) {
          if (it.pipeline_stage !== "in_production") continue;
          items++;
          units += it.total_units || 0;

          // Prints = garment screen-prints + tags only. Accessories /
          // non-garment items aren't screen-printed, so they don't count here
          // (they're still counted in Items + Units above).
          if (it.garment_type && NON_GARMENT.has(it.garment_type)) continue;
          const cp = it.garment_type ? cpByGarment[it.garment_type] : null;
          if (!cp) continue;
          const activeLocs = [1,2,3,4,5,6].filter(loc => {
            const ld = cp.printLocations?.[loc];
            return ld?.screens > 0 || ld?.location;
          }).length;
          const hasTag = cp.tagPrint ? 1 : 0;
          prints += (activeLocs + hasTag) * (it.total_units || 0);
        }
      }
    }
    return { items, units, prints };
  }, [projects]);

  // ── Filter & sort ──
  // Tab buckets:
  //   active   = any item still in_production (default view)
  //   overdue  = active + at least one in_production item past ship date
  //   stalled  = active + at least one in_production item ≥ STALL_DAYS old
  //   shipped  = every item has shipped (or job phase=complete)
  // Overdue + Stalled are sub-views of Active — they overlap, the count
  // tells you how many of the Active set fall into that signal.
  const STALL_DAYS = 7;
  const [tab, setTab] = useState<"active" | "overdue" | "stalled" | "shipped">("active");
  const [sortKey, setSortKey] = useState<"ship_date" | "days_at_decorator" | "decorator" | "client" | "units">("ship_date");
  const [viewMode, setViewMode] = useState<"grouped" | "list">("grouped");
  // Build-shipment flow — consolidate a vendor's items (across jobs) into one
  // shipment under one tracking #, marked shipped together.
  const [buildOpen, setBuildOpen] = useState(false);
  const [buildVendor, setBuildVendor] = useState<string | null>(null);
  const [buildChecked, setBuildChecked] = useState<Set<string>>(new Set());
  const [buildTracking, setBuildTracking] = useState("");
  const [buildPickup, setBuildPickup] = useState(false);
  const [buildSaving, setBuildSaving] = useState(false);
  const [mockupMap, setMockupMap] = useState<Record<string, { driveFileId: string | null; driveLink: string | null }>>({});
  const [mockupPeek, setMockupPeek] = useState<{ driveFileId: string | null; name: string } | null>(null);
  // List-view sorting is driven by clicking column headers (asc/desc toggle),
  // independent of the grouped board's sort dropdown.
  const [listSortKey, setListSortKey] = useState<"inv" | "client" | "item" | "decorator" | "stage" | "units" | "ship">("ship");
  const [listSortDir, setListSortDir] = useState<"asc" | "desc">("asc");
  const listHeaderClick = (key: "inv" | "client" | "item" | "decorator" | "stage" | "units" | "ship") => {
    if (key === listSortKey) setListSortDir(d => d === "asc" ? "desc" : "asc");
    else { setListSortKey(key); setListSortDir("asc"); }
  };

  // Stash useful per-project metadata for filtering/sorting so we
  // compute it once per render instead of re-walking decoratorGroups
  // multiple times.
  const enriched = useMemo(() => {
    return projects.map(p => {
      let oldestInProdTs: number | null = null;
      let anyInProduction = false;
      let allShipped = true;
      // Overdue is per-item, not project-aggregate: an item still at
      // its vendor with a vendor PO ship date in the past flags the
      // project. Vendor A done + Vendor B in-production with future
      // date = NOT overdue.
      let isOverdue = false;
      for (const dg of p.decoratorGroups) {
        for (const it of dg.items) {
          if (it.pipeline_stage === "in_production") {
            anyInProduction = true;
            allShipped = false;
            const ipAt = it.pipeline_timestamps?.in_production;
            if (ipAt) {
              const t = new Date(ipAt).getTime();
              if (oldestInProdTs === null || t < oldestInProdTs) oldestInProdTs = t;
            }
            // target_ship_date is the vendor-specific PO ship date now
            if (it.target_ship_date && new Date(it.target_ship_date).getTime() < now.getTime()) {
              isOverdue = true;
            }
          } else if (it.pipeline_stage !== "shipped") {
            allShipped = false;
          }
        }
      }
      const daysAtDecorator = oldestInProdTs
        ? Math.floor((now.getTime() - oldestInProdTs) / 86400000)
        : 0;
      const isShipped = allShipped || p.phase === "complete";
      const isStalled = anyInProduction && daysAtDecorator >= STALL_DAYS;
      return { p, daysAtDecorator, isShipped, isOverdue, isStalled, anyInProduction };
    });
  }, [projects]);

  // Apply text + decorator filters first — these layer on top of any tab.
  const baseFiltered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return enriched.filter(({ p }) => {
      if (q && !(p.clientName.toLowerCase().includes(q) || p.jobTitle.toLowerCase().includes(q) || p.jobNumber.toLowerCase().includes(q) || (p.invoiceNumber || "").toLowerCase().includes(q) ||
        p.decoratorGroups.some(dg => dg.decoratorName.toLowerCase().includes(q) || dg.items.some(it => it.name.toLowerCase().includes(q))))) return false;
      if (filterDecorator && !p.decoratorGroups.some(dg => dg.decoratorName === filterDecorator)) return false;
      if (filterClient && p.clientName !== filterClient) return false;
      return true;
    });
  }, [enriched, search, filterDecorator, filterClient]);

  // Per-tab counts (always reflect the base-filtered set so they update
  // as the user types or picks a decorator).
  const tabCounts = useMemo(() => ({
    active: baseFiltered.filter(e => e.anyInProduction).length,
    overdue: baseFiltered.filter(e => e.isOverdue).length,
    stalled: baseFiltered.filter(e => e.isStalled).length,
    shipped: baseFiltered.filter(e => e.isShipped).length,
  }), [baseFiltered]);

  // Visible set — matches the current tab.
  const visible = useMemo(() => {
    const arr = baseFiltered.filter(e => {
      if (tab === "active") return e.anyInProduction;
      if (tab === "overdue") return e.isOverdue;
      if (tab === "stalled") return e.isStalled;
      if (tab === "shipped") return e.isShipped;
      return true;
    });
    const cmp = (a: typeof arr[number], b: typeof arr[number]) => {
      if (sortKey === "ship_date") {
        const av = a.p.shipDate ? new Date(a.p.shipDate).getTime() : Infinity;
        const bv = b.p.shipDate ? new Date(b.p.shipDate).getTime() : Infinity;
        return av - bv;
      }
      if (sortKey === "days_at_decorator") return b.daysAtDecorator - a.daysAtDecorator;
      if (sortKey === "decorator") {
        const av = a.p.decoratorGroups[0]?.decoratorName.toLowerCase() || "";
        const bv = b.p.decoratorGroups[0]?.decoratorName.toLowerCase() || "";
        return av.localeCompare(bv);
      }
      if (sortKey === "client") return a.p.clientName.toLowerCase().localeCompare(b.p.clientName.toLowerCase());
      if (sortKey === "units") return b.p.totalUnits - a.p.totalUnits;
      return 0;
    };
    return [...arr].sort(cmp).map(e => e.p);
  }, [baseFiltered, tab, sortKey]);

  // Tab-filtered list; row UI handles both in-production and shipped
  // states via the existing decorator-group rendering.
  const activeProjects = visible;

  // Phase 1 — each active project's decorator groups flatten into one strip
  // per JOB×VENDOR (the real ship unit). The strip carries that VENDOR's own
  // ship date (so the day counter is precise, not the job's earliest), its
  // route→destination, and unit count. Sorted by urgency (ASAP/overdue first).
  const activeStrips = useMemo(() => {
    const out: { project: any; dg: any; decKey: string; shipDate: string | null; units: number; route: string }[] = [];
    for (const project of activeProjects) {
      for (const dg of project.decoratorGroups) {
        const decKey = dg.decoratorId || dg.decoratorName;
        const shipDate = dg.items.find((i: any) => i.target_ship_date)?.target_ship_date ?? project.shipDate ?? null;
        const units = dg.items.reduce((a: number, it: any) => a + (it.total_units || 0), 0);
        const route = dg.items.find((i: any) => i.shipping_route)?.shipping_route || project.shippingRoute || "ship_through";
        out.push({ project, dg, decKey, shipDate, units, route });
      }
    }
    const val = (d: string | null) => (d === "ASAP" ? -Infinity : d ? new Date(d).getTime() : Infinity);
    return out.sort((a, b) => val(a.shipDate) - val(b.shipDate));
  }, [activeProjects]);

  // All un-shipped items grouped by vendor (across ALL jobs, any tab) — the
  // source for the Build-shipment picker. A consolidator (One Stop) shows its
  // 30 items spanning 15 jobs here, to ship as one tracking #.
  const vendorShipGroups = useMemo(() => {
    const m = new Map<string, { decKey: string; name: string; shortCode: string; items: { id: string; ref: string; name: string; units: number; item: ProdItem }[] }>();
    for (const p of projects) for (const dg of p.decoratorGroups) {
      const decKey = dg.decoratorId || dg.decoratorName;
      for (const it of dg.items) {
        if (it.pipeline_stage === "shipped") continue;
        let g = m.get(decKey);
        if (!g) { g = { decKey, name: dg.decoratorName, shortCode: dg.shortCode, items: [] }; m.set(decKey, g); }
        g.items.push({ id: it.id, ref: p.invoiceNumber || p.jobNumber, name: it.name, units: it.total_units || 0, item: it });
      }
    }
    return Array.from(m.values()).filter(g => g.items.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  function openBuild() { setBuildVendor(null); setBuildChecked(new Set()); setBuildTracking(""); setBuildPickup(false); setBuildOpen(true); }
  function selectBuildVendor(decKey: string) {
    setBuildVendor(decKey);
    const g = vendorShipGroups.find(x => x.decKey === decKey);
    setBuildChecked(new Set((g?.items || []).map(i => i.id))); // pre-check all
  }
  async function shipBuild() {
    const g = vendorShipGroups.find(x => x.decKey === buildVendor);
    if (!g) return;
    const targets = g.items.filter(i => buildChecked.has(i.id));
    if (!targets.length) return;
    setBuildSaving(true);
    for (const t of targets) {
      await shipItemFromDecorator(supabase, { ...t.item, ship_tracking: buildPickup ? null : (buildTracking.trim() || null), pickup_ready: buildPickup, ship_qtys: t.item.qtys });
    }
    setBuildSaving(false); setBuildOpen(false); loadAll();
  }

  const getDaysToShip = (d: string | null) => {
    if (!d || d === "ASAP") return null;
    return Math.ceil((new Date(d).getTime() - now.getTime()) / 86400000);
  };

  const getDaysInStage = (item: ProdItem) => {
    const ts = item.pipeline_timestamps?.[item.pipeline_stage || ""];
    if (!ts) return null;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  };

  const shipDatePill = (d: string | null) => {
    // ASAP sentinel — no calendar date, treat as urgent. Set on the
    // PO tab when the team wants the decorator to ship immediately.
    if (d === "ASAP") return { color: T.red, bg: T.redDim, label: "ASAP", dateStr: "ASAP" };
    const days = getDaysToShip(d);
    if (days === null) return null;
    // Healthy/comfortable ship dates render as plain T.text — color is
    // reserved for actionable signals only (red overdue, amber imminent).
    const color = days < 0 ? T.red : days <= 3 ? T.amber : T.text;
    const bg = days < 0 ? T.redDim : days <= 3 ? T.amberDim : T.surface;
    const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`;
    return { color, bg, label, dateStr: new Date(d!).toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
  };

  // Flat one-row-per-item list for the "List" view. Same tab + decorator +
  // search filters as the grouped board, but evaluated per item so each line
  // is precise (Active = items still in_production, etc.). Sorted per item.
  const itemRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    const rows: { it: ProdItem; p: ProjectGroup }[] = [];
    for (const { p } of enriched) {
      for (const dg of p.decoratorGroups) {
        for (const it of dg.items) {
          const inProd = it.pipeline_stage === "in_production";
          const shipped = it.pipeline_stage === "shipped";
          const overdue = inProd && !!it.target_ship_date && it.target_ship_date !== "ASAP"
            && new Date(it.target_ship_date).getTime() < now.getTime();
          const dInStage = getDaysInStage(it) ?? 0;
          const stalled = inProd && dInStage >= STALL_DAYS;
          const matchesTab = tab === "active" ? inProd : tab === "overdue" ? overdue : tab === "stalled" ? stalled : shipped;
          if (!matchesTab) continue;
          if (filterDecorator && it.decorator_name !== filterDecorator) continue;
          if (filterClient && p.clientName !== filterClient) continue;
          if (q && !(
            p.clientName.toLowerCase().includes(q) || p.jobTitle.toLowerCase().includes(q) ||
            p.jobNumber.toLowerCase().includes(q) || (p.invoiceNumber || "").toLowerCase().includes(q) ||
            it.name.toLowerCase().includes(q) || (it.decorator_name || "").toLowerCase().includes(q)
          )) continue;
          rows.push({ it, p });
        }
      }
    }
    const shipVal = (d: string | null) => d === "ASAP" ? -Infinity : d ? new Date(d).getTime() : Infinity;
    const invVal = (s: string | null) => { const n = parseFloat(s || ""); return Number.isFinite(n) ? n : Infinity; };
    // Natural ascending comparison per column; listSortDir flips it.
    const cmpAsc = (a: { it: ProdItem; p: ProjectGroup }, b: { it: ProdItem; p: ProjectGroup }) => {
      switch (listSortKey) {
        case "inv": return invVal(a.p.invoiceNumber) - invVal(b.p.invoiceNumber);
        case "client": return a.p.clientName.toLowerCase().localeCompare(b.p.clientName.toLowerCase());
        case "item": return (a.it.name || "").toLowerCase().localeCompare((b.it.name || "").toLowerCase());
        case "decorator": return (a.it.decorator_short_code || a.it.decorator_name || "").localeCompare(b.it.decorator_short_code || b.it.decorator_name || "");
        case "stage": return (a.it.pipeline_stage || "").localeCompare(b.it.pipeline_stage || "");
        case "units": return (a.it.total_units || 0) - (b.it.total_units || 0);
        case "ship": return shipVal(a.it.target_ship_date) - shipVal(b.it.target_ship_date);
        default: return 0;
      }
    };
    const dir = listSortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => cmpAsc(a, b) * dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, tab, listSortKey, listSortDir, search, filterDecorator, filterClient]);

  const ic: React.CSSProperties = { padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 11, fontFamily: mono, outline: "none", width: "100%" };

  // Per-size shipped-qty editor for the LIST-view ship modals (single + batch).
  // Each size defaults to its ordered qty; the border turns amber when shipping
  // under / green when over. Writes ship_qtys (debounced) and updates local
  // state immediately, so Mark Shipped persists exactly what's shown. The
  // grouped view has its own inline copy of this grid (left untouched on
  // purpose) — this helper only serves the two list-flow modals.
  function shipQtyInputs(item: ProdItem) {
    return item.sizes.map(sz => {
      const ordered = item.qtys[sz] || 0;
      const shipped = (item.ship_qtys || {})[sz] ?? ordered;
      const diffColor = shipped < ordered ? T.amber : shipped > ordered ? T.green : null;
      return (
        <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{sz}</span>
          <input type="text" inputMode="numeric" value={shipped}
            onClick={e => { e.stopPropagation(); (e.target as HTMLInputElement).select(); }}
            onChange={e => {
              const val = parseInt(e.target.value) || 0;
              const newQtys = { ...(item.ship_qtys || {}), [sz]: val };
              setProjects(prev => prev.map(p => ({
                ...p, decoratorGroups: p.decoratorGroups.map(dg2 => ({
                  ...dg2, items: dg2.items.map(it => it.id === item.id ? { ...it, ship_qtys: newQtys } : it)
                }))
              })));
              if (saveTimers.current[`sqty_${item.id}`]) clearTimeout(saveTimers.current[`sqty_${item.id}`]);
              saveTimers.current[`sqty_${item.id}`] = setTimeout(() => {
                (supabase.from("items") as any).update({ ship_qtys: newQtys }).eq("id", item.id);
              }, 800);
            }}
            style={{ ...ic, width: 52, padding: "8px 6px", textAlign: "center", fontSize: 13, fontFamily: mono, border: `1px solid ${diffColor || T.border}`, color: T.text }} />
          <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>{ordered}</span>
        </div>
      );
    });
  }

  // ── List-view batch selection. Reuses the global selectedItemIds + the
  // batch-ship modal (batchShipState). The modal ships the FULL selection.
  // One tracking # applies to all, so we flag (not block) selections that span
  // multiple decorators so it's a deliberate choice. Modal context (title,
  // notify) comes from the first selected item's project + decorator.
  const listSelected = itemRows.filter(r => selectedItemIds.has(r.it.id));
  const listEligible = listSelected.filter(r => r.it.pipeline_stage !== "shipped");
  const listMultiDeco = new Set(listEligible.map(r => r.it.decorator_id || r.it.decorator_name)).size > 1;
  const openListBatchShip = () => {
    if (listEligible.length === 0) return;
    const first = listEligible[0];
    const dg = first.p.decoratorGroups.find(g => (g.decoratorId || g.decoratorName) === (first.it.decorator_id || first.it.decorator_name));
    if (!dg) return;
    setBatchTracking("");
    setBatchNotes("");
    setBatchShipState({ items: listEligible.map(r => r.it), project: first.p, dg });
  };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading production...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14, maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      {/* Header — title + search + decorator dropdown on one row, mirrors Projects */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Production</h1>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, clients, decorators..."
          style={{ flex: 1, maxWidth: 360, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: filterClient ? T.text : T.muted, fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c} value={c!}>{c}</option>)}
        </select>
        <select value={filterDecorator} onChange={e => setFilterDecorator(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: filterDecorator ? T.text : T.muted, fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">All decorators</option>
          {decorators.map(d => <option key={d} value={d!}>{d}</option>)}
        </select>
      </div>

      {/* KPI strip — vanity counts for active production work (Items ·
          Units · Prints). Action queues (Needs blanks / Awaiting client
          / etc.) live on the Command Center, not here. Same tile style
          as the Projects page. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 10,
      }}>
        {[
          { label: "Items",  value: productionKpis.items.toLocaleString(),  tone: T.text },
          { label: "Units",  value: productionKpis.units.toLocaleString(),  tone: T.muted },
          { label: "Prints", value: productionKpis.prints.toLocaleString(), tone: T.purple },
        ].map(s => (
          <div key={s.label} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.tone, lineHeight: 1, fontFamily: mono }}>
              {s.value}
            </div>
            <div style={{ fontSize: 9, color: T.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Tab bar — flat underline pattern matching the Projects page.
          Sort dropdown right-aligned. */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
        {([
          ["active",   "Active",   tabCounts.active,   T.text],
          ["overdue",  "Overdue",  tabCounts.overdue,  T.red],
          ["stalled",  "Stalled",  tabCounts.stalled,  T.amber],
          ["shipped",  "Shipped",  tabCounts.shipped,  T.green],
        ] as const).map(([k, l, count, tone]) => {
          const active = tab === k;
          return (
            <button key={k} onClick={() => setTab(k as any)}
              style={{
                background: "transparent", border: "none", padding: "4px 0",
                cursor: "pointer", fontFamily: font,
                fontSize: 13, fontWeight: active ? 800 : 600,
                color: active ? T.text : T.muted,
                borderBottom: active ? `2px solid ${T.text}` : "2px solid transparent",
                marginBottom: -7,
              }}>
              {l}
              {count > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: count > 0 && (k === "overdue" || k === "stalled") ? tone : T.faint }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button onClick={openBuild}
          style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 13px", fontSize: 11.5, fontWeight: 700, fontFamily: font, cursor: "pointer", marginRight: 4 }}>
          + Build shipment
        </button>
        <div style={{ display: "flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
          {(["grouped", "list"] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              style={{
                background: viewMode === m ? T.surface : "transparent",
                color: viewMode === m ? T.text : T.muted,
                border: "none", padding: "5px 12px", fontSize: 11, fontWeight: 700,
                fontFamily: font, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em",
              }}>{m === "grouped" ? "Grouped" : "List"}</button>
          ))}
        </div>
        {viewMode === "grouped" && (
        <select value={sortKey} onChange={e => setSortKey(e.target.value as any)}
          style={{ background: "transparent", border: "none", padding: "4px 0", fontSize: 11, fontWeight: 700, color: T.muted, fontFamily: font, textTransform: "uppercase", letterSpacing: "0.07em", cursor: "pointer", outline: "none" }}>
          <option value="ship_date">Sort · Ship date</option>
          <option value="days_at_decorator">Sort · Days at decorator</option>
          <option value="decorator">Sort · Decorator</option>
          <option value="client">Sort · Client</option>
          <option value="units">Sort · Units</option>
        </select>
        )}
      </div>

      {/* ── Active Projects ── */}
      {viewMode === "grouped" && activeStrips.length === 0 && (
        <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>
          {tab === "active" ? "No active production" : tab === "overdue" ? "Nothing overdue" : tab === "stalled" ? "No stalls" : "Nothing shipped"}
        </div>
      )}

      {/* ── List view — one row per item, click-through to the project ── */}
      {viewMode === "list" && (
        itemRows.length === 0 ? (
          <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>
            {tab === "active" ? "No items in production" : tab === "overdue" ? "Nothing overdue" : tab === "stalled" ? "No stalled items" : "Nothing shipped"}
          </div>
        ) : (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
            {listEligible.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
                <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{listEligible.length} selected</span>
                <button onClick={() => setSelectedItemIds(new Set())} style={{ background: "none", border: "none", color: T.muted, fontSize: 11, cursor: "pointer", fontFamily: font }}>Clear</button>
                <div style={{ flex: 1 }} />
                {listMultiDeco && (
                  <span style={{ fontSize: 11, color: T.amber }}>spans multiple decorators · one tracking # applies to all</span>
                )}
                <button onClick={openListBatchShip} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                  Ship Selected · {listEligible.length}
                </button>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", userSelect: "none" }}>
              <div style={{ width: 24, flexShrink: 0 }} />
              <div onClick={() => listHeaderClick("inv")} style={{ width: 90, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, color: listSortKey === "inv" ? T.text : T.muted }}>Inv #<span style={{ fontSize: 8, opacity: listSortKey === "inv" ? 0.9 : 0.3 }}>{listSortKey === "inv" ? (listSortDir === "asc" ? "▲" : "▼") : "↕"}</span></div>
              <div onClick={() => listHeaderClick("client")} style={{ width: 160, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, color: listSortKey === "client" ? T.text : T.muted }}>Client<span style={{ fontSize: 8, opacity: listSortKey === "client" ? 0.9 : 0.3 }}>{listSortKey === "client" ? (listSortDir === "asc" ? "▲" : "▼") : "↕"}</span></div>
              <div onClick={() => listHeaderClick("item")} style={{ flex: 1, minWidth: 0, paddingLeft: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, color: listSortKey === "item" ? T.text : T.muted }}>Item<span style={{ fontSize: 8, opacity: listSortKey === "item" ? 0.9 : 0.3 }}>{listSortKey === "item" ? (listSortDir === "asc" ? "▲" : "▼") : "↕"}</span></div>
              <div onClick={() => listHeaderClick("decorator")} style={{ width: 104, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, color: listSortKey === "decorator" ? T.text : T.muted }}>Deco<span style={{ fontSize: 8, opacity: listSortKey === "decorator" ? 0.9 : 0.3 }}>{listSortKey === "decorator" ? (listSortDir === "asc" ? "▲" : "▼") : "↕"}</span></div>
              <div onClick={() => listHeaderClick("stage")} style={{ width: 110, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, color: listSortKey === "stage" ? T.text : T.muted }}>Stage<span style={{ fontSize: 8, opacity: listSortKey === "stage" ? 0.9 : 0.3 }}>{listSortKey === "stage" ? (listSortDir === "asc" ? "▲" : "▼") : "↕"}</span></div>
              <div onClick={() => listHeaderClick("units")} style={{ width: 56, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, color: listSortKey === "units" ? T.text : T.muted }}>Units<span style={{ fontSize: 8, opacity: listSortKey === "units" ? 0.9 : 0.3 }}>{listSortKey === "units" ? (listSortDir === "asc" ? "▲" : "▼") : "↕"}</span></div>
              <div onClick={() => listHeaderClick("ship")} style={{ width: 84, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, color: listSortKey === "ship" ? T.text : T.muted }}>Ship<span style={{ fontSize: 8, opacity: listSortKey === "ship" ? 0.9 : 0.3 }}>{listSortKey === "ship" ? (listSortDir === "asc" ? "▲" : "▼") : "↕"}</span></div>
              <div style={{ width: 72, flexShrink: 0 }} />
            </div>
            {itemRows.map(({ it, p }) => {
              const isShipped = it.pipeline_stage === "shipped";
              const ship = shipDatePill(it.target_ship_date);
              return (
                <div key={it.id}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${T.border}55`, fontSize: 12 }}
                  onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  {/* Select checkbox — non-shipped items only */}
                  <div style={{ width: 24, flexShrink: 0, display: "flex", alignItems: "center" }} onClick={e => e.stopPropagation()}>
                    {!isShipped && (
                      <input type="checkbox" checked={selectedItemIds.has(it.id)} onChange={() => toggleItemSelected(it.id)}
                        style={{ width: 15, height: 15, cursor: "pointer", accentColor: T.accent }} />
                    )}
                  </div>
                  {/* Inv # */}
                  <div style={{ width: 90, flexShrink: 0, color: p.invoiceNumber ? T.text : T.faint, fontFamily: mono, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.invoiceNumber || "—"}</div>
                  {/* Client (+ project / PO subtitle) */}
                  <div style={{ width: 160, flexShrink: 0, minWidth: 0 }}>
                    <div style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.clientName || "No client"}</div>
                    {p.jobTitle && <div style={{ color: T.faint, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.jobTitle}</div>}
                  </div>
                  {/* Item (letter dropped in this view) */}
                  <div onClick={() => setMockupPeek({ driveFileId: mockupMap[it.id]?.driveFileId || null, name: it.name })} title="View mockup"
                    style={{ flex: 1, minWidth: 0, paddingLeft: 10, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{it.name}</div>
                  {/* Deco — widened so the full short code fits */}
                  <div style={{ width: 104, flexShrink: 0, color: T.muted, fontFamily: mono, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.decorator_short_code || it.decorator_name || "—"}</div>
                  {/* Stage */}
                  <div style={{ width: 110, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: isShipped ? T.green : T.blue, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {isShipped ? "Shipped" : "In Production"}
                    </span>
                  </div>
                  {/* Units */}
                  <div style={{ width: 56, flexShrink: 0, textAlign: "right", fontFamily: mono, color: T.text }}>{it.total_units || 0}</div>
                  {/* Ship date */}
                  <div style={{ width: 84, flexShrink: 0, textAlign: "right", fontFamily: mono }}>
                    {ship ? <span style={{ color: isShipped ? T.muted : ship.color }}>{ship.dateStr}</span> : <span style={{ color: T.faint }}>—</span>}
                  </div>
                  {/* Ship action — opens the per-item ship modal */}
                  <div style={{ width: 72, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                    {isShipped ? (
                      <span style={{ fontSize: 10, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.04em" }}>Shipped</span>
                    ) : (
                      <button onClick={() => setShipDetailItem(it)}
                        style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                        Ship
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {viewMode === "grouped" && activeStrips.length > 0 && (
        <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "0 19px 2px", fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          <div style={{ width: 240, flexShrink: 0 }}>Job</div>
          <div style={{ width: 150, flexShrink: 0 }}>Vendor</div>
          <div style={{ width: 130, flexShrink: 0 }}>Route</div>
          <div style={{ width: 160, flexShrink: 0 }}>Arrival ETA</div>
          <div style={{ flex: 1 }} />
          <div style={{ width: 90, flexShrink: 0, textAlign: "right" }}>Ship</div>
        </div>
      )}
      {viewMode === "grouped" && activeStrips.map(strip => {
        const project = strip.project; const dg = strip.dg;
        const isModalOpen = modalProject?.jobId === project.jobId && modalDecoratorKey === strip.decKey;
        const ship = shipDatePill(strip.shipDate);
        const allShipped = dg.items.every((it: any) => it.pipeline_stage === "shipped");
        const dest = strip.route === "drop_ship" ? `drop-ship → ${project.clientName || "client"}`
          : strip.route === "stage" ? "→ HPD · stage" : "→ HPD";
        // Arrival-at-HPD ETA: a per-item override wins, else auto (ship + buffer).
        const stripArrivalOverride = dg.items.find((i: any) => i.expected_arrival)?.expected_arrival || null;
        const stripArrival = stripArrivalOverride || computeArrivalEta(strip.route, strip.shipDate, dg.transitDays);
        const stripArrivalLabel = !stripArrival ? "—" : stripArrival === "ASAP" ? "ASAP" : new Date(stripArrival + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return (
          <div key={project.jobId + "::" + strip.decKey} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden",
          }}>
            {/* ── Job×vendor strip — the ship unit. One vendor's portion of one
                job, with that vendor's own ship date. Click opens the modal
                scoped to this vendor (the view the chip used to open). ── */}
            <div
              onClick={() => { setModalDecoratorKey(strip.decKey); setExpandedDecorators(new Set([strip.decKey])); setModalProject(project); }}
              style={{ padding: "12px 18px", display: "flex", gap: 14, alignItems: "center", cursor: "pointer" }}
              onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {/* Job + client */}
              <div style={{ width: 240, flexShrink: 0, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: project.invoiceNumber ? T.text : T.faint, fontFamily: mono, whiteSpace: "nowrap" }}>{project.invoiceNumber || project.jobNumber}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.clientName || "No client"}</span>
                  {allShipped && <span style={{ fontSize: 9, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>shipped</span>}
                </div>
                {project.jobTitle && <div style={{ fontSize: 11, color: T.faint, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.jobTitle}</div>}
              </div>
              {/* Vendor — the strip's identity */}
              <div style={{ width: 150, flexShrink: 0, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dg.shortCode || dg.decoratorName}</div>
                <div style={{ fontSize: 10.5, color: T.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {dg.items.length} item{dg.items.length !== 1 ? "s" : ""} · {strip.units.toLocaleString()}u
                  {dg.shipped > 0 && <span style={{ color: T.green }}> · {dg.shipped} shipped</span>}
                </div>
              </div>
              {/* Route → destination */}
              <div style={{ width: 130, flexShrink: 0, fontSize: 11.5, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dest}</div>
              {/* Arrival ETA at HPD (display-only). Auto = ship + vendor buffer;
                  overridable per item in the expanded view. */}
              <div style={{ width: 160, flexShrink: 0, fontFamily: mono, fontSize: 12 }}>
                <span style={{ color: stripArrival ? T.text : T.faint, fontWeight: stripArrivalOverride ? 700 : 400 }}>{stripArrivalLabel}</span>
                {!stripArrivalOverride && stripArrival && stripArrival !== "ASAP" && <span style={{ fontSize: 9, color: T.faint, marginLeft: 6 }}>auto</span>}
              </div>
              <div style={{ flex: 1 }} />
              {/* Ship — this vendor's own ship date / urgency */}
              <div style={{ width: 90, flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                {(() => {
                  const pri = project.priority === "hot" ? { label: "HOT", color: T.red }
                    : project.priority === "rush" ? { label: "RUSH", color: T.amber } : null;
                  return pri ? <span style={{ fontSize: 10, fontWeight: 800, color: pri.color, letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{pri.label}</span> : null;
                })()}
                {ship && (<>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ship.color, fontFamily: mono, whiteSpace: "nowrap" }}>{ship.label}</div>
                  <div style={{ fontSize: 10, color: T.faint, whiteSpace: "nowrap" }}>{ship.dateStr}</div>
                </>)}
              </div>
            </div>

            {/* ── Full-page modal — takes over the viewport, mirrors
                the art-studio brief modal pattern. ESC or × to close. ── */}
            {isModalOpen && (
              <div style={{ position: "fixed", inset: 0, background: T.bg, zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {/* Header */}
                  <div style={{ padding: "14px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0, background: T.card }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: T.text, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: mono }}>{project.invoiceNumber || project.jobNumber}</span>
                        <span style={{ color: T.muted, fontWeight: 600 }}>{project.clientName}</span>
                      </div>
                      <div style={{ fontSize: 12, color: T.faint, marginTop: 2 }}>
                        {project.jobTitle}
                        {project.invoiceNumber && <span style={{ marginLeft: 8, fontFamily: mono }}>{project.jobNumber}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      {ship && (
                        <div style={{ fontSize: 12, fontWeight: 700, color: ship.color, letterSpacing: "0.04em" }}>
                          {ship.dateStr} · {ship.label}
                        </div>
                      )}
                      <button onClick={() => { setModalProject(null); router.push(`/jobs/${project.jobId}`); }}
                        style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.text, fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: font, letterSpacing: "0.04em" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.color = T.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.text; }}>
                        View Project →
                      </button>
                      <button onClick={closeModalRespectReturn} title="Close (Esc)"
                        style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
                    </div>
                  </div>
                  {/* Scrollable body — filtered to the clicked decorator
                      so the modal stays focused. Switch vendors via the
                      project row's chips (close + reopen). */}
                  <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 22px" }}>
                {project.decoratorGroups
                  .filter(dg => {
                    if (!modalDecoratorKey) return true;
                    return (dg.decoratorId || dg.decoratorName) === modalDecoratorKey;
                  })
                  .map(dg => {
                  const decKey = dg.decoratorId || dg.decoratorName;
                  const visibleItems = dg.items;
                  // Ship-to resolution mirrors the PO PDF: per-vendor
                  // override → drop_ship venue → HPD warehouse default.
                  // Lookup uses printVendor (canonical costing key) with
                  // decoratorName/shortCode as fallbacks, case-insensitive.
                  const shipToAddress = (() => {
                    const costProds = (project.costingData?.costProds || []) as any[];
                    let printVendor: string | undefined;
                    for (const it of dg.items) {
                      const cp = costProds.find((c: any) => c?.id === it.id);
                      if (cp?.printVendor) { printVendor = cp.printVendor; break; }
                    }
                    const ciKey = (k: string | null | undefined) => (k || "").toLowerCase().trim();
                    const ciMap: Record<string, string> = {};
                    for (const [k, v] of Object.entries(project.poShipTo)) {
                      if (typeof v === "string" && v) ciMap[ciKey(k)] = v;
                    }
                    const tryKeys = [printVendor, dg.decoratorName, dg.shortCode].filter(Boolean) as string[];
                    for (const k of tryKeys) {
                      if (project.poShipTo[k]) return project.poShipTo[k];
                      const ci = ciMap[ciKey(k)];
                      if (ci) return ci;
                    }
                    if (project.shippingRoute === "drop_ship") {
                      return project.venueAddress || "(no address set)";
                    }
                    return "House Party Distro\n4670 W Silverado Ranch Blvd, STE 120\nLas Vegas, NV 89139";
                  })();
                  return (
                  <div key={decKey}>
                    {/* Page-style header — big decorator name, stats line,
                        ship-to address, filter pills. No bordered card
                        chrome. */}
                    <div style={{ paddingBottom: 14, borderBottom: `1px solid ${T.border}`, marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h2 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", color: T.text }}>
                            {dg.decoratorName}
                          </h2>
                          {(() => {
                            // Units shipped = sum of ship_qtys per shipped
                            // item, falling back to total_units if the item
                            // has no per-size breakdown.
                            const unitsShipped = dg.items.reduce((acc, it) => {
                              if (it.pipeline_stage !== "shipped") return acc;
                              const sq = it.ship_qtys || {};
                              const sqSum = Object.values(sq).reduce((a, b) => a + (b || 0), 0);
                              return acc + (sqSum > 0 ? sqSum : (it.total_units || 0));
                            }, 0);
                            return (
                              <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>
                                <strong style={{ color: T.text, fontWeight: 700 }}>{dg.inProduction}</strong> in production
                                <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                                <strong style={{ color: T.text, fontWeight: 700 }}>{dg.shipped}</strong> shipped
                                <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                                <strong style={{ color: T.text, fontWeight: 700 }}>{dg.totalUnits.toLocaleString()}</strong> units
                                <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                                <strong style={{ color: T.text, fontWeight: 700 }}>{unitsShipped.toLocaleString()}</strong> units shipped
                              </div>
                            );
                          })()}
                        </div>
                        {/* Ship-to card — top-right of header. Mirrors the
                            ship-to that prints on the PO so the team can
                            double-check before clicking Ship. */}
                        <div style={{ flexShrink: 0, padding: "8px 12px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}`, minWidth: 180, maxWidth: 280 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Ship to</div>
                          <div style={{ fontSize: 12, color: T.text, lineHeight: 1.45, whiteSpace: "pre-line" }}>{shipToAddress}</div>
                        </div>
                      </div>

                    </div>

                    {(<>
                    {/* Action row — Select all + Ship Selected (left) ·
                        View packing slips (right). Upload moved to per-item
                        Ship sub-modal. */}
                    {(() => {
                      const dgSlips = dg.items.flatMap(it => packingSlips[it.id] || []);
                      const uniqueSlips = dgSlips.filter((s, i, arr) => arr.findIndex(x => x.file_name === s.file_name) === i);
                      const allSelected = dg.items.length > 0 && dg.items.every(it => selectedItemIds.has(it.id));
                      // Ship Selected — operates on items in this decorator
                      // group that are both selected AND still in production.
                      // Hidden when nothing qualifies. Copies tracking from
                      // any selected item that already has one to the others
                      // (lets you fill it in once for the batch).
                      const eligible = dg.items.filter(it => selectedItemIds.has(it.id) && it.pipeline_stage !== "shipped");
                      return (
                        <div style={{ padding: "0 0 14px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={() => {
                            setSelectedItemIds(prev => {
                              const next = new Set(prev);
                              if (allSelected) {
                                // Unselect every item from this decorator group
                                for (const it of dg.items) next.delete(it.id);
                              } else {
                                for (const it of dg.items) next.add(it.id);
                              }
                              return next;
                            });
                          }}
                            style={{
                              fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 6,
                              background: allSelected ? T.text : "transparent",
                              border: `1px solid ${allSelected ? T.text : T.border}`,
                              color: allSelected ? "#fff" : T.text,
                              cursor: "pointer", fontFamily: font,
                            }}>
                            {allSelected ? "Unselect all" : "Select all"}
                          </button>
                          {eligible.length > 0 && (
                            <button onClick={() => {
                              // Seed tracking from any selected item that
                              // already has one (e.g. set previously via the
                              // per-item modal). Notes seeded the same way.
                              const seedTracking = eligible.find(it => it.ship_tracking)?.ship_tracking || "";
                              const seedNotes = eligible.find(it => it.ship_notes)?.ship_notes || "";
                              setBatchTracking(seedTracking);
                              setBatchNotes(seedNotes);
                              setBatchShipState({ items: eligible, project, dg });
                            }} style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 6, background: T.green, color: "#fff", border: "none", cursor: "pointer", fontFamily: font }}>
                              Ship Selected · {eligible.length}
                            </button>
                          )}
                          <div style={{ flex: 1 }} />
                          {uniqueSlips.length > 0 && (
                            <button onClick={(e) => { e.stopPropagation(); setViewingSlips({ files: uniqueSlips, index: 0, title: dg.shortCode || dg.decoratorName }); }}
                              style={{ fontSize: 11, padding: "5px 12px", borderRadius: 6, background: T.accentDim, color: T.accent, border: "none", cursor: "pointer", fontWeight: 600, fontFamily: font }}>
                              View packing slips ({uniqueSlips.length})
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Items */}
                    <div>
                      {visibleItems.length === 0 && (
                        <div style={{ fontSize: 13, color: T.faint, fontStyle: "italic", padding: "20px 0", textAlign: "center" }}>
                          No items match this filter.
                        </div>
                      )}
                      {visibleItems.map(item => {
                        const isShipped = item.pipeline_stage === "shipped";
                        return (
                          <div key={item.id} style={{
                            padding: "10px 12px", borderRadius: 6, marginBottom: 6,
                            background: isShipped ? T.greenDim + "44" : T.card,
                            border: `1px solid ${isShipped ? T.green + "33" : T.border}`,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                              <input
                                type="checkbox"
                                checked={selectedItemIds.has(item.id)}
                                onChange={() => toggleItemSelected(item.id)}
                                onClick={e => e.stopPropagation()}
                                style={{ width: 16, height: 16, cursor: "pointer", accentColor: T.accent, flexShrink: 0 }}
                              />
                              <span style={{ fontSize: 13, fontWeight: 800, color: T.muted, fontFamily: mono, flexShrink: 0 }}>{item.letter}</span>
                              {/* Title + specs stack */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.name}</div>
                                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                                  {item.blank_vendor || "—"} · {item.total_units} units
                                </div>
                                {/* Two-column edit row: ETA + TRK stacked
                                    on the left, the (taller) note textarea
                                    parallel on the right. Wraps below on
                                    very narrow widths. */}
                                <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap", alignItems: "stretch" }}>
                                  {/* Left sub-col: TRK + ETA (tracking sits
                                      above the ETA — tracking is the more
                                      action-oriented field; ETA is the
                                      follow-up client-facing detail). */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    {/* Ready for pickup — local pickup vendors. Pre-checks
                                        when the PO ship method is "Pick Up". Replaces the
                                        tracking field; groups by vendor on Receiving. */}
                                    {!isShipped && (
                                      <label onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", width: 212, background: item.pickup_ready ? T.greenDim : "transparent", border: `1px solid ${item.pickup_ready ? T.green : T.border}`, borderRadius: 5, padding: "3px 7px" }}>
                                        <input type="checkbox" checked={!!item.pickup_ready} onChange={e => { e.stopPropagation(); setPickupReady(item.id, e.target.checked); }} style={{ cursor: "pointer" }} />
                                        <span style={{ fontSize: 11, fontWeight: item.pickup_ready ? 700 : 600, color: item.pickup_ready ? T.green : T.muted }}>Ready for pickup</span>
                                      </label>
                                    )}
                                    {!isShipped && !item.pickup_ready && (
                                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", width: 26 }}>TRK</span>
                                        <input type="text"
                                          value={item.ship_tracking || ""}
                                          placeholder="paste tracking #"
                                          onClick={e => e.stopPropagation()}
                                          onChange={e => { e.stopPropagation(); updateField(item.id, "ship_tracking", e.target.value); }}
                                          onBlur={e => flushField(item.id, "ship_tracking", e.target.value)}
                                          style={{ ...ic, width: 180, padding: "3px 6px", fontSize: 11, fontFamily: mono, flexShrink: 0 }} />
                                      </div>
                                    )}
                                    {/* Arrival-at-HPD ETA (the ASN) override. Blank =
                                        auto (ship date + the vendor's transit buffer),
                                        shown on the strip. Set it once you have a real
                                        carrier ETA. Distinct from client_eta. */}
                                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                      <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", width: 26 }} title="Expected arrival at HPD — overrides the auto ship+buffer estimate">ETA</span>
                                      <input type="date"
                                        value={item.expected_arrival || ""}
                                        onClick={e => e.stopPropagation()}
                                        onChange={e => { e.stopPropagation(); updateField(item.id, "expected_arrival", e.target.value); }}
                                        onBlur={e => flushField(item.id, "expected_arrival", e.target.value)}
                                        style={{ ...ic, width: 180, padding: "3px 6px", fontSize: 11, fontFamily: mono, flexShrink: 0 }} />
                                    </div>
                                  </div>
                                  {/* Right sub-col: sample-pulls editor. The
                                      warehouse reads these on Receiving along
                                      with the ETA — which samples to pull, for
                                      who, and where they go. Add as needed. */}
                                  {samplePullsEditor(item)}
                                </div>
                              </div>
                              {/* Per-size ship qty grid — inline with title */}
                              {!isShipped && item.sizes.length > 0 && (
                                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                  {item.sizes.map(sz => {
                                    const ordered = item.qtys[sz] || 0;
                                    const shipped = (item.ship_qtys || {})[sz] ?? ordered;
                                    const diffColor = shipped < ordered ? T.amber : shipped > ordered ? T.green : null;
                                    return (
                                      <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                        <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{sz}</span>
                                        <input
                                          type="text" inputMode="numeric" value={shipped}
                                          onClick={e => { e.stopPropagation(); (e.target as HTMLInputElement).select(); }}
                                          onChange={e => {
                                            const val = parseInt(e.target.value) || 0;
                                            const newQtys = { ...(item.ship_qtys || {}), [sz]: val };
                                            setProjects(prev => prev.map(p => ({
                                              ...p, decoratorGroups: p.decoratorGroups.map(dg2 => ({
                                                ...dg2, items: dg2.items.map(it => it.id === item.id ? { ...it, ship_qtys: newQtys } : it)
                                              }))
                                            })));
                                            if (saveTimers.current[`sqty_${item.id}`]) clearTimeout(saveTimers.current[`sqty_${item.id}`]);
                                            saveTimers.current[`sqty_${item.id}`] = setTimeout(() => {
                                              supabase.from("items").update({ ship_qtys: newQtys }).eq("id", item.id);
                                            }, 800);
                                          }}
                                          style={{ ...ic, width: 52, padding: "8px 6px", textAlign: "center", fontSize: 13, fontFamily: mono, border: `1px solid ${diffColor || T.border}`, color: T.text }}
                                        />
                                        <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>{ordered}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {/* Ship button (or shipped status) */}
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                {isShipped ? (
                                  <>
                                    <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>
                                      {item.ship_tracking || "Shipped"}
                                    </span>
                                    {(() => {
                                      // Match either the legacy `drop_ship_vendor` records (still
                                      // written by the existing inline button on shipped rows
                                      // throughout the app) or the new v2 records of either
                                      // recipient kind. Once any matching record exists we surface
                                      // "Notified ✓" — the dialog itself handles resend.
                                      const notified = project.shippingNotifications.some(r =>
                                        (r.type === "drop_ship_vendor" || r.type === "decorator_to_warehouse") &&
                                        r.decoratorId === item.decorator_id &&
                                        (r.tracking || null) === (item.ship_tracking || null)
                                      );
                                      const canNotify = !!item.ship_tracking && !!project.invoiceNumber;
                                      const itemRoute = resolveRoute(item.shipping_route, project.shippingRoute);
                                      const label = notified ? "Notified ✓" : (itemRoute === "drop_ship" ? "Notify customer" : "Notify warehouse");
                                      const bg = notified ? T.greenDim : T.accent;
                                      const color = notified ? T.green : "#fff";
                                      const border = notified ? `1px solid ${T.green}66` : "none";
                                      return (
                                        <button onClick={(e) => {
                                          e.stopPropagation();
                                          if (!canNotify) return;
                                          openNotifyDialog({
                                            project,
                                            decoratorId: item.decorator_id,
                                            decoratorName: item.decorator_name || "",
                                            tracking: item.ship_tracking || "",
                                            route: itemRoute,
                                          });
                                        }}
                                          disabled={!canNotify}
                                          title={!project.invoiceNumber ? "Generate invoice first" : (!item.ship_tracking ? "Tracking required" : "")}
                                          style={{ fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 4, border, background: bg, color, cursor: canNotify ? "pointer" : "not-allowed", whiteSpace: "nowrap", opacity: canNotify ? 1 : 0.5, fontFamily: font }}>
                                          {label}
                                        </button>
                                      );
                                    })()}
                                    <button onClick={(e) => { e.stopPropagation(); undoShipped(item); }}
                                      style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                                      Undo
                                    </button>
                                  </>
                                ) : (
                                  <button onClick={(e) => { e.stopPropagation(); setShipDetailItem(item); }}
                                    style={{ padding: "8px 18px", borderRadius: 4, border: "none", background: T.green, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: font }}>
                                    Ship
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Decorator email thread */}
                    </>)}
                  </div>
                  );
                })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Build-shipment modal — pick a vendor, check items across jobs, ship as
          one tracking #. The shared tracking groups them as one shipment in Receiving. */}
      {buildOpen && (() => {
        const g = vendorShipGroups.find(x => x.decKey === buildVendor);
        const checkedCount = g ? g.items.filter(i => buildChecked.has(i.id)).length : 0;
        return (
          <div onClick={() => !buildSaving && setBuildOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,18,32,0.55)", backdropFilter: "blur(3px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, width: "min(620px, 94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 70px rgba(16,18,32,0.4)", fontFamily: font }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Build shipment</div>
                <button onClick={() => setBuildOpen(false)} style={{ background: "transparent", border: "none", color: T.faint, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Vendor</div>
                <select value={buildVendor || ""} onChange={e => selectBuildVendor(e.target.value)} style={{ width: "100%", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontFamily: font, fontSize: 13, padding: "8px 10px", outline: "none", cursor: "pointer" }}>
                  <option value="">Select a vendor…</option>
                  {vendorShipGroups.map(grp => <option key={grp.decKey} value={grp.decKey}>{grp.name} · {grp.items.length} item{grp.items.length !== 1 ? "s" : ""}</option>)}
                </select>
              </div>
              {g && (
                <div style={{ flex: 1, overflowY: "auto", padding: "6px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", fontSize: 11, color: T.muted }}>
                    <button onClick={() => setBuildChecked(new Set(g.items.map(i => i.id)))} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 11, fontFamily: font }}>All</button>
                    <button onClick={() => setBuildChecked(new Set())} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 11, fontFamily: font }}>None</button>
                    <span style={{ marginLeft: "auto" }}>{checkedCount} of {g.items.length} selected</span>
                  </div>
                  {g.items.map(i => {
                    const on = buildChecked.has(i.id);
                    return (
                      <label key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${T.border}33`, cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={e => { const n = new Set(buildChecked); e.target.checked ? n.add(i.id) : n.delete(i.id); setBuildChecked(n); }} style={{ cursor: "pointer" }} />
                        <span style={{ fontFamily: mono, fontSize: 12, color: T.text, width: 90, flexShrink: 0 }}>{i.ref}</span>
                        <span style={{ flex: 1, fontSize: 12.5, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.name}</span>
                        <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{i.units}u</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {g && (
                <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}` }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={buildPickup} onChange={e => setBuildPickup(e.target.checked)} />
                    <span style={{ fontSize: 12, color: buildPickup ? T.green : T.text, fontWeight: buildPickup ? 700 : 500 }}>Local pickup (no tracking)</span>
                  </label>
                  {!buildPickup && (
                    <input value={buildTracking} onChange={e => setBuildTracking(e.target.value)} placeholder="Shipment tracking # — one for the whole box" style={{ ...ic, width: "100%", padding: "8px 10px", fontSize: 12, fontFamily: mono, marginBottom: 10, boxSizing: "border-box" }} />
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button onClick={shipBuild} disabled={buildSaving || checkedCount === 0} style={{ background: checkedCount > 0 ? T.green : T.surface, color: checkedCount > 0 ? "#fff" : T.faint, border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: checkedCount > 0 && !buildSaving ? "pointer" : "default", fontFamily: font }}>
                      {buildSaving ? "Shipping…" : `Ship ${checkedCount} item${checkedCount !== 1 ? "s" : ""}`}
                    </button>
                    <span style={{ fontSize: 11.5, color: T.muted }}>{g.name}{buildPickup ? " · pickup" : buildTracking ? ` · ${buildTracking}` : ""}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Packing slip viewer modal */}
      {mockupPeek && <MockupPeek driveFileId={mockupPeek.driveFileId} name={mockupPeek.name} onClose={() => setMockupPeek(null)} />}

      {viewingSlips && (
        <div onClick={() => setViewingSlips(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, borderRadius: 12, width: "90vw", maxWidth: 900, height: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{viewingSlips.title} — Packing Slips</span>
                {viewingSlips.files.length > 1 && (
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{viewingSlips.index + 1} / {viewingSlips.files.length}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {viewingSlips.files.length > 1 && (
                  <>
                    <button onClick={() => setViewingSlips(v => v ? { ...v, index: Math.max(0, v.index - 1) } : null)} disabled={viewingSlips.index === 0}
                      style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: "none", color: viewingSlips.index === 0 ? T.faint : T.text, cursor: "pointer", fontSize: 12 }}>
                      Prev
                    </button>
                    <button onClick={() => setViewingSlips(v => v ? { ...v, index: Math.min(v.files.length - 1, v.index + 1) } : null)} disabled={viewingSlips.index === viewingSlips.files.length - 1}
                      style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: "none", color: viewingSlips.index === viewingSlips.files.length - 1 ? T.faint : T.text, cursor: "pointer", fontSize: 12 }}>
                      Next
                    </button>
                  </>
                )}
                <button onClick={() => setViewingSlips(null)}
                  style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: T.surface, color: T.muted, cursor: "pointer", fontSize: 12 }}>
                  Close
                </button>
              </div>
            </div>
            {/* File name */}
            <div style={{ padding: "6px 16px", fontSize: 11, color: T.muted, borderBottom: `1px solid ${T.border}` }}>
              {viewingSlips.files[viewingSlips.index].file_name}
            </div>
            {/* Embed */}
            <div style={{ flex: 1 }}>
              <iframe
                src={viewingSlips.files[viewingSlips.index].drive_link.replace("/view", "/preview")}
                style={{ width: "100%", height: "100%", border: "none" }}
                allow="autoplay"
              />
            </div>
          </div>
        </div>
      )}

      {/* Ship sub-modal — opens from row-level "Ship" button. Tracking
          and notes only; per-size qtys are edited inline on the row. */}
      {shipDetailItem && (() => {
        // Re-find latest version of the item + parent project from state
        // so any inline edits made before opening this modal are reflected.
        let liveItem: ProdItem | null = null;
        let liveProject: ProjectGroup | null = null;
        for (const p of projects) {
          for (const dg of p.decoratorGroups) {
            const found = dg.items.find(it => it.id === shipDetailItem.id);
            if (found) { liveItem = found; liveProject = p; break; }
          }
          if (liveItem) break;
        }
        if (!liveItem || !liveProject) return null;
        const item = liveItem;
        const project = liveProject;
        const slipKey = project.jobId + "_" + (item.decorator_id || "");
        const itemSlips = packingSlips[item.id] || [];
        return (
          <div onClick={() => setShipDetailItem(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.card, borderRadius: 12, width: "90vw", maxWidth: 480, padding: 24, fontFamily: font }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0, marginBottom: 4 }}>Ship · {item.name}</h3>
              <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>
                {item.blank_vendor || "—"} · {item.total_units} units
              </div>
              {/* Route badge — surfaces the project's shipping route in the
                  ship modal so the operator catches mismatches BEFORE flipping
                  the item to shipped. (Drop-ship items go decorator→client and
                  never appear in /receiving — easy to miss until the item has
                  "disappeared" past production.) Links back to the project's
                  Overview tab where the route can be changed. */}
              {(() => {
                const route = resolveRoute(item.shipping_route, project.shippingRoute);
                const routeLabel = route === "drop_ship" ? "DROP SHIP · direct to customer"
                  : route === "stage" ? "STAGE · fulfill from HPD"
                  : "SHIP-THROUGH · forward from HPD";
                const routeColor = route === "drop_ship" ? T.amber : route === "stage" ? T.purple : T.accent;
                const routeBg = route === "drop_ship" ? T.amberDim : route === "stage" ? T.purpleDim : T.accentDim;
                return (
                  <div style={{
                    marginBottom: 18,
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: routeBg,
                    border: `1px solid ${routeColor}55`,
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: routeColor, letterSpacing: "0.08em" }}>
                      {routeLabel}
                    </span>
                    <span style={{ flex: 1 }} />
                    <a href={`/jobs/${project.jobId}#overview`}
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: 10, fontWeight: 600, color: T.muted, textDecoration: "underline", fontFamily: font }}>
                      Change route
                    </a>
                  </div>
                );
              })()}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Shipped quantities — per-size, list-flow only. Grouped sets
                    these inline on the item row, so the grid is gated to the
                    list view here to leave the grouped Ship modal unchanged. */}
                {viewMode === "list" && item.pipeline_stage !== "shipped" && item.sizes.length > 0 && (
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>Shipped quantities</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{shipQtyInputs(item)}</div>
                    <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>Ordered shown below each — adjust if the vendor shipped a different count.</div>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>Tracking #</label>
                  <input value={item.ship_tracking || ""} placeholder="e.g. 1Z999AA10123456784"
                    onChange={e => updateField(item.id, "ship_tracking", e.target.value)}
                    style={{ ...ic, fontSize: 13, padding: "8px 10px" }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>Notes</label>
                  <input value={item.ship_notes || ""} placeholder="Optional"
                    onChange={e => updateField(item.id, "ship_notes", e.target.value)}
                    style={{ ...ic, fontSize: 13, padding: "8px 10px" }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>Packing slip</label>
                  {itemSlips.length > 0 && (
                    <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      {itemSlips.map(slip => (
                        <button
                          key={slip.id}
                          onClick={(e) => { e.stopPropagation(); setViewingSlips({ files: [slip], index: 0, title: item.name }); }}
                          style={{ fontSize: 12, padding: "8px 10px", borderRadius: 6, background: T.accentDim, color: T.accent, border: "none", cursor: "pointer", fontWeight: 600, fontFamily: font, textAlign: "left" }}>
                          {slip.file_name}
                        </button>
                      ))}
                    </div>
                  )}
                  {uploadingSlip === slipKey ? (
                    <div style={{ fontSize: 12, color: T.accent, padding: "8px 10px" }}>{slipStatus || `${slipProgress}%`}</div>
                  ) : (
                    <>
                      <div
                        onClick={(e) => { e.stopPropagation(); shipModalSlipInputRef.current?.click(); }}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setSlipDragOver("ship"); }}
                        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setSlipDragOver("ship"); }}
                        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setSlipDragOver(null); }}
                        onDrop={(e) => {
                          e.preventDefault(); e.stopPropagation(); setSlipDragOver(null);
                          const files = Array.from(e.dataTransfer.files || []);
                          if (files.length > 0) handlePackingSlipUpload(files, project, [item]);
                        }}
                        style={{
                          fontSize: 12, color: slipDragOver === "ship" ? T.accent : T.muted,
                          background: slipDragOver === "ship" ? T.accentDim : "none",
                          border: `1px dashed ${slipDragOver === "ship" ? T.accent : T.border}`,
                          borderRadius: 6, padding: "12px 10px", cursor: "pointer", fontFamily: font, width: "100%", textAlign: "center",
                        }}>
                        {slipDragOver === "ship" ? "Drop to upload" : (itemSlips.length > 0 ? "+ Add packing slip(s) — drag & drop or click" : "+ Upload packing slip(s) — drag & drop or click")}
                      </div>
                      <input ref={shipModalSlipInputRef} type="file" accept="image/*,.pdf" multiple style={{ display: "none" }}
                        onChange={e => { const fs = e.target.files; if (fs && fs.length > 0) handlePackingSlipUpload(fs, project, [item]); e.target.value = ""; }} />
                    </>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                <button onClick={() => setShipDetailItem(null)}
                  style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  Cancel
                </button>
                {/* Notify Recipient — only shown after Mark Shipped flipped
                    the item, gated by tracking + QB invoice. Surfaces
                    "Notified ✓" once a record exists for this (decorator
                    + tracking); clicking still opens the dialog → backend
                    dedups → "Already sent — Resend?" confirm. */}
                {item.pipeline_stage === "shipped" && (() => {
                  const canNotify = !!item.ship_tracking && !!project.invoiceNumber;
                  const notified = project.shippingNotifications.some(r =>
                    (r.type === "drop_ship_vendor" || r.type === "decorator_to_warehouse") &&
                    r.decoratorId === item.decorator_id &&
                    (r.tracking || null) === (item.ship_tracking || null)
                  );
                  const itemRoute = resolveRoute(item.shipping_route, project.shippingRoute);
                  const baseLabel = itemRoute === "drop_ship" ? "Notify customer" : "Notify warehouse";
                  // Lock once notified so a stray click can't re-fire the email.
                  const label = notified ? (itemRoute === "drop_ship" ? "Customer notified ✓" : "Warehouse notified ✓") : baseLabel;
                  const bg = notified ? T.greenDim : (canNotify ? T.accent : T.surface);
                  const color = notified ? T.green : (canNotify ? "#fff" : T.faint);
                  const border = notified ? `1px solid ${T.green}66` : "none";
                  return (
                    <button
                      disabled={!canNotify || notified}
                      onClick={() => {
                        if (!canNotify || notified) return;
                        openNotifyDialog({
                          project,
                          decoratorId: item.decorator_id,
                          decoratorName: item.decorator_name || "",
                          tracking: item.ship_tracking || "",
                          route: itemRoute,
                        });
                      }}
                      title={notified ? "Already notified — duplicate send blocked" : !project.invoiceNumber ? "Generate invoice first" : (!item.ship_tracking ? "Tracking required" : "")}
                      style={{ padding: "8px 18px", borderRadius: 6, border, background: bg, color, fontSize: 12, fontWeight: 700, cursor: notified ? "default" : (canNotify ? "pointer" : "not-allowed"), fontFamily: font, opacity: (notified || canNotify) ? 1 : 0.6 }}>
                      {label}
                    </button>
                  );
                })()}
                {item.pipeline_stage !== "shipped" && (
                  <button onClick={async () => { await markShipped(item); }}
                    style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                    Mark Shipped
                  </button>
                )}
                {item.pipeline_stage === "shipped" && (
                  <button onClick={() => setShipDetailItem(null)}
                    style={{ padding: "8px 18px", borderRadius: 6, border: `1px solid ${T.green}`, background: T.greenDim, color: T.green, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Batch ship sub-modal — opens from "Ship Selected · N". One
          tracking + notes + packing slip applied to every selected item.
          Vendors typically ship a single box with one tracking number
          covering multiple items. */}
      {batchShipState && (() => {
        // Re-find the latest version of each item from state so any
        // inline ship-qty edits are reflected before mark-shipped fires.
        const liveItems: ProdItem[] = [];
        for (const stale of batchShipState.items) {
          let live: ProdItem | null = null;
          for (const p of projects) {
            for (const dg2 of p.decoratorGroups) {
              const found = dg2.items.find(it => it.id === stale.id);
              if (found) { live = found; break; }
            }
            if (live) break;
          }
          if (live) liveItems.push(live);
        }
        if (liveItems.length === 0) return null;
        // Read the project LIVE from state (not the open-time snapshot) so the
        // notify button reflects shipping_notifications added while the modal is
        // still open — otherwise "Notify customer" never flips after sending.
        const project = projects.find(p => p.jobId === batchShipState.project.jobId) || batchShipState.project;
        const dg = batchShipState.dg;
        const slipKey = project.jobId + "_" + (dg.decoratorId || "");
        // Aggregate (deduped by file_name) packing slips already attached
        // to any of the selected items.
        const allSlips = liveItems.flatMap(it => packingSlips[it.id] || []);
        const uniqueSlips = allSlips.filter((s, i, arr) => arr.findIndex(x => x.file_name === s.file_name) === i);
        const totalUnits = liveItems.reduce((a, it) => a + (it.total_units || 0), 0);
        return (
          <div onClick={() => setBatchShipState(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.card, borderRadius: 12, width: "90vw", maxWidth: 520, padding: 24, fontFamily: font, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0, marginBottom: 4 }}>
                Ship {liveItems.length} {liveItems.length === 1 ? "item" : "items"} · {dg.decoratorName}
              </h3>
              <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>
                {totalUnits.toLocaleString()} total units
              </div>
              {/* Route badge — same intent as the single-item Ship modal:
                  surface the route up front so drop-ship items aren't shipped
                  by accident when the project is actually stage / ship-through.
                  Mirrors the badge in the single-item Ship modal above. */}
              {(() => {
                // Route is per-item (migration 076), and a batch can span jobs,
                // so resolve across the selection. Mixed routes can't be honestly
                // represented by one badge or one notify — flag it so the operator
                // ships deliberately. Each item still ships under its own route
                // (markShipped resolves per item in the loop below).
                const routes = Array.from(new Set(liveItems.map(it => resolveRoute(it.shipping_route, project.shippingRoute))));
                const mixed = routes.length > 1;
                const route = routes[0];
                const routeLabel = mixed ? "MIXED ROUTES · review before notifying"
                  : route === "drop_ship" ? "DROP SHIP · direct to customer"
                  : route === "stage" ? "STAGE · fulfill from HPD"
                  : "SHIP-THROUGH · forward from HPD";
                const routeColor = mixed || route === "drop_ship" ? T.amber : route === "stage" ? T.purple : T.accent;
                const routeBg = mixed || route === "drop_ship" ? T.amberDim : route === "stage" ? T.purpleDim : T.accentDim;
                return (
                  <div style={{
                    marginBottom: 16,
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: routeBg,
                    border: `1px solid ${routeColor}55`,
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: routeColor, letterSpacing: "0.08em" }}>
                      {routeLabel}
                    </span>
                    <span style={{ flex: 1 }} />
                    <a href={`/jobs/${project.jobId}#overview`}
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: 10, fontWeight: 600, color: T.muted, textDecoration: "underline", fontFamily: font }}>
                      Change route
                    </a>
                  </div>
                );
              })()}
              {/* Item list — confirm what's being shipped. In the list flow each
                  item also gets a per-size shipped-qty editor below its line.
                  Grouped keeps its exact original row (verbatim else branch). */}
              <div style={{ marginBottom: 18, padding: "10px 12px", borderRadius: 6, background: T.surface, border: `1px solid ${T.border}`, maxHeight: viewMode === "list" ? 320 : 160, overflowY: "auto" }}>
                {liveItems.map((it, idx) => (
                  viewMode === "list" ? (
                    <div key={it.id} style={{ padding: "6px 0", borderTop: idx > 0 ? `1px solid ${T.border}` : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                        <span style={{ fontFamily: mono, color: T.muted, fontWeight: 700 }}>{it.letter}</span>
                        <span style={{ flex: 1, color: T.text }}>{it.name}</span>
                        <span style={{ color: T.faint, fontFamily: mono }}>{it.total_units} units</span>
                      </div>
                      {it.sizes.length > 0 && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>{shipQtyInputs(it)}</div>
                      )}
                    </div>
                  ) : (
                    <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 12 }}>
                      <span style={{ fontFamily: mono, color: T.muted, fontWeight: 700 }}>{it.letter}</span>
                      <span style={{ flex: 1, color: T.text }}>{it.name}</span>
                      <span style={{ color: T.faint, fontFamily: mono }}>{it.total_units} units</span>
                    </div>
                  )
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>Tracking #</label>
                  <input value={batchTracking} placeholder="e.g. 1Z999AA10123456784"
                    onChange={e => setBatchTracking(e.target.value)}
                    style={{ ...ic, fontSize: 13, padding: "8px 10px" }} />
                  <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>Applied to all {liveItems.length} items.</div>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>Notes</label>
                  <input value={batchNotes} placeholder="Optional"
                    onChange={e => setBatchNotes(e.target.value)}
                    style={{ ...ic, fontSize: 13, padding: "8px 10px" }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>Packing slip</label>
                  {uniqueSlips.length > 0 && (
                    <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      {uniqueSlips.map(slip => (
                        <button
                          key={slip.id}
                          onClick={(e) => { e.stopPropagation(); setViewingSlips({ files: [slip], index: 0, title: dg.decoratorName }); }}
                          style={{ fontSize: 12, padding: "8px 10px", borderRadius: 6, background: T.accentDim, color: T.accent, border: "none", cursor: "pointer", fontWeight: 600, fontFamily: font, textAlign: "left" }}>
                          {slip.file_name}
                        </button>
                      ))}
                    </div>
                  )}
                  {uploadingSlip === slipKey ? (
                    <div style={{ fontSize: 12, color: T.accent, padding: "8px 10px" }}>{slipStatus || `${slipProgress}%`}</div>
                  ) : (
                    <>
                      <div
                        onClick={(e) => { e.stopPropagation(); batchModalSlipInputRef.current?.click(); }}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setSlipDragOver("batch"); }}
                        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setSlipDragOver("batch"); }}
                        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setSlipDragOver(null); }}
                        onDrop={(e) => {
                          e.preventDefault(); e.stopPropagation(); setSlipDragOver(null);
                          const files = Array.from(e.dataTransfer.files || []);
                          if (files.length > 0) handlePackingSlipUpload(files, project, liveItems);
                        }}
                        style={{
                          fontSize: 12, color: slipDragOver === "batch" ? T.accent : T.muted,
                          background: slipDragOver === "batch" ? T.accentDim : "none",
                          border: `1px dashed ${slipDragOver === "batch" ? T.accent : T.border}`,
                          borderRadius: 6, padding: "12px 10px", cursor: "pointer", fontFamily: font, width: "100%", textAlign: "center",
                        }}>
                        {slipDragOver === "batch" ? "Drop to upload" : (uniqueSlips.length > 0 ? "+ Add packing slip(s) — drag & drop or click" : "+ Upload packing slip(s) — drag & drop or click")}
                      </div>
                      <input ref={batchModalSlipInputRef} type="file" accept="image/*,.pdf" multiple style={{ display: "none" }}
                        onChange={e => { const fs = e.target.files; if (fs && fs.length > 0) handlePackingSlipUpload(fs, project, liveItems); e.target.value = ""; }} />
                    </>
                  )}
                </div>
              </div>
              {(() => {
                const allShipped = liveItems.length > 0 && liveItems.every(it => it.pipeline_stage === "shipped");
                const canNotify = allShipped && !!batchTracking.trim() && !!project.invoiceNumber;
                return (
                  <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
                    <button onClick={() => { setBatchShipState(null); setSelectedItemIds(new Set()); }}
                      style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                      {allShipped ? "Done" : "Cancel"}
                    </button>
                    {!allShipped && (
                      <button onClick={async () => {
                        // Mark each item shipped with the batch tracking + notes.
                        // skipReload: true on each so the modal doesn't flash
                        // N times; one loadAll at the end refreshes state.
                        for (const it of liveItems) {
                          await markShipped({ ...it, ship_tracking: batchTracking, ship_notes: batchNotes }, { skipReload: true });
                        }
                        await loadAll();
                      }}
                        style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                        Mark {liveItems.length} Shipped
                      </button>
                    )}
                    {allShipped && (() => {
                      const notified = project.shippingNotifications.some(r =>
                        (r.type === "drop_ship_vendor" || r.type === "decorator_to_warehouse") &&
                        r.decoratorId === dg.decoratorId &&
                        (r.tracking || null) === (batchTracking || null)
                      );
                      const batchRoutes = Array.from(new Set(liveItems.map(it => resolveRoute(it.shipping_route, project.shippingRoute))));
                      const mixedRoute = batchRoutes.length > 1;
                      const notifyOk = canNotify && !mixedRoute;
                      const baseLabel = mixedRoute ? "Mixed routes" : batchRoutes[0] === "drop_ship" ? "Notify customer" : "Notify warehouse";
                      // Once notified, lock the button — flips to a confirmed
                      // green state and stops responding so a stray click can't
                      // re-fire the customer email (accidental discharge).
                      const label = notified ? (batchRoutes[0] === "drop_ship" ? "Customer notified ✓" : "Warehouse notified ✓") : baseLabel;
                      const bg = notified ? T.greenDim : (notifyOk ? T.accent : T.surface);
                      const color = notified ? T.green : (notifyOk ? "#fff" : T.faint);
                      const border = notified ? `1px solid ${T.green}66` : "none";
                      return (
                        <button
                          disabled={!notifyOk || notified}
                          onClick={() => {
                            if (!notifyOk || notified) return;
                            openNotifyDialog({
                              project,
                              decoratorId: dg.decoratorId,
                              decoratorName: dg.decoratorName,
                              tracking: batchTracking,
                              route: batchRoutes[0],
                            });
                          }}
                          title={notified ? "Already notified — duplicate send blocked" : mixedRoute ? "These items have different shipping routes — notify each from its own job/row" : !project.invoiceNumber ? "Generate invoice first" : (!batchTracking ? "Tracking required" : "")}
                          style={{ padding: "8px 18px", borderRadius: 6, border, background: bg, color, fontSize: 12, fontWeight: 700, cursor: notified ? "default" : (canNotify ? "pointer" : "not-allowed"), fontFamily: font, opacity: (notified || canNotify) ? 1 : 0.6 }}>
                          {label}
                        </button>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* Notify Recipient picker dialog. Spec:
          memory/project_notify_recipient_on_ship.md */}
      <NotifyShipmentDialog
        open={!!notifyState}
        onClose={() => setNotifyState(null)}
        onSent={() => {
          // Refresh shipping_notifications via loadAll so the row's
          // "Notified ✓" badge appears immediately.
          loadAll();
        }}
        route={notifyState?.route || "drop_ship"}
        jobId={notifyState?.jobId || ""}
        decoratorId={notifyState?.decoratorId || null}
        decoratorName={notifyState?.decoratorName || ""}
        tracking={notifyState?.tracking || ""}
        qbInvoiceNumber={notifyState?.qbInvoiceNumber || ""}
        clientName={notifyState?.clientName || ""}
        jobTitle={notifyState?.jobTitle || ""}
        contacts={notifyState?.contacts || []}
      />

    </div>
  );
}
