import { NextRequest, NextResponse } from "next/server";
import { proxyDriveFile } from "@/lib/drive-proxy";
import { loadWorkOrderByToken, driveIdsInMessages } from "@/lib/design-work-orders-server";
import { driveIdsInBrief } from "@/lib/design-work-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Token-scoped file proxy for the designer door: serves ONLY the Drive ids
// that belong to this work order (its canvases, pins, extras, and thread
// files). Anything else → 404. Same shape as the art-request gallery proxy.
export async function GET(req: NextRequest, { params }: { params: { token: string; driveId: string } }) {
  const r = await loadWorkOrderByToken(params.token);
  if (!r || r.wo.state === "killed") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const allowed = driveIdsInBrief(r.wo.brief);
  driveIdsInMessages(r.messages).forEach(id => allowed.add(id));
  if (!allowed.has(params.driveId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return await proxyDriveFile(params.driveId, {
      thumb: req.nextUrl.searchParams.get("thumb") === "1",
      download: req.nextUrl.searchParams.get("dl") === "1",
      size: parseInt(req.nextUrl.searchParams.get("size") || "0", 10) || 0,
    });
  } catch (e: any) {
    console.error("[designer-door] proxy failed", params.driveId, e?.message || e);
    return new NextResponse("Failed", { status: 500 });
  }
}
