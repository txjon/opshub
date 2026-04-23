export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await req.json();
    const { company, contactName, email, phone, address, city, state, zip, projectDetails, timeline, extraContacts } = body;

    if (!company?.trim() || !contactName?.trim() || !email?.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Create client
    const shippingAddress = [address, city, state, zip].filter(Boolean).join(", ");
    const { data: client, error: clientErr } = await sb
      .from("clients")
      .insert({
        name: company.trim(),
        type: "corporate",
        shipping_address: shippingAddress || null,
        notes: [
          projectDetails ? `Project: ${projectDetails}` : "",
          timeline ? `Timeline: ${timeline}` : "",
        ].filter(Boolean).join("\n") || null,
      })
      .select("id")
      .single();

    if (clientErr) throw new Error(clientErr.message);

    // Create primary contact
    const { data: contact } = await sb
      .from("contacts")
      .insert({
        name: contactName.trim(),
        email: email.trim(),
        phone: phone?.trim() || null,
        client_id: client.id,
      })
      .select("id")
      .single();

    // Create extra contacts
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

    // Notifications table deprecated — bell UI was removed.

    return NextResponse.json({ success: true, clientId: client.id });
  } catch (e: any) {
    console.error("Onboard error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
