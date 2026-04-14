import { createClient } from "@/lib/supabase/server";
import { T, font, mono } from "@/lib/theme";
import { CommandCenter } from "@/components/CommandCenter";

export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

  // ── Data Loading ──
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), quote_approved, quote_approved_at, type_meta, costing_data, costing_summary, payment_terms, shipping_route, fulfillment_status, quote_rejection_notes, items(id, name, pipeline_stage, blanks_order_number, ship_tracking, artwork_status, garment_type, received_at_hpd, pipeline_timestamps, buy_sheet_lines(qty_ordered), decorator_assignments(decorators(name, short_code)))")
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

  // ── New clients without jobs (from onboard form) ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: newClients } = await supabase
    .from("clients")
    .select("id, name, created_at, notes")
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false });

  // Filter to clients with no jobs
  const clientIdsWithJobs = new Set((jobs || []).map(j => j.client_id).filter(Boolean));
  const { data: allJobClients } = await supabase.from("jobs").select("client_id").not("client_id", "is", null);
  for (const jc of (allJobClients || [])) { if (jc.client_id) clientIdsWithJobs.add(jc.client_id); }
  const newClientsNoJobs = (newClients || []).filter(c => !clientIdsWithJobs.has(c.id));

  // ── Generate Alerts ──
  const activeJobs = jobs || [];
  const alerts: any[] = [];

  // New client onboarded — needs project created
  for (const c of newClientsNoJobs) {
    alerts.push({
      priority: 1, type: "new_client", color: T.blue,
      action: `New client — create project`,
      jobId: "", jobTitle: "", clientName: c.name, invoiceNumber: null,
      jobNumber: "", shipDate: null, contacts: [],
      href: `/clients/${c.id}`, column: "sales",
    });
  }

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

    // ═══════════ BILLING ALERTS ═══════════

    // 4. Create invoice — timing depends on payment terms
    const isNet = terms === "net_15" || terms === "net_30";
    if (quoteApproved && !invoiceNum) {
      if (isNet) {
        const hasShippedItems = items.some((it: any) => it.pipeline_stage === "shipped" || it.ship_tracking);
        const isShippingPhase = j.phase === "shipping" || j.phase === "fulfillment" || j.phase === "receiving";
        if (hasShippedItems || isShippingPhase) {
          alerts.push({ ...base, priority: 1, type: "create_invoice", color: T.amber,
            action: "Create invoice · order shipped, invoice on actual quantities",
            href: `/jobs/${j.id}?tab=proofs`, column: "billing" });
        }
      } else {
        alerts.push({ ...base, priority: 1, type: "create_invoice", color: T.amber,
          action: "Create invoice", href: `/jobs/${j.id}?tab=proofs`, column: "billing" });
      }
    }

    // 5. Send invoice / follow up
    if (quoteApproved && invoiceNum && payments.length === 0) {
      const invoiceSentAt = typeMeta.invoice_sent_at ? new Date(typeMeta.invoice_sent_at) : null;
      const daysSinceInvoiceSent = invoiceSentAt ? Math.ceil((now.getTime() - invoiceSentAt.getTime()) / 86400000) : 0;
      if (invoiceSentAt && daysSinceInvoiceSent >= 2) {
        // Net terms: only follow up when due date is ≤1 day away
        if (isNet) {
          const earliestDue = payments.filter((p: any) => p.due_date).map((p: any) => new Date(p.due_date).getTime()).sort()[0];
          const daysToDue = earliestDue ? Math.ceil((earliestDue - now.getTime()) / 86400000) : null;
          if (daysToDue !== null && daysToDue <= 1) {
            alerts.push({ ...base, priority: 1, type: "follow_up_payment", color: T.amber,
              action: `Payment due ${daysToDue <= 0 ? "today" : "tomorrow"} — follow up`,
              href: `/jobs/${j.id}?tab=proofs`, column: "billing" });
          }
        } else {
          // Prepaid/deposit: follow up after 2 days
          alerts.push({ ...base, priority: 1, type: "follow_up_payment", color: T.amber,
            action: `Follow up — invoice sent ${daysSinceInvoiceSent}d ago, no payment`,
            href: `/jobs/${j.id}?tab=proofs`, column: "billing" });
        }
      } else if (!invoiceSentAt) {
        const proofsNeeded = !allProofsApproved;
        if (isNet) {
          const termLabel = terms === "net_15" ? "net 15" : "net 30";
          alerts.push({ ...base, priority: 1, type: "send_invoice", color: T.amber,
            action: proofsNeeded ? `Send proofs & invoice · ${termLabel}` : `Send invoice · ${termLabel}`,
            href: `/jobs/${j.id}?tab=proofs`, column: "billing" });
        } else if (j.phase === "pending") {
          alerts.push({ ...base, priority: 1, type: "send_invoice", color: T.amber,
            action: proofsNeeded ? "Send proofs & invoice · payment required" : "Send invoice · payment required",
            href: `/jobs/${j.id}?tab=proofs`, column: "billing" });
        }
      }
    }

    // 5b. Overdue payments — past due date, not paid
    for (const p of payments) {
      if (p.due_date && new Date(p.due_date) < now && p.status !== "paid" && p.status !== "void") {
        const days = Math.ceil((now.getTime() - new Date(p.due_date).getTime()) / 86400000);
        alerts.push({ ...base, priority: 1, type: "overdue_payment", color: T.red,
          action: `Payment ${days}d overdue${p.amount ? ` · $${Number(p.amount).toLocaleString()}` : ""}`,
          href: `/jobs/${j.id}?tab=proofs`, column: "billing" });
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
      } else if (!quoteSentAt) {
        // Only show "send quote" if it hasn't been sent yet
        alerts.push({ ...base, priority: 2, type: "send_quote", color: T.purple,
          action: "Send quote to client", href: `/jobs/${j.id}?tab=quote`, column: "sales" });
      }
      // If sent < 2 days ago: no alert — give client time to respond
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
            href: `/jobs/${j.id}?tab=proofs`, column: "sales" });
        } else {
          alerts.push({ ...base, priority: 2, type: "proofs_pending", color: T.muted,
            action: `Awaiting proof approval · ${pendingItems.length} item${pendingItems.length !== 1 ? "s" : ""} pending`,
            href: `/jobs/${j.id}?tab=proofs`, column: "sales" });
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

    // 14. Ships soon — use earliest vendor ship date, fall back to in-hands date
    {
      const poShipDates = Object.values((j as any).type_meta?.po_ship_dates || {}).filter(Boolean) as string[];
      const earliestShipDate = poShipDates.length > 0 ? poShipDates.sort()[0] : j.target_ship_date;
      if (earliestShipDate && !["receiving","shipping","fulfillment","complete","cancelled"].includes(j.phase)) {
        const daysToShip = Math.ceil((new Date(earliestShipDate).getTime() - now.getTime()) / 86400000);
        if (daysToShip >= 0 && daysToShip <= 3) {
          alerts.push({ ...base, priority: 2, type: "shipping_soon", color: T.amber,
            action: `Ships in ${daysToShip}d — verify status`, href: `/jobs/${j.id}`, column: "production" });
        }
      }
    }

    // 15. No ship date set — removed, not mandatory
  }

  // Sort: critical first, then high, then medium
  alerts.sort((a, b) => a.priority - b.priority);

  const allItems = activeJobs.flatMap(j => j.items || []);
  const totalUnits = allItems.reduce((a: number, it: any) => a + (it.buy_sheet_lines || []).reduce((b: number, l: any) => b + (l.qty_ordered || 0), 0), 0);

  // Total prints: (active print locations + tag) × qty per item
  const totalPrints = activeJobs.reduce((total: number, j: any) => {
    const costProds = (j.costing_data?.costProds || []);
    for (const cp of costProds) {
      const qty = cp.totalQty || 0;
      if (qty === 0) continue;
      const activeLocs = [1,2,3,4,5,6].filter(loc => {
        const ld = cp.printLocations?.[loc];
        return ld?.screens > 0 || ld?.location;
      }).length;
      const hasTag = cp.tagPrint ? 1 : 0;
      // Non-garment with custom costs = 1 decoration
      const NON_GARMENT = ["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"];
      const decoCount = NON_GARMENT.includes(cp.garment_type) ? (cp.customCosts?.length > 0 ? 1 : 0) : activeLocs + hasTag;
      total += decoCount * qty;
    }
    return total;
  }, 0);

  // Summary counts for production team
  const needsBlanks = activeJobs.filter(j => {
    const qa = (j as any).quote_approved;
    const items = j.items || [];
    const payments = paymentsByJob[j.id] || [];
    const terms = j.payment_terms || "";
    const paymentMet = terms === "net_15" || terms === "net_30" || payments.some((p: any) => p.status === "paid" || p.status === "partial");
    const allProofs = items.length > 0 && items.every((it: any) => proofMap[it.id]?.allApproved || it.artwork_status === "approved");
    const apparel = items.filter((it: any) => it.garment_type !== "accessory");
    const blanksOrdered = apparel.filter((it: any) => it.blanks_order_number).length;
    return qa && paymentMet && allProofs && apparel.length > 0 && blanksOrdered < apparel.length;
  }).length;

  const needsPO = activeJobs.filter(j => {
    const typeMeta = (j.type_meta || {}) as any;
    const poSent = typeMeta.po_sent_vendors || [];
    const costProds = ((j as any).costing_data?.costProds || []);
    const vendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))] as string[];
    return vendors.length > 0 && vendors.some((v: string) => !poSent.includes(v));
  }).length;

  const needsProofs = activeJobs.filter(j => {
    const items = j.items || [];
    return items.some((it: any) => proofMap[it.id]?.pendingCount > 0);
  }).length;

  const atDecorator = allItems.filter((it: any) => it.pipeline_stage === "in_production").length;
  const shipped = allItems.filter((it: any) => it.pipeline_stage === "shipped" && !it.received_at_hpd).length;
  const stalled = allItems.filter((it: any) => {
    if (it.pipeline_stage !== "in_production") return false;
    const ts = it.pipeline_timestamps?.in_production;
    if (!ts) return false;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) >= 7;
  }).length;

  const awaitingClient = activeJobs.filter(j => {
    const qa = (j as any).quote_approved;
    const items = j.items || [];
    const payments = paymentsByJob[j.id] || [];
    const terms = j.payment_terms || "";
    const paymentMet = terms === "net_15" || terms === "net_30" || payments.some((p: any) => p.status === "paid" || p.status === "partial");
    const allProofs = items.length > 0 && items.every((it: any) => proofMap[it.id]?.allApproved || it.artwork_status === "approved");
    return !qa || !paymentMet || !allProofs;
  }).length;

  // Decorator breakdown
  const decoratorCounts: Record<string, number> = {};
  for (const it of allItems) {
    if (it.pipeline_stage === "in_production" || it.pipeline_stage === "shipped") {
      const da = (it as any).decorator_assignments?.[0]?.decorators;
      const vendor = da?.short_code || da?.name || "Unassigned";
      decoratorCounts[vendor] = (decoratorCounts[vendor] || 0) + 1;
    }
  }

  const stats = {
    active: activeJobs.length,
    items: allItems.length,
    units: totalUnits,
    prints: totalPrints,
    sales: alerts.filter(a => a.column === "sales").length,
    production: alerts.filter(a => a.column === "production").length,
    billing: alerts.filter(a => a.column === "billing").length,
    shippingThisWeek: activeJobs.filter(j => {
      if (!j.target_ship_date) return false;
      const d = Math.ceil((new Date(j.target_ship_date).getTime() - now.getTime()) / 86400000);
      return d >= -1 && d <= 7;
    }).length,
    needsBlanks,
    needsPO,
    needsProofs,
    atDecorator,
    shipped,
    stalled,
    awaitingClient,
    decoratorCounts,
  };

  return <CommandCenter alerts={alerts} stats={stats} />;
}
