#!/usr/bin/env node
// Import /our-clients tile art from a folder of raw files.
//
//   node scripts/import-client-art.mjs ~/Desktop/client-art
//
// Name each file by the client's slug (see app/(marketing)/our-clients/clients.ts):
//   <slug>.jpg|.jpeg|.png|.webp|.heic   photo (any size; cropped to a centered square)
//   <slug>-logo.png                     white logo on transparent
// Writes public/marketing/clients/<slug>.jpg (1080x1080) and <slug>.png
// (trimmed, max 1000px), then prints which clients still have no art.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/import-client-art.mjs <folder>"); process.exit(1); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.join(root, "public/marketing/clients");
const listSrc = fs.readFileSync(path.join(root, "app/(marketing)/our-clients/clients.ts"), "utf8");
const slugs = new Set([...listSrc.matchAll(/slug: "([^"]+)"/g)].map(m => m[1]));

fs.mkdirSync(outDir, { recursive: true });
const unknown = [];
for (const file of fs.readdirSync(src)) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, path.extname(file)).toLowerCase();
  const isLogo = base.endsWith("-logo");
  const slug = isLogo ? base.slice(0, -5) : base;
  if (!slugs.has(slug)) { if (!file.startsWith(".")) unknown.push(file); continue; }
  const input = path.join(src, file);
  if (isLogo) {
    if (ext !== ".png") { unknown.push(`${file} (logo must be .png)`); continue; }
    await sharp(input).trim().resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 }).toFile(path.join(outDir, `${slug}.png`));
    console.log(`logo   ${slug}`);
  } else {
    await sharp(input).rotate().resize(1080, 1080, { fit: "cover", position: "attention" })
      .flatten({ background: "#0a0a0c" }).jpeg({ quality: 80, mozjpeg: true })
      .toFile(path.join(outDir, `${slug}.jpg`));
    console.log(`photo  ${slug}`);
  }
}

if (unknown.length) console.log(`\nSKIPPED (name doesn't match a client slug):\n  ${unknown.join("\n  ")}`);
const have = new Set(fs.readdirSync(outDir));
const missing = [...slugs].filter(s => !have.has(`${s}.jpg`) || !have.has(`${s}.png`));
console.log(`\n${slugs.size - missing.length}/${slugs.size} clients have photo + logo.`);
