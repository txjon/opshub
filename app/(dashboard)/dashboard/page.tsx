import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/theme";
import { CommandCenterBuckets, type BucketCard, type BucketPayload, type BucketSection, type Urgency } from "@/components/CommandCenterBuckets";

export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

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
    ? await supabase.from("item_files").select("item_id, stage, approval, notes").in("item_id", allItemIds).in("stage", ["proof", "mockup"]).is("superseded_at", null)
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
    if (j.target_ship_date && new Date(j.target_ship_date) < now) {
      const postProduction = j.phase === "fulfillment" || j.phase === "shipping" || j.phase === "receiving";
      if (!postProduction) {
        const days = Math.abs(Math.ceil((new Date(j.target_ship_date).getTime() - now.getTime()) / 86400000));
        alerts.push({ ...base, priority: 0, type: "overdue", color: T.red,
          action: `${days} days past ship date`,
          href: `/jobs/${j.id}`, column: "sales" });
      }
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

    // 8. Order blanks. Only fires while the job is in the ready phase —
    // once it's moved to production / receiving / fulfillment, blanks
    // are obviously ordered and this alert is just stale noise.
    if (j.phase === "ready" && quoteApproved && paymentGateMet && allProofsApproved) {
      const needsBlanks = apparelItems.filter((it: any) => (it.blanks_order_cost ?? 0) <= 0);
      if (needsBlanks.length > 0) {
        alerts.push({ ...base, priority: 1, type: "order_blanks", color: T.accent,
          action: `Order blanks · ${needsBlanks.length} item${needsBlanks.length !== 1 ? "s" : ""}`,
          href: `/jobs/${j.id}?tab=blanks`, column: "production" });
      }
    }

    // 9. Send PO — same phase gate as order_blanks.
    const allBlanksHandled = apparelItems.length === 0 || apparelItems.every((it: any) => (it.blanks_order_cost ?? 0) > 0);
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
  const { data: briefs } = await supabase
    .from("art_briefs")
    .select("id, title, state, updated_at, sent_to_designer_at, client_aborted_at, job_id, clients(name), jobs(job_number)")
    .is("client_aborted_at", null)
    .not("state", "in", '("delivered","draft")')
    .order("updated_at", { ascending: false });

  // ── Build bucket payload ──
  const priorityToUrgency = (p: number): Urgency =>
    p === 0 ? "critical" : p === 1 ? "action" : p === 2 ? "watch" : "ok";

  // Mapping from alert.type → which section it belongs to within the
  // Clients / Decorators bucket. Anything not here is dropped (billing
  // types live on /billing, not the team dashboard).
  const SECTION_BY_TYPE: Record<string, { bucket: "clients" | "decorators"; section: string }> = {
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

  // Order in which sections appear inside each bucket — critical-tinted
  // sections at the top so eyes land on red first.
  const SECTION_ORDER: Record<string, string[]> = {
    clients:    ["Past ship date", "Quote feedback", "Proof revisions", "New leads", "Send to client", "Awaiting client"],
    decorators: ["Discrepancies", "Send PO", "Order blanks", "Verify shipping"],
    designers:  ["Awaiting HPD review", "Prep print-ready", "Mark delivered", "In design"],
  };

  type Grouped = Record<string, Record<string, BucketCard[]>>;
  const grouped: Grouped = { clients: {}, decorators: {}, designers: {} };

  function pushCard(bucket: keyof Grouped, section: string, card: BucketCard) {
    if (!grouped[bucket][section]) grouped[bucket][section] = [];
    grouped[bucket][section].push(card);
  }

  // Convert job-level alerts into cards. Invoice number takes priority
  // over the OpsHub job number when present — it's the reference the
  // client recognizes, and the team chases payments by it.
  for (const a of alerts) {
    const map = SECTION_BY_TYPE[a.type];
    if (!map) continue; // billing + anything we don't surface drops here
    const titleParts = [a.clientName, a.jobTitle].filter(Boolean);
    const metaKind: "invoice" | "job" | undefined = a.invoiceNumber ? "invoice" : a.jobNumber ? "job" : undefined;
    pushCard(map.bucket, map.section, {
      id: `alert-${a.type}-${a.jobId || a.clientName}-${a.action.slice(0, 30)}`,
      title: titleParts.join(" — ") || a.action,
      subtitle: a.action,
      meta: a.invoiceNumber || a.jobNumber || undefined,
      metaKind,
      urgency: priorityToUrgency(a.priority),
      href: a.href,
    });
  }

  // Designer-side cards from art_briefs.
  const briefRows = (briefs || []) as any[];
  const stateToSection: Record<string, { section: string; urgency: Urgency; subtitlePrefix: string }> = {
    wip_review:       { section: "Awaiting HPD review", urgency: "action",  subtitlePrefix: "Designer uploaded WIP" },
    pending_prep:     { section: "Prep print-ready",   urgency: "action",  subtitlePrefix: "Designer uploaded final · prep print-ready" },
    production_ready: { section: "Mark delivered",     urgency: "action",  subtitlePrefix: "Print-ready uploaded · ready to close" },
    final_approved:   { section: "In design",          urgency: "watch",   subtitlePrefix: "Client approved · awaiting designer's final" },
    revisions:        { section: "In design",          urgency: "watch",   subtitlePrefix: "Revisions · with designer" },
    in_progress:      { section: "In design",          urgency: "watch",   subtitlePrefix: "With designer" },
    sent:             { section: "In design",          urgency: "watch",   subtitlePrefix: "Sent to designer" },
    // client_review briefs intentionally NOT mapped here — designs
    // sitting with the client for review aren't a team call-to-action,
    // and one card per brief drowns the column on big jobs (saw 14
    // FOG cards stacked). Visible in Art Studio if anyone needs to
    // check; not a Command Center concern.
  };

  for (const b of briefRows) {
    const map = stateToSection[b.state];
    if (!map) continue;
    const clientName = (b.clients as any)?.name || "";
    const briefTitle = b.title || "Untitled brief";
    const jobNumber = (b.jobs as any)?.job_number || null;
    const card: BucketCard = {
      id: `brief-${b.id}`,
      title: clientName ? `${clientName} — ${briefTitle}` : briefTitle,
      subtitle: map.subtitlePrefix,
      meta: jobNumber || undefined,
      metaKind: jobNumber ? "job" : undefined,
      urgency: map.urgency,
      href: `/art-studio?brief=${b.id}`,
    };
    // client_review briefs land under Clients (it's a client-side conversation),
    // others under Designers.
    const bucket = b.state === "client_review" ? "clients" : "designers";
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

  return <CommandCenterBuckets buckets={buckets} />;
}
