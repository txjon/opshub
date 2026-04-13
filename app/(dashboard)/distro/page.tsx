import { createClient } from "@/lib/supabase/server";
import { T, font, mono } from "@/lib/theme";
import Link from "next/link";

export default async function DistroDashboard() {
  const supabase = await createClient();

  // Load active warehouse data
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, job_number, phase, shipping_route, fulfillment_status, fulfillment_tracking, type_meta, clients(name), items(id, pipeline_stage, received_at_hpd, ship_tracking, buy_sheet_lines(qty_ordered))")
    .not("phase", "in", '("complete","cancelled","on_hold")')
    .not("shipping_route", "eq", "drop_ship")
    .order("created_at", { ascending: false });

  const allJobs = jobs || [];
  const allItems = allJobs.flatMap(j => (j.items || []));

  // Counts
  const incomingItems = allItems.filter(it => it.pipeline_stage === "shipped" && !it.received_at_hpd).length;
  const receivedItems = allItems.filter(it => it.received_at_hpd).length;
  const shipThroughJobs = allJobs.filter(j => j.shipping_route === "ship_through" && (j.items || []).every(it => it.received_at_hpd) && (j.items || []).length > 0).length;
  const fulfillmentJobs = allJobs.filter(j => j.shipping_route === "stage" && (j.items || []).every(it => it.received_at_hpd) && (j.items || []).length > 0).length;
  const totalUnits = allItems.reduce((a, it) => a + (it.buy_sheet_lines || []).reduce((b: number, l: any) => b + (l.qty_ordered || 0), 0), 0);

  const kpis = [
    { label: "Incoming", value: incomingItems, color: T.amber, href: "/receiving" },
    { label: "Received", value: receivedItems, color: T.green, href: "/receiving" },
    { label: "Ship-Through", value: shipThroughJobs, color: T.blue, href: "/shipping" },
    { label: "Fulfillment", value: fulfillmentJobs, color: T.purple, href: "/fulfillment" },
    { label: "Total Units", value: totalUnits.toLocaleString(), color: T.accent, href: null },
  ];

  return (
    <div style={{ fontFamily: font, color: T.text }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Distro Dashboard</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Warehouse operations
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        {kpis.map(kpi => {
          const inner = (
            <div style={{
              flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
              padding: "14px 16px", textAlign: "center", cursor: kpi.href ? "pointer" : "default",
              transition: "border-color 0.15s",
            }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: kpi.color, fontFamily: mono }}>{kpi.value}</div>
              <div style={{ fontSize: 9, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>{kpi.label}</div>
            </div>
          );
          return kpi.href ? <Link key={kpi.label} href={kpi.href} style={{ flex: 1, textDecoration: "none" }}>{inner}</Link> : <div key={kpi.label} style={{ flex: 1 }}>{inner}</div>;
        })}
      </div>

      {/* Quick links */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {[
          { href: "/receiving", label: "Receiving", desc: "Confirm incoming shipments from decorators", color: T.amber },
          { href: "/shipping", label: "Shipping", desc: "Forward ship-through orders to clients", color: T.blue },
          { href: "/fulfillment", label: "Fulfillment", desc: "Pack and ship staged orders", color: T.purple },
        ].map(link => (
          <Link key={link.href} href={link.href} style={{ textDecoration: "none" }}>
            <div style={{
              background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
              padding: "20px", transition: "border-color 0.15s",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: link.color, marginBottom: 4 }}>{link.label}</div>
              <div style={{ fontSize: 11, color: T.muted }}>{link.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
