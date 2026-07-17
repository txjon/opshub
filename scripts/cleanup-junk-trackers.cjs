#!/usr/bin/env node
/**
 * One-off cleanup after the default-carrier retry (2026-07-16):
 *  - "RET1" + "MULTIPLE - SEE ATTACHMENT": junk strings that FedExDefault
 *    happily accepted — detach the trackers (boxes back to plain untracked,
 *    attempted stamped so nothing retries them).
 *  - 874349855343 (typed "DHL"): landed on a DHLExpress tracker stuck
 *    "unknown"; the number is FedEx Ground format like its siblings —
 *    recreate as FedExDefault and keep whichever has real data.
 *
 * Usage: npx -y tsx scripts/cleanup-junk-trackers.cjs
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const auth = "Basic " + Buffer.from((process.env.EASYPOST_API_KEY || "") + ":").toString("base64");

async function main() {
  const { applyTrackerPayload } = await import("../lib/inbound-tracking.ts");

  for (const junk of ["RET1", "MULTIPLE - SEE ATTACHMENT"]) {
    const { data: boxes } = await sb.from("shipments").select("id").eq("tracking", junk).not("easypost_tracker_id", "is", null);
    for (const b of boxes || []) {
      await sb.from("tracking_events").delete().eq("shipment_id", b.id);
      await sb.from("shipments").update({
        easypost_tracker_id: null, carrier_status: null, carrier_detected: null,
        est_delivery_date: null, est_delivery_updated_at: null, last_scan: null,
        tracking_error: null, tracker_attempted_at: new Date().toISOString(),
      }).eq("id", b.id);
      console.log(`${junk}: detached tracker, box back to untracked`);
    }
  }

  const { data: dhlBoxes } = await sb.from("shipments").select("id, carrier_status").eq("tracking", "874349855343").eq("carrier_status", "unknown");
  for (const b of dhlBoxes || []) {
    const res = await fetch("https://api.easypost.com/v2/trackers", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ tracker: { tracking_code: "874349855343", carrier: "FedExDefault" } }),
    });
    const t = await res.json();
    if (!res.ok) { console.log(`874349855343: FedExDefault create failed — ${t?.error?.message}; leaving DHL tracker`); continue; }
    if (t.status === "unknown" && !(t.tracking_details || []).length) {
      console.log("874349855343: FedEx tracker also unknown/no scans — leaving DHL tracker in place");
      continue;
    }
    await sb.from("tracking_events").delete().eq("shipment_id", b.id);
    await sb.from("shipments").update({ easypost_tracker_id: t.id }).eq("id", b.id);
    await applyTrackerPayload(sb, b.id, t);
    console.log(`874349855343: re-pointed to FedEx tracker (${t.status}, ${(t.tracking_details || []).length} scans)`);
  }

  const { data: after } = await sb.from("shipments")
    .select("tracking, carrier_status, carrier_detected, est_delivery_date, delivered_at, tracking_error, easypost_tracker_id")
    .eq("direction", "inbound").neq("status", "received");
  console.log("\nopen inbound boxes:");
  for (const b of after || []) {
    const tag = b.easypost_tracker_id
      ? `${b.carrier_detected || "?"} · ${b.carrier_status || "?"} · est ${b.est_delivery_date || "-"} · delivered ${b.delivered_at ? b.delivered_at.slice(0, 10) : "-"}`
      : (b.tracking_error ? "ERR " + b.tracking_error : "untracked");
    console.log(`  ${b.tracking || "(no tracking)"} · ${tag}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
