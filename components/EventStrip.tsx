"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font } from "@/lib/theme";

type Event = {
  id: string;
  type: string;
  message: string;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
};

const TYPE_DOT: Record<string, string> = {
  approval: T.green,
  payment: T.green,
  alert: T.amber,
  production: T.accent,
  mention: T.purple,
};

const timeAgo = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export function EventStrip({ userId }: { userId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [idx, setIdx] = useState(0);
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load recent unread on mount
  useEffect(() => {
    loadRecent();
    const interval = setInterval(loadRecent, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  // Subscribe to realtime inserts
  useEffect(() => {
    const channel = supabase
      .channel("event-strip")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const n = payload.new as Event;
          setEvents(prev => [n, ...prev].slice(0, 10));
          setIdx(0); // Show the newest
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // Rotate through events every 5s if multiple
  useEffect(() => {
    if (rotateRef.current) clearInterval(rotateRef.current);
    if (events.length > 1) {
      rotateRef.current = setInterval(() => {
        setIdx(prev => (prev + 1) % events.length);
      }, 5000);
    }
    return () => { if (rotateRef.current) clearInterval(rotateRef.current); };
  }, [events.length]);

  async function loadRecent() {
    const { data } = await supabase
      .from("notifications")
      .select("id, type, message, reference_id, reference_type, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (data?.length) setEvents(data);
  }

  if (events.length === 0) return null;

  const current = events[idx] || events[0];
  const dotColor = TYPE_DOT[current.type] || T.accent;

  return (
    <div
      onClick={() => {
        if (current.reference_type === "job" && current.reference_id) {
          router.push(`/jobs/${current.reference_id}`);
        }
      }}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px", marginBottom: 12,
        background: T.surface, borderRadius: 8,
        cursor: current.reference_id ? "pointer" : "default",
        fontFamily: font, transition: "background 0.15s",
        borderLeft: `3px solid ${dotColor}`,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = T.card)}
      onMouseLeave={e => (e.currentTarget.style.background = T.surface)}
    >
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: dotColor, flexShrink: 0,
      }} />
      <div style={{
        flex: 1, fontSize: 11, color: T.text, fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {current.message}
      </div>
      <span style={{ fontSize: 9, color: T.faint, flexShrink: 0 }}>{timeAgo(current.created_at)}</span>
      {events.length > 1 && (
        <span style={{
          fontSize: 9, color: T.faint, flexShrink: 0,
          background: T.card, padding: "1px 6px", borderRadius: 4,
        }}>
          {idx + 1}/{events.length}
        </span>
      )}
    </div>
  );
}
