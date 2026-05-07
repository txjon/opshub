#!/usr/bin/env node
// Create an OpsHub user directly — bypasses the invite-email flow when
// Supabase's redirect/Site URL plumbing is misbehaving. Mirrors the
// /api/team POST handler: creates the auth user, the profile, and the
// company membership in one shot.
//
// Usage:
//   node scripts/create-user.js <email> <full_name> <role> <password> [company_slug]
//
// Roles: owner | manager | ops | warehouse | viewer
// Default company_slug: hpd

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const [, , email, fullName, role, password, companySlugArg] = process.argv;
if (!email || !fullName || !role || !password) {
  console.error("Usage: node scripts/create-user.js <email> <full_name> <role> <password> [company_slug]");
  process.exit(1);
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters");
  process.exit(1);
}

const VALID_ROLES = ["owner", "manager", "ops", "warehouse", "viewer"];
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Valid: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

const ROLE_DEPARTMENTS = {
  owner: ["owner", "labs", "distro", "ecomm", "contacts", "settings"],
  manager: ["labs", "distro", "ecomm", "contacts", "settings"],
  ops: ["labs", "distro", "ecomm", "contacts"],
  warehouse: ["distro"],
  viewer: ["labs", "distro", "ecomm", "contacts"],
};

const companySlug = (companySlugArg || "hpd").toLowerCase();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: company, error: companyErr } = await sb
    .from("companies").select("id, name").eq("slug", companySlug).single();
  if (companyErr || !company) {
    console.error(`No company row for slug "${companySlug}"`);
    process.exit(1);
  }

  // Re-use existing auth user if one already exists for this email —
  // createUser would otherwise fail with "already registered".
  let userId = null;
  let page = 1;
  while (!userId) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = (data.users || []).find(u => (u.email || "").toLowerCase() === email.toLowerCase());
    if (found) { userId = found.id; break; }
    if (!data.users?.length || data.users.length < 200) break;
    page++;
  }

  if (userId) {
    const { error: updErr } = await sb.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updErr) throw updErr;
    console.log(`Existing auth user ${userId} updated with new password.`);
  } else {
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    userId = created.user.id;
    console.log(`Created auth user ${userId}.`);
  }

  const { error: profileErr } = await sb.from("profiles").upsert({
    id: userId,
    full_name: fullName,
    role,
    departments: ROLE_DEPARTMENTS[role] || [],
  });
  if (profileErr) throw profileErr;
  console.log(`Profile upserted: ${fullName} / role=${role}`);

  const { error: memberErr } = await sb.from("user_company_memberships").upsert({
    user_id: userId,
    company_id: company.id,
    role,
    is_active: true,
  }, { onConflict: "user_id,company_id" });
  if (memberErr) throw memberErr;
  console.log(`Membership upserted on company "${companySlug}" (${company.name || company.id}).`);

  console.log("");
  console.log(`✓ ${email} can now sign in with the password you set.`);
})();
