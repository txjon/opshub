"use client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConfirm } from "@/components/useConfirm";
import { buildMockupClient, preloadTemplate, extractPrintInfoFromPsd } from "@/lib/mockup-client";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { deriveProofSummary, preloadLogo, PROOF_RENDERER_VERSION } from "@/lib/proof-client";
import { computeMockupLayout, MOCKUP_FRAME_ASPECT } from "@/lib/mockup-crop";
import ProofDocView from "@/components/ProofDocView";
import { useClientBranding } from "@/lib/branding-client";
import { logJobActivity } from "@/components/JobActivityPanel";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { useIsMobile } from "@/lib/useIsMobile";
import { PdfCanvasPreview } from "@/components/PdfCanvasPreview";
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
  tee:        { method: "Screen Print", instructions: ["Bulk Fold"] },
  crewneck:   { method: "Screen Print", instructions: ["Bulk Fold"] },
  hoodie:     { method: "Screen Print", instructions: ["Bulk Fold"] },
  longsleeve: { method: "Screen Print", instructions: ["Bulk Fold"] },
  tank:       { method: "Screen Print", instructions: ["Bulk Fold"] },
  crop:       { method: "Screen Print", instructions: ["Bulk Fold"] },
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

// ── Proof spec helpers ─────────────────────────────────────────────
// items.proof_spec is the editable source of truth for the proof PDF.
// The PSD parse only SEEDS it (first open, or explicit Re-pull) —
// after that the sidebar owns every field the PDF renders below the
// mockup. Shape:
//   { locations: [{ placement, sizeText, colors: [{name, hex}], callout }],
//     methods, instructions, notes, seededFrom: { fileId, at } }

const DEFAULT_CALLOUTS = {
  "Left Chest": 'Graphic centered 4" from center, 3" from neck seam',
  "Full Front": 'Centered horizontally, 3" from neck seam',
  "Full Back": 'Centered horizontally, 3" from neck seam',
  "Tag": 'Centered .5" from neck seam',
  "Tags": 'Centered .5" from neck seam',
};

// Map a PSD parse result onto spec-location rows. `priorLocations`
// lets a Re-pull carry the user's placement callouts over when the
// location name still exists in the new parse.
function psdInfoToSpecLocations(info, priorLocations = []) {
  const priorByPlacement = {};
  for (const p of (priorLocations || [])) {
    if (p?.placement) priorByPlacement[p.placement.toLowerCase().trim()] = p;
  }
  return (info || []).map(p => {
    const prior = priorByPlacement[(p.placement || "").toLowerCase().trim()];
    return {
      placement: p.placement || "",
      sizeText: (p.widthInches && p.heightInches) ? `${p.widthInches}" × ${p.heightInches}"` : "",
      colors: (p.colors || []).map(c => ({ name: c.name || "", hex: c.hex || null })),
      callout: prior?.callout || DEFAULT_CALLOUTS[p.placement] || "",
      specialties: Array.isArray(prior?.specialties) ? prior.specialties : [],
    };
  });
}

// Fetch + parse a print-ready PSD (db file row) into print info.
// dl=1 forces the full PSD bytes — the thumbnail endpoint otherwise
// serves Drive's PNG thumb for non-renderable mimes, which ag-psd
// can't parse.
async function parsePsdFileToInfo(fileRow) {
  const res = await fetch(`/api/files/thumbnail?id=${fileRow.drive_file_id}&dl=1`);
  const buf = await res.arrayBuffer();
  const { readPsd } = await import("ag-psd");
  const psd = readPsd(new Uint8Array(buf));
  // Proof spec: keep a print location even when its art layer is toggled off in
  // the PSD (a location shouldn't vanish from a client proof over layer
  // visibility). The mockup path calls this WITHOUT the flag.
  return extractPrintInfoFromPsd(psd, { keepHiddenLocations: true });
}

// A PSD whose filename reads like a tag/neck-label file is treated as the tag
// artwork. Vendors want tags as a SEPARATE file (not embedded in the main PSD),
// so a proof can carry both: main art PSD + tag PSD.
// Word-boundary match so a tag file ("SupDef - TAGS.psd", "neck-label.psd") is
// caught, but a main-art name that merely contains the letters ("vintage.psd",
// "stage.psd") is NOT wrongly flagged — a false positive would drop main art into
// the tag row, which is worse than a missed hint.
const TAG_PSD_HINT = /\b(tags?|neck|labels?)\b/i;

// Parse EVERY print-ready PSD on the item and merge their print locations into
// one spec — so a main-art PSD + a separate tag PSD both land on the proof
// (previously only a single PSD was parsed and the other was silently ignored).
// Tag-file locations are labeled so they read distinctly; duplicates by placement
// are collapsed (main wins). `prior` carries callouts forward on a re-pull.
async function parsePsdFilesToSpec(psdFiles, prior = []) {
  // The proof renderer + summary recognize a tag by placement === "tag"/"tags"
  // (counted as "size tags", excluded from the location count). So a tag-file
  // PSD's locations are normalized to "Tag" to slot into that convention.
  const isTagPlacement = (s) => { const t = (s || "").toLowerCase().trim(); return t === "tag" || t === "tags"; };
  const merged = [];
  for (const f of (psdFiles || [])) {
    const isTag = TAG_PSD_HINT.test(f.file_name || "");
    let info = [];
    try { info = await parsePsdFileToInfo(f); }
    catch (e) { console.error("PSD parse error:", f.file_name, e); }
    for (const p of (info || [])) {
      const placement = isTag
        ? (isTagPlacement(p.placement) ? p.placement : "Tag")
        : (p.placement || "");
      merged.push({ ...p, placement });
    }
  }
  const seen = new Set();
  const deduped = merged.filter(p => {
    const k = (p.placement || "").toLowerCase().trim();
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  return psdInfoToSpecLocations(deduped, prior);
}

// All print-ready PSDs on the item (fall back to any PSDs if none are flagged
// print-ready), so the proof considers every uploaded PSD, not just one.
function activePsdFiles(files) {
  const psds = (files || []).filter(f => f.file_name?.toLowerCase().endsWith(".psd"));
  const ready = psds.filter(f => f.stage === "print_ready");
  return ready.length ? ready : psds;
}

// Tag prints are almost always one ink (black / grey / white). Remember the
// last ink used across proofs (localStorage) so "+ Tag" pre-colors its size
// chips and a batch of proofs doesn't need re-coloring one size at a time.
// Placeholder approval disclaimer — wording NOT finalized (Jon 2026-07-19).
// Editable per proof; carried on proof_spec.disclaimer. TODO: make this a
// company-level default once the legal wording is locked.
const DEFAULT_DISCLAIMER = "This proof is provided for your review and approval prior to production. Please review all artwork, spelling, ink colors, print placement, and garment sizing carefully: approval authorizes production exactly as shown. Colors are reproduced as accurately as the display and printing process allow and may vary from the final printed inks; refer to Pantone references for precise color matching. Production timelines commence upon written approval, and changes requested thereafter may affect pricing and delivery.";

const TAG_INK_KEY = "opshub_last_tag_ink";
const getLastTagInk = () => { try { return (typeof localStorage !== "undefined" && localStorage.getItem(TAG_INK_KEY)) || "#000000"; } catch { return "#000000"; } };
const setLastTagInk = (hex) => { try { if (typeof localStorage !== "undefined") localStorage.setItem(TAG_INK_KEY, hex); } catch {} };

export function ProofModal({ item, clientName, projectTitle, mockupFile, files, costingData, onClose, onUpdateItem, onSaved, generateAllCounter, initialMode = "edit" }) {
  const isMobile = useIsMobile();
  const METHODS = ["Screen Print", "Embroidery", "PVC", "DTF"];
  // Ink/print TYPE — a child of Method (Product Spec pill), pick-list + custom.
  const TYPE_OPTIONS = ["Water Based", "Discharge", "Thin Vintage Print", "Smooth Plastisol Ink", "Blocker Ink"];
  // Finishing/handling chips — Smooth Plastisol Ink moved out (it's a Type now).
  const INSTRUCTIONS = ["Bulk Fold", "Piece Package", "Back Design Facing Out"];

  // Auto-populate from costing data
  const costProd = (costingData?.costProds || []).find(cp => cp.id === item.id);
  // The real print spec (feeds the PO) — screen/color counts per location, specialty,
  // finishing, tag. Drives the proof's per-location colors + the KPI spec bar.
  const spec = (() => {
    const cp = costProd || {};
    const locs = Object.values(cp.printLocations || {}).filter(l => l && l.location);
    const screensByLoc = {};
    locs.forEach(l => { screensByLoc[String(l.location).trim().toLowerCase()] = Number(l.screens) || 0; });
    return {
      locs,
      screensByLoc,
      totalScreens: locs.reduce((a, l) => a + (Number(l.screens) || 0), 0),
      finishing: Object.entries(cp.finishingQtys || {}).filter(([k, q]) => Number(q) > 0 && k !== "Packaging_on").map(([n]) => n),
      tagPrint: !!cp.tagPrint,
      isFleece: !!cp.isFleece,
    };
  })();
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
    return instr;
  })();
  // Smooth Plastisol Ink used to be a default finishing chip on screen-print
  // garments; it's now the default Type (ink) instead.
  const defaultType = defaultMethod === "Screen Print" ? "Smooth Plastisol Ink" : "";

  const branding = useClientBranding();
  // Ensure tenant logo is loaded for PDF generation
  useEffect(() => { preloadLogo(branding.slug); }, [branding.slug]);

  const [confirm, confirmEl] = useConfirm();
  const [methods, setMethods] = useState([defaultMethod]);
  const [selInstructions, setSelInstructions] = useState(defaultInstructions);
  const [notes, setNotes] = useState("");
  const [previewUrl, setPreviewUrl] = useState(null);
  // The proof editor is the inline document (the sidebar layout was retired
  // 2026-07-19). previewMode strips the edit chrome = the exact client view.
  const [previewMode, setPreviewMode] = useState(initialMode === "preview");
  // Tracks the spec last baked to the Drive PDF, so exit/Download re-bake ONLY
  // when the proof actually changed (view-only exit is a no-op). Assumes the
  // loaded proof_spec already matches the Drive PDF (they save together).
  const driveBakedSpecRef = useRef(null);
  // Forces a re-bake on exit even when the spec is unchanged — set on load when
  // the Drive PDF was baked with an older renderer (or never baked). Cleared
  // after a successful bake. Keeps view-only exits of CURRENT-version proofs a
  // no-op (so they don't reset an approved proof), while a renderer bump still
  // reaches Drive. See PROOF_RENDERER_VERSION.
  const forceRebakeRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loadingPsd, setLoadingPsd] = useState(false);
  const [mockupDataUrl, setMockupDataUrl] = useState(null);
  const [replacingMockup, setReplacingMockup] = useState(false);
  // Inline mockup replace — upload a new mockup, supersede the old, update the
  // live preview (which drives BOTH the web proof and the PDF, so it's WYSIWYG).
  async function replaceMockupInline(file) {
    if (!file || replacingMockup) return;
    setReplacingMockup(true);
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      setMockupDataUrl(dataUrl); // instant preview
      const supabase = createClient();
      const now = new Date().toISOString();
      const { data: old } = await supabase.from("item_files").select("id").eq("item_id", item.id).eq("stage", "mockup").is("superseded_at", null);
      for (const m of (old || [])) await supabase.from("item_files").update({ superseded_at: now }).eq("id", m.id);
      const driveFile = await uploadToDrive({ blob: file, fileName: file.name, mimeType: file.type, itemId: item.id, clientName, projectTitle, itemName: item.name });
      await registerFileInDb({ ...driveFile, itemId: item.id, stage: "mockup" });
      logJobActivity(item.job_id, `Mockup replaced for ${item.name}`);
      if (onSaved) onSaved();
    } catch (e) { setError("Mockup replace failed: " + (e?.message || e)); }
    setReplacingMockup(false);
  }
  // Non-destructive mockup crop transform { zoom, offsetX, offsetY } (spec field).
  const [mockupCrop, setMockupCrop] = useState(null);
  // Bake the crop into a MOCKUP_FRAME_ASPECT canvas for the PDF (web + portal
  // apply the SAME math via CSS in ProofDocView). Original mockup never touched.
  const [croppedMockupUrl, setCroppedMockupUrl] = useState(null);
  useEffect(() => {
    if (!mockupDataUrl) { setCroppedMockupUrl(null); return; }
    let cancelled = false;
    const im = new Image();
    im.onload = () => {
      if (cancelled) return;
      try {
        const cw = 1200, ch = Math.round(cw / MOCKUP_FRAME_ASPECT);
        const canvas = document.createElement("canvas");
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch);
        const lay = computeMockupLayout(im.naturalWidth, im.naturalHeight, cw, ch, mockupCrop);
        ctx.drawImage(im, lay.left, lay.top, lay.dispW, lay.dispH);
        setCroppedMockupUrl(canvas.toDataURL("image/jpeg", 0.92));
      } catch (e) { setCroppedMockupUrl(mockupDataUrl); }
    };
    im.onerror = () => { if (!cancelled) setCroppedMockupUrl(mockupDataUrl); };
    im.src = mockupDataUrl;
    return () => { cancelled = true; };
  }, [mockupDataUrl, mockupCrop]);

  // The proof spec — single editable source for everything the PDF
  // renders below the mockup. Hydrated from items.proof_spec when
  // saved, else seeded from the PSD parse, else a skeleton from
  // costing's print locations. Every field is editable; the PSD is
  // only a seeder (Re-pull = explicit refresh).
  const [specLocations, setSpecLocations] = useState([]);
  // Summary-bar override — null = auto-derive from locations +
  // instructions (stays live as they change); string = custom text;
  // empty string = omit the bar from the PDF.
  const [summaryOverride, setSummaryOverride] = useState(null);
  // Manual overrides for the Product Spec count pills (null = auto-derived).
  const [colorCountOverride, setColorCountOverride] = useState(null);
  const [locationCountOverride, setLocationCountOverride] = useState(null);
  const [disclaimer, setDisclaimer] = useState(DEFAULT_DISCLAIMER);
  const [printType, setPrintType] = useState(defaultType);
  const [specLoaded, setSpecLoaded] = useState(false);
  // EyeDropper API (Chrome/Edge) — lets the swatch open the OS eyedropper
  // directly to sample a pixel (e.g. off the mockup). Detected post-mount
  // to avoid SSR mismatch; Safari falls back to the native color input.
  const [hasEyeDropper, setHasEyeDropper] = useState(false);
  useEffect(() => { setHasEyeDropper(typeof window !== "undefined" && "EyeDropper" in window); }, []);
  const [addingMethod, setAddingMethod] = useState(false);
  const [methodDraft, setMethodDraft] = useState("");
  // Locations + Colors KPIs count the PROOF SPEC (the manual entries / cards
  // above), NOT costing — same non-tag rows deriveProofSummary uses, so the
  // KPI, the cards, and the (auto) Summary Bar always agree.
  const proofNonTag = specLocations
    .filter(l => !["tag", "tags"].includes(String(l.placement || "").toLowerCase().trim()));
  const proofLocationCount = proofNonTag.length;
  const proofColorCount = proofNonTag.reduce((a, l) => a + ((l.colors || []).length), 0);
  // Add-ons active in Costing but not yet tagged to a specific location still
  // show item-level so they "generate"; tagging one moves it under that print.
  const taggedAddOns = new Set(specLocations.flatMap(l => (l.specialties || [])));
  // The print-ready PSD file row, when one exists — drives the
  // "seeded from PSD" label, the Re-pull button, and the newer-PSD hint.
  const [psdFileMeta, setPsdFileMeta] = useState(null);
  const [psdNewer, setPsdNewer] = useState(false);
  const seededFromRef = useRef(null);
  const lastSavedSpecRef = useRef(null);

  // Best-effort name → hex resolution so typed color names get colored
  // swatches without touching the picker. Unrecognized names fall
  // through to gray (handled in proof-client).
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

  const mockupThumbUrl = mockupFile ? `/api/files/thumbnail?id=${mockupFile.drive_file_id}` : null;

  // Hydrate the proof spec on mount. Saved spec wins — the PSD is
  // never re-parsed silently once a spec exists, so reopening shows
  // exactly what was last saved/sent. Seeding order:
  //   1. items.proof_spec (saved editor state)
  //   2. PSD parse (first open with art)
  //   3. skeleton from costing's print locations (no PSD yet)
  useEffect(() => {
    const psdFiles = activePsdFiles(files);
    const psdFile = psdFiles[0]; // primary — drives the re-pull button + newness hint
    if (psdFile) setPsdFileMeta(psdFile);

    // Drive freshness vs. renderer version: if the Drive PDF was baked with an
    // older renderer (or the proof was never baked), force a re-bake on exit so
    // the current layout reaches Drive without requiring an edit.
    const bakedVer = item.proof_spec?.bakedRendererVersion;
    forceRebakeRef.current = (bakedVer == null || bakedVer < PROOF_RENDERER_VERSION);

    const saved = item.proof_spec;
    if (saved && Array.isArray(saved.locations) && saved.locations.length > 0) {
      setSpecLocations(saved.locations.map(l => ({
        placement: l.placement || "",
        sizeText: l.sizeText || "",
        colors: (l.colors || []).map(c => ({ name: c.name || "", hex: c.hex || null })),
        callout: l.callout || "",
        specialties: Array.isArray(l.specialties) ? l.specialties : [],
      })));
      if (Array.isArray(saved.methods) && saved.methods.length > 0) setMethods(saved.methods);
      if (Array.isArray(saved.instructions)) {
        // Migrate old proofs: any ink Type that was saved as a finishing chip
        // (e.g. Smooth Plastisol Ink) moves out of finishing → the Type pill.
        const typeInInstr = saved.instructions.find(x => TYPE_OPTIONS.includes(x));
        setSelInstructions(saved.instructions.filter(x => !TYPE_OPTIONS.includes(x)));
        if (typeInInstr && !saved.printType) setPrintType(typeInInstr);
      }
      if (typeof saved.notes === "string") setNotes(saved.notes);
      if (typeof saved.summaryText === "string") setSummaryOverride(saved.summaryText);
      if (typeof saved.disclaimer === "string") setDisclaimer(saved.disclaimer);
      if (typeof saved.printType === "string") setPrintType(saved.printType);
      if (saved.mockupCrop && typeof saved.mockupCrop === "object") setMockupCrop(saved.mockupCrop);
      if (saved.colorCountOverride != null) setColorCountOverride(String(saved.colorCountOverride));
      if (saved.locationCountOverride != null) setLocationCountOverride(String(saved.locationCountOverride));
      seededFromRef.current = saved.seededFrom || null;
      // Any PSD uploaded since this spec was seeded → surface a re-pull hint.
      if (saved.seededFrom?.at && psdFiles.some(f => f.created_at && new Date(f.created_at) > new Date(saved.seededFrom.at))) {
        setPsdNewer(true);
      }
      setSpecLoaded(true);
      return;
    }

    if (psdFiles.length) {
      setLoadingPsd(true);
      (async () => {
        try {
          setSpecLocations(await parsePsdFilesToSpec(psdFiles));
          seededFromRef.current = { fileId: psdFile.drive_file_id, fileIds: psdFiles.map(f => f.drive_file_id), at: new Date().toISOString() };
        } catch(e) { console.error("PSD parse error:", e); }
        finally { setLoadingPsd(false); setSpecLoaded(true); }
      })();
      return;
    }

    // No saved spec, no PSD — skeleton from costing's print locations.
    const locs = Object.values(costProd?.printLocations || {})
      .filter(l => l?.location)
      .map(l => ({ placement: l.location, sizeText: "", colors: [], callout: DEFAULT_CALLOUTS[l.location] || "", specialties: [] }));
    setSpecLocations(locs);
    setSpecLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Explicit re-seed from the PSD — replaces names/sizes/colors with a
  // fresh parse (callouts carry over by matching placement name).
  // Method / instructions / notes are untouched.
  async function repullFromPsd() {
    const psdFiles = activePsdFiles(files);
    if (!psdFiles.length || loadingPsd) return;
    const many = psdFiles.length > 1;
    if (!await confirm({ title: "Re-pull from PSD", message: `Re-pull print locations from ${many ? `all ${psdFiles.length} PSDs` : "the PSD"}? Location names, sizes, and colors will be replaced by the PSD parse${many ? " (main art + tag file merged)" : ""}. Placement callouts carry over where names match. Method, instructions, and notes are kept.`, confirmLabel: "Re-pull", confirmColor: T.amber })) return;
    setLoadingPsd(true);
    try {
      const spec = await parsePsdFilesToSpec(psdFiles, specLocations);
      setSpecLocations(spec);
      seededFromRef.current = { fileId: psdFiles[0].drive_file_id, fileIds: psdFiles.map(f => f.drive_file_id), at: new Date().toISOString() };
      setPsdNewer(false);
    } catch (e) { setError("PSD re-pull failed: " + e.message); }
    finally { setLoadingPsd(false); }
  }

  // Persist the spec (silent, debounced) so edits survive reopen —
  // items.proof_spec is the durable record of what the proof says.
  const buildSpec = () => ({
    locations: specLocations,
    methods,
    instructions: selInstructions,
    notes,
    summaryText: summaryOverride,
    seededFrom: seededFromRef.current,
    // Baked display values — so the read-only renderer (proofs tab + client
    // portal) needs NO costing access. proof_spec is self-contained.
    finishing: [...(spec?.finishing || []), ...selInstructions],
    addOns: untaggedAddOns,
    isFleece: !!spec?.isFleece,
    colorCount: kpiColors,
    locationCount: kpiLocations,
    disclaimer,
    printType,
    mockupCrop,
    blankVendor: item.blank_vendor || "",
    blankColor: item.blank_sku || "", // shirt color lives in blank_sku (no items.color column)
  });
  useEffect(() => {
    if (!specLoaded) return;
    const snapshot = JSON.stringify(buildSpec());
    if (snapshot === lastSavedSpecRef.current) return;
    const t = setTimeout(async () => {
      try {
        const spec = JSON.parse(snapshot);
        const { error: err } = await createClient().from("items").update({ proof_spec: spec }).eq("id", item.id);
        if (err) throw err;
        lastSavedSpecRef.current = snapshot;
        if (onUpdateItem) onUpdateItem(item.id, { proof_spec: spec });
      } catch (e) { console.error("Proof spec save error:", e); }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specLoaded, specLocations, methods, selInstructions, notes, summaryOverride, colorCountOverride, locationCountOverride, disclaimer, printType, mockupCrop, costProd?.finishingQtys, costProd?.specialtyQtys, costProd?.isFleece]);

  // Immediate flush for close/save paths — the debounce above could
  // otherwise drop the last edit when the modal unmounts.
  function flushSpecSave() {
    if (!specLoaded) return;
    const snapshot = JSON.stringify(buildSpec());
    if (snapshot === lastSavedSpecRef.current) return;
    lastSavedSpecRef.current = snapshot;
    const spec = JSON.parse(snapshot);
    createClient().from("items").update({ proof_spec: spec }).eq("id", item.id)
      .then(({ error: err }) => {
        if (err) { console.error("Proof spec save error:", err); return; }
        if (onUpdateItem) onUpdateItem(item.id, { proof_spec: spec });
      });
  }

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

  // The tag-filtered, trimmed print info — one transform feeding both
  // the PDF render and the derived summary-bar text, so the sidebar
  // shows exactly the line the PDF will print.
  const buildPrintInfo = () => {
    // WYSIWYG: the PDF renders EXACTLY the edited proof locations — no re-filter.
    // (Tag sizes used to be re-filtered to the order's active sizes here, which
    // diverged from the web view. Tag sizes are now controlled directly by the
    // editor: + Tag seeds them from the item's size set, then add/remove chips.)
    return (specLocations || [])
      .filter(p => (p.placement || "").trim())
      .map(p => ({
        placement: p.placement.trim(),
        sizeText: (p.sizeText || "").trim(),
        colors: p.colors || [],
        callout: p.callout || "",
        specialties: p.specialties || [],
      }));
  };
  const derivedSummary = deriveProofSummary(buildPrintInfo(), selInstructions);
  const summaryText = summaryOverride !== null ? summaryOverride : derivedSummary;
  // The count KPIs (Colors, Locations) read the Summary Bar: auto-derived from
  // the proof/costing/PSD by default, but the team can overwrite the summary to
  // correct a count and the KPIs (and the PDF) follow. Falls back to the raw
  // proof-spec count if the summary line isn't parseable.
  const parseSummaryCount = (re) => { const m = String(summaryText || "").match(re); return m ? parseInt(m[1], 10) : null; };
  // Count live from the Locations section — NOT parsed from the (now-removed)
  // summary text, which went stale and froze the Locations pill. Locations
  // counts EVERY card incl. tags (+ location and + tag both increment); colors
  // stay non-tag (tags carry size chips, not ink colors).
  const kpiLocations = specLocations.length;
  const kpiColors = proofColorCount;
  // Active add-ons for this item come from Costing (the specialties already
  // marked on/charged). The per-location TAG lives on the proof spec; the
  // money/count stays owned by Costing — we never touch pricing here.
  const activeSpecialties = Object.keys(costProd?.specialtyQtys || {})
    .filter(k => k.endsWith("_on") && costProd.specialtyQtys[k] && !k.startsWith("Fleece"))
    .map(k => k.slice(0, -3));
  const untaggedAddOns = activeSpecialties.filter(s => !taggedAddOns.has(s));

  // THE CURE (2026-07-20): the PDF is rendered from ProofDocView (the same
  // component as the web proof) on the server via /api/pdf/proof → Browserless.
  // No more jsPDF second renderer — the web layout IS the PDF layout. Generated
  // on demand (download / exit-bake), not on every keystroke, so Browserless is
  // only hit when a PDF is actually needed. The mockup is pre-cropped to the
  // 2:1 frame here (croppedMockupUrl) and mockupCrop is stripped server-side.
  async function buildProofPdfBlob() {
    const res = await fetch("/api/pdf/proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: buildSpec(),
        itemName: item.name || "",
        clientName: clientName || "",
        brandName: branding.name || "",
        logoSvg: branding.logoSvg || "",
        mockupUrl: croppedMockupUrl || null,
        font, mono,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "PDF generation failed");
    }
    return await res.blob();
  }

  // Set once the spec is loaded — assume the Drive PDF matches the loaded spec.
  useEffect(() => { if (specLoaded && driveBakedSpecRef.current === null) driveBakedSpecRef.current = JSON.stringify(buildSpec()); }, [specLoaded]);
  // Bake the current live PDF into the Drive art folder (supersede-safe via the
  // ref-counted delete). Does NOT close — exit/Download call it. One file: the
  // Drive PDF, the client, the vendor, and Download all read this.
  async function bakeToDrive() {
    if (!specLoaded) return null;
    const safeName = (item.name || "Item").replace(/[^\w\s-]/g, "");
    const specSnap = JSON.stringify(buildSpec());
    // Renderer-forced re-bake of an UNCHANGED proof (layout version bump only):
    // the document's content is identical, so the client's approval must
    // survive — only a real edit resets it to pending.
    const preserveApproval = forceRebakeRef.current && driveBakedSpecRef.current !== null && specSnap === driveBakedSpecRef.current;
    let pdfBlob;
    try { pdfBlob = await buildProofPdfBlob(); }
    catch (err) { console.error("Proof render error:", err); return null; }
    try {
      const driveFile = await uploadToDrive({ blob: pdfBlob, fileName: `${safeName} - Product Proof.pdf`, mimeType: "application/pdf", itemId: item.id, clientName, projectTitle, itemName: item.name || "" });
      await registerFileInDb({ ...driveFile, itemId: item.id, stage: "proof", preserveApproval });
      logJobActivity(item.job_id, `Product proof updated for ${item.name}`);
      driveBakedSpecRef.current = specSnap;
      forceRebakeRef.current = false;
      // Stamp the renderer version onto proof_spec so a future layout bump
      // re-bakes exactly once. (An edit afterward drops the stamp via autosave,
      // which is fine — an edit makes the proof dirty and re-bakes anyway.)
      try {
        const stamped = { ...JSON.parse(specSnap), bakedRendererVersion: PROOF_RENDERER_VERSION };
        await createClient().from("items").update({ proof_spec: stamped }).eq("id", item.id);
        if (onUpdateItem) onUpdateItem(item.id, { proof_spec: stamped });
      } catch (e) { /* stamp is best-effort */ }
      if (onSaved) onSaved();
      return pdfBlob;
    } catch (err) { console.error("Proof upload error:", err); return null; }
  }
  // Dirty since last Drive bake. forceRebakeRef covers the "same spec, stale
  // renderer / never baked" case; otherwise compare the spec snapshot.
  const isDriveDirty = () => driveBakedSpecRef.current !== null && (forceRebakeRef.current || JSON.stringify(buildSpec()) !== driveBakedSpecRef.current);

  // Exit IS the save: bake to Drive if the proof changed, then close. No prompt.
  function handleClose() {
    flushSpecSave();
    if (specLoaded && isDriveDirty()) bakeToDrive(); // fire-and-forget; finishes in background
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onClose(false);
  }

  // Download = the same file that's in Drive. Bake first if there are unbaked
  // edits (reusing that blob), so Download and Drive are provably identical.
  const [downloading, setDownloading] = useState(false);
  async function downloadProof() {
    if (!specLoaded || downloading) return;
    setDownloading(true);
    flushSpecSave();
    try {
      let blob = null;
      if (isDriveDirty()) blob = await bakeToDrive();
      if (!blob) blob = await buildProofPdfBlob();
      const safeName = (item.name || "Item").replace(/[^\w\s-]/g, "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${safeName} - Product Proof.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message || "Download failed"); }
    setDownloading(false);
  }

  const ic = { width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" };
  const lbl = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted, display: "block" };

  // ── Inline editor: map ProofDocView's edit callbacks onto the SAME state +
  // handlers the classic sidebar uses. No new data path — edits flow through
  // setSpecLocations / setSelInstructions / etc., so the debounced proof_spec
  // save + PDF regen are identical whichever layout you edit in.
  const costingFinishing = (spec && Array.isArray(spec.finishing)) ? spec.finishing : [];
  const proofEdit = {
    setNotes,
    methodOptions: METHODS,
    setMethod: (v) => setMethods(v ? [v] : []),
    finishingOptions: INSTRUCTIONS,
    // The first N finishing entries are Costing-derived (not removable here — fix
    // in Costing); only the chip picks after them get a delete ×.
    costingFinishingCount: costingFinishing.length,
    addFinishing: (v) => setSelInstructions(prev => prev.includes(v) ? prev : [...prev, v]),
    // The doc shows [costing finishing, ...chips]; only the chip picks are removable.
    removeFinishing: (i) => { if (i < costingFinishing.length) return; const chip = selInstructions[i - costingFinishing.length]; if (chip != null) setSelInstructions(prev => prev.filter(x => x !== chip)); },
    updateLocation: (i, patch) => setSpecLocations(prev => prev.map((r, k) => k === i ? { ...r, ...patch } : r)),
    addLocation: () => setSpecLocations(prev => [...prev, { placement: "", sizeText: "", colors: [], callout: "", specialties: [] }]),
    addTag: () => { const _tagAll = (item.sizes && item.sizes.length) ? item.sizes : Object.keys(item.qtys || {}); const _tagQ = _tagAll.filter(sz => (item.qtys?.[sz] || 0) > 0); const tagSizes = _tagQ.length ? _tagQ : _tagAll; const ink = getLastTagInk(); setSpecLocations(prev => [...prev, { placement: "Tag", sizeText: "", colors: tagSizes.map(sz => ({ name: sz, hex: ink })), callout: DEFAULT_CALLOUTS["Tag"] || "", specialties: [] }]); },
    removeLocation: (i) => setSpecLocations(prev => prev.filter((_, k) => k !== i)),
    addColor: (i) => setSpecLocations(prev => prev.map((r, k) => k === i ? { ...r, colors: [...(r.colors || []), { name: "", hex: null }] } : r)),
    updateColor: (i, j, patch) => setSpecLocations(prev => prev.map((r, k) => k === i ? { ...r, colors: (r.colors || []).map((c, m) => m === j ? { ...c, ...patch } : c) } : r)),
    removeColor: (i, j) => setSpecLocations(prev => prev.map((r, k) => k === i ? { ...r, colors: (r.colors || []).filter((_, m) => m !== j) } : r)),
    setAllInk: (i, hex) => { setSpecLocations(prev => prev.map((r, k) => k === i ? { ...r, colors: (r.colors || []).map(c => ({ ...c, hex })) } : r)); setLastTagInk(hex); },
    setSummary: (v) => setSummaryOverride(v),
    // Colors pill removed; Locations is now a derived sum (not editable). New
    // Type pill = ink/print type (a child of Method), pick-list + custom.
    typeOptions: TYPE_OPTIONS,
    setType: setPrintType,
    setDisclaimer,
    // Per-location add-on picker — options come LIVE from Costing's applied
    // specialties (activeSpecialties re-derives each render), so ticking one in
    // Costing surfaces it here on reopen with no re-pull. Assignment (which print
    // it belongs to) is stored per location; display-only, no pricing effect.
    addOnOptions: activeSpecialties,
    toggleSpecialty: (i, sp) => setSpecLocations(prev => prev.map((r, k) => k === i ? { ...r, specialties: (r.specialties || []).includes(sp) ? (r.specialties || []).filter(s => s !== sp) : [...(r.specialties || []), sp] } : r)),
    onReplaceMockup: replaceMockupInline,
    mockupReplacing: replacingMockup,
    setMockupCrop,
    resolveHex,
  };
  // Editor sees the effective summary (override ?? auto) so the auto text is
  // visible + editable; Preview/client use the raw buildSpec (auto stays omitted
  // unless committed) — so Preview matches exactly what the client gets.
  const editorSpec = { ...buildSpec(), summaryText: summaryOverride !== null ? summaryOverride : derivedSummary };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 100, display: "flex", flexDirection: "column" }}>
        {confirmEl}
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: font }}>Product Proof — {item.name}</span>
            {generateAllCounter && (
              <span style={{ fontSize: 11, fontWeight: 600, color: T.muted, background: T.surface, padding: "3px 10px", borderRadius: 10 }}>{generateAllCounter}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
              {[["edit", "Edit"], ["preview", "Preview"]].map(([v, l]) => {
                const on = (v === "preview") === previewMode;
                return <button key={v} onClick={() => setPreviewMode(v === "preview")}
                  style={{ border: "none", background: on ? T.text : "transparent", color: on ? "#fff" : T.muted, fontSize: 11, fontWeight: 600, padding: "6px 12px", cursor: "pointer", fontFamily: font }}>{l}</button>;
              })}
            </div>
            {psdFileMeta && (
              <button onClick={repullFromPsd} disabled={loadingPsd} title="Merge in the PSD locations (+ live costing items) — keeps your callouts & notes"
                style={{ border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: loadingPsd ? "default" : "pointer", fontFamily: font, opacity: loadingPsd ? 0.6 : 1 }}>
                {loadingPsd ? "Filling…" : "↻ Auto-fill"}
              </button>
            )}
            <button onClick={downloadProof} disabled={downloading || !specLoaded} title="Download this proof PDF (same file that's saved to Drive)"
              style={{ border: `1px solid ${T.border}`, background: T.card, color: specLoaded ? T.text : T.faint, fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 8, cursor: specLoaded ? "pointer" : "default", fontFamily: font, opacity: downloading ? 0.6 : 1 }}>
              {downloading ? "Preparing…" : "Download"}
            </button>
            <button onClick={handleClose} title="Exit — saves the proof to Drive"
              style={{ border: "none", background: T.text, color: "#fff", fontSize: 12, fontWeight: 700, padding: "7px 16px", borderRadius: 8, cursor: "pointer", fontFamily: font }}>Exit</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", background: T.surface, padding: isMobile ? 16 : "26px 20px" }}>
          <div style={{ maxWidth: 880, margin: "0 auto", background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: isMobile ? 20 : 40 }}>
            {previewMode
              ? <ProofDocView spec={buildSpec()} mockupUrl={mockupDataUrl} clientName={clientName} itemName={item.name} brandName={branding.name} logoSvg={branding.logoSvg} font={font} mono={mono} />
              : <ProofDocView spec={editorSpec} edit={proofEdit} mockupUrl={mockupDataUrl} clientName={clientName} itemName={item.name} brandName={branding.name} logoSvg={branding.logoSvg} font={font} mono={mono} />}
          </div>
        </div>
      </div>
  );
}

// (ItemArtSection / MockupDropZone / the ArtTab component were removed
// 2026-07-17 — dead since the workflow merge; ApprovalsTab imports ProofModal
// only. Full components in git history.)
