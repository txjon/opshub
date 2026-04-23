import { createClient as createAdmin } from "@supabase/supabase-js";

type NotifyType = "mention" | "alert" | "approval" | "payment" | "production";

let _admin: ReturnType<typeof createAdmin> | null = null;
function admin() {
  if (!_admin) {
    _admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _admin;
}

// Disabled 2026-04-23. The in-app notifications UI (NotificationBell) was
// removed — this function was generating one DB row per team member per
// event with no reader anywhere. Pure disk-IO waste.
// Kept as a no-op export so every caller stays compiling without edits.
// If you bring notifications back, restore the fan-out insert here.
export async function notifyTeamServer(
  _message: string,
  _type: NotifyType,
  _referenceId?: string,
  _referenceType?: string
) {
  return;
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
