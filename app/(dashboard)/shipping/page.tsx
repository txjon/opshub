"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty } from "@/lib/use-warehouse";
import { logJobActivity } from "@/components/JobActivityPanel";
import { createClient } from "@/lib/supabase/client";
import { deductSamples } from "@/lib/qty";
import { NotifyShipmentDialog } from "@/components/NotifyShipmentDialog";

type ShippedHistoryEntry = {
  id: string;
  jobNumber: string;
  invoiceNumber: string | null;
  title: string;
  clientName: string;
  fulfillmentTracking: string;
  shippedAt: string;
  itemCount: number;
  totalUnits: number;
};

export default function ShippingPage() {
  const { loading, shipThrough, undoReceived, updateFulfillment, debounceFulfillmentTracking, supabase, setJobs } = useWarehouse();
  const [outsideShipments, setOutsideShipments] = useState<any[]>([]);
  const [tab, setTab] = useState<"ready" | "shipped">("ready");
  const [shippedHistory, setShippedHistory] = useState<ShippedHistoryEntry[]>([]);
  const [shippedLoading, setShippedLoading] = useState(false);
  const db = createClient();

  // Notify Recipient dialog — opens after Mark Shipped flips state. Mirrors
  // the production page pattern: ship the goods, then a confirmation dialog
  // picks contacts + edits subject/message before firing the email.
  // Spec: memory/project_notify_recipient_on_ship.md
  const [notifyState, setNotifyState] = useState<{
    jobId: string;
    decoratorId: string | null;
    decoratorName: string;
    tracking: string;
    qbInvoiceNumber: string;
    clientName: string;
    jobTitle: string;
    contacts: Array<{ name: string; email: string; role: string }>;
  } | null>(null);
  // Cached contacts per job — lazy load on dialog open.
  const [contactsByJob, setContactsByJob] = useState<Record<string, Array<{ name: string; email: string; role: string }>>>({});

  useEffect(() => {
    db.from("outside_shipments").select("*").eq("route", "ship_through").eq("resolved", true).order("received_at", { ascending: false }).then(({ data }) => setOutsideShipments(data || []));
  }, []);

  // Load completed ship-through jobs for the Shipped history tab.
  // Window: last 30 days. Sorted newest first. Refetch when the user
  // switches to the tab so a freshly-shipped order shows up without
  // a page reload.
  async function loadShippedHistory() {
    setShippedLoading(true);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await db
      .from("jobs")
      .select("id, job_number, title, type_meta, fulfillment_tracking, fulfillment_status, updated_at, clients(name), items(id, received_qtys, ship_qtys, sample_qtys, buy_sheet_lines(size, qty_ordered))")
      .eq("phase", "complete")
      .eq("shipping_route", "ship_through")
      .eq("fulfillment_status", "shipped")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(50);
    const mapped: ShippedHistoryEntry[] = ((data as any[]) || []).map(j => {
      const items = j.items || [];
      const totalUnits = items.reduce((sum: number, it: any) => {
        const lines = it.buy_sheet_lines || [];
        const r = it.received_qtys || {};
        const s = it.ship_qtys || {};
        const delivered: Record<string, number> = {};
        for (const l of lines) delivered[l.size] = r[l.size] ?? s[l.size] ?? l.qty_ordered ?? 0;
        const continuing = deductSamples(delivered, it.sample_qtys);
        return sum + Object.values(continuing).reduce((a: number, v) => a + (v || 0), 0);
      }, 0);
      return {
        id: j.id,
        jobNumber: j.job_number,
        invoiceNumber: (j.type_meta as any)?.qb_invoice_number || null,
        title: j.title || "",
        clientName: j.clients?.name || "",
        fulfillmentTracking: j.fulfillment_tracking || "",
        shippedAt: j.updated_at,
        itemCount: items.length,
        totalUnits,
      };
    });
    setShippedHistory(mapped);
    setShippedLoading(false);
  }

  useEffect(() => { if (tab === "shipped") loadShippedHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  async function loadJobContacts(jobId: string): Promise<Array<{ name: string; email: string; role: string }>> {
    if (contactsByJob[jobId]) return contactsByJob[jobId];
    const { data } = await db
      .from("job_contacts")
      .select("role_on_job, contacts(name, email)")
      .eq("job_id", jobId);
    const list = ((data as any[]) || [])
      .map(r => ({
        name: r.contacts?.name || "Unnamed",
        email: r.contacts?.email || "",
        role: r.role_on_job || "",
      }))
      .filter(c => c.email);
    setContactsByJob(prev => ({ ...prev, [jobId]: list }));
    return list;
  }

  // Mark Shipped flow:
  // 1. Flip state (fulfillment_status = shipped, phase = complete)
  // 2. Open notify dialog with route="drop_ship" so the customer-style
  //    email + contact picker render. Even though the job's actual
  //    shipping_route is ship_through, at this step (HPD outbound to
  //    customer) the email semantics are identical to drop_ship —
  //    "Your order has shipped" with packing slip attached.
  // 3. Job removed from local list when dialog closes (sent or cancelled).
  async function markShipped(job: any) {
    if (!job.fulfillment_tracking) return;
    await updateFulfillment(job.id, "shipped");
    logJobActivity(job.id, `Ship-through complete — forwarded to client (${job.fulfillment_tracking})`);
    await supabase.from("jobs").update({ phase: "complete" }).eq("id", job.id);
    const contacts = await loadJobContacts(job.id);
    setNotifyState({
      jobId: job.id,
      decoratorId: null,
      decoratorName: "",
      tracking: job.fulfillment_tracking,
      qbInvoiceNumber: job.qb_invoice_number || "",
      clientName: job.client_name || "",
      jobTitle: job.title || "",
      contacts,
    });
  }

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Shipping</h1>
        {tab === "ready" && shipThrough.length > 0 && <span style={{ fontSize: 12, color: T.muted }}>{shipThrough.length} orders ready to ship</span>}
        {tab === "shipped" && <span style={{ fontSize: 12, color: T.muted }}>last 30 days</span>}
      </div>

      {/* Tab bar — Ready (active) / Shipped (history). Read-only history
          gives Goose a way to look up tracking, qty shipped, and dates
          for client callbacks without crossing into the production side. */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
        {([
          ["ready", "Ready", shipThrough.length, T.text],
          ["shipped", "Shipped", shippedHistory.length, T.green],
        ] as const).map(([k, l, count, tone]) => {
          const active = tab === k;
          return (
            <button key={k} onClick={() => setTab(k as any)}
              style={{
                background: "transparent", border: "none", padding: "4px 0",
                cursor: "pointer", fontFamily: font,
                fontSize: 13, fontWeight: active ? 800 : 600,
                color: active ? T.text : T.muted,
                borderBottom: active ? `2px solid ${T.text}` : "2px solid transparent",
                marginBottom: -7,
              }}>
              {l}
              {count > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: active ? tone : T.faint }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "ready" && (<>
      {shipThrough.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
          No orders ready to ship. Ship-through orders appear here after all items are received.
        </div>
      ) : (
        shipThrough.map(job => {
          // Continuing qty per item = (received_qtys || ship_qtys || qtys) − samples.
          // This is what physically ships out the door — drives the per-size
          // display and the header units total.
          const continuingByItem: Record<string, Record<string, number>> = {};
          for (const it of job.items) {
            const delivered: Record<string, number> = {};
            const r = it.received_qtys || {};
            const s = it.ship_qtys || {};
            const o = it.qtys || {};
            for (const sz of it.sizes) delivered[sz] = r[sz] ?? s[sz] ?? o[sz] ?? 0;
            continuingByItem[it.id] = deductSamples(delivered, it.sample_qtys);
          }
          const totalUnits = job.items.reduce((a, it) =>
            a + Object.values(continuingByItem[it.id]).reduce((x, q) => x + (q || 0), 0), 0);
          const qbMissing = !job.qb_invoice_number;
          const trackingMissing = !job.fulfillment_tracking;
          const canShip = !qbMissing && !trackingMissing;
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
                    {job.items.map(item => {
                      const continuing = continuingByItem[item.id] || {};
                      const itemTotal = Object.values(continuing).reduce((a, q) => a + (q || 0), 0);
                      const orderedTotal = tQty(item.qtys);
                      const sampleTotal = tQty(item.sample_qtys);
                      const variance = itemTotal - orderedTotal;
                      return (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: T.surface, borderRadius: 6 }}>
                        <div>
                          <span style={{ fontSize: 10, fontWeight: 700, color: T.purple, fontFamily: mono, marginRight: 4 }}>{item.letter}</span><span style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{item.name}</span>
                          {item.blank_vendor && <span style={{ fontSize: 10, color: T.faint, marginLeft: 6 }}>{item.blank_vendor}</span>}
                          {(variance !== 0 || sampleTotal > 0) && (
                            <span style={{ fontSize: 10, color: T.faint, marginLeft: 8 }}>
                              {variance !== 0 && <span style={{ color: variance < 0 ? T.amber : T.green, fontWeight: 600 }}>{variance > 0 ? "+" : ""}{variance} vs ordered</span>}
                              {variance !== 0 && sampleTotal > 0 && " · "}
                              {sampleTotal > 0 && <span style={{ color: T.amber }}>{sampleTotal} sample{sampleTotal === 1 ? "" : "s"} pulled</span>}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {item.sizes.map(sz => {
                            const cont = continuing[sz] ?? 0;
                            const ord = item.qtys?.[sz] ?? 0;
                            const off = cont !== ord;
                            return (
                              <span key={sz} title={off ? `Ordered ${ord}, continuing ${cont}` : undefined}
                                style={{ fontSize: 9, fontFamily: mono, color: off ? (cont < ord ? T.amber : T.green) : T.muted, padding: "1px 4px", background: T.card, borderRadius: 3 }}>
                                {sz}:{cont}
                              </span>
                            );
                          })}
                          <span style={{ fontSize: 10, fontWeight: 600, fontFamily: mono, color: T.text, marginLeft: 4 }}>{itemTotal}</span>
                        </div>
                      </div>
                      );
                    })}
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
                  <button onClick={() => markShipped(job)}
                    disabled={!canShip}
                    title={qbMissing ? "Generate QB invoice first" : (trackingMissing ? "Tracking required" : "")}
                    style={{ background: canShip ? T.green : T.surface, border: "none", borderRadius: 6, color: canShip ? "#fff" : T.faint, fontSize: 12, fontWeight: 600, padding: "8px 20px", cursor: canShip ? "pointer" : "not-allowed", opacity: canShip ? 1 : 0.5 }}>
                    Mark Shipped
                  </button>
                </div>
                {qbMissing && (
                  <div style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>
                    QB invoice not yet generated — required before notifying customer.
                  </div>
                )}
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
      </>)}

      {/* ── Shipped history ── */}
      {tab === "shipped" && (
        shippedLoading ? (
          <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.muted }}>Loading…</div>
        ) : shippedHistory.length === 0 ? (
          <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
            No ship-throughs in the last 30 days.
          </div>
        ) : (
          <div style={{ ...card }}>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 100px 1fr 90px", padding: "8px 14px", background: T.surface, borderBottom: `1px solid ${T.border}`, gap: 12 }}>
              {["Order", "Client / Project", "Items", "Tracking", "Shipped"].map(h =>
                <div key={h} style={{ fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
              )}
            </div>
            {shippedHistory.map((row, i) => (
              <Link key={row.id} href={`/jobs/${row.id}`}
                style={{
                  display: "grid", gridTemplateColumns: "120px 1fr 100px 1fr 90px", gap: 12,
                  padding: "10px 14px", alignItems: "center",
                  borderBottom: i < shippedHistory.length - 1 ? `1px solid ${T.border}` : "none",
                  textDecoration: "none", color: "inherit",
                }}>
                <div style={{ fontSize: 12, fontFamily: mono, fontWeight: 700, color: T.text }}>
                  {row.invoiceNumber || row.jobNumber}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.clientName || "—"}</div>
                  <div style={{ fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
                </div>
                <div style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>
                  {row.itemCount} item{row.itemCount === 1 ? "" : "s"} · <span style={{ color: T.text, fontWeight: 600 }}>{row.totalUnits.toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 11, fontFamily: mono, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.fulfillmentTracking || "—"}
                </div>
                <div style={{ fontSize: 11, color: T.muted }}>
                  {new Date(row.shippedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </Link>
            ))}
          </div>
        )
      )}

      {/* Notify Recipient dialog — opens after Mark Shipped. Customer
          contact picker + subject/message editor + BCC + preview, then
          fires the customer-shipped email with packing slip attached.
          Job is removed from the local list on dialog close (sent or
          cancelled — DB state was already advanced when Mark Shipped
          ran, so the next page load wouldn't show it anyway). */}
      <NotifyShipmentDialog
        open={!!notifyState}
        onClose={() => {
          if (notifyState) {
            const id = notifyState.jobId;
            setJobs(prev => prev.filter(j => j.id !== id));
          }
          setNotifyState(null);
        }}
        onSent={() => { /* removal handled in onClose for both sent + cancelled */ }}
        route="drop_ship"
        jobId={notifyState?.jobId || ""}
        decoratorId={notifyState?.decoratorId || null}
        decoratorName={notifyState?.decoratorName || ""}
        tracking={notifyState?.tracking || ""}
        qbInvoiceNumber={notifyState?.qbInvoiceNumber || ""}
        clientName={notifyState?.clientName || ""}
        jobTitle={notifyState?.jobTitle || ""}
        contacts={notifyState?.contacts || []}
      />
    </div>
  );
}
