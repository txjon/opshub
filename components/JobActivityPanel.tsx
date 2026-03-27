"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";

type Activity = {
  id: string;
  user_id: string | null;
  type: "comment" | "auto";
  message: string;
  metadata: any;
  created_at: string;
};

export function JobActivityPanel({ jobId, currentUserId, profiles }: {
  jobId: string;
  currentUserId: string;
  profiles: Record<string, string>;
}) {
  const supabase = createClient();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadActivity();
    pollRef.current = setInterval(loadActivity, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  async function loadActivity() {
    const { data } = await supabase
      .from("job_activity")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true })
      .limit(200);
    setActivities(data || []);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true);

    // Check for @mentions
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(draft)) !== null) {
      mentions.push(match[1]);
    }

    await supabase.from("job_activity").insert({
      job_id: jobId,
      user_id: currentUserId,
      type: "comment",
      message: draft.trim(),
      metadata: mentions.length > 0 ? { mentions } : {},
    });

    // Create notifications for @mentioned users
    for (const mention of mentions) {
      const userId = Object.entries(profiles).find(([_, name]) =>
        name.toLowerCase().split(" ")[0] === mention.toLowerCase()
      )?.[0];
      if (userId && userId !== currentUserId) {
        await supabase.from("notifications").insert({
          user_id: userId,
          type: "mention",
          message: `${profiles[currentUserId] || "Someone"} mentioned you in a project`,
          reference_id: jobId,
          reference_type: "job",
        });
      }
    }

    setDraft("");
    setSending(false);
    loadActivity();
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  // Render message with @mention highlighting
  const renderMessage = (msg: string) => {
    return msg.replace(/@(\w+)/g, (match) =>
      `<span style="color:${T.accent};font-weight:600">${match}</span>`
    );
  };

  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
      display: "flex", flexDirection: "column",
      maxHeight: 500,
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px", borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Activity</div>
      </div>

      {/* Feed */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "8px 10px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {activities.length === 0 && (
          <div style={{ textAlign: "center", color: T.faint, fontSize: 11, padding: "20px 0" }}>
            No activity yet
          </div>
        )}
        {activities.map(a => {
          const isAuto = a.type === "auto";
          const name = a.user_id ? (profiles[a.user_id] || "Team") : "System";
          return (
            <div key={a.id} style={{
              padding: "6px 8px", borderRadius: 6,
              background: isAuto ? "transparent" : T.surface,
              borderLeft: isAuto ? `2px solid ${T.faint}` : "none",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ fontSize: 9, fontWeight: 600, color: isAuto ? T.faint : T.accent }}>
                  {isAuto ? "Auto" : name}
                </span>
                <span style={{ fontSize: 8, color: T.faint }}>{formatTime(a.created_at)}</span>
              </div>
              <div
                style={{ fontSize: 11, color: isAuto ? T.muted : T.text, lineHeight: 1.4 }}
                dangerouslySetInnerHTML={{ __html: renderMessage(a.message) }}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Comment input */}
      <div style={{ padding: "8px 10px", borderTop: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Add a note... @name to mention"
            style={{
              flex: 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.text, fontFamily: font, fontSize: 11, padding: "6px 10px", outline: "none",
            }}
          />
          <button onClick={send} disabled={!draft.trim()}
            style={{
              background: T.accent, border: "none", borderRadius: 6,
              color: "#fff", fontSize: 10, fontWeight: 600, padding: "6px 10px",
              cursor: draft.trim() ? "pointer" : "default", opacity: draft.trim() ? 1 : 0.4,
            }}>
            Post
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper to log auto-events from other components
export async function logJobActivity(jobId: string, message: string, metadata?: any) {
  const supabase = createClient();
  await supabase.from("job_activity").insert({
    job_id: jobId,
    user_id: null,
    type: "auto",
    message,
    metadata: metadata || {},
  });
}

// Notify all team members of an important event
export async function notifyTeam(message: string, type: "alert" | "approval" | "payment" | "production", referenceId?: string, referenceType?: string) {
  const supabase = createClient();
  const { data: profiles } = await supabase.from("profiles").select("id");
  if (!profiles?.length) return;
  await supabase.from("notifications").insert(
    profiles.map((p: any) => ({
      user_id: p.id,
      type,
      message,
      reference_id: referenceId || null,
      reference_type: referenceType || null,
    }))
  );
}
