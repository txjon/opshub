export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/onboard
//
// Public intake endpoint. Used by:
//   1. The legacy /onboard form — sends a compact shape (company, name,
//      email, phone, address, projectDetails, timeline, extraContacts).
//   2. The new /start 6-step form — sends a richer shape (project_type,
//      ranges, items breakdown, shipping route, file URLs).
//
// We accept both shapes here so neither form gets out of sync with the
// backend. New fields are all optional — legacy submissions keep working.
//
// On submit: creates a client row + primary contact (+ extras). All
// captured details flow into clients.notes as structured human-readable
// text so the team can scan a fresh lead and know everything immediately.

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
  project_type?: "brand" | "tour" | "corporate" | "webstore" | string;
  project_name?: string;
  description?: string;
  items_count_range?: string;
  units_range?: string;
  target_ship_date?: string;
  budget_range?: string;
  shipping_route?: "ship_to_us" | "drop_ship" | "hold_for_fulfillment" | string;
  items?: { name?: string; sizes?: Record<string, number | string> }[];
  files?: { filename?: string; url?: string | null; size?: number }[];
};

const PROJECT_TYPE_LABEL: Record<string, string> = {
  brand: "Brand / Merch Drop",
  tour: "Tour / Artist",
  corporate: "Corporate",
  webstore: "Webstore",
};

const SHIPPING_ROUTE_LABEL: Record<string, string> = {
  ship_to_us: "Ship to HPD warehouse (we receive and forward)",
  drop_ship: "Drop ship direct to client / customers",
  hold_for_fulfillment: "Hold as inventory for ongoing fulfillment",
};

const CLIENT_TYPE_BY_PROJECT_TYPE: Record<string, string> = {
  brand: "brand",
  tour: "tour",
  corporate: "corporate",
  webstore: "webstore",
};

// Build the structured-text notes block from the intake payload. Mirrors
// what the team would have written by hand after a discovery call.
function buildNotes(b: IntakeBody): string {
  const lines: string[] = ["━━━ NEW INTAKE ━━━"];

  if (b.project_name) lines.push(`Project: ${b.project_name}`);
  if (b.project_type) lines.push(`Type: ${PROJECT_TYPE_LABEL[b.project_type] || b.project_type}`);
  if (b.description) lines.push("", "Description:", b.description.trim());

  if (b.items_count_range || b.units_range || b.target_ship_date || b.budget_range) {
    lines.push("", "Scope:");
    if (b.items_count_range) lines.push(`  • Designs: ${b.items_count_range}`);
    if (b.units_range) lines.push(`  • Total units: ${b.units_range}`);
    if (b.target_ship_date) lines.push(`  • Target ship date: ${b.target_ship_date}`);
    if (b.budget_range) lines.push(`  • Budget: ${b.budget_range}`);
  }

  if (b.shipping_route) {
    lines.push("", `Shipping route: ${SHIPPING_ROUTE_LABEL[b.shipping_route] || b.shipping_route}`);
  }

  // Per-item size breakdown (Step 4)
  const items = (b.items || []).filter(it => it.name?.trim() || hasAnySize(it.sizes));
  if (items.length > 0) {
    lines.push("", "Items & sizes:");
    for (const it of items) {
      const sizeStr = formatSizes(it.sizes || {});
      lines.push(`  • ${it.name?.trim() || "Item"}${sizeStr ? ` — ${sizeStr}` : ""}`);
    }
  }

  // Files from Step 3
  if ((b.files || []).length > 0) {
    lines.push("", "Files uploaded:");
    for (const f of b.files!) {
      const sizeKb = f.size ? Math.round(f.size / 1024) : null;
      lines.push(`  • ${f.filename || "file"}${sizeKb != null ? ` (${sizeKb} KB)` : ""}`);
      if (f.url) lines.push(`    ${f.url}`);
    }
  }

  // Legacy fields (only show if present and not already covered above)
  if (b.projectDetails && !b.description) {
    lines.push("", "Project details:", b.projectDetails.trim());
  }
  if (b.timeline && !b.target_ship_date) {
    lines.push("", `Timeline: ${b.timeline}`);
  }

  return lines.join("\n");
}

function hasAnySize(sizes: Record<string, number | string> | undefined): boolean {
  if (!sizes) return false;
  return Object.values(sizes).some(v => {
    const n = typeof v === "string" ? parseInt(v) : v;
    return typeof n === "number" && !isNaN(n) && n > 0;
  });
}

function formatSizes(sizes: Record<string, number | string>): string {
  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const entries = Object.entries(sizes)
    .map(([k, v]) => {
      const n = typeof v === "string" ? parseInt(v) : v;
      return [k.toUpperCase(), typeof n === "number" && !isNaN(n) ? n : 0] as [string, number];
    })
    .filter(([, n]) => n > 0)
    .sort((a, b) => SIZE_ORDER.indexOf(a[0]) - SIZE_ORDER.indexOf(b[0]));
  if (entries.length === 0) return "";
  return entries.map(([k, n]) => `${k}(${n})`).join(" ");
}

export async function POST(req: NextRequest) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = (await req.json()) as IntakeBody;
    const { company, contactName, email, phone, address, city, state, zip, extraContacts } = body;

    if (!company?.trim() || !contactName?.trim() || !email?.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const shippingAddress = [address, city, state, zip].filter(Boolean).join(", ");
    const clientType = CLIENT_TYPE_BY_PROJECT_TYPE[body.project_type || ""] || "corporate";
    const notes = buildNotes(body);

    const { data: client, error: clientErr } = await sb
      .from("clients")
      .insert({
        name: company.trim(),
        type: clientType,
        shipping_address: shippingAddress || null,
        notes: notes || null,
      })
      .select("id")
      .single();

    if (clientErr) throw new Error(clientErr.message);

    // Primary contact
    await sb.from("contacts").insert({
      name: contactName.trim(),
      email: email.trim(),
      phone: phone?.trim() || null,
      client_id: client.id,
    });

    // Extra contacts (legacy form only)
    for (const c of (extraContacts || [])) {
      if (c.email?.trim()) {
        await sb.from("contacts").insert({
          name: c.name?.trim() || "",
          email: c.email.trim(),
          phone: c.phone?.trim() || null,
          client_id: client.id,
        });
      }
    }

    return NextResponse.json({ success: true, clientId: client.id });
  } catch (e: any) {
    console.error("Onboard error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
