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

  const approvedCount = items.filter(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved").length;
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

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Send Proofs ── */}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setShowProofEmail(!showProofEmail)}
          style={{ flex: 1, padding: "14px", borderRadius: 10, border: "none", cursor: "pointer",
            background: T.purple, color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: font,
            transition: "opacity 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          Send Proofs to Client
        </button>
        {job.portal_token && (
          <button onClick={() => window.open(`/portal/${job.portal_token}`, "_blank")}
            style={{ padding: "14px 24px", borderRadius: 10, border: "none", cursor: "pointer",
              background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: font,
              transition: "opacity 0.15s", flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            View Portal
          </button>
        )}
      </div>
      {showProofEmail && (
        <SendEmailDialog
          type="proof_link"
          jobId={job.id}
          contacts={contacts.map(c => ({ name: c.name, email: c.email || "" }))}
          defaultEmail={contacts.find(c => c.role_on_job === "primary")?.email || ""}
          defaultSubject={`Proofs Ready for Approval — ${clientName} · ${job.title}`}
          customBody={`<p>Hi,</p><p>Your proofs are ready for review. You can view and approve all of them from your project portal.</p><p>Let us know if you have any questions or need changes.</p><p>Welcome to the party,<br/>House Party Distro</p>`}
          onClose={() => setShowProofEmail(false)}
          onSent={() => { logJobActivity(job.id, "Proofs sent to client for approval via portal link"); setShowProofEmail(false); }}
        />
      )}

      {/* ── Proof Approvals ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Proof Approvals</div>
          <span style={{ fontSize: 11, fontWeight: 600, color: allApproved ? T.green : T.amber }}>
            {approvedCount}/{items.length} approved
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((item, i) => {
            const fileApproved = proofStatus[item.id]?.allApproved;
            const manualApproved = item.artwork_status === "approved";
            const isApproved = fileApproved || manualApproved;
            const files = itemFiles[item.id] || [];
            const mockupFile = files.find(f => f.stage === "mockup") || files.find(f => f.file_name?.toLowerCase().includes("mockup"));
            const hasProofFile = files.some(f => f.stage === "proof" && f.approval && f.approval !== "none");

            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.surface, borderRadius: 8, border: `1px solid ${isApproved ? T.green + "44" : T.border}` }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{[item.blank_vendor, item.color || item.blank_sku].filter(Boolean).join(" · ")}</div>
                </div>
                {/* Generate Proof button */}
                {mockupFile && (
                  <button onClick={() => setProofModalItem(item)}
                    style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, border: "none", cursor: "pointer", background: T.amber, color: "#fff" }}>
                    {files.some(f => f.stage === "proof") ? "Regenerate Proof" : "Generate Proof"}
                  </button>
                )}
                {!mockupFile && files.length > 0 && (
                  <span style={{ fontSize: 9, color: T.faint }}>No mockup</span>
                )}
                {hasProofFile && !isApproved && (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.amberDim, color: T.amber }}>
                    Proof Sent
                  </span>
                )}
                {isApproved && (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>
                    Approved
                  </span>
                )}
                <button onClick={async () => {
                  const newStatus = manualApproved ? "not_started" : "approved";
                  await supabase.from("items").update({ artwork_status: newStatus }).eq("id", item.id);
                  if (onUpdateItem) onUpdateItem(item.id, { artwork_status: newStatus });
                  if (newStatus === "approved") logJobActivity(job.id, `${item.name} proof manually approved`);
                  if (onRecalcPhase) setTimeout(onRecalcPhase, 300);
                }}
                  style={{ padding: "3px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer",
                    background: manualApproved ? T.greenDim : T.surface,
                    color: manualApproved ? T.green : T.muted,
                    border: `1px solid ${manualApproved ? T.green + "44" : T.border}`,
                  }}>
                  {manualApproved ? "Approved" : "Approve"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Proof Modal ── */}
      {proofModalItem && (() => {
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
            onClose={(saved) => {
              setProofModalItem(null);
              if (saved) {
                // Reload files to update proof status
                const ids = items.map(it => it.id).filter(id => typeof id === "string" && id.length > 20);
                supabase.from("item_files").select("*").in("item_id", ids).then(({ data }) => {
                  const byItem = {};
                  for (const f of (data || [])) {
                    if (!byItem[f.item_id]) byItem[f.item_id] = [];
                    byItem[f.item_id].push(f);
                  }
                  setItemFiles(byItem);
                });
              }
            }}
            onUpdateItem={onUpdateItem}
          />
        );
      })()}
    </div>
  );
}
