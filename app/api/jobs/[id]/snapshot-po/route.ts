import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { snapshotVendorPo } from "@/lib/costing-summary";

export const dynamic = "force-dynamic";

// POST { vendor } — freeze the vendor's expected costs at PO send.
// Fired fire-and-forget by POTab when a PO is emailed or marked sent.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await createClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { vendor } = await req.json();
    if (!vendor) return NextResponse.json({ error: "vendor required" }, { status: 400 });
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const res = await snapshotVendorPo(admin, params.id, vendor);
    return NextResponse.json(res, { status: res.ok ? 200 : 422 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "snapshot failed" }, { status: 500 });
  }
}
