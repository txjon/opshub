import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import crypto from "crypto";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Same Host → slug map as middleware. /api/* is excluded from
// middleware so this route has to derive the active tenant itself.
function resolveCompanySlugFromRequest(req: NextRequest): string {
  const h = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

async function resolveCompanyId(req: NextRequest): Promise<string | null> {
  const slug = resolveCompanySlugFromRequest(req);
  const { data } = await admin().from("companies").select("id").eq("slug", slug).single();
  return (data as any)?.id || null;
}

async function requireOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!["owner", "manager"].includes(profile?.role)) return { error: "Forbidden", status: 403 as const };
  // Use service-role client for writes — avoids RLS gotchas on a settings-only table.
  return { supabase: admin(), user };
}

export async function GET(req: NextRequest) {
  const auth = await requireOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const companyId = await resolveCompanyId(req);
  if (!companyId) return NextResponse.json({ error: "No company for host" }, { status: 500 });
  // Service-role bypasses RLS, so scope by company_id explicitly.
  const { data, error } = await auth.supabase
    .from("designers")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ designers: data || [] });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOwner();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const companyId = await resolveCompanyId(req);
    if (!companyId) return NextResponse.json({ error: "No company for host" }, { status: 500 });
    const { name, email, notes } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const token = crypto.randomBytes(24).toString("hex");
    const { data, error } = await auth.supabase.from("designers").insert({
      name: name.trim(),
      email: email?.trim() || null,
      notes: notes?.trim() || null,
      portal_token: token,
      active: true,
      company_id: companyId,
    }).select("*").single();
    if (error) {
      console.error("[designers POST] insert error:", error);
      return NextResponse.json({ error: error.message, code: error.code, hint: error.hint }, { status: 500 });
    }
    return NextResponse.json({ designer: data });
  } catch (e: any) {
    console.error("[designers POST] exception:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id, name, email, notes, active, regenerate_token } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (notes !== undefined) updates.notes = notes;
  if (active !== undefined) updates.active = active;
  if (regenerate_token) updates.portal_token = crypto.randomBytes(24).toString("hex");
  const { data, error } = await auth.supabase.from("designers").update(updates).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ designer: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await auth.supabase.from("designers").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
