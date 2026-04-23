import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

/**
 * Scheduled alert check — runs via Vercel Cron daily.
 * Scans for: overdue payments, upcoming ship dates,
 * pending proofs, unapproved quotes.
 * Creates notifications + sends daily digest email to owner.
 *
 * Protected by CRON_SECRET to prevent unauthorized access.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = admin();
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const alerts: { priority: number; type: string; message: string; jobId: string }[] = [];

    // ── Fetch all active jobs with related data ──
    const { data: jobs } = await sb
      .from("jobs")
      .select("id, title, job_number, phase, target_ship_date, payment_terms, quote_approved, client_id, type_meta")
      .in("phase", ["intake", "pending", "ready", "production", "receiving", "fulfillment", "on_hold"])
      .order("target_ship_date");

    if (!jobs?.length) {
      return NextResponse.json({ alerts: 0, message: "No active jobs" });
    }

    const jobIds = jobs.map(j => j.id);

    // Fetch related data in parallel
    const [
      { data: allPayments },
      { data: allItems },
      { data: allProofs },
    ] = await Promise.all([
      sb.from("payment_records").select("id, job_id, amount, status, due_date, type").in("job_id", jobIds),
      sb.from("items").select("id, job_id, name, pipeline_stage, pipeline_timestamps, blanks_order_number, artwork_status").in("job_id", jobIds),
      sb.from("item_files").select("id, item_id, stage, approval, created_at").in("stage", ["proof"]).eq("approval", "pending").is("superseded_at", null),
    ]);

    // Client names
    const clientIds = [...new Set(jobs.map(j => j.client_id).filter(Boolean))];
    let clientMap: Record<string, string> = {};
    if (clientIds.length > 0) {
      const { data: clients } = await sb.from("clients").select("id, name").in("id", clientIds);
      clientMap = Object.fromEntries((clients || []).map(c => [c.id, c.name]));
    }

    // Item IDs for proof lookup
    const itemIds = (allItems || []).map(i => i.id);

    for (const job of jobs) {
      const client = clientMap[job.client_id] || "Unknown";
      const ref = `${client} · ${job.title}`;
      const payments = (allPayments || []).filter(p => p.job_id === job.id);
      const items = (allItems || []).filter(i => i.job_id === job.id);
      const jobItemIds = items.map(i => i.id);
      const proofs = (allProofs || []).filter(p => jobItemIds.includes(p.item_id));

      // ── OVERDUE PAYMENTS ──
      for (const p of payments) {
        if (p.due_date && p.status !== "paid" && p.status !== "void" && p.due_date < today) {
          const daysOver = Math.floor((now.getTime() - new Date(p.due_date).getTime()) / 86400000);
          alerts.push({
            priority: 0,
            type: "overdue_payment",
            message: `Overdue payment — $${p.amount.toLocaleString()} · ${daysOver}d overdue · ${ref}`,
            jobId: job.id,
          });
        }
      }

      // ── SHIP DATE WITHIN 3 DAYS ──
      if (job.target_ship_date && job.phase !== "complete") {
        const daysUntil = Math.ceil((new Date(job.target_ship_date).getTime() - now.getTime()) / 86400000);
        if (daysUntil < 0) {
          alerts.push({
            priority: 0,
            type: "overdue_ship",
            message: `Ship date passed ${Math.abs(daysUntil)}d ago · ${ref}`,
            jobId: job.id,
          });
        } else if (daysUntil <= 3) {
          alerts.push({
            priority: 1,
            type: "upcoming_ship",
            message: `Ships in ${daysUntil}d · ${ref}`,
            jobId: job.id,
          });
        }
      }

      // ── PROOFS PENDING 3+ DAYS ──
      for (const proof of proofs) {
        const item = items.find(i => i.id === proof.item_id);
        // Skip manually approved items — override settles it, no nag needed.
        if (item?.artwork_status === "approved") continue;
        const daysPending = Math.floor((now.getTime() - new Date(proof.created_at).getTime()) / 86400000);
        if (daysPending >= 3) {
          alerts.push({
            priority: 2,
            type: "pending_proof",
            message: `Proof pending ${daysPending}d — ${item?.name || "Item"} · ${ref}`,
            jobId: job.id,
          });
        }
      }

      // ── BLANKS NOT ORDERED (ready phase) ──
      if (job.phase === "ready") {
        const unordered = items.filter(i => !i.blanks_order_number);
        if (unordered.length > 0) {
          alerts.push({
            priority: 2,
            type: "blanks_not_ordered",
            message: `${unordered.length} item${unordered.length > 1 ? "s" : ""} need blanks ordered · ${ref}`,
            jobId: job.id,
          });
        }
      }

      // ── POs NOT SENT (ready phase, blanks ordered) ──
      if (job.phase === "ready" || job.phase === "production") {
        const poSent = (job.type_meta as any)?.po_sent_vendors || [];
        const hasItems = items.length > 0;
        const allBlanksOrdered = items.every(i => i.blanks_order_number);
        if (hasItems && allBlanksOrdered && poSent.length === 0) {
          alerts.push({
            priority: 2,
            type: "po_not_sent",
            message: `Blanks ordered but POs not sent · ${ref}`,
            jobId: job.id,
          });
        }
      }
    }

    // ── Create notifications for each alert ──
    if (alerts.length > 0) {
      // Notifications table deprecated — bell UI was removed.
      // Alerts are still surfaced via the daily digest email below.
    }

    // ── Send daily digest email to owner ──
    if (alerts.length > 0 && process.env.OWNER_EMAIL) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Group by priority
        const critical = alerts.filter(a => a.priority === 0);
        const high = alerts.filter(a => a.priority === 1);
        const medium = alerts.filter(a => a.priority === 2);

        const section = (title: string, items: typeof alerts, color: string) =>
          items.length > 0
            ? `<h3 style="color:${color};margin:16px 0 8px">${title} (${items.length})</h3><ul style="margin:0;padding-left:20px">${items.map(a => `<li style="margin:4px 0;font-size:14px">${a.message}</li>`).join("")}</ul>`
            : "";

        const html = `
<div style="font-family:sans-serif;max-width:600px">
  <h2 style="margin:0 0 16px">OpsHub Daily Digest</h2>
  <p style="color:#666;margin:0 0 20px">${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${alerts.length} alert${alerts.length !== 1 ? "s" : ""}</p>
  ${section("Critical", critical, "#ef4444")}
  ${section("Action Needed", high, "#d97706")}
  ${section("Heads Up", medium, "#4361ee")}
  <p style="margin:24px 0 0;font-size:12px;color:#999">— OpsHub</p>
</div>`;

        await resend.emails.send({
          from: process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev",
          to: process.env.OWNER_EMAIL,
          subject: `OpsHub · ${critical.length > 0 ? "🔴" : high.length > 0 ? "🟡" : "🔵"} ${alerts.length} alert${alerts.length !== 1 ? "s" : ""} — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          html,
        });
      } catch (emailErr) {
        console.error("Digest email error:", emailErr);
      }
    }

    return NextResponse.json({
      alerts: alerts.length,
      critical: alerts.filter(a => a.priority === 0).length,
      high: alerts.filter(a => a.priority === 1).length,
      medium: alerts.filter(a => a.priority === 2).length,
    });
  } catch (e: any) {
    console.error("Cron alert error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
