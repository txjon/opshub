"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { logJobActivity } from "@/components/JobActivityPanel";

export function ApprovalsTab({ job, items, contacts, proofStatus, onUpdateItem, onRecalcPhase }) {
  const supabase = createClient();
  const [showProofEmail, setShowProofEmail] = useState(false);

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" };

  const approvedCount = items.filter(it => proofStatus[it.id]?.allApproved || it.artwork_status === "approved").length;
  const allApproved = items.length > 0 && approvedCount === items.length;

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
        <button onClick={() => window.open(`/api/pdf/invoice-proofs/${job.id}`, "_blank")}
          style={{ padding: "14px 24px", borderRadius: 10, border: "none", cursor: "pointer",
            background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: font,
            transition: "opacity 0.15s", flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          Preview
        </button>
      </div>
      {showProofEmail && (
        <SendEmailDialog
          type="invoice_proofs"
          jobId={job.id}
          contacts={contacts.map(c => ({ name: c.name, email: c.email || "" }))}
          defaultEmail={contacts.find(c => c.role_on_job === "primary")?.email || ""}
          defaultSubject={`Proofs for Review — ${job.clients?.name || ""} · ${job.title}`}
          onClose={() => setShowProofEmail(false)}
          onSent={() => { logJobActivity(job.id, "Proofs sent to client for approval"); setShowProofEmail(false); }}
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
            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.surface, borderRadius: 8, border: `1px solid ${isApproved ? T.green + "44" : T.border}` }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, background: T.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: T.accent, fontFamily: mono, flexShrink: 0 }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{[item.blank_vendor, item.color].filter(Boolean).join(" · ")}</div>
                </div>
                {fileApproved && (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.greenDim, color: T.green }}>
                    File Approved
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
    </div>
  );
}
