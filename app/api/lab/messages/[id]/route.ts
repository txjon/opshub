import { NextRequest, NextResponse } from "next/server";
import { labDb, LAB_BUCKET } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE one message — used to remove an attachment from a thread. Studio-side
// only (the lab is open, service-role); the client hub never calls this.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = labDb();
  const { data: msg } = await db.from("lab_messages").select("id, thread_id, file_url").eq("id", params.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await db.from("lab_messages").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const fileUrl = (msg as any).file_url as string | null;
  if (fileUrl) {
    // If this exact file was the locked approved design, clear the lock so the
    // thread never points at a deleted image.
    await db.from("lab_threads").update({ approved_file_url: null } as never)
      .eq("id", (msg as any).thread_id).eq("approved_file_url", fileUrl);
    // Best-effort: drop the storage object too (public bucket path after /<bucket>/).
    const marker = `/${LAB_BUCKET}/`;
    const at = fileUrl.indexOf(marker);
    if (at !== -1) {
      const path = decodeURIComponent(fileUrl.slice(at + marker.length));
      try { await db.storage.from(LAB_BUCKET).remove([path]); } catch { /* orphan is harmless */ }
    }
  }
  return NextResponse.json({ ok: true });
}
