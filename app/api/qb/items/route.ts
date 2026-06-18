import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listItems, type QBItem } from "@/lib/quickbooks";

export const runtime = "nodejs";

// Live QB Product/Service catalog for the custom-invoice-line-item editor.
// The catalog changes rarely and the dropdown tolerates a few minutes of
// staleness, so we cache in-memory per warm serverless instance (cold starts
// repopulate). Pass ?refresh=1 to force a live read right after editing items
// in QB.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { items: QBItem[]; at: number } | null = null;

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const now = Date.now();
    if (!refresh && cache && now - cache.at < CACHE_TTL_MS) {
      return NextResponse.json({ items: cache.items, cached: true });
    }

    const items = await listItems();
    cache = { items, at: now };
    return NextResponse.json({ items, cached: false });
  } catch (e: any) {
    // A live refresh that fails shouldn't break the editor — serve the last
    // good catalog if we have one, flagged stale.
    if (cache) {
      return NextResponse.json({ items: cache.items, cached: true, stale: true });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
