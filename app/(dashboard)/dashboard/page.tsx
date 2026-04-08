import { createClient } from "@/lib/supabase/server";
import { T, font, mono } from "@/lib/theme";
import { CommandCenter } from "@/components/CommandCenter";

export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

  // ── Data Loading ──
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), quote_approved, quote_approved_at, type_meta, costing_data, costing_summary, payment_terms, shipping_route, fulfillment_status, quote_rejection_notes, items(id, name, pipeline_stage, blanks_order_number, ship_tracking, artwork_status, garment_type, received_at_hpd, pipeline_timestamps, buy_sheet_lines(qty_ordered))")
    .not("phase", "in", '("complete","cancelled","on_hold")')
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const { data: allPayments } = await supabase
    .from("payment_records")
    .select("*, jobs!inner(id)")
    .order("created_at");

  const allItemIds = (jobs || []).flatMap(j => (j.items || []).map((it: any) => it.id));
  const { data: proofFiles } = allItemIds.length > 0
    ? await supabase.from("item_files").select("item_id, stage, approval, notes").in("item_id", allItemIds).in("stage", ["proof", "mockup"])
    : { data: [] };

  // Load contacts for email modals
  const jobIds = (jobs || []).map(j => j.id);
  const { data: jobContacts } = jobIds.length > 0
    ? await supabase.from("job_contacts").select("job_id, role_on_job, contacts(name, email)").in("job_id", jobIds)
    : { data: [] };

  // ── Proof status map ──
  const proofMap: Record<string, { allApproved: boolean; hasRevision: boolean; pendingCount: number; revisionNotes: string | null }> = {};
  for (const id of allItemIds) {
    const proofs = (proofFiles || []).filter(f => f.item_id === id && f.stage === "proof");
    proofMap[id] = {
      allApproved: proofs.length > 0 && proofs.every(f => f.approval === "approved"),
      hasRevision: proofs.some(f => f.approval === "revision_requested"),
      pendingCount: proofs.filter(f => f.approval === "pending").length,
      revisionNotes: proofs.find(f => f.approval === "revision_requested")?.notes || null,
    };
  }

  // ── Payment map by job ──
  const paymentsByJob: Record<string, any[]> = {};
  for (const p of (allPayments || [])) {
    const jid = (p.jobs as any)?.id;
    if (jid) { if (!paymentsByJob[jid]) paymentsByJob[jid] = []; paymentsByJob[jid].push(p); }
  }

  // ── Contacts map by job ──
  const contactsByJob: Record<string, { name: string; email: string; role: string }[]> = {};
  for (const jc of (jobContacts || [])) {
    const jid = jc.job_id;
    const c = jc.contacts as any;
    if (jid && c?.email) {
      if (!contactsByJob[jid]) contactsByJob[jid] = [];
      contactsByJob[jid].push({ name: c.name || "", email: c.email, role: jc.role_on_job || "" });
    }
  }

  // ── Generate Alerts ──
  const activeJobs = jobs || [];
  const alerts: any[] = [];

  for (const j of activeJobs) {
    const items = j.items || [];
    const typeMeta = (j.type_meta || {}) as any;
    const invoiceNum = typeMeta.qb_invoice_number || null;
    const jobNum = j.job_number || "";
    const clientName = (j.clients as any)?.name || "";
    const contacts = contactsByJob[j.id] || [];
    const payments = paymentsByJob[j.id] || [];
    const hasPaidPayment = payments.some(p => p.status === "paid" || p.status === "partial");
    const quoteApproved = (j as any).quote_approved;
    const rejectionNotes = (j as any).quote_rejection_notes || null;
    const allProofsApproved = items.length > 0 && items.every((it: any) => proofMap[it.id]?.allApproved || it.artwork_status === "approved");
    const poSentVendors = typeMeta.po_sent_vendors || [];
    const costProds = (j as any).costing_data?.costProds || [];
    const allVendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))] as string[];
    const unsentVendors = allVendors.filter(v => !poSentVendors.includes(v));
    const costingSummary = (j as any).costing_summary || {};
    const costingSet = (costingSummary.grossRev || 0) > 0;
    const terms = j.payment_terms || "";
    const paymentGateMet = terms === "net_15" || terms === "net_30" || hasPaidPayment;
    const apparelItems = items.filter((it: any) => it.garment_type !== "accessory");

    const base = {
      jobId: j.id, jobTitle: j.title, clientName, invoiceNumber: invoiceNum,
      jobNumber: jobNum, shipDate: j.target_ship_date, contacts,
    };

    // ═══════════ SALES ALERTS ═══════════

    // 1. Overdue — downgrade to amber if in fulfillment/shipping (almost done)
    if (j.target_ship_date && new Date(j.target_ship_date) < now) {
      const days = Math.abs(Math.ceil((new Date(j.target_ship_date).getTime() - now.getTime()) / 86400000));
      const isFinishing = j.phase === "fulfillment" || j.phase === "shipping";
      alerts.push({ ...base, priority: isFinishing ? 1 : 0, type: "overdue", color: isFinishing ? T.amber : T.red,
        action: isFinishing ? `${days} days past ship date — ${j.phase === "fulfillment" ? "in fulfillment" : "ready to ship"}` : `${days} days past ship date`,
        href: `/jobs/${j.id}`, column: "sales" });
    }

    // 2. Quote rejected — client submitted notes (NEW)
    if (rejectionNotes && !quoteApproved) {
      alerts.push({ ...base, priority: 0, type: "quote_rejected", color: T.red,
        action: "Quote rejected — review client notes", notes: rejectionNotes,
        href: `/jobs/${j.id}?tab=quote`, column: "sales" });
    }

    // 3. Proof revision requested — with client notes
    for (const it of items) {
      if (proofMap[it.id]?.hasRevision) {
        alerts.push({ ...base, priority: 0, type: "revision", color: T.red,
          action: `Proof revision requested — ${it.name}`, notes: proofMap[it.id]?.revisionNotes || null,
          href: `/jobs/${j.id}?tab=art`, column: "sales" });
      }
    }

    // 4. Create invoice — timing depends on payment terms
    const isNet = terms === "net_15" || terms === "net_30";
    if (quoteApproved && !invoiceNum) {
      if (isNet) {
        // Net terms: invoice at shipment on actual shipped quantities
        const hasShippedItems = items.some((it: any) => it.pipeline_stage === "shipped" || it.ship_tracking);
        const isShippingPhase = j.phase === "shipping" || j.phase === "fulfillment" || j.phase === "receiving";
        if (hasShippedItems || isShippingPhase) {
          alerts.push({ ...base, priority: 1, type: "create_invoice", color: T.amber,
            action: "Create invoice · order shipped, invoice on actual quantities",
            href: `/jobs/${j.id}?tab=payment`, column: "sales" });
        }
      } else {
        // Prepaid/deposit: invoice immediately after quote approval
        alerts.push({ ...base, priority: 1, type: "create_invoice", color: T.amber,
          action: "Create invoice", href: `/jobs/${j.id}?tab=payment`, column: "sales" });
      }
    }

    // 5. Send invoice
    if (quoteApproved && invoiceNum && payments.length === 0) {
      if (isNet) {
        // Net terms: invoice already created (post-shipment), now send it
        const termLabel = terms === "net_15" ? "net 15" : "net 30";
        alerts.push({ ...base, priority: 1, type: "send_invoice", color: T.amber,
          action: `Send invoice · ${termLabel}`, href: `/jobs/${j.id}?tab=payment`, column: "sales" });
      } else if (j.phase === "pending") {
        // Prepaid/deposit: high priority, gates production
        alerts.push({ ...base, priority: 1, type: "send_invoice", color: T.amber,
          action: "Send invoice · payment required before production", href: `/jobs/${j.id}?tab=payment`, column: "sales" });
      }
    }

    // 5b. Overdue payments — past due date, not paid
    for (const p of payments) {
      if (p.due_date && new Date(p.due_date) < now && p.status !== "paid" && p.status !== "void") {
        const days = Math.ceil((now.getTime() - new Date(p.due_date).getTime()) / 86400000);
        alerts.push({ ...base, priority: 1, type: "overdue_payment", color: T.red,
          action: `Payment ${days}d overdue${p.amount ? ` · $${Number(p.amount).toLocaleString()}` : ""}`,
          href: `/jobs/${j.id}?tab=payment`, column: "sales" });
      }
    }

    // 6. Send quote — escalate to follow-up after 2 days with no response
    if (j.phase === "intake" && !quoteApproved && items.length > 0 && costingSet && !rejectionNotes) {
      const quoteSentAt = typeMeta.quote_sent_at ? new Date(typeMeta.quote_sent_at) : null;
      const daysSinceQuoteSent = quoteSentAt ? Math.ceil((now.getTime() - quoteSentAt.getTime()) / 86400000) : 0;
      if (quoteSentAt && daysSinceQuoteSent >= 2) {
        alerts.push({ ...base, priority: 1, type: "follow_up_quote", color: T.amber,
          action: `Follow up — quote sent ${daysSinceQuoteSent}d ago, no response`,
          href: `/jobs/${j.id}?tab=quote`, column: "sales" });
      } else {
        alerts.push({ ...base, priority: 2, type: "send_quote", color: T.purple,
          action: "Send quote to client", href: `/jobs/${j.id}?tab=quote`, column: "sales" });
      }
    }

    // 7. Upload proofs / Awaiting approval (both can fire — items can be in different states)
    if (quoteApproved && !allProofsApproved) {
      const pendingItems = items.filter((it: any) => proofMap[it.id]?.pendingCount > 0);
      const itemsNeedingProofs = items.filter((it: any) => {
        const proofs = (proofFiles || []).filter(f => f.item_id === it.id && f.stage === "proof");
        return proofs.length === 0 && it.artwork_status !== "approved";
      });
      if (pendingItems.length > 0) {
        // Check if proofs have been pending 2+ days — escalate for follow-up
        const proofsSentAt = typeMeta.proofs_sent_at ? new Date(typeMeta.proofs_sent_at) : null;
        const daysSinceProofsSent = proofsSentAt ? Math.ceil((now.getTime() - proofsSentAt.getTime()) / 86400000) : 0;
        if (daysSinceProofsSent >= 2) {
          alerts.push({ ...base, priority: 1, type: "follow_up_proofs", color: T.amber,
            action: `Follow up — proofs pending ${daysSinceProofsSent}d, no response`,
            href: `/jobs/${j.id}?tab=approvals`, column: "sales" });
        } else {
          alerts.push({ ...base, priority: 2, type: "proofs_pending", color: T.muted,
            action: `Awaiting proof approval · ${pendingItems.length} item${pendingItems.length !== 1 ? "s" : ""} pending`,
            href: `/jobs/${j.id}?tab=approvals`, column: "sales" });
        }
      }
      if (itemsNeedingProofs.length > 0) {
        alerts.push({ ...base, priority: 2, type: "upload_proofs", color: T.purple,
          action: `Upload proofs · ${itemsNeedingProofs.length} item${itemsNeedingProofs.length !== 1 ? "s" : ""} need proofs`,
          href: `/jobs/${j.id}?tab=art`, column: "sales" });
      }
    }

    // ═══════════ PRODUCTION ALERTS ═══════════

    // 8. Order blanks
    if (quoteApproved && paymentGateMet && allProofsApproved) {
      const needsBlanks = apparelItems.filter((it: any) => !it.blanks_order_number);
      if (needsBlanks.length > 0) {
        alerts.push({ ...base, priority: 1, type: "order_blanks", color: T.accent,
          action: `Order blanks · ${needsBlanks.length} item${needsBlanks.length !== 1 ? "s" : ""}`,
          href: `/jobs/${j.id}?tab=blanks`, column: "production" });
      }
    }

    // 9. Send PO — fixed: fires for accessory-only (no blanks needed)
    const allBlanksHandled = apparelItems.length === 0 || apparelItems.every((it: any) => it.blanks_order_number);
    if (quoteApproved && paymentGateMet && allProofsApproved && allBlanksHandled && unsentVendors.length > 0) {
      alerts.push({ ...base, priority: 1, type: "send_po", color: T.accent,
        action: `Send PO · ${unsentVendors.join(", ")}`,
        href: `/jobs/${j.id}?tab=po`, column: "production", vendors: unsentVendors });
    }

    // 10. Stalled (7+ days) + early warning (3-6 days)
    for (const it of items) {
      if (it.pipeline_stage === "in_production" && it.pipeline_timestamps?.in_production) {
        const days = Math.ceil((now.getTime() - new Date(it.pipeline_timestamps.in_production).getTime()) / 86400000);
        if (days >= 7) {
          alerts.push({ ...base, priority: 1, type: "stalled", color: T.amber,
            action: `Stalled at decorator · ${days}d — ${it.name}`, href: `/jobs/${j.id}?tab=production`, column: "production" });
        } else if (days >= 3) {
          alerts.push({ ...base, priority: 2, type: "watch", color: T.purple,
            action: `${days}d at decorator — ${it.name}`, href: `/jobs/${j.id}?tab=production`, column: "production" });
        }
      }
    }

    // 11. Incoming to warehouse + late receiving (10+ days)
    if ((j as any).shipping_route !== "drop_ship") {
      const pendingReceive = items.filter((it: any) => it.pipeline_stage === "shipped" && !it.received_at_hpd);
      if (pendingReceive.length > 0) {
        const lateItems = pendingReceive.filter((it: any) => {
          if (!it.pipeline_timestamps?.shipped) return false;
          return Math.ceil((now.getTime() - new Date(it.pipeline_timestamps.shipped).getTime()) / 86400000) >= 10;
        });
        for (const it of lateItems) {
          const daysSince = Math.ceil((now.getTime() - new Date(it.pipeline_timestamps.shipped).getTime()) / 86400000);
          alerts.push({ ...base, priority: 1, type: "late_receiving", color: T.amber,
            action: `${it.name} shipped ${daysSince}d ago — not received`, href: `/warehouse`, column: "production" });
        }
        const onTimeCount = pendingReceive.length - lateItems.length;
        if (onTimeCount > 0) {
          alerts.push({ ...base, priority: 1, type: "receiving", color: T.green,
            action: `${onTimeCount} item${onTimeCount !== 1 ? "s" : ""} incoming to warehouse`, href: `/warehouse`, column: "production" });
        }
      }
    }

    // 12. Shipping phase — ship-through, all received, needs forwarding (NEW)
    if (j.phase === "shipping") {
      alerts.push({ ...base, priority: 1, type: "ship_to_client", color: T.amber,
        action: "Forward to client — enter outbound tracking", href: `/warehouse`, column: "production" });
    }

    // 13. Fulfillment phase — stage route, all received, packing/shipping (NEW)
    if (j.phase === "fulfillment") {
      const fStatus = (j as any).fulfillment_status || "staged";
      const label = fStatus === "staged" ? "Pack & ship — items received" : fStatus === "packing" ? "Packing in progress" : "Ready to ship";
      alerts.push({ ...base, priority: 1, type: "fulfillment", color: T.amber,
        action: `Fulfillment — ${label}`, href: `/warehouse`, column: "production" });
    }

    // 14. Ships soon (0-3 days) — proactive deadline warning
    if (j.target_ship_date) {
      const daysToShip = Math.ceil((new Date(j.target_ship_date).getTime() - now.getTime()) / 86400000);
      if (daysToShip >= 0 && daysToShip <= 3) {
        alerts.push({ ...base, priority: 2, type: "shipping_soon", color: T.amber,
          action: `Ships in ${daysToShip}d — verify status`, href: `/jobs/${j.id}`, column: "production" });
      }
    }

    // 15. No ship date set — projects past intake with no deadline
    if (!j.target_ship_date && j.phase !== "intake" && items.length > 0) {
      alerts.push({ ...base, priority: 2, type: "no_ship_date", color: T.muted,
        action: "No ship date set", href: `/jobs/${j.id}`, column: "production" });
    }
  }

  // Sort: critical first, then high, then medium
  alerts.sort((a, b) => a.priority - b.priority);

  const stats = {
    active: activeJobs.length,
    sales: alerts.filter(a => a.column === "sales").length,
    production: alerts.filter(a => a.column === "production").length,
    shippingThisWeek: activeJobs.filter(j => {
      if (!j.target_ship_date) return false;
      const d = Math.ceil((new Date(j.target_ship_date).getTime() - now.getTime()) / 86400000);
      return d >= -1 && d <= 7;
    }).length,
  };

  return <CommandCenter alerts={alerts} stats={stats} />;
}
