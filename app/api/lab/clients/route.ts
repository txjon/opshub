import { NextRequest, NextResponse } from "next/server";
import { labDb, newToken } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — every lab client (for the studio's client picker). POST — create one,
// minting its magic-link token.
export async function GET() {
  const db = labDb();
  const { data } = await db.from("lab_clients").select("*").order("created_at", { ascending: false });
  return NextResponse.json({ clients: data || [] });
}

export async function POST(req: NextRequest) {
  const { name } = await req.json().catch(() => ({}));
  if (!name || !String(name).trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const db = labDb();
  const { data, error } = await db.from("lab_clients")
    .insert({ name: String(name).trim(), token: newToken() } as never).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data });
}
