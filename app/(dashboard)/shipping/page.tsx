"use client";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty } from "@/lib/use-warehouse";
import { logJobActivity } from "@/components/JobActivityPanel";

export default function ShippingPage() {
  const { loading, shipThrough, undoReceived, updateFulfillment, debounceFulfillmentTracking, supabase, setJobs } = useWarehouse();

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
        shipThrough.map(job => (
          <div key={job.id} style={card}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Link href={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none" }}>{job.client_name}</Link>
              <span style={{ fontSize: 11, color: T.muted }}>— {job.title}</span>
              <span style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>#{job.job_number}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: T.green, fontWeight: 600 }}>All {job.items.length} items received</span>
            </div>
            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: T.faint, marginBottom: 3, display: "block" }}>Outbound tracking #</label>
                  <input style={{ ...ic, fontFamily: mono }} value={job.fulfillment_tracking || ""} placeholder="Enter tracking to mark shipped"
                    onChange={e => debounceFulfillmentTracking(job.id, e.target.value)} />
                </div>
                <button onClick={async () => {
                  if (!job.fulfillment_tracking) return;
                  await updateFulfillment(job.id, "shipped");
                  logJobActivity(job.id, `Ship-through complete — forwarded to client (${job.fulfillment_tracking})`);
                  await supabase.from("jobs").update({ phase: "complete" }).eq("id", job.id);
                  setJobs(prev => prev.filter(j => j.id !== job.id));
                }}
                  disabled={!job.fulfillment_tracking}
                  style={{ background: job.fulfillment_tracking ? T.green : T.surface, border: "none", borderRadius: 6, color: job.fulfillment_tracking ? "#fff" : T.faint, fontSize: 11, fontWeight: 600, padding: "8px 16px", cursor: job.fulfillment_tracking ? "pointer" : "default", opacity: job.fulfillment_tracking ? 1 : 0.5 }}>
                  Mark Shipped
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {job.items.map(item => (
                  <span key={item.id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: T.surface, color: T.muted, cursor: "pointer" }}
                    onClick={() => undoReceived(item)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.amber; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.muted; }}
                    title="Click to revert to incoming">
                    {item.name} · {tQty(item.qtys)} units
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
