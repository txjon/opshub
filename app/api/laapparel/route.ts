import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  const styleCode = searchParams.get("styleCode") || "";

  if (endpoint === "products") {
    const { data, error } = await supabase
      .from("la_apparel_catalog")
      .select("style_code, description, category, colors")
      .order("style_code");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Deduplicate by style_code — take first row per style
    const seen = new Map<string, any>();
    for (const row of (data || [])) {
      if (!seen.has(row.style_code)) {
        seen.set(row.style_code, {
          styleCode: row.style_code,
          description: row.description,
          category: row.category,
          colors: row.colors || [],
        });
      }
    }
    return NextResponse.json([...seen.values()]);
  }

  if (endpoint === "variants") {
    if (!styleCode) return NextResponse.json({ error: "Missing styleCode" }, { status: 400 });
    const { data, error } = await supabase
      .from("la_apparel_catalog")
      .select("*")
      .eq("style_code", styleCode)
      .order("color_type")
      .order("sizes");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data || []);
  }

  if (endpoint === "add_color") {
    const color = searchParams.get("color") || "";
    if (!styleCode || !color) return NextResponse.json({ error: "Missing styleCode or color" }, { status: 400 });
    // Add color to all rows for this style
    const { data: existing } = await supabase
      .from("la_apparel_catalog")
      .select("id, colors")
      .eq("style_code", styleCode);
    for (const row of (existing || [])) {
      const colors = row.colors || [];
      if (!colors.includes(color)) {
        await supabase.from("la_apparel_catalog").update({ colors: [...colors, color] }).eq("id", row.id);
      }
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });
}
