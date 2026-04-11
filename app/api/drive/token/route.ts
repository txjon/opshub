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

    // Standard item folder request
    const { clientName, projectTitle, itemName } = body;
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
