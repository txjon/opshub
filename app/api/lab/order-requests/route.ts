import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The studio's Order requests rail. GET → open (unhandled) requests, newest
// last so the oldest ask sits first in line. PATCH { id, done } → stamp it
// handled and it leaves the rail. Studio-side only — clients see their request
// as state on the thread, never this list.
export async function GET() {
  const db = labDb();
  const { data } = await db.from("lab_order_requests")
    .select("*, lab_threads(id, title, state), lab_clients(name), art_briefs(id, title, clients(name))")
    .is("handled_at", null)
    .order("created_at", { ascending: true });
  return NextResponse.json({ requests: data || [] });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const db = labDb();
  const { error } = await db.from("lab_order_requests")
    .update({ handled_at: b.done === false ? null : new Date().toISOString() } as never)
    .eq("id", b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
