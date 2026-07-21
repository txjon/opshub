import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/portal/client/[token]/briefs/[briefId]/spec
//
// The Studio's build-it-out: the client shapes their own idea — rename it,
// set target retail, pick stock vs pre-order, format, rough run size.
// Body: { title?, retail?, model?, format?, run_size?, spec_notes? }
// Writes art_briefs.title + merges product_spec (mig 133). Changes post a
// compact system marker to the thread so the ping-pong shows the shaping.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function PATCH(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  try {
    const db = admin();
    const { data: client } = await db.from("clients")
      .select("id, name, portal_features").eq("portal_token", params.token).single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("studio")) {
      return NextResponse.json({ error: "Not available" }, { status: 403 });
    }
    const { data: brief } = await db.from("art_briefs")
      .select("id, title, client_id, product_spec").eq("id", params.briefId).single();
    if (!brief || (brief as any).client_id !== client.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {};
    const spec: Record<string, any> = { ...((brief as any).product_spec || {}) };
    const changes: string[] = [];

    if (typeof body.title === "string" && body.title.trim() && body.title.trim() !== (brief as any).title) {
      updates.title = body.title.trim().slice(0, 140);
      changes.push(`renamed to "${updates.title}"`);
    }
    if (body.retail !== undefined) {
      const r = body.retail === null || body.retail === "" ? null : Math.max(0, Math.min(100000, Number(body.retail) || 0));
      if (r !== (spec.retail ?? null)) { spec.retail = r; changes.push(r != null ? `retail $${r}` : "retail cleared"); }
    }
    if (body.model !== undefined && ["stock", "preorder", null, ""].includes(body.model)) {
      const m = body.model || null;
      if (m !== (spec.model ?? null)) { spec.model = m; changes.push(m === "preorder" ? "pre-order drop" : m === "stock" ? "fixed run" : "model cleared"); }
    }
    if (body.format !== undefined) {
      const f = String(body.format || "").trim().slice(0, 60) || null;
      if (f !== (spec.format ?? null)) { spec.format = f; if (f) changes.push(f.toLowerCase()); }
    }
    if (body.run_size !== undefined) {
      const n = body.run_size === null || body.run_size === "" ? null : Math.max(0, Math.min(1000000, Math.round(Number(body.run_size) || 0)));
      if (n !== (spec.run_size ?? null)) { spec.run_size = n; if (n) changes.push(`~${n.toLocaleString()} pcs`); }
    }
    // Multi-product line items — same artwork, N sellable versions (tee /
    // hoodie / LS…), each with its own retail + stock-vs-preorder + run.
    if (body.products !== undefined && Array.isArray(body.products)) {
      const clean = body.products.slice(0, 10).map((x: any) => ({
        id: String(x.id || "").slice(0, 40) || Math.random().toString(36).slice(2, 10),
        format: String(x.format || "").trim().slice(0, 60) || null,
        retail: x.retail === null || x.retail === "" || x.retail === undefined ? null : Math.max(0, Math.min(100000, Number(x.retail) || 0)),
        model: ["stock", "preorder"].includes(x.model) ? x.model : null,
        run_size: x.run_size === null || x.run_size === "" || x.run_size === undefined ? null : Math.max(0, Math.min(1000000, Math.round(Number(x.run_size) || 0))),
        notes: String(x.notes || "").trim().slice(0, 600) || null,
      }));
      if (JSON.stringify(clean) !== JSON.stringify(spec.products || [])) {
        spec.products = clean;
        const summary = clean.map((x: any) => [x.format || "item", x.retail != null ? `$${x.retail}` : null, x.model === "preorder" ? "pre-order" : x.model === "stock" ? "fixed run" : null].filter(Boolean).join(" ")).join(" · ");
        if (summary) changes.push(summary.slice(0, 260));
      }
    }
    if (body.spec_notes !== undefined) {
      const sn = String(body.spec_notes || "").trim().slice(0, 1000) || null;
      if (sn !== (spec.spec_notes ?? null)) { spec.spec_notes = sn; }
    }

    if (Object.keys(updates).length === 0 && changes.length === 0 && body.spec_notes === undefined) {
      return NextResponse.json({ success: true, unchanged: true });
    }
    updates.product_spec = spec;
    updates.updated_at = new Date().toISOString();
    const { error } = await db.from("art_briefs").update(updates).eq("id", (brief as any).id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (changes.length > 0) {
      try {
        // One evolving marker, not a play-by-play: field-level autosave
        // means many PATCHes per shaping session — if the LATEST message
        // on the thread is already a client ✎ marker, update it in place
        // with the current full summary instead of stacking bubbles.
        const marker = `✎ ${changes.join(" · ")}`.slice(0, 300);
        const { data: last } = await db.from("art_brief_messages")
          .select("id, sender_role, message")
          .eq("brief_id", (brief as any).id)
          .order("created_at", { ascending: false })
          .limit(1);
        const lm = (last || [])[0];
        if (lm && lm.sender_role === "client" && String(lm.message || "").startsWith("✎")) {
          await db.from("art_brief_messages").update({ message: marker }).eq("id", lm.id);
        } else {
          await db.from("art_brief_messages").insert({
            brief_id: (brief as any).id,
            sender_role: "client",
            sender_name: (client as any).name,
            message: marker,
            visibility: "all",
          });
        }
      } catch {}
    }

    return NextResponse.json({ success: true, product_spec: spec, title: updates.title || (brief as any).title });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
