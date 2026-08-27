import { NextRequest, NextResponse } from "next/server";
import { loadWorkOrderByToken, targetOf } from "@/lib/design-work-orders-server";
import { packageZipStream } from "@/lib/design-work-orders-packet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET → the offline package: brief.pdf + every attachment at full res, zipped.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const r = await loadWorkOrderByToken(params.token);
  if (!r || r.wo.state === "killed") return NextResponse.json({ error: "This link isn't live" }, { status: 404 });
  const t = await targetOf(r.wo);
  if (!t) return NextResponse.json({ error: "This order's target is gone" }, { status: 404 });
  try {
    const { stream, name } = await packageZipStream(r.wo, t, r.messages);
    return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[designer-door] package failed", e?.message || e);
    return NextResponse.json({ error: "Couldn't build the package — download the files from the page" }, { status: 500 });
  }
}
