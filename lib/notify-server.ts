import { createClient as createAdmin } from "@supabase/supabase-js";

type NotifyType = "mention" | "alert" | "approval" | "payment" | "production";

let _admin: ReturnType<typeof createAdmin> | null = null;
function admin() {
  if (!_admin) {
    _admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _admin;
}

// Server-side version of notifyTeam (for API routes, including token-auth ones).
// Fans out one notification per profile row, fire-and-forget safe.
export async function notifyTeamServer(
  message: string,
  type: NotifyType,
  referenceId?: string,
  referenceType?: string
) {
  try {
    const db = admin();
    const { data: profiles } = await db.from("profiles").select("id");
    if (!profiles?.length) return;
    await db.from("notifications").insert(
      profiles.map((p: any) => ({
        user_id: p.id,
        type,
        message,
        reference_id: referenceId || null,
        reference_type: referenceType || null,
      }))
    );
  } catch {
    // swallow — notifications are best-effort
  }
}

export async function logJobActivityServer(jobId: string, message: string, metadata?: any) {
  try {
    const db = admin();
    await db.from("job_activity").insert({
      job_id: jobId,
      user_id: null,
      type: "auto",
      message,
      metadata: metadata || {},
    });
  } catch {
    // swallow
  }
}
