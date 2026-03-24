"use client";
import { useState } from "react";
import { T, font } from "@/lib/theme";

export function SendEmailDialog({ defaultEmail, defaultSubject, onClose, type, jobId, vendor }) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [subject, setSubject] = useState(defaultSubject || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    if (!email.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          jobId,
          vendor: vendor || undefined,
          recipientEmail: email.trim(),
          recipientName: "",
          subject: subject.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Failed to send");
        setSending(false);
        return;
      }
      setSent(true);
      setSending(false);
      setTimeout(() => onClose(), 2000);
    } catch (e) {
      setError("Network error");
      setSending(false);
    }
  };

  const inp = { width:"100%", padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, background:T.surface, color:T.text, fontSize:13, fontFamily:font, outline:"none", boxSizing:"border-box" };

  if (sent) {
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:T.greenDim, border:`1px solid ${T.green}`, borderRadius:8 }}>
        <span style={{ fontSize:16 }}>✓</span>
        <span style={{ fontSize:13, fontWeight:600, color:T.green, fontFamily:font }}>Sent to {email}</span>
      </div>
    );
  }

  return (
    <div style={{ padding:"12px 14px", background:T.card, border:`1px solid ${T.border}`, borderRadius:8, display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ fontSize:11, fontWeight:700, color:T.muted, fontFamily:font, textTransform:"uppercase", letterSpacing:"0.06em" }}>
        Send {type === "quote" ? "Quote" : "Purchase Order"} via Email
      </div>
      <div>
        <label style={{ fontSize:11, color:T.muted, fontFamily:font, marginBottom:3, display:"block" }}>To</label>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="recipient@example.com" style={inp}
          onKeyDown={e => e.key === "Enter" && handleSend()} autoFocus />
      </div>
      <div>
        <label style={{ fontSize:11, color:T.muted, fontFamily:font, marginBottom:3, display:"block" }}>Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} style={inp} />
      </div>
      {error && <div style={{ fontSize:12, color:T.red, fontFamily:font }}>{error}</div>}
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={onClose} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, padding:"6px 14px", fontSize:12, fontFamily:font, cursor:"pointer" }}>
          Cancel
        </button>
        <button onClick={handleSend} disabled={sending || !email.trim()}
          style={{ background:sending ? T.surface : T.accent, color:"#fff", border:"none", borderRadius:6, padding:"6px 16px", fontSize:12, fontFamily:font, fontWeight:600, cursor:sending ? "default" : "pointer", opacity:sending ? 0.6 : 1 }}>
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
