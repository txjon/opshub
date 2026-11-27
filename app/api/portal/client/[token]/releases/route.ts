import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isRerunLineId, isProductLineId, isCardLineId, briefApproved } from "@/lib/release-lanes";
import { hubClientLookup } from "@/lib/hub-client";
import { clientSheetView, clientBoard, publishedImageIds, publishedFace } from "@/lib/line-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client Hub — RELEASES (mig 134). The client-side release builder:
// gather product lines from ACROSS their ideas into one dated release.
// GET → their releases with slots + per-slot readiness (contributing idea
// approved?) + the published line sheet summary (mig 192). POST → start a release. 'releases' grant required.
// (Renamed from /drops Aug 11 2026; the legacy staging board API moved
// to /staging-releases to free this namespace.)

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function ctxOf(token: string) {
  const db = admin();
  const { data: client } = await hubClientLookup(db, token, "id, name, portal_features, company_id");
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
        .select("id, release_id, brief_id, line_id, format, retail, model, line_notes, sold_units, qtys, qtys_confirmed_at, item_id, sort_order, added_by, line_sheet_item_id, art_briefs(title, state), line_sheet_items(sheet_id, name, item_no, images, client_verdict, dropped)")
        .in("release_id", ids)
        .order("sort_order", { ascending: true });
      // a board card's face = only art he has been shown (lib/line-sheets publishedFace)
      const pubBySheet: Record<string, Set<string>> = {};
      for (const sid of Array.from(new Set(((slots || []) as any[]).map(s => s.line_sheet_items?.sheet_id).filter(Boolean)))) pubBySheet[sid as string] = await publishedImageIds(db, sid as string);
      for (const s of (slots || []) as any[]) {
        // a board card (mig 217): its current name and the picture he's seen
        const card = isCardLineId(s.line_id) ? s.line_sheet_items : null;
        (slotsByRelease[s.release_id] = slotsByRelease[s.release_id] || []).push({
          id: s.id, briefId: s.brief_id, lineId: s.line_id,
          cardId: card ? s.line_sheet_item_id : null,
          cardThumb: card ? publishedFace(card.images, pubBySheet[card.sheet_id] || new Set()) : null,
          cardVerdict: card ? (card.dropped ? "gone" : card.client_verdict || null) : null,
          addedBy: s.added_by || null,
          format: card ? (card.name || s.format) : s.format, retail: s.retail != null ? Number(s.retail) : null,
          model: s.model, notes: s.line_notes,
          soldUnits: s.sold_units, qtys: s.qtys || {}, qtysConfirmedAt: s.qtys_confirmed_at,
          itemId: s.item_id || null,
          rerun: isRerunLineId(s.line_id),
          product: isProductLineId(s.line_id),
          ideaTitle: s.art_briefs?.title || null,
          briefState: s.art_briefs?.state || null,
          // item-sourced lines are real by definition — always ready
          // (pipeline: the run exists; re-run: the design + proofs exist)
          ideaApproved: s.item_id ? true : card ? card.client_verdict === "asis" && !card.dropped : briefApproved(s.art_briefs?.state),
        });
      }
    }
    // His board's As is cards, for the release picker's "From the board" tab
    // (mig 217). Read through THE client view, so only published art shows.
    const boardCards: any[] = [];
    {
      // THE board (lib/line-sheets clientBoard), the same one his tab shows
      const board = await clientBoard(db, client.id);
      if (board) {
        const view = await clientSheetView(db, board);
        for (const it of view.items) if (it.verdict === "asis") boardCards.push({ id: it.id, name: it.name, itemNo: it.item_no, thumb: it.images[0]?.driveId || null });
      }
    }
    const shown = releases || [];
    // Payable for cut drops — read the born job's invoice state (same
    // gating as the order surfaces: nothing shows until the invoice is
    // actually sent or a non-draft payment record exists).
    const cutJobIds = (releases || []).filter((r: any) => r.status === "cut" && r.job_id).map((r: any) => r.job_id);
    const payableByJob: Record<string, any> = {};
    if (cutJobIds.length) {
      const { data: jobs } = await db.from("jobs").select("id, type_meta, qb_invoice_number, qb_invoice_id").in("id", cutJobIds);
      const { data: pays } = await db.from("payment_records").select("job_id, amount, status").in("job_id", cutJobIds);
      for (const j of (jobs || []) as any[]) {
        const tm = j.type_meta || {};
        const jp = (pays || []).filter((p: any) => p.job_id === j.id);
        const sent = !!tm.invoice_sent_at || jp.some((p: any) => p.status && !["draft", "void"].includes(p.status));
        const paid = jp.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + Number(p.amount || 0), 0);
        const total = Number(tm.qb_total_with_tax || 0);
        payableByJob[j.id] = {
          invoiceNumber: sent ? (j.qb_invoice_number || null) : null,
          paymentLink: sent ? (tm.qb_payment_link || null) : null,
          total: sent ? total : null,
          paid,
          state: !sent ? "pending" : (total > 0 && paid >= total - 0.005) ? "paid" : "ready",
        };
      }
    }
    // Committed designs — already planned/ordered/produced. The picker
    // excludes them (the server guard on slot POST enforces the same).
    const committed = new Set<string>();
    for (const r of (releases || []) as any[]) {
      if (r.status === "cut") continue;
      for (const sl of slotsByRelease[r.id] || []) if (sl.briefId) committed.add(sl.briefId);
    }
    const { data: clientBriefs } = await db.from("art_briefs").select("id").eq("client_id", client.id);
    const bids = (clientBriefs || []).map((b: any) => b.id);
    if (bids.length) {
      const { data: reqs } = await db.from("lab_order_requests").select("brief_id").in("brief_id", bids).is("handled_at", null);
      for (const r of (reqs || []) as any[]) if (r.brief_id) committed.add(r.brief_id);
      const { data: borns } = await db.from("items").select("design_id").in("design_id", bids);
      for (const b of (borns || []) as any[]) if (b.design_id) committed.add(b.design_id);
    }
    return NextResponse.json({
      committedBriefIds: Array.from(committed),
      boardCards,
      drops: shown.map((r: any) => ({
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
    // no name sent (the Planner's "+ New release"): the next number, like
    // the Schedule's own button ("Release 03")
    let title = String(body.title || "").trim().slice(0, 120);
    if (!title) {
      const { count } = await db.from("releases").select("id", { count: "exact", head: true }).eq("client_id", client.id);
      title = `Release ${String((count || 0) + 1).padStart(2, "0")}`;
    }
    // No model at the door (Aug 12 2026): the lineup decides what a release
    // is — pipeline-only launches, anything else sells/cuts. Column kept for
    // legacy rows; new releases are born model-null.
    const target = /^\d{4}-\d{2}-\d{2}$/.test(String(body.target_live_date || "")) ? body.target_live_date : null;

    const { data, error } = await db.from("releases").insert({
      company_id: (client as any).company_id || null,
      client_id: client.id,
      title, model: null,
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
