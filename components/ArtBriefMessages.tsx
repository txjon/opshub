"use client";
import { useState, useEffect, useRef } from "react";
import { T, font } from "@/lib/theme";

type Msg = {
  id: string;
  sender_role: "hpd" | "designer" | "client";
  sender_name: string | null;
  message: string;
  visibility: "all" | "hpd_only" | "hpd_designer";
  created_at: string;
};

export function ArtBriefMessages({
  briefId,
  compact,
  onSent,
}: {
  briefId: string;
  compact?: boolean;
  onSent?: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"to_designer" | "hpd_only">("to_designer");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
    const poll = setInterval(load, 12000);
    return () => clearInterval(poll);
  }, [briefId]);

  async function load() {
    const res = await fetch(`/api/art-briefs?id=${briefId}`);
    const data = await res.json();
    setMessages(data.messages || []);
    setLoading(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 40);
  }

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setDraft("");
    const visibility = mode === "hpd_only" ? "hpd_only" : "all";
    await fetch("/api/art-briefs/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: briefId, message: text, visibility }),
    });
    setSending(false);
    await load();
    onSent?.();
  }

  const listHeight = compact ? 220 : 340;

  return (
    <div style={{ fontFamily: font }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Messages
        </div>
        <div style={{ fontSize: 10, color: T.faint }}>
          {messages.filter(m => m.sender_role === "designer").length > 0 && (
            <span style={{ marginRight: 8, color: T.accent }}>
              {messages.filter(m => m.sender_role === "designer").length} from designer
            </span>
          )}
          {messages.length} total
        </div>
      </div>

      <div
        style={{
          maxHeight: listHeight,
          minHeight: 120,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "10px 4px",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 6,
        }}
      >
        {loading && <div style={{ fontSize: 11, color: T.muted, padding: "10px 12px" }}>Loading...</div>}
        {!loading && messages.length === 0 && (
          <div style={{ fontSize: 11, color: T.faint, fontStyle: "italic", padding: "10px 12px" }}>
            No messages yet. Send one below.
          </div>
        )}
        {messages.map(m => {
          const isHpd = m.sender_role === "hpd";
          const isInternal = m.visibility === "hpd_only";
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isHpd ? "flex-end" : "flex-start",
                padding: "0 10px",
              }}
            >
              <div
                style={{
                  maxWidth: "82%",
                  padding: "7px 11px",
                  borderRadius: 10,
                  fontSize: 12,
                  background: isInternal ? T.amberDim : isHpd ? T.accentDim : T.card,
                  color: T.text,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.45,
                  border: `1px solid ${isInternal ? T.amber + "55" : isHpd ? T.accent + "44" : T.border}`,
                }}
              >
                {isInternal && (
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: T.amber,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 4,
                    }}
                  >
                    Internal — HPD only
                  </div>
                )}
                {m.message}
              </div>
              <div style={{ fontSize: 9, color: T.muted, marginTop: 3 }}>
                {m.sender_name || (isHpd ? "HPD" : m.sender_role === "designer" ? "Designer" : "Client")}
                {" · "}
                {new Date(m.created_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "flex-start" }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={mode === "hpd_only" ? "Internal note (HPD only)..." : "Message designer..."}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 6,
            border: `1px solid ${mode === "hpd_only" ? T.amber + "66" : T.border}`,
            background: mode === "hpd_only" ? T.amberDim + "22" : T.surface,
            color: T.text,
            fontSize: 12,
            outline: "none",
            fontFamily: font,
            resize: "vertical",
            lineHeight: 1.4,
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 110 }}>
          <select
            value={mode}
            onChange={e => setMode(e.target.value as any)}
            style={{
              padding: "5px 6px",
              borderRadius: 6,
              border: `1px solid ${T.border}`,
              background: T.surface,
              color: T.text,
              fontSize: 10,
              outline: "none",
              fontFamily: font,
              cursor: "pointer",
            }}
          >
            <option value="to_designer">To designer</option>
            <option value="hpd_only">HPD only</option>
          </select>
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              background: T.accent,
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              opacity: sending || !draft.trim() ? 0.5 : 1,
              fontFamily: font,
            }}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 9, color: T.faint, marginTop: 4 }}>⌘+Enter to send</div>
    </div>
  );
}
