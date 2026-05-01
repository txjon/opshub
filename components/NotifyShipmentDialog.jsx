"use client";
// Notify Recipient on Ship — picker dialog used from the production page
// after items are flipped to shipped. Mirrors the RFQ dialog pattern in
// CostingTab.jsx and adds a BCC field. Spec:
// memory/project_notify_recipient_on_ship.md

import { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";

const GOOSE_EMAIL = "goose@housepartydistro.com";

export function NotifyShipmentDialog({
  open,
  onClose,
  onSent,
  route, // "drop_ship" | "ship_through" | "stage"
  jobId,
  decoratorId,
  decoratorName,
  tracking,
  qbInvoiceNumber,
  clientName,
  jobTitle,
  contacts = [], // [{ name, email, role }] — drop_ship only
}) {
  const isDropShip = route === "drop_ship";

  // Recipient state
  const [recipientSel, setRecipientSel] = useState({}); // contactIdx -> bool
  const [extraEmail, setExtraEmail] = useState("");
  const [bccEmail, setBccEmail] = useState("");
  const [includeGoose, setIncludeGoose] = useState(true);
  const [warehouseExtras, setWarehouseExtras] = useState([]); // string[]
  const [warehouseExtraInput, setWarehouseExtraInput] = useState("");

  // Subject + body
  const [subject, setSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  // Send state
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [showResendConfirm, setShowResendConfirm] = useState(false);

  // Initialize when dialog opens
  useEffect(() => {
    if (!open) return;
    if (isDropShip) {
      const sel = {};
      contacts.forEach((c, i) => { if (c?.email) sel[i] = true; });
      setRecipientSel(sel);
    } else {
      setIncludeGoose(true);
      setWarehouseExtras([]);
      setWarehouseExtraInput("");
    }
    setExtraEmail("");
    setBccEmail("");
    setSubject(
      isDropShip
        ? `Your order has shipped — ${qbInvoiceNumber || ""} — ${jobTitle || ""}`
        : `Incoming: ${decoratorName || ""} — ${qbInvoiceNumber || ""} — ${clientName || ""} — ${tracking || ""}`
    );
    setCustomMessage("");
    setError("");
    setSent(false);
    setShowResendConfirm(false);
    setShowPreview(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // Compute final recipient list
  const dropShipRecipients = isDropShip
    ? [
        ...contacts.filter((c, i) => recipientSel[i] && c?.email).map(c => c.email.trim()),
        ...(extraEmail.trim() ? [extraEmail.trim()] : []),
      ]
    : [];
  const warehouseRecipients = !isDropShip
    ? [
        ...(includeGoose ? [GOOSE_EMAIL] : []),
        ...warehouseExtras.filter(e => e.trim()),
      ]
    : [];
  const allRecipients = isDropShip ? dropShipRecipients : warehouseRecipients;
  const dedupRecipients = Array.from(new Set(allRecipients));
  const bccList = bccEmail.trim() ? [bccEmail.trim()] : [];

  const qbMissing = !qbInvoiceNumber;
  const trackingMissing = !tracking;
  const recipientCount = dedupRecipients.length;
  const canSend = !qbMissing && !trackingMissing && recipientCount > 0 && subject.trim() && !sending;

  const labelStyle = { fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 };
  const inp = { width: "100%", padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none", boxSizing: "border-box" };

  const submit = async (force = false) => {
    if (!canSend) return;
    setError("");
    setSending(true);
    try {
      const to = dedupRecipients.slice(0, 1);
      const cc = dedupRecipients.slice(1);
      const res = await fetch("/api/email/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shipment_notify",
          jobId,
          route,
          decoratorId,
          vendorName: decoratorName,
          trackingNumber: tracking,
          to,
          cc,
          bcc: bccList,
          customSubject: subject,
          customMessage: customMessage.trim() || undefined,
          resend: force,
        }),
      });
      const data = await res.json();
      if (data.skipped === "already_sent") {
        setShowResendConfirm(true);
        setSending(false);
        return;
      }
      if (!res.ok || data.error) {
        setError(data.error || "Failed to send");
        setSending(false);
        return;
      }
      setSent(true);
      setSending(false);
      onSent?.(data.record);
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setError("Network error — check your connection and try again.");
      setSending(false);
    }
  };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 10100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.card, borderRadius: 12, width: "92vw", maxWidth: 560, maxHeight: "90vh", display: "flex", flexDirection: "column", fontFamily: font, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}` }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>
            Notify {isDropShip ? "customer" : "warehouse"}
          </h3>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {decoratorName ? `${decoratorName} · ` : ""}
            <span style={{ fontFamily: mono }}>{tracking || "(no tracking)"}</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Pre-flight gates */}
          {qbMissing && (
            <div style={{ padding: "10px 12px", background: T.amberDim, border: `1px solid ${T.amber}55`, borderRadius: 6, fontSize: 12, color: T.amber, fontWeight: 600 }}>
              QB invoice number missing — generate the invoice before notifying.
            </div>
          )}
          {trackingMissing && (
            <div style={{ padding: "10px 12px", background: T.amberDim, border: `1px solid ${T.amber}55`, borderRadius: 6, fontSize: 12, color: T.amber, fontWeight: 600 }}>
              Tracking number missing — enter tracking on the Ship action before notifying.
            </div>
          )}

          {sent && (
            <div style={{ padding: "12px 14px", background: T.greenDim, border: `1px solid ${T.green}66`, borderRadius: 6, fontSize: 13, color: T.green, fontWeight: 700, textAlign: "center" }}>
              ✓ Notification sent
            </div>
          )}

          {/* Recipients — drop_ship */}
          {isDropShip && (
            <div>
              <div style={labelStyle}>
                To {recipientCount > 1 && <span style={{ color: T.faint, fontWeight: 500, marginLeft: 4, textTransform: "none", letterSpacing: 0 }}>· first recipient is To, others are CC</span>}
              </div>
              {contacts.length === 0 ? (
                <div style={{ fontSize: 12, color: T.amber, marginBottom: 6 }}>
                  No contacts on file for this client. Add an email below.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {contacts.map((c, i) => (
                    <label key={i} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px",
                      background: recipientSel[i] ? T.accentDim : T.surface,
                      border: `1px solid ${recipientSel[i] ? T.accent + "66" : T.border}`,
                      borderRadius: 6, cursor: c?.email ? "pointer" : "default",
                      opacity: c?.email ? 1 : 0.5,
                    }}>
                      <input type="checkbox" checked={!!recipientSel[i]} disabled={!c?.email}
                        onChange={e => setRecipientSel(prev => ({ ...prev, [i]: e.target.checked }))}
                        style={{ accentColor: T.accent }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c?.name || "Unnamed"}</span>
                        {c?.role && <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>{c.role}</span>}
                      </div>
                      <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{c?.email || "no email"}</span>
                    </label>
                  ))}
                </div>
              )}
              <input value={extraEmail} onChange={e => setExtraEmail(e.target.value)}
                placeholder="+ Add another email"
                style={{ ...inp, marginTop: 6, fontSize: 12 }} />
            </div>
          )}

          {/* Recipients — ship_through / stage */}
          {!isDropShip && (
            <div>
              <div style={labelStyle}>To</div>
              <label style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px",
                background: includeGoose ? T.accentDim : T.surface,
                border: `1px solid ${includeGoose ? T.accent + "66" : T.border}`,
                borderRadius: 6, cursor: "pointer",
              }}>
                <input type="checkbox" checked={includeGoose}
                  onChange={e => setIncludeGoose(e.target.checked)}
                  style={{ accentColor: T.accent }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Goose</span>
                  <span style={{ fontSize: 10, color: T.muted, marginLeft: 6 }}>HPD Warehouse</span>
                </div>
                <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{GOOSE_EMAIL}</span>
              </label>
              {warehouseExtras.map((e, idx) => (
                <div key={idx} style={{ marginTop: 6, display: "flex", gap: 6 }}>
                  <input value={e} onChange={ev => setWarehouseExtras(prev => prev.map((x, i) => i === idx ? ev.target.value : x))}
                    style={{ ...inp, flex: 1, fontSize: 12 }} />
                  <button onClick={() => setWarehouseExtras(prev => prev.filter((_, i) => i !== idx))}
                    style={{ padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: "transparent", color: T.faint, fontSize: 11, cursor: "pointer", fontFamily: font }}>
                    Remove
                  </button>
                </div>
              ))}
              <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <input value={warehouseExtraInput} onChange={e => setWarehouseExtraInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && warehouseExtraInput.trim()) {
                      setWarehouseExtras(prev => [...prev, warehouseExtraInput.trim()]);
                      setWarehouseExtraInput("");
                    }
                  }}
                  placeholder="+ Add another email (Enter to add)"
                  style={{ ...inp, flex: 1, fontSize: 12 }} />
                {warehouseExtraInput.trim() && (
                  <button onClick={() => {
                    setWarehouseExtras(prev => [...prev, warehouseExtraInput.trim()]);
                    setWarehouseExtraInput("");
                  }}
                    style={{ padding: "6px 12px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 11, cursor: "pointer", fontFamily: font, fontWeight: 600 }}>
                    Add
                  </button>
                )}
              </div>
            </div>
          )}

          {/* BCC */}
          <div>
            <div style={labelStyle}>BCC <span style={{ color: T.faint, fontWeight: 500, marginLeft: 4, textTransform: "none", letterSpacing: 0 }}>· optional · hidden from other recipients</span></div>
            <input value={bccEmail} onChange={e => setBccEmail(e.target.value)}
              placeholder="e.g. archive@housepartydistro.com"
              style={{ ...inp, fontSize: 12 }} />
          </div>

          {/* Subject */}
          <div>
            <div style={labelStyle}>Subject</div>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              style={inp} />
          </div>

          {/* Custom message */}
          <div>
            <div style={labelStyle}>
              Your message <span style={{ color: T.faint, fontWeight: 500, marginLeft: 4, textTransform: "none", letterSpacing: 0 }}>· optional · added to standard email</span>
            </div>
            <textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)} rows={3}
              placeholder={isDropShip
                ? "Anything extra you'd like the customer to know? Special handling, follow-up info, thank-you, etc."
                : "Anything Goose should know? Quirky packaging, partial qty, double-box, etc."}
              style={{ ...inp, resize: "vertical", lineHeight: 1.5, fontSize: 13 }} />
          </div>

          {/* Standard body preview (collapsible) */}
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
            <button type="button" onClick={() => setShowPreview(s => !s)}
              style={{ width: "100%", padding: "8px 12px", background: T.surface, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: font }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.muted }}>Standard email body {showPreview ? "▾" : "▸"}</span>
              <span style={{ fontSize: 10, color: T.faint }}>What we'll always send</span>
            </button>
            {showPreview && (
              <div style={{ padding: "12px 16px", fontSize: 13, color: T.text, lineHeight: 1.55, background: T.card, fontFamily: font }}>
                {isDropShip ? (
                  <>
                    <div style={{ marginBottom: 8 }}>Hi {clientName ? clientName.split(" ")[0] : "[customer]"},</div>
                    <div style={{ marginBottom: 6 }}>Good news — your order is on the way.</div>
                    <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, marginBottom: 6 }}>Tracking: {tracking || "(none yet)"}</div>
                    <div style={{ fontWeight: 600, marginTop: 10 }}>Shipment includes:</div>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>
                      <em>(generated from items shipping under this tracking number)</em>
                    </div>
                    {customMessage.trim() && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: T.surface, borderLeft: `3px solid ${T.accent}`, borderRadius: 3, whiteSpace: "pre-wrap" }}>
                        {customMessage.trim()}
                      </div>
                    )}
                    <div style={{ marginTop: 10, fontSize: 12, color: T.muted, fontStyle: "italic" }}>
                      A packing slip is attached for your records, and you can also view your order in your project portal.
                    </div>
                    <div style={{ marginTop: 10 }}>If anything looks off when it arrives, just reply here — we'll get you sorted.</div>
                    <div style={{ marginTop: 10 }}>— The House Party Distro team<br/>hello@housepartydistro.com</div>
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 6 }}>Heads up — a shipment is inbound to HPD.</div>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}><strong>From:</strong> {decoratorName || "[vendor]"}</div>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}><strong>Tracking:</strong> <span style={{ fontFamily: mono }}>{tracking || "(none)"}</span></div>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}><strong>Project:</strong> {jobTitle || ""}</div>
                    <div style={{ fontWeight: 600, marginTop: 10 }}>Shipment includes:</div>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>
                      <em>(generated from items shipping under this tracking number)</em>
                    </div>
                    {customMessage.trim() && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: T.surface, borderLeft: `3px solid ${T.accent}`, borderRadius: 3, whiteSpace: "pre-wrap" }}>
                        {customMessage.trim()}
                      </div>
                    )}
                    <div style={{ marginTop: 10, fontSize: 12, color: T.muted, fontStyle: "italic" }}>
                      Packing slip attached. Confirm receipt in OpsHub when it arrives.
                    </div>
                    <div style={{ marginTop: 10 }}>— House Party Labs</div>
                  </>
                )}
              </div>
            )}
          </div>

          {error && (
            <div style={{ padding: "10px 12px", background: T.redDim || (T.amberDim + "44"), border: `1px solid ${T.red || T.amber}66`, borderRadius: 6, fontSize: 12, color: T.red || T.amber, fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>

        {/* Resend confirm — sits directly above the footer so it
            appears next to the action buttons the user just clicked.
            When active it replaces the Send button; the standalone
            Cancel + recipient count line stay visible. */}
        {showResendConfirm && !sent && (
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, background: T.amberDim + "44" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: T.amber, marginBottom: 4 }}>Already sent — resend anyway?</div>
            <div style={{ fontSize: 12, color: T.muted }}>
              A notification for this tracking number was already sent. Send another copy?
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, color: T.muted }}>
            {recipientCount} recipient{recipientCount !== 1 ? "s" : ""}{bccList.length > 0 ? ` · ${bccList.length} BCC` : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => !sending && onClose()}
              style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, color: T.muted, padding: "8px 16px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
            {showResendConfirm && !sent ? (
              <>
                <button onClick={() => setShowResendConfirm(false)}
                  style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, padding: "8px 16px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
                  No, cancel
                </button>
                <button onClick={() => { setShowResendConfirm(false); submit(true); }}
                  style={{ background: T.amber, border: "none", borderRadius: 6, color: "#fff", padding: "8px 18px", fontSize: 12, fontFamily: font, fontWeight: 700, cursor: "pointer" }}>
                  Yes, resend
                </button>
              </>
            ) : (
              <button disabled={!canSend} onClick={() => submit(false)}
                style={{ background: canSend ? T.green : T.surface, border: "none", borderRadius: 6, color: canSend ? "#fff" : T.faint, padding: "8px 18px", fontSize: 12, fontFamily: font, fontWeight: 700, cursor: canSend ? "pointer" : "default", opacity: canSend ? 1 : 0.6 }}>
                {sending ? "Sending…" : sent ? "Sent ✓" : "Send notification"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
