import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    // Use service role — this is a public endpoint, no user auth
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { password } = await req.json();

    const { data: board, error } = await supabase
      .from("staging_boards")
      .select("*")
      .eq("share_token", params.token)
      .single();

    if (error || !board) return NextResponse.json({ error: "Board not found" }, { status: 404 });

    // Verify password
    if (board.share_password_hash) {
      if (!password) return NextResponse.json({ error: "Password required" }, { status: 401 });
      const valid = await bcrypt.compare(password, board.share_password_hash);
      if (!valid) return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    // Fetch items with images
    const { data: items } = await supabase
      .from("staging_items")
      .select("*, staging_item_images(id, storage_path, filename)")
      .eq("board_id", board.id)
      .order("sort_order");

    const itemsWithUrls = await Promise.all((items || []).map(async (item: any) => {
      const images = await Promise.all((item.staging_item_images || []).map(async (img: any) => {
        const { data } = await supabase.storage.from("staging-images").createSignedUrl(img.storage_path, 3600);
        return { ...img, url: data?.signedUrl || null };
      }));
      return { ...item, images, staging_item_images: undefined };
    }));

    return NextResponse.json({
      id: board.id,
      name: board.name,
      client_name: board.client_name,
      summary_label: board.summary_label,
      items: itemsWithUrls,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
