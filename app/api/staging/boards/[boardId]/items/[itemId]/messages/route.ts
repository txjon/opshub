import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const admin = () =>
  createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// GET — list messages for an item
export async function GET(req: NextRequest, { params }: { params: { boardId: string; itemId: string } }) {
  try {
    // Allow both authenticated and share-token access
    const shareToken = req.nextUrl.searchParams.get("share");
    let sb: any;

    if (shareToken) {
      sb = admin();
      // Verify share token matches board
      const { data: board } = await sb
        .from("staging_boards")
        .select("id")
        .eq("id", params.boardId)
        .eq("share_token", shareToken)
        .single();
      if (!board) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    } else {
      sb = await createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await (shareToken ? sb : admin())
      .from("staging_item_messages")
      .select("*")
      .eq("item_id", params.itemId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data || []);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — add a message
export async function POST(req: NextRequest, { params }: { params: { boardId: string; itemId: string } }) {
  try {
    const body = await req.json();
    const { message, sender_type, sender_name } = body;
    if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });

    const shareToken = body.share_token;
    let sb: any;

    if (shareToken) {
      sb = admin();
      const { data: board } = await sb
        .from("staging_boards")
        .select("id")
        .eq("id", params.boardId)
        .eq("share_token", shareToken)
        .single();
      if (!board) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    } else {
      sb = await createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await admin()
      .from("staging_item_messages")
      .insert({
        item_id: params.itemId,
        sender_type: shareToken ? "client" : (sender_type || "internal"),
        sender_name: sender_name || (shareToken ? "Client" : "HPD"),
        message: message.trim(),
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
