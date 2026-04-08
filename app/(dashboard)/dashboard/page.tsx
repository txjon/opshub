import { createClient } from "@/lib/supabase/server";
import { T, font, mono } from "@/lib/theme";
import { CommandCenter } from "@/components/CommandCenter";

export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

  // ── Data Loading ──
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), quote_approved, quote_approved_at, type_meta, costing_data, payment_terms, shipping_route, items(id, name, pipeline_stage, blanks_order_number, ship_tracking, artwork_status, garment_type, received_at_hpd, pipeline_timestamps, buy_sheet_lines(qty_ordered))")
    .not("phase", "in", '("complete","cancelled")')
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const { data: allPayments } = await supabase
    .from("payment_records")
    .select("*, jobs!inner(id)")
    .order("created_at");

  const allItemIds = (jobs || []).flatMap(j => (j.items || []).map((it: any) => it.id));
  const { data: proofFiles } = allItemIds.length > 0
    ? await supabase.from("item_files").select("item_id, stage, approval").in("item_id", allItemIds).in("stage", ["proof", "mockup"])
    : { data: [] };

  // Load contacts for email modals
  const jobIds = (jobs || []).map(j => j.id);
  const { data: jobContacts } = jobIds.length > 0
    ? await supabase.from("job_contacts").select("job_id, role_on_job, contacts(name, email)").in("job_id", jobIds)
    : { data: [] };

  // ── Proof status map ──
  const proofMap: Record<string, { allApproved: boolean; hasRevision: boolean; pendingCount: number }> = {};
  for (const id of allItemIds) {
    const proofs = (proofFiles || []).filter(f => f.item_id === id && f.stage === "proof");
    proofMap[id] = {
      allApproved: proofs.length > 0 && proofs.every(f => f.approval === "approved"),
      hasRevision: proofs.some(f => f.approval === "revision_requested"),
      pendingCount: proofs.filter(f => f.approval === "pending").length,
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
    const hasPaidPayment = payments.some(p => p.status === "paid");
    const quoteApproved = (j as any).quote_approved;
    const allProofsApproved = items.length > 0 && items.every((it: any) => proofMap[it.id]?.allApproved || it.artwork_status === "approved");
    const poSentVendors = typeMeta.po_sent_vendors || [];
    const costProds = (j as any).costing_data?.costProds || [];
    const allVendors = [...new Set(costProds.map((cp: any) => cp.printVendor).filter(Boolean))] as string[];
    const unsentVendors = allVendors.filter(v => !poSentVendors.includes(v));

    const base = {
      jobId: j.id, jobTitle: j.title, clientName, invoiceNumber: invoiceNum,
      jobNumber: jobNum, shipDate: j.target_ship_date, contacts,
    };

    // ── SALES ALERTS ──

    // Critical: Overdue project
    if (j.target_ship_date && new Date(j.target_ship_date) < now) {
      const days = Math.abs(Math.ceil((new Date(j.target_ship_date).getTime() - now.getTime()) / 86400000));
      alerts.push({ ...base, priority: 0, type: "overdue", label: "OVERDUE", bg: T.redDim, color: T.red, action: `${days}d past ship date`, href: `/jobs/${j.id}`, column: "sales" });
    }

    // Critical: Revision requested
    for (const it of items) {
      if (proofMap[it.id]?.hasRevision) {
        alerts.push({ ...base, priority: 0, type: "revision", label: "REVISION", bg: T.redDim, color: T.red, action: `${it.name} — client requested changes`, href: `/jobs/${j.id}?tab=art`, column: "sales" });
      }
    }

    // Quote not approved yet (intake phase with items)
    if (j.phase === "intake" && !quoteApproved && items.length > 0) {
      alerts.push({ ...base, priority: 2, type: "send_quote", label: "QUOTE", bg: T.purpleDim, color: T.purple, action: "Send quote to client", href: `/jobs/${j.id}?tab=quote`, column: "sales" });
    }

    // Quote approved but no invoice number
    if (quoteApproved && !invoiceNum) {
      alerts.push({ ...base, priority: 1, type: "create_invoice", label: "INVOICE", bg: T.amberDim, color: T.amber, action: "Create invoice", href: `/jobs/${j.id}?tab=payment`, column: "sales" });
    }

    // Invoice exists but not sent (no payment records yet, phase is pending)
    if (quoteApproved && invoiceNum && payments.length === 0 && j.phase === "pending") {
      const terms = j.payment_terms || "";
      if (terms !== "net_15" && terms !== "net_30") {
        alerts.push({ ...base, priority: 1, type: "send_invoice", label: "SEND", bg: T.amberDim, color: T.amber, action: "Send invoice to client", href: `/jobs/${j.id}?tab=payment`, column: "sales" });
      }
    }

    // Proofs not sent yet (quote approved, items have mockups but no proofs sent)
    if (quoteApproved && !allProofsApproved) {
      const hasPending = items.some((it: any) => proofMap[it.id]?.pendingCount > 0);
      const hasNoProofs = items.some((it: any) => {
        const proofs = (proofFiles || []).filter(f => f.item_id === it.id && f.stage === "proof");
        return proofs.length === 0 && it.artwork_status !== "approved";
      });
      if (hasPending) {
        alerts.push({ ...base, priority: 2, type: "proofs_pending", label: "PROOFS", bg: T.purpleDim, color: T.purple, action: "Waiting on client approval", href: `/jobs/${j.id}?tab=approvals`, column: "sales" });
      } else if (hasNoProofs && quoteApproved) {
        alerts.push({ ...base, priority: 2, type: "send_proofs", label: "PROOFS", bg: T.purpleDim, color: T.purple, action: "Send proofs to client", href: `/jobs/${j.id}?tab=approvals`, column: "sales" });
      }
    }

    // ── PRODUCTION ALERTS ──

    // Payment gate: check if payment received (handoff to production)
    const terms = j.payment_terms || "";
    const paymentGateMet = terms === "net_15" || terms === "net_30" || hasPaidPayment;

    // Order blanks: payment + proofs approved, blanks not ordered
    if (quoteApproved && paymentGateMet && allProofsApproved) {
      const needsBlanks = items.filter((it: any) => !it.blanks_order_number && it.garment_type !== "accessory");
      if (needsBlanks.length > 0) {
        alerts.push({ ...base, priority: 1, type: "order_blanks", label: "BLANKS", bg: T.accentDim, color: T.accent, action: `Order blanks — ${needsBlanks.length} item${needsBlanks.length !== 1 ? "s" : ""}`, href: `/jobs/${j.id}?tab=blanks`, column: "production" });
      }
    }

    // Send POs: blanks ordered, POs not sent
    if (items.some((it: any) => it.blanks_order_number) && unsentVendors.length > 0) {
      alerts.push({ ...base, priority: 1, type: "send_po", label: "PO", bg: T.accentDim, color: T.accent, action: `Send PO — ${unsentVendors.join(", ")}`, href: `/jobs/${j.id}?tab=po`, column: "production", vendors: unsentVendors });
    }

    // In production — stalled (7+ days)
    for (const it of items) {
      if (it.pipeline_stage === "in_production" && it.pipeline_timestamps?.in_production) {
        const days = Math.ceil((now.getTime() - new Date(it.pipeline_timestamps.in_production).getTime()) / 86400000);
        if (days >= 7) {
          alerts.push({ ...base, priority: 1, type: "stalled", label: "STALLED", bg: T.amberDim, color: T.amber, action: `${it.name} — ${days}d at decorator`, href: `/jobs/${j.id}?tab=production`, column: "production" });
        }
      }
    }

    // Items shipped, pending receiving (ship_through / stage only)
    if ((j as any).shipping_route !== "drop_ship") {
      const pendingReceive = items.filter((it: any) => it.pipeline_stage === "shipped" && !it.received_at_hpd);
      if (pendingReceive.length > 0) {
        alerts.push({ ...base, priority: 1, type: "receiving", label: "INCOMING", bg: T.greenDim, color: T.green, action: `${pendingReceive.length} item${pendingReceive.length !== 1 ? "s" : ""} incoming to warehouse`, href: `/warehouse`, column: "production" });
      }
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
