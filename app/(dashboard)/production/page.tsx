"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";

const tQty = (q: Record<string, number>) => Object.values(q || {}).reduce((a, v) => a + v, 0);

type ProdItem = {
  id: string; name: string; job_id: string; letter: string;
  pipeline_stage: string | null; ship_tracking: string | null;
  pipeline_timestamps: Record<string, string> | null;
  blank_vendor: string | null; blank_sku: string | null;
  decorator_name: string | null; decorator_short_code: string | null;
  decorator_id: string | null; decorator_assignment_id: string | null;
  target_ship_date: string | null; total_units: number;
  garment_type: string | null;
  sizes: string[]; qtys: Record<string, number>;
  ship_qtys: Record<string, number>; ship_notes: string;
};

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
  decoratorGroups: DecoratorGroup[];
  totalItems: number; totalUnits: number;
  shippingNotifications: ShipmentNotificationRecord[];
  /** Stashed from the job for the print-count KPI. Only present for
   *  active jobs (not completed) since prints are an "in-flight" stat. */
  costingData?: any;
};

type DecoratorGroup = {
  decoratorId: string | null; decoratorName: string; shortCode: string;
  items: ProdItem[];
  inProduction: number; shipped: number; totalUnits: number;
  contacts: { name: string; email: string | null }[];
};

export default function ProductionPage() {
  const supabase = createClient();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterDecorator, setFilterDecorator] = useState("");
  const [filterStalled, setFilterStalled] = useState(false);
  const [modalProject, setModalProject] = useState<ProjectGroup | null>(null);
  // Per-decorator expand state inside the modal. Reset on modal change
  // so a fresh project always opens with everything collapsed (Jon
  // wants the multi-vendor view quiet on first open).
  const [expandedDecorators, setExpandedDecorators] = useState<Set<string>>(new Set());
  const [packingSlips, setPackingSlips] = useState<Record<string, { id: string; file_name: string; drive_link: string; folder_link?: string }[]>>({});
  const [uploadingSlip, setUploadingSlip] = useState<string | null>(null);
  const [slipProgress, setSlipProgress] = useState(0);
  const [slipStatus, setSlipStatus] = useState<string | null>(null);
  const [viewingSlips, setViewingSlips] = useState<{ files: { file_name: string; drive_link: string }[]; index: number; title: string } | null>(null);
  const slipInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const saveTimers = useRef<Record<string, any>>({});
  const now = new Date();

  useEffect(() => { loadAll(); }, []);

  // Escape closes the full-page project modal.
  useEffect(() => {
    if (!modalProject) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalProject(null); };
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

  // Reset decorator expansion state whenever the modal switches to a
  // different project (or closes).
  useEffect(() => {
    setExpandedDecorators(new Set());
  }, [modalProject?.jobId]);

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
      supabase.from("jobs").select("id, title, job_number, phase, type_meta, costing_data, clients(name)").in("phase", ["production", "receiving", "fulfillment"]),
      supabase.from("jobs").select("id, title, job_number, phase, type_meta, phase_timestamps, clients(name)").eq("phase", "complete").gte("updated_at", thirtyDaysAgo),
    ]);
    const jobs = [...(activeRes.data || []), ...(completedRes.data || [])];

    if (!jobs?.length) { setProjects([]); setLoading(false); return; }

    const jobIds = jobs.map(j => j.id);
    const jobMap: Record<string, any> = {};
    jobs.forEach(j => { jobMap[j.id] = j; });

    const { data: allItems } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered), decorator_assignments(id, pipeline_stage, decoration_type, decorator_id, decorators(id, name, short_code, contacts_list))")
      .in("job_id", jobIds)
      .order("sort_order");

    // Group items by job, then by decorator within each job
    const projectMap: Record<string, ProjectGroup> = {};

    for (const it of (allItems || [])) {
      const job = jobMap[it.job_id];
      if (!job) continue;

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
      // type_meta.po_ship_dates[vendorName]. The legacy
      // jobs.target_ship_date field is no longer used.
      const tm = (job as any).type_meta || {};
      const poShipDates = (tm.po_ship_dates || {}) as Record<string, string>;
      const vendorShipDate = poShipDates[decName] || null;

      const prodItem: ProdItem = {
        id: it.id, name: it.name, job_id: it.job_id, letter: String.fromCharCode(65 + (it.sort_order ?? 0)),
        pipeline_stage: it.pipeline_stage === "shipped" ? "shipped" : "in_production",
        ship_tracking: it.ship_tracking,
        pipeline_timestamps: it.pipeline_timestamps || {},
        blank_vendor: it.blank_vendor, blank_sku: it.blank_sku,
        decorator_name: decName, decorator_short_code: shortCode,
        decorator_id: decId,
        decorator_assignment_id: assignment?.id || null,
        target_ship_date: vendorShipDate,
        total_units: totalUnits, sizes, qtys,
        garment_type: it.garment_type ?? null,
        ship_qtys: it.ship_qtys || {}, ship_notes: it.ship_notes || "",
      };

      if (!projectMap[it.job_id]) {
        // Project-level ship date = earliest active vendor PO ship date.
        const vDates = Object.values(poShipDates).filter(Boolean) as string[];
        const earliestShipDate = vDates.length > 0 ? vDates.sort()[0] : null;
        projectMap[it.job_id] = {
          jobId: job.id, jobNumber: job.job_number,
          invoiceNumber: tm.qb_invoice_number || null,
          jobTitle: job.title,
          clientName: job.clients?.name || "",
          shipDate: earliestShipDate,
          phase: job.phase, completedAt: (job as any).phase_timestamps?.complete || null,
          decoratorGroups: [], totalItems: 0, totalUnits: 0,
          shippingNotifications: Array.isArray(tm.shipping_notifications) ? tm.shipping_notifications : [],
          costingData: (job as any).costing_data,
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
    for (const p of Object.values(projectMap)) {
      const job = jobMap[p.jobId];
      const poShipDatesAll = ((job?.type_meta || {}).po_ship_dates || {}) as Record<string, string>;
      const activeVendorDates: string[] = [];
      for (const dg of p.decoratorGroups) {
        const hasUnshipped = dg.items.some(it => it.pipeline_stage !== "shipped");
        if (!hasUnshipped) continue;
        const d = poShipDatesAll[dg.decoratorName];
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
    }

    setLoading(false);
  }

  // ── Item actions ──
  async function markShipped(item: ProdItem) {
    const ts = new Date().toISOString();
    const timestamps = { ...(item.pipeline_timestamps || {}), shipped: ts };
    // Flush ALL pending debounces for this item
    for (const key of Object.keys(saveTimers.current).filter(k => k.includes(item.id))) {
      clearTimeout(saveTimers.current[key]);
      delete saveTimers.current[key];
    }
    const shipQtysToSave = item.ship_qtys && Object.keys(item.ship_qtys).length > 0 ? item.ship_qtys : null;
    await supabase.from("items").update({
      pipeline_stage: "shipped", pipeline_timestamps: timestamps,
      ship_notes: item.ship_notes || null, ship_tracking: item.ship_tracking || null,
      ship_qtys: shipQtysToSave,
      received_at_hpd: false, received_at_hpd_at: null, received_qtys: null,
    }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: "shipped" }).eq("id", item.decorator_assignment_id);
    }
    logJobActivity(item.job_id, `${item.name} shipped from decorator${item.ship_tracking ? ` — tracking: ${item.ship_tracking}` : ""}`);
    notifyTeam(`Item shipped from decorator — ${item.name} incoming to warehouse`, "production", item.job_id, "job");

    // Route-aware post-ship flow (drop_ship only — ship_through handled by warehouse page)
    const { data: jobRow } = await supabase.from("jobs").select("shipping_route, title, clients(name)").eq("id", item.job_id).single();
    const route = (jobRow as any)?.shipping_route;
    const clientName = (jobRow as any)?.clients?.name || "";
    const jobTitle = (jobRow as any)?.title || "";

    if (route === "drop_ship") {
      // Shipment update emails are manually fired per tracking number from
      // the "Send shipment update" button (sendShipmentUpdate below) — no
      // auto-fire on markShipped so partial shipments don't leave the
      // client in the dark.

      // Invoice-ready notification when ALL job items shipped
      const { data: jobItems } = await supabase.from("items").select("id, pipeline_stage").eq("job_id", item.job_id);
      const allShipped = (jobItems || []).every((it: any) => it.id === item.id ? true : it.pipeline_stage === "shipped");
      if (allShipped) {
        await createInvoiceReadyNotification(item.job_id, jobTitle, clientName);
        logJobActivity(item.job_id, "All items shipped — invoice ready to update with shipped qtys");
      }
    }
    loadAll();
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

  function updateField(itemId: string, field: string, value: string) {
    setProjects(prev => prev.map(p => ({
      ...p, decoratorGroups: p.decoratorGroups.map(dg => ({
        ...dg, items: dg.items.map(it => it.id === itemId ? { ...it, [field]: value } : it)
      }))
    })));
    if (saveTimers.current[`${field}_${itemId}`]) clearTimeout(saveTimers.current[`${field}_${itemId}`]);
    saveTimers.current[`${field}_${itemId}`] = setTimeout(() => {
      supabase.from("items").update({ [field]: value || null }).eq("id", itemId);
    }, 800);
  }

  async function handlePackingSlipUpload(file: File, project: ProjectGroup, dgItems: ProdItem[]) {
    const key = project.jobId + "_" + (dgItems[0]?.decorator_id || "");
    setUploadingSlip(key);
    setSlipProgress(0);
    setSlipStatus(null);
    try {
      setSlipStatus("Uploading to Drive...");
      const result = await uploadToDrive({
        blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream",
        clientName: project.clientName, projectTitle: project.jobTitle, itemName: "Packing Slips",
        onProgress: (pct: number) => setSlipProgress(pct),
      });
      setSlipStatus(`Registering ${dgItems.length} items...`);
      // Register against all items in this decorator group
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
      setSlipStatus("Uploaded");
      setTimeout(() => setSlipStatus(null), 2000);
    } catch (err: any) {
      alert("Packing slip error: " + err.message);
    }
    setUploadingSlip(null);
    setSlipProgress(0);
    setSlipStatus(null);
  }

  // ── Stats ──
  const allItems = projects.flatMap(p => p.decoratorGroups.flatMap(dg => dg.items));
  const decorators = useMemo(() => [...new Set(allItems.map(it => it.decorator_name).filter(Boolean))].sort(), [projects]);

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

          const cp = it.garment_type ? cpByGarment[it.garment_type] : null;
          if (!cp) continue;
          if (NON_GARMENT.has(cp.garment_type)) {
            // Custom-cost items count as 1 decoration per piece if any
            // custom costs are configured, else 0.
            if ((cp.customCosts?.length || 0) > 0) prints += it.total_units || 0;
            continue;
          }
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
      return true;
    });
  }, [enriched, search, filterDecorator]);

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

  const getDaysToShip = (d: string | null) => {
    if (!d) return null;
    return Math.ceil((new Date(d).getTime() - now.getTime()) / 86400000);
  };

  const getDaysInStage = (item: ProdItem) => {
    const ts = item.pipeline_timestamps?.[item.pipeline_stage || ""];
    if (!ts) return null;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  };

  const shipDatePill = (d: string | null) => {
    const days = getDaysToShip(d);
    if (days === null) return null;
    const color = days < 0 ? T.red : days <= 3 ? T.amber : T.green;
    const bg = days < 0 ? T.redDim : days <= 3 ? T.amberDim : T.greenDim;
    const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`;
    return { color, bg, label, dateStr: new Date(d!).toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
  };

  const ic: React.CSSProperties = { padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 11, fontFamily: mono, outline: "none", width: "100%" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading production...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      {/* Header — title + search + decorator dropdown on one row, mirrors Projects */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Production</h1>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, clients, decorators..."
          style={{ flex: 1, maxWidth: 360, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
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
        <select value={sortKey} onChange={e => setSortKey(e.target.value as any)}
          style={{ background: "transparent", border: "none", padding: "4px 0", fontSize: 11, fontWeight: 700, color: T.muted, fontFamily: font, textTransform: "uppercase", letterSpacing: "0.07em", cursor: "pointer", outline: "none" }}>
          <option value="ship_date">Sort · Ship date</option>
          <option value="days_at_decorator">Sort · Days at decorator</option>
          <option value="decorator">Sort · Decorator</option>
          <option value="client">Sort · Client</option>
          <option value="units">Sort · Units</option>
        </select>
      </div>

      {/* ── Active Projects ── */}
      {activeProjects.length === 0 && (
        <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>
          {tab === "active" ? "No active production" : tab === "overdue" ? "Nothing overdue" : tab === "stalled" ? "No stalls" : "Nothing shipped"}
        </div>
      )}

      {activeProjects.map(project => {
        const isModalOpen = modalProject?.jobId === project.jobId;
        const ship = shipDatePill(project.shipDate);
        const allShipped = project.decoratorGroups.every(dg => dg.items.every(it => it.pipeline_stage === "shipped"));

        return (
          <div key={project.jobId} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden",
          }}>
            {/* ── Row — click opens full-page modal (replaces inline
                expand pattern Jon flagged as cluttered). ── */}
            <div
              onClick={() => setModalProject(project)}
              style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <div style={{ flex: 1 }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{project.invoiceNumber || project.jobNumber}</span>
                  {project.invoiceNumber && <span style={{ fontSize: 10, color: T.faint }}>{project.jobNumber}</span>}
                  <span style={{ fontSize: 13, color: T.muted }}>{project.clientName}</span>
                  {allShipped && <span style={{ fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase" }}>All Shipped</span>}
                </div>

                {/* Per-decorator mini breakdown */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {project.decoratorGroups.map(dg => (
                    <div key={dg.decoratorId || dg.decoratorName} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "4px 10px", borderRadius: 6, background: T.surface,
                      fontSize: 11,
                    }}>
                      <span style={{ fontWeight: 600, color: T.text }}>{dg.shortCode || dg.decoratorName}</span>
                      <span style={{ color: T.muted }}>{dg.items.length} item{dg.items.length !== 1 ? "s" : ""}</span>
                      <span style={{ color: T.faint }}>·</span>
                      {dg.inProduction > 0 && <span style={{ color: T.accent }}>{dg.inProduction} active</span>}
                      {dg.shipped > 0 && <span style={{ color: T.green }}>{dg.shipped} shipped</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right side: ship date + expand arrow */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: 12 }}>
                {ship && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: ship.color, letterSpacing: "0.04em" }}>
                    {ship.dateStr} · {ship.label}
                  </div>
                )}
                <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {project.totalUnits.toLocaleString()} units
                </span>
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
                      <button onClick={() => setModalProject(null)} title="Close (Esc)"
                        style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
                    </div>
                  </div>
                  {/* Scrollable body */}
                  <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 22px" }}>
                {project.decoratorGroups.map(dg => {
                  const decKey = dg.decoratorId || dg.decoratorName;
                  const isDecExpanded = expandedDecorators.has(decKey);
                  return (
                  <div key={decKey} style={{
                    marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden",
                  }}>
                    {/* Decorator header — click to expand/collapse */}
                    <div onClick={() => toggleDecorator(decKey)}
                      style={{
                        padding: "10px 14px", background: T.surface,
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        borderBottom: isDecExpanded ? `1px solid ${T.border}` : "none",
                        cursor: "pointer",
                      }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: T.faint, transition: "transform 0.15s", transform: isDecExpanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{dg.decoratorName}</span>
                        <span style={{ fontSize: 11, color: T.muted }}>
                          {dg.items.length} item{dg.items.length !== 1 ? "s" : ""} · {dg.totalUnits.toLocaleString()} units
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {dg.inProduction > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>{dg.inProduction} in production</span>}
                        {dg.shipped > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase" }}>{dg.shipped} shipped</span>}
                        {dg.inProduction > 1 && (
                          <button onClick={async (e) => {
                            e.stopPropagation();
                            // Copy tracking from first item that has one to all others
                            const src = dg.items.find(it => it.ship_tracking && it.pipeline_stage !== "shipped");
                            if (src) {
                              for (const it of dg.items.filter(it2 => it2.pipeline_stage !== "shipped" && it2.id !== src.id)) {
                                await supabase.from("items").update({ ship_tracking: src.ship_tracking, ship_notes: src.ship_notes || null }).eq("id", it.id);
                              }
                            }
                            // Ship all unshipped items
                            for (const it of dg.items.filter(it2 => it2.pipeline_stage !== "shipped")) {
                              await markShipped(it);
                            }
                          }} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: T.green, color: "#fff", border: "none", cursor: "pointer" }}>
                            Ship All
                          </button>
                        )}
                      </div>
                    </div>

                    {isDecExpanded && (<>
                    {/* Packing slip upload */}
                    {(() => {
                      const dgKey = project.jobId + "_" + (dg.decoratorId || "");
                      const dgSlips = dg.items.flatMap(it => packingSlips[it.id] || []);
                      const uniqueSlips = dgSlips.filter((s, i, arr) => arr.findIndex(x => x.file_name === s.file_name) === i);
                      const folderLink = dgSlips.find(s => s.folder_link)?.folder_link;
                      return (
                        <div style={{ padding: "6px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          {uniqueSlips.length > 0 && (
                            <button onClick={(e) => { e.stopPropagation(); setViewingSlips({ files: uniqueSlips, index: 0, title: dg.shortCode || dg.decoratorName }); }}
                              style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: T.accentDim, color: T.accent, border: "none", cursor: "pointer", fontWeight: 600, fontFamily: font }}>
                              View {dg.shortCode || dg.decoratorName} packing slips ({uniqueSlips.length})
                            </button>
                          )}
                          {uploadingSlip === dgKey ? (
                            <span style={{ fontSize: 10, color: T.accent }}>{slipStatus || `${slipProgress}%`}</span>
                          ) : (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); slipInputRefs.current[dgKey]?.click(); }}
                                style={{ fontSize: 10, color: T.faint, background: "none", border: `1px dashed ${T.border}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                                {uniqueSlips.length > 0 ? "+ Add" : "Upload Packing Slip"}
                              </button>
                              <input ref={el => { slipInputRefs.current[dgKey] = el; }} type="file" accept="image/*,.pdf" style={{ display: "none" }}
                                onChange={e => { const f = e.target.files?.[0]; if (f) handlePackingSlipUpload(f, project, dg.items); e.target.value = ""; }} />
                            </>
                          )}
                        </div>
                      );
                    })()}

                    {/* Items */}
                    <div style={{ padding: "10px 14px" }}>
                      {dg.items.map(item => {
                        const days = getDaysInStage(item);
                        const isShipped = item.pipeline_stage === "shipped";
                        return (
                          <div key={item.id} style={{
                            padding: "8px 10px", borderRadius: 6, marginBottom: 6,
                            background: isShipped ? T.greenDim + "44" : "transparent",
                            border: `1px solid ${isShipped ? T.green + "33" : T.border}`,
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <span style={{ fontSize: 13, fontWeight: 800, color: T.muted, fontFamily: mono, marginRight: 8 }}>{item.letter}</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{item.name}</span>
                                <span style={{ fontSize: 10, color: T.muted, marginLeft: 8 }}>
                                  {item.blank_vendor} · {item.total_units} units
                                </span>
                                {days !== null && days >= 7 && (
                                  <span style={{ fontSize: 10, fontWeight: 600, color: T.red, marginLeft: 8 }}>{days}d in stage</span>
                                )}
                                {days !== null && days >= 3 && days < 7 && (
                                  <span style={{ fontSize: 10, fontWeight: 600, color: T.amber, marginLeft: 8 }}>{days}d in stage</span>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {isShipped ? (
                                  <>
                                    <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>
                                      {item.ship_tracking || "Shipped"}
                                    </span>
                                    {(() => {
                                      const notified = project.shippingNotifications.some(r =>
                                        r.type === "drop_ship_vendor" &&
                                        r.decoratorId === item.decorator_id &&
                                        (r.tracking || null) === (item.ship_tracking || null)
                                      );
                                      if (notified) {
                                        return <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>Notified ✓</span>;
                                      }
                                      return (
                                        <button onClick={(e) => { e.stopPropagation(); sendShipmentUpdate({
                                          jobId: project.jobId,
                                          decoratorId: item.decorator_id,
                                          decoratorName: item.decorator_name,
                                          trackingNumber: item.ship_tracking || null,
                                        }); }}
                                          style={{ fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 4, border: "none", background: T.accent, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>
                                          Send shipment update
                                        </button>
                                      );
                                    })()}
                                    <button onClick={(e) => { e.stopPropagation(); undoShipped(item); }}
                                      style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                                      Undo
                                    </button>
                                  </>
                                ) : (
                                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                    <input value={item.ship_tracking || ""} placeholder="Tracking #"
                                      onChange={e => updateField(item.id, "ship_tracking", e.target.value)}
                                      onClick={e => e.stopPropagation()}
                                      style={{ ...ic, width: 160 }} />
                                    <input value={item.ship_notes || ""} placeholder="Notes"
                                      onChange={e => updateField(item.id, "ship_notes", e.target.value)}
                                      onClick={e => e.stopPropagation()}
                                      style={{ ...ic, width: 120 }} />
                                    <button onClick={(e) => { e.stopPropagation(); markShipped(item); }}
                                      style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: T.green, color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                                      Ship
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Per-size ship qty (collapsed, expand on click) */}
                            {!isShipped && item.sizes.length > 0 && (
                              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                                {item.sizes.map(sz => {
                                  const ordered = item.qtys[sz] || 0;
                                  const shipped = (item.ship_qtys || {})[sz] ?? ordered;
                                  const diffColor = shipped < ordered ? T.amber : shipped > ordered ? T.green : null;
                                  return (
                                    <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                      <span style={{ fontSize: 9, color: T.muted, fontFamily: mono }}>{sz}</span>
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
                                        style={{ ...ic, width: 44, padding: "4px", textAlign: "center", fontSize: 11, fontFamily: mono, border: `1px solid ${diffColor || T.border}`, color: diffColor || T.text }}
                                      />
                                      <span style={{ fontSize: 8, color: T.faint, fontFamily: mono }}>{ordered}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
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

      {/* Packing slip viewer modal */}
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

    </div>
  );
}
