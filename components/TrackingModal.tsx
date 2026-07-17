"use client";
// Live tracking detail for one tracking number — the internal expanded view.
// Modeled on LedgerHistory's anatomy (eyebrow header, summary strip, dot-rail
// timeline) so it reads as the same family of modal. Data = the box's tracker
// summary (shipments row) + full scan history (tracking_events, webhook-fed).
//
// TrackingLink is the universal click target: any tracking number rendered
// through it opens this modal. Click-to-VIEW, so the affordance is link
// language (hover blue + underline), NOT the dotted-underline edit convention.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";

const STATUS_META: Record<string, { label: string; color: string }> = {
  pre_transit: { label: "Label created", color: T.amber },
  in_transit: { label: "In transit", color: T.blue },
  out_for_delivery: { label: "Out for delivery", color: T.amber },
  available_for_pickup: { label: "Available for pickup", color: T.amber },
  delivered: { label: "Delivered", color: T.green },
  return_to_sender: { label: "Return to sender", color: T.red },
  failure: { label: "Delivery failure", color: T.red },
  error: { label: "Carrier error", color: T.red },
  cancelled: { label: "Cancelled", color: T.red },
  unknown: { label: "No movement yet", color: T.faint },
};
const statusMeta = (s: string | null | undefined) => STATUS_META[s || "unknown"] || { label: s || "—", color: T.muted };

// Carrier-direct tracking pages, keyed loosely so "FedExDefault" / "UPSDAP" /
// typed vendor spellings all land.
export function carrierTrackUrl(carrier: string | null | undefined, tracking: string): string | null {
  const c = (carrier || "").toLowerCase();
  const n = encodeURIComponent(tracking);
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`;
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  if (c.includes("dhl")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}`;
  return null;
}

const fmtWhen = (iso: string | null) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};
const fmtDayOnly = (iso: string | null) => {
  if (!iso) return "—";
  const d = iso.includes("T") ? new Date(iso) : new Date(iso + "T12:00:00");
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

type BoxRow = {
  id: string; carrier: string | null; tracking: string | null; carrier_detected: string | null;
  carrier_status: string | null; est_delivery_date: string | null; delivered_at: string | null;
  tracking_error: string | null; created_at: string; status: string | null; received_at: string | null;
};
type Scan = { id: string; status: string | null; description: string | null; location: string | null; occurred_at: string | null };

export function TrackingModal({ tracking, shipmentId, onClose }: { tracking: string; shipmentId?: string | null; onClose: () => void }) {
  const [box, setBox] = useState<BoxRow | null>(null);
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sb = createClient();
    (async () => {
      const SEL = "id, carrier, tracking, carrier_detected, carrier_status, est_delivery_date, delivered_at, tracking_error, created_at, status, received_at";
      let b: BoxRow | null = null;
      if (shipmentId) b = (await sb.from("shipments").select(SEL).eq("id", shipmentId).single()).data as any;
      if (!b) {
        // items-list entry points only know the number — prefer the tracked twin
        const { data } = await sb.from("shipments").select(SEL).eq("tracking", tracking)
          .order("easypost_tracker_id", { ascending: false, nullsFirst: false } as any).limit(1);
        b = (data as any[])?.[0] || null;
      }
      setBox(b);
      if (b) {
        const { data: ev } = await sb.from("tracking_events").select("id, status, description, location, occurred_at")
          .eq("shipment_id", b.id).order("occurred_at", { ascending: false });
        setScans((ev as any[]) || []);
      } else setScans([]);
    })();
  }, [tracking, shipmentId]);

  const carrier = box?.carrier_detected || box?.carrier || null;
  const outUrl = carrierTrackUrl(carrier, tracking);
  // human receive state outranks carrier talk — a counted-in box saying
  // "No movement yet" reads as a broken feed when it's actually DONE
  const isReceived = box?.status === "received";
  const cur = isReceived
    ? { label: "Received at HPD", color: T.green }
    : statusMeta(box?.delivered_at ? "delivered" : box?.carrier_status);
  const hasFeed = !!box?.carrier_status;

  const stat = (label: string, value: string, color?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color: color || T.text, fontFamily: mono }}>{value}</span>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 12, width: "100%", maxWidth: 560, maxHeight: "86vh", display: "flex", flexDirection: "column", overflow: "hidden", border: `1px solid ${T.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", fontFamily: font }}>
        {/* header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Live tracking</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginTop: 2, fontFamily: mono, wordBreak: "break-all" }}>{tracking}</div>
            <div style={{ display: "flex", gap: 12, marginTop: 5, alignItems: "baseline", flexWrap: "wrap" }}>
              <span onClick={() => { navigator.clipboard?.writeText(tracking); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                style={{ fontSize: 11, fontWeight: 700, color: copied ? T.green : T.muted, cursor: "pointer" }}>
                {copied ? "✓ copied" : "Copy number"}
              </span>
              {outUrl && (
                <a href={outUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: T.blue, textDecoration: "none" }}>
                  Track on {carrier?.replace(/Default$/, "").replace(/DAP$/, "")} →
                </a>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* summary strip */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, background: T.surface + "55", display: "flex", gap: 26, flexWrap: "wrap" }}>
          {stat("Status", box === null ? "…" : cur.label, cur.color)}
          {stat("Carrier", carrier ? carrier.replace(/Default$/, "").replace(/DAP$/, "") : "—")}
          {box?.delivered_at
            ? stat("Delivered", fmtDayOnly(box.delivered_at), T.green)
            : stat("Est. delivery", fmtDayOnly(box?.est_delivery_date || null), box?.est_delivery_date ? T.text : T.faint)}
        </div>

        {/* scan timeline — newest first */}
        <div style={{ overflowY: "auto", padding: "8px 20px 20px" }}>
          {scans === null && <div style={{ padding: 30, textAlign: "center", color: T.faint }}>Loading…</div>}
          {scans && scans.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: T.faint, fontSize: 13 }}>
              {box?.tracking_error
                ? <>The carrier rejected this number — <span style={{ color: T.red, fontWeight: 600 }}>{box.tracking_error}</span></>
                : isReceived && !hasFeed
                  ? "Received and counted in — this box finished its trip before live tracking existed, so no feed was ever created."
                  : hasFeed
                    ? "No scans yet — the carrier hasn't moved it."
                    : "No live feed for this box — freight, pickup, or shipped before tracking went live."}
              {outUrl && <div style={{ marginTop: 8 }}><a href={outUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: T.blue, textDecoration: "none" }}>Check on the carrier site →</a></div>}
            </div>
          )}
          {(scans || []).map((s, i) => {
            const m = statusMeta(s.status);
            return (
              <div key={s.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.border}55`, opacity: i === 0 ? 1 : 0.85 }}>
                <div style={{ width: 8, height: 8, borderRadius: 8, background: m.color, marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? m.color : T.text }}>{s.description || m.label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.faint, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>{fmtWhen(s.occurred_at)}</span>
                    {s.location && <span>· {s.location}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// The universal click target — wrap any rendered tracking number. Opens the
// modal; eats the click (cards underneath are click-to-act). Link affordance:
// hover turns blue + underlines (view, not edit — dotted underline stays
// reserved for editable values).
export function TrackingLink({ tracking, shipmentId, style }: { tracking: string; shipmentId?: string | null; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <>
      <span onClick={e => { e.stopPropagation(); setOpen(true); }}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        title="Live tracking — scan history + carrier link"
        style={{ fontFamily: mono, cursor: "pointer", color: hover ? T.blue : undefined, textDecoration: hover ? "underline" : "none", ...style }}>
        {tracking}
      </span>
      {open && <TrackingModal tracking={tracking} shipmentId={shipmentId} onClose={() => setOpen(false)} />}
    </>
  );
}
