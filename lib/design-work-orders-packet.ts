// THE DESIGN PACKET — the offline form of a work order. One spec, one more
// render: brief.pdf (canvases with numbered markers + the pin list + notes +
// conversation + file manifest) and a ZIP with every attachment at full res.
// Server-only. Images ride inside the PDF as data URIs so Browserless never
// needs to reach our proxy (which it can't on localhost anyway).
import JSZip from "jszip";
import { generatePDF } from "@/lib/pdf/browser";
import { proxyDriveFile } from "@/lib/drive-proxy";
import { woTypeLabel, type BriefSpec, type DesignWorkOrder } from "@/lib/design-work-orders";
import type { ResolvedTarget } from "@/lib/design-work-orders-server";

const ZIP_BUDGET = 400 * 1024 * 1024;   // in-memory cap; anything past it is listed in the manifest as "download from the link"

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
  const what = t.kind === "item" && t.jobNumber ? `${t.title} (${t.jobNumber})` : t.title;
  const due = wo.due_by ? new Date(wo.due_by + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null;
  const words = messages.filter(m => m.body && String(m.body).trim() && !/^[✓✕↩]/.test(String(m.body).trim()));
  const canvases = spec.canvases.map((c, i) => `
    <section class="canvas">
      <div class="eyebrow">${spec.canvases.length > 1 ? `Reference ${i + 1}` : "The reference"} · ${c.pins.length} pin${c.pins.length === 1 ? "" : "s"}${c.name ? ` · <span class="mono">${esc(c.name)}</span>` : ""}</div>
      ${c.note ? `<div class="note">${esc(c.note)}</div>` : ""}
      <div class="box">${img[c.previewId || c.driveId] ? `<img src="${img[c.previewId || c.driveId]}" />` : `<div class="missing">image unavailable</div>`}
        ${c.pins.map((p, n) => `<span class="pin" style="left:${p.x}%;top:${p.y}%">${n + 1}</span>`).join("")}
      </div>
      ${c.pins.length ? `<ol class="pins">${c.pins.map((p, n) => `<li><span class="n">${n + 1}</span><div><div class="txt">${esc(p.text || (p.driveId ? "Use this image here." : ""))}</div>${p.driveId && img[p.driveId] ? `<div class="swap"><img src="${img[p.driveId]}" /><span class="mono">${esc(p.name || "")}</span></div>` : ""}</div></li>`).join("")}</ol>` : ""}
    </section>`).join("");
  const extras = spec.extras.length ? `<section><div class="eyebrow">${spec.canvases.length ? "More files" : "The files"} · in the ZIP at full resolution</div><div class="grid">${spec.extras.map(e => `<div class="cell">${img[e.previewId || e.driveId] ? `<img src="${img[e.previewId || e.driveId]}" />` : ""}<div class="cap">${e.label ? `<b>${esc(e.label)}</b> · ` : ""}<span class="mono">${esc(e.name || "")}</span></div></div>`).join("")}</div></section>` : "";
  const convo = (spec.conversation || []).length ? `<section><div class="eyebrow">What the client said</div>${(spec.conversation || []).map(l => `<div class="line"><span class="who ${l.role}">${l.role === "client" ? "Client" : "HPD"}</span><span>${esc(l.text)}</span></div>`).join("")}</section>` : "";
  const thread = words.length ? `<section><div class="eyebrow">The thread so far</div>${words.map(m => `<div class="line"><span class="who ${m.sender_role === "designer" ? "designer" : "us"}">${m.sender_role === "designer" ? esc(m.sender_name || "Designer") : "HPD"}</span><span>${esc(m.body)}</span></div>`).join("")}</section>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(what)} — work order</title>
<style>
  @page{size:Letter;margin:0.5in}
  body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#111;font-size:12px;line-height:1.45;margin:0}
  .mono{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#666}
  h1{font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;margin:2px 0 4px}
  .eyebrow{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#888;margin:0 0 8px}
  .meta{font-size:11px;color:#555}
  .headline{margin:14px 0 0;padding:12px 14px;background:#111;color:#fff;font-weight:900;font-size:18px;text-transform:uppercase;letter-spacing:.02em;border-radius:8px}
  section{margin-top:22px;break-inside:avoid}
  .canvas{break-before:auto}
  .note{font-size:14px;font-weight:800;text-transform:uppercase;margin:0 0 8px}
  .box{position:relative;display:inline-block;max-width:100%;border:1px solid #ddd;border-radius:8px;overflow:hidden;line-height:0}
  .box img{max-width:100%;max-height:6.2in;display:block}
  .pin{position:absolute;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:999px;background:#111;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font:900 11px/18px ui-monospace,Menlo,monospace;text-align:center}
  ol.pins{list-style:none;padding:0;margin:10px 0 0}
  ol.pins li{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid #eee;break-inside:avoid}
  .n{flex:0 0 22px;width:22px;height:22px;border-radius:999px;background:#111;color:#fff;font:900 11px/22px ui-monospace,Menlo,monospace;text-align:center}
  .txt{font-size:13px;font-weight:700;white-space:pre-wrap}
  .swap{margin-top:6px;display:flex;gap:8px;align-items:center}.swap img{width:110px;height:110px;object-fit:cover;border-radius:6px;border:1px solid #ddd}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.cell img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;border:1px solid #ddd}.cap{font-size:10px;margin-top:3px}
  .line{display:flex;gap:10px;padding:5px 0;border-top:1px solid #eee}.who{flex:0 0 58px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding-top:2px;color:#888}.who.client{color:#2a7f9c}.who.designer{color:#2f8f2f}
  .notes{white-space:pre-wrap;font-size:13px}
  .missing{padding:40px;color:#999;text-align:center}
  .foot{margin-top:26px;font-size:10px;color:#888}
</style></head><body>
  <div class="eyebrow">Work order · ${esc(t.companyName)}</div>
  <h1>${esc(what)}</h1>
  <div class="meta">${esc(woTypeLabel(wo.type))}${due ? ` · due ${esc(due)}` : ""}${wo.designer_name ? ` · for ${esc(wo.designer_name)}` : ""} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
  ${wo.headline ? `<div class="headline">${esc(wo.headline)}</div>` : ""}
  ${canvases}
  ${wo.instructions ? `<section><div class="eyebrow">Notes</div><div class="notes">${esc(wo.instructions)}</div></section>` : ""}
  ${convo}
  ${extras}
  ${thread}
  <div class="foot">Deliver on the work order page — it lands on our side instantly. This packet is a snapshot; the page is the live brief.</div>
</body></html>`;
}

export async function packetPdf(wo: DesignWorkOrder, t: ResolvedTarget, messages: any[]): Promise<Buffer> {
  return generatePDF(await packetHtml(wo, t, messages));
}

// ── the ZIP: brief.pdf + every attachment, originals ────────────────────────
export async function packageZip(wo: DesignWorkOrder, t: ResolvedTarget, messages: any[]): Promise<{ buf: Buffer; name: string }> {
  const spec: BriefSpec = wo.brief || { canvases: [], extras: [] };
  const zip = new JSZip();
  const manifest: string[] = [`${t.title} — work order (${woTypeLabel(wo.type)})`, `Packaged ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, ""];
  // the brief: PDF if the renderer's up, HTML otherwise (never an empty package)
  const html = await packetHtml(wo, t, messages);
  try { zip.file("brief.pdf", await generatePDF(html)); manifest.push("brief.pdf — the design packet"); }
  catch { zip.file("brief.html", html); manifest.push("brief.html — the design packet (open in a browser)"); }
  // every attachment, deduped by Drive id, originals
  const want: { id: string; folder: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined, folder: string, label: string) => { if (id && !seen.has(id)) { seen.add(id); want.push({ id, folder, label }); } };
  spec.canvases.forEach((c, i) => { add(c.driveId, "references", `reference ${i + 1}`); c.pins.forEach((p, n) => add(p.driveId, "pins", `pin ${n + 1} of reference ${i + 1}`)); });
  spec.extras.forEach(e => add(e.driveId, "files", e.label || "file"));
  for (const m of messages) if (m.sender_role === "hpd" && m._drive) add(m._drive, "thread", "reference from HPD");
  let used = 0;
  for (const w of want) {
    const b = used < ZIP_BUDGET ? await driveBytes(w.id) : null;
    if (!b) { manifest.push(`${w.folder}/ — ${w.label}: NOT INCLUDED (download it from the work order page)`); continue; }
    used += b.buf.length;
    const name = safeName(b.name, w.id);
    zip.file(`${w.folder}/${name}`, b.buf);
    manifest.push(`${w.folder}/${name} — ${w.label} (${(b.buf.length / 1048576).toFixed(1)} MB)`);
  }
  zip.file("manifest.txt", manifest.join("\n"));
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  return { buf, name: `${safeName(t.title, "design")} - work order.zip` };
}
