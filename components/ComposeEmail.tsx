"use client";
import { useState } from "react";
import { T, font } from "@/lib/theme";

type Contact = { name: string; email: string | null; role?: string };

export function ComposeEmail({
  jobId,
  contacts,
  decoratorContacts,
  onClose,
  onSent,
  defaultTo,
  defaultSubject,
  channel,
  decoratorId,
}: {
  jobId: string;
  contacts: Contact[];
  decoratorContacts?: Contact[];
  onClose: () => void;
  onSent?: () => void;
  defaultTo?: string;
  defaultSubject?: string;
  channel?: "client" | "production";
  decoratorId?: string;
}) {
  const [to, setTo] = useState(defaultTo || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject || "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const allContacts = [
    ...(contacts || []).map(c => ({ ...c, group: "Client" })),
    ...(decoratorContacts || []).map(c => ({ ...c, group: "Decorator" })),
  ].filter(c => c.email);

  async function send() {
    if (!to || !subject.trim() || !body.trim()) return;
    setSending(true);
    setError("");
    try {
      const ccList = cc.split(",").map(s => s.trim()).filter(Boolean);
      const res = await fetch("/api/email/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          toEmail: to,
          ccEmails: ccList.length > 0 ? ccList : undefined,
          subject: subject.trim(),
          body: body.trim(),
          channel: channel || "client",
          decoratorId: decoratorId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send");
      }
      setSent(true);
      onSent?.();
      setTimeout(onClose, 1500);
    } catch (e: any) {
      setError(e.message);
    }
    setSending(false);
  }

  const inputStyle = {
    width: "100%", padding: "8px 10px", borderRadius: 6,
    background: T.surface, border: `1px solid ${T.border}`,
    color: T.text, fontFamily: font, fontSize: 12, outline: "none",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, borderRadius: 12, width: "95%", maxWidth: 520,
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 16px", borderBottom: `1px solid ${T.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Compose Email</span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: T.muted, fontSize: 18, cursor: "pointer", padding: 0,
          }}>&times;</button>
        </div>

        {sent ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.green, marginBottom: 4 }}>Sent</div>
            <div style={{ fontSize: 12, color: T.muted }}>Email delivered to {to}</div>
          </div>
        ) : (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* To */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>To</label>
              {allContacts.length > 0 ? (
                <select
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="">Select a contact...</option>
                  {allContacts.map((c, i) => (
                    <option key={i} value={c.email!}>
                      {c.name}{c.role ? ` (${c.role})` : ""} — {c.email} [{c.group}]
                    </option>
                  ))}
                  <option value="__custom">Type custom email...</option>
                </select>
              ) : (
                <input
                  type="email" value={to} onChange={e => setTo(e.target.value)}
                  placeholder="email@example.com" style={inputStyle}
                />
              )}
              {to === "__custom" && (
                <input
                  type="email" value="" onChange={e => setTo(e.target.value)}
                  placeholder="email@example.com" style={{ ...inputStyle, marginTop: 6 }}
                  autoFocus
                />
              )}
            </div>

            {/* CC */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>CC <span style={{ fontWeight: 400, textTransform: "none" }}>(optional, comma-separated)</span></label>
              <input
                value={cc} onChange={e => setCc(e.target.value)}
                placeholder="cc@example.com"
                style={inputStyle}
              />
            </div>

            {/* Subject */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>Subject</label>
              <input
                value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="Subject line" style={inputStyle}
              />
            </div>

            {/* Body */}
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>Message</label>
              <textarea
                value={body} onChange={e => setBody(e.target.value)}
                placeholder="Type your message..."
                rows={8}
                style={{
                  ...inputStyle, resize: "vertical", minHeight: 120,
                  lineHeight: 1.5,
                }}
              />
            </div>

            {error && (
              <div style={{ fontSize: 11, color: T.red, padding: "6px 0" }}>{error}</div>
            )}

            {/* Send */}
            <button
              onClick={send}
              disabled={!to || to === "__custom" || !subject.trim() || !body.trim() || sending}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 8,
                background: T.accent, color: "#fff", border: "none",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                opacity: (!to || to === "__custom" || !subject.trim() || !body.trim() || sending) ? 0.4 : 1,
              }}
            >
              {sending ? "Sending..." : "Send Email"}
            </button>

            <div style={{ fontSize: 10, color: T.faint, textAlign: "center" }}>
              Sent from production@housepartydistro.com · Replies route back to this project
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
