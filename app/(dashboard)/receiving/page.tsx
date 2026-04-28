"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty } from "@/lib/use-warehouse";
import { uploadToReceiving, uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { DriveFileLink } from "@/components/DriveFileLink";

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

export default function ReceivingPage() {
  const { loading, incoming, updateReceivedQty, markReceived, undoReceived, returnToProduction } = useWarehouse();
  const supabase = createClient();

  const [outsideShipments, setOutsideShipments] = useState<OutsideShipment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ carrier: "", tracking: "", sender: "", description: "", condition: "good", notes: "" });
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<{ id: string; title: string; client_name: string; job_number: string }[]>([]);
  const [tab, setTab] = useState<"production" | "outside">("production");
  const [conditionNote, setConditionNote] = useState<Record<string, string>>({});
  const [itemCondition, setItemCondition] = useState<Record<string, string>>({});
  // Collapsed-by-default decorator groups, mirroring the Production
  // page pattern. Click the header bar to expand. Key = jobId-decName.
  const [expandedDecorators, setExpandedDecorators] = useState<Set<string>>(new Set());
  const toggleDecorator = (key: string) => {
    setExpandedDecorators(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const [packingSlips, setPackingSlips] = useState<Record<string, { file_name: string; drive_link: string; drive_file_id: string | null; mime_type: string | null }[]>>({});
  const [receivingPhotos, setReceivingPhotos] = useState<Record<string, { file_name: string; drive_link: string; drive_file_id: string | null; mime_type: string | null }[]>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  const [viewingSlips, setViewingSlips] = useState<{ files: { file_name: string; drive_link: string }[]; index: number; title: string } | null>(null);
  const photoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    loadOutside();
    loadJobs();
  }, []);

  // Load packing slips + receiving photos when incoming data is available
  useEffect(() => {
    if (incoming.length === 0) return;
    const itemIds = incoming.flatMap(j => j.items.map(it => it.id));
    if (itemIds.length === 0) return;
    supabase.from("item_files").select("item_id, file_name, drive_link, drive_file_id, mime_type, stage")
      .in("stage", ["packing_slip", "receiving_photo"])
      .in("item_id", itemIds)
      .then(({ data }) => {
        type F = { file_name: string; drive_link: string; drive_file_id: string | null; mime_type: string | null };
        const slips: Record<string, F[]> = {};
        const photos: Record<string, F[]> = {};
        for (const f of (data || [])) {
          const target = f.stage === "packing_slip" ? slips : photos;
          if (!target[f.item_id]) target[f.item_id] = [];
          target[f.item_id].push({ file_name: f.file_name, drive_link: f.drive_link, drive_file_id: f.drive_file_id, mime_type: f.mime_type });
        }
        setPackingSlips(slips);
        setReceivingPhotos(photos);
      });
  }, [incoming]);

  async function loadOutside() {
    const { data } = await supabase
      .from("outside_shipments")
      .select("*")
      .eq("resolved", false)
      .order("received_at", { ascending: false });
    setOutsideShipments(data || []);
  }

  async function loadJobs() {
    const { data } = await supabase
      .from("jobs")
      .select("id, title, job_number, type_meta, clients(name)")
      .not("phase", "in", '("complete","cancelled")')
      .order("created_at", { ascending: false })
      .limit(50);
    setJobs((data || []).map((j: any) => ({ id: j.id, title: j.title, client_name: j.clients?.name || "", job_number: j.job_number, display_number: j.type_meta?.qb_invoice_number || j.job_number })));
  }

  async function submitOutside() {
    if (!form.description.trim()) return;
    setSaving(true);

    // Upload files to Drive if any
    const uploadedFiles: { name: string; driveLink: string; driveFileId: string }[] = [];
    let driveFolderLink = null;

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
        } catch (err) {
          console.error("Upload error:", err);
        }
      }
      setUploadStatus("");
    }

    await supabase.from("outside_shipments").insert({
      carrier: form.carrier || null,
      tracking: form.tracking || null,
      sender: form.sender || null,
      description: form.description,
      condition: form.condition,
      notes: form.notes || null,
      files: uploadedFiles.length > 0 ? uploadedFiles : [],
      drive_folder_link: driveFolderLink,
    });

    setForm({ carrier: "", tracking: "", sender: "", description: "", condition: "good", notes: "" });
    setPendingFiles([]);
    setShowForm(false);
    setSaving(false);
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

  async function handlePhotoUpload(file: File, job: any, item: any) {
    setUploadingPhoto(item.id);
    try {
      const result = await uploadToDrive({
        blob: file, fileName: file.name, mimeType: file.type || "image/jpeg",
        clientName: job.client_name, projectTitle: job.title, itemName: item.name,
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
    } catch (err) {
      console.error("Photo upload error:", err);
    }
    setUploadingPhoto(null);
  }

  // Stats
  const expectedCount = incoming.reduce((a, j) => a + j.items.filter(it => !it.received_at_hpd).length, 0);
  const overdueItems = incoming.reduce((a, j) => {
    return a + j.items.filter(it => {
      if (it.received_at_hpd || !it.ship_tracking) return false;
      // No ship date tracked, so just count items with tracking but not received
      return true;
    }).length;
  }, 0);
  const receivedToday = incoming.reduce((a, j) => {
    return a + j.items.filter(it => {
      if (!it.received_at_hpd || !it.received_at_hpd_at) return false;
      return new Date(it.received_at_hpd_at).toDateString() === new Date().toDateString();
    }).length;
  }, 0);
  const unroutedOutside = outsideShipments.filter(s => !s.job_id).length;

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "7px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Compact page header — title + inline stats + tabs in one row.
          The big stacked H1 / stats / tabs trio was eating 150px before
          any content showed; this fits all of it in ~60px. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Receiving</h1>
        <div style={{ display: "flex", gap: 14, alignItems: "baseline", fontSize: 11 }}>
          <span style={{ color: T.muted }}>Expected <strong style={{ color: T.accent, fontFamily: mono, fontSize: 13 }}>{expectedCount}</strong></span>
          <span style={{ color: T.muted }}>Received today <strong style={{ color: T.green, fontFamily: mono, fontSize: 13 }}>{receivedToday}</strong></span>
          {unroutedOutside > 0 && <span style={{ color: T.muted }}>Unrouted <strong style={{ color: T.amber, fontFamily: mono, fontSize: 13 }}>{unroutedOutside}</strong></span>}
        </div>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto", padding: 3, background: T.surface, borderRadius: 6 }}>
          {([
            { id: "production" as const, label: "From Production", count: expectedCount },
            { id: "outside" as const, label: "Outside", count: outsideShipments.length },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "5px 12px", borderRadius: 4, border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 600, fontFamily: font,
                display: "flex", alignItems: "center", gap: 5,
                background: tab === t.id ? T.accent : "transparent",
                color: tab === t.id ? "#fff" : T.muted,
              }}>
              {t.label}
              {t.count > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, opacity: 0.85 }}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── PRODUCTION RETURNS ── */}
      {tab === "production" && (
        incoming.length === 0 ? (
          <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
            No incoming items. Items appear here when shipped from decorator.
          </div>
        ) : (
          incoming.map(job => (
            <div key={job.id} style={card}>
              <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
                <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
                <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.display_number}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button onClick={async () => {
                    for (const it of job.items) await returnToProduction(it);
                  }} style={{ fontSize: 10, padding: "4px 12px", borderRadius: 4, background: "none", color: T.amber, border: `1px solid ${T.amber}44`, cursor: "pointer" }}>
                    ← Return All
                  </button>
                  {job.items.some(it => !it.received_at_hpd) && (
                    <button onClick={async () => {
                      for (const it of job.items.filter(i => !i.received_at_hpd)) {
                        await markReceived(it, {
                          condition: itemCondition[it.id] || "good",
                          notes: conditionNote[it.id] || "",
                        });
                      }
                    }} style={{ fontSize: 10, fontWeight: 600, padding: "4px 12px", borderRadius: 4, background: T.green, color: "#fff", border: "none", cursor: "pointer" }}>
                      Receive All
                    </button>
                  )}
                </div>
                <span style={{ marginLeft: job.items.some(it => !it.received_at_hpd) ? 0 : "auto", fontSize: 10, padding: "2px 8px", borderRadius: 99,
                  background: job.shipping_route === "stage" ? T.purpleDim : T.accentDim,
                  color: job.shipping_route === "stage" ? T.purple : T.accent }}>
                  {job.shipping_route === "stage" ? "→ Fulfillment" : "→ Shipping"}
                </span>
              </div>
              {/* Packing slips from production */}
              {(() => {
                const jobSlips = job.items.flatMap(it => (packingSlips[it.id] || []).map(s => s));
                const unique = jobSlips.filter((s, i, arr) => arr.findIndex(x => x.file_name === s.file_name) === i);
                if (unique.length === 0) return null;
                return (
                  <div style={{ padding: "6px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => setViewingSlips({ files: unique, index: 0, title: job.client_name })}
                      style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: T.accentDim, color: T.accent, border: "none", cursor: "pointer", fontWeight: 600, fontFamily: font }}>
                      View packing slips ({unique.length})
                    </button>
                  </div>
                );
              })()}

              {/* Items grouped by decorator (mirrors Production page) so
                  it's clear which vendor's shipment you're receiving. If
                  every item is from one decorator, the sub-header still
                  shows their name as a useful at-a-glance reference. */}
              {(() => {
                const groups = new Map<string, { name: string; shortCode: string | null; items: typeof job.items }>();
                for (const it of job.items) {
                  const key = it.decorator_name || "Unassigned";
                  if (!groups.has(key)) groups.set(key, { name: key, shortCode: it.decorator_short_code || null, items: [] });
                  groups.get(key)!.items.push(it);
                }
                const groupArr = Array.from(groups.values());
                return groupArr.map((group, gi) => {
                  const decKey = `${job.id}-${group.name}`;
                  const isExpanded = expandedDecorators.has(decKey);
                  const receivedCount = group.items.filter(it => it.received_at_hpd).length;
                  const pendingCount = group.items.length - receivedCount;
                  return (
                  <div key={group.name} style={{ borderTop: gi === 0 ? "none" : `1px solid ${T.border}` }}>
                    {/* Decorator header — click to toggle */}
                    <div onClick={() => toggleDecorator(decKey)}
                      style={{ padding: "8px 12px", background: T.surface, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <span style={{ fontSize: 10, color: T.faint, transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block", width: 10 }}>▶</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>From</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{group.name}</span>
                      {group.shortCode && <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>· {group.shortCode}</span>}
                      <span style={{ fontSize: 10, color: T.muted }}>· {group.items.length} item{group.items.length !== 1 ? "s" : ""}</span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 10, fontWeight: 700 }}>
                        {pendingCount > 0 && <span style={{ color: T.amber }}>{pendingCount} pending</span>}
                        {receivedCount > 0 && <span style={{ color: T.green }}>{receivedCount} received</span>}
                      </div>
                    </div>
                    {isExpanded && (
                    <div style={{ padding: "6px 12px" }}>
                      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                            {["Item", "Tracking", "Shipped → Received", "Condition", ""].map(h =>
                              <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item, i) => {
                      const shippedQty = tQty(item.ship_qtys);
                      const totalQty = tQty(item.qtys);
                      const receivedTotal = tQty(item.received_qtys);
                      const hasVariance = item.received_at_hpd && receivedTotal > 0 && receivedTotal !== (shippedQty ?? totalQty);
                      return (
                        <tr key={item.id} style={{ borderBottom: i < job.items.length - 1 ? `1px solid ${T.border}` : "none", verticalAlign: "top" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: T.purple, fontFamily: mono, marginRight: 6 }}>{item.letter}</span>{item.name}
                            <div style={{ fontSize: 10, color: T.faint, fontWeight: 400 }}>{[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ")}</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3, alignItems: "center" }}>
                              {(receivingPhotos[item.id] || []).map((p, pi) => (
                                <DriveFileLink key={pi} driveFileId={p.drive_file_id} fileName={p.file_name} mimeType={p.mime_type}
                                  style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: T.surface, color: T.muted }}>
                                  {p.file_name}
                                </DriveFileLink>
                              ))}
                              {uploadingPhoto === item.id ? (
                                <span style={{ fontSize: 9, color: T.accent }}>Uploading...</span>
                              ) : (
                                <>
                                  <button onClick={() => photoInputRefs.current[item.id]?.click()}
                                    style={{ fontSize: 9, color: T.faint, background: "none", border: `1px dashed ${T.border}`, borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>
                                    + Photo
                                  </button>
                                  <input ref={el => { photoInputRefs.current[item.id] = el; }} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                                    onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f, job, item); e.target.value = ""; }} />
                                </>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>{item.ship_tracking || "—"}</div>
                            {item.ship_notes && <div style={{ fontSize: 10, color: T.amber, marginTop: 2 }}>{item.ship_notes}</div>}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {/* Horizontal compact size grid:
                                S 99 → [99]  M 347 → [347]  …
                                Each size in one row instead of stacked
                                vertically saves ~30px per item. */}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              {item.sizes.map(sz => {
                                const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                                const received = item.received_qtys?.[sz] ?? shipped;
                                const mismatch = item.received_at_hpd && received !== shipped;
                                return (
                                  <div key={sz} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: mono, fontSize: 10 }}>
                                    <span style={{ color: T.faint, fontWeight: 600 }}>{sz}</span>
                                    <span style={{ color: T.muted }}>{shipped}</span>
                                    <span style={{ color: T.faint }}>→</span>
                                    <input type="number" min="0" value={received}
                                      onChange={e => updateReceivedQty(item, sz, parseInt(e.target.value) || 0)}
                                      onFocus={e => e.target.select()}
                                      style={{ width: 38, textAlign: "center", padding: "2px 3px", border: `1px solid ${mismatch ? T.red : T.border}`, borderRadius: 3, background: T.surface, color: mismatch ? T.red : T.text, fontSize: 10, fontFamily: mono, outline: "none" }} />
                                  </div>
                                );
                              })}
                            </div>
                            {hasVariance && <div style={{ fontSize: 9, color: T.red, marginTop: 3 }}>Variance: {receivedTotal - (shippedQty ?? totalQty)} units</div>}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {item.received_at_hpd ? (
                              <div>
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
                                  <div style={{ fontSize: 9, color: T.muted, marginTop: 3, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }} title={(item.receiving_data as any).notes}>
                                    {(item.receiving_data as any).notes}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                <select
                                  value={itemCondition[item.id] || "good"}
                                  onChange={e => setItemCondition(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  style={{ ...ic, width: 110, fontSize: 10, padding: "3px 6px" }}
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
                                    ...ic, width: 110, fontSize: 10, padding: "3px 6px",
                                    borderColor: itemCondition[item.id] && itemCondition[item.id] !== "good" ? T.amber : T.border,
                                  }}
                                />
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                              {item.received_at_hpd ? (
                                <>
                                  <button onClick={() => undoReceived(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>Undo</button>
                                  <button onClick={() => returnToProduction(item)} style={{ fontSize: 10, color: T.amber, background: "none", border: `1px solid ${T.amber}44`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }} title="Send back to decorator">← Production</button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => returnToProduction(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }} title="Send back to decorator">← Production</button>
                                  <button onClick={() => markReceived(item, {
                                    condition: itemCondition[item.id] || "good",
                                    notes: conditionNote[item.id] || "",
                                  })} style={{ fontSize: 10, fontWeight: 600, color: "#fff", background: T.green, border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}>Receive</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </div>
                  );
                });
              })()}
            </div>
          ))
        )
      )}

      {/* ── OUTSIDE SHIPMENTS ── */}
      {tab === "outside" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Add button */}
          <button onClick={() => setShowForm(!showForm)}
            style={{ alignSelf: "flex-start", padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: font }}>
            + Log Incoming Shipment
          </button>

          {/* Intake form */}
          {showForm && (
            <div style={{ ...card, padding: "16px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>New Outside Shipment</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Carrier</label>
                  <input style={ic} value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} placeholder="UPS, FedEx, USPS..." />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Tracking #</label>
                  <input style={{ ...ic, fontFamily: mono }} value={form.tracking} onChange={e => setForm(f => ({ ...f, tracking: e.target.value }))} placeholder="Tracking number" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Sender</label>
                  <input style={ic} value={form.sender} onChange={e => setForm(f => ({ ...f, sender: e.target.value }))} placeholder="Who sent it?" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Condition</label>
                  <select style={ic} value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                    <option value="good">Good</option>
                    <option value="damaged">Damaged</option>
                    <option value="partial">Partial</option>
                    <option value="wrong_item">Wrong Item</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Description *</label>
                <input style={ic} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What is it? e.g. Client samples, return from Nike, supplies box" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
                <input style={ic} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional details" />
              </div>

              {/* File upload */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Photos / Documents</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; setPendingFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
                  style={{
                    border: `2px dashed ${T.border}`, borderRadius: 8, padding: "12px 16px",
                    textAlign: "center", cursor: "pointer", transition: "border-color 0.15s",
                  }}>
                  <div style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>Drop files or click to browse</div>
                  <div style={{ fontSize: 9, color: T.faint, marginTop: 2 }}>Photos of packaging, packing slips, damage, etc.</div>
                </div>
                <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
                  onChange={e => { setPendingFiles(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
                {pendingFiles.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {pendingFiles.map((f, i) => (
                      <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: T.surface, color: T.muted, display: "flex", alignItems: "center", gap: 4 }}>
                        {f.name}
                        <button onClick={e => { e.stopPropagation(); setPendingFiles(prev => prev.filter((_, j) => j !== i)); }}
                          style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 10, padding: 0 }}>x</button>
                      </span>
                    ))}
                  </div>
                )}
                {uploadStatus && <div style={{ fontSize: 10, color: T.accent, marginTop: 4 }}>{uploadStatus}</div>}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={submitOutside} disabled={saving || !form.description.trim()}
                  style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600, opacity: saving || !form.description.trim() ? 0.5 : 1 }}>
                  {saving ? (uploadStatus || "Saving...") : "Log Shipment"}
                </button>
                <button onClick={() => setShowForm(false)}
                  style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 12 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Outside shipments list */}
          {outsideShipments.length === 0 && !showForm ? (
            <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
              No outside shipments logged. Use the button above to log incoming packages not tied to a project.
            </div>
          ) : (
            outsideShipments.map(s => (
              <div key={s.id} style={{ ...card, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{s.description}</div>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: T.muted, flexWrap: "wrap" }}>
                      {s.sender && <span>From: {s.sender}</span>}
                      {s.carrier && <span>{s.carrier}</span>}
                      {s.tracking && <span style={{ fontFamily: mono }}>{s.tracking}</span>}
                      <span>{new Date(s.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    {s.notes && <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>{s.notes}</div>}
                    {s.files?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                        {s.files.map((f, i) => (
                          <DriveFileLink key={i} driveFileId={f.driveFileId} fileName={f.name}
                            style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: T.accentDim, color: T.accent }}>
                            {f.name}
                          </DriveFileLink>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                        background: s.condition === "good" ? T.greenDim : s.condition === "damaged" ? T.redDim : T.amberDim,
                        color: s.condition === "good" ? T.green : s.condition === "damaged" ? T.red : T.amber,
                      }}>
                        {s.condition === "good" ? "Good" : s.condition === "damaged" ? "Damaged" : s.condition === "partial" ? "Partial" : "Wrong Item"}
                      </span>
                      {s.job_id ? (
                        <span style={{ fontSize: 10, color: T.accent }}>
                          Linked to project
                        </span>
                      ) : (
                        <select
                          onChange={e => { if (e.target.value) linkToJob(s.id, e.target.value); }}
                          value=""
                          style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.surface, color: T.muted, cursor: "pointer" }}>
                          <option value="">Link to project...</option>
                          {jobs.map(j => (
                            <option key={j.id} value={j.id}>{j.client_name} — {j.title}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => routeShipment(s.id, "ship_through")}
                      style={{ fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", background: T.blue, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>
                      → Ship-through
                    </button>
                    <button onClick={() => routeShipment(s.id, "stage")}
                      style={{ fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", background: T.purple, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}>
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
                <span style={{ fontSize: 14, fontWeight: 700 }}>{viewingSlips.title} — Packing Slips</span>
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
