"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty, type WarehouseJob, type WarehouseItem } from "@/lib/use-warehouse";
import { uploadToReceiving, uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { DriveFileLink } from "@/components/DriveFileLink";
import { DriveThumb } from "@/components/DriveThumb";

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
  const { loading, jobs, updateReceivedQty, updateSampleQty, markReceived, undoReceived, returnToProduction } = useWarehouse();
  const supabase = createClient();

  // Filters / tabs
  const [search, setSearch] = useState("");
  const [filterDecorator, setFilterDecorator] = useState("");
  const [tab, setTab] = useState<"pending" | "received" | "outside">("pending");

  // Modal
  const [modalProject, setModalProject] = useState<ReceivingProject | null>(null);
  const [modalDecoratorKey, setModalDecoratorKey] = useState<string | null>(null);
  const [expandedDecorators, setExpandedDecorators] = useState<Set<string>>(new Set());
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

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
    if (!modalProject) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalProject(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalProject]);

  // Reset modal-local state when modal closes
  useEffect(() => {
    if (!modalProject) {
      setExpandedDecorators(new Set());
      setModalDecoratorKey(null);
      setSelectedItemIds(new Set());
    }
  }, [modalProject?.id]);

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

  // Sync open modal with refreshed projects list
  useEffect(() => {
    if (!modalProject) return;
    const fresh = projects.find(p => p.id === modalProject.id);
    if (fresh && fresh !== modalProject) setModalProject(fresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

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

  async function handlePhotoUpload(file: File, project: ReceivingProject, item: WarehouseItem) {
    setUploadingPhoto(item.id);
    try {
      const result = await uploadToDrive({
        blob: file, fileName: file.name, mimeType: file.type || "image/jpeg",
        clientName: project.client_name, projectTitle: project.title, itemName: item.name,
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

  function toggleDecorator(key: string) {
    setExpandedDecorators(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
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

  const filtered = useMemo(() => {
    let arr = projects;
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(p =>
        p.client_name.toLowerCase().includes(q)
        || p.title.toLowerCase().includes(q)
        || p.job_number.toLowerCase().includes(q)
        || (p.invoiceNumber || "").toLowerCase().includes(q)
        || p.decoratorGroups.some(g => g.decoratorName.toLowerCase().includes(q))
      );
    }
    if (filterDecorator) arr = arr.filter(p => p.decoratorGroups.some(g => g.decoratorName === filterDecorator));
    return arr;
  }, [projects, search, filterDecorator]);

  const tabCounts = useMemo(() => ({
    pending: filtered.filter(p => p.pendingItems > 0).length,
    received: filtered.filter(p => p.receivedItems > 0).length,
    outside: outsideShipments.length,
  }), [filtered, outsideShipments]);

  const visible = useMemo(() => {
    if (tab === "pending") return filtered.filter(p => p.pendingItems > 0);
    if (tab === "received") return filtered.filter(p => p.receivedItems > 0);
    return [];
  }, [filtered, tab]);

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
      </div>

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
      </div>

      {/* ── Pending / Received tabs — project rows ── */}
      {(tab === "pending" || tab === "received") && (
        <>
          {visible.length === 0 && (
            <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>
              {tab === "pending" ? "Nothing pending — all items received." : "Nothing received recently."}
            </div>
          )}

          {visible.map(project => {
            const isModalOpen = modalProject?.id === project.id;
            const allReceived = project.pendingItems === 0;
            return (
              <div key={project.id} style={{
                background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden",
              }}>
                <div style={{ padding: "14px 18px", display: "flex", gap: 16, alignItems: "flex-start" }}>
                  {/* Title block */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, width: 220, flexShrink: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: project.invoiceNumber ? T.text : "transparent", fontFamily: mono, whiteSpace: "nowrap", alignSelf: "center" }}>
                      {project.invoiceNumber || project.job_number}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Link href={`/jobs/${project.id}`} style={{ color: T.text, textDecoration: "none" }}>{project.client_name || "No client"}</Link>
                        {allReceived && <span style={{ fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase" }}>All received</span>}
                        <span style={{ fontSize: 10, fontWeight: 700, color: project.shipping_route === "stage" ? T.purple : T.accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          → {project.shipping_route === "stage" ? "Fulfillment" : "Shipping"}
                        </span>
                      </div>
                      {project.title && (
                        <div style={{ fontSize: 12, color: T.faint, marginTop: 2, lineHeight: 1.4, wordBreak: "break-word" }}>{project.title}</div>
                      )}
                    </div>
                  </div>

                  {/* Vendor chips */}
                  <div style={{ flex: 1, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    {project.decoratorGroups.map(dg => {
                      const decKey = dg.decoratorName;
                      return (
                        <button key={decKey}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModalDecoratorKey(decKey);
                            setExpandedDecorators(new Set([decKey]));
                            setModalProject(project);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "4px 10px", borderRadius: 6, background: T.surface,
                            fontSize: 11, border: `1px solid ${T.border}`, cursor: "pointer",
                            fontFamily: font, transition: "all 0.12s",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = T.accentDim; e.currentTarget.style.borderColor = T.accent; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = T.surface; e.currentTarget.style.borderColor = T.border; }}>
                          <span style={{ fontWeight: 600, color: T.text }}>{dg.shortCode || dg.decoratorName}</span>
                          <span style={{ color: T.muted }}>{dg.items.length} item{dg.items.length !== 1 ? "s" : ""}</span>
                          <span style={{ color: T.faint }}>·</span>
                          {dg.pending > 0 && <span style={{ color: T.amber }}>{dg.pending} pending</span>}
                          {dg.received > 0 && <span style={{ color: T.green }}>{dg.received} received</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Right — units + counts */}
                  <div style={{ flexShrink: 0, marginLeft: 12, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 70 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: project.pendingItems > 0 ? T.amber : T.green, fontFamily: mono, whiteSpace: "nowrap" }}>
                      {project.pendingItems > 0 ? `${project.pendingItems} to go` : "Done"}
                    </div>
                    <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {project.totalUnits.toLocaleString()} units
                    </span>
                  </div>
                </div>

                {/* ── Modal ── */}
                {isModalOpen && (
                  <div style={{ position: "fixed", inset: 0, background: T.bg, zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
                    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      {/* Header */}
                      <div style={{ padding: "14px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0, background: T.card }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: T.text, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: mono }}>{project.invoiceNumber || project.job_number}</span>
                            <span style={{ color: T.muted, fontWeight: 600 }}>{project.client_name}</span>
                          </div>
                          <div style={{ fontSize: 12, color: T.faint, marginTop: 2 }}>
                            {project.title}
                            {project.invoiceNumber && <span style={{ marginLeft: 8, fontFamily: mono }}>{project.job_number}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: project.shipping_route === "stage" ? T.purple : T.accent, padding: "3px 10px", borderRadius: 99, background: project.shipping_route === "stage" ? T.purpleDim : T.accentDim }}>
                            → {project.shipping_route === "stage" ? "Fulfillment" : "Shipping"}
                          </span>
                          <button onClick={() => setModalProject(null)} title="Close (Esc)"
                            style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
                        </div>
                      </div>

                      {/* Body */}
                      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 22px" }}>
                        {project.decoratorGroups
                          .filter(dg => !modalDecoratorKey || dg.decoratorName === modalDecoratorKey)
                          .map(dg => {
                            const decKey = dg.decoratorName;
                            const dgSlips = dg.items.flatMap(it => packingSlips[it.id] || []);
                            const uniqueSlips = dgSlips.filter((s, i, arr) => arr.findIndex(x => x.file_name === s.file_name) === i);
                            const pendingInGroup = dg.items.filter(it => !it.received_at_hpd);
                            return (
                              <div key={decKey}>
                                {/* Decorator header */}
                                <div style={{ paddingBottom: 14, borderBottom: `1px solid ${T.border}`, marginBottom: 14 }}>
                                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <h2 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", color: T.text }}>
                                        {dg.decoratorName}
                                      </h2>
                                      <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>
                                        <strong style={{ color: T.text, fontWeight: 700 }}>{dg.pending}</strong> pending
                                        <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                                        <strong style={{ color: T.text, fontWeight: 700 }}>{dg.received}</strong> received
                                        <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                                        <strong style={{ color: T.text, fontWeight: 700 }}>{dg.totalUnits.toLocaleString()}</strong> units
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Action row — Select all + bulk receive (left) ·
                                    View packing slips (right). Mirrors Production. */}
                                {(() => {
                                  const allSelected = dg.items.length > 0 && dg.items.every(it => selectedItemIds.has(it.id));
                                  // Eligible = selected AND still pending receive.
                                  const eligible = dg.items.filter(it => selectedItemIds.has(it.id) && !it.received_at_hpd);
                                  return (
                                    <div style={{ padding: "0 0 14px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                      <button onClick={() => {
                                        setSelectedItemIds(prev => {
                                          const next = new Set(prev);
                                          if (allSelected) {
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
                                        <button onClick={async () => {
                                          for (const it of eligible) {
                                            await markReceived(it, {
                                              condition: itemCondition[it.id] || "good",
                                              notes: conditionNote[it.id] || "",
                                            });
                                          }
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
                                  {dg.items.map(item => {
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
                                                    onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f, project, item); e.target.value = ""; }} />
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
                                                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                                  background: (item.receiving_data as any)?.condition === "damaged" ? "#3a0a0a"
                                                    : (item.receiving_data as any)?.condition === "partial_damage" ? T.amberDim
                                                    : hasVariance ? T.amberDim : T.greenDim,
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
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

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
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                        background: s.condition === "good" ? T.greenDim : s.condition === "damaged" ? T.redDim : T.amberDim,
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
