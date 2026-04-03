import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("staging_boards")
      .select("*, staging_items(id)")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const boards = (data || []).map(b => ({
      ...b,
      item_count: b.staging_items?.length || 0,
      staging_items: undefined,
    }));

    return NextResponse.json(boards);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name, client_name, password } = await req.json();
    if (!name || !client_name) return NextResponse.json({ error: "Name and client required" }, { status: 400 });

    const share_password_hash = password ? await bcrypt.hash(password, 10) : null;

    const { data, error } = await supabase
      .from("staging_boards")
      .insert({ name, client_name, share_password_hash })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
