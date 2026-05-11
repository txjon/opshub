import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getDriveToken, renameDriveFolder } from "@/lib/drive-token";

export const dynamic = "force-dynamic";

// POST /api/drive/rename
// Body: { entity: "client" | "job" | "item"; id: string; name?: string }
//
// Renames the Drive folder backing the given row in place. The
// folder ID never changes — anything that references the folder
// (item.drive_link, PO links, the stashed *_folder_id on parent
// rows) stays valid.
//
// Fires after a client.name / job.title / item.name edit on the
// Overview tab, Client detail, or Buy Sheet. No-op when the row
// has no drive_folder_id yet (no files uploaded → no folder to
// rename → next upload will create it with the new name).
//
// `name` is optional. When omitted, the route reads the row and
// uses the current value. Pass it explicitly to avoid a race where
// the caller fires this before the DB update lands.

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const TABLE_BY_ENTITY: Record<string, { table: string; nameCol: string }> = {
  client: { table: "clients", nameCol: "name" },
  job: { table: "jobs", nameCol: "title" },
  item: { table: "items", nameCol: "name" },
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const entity = String(body.entity || "").toLowerCase();
    const id = body.id ? String(body.id) : "";
    const explicitName: string | undefined = typeof body.name === "string" ? body.name : undefined;

    const cfg = TABLE_BY_ENTITY[entity];
    if (!cfg) return NextResponse.json({ error: `Invalid entity "${entity}"` }, { status: 400 });
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const db = admin();
    const { data: row, error } = await db
      .from(cfg.table as any)
      .select(`id, drive_folder_id, ${cfg.nameCol}`)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: `${entity} not found` }, { status: 404 });

    const folderId = (row as any).drive_folder_id;
    const name = explicitName ?? (row as any)[cfg.nameCol];

    if (!folderId) {
      // No folder yet — first upload will create it with the new name.
      return NextResponse.json({ skipped: "no folder yet", entity, id });
    }
    if (!name || !String(name).trim()) {
      return NextResponse.json({ skipped: "empty name", entity, id });
    }

    const token = await getDriveToken();
    await renameDriveFolder(token, folderId, String(name));

    return NextResponse.json({ ok: true, entity, id, folderId, newName: name });
  } catch (e: any) {
    console.error("[drive/rename]", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
