import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { birthProductsFromBrief, assignProductsToJob } from "@/lib/products-server";
import { hubClientLookup } from "@/lib/hub-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE FORK — client greenlights an idea (Jul 22 2026).
//
// POST body: { door: "later" }
//         or { door: "order", qtys: { [lineId]: { [size]: qty } } }
//
// BOTH doors birth products (one per build-out line, idempotent). "later"
// shelves them: client catalog + our rack, run whenever. "order" assigns them
// straight to a fresh job with the client's quantities (the generalized Cut).
// Re-ordering an already-produced product goes through its item history, not
// here — this route refuses a second "order" to keep runs distinct.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  try {
    const db = admin();
    const { data: client } = await hubClientLookup(db, params.token, "id, name, portal_features");
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("studio")) {
      return NextResponse.json({ error: "Not available" }, { status: 403 });
    }
    const { data: brief } = await db.from("art_briefs")
      .select("id, title, state, client_id").eq("id", params.briefId).single();
    if (!brief || (brief as any).client_id !== (client as any).id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const door = body.door === "order" ? "order" : "later";

    const products = await birthProductsFromBrief(db, (brief as any).id);
    if (!products.length) return NextResponse.json({ error: "Nothing to greenlight yet" }, { status: 400 });

    let job: { jobId: string; jobNumber: string; itemCount: number } | null = null;
    if (door === "order") {
      // one run per product through this door — repeats go through reorders
      const { data: produced } = await db.from("items")
        .select("id").in("product_id", products.map(p => p.id)).limit(1);
      if ((produced || []).length) {
        return NextResponse.json({ error: "This one's already in production — reorder it from your items page" }, { status: 409 });
      }
      const qtysByLine: Record<string, Record<string, number>> = body.qtys || {};
      const qtysByProduct: Record<string, Record<string, number>> = {};
      for (const p of products) qtysByProduct[p.id] = qtysByLine[p.line_id || ""] || {};
      const total = Object.values(qtysByProduct).reduce((a, q) =>
        a + Object.values(q).reduce((s: number, n: any) => s + (Number(n) || 0), 0), 0);
      if (total <= 0) return NextResponse.json({ error: "Add quantities first" }, { status: 400 });
      job = await assignProductsToJob(db, {
        clientId: (client as any).id,
        title: (brief as any).title || "New order",
        products,
        qtysByProduct,
        source: "studio_greenlight",
        sourceMeta: { brief_id: (brief as any).id },
      });
    }

    const now = new Date().toISOString();
    await db.from("art_briefs").update({ state: "approved", updated_at: now }).eq("id", (brief as any).id);
    // ✓ markers are load-bearing (approval recovery) — one real event, not autosave noise
    await db.from("art_brief_messages").insert({
      brief_id: (brief as any).id,
      sender_role: "client",
      sender_name: (client as any).name,
      message: door === "order"
        ? `✓ Greenlit — ordered (${job?.itemCount || products.length} item${(job?.itemCount || products.length) === 1 ? "" : "s"})`
        : "✓ Greenlit — on the shelf, ready when they are",
      visibility: "all",
    });

    try {
      const { sendInternalMail } = await import("@/lib/internal-mail");
      await sendInternalMail({
        kind: "idea_greenlit",
        client: (client as any).name,
        title: (brief as any).title || "Idea",
        door,
        productCount: products.length,
        jobId: job?.jobId || null,
        jobNumber: job?.jobNumber || null,
      });
    } catch {}

    return NextResponse.json({ success: true, door, products: products.length, job });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
