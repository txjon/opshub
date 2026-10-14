import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hubClientLookup, infoFormEditable, INFO_UPDATE_EMAIL } from "@/lib/hub-client";
import { CERT_BUCKET } from "@/lib/client-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/portal/client/[token]/company/upload { fileName, size, type }
// → a one-time signed upload URL into the PRIVATE client-docs bucket, under
// this client's own folder. The browser uploads straight there (no 4.5MB
// API-route limit); on submit the file is filed in Drive as a staff-only
// Tax Document (lib/client-info). Never public, never listed to the client.
const MAX_BYTES = 15 * 1024 * 1024;
const OK_TYPES = /^(application\/pdf|image\/(png|jpe?g|heic|heif|webp))$/i;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: client } = await hubClientLookup(db, params.token, "id");
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (!(await infoFormEditable(db, (client as any).id))) return NextResponse.json({ error: `This page is view-only. To send a certificate, email ${INFO_UPDATE_EMAIL}.` }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const name = String(b?.fileName || "certificate").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100);
    if (Number(b?.size) > MAX_BYTES) return NextResponse.json({ error: "That file is over 15 MB. Please upload a smaller scan or a PDF." }, { status: 400 });
    if (b?.type && !OK_TYPES.test(String(b.type))) return NextResponse.json({ error: "Please upload a PDF or a photo (JPG, PNG, HEIC)." }, { status: 400 });

    const { data: buckets } = await db.storage.listBuckets();
    // Size + type enforced by STORAGE, not just the browser's word.
    const limits = { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/heic", "image/heif", "image/webp"] };
    if (!(buckets || []).some((x: any) => x.name === CERT_BUCKET)) await db.storage.createBucket(CERT_BUCKET, limits);
    const path = `${(client as any).id}/${Date.now()}-${name}`;
    const { data, error } = await db.storage.from(CERT_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: error?.message || "Upload link failed" }, { status: 500 });
    return NextResponse.json({ path, token: data.token });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 });
  }
}
