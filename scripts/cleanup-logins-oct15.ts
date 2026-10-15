// One-off (Oct 15 2026): turn off the leftover e2e test logins and Adrien's
// IHM login. Done on Oct 15: e2e-rfq deleted, Adrien banned. The 3 e2e-heal/
// bake logins couldn't be deleted (records from their test runs still point at
// them), so they're banned instead: same effect, nothing else touched.
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const { data: u } = await db.auth.admin.listUsers({ perPage: 500 });
  for (const x of u.users.filter(x => /^e2e-/.test(x.email || ""))) {
    const { error } = await db.auth.admin.updateUserById(x.id, { ban_duration: "876000h" } as any);
    console.log("turn off", x.email, error?.message || "ok");
  }
})();
