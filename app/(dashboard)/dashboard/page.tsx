import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/theme";
import { CommandCenterBuckets, type BucketCard, type BucketPayload, type BucketSection, type Urgency } from "@/components/CommandCenterBuckets";
import { attachUnreadStatus } from "@/lib/art-brief-activity";
import { daysUntilDay } from "@/lib/dates";

export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

  // Read team-wide messenger state from the active tenant's branding
  // JSONB. last_dashboard_seen_at drives "auto-read" of new external
  // events on dashboard open; dashboard_unread_overrides forces
  // specific cards back to unread regardless (Jon → Drake/Taylor pings).
  const { data: companiesRow } = await supabase.from("companies").select("id, branding").limit(1);
  const companyId: string | null = ((companiesRow || [])[0] as any)?.id || null;
  const branding = ((companiesRow || [])[0] as any)?.branding || {};
  const lastSeen: string = branding.last_dashboard_seen_at || "1970-01-01T00:00:00.000Z";
  const unreadOverrides: string[] = Array.isArray(branding.dashboard_unread_overrides)
    ? branding.dashboard_unread_overrides : [];
  const overrideSet = new Set(unreadOverrides);
  // Decide read state for a given card. Defaults to read; flips to
  // unread when the underlying event is newer than lastSeen OR when
  // the card was explicitly flagged. Server-side so the result is
  // identical for every team member.
  const computeRead = (cardId: string, eventAt?: string | null): boolean => {
    if (overrideSet.has(cardId)) return false;
    if (eventAt && eventAt > lastSeen) return false;
    return true;
  };

  // ── Data Loading ──
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), quote_approved, quote_approved_at, type_meta, costing_data, costing_summary, payment_terms, shipping_route, fulfillment_status, quote_rejection_notes, items(id, name, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, artwork_status, garment_type, received_at_hpd, pipeline_timestamps, buy_sheet_lines(qty_ordered), decorator_assignments(decorators(name, short_code)))")
    .not("phase", "in", '("complete","cancelled","on_hold")')
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const { data: allPayments } = await supabase
    .from("payment_records")
    .select("*, jobs!inner(id)")
    .order("created_at");

  const allItemIds = (jobs || []).flatMap(j => (j.items || []).map((it: any) => it.id));
  const { data: proofFiles } = allItemIds.length > 0
    ? await supabase.from("item_files").select("item_id, stage, approval, notes, created_at, revision_pending_send").in("item_id", allItemIds).in("stage", ["proof", "mockup"]).is("superseded_at", null)
    : { data: [] };

  // Load contacts for email modals
  const jobIds = (jobs || []).map(j => j.id);
  const { data: jobContacts } = jobIds.length > 0
    ? await supabase.from("job_contacts").select("job_id, role_on_job, contacts(name, email)").in("job_id", jobIds)
    : { data: [] };

  // ── Proof status map ──
  const proofMap: Record<string, { allApproved: boolean; hasRevision: boolean; revisionPendingSend: boolean; pendingCount: number; revisionNotes: string | null; revisionAt: string | null }> = {};
  for (const id of allItemIds) {
    const proofs = (proofFiles || []).filter(f => f.item_id === id && f.stage === "proof");
    const rev = proofs.find(f => f.approval === "revision_requested");
    proofMap[id] = {
      allApproved: proofs.length > 0 && proofs.every(f => f.approval === "approved"),
      hasRevision: proofs.some(f => f.approval === "revision_requested"),
      revisionPendingSend: proofs.some(f => (f as any).revision_pending_send),
      pendingCount: proofs.filter(f => f.approval === "pending").length,
      revisionNotes: rev?.notes || null,
      revisionAt: rev?.created_at || null,
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
      event_at: c.created_at,
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
    // Match BlanksTab + ProjectProgress + lifecycle: only real garments
    // count toward blanks alerts. Patches/stickers/totes/etc. are
    // priced via custom-cost lines and don't have a blanks order.
    const NON_GARMENT_TYPES = new Set(["accessory","patch","sticker","poster","pin","koozie","banner","flag","lighter","towel","water_bottle","samples","custom","key_chain","woven_labels","bandana","socks","tote","custom_bag","pillow","rug","pens","napkins","balloons","stencils"]);
    const apparelItems = items.filter((it: any) => !NON_GARMENT_TYPES.has(it.garment_type));

    const base = {
      jobId: j.id, jobTitle: j.title, clientName, invoiceNumber: invoiceNum,
      jobNumber: jobNum, shipDate: j.target_ship_date, contacts,
    };

    // ═══════════ SALES ALERTS ═══════════

    // 1. Overdue — only for pre-fulfillment phases (handoff-to-warehouse = no longer Labs concern)
    if (j.target_ship_date && (daysUntilDay(j.target_ship_date) ?? 1) < 0) {
      const postProduction = j.phase === "fulfillment" || j.phase === "shipping" || j.phase === "receiving";
      if (!postProduction) {
        const days = Math.abs(daysUntilDay(j.target_ship_date) ?? 0);
        alerts.push({ ...base, priority: 0, type: "overdue", color: T.red,
          action: `${days} days past ship date`,
          href: `/jobs/${j.id}`, column: "sales" });
      }
    }

    // 2. Quote rejected — client submitted notes (NEW)
    if (rejectionNotes && !quoteApproved) {
      alerts.push({ ...base, priority: 0, type: "quote_rejected", color: T.red,
        action: "Quote rejected — review client notes", notes: rejectionNotes,
        href: `/jobs/${j.id}?tab=quote`, column: "sales",
        event_at: (j as any).updated_at });
    }

    // 3. Proof revision requested — with client notes
    for (const it of items) {
      if (proofMap[it.id]?.hasRevision) {
        alerts.push({ ...base, priority: 0, type: "revision", color: T.red,
          action: `Proof revision requested — ${it.name}`, notes: proofMap[it.id]?.revisionNotes || null,
          href: `/jobs/${j.id}?tab=proofs`, column: "sales",
          // Used by the Command Center to open a per-revision modal with
          // mockup thumbnail + client message.
          itemId: it.id, itemName: it.name,
          event_at: proofMap[it.id]?.revisionAt || (j as any).updated_at,
        });
      }
    }

    // 3b. Revised proof re-uploaded but NOT yet re-sent to the client.
    for (const it of items) {
      if (proofMap[it.id]?.revisionPendingSend) {
        alerts.push({ ...base, priority: 0, type: "revision_send", color: T.amber,
          action: `Revised proof ready to send — ${it.name}`,
          href: `/jobs/${j.id}?tab=proofs`, column: "sales",
          itemId: it.id, itemName: it.name,
          event_at: (j as any).updated_at,
        });
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
    // QB push now opens a "sent" payment_records row up-front, so the
    // legacy `payments.length === 0` gate was too tight — it suppressed
    // the pre-due nag once that row existed. Switch to "no PAID record
    // yet" so the block fires whenever there's still money to collect.
    if (quoteApproved && invoiceNum && !hasPaidPayment) {
      const invoiceSentAt = typeMeta.invoice_sent_at ? new Date(typeMeta.invoice_sent_at) : null;
      const daysSinceInvoiceSent = invoiceSentAt ? Math.ceil((now.getTime() - invoiceSentAt.getTime()) / 86400000) : 0;
      if (invoiceSentAt && daysSinceInvoiceSent >= 2) {
        // Net terms: only follow up when due date is ≤1 day away
        if (isNet) {
          // due_date is date-only — sort the ISO strings (lexicographic = chronological)
          // and count calendar days; the old epoch math flagged "due" a day early.
          const earliestDue = payments.filter((p: any) => p.due_date).map((p: any) => p.due_date as string).sort()[0];
          const daysToDue = earliestDue ? daysUntilDay(earliestDue) : null;
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
      if (p.due_date && (daysUntilDay(p.due_date) ?? 1) < 0 && p.status !== "paid" && p.status !== "void") {
        const days = Math.abs(daysUntilDay(p.due_date) ?? 0);
        alerts.push({ ...base, priority: 1, type: "overdue_payment", color: T.red,
          paymentId: p.id,
          action: `Payment ${days}d overdue${p.amount ? ` · $${Number(p.amount).toLocaleString()}` : ""}`,
          href: `/jobs/${j.id}?tab=proofs`, column: "billing" });
      }
    }

    // 5c. Payment received — surfaces every paid invoice on the Clients
    // bucket until POs are sent (the cue that the team has acted on the
    // payment by moving the job into production). Adds a "Proofs not
    // approved" badge when relevant so the team doesn't ship into a
    // proof-gate violation.
    if (hasPaidPayment && unsentVendors.length > 0) {
      const paidPays = payments.filter((p: any) => p.status === "paid" || p.status === "partial");
      const paidSum = paidPays.reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
      const latestPaidDate = paidPays
        .map((p: any) => p.paid_date || p.created_at)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || null;
      alerts.push({
        ...base,
        priority: 1,
        type: "payment_received",
        color: T.green,
        action: `Payment received · $${paidSum.toLocaleString()}`,
        badge: !allProofsApproved ? "Proofs not approved" : undefined,
        href: `/jobs/${j.id}?tab=po`,
        column: "sales",
        event_at: latestPaidDate,
      });
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
    // Phase-gated to pending/intake only — once the job has advanced
    // to ready or beyond, the proof gate is closed (lifecycle either
    // approved them or accepted the manual artwork_status override).
    // Continuing to nag past that point is stale noise.
    const proofPhase = j.phase === "intake" || j.phase === "pending";
    if (proofPhase && quoteApproved && !allProofsApproved) {
      // Exclude items with manual override (artwork_status='approved') — they
      // don't need client approval even if the underlying proof is pending.
      const pendingItems = items.filter((it: any) => proofMap[it.id]?.pendingCount > 0 && it.artwork_status !== "approved");
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
            href: `/jobs/${j.id}?tab=proofs`, column: "sales",
            event_at: proofsSentAt ? proofsSentAt.toISOString() : null });
        } else {
          alerts.push({ ...base, priority: 2, type: "proofs_pending", color: T.muted,
            action: `Awaiting proof approval · ${pendingItems.length} item${pendingItems.length !== 1 ? "s" : ""} pending`,
            href: `/jobs/${j.id}?tab=proofs`, column: "sales",
            event_at: proofsSentAt ? proofsSentAt.toISOString() : null });
        }
      }
      if (itemsNeedingProofs.length > 0) {
        alerts.push({ ...base, priority: 2, type: "upload_proofs", color: T.purple,
          action: `Upload proofs · ${itemsNeedingProofs.length} item${itemsNeedingProofs.length !== 1 ? "s" : ""} need proofs`,
          href: `/jobs/${j.id}?tab=art`, column: "sales" });
      }
    }

    // ═══════════ PRODUCTION ALERTS ═══════════

    // 8. Order blanks. Only fires while the job is in the ready phase —
    // once it's moved to production / receiving / fulfillment, blanks
    // are obviously ordered and this alert is just stale noise.
    if (j.phase === "ready" && quoteApproved && paymentGateMet && allProofsApproved) {
      const needsBlanks = apparelItems.filter((it: any) => it.blanks_order_cost == null);
      if (needsBlanks.length > 0) {
        alerts.push({ ...base, priority: 1, type: "order_blanks", color: T.accent,
          action: `Order blanks · ${needsBlanks.length} item${needsBlanks.length !== 1 ? "s" : ""}`,
          href: `/jobs/${j.id}?tab=blanks`, column: "production" });
      }
    }

    // 9. Send PO — same phase gate as order_blanks.
    const allBlanksHandled = apparelItems.length === 0 || apparelItems.every((it: any) => it.blanks_order_cost != null);
    if (j.phase === "ready" && quoteApproved && paymentGateMet && allProofsApproved && allBlanksHandled && unsentVendors.length > 0) {
      alerts.push({ ...base, priority: 1, type: "send_po", color: T.accent,
        action: `Send PO · ${unsentVendors.join(", ")}`,
        href: `/jobs/${j.id}?tab=po`, column: "production", vendors: unsentVendors });
    }

    // "Stalled at decorator" alerts removed per Jon — only "Ships in Xd" alerts
    // (alert #14 below) fire for the Production column now.

    // Warehouse/fulfillment alerts (incoming, ship-through forwarding, pack & ship)
    // live on the Distro dashboard, not here — Labs stops at handoff from decorator.

    // 14. Ships soon — use earliest vendor ship date, fall back to in-hands date
    {
      const poShipDates = Object.values((j as any).type_meta?.po_ship_dates || {}).filter(Boolean) as string[];
      const hasAsap = poShipDates.includes("ASAP");
      const calendarDates = poShipDates.filter(d => d !== "ASAP");
      const earliestShipDate = hasAsap ? "ASAP" : (calendarDates.length > 0 ? calendarDates.sort()[0] : j.target_ship_date);
      if (earliestShipDate && !["receiving","shipping","fulfillment","complete","cancelled"].includes(j.phase)) {
        if (earliestShipDate === "ASAP") {
          alerts.push({ ...base, priority: 2, type: "shipping_soon", color: T.amber,
            action: `Ships ASAP — verify status`, href: `/jobs/${j.id}`, column: "production" });
        } else {
          const daysToShip = daysUntilDay(earliestShipDate) ?? 99;
          if (daysToShip >= 0 && daysToShip <= 3) {
            alerts.push({ ...base, priority: 2, type: "shipping_soon", color: T.amber,
              action: `Ships in ${daysToShip}d — verify status`, href: `/jobs/${j.id}`, column: "production" });
          }
        }
      }
    }

    // 15. No ship date set — removed, not mandatory
  }

  // ── Open vendor discrepancies ──
  // Pulled from decorator_assignments where the vendor flagged an issue
  // that hasn't been resolved yet. Surfaces in the Decorators bucket so
  // the team can address before it becomes a shipping problem.
  const { data: openDiscrepancies } = await supabase
    .from("decorator_assignments")
    .select("item_id, decorator_id, last_issue_note, last_issue_at, items(id, name, job_id, jobs(id, title, job_number, type_meta, clients(name))), decorators(name, short_code)")
    .not("last_issue_at", "is", null)
    .is("issue_resolved_at", null);
  for (const d of (openDiscrepancies || []) as any[]) {
    const item = d.items;
    const job = item?.jobs;
    if (!item || !job) continue;
    const clientName = job.clients?.name || "";
    const decoratorName = d.decorators?.name || d.decorators?.short_code || "Vendor";
    const invNum = (job.type_meta as any)?.qb_invoice_number || null;
    alerts.push({
      priority: 0,
      type: "vendor_discrepancy",
      color: T.red,
      action: `${decoratorName} flagged ${item.name}: "${(d.last_issue_note || "").slice(0, 80)}${(d.last_issue_note || "").length > 80 ? "…" : ""}"`,
      jobId: job.id,
      jobNumber: job.job_number,
      jobTitle: job.title,
      clientName,
      invoiceNumber: invNum,
      href: `/jobs/${job.id}?tab=po`,
      column: "production",
      event_at: (d as any).last_issue_at,
      // Resolve metadata — surfaces the ✓ Resolve button on the card
      // and tells the client component which (item, decorator) row to
      // mark resolved on decorator_assignments.
      resolveItemId: item.id,
      resolveDecoratorId: d.decorator_id,
    });
  }

  // Sort: critical first, then high, then medium
  alerts.sort((a, b) => a.priority - b.priority);

  // ── Designer-side action queue from art_briefs ──
  // Briefs that need HPD's move (wip_review, pending_prep,
  // production_ready) plus a count of in-flight work with the
  // designer (sent / in_progress / revisions / final_approved). Active
  // only — aborted briefs are filtered out via client_aborted_at, the
  // delivered ones are simply not "active" for the team.
  //
  // We also pull client_review briefs so the Unread detector below can
  // surface client comments on in-flight proofs. Without unread,
  // client_review still drops out at the section-mapping step (one
  // card per brief drowned the column on big jobs — see SECTION_ORDER).
  // hpd_last_seen_at + state included to feed attachUnreadStatus.
  // Include draft state so client-submitted intake briefs (source=client,
  // has_unread_external=true) surface in the Unread section. The state-
  // based mapping below has no entry for "draft" — silent drafts still
  // drop out via the "no map → continue" path, so only unread drafts
  // render. Matches the badge counter, which also includes drafts.
  const { data: briefs } = await supabase
    .from("art_briefs")
    .select("id, title, state, source, updated_at, sent_to_designer_at, client_aborted_at, hpd_last_seen_at, job_id, clients(name), jobs(job_number)")
    .is("client_aborted_at", null)
    .not("state", "in", "(killed,shelved)")
    .order("updated_at", { ascending: false });
  const briefsWithUnread = await attachUnreadStatus(briefs || [], supabase);

  // ── Build bucket payload ──
  const priorityToUrgency = (p: number): Urgency =>
    p === 0 ? "critical" : p === 1 ? "action" : p === 2 ? "watch" : "ok";

  // Mapping from alert.type → which section it belongs to within the
  // Clients / Decorators bucket. Anything not here is dropped (billing
  // types live on /billing, not the team dashboard).
  const SECTION_BY_TYPE: Record<string, { bucket: "clients" | "decorators"; section: string }> = {
    payment_received:  { bucket: "clients",    section: "Payments" },
    overdue:           { bucket: "clients",    section: "Past ship date" },
    quote_rejected:    { bucket: "clients",    section: "Quote feedback" },
    revision:          { bucket: "clients",    section: "Proof revisions" },
    new_client:        { bucket: "clients",    section: "New leads" },
    follow_up_proofs:  { bucket: "clients",    section: "Awaiting client" },
    proofs_pending:    { bucket: "clients",    section: "Awaiting client" },
    follow_up_quote:   { bucket: "clients",    section: "Awaiting client" },
    send_quote:        { bucket: "clients",    section: "Send to client" },
    upload_proofs:     { bucket: "clients",    section: "Send to client" },
    order_blanks:      { bucket: "decorators", section: "Order blanks" },
    send_po:           { bucket: "decorators", section: "Send PO" },
    shipping_soon:     { bucket: "decorators", section: "Verify shipping" },
    vendor_discrepancy:{ bucket: "decorators", section: "Discrepancies" },
  };

  // Order in which sections appear inside each bucket — Payments lands
  // at the top so cash-in surfaces draw the eye first.
  const SECTION_ORDER: Record<string, string[]> = {
    clients:    ["Payments", "Past ship date", "Quote feedback", "Proof revisions", "New leads", "Send to client", "Awaiting client"],
    decorators: ["Discrepancies", "Send PO", "Order blanks", "Verify shipping"],
    designers:  ["Unread", "Awaiting HPD review", "Prep print-ready", "Mark delivered", "In design"],
  };

  type Grouped = Record<string, Record<string, BucketCard[]>>;
  const grouped: Grouped = { clients: {}, decorators: {}, designers: {} };

  function pushCard(bucket: keyof Grouped, section: string, card: BucketCard) {
    if (!grouped[bucket][section]) grouped[bucket][section] = [];
    grouped[bucket][section].push(card);
  }

  // Stable card ID generator. The previous version sliced 30 chars of
  // a.action into the id, which broke override persistence — actions
  // include day counters ("4d ago"), running dollar totals, vendor
  // lists, etc. that shift between renders. Switch to a logical key:
  // type + jobId/clientName, plus a disambiguator for the few types
  // that legitimately have multiples per job (revision per item,
  // vendor flag per assignment, overdue per payment row).
  const cardIdFor = (a: any): string => {
    if (a.type === "revision" && a.itemId) return `alert-revision-${a.itemId}`;
    if (a.type === "vendor_discrepancy" && a.resolveItemId && a.resolveDecoratorId) {
      return `alert-vendor_discrepancy-${a.resolveItemId}-${a.resolveDecoratorId}`;
    }
    if (a.type === "overdue_payment" && a.paymentId) return `alert-overdue_payment-${a.paymentId}`;
    if (a.type === "new_client") return `alert-new_client-${a.clientName}`;
    return `alert-${a.type}-${a.jobId || a.clientName}`;
  };

  // Convert job-level alerts into cards. Invoice number takes priority
  // over the OpsHub job number when present — it's the reference the
  // client recognizes, and the team chases payments by it.
  for (const a of alerts) {
    const map = SECTION_BY_TYPE[a.type];
    if (!map) continue; // billing + anything we don't surface drops here
    const titleParts = [a.clientName, a.jobTitle].filter(Boolean);
    const metaKind: "invoice" | "job" | undefined = a.invoiceNumber ? "invoice" : a.jobNumber ? "job" : undefined;
    const cardId = cardIdFor(a);
    pushCard(map.bucket, map.section, {
      id: cardId,
      title: titleParts.join(" — ") || a.action,
      subtitle: a.action,
      meta: a.invoiceNumber || a.jobNumber || undefined,
      metaKind,
      badge: a.badge || undefined,
      urgency: priorityToUrgency(a.priority),
      href: a.href,
      read: computeRead(cardId, a.event_at),
      // Revision cards open a per-revision preview modal instead of a navigation
      revision: a.type === "revision" && a.itemId && a.jobId ? {
        jobId: a.jobId,
        itemId: a.itemId,
        itemName: a.itemName || a.action,
        notes: a.notes || null,
        href: a.href,
      } : undefined,
      // Vendor discrepancy cards get a server-side resolve action
      resolve: a.type === "vendor_discrepancy" && a.resolveItemId && a.resolveDecoratorId ? {
        kind: "vendor_discrepancy" as const,
        itemId: a.resolveItemId,
        decoratorId: a.resolveDecoratorId,
      } : undefined,
    });
  }

  // Designer-side cards from art_briefs.
  const briefRows = briefsWithUnread as any[];
  // FIVE-STATE model (mig 159): a brief state alone is never a team
  // call-to-action — working is the default hum, with_client is the client's
  // move, approved is the bank. Only UNREAD activity surfaces cards (below).
  const stateToSection: Record<string, { section: string; urgency: Urgency; subtitlePrefix: string }> = {};

  // "X ago" for unread subtitles. Coarse — minute / hour / day buckets
  // are enough for an at-a-glance command center; longer-form lives
  // inside Art Studio itself.
  function unreadAgo(iso: string | null): string {
    if (!iso) return "";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return "just now";
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1w ago" : `${weeks}w ago`;
  }

  for (const b of briefRows) {
    const clientName = (b.clients as any)?.name || "";
    const briefTitle = b.title || "Untitled brief";
    const jobNumber = (b.jobs as any)?.job_number || null;
    const title = clientName ? `${clientName} — ${briefTitle}` : briefTitle;

    // Unread wins. If a client or designer has activity newer than
    // HPD's last view, render a single "Unread" card and skip the
    // state-based mapping — otherwise the brief would appear twice
    // (once as Unread, once as e.g. "In design"). This is also the
    // only path that surfaces client_review briefs on the dashboard.
    if (b.has_unread_external) {
      const who = b.unread_by_role === "client" ? "Client" : "Designer";
      const cardId = `brief-unread-${b.id}`;
      pushCard("designers", "Unread", {
        id: cardId,
        title,
        subtitle: `${who} commented · ${unreadAgo(b.unread_at)}`,
        meta: jobNumber || undefined,
        metaKind: jobNumber ? "job" : undefined,
        urgency: "action",
        href: `/art-studio?brief=${b.id}`,
        read: computeRead(cardId, b.unread_at),
      });
      continue;
    }

    const map = stateToSection[b.state];
    if (!map) continue;
    const cardId = `brief-${b.id}`;
    const card: BucketCard = {
      id: cardId,
      title,
      subtitle: map.subtitlePrefix,
      meta: jobNumber || undefined,
      metaKind: jobNumber ? "job" : undefined,
      urgency: map.urgency,
      href: `/art-studio?brief=${b.id}`,
      read: computeRead(cardId, b.updated_at),
    };
    // client_review briefs land under Clients (it's a client-side conversation),
    // others under Designers.
    const bucket = b.state === "with_client" ? "clients" : "designers";
    pushCard(bucket, map.section, card);
  }

  // Materialize buckets in display order, dropping empty sections.
  const buckets: BucketPayload[] = [
    {
      key: "clients",
      label: "Clients",
      hint: bucketHint("clients", grouped.clients),
      sections: orderSections("clients", grouped.clients),
    },
    {
      key: "decorators",
      label: "Decorators",
      hint: bucketHint("decorators", grouped.decorators),
      sections: orderSections("decorators", grouped.decorators),
    },
    {
      key: "designers",
      label: "Designers",
      hint: bucketHint("designers", grouped.designers),
      sections: orderSections("designers", grouped.designers),
    },
  ];

  function orderSections(bucket: string, group: Record<string, BucketCard[]>): BucketSection[] {
    const order = SECTION_ORDER[bucket] || [];
    const known = order
      .filter(name => group[name] && group[name].length > 0)
      .map(name => ({ title: name, cards: group[name] }));
    // Any unanticipated sections (shouldn't happen with current mapping, but
    // safe net) appear at the end in insertion order.
    const extras = Object.keys(group)
      .filter(name => !order.includes(name) && group[name].length > 0)
      .map(name => ({ title: name, cards: group[name] }));
    return [...known, ...extras];
  }

  function bucketHint(bucket: string, group: Record<string, BucketCard[]>): string {
    const order = SECTION_ORDER[bucket] || [];
    const parts: string[] = [];
    for (const name of order) {
      const n = group[name]?.length || 0;
      if (n === 0) continue;
      parts.push(`${n} ${name.toLowerCase()}`);
    }
    return parts.join(" · ") || "All clear";
  }

  // Prune stale unread overrides — anything in the team's
  // dashboard_unread_overrides list that doesn't match a card we just
  // rendered (ID format changed, card resolved, etc.) gets dropped.
  // Keeps the badge count honest: badge = currently-displaying unread
  // cards, never inflated by orphan entries.
  if (companyId) {
    const renderedIds: string[] = [];
    for (const bucket of Object.values(grouped)) {
      for (const cards of Object.values(bucket)) {
        for (const c of cards) renderedIds.push(c.id);
      }
    }
    if (unreadOverrides.length > 0) {
      try {
        await (supabase as any).rpc("prune_dashboard_unread_overrides", {
          p_company_id: companyId,
          p_valid_card_ids: renderedIds,
        });
      } catch {}
    }
  }

  return <CommandCenterBuckets buckets={buckets} />;
}
