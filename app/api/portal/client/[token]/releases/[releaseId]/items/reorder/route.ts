import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// PATCH /api/portal/client/[token]/releases/[releaseId]/items/reorder
// Body: { ordered: [{ kind: "item" | "proposal", id: string }] }
//
// Rewrites sort_order on the release's release_items rows so they match
// the supplied order. Tiles not present in the array are left alone (so
// a partial array is safe for in-page optimistic updates).

export async function PATCH(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const db = admin();
    const { data: client } = await db.from("clients").select("id").eq("portal_token", params.token).single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { data: release } = await db
      .from("client_releases")
      .select("id, client_id")
      .eq("id", params.releaseId)
      .single();
    if (!release || (release as any).client_id !== (client as any).id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    // Two payload shapes supported:
    //   • { rows: [[{kind,id}, ...], ...] }  — full row layout (Brand
    //     Planner default). row_index = outer index, sort_order =
    //     (innerIndex + 1) * 10.
    //   • { ordered: [{kind,id}, ...] }      — single flat list, kept for
    //     legacy callers; written with row_index = 0.
    const rows: Array<Array<{ kind: string; id: string }>> | undefined = body.rows;
    const ordered: Array<{ kind: string; id: string }> | undefined = body.ordered;

    if (rows) {
      if (!Array.isArray(rows)) return NextResponse.json({ error: "rows must be an array" }, { status: 400 });
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
          const entry = row[c];
          const filterCol = entry.kind === "item" ? "item_id" : "proposal_id";
          await db
            .from("release_items")
            .update({ row_index: r, sort_order: (c + 1) * 10 })
            .eq("release_id", params.releaseId)
            .eq(filterCol, entry.id);
        }
      }
    } else if (ordered) {
      if (!Array.isArray(ordered)) return NextResponse.json({ error: "ordered must be an array" }, { status: 400 });
      for (let i = 0; i < ordered.length; i++) {
        const entry = ordered[i];
        const filterCol = entry.kind === "item" ? "item_id" : "proposal_id";
        await db
          .from("release_items")
          .update({ row_index: 0, sort_order: (i + 1) * 10 })
          .eq("release_id", params.releaseId)
          .eq(filterCol, entry.id);
      }
    } else {
      return NextResponse.json({ error: "rows or ordered required" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
