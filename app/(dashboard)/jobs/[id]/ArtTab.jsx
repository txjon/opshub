"use client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { buildMockupClient, preloadTemplate } from "@/lib/mockup-client";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { generateProofPdfClient, preloadLogo } from "@/lib/proof-client";
import { logJobActivity } from "@/components/JobActivityPanel";
import { SendEmailDialog } from "@/components/SendEmailDialog";

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

function FileCard({ file, onDelete, onApproval, onSendToClient, stageLabel, stageColor }) {
  const approval = APPROVAL_LABELS[file.approval];
  const isImage = file.mime_type?.startsWith("image/");
  const thumbUrl = isImage ? `https://drive.google.com/thumbnail?id=${file.drive_file_id}&sz=w200` : null;

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
      padding: 8, display: "flex", gap: 8, alignItems: "flex-start", overflow: "hidden",
    }}>
      {/* Thumbnail or file type icon */}
      <div style={{
        width: 48, height: 48, borderRadius: 6, overflow: "hidden", flexShrink: 0,
        background: T.card, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={e => { e.target.style.display = "none"; e.target.parentElement.innerHTML = `<span style="font-size:18px;color:${T.faint}">📄</span>`; }} />
        ) : (
          <span style={{ fontSize: 18, color: T.faint }}>📄</span>
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
        <div style={{ fontSize: 10, color: T.muted, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
          {stageLabel && (
            <span style={{ fontSize: 8, fontWeight: 700, color: stageColor || T.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{stageLabel}</span>
          )}
          <span>{new Date(file.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          {file.notes && <span> · {file.notes}</span>}
        </div>
        {/* Approval status for proofs */}
        {false && approval && (
          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: approval.bg, color: approval.color }}>
              {approval.label}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        {(file.stage === "proof" || file.stage === "mockup") && onSendToClient && (
          <button onClick={() => onSendToClient(file)}
            style={{ fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.purpleDim || "#2d1f5e", color: T.purple, border: "none", cursor: "pointer" }}>
            Send
          </button>
        )}
        <button onClick={() => onDelete(file)}
          style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11 }}
          onMouseEnter={e => e.currentTarget.style.color = T.red}
          onMouseLeave={e => e.currentTarget.style.color = T.faint}>✕</button>
      </div>
    </div>
  );
}

function ItemArtSection({ item, clientName, projectTitle, contacts, jobId, onFilesChanged, onUpdateItem }) {
  const [files, setFiles] = useState([]);
  const [sendingFile, setSendingFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("client_art");
  const [expanded, setExpanded] = useState(() => {
    try { const v = localStorage.getItem(`art-exp-${item.id}`); return v !== null ? v === "1" : true; } catch { return true; }
  });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadFiles(); }, [item.id]);

  async function loadFiles() {
    const res = await fetch(`/api/files?itemId=${item.id}`);
    const data = await res.json();
    const fileList = data.files || [];
    setFiles(fileList);
    setLoading(false);
    if (onUpdateItem) onUpdateItem(item.id, { hasFiles: fileList.length > 0 });
  }

  async function handleUpload(e) {
    const fileList = e.target.files;
    if (!fileList?.length) return;
    setUploading(true);

    try {
      for (const file of fileList) {
        const driveFile = await uploadToDrive({
          blob: file,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          clientName,
          projectTitle,
          itemName: item.name,
        });
        await registerFileInDb({
          ...driveFile,
          itemId: item.id,
          stage: uploadStage,
        });
      }
      const stageLabel = STAGES.find(s=>s.key===uploadStage)?.label || uploadStage;
      logJobActivity(item.job_id, `${fileList.length} file${fileList.length>1?"s":""} uploaded to ${item.name} (${stageLabel})`);
    } catch (err) {
      console.error("Upload error:", err);
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
  const pendingProofs = item.artwork_status === "approved" ? 0 : files.filter(f => f.stage === "proof" && f.approval === "pending").length;
  const hasPrintReady = files.some(f => f.stage === "print_ready");

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      {/* Item header */}
      <div onClick={() => { const next = !expanded; setExpanded(next); try { localStorage.setItem(`art-exp-${item.id}`, next ? "1" : "0"); } catch {} }}
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
          <div style={{ fontSize: 10, color: T.muted }}>{[item.blank_vendor, item.blank_sku || item.color].filter(Boolean).join(" · ")}</div>
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
          {item.artwork_status === "approved" && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>
              Proof Approved
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

          {/* File list — flat grid, stage badge on each card */}
          {loading ? (
            <div style={{ fontSize: 12, color: T.muted, padding: "12px 0" }}>Loading files...</div>
          ) : totalFiles === 0 ? (
            <div style={{ fontSize: 12, color: T.faint, padding: "12px 0" }}>No files yet — select a stage and upload.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {files.map(f => {
                const stage = STAGES.find(s => s.key === f.stage);
                return (
                  <FileCard key={f.id} file={f} stageLabel={stage?.label} stageColor={stage?.color}
                    onDelete={file => setConfirmDelete(file)}
                    onApproval={handleApproval}
                    onSendToClient={file => setSendingFile(file)}
                  />
                );
              })}
            </div>
          )}

          {/* Mockup generator */}
          <MockupDropZone item={item} clientName={clientName} projectTitle={projectTitle} onFilesChanged={loadFiles} onUpdateItem={onUpdateItem} />
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

      {sendingFile && (
        <div style={{ marginTop: 8 }}>
          <SendEmailDialog
            type="proof_link"
            jobId={item.job_id}
            contacts={(contacts || []).map(c => ({ name: c.name || "", email: c.email || "" }))}
            defaultEmail={(contacts || []).find(c => c.role_on_job === "primary")?.email || ""}
            defaultSubject={`${sendingFile.stage === "proof" ? "Proof" : "Mockup"} for Review — ${item.name} · ${clientName}`}
            customBody={`<p>Please review the attached ${sendingFile.stage === "proof" ? "proof" : "mockup"} for <strong>${item.name}</strong>.</p><p><a href="${sendingFile.drive_link}">View file in Google Drive</a></p><p>Let us know if you'd like any revisions.</p><p>Best,<br/>House Party Distro</p>`}
            onClose={() => setSendingFile(null)}
            onSent={() => { logJobActivity(item.job_id, `${sendingFile.stage === "proof" ? "Proof" : "Mockup"} sent to client for ${item.name}`); setSendingFile(null); }}
          />
        </div>
      )}
    </div>
  );
}

function MockupDropZone({ item, clientName, projectTitle, onFilesChanged, onUpdateItem }) {
  useEffect(() => { preloadLogo(); preloadTemplate(); }, []);
  const [mode, setMode] = useState(null); // null | "auto" | "manual"
  const [mockupData, setMockupData] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [dragover, setDragover] = useState(false);
  const [fileName, setFileName] = useState("");
  const mockupInputRef = useRef(null);
  const manualMockupRef = useRef(null);
  const manualPsdRef = useRef(null);
  const [manualMockupFile, setManualMockupFile] = useState(null);
  const [manualMockupPreview, setManualMockupPreview] = useState(null);
  const [manualPsdFile, setManualPsdFile] = useState(null);
  const [manualPrintInfo, setManualPrintInfo] = useState(null);

  // ── Auto mode: PSD → mockup + proof ──────────────────────────
  async function processFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".psd")) {
      setError("Only .psd files are supported. Drop a Photoshop file.");
      return;
    }
    setMode("auto");
    setFileName(file.name);
    setGenerating(true);
    setError(null);
    setMockupData(null);
    setSaved(false);

    try {
      setGenStatus("Reading PSD...");
      const arrayBuffer = await file.arrayBuffer();
      setGenStatus("Building mockup...");
      const result = await buildMockupClient(arrayBuffer);
      setGenStatus("Done");
      setMockupData({ mockup: result.mockupBase64, dataUrl: result.dataUrl, uploadDataUrl: result.uploadDataUrl, printInfo: result.printInfo, psdFile: file });
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
      setGenStatus("");
    }
  }

  // ── Manual mode: upload mockup image + PSD separately ────────
  function handleManualMockup(file) {
    if (!file || !file.type.startsWith("image/")) { setError("Please upload an image file (JPG, PNG)"); return; }
    setManualMockupFile(file);
    const reader = new FileReader();
    reader.onload = e => setManualMockupPreview(e.target.result);
    reader.readAsDataURL(file);
  }

  async function handleManualPsd(file) {
    if (!file || !file.name.toLowerCase().endsWith(".psd")) { setError("Please upload a .psd file"); return; }
    setManualPsdFile(file);
    setError(null);
    try {
      setGenStatus("Reading PSD print data...");
      setGenerating(true);
      const { readPsd } = await import("ag-psd");
      const arrayBuffer = await file.arrayBuffer();
      const psd = readPsd(new Uint8Array(arrayBuffer));
      // Extract print info from PSD groups (same logic as mockup-client)
      const PLACEMENT_MAP = { 'Front':'Full Front','Full Front':'Full Front','Back':'Full Back','Full Back':'Full Back','Left Chest':'Left Chest' };
      const SKIP_GROUPS = ['Shirt Color', 'Shadows', 'Highlights', 'Mask'];
      const printInfo = [];
      const groups = [...(psd.children || [])].reverse();
      for (const group of groups) {
        if (!group.children) continue;
        if (SKIP_GROUPS.includes(group.name)) continue;
        const zoneName = PLACEMENT_MAP[group.name];
        const isTag = group.name.toLowerCase() === "tag" || group.name.toLowerCase() === "tags";
        const colors = [];
        let minL=Infinity, minT=Infinity, maxR=-Infinity, maxB=-Infinity;
        for (const layer of group.children) {
          if (isTag) {
            if (minL === Infinity) { minL=layer.left; minT=layer.top; maxR=layer.right; maxB=layer.bottom; }
          } else {
            minL=Math.min(minL,layer.left); minT=Math.min(minT,layer.top);
            maxR=Math.max(maxR,layer.right); maxB=Math.max(maxB,layer.bottom);
          }
          // Sample color from layer
          let hex = "#888888";
          if (layer.canvas) {
            const ctx = layer.canvas.getContext("2d");
            const data = ctx.getImageData(0,0,layer.canvas.width,layer.canvas.height).data;
            let rS=0,gS=0,bS=0,cnt=0;
            for (let i=0;i<data.length;i+=40) { if(data[i+3]>128){rS+=data[i];gS+=data[i+1];bS+=data[i+2];cnt++;} }
            if (cnt>0) hex="#"+[rS,gS,bS].map(v=>Math.round(v/cnt).toString(16).padStart(2,"0")).join("");
          }
          colors.push({ name: layer.name, hex });
        }
        const artW = maxR - minL;
        const artH = maxB - minT;
        if (artW <= 0 || artH <= 0) continue;
        printInfo.push({
          placement: zoneName || group.name,
          groupName: group.name,
          widthInches: (artW/300).toFixed(2),
          heightInches: (artH/300).toFixed(2),
          colors,
        });
      }
      setManualPrintInfo(printInfo);
    } catch (err) {
      setError("Failed to read PSD: " + err.message);
    } finally {
      setGenerating(false);
      setGenStatus("");
    }
  }

  function finalizeManual() {
    if (!manualMockupFile || !manualMockupPreview) return;
    // Build mockup data in the same shape as auto mode
    // Convert mockup image to JPEG upload format
    const canvas = document.createElement("canvas");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const uploadDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const pngDataUrl = canvas.toDataURL("image/png");
      const base64 = pngDataUrl.split(",")[1];
      setMockupData({
        mockup: base64,
        dataUrl: pngDataUrl,
        uploadDataUrl,
        printInfo: manualPrintInfo || [],
        psdFile: manualPsdFile,
      });
      setMode("manual");
    };
    img.src = manualMockupPreview;
  }

  async function handleSaveToDrive() {
    if (!mockupData) return;
    setSaving(true);
    setError(null);

    const safeName = (item.name || "Item").replace(/[^\w\s-]/g, "");
    const driveCtx = { clientName, projectTitle, itemName: item.name || "" };

    try {
      let folderLink = null;

      setSaveStatus("Uploading art file...");
      if (mockupData.psdFile) {
        const psdFile = await uploadToDrive({ blob: mockupData.psdFile, fileName: mockupData.psdFile.name, mimeType: "application/octet-stream", ...driveCtx });
        await registerFileInDb({ ...psdFile, itemId: item.id, stage: "print_ready" });
        folderLink = psdFile.folderLink;
      }

      setSaveStatus("Uploading mockup...");
      const mockupRes = await fetch(mockupData.uploadDataUrl);
      const mockupBlob = await mockupRes.blob();
      const mockupFile = await uploadToDrive({ blob: mockupBlob, fileName: `${safeName} - Mockup.jpg`, mimeType: "image/jpeg", ...driveCtx });
      await registerFileInDb({ ...mockupFile, itemId: item.id, stage: "mockup" });
      if (!folderLink) folderLink = mockupFile.folderLink;

      setSaveStatus("Uploading proof...");
      const doc = buildProofPdf();
      const pdfBlob = doc.output("blob");
      const proofFile = await uploadToDrive({ blob: pdfBlob, fileName: `${safeName} - Print Proof.pdf`, mimeType: "application/pdf", ...driveCtx });
      await registerFileInDb({ ...proofFile, itemId: item.id, stage: "proof" });

      if (folderLink) {
        await fetch("/api/drive/register", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: item.id, driveLink: folderLink }),
        });
        if (onUpdateItem) onUpdateItem(item.id, { drive_link: folderLink });
      }

      setSaved(true);
      if (onFilesChanged) onFilesChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      setSaveStatus("");
    }
  }

  const [downloading, setDownloading] = useState(false);

  function buildProofPdf() {
    return generateProofPdfClient({
      mockupDataUrl: mockupData.uploadDataUrl,
      printInfo: mockupData.printInfo,
      clientName,
      itemName: item.name || "",
      blankVendor: item.blank_vendor || "",
      blankStyle: item.sku || "",
      blankColor: item.color || "",
    });
  }

  function downloadPdf() {
    if (!mockupData) return;
    setDownloading(true);
    try {
      const doc = buildProofPdf();
      doc.save(`${item.name || "Item"} — Print Proof.pdf`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    setMockupData(null);
    setError(null);
    setSaved(false);
    setFileName("");
    setMode(null);
    setManualMockupFile(null);
    setManualMockupPreview(null);
    setManualPsdFile(null);
    setManualPrintInfo(null);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  return (
    <div style={{ marginTop: 8 }}>
      {!mockupData && !generating && !mode && (
        <div style={{ display: "flex", gap: 8 }}>
          {/* Auto: PSD drop */}
          <div
            onDragOver={e => { e.preventDefault(); setDragover(true); }}
            onDragLeave={() => setDragover(false)}
            onDrop={handleDrop}
            onClick={() => mockupInputRef.current?.click()}
            style={{
              flex: 1, border: `2px dashed ${dragover ? T.accent : T.border}`,
              borderRadius: 8, padding: "16px 12px", textAlign: "center", cursor: "pointer",
              background: dragover ? T.accentDim : "transparent", transition: "all 0.15s",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: T.accent, marginBottom: 4 }}>Auto Mockup</div>
            <div style={{ fontSize: 10, color: T.muted }}>Drop .psd — generates tee mockup + proof</div>
            <input ref={mockupInputRef} type="file" accept=".psd" onChange={e => { processFile(e.target.files?.[0]); e.target.value = ""; }} style={{ display: "none" }} />
          </div>
          {/* Manual: upload mockup + PSD — supports drag-and-drop of both at once */}
          <div
            onClick={() => setMode("manual-setup")}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.purple; e.currentTarget.style.background = T.purple + "11"; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = "transparent"; }}
            onDrop={e => {
              e.preventDefault();
              e.currentTarget.style.borderColor = T.border;
              e.currentTarget.style.background = "transparent";
              const files = Array.from(e.dataTransfer.files);
              const imageFile = files.find(f => f.type.startsWith("image/"));
              const psdFile = files.find(f => f.name.toLowerCase().endsWith(".psd"));
              if (imageFile) handleManualMockup(imageFile);
              if (psdFile) handleManualPsd(psdFile);
              if (imageFile || psdFile) setMode("manual-setup");
            }}
            style={{
              flex: 1, border: `2px dashed ${T.border}`,
              borderRadius: 8, padding: "16px 12px", textAlign: "center", cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.purple; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: T.purple, marginBottom: 4 }}>Custom Mockup</div>
            <div style={{ fontSize: 10, color: T.muted }}>Drop mockup + .psd together, or click to upload</div>
          </div>
        </div>
      )}

      {/* Manual setup: two upload slots */}
      {mode === "manual-setup" && !mockupData && !generating && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, background: T.surface }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.purple }}>Custom Mockup</div>
            <button onClick={() => { setMode(null); setManualMockupFile(null); setManualMockupPreview(null); setManualPsdFile(null); setManualPrintInfo(null); }}
              style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {/* Mockup image upload */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>1. Mockup Image</div>
              {manualMockupPreview ? (
                <div style={{ position: "relative" }}>
                  <img src={manualMockupPreview} style={{ width: "100%", borderRadius: 6, border: `1px solid ${T.border}` }} />
                  <button onClick={() => { setManualMockupFile(null); setManualMockupPreview(null); }}
                    style={{ position: "absolute", top: 4, right: 4, background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, color: T.muted, cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>×</button>
                </div>
              ) : (
                <div onClick={() => manualMockupRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith("image/")); if (f) handleManualMockup(f); }}
                  style={{ border: `2px dashed ${T.border}`, borderRadius: 6, padding: "20px 10px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, color: T.muted }}>Drop or click — JPG/PNG</div>
                  <input ref={manualMockupRef} type="file" accept="image/*" onChange={e => { handleManualMockup(e.target.files?.[0]); e.target.value = ""; }} style={{ display: "none" }} />
                </div>
              )}
            </div>
            {/* PSD art file upload */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>2. Art File (.psd)</div>
              {manualPsdFile ? (
                <div style={{ padding: "10px", background: T.card, borderRadius: 6, border: `1px solid ${T.green}` }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.green, marginBottom: 4 }}>{manualPsdFile.name}</div>
                  {manualPrintInfo && manualPrintInfo.length > 0 && (
                    <div style={{ fontSize: 10, color: T.muted }}>
                      {manualPrintInfo.map(p => `${p.placement}: ${p.colors.length} color${p.colors.length !== 1 ? "s" : ""}`).join(" · ")}
                    </div>
                  )}
                  <button onClick={() => { setManualPsdFile(null); setManualPrintInfo(null); }}
                    style={{ fontSize: 9, color: T.faint, background: "none", border: "none", cursor: "pointer", marginTop: 4 }}>Remove</button>
                </div>
              ) : (
                <div onClick={() => manualPsdRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith(".psd")); if (f) handleManualPsd(f); }}
                  style={{ border: `2px dashed ${T.border}`, borderRadius: 6, padding: "20px 10px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, color: T.muted }}>Drop or click — .psd file</div>
                  <div style={{ fontSize: 9, color: T.faint, marginTop: 2 }}>Optional — extracts print data</div>
                  <input ref={manualPsdRef} type="file" accept=".psd" onChange={e => { handleManualPsd(e.target.files?.[0]); e.target.value = ""; }} style={{ display: "none" }} />
                </div>
              )}
            </div>
          </div>
          {/* Generate button */}
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={finalizeManual} disabled={!manualMockupFile}
              style={{
                background: manualMockupFile ? T.purple : T.surface, color: manualMockupFile ? "#fff" : T.faint,
                border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 12, fontWeight: 600,
                cursor: manualMockupFile ? "pointer" : "default", opacity: manualMockupFile ? 1 : 0.5,
              }}>
              Generate Proof →
            </button>
          </div>
        </div>
      )}

      {generating && (
        <div style={{ textAlign: "center", padding: "14px 0" }}>
          <div style={{ fontSize: 11, color: T.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, border: `2px solid ${T.border}`, borderTopColor: T.accent, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            {genStatus || "Generating..."}
          </div>
          {fileName && <div style={{ fontSize: 10, color: T.faint, marginTop: 4 }}>{fileName}</div>}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && (
        <div style={{ padding: 10, background: T.redDim, borderRadius: 8, fontSize: 11, color: T.red, marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={reset} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>Dismiss</button>
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
          {saved ? (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: 11, color: T.green, fontWeight: 600, marginBottom: 8 }}>Saved to Google Drive</div>
              <button onClick={reset} style={{
                background: T.accent, border: "none", borderRadius: 6, color: "#fff",
                fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 18px", cursor: "pointer",
              }}>
                Generate Another
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={downloadPdf} disabled={downloading || saving} style={{
                background: T.accent, border: "none", borderRadius: 6, color: "#fff",
                fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 14px",
                cursor: downloading || saving ? "default" : "pointer", opacity: downloading || saving ? 0.6 : 1,
              }}>
                {downloading ? "Generating PDF..." : "Download PDF"}
              </button>
              <button onClick={handleSaveToDrive} disabled={saving || downloading} style={{
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text,
                fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 14px",
                cursor: saving || downloading ? "default" : "pointer", opacity: saving || downloading ? 0.6 : 1,
              }}>
                {saving ? (saveStatus || "Saving...") : "Save to Drive"}
              </button>
              <button onClick={reset} style={{
                background: "none", border: "none",
                color: T.faint, fontSize: 11, fontFamily: font, fontWeight: 600, padding: "6px 8px", cursor: "pointer",
              }}>
                Reset
              </button>
            </div>
          )}
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

export function ArtTab({ project, items, contacts, onUpdateItem }) {
  const clientName = project?.clients?.name || "Unknown Client";
  const projectTitle = project?.title || "Untitled Project";
  const sorted = items;

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
        <ItemArtSection key={item.id} item={{ ...item, _index: i }} clientName={clientName} projectTitle={projectTitle} contacts={contacts} jobId={project.id} onUpdateItem={onUpdateItem} />
      ))}
    </div>
  );
}
