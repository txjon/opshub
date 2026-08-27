// THE DESIGN PACKET — the offline form of a work order. One spec, one more
// render: brief.pdf (canvases with numbered markers + the pin list + notes +
// conversation + file manifest) and a ZIP with every attachment at full res.
// Server-only. Images ride inside the PDF as data URIs so Browserless never
// needs to reach our proxy (which it can't on localhost anyway).
// @ts-ignore — plain-JS lib, no declarations
import archiver from "archiver";
import { Readable } from "stream";
import { generatePDF } from "@/lib/pdf/browser";
import { proxyDriveFile, driveFileMeta, driveFileStream } from "@/lib/drive-proxy";
import { woTypeLabel, type BriefSpec, type DesignWorkOrder } from "@/lib/design-work-orders";
import type { ResolvedTarget } from "@/lib/design-work-orders-server";


export const safeName = (s: string | null | undefined, fallback = "file") => (String(s || fallback).replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || fallback);
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function driveBytes(driveId: string, opts: { thumb?: boolean; size?: number } = {}): Promise<{ buf: Buffer; type: string; name: string } | null> {
  try {
    const res = await proxyDriveFile(driveId, { thumb: !!opts.thumb, size: opts.size || 0, download: !opts.thumb });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get("content-disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="([^"]+)"/.exec(cd);
    return { buf, type: res.headers.get("content-type") || "application/octet-stream", name: m ? decodeURIComponent(m[1]) : driveId };
  } catch { return null; }
}
const dataUri = (b: { buf: Buffer; type: string }) => `data:${b.type};base64,${b.buf.toString("base64")}`;

// ── the packet HTML (print-first) ───────────────────────────────────────────
export async function packetHtml(wo: DesignWorkOrder, t: ResolvedTarget, messages: any[]): Promise<string> {
  const spec: BriefSpec = wo.brief || { canvases: [], extras: [] };
  const img: Record<string, string> = {};
  const want = new Set<string>();
  for (const c of spec.canvases) { want.add(c.previewId || c.driveId); for (const p of c.pins) if (p.driveId) want.add(p.driveId); }
  for (const e of spec.extras) want.add(e.previewId || e.driveId);
  await Promise.all(Array.from(want).map(async id => { const b = await driveBytes(id, { thumb: true, size: 1400 }); if (b) img[id] = dataUri(b); }));
  const what = `${t.clientName ? `${t.clientName} · ` : ""}${t.title}${t.kind === "item" && t.jobNumber ? ` (${t.jobNumber})` : ""}`;
  const due = wo.due_by ? new Date(wo.due_by + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null;
  const words = messages.filter(m => m.body && String(m.body).trim() && !/^[✓✕↩]/.test(String(m.body).trim()));
  const notesBlock = wo.instructions ? `<div class="blk"><div class="eyebrow">Notes</div><div class="notes">${esc(wo.instructions)}</div></div>` : "";
  const convoBlock = (spec.conversation || []).length ? `<div class="blk"><div class="eyebrow">What the client said</div>${(spec.conversation || []).map(l => `<div class="line"><span class="who ${l.role}">${l.role === "client" ? "Client" : "HPD"}</span><span>${esc(l.text)}</span></div>`).join("")}</div>` : "";
  const filesBlock = spec.extras.length ? `<div class="blk"><div class="eyebrow">${spec.canvases.length ? "More files" : "The files"} · full resolution in the ZIP</div><div class="grid">${spec.extras.map(e => `<div class="cell">${img[e.previewId || e.driveId] ? `<img src="${img[e.previewId || e.driveId]}" />` : ""}<div class="cap">${e.label ? `<b>${esc(e.label)}</b><br/>` : ""}<span class="mono">${esc(e.name || "")}</span></div></div>`).join("")}</div></div>` : "";
  const header = `<div class="head"><div><div class="eyebrow">Work order · ${esc(t.companyName)}</div><h1>${esc(what)}</h1><div class="meta">${esc(woTypeLabel(wo.type))}${due ? ` · due ${esc(due)}` : ""}${wo.designer_name ? ` · for ${esc(wo.designer_name)}` : ""} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div></div>${wo.headline ? `<div class="headline">${esc(wo.headline)}</div>` : ""}</div>`;
  // ONE PAGE PER REFERENCE: image left, pins right; the first page carries the
  // header, the last page carries notes / conversation / files under its pins.
  const pages = spec.canvases.length ? spec.canvases.map((c, i) => {
    const last = i === spec.canvases.length - 1;
    return `<div class="page">
      ${i === 0 ? header : `<div class="head slim"><div class="eyebrow">Work order · ${esc(what)}</div></div>`}
      <div class="cols">
        <div class="left">
          <div class="eyebrow">${spec.canvases.length > 1 ? `Reference ${i + 1} of ${spec.canvases.length}` : "The reference"}${c.name ? ` · <span class="mono">${esc(c.name)}</span>` : ""}</div>
          ${c.note ? `<div class="note">${esc(c.note)}</div>` : ""}
          <div class="box">${img[c.previewId || c.driveId] ? `<img src="${img[c.previewId || c.driveId]}" />` : `<div class="missing">image unavailable</div>`}
            ${c.pins.map((p, n) => `<span class="pin" style="left:${p.x}%;top:${p.y}%">${n + 1}</span>`).join("")}
          </div>
        </div>
        <div class="right">
          ${c.pins.length ? `<div class="eyebrow">${c.pins.length} pin${c.pins.length === 1 ? "" : "s"}</div><ol class="pins">${c.pins.map((p, n) => `<li><span class="n">${n + 1}</span><div><div class="txt">${esc(p.text || (p.driveId ? "Use this image here." : ""))}</div>${p.driveId && img[p.driveId] ? `<div class="swap"><img src="${img[p.driveId]}" /><span class="mono">${esc((p.name || "").slice(0, 34))}</span></div>` : ""}</div></li>`).join("")}</ol>` : `<div class="eyebrow">No pins — see the notes</div>`}
          ${last ? notesBlock + convoBlock + filesBlock : ""}
        </div>
      </div>
      <div class="foot">Snapshot — the work order page is the live brief. Deliver there.${spec.canvases.length > 1 ? ` · page ${i + 1} of ${spec.canvases.length}` : ""}</div>
    </div>`;
  }).join("") : `<div class="page">${header}<div class="single">${notesBlock}${convoBlock}${filesBlock}</div><div class="foot">Snapshot — the work order page is the live brief. Deliver there.</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(what)} — work order</title>
<style>
  @page{size:Letter;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#111;font-size:11px;line-height:1.4}
  .page{width:8.5in;height:11in;padding:0.45in 0.5in 0.4in;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;position:relative}
  .page:last-child{page-break-after:auto}
  .mono{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:#777}
  .eyebrow{font-size:8.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#888;margin:0 0 6px}
  h1{font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;margin:1px 0 3px;line-height:1.05}
  .meta{font-size:10.5px;color:#555}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:10px;flex:0 0 auto}
  .head.slim{margin-bottom:6px}
  .headline{flex:0 0 auto;max-width:3.4in;padding:9px 12px;background:#111;color:#fff;font-weight:900;font-size:13px;text-transform:uppercase;letter-spacing:.02em;border-radius:6px;text-align:center}
  .cols{display:flex;gap:0.25in;flex:1 1 auto;min-height:0}
  .left{flex:0 0 4.7in;display:flex;flex-direction:column;min-height:0}
  .right{flex:1 1 auto;min-width:0;overflow:hidden}
  .note{font-size:12.5px;font-weight:800;text-transform:uppercase;margin:0 0 6px}
  .box{position:relative;display:inline-block;max-width:100%;border:1px solid #ddd;border-radius:6px;overflow:hidden;line-height:0;align-self:flex-start}
  .box img{max-width:4.68in;max-height:8.7in;display:block}
  .pin{position:absolute;display:block;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;background:#111;color:#fff;border:2px solid #fff;font:900 10px/16px ui-monospace,Menlo,monospace;text-align:center}
  ol.pins{list-style:none;padding:0;margin:0}
  ol.pins li{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid #e6e6e6}
  ol.pins li:first-child{border-top:none;padding-top:0}
  .n{flex:0 0 18px;width:18px;height:18px;border-radius:50%;background:#111;color:#fff;font:900 10px/18px ui-monospace,Menlo,monospace;text-align:center;margin-top:1px}
  .txt{font-size:11px;font-weight:700;white-space:pre-wrap;line-height:1.35}
  .swap{margin-top:5px;display:flex;gap:7px;align-items:center}.swap img{width:64px;height:64px;object-fit:cover;border-radius:5px;border:1px solid #ddd}
  .blk{margin-top:12px;padding-top:10px;border-top:1px solid #e6e6e6}
  .notes{white-space:pre-wrap;font-size:11px}
  .line{display:flex;gap:8px;padding:4px 0;border-top:1px solid #f0f0f0;font-size:10.5px}.line:first-of-type{border-top:none}.who{flex:0 0 42px;font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding-top:2px;color:#888}.who.client{color:#2a7f9c}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.cell img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:5px;border:1px solid #ddd}.cap{font-size:9px;margin-top:2px;line-height:1.25}
  .single{flex:1 1 auto;overflow:hidden;columns:2;column-gap:0.3in}.single .blk{break-inside:avoid;margin-top:0;margin-bottom:12px;border-top:none;padding-top:0}
  .single .grid{grid-template-columns:repeat(2,1fr)}
  .missing{padding:40px;color:#999;text-align:center;font-size:11px}
  .foot{flex:0 0 auto;margin-top:8px;font-size:9px;color:#999;border-top:1px solid #eee;padding-top:5px}
</style></head><body>${pages}</body></html>`;
}

export async function packetPdf(wo: DesignWorkOrder, t: ResolvedTarget, messages: any[]): Promise<Buffer> {
  return generatePDF(await packetHtml(wo, t, messages));
}

// ── the ZIP: brief.pdf + every attachment, originals — STREAMED ─────────────
// Nothing is held in memory but the PDF: each Drive file streams straight into
// the archive and the archive streams straight to the browser (Vercel's 4.5MB
// cap only bites buffered responses). STORE, not DEFLATE — art is already
// compressed and the designer wants it now.
export async function packageZipStream(wo: DesignWorkOrder, t: ResolvedTarget, messages: any[]): Promise<{ stream: ReadableStream<Uint8Array>; name: string }> {
  const spec: BriefSpec = wo.brief || { canvases: [], extras: [] };
  const html = await packetHtml(wo, t, messages);
  let pdf: Buffer | null = null;
  try { pdf = await generatePDF(html); } catch { pdf = null; }
  const want: { id: string; folder: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined, folder: string, label: string) => { if (id && !seen.has(id)) { seen.add(id); want.push({ id, folder, label }); } };
  spec.canvases.forEach((c, i) => { add(c.driveId, "references", `reference ${i + 1}`); c.pins.forEach((p, n) => add(p.driveId, "pins", `pin ${n + 1} of reference ${i + 1}`)); });
  spec.extras.forEach(e => add(e.driveId, "files", e.label || "file"));
  for (const m of messages) if (m.sender_role === "hpd" && m._drive) add(m._drive, "thread", "reference from HPD");
  const metas = await Promise.all(want.map(async w => ({ ...w, meta: await driveFileMeta(w.id) })));

  const archive = archiver("zip", { store: true });
  const manifest: string[] = [`${t.title} — work order (${woTypeLabel(wo.type)})`, `Packaged ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, ""];
  if (pdf) { archive.append(pdf, { name: "brief.pdf" }); manifest.push("brief.pdf — the design packet"); }
  else { archive.append(Buffer.from(html, "utf8"), { name: "brief.html" }); manifest.push("brief.html — the design packet (open in a browser)"); }
  const used = new Set<string>();
  const uniq = (n: string) => { let k = n, i = 2; while (used.has(k)) { const dot = n.lastIndexOf("."); k = dot > 0 ? `${n.slice(0, dot)} (${i})${n.slice(dot)}` : `${n} (${i})`; i++; } used.add(k); return k; };
  // Pump files sequentially in the background; the response starts streaming
  // as soon as the first bytes hit the archive.
  (async () => {
    try {
      for (const w of metas) {
        const name = uniq(safeName(w.meta?.name, w.id));
        const body = await driveFileStream(w.id);
        if (!body) { manifest.push(`${w.folder}/${name} — ${w.label}: NOT INCLUDED (download it from the work order page)`); continue; }
        manifest.push(`${w.folder}/${name} — ${w.label}${w.meta?.size ? ` (${(w.meta.size / 1048576).toFixed(1)} MB)` : ""}`);
        await new Promise<void>((resolve, reject) => {
          const src = Readable.fromWeb(body as any);
          src.on("end", resolve); src.on("error", reject);
          archive.append(src, { name: `${w.folder}/${name}` });
        });
      }
      archive.append(Buffer.from(manifest.join("\n"), "utf8"), { name: "manifest.txt" });
      await archive.finalize();
    } catch (e) { archive.abort(); console.error("[designer-door] zip stream failed", (e as any)?.message || e); }
  })();
  return { stream: Readable.toWeb(archive as any) as ReadableStream<Uint8Array>, name: `${safeName(t.title, "design")} - work order.zip` };
}
