import { NextRequest, NextResponse } from "next/server";
import { LAB_BUCKET } from "@/lib/lab";
import { woDb } from "@/lib/design-work-orders-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { filename, contentType } → a signed upload URL the designer's browser
// PUTs the raw file to (no request-body walls — deliverables are 50MB+ AI/PSD),
// scoped to ONE path under this work order. The bytes land in storage first;
// the message route then copies them into Drive as a real brief file. The
// designer never touches a Drive credential.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { filename, contentType } = await req.json().catch(() => ({} as any));
  if (!filename) return NextResponse.json({ error: "filename required" }, { status: 400 });
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("id, state").eq("token", params.token).maybeSingle();
  if (!wo || (wo as any).state === "killed") return NextResponse.json({ error: "This link isn't live" }, { status: 404 });
  const safe = String(filename).replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const path = `wo/${(wo as any).id}/${Date.now()}-${safe}`;
  const { data, error } = await db.storage.from(LAB_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || "Upload init failed" }, { status: 500 });
  return NextResponse.json({ uploadUrl: data.signedUrl, path, contentType: contentType || "application/octet-stream" });
}
