import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { logJobActivityServer } from "@/lib/notify-server";
import { getItemFolderId, createShortcut } from "@/lib/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/jobs/[id]/duplicate
//
// Re-order duplication. Carries forward everything that's still valid
// for the same client placing another order of the same artwork:
//
//   - jobs row (cleared QB/Stripe/payment fields, fresh phase, blank
//     job_number — the trigger assigns a new one)
//   - items rows (new ids, fresh lifecycle, qtys preserved)
//   - buy_sheet_lines (qty_ordered preserved; ship/receive counters reset)
//   - item_files rows (NEW item_id, SAME drive_file_id — files are
//     shared assets). approval / approved_at preserved so a previously
//     client-approved proof stays approved on the re-order. Filtered to
//     superseded_at IS NULL so we don't carry stale rows. mime_type,
//     file_size, notes carry over too.
//   - costing_data.costProds rebound to the new item ids
//   - job_contacts (same contacts on the new job)
//
// Best-effort side effect: creates Drive shortcuts in the new project's
// Drive folder pointing at each original file. That way Drake browsing
// the duplicate's Drive folder directly sees the art/mockup/proof. If
// Drive shortcut creation fails for any reason, the DB duplication
// still succeeds — the OpsHub UI reads files by drive_file_id from
// item_files, so DB state alone keeps the app working.
//
// Not copied:
//   - decorator_assignments (start clean for the new run)
//   - pipeline_stage / blanks_order_number / tracking
//   - QB invoice number, Stripe invoice id, payment links, po_sent_vendors
//   - quote_approved / quote_approved_at (this job needs its own approval)

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();

    // Pull source job + everything we need to clone
    const { data: srcJob, error: jobErr } = await db
      .from("jobs")
      .select("*, clients(name)")
      .eq("id", params.id)
      .single();
    if (jobErr || !srcJob) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Strip transactional / external-system fields from type_meta so the
    // duplicate doesn't masquerade as already invoiced / PO'd. Keeps
    // benign meta like venue addresses, shipping notes, etc.
    const clearedTypeMeta = (() => {
      const m: Record<string, any> = { ...((srcJob as any).type_meta || {}) };
      delete m.qb_invoice_id;
      delete m.qb_invoice_number;
      delete m.qb_payment_link;
      delete m.qb_tax_amount;
      delete m.qb_total_with_tax;
      delete m.stripe_invoice_id;
      delete m.stripe_invoice_number;
      delete m.stripe_payment_link;
      delete m.stripe_invoice_status;
      delete m.stripe_total_cents;
      delete m.po_sent_vendors;
      delete m.po_sent_dates;
      delete m.quote_sent_at;
      delete m.invoice_sent_at;
      delete m.invoice_date_override;
      delete m.last_reminder_sent_at;
      delete m.qb_variance_pushed_at;
      return m;
    })();

    const newTitle = `${(srcJob as any).title || ""} (Copy)`.trim();

    const { data: newJob, error: newJobErr } = await db
      .from("jobs")
      .insert({
        title: newTitle,
        job_type: (srcJob as any).job_type,
        phase: "intake",
        priority: (srcJob as any).priority,
        payment_terms: (srcJob as any).payment_terms,
        shipping_route: (srcJob as any).shipping_route,
        target_ship_date: null,
        type_meta: clearedTypeMeta,
        notes: (srcJob as any).notes,
        client_id: (srcJob as any).client_id,
        job_number: "", // trigger assigns
        costing_data: (srcJob as any).costing_data || null,
        costing_summary: null,
        quote_approved: false,
        quote_approved_at: null,
      })
      .select("id")
      .single();
    if (newJobErr || !newJob) {
      return NextResponse.json({ error: newJobErr?.message || "Failed to create duplicate job" }, { status: 500 });
    }

    const newJobId = (newJob as any).id as string;

    // Pull source items
    const { data: srcItems } = await db
      .from("items")
      .select("*")
      .eq("job_id", params.id)
      .order("sort_order", { ascending: true });

    const idMap: Record<string, string> = {};
    const newItems: { id: string; name: string }[] = [];

    for (const item of srcItems || []) {
      const { data: ni, error: itemErr } = await db
        .from("items")
        .insert({
          job_id: newJobId,
          name: (item as any).name,
          blank_vendor: (item as any).blank_vendor,
          blank_sku: (item as any).blank_sku,
          cost_per_unit: (item as any).cost_per_unit,
          sell_per_unit: (item as any).sell_per_unit,
          blank_costs: (item as any).blank_costs || null,
          garment_type: (item as any).garment_type || null,
          drive_link: (item as any).drive_link || null,
          is_fleece: !!(item as any).is_fleece,
          status: "tbd",
          artwork_status: (item as any).artwork_status === "approved" ? "approved" : "not_started",
          sort_order: (item as any).sort_order ?? 0,
          pipeline_stage: null,
          blanks_order_number: null,
          ship_tracking: null,
        })
        .select("id, name")
        .single();
      if (itemErr || !ni) continue;
      idMap[(item as any).id] = (ni as any).id;
      newItems.push({ id: (ni as any).id, name: (ni as any).name });

      // Carry buy_sheet_lines (size + qty_ordered). Other counters reset.
      const { data: srcLines } = await db
        .from("buy_sheet_lines")
        .select("size, qty_ordered")
        .eq("item_id", (item as any).id);
      if ((srcLines || []).length > 0) {
        await db.from("buy_sheet_lines").insert(
          (srcLines || []).map((l: any) => ({
            item_id: (ni as any).id,
            size: l.size,
            qty_ordered: l.qty_ordered,
            qty_shipped_from_vendor: 0,
            qty_received_at_hpd: 0,
            qty_shipped_to_customer: 0,
          }))
        );
      }

      // Carry item_files — same drive_file_id, preserve approval state.
      const { data: srcFiles } = await db
        .from("item_files")
        .select("file_name, stage, drive_file_id, drive_link, mime_type, file_size, approval, approved_at, notes")
        .eq("item_id", (item as any).id)
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

    // Remap costing_data.costProds ids to the new item ids so CostingTab
    // shows pricing immediately on the duplicate.
    const costing = ((srcJob as any).costing_data || null) as any;
    if (costing && Array.isArray(costing.costProds)) {
      const remapped = costing.costProds.map((cp: any) => ({
        ...cp,
        id: idMap[cp.id] || cp.id,
      }));
      await db.from("jobs").update({
        costing_data: { ...costing, costProds: remapped, _savedAt: new Date().toISOString() },
      }).eq("id", newJobId);
    }

    // Copy contacts
    const { data: srcContacts } = await db
      .from("job_contacts")
      .select("contact_id, role_on_job")
      .eq("job_id", params.id);
    if ((srcContacts || []).length > 0) {
      await db.from("job_contacts").insert(
        (srcContacts || []).map((c: any) => ({
          job_id: newJobId,
          contact_id: c.contact_id,
          role_on_job: c.role_on_job,
        }))
      );
    }

    // Best-effort: create Drive shortcuts in the duplicate's project
    // folder pointing at each original file. The DB-level duplication
    // above is the source of truth — if Drive shortcut creation fails
    // (network blip, missing source file, permission edge), we log and
    // continue. Users still see all files in OpsHub via item_files;
    // shortcuts are purely for Drive-browser convenience.
    const clientName = ((srcJob as any).clients?.name) || "";
    const shortcutResult = { attempted: 0, ok: 0, failed: 0 };
    if (clientName && newTitle) {
      for (const ni of newItems) {
        const { data: filesForItem } = await db
          .from("item_files")
          .select("file_name, drive_file_id")
          .eq("item_id", ni.id);
        if (!filesForItem || filesForItem.length === 0) continue;
        let itemFolderId: string;
        try {
          itemFolderId = await getItemFolderId(clientName, newTitle, ni.name || "Item");
        } catch (e: any) {
          console.error("[job duplicate] folder ensure failed:", e?.message || e);
          continue;
        }
        for (const f of filesForItem) {
          if (!f.drive_file_id) continue;
          shortcutResult.attempted++;
          try {
            await createShortcut(f.drive_file_id, f.file_name || "file", itemFolderId);
            shortcutResult.ok++;
          } catch (e: any) {
            shortcutResult.failed++;
            console.error("[job duplicate] shortcut failed:", e?.message || e);
          }
        }
      }
    }

    try {
      await logJobActivityServer(newJobId,
        `Project duplicated from "${(srcJob as any).title || "—"}" (re-order; files shortcut from original).`);
    } catch {}

    return NextResponse.json({
      jobId: newJobId,
      itemCount: newItems.length,
      shortcuts: shortcutResult,
    });
  } catch (e: any) {
    console.error("[job duplicate] error:", e);
    return NextResponse.json({ error: e?.message || "Duplication failed" }, { status: 500 });
  }
}
