import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import bcrypt from "bcryptjs";

export async function GET(req: NextRequest, { params }: { params: { boardId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: board, error } = await supabase
      .from("staging_boards")
      .select("*")
      .eq("id", params.boardId)
      .single();

    if (error || !board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

    const { data: items } = await supabase
      .from("staging_items")
      .select("*, staging_item_images(id, storage_path, filename)")
      .eq("board_id", params.boardId)
      .order("sort_order");

    // Generate signed URLs for images
    const itemsWithUrls = await Promise.all((items || []).map(async (item: any) => {
      const images = await Promise.all((item.staging_item_images || []).map(async (img: any) => {
        const { data } = await supabase.storage.from("staging-images").createSignedUrl(img.storage_path, 3600);
        return { ...img, url: data?.signedUrl || null };
      }));
      return { ...item, images, staging_item_images: undefined };
    }));

    return NextResponse.json({ ...board, items: itemsWithUrls });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { boardId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const updates = await req.json();
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.client_name !== undefined) dbUpdates.client_name = updates.client_name;
    if (updates.summary_label !== undefined) dbUpdates.summary_label = updates.summary_label;
    if (updates.password !== undefined) {
      dbUpdates.share_password_hash = updates.password ? await bcrypt.hash(updates.password, 10) : null;
    }
    dbUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("staging_boards")
      .update(dbUpdates)
      .eq("id", params.boardId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
