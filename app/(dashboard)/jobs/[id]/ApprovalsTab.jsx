"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";
import { ProofModal } from "./ArtTab";
import ProofDocView from "@/components/ProofDocView";
import { useIsMobile } from "@/lib/useIsMobile";

export function ApprovalsTab({ job, items, contacts, proofStatus, onUpdateItem, onRecalcPhase }) {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [showProofEmail, setShowProofEmail] = useState(false);
  const [proofModalItem, setProofModalItem] = useState(null);
  const [proofModalMode, setProofModalMode] = useState("edit"); // "preview" (View) | "edit" (Edit/Generate)
  const [itemFiles, setItemFiles] = useState({});
  const [sendingProofEmail, setSendingProofEmail] = useState(false);
  const [replacingMockup, setReplacingMockup] = useState(false);
  const [proofEmailSent, setProofEmailSent] = useState(false);
  const [sendingRevised, setSendingRevised] = useState(false);
  const [revisedModalOpen, setRevisedModalOpen] = useState(false);
  const [revisedNote, setRevisedNote] = useState("");
  const [revisedSelected, setRevisedSelected] = useState({});
  const [proofReviewOpen, setProofReviewOpen] = useState(false);
  const [proofSelected, setProofSelected] = useState({});

  // Open the "Send revised proofs" modal — default-select every contact with an email.
  function openRevisedModal() {
    const sel = {};
    (contacts || []).forEach((c, i) => { if (c.email) sel[i] = true; });
    setRevisedSelected(sel);
    setRevisedNote("");
    setRevisedModalOpen(true);
  }

  // Send the revised proof(s) to the selected contacts with an optional custom
  // note. Distinct "revision ready" email; server clears the
  // revision_pending_send flags; reloadFiles drops the nudge.
  async function submitRevisedProofs() {
    const recipients = (contacts || []).filter((_, i) => revisedSelected[i]).map(c => c.email).filter(Boolean);
    if (recipients.length === 0) return;
    setSendingRevised(true);
    try {
      await fetch("/api/email/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, type: "proof_revised", recipients, note: revisedNote.trim() || undefined }),
      });
      logJobActivity(job.id, `Revised proof(s) sent to client (${recipients.length} recipient${recipients.length === 1 ? "" : "s"})`);
      setRevisedModalOpen(false);
      reloadFiles();
    } catch (e) {
      console.error("Revised proof send failed", e);
    }
    setSendingRevised(false);
  }

  // Open the "Send proofs for review" modal — default-select every contact with an email.
  function sendProofForReview() {
    const sel = {};
    (contacts || []).forEach((c, i) => { if (c.email) sel[i] = true; });
    setProofSelected(sel);
    setProofReviewOpen(true);
  }

  async function submitProofReview() {
    const recipients = (contacts || []).filter((_, i) => proofSelected[i]).map(c => c.email).filter(Boolean);
    if (recipients.length === 0) return;
    setSendingProofEmail(true);
    try {
      await fetch("/api/email/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, type: "proof_ready", recipients }),
      });
      logJobActivity(job.id, `Proof review email sent to client (${recipients.length} recipient${recipients.length === 1 ? "" : "s"})`);
      setProofReviewOpen(false);
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
    if (ids.length === 0) return Promise.resolve();
    return supabase.from("item_files").select("*").in("item_id", ids).is("superseded_at", null).then(({ data }) => {
      const byItem = {};
      for (const f of (data || [])) {
        if (!byItem[f.item_id]) byItem[f.item_id] = [];
        byItem[f.item_id].push(f);
      }
      setItemFiles(byItem);
    });
  }

  // Replace mockup — upload a new one, supersede the old, then reopen the proof
  // generator. ProofModal loads the SAVED proof_spec, so print/proof data is
  // preserved — only the mockup image changes. Closes the "revised proof with an
  // updated mockup" edge case without a trip back to Product Builder.
  async function handleReplaceMockup(item, file) {
    if (!file || replacingMockup) return;
    setReplacingMockup(true);
    try {
      const now = new Date().toISOString();
      const oldMockups = (itemFiles[item.id] || []).filter(f => f.stage === "mockup" && !f.superseded_at);
      for (const m of oldMockups) await supabase.from("item_files").update({ superseded_at: now }).eq("id", m.id);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("itemId", item.id);
      fd.append("stage", "mockup");
      fd.append("clientName", job.clients?.name || "");
      fd.append("projectTitle", job.title || "");
      fd.append("itemName", item.name || "");
      const res = await fetch("/api/files", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      logJobActivity(job.id, `Mockup replaced for ${item.name}`);
      await reloadFiles();
      // Reopen the generator on the new mockup + the saved print spec.
      setPeekItem(null);
      setProofModalItem(item);
    } catch (e) {
      console.error("Replace mockup failed", e);
    }
    setReplacingMockup(false);
  }

  const [peekItem, setPeekItem] = useState(null);

  // Preview flipper — "Preview proofs" opens EVERY item's proof in sequence
  // with prev/next arrows (Jon 2026-07-20; matches the new proofing flow).
  const [previewList, setPreviewList] = useState([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  function openPreviewSequence(startItem) {
    const withProofs = items.filter(it => (itemFiles[it.id] || []).some(f => f.stage === "proof"));
    if (withProofs.length === 0) return;
    const idx = startItem ? Math.max(0, withProofs.findIndex(x => x.id === startItem.id)) : 0;
    setPreviewList(withProofs);
    setPreviewIdx(idx);
    setProofModalMode("preview");
    setProofModalItem(withProofs[idx]);
  }
  const isFlipping = previewList.length > 1 && !!proofModalItem && proofModalMode === "preview";
  function flipPreview(delta) {
    if (!isFlipping) return;
    const n = (previewIdx + delta + previewList.length) % previewList.length;
    setPreviewIdx(n);
    setProofModalItem(previewList[n]);
  }
  useEffect(() => {
    if (!isFlipping) return;
    const h = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      if (e.key === "ArrowRight") flipPreview(1);
      else if (e.key === "ArrowLeft") flipPreview(-1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

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
  // Items whose latest proof was re-uploaded after a client revision request
  // and hasn't been re-sent yet.
  const revisedPendingItems = items.filter(it => (itemFiles[it.id] || []).some(f => f.stage === "proof" && f.revision_pending_send));

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Proof Approvals ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Order items &amp; proofs</div>
          <span style={{ fontSize: 11, fontWeight: 600, color: allApproved ? T.green : T.amber }}>
            {approvedCount}/{items.length} approved{internalOnlyCount > 0 ? ` · ${internalOnlyCount} internal` : ""}
          </span>
        </div>

        {/* Revised-proof nudge — appears after a revised proof is re-uploaded
            for an item the client requested changes on. Staged manual send. */}
        {revisedPendingItems.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", marginBottom: 10, borderRadius: 8, background: T.amber + "14", border: `1px solid ${T.amber}55` }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: T.amber, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>Revised · ready to send</span>
            <span style={{ fontSize: 12, color: T.text, minWidth: 0, flex: 1 }}>
              {revisedPendingItems.length} revised proof{revisedPendingItems.length === 1 ? "" : "s"} not yet sent — {revisedPendingItems.map(it => it.name).join(", ")}
            </span>
            <button onClick={openRevisedModal}
              style={{ flexShrink: 0, padding: "7px 16px", borderRadius: 7, border: "none", cursor: "pointer", background: T.amber, color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: font }}>
              Send revised proofs
            </button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12 }}>
          {items.map((item, i) => {
            const files = itemFiles[item.id] || [];
            const proofFiles = files.filter(f => f.stage === "proof");
            const hasProof = proofFiles.length > 0;
            const fileApproved = fileApprovedByItem[item.id];
            const manualApproved = item.artwork_status === "approved";
            const isApproved = fileApproved || manualApproved;
            const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"));
            const revisionRequested = proofFiles.some(f => f.approval === "revision_requested");
            const revisedPendingSend = proofFiles.some(f => f.revision_pending_send);
            const pendingClient = hasProof && !fileApproved && !revisionRequested && !revisedPendingSend;
            const internalOnly = !fileApproved && manualApproved;

            // Clean status pill — short labels, softer colors
            let pillText = "No proof";
            let pillColor = T.faint;
            if (fileApproved)          { pillText = "Client approved"; pillColor = T.green; }
            else if (revisedPendingSend){ pillText = "Revised · send"; pillColor = T.amber; }
            else if (revisionRequested){ pillText = "Revision";        pillColor = T.amber; }
            else if (internalOnly)     { pillText = "Internal";        pillColor = T.green; }
            else if (pendingClient)    { pillText = "Pending client";  pillColor = T.amber; }

            const qty = Object.values(item.qtys || {}).reduce((a, v) => a + (Number(v) || 0), 0);
            const sell = item.sell_per_unit ? Math.round(item.sell_per_unit).toLocaleString() : null;
            // Mockup first (it exists before a proof does); fall back to the proof.
            const thumbFile = mockupFile || proofFiles[0];
            const thumbId = thumbFile?.drive_file_id;

            // Gallery chip — whole card opens the peek modal (actions live there).
            return (
              <div key={item.id} onClick={() => setPeekItem(item)} style={{ border: `1px solid ${isApproved ? T.green + "44" : T.border}`, borderRadius: 11, overflow: "hidden", background: T.card, display: "flex", flexDirection: "column", cursor: "pointer" }}>
                <div style={{ aspectRatio: "4 / 3", background: "#f2f2f4", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
                  {thumbId
                    ? <img src={`/api/files/thumbnail?id=${thumbId}&thumb=1`} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    : <span style={{ fontSize: 11, color: T.faint }}>No mockup yet</span>}
                  <span style={{ position: "absolute", top: 6, left: 6, width: 20, height: 20, borderRadius: "50%", background: isApproved ? T.greenDim : "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: isApproved ? T.green : T.muted, fontFamily: mono, boxShadow: "0 1px 2px rgba(0,0,0,0.12)" }}>{String.fromCharCode(65 + i)}</span>
                </div>
                <div style={{ padding: "9px 11px 11px", display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.name}>{item.name}</div>
                  <div style={{ fontSize: 13, color: T.text, fontFamily: mono, fontWeight: 600 }}>{qty} × {sell ? `$${sell}` : "—"} : {item.sell_per_unit ? `$${Math.round(item.sell_per_unit * qty).toLocaleString()}` : "—"}</div>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: pillColor }}>
                    {fileApproved || internalOnly ? "✓ " : revisionRequested ? "⚠ " : ""}{pillText}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Batch proof actions — inside the container, matching the quote card's bottom actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
          {(() => {
            const btn = { height: 38, borderRadius: 9, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12.5, fontWeight: 700, fontFamily: font, padding: "0 16px", cursor: "pointer" };
            const anyProofs = items.some(it => (itemFiles[it.id] || []).some(f => f.stage === "proof"));
            return (
              <>
                <button onClick={() => openPreviewSequence()} style={btn}>Preview proofs</button>
                {itemsWithMockups.length > 0 && <button onClick={startGenerateAll} style={btn}>Generate all ({itemsWithMockups.length})</button>}
                {anyProofs && (
                  <button onClick={sendProofForReview} disabled={sendingProofEmail}
                    style={{ ...btn, background: proofEmailSent ? T.greenDim : T.surface, color: proofEmailSent ? T.green : T.text, cursor: sendingProofEmail ? "default" : "pointer", opacity: sendingProofEmail ? 0.6 : 1 }}>
                    {sendingProofEmail ? "Sending…" : proofEmailSent ? "✓ Sent to client" : (isMobile ? "Send for review" : "Send proofs for review")}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* ── Item peek — mirrors the Overview gallery peek; proof actions here ── */}
      {peekItem && (() => {
        const item = items.find(x => x.id === peekItem.id) || peekItem;
        const files = itemFiles[item.id] || [];
        const proofFiles = files.filter(f => f.stage === "proof");
        const hasProof = proofFiles.length > 0;
        const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"));
        const thumbId = (mockupFile || proofFiles[0])?.drive_file_id;
        const fileApproved = fileApprovedByItem[item.id];
        const manualApproved = item.artwork_status === "approved";
        const revisionRequested = proofFiles.some(f => f.approval === "revision_requested");
        const revisedPendingSend = proofFiles.some(f => f.revision_pending_send);
        const pendingClient = hasProof && !fileApproved && !revisionRequested && !revisedPendingSend;
        const internalOnly = !fileApproved && manualApproved;
        let pillText = "No proof", pillColor = T.faint;
        if (fileApproved) { pillText = "Client approved"; pillColor = T.green; }
        else if (revisedPendingSend) { pillText = "Revised · send"; pillColor = T.amber; }
        else if (revisionRequested) { pillText = "Revision requested"; pillColor = T.amber; }
        else if (internalOnly) { pillText = "Internal"; pillColor = T.green; }
        else if (pendingClient) { pillText = "Pending client"; pillColor = T.amber; }
        else if (mockupFile) { pillText = "Awaiting proof"; pillColor = T.amber; }
        const qty = Object.values(item.qtys || {}).reduce((a, v) => a + (Number(v) || 0), 0);
        const sell = item.sell_per_unit ? Math.round(item.sell_per_unit).toLocaleString() : null;
        const q = item.qtys || {};
        const sizes = (item.sizes && item.sizes.length) ? item.sizes : Object.keys(q);
        const btn = { flex: "1 1 auto", padding: "9px 0", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: font };
        const markInternal = async () => {
          const newStatus = manualApproved ? "not_started" : "approved";
          await supabase.from("items").update({ artwork_status: newStatus }).eq("id", item.id);
          if (onUpdateItem) onUpdateItem(item.id, { artwork_status: newStatus });
          if (newStatus === "approved") logJobActivity(job.id, `${item.name} approved internally`);
          if (onRecalcPhase) setTimeout(onRecalcPhase, 300);
          setPeekItem(null);
        };
        return (
          <div onClick={() => setPeekItem(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9998, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto", fontFamily: font }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 14, width: "100%", maxWidth: 480, boxShadow: "0 16px 48px rgba(0,0,0,0.45)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                <button onClick={() => setPeekItem(null)} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ aspectRatio: "16 / 10", background: "#f2f2f4", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                {thumbId ? <img src={`/api/files/thumbnail?id=${thumbId}&thumb=1`} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 12, color: T.faint }}>No mockup yet</span>}
              </div>
              <div style={{ padding: "14px 18px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: pillColor }}>{pillText}</div>
                <div style={{ fontSize: 13, color: T.muted, marginTop: 6, fontFamily: mono }}>{qty} units · {sell ? `$${sell}` : "—"}/unit</div>
                {sizes.length > 0 && <div style={{ fontSize: 12.5, color: T.text, marginTop: 8, fontFamily: mono, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>{sizes.map(s => q[s] ? <span key={s}>{s}:{q[s]}</span> : null)}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                  {hasProof ? (
                    <button onClick={() => { openPreviewSequence(item); setPeekItem(null); }} style={{ ...btn, background: T.accent, color: "#0a0a0a", border: "none" }}>View</button>
                  ) : mockupFile ? (
                    <button onClick={() => { setPreviewList([]); setProofModalItem(item); setProofModalMode("edit"); setPeekItem(null); }} style={{ ...btn, background: T.amber, color: "#fff", border: "none" }}>Generate proof</button>
                  ) : null}
                  {mockupFile && hasProof && <button onClick={() => { setPreviewList([]); setProofModalItem(item); setProofModalMode("edit"); setPeekItem(null); }} style={btn}>Edit</button>}
                  {!fileApproved && <button onClick={markInternal} style={{ ...btn, borderColor: T.blue, color: T.blue }}>{manualApproved ? "Unmark internal" : "Mark internal"}</button>}
                </div>
                {!mockupFile && !hasProof && <div style={{ fontSize: 11.5, color: T.faint, marginTop: 10 }}>No mockup yet — add one in Product Builder to generate a proof.</div>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Proof Modal (single item) ── */}
      {proofModalItem && !isGenerateAll && (() => {
        const files = itemFiles[proofModalItem.id] || [];
        const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"));
        return (
          <>
            <ProofModal
              key={proofModalItem.id}
              item={proofModalItem}
              clientName={clientName}
              projectTitle={projectTitle}
              mockupFile={mockupFile}
              files={files}
              costingData={job.costing_data}
              onClose={() => { setProofModalItem(null); setPreviewList([]); }}
              onSaved={reloadFiles}
              onUpdateItem={onUpdateItem}
              initialMode={proofModalMode}
            />
            {/* Flip-through chrome — floats above the full-screen ProofModal (z 100). */}
            {isFlipping && (
              <>
                <button onClick={() => flipPreview(-1)} aria-label="Previous proof"
                  style={{ position: "fixed", left: 14, top: "50%", transform: "translateY(-50%)", zIndex: 120, width: 46, height: 46, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 22, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.18)", fontFamily: font, lineHeight: 1 }}>‹</button>
                <button onClick={() => flipPreview(1)} aria-label="Next proof"
                  style={{ position: "fixed", right: 14, top: "50%", transform: "translateY(-50%)", zIndex: 120, width: 46, height: 46, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 22, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.18)", fontFamily: font, lineHeight: 1 }}>›</button>
                <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 120, background: T.card, border: `1px solid ${T.border}`, borderRadius: 9, padding: "7px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.18)", display: "flex", alignItems: "baseline", gap: 10, maxWidth: "80vw" }}>
                  <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 800, color: T.text, whiteSpace: "nowrap" }}>{previewIdx + 1} / {previewList.length}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proofModalItem.name}</span>
                </div>
              </>
            )}
          </>
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


      {/* ── Send revised proofs modal — contacts + stock message + note ── */}
      {revisedModalOpen && (
        <div onClick={() => !sendingRevised && setRevisedModalOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, width: "100%", maxWidth: 560, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", fontFamily: font }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Send revised proofs</div>
              <button onClick={() => setRevisedModalOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {/* Recipients */}
            <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>To</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
              {(contacts || []).length === 0 && <div style={{ fontSize: 12, color: T.faint }}>No contacts on this job.</div>}
              {(contacts || []).map((c, i) => (
                <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: revisedSelected[i] ? T.accentDim : T.surface, borderRadius: 6, cursor: c.email ? "pointer" : "default", opacity: c.email ? 1 : 0.5 }}>
                  <input type="checkbox" checked={!!revisedSelected[i]} disabled={!c.email}
                    onChange={e => setRevisedSelected(p => ({ ...p, [i]: e.target.checked }))} style={{ accentColor: T.accent }} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: T.text }}>{c.name || "Unnamed"}{c.role_on_job ? <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>{c.role_on_job}</span> : null}</span>
                  <span style={{ fontSize: 11, color: T.muted }}>{c.email || "no email"}</span>
                </label>
              ))}
            </div>

            {/* Stock message preview */}
            <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>Message</label>
            <div style={{ fontSize: 12, color: T.muted, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", marginBottom: 10, lineHeight: 1.5 }}>
              "We've made the changes you requested — an updated proof is ready for another look in the portal. Approve when it's good, or request further changes." <span style={{ color: T.faint }}>+ portal link</span>
            </div>

            {/* Custom note */}
            <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>Add a note <span style={{ color: T.faint }}>(optional)</span></label>
            <textarea value={revisedNote} onChange={e => setRevisedNote(e.target.value)} rows={3}
              placeholder="e.g. Moved the logo up and switched the back print to white per your notes."
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, resize: "vertical", boxSizing: "border-box", marginBottom: 14 }} />

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: T.muted, flex: 1 }}>
                {Object.values(revisedSelected).filter(Boolean).length} recipient{Object.values(revisedSelected).filter(Boolean).length === 1 ? "" : "s"}
              </span>
              <button onClick={() => setRevisedModalOpen(false)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, padding: "7px 14px", fontSize: 12, fontFamily: font, cursor: "pointer" }}>Cancel</button>
              <button onClick={submitRevisedProofs} disabled={sendingRevised || Object.values(revisedSelected).filter(Boolean).length === 0}
                style={{ background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 6, padding: "7px 18px", fontSize: 12, fontWeight: 700, fontFamily: font, cursor: sendingRevised ? "default" : "pointer", opacity: sendingRevised || Object.values(revisedSelected).filter(Boolean).length === 0 ? 0.6 : 1 }}>
                {sendingRevised ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Send proofs for review modal — client contact selection ── */}
      {proofReviewOpen && (
        <div onClick={() => !sendingProofEmail && setProofReviewOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, width: "100%", maxWidth: 560, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", fontFamily: font }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Send proofs for review</div>
              <button onClick={() => setProofReviewOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {/* Recipients */}
            <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>To</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
              {(contacts || []).length === 0 && <div style={{ fontSize: 12, color: T.faint }}>No contacts on this job.</div>}
              {(contacts || []).map((c, i) => (
                <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: proofSelected[i] ? T.accentDim : T.surface, borderRadius: 6, cursor: c.email ? "pointer" : "default", opacity: c.email ? 1 : 0.5 }}>
                  <input type="checkbox" checked={!!proofSelected[i]} disabled={!c.email}
                    onChange={e => setProofSelected(p => ({ ...p, [i]: e.target.checked }))} style={{ accentColor: T.accent }} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: T.text }}>{c.name || "Unnamed"}{c.role_on_job ? <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>{c.role_on_job}</span> : null}</span>
                  <span style={{ fontSize: 11, color: T.muted }}>{c.email || "no email"}</span>
                </label>
              ))}
            </div>

            {/* Stock message preview */}
            <label style={{ fontSize: 11, color: T.muted, marginBottom: 4, display: "block" }}>Message</label>
            <div style={{ fontSize: 12, color: T.muted, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", marginBottom: 14, lineHeight: 1.5 }}>
              "Your proofs are ready to review — approve or request changes in the portal." <span style={{ color: T.faint }}>+ portal link</span>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: T.muted, flex: 1 }}>
                {Object.values(proofSelected).filter(Boolean).length} recipient{Object.values(proofSelected).filter(Boolean).length === 1 ? "" : "s"}
              </span>
              <button onClick={() => setProofReviewOpen(false)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, padding: "7px 14px", fontSize: 12, fontFamily: font, cursor: "pointer" }}>Cancel</button>
              <button onClick={submitProofReview} disabled={sendingProofEmail || Object.values(proofSelected).filter(Boolean).length === 0}
                style={{ background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 6, padding: "7px 18px", fontSize: 12, fontWeight: 700, fontFamily: font, cursor: sendingProofEmail ? "default" : "pointer", opacity: sendingProofEmail || Object.values(proofSelected).filter(Boolean).length === 0 ? 0.6 : 1 }}>
                {sendingProofEmail ? "Sending…" : "Send for review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
