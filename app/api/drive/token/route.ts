import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveToken, getItemFolderIdDirect, getReceivingFolderId, getPackingSlipFolderId } from "@/lib/drive-token";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();

    // Receiving folder request
    if (body.receiving && body.shipmentLabel) {
      const token = await getDriveToken();
      const folderId = await getReceivingFolderId(token, body.shipmentLabel);
      return NextResponse.json({ token, folderId });
    }

    // Packing slip folder request
    if (body.packingSlip && body.clientName && body.projectTitle) {
      const token = await getDriveToken();
      const folderId = await getPackingSlipFolderId(token, body.clientName, body.projectTitle);
      return NextResponse.json({ token, folderId });
    }

    // Standard item folder request — soft fallbacks so a partially-filled
    // job (no title yet, etc.) still uploads instead of silently failing.
    // The folder name is just for organization; the item is also tracked
    // by item_id in the DB so a placeholder folder name is harmless.
    const clientName = (body.clientName && String(body.clientName).trim()) || "Unknown Client";
    const projectTitle = (body.projectTitle && String(body.projectTitle).trim()) || "Untitled Project";
    const itemName = (body.itemName && String(body.itemName).trim()) || "Untitled Item";

    const token = await getDriveToken();
    const folderId = await getItemFolderIdDirect(token, clientName, projectTitle, itemName);

    return NextResponse.json({ token, folderId });
  } catch (e: any) {
    console.error("Drive token error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
