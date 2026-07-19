"use client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConfirm } from "@/components/useConfirm";
import { buildMockupClient, preloadTemplate, extractPrintInfoFromPsd } from "@/lib/mockup-client";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { generateProofPdfClient, deriveProofSummary, preloadLogo } from "@/lib/proof-client";
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
  return extractPrintInfoFromPsd(psd);
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

export function ProofModal({ item, clientName, projectTitle, mockupFile, files, costingData, onClose, onUpdateItem, onSaved, generateAllCounter }) {
  const isMobile = useIsMobile();
  const METHODS = ["Screen Print", "DTF", "Embroidery"];
  const INSTRUCTIONS = ["Bulk Fold", "Piece Package", "Back Design Facing Out", "Smooth Plastisol Ink"];

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
    if (defaultMethod === "Screen Print") instr.push("Smooth Plastisol Ink");
    return instr;
  })();

  const branding = useClientBranding();
  // Ensure tenant logo is loaded for PDF generation
  useEffect(() => { preloadLogo(branding.slug); }, [branding.slug]);

  const [confirm, confirmEl] = useConfirm();
  const [methods, setMethods] = useState([defaultMethod]);
  const [selInstructions, setSelInstructions] = useState(defaultInstructions);
  const [notes, setNotes] = useState("");
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loadingPsd, setLoadingPsd] = useState(false);
  const [mockupDataUrl, setMockupDataUrl] = useState(null);

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
      if (Array.isArray(saved.instructions)) setSelInstructions(saved.instructions);
      if (typeof saved.notes === "string") setNotes(saved.notes);
      if (typeof saved.summaryText === "string") setSummaryOverride(saved.summaryText);
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
    blankVendor: item.blank_vendor || "",
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
  }, [specLoaded, specLocations, methods, selInstructions, notes, summaryOverride, costProd?.finishingQtys, costProd?.specialtyQtys, costProd?.isFleece]);

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
    return (specLocations || [])
      .filter(p => (p.placement || "").trim())
      .map(p => {
        const isTag = (p.placement || "").toLowerCase().trim() === "tag" || (p.placement || "").toLowerCase().trim() === "tags";
        // Tag groups carry one layer per size — only show sizes the
        // order actually includes.
        const colors = (isTag && activeSizesNorm) ? (p.colors || []).filter(c => activeSizesNorm.includes(normalizeSize(c.name))) : (p.colors || []);
        return { placement: p.placement.trim(), sizeText: (p.sizeText || "").trim(), colors, callout: p.callout || "", specialties: p.specialties || [] };
      });
  };
  const derivedSummary = deriveProofSummary(buildPrintInfo(), selInstructions);
  const summaryText = summaryOverride !== null ? summaryOverride : derivedSummary;
  // The count KPIs (Colors, Locations) read the Summary Bar: auto-derived from
  // the proof/costing/PSD by default, but the team can overwrite the summary to
  // correct a count and the KPIs (and the PDF) follow. Falls back to the raw
  // proof-spec count if the summary line isn't parseable.
  const parseSummaryCount = (re) => { const m = String(summaryText || "").match(re); return m ? parseInt(m[1], 10) : null; };
  const kpiLocations = parseSummaryCount(/(\d+)\s*locations?\b/i) ?? proofLocationCount;
  const kpiColors = parseSummaryCount(/(\d+)\s*colors?\b/i) ?? proofColorCount;
  // Active add-ons for this item come from Costing (the specialties already
  // marked on/charged). The per-location TAG lives on the proof spec; the
  // money/count stays owned by Costing — we never touch pricing here.
  const activeSpecialties = Object.keys(costProd?.specialtyQtys || {})
    .filter(k => k.endsWith("_on") && costProd.specialtyQtys[k] && !k.startsWith("Fleece"))
    .map(k => k.slice(0, -3));
  const untaggedAddOns = activeSpecialties.filter(s => !taggedAddOns.has(s));

  // Auto-generate preview whenever inputs change (debounced to avoid lag)
  useEffect(() => {
    if (!mockupDataUrl) return;
    const timer = setTimeout(() => {
      try {
        const printInfo = buildPrintInfo();

        const doc = generateProofPdfClient({
          mockupDataUrl,
          printInfo,
          summaryText: summaryOverride === null ? undefined : summaryOverride,
          clientName: clientName || "",
          itemName: item.name || "",
          blankVendor: item.blank_vendor || "",
          blankStyle: item.blank_sku || "",
          blankColor: item.color || "",
          method: methods.join(", "),
          instructions: selInstructions,
          notes: notes.trim(),
          // KPI + list data — mirrors the web proof view exactly.
          finishing: [...spec.finishing, ...selInstructions],
          addOns: untaggedAddOns,
          fleece: spec.isFleece,
          colorCount: kpiColors,
          locationCount: kpiLocations,
          tenantSlug: branding.slug,
          tenantName: branding.name,
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
  }, [mockupDataUrl, specLocations, methods, selInstructions, notes, summaryOverride, costProd?.specialtyQtys, costProd?.finishingQtys, costProd?.isFleece]);

  async function saveToDrive() {
    if (!pdfDoc) return;
    flushSpecSave();
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
          itemId: item.id,
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

  async function handleClose() {
    flushSpecSave();
    if (previewUrl) {
      if (!await confirm({ title: "Unsaved proof", message: "Save this proof to Drive before closing?", confirmLabel: "Save & close", confirmColor: T.accent })) {
        URL.revokeObjectURL(previewUrl);
        onClose(false);
        return;
      }
      saveToDrive();
    } else {
      onClose(false);
    }
  }

  const ic = { width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, outline: "none", fontFamily: font, boxSizing: "border-box" };
  const lbl = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted, display: "block" };

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
          <button onClick={handleClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: isMobile ? "column" : "row" }}>
          <div style={{ width: isMobile ? "100%" : 400, flexShrink: 0, padding: "18px 22px", overflowY: isMobile ? "visible" : "auto", display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Method toggle buttons */}
            <div>
              <label style={{ ...lbl, marginBottom: 6 }}>Print Method</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                {[...METHODS, ...methods.filter(m => !METHODS.includes(m))].map(m => {
                  const on = methods.includes(m);
                  return (
                    <button key={m} onClick={() => toggleMethod(m)}
                      style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${on ? T.accent : T.border}`, background: on ? T.accentDim : "transparent", color: on ? T.accent : T.faint, fontSize: 12, fontWeight: on ? 600 : 400, cursor: "pointer", fontFamily: font, transition: "all 0.12s" }}>
                      {m}
                    </button>
                  );
                })}
                {addingMethod ? (
                  <input autoFocus value={methodDraft}
                    onChange={e => setMethodDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { const v = methodDraft.trim(); if (v) setMethods([v]); setMethodDraft(""); setAddingMethod(false); }
                      if (e.key === "Escape") { setMethodDraft(""); setAddingMethod(false); }
                    }}
                    onBlur={() => { const v = methodDraft.trim(); if (v) setMethods([v]); setMethodDraft(""); setAddingMethod(false); }}
                    placeholder="Method name…"
                    style={{ ...ic, fontSize: 12, width: 140 }} />
                ) : (
                  <button onClick={() => setAddingMethod(true)}
                    style={{ padding: "6px 12px", borderRadius: 6, border: `1px dashed ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: font }}
                    onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
                    + Custom
                  </button>
                )}
              </div>
            </div>

            {/* Print locations — the editable proof spec. Everything
                here is what the PDF renders; the PSD only seeds it. */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ ...lbl }}>Locations{psdFileMeta && <span style={{ color: T.faint, fontWeight: 400 }}> · seeded from PSD</span>}</label>
                <div style={{ display: "flex", gap: 5 }}>
                  {psdFileMeta && (
                    <button onClick={repullFromPsd} disabled={loadingPsd}
                      title="Replace locations with a fresh parse of the print-ready PSD (callouts carry over)"
                      style={{ fontSize: 10, fontWeight: 600, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "2px 8px", cursor: loadingPsd ? "default" : "pointer", fontFamily: font, opacity: loadingPsd ? 0.6 : 1 }}
                      onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
                      onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
                      {loadingPsd ? "Reading…" : "Re-pull PSD"}
                    </button>
                  )}
                  <button onClick={() => setSpecLocations(prev => [...prev, { placement: "", sizeText: "", colors: [], callout: "", specialties: [] }])}
                    style={{ fontSize: 10, fontWeight: 600, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: font }}
                    onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
                    + Add
                  </button>
                </div>
              </div>
              {psdNewer && (
                <div style={{ fontSize: 10, color: T.amber, background: T.amberDim, borderRadius: 5, padding: "5px 8px", marginBottom: 6, lineHeight: 1.4 }}>
                  A newer PSD was uploaded after these locations were seeded — Re-pull to refresh.
                </div>
              )}
              {loadingPsd && specLocations.length === 0 && <div style={{ fontSize: 11, color: T.muted }}>Reading PSD print data...</div>}
              {!loadingPsd && specLocations.length === 0 && (
                <div style={{ fontSize: 11, color: T.faint, padding: "8px 10px", background: T.surface, borderRadius: 6, textAlign: "center" }}>
                  Click + Add to enter a placement.
                </div>
              )}
              {specLocations.map((p, idx) => {
                const update = (patch) => setSpecLocations(prev => prev.map((row, i) => i === idx ? { ...row, ...patch } : row));
                const updColor = (j, patch) => update({ colors: (p.colors || []).map((cc, k) => k === j ? { ...cc, ...patch } : cc) });
                const remove = () => setSpecLocations(prev => prev.filter((_, i) => i !== idx));
                return (
                  <div key={idx} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 11px", marginBottom: 7, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input value={p.placement} onChange={e => update({ placement: e.target.value })}
                        list={`pi-placement-${idx}`} placeholder="Placement (Front, Back, Tag…)"
                        style={{ ...ic, fontSize: 12, fontWeight: 600, flex: 1 }} />
                      <datalist id={`pi-placement-${idx}`}>{["Front","Full Front","Back","Full Back","Left Chest","Right Chest","Left Sleeve","Right Sleeve","Hood","Pocket","Tag","Tags","Neck"].map(o => <option key={o} value={o} />)}</datalist>
                      <input value={p.sizeText} onChange={e => update({ sizeText: e.target.value })}
                        placeholder={`W" × H"`} title="Print size — freeform, flows to the PDF as-is"
                        style={{ ...ic, fontSize: 11, width: 92, fontFamily: mono }} />
                      <button onClick={remove} title="Remove placement"
                        style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 14, padding: "0 2px" }}
                        onMouseEnter={e => e.currentTarget.style.color = T.red}
                        onMouseLeave={e => e.currentTarget.style.color = T.faint}>✕</button>
                    </div>
                    {/* Color chips — freeform names (pantones, "Base",
                        separations); the swatch opens a color picker. */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                      {(p.colors || []).map((c, j) => (
                        <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 8px" }}>
                          {hasEyeDropper ? (
                            <button title="Click to eyedrop a color"
                              onClick={async () => {
                                try { const res = await new window.EyeDropper().open(); if (res?.sRGBHex) updColor(j, { hex: res.sRGBHex }); } catch { /* cancelled */ }
                              }}
                              style={{ width: 26, height: 26, borderRadius: 6, background: c.hex || "#9aa0ae", border: `1px solid ${T.border}`, cursor: "pointer", flexShrink: 0, padding: 0 }} />
                          ) : (
                            <label title="Swatch color — click to pick"
                              style={{ width: 26, height: 26, borderRadius: 6, background: c.hex || "#9aa0ae", border: `1px solid ${T.border}`, cursor: "pointer", flexShrink: 0, display: "inline-block", position: "relative", overflow: "hidden" }}>
                              <input type="color" value={c.hex || "#9aa0ae"}
                                onChange={e => updColor(j, { hex: e.target.value })}
                                style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer", border: "none", padding: 0 }} />
                            </label>
                          )}
                          <input value={c.name}
                            onChange={e => {
                              const name = e.target.value;
                              // Auto-resolve a swatch from recognized names
                              // until the user explicitly picks one.
                              const auto = !c.hex ? resolveHex(name) : null;
                              updColor(j, auto ? { name, hex: auto } : { name });
                            }}
                            placeholder="Color"
                            style={{ background: "transparent", border: "none", outline: "none", color: T.text, fontSize: 12.5, fontFamily: font, width: `${Math.min(Math.max((c.name || "").length + 1, 6), 22)}ch` }} />
                          <button onClick={() => update({ colors: (p.colors || []).filter((_, k) => k !== j) })} title="Remove color"
                            style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1 }}
                            onMouseEnter={e => e.currentTarget.style.color = T.red}
                            onMouseLeave={e => e.currentTarget.style.color = T.faint}>×</button>
                        </span>
                      ))}
                      <button onClick={() => update({ colors: [...(p.colors || []), { name: "", hex: null }] })}
                        style={{ fontSize: 10, fontWeight: 600, color: T.muted, background: "none", border: `1px dashed ${T.border}`, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: font }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
                        + color
                      </button>
                    </div>
                    <input value={p.callout || ""} onChange={e => update({ callout: e.target.value })}
                      placeholder="Placement callout…"
                      style={{ ...ic, fontSize: 11 }} />
                    {/* Per-location add-ons — options come from Costing's active
                        specialties; the tag rides on the proof spec only. */}
                    {activeSpecialties.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 2 }}>Add-ons</span>
                        {activeSpecialties.map(sp => {
                          const on = (p.specialties || []).includes(sp);
                          return (
                            <button key={sp}
                              onClick={() => update({ specialties: on ? (p.specialties || []).filter(s => s !== sp) : [...(p.specialties || []), sp] })}
                              style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, color: on ? T.accent : T.muted, background: on ? T.accentDim : "transparent", border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: font, transition: "all 0.12s" }}>
                              {on ? "✓ " : "+ "}{sp}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Special instructions toggle buttons */}
            <div>
              <label style={{ ...lbl, marginBottom: 6 }}>Special Instructions</label>
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

            {/* Summary bar — pre-loaded with the derived line ("2
                locations · 6 colors · …"); typing makes it custom,
                Auto reverts. Clearing the field omits the bar. */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ ...lbl }}>Summary Bar{summaryOverride !== null && <span style={{ color: T.amber, fontWeight: 600 }}> · custom</span>}</label>
                {summaryOverride !== null && (
                  <button onClick={() => setSummaryOverride(null)}
                    title="Revert to the auto-derived summary (updates live with locations + instructions)"
                    style={{ fontSize: 10, fontWeight: 600, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: font }}
                    onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}>
                    ↺ Auto
                  </button>
                )}
              </div>
              <textarea value={summaryOverride !== null ? summaryOverride : derivedSummary}
                onChange={e => setSummaryOverride(e.target.value)}
                rows={2} placeholder="Leave empty to omit the bar"
                style={{ ...ic, fontSize: 11, resize: "vertical", lineHeight: 1.4, color: summaryOverride !== null ? T.text : T.muted }} />
            </div>

            {/* Notes */}
            <div>
              <label style={{ ...lbl, marginBottom: 3 }}>Special Instructions</label>
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

          <div style={{
            flex: 1,
            borderLeft: isMobile ? "none" : `1px solid ${T.border}`,
            borderTop: isMobile ? `1px solid ${T.border}` : "none",
            background: T.surface,
            display: "flex", alignItems: "stretch", justifyContent: "center",
            minHeight: isMobile ? 480 : "auto",
          }}>
            {/* Web-first proof view — a clean on-screen render of the same spec.
                Fits a laptop, no PDF scrolling. The PDF still generates on Save
                (that's the vendor's printable document). First step toward web-first. */}
            {mockupDataUrl || specLocations.length > 0 ? (
              <div style={{ flex: 1, minWidth: 0, width: "100%", overflowY: "auto", background: "#fff", padding: isMobile ? 16 : 28 }}>
                <ProofDocView spec={buildSpec()} mockupUrl={mockupDataUrl} clientName={clientName} itemName={item.name} font={font} mono={mono} />
              </div>
            ) : (
              <div style={{ fontSize: 11, color: T.faint, alignSelf: "center" }}>Generating preview…</div>
            )}
          </div>
        </div>
      </div>
  );
}

// (ItemArtSection / MockupDropZone / the ArtTab component were removed
// 2026-07-17 — dead since the workflow merge; ApprovalsTab imports ProofModal
// only. Full components in git history.)
