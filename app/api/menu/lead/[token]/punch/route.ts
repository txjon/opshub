export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resendForSlug } from "@/lib/resend-client";
import type { Database } from "@/types/database";
import type { Quote, PunchPoint } from "@/lib/menu-quote";

// POST /api/menu/lead/[token]/punch — the client completes a punch-list
// point on their quote page. { key, payload } — payload shape depends on
// the point's kind; 'files' payloads may carry {add:{filename,path,size}}
// entries which get signed 30-day download URLs here.
// When the LAST required point completes, hello@ gets one bell.

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
  const body = await req.json().catch(() => null);
  const key = String(body?.key || "");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const sb = admin();
  const { data: lead } = await sb
    .from("menu_leads")
    .select("id,email,quote,contact")
    .eq("token", token)
    .maybeSingle();
  if (!lead?.quote) return NextResponse.json({ error: "No quote on this link." }, { status: 404 });

  const quote = lead.quote as Quote;
  const point = quote.punch.find((p) => p.key === key);
  if (!point) return NextResponse.json({ error: "Unknown checklist point." }, { status: 400 });

  const wasAllDone = quote.punch.every((p) => !p.required || p.status === "done");

  if (point.kind === "files") {
    const add = body?.add;
    const existing = ((point.payload as any)?.files || []) as any[];
    if (add?.path && add?.filename) {
      const { data: signed } = await sb.storage.from("intake-uploads").createSignedUrl(String(add.path), 60 * 60 * 24 * 30);
      existing.push({ filename: String(add.filename).slice(0, 200), path: String(add.path), size: Number(add.size) || 0, url: signed?.signedUrl || null });
    }
    if (body?.removePath) {
      const idx = existing.findIndex((f) => f.path === body.removePath);
      if (idx >= 0) existing.splice(idx, 1);
    }
    point.payload = { files: existing };
    point.status = existing.length ? "done" : "needed";
  } else {
    const payload = body?.payload;
    if (payload == null || typeof payload !== "object" || JSON.stringify(payload).length > 20000) {
      return NextResponse.json({ error: "Bad payload" }, { status: 400 });
    }
    point.payload = payload;
    point.status = "done";
  }

  const { error } = await sb
    .from("menu_leads")
    .update({ quote, updated_at: new Date().toISOString() } as never)
    .eq("id", lead.id);
  if (error) return NextResponse.json({ error: "Save failed" }, { status: 500 });

  const nowAllDone = quote.punch.every((p) => !p.required || p.status === "done");
  if (!wasAllDone && nowAllDone) {
    try {
      await resendForSlug("hpd").emails.send({
        from: `OpsHub <${FROM_EMAIL}>`,
        to: TO_EMAIL,
        replyTo: lead.email,
        subject: `[Build] Checklist complete: ${(lead.contact as any)?.name || lead.email}`,
        text: `Every required point on the quote checklist is done.\n\nReview: https://app.housepartydistro.com/intake`,
      });
    } catch { /* bell only */ }
  }

  return NextResponse.json({ ok: true, quote });
}
