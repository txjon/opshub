import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

// POST — HPD posts a comment on a file. Body: { fileId, body }
//
// Auth is verified via the cookie client; the actual insert uses the
// service-role admin client so it bypasses art_brief_file_comments RLS
// (which has no policies — designer/client routes follow the same
// pattern via their token verification).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fileId, body } = await req.json();
    const text = (body || "").trim();
    if (!fileId || !text) return NextResponse.json({ error: "fileId and body required" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: file } = await admin.from("art_brief_files").select("id, brief_id").eq("id", fileId).single();
    if (!file || file.brief_id !== params.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await admin.from("art_brief_file_comments").insert({
      file_id: fileId,
      brief_id: params.id,
      sender_role: "hpd",
      body: text,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ comment: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
