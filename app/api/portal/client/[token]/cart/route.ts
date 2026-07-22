import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/portal/client/[token]/cart
//
// Client Hub reorder cart. Body:
//   { items: [{ itemId, sizes: { [size]: qty } }], note?: string }
//
// Creates ONE new job in `intake` with a cloned item per cart line —
// the client-side twin of the internal Duplicate action, but item-picked
// across any of the client's past jobs instead of whole-job. Copy shapes
// mirror /api/jobs/[id]/duplicate:
//   - items: identity + costs carried, lifecycle reset (pipeline_stage null)
//   - buy_sheet_lines: the client's REQUESTED per-size qtys (not the old run's)
//   - item_files: same drive_file_id, new rows (files are shared assets;
//     deletion is reference-counted so this is safe)
//   - job_contacts: copied from the most recent source job
// Nothing is priced or committed — the job lands in intake for Drake to
// review, cost, and quote like any other order.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const cart: { itemId: string; sizes?: Record<string, number> }[] = Array.isArray(body.items) ? body.items : [];
    const note: string = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (cart.length === 0) return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    if (cart.length > 40) return NextResponse.json({ error: "Too many items" }, { status: 400 });

    const { data: client } = await db
      .from("clients")
      .select("id, name, default_terms")
      .eq("portal_token", params.token)
      .single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    // Source items must all belong to this client.
    const ids = Array.from(new Set(cart.map(c => c.itemId).filter(Boolean)));
    const { data: srcItems } = await db
      .from("items")
      .select("*, jobs!inner(id, client_id, job_number, title, job_type, payment_terms, shipping_route, created_at)")
      .in("id", ids);
    const owned = (srcItems || []).filter((it: any) => it.jobs?.client_id === client.id);
    if (owned.length !== ids.length) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Job defaults come from the most recent source job — same client,
    // same world; Drake adjusts in intake if this run differs.
    const latestJob = owned
      .map((it: any) => it.jobs)
      .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];

    const firstName = (owned.find((it: any) => it.id === cart[0].itemId) as any)?.name || (owned[0] as any).name || "Reorder";
    const title = owned.length === 1 ? `Reorder: ${firstName}` : `Reorder: ${firstName} + ${owned.length - 1} more`;

    const { data: newJob, error: newJobErr } = await db
      .from("jobs")
      .insert({
        title: title.slice(0, 120),
        job_type: latestJob?.job_type || null,
        phase: "intake",
        payment_terms: latestJob?.payment_terms || (client as any).default_terms || null,
        shipping_route: latestJob?.shipping_route || null,
        target_ship_date: null,
        client_id: client.id,
        job_number: "", // trigger assigns
        type_meta: {
          source: "client_portal_cart",
          client_note: note || null,
          reorder_item_ids: ids,
        },
        quote_approved: false,
      })
      .select("id, job_number")
      .single();
    if (newJobErr || !newJob) {
      return NextResponse.json({ error: newJobErr?.message || "Couldn't create order" }, { status: 500 });
    }
    const newJobId = (newJob as any).id as string;

    let itemCount = 0;
    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const src: any = owned.find((it: any) => it.id === line.itemId);
      if (!src) continue;
      const sizes = Object.entries(line.sizes || {})
        .map(([size, qty]) => ({ size: String(size).slice(0, 20), qty: Math.max(0, Math.min(100000, Math.round(Number(qty) || 0))) }))
        .filter(s => s.qty > 0);
      if (sizes.length === 0) continue;

      const { data: ni, error: itemErr } = await db
        .from("items")
        .insert({
          job_id: newJobId,
          name: src.name,
          blank_vendor: src.blank_vendor,
          blank_sku: src.blank_sku,
          cost_per_unit: src.cost_per_unit,
          sell_per_unit: src.sell_per_unit,
          blank_costs: src.blank_costs || null,
          garment_type: src.garment_type || null,
          drive_link: src.drive_link || null,
          is_fleece: !!src.is_fleece,
          status: "tbd",
          artwork_status: src.artwork_status === "approved" ? "approved" : "not_started",
          sort_order: i,
          pipeline_stage: null,
          blanks_order_number: null,
          ship_tracking: null,
          design_id: src.design_id || null,
        })
        .select("id")
        .single();
      if (itemErr || !ni) continue;
      itemCount++;

      await db.from("buy_sheet_lines").insert(
        sizes.map(s => ({
          item_id: (ni as any).id,
          size: s.size,
          qty_ordered: s.qty,
          qty_shipped_from_vendor: 0,
          qty_received_at_hpd: 0,
          qty_shipped_to_customer: 0,
        }))
      );

      const { data: srcFiles } = await db
        .from("item_files")
        .select("file_name, stage, drive_file_id, drive_link, mime_type, file_size, approval, approved_at, notes")
        .eq("item_id", src.id)
        .is("superseded_at", null);
      if ((srcFiles || []).length > 0) {
        await db.from("item_files").insert(
          (srcFiles || []).map((f: any) => ({
            item_id: (ni as any).id,
            file_name: f.file_name,
            stage: f.stage,
            drive_file_id: f.drive_file_id,
            drive_link: f.drive_link || `https://drive.google.com/file/d/${f.drive_file_id}/view`,
            mime_type: f.mime_type || null,
            file_size: f.file_size || null,
            approval: f.approval || "none",
            approved_at: f.approved_at || null,
            notes: f.notes || null,
          }))
        );
      }
    }

    if (itemCount === 0) {
      await db.from("jobs").delete().eq("id", newJobId);
      return NextResponse.json({ error: "No valid items in cart" }, { status: 400 });
    }

    // Same people as the last order.
    if (latestJob?.id) {
      const { data: srcContacts } = await db
        .from("job_contacts")
        .select("contact_id, role_on_job")
        .eq("job_id", latestJob.id);
      if ((srcContacts || []).length > 0) {
        await db.from("job_contacts").insert(
          (srcContacts || []).map((c: any) => ({
            job_id: newJobId,
            contact_id: c.contact_id,
            role_on_job: c.role_on_job,
          }))
        );
      }
    }

    try {
      const { sendInternalMail } = await import("@/lib/internal-mail");
      await sendInternalMail({ kind: "cart_reorder", client: client.name, jobNumber: (newJob as any).job_number || "new job", title, itemCount, note: note || null, jobId: newJobId });
    } catch {}

    try {
      await logJobActivityServer(newJobId,
        `Reorder request submitted from the client hub (${itemCount} item${itemCount === 1 ? "" : "s"})${note ? ` — note: "${note.slice(0, 200)}"` : ""}`);
    } catch {}

    return NextResponse.json({
      success: true,
      jobId: newJobId,
      jobNumber: (newJob as any).job_number || null,
      itemCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
