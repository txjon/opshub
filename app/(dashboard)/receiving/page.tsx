"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty } from "@/lib/use-warehouse";

type OutsideShipment = {
  id: string;
  carrier: string;
  tracking: string;
  sender: string;
  description: string;
  condition: string;
  notes: string;
  job_id: string | null;
  resolved: boolean;
  received_at: string;
};

export default function ReceivingPage() {
  const { loading, incoming, updateReceivedQty, markReceived, undoReceived } = useWarehouse();
  const supabase = createClient();

  const [outsideShipments, setOutsideShipments] = useState<OutsideShipment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ carrier: "", tracking: "", sender: "", description: "", condition: "good", notes: "" });
  const [saving, setSaving] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; title: string; client_name: string; job_number: string }[]>([]);
  const [tab, setTab] = useState<"production" | "outside">("production");
  const [conditionNote, setConditionNote] = useState<Record<string, string>>({});

  useEffect(() => {
    loadOutside();
    loadJobs();
  }, []);

  async function loadOutside() {
    const { data } = await supabase
      .from("outside_shipments")
      .select("*")
      .eq("resolved", false)
      .order("received_at", { ascending: false });
    setOutsideShipments(data || []);
  }

  async function loadJobs() {
    const { data } = await supabase
      .from("jobs")
      .select("id, title, job_number, clients(name)")
      .not("phase", "in", '("complete","cancelled")')
      .order("created_at", { ascending: false })
      .limit(50);
    setJobs((data || []).map((j: any) => ({ id: j.id, title: j.title, client_name: j.clients?.name || "", job_number: j.job_number })));
  }

  async function submitOutside() {
    if (!form.description.trim()) return;
    setSaving(true);
    await supabase.from("outside_shipments").insert({
      carrier: form.carrier || null,
      tracking: form.tracking || null,
      sender: form.sender || null,
      description: form.description,
      condition: form.condition,
      notes: form.notes || null,
    });
    setForm({ carrier: "", tracking: "", sender: "", description: "", condition: "good", notes: "" });
    setShowForm(false);
    setSaving(false);
    loadOutside();
  }

  async function linkToJob(shipmentId: string, jobId: string) {
    await supabase.from("outside_shipments").update({ job_id: jobId }).eq("id", shipmentId);
    loadOutside();
  }

  async function resolveShipment(id: string) {
    await supabase.from("outside_shipments").update({ resolved: true }).eq("id", id);
    setOutsideShipments(prev => prev.filter(s => s.id !== id));
  }

  // Stats
  const expectedCount = incoming.reduce((a, j) => a + j.items.filter(it => !it.received_at_hpd).length, 0);
  const overdueItems = incoming.reduce((a, j) => {
    return a + j.items.filter(it => {
      if (it.received_at_hpd || !it.ship_tracking) return false;
      // No ship date tracked, so just count items with tracking but not received
      return true;
    }).length;
  }, 0);
  const receivedToday = incoming.reduce((a, j) => {
    return a + j.items.filter(it => {
      if (!it.received_at_hpd || !it.received_at_hpd_at) return false;
      return new Date(it.received_at_hpd_at).toDateString() === new Date().toDateString();
    }).length;
  }, 0);
  const unroutedOutside = outsideShipments.filter(s => !s.job_id).length;

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "7px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Receiving</h1>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 10 }}>
        {[
          { label: "Expected", value: expectedCount, color: T.accent },
          { label: "Received Today", value: receivedToday, color: T.green },
          { label: "Unrouted", value: unroutedOutside, color: unroutedOutside > 0 ? T.amber : T.faint },
        ].map(s => (
          <div key={s.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 16px", flex: 1 }}>
            <div style={{ fontSize: 9, color: T.faint, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: mono, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: 4, background: T.surface, borderRadius: 8 }}>
        {([
          { id: "production" as const, label: "Production Returns", count: expectedCount },
          { id: "outside" as const, label: "Outside Shipments", count: outsideShipments.length },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 600, fontFamily: font,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              background: tab === t.id ? T.accent : "transparent",
              color: tab === t.id ? "#fff" : T.muted,
            }}>
            {t.label}
            {t.count > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, padding: "1px 6px", borderRadius: 99,
                background: tab === t.id ? "rgba(255,255,255,0.2)" : T.card,
                color: tab === t.id ? "#fff" : T.accent,
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── PRODUCTION RETURNS ── */}
      {tab === "production" && (
        incoming.length === 0 ? (
          <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
            No incoming items. Items appear here when shipped from decorator.
          </div>
        ) : (
          incoming.map(job => (
            <div key={job.id} style={card}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
                <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
                <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.job_number}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 99,
                  background: job.shipping_route === "stage" ? "#2d1f5e" : T.accentDim,
                  color: job.shipping_route === "stage" ? "#a78bfa" : T.accent }}>
                  {job.shipping_route === "stage" ? "→ Fulfillment" : "→ Shipping"}
                </span>
              </div>
              <div style={{ padding: "10px 14px" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                      {["Item", "Tracking", "Shipped → Received", "Condition", ""].map(h =>
                        <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {job.items.map((item, i) => {
                      const shippedQty = tQty(item.ship_qtys);
                      const totalQty = tQty(item.qtys);
                      const receivedTotal = tQty(item.received_qtys);
                      const hasVariance = item.received_at_hpd && receivedTotal > 0 && receivedTotal !== (shippedQty || totalQty);
                      return (
                        <tr key={item.id} style={{ borderBottom: i < job.items.length - 1 ? `1px solid ${T.border}` : "none", verticalAlign: "top" }}>
                          <td style={{ padding: "8px", fontWeight: 600 }}>
                            {item.name}
                            <div style={{ fontSize: 10, color: T.faint, fontWeight: 400 }}>{[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ")}</div>
                          </td>
                          <td style={{ padding: "8px", fontFamily: mono, fontSize: 11, color: T.muted }}>{item.ship_tracking || "—"}</td>
                          <td style={{ padding: "8px" }}>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {item.sizes.map(sz => {
                                const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                                const received = item.received_qtys?.[sz] ?? shipped;
                                const mismatch = item.received_at_hpd && received !== shipped;
                                return (
                                  <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                    <span style={{ fontSize: 8, color: T.faint, fontFamily: mono }}>{sz}</span>
                                    <span style={{ fontSize: 10, color: T.muted, fontFamily: mono }}>{shipped}</span>
                                    <input type="number" min="0" value={received}
                                      onChange={e => updateReceivedQty(item, sz, parseInt(e.target.value) || 0)}
                                      onFocus={e => e.target.select()}
                                      style={{ width: 36, textAlign: "center", padding: "2px", border: `1px solid ${mismatch ? T.red : T.border}`, borderRadius: 3, background: T.surface, color: mismatch ? T.red : T.text, fontSize: 10, fontFamily: mono, outline: "none" }} />
                                  </div>
                                );
                              })}
                            </div>
                            {hasVariance && <div style={{ fontSize: 9, color: T.red, marginTop: 4 }}>Variance: {receivedTotal - (shippedQty || totalQty)} units</div>}
                          </td>
                          <td style={{ padding: "8px" }}>
                            {item.received_at_hpd ? (
                              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: hasVariance ? T.amberDim : T.greenDim, color: hasVariance ? T.amber : T.green }}>
                                {hasVariance ? "Variance" : "Good"}
                              </span>
                            ) : (
                              <input
                                type="text"
                                placeholder="Notes..."
                                value={conditionNote[item.id] || ""}
                                onChange={e => setConditionNote(prev => ({ ...prev, [item.id]: e.target.value }))}
                                style={{ ...ic, width: 100, fontSize: 10, padding: "3px 6px" }}
                              />
                            )}
                          </td>
                          <td style={{ padding: "8px", textAlign: "right" }}>
                            {item.received_at_hpd ? (
                              <button onClick={() => undoReceived(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>Undo</button>
                            ) : (
                              <button onClick={() => markReceived(item)} style={{ fontSize: 10, fontWeight: 600, color: "#fff", background: T.green, border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}>Receive</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )
      )}

      {/* ── OUTSIDE SHIPMENTS ── */}
      {tab === "outside" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Add button */}
          <button onClick={() => setShowForm(!showForm)}
            style={{ alignSelf: "flex-start", padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: font }}>
            + Log Incoming Shipment
          </button>

          {/* Intake form */}
          {showForm && (
            <div style={{ ...card, padding: "16px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>New Outside Shipment</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Carrier</label>
                  <input style={ic} value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} placeholder="UPS, FedEx, USPS..." />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Tracking #</label>
                  <input style={{ ...ic, fontFamily: mono }} value={form.tracking} onChange={e => setForm(f => ({ ...f, tracking: e.target.value }))} placeholder="Tracking number" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Sender</label>
                  <input style={ic} value={form.sender} onChange={e => setForm(f => ({ ...f, sender: e.target.value }))} placeholder="Who sent it?" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Condition</label>
                  <select style={ic} value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                    <option value="good">Good</option>
                    <option value="damaged">Damaged</option>
                    <option value="partial">Partial</option>
                    <option value="wrong_item">Wrong Item</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Description *</label>
                <input style={ic} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What is it? e.g. Client samples, return from Nike, supplies box" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
                <input style={ic} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional details" />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={submitOutside} disabled={saving || !form.description.trim()}
                  style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 600, opacity: saving || !form.description.trim() ? 0.5 : 1 }}>
                  {saving ? "Saving..." : "Log Shipment"}
                </button>
                <button onClick={() => setShowForm(false)}
                  style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 12 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Outside shipments list */}
          {outsideShipments.length === 0 && !showForm ? (
            <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
              No outside shipments logged. Use the button above to log incoming packages not tied to a project.
            </div>
          ) : (
            outsideShipments.map(s => (
              <div key={s.id} style={{ ...card, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{s.description}</div>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: T.muted, flexWrap: "wrap" }}>
                      {s.sender && <span>From: {s.sender}</span>}
                      {s.carrier && <span>{s.carrier}</span>}
                      {s.tracking && <span style={{ fontFamily: mono }}>{s.tracking}</span>}
                      <span>{new Date(s.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    {s.notes && <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>{s.notes}</div>}
                    <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                        background: s.condition === "good" ? T.greenDim : s.condition === "damaged" ? T.redDim : T.amberDim,
                        color: s.condition === "good" ? T.green : s.condition === "damaged" ? T.red : T.amber,
                      }}>
                        {s.condition === "good" ? "Good" : s.condition === "damaged" ? "Damaged" : s.condition === "partial" ? "Partial" : "Wrong Item"}
                      </span>
                      {s.job_id ? (
                        <span style={{ fontSize: 10, color: T.accent }}>
                          Linked to project
                        </span>
                      ) : (
                        <select
                          onChange={e => { if (e.target.value) linkToJob(s.id, e.target.value); }}
                          value=""
                          style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: `1px solid ${T.border}`, background: T.surface, color: T.muted, cursor: "pointer" }}>
                          <option value="">Link to project...</option>
                          {jobs.map(j => (
                            <option key={j.id} value={j.id}>{j.client_name} — {j.title}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <button onClick={() => resolveShipment(s.id)}
                    style={{ fontSize: 10, padding: "4px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, cursor: "pointer", flexShrink: 0 }}>
                    Resolve
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
