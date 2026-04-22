import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { notifyTeamServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// POST /api/portal/client/[token]/briefs
// Client creates a new design request from their portal. Lands as
// source='client', state='draft' — HPD reviews + sends to designer explicitly.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", params.token).single();
  if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { title, concept } = await req.json();

  // Pre-assign to sole active designer (same rule as HPD-side inserts) —
  // HPD can reassign if needed. Designer doesn't see it until HPD hits Send.
  let finalDesignerId: string | null = null;
  const { data: activeDesigners } = await db.from("designers").select("id").eq("active", true);
  if (activeDesigners && activeDesigners.length === 1) finalDesignerId = activeDesigners[0].id;

  const { data: brief, error } = await db.from("art_briefs").insert({
    client_id: client.id,
    title: title?.trim() || null,
    concept: concept?.trim() || null,
    source: "client",
    state: "draft",
    assigned_designer_id: finalDesignerId,
  }).select("*").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify HPD — a client-submitted brief wants review
  try {
    await notifyTeamServer(
      `${client.name} submitted a new design request${title ? `: ${title}` : ""}`,
      "mention", brief.id, "art_brief"
    );
  } catch {}

  return NextResponse.json({ brief });
}
