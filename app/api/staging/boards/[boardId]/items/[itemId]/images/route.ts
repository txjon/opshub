import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest, { params }: { params: { boardId: string; itemId: string } }) {
  try {
    // Allow share token auth for client uploads
    const shareToken = req.nextUrl.searchParams.get("share");
    let supabase: any;

    if (shareToken) {
      const sb = admin();
      const { data: board } = await sb.from("staging_boards").select("id").eq("id", params.boardId).eq("share_token", shareToken).single();
      if (!board) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      supabase = sb;
    } else {
      supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const ext = file.name.split(".").pop() || "jpg";
    const storagePath = `${params.boardId}/${params.itemId}/${Date.now()}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from("staging-images")
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    const { data: row, error: dbError } = await supabase
      .from("staging_item_images")
      .insert({ item_id: params.itemId, storage_path: storagePath, filename: file.name })
      .select("*")
      .single();

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    // Return signed URL
    const { data: urlData } = await supabase.storage.from("staging-images").createSignedUrl(storagePath, 3600);

    return NextResponse.json({ ...row, url: urlData?.signedUrl || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { boardId: string; itemId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { imageId } = await req.json();
    if (!imageId) return NextResponse.json({ error: "Missing imageId" }, { status: 400 });

    const { data: img } = await supabase
      .from("staging_item_images")
      .select("storage_path")
      .eq("id", imageId)
      .single();

    if (img?.storage_path) {
      await supabase.storage.from("staging-images").remove([img.storage_path]);
    }

    await supabase.from("staging_item_images").delete().eq("id", imageId);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
