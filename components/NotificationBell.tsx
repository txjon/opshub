"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font } from "@/lib/theme";

type Notification = {
  id: string;
  type: string;
  message: string;
  reference_id: string | null;
  reference_type: string | null;
  read: boolean;
  created_at: string;
};

export function NotificationBell({ userId }: { userId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function loadNotifications() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifications(data || []);
  }

  async function markRead(id: string) {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read).map(n => n.id);
    if (unread.length === 0) return;
    await supabase.from("notifications").update({ read: true }).in("id", unread);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  function handleClick(n: Notification) {
    markRead(n.id);
    if (n.reference_type === "job" && n.reference_id) {
      router.push(`/jobs/${n.reference_id}`);
    }
    setOpen(false);
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  const typeIcon: Record<string, string> = {
    mention: "@",
    alert: "!",
    approval: "✓",
    payment: "$",
    production: "⚙",
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diff < 1) return "now";
    if (diff < 60) return diff + "m";
    if (diff < 1440) return Math.floor(diff / 60) + "h";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: unreadCount > 0 ? T.accent : T.faint, fontSize: 18,
          position: "relative", padding: 4,
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 0, right: 0,
            background: T.red, color: "#fff", fontSize: 9, fontWeight: 700,
            width: 16, height: 16, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 8,
          width: 320, maxHeight: 400, overflowY: "auto",
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          zIndex: 999, fontFamily: font,
        }}>
          <div style={{
            padding: "10px 14px", borderBottom: `1px solid ${T.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                style={{ background: "none", border: "none", color: T.accent, fontSize: 10, cursor: "pointer" }}>
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 && (
            <div style={{ padding: "24px 14px", textAlign: "center", color: T.faint, fontSize: 12 }}>
              No notifications
            </div>
          )}

          {notifications.map(n => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              style={{
                padding: "10px 14px", borderBottom: `1px solid ${T.border}`,
                cursor: n.reference_id ? "pointer" : "default",
                background: n.read ? "transparent" : T.accentDim + "33",
                display: "flex", gap: 10, alignItems: "flex-start",
              }}
              onMouseEnter={e => { if (!n.read) (e.currentTarget as HTMLElement).style.background = T.surface; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = n.read ? "transparent" : T.accentDim + "33"; }}
            >
              <span style={{
                width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                background: T.surface, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: T.accent,
              }}>
                {typeIcon[n.type] || "•"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: n.read ? T.muted : T.text, lineHeight: 1.4 }}>{n.message}</div>
                <div style={{ fontSize: 9, color: T.faint, marginTop: 2 }}>{formatTime(n.created_at)}</div>
              </div>
              {!n.read && (
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent, flexShrink: 0, marginTop: 6 }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
