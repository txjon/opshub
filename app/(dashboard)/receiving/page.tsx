"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty, type WarehouseJob, type WarehouseItem } from "@/lib/use-warehouse";
import { useShipments, type Shipment } from "@/lib/use-shipments";
import { uploadToReceiving, uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { DriveFileLink } from "@/components/DriveFileLink";
import { DriveThumb } from "@/components/DriveThumb";
import { MockupPeek } from "@/components/MockupPeek";

type OutsideShipment = {
  id: string;
  carrier: string;
  tracking: string;
  sender: string;
  description: string;
  condition: string;
  notes: string;
  job_id: string | null;
  resolved: boolean;
  received_at: string;
  files: { name: string; driveLink: string; driveFileId: string }[];
  drive_folder_link: string | null;
};

type ReceivingProject = WarehouseJob & {
  invoiceNumber: string | null;
  shipDate: string | null;
  decoratorGroups: DecoratorGroup[];
  pendingItems: number;
  receivedItems: number;
  totalUnits: number;
};

type DecoratorGroup = {
  decoratorId: string | null;
  decoratorName: string;
  shortCode: string;
  items: WarehouseItem[];
  pending: number;
  received: number;
  totalUnits: number;
};

type FileRec = { file_name: string; drive_link: string; drive_file_id: string | null; mime_type: string | null };

export default function ReceivingPage() {
  const { loading, jobs, updateReceivedQty, updateSampleQty, markReceived, bulkMarkReceived, undoReceived, returnToProduction } = useWarehouse();
  const supabase = createClient();

  // Filters / tabs
  const [search, setSearch] = useState("");
  const [filterDecorator, setFilterDecorator] = useState("");
  const [tab, setTab] = useState<"pending" | "received" | "outside">("pending");
  // Silent mode — suppresses the production_complete client email for
  // receives keyed in this session. Used when backfilling historical
  // receives (boxes that physically arrived weeks ago but haven't been
  // marked in OpsHub yet). Activity log + phase recalc still fire so
  // internal state stays consistent. localStorage-persisted so a page
  // navigation doesn't accidentally re-enable emails mid-backfill.
  const [silentMode, setSilentMode] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSilentMode(window.localStorage.getItem("receivingSilentMode") === "1");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("receivingSilentMode", silentMode ? "1" : "0");
  }, [silentMode]);

  // Modal — scoped to one Shipment at a time. The receive flow inside
  // unchanged; we just regroup items by (decorator, tracking) at the
  // list level so what shows up here is a single physical box, not a
  // project's full vendor mix.
  const [modalShipmentKey, setModalShipmentKey] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  // List view (production-style per-item view) — toggle on pending/received.
  const [viewMode, setViewMode] = useState<"shipments" | "list">("list");
  // Batch-receive confirm modal — the items queued by "Receive Selected".
  const [batchReceiveItems, setBatchReceiveItems] = useState<WarehouseItem[] | null>(null);
  const [mockupPeek, setMockupPeek] = useState<{ driveFileId: string | null; name: string } | null>(null);
  const [listSortKey, setListSortKey] = useState<"inv" | "client" | "item" | "decorator" | "shipped" | "units">("shipped");
  const [listSortDir, setListSortDir] = useState<"asc" | "desc">("asc");
  const listHeaderClick = (key: typeof listSortKey) => {
    if (key === listSortKey) setListSortDir(d => d === "asc" ? "desc" : "asc");
    else { setListSortKey(key); setListSortDir("asc"); }
  };

  // Receive UI state — keyed by item id
  const [conditionNote, setConditionNote] = useState<Record<string, string>>({});
  const [itemCondition, setItemCondition] = useState<Record<string, string>>({});

  // Files
  const [packingSlips, setPackingSlips] = useState<Record<string, FileRec[]>>({});
  const [receivingPhotos, setReceivingPhotos] = useState<Record<string, FileRec[]>>({});
  const [mockupMap, setMockupMap] = useState<Record<string, { driveFileId: string | null; driveLink: string | null }>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  const [viewingSlips, setViewingSlips] = useState<{ files: { file_name: string; drive_link: string }[]; index: number; title: string } | null>(null);
  const photoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Outside
  const [outsideShipments, setOutsideShipments] = useState<OutsideShipment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ carrier: "", tracking: "", sender: "", description: "", condition: "good", notes: "" });
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkableJobs, setLinkableJobs] = useState<{ id: string; title: string; client_name: string; job_number: string; display_number: string }[]>([]);

  useEffect(() => { loadOutside(); loadLinkableJobs(); }, []);

  // Escape closes modal
  useEffect(() => {
    if (!modalShipmentKey) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalShipmentKey(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalShipmentKey]);

  // Reset modal-local state when modal closes
  useEffect(() => {
    if (!modalShipmentKey) {
      setSelectedItemIds(new Set());
    }
  }, [modalShipmentKey]);

  function toggleItemSelected(itemId: string) {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  // Load packing slips + photos when items change
  useEffect(() => {
    if (jobs.length === 0) return;
    const itemIds = jobs.flatMap(j => j.items.map(it => it.id));
    if (itemIds.length === 0) return;
    supabase.from("item_files")
      .select("item_id, file_name, drive_link, drive_file_id, mime_type, stage")
      .in("stage", ["packing_slip", "receiving_photo"])
      .in("item_id", itemIds)
      .then(({ data }) => {
        const slips: Record<string, FileRec[]> = {};
        const photos: Record<string, FileRec[]> = {};
        for (const f of (data || [])) {
          const target = f.stage === "packing_slip" ? slips : photos;
          if (!target[f.item_id]) target[f.item_id] = [];
          target[f.item_id].push({ file_name: f.file_name, drive_link: f.drive_link, drive_file_id: f.drive_file_id, mime_type: f.mime_type });
        }
        setPackingSlips(slips);
        setReceivingPhotos(photos);
      });
  }, [jobs]);

  // Load active mockup thumbnails — one per item, latest first. Filtered
  // by superseded_at IS NULL so we never show old versions after a re-up.
  useEffect(() => {
    if (jobs.length === 0) return;
    const itemIds = jobs.flatMap(j => j.items.map(it => it.id));
    if (itemIds.length === 0) return;
    supabase.from("item_files")
      .select("item_id, drive_file_id, drive_link, created_at")
      .eq("stage", "mockup")
      .is("superseded_at", null)
      .in("item_id", itemIds)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const m: Record<string, { driveFileId: string | null; driveLink: string | null }> = {};
        for (const f of (data || [])) {
          if (!m[f.item_id]) m[f.item_id] = { driveFileId: f.drive_file_id, driveLink: f.drive_link };
        }
        setMockupMap(m);
      });
  }, [jobs]);

  // No explicit sync effect — the modal reads `shipments.find(s => s.key === modalShipmentKey)`
  // directly during render, so any change to the underlying shipments
  // (item received, qty updated, etc.) flows through naturally without
  // setState chains.

  async function loadOutside() {
    const { data } = await supabase
      .from("outside_shipments").select("*").eq("resolved", false)
      .order("received_at", { ascending: false });
    setOutsideShipments(data || []);
  }

  async function loadLinkableJobs() {
    const { data } = await supabase
      .from("jobs")
      .select("id, title, job_number, type_meta, clients(name)")
      .not("phase", "in", '("complete","cancelled")')
      .order("created_at", { ascending: false }).limit(50);
    setLinkableJobs((data || []).map((j: any) => ({
      id: j.id, title: j.title, client_name: j.clients?.name || "",
      job_number: j.job_number, display_number: j.type_meta?.qb_invoice_number || j.job_number,
    })));
  }

  async function submitOutside() {
    if (!form.description.trim()) return;
    setSaving(true);
    const uploadedFiles: { name: string; driveLink: string; driveFileId: string }[] = [];
    let driveFolderLink: string | null = null;
    if (pendingFiles.length > 0) {
      const today = new Date().toISOString().split("T")[0];
      const label = `${today} — ${form.sender || form.description}`.slice(0, 100);
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        setUploadStatus(`Uploading ${i + 1}/${pendingFiles.length}...`);
        try {
          const result = await uploadToReceiving({
            blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream", shipmentLabel: label,
          });
          uploadedFiles.push({ name: file.name, driveLink: result.webViewLink, driveFileId: result.fileId });
          if (!driveFolderLink) driveFolderLink = result.folderLink;
        } catch (err) { console.error("Upload error:", err); }
      }
      setUploadStatus("");
    }
    await supabase.from("outside_shipments").insert({
      carrier: form.carrier || null, tracking: form.tracking || null,
      sender: form.sender || null, description: form.description,
      condition: form.condition, notes: form.notes || null,
      files: uploadedFiles.length > 0 ? uploadedFiles : [],
      drive_folder_link: driveFolderLink,
    });
    setForm({ carrier: "", tracking: "", sender: "", description: "", condition: "good", notes: "" });
    setPendingFiles([]); setShowForm(false); setSaving(false);
    loadOutside();
  }

  async function linkToJob(shipmentId: string, jobId: string) {
    await supabase.from("outside_shipments").update({ job_id: jobId }).eq("id", shipmentId);
    loadOutside();
  }

  async function routeShipment(id: string, route: "ship_through" | "stage") {
    await supabase.from("outside_shipments").update({ route, resolved: true }).eq("id", id);
    setOutsideShipments(prev => prev.filter(s => s.id !== id));
  }

  async function handlePhotoUpload(file: File, jobMeta: { client_name: string; title: string }, item: WarehouseItem) {
    setUploadingPhoto(item.id);
    try {
      const result = await uploadToDrive({
        blob: file, fileName: file.name, mimeType: file.type || "image/jpeg",
        clientName: jobMeta.client_name, projectTitle: jobMeta.title, itemName: item.name,
        onProgress: undefined,
      });
      await registerFileInDb({
        fileId: result.fileId, webViewLink: result.webViewLink, folderLink: result.folderLink,
        fileName: file.name, mimeType: file.type, fileSize: file.size,
        itemId: item.id, stage: "receiving_photo", notes: null,
      });
      setReceivingPhotos(prev => ({
        ...prev,
        [item.id]: [...(prev[item.id] || []), { file_name: file.name, drive_link: result.webViewLink, drive_file_id: result.fileId, mime_type: file.type }],
      }));
    } catch (err) { console.error("Photo upload error:", err); }
    setUploadingPhoto(null);
  }

  // Build ReceivingProjects from jobs — group items per decorator, attach
  // ship date, invoice number, and counts. Re-derives on every render
  // because useWarehouse owns the underlying state.
  const projects = useMemo<ReceivingProject[]>(() => {
    return jobs.map(j => {
      const groups = new Map<string, DecoratorGroup>();
      for (const it of j.items) {
        const key = it.decorator_name || "Unassigned";
        if (!groups.has(key)) {
          groups.set(key, {
            decoratorId: null, decoratorName: key, shortCode: it.decorator_short_code || "",
            items: [], pending: 0, received: 0, totalUnits: 0,
          });
        }
        const g = groups.get(key)!;
        g.items.push(it);
        g.totalUnits += tQty(it.qtys);
        if (it.received_at_hpd) g.received++; else g.pending++;
      }
      const decoratorGroups = Array.from(groups.values());
      const pendingItems = j.items.filter(it => !it.received_at_hpd).length;
      const receivedItems = j.items.length - pendingItems;
      const totalUnits = j.items.reduce((a, it) => a + tQty(it.qtys), 0);
      return {
        ...j,
        invoiceNumber: j.display_number !== j.job_number ? j.display_number : null,
        shipDate: null, // receiving doesn't track inbound ship dates yet
        decoratorGroups, pendingItems, receivedItems, totalUnits,
      };
    });
  }, [jobs]);

  const decoratorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) for (const dg of p.decoratorGroups) if (dg.decoratorName !== "Unassigned") set.add(dg.decoratorName);
    return Array.from(set).sort();
  }, [projects]);

  // Shipments — the actual unit of work on receiving. Grouped by
  // (decorator, tracking) so 3 items shipped today + 4 next week from
  // the same vendor are two rows, not one chip. Falls back to date
  // when tracking is missing.
  const shipments = useShipments(jobs);

  const filteredShipments = useMemo(() => {
    let arr = shipments;
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(s =>
        s.decorator_name.toLowerCase().includes(q)
        || (s.tracking || "").toLowerCase().includes(q)
        || s.short_code.toLowerCase().includes(q)
        || s.jobs.some(j =>
          j.client_name.toLowerCase().includes(q)
          || j.title.toLowerCase().includes(q)
          || j.job_number.toLowerCase().includes(q)
          || j.display_number.toLowerCase().includes(q))
      );
    }
    if (filterDecorator) arr = arr.filter(s => s.decorator_name === filterDecorator);
    return arr;
  }, [shipments, search, filterDecorator]);

  const tabCounts = useMemo(() => ({
    pending: filteredShipments.filter(s => s.pending_count > 0).length,
    received: filteredShipments.filter(s => s.received_count > 0).length,
    outside: outsideShipments.length,
  }), [filteredShipments, outsideShipments]);

  const visibleShipments = useMemo(() => {
    if (tab === "pending") return filteredShipments.filter(s => s.pending_count > 0);
    if (tab === "received") return filteredShipments.filter(s => s.received_count > 0);
    return [];
  }, [filteredShipments, tab]);

  // Action-required classifier for received shipments. Returns the
  // reason a shipment still needs warehouse attention, or null when
  // it's purely historical (sitting in the Received tab as audit
  // trail, no action needed).
  function actionReasonFor(s: Shipment): string | null {
    if (s.variance_units !== 0) {
      return s.variance_units > 0 ? "Over-receive" : "Short";
    }
    const isStage = s.jobs.some(j => j.shipping_route === "stage");
    const isShipThrough = s.jobs.some(j => j.shipping_route === "ship_through");
    if (isStage && s.received_count > 0) {
      const receivedItems = s.items.filter(it => it.received_at_hpd);
      if (receivedItems.length > 0 && receivedItems.some(it => !it.webstore_entered_at)) {
        // Front-office action — warehouse just needs visibility.
        return "Pending front office";
      }
    }
    if (isShipThrough && s.received_count > 0 && s.all_received) {
      // ship_through that's fully received but hasn't been forwarded
      // out yet. The Mark Shipped outbound action lives on /shipping;
      // surface here as a nudge so the dispatcher knows.
      return "Forward to client";
    }
    return null;
  }

  // "Just live in Shopify" — stage shipments fully entered into Shopify
  // within the last 48h. Surfaces as a fresh-inventory cue so warehouse
  // can physically organize / shelve. Drops naturally after the window
  // (the underlying useWarehouse query filters by 48h, so the shipment
  // disappears entirely once it ages out).
  function isLiveInShopify(s: Shipment): boolean {
    const isStage = s.jobs.some(j => j.shipping_route === "stage");
    if (!isStage) return false;
    const receivedItems = s.items.filter(it => it.received_at_hpd);
    if (receivedItems.length === 0) return false;
    if (receivedItems.some(it => !it.webstore_entered_at)) return false;
    const entered = receivedItems
      .map(it => it.webstore_entered_at)
      .filter(Boolean) as string[];
    if (entered.length === 0) return false;
    const mostRecent = entered.sort().reverse()[0];
    const ageHours = (Date.now() - new Date(mostRecent).getTime()) / 3600000;
    return ageHours <= 48;
  }

  // Received tab buckets: action-required pinned to top, then
  // time-bucketed history (Today / This week / Last 30 / Older).
  // "Older" is hidden behind a toggle to prevent the tab becoming a
  // wall of historical receives once volume builds up.
  const [showAllReceived, setShowAllReceived] = useState(false);
  const receivedBuckets = useMemo(() => {
    if (tab !== "received") return null;
    const liveInShopify: Shipment[] = [];
    const actionRequired: { shipment: Shipment; reason: string }[] = [];
    const today: Shipment[] = [];
    const thisWeek: Shipment[] = [];
    const last30: Shipment[] = [];
    const older: Shipment[] = [];
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(todayStart); monthStart.setDate(monthStart.getDate() - 30);
    // Sort by received_at desc (newest first) before bucketing so
    // each section preserves that order.
    const sorted = [...visibleShipments].sort((a, b) => {
      const aTs = a.received_at ? new Date(a.received_at).getTime() : 0;
      const bTs = b.received_at ? new Date(b.received_at).getTime() : 0;
      return bTs - aTs;
    });
    for (const s of sorted) {
      // Live-in-Shopify is a terminal bucket — takes priority over
      // everything else so a fresh-from-Shopify shipment doesn't also
      // show in Today or Needs Attention.
      if (isLiveInShopify(s)) { liveInShopify.push(s); continue; }
      const reason = actionReasonFor(s);
      if (reason) { actionRequired.push({ shipment: s, reason }); continue; }
      const ts = s.received_at ? new Date(s.received_at).getTime() : 0;
      if (ts >= todayStart.getTime()) today.push(s);
      else if (ts >= weekStart.getTime()) thisWeek.push(s);
      else if (ts >= monthStart.getTime()) last30.push(s);
      else older.push(s);
    }
    return { liveInShopify, actionRequired, today, thisWeek, last30, older };
  }, [visibleShipments, tab]);

  const modalShipment = useMemo(() =>
    modalShipmentKey ? shipments.find(s => s.key === modalShipmentKey) || null : null,
    [modalShipmentKey, shipments]);

  // KPI tiles
  const kpis = useMemo(() => {
    const items = projects.reduce((a, p) => a + p.pendingItems, 0);
    const units = projects.reduce((a, p) => {
      return a + p.items.filter(it => !it.received_at_hpd).reduce((b, it) => b + tQty(it.qtys), 0);
    }, 0);
    const todayStr = new Date().toDateString();
    const receivedToday = projects.reduce((a, p) => {
      return a + p.items.filter(it => it.received_at_hpd && it.received_at_hpd_at && new Date(it.received_at_hpd_at).toDateString() === todayStr).length;
    }, 0);
    return { items, units, receivedToday };
  }, [projects]);

  const ic: React.CSSProperties = { padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 11, fontFamily: mono, outline: "none", width: "100%" };

  // Shipment row — used by Pending (flat list) and Received (sectioned).
  // Optional adornments:
  //   actionReason → amber reason chip + amber left border
  //   liveInShopify → green "✓ LIVE IN SHOPIFY" chip + green left border;
  //                   indicates fresh inventory just keyed in
  function renderShipmentRow(shipment: Shipment, opts?: { actionReason?: string; liveInShopify?: boolean }) {
    const primaryJob = shipment.jobs[0];
    const multiJob = shipment.jobs.length > 1;
    const shippedLabel = shipment.shipped_at
      ? new Date(shipment.shipped_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;
    const receivedLabel = shipment.received_at
      ? new Date(shipment.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;
    const ageDays = shipment.shipped_at
      ? Math.floor((Date.now() - new Date(shipment.shipped_at).getTime()) / 86400000)
      : 0;
    const isStale = shipment.pending_count > 0 && ageDays >= 5;
    const routeForBadge = primaryJob?.shipping_route || "ship_through";
    return (
      <div key={shipment.key}
        onClick={() => setModalShipmentKey(shipment.key)}
        style={{
          background: T.card,
          border: `1px solid ${opts?.liveInShopify ? T.green + "55" : opts?.actionReason ? T.amber + "55" : T.border}`,
          borderLeft: opts?.liveInShopify ? `3px solid ${T.green}` : opts?.actionReason ? `3px solid ${T.amber}` : `1px solid ${T.border}`,
          borderRadius: 12,
          padding: "14px 18px", display: "flex", gap: 16, alignItems: "flex-start", cursor: "pointer",
          transition: "border-color 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = opts?.liveInShopify ? T.green + "55" : opts?.actionReason ? T.amber + "55" : T.border; }}>
        {/* Left: vendor + tracking + dates */}
        <div style={{ width: 260, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>
              {shipment.short_code || shipment.decorator_name}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: routeForBadge === "stage" ? T.purple : T.accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              → {routeForBadge === "stage" ? "Fulfillment" : "Shipping"}
            </span>
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4, fontFamily: mono, wordBreak: "break-all" }}>
            {shipment.tracking || <span style={{ color: T.amber }}>no tracking</span>}
          </div>
          {shippedLabel && (
            <div style={{ fontSize: 11, color: isStale ? T.amber : T.faint, marginTop: 2 }}>
              shipped {shippedLabel}{ageDays >= 1 && ` · ${ageDays}d ago`}
            </div>
          )}
          {receivedLabel && (
            <div style={{ fontSize: 11, color: T.green, marginTop: 2, fontWeight: 600 }}>
              received {receivedLabel}
            </div>
          )}
        </div>

        {/* Middle: project chips */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {shipment.jobs.map(j => (
            <div key={j.id} style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <Link href={`/jobs/${j.id}`} onClick={e => e.stopPropagation()}
                style={{ fontSize: 14, fontWeight: 700, color: T.text, textDecoration: "none" }}>
                {j.client_name || "No client"}
              </Link>
              <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>
                {j.display_number !== j.job_number ? j.display_number : j.job_number}
              </span>
              {j.title && (
                <span style={{ fontSize: 11, color: T.faint, wordBreak: "break-word" }}>· {j.title}</span>
              )}
            </div>
          ))}
          {multiJob && (
            <div style={{ fontSize: 10, color: T.amber, fontWeight: 600, marginTop: 2 }}>
              Multi-project shipment ({shipment.jobs.length})
            </div>
          )}
        </div>

        {/* Right: counts + action reason chip */}
        <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 120 }}>
          {opts?.liveInShopify && (
            <span style={{ fontSize: 10, fontWeight: 800, color: T.green, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              ✓ Live in Shopify
            </span>
          )}
          {opts?.actionReason && (
            <span style={{ fontSize: 10, fontWeight: 800, color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {opts.actionReason}
            </span>
          )}
          <div style={{ fontSize: 13, fontWeight: 700, color: shipment.pending_count > 0 ? T.amber : T.green, fontFamily: mono, whiteSpace: "nowrap" }}>
            {shipment.pending_count > 0
              ? `${shipment.pending_count} of ${shipment.total_items}`
              : "Received"}
          </div>
          <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
            {shipment.total_units.toLocaleString()} units
          </span>
          {shipment.variance_units !== 0 && (
            <span style={{ fontSize: 10, color: shipment.variance_units < 0 ? T.red : T.green, fontFamily: mono, marginTop: 2 }}>
              {shipment.variance_units > 0 ? "+" : ""}{shipment.variance_units} variance
            </span>
          )}
        </div>
      </div>
    );
  }

  // Flat per-item list (production-style). Reuses filteredShipments (search +
  // decorator already applied), flattens to items for the active tab, sortable
  // by column. Per-item Receive opens that item's shipment modal (full receive
  // flow); multi-select runs bulkMarkReceived.
  function renderListView() {
    const isPending = tab === "pending";
    const rows = filteredShipments.flatMap(s =>
      s.items
        .filter(it => !!it.received_at_hpd === !isPending)
        .map(it => ({ it, s, job: s.jobs.find(j => j.id === it.job_id) || s.jobs[0] }))
    );
    const shipVal = (d: string | null) => d ? new Date(d).getTime() : Infinity;
    const cmpAsc = (a: typeof rows[number], b: typeof rows[number]) => {
      switch (listSortKey) {
        case "inv": return (a.job?.display_number || "").localeCompare(b.job?.display_number || "");
        case "client": return (a.job?.client_name || "").toLowerCase().localeCompare((b.job?.client_name || "").toLowerCase());
        case "item": return (a.it.name || "").toLowerCase().localeCompare((b.it.name || "").toLowerCase());
        case "decorator": return (a.it.decorator_short_code || a.it.decorator_name || "").localeCompare(b.it.decorator_short_code || b.it.decorator_name || "");
        case "shipped": return shipVal(a.s.shipped_at) - shipVal(b.s.shipped_at);
        case "units": return tQty(a.it.qtys) - tQty(b.it.qtys);
        default: return 0;
      }
    };
    const dir = listSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => cmpAsc(a, b) * dir);

    const selected = rows.filter(r => selectedItemIds.has(r.it.id));
    const eligible = selected.filter(r => !r.it.received_at_hpd);

    const sortGlyph = (k: typeof listSortKey) => (
      <span style={{ fontSize: 8, opacity: listSortKey === k ? 0.9 : 0.3 }}>{listSortKey === k ? (listSortDir === "asc" ? "▲" : "▼") : "↕"}</span>
    );
    const hCell = (k: typeof listSortKey, label: string, style: any) => (
      <div onClick={() => listHeaderClick(k)} style={{ ...style, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, color: listSortKey === k ? T.text : T.muted }}>{label}{sortGlyph(k)}</div>
    );

    if (rows.length === 0) {
      return <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>{isPending ? "Nothing pending — every box is received." : "Nothing received yet."}</div>;
    }

    return (
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
        {isPending && eligible.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
            <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{eligible.length} selected</span>
            <button onClick={() => setSelectedItemIds(new Set())} style={{ background: "none", border: "none", color: T.muted, fontSize: 11, cursor: "pointer", fontFamily: font }}>Clear</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setBatchReceiveItems(eligible.map(r => r.it))}
              style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
              Receive Selected · {eligible.length}
            </button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", userSelect: "none" }}>
          {isPending && <div style={{ width: 24, flexShrink: 0 }} />}
          {hCell("inv", "Inv #", { width: 90, flexShrink: 0 })}
          {hCell("client", "Client", { width: 150, flexShrink: 0 })}
          {hCell("item", "Item", { flex: 1, minWidth: 0, paddingLeft: 10 })}
          {hCell("decorator", "Deco", { width: 104, flexShrink: 0 })}
          {hCell("shipped", "Shipped", { width: 84, flexShrink: 0, justifyContent: "flex-end" })}
          {hCell("units", "Units", { width: 56, flexShrink: 0, justifyContent: "flex-end" })}
          <div style={{ width: 80, flexShrink: 0 }} />
        </div>
        {rows.map(({ it, s, job }) => {
          const isReceived = it.received_at_hpd;
          const shippedStr = s.shipped_at ? new Date(s.shipped_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
          return (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${T.border}55`, fontSize: 12 }}
              onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              {isPending && (
                <div style={{ width: 24, flexShrink: 0, display: "flex", alignItems: "center" }} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedItemIds.has(it.id)} onChange={() => toggleItemSelected(it.id)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: T.accent }} />
                </div>
              )}
              <div style={{ width: 90, flexShrink: 0, color: job?.display_number ? T.text : T.faint, fontFamily: mono, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job?.display_number || "—"}</div>
              <div style={{ width: 150, flexShrink: 0, minWidth: 0, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job?.client_name || "No client"}</div>
              <div onClick={() => setMockupPeek({ driveFileId: mockupMap[it.id]?.driveFileId || null, name: it.name })} title="View mockup"
                style={{ flex: 1, minWidth: 0, paddingLeft: 10, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{it.name}</div>
              <div style={{ width: 104, flexShrink: 0, color: T.muted, fontFamily: mono, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.decorator_short_code || it.decorator_name || "—"}</div>
              <div style={{ width: 84, flexShrink: 0, textAlign: "right", fontFamily: mono, color: T.muted }}>{shippedStr}</div>
              <div style={{ width: 56, flexShrink: 0, textAlign: "right", fontFamily: mono, color: T.text }}>{tQty(it.qtys)}</div>
              <div style={{ width: 80, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                {isReceived ? (
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.04em" }}>Received</span>
                ) : (
                  <button onClick={() => setModalShipmentKey(s.key)} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Receive</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading receiving...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      {/* Header — title + search + decorator filter, mirrors Production */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Receiving</h1>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, clients, decorators..."
          style={{ flex: 1, maxWidth: 360, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
        <select value={filterDecorator} onChange={e => setFilterDecorator(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: filterDecorator ? T.text : T.muted, fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">All decorators</option>
          {decoratorOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        {/* Silent mode toggle — suppresses client emails on receive.
            Visible always so the state is discoverable; the banner
            below makes it impossible to miss when active. */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: silentMode ? T.amber : T.muted, cursor: "pointer", fontFamily: font, padding: "6px 10px", borderRadius: 8, border: `1px solid ${silentMode ? T.amber : T.border}`, background: silentMode ? T.amberDim : "transparent" }}>
          <input type="checkbox" checked={silentMode} onChange={e => setSilentMode(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: T.amber, cursor: "pointer" }} />
          Silent mode
        </label>
      </div>

      {/* Silent mode banner — loud + persistent so Jon can't forget
          it's on. Backfill scenario: receive a stack of old shipments
          without spamming clients with stale "production complete"
          emails for boxes that arrived weeks ago. */}
      {silentMode && (
        <div style={{ background: T.amberDim, border: `1px solid ${T.amber}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase" }}>Silent mode</span>
          <span style={{ color: T.text }}>Client "production complete" emails will NOT fire. Use for backfilling historical receives.</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setSilentMode(false)}
            style={{ background: T.amber, border: "none", color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontFamily: font }}>
            Turn off
          </button>
        </div>
      )}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {[
          { label: "Items pending", value: kpis.items.toLocaleString(), tone: T.text },
          { label: "Units pending", value: kpis.units.toLocaleString(), tone: T.muted },
          { label: "Received today", value: kpis.receivedToday.toLocaleString(), tone: T.green },
        ].map(s => (
          <div key={s.label} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.tone, lineHeight: 1, fontFamily: mono }}>{s.value}</div>
            <div style={{ fontSize: 9, color: T.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tab bar — flat underline */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
        {([
          ["pending", "Pending", tabCounts.pending, T.text],
          ["received", "Received", tabCounts.received, T.green],
          ["outside", "Outside", tabCounts.outside, T.amber],
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
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: active || k === "outside" ? tone : T.faint }}>{count}</span>
              )}
            </button>
          );
        })}
        {tab !== "outside" && (
          <>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
              {(["shipments", "list"] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  style={{ background: viewMode === m ? T.surface : "transparent", color: viewMode === m ? T.text : T.muted, border: "none", padding: "5px 12px", fontSize: 11, fontWeight: 700, fontFamily: font, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {m === "shipments" ? "Shipments" : "Item List"}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── List view (pending / received) — one row per item ── */}
      {tab !== "outside" && viewMode === "list" && renderListView()}

      {/* ── Pending tab — shipment rows, flat list ── */}
      {tab === "pending" && viewMode === "shipments" && (
        <>
          {visibleShipments.length === 0 && (
            <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>
              Nothing pending — every box is received.
            </div>
          )}
          {visibleShipments.map(shipment => renderShipmentRow(shipment))}
        </>
      )}

      {/* ── Received tab — sectioned: Needs attention · Today · This
          week · Last 30 days · Older. Action-required pinned on top
          gives the floor a clear daily working list; time buckets
          collapse the historical pile so the page doesn't read as
          a wall of "done" stuff. */}
      {tab === "received" && receivedBuckets && viewMode === "shipments" && (
        <>
          {visibleShipments.length === 0 && (
            <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>
              Nothing received recently.
            </div>
          )}

          {/* Live in Shopify — pinned to top. Fresh inventory keyed in
              by front office in the last 48h. Cue for warehouse to
              shelve/organize. Rows auto-drop after the 48h window
              (filtered server-side by useWarehouse). */}
          {receivedBuckets.liveInShopify.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.green, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  ✓ Live in Shopify — shelve
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.liveInShopify.length} shipment{receivedBuckets.liveInShopify.length === 1 ? "" : "s"} · last 48h
                </span>
              </div>
              {receivedBuckets.liveInShopify.map(s => renderShipmentRow(s, { liveInShopify: true }))}
            </>
          )}

          {/* Needs attention — amber section header, reason badge per row */}
          {receivedBuckets.actionRequired.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  Needs attention
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.actionRequired.length} shipment{receivedBuckets.actionRequired.length === 1 ? "" : "s"}
                </span>
              </div>
              {receivedBuckets.actionRequired.map(({ shipment, reason }) =>
                renderShipmentRow(shipment, { actionReason: reason }))}
            </>
          )}

          {/* Today */}
          {receivedBuckets.today.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  Today
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.today.length} shipment{receivedBuckets.today.length === 1 ? "" : "s"}
                </span>
              </div>
              {receivedBuckets.today.map(s => renderShipmentRow(s))}
            </>
          )}

          {/* This week */}
          {receivedBuckets.thisWeek.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  This week
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.thisWeek.length} shipment{receivedBuckets.thisWeek.length === 1 ? "" : "s"}
                </span>
              </div>
              {receivedBuckets.thisWeek.map(s => renderShipmentRow(s))}
            </>
          )}

          {/* Last 30 days */}
          {receivedBuckets.last30.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  Last 30 days
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.last30.length} shipment{receivedBuckets.last30.length === 1 ? "" : "s"}
                </span>
              </div>
              {receivedBuckets.last30.map(s => renderShipmentRow(s))}
            </>
          )}

          {/* Older — collapsed by default; "Show all" toggle reveals.
              Prevents the tab becoming a wall of historical data. */}
          {receivedBuckets.older.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <button onClick={() => setShowAllReceived(v => !v)}
                  style={{ background: "transparent", border: "none", color: T.faint, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", padding: 0, fontFamily: font }}>
                  {showAllReceived ? "▾" : "▸"} Older
                </button>
                <span style={{ fontSize: 11, color: T.faint }}>
                  {receivedBuckets.older.length} shipment{receivedBuckets.older.length === 1 ? "" : "s"} hidden
                </span>
              </div>
              {showAllReceived && receivedBuckets.older.map(s => renderShipmentRow(s))}
            </>
          )}
        </>
      )}

      {/* ── Shipment receive modal — opens on row click ── */}
      {modalShipment && (() => {
        const shipment = modalShipment;
        const primaryJob = shipment.jobs[0];
        const routeForBadge = primaryJob?.shipping_route || "ship_through";
        const shipmentSlips = shipment.items.flatMap(it => packingSlips[it.id] || []);
        const uniqueSlips = shipmentSlips.filter((s, i, arr) => arr.findIndex(x => x.file_name === s.file_name) === i);
        const allSelected = shipment.items.length > 0 && shipment.items.every(it => selectedItemIds.has(it.id));
        const eligible = shipment.items.filter(it => selectedItemIds.has(it.id) && !it.received_at_hpd);
        // Job lookup so handlePhotoUpload can pass the right client/project
        // for the Drive folder path. Items in a multi-job shipment route
        // to their own project's folder.
        const jobById = new Map(shipment.jobs.map(j => [j.id, j]));
        return (
          <div style={{ position: "fixed", inset: 0, background: T.bg, zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Header — vendor + tracking primary; project context secondary */}
              <div style={{ padding: "14px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0, background: T.card }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span>{shipment.decorator_name}</span>
                    {shipment.tracking ? (
                      <span style={{ fontFamily: mono, color: T.muted, fontWeight: 600, fontSize: 13 }}>{shipment.tracking}</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.amber, letterSpacing: "0.06em", textTransform: "uppercase" }}>no tracking</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: T.faint, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {shipment.shipped_at && (
                      <span>Shipped {new Date(shipment.shipped_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
                    )}
                    {shipment.received_at && (
                      <span style={{ color: T.green, fontWeight: 600 }}>
                        Received {new Date(shipment.received_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                    {shipment.jobs.map(j => (
                      <Link key={j.id} href={`/jobs/${j.id}`} style={{ color: T.muted, textDecoration: "none" }}>
                        {j.client_name} · {j.display_number}
                      </Link>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: routeForBadge === "stage" ? T.purple : T.accent, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    → {routeForBadge === "stage" ? "Fulfillment" : "Shipping"}
                  </span>
                  <button onClick={() => setModalShipmentKey(null)} title="Close (Esc)"
                    style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
                </div>
              </div>

              {/* Body */}
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 22px" }}>
                {/* Shipment header — counts + bulk actions */}
                <div style={{ paddingBottom: 14, borderBottom: `1px solid ${T.border}`, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", color: T.text }}>
                        {shipment.total_items} item{shipment.total_items !== 1 ? "s" : ""}
                      </h2>
                      <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>
                        <strong style={{ color: T.text, fontWeight: 700 }}>{shipment.pending_count}</strong> pending
                        <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                        <strong style={{ color: T.text, fontWeight: 700 }}>{shipment.received_count}</strong> received
                        <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                        <strong style={{ color: T.text, fontWeight: 700 }}>{shipment.total_units.toLocaleString()}</strong> units
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action row — Select all + bulk receive · View packing slips */}
                <div style={{ padding: "0 0 14px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => {
                    setSelectedItemIds(prev => {
                      const next = new Set(prev);
                      if (allSelected) {
                        for (const it of shipment.items) next.delete(it.id);
                      } else {
                        for (const it of shipment.items) next.add(it.id);
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
                    <button onClick={async () => {
                      // bulkMarkReceived resolves per-item condition+notes
                      // from the row inputs, runs all the writes, then
                      // fires the "all received" email + phase recalc
                      // exactly once per affected job after the loop.
                      await bulkMarkReceived(eligible, (it) => ({
                        condition: itemCondition[it.id] || "good",
                        notes: conditionNote[it.id] || "",
                      }), { skipClientEmail: silentMode });
                      setSelectedItemIds(prev => {
                        const next = new Set(prev);
                        for (const it of eligible) next.delete(it.id);
                        return next;
                      });
                    }} style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 6, background: T.green, color: "#fff", border: "none", cursor: "pointer", fontFamily: font }}>
                      Receive Selected · {eligible.length}
                    </button>
                  )}
                  {eligible.length > 0 && (
                    <button onClick={async () => {
                      for (const it of eligible) await returnToProduction(it);
                      setSelectedItemIds(prev => {
                        const next = new Set(prev);
                        for (const it of eligible) next.delete(it.id);
                        return next;
                      });
                    }} style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 6, background: T.amber, color: "#fff", border: "none", cursor: "pointer", fontFamily: font }}>
                      ← Return Selected · {eligible.length}
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  {uniqueSlips.length > 0 && (
                    <button onClick={(e) => { e.stopPropagation(); setViewingSlips({ files: uniqueSlips, index: 0, title: shipment.short_code || shipment.decorator_name }); }}
                      style={{ fontSize: 11, padding: "5px 12px", borderRadius: 6, background: T.accentDim, color: T.accent, border: "none", cursor: "pointer", fontWeight: 600, fontFamily: font }}>
                      View packing slips ({uniqueSlips.length})
                    </button>
                  )}
                </div>

                {/* Shopify-entry status — informational only. The action
                    moved to the Ecomm Intake tab (front office workflow).
                    Warehouse still sees the pending count so they know
                    handoff is in motion. */}
                {(() => {
                  const isStage = shipment.jobs.some(j => j.shipping_route === "stage");
                  if (!isStage) return null;
                  const receivedItems = shipment.items.filter(it => it.received_at_hpd);
                  if (receivedItems.length === 0) return null;
                  const notEntered = receivedItems.filter(it => !it.webstore_entered_at);
                  const allEntered = notEntered.length === 0;
                  if (allEntered) {
                    return (
                      <div style={{ padding: "8px 12px", marginBottom: 14, borderRadius: 8, background: T.greenDim, border: `1px solid ${T.green}44`, display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: T.green, letterSpacing: "0.08em", textTransform: "uppercase" }}>✓ Entered in Shopify</span>
                        <span style={{ fontSize: 11, color: T.muted }}>
                          {receivedItems.length} item{receivedItems.length === 1 ? "" : "s"} handed off · ShipStation owns fulfillment from here
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div style={{ padding: "8px 12px", marginBottom: 14, borderRadius: 8, background: T.amberDim, border: `1px solid ${T.amber}55`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase" }}>Awaiting Shopify entry</span>
                      <span style={{ fontSize: 11, color: T.text }}>
                        {notEntered.length} of {receivedItems.length} received item{receivedItems.length === 1 ? "" : "s"} pending front-office entry on /ecomm
                      </span>
                    </div>
                  );
                })()}

                {/* Items */}
                <div>
                  {shipment.items.map(item => {
                                    const isReceived = item.received_at_hpd;
                                    const shippedQty = tQty(item.ship_qtys);
                                    const totalQty = tQty(item.qtys);
                                    const receivedTotal = tQty(item.received_qtys);
                                    const sampleTotal = tQty(item.sample_qtys);
                                    const hasVariance = isReceived && receivedTotal > 0 && receivedTotal !== (shippedQty || totalQty);
                                    return (
                                      <div key={item.id} style={{
                                        padding: "12px 14px", borderRadius: 6, marginBottom: 6,
                                        background: isReceived ? T.greenDim + "44" : "transparent",
                                        border: `1px solid ${isReceived ? T.green + "33" : T.border}`,
                                      }}>
                                        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                                          <input
                                            type="checkbox"
                                            checked={selectedItemIds.has(item.id)}
                                            onChange={() => toggleItemSelected(item.id)}
                                            onClick={e => e.stopPropagation()}
                                            style={{ width: 16, height: 16, cursor: "pointer", accentColor: T.accent, flexShrink: 0, marginTop: 4 }}
                                          />
                                          <span style={{ fontSize: 13, fontWeight: 800, color: T.muted, fontFamily: mono, flexShrink: 0, marginTop: 2 }}>{item.letter}</span>

                                          {/* Mockup thumbnail — visual confirmation
                                              for the receiver. Click enlarges. */}
                                          <div style={{ width: 72, height: 72, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: T.surface, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            {mockupMap[item.id]?.driveFileId ? (
                                              <DriveThumb
                                                driveFileId={mockupMap[item.id].driveFileId}
                                                enlargeable
                                                title={`${item.name} — mockup`}
                                                driveLink={mockupMap[item.id].driveLink || null}
                                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                                fallback={<span style={{ fontSize: 9, color: T.faint }}>no mockup</span>}
                                              />
                                            ) : (
                                              <span style={{ fontSize: 9, color: T.faint }}>no mockup</span>
                                            )}
                                          </div>

                                          {/* Title + specs */}
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.name}</div>
                                            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                                              {[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ") || "—"}
                                              {item.ship_tracking && <> · <span style={{ fontFamily: mono }}>{item.ship_tracking}</span></>}
                                            </div>
                                            {item.ship_notes && <div style={{ fontSize: 11, color: T.amber, marginTop: 3 }}>{item.ship_notes}</div>}

                                            {/* Photos */}
                                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                                              {(receivingPhotos[item.id] || []).map((p, pi) => (
                                                <DriveFileLink key={pi} driveFileId={p.drive_file_id} fileName={p.file_name} mimeType={p.mime_type}
                                                  style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: T.surface, color: T.muted }}>
                                                  {p.file_name}
                                                </DriveFileLink>
                                              ))}
                                              {uploadingPhoto === item.id ? (
                                                <span style={{ fontSize: 10, color: T.accent }}>Uploading...</span>
                                              ) : (
                                                <>
                                                  <button onClick={() => photoInputRefs.current[item.id]?.click()}
                                                    style={{ fontSize: 10, color: T.faint, background: "none", border: `1px dashed ${T.border}`, borderRadius: 3, padding: "2px 8px", cursor: "pointer" }}>
                                                    + Photo
                                                  </button>
                                                  <input ref={el => { photoInputRefs.current[item.id] = el; }} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                                                    onChange={e => {
                                                      const f = e.target.files?.[0];
                                                      if (f) {
                                                        const j = jobById.get(item.job_id);
                                                        handlePhotoUpload(f, { client_name: j?.client_name || "", title: j?.title || "" }, item);
                                                      }
                                                      e.target.value = "";
                                                    }} />
                                                </>
                                              )}
                                            </div>
                                          </div>

                                          {/* Per-size receiving grid — single
                                              "Samples" label on the left of the
                                              samples row instead of repeating
                                              above every input. */}
                                          {item.sizes.length > 0 && (
                                            <div style={{
                                              display: "grid",
                                              gridTemplateColumns: `auto repeat(${item.sizes.length}, 56px)`,
                                              columnGap: 8,
                                              rowGap: 2,
                                              alignItems: "center",
                                              fontFamily: mono,
                                              flexShrink: 0,
                                            }}>
                                              {/* Row 1 — size headers */}
                                              <span />
                                              {item.sizes.map(sz => (
                                                <span key={`hdr-${sz}`} style={{ fontSize: 11, color: T.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "center" }}>{sz}</span>
                                              ))}

                                              {/* Row 2 — shipped qty (read-only) */}
                                              <span />
                                              {item.sizes.map(sz => {
                                                const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                                                return (
                                                  <span key={`shp-${sz}`} style={{ fontSize: 11, color: T.muted, fontWeight: 600, textAlign: "center" }}>{shipped}</span>
                                                );
                                              })}

                                              {/* Row 3 — received qty (input). Live variance flag
                                                  matches Production: under = amber, over = green,
                                                  equal = neutral. Persists after Receive too so
                                                  the row keeps showing where the gaps were. */}
                                              <span style={{ fontSize: 8, color: T.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", paddingRight: 4, fontFamily: font }}>Delivered</span>
                                              {item.sizes.map(sz => {
                                                const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                                                const received = item.received_qtys?.[sz] ?? shipped;
                                                const diffColor = received < shipped ? T.amber : received > shipped ? T.green : null;
                                                return (
                                                  <input key={`rcv-${sz}`} type="number" min="0" value={received}
                                                    onChange={e => updateReceivedQty(item, sz, parseInt(e.target.value) || 0)}
                                                    onFocus={e => e.target.select()}
                                                    title="Received"
                                                    style={{ width: 56, textAlign: "center", padding: "6px 4px", border: `1px solid ${diffColor || T.border}`, borderRadius: 5, background: T.surface, color: diffColor || T.text, fontSize: 13, fontWeight: 600, fontFamily: mono, outline: "none" }} />
                                                );
                                              })}

                                              {/* Row 4 — Samples (single label + per-size inputs) */}
                                              <span style={{ fontSize: 8, color: T.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", paddingRight: 4, fontFamily: font, marginTop: 2 }}>Samples</span>
                                              {item.sizes.map(sz => {
                                                const samples = item.sample_qtys?.[sz] ?? 0;
                                                return (
                                                  <input key={`smp-${sz}`} type="number" min="0" value={samples}
                                                    onChange={e => updateSampleQty(item, sz, parseInt(e.target.value) || 0)}
                                                    onFocus={e => e.target.select()}
                                                    title="Samples pulled (deducts from continuing qty)"
                                                    style={{ width: 56, marginTop: 2, textAlign: "center", padding: "5px 4px", border: `1px solid ${samples > 0 ? T.amber : T.border}`, borderRadius: 5, background: samples > 0 ? T.amberDim : T.surface, color: samples > 0 ? T.amber : T.faint, fontSize: 12, fontWeight: 600, fontFamily: mono, outline: "none" }} />
                                                );
                                              })}
                                            </div>
                                          )}

                                          {/* Right side — condition / status / actions */}
                                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, minWidth: 130 }}>
                                            {isReceived ? (
                                              <>
                                                <span style={{
                                                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                                                  color: (item.receiving_data as any)?.condition === "damaged" ? T.red
                                                    : (item.receiving_data as any)?.condition === "partial_damage" ? T.amber
                                                    : hasVariance ? T.amber : T.green,
                                                }}>
                                                  {(item.receiving_data as any)?.condition === "damaged" ? "Damaged"
                                                    : (item.receiving_data as any)?.condition === "partial_damage" ? "Partial damage"
                                                    : hasVariance ? "Variance" : "Good"}
                                                </span>
                                                {(item.receiving_data as any)?.notes && (
                                                  <div style={{ fontSize: 10, color: T.muted, maxWidth: 130, textAlign: "right", lineHeight: 1.3 }} title={(item.receiving_data as any).notes}>
                                                    {(item.receiving_data as any).notes}
                                                  </div>
                                                )}
                                                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                                                  <button onClick={() => undoReceived(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>Undo</button>
                                                  <button onClick={() => returnToProduction(item)} style={{ fontSize: 10, color: T.amber, background: "none", border: `1px solid ${T.amber}44`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }} title="Send back to decorator">← Production</button>
                                                </div>
                                              </>
                                            ) : (
                                              <>
                                                {/* Condition is metadata only — damaged units must be
                                                    manually decremented from Delivered above. There's
                                                    no per-size damage column yet, so a "Damaged" tag
                                                    won't auto-deduct from the continuing qty that
                                                    flows to packing slip / QB invoice / fulfillment. */}
                                                <select
                                                  value={itemCondition[item.id] || "good"}
                                                  onChange={e => setItemCondition(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                  style={{ ...ic, width: 130, fontSize: 11, padding: "5px 8px" }}
                                                >
                                                  <option value="good">Good</option>
                                                  <option value="partial_damage">Partial damage</option>
                                                  <option value="damaged">Damaged</option>
                                                </select>
                                                <input
                                                  type="text"
                                                  placeholder={itemCondition[item.id] && itemCondition[item.id] !== "good" ? "Describe damage..." : "Notes (optional)"}
                                                  value={conditionNote[item.id] || ""}
                                                  onChange={e => setConditionNote(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                  style={{
                                                    ...ic, width: 130, fontSize: 11, padding: "5px 8px",
                                                    fontFamily: font,
                                                    borderColor: itemCondition[item.id] && itemCondition[item.id] !== "good" ? T.amber : T.border,
                                                  }}
                                                />
                                                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                                                  <button onClick={() => returnToProduction(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }} title="Send back to decorator">← Production</button>
                                                  <button onClick={() => markReceived(item, {
                                                    condition: itemCondition[item.id] || "good",
                                                    notes: conditionNote[item.id] || "",
                                                    skipClientEmail: silentMode,
                                                  })} style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: T.green, border: "none", borderRadius: 4, padding: "5px 14px", cursor: "pointer" }}>Receive</button>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        </div>

                                        {/* Variance / samples summary */}
                                        {(hasVariance || sampleTotal > 0) && (
                                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${T.border}`, display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap" }}>
                                            {hasVariance && (
                                              <span style={{ color: T.red, fontWeight: 600 }}>
                                                Variance: {receivedTotal - (shippedQty || totalQty)} units
                                              </span>
                                            )}
                                            {sampleTotal > 0 && (
                                              <span style={{ color: T.muted }}>
                                                <span style={{ color: T.amber, fontWeight: 600 }}>{sampleTotal}</span> sample{sampleTotal !== 1 ? "s" : ""} pulled
                                                {" · "}
                                                <span style={{ color: T.text, fontWeight: 700, fontFamily: mono }}>{receivedTotal - sampleTotal}</span> continuing
                                              </span>
                                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Outside tab ── */}
      {tab === "outside" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button onClick={() => setShowForm(!showForm)}
            style={{ alignSelf: "flex-start", padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: font }}>
            + Log incoming shipment
          </button>

          {showForm && (
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>New outside shipment</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Carrier</label>
                  <input style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} placeholder="UPS, FedEx, USPS..." />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Tracking #</label>
                  <input style={{ ...ic, fontFamily: mono }} value={form.tracking} onChange={e => setForm(f => ({ ...f, tracking: e.target.value }))} placeholder="Tracking number" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Sender</label>
                  <input style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.sender} onChange={e => setForm(f => ({ ...f, sender: e.target.value }))} placeholder="Who sent it?" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Condition</label>
                  <select style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                    <option value="good">Good</option>
                    <option value="damaged">Damaged</option>
                    <option value="partial">Partial</option>
                    <option value="wrong_item">Wrong item</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Description *</label>
                <input style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What is it? e.g. Client samples, return from Nike, supplies box" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
                <input style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional details" />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Photos / documents</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; setPendingFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
                  style={{
                    border: `2px dashed ${T.border}`, borderRadius: 8, padding: "12px 16px",
                    textAlign: "center", cursor: "pointer", transition: "border-color 0.15s",
                  }}>
                  <div style={{ fontSize: 12, color: T.accent, fontWeight: 600 }}>Drop files or click to browse</div>
                  <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>Photos of packaging, packing slips, damage, etc.</div>
                </div>
                <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
                  onChange={e => { setPendingFiles(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
                {pendingFiles.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {pendingFiles.map((f, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: T.surface, color: T.muted, display: "flex", alignItems: "center", gap: 4 }}>
                        {f.name}
                        <button onClick={e => { e.stopPropagation(); setPendingFiles(prev => prev.filter((_, j) => j !== i)); }}
                          style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11, padding: 0 }}>x</button>
                      </span>
                    ))}
                  </div>
                )}
                {uploadStatus && <div style={{ fontSize: 11, color: T.accent, marginTop: 4 }}>{uploadStatus}</div>}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={submitOutside} disabled={saving || !form.description.trim()}
                  style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, opacity: saving || !form.description.trim() ? 0.5 : 1 }}>
                  {saving ? (uploadStatus || "Saving...") : "Log shipment"}
                </button>
                <button onClick={() => setShowForm(false)}
                  style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 12 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {outsideShipments.length === 0 && !showForm ? (
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
              No outside shipments logged. Use the button above to log incoming packages not tied to a project.
            </div>
          ) : (
            outsideShipments.map(s => (
              <div key={s.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{s.description}</div>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: T.muted, flexWrap: "wrap" }}>
                      {s.sender && <span>From: {s.sender}</span>}
                      {s.carrier && <span>{s.carrier}</span>}
                      {s.tracking && <span style={{ fontFamily: mono }}>{s.tracking}</span>}
                      <span>{new Date(s.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    {s.notes && <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>{s.notes}</div>}
                    {s.files?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                        {s.files.map((f, i) => (
                          <DriveFileLink key={i} driveFileId={f.driveFileId} fileName={f.name}
                            style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: T.accentDim, color: T.accent }}>
                            {f.name}
                          </DriveFileLink>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                        color: s.condition === "good" ? T.green : s.condition === "damaged" ? T.red : T.amber,
                      }}>
                        {s.condition === "good" ? "Good" : s.condition === "damaged" ? "Damaged" : s.condition === "partial" ? "Partial" : "Wrong item"}
                      </span>
                      {s.job_id ? (
                        <span style={{ fontSize: 10, color: T.accent }}>Linked to project</span>
                      ) : (
                        <select
                          onChange={e => { if (e.target.value) linkToJob(s.id, e.target.value); }}
                          value=""
                          style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.surface, color: T.muted, cursor: "pointer" }}>
                          <option value="">Link to project...</option>
                          {linkableJobs.map(j => (
                            <option key={j.id} value={j.id}>{j.client_name} — {j.title}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => routeShipment(s.id, "ship_through")}
                      style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 6, border: "none", background: T.accent, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>
                      → Ship-through
                    </button>
                    <button onClick={() => routeShipment(s.id, "stage")}
                      style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 6, border: "none", background: T.purple, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>
                      → Stage
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Packing slip viewer modal */}
      {/* Batch-receive confirm — opened by "Receive Selected" in List view.
          Review each item's qty + condition, then commit via bulkMarkReceived.
          Per-size / photo detail stays in the per-item Receive modal. */}
      {mockupPeek && <MockupPeek driveFileId={mockupPeek.driveFileId} name={mockupPeek.name} onClose={() => setMockupPeek(null)} />}

      {batchReceiveItems && (() => {
        const items = batchReceiveItems;
        return (
          <div onClick={() => setBatchReceiveItems(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(560px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Receive {items.length} item{items.length !== 1 ? "s" : ""}</div>
                <button onClick={() => setBatchReceiveItems(null)} style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>Confirm quantities + condition, then mark received. For per-size or photo detail, use the row&apos;s Receive button instead.</div>
                {items.map(it => {
                  const cond = itemCondition[it.id] || "good";
                  const shipped = tQty(it.ship_qtys) || tQty(it.qtys);
                  return (
                    <div key={it.id} style={{ padding: "10px 0", borderBottom: `1px solid ${T.border}55`, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                          <div style={{ fontSize: 11, color: T.muted }}>{it.decorator_short_code || it.decorator_name || "—"}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: mono, whiteSpace: "nowrap" }}>{shipped} units</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {(["good", "damaged"] as const).map(c => (
                          <button key={c} onClick={() => setItemCondition(prev => ({ ...prev, [it.id]: c }))}
                            style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 6, border: `1px solid ${cond === c ? (c === "damaged" ? T.red : T.green) : T.border}`, background: cond === c ? (c === "damaged" ? T.redDim : T.greenDim) : "transparent", color: cond === c ? (c === "damaged" ? T.red : T.green) : T.muted, cursor: "pointer", fontFamily: font, textTransform: "capitalize" }}>{c}</button>
                        ))}
                        {cond === "damaged" && (
                          <input value={conditionNote[it.id] || ""} onChange={e => setConditionNote(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="What's damaged?"
                            style={{ flex: 1, fontSize: 12, padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, outline: "none", fontFamily: font }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => setBatchReceiveItems(null)} style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Cancel</button>
                <button onClick={async () => {
                  await bulkMarkReceived(items, (it) => ({ condition: itemCondition[it.id] || "good", notes: conditionNote[it.id] || "" }), { skipClientEmail: silentMode });
                  setSelectedItemIds(prev => { const next = new Set(prev); for (const it of items) next.delete(it.id); return next; });
                  setBatchReceiveItems(null);
                }} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                  Mark {items.length} Received
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {viewingSlips && (
        <div onClick={() => setViewingSlips(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, borderRadius: 12, width: "90vw", maxWidth: 900, height: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{viewingSlips.title} — Packing slips</span>
                {viewingSlips.files.length > 1 && (
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{viewingSlips.index + 1} / {viewingSlips.files.length}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {viewingSlips.files.length > 1 && (
                  <>
                    <button onClick={() => setViewingSlips(v => v ? { ...v, index: Math.max(0, v.index - 1) } : null)} disabled={viewingSlips.index === 0}
                      style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: "none", color: viewingSlips.index === 0 ? T.faint : T.text, cursor: "pointer", fontSize: 12 }}>Prev</button>
                    <button onClick={() => setViewingSlips(v => v ? { ...v, index: Math.min(v.files.length - 1, v.index + 1) } : null)} disabled={viewingSlips.index === viewingSlips.files.length - 1}
                      style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: "none", color: viewingSlips.index === viewingSlips.files.length - 1 ? T.faint : T.text, cursor: "pointer", fontSize: 12 }}>Next</button>
                  </>
                )}
                <button onClick={() => setViewingSlips(null)}
                  style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: T.surface, color: T.muted, cursor: "pointer", fontSize: 12 }}>Close</button>
              </div>
            </div>
            <div style={{ padding: "6px 16px", fontSize: 11, color: T.muted, borderBottom: `1px solid ${T.border}` }}>
              {viewingSlips.files[viewingSlips.index].file_name}
            </div>
            <div style={{ flex: 1 }}>
              <iframe src={viewingSlips.files[viewingSlips.index].drive_link.replace("/view", "/preview")} style={{ width: "100%", height: "100%", border: "none" }} allow="autoplay" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
