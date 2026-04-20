"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";
import { ProofModal } from "./ArtTab";

export function ApprovalsTab({ job, items, contacts, proofStatus, onUpdateItem, onRecalcPhase }) {
  const supabase = createClient();
  const [showProofEmail, setShowProofEmail] = useState(false);
  const [proofModalItem, setProofModalItem] = useState(null);
  const [itemFiles, setItemFiles] = useState({});

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" };
  const clientName = job?.clients?.name || "";
  const projectTitle = job?.title || "";

  const fileApprovedCount = items.filter(it => proofStatus[it.id]?.allApproved).length;
  const internalOnlyCount = items.filter(it => !proofStatus[it.id]?.allApproved && it.artwork_status === "approved").length;
  const approvedCount = fileApprovedCount + internalOnlyCount;
  const allApproved = items.length > 0 && approvedCount === items.length;

  // Load files for all items to find mockups for proof generation
  useEffect(() => {
    const ids = items.map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
    if (ids.length === 0) return;
    supabase.from("item_files").select("*").in("item_id", ids).then(({ data }) => {
      const byItem = {};
      for (const f of (data || [])) {
        if (!byItem[f.item_id]) byItem[f.item_id] = [];
        byItem[f.item_id].push(f);
      }
      setItemFiles(byItem);
    });
  }, [items]);

  function reloadFiles() {
    const ids = items.map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
    if (ids.length === 0) return;
    supabase.from("item_files").select("*").in("item_id", ids).then(({ data }) => {
      const byItem = {};
      for (const f of (data || [])) {
        if (!byItem[f.item_id]) byItem[f.item_id] = [];
        byItem[f.item_id].push(f);
      }
      setItemFiles(byItem);
    });
  }

  const [previewProofItem, setPreviewProofItem] = useState(null);

  // Generate All state
  const [generateAllItems, setGenerateAllItems] = useState([]);
  const [generateAllIndex, setGenerateAllIndex] = useState(0);
  const isGenerateAll = generateAllItems.length > 0;
  const generateAllCurrent = isGenerateAll ? generateAllItems[generateAllIndex] : null;

  // Items eligible for Generate All: have a mockup file
  const itemsWithMockups = items.filter(item => {
    const files = itemFiles[item.id] || [];
    return files.some(f => f.stage === "mockup" || f.file_name?.toLowerCase().includes("mockup"));
  });

  function startGenerateAll() {
    if (itemsWithMockups.length === 0) return;
    setGenerateAllItems(itemsWithMockups);
    setGenerateAllIndex(0);
  }

  function handleGenerateAllClose(saved) {
    if (saved) {
      // User saved — advance to next item
      const nextIdx = generateAllIndex + 1;
      if (nextIdx < generateAllItems.length) {
        setGenerateAllIndex(nextIdx);
      } else {
        // All done
        setGenerateAllItems([]);
        setGenerateAllIndex(0);
      }
    } else {
      // User cancelled — stop the sequence
      setGenerateAllItems([]);
      setGenerateAllIndex(0);
    }
  }

  function handleGenerateAllSaved() {
    reloadFiles();
  }

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Proof Approvals ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Proof Approvals</div>
          <span style={{ fontSize: 11, fontWeight: 600, color: allApproved ? T.green : T.amber }}>
            {approvedCount}/{items.length} approved{internalOnlyCount > 0 ? ` · ${internalOnlyCount} internal` : ""}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((item, i) => {
            const fileApproved = proofStatus[item.id]?.allApproved;
            const manualApproved = item.artwork_status === "approved";
            const isApproved = fileApproved || manualApproved;
            const files = itemFiles[item.id] || [];
            const proofFiles = files.filter(f => f.stage === "proof");
            const hasProof = proofFiles.length > 0;
            const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"));
            const revisionRequested = proofFiles.some(f => f.approval === "revision_requested");
            const pendingClient = hasProof && !fileApproved && !revisionRequested;
            const internalOnly = !fileApproved && manualApproved;

            let pillText = "No proof yet";
            let pillColor = T.faint;
            let pillBg = "transparent";
            let pillBorder = T.border;
            if (fileApproved) { pillText = "✓ Approved by client"; pillColor = T.green; pillBg = T.greenDim; pillBorder = T.green + "44"; }
            else if (revisionRequested) { pillText = "⚠ Revision requested"; pillColor = T.amber; pillBg = T.amber + "22"; pillBorder = T.amber + "44"; }
            else if (internalOnly) { pillText = "✓ Approved (internal)"; pillColor = T.green; pillBg = T.greenDim; pillBorder = T.green + "44"; }
            else if (pendingClient) { pillText = "Pending client review"; pillColor = T.accent; pillBg = T.accentDim; pillBorder = T.accent + "44"; }

            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: T.surface, borderRadius: 6, border: `1px solid ${isApproved ? T.green + "44" : T.border}` }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: T.muted, display: "flex", gap: 10, marginTop: 2 }}>
                    {hasProof && mockupFile && (
                      <button onClick={() => setProofModalItem(item)}
                        style={{ padding: 0, background: "transparent", border: "none", color: T.muted, cursor: "pointer", fontFamily: font, fontSize: 10, textDecoration: "underline" }}>
                        Regenerate
                      </button>
                    )}
                    {!fileApproved && (
                      <button onClick={async () => {
                        const newStatus = manualApproved ? "not_started" : "approved";
                        await supabase.from("items").update({ artwork_status: newStatus }).eq("id", item.id);
                        if (onUpdateItem) onUpdateItem(item.id, { artwork_status: newStatus });
                        if (newStatus === "approved") logJobActivity(job.id, `${item.name} approved internally`);
                        if (onRecalcPhase) setTimeout(onRecalcPhase, 300);
                      }}
                        style={{ padding: 0, background: "transparent", border: "none", color: T.muted, cursor: "pointer", fontFamily: font, fontSize: 10, textDecoration: "underline" }}>
                        {manualApproved ? "Unmark internal approval" : "Mark internally approved"}
                      </button>
                    )}
                  </div>
                </div>
                <span style={{ padding: "3px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, color: pillColor, background: pillBg, border: `1px solid ${pillBorder}`, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {pillText}
                </span>
                {hasProof ? (
                  <button onClick={() => setPreviewProofItem(proofFiles[0])}
                    style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: T.accent, color: "#fff", flexShrink: 0 }}>
                    View Proof
                  </button>
                ) : mockupFile ? (
                  <button onClick={() => setProofModalItem(item)}
                    style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: T.amber, color: "#fff", flexShrink: 0 }}>
                    Generate Proof
                  </button>
                ) : (
                  <span style={{ fontSize: 10, color: T.faint, padding: "6px 14px", flexShrink: 0, whiteSpace: "nowrap" }}>Needs mockup</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div style={{ display: "flex", gap: 8, alignSelf: "flex-start" }}>
        <button onClick={() => {
          const allProofs = items.flatMap(it => (itemFiles[it.id] || []).filter(f => f.stage === "proof"));
          if (allProofs.length > 0) setPreviewProofItem(allProofs[0]);
        }}
          style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
            background: T.accent, color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: font,
            transition: "opacity 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          Preview Proofs
        </button>
        {itemsWithMockups.length > 0 && (
          <button onClick={startGenerateAll}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
              background: T.amber, color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: font,
              transition: "opacity 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            Generate All ({itemsWithMockups.length})
          </button>
        )}
      </div>

      {/* ── Proof Modal (single item) ── */}
      {proofModalItem && !isGenerateAll && (() => {
        const files = itemFiles[proofModalItem.id] || [];
        const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"));
        return (
          <ProofModal
            item={proofModalItem}
            clientName={clientName}
            projectTitle={projectTitle}
            mockupFile={mockupFile}
            files={files}
            costingData={job.costing_data}
            onClose={() => setProofModalItem(null)}
            onSaved={reloadFiles}
            onUpdateItem={onUpdateItem}
          />
        );
      })()}

      {/* ── Proof Modal (Generate All flow) ── */}
      {isGenerateAll && generateAllCurrent && (() => {
        const files = itemFiles[generateAllCurrent.id] || [];
        const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"));
        return (
          <ProofModal
            key={generateAllCurrent.id}
            item={generateAllCurrent}
            clientName={clientName}
            projectTitle={projectTitle}
            mockupFile={mockupFile}
            files={files}
            costingData={job.costing_data}
            onClose={handleGenerateAllClose}
            onSaved={handleGenerateAllSaved}
            onUpdateItem={onUpdateItem}
            generateAllCounter={`${generateAllIndex + 1} of ${generateAllItems.length}`}
          />
        );
      })()}

      {/* Fullscreen proof preview with prev/next */}
      {previewProofItem && (()=>{
        const allProofs = items.flatMap(it => (itemFiles[it.id] || []).filter(f => f.stage === "proof"));
        const currentIdx = allProofs.findIndex(f => f.id === previewProofItem.id);
        const prevProof = currentIdx > 0 ? allProofs[currentIdx - 1] : null;
        const nextProof = currentIdx < allProofs.length - 1 ? allProofs[currentIdx + 1] : null;
        const itemName = items.find(it => it.id === previewProofItem.item_id)?.name || "";
        return (
        <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{itemName}</div>
              <div style={{ fontSize: 11, color: T.muted }}>{currentIdx + 1} of {allProofs.length} proofs</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {prevProof && <button onClick={() => setPreviewProofItem(prevProof)}
                style={{ padding: "8px 16px", borderRadius: 8, background: T.surface, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>← Prev</button>}
              {nextProof && <button onClick={() => setPreviewProofItem(nextProof)}
                style={{ padding: "8px 16px", borderRadius: 8, background: T.surface, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Next →</button>}
              <button onClick={() => setPreviewProofItem(null)}
                style={{ padding: "8px 20px", borderRadius: 8, background: T.surface, border: `1px solid ${T.border}`, color: T.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", background: T.bg, padding: 20 }}>
            {/\.pdf$/i.test(previewProofItem.file_name) ? (
              <iframe src={`/api/files/view/${encodeURIComponent(previewProofItem.file_name)}?id=${previewProofItem.drive_file_id}`}
                style={{ width: "100%", height: "100%", border: "none" }} />
            ) : (
              <img src={`/api/files/thumbnail?id=${previewProofItem.drive_file_id}`}
                alt={previewProofItem.file_name}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
            )}
          </div>
        </div>
        );})()}
    </div>
  );
}
