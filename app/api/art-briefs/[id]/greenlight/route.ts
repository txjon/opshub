import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { birthProductsFromBrief, assignProductsToJob } from "@/lib/products-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE INTERNAL GREENLIGHT (hole #1, built live with Corey on the line,
// Jul 22). When the client approves out-of-band — or the submission IS the
// approval ("ready to make") — we fork on their word, logged with who
// tapped it. Same machinery as the client fork: products born per build-out
// line; the order door births the job (sizes settle in the builder).
// Body: { door: "later" | "order" }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
    const byName = (profile as any)?.full_name || user.email || "HPD";

    const db = admin();
    const { data: brief } = await db.from("art_briefs")
      .select("id, title, state, client_id, clients(name)").eq("id", params.id).single();
    if (!brief) return NextResponse.json({ error: "Idea not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const door = body.door === "order" ? "order" : "later";

    const products = await birthProductsFromBrief(db, (brief as any).id);
    if (!products.length) return NextResponse.json({ error: "Nothing to greenlight — add a build-out line first" }, { status: 400 });

    let job: { jobId: string; jobNumber: string; itemCount: number } | null = null;
    if (door === "order") {
      const { data: produced } = await db.from("items")
        .select("id").in("product_id", products.map(p => p.id)).limit(1);
      if ((produced || []).length) {
        return NextResponse.json({ error: "Already in production — run repeats from the catalog" }, { status: 409 });
      }
      job = await assignProductsToJob(db, {
        clientId: (brief as any).client_id,
        title: (brief as any).title || "New order",
        products,
        qtysByProduct: Object.fromEntries(products.map(p => [p.id, {}])),
        source: "internal_greenlight",
        sourceMeta: { brief_id: (brief as any).id, greenlit_by: byName },
      });
    }

    const now = new Date().toISOString();
    await db.from("art_briefs").update({ state: "final_approved", updated_at: now }).eq("id", (brief as any).id);
    await db.from("art_brief_messages").insert({
      brief_id: (brief as any).id,
      sender_role: "hpd",
      sender_name: byName,
      message: door === "order"
        ? `✓ Greenlit on the client's word — ${job?.itemCount || products.length} item${(job?.itemCount || products.length) === 1 ? "" : "s"} heading to costing (${job?.jobNumber})`
        : "✓ Greenlit on the client's word — products on the shelf",
      visibility: "all",
    });

    return NextResponse.json({ success: true, door, products: products.length, job });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
