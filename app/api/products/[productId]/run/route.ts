import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { assignProductsToJob } from "@/lib/products-server";
import { logJobActivityServer } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RUN IT — the Catalog's door back into production (client space, Jul 22).
// One product → a fresh intake job with one item carrying the lineage and
// approved art; sizes get settled in the Product Builder (assignProductsToJob
// takes empty qtys by design). Internal-only: auth-gated, service-role writes.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(_req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();
    const { data: product } = await db.from("products")
      .select("id, client_id, brief_id, line_id, title, format, retail, model, state")
      .eq("id", params.productId).single();
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    if ((product as any).state === "retired") return NextResponse.json({ error: "This product is retired" }, { status: 409 });

    const job = await assignProductsToJob(db, {
      clientId: (product as any).client_id,
      title: (product as any).title,
      products: [product as any],
      qtysByProduct: { [(product as any).id]: {} },   // sizes land in the builder
      source: "catalog_run",
      sourceMeta: { product_id: (product as any).id },
    });

    try {
      await logJobActivityServer(job.jobId, `Run started from the catalog: ${(product as any).title}`);
    } catch {}

    return NextResponse.json({ success: true, jobId: job.jobId, jobNumber: job.jobNumber });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
