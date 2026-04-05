"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font } from "@/lib/theme";

type Email = {
  id: string;
  direction: "inbound" | "outbound";
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  created_at: string;
};

export function EmailThread({ jobId, onCompose }: { jobId: string; onCompose: () => void }) {
  const supabase = createClient();
  const [emails, setEmails] = useState<Email[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { load(); }, [jobId]);

  async function load() {
    const { data } = await supabase
      .from("email_messages")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(50);
    setEmails(data || []);
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Email ({emails.length})
        </div>
        <button onClick={onCompose} style={{
          background: T.accent, border: "none", borderRadius: 6,
          color: "#fff", fontSize: 10, fontWeight: 600, padding: "5px 12px",
          cursor: "pointer",
        }}>
          Compose
        </button>
      </div>

      {emails.length === 0 ? (
        <div style={{
          textAlign: "center", color: T.faint, fontSize: 11, padding: "20px 0",
          background: T.card, borderRadius: 8, border: `1px solid ${T.border}`,
        }}>
          No emails yet. Click Compose to send the first one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {emails.map(email => {
            const isIn = email.direction === "inbound";
            const isExpanded = expanded === email.id;
            const sender = email.from_name || email.from_email;
            const recipients = email.to_emails.join(", ");

            return (
              <div key={email.id} style={{
                background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
                overflow: "hidden",
                borderLeft: isIn ? `3px solid ${T.green}` : `3px solid ${T.accent}`,
              }}>
                {/* Email row (collapsed) */}
                <div
                  onClick={() => setExpanded(isExpanded ? null : email.id)}
                  style={{
                    padding: "8px 10px", cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{
                        fontSize: 8, fontWeight: 700, textTransform: "uppercase",
                        padding: "1px 5px", borderRadius: 3,
                        background: isIn ? T.greenDim : T.accentDim,
                        color: isIn ? T.green : T.accent,
                      }}>
                        {isIn ? "IN" : "OUT"}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>
                        {sender}
                      </span>
                      {!isIn && (
                        <span style={{ fontSize: 10, color: T.faint }}>→ {recipients}</span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 11, color: T.muted,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {email.subject || "(no subject)"}
                    </div>
                  </div>
                  <span style={{ fontSize: 9, color: T.faint, whiteSpace: "nowrap", marginLeft: 8 }}>
                    {formatTime(email.created_at)}
                  </span>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div style={{
                    padding: "10px 12px", borderTop: `1px solid ${T.border}`,
                    background: T.surface,
                  }}>
                    {/* Meta */}
                    <div style={{ fontSize: 10, color: T.faint, marginBottom: 8 }}>
                      <div>From: {email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}</div>
                      <div>To: {email.to_emails.join(", ")}</div>
                      {email.cc_emails?.length > 0 && <div>CC: {email.cc_emails.join(", ")}</div>}
                    </div>
                    {/* Body */}
                    <div style={{
                      fontSize: 12, color: T.text, lineHeight: 1.5,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {email.body_text || "(no body)"}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
