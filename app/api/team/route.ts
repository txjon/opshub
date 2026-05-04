import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { appBaseUrl } from "@/lib/public-url";

export async function POST(req: NextRequest) {
  try {
    // Auth check — only managers can invite
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!["manager", "owner"].includes(profile?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { email, fullName, role } = await req.json();
    if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });

    const validRoles = ["ops", "warehouse", "viewer"];
    const assignedRole = validRoles.includes(role) ? role : "viewer";

    // Derive departments from role
    const ROLE_DEPARTMENTS: Record<string, string[]> = {
      ops: ["labs", "distro", "ecomm", "contacts"],
      warehouse: ["distro"],
      viewer: ["labs", "distro", "ecomm", "contacts"],
    };

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Invite user via Supabase auth
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appBaseUrl()}/auth/callback`,
    });
    if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 });

    // Create/update profile with role + derived departments
    await admin.from("profiles").upsert({
      id: inviteData.user.id,
      full_name: fullName || null,
      role: assignedRole,
      departments: ROLE_DEPARTMENTS[assignedRole] || [],
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    // Auth check — only managers can edit roles
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!["manager", "owner"].includes(profile?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { profileId, role, fullName } = await req.json();
    if (!profileId) return NextResponse.json({ error: "Missing profileId" }, { status: 400 });

    const ROLE_DEPARTMENTS: Record<string, string[]> = {
      owner: ["owner", "labs", "distro", "ecomm", "contacts", "settings"],
      ops: ["labs", "distro", "ecomm", "contacts"],
      warehouse: ["distro"],
      viewer: ["labs", "distro", "ecomm", "contacts"],
    };

    const updates: any = {};
    if (role) {
      updates.role = role;
      updates.departments = ROLE_DEPARTMENTS[role] || [];
    }
    if (fullName !== undefined) updates.full_name = fullName;

    await supabase.from("profiles").update(updates).eq("id", profileId);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 });
  }
}
