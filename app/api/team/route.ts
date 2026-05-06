import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { appBaseUrl } from "@/lib/public-url";

// Same Host → slug map as middleware. /api/* is excluded from middleware
// so this route has to derive the active tenant from the request itself.
function resolveCompanySlugFromRequest(req: NextRequest): string {
  const h = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

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

    // Resolve which tenant this invite is for — based on the subdomain
    // the inviter is currently using. Inviting from app.inhousemerchandise.com
    // creates a membership in IHM; inviting from HPD creates one in HPD.
    const slug = resolveCompanySlugFromRequest(req);
    const { data: company } = await admin.from("companies").select("id").eq("slug", slug).single();
    if (!company) return NextResponse.json({ error: `No company row for slug "${slug}"` }, { status: 500 });

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

    // Create the company membership so the layout's tenant gate lets
    // them in once they accept the invite. Idempotent via the unique
    // constraint on (user_id, company_id).
    await admin.from("user_company_memberships").upsert({
      user_id: inviteData.user.id,
      company_id: (company as any).id,
      role: assignedRole,
      is_active: true,
    }, { onConflict: "user_id,company_id" });

    return NextResponse.json({ success: true, company: slug });
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
