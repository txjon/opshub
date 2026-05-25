export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

// POST /api/onboard
//
// Public intake endpoint. Writes EVERY submission to the
// intake_submissions table as a discrete record. The team reviews on
// /intake and explicitly converts to a client when ready — we don't
// auto-create clients here, because that mixed leads into the customer
// list and made the data noisy.
//
// Accepts both shapes:
//   1. New /start 6-step form — full structured payload
//   2. Legacy /onboard form — flatter shape; we coerce into the same
//      intake_submissions row so the team only has one inbox to watch
//
// Returns 200 with { ok: true, id } on success.

type IntakeBody = {
  // Always present (both forms)
  company?: string;
  contactName?: string;
  email?: string;
  phone?: string;

  // Legacy /onboard fields
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  projectDetails?: string;
  timeline?: string;
  extraContacts?: { name?: string; email?: string; phone?: string }[];

  // New /start fields
  project_type?: string;
  project_name?: string;
  description?: string;
  items_count_range?: string;
  units_range?: string;
  target_ship_date?: string;
  budget_range?: string;
  shipping_route?: string;
  items?: { name?: string; sizes?: Record<string, number | string> }[];
  files?: { filename?: string; url?: string | null; size?: number; path?: string }[];
};

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const sb = admin();

    const body = (await req.json()) as IntakeBody;
    const { company, contactName, email } = body;

    if (!company?.trim() || !contactName?.trim() || !email?.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Tenant slug — Host header → slug, matches the marketing site's
    // tenant routing. Defaults to HPD.
    const h = await headers();
    const slug = h.get("x-company-slug") || "hpd";

    // Coerce legacy form fields into the new shape.
    const description = body.description?.trim()
      || [body.projectDetails, body.timeline].filter(Boolean).join("\n\n").trim()
      || null;

    // Legacy shipping address — fold into notes since the new schema
    // doesn't have a dedicated address column on submissions.
    const legacyAddress = [body.address, body.city, body.state, body.zip].filter(Boolean).join(", ");
    const extraContactsBlock = (body.extraContacts || [])
      .filter(c => c.email?.trim())
      .map(c => `  • ${c.name || "—"} <${c.email}>${c.phone ? " · " + c.phone : ""}`)
      .join("\n");
    const legacyNotes = [
      legacyAddress ? `Address: ${legacyAddress}` : "",
      extraContactsBlock ? `Extra contacts:\n${extraContactsBlock}` : "",
    ].filter(Boolean).join("\n\n") || null;

    // Items — normalize size values to numbers so the DB has clean shape.
    const items = (body.items || []).map(it => ({
      name: (it.name || "").trim() || null,
      sizes: Object.fromEntries(
        Object.entries(it.sizes || {})
          .map(([k, v]) => [k.toUpperCase(), typeof v === "string" ? parseInt(v) : v])
          .filter(([, n]) => typeof n === "number" && !isNaN(n) && n > 0)
      ),
    })).filter(it => it.name || Object.keys(it.sizes).length > 0);

    // Files — keep just what's meaningful for review later.
    const files = (body.files || []).map(f => ({
      filename: f.filename || null,
      url: f.url || null,
      size: typeof f.size === "number" ? f.size : null,
      path: f.path || null,
    })).filter(f => f.filename);

    const insert = {
      status: "new" as const,
      project_type: body.project_type || null,
      project_name: body.project_name?.trim() || null,
      description,
      items_count_range: body.items_count_range || null,
      units_range: body.units_range || null,
      target_ship_date: body.target_ship_date || null,
      budget_range: body.budget_range || null,
      shipping_route: body.shipping_route || null,
      items,
      files,
      contact_name: contactName.trim(),
      contact_email: email.trim(),
      contact_phone: body.phone?.trim() || null,
      company: company.trim(),
      company_slug: slug,
      notes: legacyNotes,
    };

    const { data, error } = await (sb.from("intake_submissions") as any)
      .insert(insert)
      .select("id")
      .single();

    if (error) {
      console.error("Intake insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (e: any) {
    console.error("Onboard error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
