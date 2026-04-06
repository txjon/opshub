"use client";
import { useState, useEffect, useRef } from "react";
import { T, font, mono, sortSizes } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { logJobActivity } from "@/components/JobActivityPanel";

export const PLACEMENT_MAP = { 'Front':'Full Front','Full Front':'Full Front','Back':'Full Back','Full Back':'Full Back','Left Chest':'Left Chest','Right Chest':'Right Chest','Left Sleeve':'Left Sleeve','Right Sleeve':'Right Sleeve','Neck':'Neck','Hood':'Hood','Pocket':'Pocket' };
export const SKIP_GROUPS = ['Shirt Color','Shadows','Highlights','Mask','Client Art'];

export async function parsePsd(arrayBuffer) {
  const { readPsd } = await import("ag-psd");
  const psd = readPsd(new Uint8Array(arrayBuffer));
  const groups = [...(psd.children || [])].reverse();
  const locations = [];
  let hasTag = false;

  for (const group of groups) {
    if (SKIP_GROUPS.includes(group.name)) continue;
    const isTag = (group.name || "").toLowerCase() === "tag" || (group.name || "").toLowerCase() === "tags";
    if (isTag) { hasTag = true; continue; }
    if (!group.children || group.children.length === 0) continue;

    const colors = group.children
      .filter(l => !SKIP_GROUPS.includes(l.name) && l.name)
      .map(l => l.name);

    locations.push({
      placement: PLACEMENT_MAP[group.name] || group.name,
      colorCount: colors.length,
      colorNames: colors,
    });
  }

  return { locations, hasTag };
}

export function ProcessingTab({ project, items, onItemsChanged }) {
  const [slots, setSlots] = useState([]);
  const [processing, setProcessing] = useState({});
  const [dragoverSlot, setDragoverSlot] = useState(null);
  const [dragoverNew, setDragoverNew] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const supabase = createClient();
  const clientName = project?.clients?.name || "Unknown Client";
  const projectTitle = project?.title || "";

  // Load existing items and check for PSD files
  useEffect(() => {
    (async () => {
      const ids = (items || []).map(it => it.id);
      let psdByItem = {};
      if (ids.length > 0) {
        const { data: psdFiles } = await supabase.from("item_files").select("item_id, file_name, drive_file_id").in("item_id", ids).ilike("file_name", "%.psd");
        for (const f of (psdFiles || [])) { if (!psdByItem[f.item_id]) psdByItem[f.item_id] = f; }
      }
      const existing = (items || []).map(it => ({
        itemId: it.id,
        name: it.name,
        fileName: psdByItem[it.id]?.file_name || null,
        locations: [],
        hasTag: false,
        uploaded: true,
        needsParse: !!psdByItem[it.id],
        driveFileId: psdByItem[it.id]?.drive_file_id || null,
      }));
      setSlots(existing);

      // Background: parse PSDs for items that have them
      for (const slot of existing) {
        if (!slot.driveFileId) continue;
        try {
          const res = await fetch(`/api/files/thumbnail?id=${slot.driveFileId}`);
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          const { locations, hasTag } = await parsePsd(buf);
          setSlots(prev => prev.map(s => s.itemId === slot.itemId ? { ...s, locations, hasTag, needsParse: false } : s));
        } catch {}
      }
    })();
  }, [items]);

  async function processFile(file, slotIdx) {
    if (!file || !file.name.toLowerCase().endsWith(".psd")) return;

    const itemName = file.name.replace(/\.psd$/i, "").trim();
    setProcessing(p => ({ ...p, [slotIdx ?? "new"]: { status: "Reading PSD...", fileName: file.name } }));

    try {
      // Parse PSD
      const arrayBuffer = await file.arrayBuffer();
      const { locations, hasTag } = await parsePsd(arrayBuffer);

      if (slotIdx !== undefined && slotIdx !== null && slots[slotIdx]) {
        // Update existing slot
        const slot = slots[slotIdx];
        setProcessing(p => ({ ...p, [slotIdx]: { status: "Uploading to Drive...", fileName: file.name } }));

        // Upload to Drive
        const driveFile = await uploadToDrive({
          blob: file, fileName: file.name, mimeType: "application/octet-stream",
          clientName, projectTitle, itemName: slot.name,
        });
        await registerFileInDb({ ...driveFile, itemId: slot.itemId, stage: "client_art", notes: JSON.stringify({ psd_locations: locations, psd_has_tag: hasTag }) });

        setSlots(prev => prev.map((s, i) => i === slotIdx ? { ...s, fileName: file.name, locations, hasTag, uploaded: true } : s));
        logJobActivity(project.id, `PSD processed for ${slot.name}: ${locations.length} location${locations.length !== 1 ? "s" : ""}`);
      } else {
        // Create new item
        setProcessing(p => ({ ...p, new: { status: "Creating item...", fileName: file.name } }));

        const sortOrder = items.length + slots.filter(s => !items.find(it => it.id === s.itemId)).length;
        const { data: newItem } = await supabase.from("items").insert({
          job_id: project.id,
          name: itemName,
          status: "tbd",
          artwork_status: "not_started",
          sort_order: sortOrder,
        }).select("id").single();

        if (newItem) {
          setProcessing(p => ({ ...p, new: { status: "Uploading to Drive...", fileName: file.name } }));

          // Upload to Drive
          const driveFile = await uploadToDrive({
            blob: file, fileName: file.name, mimeType: "application/octet-stream",
            clientName, projectTitle, itemName,
          });
          await registerFileInDb({ ...driveFile, itemId: newItem.id, stage: "client_art", notes: JSON.stringify({ psd_locations: locations, psd_has_tag: hasTag }) });

          setSlots(prev => [...prev, {
            itemId: newItem.id, name: itemName, fileName: file.name,
            locations, hasTag, uploaded: true,
          }]);

          logJobActivity(project.id, `Item "${itemName}" created from PSD: ${locations.length} location${locations.length !== 1 ? "s" : ""}${hasTag ? " + tag" : ""}`);
        }
      }

      if (onItemsChanged) onItemsChanged();
    } catch (err) {
      console.error("PSD processing error:", err);
    } finally {
      setProcessing(p => { const n = { ...p }; delete n[slotIdx ?? "new"]; return n; });
    }
  }

  async function handleReorder(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const newSlots = [...slots];
    const [moved] = newSlots.splice(fromIdx, 1);
    newSlots.splice(toIdx, 0, moved);
    setSlots(newSlots);
    setDragIdx(null);
    setDragOverIdx(null);
    // Update sort orders in DB
    for (let i = 0; i < newSlots.length; i++) {
      if (newSlots[i].itemId) {
        await supabase.from("items").update({ sort_order: i }).eq("id", newSlots[i].itemId);
      }
    }
    if (onItemsChanged) onItemsChanged();
  }

  async function removeSlot(idx) {
    const slot = slots[idx];
    if (!slot) return;
    if (!window.confirm(`Remove "${slot.name}" and its buy sheet item?`)) return;

    // Delete item + related data
    if (slot.itemId) {
      await supabase.from("buy_sheet_lines").delete().eq("item_id", slot.itemId);
      await supabase.from("item_files").delete().eq("item_id", slot.itemId);
      await supabase.from("decorator_assignments").delete().eq("item_id", slot.itemId);
      await supabase.from("items").delete().eq("id", slot.itemId);
    }

    setSlots(prev => prev.filter((_, i) => i !== idx));
    if (onItemsChanged) onItemsChanged();
  }

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 12 }}>
        Drop PSD files to create items. Each file becomes a line item with print locations auto-detected.
      </div>

      {/* Existing items grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: 10 }}>
        {slots.map((slot, idx) => (
          <div key={slot.itemId || idx}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={e => { e.preventDefault(); if (dragIdx !== null) setDragOverIdx(idx); else setDragoverSlot(idx); }}
            onDragLeave={() => { setDragoverSlot(null); setDragOverIdx(null); }}
            onDrop={e => { e.preventDefault(); setDragoverSlot(null); if (dragIdx !== null) { handleReorder(dragIdx, idx); } else { processFile(e.dataTransfer.files[0], idx); } }}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
            style={{
              background: T.card, border: `1px solid ${dragOverIdx === idx ? T.accent : dragoverSlot === idx ? T.accent : T.border}`,
              borderRadius: 10, padding: "14px", position: "relative",
              transition: "border-color 0.15s", cursor: "grab",
              opacity: dragIdx === idx ? 0.5 : 1,
            }}>
            {/* Remove button */}
            <button onClick={() => removeSlot(idx)}
              style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 12 }}
              onMouseEnter={e => (e.currentTarget.style.color = T.red)}
              onMouseLeave={e => (e.currentTarget.style.color = T.faint)}>✕</button>

            {/* Drag handle + Item number */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ color: T.faint, fontSize: 12, cursor: "grab", userSelect: "none" }}>⠿</span>
              <span style={{
                width: 22, height: 22, borderRadius: 5, background: T.accentDim,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono,
              }}>
                {String.fromCharCode(65 + idx)}
              </span>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{slot.name}</div>
            </div>

            {/* PSD file info + thumbnail */}
            {slot.fileName && (
              <div style={{ fontSize: 10, color: T.faint, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                {slot.driveFileId && (
                  <img src={`/api/files/thumbnail?id=${slot.driveFileId}`} style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover", border: `1px solid ${T.border}`, flexShrink: 0 }}
                    onError={e => { e.target.style.display = "none"; }} />
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slot.fileName}</span>
              </div>
            )}

            {/* Print locations */}
            {slot.locations && slot.locations.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {slot.locations.map((loc, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: T.surface, borderRadius: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{loc.placement}</span>
                    <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>{loc.colorCount} color{loc.colorCount !== 1 ? "s" : ""}</span>
                  </div>
                ))}
                {slot.hasTag && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: T.surface, borderRadius: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.amber }}>Tag</span>
                    <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>tag print</span>
                  </div>
                )}
              </div>
            )}

            {/* Color names */}
            {slot.locations && slot.locations.some(l => l.colorNames?.length > 0) && (
              <div style={{ marginTop: 6, display: "flex", gap: 3, flexWrap: "wrap" }}>
                {[...new Set(slot.locations.flatMap(l => l.colorNames || []))].map((c, i) => (
                  <span key={i} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: T.surface, color: T.muted, border: `1px solid ${T.border}` }}>{c}</span>
                ))}
              </div>
            )}

            {/* Processing indicator */}
            {processing[idx] && (
              <div style={{ marginTop: 8, fontSize: 10, color: T.accent }}>{processing[idx].status}</div>
            )}
          </div>
        ))}

        {/* New item drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragoverNew(true); }}
          onDragLeave={() => setDragoverNew(false)}
          onDrop={e => { e.preventDefault(); setDragoverNew(false); const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".psd")); for (const f of files) processFile(f, null); }}
          onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = ".psd"; input.multiple = true; input.onchange = () => { for (const f of Array.from(input.files || [])) processFile(f, null); }; input.click(); }}
          style={{
            minHeight: 120, border: `2px dashed ${dragoverNew ? T.accent : T.border}`,
            borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            cursor: "pointer", background: dragoverNew ? T.accentDim : "transparent", transition: "all 0.15s",
          }}>
          {processing.new ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.accent, marginBottom: 2 }}>{processing.new.status}</div>
              <div style={{ fontSize: 10, color: T.muted }}>{processing.new.fileName}</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 20, color: T.faint, marginBottom: 4 }}>+</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.accent }}>Drop PSD</div>
              <div style={{ fontSize: 10, color: T.muted }}>or click to browse</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
