"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";

type Message = {
  id: string;
  user_id: string;
  message: string;
  created_at: string;
  profiles?: { full_name: string | null } | null;
};

export function PartyLine({ currentUserId }: { currentUserId: string }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    supabase.from("profiles").select("id, full_name").then(({ data }) => {
      const map: Record<string, string> = {};
      (data || []).forEach((p: any) => { map[p.id] = p.full_name || "Team"; });
      setProfiles(map);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    loadMessages();
    pollRef.current = setInterval(loadMessages, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open]);

  async function loadMessages() {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(100);
    setMessages(data || []);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true);
    await supabase.from("messages").insert({ user_id: currentUserId, message: draft.trim() });
    setDraft("");
    setSending(false);
    loadMessages();
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const getInitials = (name: string) => name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 998,
          width: 48, height: 48, borderRadius: "50%",
          background: open ? T.accent : T.card, border: `2px solid ${open ? T.accent : T.border}`,
          color: open ? "#fff" : T.muted, fontSize: 18,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          transition: "all 0.15s",
        }}
      >
        {open ? "✕" : "💬"}
      </button>

      {/* Chat drawer */}
      {open && (
        <div style={{
          position: "fixed", bottom: 80, right: 20, zIndex: 997,
          width: 360, height: 480, maxHeight: "70vh",
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
          display: "flex", flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          fontFamily: font,
        }}>
          {/* Header */}
          <div style={{
            padding: "12px 16px", borderBottom: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Party Line</div>
              <div style={{ fontSize: 10, color: T.muted }}>Team chat</div>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "12px 16px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: T.faint, fontSize: 12, padding: "40px 0" }}>
                No messages yet — say something
              </div>
            )}
            {messages.map(m => {
              const isMe = m.user_id === currentUserId;
              const name = profiles[m.user_id] || "Team";
              return (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start" }}>
                  {!isMe && (
                    <div style={{ fontSize: 9, color: T.faint, marginBottom: 2, marginLeft: 4 }}>{name}</div>
                  )}
                  <div style={{
                    maxWidth: "80%", padding: "8px 12px", borderRadius: 10,
                    background: isMe ? T.accent : T.surface,
                    color: isMe ? "#fff" : T.text,
                    fontSize: 12, lineHeight: 1.5, wordBreak: "break-word",
                  }}>
                    {m.message}
                  </div>
                  <div style={{ fontSize: 8, color: T.faint, marginTop: 2, marginLeft: 4, marginRight: 4 }}>
                    {formatTime(m.created_at)}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: "10px 12px", borderTop: `1px solid ${T.border}`,
            display: "flex", gap: 8,
          }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message..."
              style={{
                flex: 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
                color: T.text, fontFamily: font, fontSize: 12, padding: "8px 12px", outline: "none",
              }}
            />
            <button
              onClick={send}
              disabled={!draft.trim() || sending}
              style={{
                background: T.accent, border: "none", borderRadius: 8,
                color: "#fff", fontSize: 12, fontWeight: 600, padding: "8px 14px",
                cursor: draft.trim() ? "pointer" : "default", opacity: draft.trim() ? 1 : 0.4,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
