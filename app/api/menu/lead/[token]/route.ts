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

  // Art links are minted FRESH on every read — the row stores PATHS; a stored
  // signed URL dies after its TTL (the Sep 27 "files not opening" class, part
  // two). One place, so the build page never sees a stale link.
  const signFiles = async (files: any[]) => {
    for (const f of files || []) {
      if (!f?.path) continue;
      const { data: signed } = await sb.storage.from("intake-uploads").createSignedUrl(String(f.path), 60 * 60 * 6);
      if (signed?.signedUrl) f.url = signed.signedUrl;
    }
  };
  await signFiles((lead.picks as any)?.files || []);
  for (const pt of ((lead.quote as any)?.punch || [])) if (pt?.kind === "files") await signFiles((pt.payload as any)?.files || []);

  const { data: rates } = await sb
    .from("menu_rates")
    .select("product_group,lane,style_code,style_name,band_min,price_lo,price_hi,sort")
    .eq("active", true)
    .order("sort")
    .order("band_min");

  // Self-hosted product imagery (scripts/fetch-menu-imagery.ts).
  const { data: imgCache } = await sb.from("api_cache").select("data").eq("key", "menu_imagery").maybeSingle();
  const imagery = ((imgCache?.data as any)?.styles || {}) as Record<string, { hero: string | null; colors: { name: string; hex: string | null; image: string | null }[]; allColors?: { name: string; hex: string | null; image?: string | null }[]; moreCount: number }>;

  // Card photo = the BLACK colorway (Jon, Oct 14 2026: the page is all
  // black, the product shots should match). Exact "Black" first, then a
  // single-color black (Faded / Vintage / Carbon Black); two-tone names
  // ("Black/ White") don't count. A hand-dropped hero (override/ or la/
  // in the bucket = HPD's own photo) always wins; no black = vendor hero.
  const cardHero = (img: (typeof imagery)[string] | undefined): string | null => {
    if (!img) return null;
    if (img.hero && /\/menu-assets\/(override|la)\//.test(img.hero)) return img.hero;
    const cs = (img.allColors || []).filter((c) => c.image);
    const black = cs.find((c) => /^black$/i.test(c.name.trim())) || cs.find((c) => /black/i.test(c.name) && !c.name.includes("/"));
    return black?.image || img.hero;
  };

  const styles: Record<string, { code: string; name: string; lane: string; group: string; sort: number; bands: Record<number, { lo: number | null; hi: number | null }>; hero: string | null; colors: { name: string; hex: string | null; image: string | null }[]; allColors: { name: string; hex: string | null }[]; moreColors: number }> = {};
  for (const r of rates || []) {
    if (!styles[r.style_code]) {
      const img = imagery[r.style_code];
      styles[r.style_code] = {
        code: r.style_code, name: r.style_name, lane: r.lane, group: r.product_group, sort: r.sort, bands: {},
        hero: cardHero(img),
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
