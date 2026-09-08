export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resendForSlug } from "@/lib/resend-client";
import type { Database } from "@/types/database";

// POST /api/menu/lead/[token]/quote — "Request my real quote".
// { name, phone?, neededBy?, notes? }
//
// Promotes the lead browsed → quote_requested, stores the contact block,
// and snapshots the EXACT rates shown right now into rates_snapshot —
// menu_rates drifts as Jon/Taylor edit it, and the quoting conversation
// must know what the customer saw, not what the table says later.
// Pings hello@ so the 1-business-day promise has a bell attached.

const TO_EMAIL = "hello@housepartydistro.com";
const FROM_EMAIL = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

function admin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  const contact = {
    name: name.slice(0, 120),
    phone: String(body?.phone || "").trim().slice(0, 40) || null,
    neededBy: String(body?.neededBy || "").trim().slice(0, 40) || null,
    notes: String(body?.notes || "").trim().slice(0, 2000) || null,
  };

  const sb = admin();
  const { data: lead } = await sb
    .from("menu_leads")
    .select("id,email,picks,client_match")
    .eq("token", token)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { data: rates } = await sb
    .from("menu_rates")
    .select("product_group,lane,style_code,style_name,band_min,price_lo,price_hi")
    .eq("active", true);

  // Sign 30-day download URLs for any art the customer attached (paths in
  // the private intake-uploads bucket) so /intake and the notify email can
  // link straight to the files.
  const picks = (lead.picks || {}) as Record<string, any>;
  const FILE_URL_TTL = 60 * 60 * 24 * 30;
  if (Array.isArray(picks.files) && picks.files.length) {
    picks.files = await Promise.all(picks.files.map(async (f: any) => {
      if (!f?.path) return f;
      const { data } = await sb.storage.from("intake-uploads").createSignedUrl(f.path, FILE_URL_TTL);
      return { ...f, url: data?.signedUrl || f.url || null };
    }));
  }

  const { error } = await sb
    .from("menu_leads")
    .update({
      status: "quote_requested",
      contact,
      picks,
      rates_snapshot: rates || [],
      quote_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", lead.id);
  if (error) return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });

  // Ring the bell. Send-and-forget — the customer's confirmation never
  // waits on internal mail.
  try {
    const items = Array.isArray(picks.items) ? picks.items : [];
    const itemLines = items.length
      ? items.map((it: any) => `- ${it.styleCode} x ${it.qty}${Array.isArray(it.colors) && it.colors.length ? ` (${it.colors.join(", ")})` : ""}`)
      : ["- no styles picked (browsing / needs guidance)"];
    const fileLines = Array.isArray(picks.files)
      ? picks.files.filter((f: any) => f?.url).map((f: any) => `- ${f.filename}: ${f.url}`)
      : [];
    const summary = [
      "Picks:",
      ...itemLines,
      picks.budget ? `Budget: $${Number(picks.budget).toLocaleString()}` : null,
      picks.artStatus ? `Art: ${picks.artStatus === "need_help" ? "needs design help" : "ready"}` : null,
      picks.notes ? `Notes: ${picks.notes}` : null,
      contact.neededBy ? `Needed by: ${contact.neededBy}` : null,
      contact.notes ? `Extra: ${contact.notes}` : null,
      ...(fileLines.length ? ["Art files:", ...fileLines] : []),
      lead.client_match ? "MATCHES AN EXISTING CLIENT — check before quoting rack rates" : null,
    ].filter(Boolean).join("\n");
    await resendForSlug("hpd").emails.send({
      from: `OpsHub <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      replyTo: lead.email,
      subject: `[Menu] Quote request: ${contact.name}`,
      text: `${contact.name} <${lead.email}>${contact.phone ? ` · ${contact.phone}` : ""}\n\n${summary}\n\nReview: https://app.housepartydistro.com/intake`,
    });
  } catch (err) {
    console.error("menu quote notify failed", err);
  }

  return NextResponse.json({ ok: true });
}
