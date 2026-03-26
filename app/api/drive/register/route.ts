import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fileId, webViewLink, fileName, mimeType, fileSize, itemId, stage } = await req.json();

    if (!fileId || !itemId || !stage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data, error } = await supabase.from("item_files").insert({
      item_id: itemId,
      file_name: fileName,
      stage,
      drive_file_id: fileId,
      drive_link: webViewLink,
      mime_type: mimeType,
      file_size: fileSize,
      approval: stage === "proof" ? "pending" : "none",
      uploaded_by: user.id,
    }).select("*").single();

    if (error) throw new Error(error.message);

    // Auto-update item's drive_link for print-ready files
    if (stage === "print_ready") {
      await supabase.from("items").update({ drive_link: webViewLink }).eq("id", itemId);
    }

    return NextResponse.json({ success: true, file: data });
  } catch (e: any) {
    console.error("Register error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
