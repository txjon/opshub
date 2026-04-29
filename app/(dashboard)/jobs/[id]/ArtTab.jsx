"use client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { buildMockupClient, preloadTemplate, extractPrintInfoFromPsd } from "@/lib/mockup-client";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { generateProofPdfClient, preloadLogo } from "@/lib/proof-client";
import { logJobActivity } from "@/components/JobActivityPanel";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { ArtBriefPanel } from "./ArtBriefPanel";
import { DriveThumb } from "@/components/DriveThumb";
import { DriveFileLink } from "@/components/DriveFileLink";

// Recursively collect files from drag-and-drop (handles folders)
export async function collectFiles(dataTransferItems) {
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

export function FileCard({ file, onDelete, onApproval, onSendToClient, stageLabel, stageColor }) {
  const approval = APPROVAL_LABELS[file.approval];
  const hasRevisionNote = file.approval === "revision_requested" && file.notes;

  return (
    <div style={{ borderRadius: 4 }}
      onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
          {stageLabel && (
            <span style={{ fontSize: 8, fontWeight: 700, color: stageColor || T.muted, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, width: 55 }}>{stageLabel}</span>
          )}
          <DriveFileLink driveFileId={file.drive_file_id} fileName={file.file_name} mimeType={file.mime_type}
            style={{ fontSize: 11, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
            {file.file_name}
          </DriveFileLink>
          {formatSize(file.file_size) && (
            <span style={{ fontSize: 9, color: T.faint, fontFamily: mono, flexShrink: 0 }}>{formatSize(file.file_size)}</span>
          )}
          <span style={{ fontSize: 9, color: T.faint, flexShrink: 0 }}>{new Date(file.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          {approval && (
            <span style={{ fontSize: 8, fontWeight: 600, padding: "1px 7px", borderRadius: 99, background: approval.bg, color: approval.color, flexShrink: 0, whiteSpace: "nowrap" }}>
              {approval.label}{file.approved_at ? ` · ${new Date(file.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${new Date(file.approved_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
            </span>
          )}
        </div>
        <button onClick={() => onDelete(file)}
          style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 10, flexShrink: 0, padding: "0 2px" }}
          onMouseEnter={e => e.currentTarget.style.color = T.red}
          onMouseLeave={e => e.currentTarget.style.color = T.faint}>✕</button>
      </div>
      {hasRevisionNote && (
        <div style={{ padding: "2px 6px 4px 61px", fontSize: 10, color: T.red, lineHeight: 1.3 }}>
          Client note: "{file.notes}"
        </div>
      )}
    </div>
  );
}

// Per-QB-category proof defaults. Tee/Hoodie/etc. get the standard
// fold + ink note; Hat/Beanie default to Embroidery with no fold; patches/
// stickers/pins default to no print method since the item itself IS the
// print. Empty string for `method` leaves the toggle unselected.
//
// Future (#3 in conversation): let these be edited in settings as curated
// per-category lists — see project_proof_category_lists.md.
const PROOF_DEFAULTS_BY_TYPE = {
  // Apparel — fold + ink note are the standard
  tee:        { method: "Screen Print", instructions: ["Bulk Fold", "Smooth Plastisol Ink"] },
  crewneck:   { method: "Screen Print", instructions: ["Bulk Fold", "Smooth Plastisol Ink"] },
  hoodie:     { method: "Screen Print", instructions: ["Bulk Fold", "Smooth Plastisol Ink"] },
  longsleeve: { method: "Screen Print", instructions: ["Bulk Fold", "Smooth Plastisol Ink"] },
  tank:       { method: "Screen Print", instructions: ["Bulk Fold", "Smooth Plastisol Ink"] },
  crop:       { method: "Screen Print", instructions: ["Bulk Fold", "Smooth Plastisol Ink"] },
  jacket:     { method: "Embroidery",   instructions: ["Bulk Fold"] },
  // Headwear — embroidery default, no fold
  hat:        { method: "Embroidery",   instructions: [] },
  beanie:     { method: "Embroidery",   instructions: [] },
  // Bottoms
  shorts:     { method: "Screen Print", instructions: ["Bulk Fold"] },
  pants:      { method: "Screen Print", instructions: ["Bulk Fold"] },
  bottoms:    { method: "Screen Print", instructions: ["Bulk Fold"] },
  // Bags / soft accessories
  tote:       { method: "Screen Print", instructions: [] },
  custom_bag: { method: "Screen Print", instructions: [] },
  bandana:    { method: "Screen Print", instructions: [] },
  towel:      { method: "Embroidery",   instructions: [] },
  socks:      { method: "Embroidery",   instructions: [] },
  // Decoration IS the item — no method on the proof
  patch:        { method: "", instructions: [] },
  pin:          { method: "", instructions: [] },
  sticker:      { method: "", instructions: [] },
  woven_labels: { method: "", instructions: [] },
  // Hard goods — leave method blank by default; Koozie skews screen print
  koozie:        { method: "Screen Print", instructions: [] },
  lighter:       { method: "", instructions: [] },
  water_bottle:  { method: "", instructions: [] },
  flag:          { method: "", instructions: [] },
  banner:        { method: "", instructions: [] },
  poster:        { method: "", instructions: [] },
  pillow:        { method: "", instructions: [] },
  rug:           { method: "", instructions: [] },
  // Misc / unmapped — let user pick
  accessory:    { method: "", instructions: [] },
  samples:      { method: "", instructions: [] },
  custom:       { method: "", instructions: [] },
  key_chain:    { method: "", instructions: [] },
  pens:         { method: "", instructions: [] },
  napkins:      { method: "", instructions: [] },
  balloons:     { method: "", instructions: [] },
  stencils:     { method: "", instructions: [] },
};

export function ProofModal({ item, clientName, projectTitle, mockupFile, files, costingData, onClose, onUpdateItem, onSaved, generateAllCounter }) {
  const METHODS = ["Screen Print", "DTF", "Embroidery"];
  const INSTRUCTIONS = ["Bulk Fold", "Piece Package", "Back Design Facing Out", "Smooth Plastisol Ink"];

  // Auto-populate from costing data
  const costProd = (costingData?.costProds || []).find(cp => cp.id === item.id);
  const decoType = costProd?.decorationType || "";
  const hasPackaging = costProd?.finishingQtys?.Packaging_on && costProd.finishingQtys.Packaging_on > 0;
  const locations = costProd?.printLocations || {};
  const locationNames = Object.values(locations).map(l => (l?.location || "").toLowerCase()).filter(Boolean);
  const hasBackPrint = locationNames.some(l => l.includes("back"));

  // Per-garment-type defaults — Tee/Hoodie/etc. get fold+ink, Hat gets Embroidery,
  // patches/pins get no method, etc. Costing's decorationType still wins for the
  // method (user already picked it). Falls through to legacy logic for unknown types.
  const typeDefaults = PROOF_DEFAULTS_BY_TYPE[item.garment_type] || null;
  const isFoldable = !!(typeDefaults && typeDefaults.instructions.includes("Bulk Fold"));

  const defaultMethod = (() => {
    if (decoType === "dtf" || decoType === "DTF") return "DTF";
    if (decoType === "embroidery" || decoType === "Embroidery") return "Embroidery";
    if (decoType === "screen_print" || decoType === "Screen Print") return "Screen Print";
    if (typeDefaults?.method) return typeDefaults.method;
    return "Screen Print";
  })();

  const defaultInstructions = (() => {
    if (typeDefaults) {
      const instr = [...typeDefaults.instructions];
      // Apparel-specific layer: swap Bulk Fold for Piece Package when packaged,
      // add Back Design facing out if there's a back print
      if (isFoldable && hasPackaging) {
        const bf = instr.indexOf("Bulk Fold");
        if (bf >= 0) instr.splice(bf, 1);
        if (!instr.includes("Piece Package")) instr.push("Piece Package");
        if (hasBackPrint && !instr.includes("Back Design Facing Out")) instr.push("Back Design Facing Out");
      }
      return instr;
    }
    // Legacy fallback for items without a recognized garment_type
    const instr = [];
    if (hasPackaging) {
      instr.push("Piece Package");
      if (hasBackPrint) instr.push("Back Design Facing Out");
    } else {
      instr.push("Bulk Fold");
    }
    if (defaultMethod === "Screen Print") instr.push("Smooth Plastisol Ink");
    return instr;
  })();

  // Ensure logo is loaded for PDF generation
  useEffect(() => { preloadLogo(); }, []);

  const [methods, setMethods] = useState([defaultMethod]);
  const [selInstructions, setSelInstructions] = useState(defaultInstructions);
  const [notes, setNotes] = useState("");
  const [callouts, setCallouts] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [psdPrintInfo, setPsdPrintInfo] = useState(null);
  const [loadingPsd, setLoadingPsd] = useState(false);
  const [mockupDataUrl, setMockupDataUrl] = useState(null);

  // Manual print-info entry — fallback when no PSD is available. Seeded from
  // costing's print locations so the user has a starting list of placements
  // to fill in dimensions / colors / callouts on.
  const [manualPrintInfo, setManualPrintInfo] = useState(() => {
    const locs = costProd?.printLocations || {};
    return Object.values(locs)
      .filter(l => l?.location)
      .map(l => ({
        placement: l.location,
        widthInches: "",
        heightInches: "",
        colorsText: "",
        callout: "",
      }));
  });

  // Best-effort name → hex resolution so manual entries get colored swatches
  // on the PDF. Unrecognized names fall through to gray (handled in proof-client).
  const COLOR_HEX = {
    black: "#000000", white: "#ffffff", red: "#d32f2f", blue: "#1565c0",
    navy: "#001f5c", royal: "#1c3faa", green: "#2e7d32", forest: "#194d20",
    olive: "#6b6b1a", yellow: "#fbc02d", gold: "#bf9000", orange: "#ef6c00",
    purple: "#6a1b9a", pink: "#ec407a", magenta: "#c2185b", maroon: "#7b1f1f",
    brown: "#5d3a1a", tan: "#b89572", khaki: "#a39160", cream: "#f4e9c8",
    gray: "#7a7a82", grey: "#7a7a82", silver: "#bfbfc6", charcoal: "#36363c",
    teal: "#00838f", aqua: "#26a3a5", cyan: "#00bcd4",
    heather: "#a3a3ab", "heather grey": "#a3a3ab", "heather gray": "#a3a3ab",
    natural: "#ece2cc", sand: "#dcc8a8", coral: "#e5734a",
  };
  const resolveHex = (name) => COLOR_HEX[(name || "").toLowerCase().trim()] || null;

  // Use PSD info when available, manual entries otherwise.
  const effectivePrintInfo = (psdPrintInfo && psdPrintInfo.length > 0)
    ? psdPrintInfo
    : manualPrintInfo
        .filter(p => (p.placement || "").trim())
        .map(p => ({
          placement: p.placement.trim(),
          widthInches: parseFloat(p.widthInches) || null,
          heightInches: parseFloat(p.heightInches) || null,
          colors: (p.colorsText || "").split(",").map(s => s.trim()).filter(Boolean).map(name => {
            const hex = resolveHex(name);
            return hex ? { name, hex } : { name };
          }),
          callout: p.callout || "",
        }));

  const mockupThumbUrl = mockupFile ? `/api/files/thumbnail?id=${mockupFile.drive_file_id}` : null;

  // Load PSD print info on mount
  useEffect(() => {
    const psdFile = (files || []).find(f => f.stage === "print_ready" && f.file_name?.toLowerCase().endsWith(".psd"))
      || [...(files || [])].reverse().find(f => f.file_name?.toLowerCase().endsWith(".psd"));
    if (!psdFile) return;
    setLoadingPsd(true);
    (async () => {
      try {
        const res = await fetch(`/api/files/thumbnail?id=${psdFile.drive_file_id}`);
        const buf = await res.arrayBuffer();
        const { readPsd } = await import("ag-psd");
        const psd = readPsd(new Uint8Array(buf));
        const info = extractPrintInfoFromPsd(psd);
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

  // Print method is single-select — clicking an unselected method makes it
  // the only choice; clicking the active one deselects (none).
  const toggleMethod = (m) => setMethods(prev => prev[0] === m ? [] : [m]);
  const toggleInstruction = (i) => setSelInstructions(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

  // Load mockup image once on mount — convert to JPEG for reliable PDF rendering
  useEffect(() => {
    if (!mockupThumbUrl) return;
    (async () => {
      try {
        const res = await fetch(mockupThumbUrl);
        const blob = await res.blob();
        const bmpUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          // White background (fills alpha channel areas)
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(bmpUrl);
          setMockupDataUrl(canvas.toDataURL("image/jpeg", 0.92));
        };
        img.onerror = () => URL.revokeObjectURL(bmpUrl);
        img.src = bmpUrl;
      } catch {}
    })();
  }, [mockupThumbUrl]);

  // Auto-generate preview whenever inputs change (debounced to avoid lag)
  useEffect(() => {
    if (!mockupDataUrl) return;
    const timer = setTimeout(() => {
      try {
        const activeSizes = item.qtys ? Object.keys(item.qtys).filter(sz => item.qtys[sz] > 0) : null;
        const hasActiveSizes = activeSizes && activeSizes.length > 0;
        const normalizeSize = (s) => {
          const u = (s || "").toUpperCase().trim();
          if (u === "XXL" || u === "2X") return "2XL";
          if (u === "XXXL" || u === "3X") return "3XL";
          if (u === "XXXXL" || u === "4X") return "4XL";
          if (u === "XXXXXL" || u === "5X") return "5XL";
          return u;
        };
        const activeSizesNorm = hasActiveSizes ? activeSizes.map(normalizeSize) : null;
        const printInfo = (effectivePrintInfo || []).map(p => {
          const isTag = (p.placement || "").toLowerCase() === "tag" || (p.placement || "").toLowerCase() === "tags";
          const colors = (isTag && activeSizesNorm) ? (p.colors || []).filter(c => activeSizesNorm.includes(normalizeSize(c.name))) : (p.colors || []);
          // Callouts state takes precedence over the manual-entry callout when both exist
          const callout = callouts[p.placement] || p.callout || "";
          return { ...p, colors, callout };
        });

        const doc = generateProofPdfClient({
          mockupDataUrl,
          printInfo,
          clientName: clientName || "",
          itemName: item.name || "",
          blankVendor: item.blank_vendor || "",
          blankStyle: item.blank_sku || "",
          blankColor: item.color || "",
          method: methods.join(", "),
          instructions: selInstructions,
          notes: notes.trim(),
        });

        const pdfBlob = doc.output("blob");
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const url = URL.createObjectURL(pdfBlob);
        setPreviewUrl(url);
        setPdfDoc(doc);
      } catch (err) {
        setError(err.message);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [mockupDataUrl, psdPrintInfo, methods, selInstructions, notes, callouts, manualPrintInfo]);

  async function saveToDrive() {
    if (!pdfDoc) return;
    // Close modal immediately, upload in background
    const pdfBlob = pdfDoc.output("blob");
    const safeName = (item.name || "Item").replace(/[^\w\s-]/g, "");
    onClose(true);
    // Background upload — onSaved refreshes file list when upload completes
    (async () => {
      try {
        const driveFile = await uploadToDrive({
          blob: pdfBlob,
          fileName: `${safeName} - Product Proof.pdf`,
          mimeType: "application/pdf",
          clientName,
          projectTitle,
          itemName: item.name || "",
        });
        await registerFileInDb({ ...driveFile, itemId: item.id, stage: "proof" });
        logJobActivity(item.job_id, `Product proof generated for ${item.name}`);
        if (onSaved) onSaved();
      } catch (err) {
        console.error("Proof upload error:", err);
      }
    })();
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
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 100, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: font }}>Product Proof — {item.name}</span>
            {generateAllCounter && (
              <span style={{ fontSize: 11, fontWeight: 600, color: T.muted, background: T.surface, padding: "3px 10px", borderRadius: 10 }}>{generateAllCounter}</span>
            )}
          </div>
          <button onClick={handleClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", display: "flex" }}>
          <div style={{ width: 320, flexShrink: 0, padding: "14px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
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
                <label style={{ fontSize: 11, color: T.muted, marginBottom: 6, display: "block" }}>Print Locations <span style={{ color: T.faint, fontWeight: 400 }}>· from PSD</span></label>
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

            {/* Manual print-info entry — fallback when no PSD found */}
            {!loadingPsd && (!psdPrintInfo || psdPrintInfo.length === 0) && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: T.muted }}>Print Locations <span style={{ color: T.faint, fontWeight: 400 }}>· no PSD, enter manually</span></label>
                  <button onClick={() => setManualPrintInfo(prev => [...prev, { placement: "", widthInches: "", heightInches: "", colorsText: "", callout: "" }])}
                    style={{ fontSize: 10, fontWeight: 600, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: font }}
                    onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
                    + Add
                  </button>
                </div>
                {manualPrintInfo.length === 0 && (
                  <div style={{ fontSize: 11, color: T.faint, padding: "8px 10px", background: T.surface, borderRadius: 6, textAlign: "center" }}>
                    Click + Add to enter a placement.
                  </div>
                )}
                {manualPrintInfo.map((p, idx) => {
                  const update = (field, value) => setManualPrintInfo(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
                  const remove = () => setManualPrintInfo(prev => prev.filter((_, i) => i !== idx));
                  return (
                    <div key={idx} style={{ background: T.surface, borderRadius: 6, padding: "8px 10px", marginBottom: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input value={p.placement} onChange={e => update("placement", e.target.value)}
                          list={`pi-placement-${idx}`} placeholder="Placement (Front, Back, Tag…)"
                          style={{ ...ic, fontSize: 12, fontWeight: 600, flex: 1 }} />
                        <datalist id={`pi-placement-${idx}`}>{["Front","Back","Left Chest","Right Chest","Left Sleeve","Right Sleeve","Hood","Pocket","Tag","Tags","Neck"].map(o => <option key={o} value={o} />)}</datalist>
                        <button onClick={remove} title="Remove placement"
                          style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                          onMouseEnter={e => e.currentTarget.style.color = T.red}
                          onMouseLeave={e => e.currentTarget.style.color = T.faint}>✕</button>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input value={p.widthInches} onChange={e => update("widthInches", e.target.value)}
                          type="text" inputMode="decimal" placeholder="W"
                          style={{ ...ic, fontSize: 12, width: 60 }} />
                        <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>×</span>
                        <input value={p.heightInches} onChange={e => update("heightInches", e.target.value)}
                          type="text" inputMode="decimal" placeholder="H"
                          style={{ ...ic, fontSize: 12, width: 60 }} />
                        <span style={{ fontSize: 10, color: T.faint }}>in</span>
                        <input value={p.colorsText} onChange={e => update("colorsText", e.target.value)}
                          placeholder="Colors: Black, White, Red"
                          style={{ ...ic, fontSize: 11, flex: 1 }} />
                      </div>
                      <input value={p.callout} onChange={e => update("callout", e.target.value)}
                        placeholder="Placement callout (optional)…"
                        style={{ ...ic, fontSize: 11 }} />
                    </div>
                  );
                })}
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
              <button onClick={saveToDrive} disabled={saving || !pdfDoc}
                style={{ flex: 1, padding: "8px", borderRadius: 6, border: "none", background: pdfDoc ? T.green : T.surface, color: pdfDoc ? "#fff" : T.faint, fontSize: 12, fontWeight: 600, cursor: pdfDoc ? "pointer" : "default", fontFamily: font, opacity: saving ? 0.5 : 1 }}>
                {saving ? "Saving..." : "Save to Drive"}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, borderLeft: `1px solid ${T.border}`, background: T.surface, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {previewUrl ? (
              <iframe src={previewUrl} style={{ width: "100%", height: "100%", border: "none", minHeight: 500 }} />
            ) : (
              <div style={{ fontSize: 11, color: T.faint }}>Loading preview...</div>
            )}
          </div>
        </div>
      </div>
  );
}

export function ItemArtSection({ item, clientName, projectTitle, contacts, jobId, costingData, onFilesChanged, onUpdateItem }) {
  const [files, setFiles] = useState([]);
  const [sendingFile, setSendingFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [dropover, setDropover] = useState(false);
  const [showProofModal, setShowProofModal] = useState(false);
  const [showBriefPanel, setShowBriefPanel] = useState(false);
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
  const hasProof = files.some(f => f.stage === "proof");
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
          {hasProof && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.amberDim, color: T.amber }}>
              Proof
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
        const nonMockupFiles = files.filter(f => f !== mockupFile);

        return (
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
            {/* Left: mockup thumbnail — height matches right column */}
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
              {mockupFile?.drive_file_id ? (
                <div style={{ position: "relative", height: "100%" }}>
                  <DriveThumb
                    driveFileId={mockupFile.drive_file_id}
                    enlargeable
                    title={`${item.name} — mockup`}
                    driveLink={mockupFile.drive_link || null}
                    style={{ height: 240, maxHeight: 240, width: "auto", borderRadius: 8, border: `1px solid ${T.border}`, display: "block", objectFit: "contain" }}
                  />
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

              {/* Action buttons */}
              <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                {mockupFile && (
                  <button onClick={() => setShowProofModal(true)}
                    style={{ padding: "6px 14px", borderRadius: 6, background: hasProof ? T.surface : T.amber, color: hasProof ? T.muted : "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, border: hasProof ? `1px solid ${T.border}` : "none" }}>
                    {hasProof ? "Regenerate Proof" : "Generate Proof"}
                  </button>
                )}
                <button onClick={() => setShowBriefPanel(true)}
                  style={{ padding: "6px 14px", borderRadius: 6, background: "transparent", color: T.accent, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, border: `1px solid ${T.accent}44` }}>
                  Art Brief
                </button>
              </div>
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
          costingData={costingData}
          onClose={() => setShowProofModal(false)}
          onUpdateItem={onUpdateItem}
          onSaved={() => loadFiles()}
        />
      )}

      {/* Art Brief panel */}
      {showBriefPanel && (
        <ArtBriefPanel
          itemId={item.id}
          jobId={jobId || item.job_id}
          onClose={() => setShowBriefPanel(false)}
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

export function MockupDropZone({ item, clientName, projectTitle, onFilesChanged, onUpdateItem }) {
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
      const printInfo = extractPrintInfoFromPsd(psd);
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
      const proofFile = await uploadToDrive({ blob: pdfBlob, fileName: `${safeName} - Product Proof.pdf`, mimeType: "application/pdf", ...driveCtx });
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
      doc.save(`${item.name || "Item"} — Product Proof.pdf`);
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
        <ItemArtSection key={item.id} item={{ ...item, _index: i }} clientName={clientName} projectTitle={projectTitle} contacts={contacts} jobId={project.id} costingData={project?.costing_data} onUpdateItem={onUpdateItem} />
      ))}
    </div>
  );
}
