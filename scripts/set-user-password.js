#!/usr/bin/env node
// Direct password set for a stuck invited user — bypasses the
// recovery-email round-trip when Supabase's Site URL / redirect
// allow-list isn't routing them through /auth/callback correctly.
//
// Usage:
//   node scripts/set-user-password.js <email> <new_password>
//
// Effect: Looks up the user by email, sets their password, and
// confirms their email if it wasn't already. They can log in
// immediately at the OpsHub URL with email + password and change
// it in-app afterwards.

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error("Usage: node scripts/set-user-password.js <email> <password>");
  process.exit(1);
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters");
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // Look up by email — admin.listUsers paginates so we filter ourselves.
  let user = null;
  let page = 1;
  while (!user) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    user = (data.users || []).find(u => (u.email || "").toLowerCase() === email.toLowerCase());
    if (user || !data.users?.length || data.users.length < 200) break;
    page++;
  }
  if (!user) {
    console.error(`No auth user found for ${email}`);
    process.exit(1);
  }

  const { error: updErr } = await sb.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (updErr) throw updErr;

  console.log(`Updated user ${user.id} (${email})`);
  console.log("They can sign in at the OpsHub login page with this password.");
})();
