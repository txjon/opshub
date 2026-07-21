"use client";
// THE client-facing package approval — one Approve + one Request-changes for the
// whole package (quote + all proofs), shared by the per-job portal and the Client
// Hub order detail. No per-item buttons. Approve shows a terms-aware acceptance
// disclaimer (our record + expectation-setting); Request-changes takes a free note.
// Theme + the POST action are passed in so this stays portal-agnostic. Server side
// = lib/portal/approval-actions. See [[jon-clean-architecture-standard]].
import { useState } from "react";

type Theme = any; // the portal's document-style `C` theme object

const fmtMoney = (n?: number | null) => (n != null ? "$" + Math.round(n).toLocaleString() : null);

// The acceptance line shown on the approve prompt, tuned to the client's terms.
function invoiceLine(terms?: string | null): string {
  const t = (terms || "").toLowerCase();
  if (t === "prepaid") return "We'll send your invoice shortly — production begins once it's paid.";
  if (t === "deposit_balance") return "We'll send your deposit invoice shortly — production begins once it's received.";
  if (/^net/.test(t)) return "We'll send your invoice shortly (due per your terms); production begins now.";
  return "We'll send your invoice shortly.";
}

export function PackageApproval({ c, approved, approvedAt, changeRequest, quoteTotal, terms, projectName, items, pendingReapproval, onAction }: {
  c: Theme;
  approved: boolean;
  approvedAt?: string | null;
  changeRequest?: { note: string; at: string } | null;
  quoteTotal?: number | null;
  terms?: string | null;
  projectName?: string;
  items?: { id: string; name: string }[]; // for optional per-item tags on Request changes
  pendingReapproval?: boolean; // quote approved but proofs were revised → offer "Approve updated proofs"
  onAction: (action: string, body?: any) => Promise<void>;
}) {
  const [modal, setModal] = useState<null | "approve" | "changes">(null);
  const [note, setNote] = useState("");
  const [tagged, setTagged] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const total = fmtMoney(quoteTotal);

  async function submit(action: string, body?: any) {
    setBusy(true);
    try { await onAction(action, body); setModal(null); setNote(""); setTagged({}); }
    finally { setBusy(false); }
  }
  const taggedIds = Object.keys(tagged).filter(k => tagged[k]);

  // ── Approved and nothing revised since: locked confirmation, no live actions ──
  if (approved && !pendingReapproval) {
    return (
      <div style={{ background: c.greenBg, border: `1px solid ${c.greenBorder}`, borderRadius: 12, padding: "16px 18px", fontFamily: c.font }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: c.green, fontSize: 16 }}>✓</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: c.green }}>Approved{approvedAt ? ` · ${fmtDate(approvedAt)}` : ""}</span>
        </div>
        <div style={{ fontSize: 13, color: c.muted, marginTop: 6, lineHeight: 1.5 }}>
          Thanks — everything's approved for production{total ? ` at ${total}` : ""}. {invoiceLine(terms)} Need a change? Just reply to your rep and we'll help.
        </div>
      </div>
    );
  }

  const btnPrimary: React.CSSProperties = { flex: "1 1 auto", padding: "12px 18px", borderRadius: 10, border: "none", background: c.accent, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: c.font };
  const btnGhost: React.CSSProperties = { flex: "0 0 auto", padding: "12px 18px", borderRadius: 10, border: `1px solid ${c.border}`, background: c.card, color: c.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: c.font };

  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: "16px 18px", fontFamily: c.font }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: c.text }}>{approved ? "Updated proofs are ready" : "Ready to move forward?"}</div>
      <div style={{ fontSize: 13, color: c.muted, marginTop: 5, lineHeight: 1.5 }}>
        {approved
          ? "We've revised your proofs since your approval. Take a look above, then approve the updates in one click — or send us more notes."
          : <>Review your quote{total ? ` (${total})` : ""} and proofs above. When everything looks right, approve it all in one click — or tell us what to change.</>}
      </div>

      {changeRequest && (
        <div style={{ marginTop: 12, borderLeft: `3px solid ${c.amber}`, background: c.amberBg, borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: c.text, lineHeight: 1.45 }}>
          <b style={{ color: c.amber }}>Changes requested</b> {changeRequest.at ? `· ${fmtDate(changeRequest.at)}` : ""} — our team is on it. You can still approve below if you'd like to proceed as-is.
          {changeRequest.note && <div style={{ color: c.muted, marginTop: 4 }}>&ldquo;{changeRequest.note}&rdquo;</div>}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={() => setModal("approve")} style={btnPrimary}>{approved ? "Approve updated proofs" : "Approve"}</button>
        <button onClick={() => setModal("changes")} style={btnGhost}>Request changes</button>
      </div>

      {/* ── Approve prompt: acceptance disclaimer ── */}
      {modal === "approve" && (
        <Overlay c={c} onClose={() => !busy && setModal(null)}>
          <div style={{ fontSize: 16, fontWeight: 800, color: c.text }}>{approved ? "Approve the updated proofs?" : `Approve ${projectName || "this order"}?`}</div>
          <div style={{ fontSize: 13.5, color: c.text, marginTop: 10, lineHeight: 1.55 }}>
            By approving, you confirm all products and artwork shown are <b>correct and approved for production</b>. Changes requested after approval may not be able to be accommodated and could incur re-stocking or re-print charges.
          </div>
          <div style={{ fontSize: 13, color: c.muted, marginTop: 10, lineHeight: 1.5 }}>{invoiceLine(terms)}</div>
          {total && <div style={{ fontSize: 13, color: c.muted, marginTop: 8 }}>Approved total: <b style={{ color: c.text }}>{total}</b></div>}
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button onClick={() => submit("approve-package")} disabled={busy} style={{ ...btnPrimary, background: c.green, opacity: busy ? 0.6 : 1 }}>{busy ? "Approving…" : "Approve for production"}</button>
            <button onClick={() => setModal(null)} disabled={busy} style={btnGhost}>Cancel</button>
          </div>
        </Overlay>
      )}

      {/* ── Request-changes prompt: free note ── */}
      {modal === "changes" && (
        <Overlay c={c} onClose={() => !busy && setModal(null)}>
          <div style={{ fontSize: 16, fontWeight: 800, color: c.text }}>Request changes</div>
          <div style={{ fontSize: 13.5, color: c.muted, marginTop: 8, lineHeight: 1.5 }}>Tell us what you'd like changed — pricing, artwork, sizes, anything. We'll revise and send it back for another look. This won't approve your order.</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} autoFocus rows={5} placeholder="What would you like us to change?"
            style={{ width: "100%", marginTop: 12, padding: "10px 12px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.surface, color: c.text, fontSize: 13.5, fontFamily: c.font, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
          {(items || []).length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.text }}>Which items? <span style={{ fontWeight: 400, color: c.muted }}>Optional — leave blank if it applies to the whole order.</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, maxHeight: 170, overflowY: "auto" }}>
                {(items || []).map(it => (
                  <label key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 7, background: tagged[it.id] ? c.surface : "transparent", cursor: "pointer", fontSize: 13, color: c.text }}>
                    <input type="checkbox" checked={!!tagged[it.id]} onChange={e => setTagged(p => ({ ...p, [it.id]: e.target.checked }))} />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button onClick={() => submit("request-changes", { note: note.trim(), itemIds: taggedIds })} disabled={busy || !note.trim()} style={{ ...btnPrimary, background: c.accent, opacity: busy || !note.trim() ? 0.5 : 1 }}>{busy ? "Sending…" : "Submit change request"}</button>
            <button onClick={() => setModal(null)} disabled={busy} style={btnGhost}>Cancel</button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ c, onClose, children }: { c: Theme; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: c.card, borderRadius: 14, padding: "20px 22px", width: "100%", maxWidth: 440, boxShadow: "0 16px 48px rgba(0,0,0,0.3)", fontFamily: c.font }}>
        {children}
      </div>
    </div>
  );
}
