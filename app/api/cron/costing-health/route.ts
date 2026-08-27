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
      .select("id, job_number, phase, costing_data, costing_summary, items(id, name, is_fleece, sell_per_unit, buy_sheet_lines(qty_ordered))")
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

    // Email the owner ONLY when something is wrong. Silent when clean.
    if ((drift.length || healed.length || fleeceGaps.length || phaseDrift.length) && process.env.OWNER_EMAIL) {
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
  <p style="margin:20px 0 0;font-size:12px;color:#999">Costing: re-save the job's costing tab. Phase: open the job (V2 heals on load). — OpsHub tripwire</p>
</div>`;
        await resend.emails.send({
          from: process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev",
          to: process.env.OWNER_EMAIL,
          subject: `OpsHub · ⚠️ ${drift.length + fleeceGaps.length + phaseDrift.length} health issue${drift.length + fleeceGaps.length + phaseDrift.length !== 1 ? "s" : ""} (${drift.length} rev · ${phaseDrift.length} phase)`,
          html,
        });
      } catch (emailErr) {
        console.error("Costing-health email error:", emailErr);
      }
    }

    return NextResponse.json({ consistent, drifted: drift.length, healed: healed.length, fleeceGaps: fleeceGaps.length, phaseDrift: phaseDrift.length, jobs: drift.map(d => d.job), healedJobs: healed.map(h => h.job), phaseJobs: phaseDrift.map(p => p.job) });
  } catch (e: any) {
    console.error("Costing-health cron error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
