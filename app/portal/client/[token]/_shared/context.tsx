"use client";
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { PortalData, Toast } from "./types";

type ClientPortalCtx = {
  data: PortalData | null;
  loading: boolean;
  error: string;
  token: string;
  refetch: () => Promise<void>;
  toasts: Toast[];
  dismissToast: (id: string) => void;
  // Opens the Designs tab with a specific brief modal. Set by the designs page
  // when it mounts; the toast handler calls it to jump to a brief.
  openBriefOnDesigns: ((briefId: string) => void) | null;
  registerBriefOpener: (fn: ((briefId: string) => void) | null) => void;
};

const Ctx = createContext<ClientPortalCtx | null>(null);

export function useClientPortal() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useClientPortal outside provider");
  return ctx;
}

export function ClientPortalProvider({ token, children }: { token: string; children: ReactNode }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevActivityRef = useRef<Record<string, string>>({});
  const briefOpenerRef = useRef<((briefId: string) => void) | null>(null);

  async function fetchPortal(isInitial: boolean) {
    try {
      const res = await fetch(`/api/portal/client/${token}`);
      const body = await res.json();
      if (!res.ok) {
        if (isInitial) { setError(body.error || "Couldn't load"); setLoading(false); }
        return;
      }
      const nextBriefs = body.briefs || [];

      // Toast on new external activity between polls. Initial load doesn't
      // toast — everything would flood at once.
      if (!isInitial) {
        const prev = prevActivityRef.current;
        const newToasts: Toast[] = [];
        for (const b of nextBriefs) {
          const nextAt = b.last_activity_at || "";
          const prevAt = prev[b.id] || "";
          if (nextAt && nextAt > prevAt && b.has_unread_external) {
            newToasts.push({
              id: `${b.id}-${nextAt}`,
              briefId: b.id,
              title: b.title || "Untitled design",
              preview: b.preview_line || "New activity",
            });
          }
        }
        if (newToasts.length > 0) {
          setToasts(t => [...newToasts, ...t].slice(0, 5));
          newToasts.forEach(t => setTimeout(() => {
            setToasts(ts => ts.filter(x => x.id !== t.id));
          }, 6000));
        }
      }
      const snap: Record<string, string> = {};
      for (const b of nextBriefs) snap[b.id] = b.last_activity_at || "";
      prevActivityRef.current = snap;

      setData(body);
    } catch {
      if (isInitial) setError("Connection error");
    }
    if (isInitial) setLoading(false);
  }

  useEffect(() => {
    fetchPortal(true);
    const interval = setInterval(() => fetchPortal(false), 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const dismissToast = (id: string) => setToasts(ts => ts.filter(x => x.id !== id));
  const registerBriefOpener = (fn: ((briefId: string) => void) | null) => {
    briefOpenerRef.current = fn;
  };

  return (
    <Ctx.Provider value={{
      data, loading, error, token,
      refetch: () => fetchPortal(false),
      toasts, dismissToast,
      openBriefOnDesigns: briefOpenerRef.current,
      registerBriefOpener,
    }}>
      {children}
    </Ctx.Provider>
  );
}
