import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { assignProductsToJob } from "@/lib/products-server";
import { hubClientLookup } from "@/lib/hub-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE SHELF (client Catalog, Jul 22) — greenlit products that haven't run
// yet. "Bring it back later" lands here; ordering one is its first run.
// GET  → unproduced ready products with art
// POST → { productId, qtys: { [size]: n } } → first run: job born (the
//        generalized cut), labs notified. Produced products reorder through
//        the item catalog instead — one door per state, never two.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function gate(token: string) {
  const db = admin();
  const { data: client } = await hubClientLookup(db, token, "id, name");
  return client ? { db, client } : null;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const ctx = await gate(params.token);
    if (!ctx) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const { db, client } = ctx;

    const { data: prods } = await db.from("products")
      .select("id, brief_id, title, format, retail, model, created_at")
      .eq("client_id", (client as any).id).eq("state", "ready")
      .order("created_at", { ascending: false });
    if (!(prods || []).length) return NextResponse.json({ products: [] });

    // produced products live in the item catalog — the shelf is the unrun
    const { data: produced } = await db.from("items")
      .select("product_id").in("product_id", (prods || []).map((p: any) => p.id));
    const producedSet = new Set((produced || []).map((i: any) => i.product_id));
    const shelf = (prods || []).filter((p: any) => !producedSet.has(p.id));

    // art: newest client-visible image on each product's brief
    const briefIds = Array.from(new Set(shelf.map((p: any) => p.brief_id).filter(Boolean)));
    const artByBrief: Record<string, string> = {};
    if (briefIds.length) {
      const { data: files } = await db.from("art_brief_files")
        .select("brief_id, drive_file_id, preview_drive_file_id, mime_type, uploader_role, shared_with_client_at, created_at")
        .in("brief_id", briefIds).order("created_at", { ascending: false });
      for (const f of (files || []) as any[]) {
        if (artByBrief[f.brief_id]) continue;
        if (!(f.shared_with_client_at || f.uploader_role === "client")) continue;
        if (/pdf/i.test(f.mime_type || "")) continue;
        const id = f.preview_drive_file_id || f.drive_file_id;
        if (id) artByBrief[f.brief_id] = id;
      }
    }
    return NextResponse.json({
      products: shelf.map((p: any) => ({
        id: p.id, title: p.title, format: p.format, retail: p.retail, model: p.model,
        artFileId: p.brief_id ? artByBrief[p.brief_id] || null : null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const ctx = await gate(params.token);
    if (!ctx) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const { db, client } = ctx;
    const body = await req.json().catch(() => ({}));

    const { data: product } = await db.from("products")
      .select("id, client_id, brief_id, line_id, title, format, retail, model, notes, state")
      .eq("id", String(body.productId || "")).single();
    if (!product || (product as any).client_id !== (client as any).id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data: produced } = await db.from("items").select("id").eq("product_id", (product as any).id).limit(1);
    if ((produced || []).length) {
      return NextResponse.json({ error: "This one's already run — reorder it from your catalog below" }, { status: 409 });
    }
    const qtys: Record<string, number> = {};
    for (const [s, n] of Object.entries(body.qtys || {})) {
      const v = Math.round(Number(n) || 0);
      if (v > 0) qtys[String(s)] = v;
    }
    const total = Object.values(qtys).reduce((a, n) => a + n, 0);
    if (total <= 0) return NextResponse.json({ error: "Add quantities first" }, { status: 400 });

    const job = await assignProductsToJob(db, {
      clientId: (client as any).id,
      title: (product as any).title,
      products: [product as any],
      qtysByProduct: { [(product as any).id]: qtys },
      source: "catalog_run_client",
      sourceMeta: { product_id: (product as any).id },
    });

    try {
      const { sendInternalMail } = await import("@/lib/internal-mail");
      await sendInternalMail({
        kind: "product_run",
        client: (client as any).name,
        title: (product as any).title,
        units: total,
        jobId: job.jobId,
        jobNumber: job.jobNumber,
      });
    } catch {}

    return NextResponse.json({ success: true, jobNumber: job.jobNumber });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
