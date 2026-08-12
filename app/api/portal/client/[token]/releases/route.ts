import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client Hub — RELEASES (mig 134). The client-side release builder:
// gather product lines from ACROSS their ideas into one dated release.
// GET → their releases with slots + per-slot readiness (contributing idea
// approved?). POST → start a release. 'releases' grant required.
// (Renamed from /drops Aug 11 2026; the legacy staging board API moved
// to /staging-releases to free this namespace.)

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const APPROVED = ["approved"];

async function ctxOf(token: string) {
  const db = admin();
  const { data: client } = await db.from("clients")
    .select("id, name, portal_features, company_id").eq("portal_token", token).single();
  if (!client) return null;
  const denied = !Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("releases");
  return { db, client, denied };
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const ctx = await ctxOf(params.token);
    if (!ctx) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (ctx.denied) return NextResponse.json({ drops: [] });
    const { db, client } = ctx;

    const { data: releases } = await db.from("releases")
      .select("id, title, status, model, target_live_date, window_close_date, job_id, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    const ids = (releases || []).map((r: any) => r.id);
    const slotsByRelease: Record<string, any[]> = {};
    if (ids.length) {
      const { data: slots } = await db.from("release_slots")
        .select("id, release_id, brief_id, line_id, format, retail, model, line_notes, sold_units, qtys, qtys_confirmed_at, item_id, sort_order, art_briefs(title, state)")
        .in("release_id", ids)
        .order("sort_order", { ascending: true });
      for (const s of (slots || []) as any[]) {
        (slotsByRelease[s.release_id] = slotsByRelease[s.release_id] || []).push({
          id: s.id, briefId: s.brief_id, lineId: s.line_id,
          format: s.format, retail: s.retail != null ? Number(s.retail) : null,
          model: s.model, notes: s.line_notes,
          soldUnits: s.sold_units, qtys: s.qtys || {}, qtysConfirmedAt: s.qtys_confirmed_at,
          itemId: s.item_id || null,
          ideaTitle: s.art_briefs?.title || null,
          // an in-production item is real by definition — always ready
          ideaApproved: s.item_id ? true : APPROVED.includes(s.art_briefs?.state),
        });
      }
    }
    // Payable for cut drops — read the born job's invoice state (same
    // gating as the order surfaces: nothing shows until the invoice is
    // actually sent or a non-draft payment record exists).
    const cutJobIds = (releases || []).filter((r: any) => r.status === "cut" && r.job_id).map((r: any) => r.job_id);
    const payableByJob: Record<string, any> = {};
    if (cutJobIds.length) {
      const { data: jobs } = await db.from("jobs").select("id, type_meta").in("id", cutJobIds);
      const { data: pays } = await db.from("payment_records").select("job_id, amount, status").in("job_id", cutJobIds);
      for (const j of (jobs || []) as any[]) {
        const tm = j.type_meta || {};
        const jp = (pays || []).filter((p: any) => p.job_id === j.id);
        const sent = !!tm.invoice_sent_at || jp.some((p: any) => p.status && !["draft", "void"].includes(p.status));
        const paid = jp.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + Number(p.amount || 0), 0);
        const total = Number(tm.qb_total_with_tax || 0);
        payableByJob[j.id] = {
          invoiceNumber: sent ? (tm.qb_invoice_number || null) : null,
          paymentLink: sent ? (tm.qb_payment_link || null) : null,
          total: sent ? total : null,
          paid,
          state: !sent ? "pending" : (total > 0 && paid >= total - 0.005) ? "paid" : "ready",
        };
      }
    }
    return NextResponse.json({
      drops: (releases || []).map((r: any) => ({
        ...r,
        slots: slotsByRelease[r.id] || [],
        payable: r.status === "cut" && r.job_id ? (payableByJob[r.job_id] || null) : null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const ctx = await ctxOf(params.token);
    if (!ctx) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (ctx.denied) return NextResponse.json({ error: "Not available" }, { status: 403 });
    const { db, client } = ctx;

    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").trim().slice(0, 120);
    if (!title) return NextResponse.json({ error: "Name the drop" }, { status: 400 });
    const model = ["preorder", "stock"].includes(body.model) ? body.model : "preorder";
    const target = /^\d{4}-\d{2}-\d{2}$/.test(String(body.target_live_date || "")) ? body.target_live_date : null;

    const { data, error } = await db.from("releases").insert({
      company_id: (client as any).company_id || null,
      client_id: client.id,
      title, model,
      target_live_date: target,
      status: "building",
      status_timestamps: { building: new Date().toISOString() },
    }).select("id").single();
    if (error || !data) return NextResponse.json({ error: error?.message || "Couldn't create" }, { status: 500 });
    return NextResponse.json({ success: true, dropId: (data as any).id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
