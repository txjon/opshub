export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getItemFolderId, uploadFile } from "@/lib/google-drive";

// Materialize Shopify product images as Drive mockups on freshly-pushed items.
// Called by the e-comm push-to-production flow: for each item with a public
// Shopify image URL, fetch it, upload to the item's Drive folder named
// "{item name} mockup.{ext}", and write a stage='mockup' item_files row so it
// lights up the Product Builder mockup slot — the same path a manual upload
// takes. Auto-approved (for pre-orders the storefront render IS the proof).
//
// Sequential by design: getItemFolderId find-or-creates Client/Project/Item
// folders, and running items in parallel can race two copies of the same
// project folder. Best-effort per item — one bad image never fails the batch.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { clientName, projectTitle, items } = await req.json();
    if (!clientName || !projectTitle || !Array.isArray(items)) {
      return NextResponse.json({ error: "Missing clientName, projectTitle, or items" }, { status: 400 });
    }

    let imported = 0, skipped = 0, failed = 0;
    const results: { itemId: string; ok: boolean; skipped?: boolean; error?: string }[] = [];

    for (const it of items) {
      const itemId: string = it?.itemId;
      const name: string = (it?.name || "").trim();
      const imageUrl: string = (it?.imageUrl || "").trim();
      if (!itemId || !name || !imageUrl) {
        skipped++; results.push({ itemId, ok: false, skipped: true }); continue;
      }

      try {
        // Idempotent: don't double-add if this item already has a live mockup.
        const { data: existing } = await supabase
          .from("item_files")
          .select("id")
          .eq("item_id", itemId)
          .eq("stage", "mockup")
          .is("superseded_at", null)
          .limit(1);
        if (existing && existing.length > 0) {
          skipped++; results.push({ itemId, ok: true, skipped: true }); continue;
        }

        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const mime = res.headers.get("content-type")?.split(";")[0].trim() || "image/png";
        const ext = mime === "image/jpeg" ? "jpg"
          : mime === "image/webp" ? "webp"
          : mime === "image/png" ? "png"
          : (imageUrl.split("?")[0].match(/\.(png|jpe?g|webp)$/i)?.[1] || "png").toLowerCase();
        const buffer = Buffer.from(await res.arrayBuffer());
        const fileName = `${name} mockup.${ext}`;

        const folderId = await getItemFolderId(clientName, projectTitle, name);
        const up = await uploadFile(folderId, fileName, mime, buffer);

        const { error: insErr } = await (supabase.from("item_files") as any).insert({
          item_id: itemId,
          file_name: fileName,
          stage: "mockup",
          drive_file_id: up.fileId,
          drive_link: up.webViewLink,
          mime_type: mime,
          file_size: buffer.length,
          approval: "approved",
          approved_at: new Date().toISOString(),
          uploaded_by: user.id,
        });
        if (insErr) throw new Error(insErr.message);

        // Printer needs the folder (mockup + print file + proof all live here).
        await (supabase.from("items") as any)
          .update({ drive_link: `https://drive.google.com/drive/folders/${folderId}` })
          .eq("id", itemId);

        imported++; results.push({ itemId, ok: true });
      } catch (e: any) {
        failed++; results.push({ itemId, ok: false, error: e?.message || "failed" });
      }
    }

    return NextResponse.json({ imported, skipped, failed, results });
  } catch (e: any) {
    console.error("import-mockups error:", e);
    return NextResponse.json({ error: e.message || "Import failed" }, { status: 500 });
  }
}
