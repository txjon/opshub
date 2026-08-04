import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { setFilePublicReadable, getDriveWebLink } from "@/lib/drive-resumable";
import { notifyTeamServer, logJobActivityServer } from "@/lib/notify-server";
import { generatePsdPreview, isPsdFile } from "@/lib/psd-preview-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: designer } = await db.from("designers").select("id, active, name").eq("portal_token", token).single();
  if (!designer || !designer.active) return null;
  const { data: brief } = await db.from("art_briefs").select("id, title, assigned_designer_id, state, item_id, job_id, client_aborted_at").eq("id", briefId).single();
  // Aborted/archived briefs are recalled from the designer side.
  if (!brief || brief.assigned_designer_id !== designer.id || brief.client_aborted_at) return null;
  return { db, designer, brief };
}

// WIP retired 2026-05-17 — first_draft is the designer's first
// deliverable. The `wip` kind is no longer accepted by the API.
const DESIGNER_KINDS = ["first_draft", "revision", "final"];

export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  try {
    const ctx = await verifyAccess(params.token, params.briefId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { drive_file_id, file_name, mime_type, file_size, kind, note } = await req.json();
    if (!drive_file_id || !file_name) {
      return NextResponse.json({ error: "drive_file_id, file_name required" }, { status: 400 });
    }
    const requested = (kind || "first_draft").toLowerCase();
    if (!DESIGNER_KINDS.includes(requested)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });

    // Auto-promote subsequent 1st Draft uploads to "revision" so the
    // label sequence reads "1st Draft → 2nd Draft → 3rd Draft → …"
    // (formatFileLabel maps revision #N to the (N+1)th draft). Saves
    // the designer from having to manually pick "Revision" — the very
    // first first_draft upload is the only one stored under that kind.
    let k = requested;
    if (k === "first_draft") {
      const { count: firstDraftCount } = await ctx.db.from("art_brief_files")
        .select("id", { count: "exact", head: true })
        .eq("brief_id", ctx.brief.id).eq("kind", "first_draft");
      if ((firstDraftCount || 0) > 0) k = "revision";
    }

    try { await setFilePublicReadable(drive_file_id); } catch {}
    const webViewLink = await getDriveWebLink(drive_file_id);

    // Version per kind (computed against the effective kind so promoted
    // revisions get the right sequence number for the "Nth Draft" label).
    const { count } = await ctx.db.from("art_brief_files").select("id", { count: "exact", head: true })
      .eq("brief_id", ctx.brief.id).eq("kind", k);
    const version = (count || 0) + 1;

    const noteTrimmed = (note || "").trim() || null;
    const { data, error } = await ctx.db.from("art_brief_files").insert({
      brief_id: ctx.brief.id,
      file_name,
      drive_file_id,
      drive_link: webViewLink,
      mime_type: mime_type || null,
      file_size: file_size || null,
      kind: k,
      version,
      uploader_role: "designer",
      designer_annotation: noteTrimmed,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // PSD preview — Drive can't auto-thumbnail layered Photoshop files.
    // Render a flattened PNG and store its drive_id for the tile thumb.
    // Fire-and-forget so the upload response stays fast.
    if (data?.id && isPsdFile(file_name, mime_type)) {
      generatePsdPreview(drive_file_id, file_name).then(async (previewId) => {
        if (previewId) {
          await ctx.db.from("art_brief_files")
            .update({ preview_drive_file_id: previewId })
            .eq("id", data.id);
        }
      }).catch(() => {});
    }

    // Auto state transition. WIP path retired — first_draft is the
    // first designer deliverable, going straight to client_review.
    const now = new Date().toISOString();
    let newState = (ctx.brief as any).state;
    if (k === "first_draft") newState = "working";
    if (k === "revision") newState = "working";
    if (k === "final") newState = "working";

    await ctx.db.from("art_briefs").update({
      state: newState,
      version_count: version,
      updated_at: now,
    }).eq("id", ctx.brief.id);

    const kindLabel: Record<string, string> = {
      first_draft: "1st Draft", revision: "Revision", final: "FINAL",
    };
    const activityMsg = `Designer uploaded ${kindLabel[k] || k.toUpperCase()} v${version} for "${(ctx.brief as any).title || "brief"}"`;

    try {
      await notifyTeamServer(activityMsg, k === "final" ? "approval" : "production", ctx.brief.id, "art_brief");
      if ((ctx.brief as any).job_id) await logJobActivityServer((ctx.brief as any).job_id, activityMsg);
    } catch {}

    return NextResponse.json({ file: data, state: newState });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
