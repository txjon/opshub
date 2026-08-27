import { NextRequest, NextResponse } from "next/server";
import { loadWorkOrderByToken, targetOf } from "@/lib/design-work-orders-server";
import { packetPdf, packetHtml, safeName } from "@/lib/design-work-orders-packet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET → brief.pdf alone (the design packet). ?html=1 previews the source.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const r = await loadWorkOrderByToken(params.token);
  if (!r || r.wo.state === "killed") return NextResponse.json({ error: "This link isn't live" }, { status: 404 });
  const t = await targetOf(r.wo);
  if (!t) return NextResponse.json({ error: "This order's target is gone" }, { status: 404 });
  if (req.nextUrl.searchParams.get("html") === "1") return new NextResponse(await packetHtml(r.wo, t, r.messages), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  try {
    const pdf = await packetPdf(r.wo, t, r.messages);
    const name = `${safeName(t.title, "design")} - brief.pdf`;
    return new NextResponse(pdf as any, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[designer-door] packet failed", e?.message || e);
    return NextResponse.json({ error: "Couldn't render the PDF right now" }, { status: 500 });
  }
}
