import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function resolveClient(token: string) {
  const db = admin();
  const { data: client } = await db
    .from("clients")
    .select("id, name")
    .eq("portal_token", token)
    .single();
  return client;
}

// GET /api/portal/client/[token]/proposals
// Returns every proposal for this client, including ones that have been
// "converted" (so the UI can show conversion state). The Staging tab
// filters to status='proposed' for the active pool.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const client = await resolveClient(params.token);
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const db = admin();
    const { data: proposals } = await db
      .from("client_proposal_items")
      .select("id, name, notes, drive_file_id, drive_link, qty_estimate, garment_type, status, converted_to_item_id, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });
    return NextResponse.json({ proposals: proposals || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// POST /api/portal/client/[token]/proposals
// Body: { name: string, drive_file_id?: string, drive_link?: string, qty_estimate?: number, garment_type?: string, notes?: string }
// Finalizes a proposal record after the client has uploaded the mockup
// to Drive via /upload-session. Mockup is optional — the client can
// create a placeholder proposal and add the image later.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const client = await resolveClient(params.token);
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const body = await req.json();
    const name = (body.name || "").toString().trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const db = admin();
    const { data, error } = await db
      .from("client_proposal_items")
      .insert({
        client_id: (client as any).id,
        name,
        drive_file_id: body.drive_file_id || null,
        drive_link: body.drive_link || null,
        qty_estimate: body.qty_estimate ? parseInt(body.qty_estimate) || null : null,
        garment_type: body.garment_type || null,
        notes: (body.notes || "").toString().trim() || null,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ proposal: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
