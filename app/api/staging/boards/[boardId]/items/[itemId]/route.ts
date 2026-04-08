import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest, { params }: { params: { boardId: string; itemId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const updates = await req.json();
    const allowed = ["item_name", "qty", "unit_cost", "retail", "status", "notes", "sort_order", "eta", "payment_received"];
    const dbUpdates: any = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) dbUpdates[key] = updates[key];
    }
    dbUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("staging_items")
      .update(dbUpdates)
      .eq("id", params.itemId)
      .eq("board_id", params.boardId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { boardId: string; itemId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Delete images from storage first
    const { data: images } = await supabase
      .from("staging_item_images")
      .select("storage_path")
      .eq("item_id", params.itemId);

    if (images?.length) {
      await supabase.storage.from("staging-images").remove(images.map(i => i.storage_path));
    }

    const { error } = await supabase
      .from("staging_items")
      .delete()
      .eq("id", params.itemId)
      .eq("board_id", params.boardId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
