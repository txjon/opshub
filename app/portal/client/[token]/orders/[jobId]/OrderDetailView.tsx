"use client";
// Client Hub — per-order detail (P1 session 2, Jul 20 2026). This surface now
// renders the SAME shop-skinned OrderExperience as the per-job portal — one
// component, two doors, zero drift. This file is the thin adapter: fetch the
// hub payload (which carries the OrderExperience item fields + jobPortalToken
// for PDF links), wire actions, and wrap in modal chrome when the Orders tab
// opens it as an overlay.
import { useState, useEffect } from "react";
import { H } from "@/components/hub/theme";
import { OrderExperience } from "@/components/hub/OrderExperience";

// Reusable view — used by the standalone route AND by the Orders tab modal.
// Pass `onClose` to render as a modal (Close row top-right, no back link);
// omit it to render standalone. suppressOwnChrome kept for the tab embed
// (the tab supplies its own modal shell).
export function OrderDetailView({ token, jobId, onClose, suppressOwnChrome }: {
  token: string; jobId: string; onClose?: () => void; suppressOwnChrome?: boolean;
}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, jobId]);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/portal/client/${token}/orders/${jobId}`);
      if (!res.ok) { setError("This link is no longer valid."); return; }
      setData(await res.json());
      setError("");
    } catch { if (!quiet) setError("Unable to load. Please try again."); }
    finally { setLoading(false); }
  }

  async function doAction(action: string, extra?: Record<string, any>) {
    const res = await fetch(`/api/portal/client/${token}/orders/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    if (res.ok) await load(true);
  }

  const frame: React.CSSProperties = {
    background: H.ink, color: H.text, fontFamily: H.font,
    minHeight: suppressOwnChrome ? "100%" : "100vh",
  };

  if (loading) return <div style={{ ...frame, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "50vh", color: H.faint, fontSize: 13 }}>Loading…</div>;

  if (error || !data) return (
    <div style={{ ...frame, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "50vh", padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 900, textTransform: "uppercase" }}>Link not found.</div>
      <div style={{ fontSize: 13, color: H.dim, maxWidth: "44ch" }}>{error || "This order link is invalid."} If you think that's wrong, reply to your rep and we'll sort it out.</div>
    </div>
  );

  return (
    <div style={frame}>
      <div style={{ display: "flex", justifyContent: onClose ? "flex-end" : "flex-start", padding: "16px 18px 0" }}>
        {onClose ? (
          <button onClick={onClose} aria-label="Close"
            style={{ background: "none", border: `1px solid ${H.line}`, color: H.dim, borderRadius: 999, padding: "7px 16px", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
            Close ×
          </button>
        ) : (
          <a href={`/portal/client/${token}/orders`}
            style={{ color: H.dim, fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", textDecoration: "none" }}>
            ‹ All orders
          </a>
        )}
      </div>
      <OrderExperience data={data} token={data.jobPortalToken || token} onAction={doAction} />
    </div>
  );
}
