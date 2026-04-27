// Shared types for the client portal shell + tabs.

export type Thumb = {
  drive_file_id: string | null;
  preview_drive_file_id?: string | null;
  drive_link: string | null;
  kind?: string;
};

export type Brief = {
  id: string;
  title: string | null;
  concept: string | null;
  state: string;
  deadline: string | null;
  job_title: string | null;
  job_number: string | null;
  intake_token: string | null;
  intake_requested: boolean;
  submitted_at: string | null;
  has_intake: boolean;
  sent_to_designer_at: string | null;
  thumbs: Thumb[];
  thumb_total: number;
  updated_at: string;
  last_activity_at?: string | null;
  has_unread_external?: boolean;
  has_latest_draft?: boolean;
  unread_kind?: string | null;
  preview_line?: string | null;
};

export type OrdersSummary = {
  active_count: number;
  delivered_recent_count: number;
  unpaid_count: number;
  next_ship_date: string | null;
};

export type PortalData = {
  client: { name: string };
  briefs: Brief[];
  orders_summary?: OrdersSummary;
};

export type Toast = {
  id: string;
  briefId: string;
  title: string;
  preview: string;
};

// Client-facing state buckets. Internal states (HPD review, pending-prep) are
// collapsed — the client doesn't need to see our plumbing.
export type ClientStateMeta = {
  label: string;
  bucket: "action" | "progress" | "done";
  color: string;
  bg: string;
  border: string;
};
