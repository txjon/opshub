import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resendForSlug } from "@/lib/resend-client";
import { recalcJobPhase } from "@/lib/job-phase-recalc";
import { refreshJobFinancials } from "@/lib/costing-summary";

export const maxDuration = 60; // per-job phase recompute over the active jobs

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/**
 * COSTING HEALTH TRIPWIRE — runs via Vercel Cron.
 *
 * Guards the ONE invariant that must always hold regardless of decorator-rate
 * era: a job's reported revenue must equal the sum of the prices actually
 * charged. costing_summary.grossRev == Σ(items.sell_per_unit × qty) over
 * non-passthrough items. sell_per_unit is the source of truth (quote / invoice
 * / QB all read it); grossRev is a derived cache every write path must keep in
 * step. A mismatch means a write path left the summary stale (the Jul 28 bug
 * class) — this surfaces it by email in a day instead of when a client notices.
 *
 * Also flags fleece items whose costProd never caught isFleece (the vendor
 * upcharge + shipping buffer weren't applied → possible under-price).
 *
 * Silent when clean (no email). Protected by CRON_SECRET.
 */

// Known-correct exceptions, confirmed against QuickBooks. Keep tiny + documented.
const SKIP = new Set<string>([
  "HPD-2606-040", // passthrough/wave edge case — correct to QB (Jon, Jul 28 2026)
]);

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = admin();
    const { data: jobs, error } = await sb
      .from("jobs")
      .select("id, job_number, phase, is_internal, financial_closed_at, costing_data, costing_summary, items(id, name, is_fleece, archived_at, sell_per_unit, buy_sheet_lines(size, qty_ordered))")
      .not("costing_summary", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const drift: { job: string; phase: string; grossRev: number; target: number; delta: number }[] = [];
    // HEAL ON SIGHT for pre-production jobs (Jon, Aug 27): their rates are
    // today's rates, so recomputing is safe — the "old summaries embed the
    // rates of their era" warning is about closed jobs. Healed jobs are still
    // reported (the write path that leaked is still a bug); the write is
    // guarded: it only counts as healed when fresh.grossRev lands on target.
    const HEAL_PHASES = new Set(["intake", "pending", "ready"]);
    const healed: { job: string; phase: string; from: number; to: number }[] = [];
    const fleeceGaps: string[] = [];
    let consistent = 0;

    for (const j of jobs || []) {
      const gr = Number((j.costing_summary as any)?.grossRev);
      const cps: any[] = (j.costing_data as any)?.costProds || [];
      const passthru = new Set(cps.filter(p => p.passthrough).map(p => p.id));

      for (const it of (j.items as any[]) || []) {
        if (!it.is_fleece) continue;
        const cp = cps.find(c => c.id === it.id) || cps.find(c => (c.name || "").trim().toLowerCase() === (it.name || "").trim().toLowerCase());
        if (cp && !cp.isFleece) fleeceGaps.push(`${j.job_number} · ${it.name || "?"} (${j.phase})`);
      }

      if (!gr) continue;
      let target = 0;
      for (const it of (j.items as any[]) || []) {
        if (passthru.has(it.id)) continue;
        const q = (it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0);
        target += (Number(it.sell_per_unit) || 0) * q;
      }
      target = Math.round(target * 100) / 100;
      if (target === 0) continue; // unpriced — nothing to compare
      const delta = Math.round((gr - target) * 100) / 100;
      if (Math.abs(delta) <= 1) { consistent++; continue; }
      if (SKIP.has(j.job_number)) continue;
      if (HEAL_PHASES.has(j.phase)) {
        try {
          const r = await refreshJobFinancials(sb, (j as any).id);
          const fresh = Number(r.summary?.grossRev);
          if (r.ok && Number.isFinite(fresh) && Math.abs(fresh - target) <= 1) { healed.push({ job: j.job_number, phase: j.phase, from: gr, to: fresh }); continue; }
        } catch { /* fall through to report */ }
      }
      drift.push({ job: j.job_number, phase: j.phase, grossRev: gr, target, delta });
    }

    // ── Qty tripwire: costing_data per-size qtys vs buy_sheet_lines (the
    //    owner). Reorder clones + worksheet qty edits drifted these silently
    //    for weeks and poisoned variance projections (HPD-2608-023, Sep 4:
    //    $17.5K phantom overage that was really $4.5K under). Costing
    //    UNDERCOUNTING the buy sheet is the stale-seed class → heal on sight
    //    (mirrors CostingTabWrapper's sync: match by item id, only when the
    //    item has real lines, qtys/totalQty/sizes only, stamp _savedAt).
    //    Costing OVERCOUNTING is the pre-order/wave shape (FOG) → report
    //    only, humans decide. Financially closed books are never touched.
    const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
    const qtyHealed: { job: string; detail: string }[] = [];
    const qtyDrift: { job: string; phase: string; cpQty: number; bsQty: number }[] = [];
    for (const j of jobs || []) {
      const cps: any[] = (j.costing_data as any)?.costProds || [];
      if (!cps.length) continue;
      const linesById: Record<string, Record<string, number>> = {};
      for (const it of (j.items as any[]) || []) {
        if (it.archived_at) continue;
        const q: Record<string, number> = {};
        for (const l of it.buy_sheet_lines || []) if (l.size) q[l.size] = (q[l.size] || 0) + (Number(l.qty_ordered) || 0);
        if (Object.keys(q).length) linesById[it.id] = q;
      }
      // S3 (Sep 5): saves no longer persist qtys into costProds — ABSENT
      // copies are the clean single-sourced state, not drift. Only costProds
      // still CARRYING a qtys map can be stale; compare (and heal) those
      // alone, and never re-seed a stripped one.
      const carriers = cps.filter((p) => p.qtys && Object.keys(p.qtys).length > 0);
      if (!carriers.length) continue;
      const carrierIds = new Set(carriers.map((p) => p.id));
      const cpQty = carriers.reduce((a, p) => a + Object.values(p.qtys || {}).reduce((x: number, y: any) => x + (Number(y) || 0), 0), 0);
      const bsQty = Object.entries(linesById).filter(([id]) => carrierIds.has(id)).reduce((a, [, q]) => a + Object.values(q).reduce((x, y) => x + y, 0), 0);
      if (bsQty === 0 || Math.abs(cpQty - bsQty) <= Math.max(2, bsQty * 0.05)) continue;
      if (cpQty > bsQty || (j as any).financial_closed_at) {
        qtyDrift.push({ job: j.job_number, phase: j.phase, cpQty, bsQty });
        continue;
      }
      try {
        const changes: string[] = [];
        for (const cp of cps) {
          if (!cp.qtys || !Object.keys(cp.qtys).length) continue; // stripped = clean, never re-seed
          const q = linesById[cp.id];
          if (!q) continue;
          if (JSON.stringify(cp.qtys) === JSON.stringify(q)) continue;
          const cur = Object.values(cp.qtys || {}).reduce((x: number, y: any) => x + (Number(y) || 0), 0);
          const total = Object.values(q).reduce((x, y) => x + y, 0);
          cp.qtys = q;
          cp.totalQty = total;
          cp.sizes = Object.keys(q).sort((a, b) => (SIZE_ORDER.indexOf(a) + 100 * +(SIZE_ORDER.indexOf(a) < 0)) - (SIZE_ORDER.indexOf(b) + 100 * +(SIZE_ORDER.indexOf(b) < 0)));
          changes.push(`${cp.name || "?"} ${cur}→${total}u`);
        }
        if (!changes.length) { qtyDrift.push({ job: j.job_number, phase: j.phase, cpQty, bsQty }); continue; }
        (j.costing_data as any)._savedAt = new Date().toISOString();
        const { error: wErr } = await sb.from("jobs").update({ costing_data: j.costing_data }).eq("id", (j as any).id);
        if (wErr) throw wErr;
        await refreshJobFinancials(sb, (j as any).id);
        qtyHealed.push({ job: j.job_number, detail: changes.join(" · ") });
      } catch {
        qtyDrift.push({ job: j.job_number, phase: j.phase, cpQty, bsQty });
      }
    }

    drift.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    // ── Phase tripwire: stored jobs.phase vs the canonical dry-run recompute ──
    // A mismatch means a write path changed a gate input without recomputing
    // phase (the payment-webhook class). Active jobs only — on_hold/cancelled
    // are intentionally locked, and recalcJobPhase returns null for them.
    const { data: activeJobs } = await sb.from("jobs")
      .select("id, job_number, phase")
      .in("phase", ["intake", "pending", "ready", "production", "receiving", "fulfillment"]);
    const phaseDrift: { job: string; stored: string; computed: string }[] = [];
    for (const j of activeJobs || []) {
      try {
        const r = await recalcJobPhase(sb, j.id, { commit: false });
        if (r && r.changed) phaseDrift.push({ job: j.job_number, stored: r.stored, computed: r.phase });
      } catch { /* one job erroring must not sink the whole sweep */ }
    }

    // ── Sep 11 2026 tripwires — the three failure shapes that sat unnoticed
    //    for days-to-weeks that day. Detection only; each is a human call.
    const ACTIVE_PHASES = new Set(["intake", "pending", "ready", "quoting", "approved", "production", "receiving", "shipping", "fulfillment"]);

    // (a) PO art link points somewhere other than the item's own folder. A
    //     packing-slip upload repointed four items at "Packing Slips"; a
    //     duplicate copied it; ICON opened an empty folder. Register now moves
    //     the link on art stages only — this catches any other path.
    const folderOf = (l: string | null) => (l || "").match(/folders\/([A-Za-z0-9_-]+)/)?.[1] || null;
    const badLinks: string[] = [];
    for (let from = 0; ; from += 1000) { // paginate — un-ranged selects cap at 1000 silently
      const { data: page } = await sb.from("items")
        .select("id, name, drive_link, drive_folder_id, jobs(job_number, phase)")
        .is("archived_at", null).not("drive_folder_id", "is", null).range(from, from + 999);
      for (const it of (page || []) as any[]) {
        if (!ACTIVE_PHASES.has(it.jobs?.phase)) continue;
        const f = folderOf(it.drive_link);
        if (f && f !== it.drive_folder_id) badLinks.push(`${it.jobs.job_number} · ${it.name || "?"} (${it.jobs.phase})`);
      }
      if (!page || page.length < 1000) break;
    }

    // (b) A cost entry the gates forbid carries a QB bill id anyway (mig 177
    //     refuses new ones at the row; this catches anything that predates it
    //     or slips through a bypass).
    const { data: forbidden } = await sb.from("cost_entries")
      .select("id, source, bill_method, qb_bill_id, vendor_name, amount, job_id, jobs(job_number)")
      .not("qb_bill_id", "is", null).neq("qb_bill_id", "paid-verified")
      .or("source.eq.pre_opshub,bill_method.eq.credit_card");
    const forbiddenPushes = ((forbidden || []) as any[]).map(e =>
      `${e.jobs?.job_number || "no job"} · ${e.vendor_name || "?"} $${Number(e.amount || 0).toLocaleString()} · ${e.source === "pre_opshub" ? "pre-OpsHub" : "card charge"} → QB Bill #${e.qb_bill_id}`);

    // (c) A PO went out but the job has no invoice number. Either the invoice
    //     was never drafted, or the job's type_meta lost it (the Sep 11 wipe —
    //     mig 176 refuses that now). Internal + terminal jobs excluded.
    const poNoInvoice = ((jobs || []) as any[])
      .filter(j => !j.is_internal && ACTIVE_PHASES.has(j.phase))
      .filter(j => ((j.type_meta?.po_sent_vendors || []) as string[]).length > 0 && !j.type_meta?.qb_invoice_number)
      .map(j => `${j.job_number} (${j.phase}) — PO sent to ${(j.type_meta.po_sent_vendors as string[]).join(", ")}`);

    // Email the owner ONLY when something is wrong. Silent when clean.
    const sep11Count = badLinks.length + forbiddenPushes.length + poNoInvoice.length;
    if ((drift.length || healed.length || fleeceGaps.length || phaseDrift.length || qtyHealed.length || qtyDrift.length || sep11Count) && process.env.OWNER_EMAIL) {
      try {
        const resend = resendForSlug("hpd");
        const driftRows = drift.map(d =>
          `<li style="margin:4px 0;font-size:14px"><b>${d.job}</b> (${d.phase}) — reports $${d.grossRev.toLocaleString()}, should be $${d.target.toLocaleString()} · off by $${d.delta.toLocaleString()}</li>`
        ).join("");
        const fleeceRows = fleeceGaps.map(f => `<li style="margin:4px 0;font-size:14px">${f}</li>`).join("");
        const phaseRows = phaseDrift.map(p => `<li style="margin:4px 0;font-size:14px"><b>${p.job}</b> — reads "${p.stored}", should be "${p.computed}"</li>`).join("");
        const html = `
<div style="font-family:sans-serif;max-width:600px">
  <h2 style="margin:0 0 8px">OpsHub · Ops Health</h2>
  <p style="color:#666;margin:0 0 16px">${consistent} costing-consistent · ${drift.length} revenue drift · ${fleeceGaps.length} fleece · ${phaseDrift.length} phase drift</p>
  ${healed.length ? `<h3 style="color:#16a34a;margin:16px 0 8px">Revenue drift healed on sight (${healed.length})</h3><ul style="margin:0;padding-left:20px">${healed.map(h => `<li style="margin:4px 0;font-size:14px"><b>${h.job}</b> (${h.phase}) — was $${h.from.toLocaleString()}, now $${h.to.toLocaleString()} · a price edit skipped the summary refresh</li>`).join("")}</ul>` : ""}
  ${drift.length ? `<h3 style="color:#ef4444;margin:16px 0 8px">Revenue drift — summary out of step with item prices (${drift.length})</h3><ul style="margin:0;padding-left:20px">${driftRows}</ul>` : ""}
  ${fleeceGaps.length ? `<h3 style="color:#d97706;margin:16px 0 8px">Fleece not applied in costing (${fleeceGaps.length})</h3><ul style="margin:0;padding-left:20px">${fleeceRows}</ul>` : ""}
  ${phaseDrift.length ? `<h3 style="color:#ef4444;margin:16px 0 8px">Phase drift — stored phase ≠ recomputed (${phaseDrift.length})</h3><ul style="margin:0;padding-left:20px">${phaseRows}</ul>` : ""}
  ${qtyHealed.length ? `<h3 style="color:#16a34a;margin:16px 0 8px">Costing qtys re-synced from the buy sheet (${qtyHealed.length})</h3><ul style="margin:0;padding-left:20px">${qtyHealed.map(h => `<li style="margin:4px 0;font-size:14px"><b>${h.job}</b> — ${h.detail}</li>`).join("")}</ul>` : ""}
  ${qtyDrift.length ? `<h3 style="color:#d97706;margin:16px 0 8px">Costing qtys ≠ buy sheet — needs eyes (${qtyDrift.length})</h3><ul style="margin:0;padding-left:20px">${qtyDrift.map(d => `<li style="margin:4px 0;font-size:14px"><b>${d.job}</b> (${d.phase}) — costing ${d.cpQty}u vs buy sheet ${d.bsQty}u${d.cpQty > d.bsQty ? " · costing overcounts (pre-order/wave shape — review, not auto-healed)" : " · closed or unhealable"}</li>`).join("")}</ul>` : ""}
  ${badLinks.length ? `<h3 style="color:#ef4444;margin:16px 0 8px">PO art link points away from the item's folder (${badLinks.length})</h3><ul style="margin:0;padding-left:20px">${badLinks.map(t => `<li style="margin:4px 0;font-size:14px">${t}</li>`).join("")}</ul><p style="font-size:12px;color:#666;margin:4px 0 0">The printer's "Production Files" button opens this link. Re-pull the proof or set the folder link on the item.</p>` : ""}
  ${forbiddenPushes.length ? `<h3 style="color:#ef4444;margin:16px 0 8px">Cost entries in QB that should never be (${forbiddenPushes.length})</h3><ul style="margin:0;padding-left:20px">${forbiddenPushes.map(t => `<li style="margin:4px 0;font-size:14px">${t}</li>`).join("")}</ul><p style="font-size:12px;color:#666;margin:4px 0 0">Delete the QB Bill, then clear the entry's pushed stamp.</p>` : ""}
  ${poNoInvoice.length ? `<h3 style="color:#d97706;margin:16px 0 8px">PO sent, no invoice on the job (${poNoInvoice.length})</h3><ul style="margin:0;padding-left:20px">${poNoInvoice.map(t => `<li style="margin:4px 0;font-size:14px">${t}</li>`).join("")}</ul><p style="font-size:12px;color:#666;margin:4px 0 0">Draft the invoice, or the job lost its QB link — check job_type_meta_history.</p>` : ""}
  <p style="margin:20px 0 0;font-size:12px;color:#999">Costing: re-save the job's costing tab. Phase: open the job (V2 heals on load). — OpsHub tripwire</p>
</div>`;
        await resend.emails.send({
          from: process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev",
          to: process.env.OWNER_EMAIL,
          subject: `OpsHub · ⚠️ ${drift.length + fleeceGaps.length + phaseDrift.length + qtyDrift.length + sep11Count} health issue${drift.length + fleeceGaps.length + phaseDrift.length + qtyDrift.length + sep11Count !== 1 ? "s" : ""} (${drift.length} rev · ${phaseDrift.length} phase · ${qtyDrift.length} qty${sep11Count ? ` · ${sep11Count} links/pushes/invoices` : ""})`,
          html,
        });
      } catch (emailErr) {
        console.error("Costing-health email error:", emailErr);
      }
    }

    return NextResponse.json({ consistent, drifted: drift.length, healed: healed.length, fleeceGaps: fleeceGaps.length, phaseDrift: phaseDrift.length, qtyHealed: qtyHealed.length, qtyDrift: qtyDrift.length, jobs: drift.map(d => d.job), healedJobs: healed.map(h => h.job), phaseJobs: phaseDrift.map(p => p.job), qtyHealedJobs: qtyHealed.map(h => h.job), qtyDriftJobs: qtyDrift.map(d => d.job), badLinks, forbiddenPushes, poNoInvoice });
  } catch (e: any) {
    console.error("Costing-health cron error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
