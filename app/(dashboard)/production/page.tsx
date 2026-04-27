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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [packingSlips, setPackingSlips] = useState<Record<string, { id: string; file_name: string; drive_link: string; folder_link?: string }[]>>({});
  const [uploadingSlip, setUploadingSlip] = useState<string | null>(null);
  const [slipProgress, setSlipProgress] = useState(0);
  const [slipStatus, setSlipStatus] = useState<string | null>(null);
  const [viewingSlips, setViewingSlips] = useState<{ files: { file_name: string; drive_link: string }[]; index: number; title: string } | null>(null);
  const slipInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const saveTimers = useRef<Record<string, any>>({});
  const now = new Date();

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    // Active jobs + recently completed (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const [activeRes, completedRes] = await Promise.all([
      supabase.from("jobs").select("id, title, job_number, target_ship_date, phase, type_meta, clients(name)").in("phase", ["production", "receiving", "fulfillment"]),
      supabase.from("jobs").select("id, title, job_number, target_ship_date, phase, type_meta, phase_timestamps, clients(name)").eq("phase", "complete").gte("updated_at", thirtyDaysAgo),
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

      const prodItem: ProdItem = {
        id: it.id, name: it.name, job_id: it.job_id, letter: String.fromCharCode(65 + (it.sort_order ?? 0)),
        pipeline_stage: it.pipeline_stage === "shipped" ? "shipped" : "in_production",
        ship_tracking: it.ship_tracking,
        pipeline_timestamps: it.pipeline_timestamps || {},
        blank_vendor: it.blank_vendor, blank_sku: it.blank_sku,
        decorator_name: decName, decorator_short_code: shortCode,
        decorator_id: decId,
        decorator_assignment_id: assignment?.id || null,
        target_ship_date: job.target_ship_date,
        total_units: totalUnits, sizes, qtys,
        ship_qtys: it.ship_qtys || {}, ship_notes: it.ship_notes || "",
      };

      if (!projectMap[it.job_id]) {
        const tm = (job as any).type_meta || {};
        projectMap[it.job_id] = {
          jobId: job.id, jobNumber: job.job_number,
          invoiceNumber: tm.qb_invoice_number || null,
          jobTitle: job.title,
          clientName: job.clients?.name || "",
          shipDate: (() => { const vDates = Object.values(tm.po_ship_dates || {}).filter(Boolean) as string[]; return vDates.length > 0 ? vDates.sort()[0] : job.target_ship_date; })(),
          phase: job.phase, completedAt: (job as any).phase_timestamps?.complete || null,
          decoratorGroups: [], totalItems: 0, totalUnits: 0,
          shippingNotifications: Array.isArray(tm.shipping_notifications) ? tm.shipping_notifications : [],
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
  const atDecorator = allItems.filter(it => it.pipeline_stage === "in_production").length;
  const stalled = allItems.filter(it => {
    const ts = it.pipeline_timestamps?.[it.pipeline_stage || ""];
    if (!ts) return false;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) >= 7;
  }).length;
  const shippingThisWeek = allItems.filter(it => {
    if (!it.target_ship_date) return false;
    const diff = Math.ceil((new Date(it.target_ship_date).getTime() - now.getTime()) / 86400000);
    return diff >= 0 && diff <= 7;
  }).length;
  // Production-pipeline KPIs ported from the old Command Center. These
  // belong here per "vanity counts live on their domain page."
  const needsBlanks = allItems.filter((it: any) =>
    !it.blanks_order_number && it.garment_type !== "accessory"
  ).length;
  const shippedEnRoute = allItems.filter((it: any) =>
    it.pipeline_stage === "shipped" && !it.received_at_hpd
  ).length;
  const decorators = useMemo(() => [...new Set(allItems.map(it => it.decorator_name).filter(Boolean))].sort(), [projects]);

  // ── Filter & split active vs completed ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return projects.filter(p => {
      if (q && !(p.clientName.toLowerCase().includes(q) || p.jobTitle.toLowerCase().includes(q) || p.jobNumber.toLowerCase().includes(q) || (p.invoiceNumber || "").toLowerCase().includes(q) ||
        p.decoratorGroups.some(dg => dg.decoratorName.toLowerCase().includes(q) || dg.items.some(it => it.name.toLowerCase().includes(q))))) return false;
      if (filterDecorator && !p.decoratorGroups.some(dg => dg.decoratorName === filterDecorator)) return false;
      return true;
    });
  }, [projects, search, filterDecorator]);

  const activeProjects = filtered.filter(p => p.decoratorGroups.some(dg => dg.items.some(it => it.pipeline_stage === "in_production")));
  const completedProjects = filtered.filter(p => p.decoratorGroups.every(dg => dg.items.every(it => it.pipeline_stage === "shipped")) || p.phase === "complete");

  // Group completed by time period
  const groupByPeriod = (projects: ProjectGroup[]) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

    const recent: ProjectGroup[] = [];
    const lastWeek: ProjectGroup[] = [];
    const older: ProjectGroup[] = [];

    for (const p of projects) {
      const ts = p.completedAt || p.decoratorGroups.flatMap(dg => dg.items.map(it => it.pipeline_timestamps?.shipped)).filter(Boolean).sort().pop();
      const d = ts ? new Date(ts) : new Date(0);
      if (d >= yesterday) recent.push(p);
      else if (d >= weekAgo) lastWeek.push(p);
      else older.push(p);
    }
    return { recent, lastWeek, older };
  };
  const completedGroups = groupByPeriod(completedProjects);
  const [showCompleted, setShowCompleted] = useState(true);

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
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Production</h1>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{allItems.length} items across {projects.length} projects</div>
      </div>

      {/* Stats — production-pipeline KPI strip. Same tile style as the
          Projects page strip (number left, label right) for consistency
          across domain pages. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 10,
      }}>
        {[
          { label: "Needs blanks",       count: needsBlanks,      tone: needsBlanks > 0 ? T.amber : T.muted },
          { label: "At decorator",       count: atDecorator,      tone: T.text },
          { label: "Stalled 7+ days",    count: stalled,          tone: stalled > 0 ? T.red : T.muted },
          { label: "Shipping this week", count: shippingThisWeek, tone: T.blue },
          { label: "Shipped en route",   count: shippedEnRoute,   tone: T.purple },
        ].map(s => (
          <div key={s.label} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.count > 0 ? s.tone : T.faint, lineHeight: 1, fontFamily: mono }}>
              {s.count}
            </div>
            <div style={{ fontSize: 9, color: T.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, clients, decorators..."
          style={{ flex: 1, maxWidth: 320, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
        <select value={filterDecorator} onChange={e => setFilterDecorator(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: filterDecorator ? T.text : T.muted, fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">All decorators</option>
          {decorators.map(d => <option key={d} value={d!}>{d}</option>)}
        </select>
      </div>

      {/* ── Active Projects ── */}
      {activeProjects.length === 0 && completedProjects.length === 0 && (
        <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>No active production</div>
      )}

      {activeProjects.map(project => {
        const isExpanded = expanded.has(project.jobId);
        const ship = shipDatePill(project.shipDate);
        const allShipped = project.decoratorGroups.every(dg => dg.items.every(it => it.pipeline_stage === "shipped"));

        return (
          <div key={project.jobId} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden",
          }}>
            {/* ── Collapsed row ── */}
            <div
              onClick={() => setExpanded(prev => {
                const next = new Set(prev);
                next.has(project.jobId) ? next.delete(project.jobId) : next.add(project.jobId);
                return next;
              })}
              style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                borderBottom: isExpanded ? `1px solid ${T.border}` : "none",
              }}
            >
              <div style={{ flex: 1 }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{project.invoiceNumber || project.jobNumber}</span>
                  {project.invoiceNumber && <span style={{ fontSize: 10, color: T.faint }}>{project.jobNumber}</span>}
                  <span style={{ fontSize: 13, color: T.muted }}>{project.clientName}</span>
                  {allShipped && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>All Shipped</span>}
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
                  <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: ship.bg, color: ship.color }}>
                    {ship.dateStr} · {ship.label}
                  </div>
                )}
                <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {project.totalUnits.toLocaleString()} units
                </span>
                <span style={{ fontSize: 18, color: T.faint, transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "none" }}>▾</span>
              </div>
            </div>

            {/* ── Expanded: decorator groups ── */}
            {isExpanded && (
              <div style={{ padding: "0 18px 18px" }}>
                {project.decoratorGroups.map(dg => (
                  <div key={dg.decoratorId || dg.decoratorName} style={{
                    marginTop: 14, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden",
                  }}>
                    {/* Decorator header */}
                    <div style={{
                      padding: "10px 14px", background: T.surface,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      borderBottom: `1px solid ${T.border}`,
                    }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{dg.decoratorName}</span>
                        <span style={{ fontSize: 11, color: T.muted, marginLeft: 8 }}>
                          {dg.items.length} item{dg.items.length !== 1 ? "s" : ""} · {dg.totalUnits.toLocaleString()} units
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {dg.inProduction > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.accentDim, color: T.accent }}>{dg.inProduction} in production</span>}
                        {dg.shipped > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>{dg.shipped} shipped</span>}
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
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Completed ── */}
      {completedProjects.length > 0 && (
        <div>
          <button onClick={() => setShowCompleted(!showCompleted)}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "8px 0", width: "100%" }}>
            <span style={{ fontSize: 11, color: T.faint, transform: showCompleted ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▶</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Completed</span>
            <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{completedProjects.length}</span>
            <div style={{ flex: 1, height: 1, background: T.border }} />
          </button>

          {showCompleted && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {([
                { label: "Recently", items: completedGroups.recent },
                { label: "Last 7 days", items: completedGroups.lastWeek },
                { label: "Last 30 days", items: completedGroups.older },
              ] as const).filter(g => g.items.length > 0).map(group => (
                <div key={group.label}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", padding: "6px 0 4px" }}>{group.label}</div>
                  {group.items.map(project => (
                    <Link key={project.jobId} href={`/jobs/${project.jobId}?tab=production`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 16px", marginBottom: 4, display: "flex", alignItems: "center", gap: 10, opacity: 0.8, cursor: "pointer", transition: "opacity 0.15s" }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = "0.8"; }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{project.invoiceNumber || project.jobNumber}</span>
                        <span style={{ fontSize: 12, color: T.muted }}>{project.clientName}</span>
                        <span style={{ fontSize: 11, color: T.faint }}>— {project.jobTitle}</span>
                        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, color: T.muted }}>{project.totalItems} items · {project.totalUnits.toLocaleString()} units</span>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>
                            {project.phase === "complete" ? "Complete" : "All Shipped"}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
