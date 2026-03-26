import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveToken, getItemFolderIdDirect } from "@/lib/drive-token";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientName, projectTitle, itemName } = await req.json();
    if (!clientName || !projectTitle || !itemName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const token = await getDriveToken();
    const folderId = await getItemFolderIdDirect(token, clientName, projectTitle, itemName);

    return NextResponse.json({ token, folderId });
  } catch (e: any) {
    console.error("Drive token error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
