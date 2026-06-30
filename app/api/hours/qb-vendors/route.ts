export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchVendors } from "@/lib/quickbooks";

// Search QuickBooks vendors for the contractor → vendor mapping picker.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q") || "";
  if (q.trim().length < 2) return NextResponse.json({ vendors: [] });
  try {
    return NextResponse.json({ vendors: await searchVendors(q) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Vendor search failed" }, { status: 500 });
  }
}
