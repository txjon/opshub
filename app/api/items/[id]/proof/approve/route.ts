export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { approveVersion } from "@/lib/proof-versions";

// Staff approving on the client's behalf (verbal or email sign-off). Stamps the
// same proof VERSION the client would have approved in their hub, so the record
// reads identically however the approval arrived.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await createServerClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: profile } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const res = await approveVersion(db, {
    itemId: params.id,
    approvedBy: (profile as any)?.full_name || user.email || "staff",
    source: body?.source || "internal",
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ version: res.version });
}
