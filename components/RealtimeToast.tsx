"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font } from "@/lib/theme";

type Toast = {
  id: string;
  type: string;
  message: string;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
};

const TYPE_STYLES: Record<string, { icon: string; accent: string }> = {
  approval: { icon: "✓", accent: T.green },
  payment: { icon: "$", accent: T.green },
  alert: { icon: "!", accent: T.amber },
  production: { icon: "→", accent: T.accent },
  mention: { icon: "@", accent: T.purple },
};

export function RealtimeToast({ userId }: { userId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const n = payload.new as Toast;
          setToasts(prev => [n, ...prev].slice(0, 5));

          // Auto-dismiss after 6 seconds
          setTimeout(() => dismiss(n.id), 6000);

          // Mark as read after showing
          supabase.from("notifications").update({ read: true }).eq("id", n.id).then(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  function handleClick(toast: Toast) {
    dismiss(toast.id);
    if (toast.reference_type === "job" && toast.reference_id) {
      router.push(`/jobs/${toast.reference_id}`);
    }
  }

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, zIndex: 9999,
      display: "flex", flexDirection: "column-reverse", gap: 8,
      pointerEvents: "none",
    }}>
      {toasts.map(toast => {
        const style = TYPE_STYLES[toast.type] || TYPE_STYLES.alert;
        return (
          <div
            key={toast.id}
            onClick={() => handleClick(toast)}
            style={{
              pointerEvents: "auto",
              background: T.card, border: `1px solid ${T.border}`,
              borderLeft: `3px solid ${style.accent}`,
              borderRadius: 10, padding: "12px 16px",
              width: 360, maxWidth: "calc(100vw - 40px)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              cursor: toast.reference_id ? "pointer" : "default",
              fontFamily: font,
              animation: "toastSlideIn 0.3s ease-out",
              display: "flex", alignItems: "flex-start", gap: 10,
            }}
          >
            <span style={{
              width: 26, height: 26, borderRadius: 7, flexShrink: 0,
              background: style.accent + "22",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, color: style.accent,
            }}>
              {style.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: T.text, fontWeight: 500, lineHeight: 1.4 }}>{toast.message}</div>
              <div style={{ fontSize: 9, color: T.faint, marginTop: 3 }}>just now</div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); dismiss(toast.id); }}
              style={{
                background: "none", border: "none", color: T.faint,
                cursor: "pointer", fontSize: 14, padding: "0 2px",
                flexShrink: 0,
              }}
            >
              x
            </button>
          </div>
        );
      })}

      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
