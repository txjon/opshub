"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font } from "@/lib/theme";

type Attachment = {
  filename: string;
  mimeType: string;
  size: number;
  gmailMessageId: string;
  attachmentId: string;
};

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
  attachments: Attachment[] | null;
  created_at: string;
};

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
};

const isImage = (mime: string) => mime.startsWith("image/");
const isPdf = (mime: string) => mime === "application/pdf";

export function EmailThread({ jobId, onCompose }: { jobId: string; onCompose: () => void }) {
  const supabase = createClient();
  const [emails, setEmails] = useState<Email[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");

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
                      {email.body_text || (isIn ? "Reply received — view full message in your email client" : "(no body)")}
                    </div>
                    {/* Attachments */}
                    {email.attachments && email.attachments.length > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {email.attachments.map((att: Attachment, ai: number) => {
                          const url = `/api/email/attachment?messageId=${encodeURIComponent(att.gmailMessageId)}&attachmentId=${encodeURIComponent(att.attachmentId)}&filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}`;
                          return (
                            <button
                              key={ai}
                              onClick={() => {
                                setPreviewUrl(url);
                                setPreviewName(att.filename);
                              }}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                padding: "5px 10px", borderRadius: 6,
                                background: T.card, border: `1px solid ${T.border}`,
                                color: T.accent, fontSize: 11, fontWeight: 500,
                                cursor: "pointer", fontFamily: font,
                              }}
                            >
                              <span style={{ fontSize: 13 }}>{isImage(att.mimeType) ? "🖼" : isPdf(att.mimeType) ? "📄" : "📎"}</span>
                              <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.filename}</span>
                              <span style={{ color: T.faint, fontSize: 9 }}>{fmtSize(att.size)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Attachment preview modal */}
      {previewUrl && (
        <div
          onClick={() => { setPreviewUrl(null); setPreviewName(""); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, cursor: "pointer",
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: T.card, borderRadius: 12, overflow: "hidden",
            maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}>
            {/* Header */}
            <div style={{
              padding: "10px 14px", borderBottom: `1px solid ${T.border}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{previewName}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={async () => {
                  const res = await fetch(previewUrl!);
                  const blob = await res.blob();
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = previewName;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }} style={{
                  fontSize: 10, fontWeight: 600, color: T.accent, background: "none",
                  padding: "3px 8px", borderRadius: 4, border: `1px solid ${T.border}`,
                  cursor: "pointer", fontFamily: font,
                }}>Save to Computer</button>
                <button onClick={() => { setPreviewUrl(null); setPreviewName(""); }} style={{
                  background: "none", border: "none", color: T.muted, fontSize: 16, cursor: "pointer",
                }}>&times;</button>
              </div>
            </div>
            {/* Content */}
            <div style={{ padding: 16, overflow: "auto", maxHeight: "80vh" }}>
              {previewUrl.includes("mimeType=image") ? (
                <img src={previewUrl} alt={previewName} style={{ maxWidth: "100%", borderRadius: 6 }} />
              ) : previewUrl.includes("mimeType=application%2Fpdf") ? (
                <iframe src={previewUrl} style={{ width: "80vw", height: "75vh", border: "none", borderRadius: 6 }} />
              ) : (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📎</div>
                  <div style={{ fontSize: 14, color: T.text, fontWeight: 600, marginBottom: 4 }}>{previewName}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>Preview not available for this file type</div>
                  <a href={previewUrl} download={previewName} style={{
                    display: "inline-block", padding: "10px 24px", borderRadius: 8,
                    background: T.accent, color: "#fff", textDecoration: "none",
                    fontSize: 13, fontWeight: 600,
                  }}>Save to Computer</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
