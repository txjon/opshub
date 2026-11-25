// LINE SHEET DOWNLOADS — the sheet is where the mockup files live (Jon, Nov
// 2026: create in Photoshop, drop on the sheet, delete from the desktop). Any
// set of a sheet's mockups comes back out, full res, named by the item:
//   approved → every thumbs-up item (creative director ask, Oct 15 2026). Only
//              art the client has SEEN counts: an image uploaded after their
//              thumb but not yet published isn't what they approved.
//   all      → every live (not dropped) item, published or not
//   items    → the chosen item ids (selection, or one card's ↓)
// One file comes back as itself; more come back as a ZIP with a folder per
// shelf. Streams Drive → archive → browser, STORE not DEFLATE (art is
// already compressed), like the designer package.
// @ts-ignore — plain-JS lib, no declarations
import archiver from "archiver";
import { Readable } from "stream";
import { driveFileMeta, driveFileStream } from "@/lib/drive-proxy";
import { publishedImageIds, type SheetImage } from "@/lib/line-sheets";
import { safeName } from "@/lib/design-work-orders-packet";

type Db = any;
export type MockPick = { mode: "approved" } | { mode: "all" } | { mode: "items"; ids: string[] };

const stripExt = (n?: string | null) => String(n || "").replace(/\.[a-z0-9]{2,5}$/i, "").trim();

// The name each of an item's files goes by. One image: the item's line sheet
// name (a rename carries), else the file's own name, else its number. Several
// (front/back): each keeps its own file name, so Front/Back survive, else
// item name + (k). Extension not included.
export function imageFileBases(it: { name?: string | null; item_no?: number | null; images?: { name?: string | null }[] }): string[] {
  const no = it.item_no != null ? String(it.item_no).padStart(2, "0") : null;
  const named = (it.name || "").trim();
  const imgs = it.images || [];
  const fallback = named || (no ? `Item ${no}` : "Item");
  if (imgs.length <= 1) return [safeName(named || stripExt(imgs[0]?.name) || fallback, "item")];
  return imgs.map((img, k) => safeName(stripExt(img?.name) || `${fallback} (${k + 1})`, "item"));
}

export async function sheetMocks(db: Db, sheetId: string, pick: MockPick) {
  const [{ data: sheet }, { data: secs }, { data: rows }] = await Promise.all([
    db.from("line_sheets").select("id, title, season, clients(name)").eq("id", sheetId).maybeSingle(),
    db.from("line_sheet_sections").select("id, name, sort").eq("sheet_id", sheetId).order("sort"),
    db.from("line_sheet_items").select("id, section_id, name, item_no, sort, images, dropped, client_thumb").eq("sheet_id", sheetId).order("sort"),
  ]);
  if (!sheet) return null;
  const published = pick.mode === "approved" ? await publishedImageIds(db, sheetId) : null;
  const wanted = pick.mode === "items" ? new Set(pick.ids) : null;
  const secName = new Map(((secs || []) as any[]).map(s => [s.id, s.name]));
  const secSort = new Map(((secs || []) as any[]).map(s => [s.id, s.sort]));
  const items = ((rows || []) as any[])
    .filter(it => !it.dropped)
    .filter(it => pick.mode === "approved" ? it.client_thumb === "up" : wanted ? wanted.has(it.id) : true)
    .map(it => ({ ...it, images: ((it.images || []) as SheetImage[]).filter(img => img?.driveId && (!published || published.has(img.driveId))) }))
    .filter(it => it.images.length > 0)
    .sort((a, b) => (secSort.get(a.section_id) ?? 1e9) - (secSort.get(b.section_id) ?? 1e9) || a.sort - b.sort);
  const files: { driveId: string; folder: string; base: string }[] = [];
  for (const it of items) {
    const bases = imageFileBases(it);
    const folder = it.section_id && secName.get(it.section_id) ? safeName(secName.get(it.section_id)).replace(/^\.+$/, "_") + "/" : "";
    it.images.forEach((img: SheetImage, i: number) => files.push({ driveId: img.driveId, folder, base: bases[i] }));
  }
  const title = [(sheet as any).clients?.name, (sheet as any).title, (sheet as any).season].filter(Boolean).join(" - ");
  return { title, items: items.length, files };
}

const extOf = (name?: string | null) => /\.[a-z0-9]{2,5}$/i.exec(name || "")?.[0] || "";

export async function sheetMocksDownload(db: Db, sheetId: string, pick: MockPick, label: string):
  Promise<{ stream: ReadableStream<Uint8Array>; name: string; type: string; count: number; size?: number | null } | null> {
  const a = await sheetMocks(db, sheetId, pick);
  if (!a) return null;
  if (a.files.length === 1) {
    const f = a.files[0];
    const meta = await driveFileMeta(f.driveId).catch(() => null);
    const body = meta ? await driveFileStream(f.driveId).catch(() => null) : null;
    if (!body) throw new Error("Couldn't pull that file from Drive");
    // size → Content-Length, so a Drive hiccup mid-stream reads as a failed
    // download instead of a "complete" broken PNG
    return { stream: body, name: `${f.base}${extOf(meta?.name)}`, type: meta?.mimeType || "application/octet-stream", count: 1, size: meta?.size ?? null };
  }
  const archive = archiver("zip", { store: true });
  const used = new Set<string>();
  const uniq = (n: string) => { let k = n, i = 2; while (used.has(k.toLowerCase())) { const dot = n.lastIndexOf("."); k = dot > 0 ? `${n.slice(0, dot)} (${i})${n.slice(dot)}` : `${n} (${i})`; i++; } used.add(k.toLowerCase()); return k; };
  (async () => {
    const missing: string[] = [];
    try {
      for (const f of a.files) {
        // one Drive hiccup = one MISSING.txt line, not a dead ZIP
        const meta = await driveFileMeta(f.driveId).catch(() => null);
        const name = uniq(`${f.folder}${f.base}${extOf(meta?.name)}`);
        const body = meta ? await driveFileStream(f.driveId).catch(() => null) : null;
        if (!body) { missing.push(name); continue; }
        await new Promise<void>((resolve, reject) => {
          const src = Readable.fromWeb(body as any);
          src.on("end", resolve); src.on("error", reject);
          archive.append(src, { name });
        });
      }
      if (missing.length) archive.append(Buffer.from(`These files couldn't be pulled from Drive. Download them from the line sheet:\n\n${missing.join("\n")}\n`, "utf8"), { name: "MISSING.txt" });
      await archive.finalize();
    } catch (e) { archive.abort(); console.error("[line-sheet-zip] stream failed", (e as any)?.message || e); }
  })();
  return { stream: Readable.toWeb(archive as any) as ReadableStream<Uint8Array>, name: `${safeName(a.title, "line sheet")} - ${label}.zip`, type: "application/zip", count: a.files.length };
}
