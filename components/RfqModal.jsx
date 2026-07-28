"use client";
// RFQ (Request Pricing) modal — THE one source, extracted verbatim from
// CostingTab (Jul 27) so classic Costing and Job Detail V2 send identical
// quote requests. Self-contained: owns its own selection/recipient/subject
// state (fresh on every mount — render conditionally), sends via
// /api/email/send type "rfq", and reports the new rfq_history entry through
// onSent so the caller can update job.type_meta locally.
import { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";

export default function RfqModal({ job, costProds, decoratorRecords = [], onClose, onSent }) {
  const [rfqVendor, setRfqVendor] = useState("");
  const [rfqSelected, setRfqSelected] = useState({});
  const [rfqRecipientSel, setRfqRecipientSel] = useState({});
  const [rfqExtraEmail, setRfqExtraEmail] = useState("");
  const [rfqSubject, setRfqSubject] = useState("");
  const [rfqBody, setRfqBody] = useState("");
  const [rfqSending, setRfqSending] = useState(false);
  const [rfqSent, setRfqSent] = useState(false);
  const [rfqError, setRfqError] = useState("");
  const [rfqShowPreview, setRfqShowPreview] = useState(false);

  const getDecRecord = (key) => decoratorRecords.find(d => (d.short_code || d.name) === key || d.name === key);

  // Vendor pick → preselect every contact with an email + reseed the subject.
  useEffect(() => {
    if (!rfqVendor) return;
    const dec = getDecRecord(rfqVendor);
    const contactsNext = {};
    (dec?.contacts_list || []).forEach((c, i) => { if (c?.email) contactsNext[i] = true; });
    setRfqRecipientSel(contactsNext);
    setRfqSubject(`Quote request — ${job?.job_number || ""} — ${job?.clients?.name || job?.title || ""}`.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfqVendor]);

  const sendRfq = async () => {
    setRfqError("");
    const dec = getDecRecord(rfqVendor);
    const contactList = dec?.contacts_list || [];
    const recipients = [
      ...contactList.filter((c, i) => rfqRecipientSel[i] && c?.email).map(c => c.email),
      ...(rfqExtraEmail.trim() ? [rfqExtraEmail.trim()] : []),
    ];
    const dedupRecipients = [...new Set(recipients)];
    if (dedupRecipients.length === 0) { setRfqError("Pick at least one recipient."); return; }
    const itemIds = Object.keys(rfqSelected).filter(id => rfqSelected[id]);
    if (itemIds.length === 0) { setRfqError("Pick at least one item."); return; }
    setRfqSending(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "rfq",
          jobId: job.id,
          vendor: rfqVendor,
          recipientEmail: dedupRecipients[0],
          ccEmails: dedupRecipients.slice(1),
          subject: rfqSubject.trim(),
          customBody: rfqBody.trim() || undefined,
          rfqItemIds: itemIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setRfqError(data.error || "Failed to send"); setRfqSending(false); return; }
      setRfqSent(true);
      setRfqSending(false);
      onSent?.({ vendor: rfqVendor, item_ids: itemIds, recipient: dedupRecipients[0], cc: dedupRecipients.slice(1), sent_at: new Date().toISOString() });
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setRfqError("Network error");
      setRfqSending(false);
    }
  };

  const eligible = (costProds || []).filter(p => (p.totalQty || 0) > 0);
  const selectedIds = Object.keys(rfqSelected).filter(id => rfqSelected[id]);
  const selectedCount = selectedIds.length;
  const dec = getDecRecord(rfqVendor);
  const contactList = dec?.contacts_list || [];
  const recipientCount =
    contactList.filter((c, i) => rfqRecipientSel[i] && c?.email).length +
    (rfqExtraEmail.trim() ? 1 : 0);
  const canSend = !!rfqVendor && selectedCount > 0 && recipientCount > 0 && !rfqSending;
  const inp = { width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none", boxSizing: "border-box" };
  const sectionLabel = { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => !rfqSending && onClose()}>
      <div style={{ background: T.card, borderRadius: 12, width: "95vw", maxWidth: 680, maxHeight: "90vh", overflow: "auto", padding: 0 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFamily: font }}>Request Pricing</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Send a quote request to a decorator</div>
          </div>
          <button onClick={() => !rfqSending && onClose()} style={{ background: "none", border: "none", color: T.faint, fontSize: 18, cursor: "pointer", padding: "0 4px" }}>×</button>
        </div>

        {/* Sent confirmation */}
        {rfqSent && (
          <div style={{ padding: "24px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: T.green, fontFamily: font, fontSize: 14, fontWeight: 600 }}>
            <span style={{ fontSize: 18 }}>✓</span> Quote request sent to {rfqVendor}
          </div>
        )}

        {!rfqSent && (
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Decorator */}
            <div>
              <div style={sectionLabel}>Decorator</div>
              <select value={rfqVendor} onChange={e => setRfqVendor(e.target.value)}
                style={{ ...inp, cursor: "pointer", borderColor: rfqVendor ? T.accent + "66" : T.border, color: rfqVendor ? T.text : T.muted }}>
                <option value="">— select decorator —</option>
                {decoratorRecords.map(d => (
                  <option key={d.id} value={d.short_code || d.name}>{d.name}{d.short_code ? ` (${d.short_code})` : ""}</option>
                ))}
              </select>
            </div>

            {/* Items */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <div style={sectionLabel}>Items</div>
                {eligible.length > 0 && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => { const all = {}; eligible.forEach(p => { all[p.id] = true; }); setRfqSelected(all); }}
                      style={{ fontSize: 10, color: T.accent, background: "none", border: "none", cursor: "pointer", fontFamily: font }}>Select all</button>
                    <button onClick={() => setRfqSelected({})}
                      style={{ fontSize: 10, color: T.faint, background: "none", border: "none", cursor: "pointer", fontFamily: font }}>Clear</button>
                  </div>
                )}
              </div>
              {eligible.length === 0 ? (
                <div style={{ padding: "12px", fontSize: 11, color: T.faint, textAlign: "center", border: `1px dashed ${T.border}`, borderRadius: 6 }}>
                  No items with quantities yet — add items first.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflow: "auto" }}>
                  {eligible.map((p, idx) => {
                    const checked = !!rfqSelected[p.id];
                    const itemVendor = p.printVendor || "";
                    const matchesVendor = rfqVendor && itemVendor === rfqVendor;
                    return (
                      <label key={p.id}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: checked ? T.accentDim : T.surface, border: `1px solid ${checked ? T.accent + "66" : T.border}`, borderRadius: 6, cursor: "pointer" }}>
                        <input type="checkbox" checked={checked}
                          onChange={e => setRfqSelected(prev => ({ ...prev, [p.id]: e.target.checked }))}
                          style={{ accentColor: T.accent, flexShrink: 0 }} />
                        <span style={{ width: 20, height: 20, borderRadius: 4, background: T.purpleDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: T.purple, fontFamily: mono, flexShrink: 0 }}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{p.name || "—"}</div>
                          <div style={{ fontSize: 10, color: T.muted }}>
                            {(p.totalQty || 0).toLocaleString()} units
                            {p.style ? ` · ${p.style}` : ""}
                            {p.color ? ` · ${p.color}` : ""}
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: matchesVendor ? T.green : itemVendor ? T.muted : T.faint, fontFamily: mono, flexShrink: 0 }}>
                          {itemVendor || "no vendor"}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recipients (contacts + manual add) */}
            {rfqVendor && (
              <div>
                <div style={sectionLabel}>To {recipientCount > 1 && <span style={{ color: T.faint, fontWeight: 500, marginLeft: 4, textTransform: "none", letterSpacing: 0 }}>· first recipient is To, others are CC</span>}</div>
                {contactList.length === 0 && !dec?.contact_email ? (
                  <div style={{ fontSize: 11, color: T.amber, marginBottom: 6 }}>No contacts on file for {dec?.name || rfqVendor}. Add an email below.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {contactList.map((c, i) => (
                      <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: rfqRecipientSel[i] ? T.accentDim : T.surface, border: `1px solid ${rfqRecipientSel[i] ? T.accent + "66" : T.border}`, borderRadius: 6, cursor: c?.email ? "pointer" : "default", opacity: c?.email ? 1 : 0.5 }}>
                        <input type="checkbox" checked={!!rfqRecipientSel[i]} disabled={!c?.email}
                          onChange={e => setRfqRecipientSel(prev => ({ ...prev, [i]: e.target.checked }))}
                          style={{ accentColor: T.accent }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{c?.name || "Unnamed"}</span>
                          {c?.role && <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>{c.role}</span>}
                        </div>
                        <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{c?.email || "no email"}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 6 }}>
                  <input value={rfqExtraEmail} onChange={e => setRfqExtraEmail(e.target.value)}
                    placeholder="+ Add another email"
                    style={{ ...inp, fontSize: 11, padding: "5px 10px" }} />
                </div>
              </div>
            )}

            {/* Subject */}
            {rfqVendor && (
              <div>
                <div style={sectionLabel}>Subject</div>
                <input value={rfqSubject} onChange={e => setRfqSubject(e.target.value)} style={inp} />
              </div>
            )}

            {/* Custom message */}
            {rfqVendor && (
              <div>
                <div style={sectionLabel}>Your message <span style={{ color: T.faint, fontWeight: 500, marginLeft: 4, textTransform: "none", letterSpacing: 0 }}>· optional · added to standard email</span></div>
                <textarea value={rfqBody} onChange={e => setRfqBody(e.target.value)} rows={3}
                  placeholder="Anything specific you want them to know? Tight deadline, multiple decorators bidding, special technique, etc."
                  style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
              </div>
            )}

            {/* Automated email preview (collapsible) */}
            {rfqVendor && (
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
                <button type="button" onClick={() => setRfqShowPreview(s => !s)}
                  style={{ width: "100%", padding: "7px 10px", background: T.surface, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: font }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.muted }}>Standard email body {rfqShowPreview ? "▾" : "▸"}</span>
                  <span style={{ fontSize: 10, color: T.faint }}>What we&apos;ll always send</span>
                </button>
                {rfqShowPreview && (
                  <div style={{ padding: "10px 14px", fontSize: 12, color: T.text, lineHeight: 1.55, background: T.card, fontFamily: font }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Hi {rfqVendor || "{Vendor}"},</div>
                    <div style={{ marginBottom: 6 }}>
                      Can you please provide pricing for the item(s) in the attachment? The PDF lays out each item — please reply with: pricing, setup fees, and estimated shipping cost. In addition, we need realistic production lead time and post-production transit time.
                    </div>
                    {rfqBody.trim() && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: T.surface, borderLeft: `3px solid ${T.accent}`, borderRadius: 3, whiteSpace: "pre-wrap" }}>
                        {rfqBody.trim()}
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 11, color: T.muted, fontStyle: "italic" }}>
                      Reach out if anything in the spec is unclear or if you need additional info — we&apos;ll send through whatever you need.
                    </div>
                    <div style={{ marginTop: 8 }}>Thanks,<br />House Party Distro</div>
                  </div>
                )}
              </div>
            )}

            {rfqError && (
              <div style={{ fontSize: 12, color: T.red, fontFamily: font }}>{rfqError}</div>
            )}
          </div>
        )}

        {/* Footer */}
        {!rfqSent && (
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 11, color: T.muted }}>
              {selectedCount} item{selectedCount !== 1 ? "s" : ""} · {recipientCount} recipient{recipientCount !== 1 ? "s" : ""}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => !rfqSending && onClose()}
                style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, padding: "7px 14px", fontSize: 12, fontFamily: font, cursor: "pointer" }}>
                Cancel
              </button>
              <button disabled={!canSend} onClick={sendRfq}
                style={{ background: canSend ? T.accent : T.surface, border: "none", borderRadius: 6, color: canSend ? "#0a0a0a" : T.faint, padding: "7px 16px", fontSize: 12, fontFamily: font, fontWeight: 700, cursor: canSend ? "pointer" : "default", opacity: canSend ? 1 : 0.6 }}>
                {rfqSending ? "Sending…" : "Send Request"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
