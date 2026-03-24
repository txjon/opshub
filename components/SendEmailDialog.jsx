"use client";
import { useState } from "react";
import { T, font } from "@/lib/theme";

export function SendEmailDialog({ defaultEmail, defaultSubject, onClose, type, jobId, vendor, contacts }) {
  // contacts: [{name, email}] — optional, for multi-recipient (PO to decorator)
  const hasContacts = contacts && contacts.length > 0;
  const [selected, setSelected] = useState(() => {
    if (!hasContacts) return {};
    const sel = {};
    contacts.forEach((c, i) => { if (c.email) sel[i] = true; });
    return sel;
  });
  const [email, setEmail] = useState(defaultEmail || "");
  const [subject, setSubject] = useState(defaultSubject || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const getRecipients = () => {
    if (hasContacts) {
      return contacts.filter((_, i) => selected[i]).map(c => c.email).filter(Boolean);
    }
    return email.trim() ? [email.trim()] : [];
  };

  const handleSend = async () => {
    const recipients = getRecipients();
    if (recipients.length === 0) return;
    setSending(true);
    setError("");
    try {
      // Send to each recipient
      for (const recipientEmail of recipients) {
        const res = await fetch("/api/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            jobId,
            vendor: vendor || undefined,
            recipientEmail,
            recipientName: "",
            subject: subject.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setError(data.error || `Failed to send to ${recipientEmail}`);
          setSending(false);
          return;
        }
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
    const recipients = getRecipients();
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:T.greenDim, border:`1px solid ${T.green}`, borderRadius:8 }}>
        <span style={{ fontSize:16 }}>✓</span>
        <span style={{ fontSize:13, fontWeight:600, color:T.green, fontFamily:font }}>Sent to {recipients.join(", ")}</span>
      </div>
    );
  }

  return (
    <div style={{ padding:"12px 14px", background:T.card, border:`1px solid ${T.border}`, borderRadius:8, display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ fontSize:11, fontWeight:700, color:T.muted, fontFamily:font, textTransform:"uppercase", letterSpacing:"0.06em" }}>
        Send {type === "quote" ? "Quote" : "Purchase Order"} via Email
      </div>

      {hasContacts ? (
        <div>
          <label style={{ fontSize:11, color:T.muted, fontFamily:font, marginBottom:4, display:"block" }}>To</label>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {contacts.map((c, i) => (
              <label key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 8px", background:selected[i] ? T.accentDim : T.surface, borderRadius:6, cursor:c.email?"pointer":"default", opacity:c.email?1:0.5 }}>
                <input type="checkbox" checked={!!selected[i]} disabled={!c.email}
                  onChange={e => setSelected(p => ({...p, [i]: e.target.checked}))}
                  style={{ accentColor:T.accent }} />
                <div style={{ flex:1 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:T.text }}>{c.name||"Unnamed"}</span>
                  {c.role && <span style={{ fontSize:10, color:T.muted, marginLeft:6 }}>{c.role}</span>}
                </div>
                <span style={{ fontSize:11, color:T.muted, fontFamily:font }}>{c.email||"no email"}</span>
              </label>
            ))}
          </div>
          {/* Manual email add */}
          <div style={{ marginTop:6 }}>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="+ Add another email..." style={{...inp, fontSize:11, padding:"5px 8px"}}
              onKeyDown={e => {
                if (e.key === "Enter" && email.trim()) {
                  setSelected(p => ({...p, [contacts.length + Object.keys(selected).length]: true}));
                }
              }} />
          </div>
        </div>
      ) : (
        <div>
          <label style={{ fontSize:11, color:T.muted, fontFamily:font, marginBottom:3, display:"block" }}>To</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="recipient@example.com" style={inp}
            onKeyDown={e => e.key === "Enter" && handleSend()} autoFocus />
        </div>
      )}

      <div>
        <label style={{ fontSize:11, color:T.muted, fontFamily:font, marginBottom:3, display:"block" }}>Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} style={inp} />
      </div>
      {error && <div style={{ fontSize:12, color:T.red, fontFamily:font }}>{error}</div>}
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end", alignItems:"center" }}>
        {hasContacts && <span style={{ fontSize:10, color:T.muted, fontFamily:font, flex:1 }}>{getRecipients().length} recipient{getRecipients().length!==1?"s":""}</span>}
        <button onClick={onClose} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, padding:"6px 14px", fontSize:12, fontFamily:font, cursor:"pointer" }}>
          Cancel
        </button>
        <button onClick={handleSend} disabled={sending || getRecipients().length === 0}
          style={{ background:sending ? T.surface : T.accent, color:"#fff", border:"none", borderRadius:6, padding:"6px 16px", fontSize:12, fontFamily:font, fontWeight:600, cursor:sending ? "default" : "pointer", opacity:sending || getRecipients().length===0 ? 0.6 : 1 }}>
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
