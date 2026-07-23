// THE LAB STUDIO — server-side helpers (Jon, Jul 22 2026). An isolated sandbox
// for the design-approval ping-pong; every /api/lab/* route runs on the service
// role (lab_* tables have RLS on with no policies). Nothing here touches
// production — it's the proving ground before this becomes the front of the
// pipeline.
import { createClient } from "@supabase/supabase-js";

export function labDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export const LAB_BUCKET = "lab-studio";

// A short, url-safe magic-link token for a client (generated in JS so the
// table needs no pgcrypto default).
export function newToken(len = 20): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export type LabThread = {
  id: string; client_id: string; title: string;
  state: "working" | "with_client" | "approved";
  initiated_by: "hpd" | "client";
  approved_at: string | null; approved_by: string | null; approved_file_url: string | null;
  created_at: string; updated_at: string;
};
export type LabMessage = {
  id: string; thread_id: string; sender_role: "client" | "hpd"; sender_name: string | null;
  body: string | null; visibility: "client" | "internal";
  file_url: string | null; file_name: string | null;
  kind: "comment" | "version" | "change_request" | "approval" | "submission";
  created_at: string;
};

// Whose move is it, in plain words — one source both surfaces read.
export function threadMove(state: LabThread["state"]): { label: string; who: "you" | "them" | "done"; tone: "amber" | "blue" | "green" } {
  if (state === "with_client") return { label: "With the client", who: "them", tone: "blue" };
  if (state === "approved") return { label: "Design approved", who: "done", tone: "green" };
  return { label: "Your move", who: "you", tone: "amber" };
}
