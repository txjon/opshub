import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// POST /api/portal/client/[token]/releases/[releaseId]/items
// Body: { item_id: string }
//
// Moves an item into this release bucket. Because release_items.item_id
// is UNIQUE, this enforces "one release per item" — dragging an item from
// release A to release B physically moves it (delete prior row + insert).

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
    if (!release || release.client_id !== client.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { item_id } = await req.json();
    if (!item_id) return NextResponse.json({ error: "item_id required" }, { status: 400 });

    // Guard: the item must belong to one of this client's jobs. Prevents
    // a bad actor from staging items they don't own into their release.
    const { data: item } = await db
      .from("items")
      .select("id, jobs(client_id)")
      .eq("id", item_id)
      .single();
    if (!item || (item as any).jobs?.client_id !== client.id) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Move: delete any prior assignment of this item across ANY release
    // for this client, then insert into the new one. One-release-per-item
    // is enforced by the unique constraint on item_id.
    await db.from("release_items").delete().eq("item_id", item_id);

    // Compute next sort_order within the destination release
    const { data: tail } = await db
      .from("release_items")
      .select("sort_order")
      .eq("release_id", params.releaseId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextSort = (tail?.[0]?.sort_order || 0) + 10;

    const { error } = await db
      .from("release_items")
      .insert({ release_id: params.releaseId, item_id, sort_order: nextSort });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// DELETE /api/portal/client/[token]/releases/[releaseId]/items?item_id=...
// Removes an item from the release (returns it to the pool).
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
    if (!release || release.client_id !== client.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const itemId = new URL(req.url).searchParams.get("item_id");
    if (!itemId) return NextResponse.json({ error: "item_id required" }, { status: 400 });

    const { error } = await db
      .from("release_items")
      .delete()
      .eq("release_id", params.releaseId)
      .eq("item_id", itemId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
