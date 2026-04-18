import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import crypto from "crypto";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET /api/portal/client/[token]
// Returns all art briefs for the client identified by the portal token,
// plus per-brief intake tokens so the front-end can deep-link to
// /art-intake/[token] for each one.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await db
      .from("clients")
      .select("id, name")
      .eq("portal_token", params.token)
      .single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { data: briefs } = await db
      .from("art_briefs")
      .select(
        "id, title, state, deadline, client_intake_token, client_intake_submitted_at, purpose, audience, mood_words, no_gos, created_at, updated_at, job_id, jobs(title, job_number)"
      )
      .eq("client_id", client.id)
      .not("state", "in", "(delivered)")
      .order("updated_at", { ascending: false });

    const briefList = (briefs || []) as any[];
    const ids = briefList.map(b => b.id);

    let filesByBrief: Record<string, any[]> = {};
    if (ids.length > 0) {
      const { data: files } = await db
        .from("art_brief_files")
        .select("brief_id, drive_file_id, drive_link, kind, created_at")
        .in("brief_id", ids);
      const rank: Record<string, number> = { final: 4, wip: 3, reference: 2, client_intake: 1 };
      (files || []).forEach((f: any) => {
        (filesByBrief[f.brief_id] ||= []).push(f);
      });
      Object.keys(filesByBrief).forEach(bid => {
        filesByBrief[bid].sort((a, b) => (rank[b.kind] || 0) - (rank[a.kind] || 0));
      });
    }

    // Mint intake tokens for briefs that don't have one yet, so every link
    // in the portal works without extra round-trips.
    const needsToken = briefList.filter(b => !b.client_intake_token);
    for (const b of needsToken) {
      const t = crypto.randomBytes(16).toString("hex");
      await db.from("art_briefs").update({ client_intake_token: t }).eq("id", b.id);
      b.client_intake_token = t;
    }

    const out = briefList.map(b => {
      const files = filesByBrief[b.id] || [];
      const thumbs = files.slice(0, 4).map(f => ({
        drive_file_id: f.drive_file_id,
        drive_link: f.drive_link,
      }));
      return {
        id: b.id,
        title: b.title || null,
        state: b.state,
        deadline: b.deadline,
        job_title: b.jobs?.title || null,
        job_number: b.jobs?.job_number || null,
        intake_token: b.client_intake_token,
        submitted_at: b.client_intake_submitted_at,
        has_intake: !!b.client_intake_submitted_at,
        thumbs,
        thumb_total: files.length,
        updated_at: b.updated_at,
      };
    });

    return NextResponse.json({
      client: { name: client.name },
      briefs: out,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
