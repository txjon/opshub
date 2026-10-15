// THE APPROVED MOCKS ZIP — every mockup the client thumbed up on a line sheet,
// full res, one ZIP (creative director ask, Oct 15 2026). Studio-only.
// "Approved" = client_thumb "up" on a live (not dropped) item. Only art the
// client has seen counts: an image uploaded after their thumb but not yet
// published isn't what they approved, so it stays out.
// Streams like the designer package (lib/design-work-orders-packet): Drive →
// archive → browser, STORE not DEFLATE (art is already compressed).
// @ts-ignore — plain-JS lib, no declarations
import archiver from "archiver";
import { Readable } from "stream";
import { driveFileMeta, driveFileStream } from "@/lib/drive-proxy";
import { publishedImageIds, type SheetImage } from "@/lib/line-sheets";
import { safeName } from "@/lib/design-work-orders-packet";

type Db = any;

export async function approvedMocks(db: Db, sheetId: string) {
  const [{ data: sheet }, { data: secs }, { data: rows }, published] = await Promise.all([
    db.from("line_sheets").select("id, title, season, clients(name)").eq("id", sheetId).maybeSingle(),
    db.from("line_sheet_sections").select("id, name, sort").eq("sheet_id", sheetId).order("sort"),
    db.from("line_sheet_items").select("id, section_id, name, item_no, sort, images, dropped, client_thumb").eq("sheet_id", sheetId).order("sort"),
    publishedImageIds(db, sheetId),
  ]);
  if (!sheet) return null;
  const secName = new Map(((secs || []) as any[]).map(s => [s.id, s.name]));
  const secSort = new Map(((secs || []) as any[]).map(s => [s.id, s.sort]));
  const items = ((rows || []) as any[])
    .filter(it => !it.dropped && it.client_thumb === "up")
    .map(it => ({ ...it, images: ((it.images || []) as SheetImage[]).filter(img => published.has(img.driveId)) }))
    .filter(it => it.images.length > 0)
    .sort((a, b) => (secSort.get(a.section_id) ?? -1) - (secSort.get(b.section_id) ?? -1) || a.sort - b.sort);
  const files: { driveId: string; folder: string; base: string }[] = [];
  for (const it of items) {
    const label = safeName([it.item_no != null ? String(it.item_no).padStart(2, "0") : null, it.name].filter(Boolean).join(" "), "item");
    const folder = it.section_id && secName.get(it.section_id) ? safeName(secName.get(it.section_id)) + "/" : "";
    it.images.forEach((img: SheetImage, i: number) => files.push({ driveId: img.driveId, folder, base: it.images.length > 1 ? `${label} (${i + 1})` : label }));
  }
  const title = [(sheet as any).clients?.name, (sheet as any).title, (sheet as any).season].filter(Boolean).join(" - ");
  return { title, items: items.length, files };
}

export async function approvedMocksZipStream(db: Db, sheetId: string): Promise<{ stream: ReadableStream<Uint8Array>; name: string; count: number } | null> {
  const a = await approvedMocks(db, sheetId);
  if (!a) return null;
  const archive = archiver("zip", { store: true });
  const used = new Set<string>();
  const uniq = (n: string) => { let k = n, i = 2; while (used.has(k.toLowerCase())) { const dot = n.lastIndexOf("."); k = dot > 0 ? `${n.slice(0, dot)} (${i})${n.slice(dot)}` : `${n} (${i})`; i++; } used.add(k.toLowerCase()); return k; };
  (async () => {
    const missing: string[] = [];
    try {
      for (const f of a.files) {
        const meta = await driveFileMeta(f.driveId);
        const ext = /\.[a-z0-9]{2,5}$/i.exec(meta?.name || "")?.[0] || "";
        const name = uniq(`${f.folder}${f.base}${ext}`);
        const body = meta ? await driveFileStream(f.driveId) : null;
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
  return { stream: Readable.toWeb(archive as any) as ReadableStream<Uint8Array>, name: `${safeName(a.title, "line sheet")} - approved.zip`, count: a.files.length };
}
