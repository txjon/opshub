export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// The unlisted menu's data spine.
//   GET  /api/menu/lead/[token] — lead state + the active rate card
//   POST /api/menu/lead/[token] — autosave picks { picks }
//
// Token-addressed, no auth: the token IS the credential (same model as
// the client hub). Rates go out lo/hi only — cost basis and seed meta
// never leave the building.

function admin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const validToken = (t: string) => /^[a-f0-9]{32}$/.test(t);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!validToken(token)) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const sb = admin();

  const { data: lead } = await sb
    .from("menu_leads")
    .select("email,status,picks,quote,quote_requested_at")
    .eq("token", token)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { data: rates } = await sb
    .from("menu_rates")
    .select("product_group,lane,style_code,style_name,band_min,price_lo,price_hi,sort")
    .eq("active", true)
    .order("sort")
    .order("band_min");

  // Self-hosted product imagery (scripts/fetch-menu-imagery.ts).
  const { data: imgCache } = await sb.from("api_cache").select("data").eq("key", "menu_imagery").maybeSingle();
  const imagery = ((imgCache?.data as any)?.styles || {}) as Record<string, { hero: string | null; colors: { name: string; hex: string | null; image: string | null }[]; allColors?: { name: string; hex: string | null }[]; moreCount: number }>;

  const styles: Record<string, { code: string; name: string; lane: string; group: string; sort: number; bands: Record<number, { lo: number | null; hi: number | null }>; hero: string | null; colors: { name: string; hex: string | null; image: string | null }[]; allColors: { name: string; hex: string | null }[]; moreColors: number }> = {};
  for (const r of rates || []) {
    if (!styles[r.style_code]) {
      const img = imagery[r.style_code];
      styles[r.style_code] = {
        code: r.style_code, name: r.style_name, lane: r.lane, group: r.product_group, sort: r.sort, bands: {},
        hero: img?.hero ?? null,
        colors: img?.colors ?? [],
        allColors: img?.allColors ?? [],
        moreColors: img?.moreCount ?? 0,
      };
    }
    styles[r.style_code].bands[r.band_min] = { lo: r.price_lo, hi: r.price_hi };
  }

  return NextResponse.json({
    email: lead.email,
    status: lead.status,
    picks: lead.picks || {},
    quote: lead.quote || null,
    quoteRequestedAt: lead.quote_requested_at,
    styles: Object.values(styles).sort((a, b) => a.sort - b.sort),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!validToken(token)) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const picks = body?.picks;
  if (!picks || typeof picks !== "object" || JSON.stringify(picks).length > 8000) {
    return NextResponse.json({ error: "Bad picks" }, { status: 400 });
  }
  const sb = admin();
  const { error } = await sb
    .from("menu_leads")
    .update({ picks, updated_at: new Date().toISOString() } as never)
    .eq("token", token);
  if (error) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
