#!/usr/bin/env node
/**
 * Re-fire a shipment_notify email for a given job (for testing the
 * outbound packing-slip fix). Uses the internal service-role key so
 * we don't have to log in as a user.
 *
 * Replicates exactly what /shipping → Mark Shipped → Notify
 * dialog → "Send" sends, but with resend=true so the dedup record
 * doesn't block.
 *
 * Usage:
 *   node scripts/resend-shipment-notify.js HPD-2605-002 jon@housepartydistro.com [tracking]
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const [, , jobNumber, recipient, trackingArg] = process.argv;
if (!jobNumber || !recipient) {
  console.error("Usage: node scripts/resend-shipment-notify.js <job#> <recipient> [tracking]");
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

(async () => {
  const { data: job } = await sb
    .from("jobs")
    .select("id, job_number, title, fulfillment_tracking, type_meta, shipping_route, clients(name)")
    .eq("job_number", jobNumber)
    .single();
  if (!job) { console.error(`No job ${jobNumber}`); process.exit(2); }

  // Use original tracking from the prior notification record if not provided.
  const records = (job.type_meta || {}).shipping_notifications || [];
  const lastDropShip = records.filter(r => r.type === "drop_ship_vendor").pop();
  const tracking = trackingArg || job.fulfillment_tracking || lastDropShip?.tracking;
  if (!tracking) {
    console.error("No tracking number — pass one as the 3rd arg");
    process.exit(3);
  }

  console.log(`Job:      ${job.job_number}`);
  console.log(`Title:    ${job.title}`);
  console.log(`Client:   ${job.clients?.name}`);
  console.log(`Route:    ${job.shipping_route}`);
  console.log(`Tracking: ${tracking}`);
  console.log(`To:       ${recipient}`);
  console.log("");

  const body = {
    type: "shipment_notify",
    jobId: job.id,
    route: "drop_ship", // shipping page forces this for customer-style email
    decoratorId: null,
    vendorName: "",
    trackingNumber: tracking,
    to: [recipient],
    cc: [],
    bcc: [],
    resend: true,
  };

  const res = await fetch(`${BASE}/api/email/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  console.log(`Status: ${res.status}`);
  console.log(JSON.stringify(data, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
