import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function getAuth() {
  let key: any;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "";
    key = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "jon@housepartydistro.com" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const drive = google.drive({ version: "v3", auth: getAuth() });

    // Get all items that have files but no drive_link or a file-level link
    const { data: items } = await supabase
      .from("items")
      .select("id, drive_link, item_files(drive_file_id)")
      .not("item_files", "is", null);

    if (!items) return NextResponse.json({ error: "No items" }, { status: 404 });

    let updated = 0;
    for (const item of items) {
      const files = (item as any).item_files || [];
      if (files.length === 0) continue;

      // Skip if already a folder link
      if (item.drive_link?.includes("/folders/")) continue;

      // Get parent folder of first file
      const fileId = files[0].drive_file_id;
      if (!fileId) continue;

      try {
        const res = await drive.files.get({ fileId, fields: "parents" });
        const parentId = res.data.parents?.[0];
        if (parentId) {
          const folderLink = `https://drive.google.com/drive/folders/${parentId}`;
          await supabase.from("items").update({ drive_link: folderLink }).eq("id", item.id);
          updated++;
        }
      } catch (e) {
        // File might be deleted, skip
        continue;
      }
    }

    return NextResponse.json({ success: true, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
