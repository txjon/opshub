export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";
import { appBaseUrlForSlug } from "@/lib/public-url";

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

// Escape user-supplied text before interpolating into the alert email's
// HTML. renderBrandedEmail injects heading/body raw, so anything from the
// public form must be escaped here.
const escapeHtml = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

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

    // Internal "new intake" alert → the tenant's hello@ inbox, so the team
    // sees leads without watching the /intake page. Best-effort: the row is
    // already saved, so a mail failure must never fail the submission.
    // /api/* routes aren't stamped with x-company-slug by middleware, so
    // resolve the tenant from the Host header (same approach as the notify
    // route + lib/public-url).
    try {
      const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
      const tenantSlug =
        host === "app.inhousemerchandise.com" ||
        host === "inhousemerchandise.com" ||
        host === "ihm.localhost"
          ? "ihm"
          : "hpd";

      const { data: companyRow } = await sb
        .from("companies")
        .select("name, from_email_quotes")
        .eq("slug", tenantSlug)
        .maybeSingle();
      const tenantName = (companyRow as any)?.name || "House Party Distro";
      const helloInbox =
        (companyRow as any)?.from_email_quotes ||
        process.env.EMAIL_FROM_QUOTES ||
        "hello@housepartydistro.com";

      const labelStyle =
        "font-size:11px;color:#888;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;";
      const valStyle = "font-size:14px;color:#222;margin:2px 0 12px;line-height:1.5;";
      const row = (label: string, valueHtml: string) =>
        valueHtml ? `<div style="${labelStyle}">${label}</div><div style="${valStyle}">${valueHtml}</div>` : "";
      const nl2br = (s: string) => s.replace(/\n/g, "<br/>");

      const contactHtml =
        `${escapeHtml(contactName)} &lt;<a href="mailto:${escapeHtml(email)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(email)}</a>&gt;` +
        (body.phone?.trim() ? ` · ${escapeHtml(body.phone.trim())}` : "");

      const itemsHtml = items.length
        ? `<ul style="margin:4px 0 12px;padding-left:18px;">${items
            .map((it) => {
              const sizes = Object.entries(it.sizes || {})
                .map(([sz, q]) => `${escapeHtml(sz)}(${escapeHtml(q)})`)
                .join(" ");
              return `<li style="font-size:13px;color:#333;margin:3px 0;">${escapeHtml(it.name || "Unnamed item")}${sizes ? ` — <span style="font-family:'SF Mono',Menlo,monospace;color:#666;">${sizes}</span>` : ""}</li>`;
            })
            .join("")}</ul>`
        : "";

      const filesHtml = files.length
        ? `<ul style="margin:4px 0 12px;padding-left:18px;">${files
            .map((f) => {
              const nm = escapeHtml(f.filename || "file");
              return `<li style="font-size:13px;margin:3px 0;">${f.url ? `<a href="${escapeHtml(f.url)}" style="color:#2563eb;text-decoration:none;">${nm}</a>` : nm}</li>`;
            })
            .join("")}</ul>`
        : "";

      const bodyHtml =
        row("Contact", contactHtml) +
        row("Project type", escapeHtml(body.project_type)) +
        row("Project name", escapeHtml(body.project_name)) +
        row("Description", nl2br(escapeHtml(description))) +
        row("Estimated items", escapeHtml(body.items_count_range)) +
        row("Estimated units", escapeHtml(body.units_range)) +
        row("Target ship date", escapeHtml(body.target_ship_date)) +
        row("Budget", escapeHtml(body.budget_range)) +
        row("Shipping route", escapeHtml((body.shipping_route || "").replace(/_/g, " "))) +
        row("Items", itemsHtml) +
        row("Files", filesHtml) +
        row("Notes", legacyNotes ? nl2br(escapeHtml(legacyNotes)) : "");

      const html = renderBrandedEmail({
        eyebrow: "New project inquiry",
        heading: escapeHtml(company.trim()),
        bodyHtml,
        cta: { label: "Review in OpsHub →", url: `${appBaseUrlForSlug(tenantSlug)}/intake` },
        closing: "",
        hint: "Submitted via the website intake form. Reply to this email to respond to the client directly.",
      });

      const subject =
        `New project inquiry — ${company.trim()}` +
        (body.project_name?.trim() ? ` · ${body.project_name.trim()}` : "");

      const resend = resendForSlug(tenantSlug);
      const sendRes = await resend.emails.send({
        from: `${tenantName} Website <${helloInbox}>`,
        to: helloInbox,
        subject,
        html,
        ...(email.includes("@") ? { replyTo: email.trim() } : {}),
      });
      if ((sendRes as any)?.error) {
        throw new Error((sendRes as any).error.message || "Resend rejected the send");
      }
    } catch (mailErr: any) {
      // Never fail the submission over a notification problem.
      console.error("Intake alert email failed:", mailErr?.message || mailErr);
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (e: any) {
    console.error("Onboard error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
