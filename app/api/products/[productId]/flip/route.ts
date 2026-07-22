import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FLIP IT — a previous product in a new direction (different blank color, ink
// color, whatever changes). Doctrine: a flip is a NEW idea in the Studio,
// pre-loaded with the parent's art and build-out line; the child PRODUCT is
// born at its own greenlight fork carrying parent_product_id (spec.flip_of →
// birthProductsFromBrief). Colorway changes need the design ping-pong a
// straight reorder skips — that's why this lands in the Studio, not a job.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const note = String(body.note || "").trim().slice(0, 1000);

    const db = admin();
    const { data: product } = await db.from("products")
      .select("id, client_id, brief_id, line_id, title, format, retail, model")
      .eq("id", params.productId).single();
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const p: any = product;
    const { data: brief, error: bErr } = await db.from("art_briefs").insert({
      client_id: p.client_id,
      title: `${p.title} — Flip`.slice(0, 140),
      concept: note || `Flip of ${p.title}. Same design, new direction — blank color, ink color, or both. What changes?`,
      state: "draft",
      source: "hpd",
      product_spec: {
        flip_of: p.id,
        products: [{ id: "l1", format: p.format || null, retail: p.retail ?? null, model: p.model || null, notes: null }],
      },
    }).select("id").single();
    if (bErr || !brief) return NextResponse.json({ error: bErr?.message || "Couldn't open the flip" }, { status: 500 });

    // carry the parent's newest client-visible image (pointer, not a copy)
    if (p.brief_id) {
      const { data: bf } = await db.from("art_brief_files")
        .select("file_name, drive_file_id, preview_drive_file_id, drive_link, mime_type, file_size, kind, uploader_role, shared_with_client_at")
        .eq("brief_id", p.brief_id).order("created_at", { ascending: false }).limit(10);
      const pick = (bf || []).find((f: any) => (f.shared_with_client_at || f.uploader_role === "client")
        && (f.preview_drive_file_id || f.drive_file_id) && !/pdf/i.test(f.mime_type || ""));
      if (pick) {
        await db.from("art_brief_files").insert({
          brief_id: (brief as any).id,
          file_name: (pick as any).file_name || "parent art",
          drive_file_id: (pick as any).drive_file_id,
          preview_drive_file_id: (pick as any).preview_drive_file_id || null,
          drive_link: (pick as any).drive_link || null,
          mime_type: (pick as any).mime_type || null,
          file_size: (pick as any).file_size || null,
          kind: (pick as any).kind || "reference",
          uploader_role: "hpd",
          shared_with_client_at: (pick as any).shared_with_client_at ? new Date().toISOString() : null,
        });
      }
    }

    return NextResponse.json({ success: true, briefId: (brief as any).id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
