export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resendForSlug } from "@/lib/resend-client";
import type { Database } from "@/types/database";
import type { Quote } from "@/lib/menu-quote";

// POST /api/menu/lead/[token]/accept — the client accepts the quote.
// Accept works even with checklist points open (the page says so) — an
// accepted quote with a missing size grid is a job that WANTS to start,
// not a lead to re-chase. hello@ gets the bell; job creation is the next
// phase (accept→job) and reads everything from this record.

const FROM_EMAIL = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
const TO_EMAIL = "hello@housepartydistro.com";

function admin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const sb = admin();
  const { data: lead } = await sb
    .from("menu_leads")
    .select("id,email,quote,contact,client_match")
    .eq("token", token)
    .maybeSingle();
  if (!lead?.quote) return NextResponse.json({ error: "No quote on this link." }, { status: 404 });

  const quote = lead.quote as Quote;
  quote.acceptedAt = new Date().toISOString();

  const { error } = await sb
    .from("menu_leads")
    .update({
      quote,
      status: "accepted",
      accepted_at: quote.acceptedAt,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", lead.id);
  if (error) return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });

  const openPoints = quote.punch.filter((p) => p.required && p.status !== "done").map((p) => p.label);
  try {
    await resendForSlug("hpd").emails.send({
      from: `OpsHub <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      replyTo: lead.email,
      subject: `[Menu] QUOTE ACCEPTED: ${(lead.contact as any)?.name || lead.email} — $${(quote.total || 0).toLocaleString()}`,
      text: [
        `${(lead.contact as any)?.name || lead.email} accepted the quote ($${(quote.total || 0).toLocaleString()}).`,
        openPoints.length ? `Still open on the checklist: ${openPoints.join(", ")}` : "Checklist complete — everything needed to build the job is on the lead.",
        lead.client_match ? "EXISTING CLIENT — check the client card before creating a duplicate." : "New client.",
        "",
        "Review: https://app.housepartydistro.com/intake",
      ].join("\n"),
    });
  } catch { /* bell only */ }

  return NextResponse.json({ ok: true });
}
