import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveToken, getItemFolderIdDirect, getItemFolderIdForItem, getReceivingFolderId, getPackingSlipFolderId } from "@/lib/drive-token";

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

    // Standard item folder request. Prefer the item-id path — it reads
    // the stashed drive_folder_id on items/jobs/clients so a memo or
    // name rename doesn't split files into a new sibling folder.
    // Falls back to the legacy string-path resolver only when itemId
    // isn't provided (toolkit / standalone tools that have no item row).
    const token = await getDriveToken();
    let folderId: string;
    if (body.itemId && typeof body.itemId === "string") {
      folderId = await getItemFolderIdForItem(token, body.itemId);
    } else {
      const clientName = (body.clientName && String(body.clientName).trim()) || "Unknown Client";
      const projectTitle = (body.projectTitle && String(body.projectTitle).trim()) || "Untitled Project";
      const itemName = (body.itemName && String(body.itemName).trim()) || "Untitled Item";
      folderId = await getItemFolderIdDirect(token, clientName, projectTitle, itemName);
    }

    return NextResponse.json({ token, folderId });
  } catch (e: any) {
    console.error("Drive token error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
