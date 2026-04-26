import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/items/add-with-graphic
// Body: { job_id, name, drive_link, drive_file_id, file_name?, mime_type?, file_size? }
//
// Creates a fresh item under an existing job with the print-ready graphic
// pre-attached (items.drive_link + an item_files row at stage=print_ready).
// Used by the Art Studio "Add to existing project" flow when HPD wants to
// reuse a finished graphic on a new product.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { job_id, name, drive_link, drive_file_id, file_name, mime_type, file_size } = await req.json();
    if (!job_id || !name || !drive_link) {
      return NextResponse.json({ error: "job_id, name, and drive_link required" }, { status: 400 });
    }

    // Determine sort_order — append to end of the job's items
    const { count } = await supabase.from("items").select("id", { count: "exact", head: true }).eq("job_id", job_id);

    const { data: item, error: itemErr } = await supabase
      .from("items")
      .insert({
        job_id,
        name,
        drive_link,
        sort_order: count || 0,
      })
      .select("id")
      .single();
    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });

    if (drive_file_id) {
      await supabase.from("item_files").insert({
        item_id: (item as any).id,
        file_name: file_name || name,
        stage: "print_ready",
        drive_file_id,
        drive_link,
        mime_type: mime_type || null,
        file_size: file_size || null,
        uploaded_by: user.id,
      });
    }

    return NextResponse.json({ item });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
