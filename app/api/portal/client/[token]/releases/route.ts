import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function resolveClient(token: string) {
  const db = admin();
  const { data: client } = await db
    .from("clients")
    .select("id, name")
    .eq("portal_token", token)
    .single();
  return client;
}

// GET /api/portal/client/[token]/releases
//
// Returns every release bucket for this client plus the items in each.
// One call powers the whole Staging board.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const client = await resolveClient(params.token);
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const db = admin();
    const { data: releases } = await db
      .from("client_releases")
      .select("id, title, target_date, sort_order, created_at")
      .eq("client_id", client.id)
      .order("sort_order", { ascending: true });

    const ids = (releases || []).map((r: any) => r.id);
    let itemsByRelease: Record<string, string[]> = {};
    let proposalsByRelease: Record<string, string[]> = {};
    // rows: per-release 2D array — outer = row_index, inner = tiles in
    // sort_order. Drives the staging Brand Planner layout. Empty rows
    // are dropped client-side so the array stays dense.
    let rowsByRelease: Record<string, Array<Array<{ kind: "item" | "proposal"; id: string }>>> = {};
    if (ids.length > 0) {
      const { data: ri } = await db
        .from("release_items")
        .select("release_id, item_id, proposal_id, sort_order, row_index")
        .in("release_id", ids)
        .order("row_index", { ascending: true })
        .order("sort_order", { ascending: true });
      for (const r of (ri || [])) {
        const rid = (r as any).release_id;
        if ((r as any).item_id) (itemsByRelease[rid] ||= []).push((r as any).item_id);
        if ((r as any).proposal_id) (proposalsByRelease[rid] ||= []).push((r as any).proposal_id);
        const rowIdx = (r as any).row_index ?? 0;
        const buckets = rowsByRelease[rid] ||= [];
        // Pad sparse rows so row_index 5 lands at index 5 even when
        // 0..4 are empty. Empty rows get filtered out below.
        while (buckets.length <= rowIdx) buckets.push([]);
        const kind: "item" | "proposal" = (r as any).item_id ? "item" : "proposal";
        const id = (r as any).item_id || (r as any).proposal_id;
        if (id) buckets[rowIdx].push({ kind, id });
      }
      // Drop fully-empty rows and re-index so the client never sees gaps.
      for (const k of Object.keys(rowsByRelease)) {
        rowsByRelease[k] = rowsByRelease[k].filter(row => row.length > 0);
      }
    }

    return NextResponse.json({
      releases: (releases || []).map((r: any) => ({
        ...r,
        item_ids: itemsByRelease[r.id] || [],
        proposal_ids: proposalsByRelease[r.id] || [],
        rows: rowsByRelease[r.id] || [],
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// POST /api/portal/client/[token]/releases
// Body: { title: string, target_date?: string }
// Create a new release bucket.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const client = await resolveClient(params.token);
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const body = await req.json();
    const title = (body.title || "").toString().trim();
    if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

    const db = admin();
    // Next sort_order = max + 10
    const { data: existing } = await db
      .from("client_releases")
      .select("sort_order")
      .eq("client_id", client.id)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextSort = (existing?.[0]?.sort_order || 0) + 10;

    const { data, error } = await db
      .from("client_releases")
      .insert({
        client_id: client.id,
        title,
        target_date: body.target_date || null,
        sort_order: nextSort,
      })
      .select("id, title, target_date, sort_order, created_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ release: { ...data, item_ids: [] } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
