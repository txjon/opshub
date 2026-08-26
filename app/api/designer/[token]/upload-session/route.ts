import { NextRequest, NextResponse } from "next/server";
import { createResumableUploadSession } from "@/lib/drive-resumable";
import { woDb, targetOf, targetFolderId } from "@/lib/design-work-orders-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { fileName, mimeType } → a Drive resumable-upload session for THIS work
// order's design folder (Client / Studio / Design — where the studio's own
// files live). The designer's browser streams the bytes in ≤4MB chunks through
// /api/upload-chunk straight into Drive: no storage hop, no size ceiling, no
// 60-second copy. A session URL is bound to one file — it is not a credential.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { fileName, mimeType } = await req.json().catch(() => ({} as any));
  if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("id, state, title, brief_id, item_id").eq("token", params.token).maybeSingle();
  if (!wo || (wo as any).state === "killed") return NextResponse.json({ error: "This link isn't live" }, { status: 404 });
  if ((wo as any).state === "accepted") return NextResponse.json({ error: "This order is closed" }, { status: 409 });
  try {
    const t = await targetOf(wo as any);
    if (!t) return NextResponse.json({ error: "This order's target is gone" }, { status: 404 });
    // Designs: Client / Studio / Design. Runs: the item's own folder (stashed id).
    const { uploadUrl, folderId } = await createResumableUploadSession({ folderId: await targetFolderId(t), fileName: String(fileName).slice(0, 200), mimeType: mimeType || "application/octet-stream" });
    return NextResponse.json({ uploadUrl, folderId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Couldn't start the upload" }, { status: 500 });
  }
}
