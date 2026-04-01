"use client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { buildMockupClient, preloadTemplate } from "@/lib/mockup-client";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { generateProofPdfClient, preloadLogo } from "@/lib/proof-client";
import { logJobActivity } from "@/components/JobActivityPanel";
import { SendEmailDialog } from "@/components/SendEmailDialog";

// Recursively collect files from drag-and-drop (handles folders)
async function collectFiles(dataTransferItems) {
  const files = [];
  async function readEntry(entry) {
    if (entry.isFile) {
      const file = await new Promise(resolve => entry.file(resolve));
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise(resolve => reader.readEntries(resolve));
      for (const e of entries) await readEntry(e);
    }
  }
  const entries = [];
  for (let i = 0; i < dataTransferItems.length; i++) {
    const entry = dataTransferItems[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = dataTransferItems[i].getAsFile();
      if (file) files.push(file);
    }
  }
  for (const entry of entries) await readEntry(entry);
  return files;
}

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

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 4,
    }}
      onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
        {stageLabel && (
          <span style={{ fontSize: 8, fontWeight: 700, color: stageColor || T.muted, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, width: 55 }}>{stageLabel}</span>
        )}
        <a href={file.drive_link} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: T.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.file_name}
        </a>
        {formatSize(file.file_size) && (
          <span style={{ fontSize: 9, color: T.faint, fontFamily: mono, flexShrink: 0 }}>{formatSize(file.file_size)}</span>
        )}
        <span style={{ fontSize: 9, color: T.faint, flexShrink: 0 }}>{new Date(file.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </div>
      <button onClick={() => onDelete(file)}
        style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 10, flexShrink: 0, padding: "0 2px" }}
        onMouseEnter={e => e.currentTarget.style.color = T.red}
        onMouseLeave={e => e.currentTarget.style.color = T.faint}>✕</button>
    </div>
  );
}

function ProofModal({ item, clientName, projectTitle, mockupFile, files, onClose, onUpdateItem }) {
  const METHODS = ["Screen Print", "DTF", "Embroidery"];
  const INSTRUCTIONS = ["Bulk Fold", "Piece Package", "Back Design Facing Out", "Smooth Plastisol Ink"];
  const [methods, setMethods] = useState(["Screen Print"]);
  const [selInstructions, setSelInstructions] = useState([]);
  const [notes, setNotes] = useState("");
  const [callouts, setCallouts] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [psdPrintInfo, setPsdPrintInfo] = useState(null);
  const [loadingPsd, setLoadingPsd] = useState(false);

  const mockupThumbUrl = mockupFile ? `/api/files/thumbnail?id=${mockupFile.drive_file_id}` : null;

  // Load PSD print info on mount
  useEffect(() => {
    const psdFile = (files || []).find(f => f.stage === "print_ready" && f.file_name?.toLowerCase().endsWith(".psd"));
    if (!psdFile) return;
    setLoadingPsd(true);
    (async () => {
      try {
        const res = await fetch(`/api/files/thumbnail?id=${psdFile.drive_file_id}`);
        const buf = await res.arrayBuffer();
        const { readPsd } = await import("ag-psd");
        const psd = readPsd(new Uint8Array(buf));
        const PLACEMENT_MAP = { 'Front':'Full Front','Full Front':'Full Front','Back':'Full Back','Full Back':'Full Back','Left Chest':'Left Chest','Right Chest':'Right Chest','Left Sleeve':'Left Sleeve','Right Sleeve':'Right Sleeve','Neck':'Neck','Hood':'Hood','Pocket':'Pocket' };
        const SKIP_GROUPS = ['Shirt Color','Shadows','Highlights','Mask'];
        const info = [];
        const groups = [...(psd.children || [])].reverse();
        for (const group of groups) {
          if (!group.children) continue;
          if (SKIP_GROUPS.includes(group.name)) continue;
          const isTag = (group.name||"").toLowerCase()==="tag"||(group.name||"").toLowerCase()==="tags";
          let minL=Infinity,minT=Infinity,maxR=-Infinity,maxB=-Infinity;
          const colors = [];
          for (const layer of group.children) {
            if (isTag) { if(minL===Infinity){minL=layer.left||0;minT=layer.top||0;maxR=layer.right||0;maxB=layer.bottom||0;} }
            else { minL=Math.min(minL,layer.left||0);minT=Math.min(minT,layer.top||0);maxR=Math.max(maxR,layer.right||0);maxB=Math.max(maxB,layer.bottom||0); }
            let hex="#888888";
            if(layer.canvas){const ctx=layer.canvas.getContext("2d");if(ctx){const d=ctx.getImageData(0,0,layer.canvas.width,layer.canvas.height).data;let rS=0,gS=0,bS=0,cnt=0;for(let i=0;i<d.length;i+=40){if(d[i+3]>128){rS+=d[i];gS+=d[i+1];bS+=d[i+2];cnt++;}}if(cnt>0)hex="#"+[rS,gS,bS].map(v=>Math.round(v/cnt).toString(16).padStart(2,"0")).join("");}}
            colors.push({name:layer.name,hex});
          }
          const artW=maxR-minL,artH=maxB-minT;
          if(artW<=0||artH<=0) continue;
          info.push({ placement: PLACEMENT_MAP[group.name]||group.name, widthInches:(artW/300).toFixed(2), heightInches:(artH/300).toFixed(2), colors });
        }
        setPsdPrintInfo(info);
        // Pre-fill default callouts
        const defaults = {
          "Left Chest": 'Graphic centered 4" from center, 3" from neck seam',
          "Full Front": 'Centered horizontally, 3" from neck seam',
          "Full Back": 'Centered horizontally, 3" from neck seam',
          "Tag": 'Centered .5" from neck seam',
          "Tags": 'Centered .5" from neck seam',
        };
        const prefilled = {};
        for (const p of info) { if (defaults[p.placement]) prefilled[p.placement] = defaults[p.placement]; }
        setCallouts(prev => ({ ...prefilled, ...prev }));
      } catch(e) { console.error("PSD parse error:", e); }
      finally { setLoadingPsd(false); }
    })();
  }, []);

  const toggleMethod = (m) => setMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  const toggleInstruction = (i) => setSelInstructions(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

  async function generate() {
    if (!mockupThumbUrl) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(mockupThumbUrl);
      const blob = await res.blob();
      const mockupDataUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });

      // Merge PSD print info with user callouts
      const printInfo = (psdPrintInfo || []).map(p => ({
        ...p,
        callout: callouts[p.placement] || "",
      }));

      const doc = generateProofPdfClient({
        mockupDataUrl,
        printInfo,
        clientName: clientName || "",
        itemName: item.name || "",
        blankVendor: item.blank_vendor || "",
        blankStyle: item.blank_sku || "",
        blankColor: item.color || "",
        method: methods.join(", "),
        instructions: [...selInstructions, ...(notes.trim() ? [notes.trim()] : [])].join(" · "),
        notes: "",
      });

      const pdfBlob = doc.output("blob");
      const url = URL.createObjectURL(pdfBlob);
      setPreviewUrl(url);
      setPdfDoc(doc);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function saveToDrive() {
    if (!pdfDoc) return;
    setSaving(true);
    setError(null);
    try {
      const pdfBlob = pdfDoc.output("blob");
      const safeName = (item.name || "Item").replace(/[^\w\s-]/g, "");
      const driveFile = await uploadToDrive({
        blob: pdfBlob,
        fileName: `${safeName} - Print Proof.pdf`,
        mimeType: "application/pdf",
        clientName,
        projectTitle,
        itemName: item.name || "",
      });
      await registerFileInDb({ ...driveFile, itemId: item.id, stage: "proof" });
      logJobActivity(item.job_id, `Print proof generated for ${item.name}`);
      onClose(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (previewUrl) {
      if (!window.confirm("Save proof to Drive before closing?")) {
        URL.revokeObjectURL(previewUrl);
        onClose(false);
        return;
      }
      saveToDrive();
    } else {
      onClose(false);
    }
  }

  const ic = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, width: previewUrl ? 900 : 480, maxWidth: "95vw", maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: font }}>Generate Proof — {item.name}</div>
          <button onClick={handleClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", display: "flex" }}>
          <div style={{ width: previewUrl ? 320 : "100%", flexShrink: 0, padding: "14px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Method toggle buttons */}
            <div>
              <label style={{ fontSize: 11, color: T.muted, marginBottom: 6, display: "block" }}>Print Method</label>
              <div style={{ display: "flex", gap: 4 }}>
                {METHODS.map(m => {
                  const on = methods.includes(m);
                  return (
                    <button key={m} onClick={() => toggleMethod(m)}
                      style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accentDim : "transparent", color: on ? T.accent : T.faint, fontSize: 12, fontWeight: on ? 600 : 400, cursor: "pointer", fontFamily: font, transition: "all 0.12s" }}>
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Print locations from PSD with callout fields */}
            {loadingPsd && <div style={{ fontSize: 11, color: T.muted }}>Reading PSD print data...</div>}
            {psdPrintInfo && psdPrintInfo.length > 0 && (
              <div>
                <label style={{ fontSize: 11, color: T.muted, marginBottom: 6, display: "block" }}>Print Locations</label>
                {psdPrintInfo.map((p, i) => (
                  <div key={i} style={{ background: T.surface, borderRadius: 6, padding: "8px 10px", marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{p.placement}</span>
                      <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>{p.widthInches}" × {p.heightInches}" · {p.colors?.length || 0} color{(p.colors?.length||0)!==1?"s":""}</span>
                    </div>
                    <input value={callouts[p.placement] || ""} onChange={e => setCallouts(prev => ({...prev, [p.placement]: e.target.value}))}
                      placeholder="Placement callout..." style={{ ...ic, fontSize: 11 }} />
                  </div>
                ))}
              </div>
            )}

            {/* Special instructions toggle buttons */}
            <div>
              <label style={{ fontSize: 11, color: T.muted, marginBottom: 6, display: "block" }}>Special Instructions</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {INSTRUCTIONS.map(i => {
                  const on = selInstructions.includes(i);
                  return (
                    <button key={i} onClick={() => toggleInstruction(i)}
                      style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accentDim : "transparent", color: on ? T.accent : T.faint, fontSize: 11, fontWeight: on ? 600 : 400, cursor: "pointer", fontFamily: font, transition: "all 0.12s" }}>
                      {i}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={{ fontSize: 11, color: T.muted, marginBottom: 3, display: "block" }}>Special Instructions</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...ic, resize: "vertical", lineHeight: 1.4 }} />
            </div>

            {error && <div style={{ fontSize: 11, color: T.red, padding: "6px 8px", background: T.redDim, borderRadius: 4 }}>{error}</div>}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {!previewUrl ? (
                <button onClick={generate} disabled={generating}
                  style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", background: T.amber, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: generating ? 0.5 : 1 }}>
                  {generating ? "Generating..." : "Generate Preview"}
                </button>
              ) : (
                <>
                  <button onClick={saveToDrive} disabled={saving}
                    style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font, opacity: saving ? 0.5 : 1 }}>
                    {saving ? "Saving..." : "Save to Drive"}
                  </button>
                  <button onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setPdfDoc(null); }}
                    style={{ padding: "8px 14px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                    Edit
                  </button>
                </>
              )}
            </div>
          </div>

          {previewUrl && (
            <div style={{ flex: 1, borderLeft: `1px solid ${T.border}`, background: T.surface }}>
              <iframe src={previewUrl} style={{ width: "100%", height: "100%", border: "none", minHeight: 500 }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemArtSection({ item, clientName, projectTitle, contacts, jobId, onFilesChanged, onUpdateItem }) {
  const [files, setFiles] = useState([]);
  const [sendingFile, setSendingFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [dropover, setDropover] = useState(false);
  const [showProofModal, setShowProofModal] = useState(false);
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

  function detectStage(fileName) {
    const n = fileName.toLowerCase();
    if (n.endsWith(".psd")) return "print_ready";
    if (n.endsWith(".ai") || n.endsWith(".eps")) return "vector";
    if (n.endsWith(".pdf") && !n.includes("proof")) return "vector";
    if (n.endsWith(".pdf") && n.includes("proof")) return "proof";
    if ((n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg")) && n.includes("mockup")) return "mockup";
    if ((n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg")) && n.includes("proof")) return "proof";
    return "client_art";
  }

  async function handleMultiUpload(fileList) {
    if (!fileList?.length) return;
    setUploading(true);
    setUploadProgress({ total: fileList.length, done: 0, current: "" });

    try {
      let done = 0;
      for (const file of fileList) {
        const stage = detectStage(file.name);
        setUploadProgress(p => ({ ...p, current: file.name, done }));
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
          stage,
        });
        done++;
      }
      const stageCounts = {};
      for (const file of fileList) {
        const s = detectStage(file.name);
        const label = STAGES.find(st=>st.key===s)?.label || s;
        stageCounts[label] = (stageCounts[label] || 0) + 1;
      }
      const summary = Object.entries(stageCounts).map(([k,v])=>`${v} ${k}`).join(", ");
      logJobActivity(item.job_id, `${fileList.length} file${fileList.length>1?"s":""} uploaded to ${item.name} (${summary})`);
    } catch (err) {
      console.error("Upload error:", err);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
    setUploadProgress(null);
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

      {expanded && (()=>{
        const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup") && (f.mime_type?.startsWith("image/") || /\.(png|jpg|jpeg)$/i.test(f.file_name)));
        const mockupThumb = mockupFile ? `/api/files/thumbnail?id=${mockupFile.drive_file_id}` : null;
        const nonMockupFiles = files.filter(f => f !== mockupFile);

        return (
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
            {/* Left: mockup thumbnail — height matches right column */}
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
              {mockupThumb ? (
                <div style={{ position: "relative", height: "100%" }}>
                  <a href={mockupFile.drive_link} target="_blank" rel="noopener noreferrer" style={{ display: "block", height: "100%" }}>
                    <img src={mockupThumb} alt="Mockup"
                      style={{ height: "100%", maxHeight: 240, width: "auto", borderRadius: 8, border: `1px solid ${T.border}`, display: "block", objectFit: "contain" }}
                      onError={e => { e.target.style.display = "none"; }} />
                  </a>
                  <button onClick={e => { e.stopPropagation(); setConfirmDelete(mockupFile); }}
                    style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 4, background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.red)}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0.6)")}>✕</button>
                </div>
              ) : (
                <div style={{ width: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 10, color: T.faint }}>No mockup yet</span>
                </div>
              )}
            </div>

            {/* Right: drop zone + file list */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDropover(true); }}
                onDragLeave={() => setDropover(false)}
                onDrop={e => { e.preventDefault(); setDropover(false); const items = e.dataTransfer.items; if (items) { collectFiles(items).then(f => handleMultiUpload(f)); } else { handleMultiUpload(Array.from(e.dataTransfer.files)); } }}
                onClick={() => !uploading && fileInputRef.current?.click()}
                style={{ border: `2px dashed ${dropover ? T.accent : T.border}`, borderRadius: 8, padding: uploading ? "8px 12px" : "12px", textAlign: "center", cursor: uploading ? "default" : "pointer", background: dropover ? T.accentDim : "transparent", transition: "all 0.15s", marginBottom: 10 }}>
                {uploading && uploadProgress ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.accent, marginBottom: 3 }}>Uploading {uploadProgress.done}/{uploadProgress.total}...</div>
                    <div style={{ fontSize: 10, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{uploadProgress.current}</div>
                    <div style={{ height: 3, background: T.surface, borderRadius: 2, marginTop: 4 }}>
                      <div style={{ height: "100%", width: `${(uploadProgress.done / uploadProgress.total) * 100}%`, background: T.accent, borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.accent, marginBottom: 2 }}>Drop files here or click to browse</div>
                    <div style={{ fontSize: 9, color: T.muted }}>Auto-categorized: .psd → print-ready · .ai/.pdf → vector · images → client art</div>
                  </div>
                )}
                <input ref={fileInputRef} type="file" multiple onChange={e => handleMultiUpload(Array.from(e.target.files || []))} style={{ display: "none" }} />
              </div>

              {/* File list */}
              {loading ? (
                <div style={{ fontSize: 12, color: T.muted, padding: "8px 0" }}>Loading files...</div>
              ) : nonMockupFiles.length === 0 && !mockupFile ? (
                <div style={{ fontSize: 11, color: T.faint, padding: "8px 0" }}>No files yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {nonMockupFiles.map(f => {
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

              {/* Generate Proof button */}
              {mockupFile && (
                <button onClick={() => setShowProofModal(true)}
                  style={{ marginTop: 8, padding: "6px 14px", borderRadius: 6, border: "none", background: T.amber, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  Generate Proof
                </button>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Proof generation modal */}
      {showProofModal && (
        <ProofModal
          item={item}
          clientName={clientName}
          projectTitle={projectTitle}
          mockupFile={files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"))}
          files={files}
          onClose={(saved) => { setShowProofModal(false); if (saved) loadFiles(); }}
          onUpdateItem={onUpdateItem}
        />
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
