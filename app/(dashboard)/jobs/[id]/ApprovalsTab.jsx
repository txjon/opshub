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
  const [sendingProofEmail, setSendingProofEmail] = useState(false);
  const [proofEmailSent, setProofEmailSent] = useState(false);

  async function sendProofForReview() {
    if (!window.confirm("Send a proof-review email to the client? They'll get a link to the portal to approve or request changes.")) return;
    setSendingProofEmail(true);
    try {
      await fetch("/api/email/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, type: "proof_ready" }),
      });
      logJobActivity(job.id, "Proof review email sent to client");
      setProofEmailSent(true);
      setTimeout(() => setProofEmailSent(false), 3000);
    } catch (e) {
      console.error("Proof email send failed", e);
    }
    setSendingProofEmail(false);
  }

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" };
  const clientName = job?.clients?.name || "";
  const projectTitle = job?.title || "";

  // proofStatus.allApproved is OR'd with manualApproved in page.tsx (for
  // lifecycle gates). Here we need honest per-item file-level approval, so we
  // recompute from itemFiles loaded below rather than trust proofStatus.

  // Load files for all items to find mockups for proof generation
  useEffect(() => {
    const ids = items.map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
    if (ids.length === 0) return;
    supabase.from("item_files").select("*").in("item_id", ids).is("superseded_at", null).then(({ data }) => {
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
    supabase.from("item_files").select("*").in("item_id", ids).is("superseded_at", null).then(({ data }) => {
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

  // Honest file-level approval — proof files exist and all are approved.
  // Distinct from manualApproved (artwork_status override).
  const fileApprovedByItem = {};
  for (const it of items) {
    const files = itemFiles[it.id] || [];
    const proofs = files.filter(f => f.stage === "proof");
    fileApprovedByItem[it.id] = proofs.length > 0 && proofs.every(f => f.approval === "approved");
  }
  const fileApprovedCount = items.filter(it => fileApprovedByItem[it.id]).length;
  const internalOnlyCount = items.filter(it => !fileApprovedByItem[it.id] && it.artwork_status === "approved").length;
  const approvedCount = fileApprovedCount + internalOnlyCount;
  const allApproved = items.length > 0 && approvedCount === items.length;

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
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((item, i) => {
            const files = itemFiles[item.id] || [];
            const proofFiles = files.filter(f => f.stage === "proof");
            const hasProof = proofFiles.length > 0;
            const fileApproved = fileApprovedByItem[item.id];
            const manualApproved = item.artwork_status === "approved";
            const isApproved = fileApproved || manualApproved;
            const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"));
            const revisionRequested = proofFiles.some(f => f.approval === "revision_requested");
            const pendingClient = hasProof && !fileApproved && !revisionRequested;
            const internalOnly = !fileApproved && manualApproved;

            // Clean status pill — short labels, softer colors
            let pillText = "No proof";
            let pillColor = T.faint;
            let pillBg = "transparent";
            if (fileApproved)          { pillText = "Client approved"; pillColor = T.green; pillBg = T.greenDim; }
            else if (revisionRequested){ pillText = "Revision";        pillColor = T.amber; pillBg = T.amberDim; }
            else if (internalOnly)     { pillText = "Internal";        pillColor = T.green; pillBg = T.greenDim; }
            else if (pendingClient)    { pillText = "Pending client";  pillColor = T.accent; pillBg = T.accentDim; }

            const metaLink = {
              padding: 0, background: "transparent", border: "none",
              color: T.faint, cursor: "pointer", fontFamily: font, fontSize: 10,
              fontWeight: 500,
            };

            return (
              <div key={item.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px",
                  background: T.card,
                  borderRadius: 8,
                  border: `1px solid ${isApproved ? T.green + "33" : T.border}`,
                  boxShadow: isApproved ? "none" : "0 1px 2px rgba(0,0,0,0.02)",
                }}>
                {/* Letter badge — small circle */}
                <span style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: isApproved ? T.greenDim : T.surface,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700,
                  color: isApproved ? T.green : T.muted,
                  fontFamily: mono, flexShrink: 0,
                }}>
                  {String.fromCharCode(65 + i)}
                </span>

                {/* Name + inline meta actions */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: T.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    letterSpacing: "-0.01em",
                  }} title={item.name}>
                    {item.name}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                    {hasProof && mockupFile && (
                      <button
                        onClick={() => setProofModalItem(item)}
                        style={metaLink}
                        onMouseEnter={e => (e.currentTarget.style.color = T.accent)}
                        onMouseLeave={e => (e.currentTarget.style.color = T.faint)}
                      >↻ Regenerate</button>
                    )}
                    {!fileApproved && (
                      <button
                        onClick={async () => {
                          const newStatus = manualApproved ? "not_started" : "approved";
                          await supabase.from("items").update({ artwork_status: newStatus }).eq("id", item.id);
                          if (onUpdateItem) onUpdateItem(item.id, { artwork_status: newStatus });
                          if (newStatus === "approved") logJobActivity(job.id, `${item.name} approved internally`);
                          if (onRecalcPhase) setTimeout(onRecalcPhase, 300);
                        }}
                        style={metaLink}
                        onMouseEnter={e => (e.currentTarget.style.color = manualApproved ? T.red : T.green)}
                        onMouseLeave={e => (e.currentTarget.style.color = T.faint)}
                      >{manualApproved ? "Unmark internal" : "Mark internal"}</button>
                    )}
                  </div>
                </div>

                {/* Status pill */}
                <span style={{
                  padding: "3px 9px", borderRadius: 99,
                  fontSize: 10, fontWeight: 600,
                  color: pillColor, background: pillBg,
                  whiteSpace: "nowrap", flexShrink: 0,
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                  {fileApproved || internalOnly ? <span style={{ fontSize: 9 }}>✓</span> : null}
                  {revisionRequested ? <span style={{ fontSize: 9 }}>⚠</span> : null}
                  {pillText}
                </span>

                {/* Primary action */}
                {hasProof ? (
                  <button onClick={() => setPreviewProofItem(proofFiles[0])}
                    style={{
                      padding: "7px 14px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                      border: `1px solid ${T.border}`, cursor: "pointer",
                      background: T.card, color: T.text, flexShrink: 0,
                      fontFamily: font, transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accent; e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.card; e.currentTarget.style.color = T.text; }}>
                    View proof
                  </button>
                ) : mockupFile ? (
                  <button onClick={() => setProofModalItem(item)}
                    style={{
                      padding: "7px 14px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                      border: "none", cursor: "pointer",
                      background: T.amber, color: "#fff", flexShrink: 0,
                      fontFamily: font,
                    }}>
                    Generate
                  </button>
                ) : (
                  <span style={{ fontSize: 10, color: T.faint, padding: "6px 10px", flexShrink: 0, whiteSpace: "nowrap" }}>Needs mockup</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div style={{ display: "flex", gap: 8, alignSelf: "flex-start", flexWrap: "wrap" }}>
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
        {(() => {
          const anyProofs = items.some(it => (itemFiles[it.id] || []).some(f => f.stage === "proof"));
          if (!anyProofs) return null;
          return (
            <button onClick={sendProofForReview} disabled={sendingProofEmail}
              style={{ padding: "10px 20px", borderRadius: 8, border: "none",
                cursor: sendingProofEmail ? "default" : "pointer",
                background: proofEmailSent ? T.greenDim : T.blue,
                color: proofEmailSent ? T.green : "#fff",
                fontSize: 12, fontWeight: 700, fontFamily: font,
                opacity: sendingProofEmail ? 0.6 : 1,
                transition: "opacity 0.15s" }}>
              {sendingProofEmail ? "Sending…" : proofEmailSent ? "✓ Sent to client" : "Send proofs to client for review"}
            </button>
          );
        })()}
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
