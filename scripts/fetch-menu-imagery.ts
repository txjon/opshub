// Pull product imagery for the intake-menu styles from S&S, AS Colour, and
// LA Apparel's retail Shopify site; self-host EVERY colorway's photo in the
// public `menu-assets` bucket (resized to 700px jpeg via sharp) and write a
// manifest to api_cache (key "menu_imagery") that /api/menu/lead serves.
// Run: npx tsx scripts/fetch-menu-imagery.ts
//
// Every color in allColors carries BOTH an image and a hex: S&S provides
// hex natively (color1); for AS Colour + LA Apparel the hex is computed by
// sampling the center of the garment photo (sharp) — one download feeds
// the stored image and the swatch color. Featured = the 6 most-printed
// colors per style (history_sales volume). A hand-dropped la/<STYLE>.jpg
// in the bucket OVERRIDES the scraped hero (the slot for HPD's own
// photography). 1801MW is wholesale-only (no retail listing anywhere in
// their 1,653-product catalog) — stays a stub until a photo is dropped.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BUCKET = "menu-assets";
const FEATURED = 6;
const CONCURRENCY = 5;

type MenuStyle = { code: string; vendor: "ss" | "ascolour" | "la"; ssSearch?: string; ssStyleName?: string; laHandle?: string; hist: RegExp };
const STYLES: MenuStyle[] = [
  { code: "NL6210",  vendor: "ss", ssSearch: "Next Level 6210", ssStyleName: "6210", hist: /^(NL|NEXTLEVEL)6210/i },
  { code: "NL3600",  vendor: "ss", ssSearch: "Next Level 3600", ssStyleName: "3600", hist: /^(NL|NEXTLEVEL)3600/i },
  { code: "CC1717",  vendor: "ss", ssSearch: "Comfort Colors 1717", ssStyleName: "1717", hist: /^(CC|COMFORTCOLORS)1717/i },
  { code: "IND4000", vendor: "ss", ssSearch: "IND4000", ssStyleName: "IND4000", hist: /IND4000/i },
  { code: "5001",    vendor: "ascolour", hist: /^(AS|ASCOLOUR)5001/i },
  { code: "5026",    vendor: "ascolour", hist: /^(AS|ASCOLOUR)5026/i },
  { code: "5082",    vendor: "ascolour", hist: /^(AS|ASCOLOUR)5082/i },
  { code: "5101",    vendor: "ascolour", hist: /^(AS|ASCOLOUR)5101/i },
  { code: "1801GD",  vendor: "la", laHandle: "the-1801-garment-dye", hist: /1801GD/i },
  { code: "1801MW",  vendor: "la", hist: /1801MW/i },
  { code: "HF-09",   vendor: "la", laHandle: "hf09-heavy-fleece-hoodie-garment-dye", hist: /HF.?09/i },
];

const SS_CDN = "https://cdn.ssactivewear.com/";
const ssHeaders = {
  Authorization: "Basic " + Buffer.from(`${process.env.SS_USERNAME}:${process.env.SS_PASSWORD}`).toString("base64"),
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};
const uaHeaders = { "User-Agent": "Mozilla/5.0" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

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

// Download once → resize to 700px jpeg, upload, AND sample the garment for
// a swatch hex (center 40% region average — the garment fills the middle
// of every vendor's product shot).
async function processAndStore(
  path: string,
  candidateUrls: string[],
  headers?: Record<string, string>
): Promise<{ url: string; hex: string } | null> {
  for (const srcUrl of candidateUrls) {
    try {
      const res = await fetch(srcUrl, { headers });
      if (!res.ok) continue;
      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.length < 1000) continue;

      const img = sharp(raw).rotate();
      const meta = await img.metadata();
      const w = meta.width || 700, h = meta.height || 700;
      const region = {
        left: Math.floor(w * 0.3), top: Math.floor(h * 0.3),
        width: Math.max(Math.floor(w * 0.4), 1), height: Math.max(Math.floor(h * 0.4), 1),
      };
      const px = await sharp(raw).rotate().extract(region).resize(1, 1, { fit: "fill" }).removeAlpha().raw().toBuffer();
      const hex = "#" + [px[0], px[1], px[2]].map((n) => n.toString(16).padStart(2, "0")).join("");

      const out = await sharp(raw).rotate().resize(700, 700, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 78 }).toBuffer();
      const { error } = await sb.storage.from(BUCKET).upload(path, out, { contentType: "image/jpeg", upsert: true });
      if (error) { console.warn(`  ! upload ${path}: ${error.message}`); return null; }
      return { url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`, hex };
    } catch (e: any) {
      console.warn(`  ! ${srcUrl.slice(0, 80)}: ${e.message}`);
    }
  }
  return null;
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }));
  return results;
}

async function laStub(code: string): Promise<string | null> {
  const { data } = await sb.storage.from(BUCKET).list("la");
  const file = (data || []).find((f) => f.name.toLowerCase().startsWith(code.toLowerCase().replace(/[^a-z0-9]/gi, "")) || f.name.toLowerCase().startsWith(code.toLowerCase()));
  if (!file) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/la/${file.name}`;
}

type ManifestColor = { name: string; hex: string | null; image: string | null };
type ManifestStyle = { hero: string | null; stub: boolean; colors: ManifestColor[]; allColors: ManifestColor[]; moreCount: number };

// Build allColors: ranked color names → candidate source URLs; download all.
async function buildColors(
  code: string,
  ranked: { name: string; urls: string[]; vendorHex: string | null }[],
  headers?: Record<string, string>
): Promise<ManifestColor[]> {
  return pool(ranked, CONCURRENCY, async (c) => {
    const stored = await processAndStore(`${code}/${norm(c.name)}.jpg`, c.urls, headers);
    return { name: c.name, hex: c.vendorHex || stored?.hex || null, image: stored?.url || null };
  });
}

async function main() {
  const { data: buckets } = await sb.storage.listBuckets();
  if (!(buckets || []).some((b) => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true });
    if (error) throw new Error(`createBucket: ${error.message}`);
  }

  const manifest: Record<string, ManifestStyle> = {};

  for (const st of STYLES) {
    console.log(`\n${st.code} (${st.vendor})`);
    const printed = await histColorCounts(st.hist);

    if (st.vendor === "ss") {
      const sres = await fetch(`https://api.ssactivewear.com/v2/styles?search=${encodeURIComponent(st.ssSearch!)}`, { headers: ssHeaders });
      const found = (await sres.json()) as any[];
      const style = Array.isArray(found) ? found.find((s) => norm(s.styleName) === norm(st.ssStyleName!)) || found[0] : null;
      if (!style) { console.warn("  ! style not found on S&S"); manifest[st.code] = { hero: null, stub: true, colors: [], allColors: [], moreCount: 0 }; continue; }
      const pres = await fetch(`https://api.ssactivewear.com/v2/products?styleid=${style.styleID}`, { headers: ssHeaders });
      const products = (await pres.json()) as any[];
      const byColor = new Map<string, any>();
      for (const p of products || []) if (p.colorName && !byColor.has(p.colorName)) byColor.set(p.colorName, p);
      const ranked = [...byColor.values()]
        .sort((a, b) => printedQty(printed, b.colorName) - printedQty(printed, a.colorName))
        .map((p) => ({ name: p.colorName as string, urls: p.colorFrontImage ? [SS_CDN + p.colorFrontImage] : [], vendorHex: (p.color1 as string) || null }));
      const allColors = await buildColors(st.code, ranked, ssHeaders);
      const heroStored = style.styleImage ? await processAndStore(`${st.code}/hero.jpg`, [SS_CDN + style.styleImage], ssHeaders) : null;
      const hero = heroStored?.url || allColors.find((c) => c.image)?.image || null;
      manifest[st.code] = { hero, stub: false, colors: allColors.slice(0, FEATURED), allColors, moreCount: Math.max(allColors.length - FEATURED, 0) };
      console.log(`  hero ${hero ? "ok" : "MISSING"} · ${allColors.filter((c) => c.image).length}/${allColors.length} colors imaged`);

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
      // Stale imageUrls (404) are common — every size's URL per colour goes
      // in as a candidate; processAndStore tries them in order.
      const urlsByColor = new Map<string, string[]>();
      for (const v of all) {
        if (!v.colour || v.discontinued || !v.imageUrl) continue;
        const list = urlsByColor.get(v.colour) || [];
        if (!list.includes(v.imageUrl)) list.push(v.imageUrl);
        urlsByColor.set(v.colour, list);
      }
      const ranked = [...urlsByColor.entries()]
        .sort((a, b) => printedQty(printed, b[0]) - printedQty(printed, a[0]))
        .map(([name, urls]) => ({ name: titleCase(name), urls, vendorHex: null }));
      const allColors = await buildColors(st.code, ranked);
      let hero = allColors.find((c) => c.image)?.image || null;
      if (!hero) {
        // Whole line's CDN images dead (5082's shape): og:image off the
        // style's public product page.
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
            const page = await (await fetch(prod.websiteURL, { headers: uaHeaders })).text();
            const og = page.match(/property="og:image"\s+content="([^"]+)"/i) || page.match(/content="([^"]+)"\s+property="og:image"/i);
            if (og) hero = (await processAndStore(`${st.code}/hero.jpg`, [og[1]]))?.url || null;
          }
        } catch { /* stub stays */ }
        console.log(`  og:image fallback ${hero ? "ok" : "failed"}`);
      }
      manifest[st.code] = { hero, stub: false, colors: allColors.slice(0, FEATURED), allColors, moreCount: Math.max(allColors.length - FEATURED, 0) };
      console.log(`  hero ${hero ? "ok" : "MISSING"} · ${allColors.filter((c) => c.image).length}/${allColors.length} colors imaged`);

    } else {
      const dropped = await laStub(st.code);
      if (!st.laHandle) {
        // No retail listing (1801MW). History color names only, junk rows
        // (size-breakdown text) filtered.
        const colors = [...printed.values()]
          .filter((c) => c.display.length <= 24 && !/[•\d]/.test(c.display))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, FEATURED)
          .map((c) => ({ name: titleCase(c.display), hex: null, image: null }));
        manifest[st.code] = { hero: dropped, stub: dropped === null, colors, allColors: colors, moreCount: 0 };
        console.log(`  ${dropped ? "hand-dropped hero found" : `STUB — no retail listing; drop la/${st.code}.jpg in the ${BUCKET} bucket and rerun`}`);
        continue;
      }
      const res = await fetch(`https://losangelesapparel.net/products/${st.laHandle}.js`, { headers: uaHeaders });
      if (!res.ok) {
        console.warn(`  ! shopify ${res.status} for ${st.laHandle}`);
        manifest[st.code] = { hero: dropped, stub: dropped === null, colors: [], allColors: [], moreCount: 0 };
        continue;
      }
      const prod = (await res.json()) as any;
      const colorIdx = (prod.options || []).findIndex((o: any) => String(o.name).toLowerCase() === "color");
      const imgByColor = new Map<string, string>();
      for (const v of prod.variants || []) {
        const color = colorIdx === 0 ? v.option1 : colorIdx === 1 ? v.option2 : v.option3;
        const src = v.featured_image?.src;
        if (color && src && !imgByColor.has(color)) imgByColor.set(color, src);
      }
      const ranked = [...imgByColor.entries()]
        .sort((a, b) => printedQty(printed, b[0]) - printedQty(printed, a[0]))
        .map(([name, url]) => ({ name: titleCase(name), urls: [url], vendorHex: null }));
      const allColors = await buildColors(st.code, ranked, uaHeaders);
      const hero = dropped || allColors.find((c) => c.image)?.image || null;
      manifest[st.code] = { hero, stub: hero === null, colors: allColors.slice(0, FEATURED), allColors, moreCount: Math.max(allColors.length - FEATURED, 0) };
      console.log(`  hero ${hero ? (dropped ? "hand-dropped (override)" : "ok") : "MISSING"} · ${allColors.filter((c) => c.image).length}/${allColors.length} colors imaged`);
    }
  }

  const { error } = await sb.from("api_cache").upsert({
    key: "menu_imagery",
    data: { version: 2, generatedAt: new Date().toISOString(), styles: manifest },
    updated_at: new Date().toISOString(),
  } as never);
  if (error) throw error;
  console.log("\nmanifest written to api_cache key menu_imagery.");
}

main().catch((e) => { console.error(e); process.exit(1); });
