"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty } from "@/lib/use-warehouse";
import { logJobActivity } from "@/components/JobActivityPanel";
import { createClient } from "@/lib/supabase/client";

export default function ShippingPage() {
  const { loading, shipThrough, undoReceived, updateFulfillment, debounceFulfillmentTracking, supabase, setJobs } = useWarehouse();
  const [outsideShipments, setOutsideShipments] = useState<any[]>([]);
  const db = createClient();

  useEffect(() => {
    db.from("outside_shipments").select("*").eq("route", "ship_through").eq("resolved", true).order("received_at", { ascending: false }).then(({ data }) => setOutsideShipments(data || []));
  }, []);

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Shipping</h1>
        {shipThrough.length > 0 && <span style={{ fontSize: 12, color: T.muted }}>{shipThrough.length} orders ready to ship</span>}
      </div>

      {shipThrough.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
          No orders ready to ship. Ship-through orders appear here after all items are received.
        </div>
      ) : (
        shipThrough.map(job => {
          const totalUnits = job.items.reduce((a, it) => a + tQty(it.qtys), 0);
          return (
            <div key={job.id} style={card}>
              {/* Header */}
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
                <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
                <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.display_number}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: T.green, fontWeight: 600 }}>{job.items.length} items · {totalUnits.toLocaleString()} units</span>
              </div>

              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Ship-to + contact */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Ship To</div>
                    {job.ship_to_address ? (
                      <div style={{ fontSize: 12, color: T.text, whiteSpace: "pre-line", lineHeight: 1.4 }}>{job.ship_to_address}</div>
                    ) : (
                      <div style={{ fontSize: 12, color: T.red }}>No address on file</div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Contact</div>
                    {job.contact_name ? (
                      <div>
                        <div style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{job.contact_name}</div>
                        {job.contact_phone && <div style={{ fontSize: 11, color: T.muted }}>{job.contact_phone}</div>}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: T.faint }}>No contact</div>
                    )}
                    {job.ship_method && (
                      <div style={{ marginTop: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: T.accentDim, color: T.accent }}>{job.ship_method}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Items */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Items</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {job.items.map(item => (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: T.surface, borderRadius: 6 }}>
                        <div>
                          <span style={{ fontSize: 10, fontWeight: 700, color: T.purple, fontFamily: mono, marginRight: 4 }}>{item.letter}</span><span style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{item.name}</span>
                          {item.blank_vendor && <span style={{ fontSize: 10, color: T.faint, marginLeft: 6 }}>{item.blank_vendor}</span>}
                        </div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {item.sizes.map(sz => (
                            <span key={sz} style={{ fontSize: 9, fontFamily: mono, color: T.muted, padding: "1px 4px", background: T.card, borderRadius: 3 }}>
                              {sz}:{item.qtys?.[sz] || 0}
                            </span>
                          ))}
                          <span style={{ fontSize: 10, fontWeight: 600, fontFamily: mono, color: T.text, marginLeft: 4 }}>{tQty(item.qtys)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Project-level shipping notes */}
                {job.shipping_notes && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Shipping Notes</div>
                    <div style={{ fontSize: 11, color: T.amber, padding: "6px 10px", background: T.amberDim, borderRadius: 6 }}>{job.shipping_notes}</div>
                  </div>
                )}

                {/* Per-item notes from Production */}
                {job.items.some(it => it.ship_notes) && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Production Notes</div>
                    {job.items.filter(it => it.ship_notes).map(it => (
                      <div key={it.id} style={{ fontSize: 11, color: T.amber, padding: "6px 10px", background: T.amberDim, borderRadius: 6, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{it.name}:</span> {it.ship_notes}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tracking + ship */}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block" }}>Outbound Tracking #</label>
                    <input style={{ ...ic, fontFamily: mono }} value={job.fulfillment_tracking || ""} placeholder="Enter tracking number"
                      onChange={e => debounceFulfillmentTracking(job.id, e.target.value)} />
                  </div>
                  <button onClick={async () => {
                    if (!job.fulfillment_tracking) return;
                    await updateFulfillment(job.id, "shipped");
                    logJobActivity(job.id, `Ship-through complete — forwarded to client (${job.fulfillment_tracking})`);
                    await supabase.from("jobs").update({ phase: "complete" }).eq("id", job.id);
                    // Auto-email client shipped notification
                    fetch("/api/email/notify", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ jobId: job.id, type: "order_shipped_hpd", trackingNumber: job.fulfillment_tracking }),
                    }).catch(() => {});
                    setJobs(prev => prev.filter(j => j.id !== job.id));
                  }}
                    disabled={!job.fulfillment_tracking}
                    style={{ background: job.fulfillment_tracking ? T.green : T.surface, border: "none", borderRadius: 6, color: job.fulfillment_tracking ? "#fff" : T.faint, fontSize: 12, fontWeight: 600, padding: "8px 20px", cursor: job.fulfillment_tracking ? "pointer" : "default", opacity: job.fulfillment_tracking ? 1 : 0.5 }}>
                    Mark Shipped
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
      {/* Outside shipments routed to ship-through */}
      {outsideShipments.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 8 }}>Outside Shipments</div>
          {outsideShipments.map(s => (
            <div key={s.id} style={{ ...card, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.description}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    {[s.sender, s.carrier, s.tracking].filter(Boolean).join(" · ")}
                    {s.job_id && <span style={{ marginLeft: 8, color: T.blue }}> Linked to project</span>}
                  </div>
                </div>
                <button onClick={async () => {
                  await db.from("outside_shipments").update({ route: "shipped" }).eq("id", s.id);
                  setOutsideShipments(prev => prev.filter(x => x.id !== s.id));
                }}
                  style={{ fontSize: 10, fontWeight: 600, padding: "5px 14px", borderRadius: 6, border: "none", background: T.green, color: "#fff", cursor: "pointer" }}>
                  Mark Shipped
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
