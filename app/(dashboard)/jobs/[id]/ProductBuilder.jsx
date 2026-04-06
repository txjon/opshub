"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { logJobActivity } from "@/components/JobActivityPanel";
import { parsePsd, PLACEMENT_MAP, SKIP_GROUPS } from "./ProcessingTab";
import { ItemArtSection } from "./ArtTab";
import { BuySheetTab } from "./BuySheetTab";

/**
 * Product Builder — unified tab combining:
 * - PSD drop zone (from ProcessingTab) at the top
 * - Buy Sheet (BuySheetTab) for blank assignment, sizes, quantities
 * - Per-item art files (from ArtTab) inline below each item
 *
 * The BuySheetTab is rendered as-is with all its auto-save logic preserved.
 * PSD drop creates items and triggers onItemsChanged.
 * Art sections are rendered per-item below the buy sheet.
 */
export function ProductBuilder({ project, items, contacts, onItemsChanged, onRegisterSave, onSaveStatus, onSaved, onUpdateItem }) {
  const supabase = createClient();
  const [processing, setProcessing] = useState({});
  const [dragoverPsd, setDragoverPsd] = useState(false);
  const [showFiles, setShowFiles] = useState({});
  const clientName = project?.clients?.name || "Unknown Client";
  const projectTitle = project?.title || "";

  // Toggle file section visibility per item
  const toggleFiles = (itemId) => {
    setShowFiles(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  // ── PSD Processing (from ProcessingTab) ──
  async function processFile(file) {
    if (!file || !file.name.toLowerCase().endsWith(".psd")) return;

    const itemName = file.name.replace(/\.psd$/i, "").trim();
    setProcessing(p => ({ ...p, new: { status: "Reading PSD...", fileName: file.name } }));

    try {
      const arrayBuffer = await file.arrayBuffer();
      const { locations, hasTag } = await parsePsd(arrayBuffer);

      setProcessing(p => ({ ...p, new: { status: "Creating item...", fileName: file.name } }));

      const sortOrder = (items || []).length;
      const { data: newItem } = await supabase.from("items").insert({
        job_id: project.id,
        name: itemName,
        status: "tbd",
        artwork_status: "not_started",
        sort_order: sortOrder,
      }).select("id").single();

      if (newItem) {
        setProcessing(p => ({ ...p, new: { status: "Uploading to Drive...", fileName: file.name } }));

        const driveFile = await uploadToDrive({
          blob: file, fileName: file.name, mimeType: "application/octet-stream",
          clientName, projectTitle, itemName,
        });
        await registerFileInDb({
          ...driveFile, itemId: newItem.id, stage: "client_art",
          notes: JSON.stringify({ psd_locations: locations, psd_has_tag: hasTag }),
        });

        logJobActivity(project.id, `Item "${itemName}" created from PSD: ${locations.length} location${locations.length !== 1 ? "s" : ""}${hasTag ? " + tag" : ""}`);
      }

      if (onItemsChanged) onItemsChanged();
    } catch (err) {
      console.error("PSD processing error:", err);
    } finally {
      setProcessing(p => { const n = { ...p }; delete n.new; return n; });
    }
  }

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      {/* ── PSD Drop Zone ── */}
      <div
        onDragOver={e => { e.preventDefault(); setDragoverPsd(true); }}
        onDragLeave={() => setDragoverPsd(false)}
        onDrop={e => {
          e.preventDefault(); setDragoverPsd(false);
          const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".psd"));
          for (const f of files) processFile(f);
        }}
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file"; input.accept = ".psd"; input.multiple = true;
          input.onchange = () => { for (const f of Array.from(input.files || [])) processFile(f); };
          input.click();
        }}
        style={{
          border: `2px dashed ${dragoverPsd ? T.accent : T.border}`,
          borderRadius: 10, padding: "14px 20px", marginBottom: 12,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          cursor: "pointer", background: dragoverPsd ? T.accentDim : "transparent",
          transition: "all 0.15s",
        }}
      >
        {processing.new ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.accent }}>{processing.new.status}</div>
            <div style={{ fontSize: 10, color: T.muted }}>{processing.new.fileName}</div>
          </div>
        ) : (
          <>
            <span style={{ fontSize: 16, color: T.faint }}>+</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.accent }}>Drop PSD to create items</span>
            <span style={{ fontSize: 10, color: T.muted }}>or click to browse</span>
          </>
        )}
      </div>

      {/* ── Buy Sheet (full component, all auto-save preserved) ── */}
      <BuySheetTab
        items={items}
        jobId={project.id}
        onRegisterSave={onRegisterSave}
        onSaveStatus={onSaveStatus}
        onSaved={onSaved}
      />

      {/* ── Per-Item Art Files ── */}
      {(items || []).length > 0 && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Art Files
          </div>
          {(items || []).map((item, idx) => (
            <ItemArtSection
              key={item.id}
              item={{ ...item, _index: idx }}
              clientName={clientName}
              projectTitle={projectTitle}
              contacts={contacts || []}
              jobId={project.id}
              costingData={project.costing_data}
              onFilesChanged={() => { if (onItemsChanged) onItemsChanged(); }}
              onUpdateItem={onUpdateItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
