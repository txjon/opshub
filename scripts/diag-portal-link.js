#!/usr/bin/env node
/**
 * Diagnose what portal URL would be generated for a job's email.
 * Usage: node scripts/diag-portal-link.js <jobId>
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const [, , jobId] = process.argv;
if (!jobId) { console.error("Usage: node scripts/diag-portal-link.js <jobId>"); process.exit(1); }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, title, job_number, portal_token, client_id, clients(name, portal_token, client_hub_enabled)")
    .eq("id", jobId)
    .single();
  if (error || !job) { console.error("Job not found:", error?.message); process.exit(1); }

  const c = job.clients || {};
  const baseUrl = "https://app.housepartydistro.com";
  const clientHubUrl = c.client_hub_enabled && c.portal_token
    ? `${baseUrl}/portal/client/${c.portal_token}/orders/${job.id}`
    : null;
  const legacyUrl = job.portal_token ? `${baseUrl}/portal/${job.portal_token}` : null;

  console.log("─── JOB ───");
  console.log(`Id:              ${job.id}`);
  console.log(`Job number:      ${job.job_number}`);
  console.log(`Title:           ${job.title}`);
  console.log(`portal_token:    ${job.portal_token || "(null)"}`);
  console.log("");
  console.log("─── CLIENT ───");
  console.log(`Name:                ${c.name}`);
  console.log(`portal_token:        ${c.portal_token || "(null)"}`);
  console.log(`client_hub_enabled:  ${c.client_hub_enabled === undefined ? "(undefined)" : c.client_hub_enabled}`);
  console.log("");
  console.log("─── COMPUTED ───");
  console.log(`Would use:           ${clientHubUrl ? "CLIENT HUB" : "LEGACY"}`);
  console.log(`Client hub URL:      ${clientHubUrl || "(unavailable — needs client.client_hub_enabled + client.portal_token)"}`);
  console.log(`Legacy URL:          ${legacyUrl || "(unavailable — job has no portal_token)"}`);
})().catch(e => { console.error(e); process.exit(1); });
