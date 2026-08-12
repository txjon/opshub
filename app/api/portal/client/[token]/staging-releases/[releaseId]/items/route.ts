import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// POST /api/portal/client/[token]/releases/[releaseId]/items
// Body: { item_id?: string, proposal_id?: string }  (exactly one)
//
// Moves an item OR client_proposal_items entry into this release bucket.
// Each can live in at most one release (partial unique indexes on
// release_items.item_id and .proposal_id), so dragging from another
// release physically moves it.

export async function POST(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const db = admin();
    const { data: client } = await db.from("clients").select("id").eq("portal_token", params.token).single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { data: release } = await db
      .from("client_releases")
      .select("id, client_id")
      .eq("id", params.releaseId)
      .single();
    if (!release || (release as any).client_id !== (client as any).id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const itemId = body.item_id || null;
    const proposalId = body.proposal_id || null;
    const explicitRow = typeof body.row_index === "number" ? body.row_index : null;
    const explicitSort = typeof body.sort_order === "number" ? body.sort_order : null;
    if (!itemId && !proposalId) {
      return NextResponse.json({ error: "item_id or proposal_id required" }, { status: 400 });
    }
    if (itemId && proposalId) {
      return NextResponse.json({ error: "Provide exactly one of item_id / proposal_id" }, { status: 400 });
    }

    if (itemId) {
      // Item must belong to one of this client's jobs.
      const { data: item } = await db
        .from("items")
        .select("id, jobs(client_id)")
        .eq("id", itemId)
        .single();
      if (!item || (item as any).jobs?.client_id !== (client as any).id) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      await db.from("release_items").delete().eq("item_id", itemId);
    } else {
      // Proposal must belong to this client.
      const { data: proposal } = await db
        .from("client_proposal_items")
        .select("id, client_id")
        .eq("id", proposalId)
        .single();
      if (!proposal || (proposal as any).client_id !== (client as any).id) {
        return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      }
      await db.from("release_items").delete().eq("proposal_id", proposalId);
    }

    // Resolve target row + position. If caller supplied row_index, use
    // it; otherwise default to row 0. Within the chosen row, default to
    // appending at the end if no sort_order was supplied.
    const targetRow = explicitRow ?? 0;
    let nextSort = explicitSort;
    if (nextSort === null) {
      const { data: rowTail } = await db
        .from("release_items")
        .select("sort_order")
        .eq("release_id", params.releaseId)
        .eq("row_index", targetRow)
        .order("sort_order", { ascending: false })
        .limit(1);
      nextSort = ((rowTail as any)?.[0]?.sort_order || 0) + 10;
    }

    const insertRow: any = { release_id: params.releaseId, sort_order: nextSort, row_index: targetRow };
    if (itemId) insertRow.item_id = itemId;
    if (proposalId) insertRow.proposal_id = proposalId;

    const { error } = await db.from("release_items").insert(insertRow);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// DELETE /api/portal/client/[token]/releases/[releaseId]/items?item_id=... | ?proposal_id=...
// Removes either an item or a proposal from the release (returns to pool).
export async function DELETE(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const db = admin();
    const { data: client } = await db.from("clients").select("id").eq("portal_token", params.token).single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { data: release } = await db
      .from("client_releases")
      .select("id, client_id")
      .eq("id", params.releaseId)
      .single();
    if (!release || (release as any).client_id !== (client as any).id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(req.url);
    const itemId = url.searchParams.get("item_id");
    const proposalId = url.searchParams.get("proposal_id");
    if (!itemId && !proposalId) {
      return NextResponse.json({ error: "item_id or proposal_id required" }, { status: 400 });
    }

    let q = db.from("release_items").delete().eq("release_id", params.releaseId);
    if (itemId) q = q.eq("item_id", itemId);
    if (proposalId) q = q.eq("proposal_id", proposalId);
    const { error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
