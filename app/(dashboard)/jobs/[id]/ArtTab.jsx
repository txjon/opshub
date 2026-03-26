"use client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { buildMockupClient } from "@/lib/mockup-client";

const STAGES = [
  { key: "client_art", label: "Client Art", color: T.muted },
  { key: "vector", label: "Vector / Cleanup", color: T.accent },
  { key: "mockup", label: "Mockup", color: T.purple },
  { key: "proof", label: "Proof", color: T.amber },
  { key: "print_ready", label: "Print-Ready", color: T.green },
];

const APPROVAL_LABELS = {
  none: null,
  pending: { label: "Pending approval", bg: T.amberDim, color: T.amber },
  approved: { label: "Approved", bg: T.greenDim, color: T.green },
  revision_requested: { label: "Revision requested", bg: T.redDim, color: T.red },
};

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function FileCard({ file, onDelete, onApproval }) {
  const approval = APPROVAL_LABELS[file.approval];
  const isImage = file.mime_type?.startsWith("image/");
  const thumbUrl = isImage ? `https://drive.google.com/thumbnail?id=${file.drive_file_id}&sz=w200` : null;

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
      padding: 10, display: "flex", gap: 10, alignItems: "flex-start",
    }}>
      {/* Thumbnail or file type icon */}
      <div style={{
        width: 56, height: 56, borderRadius: 6, overflow: "hidden", flexShrink: 0,
        background: T.card, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={e => { e.target.style.display = "none"; e.target.parentElement.innerHTML = `<span style="font-size:20px;color:${T.faint}">📄</span>`; }} />
        ) : (
          <span style={{ fontSize: 20, color: T.faint }}>📄</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <a href={file.drive_link} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, fontWeight: 600, color: T.accent, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.file_name}
          </a>
          {formatSize(file.file_size) && (
            <span style={{ fontSize: 9, color: T.faint, fontFamily: mono, flexShrink: 0 }}>{formatSize(file.file_size)}</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
          {new Date(file.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {file.notes && <span> · {file.notes}</span>}
        </div>
        {/* Approval status for proofs */}
        {approval && (
          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: approval.bg, color: approval.color }}>
              {approval.label}
            </span>
            {file.approval === "pending" && (
              <>
                <button onClick={() => onApproval(file.id, "approved")}
                  style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green, border: "none", cursor: "pointer" }}>
                  Approve
                </button>
                <button onClick={() => onApproval(file.id, "revision_requested")}
                  style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.redDim, color: T.red, border: "none", cursor: "pointer" }}>
                  Request revision
                </button>
              </>
            )}
            {file.approval === "revision_requested" && (
              <button onClick={() => onApproval(file.id, "pending")}
                style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.amberDim, color: T.amber, border: "none", cursor: "pointer" }}>
                Re-submit
              </button>
            )}
          </div>
        )}
      </div>

      <button onClick={() => onDelete(file)}
        style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11, flexShrink: 0 }}
        onMouseEnter={e => e.currentTarget.style.color = T.red}
        onMouseLeave={e => e.currentTarget.style.color = T.faint}>✕</button>
    </div>
  );
}

function ItemArtSection({ item, clientName, projectTitle, onFilesChanged }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("client_art");
  const [expanded, setExpanded] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadFiles(); }, [item.id]);

  async function loadFiles() {
    const res = await fetch(`/api/files?itemId=${item.id}`);
    const data = await res.json();
    setFiles(data.files || []);
    setLoading(false);
  }

  async function handleUpload(e) {
    const fileList = e.target.files;
    if (!fileList?.length) return;
    setUploading(true);

    for (const file of fileList) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("itemId", item.id);
      fd.append("stage", uploadStage);
      fd.append("clientName", clientName);
      fd.append("projectTitle", projectTitle);
      fd.append("itemName", item.name);

      await fetch("/api/files", { method: "POST", body: fd });
    }

    fileInputRef.current.value = "";
    setUploading(false);
    loadFiles();
  }

  async function handleDelete(file) {
    await fetch("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: file.id, driveFileId: file.drive_file_id }),
    });
    setConfirmDelete(null);
    loadFiles();
  }

  async function handleApproval(fileId, status) {
    await fetch("/api/files", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, approval: status }),
    });
    loadFiles();
  }

  const grouped = STAGES.map(s => ({
    ...s,
    files: files.filter(f => f.stage === s.key),
  }));
  const totalFiles = files.length;
  const pendingProofs = files.filter(f => f.stage === "proof" && f.approval === "pending").length;
  const hasPrintReady = files.some(f => f.stage === "print_ready");

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      {/* Item header */}
      <div onClick={() => setExpanded(!expanded)}
        style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <span style={{
          width: 22, height: 22, borderRadius: 5, background: T.accentDim,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0,
        }}>
          {String.fromCharCode(65 + (item._index || 0))}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
          <div style={{ fontSize: 10, color: T.muted }}>{[item.blank_vendor, item.color].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {totalFiles > 0 && (
            <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>{totalFiles} file{totalFiles !== 1 ? "s" : ""}</span>
          )}
          {pendingProofs > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.amberDim, color: T.amber }}>
              {pendingProofs} pending
            </span>
          )}
          {hasPrintReady && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>
              Print-ready
            </span>
          )}
          <span style={{ fontSize: 12, color: T.muted }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "12px 14px" }}>
          {/* Upload bar */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <select value={uploadStage} onChange={e => setUploadStage(e.target.value)}
              style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontFamily: font, fontSize: 11, padding: "5px 8px", outline: "none" }}>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              style={{ background: T.accent, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontFamily: font, fontWeight: 600, padding: "5px 14px", cursor: "pointer", opacity: uploading ? 0.6 : 1 }}>
              {uploading ? "Uploading..." : "Upload files"}
            </button>
            <input ref={fileInputRef} type="file" multiple onChange={handleUpload} style={{ display: "none" }} />
            {uploading && <span style={{ fontSize: 10, color: T.amber }}>Pushing to Google Drive...</span>}
          </div>

          {/* File list by stage */}
          {loading ? (
            <div style={{ fontSize: 12, color: T.muted, padding: "12px 0" }}>Loading files...</div>
          ) : totalFiles === 0 ? (
            <div style={{ fontSize: 12, color: T.faint, padding: "12px 0" }}>No files yet — select a stage and upload.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {grouped.filter(g => g.files.length > 0).map(g => (
                <div key={g.key}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                    {g.label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {g.files.map(f => (
                      <FileCard key={f.id} file={f}
                        onDelete={file => setConfirmDelete(file)}
                        onApproval={handleApproval}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Mockup generator */}
          <MockupDropZone item={item} clientName={clientName} projectTitle={projectTitle} onFilesChanged={loadFiles} />
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete file"
        message={confirmDelete ? `Delete "${confirmDelete.file_name}"? This will also remove it from Google Drive.` : ""}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function MockupDropZone({ item, clientName, projectTitle, onFilesChanged }) {
  const [mockupData, setMockupData] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [dragover, setDragover] = useState(false);
  const mockupInputRef = useRef(null);

  async function processFile(file) {
    if (!file || !file.name.endsWith(".psd")) return;
    setGenerating(true);
    setError(null);
    setMockupData(null);
    setSaved(false);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const { mockupBase64, blob, printInfo } = await buildMockupClient(arrayBuffer);
      setMockupData({ mockup: mockupBase64, mockupBlob: blob, printInfo });
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveToDrive() {
    if (!mockupData) return;
    setSaving(true);
    setError(null);

    try {
      // Upload mockup PNG
      const fd1 = new FormData();
      fd1.append("file", new File([mockupData.mockupBlob], `${item.name || "Item"} — Mockup.png`, { type: "image/png" }));
      fd1.append("itemId", item.id);
      fd1.append("stage", "mockup");
      fd1.append("clientName", clientName);
      fd1.append("projectTitle", projectTitle);
      fd1.append("itemName", item.name || "");
      const res = await fetch("/api/files", { method: "POST", body: fd1 });
      if (!res.ok) throw new Error("Failed to save mockup");

      // Generate proof PDF on demand then upload
      const pdfRes = await fetch("/api/mockup/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mockupBase64: mockupData.mockup,
          printInfo: mockupData.printInfo,
          clientName,
          itemName: item.name || "",
          blankVendor: item.blank_vendor || "",
          blankStyle: item.sku || "",
          blankColor: item.color || "",
          decoratorName: item.decorator || "",
        }),
      });
      if (!pdfRes.ok) throw new Error("Failed to generate proof PDF");
      const pdfBlob = await pdfRes.blob();

      const fd2 = new FormData();
      fd2.append("file", new File([pdfBlob], `${item.name || "Item"} — Print Proof.pdf`, { type: "application/pdf" }));
      fd2.append("itemId", item.id);
      fd2.append("stage", "proof");
      fd2.append("clientName", clientName);
      fd2.append("projectTitle", projectTitle);
      fd2.append("itemName", item.name || "");
      const res2 = await fetch("/api/files", { method: "POST", body: fd2 });
      if (!res2.ok) throw new Error("Failed to save proof");

      setSaved(true);
      if (onFilesChanged) onFilesChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    if (!mockupData) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/mockup/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mockupBase64: mockupData.mockup,
          printInfo: mockupData.printInfo,
          clientName,
          itemName: item.name || "",
          blankVendor: item.blank_vendor || "",
          blankStyle: item.sku || "",
          blankColor: item.color || "",
          decoratorName: item.decorator || "",
        }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.name || "Item"} — Print Proof.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  return (
    <div style={{ marginTop: 8 }}>
      {!mockupData && !generating && (
        <div
          onDragOver={e => { e.preventDefault(); setDragover(true); }}
          onDragLeave={() => setDragover(false)}
          onDrop={handleDrop}
          onClick={() => mockupInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragover ? T.accent : T.border}`,
            borderRadius: 8, padding: "16px 12px", textAlign: "center", cursor: "pointer",
            background: dragover ? T.accentDim : "transparent",
            transition: "all 0.15s",
          }}
        >
          <div style={{ fontSize: 11, color: T.muted }}>Drop .psd to generate mockup & proof</div>
          <input ref={mockupInputRef} type="file" accept=".psd" onChange={e => { processFile(e.target.files?.[0]); e.target.value = ""; }} style={{ display: "none" }} />
        </div>
      )}

      {generating && (
        <div style={{ textAlign: "center", padding: "14px 0", fontSize: 11, color: T.muted }}>
          Generating mockup & proof...
        </div>
      )}

      {error && (
        <div style={{ padding: 10, background: T.redDim, borderRadius: 8, fontSize: 11, color: T.red, marginTop: 6 }}>
          {error}
        </div>
      )}

      {mockupData && (
        <div style={{ marginTop: 4 }}>
          <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, textAlign: "center", marginBottom: 8 }}>
            <img
              src={`data:image/png;base64,${mockupData.mockup}`}
              alt="Mockup"
              style={{ maxWidth: "100%", height: "auto", borderRadius: 4 }}
            />
          </div>

          {/* Print info */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {mockupData.printInfo.map((p, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "6px 10px", background: T.surface, borderRadius: 6,
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{p.placement}</div>
                  <div style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>{p.widthInches}" x {p.heightInches}"</div>
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {p.colors.map((c, j) => {
                    const isLight = isLightColor(c.hex);
                    return (
                      <span key={j} style={{
                        fontSize: 9, padding: "2px 8px", borderRadius: 20,
                        background: c.hex, color: isLight ? "#222" : "#fff",
                        display: "flex", alignItems: "center", gap: 4,
                        border: isLight ? "1px solid #ccc" : "none",
                      }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: "50%", background: c.hex,
                          border: `1.5px solid ${isLight ? "#aaa" : "rgba(255,255,255,0.4)"}`,
                          flexShrink: 0,
                        }} />
                        {c.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={downloadPdf} disabled={downloading} style={{
              background: T.accent, border: "none", borderRadius: 6, color: "#fff",
              fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 14px",
              cursor: downloading ? "default" : "pointer", opacity: downloading ? 0.6 : 1,
            }}>
              {downloading ? "Generating PDF..." : "Download PDF"}
            </button>
            <button onClick={handleSaveToDrive} disabled={saving || saved} style={{
              background: saved ? T.greenDim : T.surface, border: `1px solid ${saved ? T.green : T.border}`,
              borderRadius: 6, color: saved ? T.green : T.text,
              fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 14px",
              cursor: saving || saved ? "default" : "pointer", opacity: saving ? 0.6 : 1,
            }}>
              {saved ? "Saved to Drive" : saving ? "Saving..." : "Save to Drive"}
            </button>
            <button onClick={() => { setMockupData(null); setError(null); setSaved(false); }} style={{
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.muted, fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 14px", cursor: "pointer",
            }}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function isLightColor(hex) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

export function ArtTab({ project, items }) {
  const clientName = project?.clients?.name || "Unknown Client";
  const projectTitle = project?.title || "Untitled Project";
  const sorted = [...items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  if (!items.length) {
    return (
      <div style={{ fontFamily: font, color: T.faint, fontSize: 13, padding: "20px 0" }}>
        No items yet — add items in the Buy Sheet first.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>
        Files are uploaded to Google Drive: <span style={{ fontFamily: mono, color: T.faint }}>OpsHub Files / {clientName} / {projectTitle}</span>
      </div>
      {sorted.map((item, i) => (
        <ItemArtSection key={item.id} item={{ ...item, _index: i }} clientName={clientName} projectTitle={projectTitle} />
      ))}
    </div>
  );
}
