#!/usr/bin/env node
// Duplicate the HPD "ICON" decorator into IHM. Tenant rule: no shared
// anything — each tenant has its own row with the same data so future
// IHM-specific tweaks (rates, contacts, notes) won't bleed back to HPD.

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: companies, error: cErr } = await sb
    .from("companies")
    .select("id, slug, name")
    .in("slug", ["hpd", "ihm"]);
  if (cErr) throw cErr;
  const hpd = companies.find(c => c.slug === "hpd");
  const ihm = companies.find(c => c.slug === "ihm");
  if (!hpd) throw new Error("HPD company row not found");
  if (!ihm) throw new Error("IHM company row not found");
  console.log(`HPD: ${hpd.id}`);
  console.log(`IHM: ${ihm.id}`);

  const { data: source, error: sErr } = await sb
    .from("decorators")
    .select("*")
    .eq("company_id", hpd.id)
    .ilike("name", "ICON Screening")
    .maybeSingle();
  if (sErr) throw sErr;
  if (!source) {
    const { data: any } = await sb
      .from("decorators")
      .select("name, company_id")
      .ilike("name", "%icon%");
    console.log("No exact 'ICON' row under HPD. Candidates:", any);
    process.exit(1);
  }
  console.log(`Found HPD decorator: ${source.name} (${source.id})`);

  const { data: existing } = await sb
    .from("decorators")
    .select("id, name")
    .eq("company_id", ihm.id)
    .ilike("name", source.name)
    .maybeSingle();
  if (existing) {
    console.log(`IHM already has "${existing.name}" (${existing.id}) — skipping insert.`);
    process.exit(0);
  }

  // Strip identity + audit + per-tenant unique columns; carry everything
  // else 1:1. external_token is the vendor portal token — must be unique
  // per row, so let the DB regenerate it via column default.
  const { id, created_at, updated_at, company_id, external_token, ...rest } = source;
  const payload = { ...rest, company_id: ihm.id };

  const { data: inserted, error: iErr } = await sb
    .from("decorators")
    .insert(payload)
    .select("id, name, company_id, short_code")
    .single();
  if (iErr) {
    console.error("Insert failed:");
    console.error(JSON.stringify(iErr, null, 2));
    console.error("Payload keys:", Object.keys(payload).sort().join(", "));
    process.exit(1);
  }
  console.log(`Inserted IHM copy: ${inserted.name} (${inserted.id})`);
  console.log("Carried fields:", Object.keys(rest).sort().join(", "));
})();
