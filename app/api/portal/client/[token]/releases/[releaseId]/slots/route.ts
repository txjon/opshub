import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hubClientLookup } from "@/lib/hub-client";
import { addSlot, removeSlot, patchSlot, isSlotOpFail } from "@/lib/release-slot-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client-hub slot ops — thin wrapper over lib/release-slot-ops (the ONE
// implementation, shared with the internal /api/drops slots route).
// POST   → add a line ({ briefId, lineId } | { briefId } | { itemId } |
//          { itemId, rerun: true }); building only for clients.
// DELETE → ?slotId= remove while building.
// PATCH  → { slotId, qtys } after close (Corey's step 5), or
//          { slotId, format, retail } while building.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function owned(token: string, releaseId: string) {
  const db = admin();
  const { data: client } = await hubClientLookup(db, token, "id, portal_features");
  if (!client) return null;
  if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("releases")) return null;
  const { data: release } = await db.from("releases").select("id, client_id, status, company_id").eq("id", releaseId).single();
  if (!release || (release as any).client_id !== client.id) return null;
  return { db, release: release as any };
}

export async function POST(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const out = await addSlot(ctx.db, ctx.release, body, "client");
    if (isSlotOpFail(out)) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ success: true, slotId: out.slotId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const out = await removeSlot(ctx.db, ctx.release, req.nextUrl.searchParams.get("slotId") || "", "client");
    if (isSlotOpFail(out)) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const out = await patchSlot(ctx.db, ctx.release, body, "client");
    if (isSlotOpFail(out)) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
