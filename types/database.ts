// Auto-generated types from Supabase schema
// Run: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > types/database.ts
// For now these are hand-written stubs -- replace with generated types after schema is applied

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string;
          name: string;
          client_type: "artist" | "brand" | "corporate" | "label" | null;
          default_terms: "net_15" | "net_30" | "deposit_balance" | "prepaid" | null;
          notes: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["clients"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
      };
      contacts: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          email: string | null;
          phone: string | null;
          role_label: string | null;
          is_primary: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["contacts"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["contacts"]["Insert"]>;
      };
      jobs: {
        Row: {
          id: string;
          client_id: string;
          parent_job_id: string | null;
          template_id: string | null;
          job_number: string;
          job_type: "tour" | "webstore" | "corporate" | "brand";
          title: string;
          phase: "intake" | "pending" | "ready" | "production" | "receiving" | "fulfillment" | "complete" | "on_hold" | "cancelled";
          priority: "normal" | "high" | "urgent";
          payment_terms: "net_15" | "net_30" | "deposit_balance" | "prepaid" | null;
          contract_status: "not_sent" | "sent" | "signed" | "waived";
          notes: string | null;
          target_ship_date: string | null;
          est_completion: string | null;
          type_meta: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["jobs"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["jobs"]["Insert"]>;
      };
      items: {
        Row: {
          id: string;
          job_id: string;
          name: string;
          blank_vendor: string | null;
          blank_sku: string | null;
          garment_type: "tee" | "hoodie" | "longsleeve" | "crewneck" | "hat" | "beanie" | "tote" | "patch" | "poster" | "sticker" | "custom" | null;
          status: "confirmed" | "tbd";
          artwork_status: "not_started" | "in_progress" | "approved" | "n_a";
          artwork_url: string | null;
          cost_per_unit: number | null;
          sell_per_unit: number | null;
          margin_pct: number | null;
          notes: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["items"]["Row"], "id" | "created_at" | "margin_pct">;
        Update: Partial<Database["public"]["Tables"]["items"]["Insert"]>;
      };
      buy_sheet_lines: {
        Row: {
          id: string;
          item_id: string;
          size: string;
          qty_ordered: number;
          qty_shipped_from_vendor: number;
          qty_received_at_hpd: number;
          qty_shipped_to_customer: number;
        };
        Insert: Omit<Database["public"]["Tables"]["buy_sheet_lines"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["buy_sheet_lines"]["Insert"]>;
      };
      decorators: {
        Row: {
          id: string;
          name: string;
          capabilities: string[];
          location: string | null;
          lead_time_days: number | null;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          notes: string | null;
          external_token: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["decorators"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["decorators"]["Insert"]>;
      };
      decorator_assignments: {
        Row: {
          id: string;
          item_id: string;
          decorator_id: string;
          decoration_type: "screen_print" | "embroidery" | "patch" | "cut_sew" | "dtg" | "sublimation" | "heat_transfer";
          pipeline_stage: "blanks_ordered" | "in_production" | "shipped";
          strikeoff_status: "not_needed" | "pending" | "approved" | "revision_requested";
          sent_to_decorator_date: string | null;
          est_completion_date: string | null;
          actual_completion_date: string | null;
          tracking_number: string | null;
          cost: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["decorator_assignments"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["decorator_assignments"]["Insert"]>;
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: "manager" | "production" | "warehouse" | "shipping" | "sales" | "readonly";
          assigned_client_ids: string[];
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at">;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      alerts: {
        Row: {
          id: string;
          job_id: string;
          item_id: string | null;
          decorator_assignment_id: string | null;
          alert_type: string;
          severity: "critical" | "warning" | "info";
          message: string;
          due_date: string | null;
          assigned_roles: string[];
          is_dismissed: boolean;
          dismissed_by: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["alerts"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["alerts"]["Insert"]>;
      };
      payment_records: {
        Row: {
          id: string;
          job_id: string;
          qb_invoice_id: string | null;
          invoice_number: string | null;
          type: "deposit" | "balance" | "full_payment" | "refund";
          amount: number;
          status: "draft" | "sent" | "viewed" | "partial" | "paid" | "overdue" | "void";
          due_date: string | null;
          paid_date: string | null;
          synced_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["payment_records"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["payment_records"]["Insert"]>;
      };
    };
  };
};

// Convenience types
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type Contact = Database["public"]["Tables"]["contacts"]["Row"];
export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type Item = Database["public"]["Tables"]["items"]["Row"];
export type BuySheetLine = Database["public"]["Tables"]["buy_sheet_lines"]["Row"];
export type Decorator = Database["public"]["Tables"]["decorators"]["Row"];
export type DecoratorAssignment = Database["public"]["Tables"]["decorator_assignments"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Alert = Database["public"]["Tables"]["alerts"]["Row"];
export type PaymentRecord = Database["public"]["Tables"]["payment_records"]["Row"];
