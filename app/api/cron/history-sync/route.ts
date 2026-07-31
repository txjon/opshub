import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { runQbHistorySync } from "@/lib/qb-history-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // full QB re-pull (~10k lines) + stamp pass

// Nightly QB → history_sales sync (Jon, Jul 31 2026: "re-run the QB pull
// nightly"). The archive was a one-time Jul-21 snapshot; god-mode fell ~10
// days behind QB. Full idempotent re-pull — see lib/qb-history-sync.
// Protected by CRON_SECRET, same as the other crons.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const r = await runQbHistorySync(db);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "sync failed" }, { status: 500 });
  }
}
