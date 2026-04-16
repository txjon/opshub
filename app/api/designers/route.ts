import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

async function requireOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!["owner", "manager"].includes(profile?.role)) return { error: "Forbidden", status: 403 as const };
  return { supabase, user };
}

export async function GET() {
  const auth = await requireOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { data, error } = await auth.supabase.from("designers").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ designers: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { name, email, notes } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const token = crypto.randomBytes(24).toString("hex");
  const { data, error } = await auth.supabase.from("designers").insert({
    name: name.trim(), email: email?.trim() || null, notes: notes?.trim() || null, portal_token: token, active: true,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ designer: data });
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
