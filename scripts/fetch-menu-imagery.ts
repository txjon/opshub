// Pull product imagery for the intake-menu styles from S&S + AS Colour,
// self-host it in the public `menu-assets` storage bucket, and write a
// manifest to api_cache (key "menu_imagery") that /api/menu/lead serves.
// Run: npx tsx scripts/fetch-menu-imagery.ts
//
// Self-hosted on purpose: vendor CDN URLs churn and their uptime is not
// ours; one download gives the public menu stable, consistently-sized
// assets. Featured colors are seeded from what we actually printed
// (history_sales.color per style), topped up from the vendor list to 6.
//
// LA Apparel has no API imagery (PromoStandards media service errors;
// product data carries no URLs) — LA styles are STUBS: drop files into
// the bucket at la/<STYLE>.jpg (e.g. la/1801GD.jpg), rerun this script,
// and it promotes them to heroes automatically.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BUCKET = "menu-assets";
const FEATURED = 6;

type MenuStyle = { code: string; vendor: "ss" | "ascolour" | "la"; ssSearch?: string; ssStyleName?: string; hist: RegExp };
const STYLES: MenuStyle[] = [
  { code: "NL6210",  vendor: "ss", ssSearch: "Next Level 6210", ssStyleName: "6210", hist: /^(NL|NEXTLEVEL)6210/i },
  { code: "NL3600",  vendor: "ss", ssSearch: "Next Level 3600", ssStyleName: "3600", hist: /^(NL|NEXTLEVEL)3600/i },
  { code: "CC1717",  vendor: "ss", ssSearch: "Comfort Colors 1717", ssStyleName: "1717", hist: /^(CC|COMFORTCOLORS)1717/i },
  { code: "IND4000", vendor: "ss", ssSearch: "IND4000", ssStyleName: "IND4000", hist: /IND4000/i },
  { code: "5001",    vendor: "ascolour", hist: /^(AS|ASCOLOUR)5001/i },
  { code: "5026",    vendor: "ascolour", hist: /^(AS|ASCOLOUR)5026/i },
  { code: "5082",    vendor: "ascolour", hist: /^(AS|ASCOLOUR)5082/i },
  { code: "5101",    vendor: "ascolour", hist: /^(AS|ASCOLOUR)5101/i },
  { code: "1801GD",  vendor: "la", hist: /1801GD/i },
  { code: "1801MW",  vendor: "la", hist: /1801MW/i },
  { code: "HF-09",   vendor: "la", hist: /HF.?09/i },
];

const SS_CDN = "https://cdn.ssactivewear.com/";
const ssHeaders = {
  Authorization: "Basic " + Buffer.from(`${process.env.SS_USERNAME}:${process.env.SS_PASSWORD}`).toString("base64"),
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type ColorCount = { qty: number; display: string };
async function histColorCounts(hist: RegExp): Promise<Map<string, ColorCount>> {
  const counts = new Map<string, ColorCount>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("history_sales").select("blank_style,color,qty").range(from, from + 999);
    if (error) throw error;
    for (const r of (data as any[]) || []) {
      const bs = r.blank_style?.trim();
      const c = r.color?.trim();
      if (!bs || !c || !hist.test(bs)) continue;
      const k = norm(c);
      const cur = counts.get(k) || { qty: 0, display: c };
      counts.set(k, { qty: cur.qty + (r.qty || 0), display: cur.display });
    }
    if (!data || data.length < 1000) break;
  }
  return counts;
}
const printedQty = (m: Map<string, ColorCount>, name: string) => m.get(norm(name))?.qty || 0;

async function storeImage(path: string, srcUrl: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(srcUrl, { headers });
    if (!res.ok) { console.warn(`  ! fetch ${res.status} ${srcUrl}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) { console.warn(`  ! tiny payload ${srcUrl}`); return null; }
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, {
      contentType: res.headers.get("content-type") || "image/jpeg",
      upsert: true,
    });
    if (error) { console.warn(`  ! upload ${path}: ${error.message}`); return null; }
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  } catch (e: any) {
    console.warn(`  ! ${srcUrl}: ${e.message}`);
    return null;
  }
}

async function laStub(code: string): Promise<string | null> {
  // Promote a hand-dropped la/<STYLE>.jpg (or .png) to hero if present.
  const { data } = await sb.storage.from(BUCKET).list("la");
  const file = (data || []).find((f) => f.name.toLowerCase().startsWith(code.toLowerCase().replace(/[^a-z0-9]/gi, "")) || f.name.toLowerCase().startsWith(code.toLowerCase()));
  if (!file) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/la/${file.name}`;
}

async function main() {
  // Bucket (public) — idempotent.
  const { data: buckets } = await sb.storage.listBuckets();
  if (!(buckets || []).some((b) => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true });
    if (error) throw new Error(`createBucket: ${error.message}`);
    console.log(`created public bucket ${BUCKET}`);
  }

  const manifest: Record<string, { hero: string | null; stub: boolean; colors: { name: string; hex: string | null; image: string | null }[]; moreCount: number }> = {};

  for (const st of STYLES) {
    console.log(`\n${st.code} (${st.vendor})`);
    const printed = await histColorCounts(st.hist);

    if (st.vendor === "ss") {
      const sres = await fetch(`https://api.ssactivewear.com/v2/styles?search=${encodeURIComponent(st.ssSearch!)}`, { headers: ssHeaders });
      const found = (await sres.json()) as any[];
      const style = Array.isArray(found) ? found.find((s) => norm(s.styleName) === norm(st.ssStyleName!)) || found[0] : null;
      if (!style) { console.warn("  ! style not found on S&S"); manifest[st.code] = { hero: null, stub: true, colors: [], moreCount: 0 }; continue; }
      const pres = await fetch(`https://api.ssactivewear.com/v2/products?styleid=${style.styleID}`, { headers: ssHeaders });
      const products = (await pres.json()) as any[];
      const byColor = new Map<string, any>();
      for (const p of products || []) if (p.colorName && !byColor.has(p.colorName)) byColor.set(p.colorName, p);
      const all = [...byColor.values()];
      const ranked = all.sort((a, b) => printedQty(printed, b.colorName) - printedQty(printed, a.colorName));
      const featured = ranked.slice(0, FEATURED);
      const hero = style.styleImage ? await storeImage(`${st.code}/hero.jpg`, SS_CDN + style.styleImage, ssHeaders) : null;
      const colors: { name: string; hex: string | null; image: string | null }[] = [];
      for (const p of featured) {
        const img = p.colorFrontImage ? await storeImage(`${st.code}/${norm(p.colorName)}.jpg`, SS_CDN + p.colorFrontImage, ssHeaders) : null;
        colors.push({ name: p.colorName, hex: p.color1 || null, image: img });
      }
      manifest[st.code] = { hero, stub: false, colors, moreCount: Math.max(all.length - featured.length, 0) };
      console.log(`  hero ${hero ? "ok" : "MISSING"} · ${colors.length} featured / ${all.length} colors`);

    } else if (st.vendor === "ascolour") {
      const h = { Accept: "application/json", "Content-Type": "application/json", "Subscription-Key": process.env.ASCOLOUR_SUBSCRIPTION_KEY || "" };
      const all: any[] = [];
      for (let page = 1; ; page++) {
        const res = await fetch(`https://api.ascolour.com/v1/catalog/products/${st.code}/variants?pageSize=250&pageNumber=${page}`, { headers: h });
        if (!res.ok) break;
        const data = await res.json();
        const items = data.data || data;
        if (!Array.isArray(items) || !items.length) break;
        all.push(...items);
        if (items.length < 250) break;
      }
      // Some variants carry stale imageUrls (404) — collect every size's URL
      // per colour and try them in order until one downloads.
      const urlsByColor = new Map<string, string[]>();
      for (const v of all) {
        if (!v.colour || v.discontinued || !v.imageUrl) continue;
        const list = urlsByColor.get(v.colour) || [];
        if (!list.includes(v.imageUrl)) list.push(v.imageUrl);
        urlsByColor.set(v.colour, list);
      }
      const colorsAll = [...urlsByColor.keys()];
      const ranked = colorsAll.sort((a, b) => printedQty(printed, b) - printedQty(printed, a));
      const featured = ranked.slice(0, FEATURED);
      const colors: { name: string; hex: string | null; image: string | null }[] = [];
      for (const colour of featured) {
        let img: string | null = null;
        for (const url of urlsByColor.get(colour)!) {
          img = await storeImage(`${st.code}/${norm(colour)}.jpg`, url);
          if (img) break;
        }
        colors.push({ name: titleCase(colour), hex: null, image: img });
      }
      // Hero = the most-printed colour's shot (black is almost always #1 anyway).
      let hero = colors.find((c) => c.image)?.image || null;
      if (!hero) {
        // Every variant URL dead (5082's shape — their CDN retired the line's
        // images): fall back to og:image on the style's public product page.
        try {
          let prod: any = null;
          for (let page = 1; page <= 8 && !prod; page++) {
            const cres = await fetch(`https://api.ascolour.com/v1/catalog/products?pageSize=250&pageNumber=${page}`, { headers: h });
            const cdata = await cres.json();
            const items = (cdata.data || cdata) as any[];
            if (!Array.isArray(items) || !items.length) break;
            prod = items.find((p) => String(p.styleCode) === st.code) || null;
            if (items.length < 250) break;
          }
          if (prod?.websiteURL) {
            const page = await (await fetch(prod.websiteURL)).text();
            const og = page.match(/property="og:image"\s+content="([^"]+)"/i) || page.match(/content="([^"]+)"\s+property="og:image"/i);
            if (og) hero = await storeImage(`${st.code}/hero.jpg`, og[1]);
          }
        } catch { /* stub stays */ }
        console.log(`  og:image fallback ${hero ? "ok" : "failed"}`);
      }
      manifest[st.code] = { hero, stub: false, colors, moreCount: Math.max(colorsAll.length - featured.length, 0) };
      console.log(`  hero ${hero ? "ok" : "MISSING"} · ${colors.length} featured / ${colorsAll.length} colors`);

    } else {
      // LA stub — promote hand-dropped assets when they exist.
      const hero = await laStub(st.code);
      const colors = [...printed.values()]
        .sort((a, b) => b.qty - a.qty)
        .slice(0, FEATURED)
        .map((c) => ({ name: titleCase(c.display), hex: null, image: null }));
      manifest[st.code] = { hero, stub: hero === null, colors, moreCount: 0 };
      console.log(`  ${hero ? "hand-dropped hero found" : `STUB — drop la/${st.code}.jpg in the ${BUCKET} bucket and rerun`} · ${colors.length} printed colors listed`);
    }
  }

  const { error } = await sb.from("api_cache").upsert({
    key: "menu_imagery",
    data: { version: 1, generatedAt: new Date().toISOString(), styles: manifest },
    updated_at: new Date().toISOString(),
  } as never);
  if (error) throw error;
  console.log("\nmanifest written to api_cache key menu_imagery.");
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

main().catch((e) => { console.error(e); process.exit(1); });
