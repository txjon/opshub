export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseShopifyInventoryCSV, partitionLocations } from "@/lib/shopify-csv/parse-inventory";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("inventoryFile");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Missing inventoryFile" }, { status: 400 });
    }

    const text = await (file as File).text();
    const rows = parseShopifyInventoryCSV(text);
    if (rows.length === 0) {
      return NextResponse.json({ error: "No inventory rows parsed" }, { status: 400 });
    }

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of rows) {
      if (!seen.has(r.location)) {
        seen.add(r.location);
        ordered.push(r.location);
      }
    }
    const { allLocations, podLocations, physicalLocations } = partitionLocations(ordered);

    return NextResponse.json({ allLocations, podLocations, physicalLocations });
  } catch (e: any) {
    console.error("[drop-valuation-multi/preview] error:", e);
    return NextResponse.json({ error: e.message || "Failed to preview" }, { status: 500 });
  }
}
