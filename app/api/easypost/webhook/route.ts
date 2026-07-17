import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { applyTrackerPayload } from "@/lib/inbound-tracking";

export const dynamic = "force-dynamic";

// EasyPost tracking webhook — push-updates for inbound boxes (plan locked
// 2026-07-16). Verifies the HMAC signature (X-Hmac-Signature =
// "hmac-sha256-hex=" + HMAC_SHA256(secret NFKD, raw body)), then applies the
// tracker payload to its shipment. Idempotent at the DB: scans upsert on a
// unique scan_key, so retries and replays no-op. NEVER touches received
// state — delivered_at is a carrier signal; receiving is human truth.
//
// Always 200 on verified requests (even unknown trackers) so EasyPost
// doesn't retry-spam events we deliberately ignore.

const admin = () =>
  createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.EASYPOST_WEBHOOK_SECRET || "";
  if (!secret || !header) return false;
  const expected = "hmac-sha256-hex=" + createHmac("sha256", secret.normalize("NFKD")).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (!verifySignature(raw, req.headers.get("x-hmac-signature"))) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
    const event = JSON.parse(raw);
    // only tracker events carry scans; ignore everything else politely
    if (!String(event?.description || "").startsWith("tracker.")) {
      return NextResponse.json({ ok: true, ignored: event?.description || "unknown" });
    }
    const tracker = event.result;
    if (!tracker?.id) return NextResponse.json({ ok: true, ignored: "no tracker" });

    const sb = admin();
    const { data: boxes } = await sb.from("shipments").select("id").eq("easypost_tracker_id", tracker.id);
    if (!boxes?.length) return NextResponse.json({ ok: true, ignored: "unknown tracker" });
    for (const b of boxes) await applyTrackerPayload(sb, b.id, tracker);
    return NextResponse.json({ ok: true, applied: boxes.length });
  } catch (e: any) {
    console.error("[easypost webhook]", e);
    // 200 so EasyPost doesn't hammer retries on our own bug; error is logged
    return NextResponse.json({ ok: false, error: e?.message || "failed" });
  }
}

// Internal health check (deploy verification): requires the service key
// header, confirms the EasyPost key is active from the deployed environment.
export async function GET(req: NextRequest) {
  if (req.headers.get("x-internal-key") !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = process.env.EASYPOST_API_KEY || "";
  const res = await fetch("https://api.easypost.com/v2/trackers?page_size=1", {
    headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64") },
  });
  return NextResponse.json({
    easypost_key: res.ok ? "active" : `error ${res.status}`,
    webhook_secret_set: !!process.env.EASYPOST_WEBHOOK_SECRET,
  });
}
