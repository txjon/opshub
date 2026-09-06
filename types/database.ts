// AUTO-GENERATED from the live database schema — do not hand-edit.
// Regenerate after every migration:  node scripts/gen-db-types.mjs
// (PostgREST OpenAPI introspection; generator: scripts/gen-db-types.mjs)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      alerts: {
        Row: {
          id: string;
          job_id: string | null;
          item_id: string | null;
          decorator_assignment_id: string | null;
          alert_type: string;
          severity: string | null;
          message: string;
          due_date: string | null;
          assigned_roles: string[];
          is_dismissed: boolean | null;
          dismissed_by: string | null;
          created_at: string | null;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          job_id?: string | null;
          item_id?: string | null;
          decorator_assignment_id?: string | null;
          alert_type: string;
          severity?: string | null;
          message: string;
          due_date?: string | null;
          assigned_roles: string[];
          is_dismissed?: boolean | null;
          dismissed_by?: string | null;
          created_at?: string | null;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string | null;
          item_id?: string | null;
          decorator_assignment_id?: string | null;
          alert_type?: string;
          severity?: string | null;
          message?: string;
          due_date?: string | null;
          assigned_roles?: string[];
          is_dismissed?: boolean | null;
          dismissed_by?: string | null;
          created_at?: string | null;
          resolved_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "alerts_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "alerts_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "alerts_decorator_assignment_id_fkey"; columns: ["decorator_assignment_id"]; isOneToOne: false; referencedRelation: "decorator_assignments"; referencedColumns: ["id"] },
          { foreignKeyName: "alerts_dismissed_by_fkey"; columns: ["dismissed_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ];
      };
      ap_vendors: {
        Row: {
          id: string;
          name: string;
          kind: string;
          decorator_id: string | null;
          qb_vendor_id: string | null;
          default_expense_account: string | null;
          active: boolean;
          created_at: string;
          match_keys: string[] | null;
          default_bill_method: string;
        };
        Insert: {
          id?: string;
          name: string;
          kind?: string;
          decorator_id?: string | null;
          qb_vendor_id?: string | null;
          default_expense_account?: string | null;
          active?: boolean;
          created_at?: string;
          match_keys?: string[] | null;
          default_bill_method?: string;
        };
        Update: {
          id?: string;
          name?: string;
          kind?: string;
          decorator_id?: string | null;
          qb_vendor_id?: string | null;
          default_expense_account?: string | null;
          active?: boolean;
          created_at?: string;
          match_keys?: string[] | null;
          default_bill_method?: string;
        };
        Relationships: [
          { foreignKeyName: "ap_vendors_decorator_id_fkey"; columns: ["decorator_id"]; isOneToOne: false; referencedRelation: "decorators"; referencedColumns: ["id"] }
        ];
      };
      api_cache: {
        Row: {
          key: string;
          data: Json;
          updated_at: string | null;
        };
        Insert: {
          key: string;
          data: Json;
          updated_at?: string | null;
        };
        Update: {
          key?: string;
          data?: Json;
          updated_at?: string | null;
        };
        Relationships: [

        ];
      };
      art_brief_file_comments: {
        Row: {
          id: string;
          file_id: string;
          brief_id: string;
          sender_role: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          file_id: string;
          brief_id: string;
          sender_role: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          file_id?: string;
          brief_id?: string;
          sender_role?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "art_brief_file_comments_file_id_fkey"; columns: ["file_id"]; isOneToOne: false; referencedRelation: "art_brief_files"; referencedColumns: ["id"] },
          { foreignKeyName: "art_brief_file_comments_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] }
        ];
      };
      art_brief_files: {
        Row: {
          id: string;
          brief_id: string | null;
          file_name: string;
          drive_file_id: string | null;
          drive_link: string | null;
          mime_type: string | null;
          file_size: number | null;
          version: number | null;
          kind: string | null;
          notes: string | null;
          uploaded_by: string | null;
          uploader_role: string | null;
          created_at: string | null;
          client_annotation: string | null;
          hpd_annotation: string | null;
          shared_with_client_at: string | null;
          designer_annotation: string | null;
          annotation_updated_at: string | null;
          preview_drive_file_id: string | null;
          reaction: string | null;
        };
        Insert: {
          id?: string;
          brief_id?: string | null;
          file_name: string;
          drive_file_id?: string | null;
          drive_link?: string | null;
          mime_type?: string | null;
          file_size?: number | null;
          version?: number | null;
          kind?: string | null;
          notes?: string | null;
          uploaded_by?: string | null;
          uploader_role?: string | null;
          created_at?: string | null;
          client_annotation?: string | null;
          hpd_annotation?: string | null;
          shared_with_client_at?: string | null;
          designer_annotation?: string | null;
          annotation_updated_at?: string | null;
          preview_drive_file_id?: string | null;
          reaction?: string | null;
        };
        Update: {
          id?: string;
          brief_id?: string | null;
          file_name?: string;
          drive_file_id?: string | null;
          drive_link?: string | null;
          mime_type?: string | null;
          file_size?: number | null;
          version?: number | null;
          kind?: string | null;
          notes?: string | null;
          uploaded_by?: string | null;
          uploader_role?: string | null;
          created_at?: string | null;
          client_annotation?: string | null;
          hpd_annotation?: string | null;
          shared_with_client_at?: string | null;
          designer_annotation?: string | null;
          annotation_updated_at?: string | null;
          preview_drive_file_id?: string | null;
          reaction?: string | null;
        };
        Relationships: [
          { foreignKeyName: "art_brief_files_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] },
          { foreignKeyName: "art_brief_files_uploaded_by_fkey"; columns: ["uploaded_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ];
      };
      art_brief_messages: {
        Row: {
          id: string;
          brief_id: string | null;
          sender_role: string;
          sender_name: string | null;
          sender_id: string | null;
          message: string;
          visibility: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          brief_id?: string | null;
          sender_role: string;
          sender_name?: string | null;
          sender_id?: string | null;
          message: string;
          visibility?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          brief_id?: string | null;
          sender_role?: string;
          sender_name?: string | null;
          sender_id?: string | null;
          message?: string;
          visibility?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "art_brief_messages_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] },
          { foreignKeyName: "art_brief_messages_sender_id_fkey"; columns: ["sender_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ];
      };
      art_briefs: {
        Row: {
          id: string;
          item_id: string | null;
          job_id: string | null;
          title: string | null;
          concept: string | null;
          placement: string | null;
          colors: string | null;
          reference_urls: Json | null;
          deadline: string | null;
          internal_notes: string | null;
          state: string | null;
          assigned_to: string | null;
          version_count: number | null;
          created_by: string | null;
          created_at: string | null;
          updated_at: string | null;
          client_id: string | null;
          purpose: string | null;
          audience: string | null;
          mood_words: Json | null;
          no_gos: string | null;
          client_intake_token: string | null;
          client_intake_submitted_at: string | null;
          assigned_designer_id: string | null;
          sent_to_designer_at: string | null;
          source: string | null;
          client_aborted_at: string | null;
          archived_by: string | null;
          hpd_last_seen_at: string | null;
          designer_last_seen_at: string | null;
          client_last_seen_at: string | null;
          company_id: string;
          product_spec: Json;
          internal_only: boolean;
          approved_file_id: string | null;
          parent_brief_id: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          job_id?: string | null;
          title?: string | null;
          concept?: string | null;
          placement?: string | null;
          colors?: string | null;
          reference_urls?: Json | null;
          deadline?: string | null;
          internal_notes?: string | null;
          state?: string | null;
          assigned_to?: string | null;
          version_count?: number | null;
          created_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          client_id?: string | null;
          purpose?: string | null;
          audience?: string | null;
          mood_words?: Json | null;
          no_gos?: string | null;
          client_intake_token?: string | null;
          client_intake_submitted_at?: string | null;
          assigned_designer_id?: string | null;
          sent_to_designer_at?: string | null;
          source?: string | null;
          client_aborted_at?: string | null;
          archived_by?: string | null;
          hpd_last_seen_at?: string | null;
          designer_last_seen_at?: string | null;
          client_last_seen_at?: string | null;
          company_id: string;
          product_spec: Json;
          internal_only?: boolean;
          approved_file_id?: string | null;
          parent_brief_id?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          job_id?: string | null;
          title?: string | null;
          concept?: string | null;
          placement?: string | null;
          colors?: string | null;
          reference_urls?: Json | null;
          deadline?: string | null;
          internal_notes?: string | null;
          state?: string | null;
          assigned_to?: string | null;
          version_count?: number | null;
          created_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          client_id?: string | null;
          purpose?: string | null;
          audience?: string | null;
          mood_words?: Json | null;
          no_gos?: string | null;
          client_intake_token?: string | null;
          client_intake_submitted_at?: string | null;
          assigned_designer_id?: string | null;
          sent_to_designer_at?: string | null;
          source?: string | null;
          client_aborted_at?: string | null;
          archived_by?: string | null;
          hpd_last_seen_at?: string | null;
          designer_last_seen_at?: string | null;
          client_last_seen_at?: string | null;
          company_id?: string;
          product_spec?: Json;
          internal_only?: boolean;
          approved_file_id?: string | null;
          parent_brief_id?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "art_briefs_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "art_briefs_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "art_briefs_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "art_briefs_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "art_briefs_assigned_designer_id_fkey"; columns: ["assigned_designer_id"]; isOneToOne: false; referencedRelation: "designers"; referencedColumns: ["id"] },
          { foreignKeyName: "art_briefs_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "art_briefs_approved_file_id_fkey"; columns: ["approved_file_id"]; isOneToOne: false; referencedRelation: "art_brief_files"; referencedColumns: ["id"] },
          { foreignKeyName: "art_briefs_parent_brief_id_fkey"; columns: ["parent_brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] }
        ];
      };
      art_client_requests: {
        Row: {
          id: string;
          item_id: string | null;
          job_id: string | null;
          brief_id: string | null;
          concept: string | null;
          directions: string | null;
          reference_urls: Json | null;
          state: string | null;
          submitted_by_contact: string | null;
          created_at: string | null;
          client_id: string | null;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          job_id?: string | null;
          brief_id?: string | null;
          concept?: string | null;
          directions?: string | null;
          reference_urls?: Json | null;
          state?: string | null;
          submitted_by_contact?: string | null;
          created_at?: string | null;
          client_id?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          job_id?: string | null;
          brief_id?: string | null;
          concept?: string | null;
          directions?: string | null;
          reference_urls?: Json | null;
          state?: string | null;
          submitted_by_contact?: string | null;
          created_at?: string | null;
          client_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "art_client_requests_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "art_client_requests_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "art_client_requests_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] },
          { foreignKeyName: "art_client_requests_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }
        ];
      };
      art_requests: {
        Row: {
          id: string;
          token: string;
          job_id: string;
          company_id: string | null;
          designer_email: string;
          designer_name: string | null;
          message: string | null;
          status: string;
          created_by: string | null;
          created_at: string;
          file_ids: string[];
          quoted_amount: number | null;
          quoted_screens: number | null;
          quoted_note: string | null;
          responded_at: string | null;
          quoted_items: Json;
        };
        Insert: {
          id?: string;
          token: string;
          job_id: string;
          company_id?: string | null;
          designer_email: string;
          designer_name?: string | null;
          message?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          file_ids: string[];
          quoted_amount?: number | null;
          quoted_screens?: number | null;
          quoted_note?: string | null;
          responded_at?: string | null;
          quoted_items: Json;
        };
        Update: {
          id?: string;
          token?: string;
          job_id?: string;
          company_id?: string | null;
          designer_email?: string;
          designer_name?: string | null;
          message?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          file_ids?: string[];
          quoted_amount?: number | null;
          quoted_screens?: number | null;
          quoted_note?: string | null;
          responded_at?: string | null;
          quoted_items?: Json;
        };
        Relationships: [
          { foreignKeyName: "art_requests_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] }
        ];
      };
      audit_log: {
        Row: {
          id: string;
          user_id: string | null;
          entity_type: string;
          entity_id: string;
          action: string;
          field: string | null;
          old_value: string | null;
          new_value: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          entity_type: string;
          entity_id: string;
          action: string;
          field?: string | null;
          old_value?: string | null;
          new_value?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          entity_type?: string;
          entity_id?: string;
          action?: string;
          field?: string | null;
          old_value?: string | null;
          new_value?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "audit_log_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ];
      };
      bill_attachments: {
        Row: {
          id: string;
          bill_group_id: string;
          company_id: string | null;
          file_name: string;
          mime_type: string | null;
          size_bytes: number | null;
          storage_path: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          bill_group_id: string;
          company_id?: string | null;
          file_name: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          storage_path: string;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          bill_group_id?: string;
          company_id?: string | null;
          file_name?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          storage_path?: string;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [

        ];
      };
      blank_catalog: {
        Row: {
          id: string;
          brand: string;
          style: string;
          color: string;
          sizes: Json;
          costs: Json;
          created_at: string | null;
          company_id: string;
        };
        Insert: {
          id?: string;
          brand: string;
          style: string;
          color: string;
          sizes: Json;
          costs: Json;
          created_at?: string | null;
          company_id: string;
        };
        Update: {
          id?: string;
          brand?: string;
          style?: string;
          color?: string;
          sizes?: Json;
          costs?: Json;
          created_at?: string | null;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "blank_catalog_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      buy_sheet_lines: {
        Row: {
          id: string;
          item_id: string | null;
          size: string;
          qty_ordered: number | null;
          qty_shipped_from_vendor: number | null;
          qty_received_at_hpd: number | null;
          qty_shipped_to_customer: number | null;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          size: string;
          qty_ordered?: number | null;
          qty_shipped_from_vendor?: number | null;
          qty_received_at_hpd?: number | null;
          qty_shipped_to_customer?: number | null;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          size?: string;
          qty_ordered?: number | null;
          qty_shipped_from_vendor?: number | null;
          qty_received_at_hpd?: number | null;
          qty_shipped_to_customer?: number | null;
        };
        Relationships: [
          { foreignKeyName: "buy_sheet_lines_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] }
        ];
      };
      client_files: {
        Row: {
          id: string;
          client_id: string;
          file_name: string;
          drive_file_id: string | null;
          drive_link: string | null;
          mime_type: string | null;
          file_size: number | null;
          kind: string;
          notes: string | null;
          uploaded_by: string | null;
          created_at: string;
          company_id: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          file_name: string;
          drive_file_id?: string | null;
          drive_link?: string | null;
          mime_type?: string | null;
          file_size?: number | null;
          kind?: string;
          notes?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
          company_id: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          file_name?: string;
          drive_file_id?: string | null;
          drive_link?: string | null;
          mime_type?: string | null;
          file_size?: number | null;
          kind?: string;
          notes?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "client_files_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "client_files_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      client_proposal_items: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          notes: string | null;
          drive_file_id: string | null;
          drive_link: string | null;
          qty_estimate: number | null;
          garment_type: string | null;
          status: string;
          converted_to_item_id: string | null;
          created_at: string;
          updated_at: string;
          company_id: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          notes?: string | null;
          drive_file_id?: string | null;
          drive_link?: string | null;
          qty_estimate?: number | null;
          garment_type?: string | null;
          status?: string;
          converted_to_item_id?: string | null;
          created_at?: string;
          updated_at?: string;
          company_id: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          notes?: string | null;
          drive_file_id?: string | null;
          drive_link?: string | null;
          qty_estimate?: number | null;
          garment_type?: string | null;
          status?: string;
          converted_to_item_id?: string | null;
          created_at?: string;
          updated_at?: string;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "client_proposal_items_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "client_proposal_items_converted_to_item_id_fkey"; columns: ["converted_to_item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "client_proposal_items_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      client_releases: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          target_date: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
          company_id: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          title: string;
          target_date?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          company_id: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          title?: string;
          target_date?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "client_releases_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "client_releases_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      clients: {
        Row: {
          id: string;
          name: string;
          client_type: string | null;
          default_terms: string | null;
          notes: string | null;
          created_at: string | null;
          short_code: string | null;
          qb_customer_id: string | null;
          website: string | null;
          billing_address: string | null;
          shipping_address: string | null;
          tax_exempt: boolean;
          portal_token: string | null;
          portal_tier: string | null;
          hpd_fee_pct: number | null;
          client_hub_enabled: boolean;
          allow_cc: boolean;
          allow_ach: boolean;
          hpd_per_package_fee: number | null;
          company_id: string;
          stripe_customer_id: string | null;
          drive_folder_id: string | null;
          portal_features: string[];
          is_lead: boolean;
          is_internal: boolean;
        };
        Insert: {
          id?: string;
          name: string;
          client_type?: string | null;
          default_terms?: string | null;
          notes?: string | null;
          created_at?: string | null;
          short_code?: string | null;
          qb_customer_id?: string | null;
          website?: string | null;
          billing_address?: string | null;
          shipping_address?: string | null;
          tax_exempt?: boolean;
          portal_token?: string | null;
          portal_tier?: string | null;
          hpd_fee_pct?: number | null;
          client_hub_enabled?: boolean;
          allow_cc?: boolean;
          allow_ach?: boolean;
          hpd_per_package_fee?: number | null;
          company_id: string;
          stripe_customer_id?: string | null;
          drive_folder_id?: string | null;
          portal_features: string[];
          is_lead?: boolean;
          is_internal?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          client_type?: string | null;
          default_terms?: string | null;
          notes?: string | null;
          created_at?: string | null;
          short_code?: string | null;
          qb_customer_id?: string | null;
          website?: string | null;
          billing_address?: string | null;
          shipping_address?: string | null;
          tax_exempt?: boolean;
          portal_token?: string | null;
          portal_tier?: string | null;
          hpd_fee_pct?: number | null;
          client_hub_enabled?: boolean;
          allow_cc?: boolean;
          allow_ach?: boolean;
          hpd_per_package_fee?: number | null;
          company_id?: string;
          stripe_customer_id?: string | null;
          drive_folder_id?: string | null;
          portal_features?: string[];
          is_lead?: boolean;
          is_internal?: boolean;
        };
        Relationships: [
          { foreignKeyName: "clients_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      companies: {
        Row: {
          id: string;
          slug: string;
          name: string;
          legal_name: string | null;
          job_number_prefix: string;
          default_payment_provider: string;
          bill_to_address: string | null;
          warehouse_address: string | null;
          from_email_quotes: string | null;
          from_email_production: string | null;
          from_email_billing: string | null;
          branding: Json | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          departments: string[];
          drive_folder_id: string | null;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          legal_name?: string | null;
          job_number_prefix?: string;
          default_payment_provider?: string;
          bill_to_address?: string | null;
          warehouse_address?: string | null;
          from_email_quotes?: string | null;
          from_email_production?: string | null;
          from_email_billing?: string | null;
          branding?: Json | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          departments: string[];
          drive_folder_id?: string | null;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          legal_name?: string | null;
          job_number_prefix?: string;
          default_payment_provider?: string;
          bill_to_address?: string | null;
          warehouse_address?: string | null;
          from_email_quotes?: string | null;
          from_email_production?: string | null;
          from_email_billing?: string | null;
          branding?: Json | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          departments?: string[];
          drive_folder_id?: string | null;
        };
        Relationships: [

        ];
      };
      company_item_types: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          name?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "company_item_types_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      contacts: {
        Row: {
          id: string;
          client_id: string | null;
          name: string;
          email: string | null;
          phone: string | null;
          role_label: string | null;
          is_primary: boolean | null;
          created_at: string | null;
          company_id: string;
          doc_routing: string[] | null;
        };
        Insert: {
          id?: string;
          client_id?: string | null;
          name: string;
          email?: string | null;
          phone?: string | null;
          role_label?: string | null;
          is_primary?: boolean | null;
          created_at?: string | null;
          company_id: string;
          doc_routing?: string[] | null;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          name?: string;
          email?: string | null;
          phone?: string | null;
          role_label?: string | null;
          is_primary?: boolean | null;
          created_at?: string | null;
          company_id?: string;
          doc_routing?: string[] | null;
        };
        Relationships: [
          { foreignKeyName: "contacts_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "contacts_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      contractor_pay: {
        Row: {
          contractor_id: string;
          hourly_rate: number;
          qb_vendor_id: string | null;
          qb_vendor_name: string | null;
          updated_at: string;
        };
        Insert: {
          contractor_id: string;
          hourly_rate?: number;
          qb_vendor_id?: string | null;
          qb_vendor_name?: string | null;
          updated_at?: string;
        };
        Update: {
          contractor_id?: string;
          hourly_rate?: number;
          qb_vendor_id?: string | null;
          qb_vendor_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "contractor_pay_contractor_id_fkey"; columns: ["contractor_id"]; isOneToOne: false; referencedRelation: "contractors"; referencedColumns: ["id"] }
        ];
      };
      contractor_pay_runs: {
        Row: {
          id: string;
          contractor_id: string;
          period_start: string;
          period_end: string;
          hours: number;
          rate: number;
          amount: number;
          qb_bill_id: string | null;
          qb_doc_number: string | null;
          pushed_by: string | null;
          pushed_at: string;
          qb_paid_at: string | null;
        };
        Insert: {
          id?: string;
          contractor_id: string;
          period_start: string;
          period_end: string;
          hours: number;
          rate: number;
          amount: number;
          qb_bill_id?: string | null;
          qb_doc_number?: string | null;
          pushed_by?: string | null;
          pushed_at?: string;
          qb_paid_at?: string | null;
        };
        Update: {
          id?: string;
          contractor_id?: string;
          period_start?: string;
          period_end?: string;
          hours?: number;
          rate?: number;
          amount?: number;
          qb_bill_id?: string | null;
          qb_doc_number?: string | null;
          pushed_by?: string | null;
          pushed_at?: string;
          qb_paid_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "contractor_pay_runs_contractor_id_fkey"; columns: ["contractor_id"]; isOneToOne: false; referencedRelation: "contractors"; referencedColumns: ["id"] }
        ];
      };
      contractor_time_entries: {
        Row: {
          id: string;
          contractor_id: string;
          work_date: string;
          time_in: string | null;
          time_out: string | null;
          break_minutes: number;
          notes: string | null;
          created_at: string;
          pay_run_id: string | null;
        };
        Insert: {
          id?: string;
          contractor_id: string;
          work_date: string;
          time_in?: string | null;
          time_out?: string | null;
          break_minutes?: number;
          notes?: string | null;
          created_at?: string;
          pay_run_id?: string | null;
        };
        Update: {
          id?: string;
          contractor_id?: string;
          work_date?: string;
          time_in?: string | null;
          time_out?: string | null;
          break_minutes?: number;
          notes?: string | null;
          created_at?: string;
          pay_run_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "contractor_time_entries_contractor_id_fkey"; columns: ["contractor_id"]; isOneToOne: false; referencedRelation: "contractors"; referencedColumns: ["id"] },
          { foreignKeyName: "contractor_time_entries_pay_run_id_fkey"; columns: ["pay_run_id"]; isOneToOne: false; referencedRelation: "contractor_pay_runs"; referencedColumns: ["id"] }
        ];
      };
      contractors: {
        Row: {
          id: string;
          name: string;
          active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [

        ];
      };
      cost_entries: {
        Row: {
          id: string;
          source: string;
          vendor_id: string | null;
          vendor_name: string | null;
          vendor_invoice_number: string | null;
          po_ref: string | null;
          job_id: string | null;
          amount: number;
          expected_amount: number | null;
          charge_type: string;
          status: string;
          bill_id: string | null;
          not_job_specific: boolean;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          bill_method: string;
          qb_bill_id: string | null;
          qb_pushed_at: string | null;
          bill_group_id: string | null;
          hpd_bill_number: string | null;
          ext_tracking: string | null;
          ext_date: string | null;
          qb_paid_at: string | null;
        };
        Insert: {
          id?: string;
          source?: string;
          vendor_id?: string | null;
          vendor_name?: string | null;
          vendor_invoice_number?: string | null;
          po_ref?: string | null;
          job_id?: string | null;
          amount?: number;
          expected_amount?: number | null;
          charge_type?: string;
          status?: string;
          bill_id?: string | null;
          not_job_specific?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          bill_method?: string;
          qb_bill_id?: string | null;
          qb_pushed_at?: string | null;
          bill_group_id?: string | null;
          hpd_bill_number?: string | null;
          ext_tracking?: string | null;
          ext_date?: string | null;
          qb_paid_at?: string | null;
        };
        Update: {
          id?: string;
          source?: string;
          vendor_id?: string | null;
          vendor_name?: string | null;
          vendor_invoice_number?: string | null;
          po_ref?: string | null;
          job_id?: string | null;
          amount?: number;
          expected_amount?: number | null;
          charge_type?: string;
          status?: string;
          bill_id?: string | null;
          not_job_specific?: boolean;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          bill_method?: string;
          qb_bill_id?: string | null;
          qb_pushed_at?: string | null;
          bill_group_id?: string | null;
          hpd_bill_number?: string | null;
          ext_tracking?: string | null;
          ext_date?: string | null;
          qb_paid_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "cost_entries_vendor_id_fkey"; columns: ["vendor_id"]; isOneToOne: false; referencedRelation: "ap_vendors"; referencedColumns: ["id"] },
          { foreignKeyName: "cost_entries_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] }
        ];
      };
      cost_vendor_status: {
        Row: {
          id: string;
          job_id: string;
          vendor_id: string;
          status: string;
          reason: string | null;
          note: string | null;
          marked_by: string | null;
          marked_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          vendor_id: string;
          status?: string;
          reason?: string | null;
          note?: string | null;
          marked_by?: string | null;
          marked_at?: string;
        };
        Update: {
          id?: string;
          job_id?: string;
          vendor_id?: string;
          status?: string;
          reason?: string | null;
          note?: string | null;
          marked_by?: string | null;
          marked_at?: string;
        };
        Relationships: [
          { foreignKeyName: "cost_vendor_status_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "cost_vendor_status_vendor_id_fkey"; columns: ["vendor_id"]; isOneToOne: false; referencedRelation: "ap_vendors"; referencedColumns: ["id"] }
        ];
      };
      decorator_assignments: {
        Row: {
          id: string;
          item_id: string | null;
          decorator_id: string | null;
          decoration_type: string | null;
          pipeline_stage: string | null;
          strikeoff_status: string | null;
          sent_to_decorator_date: string | null;
          est_completion_date: string | null;
          actual_completion_date: string | null;
          tracking_number: string | null;
          cost: number | null;
          notes: string | null;
          created_at: string | null;
          updated_at: string | null;
          last_issue_note: string | null;
          last_issue_at: string | null;
          issue_resolved_at: string | null;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          decorator_id?: string | null;
          decoration_type?: string | null;
          pipeline_stage?: string | null;
          strikeoff_status?: string | null;
          sent_to_decorator_date?: string | null;
          est_completion_date?: string | null;
          actual_completion_date?: string | null;
          tracking_number?: string | null;
          cost?: number | null;
          notes?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          last_issue_note?: string | null;
          last_issue_at?: string | null;
          issue_resolved_at?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          decorator_id?: string | null;
          decoration_type?: string | null;
          pipeline_stage?: string | null;
          strikeoff_status?: string | null;
          sent_to_decorator_date?: string | null;
          est_completion_date?: string | null;
          actual_completion_date?: string | null;
          tracking_number?: string | null;
          cost?: number | null;
          notes?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          last_issue_note?: string | null;
          last_issue_at?: string | null;
          issue_resolved_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "decorator_assignments_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "decorator_assignments_decorator_id_fkey"; columns: ["decorator_id"]; isOneToOne: false; referencedRelation: "decorators"; referencedColumns: ["id"] }
        ];
      };
      decorators: {
        Row: {
          id: string;
          name: string;
          capabilities: string[] | null;
          location: string | null;
          lead_time_days: number | null;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          notes: string | null;
          external_token: string | null;
          created_at: string | null;
          short_code: string | null;
          phone: string | null;
          address: string | null;
          city: string | null;
          state: string | null;
          zip: string | null;
          pricing_data: Json | null;
          ship_from_address: string | null;
          ship_from_city: string | null;
          ship_from_state: string | null;
          ship_from_zip: string | null;
          contacts_list: Json | null;
          company_id: string;
          default_shipping_route: string | null;
          transit_days: number | null;
          transit_defaults: Json | null;
          default_ship_method: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          capabilities?: string[] | null;
          location?: string | null;
          lead_time_days?: number | null;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          notes?: string | null;
          external_token?: string | null;
          created_at?: string | null;
          short_code?: string | null;
          phone?: string | null;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          pricing_data?: Json | null;
          ship_from_address?: string | null;
          ship_from_city?: string | null;
          ship_from_state?: string | null;
          ship_from_zip?: string | null;
          contacts_list?: Json | null;
          company_id: string;
          default_shipping_route?: string | null;
          transit_days?: number | null;
          transit_defaults?: Json | null;
          default_ship_method?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          capabilities?: string[] | null;
          location?: string | null;
          lead_time_days?: number | null;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          notes?: string | null;
          external_token?: string | null;
          created_at?: string | null;
          short_code?: string | null;
          phone?: string | null;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          pricing_data?: Json | null;
          ship_from_address?: string | null;
          ship_from_city?: string | null;
          ship_from_state?: string | null;
          ship_from_zip?: string | null;
          contacts_list?: Json | null;
          company_id?: string;
          default_shipping_route?: string | null;
          transit_days?: number | null;
          transit_defaults?: Json | null;
          default_ship_method?: string | null;
        };
        Relationships: [
          { foreignKeyName: "decorators_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      design_wo_messages: {
        Row: {
          id: string;
          work_order_id: string;
          sender_role: string;
          sender_name: string | null;
          body: string | null;
          file_id: string | null;
          file_url: string | null;
          file_name: string | null;
          kind: string;
          created_at: string;
          item_file_id: string | null;
          drive_file_id: string | null;
        };
        Insert: {
          id?: string;
          work_order_id: string;
          sender_role: string;
          sender_name?: string | null;
          body?: string | null;
          file_id?: string | null;
          file_url?: string | null;
          file_name?: string | null;
          kind?: string;
          created_at?: string;
          item_file_id?: string | null;
          drive_file_id?: string | null;
        };
        Update: {
          id?: string;
          work_order_id?: string;
          sender_role?: string;
          sender_name?: string | null;
          body?: string | null;
          file_id?: string | null;
          file_url?: string | null;
          file_name?: string | null;
          kind?: string;
          created_at?: string;
          item_file_id?: string | null;
          drive_file_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "design_wo_messages_work_order_id_fkey"; columns: ["work_order_id"]; isOneToOne: false; referencedRelation: "design_work_orders"; referencedColumns: ["id"] },
          { foreignKeyName: "design_wo_messages_file_id_fkey"; columns: ["file_id"]; isOneToOne: false; referencedRelation: "art_brief_files"; referencedColumns: ["id"] },
          { foreignKeyName: "design_wo_messages_item_file_id_fkey"; columns: ["item_file_id"]; isOneToOne: false; referencedRelation: "item_files"; referencedColumns: ["id"] }
        ];
      };
      design_work_orders: {
        Row: {
          id: string;
          brief_id: string | null;
          type: string;
          title: string | null;
          headline: string | null;
          instructions: string | null;
          brief: Json;
          due_by: string | null;
          designer_name: string | null;
          designer_email: string | null;
          token: string;
          state: string;
          accepted_file_id: string | null;
          sent_at: string | null;
          last_designer_at: string | null;
          last_hpd_at: string | null;
          hpd_seen_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          item_id: string | null;
          job_id: string | null;
          accepted_item_file_id: string | null;
        };
        Insert: {
          id?: string;
          brief_id?: string | null;
          type: string;
          title?: string | null;
          headline?: string | null;
          instructions?: string | null;
          brief: Json;
          due_by?: string | null;
          designer_name?: string | null;
          designer_email?: string | null;
          token: string;
          state?: string;
          accepted_file_id?: string | null;
          sent_at?: string | null;
          last_designer_at?: string | null;
          last_hpd_at?: string | null;
          hpd_seen_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          item_id?: string | null;
          job_id?: string | null;
          accepted_item_file_id?: string | null;
        };
        Update: {
          id?: string;
          brief_id?: string | null;
          type?: string;
          title?: string | null;
          headline?: string | null;
          instructions?: string | null;
          brief?: Json;
          due_by?: string | null;
          designer_name?: string | null;
          designer_email?: string | null;
          token?: string;
          state?: string;
          accepted_file_id?: string | null;
          sent_at?: string | null;
          last_designer_at?: string | null;
          last_hpd_at?: string | null;
          hpd_seen_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          item_id?: string | null;
          job_id?: string | null;
          accepted_item_file_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "design_work_orders_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] },
          { foreignKeyName: "design_work_orders_accepted_file_id_fkey"; columns: ["accepted_file_id"]; isOneToOne: false; referencedRelation: "art_brief_files"; referencedColumns: ["id"] },
          { foreignKeyName: "design_work_orders_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "design_work_orders_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "design_work_orders_accepted_item_file_id_fkey"; columns: ["accepted_item_file_id"]; isOneToOne: false; referencedRelation: "item_files"; referencedColumns: ["id"] }
        ];
      };
      designers: {
        Row: {
          id: string;
          name: string | null;
          email: string | null;
          portal_token: string | null;
          active: boolean | null;
          created_at: string | null;
          notes: string | null;
          company_id: string;
        };
        Insert: {
          id?: string;
          name?: string | null;
          email?: string | null;
          portal_token?: string | null;
          active?: boolean | null;
          created_at?: string | null;
          notes?: string | null;
          company_id: string;
        };
        Update: {
          id?: string;
          name?: string | null;
          email?: string | null;
          portal_token?: string | null;
          active?: boolean | null;
          created_at?: string | null;
          notes?: string | null;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "designers_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      doc_links: {
        Row: {
          id: string;
          token: string;
          doc: string;
          label: string | null;
          created_at: string;
          opened_count: number;
          last_opened_at: string | null;
        };
        Insert: {
          id?: string;
          token: string;
          doc: string;
          label?: string | null;
          created_at?: string;
          opened_count?: number;
          last_opened_at?: string | null;
        };
        Update: {
          id?: string;
          token?: string;
          doc?: string;
          label?: string | null;
          created_at?: string;
          opened_count?: number;
          last_opened_at?: string | null;
        };
        Relationships: [

        ];
      };
      email_messages: {
        Row: {
          id: string;
          job_id: string;
          direction: string;
          from_email: string;
          from_name: string | null;
          to_emails: string[];
          cc_emails: string[] | null;
          subject: string | null;
          body_text: string | null;
          body_html: string | null;
          resend_message_id: string | null;
          in_reply_to: string | null;
          created_at: string | null;
          attachments: Json | null;
          channel: string | null;
          decorator_id: string | null;
        };
        Insert: {
          id?: string;
          job_id: string;
          direction: string;
          from_email: string;
          from_name?: string | null;
          to_emails: string[];
          cc_emails?: string[] | null;
          subject?: string | null;
          body_text?: string | null;
          body_html?: string | null;
          resend_message_id?: string | null;
          in_reply_to?: string | null;
          created_at?: string | null;
          attachments?: Json | null;
          channel?: string | null;
          decorator_id?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string;
          direction?: string;
          from_email?: string;
          from_name?: string | null;
          to_emails?: string[];
          cc_emails?: string[] | null;
          subject?: string | null;
          body_text?: string | null;
          body_html?: string | null;
          resend_message_id?: string | null;
          in_reply_to?: string | null;
          created_at?: string | null;
          attachments?: Json | null;
          channel?: string | null;
          decorator_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "email_messages_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "email_messages_decorator_id_fkey"; columns: ["decorator_id"]; isOneToOne: false; referencedRelation: "decorators"; referencedColumns: ["id"] }
        ];
      };
      favorites: {
        Row: {
          id: string;
          supplier: string;
          style_code: string;
          style_name: string;
          created_by: string | null;
          created_at: string | null;
          category: string | null;
        };
        Insert: {
          id?: string;
          supplier: string;
          style_code: string;
          style_name: string;
          created_by?: string | null;
          created_at?: string | null;
          category?: string | null;
        };
        Update: {
          id?: string;
          supplier?: string;
          style_code?: string;
          style_name?: string;
          created_by?: string | null;
          created_at?: string | null;
          category?: string | null;
        };
        Relationships: [

        ];
      };
      fulfillment_daily_logs: {
        Row: {
          id: string;
          project_id: string | null;
          log_date: string;
          starting_orders: number | null;
          orders_shipped: number | null;
          remaining_orders: number | null;
          notes: string | null;
          logged_by: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          log_date?: string;
          starting_orders?: number | null;
          orders_shipped?: number | null;
          remaining_orders?: number | null;
          notes?: string | null;
          logged_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string | null;
          log_date?: string;
          starting_orders?: number | null;
          orders_shipped?: number | null;
          remaining_orders?: number | null;
          notes?: string | null;
          logged_by?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "fulfillment_daily_logs_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "fulfillment_projects"; referencedColumns: ["id"] }
        ];
      };
      fulfillment_inventory: {
        Row: {
          id: string;
          project_id: string;
          source_type: string;
          source_item_id: string | null;
          source_shipment_id: string | null;
          description: string | null;
          qtys: Json | null;
          notes: string | null;
          webstore_entered_at: string | null;
          webstore_entered_by: string | null;
          sort_order: number | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          source_type: string;
          source_item_id?: string | null;
          source_shipment_id?: string | null;
          description?: string | null;
          qtys?: Json | null;
          notes?: string | null;
          webstore_entered_at?: string | null;
          webstore_entered_by?: string | null;
          sort_order?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          source_type?: string;
          source_item_id?: string | null;
          source_shipment_id?: string | null;
          description?: string | null;
          qtys?: Json | null;
          notes?: string | null;
          webstore_entered_at?: string | null;
          webstore_entered_by?: string | null;
          sort_order?: number | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "fulfillment_inventory_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "fulfillment_projects"; referencedColumns: ["id"] },
          { foreignKeyName: "fulfillment_inventory_source_item_id_fkey"; columns: ["source_item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "fulfillment_inventory_source_shipment_id_fkey"; columns: ["source_shipment_id"]; isOneToOne: false; referencedRelation: "outside_shipments"; referencedColumns: ["id"] }
        ];
      };
      fulfillment_projects: {
        Row: {
          id: string;
          client_id: string | null;
          name: string;
          store_name: string | null;
          status: string | null;
          notes: string | null;
          total_units: number | null;
          source_job_id: string | null;
          created_at: string | null;
          mode: string | null;
          platform: string | null;
          store_account: string | null;
          open_date: string | null;
          close_date: string | null;
          target_ship_date: string | null;
          buffer_pct: number | null;
          listed_by: string | null;
          company_id: string;
          preorder_status: string | null;
        };
        Insert: {
          id?: string;
          client_id?: string | null;
          name: string;
          store_name?: string | null;
          status?: string | null;
          notes?: string | null;
          total_units?: number | null;
          source_job_id?: string | null;
          created_at?: string | null;
          mode?: string | null;
          platform?: string | null;
          store_account?: string | null;
          open_date?: string | null;
          close_date?: string | null;
          target_ship_date?: string | null;
          buffer_pct?: number | null;
          listed_by?: string | null;
          company_id: string;
          preorder_status?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          name?: string;
          store_name?: string | null;
          status?: string | null;
          notes?: string | null;
          total_units?: number | null;
          source_job_id?: string | null;
          created_at?: string | null;
          mode?: string | null;
          platform?: string | null;
          store_account?: string | null;
          open_date?: string | null;
          close_date?: string | null;
          target_ship_date?: string | null;
          buffer_pct?: number | null;
          listed_by?: string | null;
          company_id?: string;
          preorder_status?: string | null;
        };
        Relationships: [
          { foreignKeyName: "fulfillment_projects_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "fulfillment_projects_source_job_id_fkey"; columns: ["source_job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "fulfillment_projects_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      history_assignments: {
        Row: {
          key: string;
          product_group: string;
          created_at: string;
        };
        Insert: {
          key: string;
          product_group: string;
          created_at?: string;
        };
        Update: {
          key?: string;
          product_group?: string;
          created_at?: string;
        };
        Relationships: [

        ];
      };
      history_sales: {
        Row: {
          id: string;
          company_id: string | null;
          txn_date: string | null;
          txn_type: string | null;
          doc_num: string | null;
          customer: string | null;
          description: string | null;
          qty: number | null;
          unit_price: number | null;
          amount: number | null;
          product_group: string | null;
          product_name: string | null;
          blank_style: string | null;
          color: string | null;
          size_qtys: Json | null;
          source_file: string | null;
          imported_at: string;
          opshub_job_id: string | null;
          product_parent: string | null;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          txn_date?: string | null;
          txn_type?: string | null;
          doc_num?: string | null;
          customer?: string | null;
          description?: string | null;
          qty?: number | null;
          unit_price?: number | null;
          amount?: number | null;
          product_group?: string | null;
          product_name?: string | null;
          blank_style?: string | null;
          color?: string | null;
          size_qtys?: Json | null;
          source_file?: string | null;
          imported_at?: string;
          opshub_job_id?: string | null;
          product_parent?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          txn_date?: string | null;
          txn_type?: string | null;
          doc_num?: string | null;
          customer?: string | null;
          description?: string | null;
          qty?: number | null;
          unit_price?: number | null;
          amount?: number | null;
          product_group?: string | null;
          product_name?: string | null;
          blank_style?: string | null;
          color?: string | null;
          size_qtys?: Json | null;
          source_file?: string | null;
          imported_at?: string;
          opshub_job_id?: string | null;
          product_parent?: string | null;
        };
        Relationships: [
          { foreignKeyName: "history_sales_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "history_sales_opshub_job_id_fkey"; columns: ["opshub_job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] }
        ];
      };
      history_vendor_costs: {
        Row: {
          id: string;
          company_id: string | null;
          txn_date: string | null;
          txn_type: string | null;
          doc_num: string | null;
          vendor: string | null;
          description: string | null;
          qty: number | null;
          rate: number | null;
          amount: number | null;
          source_file: string | null;
          imported_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          txn_date?: string | null;
          txn_type?: string | null;
          doc_num?: string | null;
          vendor?: string | null;
          description?: string | null;
          qty?: number | null;
          rate?: number | null;
          amount?: number | null;
          source_file?: string | null;
          imported_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          txn_date?: string | null;
          txn_type?: string | null;
          doc_num?: string | null;
          vendor?: string | null;
          description?: string | null;
          qty?: number | null;
          rate?: number | null;
          amount?: number | null;
          source_file?: string | null;
          imported_at?: string;
        };
        Relationships: [
          { foreignKeyName: "history_vendor_costs_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      intake_submissions: {
        Row: {
          id: string;
          status: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          client_id: string | null;
          project_id: string | null;
          project_type: string | null;
          project_name: string | null;
          description: string | null;
          items_count_range: string | null;
          units_range: string | null;
          target_ship_date: string | null;
          budget_range: string | null;
          files: Json;
          items: Json;
          contact_name: string;
          contact_email: string;
          contact_phone: string | null;
          company: string;
          shipping_route: string | null;
          company_slug: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          client_id?: string | null;
          project_id?: string | null;
          project_type?: string | null;
          project_name?: string | null;
          description?: string | null;
          items_count_range?: string | null;
          units_range?: string | null;
          target_ship_date?: string | null;
          budget_range?: string | null;
          files: Json;
          items: Json;
          contact_name: string;
          contact_email: string;
          contact_phone?: string | null;
          company: string;
          shipping_route?: string | null;
          company_slug?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          client_id?: string | null;
          project_id?: string | null;
          project_type?: string | null;
          project_name?: string | null;
          description?: string | null;
          items_count_range?: string | null;
          units_range?: string | null;
          target_ship_date?: string | null;
          budget_range?: string | null;
          files?: Json;
          items?: Json;
          contact_name?: string;
          contact_email?: string;
          contact_phone?: string | null;
          company?: string;
          shipping_route?: string | null;
          company_slug?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "intake_submissions_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "intake_submissions_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] }
        ];
      };
      inventory_records: {
        Row: {
          id: string;
          item_id: string | null;
          size: string;
          qty_on_hand: number | null;
          qty_allocated: number | null;
          qty_available: number | null;
          reorder_threshold: number | null;
          bin_location: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          size: string;
          qty_on_hand?: number | null;
          qty_allocated?: number | null;
          qty_available?: number | null;
          reorder_threshold?: number | null;
          bin_location?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          size?: string;
          qty_on_hand?: number | null;
          qty_allocated?: number | null;
          qty_available?: number | null;
          reorder_threshold?: number | null;
          bin_location?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "inventory_records_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] }
        ];
      };
      item_files: {
        Row: {
          id: string;
          item_id: string | null;
          file_name: string;
          stage: string;
          drive_file_id: string;
          drive_link: string;
          mime_type: string | null;
          file_size: number | null;
          approval: string | null;
          approved_at: string | null;
          notes: string | null;
          uploaded_by: string | null;
          created_at: string | null;
          superseded_at: string | null;
          revision_pending_send: boolean;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          file_name: string;
          stage: string;
          drive_file_id: string;
          drive_link: string;
          mime_type?: string | null;
          file_size?: number | null;
          approval?: string | null;
          approved_at?: string | null;
          notes?: string | null;
          uploaded_by?: string | null;
          created_at?: string | null;
          superseded_at?: string | null;
          revision_pending_send?: boolean;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          file_name?: string;
          stage?: string;
          drive_file_id?: string;
          drive_link?: string;
          mime_type?: string | null;
          file_size?: number | null;
          approval?: string | null;
          approved_at?: string | null;
          notes?: string | null;
          uploaded_by?: string | null;
          created_at?: string | null;
          superseded_at?: string | null;
          revision_pending_send?: boolean;
        };
        Relationships: [
          { foreignKeyName: "item_files_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] }
        ];
      };
      item_store_listings: {
        Row: {
          id: string;
          item_id: string;
          ecomm_project_id: string | null;
          platform: string;
          store_account: string;
          product_id: string | null;
          variant_id: string | null;
          size: string | null;
          color: string | null;
          sell_price: number | null;
          low_stock_threshold: number | null;
          production_lead_days: number | null;
          current_qty: number | null;
          current_qty_synced_at: string | null;
          listed_at: string | null;
          listed_by: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          item_id: string;
          ecomm_project_id?: string | null;
          platform: string;
          store_account: string;
          product_id?: string | null;
          variant_id?: string | null;
          size?: string | null;
          color?: string | null;
          sell_price?: number | null;
          low_stock_threshold?: number | null;
          production_lead_days?: number | null;
          current_qty?: number | null;
          current_qty_synced_at?: string | null;
          listed_at?: string | null;
          listed_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string;
          ecomm_project_id?: string | null;
          platform?: string;
          store_account?: string;
          product_id?: string | null;
          variant_id?: string | null;
          size?: string | null;
          color?: string | null;
          sell_price?: number | null;
          low_stock_threshold?: number | null;
          production_lead_days?: number | null;
          current_qty?: number | null;
          current_qty_synced_at?: string | null;
          listed_at?: string | null;
          listed_by?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "item_store_listings_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "item_store_listings_ecomm_project_id_fkey"; columns: ["ecomm_project_id"]; isOneToOne: false; referencedRelation: "fulfillment_projects"; referencedColumns: ["id"] }
        ];
      };
      items: {
        Row: {
          id: string;
          job_id: string | null;
          name: string;
          blank_vendor: string | null;
          blank_sku: string | null;
          garment_type: string | null;
          status: string | null;
          artwork_status: string | null;
          artwork_url: string | null;
          cost_per_unit: number | null;
          sell_per_unit: number | null;
          notes: string | null;
          sort_order: number | null;
          created_at: string | null;
          blank_costs: Json | null;
          drive_link: string | null;
          incoming_goods: string | null;
          production_notes_po: string | null;
          packing_notes: string | null;
          receiving_data: Json | null;
          pipeline_stage: string | null;
          pipeline_timestamps: Json | null;
          blanks_order_number: string | null;
          blanks_order_cost: number | null;
          ship_tracking: string | null;
          ship_qtys: Json | null;
          mockup_color: string | null;
          received_at_hpd: boolean | null;
          received_at_hpd_at: string | null;
          received_qtys: Json | null;
          ship_notes: string | null;
          cost_per_unit_all_in: number | null;
          design_id: string | null;
          specialty_stage: Json | null;
          sample_qtys: Json;
          company_id: string;
          drive_folder_id: string | null;
          client_eta: string | null;
          client_eta_set_at: string | null;
          client_eta_note: string | null;
          working_status: string | null;
          client_retail_per_unit: number | null;
          archived_at: string | null;
          completed_at: string | null;
          shipping_route: string | null;
          is_fleece: boolean | null;
          webstore_entered_at: string | null;
          webstore_entered_by: string | null;
          proof_spec: Json | null;
          sample_pulls: Json;
          qb_item_type: string | null;
          forwarded_at: string | null;
          forward_tracking: string | null;
          pickup_ready: boolean;
          expected_arrival: string | null;
          size_subs: Json;
          ship_final: boolean;
          variance_resolved: Json | null;
          product_id: string | null;
          ship_est: string | null;
          proof_sent_at: string | null;
          release_slot_id: string | null;
        };
        Insert: {
          id?: string;
          job_id?: string | null;
          name: string;
          blank_vendor?: string | null;
          blank_sku?: string | null;
          garment_type?: string | null;
          status?: string | null;
          artwork_status?: string | null;
          artwork_url?: string | null;
          cost_per_unit?: number | null;
          sell_per_unit?: number | null;
          notes?: string | null;
          sort_order?: number | null;
          created_at?: string | null;
          blank_costs?: Json | null;
          drive_link?: string | null;
          incoming_goods?: string | null;
          production_notes_po?: string | null;
          packing_notes?: string | null;
          receiving_data?: Json | null;
          pipeline_stage?: string | null;
          pipeline_timestamps?: Json | null;
          blanks_order_number?: string | null;
          blanks_order_cost?: number | null;
          ship_tracking?: string | null;
          ship_qtys?: Json | null;
          mockup_color?: string | null;
          received_at_hpd?: boolean | null;
          received_at_hpd_at?: string | null;
          received_qtys?: Json | null;
          ship_notes?: string | null;
          cost_per_unit_all_in?: number | null;
          design_id?: string | null;
          specialty_stage?: Json | null;
          sample_qtys: Json;
          company_id: string;
          drive_folder_id?: string | null;
          client_eta?: string | null;
          client_eta_set_at?: string | null;
          client_eta_note?: string | null;
          working_status?: string | null;
          client_retail_per_unit?: number | null;
          archived_at?: string | null;
          completed_at?: string | null;
          shipping_route?: string | null;
          is_fleece?: boolean | null;
          webstore_entered_at?: string | null;
          webstore_entered_by?: string | null;
          proof_spec?: Json | null;
          sample_pulls: Json;
          qb_item_type?: string | null;
          forwarded_at?: string | null;
          forward_tracking?: string | null;
          pickup_ready?: boolean;
          expected_arrival?: string | null;
          size_subs: Json;
          ship_final?: boolean;
          variance_resolved?: Json | null;
          product_id?: string | null;
          ship_est?: string | null;
          proof_sent_at?: string | null;
          release_slot_id?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string | null;
          name?: string;
          blank_vendor?: string | null;
          blank_sku?: string | null;
          garment_type?: string | null;
          status?: string | null;
          artwork_status?: string | null;
          artwork_url?: string | null;
          cost_per_unit?: number | null;
          sell_per_unit?: number | null;
          notes?: string | null;
          sort_order?: number | null;
          created_at?: string | null;
          blank_costs?: Json | null;
          drive_link?: string | null;
          incoming_goods?: string | null;
          production_notes_po?: string | null;
          packing_notes?: string | null;
          receiving_data?: Json | null;
          pipeline_stage?: string | null;
          pipeline_timestamps?: Json | null;
          blanks_order_number?: string | null;
          blanks_order_cost?: number | null;
          ship_tracking?: string | null;
          ship_qtys?: Json | null;
          mockup_color?: string | null;
          received_at_hpd?: boolean | null;
          received_at_hpd_at?: string | null;
          received_qtys?: Json | null;
          ship_notes?: string | null;
          cost_per_unit_all_in?: number | null;
          design_id?: string | null;
          specialty_stage?: Json | null;
          sample_qtys?: Json;
          company_id?: string;
          drive_folder_id?: string | null;
          client_eta?: string | null;
          client_eta_set_at?: string | null;
          client_eta_note?: string | null;
          working_status?: string | null;
          client_retail_per_unit?: number | null;
          archived_at?: string | null;
          completed_at?: string | null;
          shipping_route?: string | null;
          is_fleece?: boolean | null;
          webstore_entered_at?: string | null;
          webstore_entered_by?: string | null;
          proof_spec?: Json | null;
          sample_pulls?: Json;
          qb_item_type?: string | null;
          forwarded_at?: string | null;
          forward_tracking?: string | null;
          pickup_ready?: boolean;
          expected_arrival?: string | null;
          size_subs?: Json;
          ship_final?: boolean;
          variance_resolved?: Json | null;
          product_id?: string | null;
          ship_est?: string | null;
          proof_sent_at?: string | null;
          release_slot_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "items_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "items_design_id_fkey"; columns: ["design_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] },
          { foreignKeyName: "items_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "items_product_id_fkey"; columns: ["product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"] },
          { foreignKeyName: "items_release_slot_id_fkey"; columns: ["release_slot_id"]; isOneToOne: false; referencedRelation: "release_slots"; referencedColumns: ["id"] }
        ];
      };
      job_activity: {
        Row: {
          id: string;
          job_id: string | null;
          user_id: string | null;
          type: string;
          message: string;
          metadata: Json | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          job_id?: string | null;
          user_id?: string | null;
          type?: string;
          message: string;
          metadata?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string | null;
          user_id?: string | null;
          type?: string;
          message?: string;
          metadata?: Json | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "job_activity_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] }
        ];
      };
      job_contacts: {
        Row: {
          id: string;
          job_id: string | null;
          contact_id: string | null;
          role_on_job: string | null;
          notify: boolean | null;
        };
        Insert: {
          id?: string;
          job_id?: string | null;
          contact_id?: string | null;
          role_on_job?: string | null;
          notify?: boolean | null;
        };
        Update: {
          id?: string;
          job_id?: string | null;
          contact_id?: string | null;
          role_on_job?: string | null;
          notify?: boolean | null;
        };
        Relationships: [
          { foreignKeyName: "job_contacts_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "job_contacts_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "contacts"; referencedColumns: ["id"] }
        ];
      };
      job_templates: {
        Row: {
          id: string;
          name: string;
          client_id: string | null;
          job_type: string | null;
          default_items: Json | null;
          default_contacts: Json | null;
          payment_terms: string | null;
          notes: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          client_id?: string | null;
          job_type?: string | null;
          default_items?: Json | null;
          default_contacts?: Json | null;
          payment_terms?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          client_id?: string | null;
          job_type?: string | null;
          default_items?: Json | null;
          default_contacts?: Json | null;
          payment_terms?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "job_templates_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }
        ];
      };
      jobs: {
        Row: {
          id: string;
          client_id: string | null;
          parent_job_id: string | null;
          template_id: string | null;
          job_number: string;
          job_type: string;
          title: string;
          phase: string | null;
          priority: string | null;
          payment_terms: string | null;
          contract_status: string | null;
          notes: string | null;
          target_ship_date: string | null;
          est_completion: string | null;
          type_meta: Json | null;
          created_at: string | null;
          updated_at: string | null;
          costing_data: Json | null;
          costing_summary: Json | null;
          phase_timestamps: Json | null;
          quote_approved: boolean | null;
          quote_approved_at: string | null;
          shipping_route: string | null;
          fulfillment_status: string | null;
          fulfillment_tracking: string | null;
          portal_token: string | null;
          quote_rejection_notes: string | null;
          company_id: string;
          drive_folder_id: string | null;
          is_inventory: boolean;
          is_test: boolean;
          release_id: string | null;
          financial_closed_at: string | null;
          financial_closed_by: string | null;
          is_internal: boolean;
        };
        Insert: {
          id?: string;
          client_id?: string | null;
          parent_job_id?: string | null;
          template_id?: string | null;
          job_number: string;
          job_type: string;
          title: string;
          phase?: string | null;
          priority?: string | null;
          payment_terms?: string | null;
          contract_status?: string | null;
          notes?: string | null;
          target_ship_date?: string | null;
          est_completion?: string | null;
          type_meta?: Json | null;
          created_at?: string | null;
          updated_at?: string | null;
          costing_data?: Json | null;
          costing_summary?: Json | null;
          phase_timestamps?: Json | null;
          quote_approved?: boolean | null;
          quote_approved_at?: string | null;
          shipping_route?: string | null;
          fulfillment_status?: string | null;
          fulfillment_tracking?: string | null;
          portal_token?: string | null;
          quote_rejection_notes?: string | null;
          company_id: string;
          drive_folder_id?: string | null;
          is_inventory?: boolean;
          is_test?: boolean;
          release_id?: string | null;
          financial_closed_at?: string | null;
          financial_closed_by?: string | null;
          is_internal?: boolean;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          parent_job_id?: string | null;
          template_id?: string | null;
          job_number?: string;
          job_type?: string;
          title?: string;
          phase?: string | null;
          priority?: string | null;
          payment_terms?: string | null;
          contract_status?: string | null;
          notes?: string | null;
          target_ship_date?: string | null;
          est_completion?: string | null;
          type_meta?: Json | null;
          created_at?: string | null;
          updated_at?: string | null;
          costing_data?: Json | null;
          costing_summary?: Json | null;
          phase_timestamps?: Json | null;
          quote_approved?: boolean | null;
          quote_approved_at?: string | null;
          shipping_route?: string | null;
          fulfillment_status?: string | null;
          fulfillment_tracking?: string | null;
          portal_token?: string | null;
          quote_rejection_notes?: string | null;
          company_id?: string;
          drive_folder_id?: string | null;
          is_inventory?: boolean;
          is_test?: boolean;
          release_id?: string | null;
          financial_closed_at?: string | null;
          financial_closed_by?: string | null;
          is_internal?: boolean;
        };
        Relationships: [
          { foreignKeyName: "jobs_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "jobs_parent_job_id_fkey"; columns: ["parent_job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "jobs_template_id_fkey"; columns: ["template_id"]; isOneToOne: false; referencedRelation: "job_templates"; referencedColumns: ["id"] },
          { foreignKeyName: "jobs_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "jobs_release_id_fkey"; columns: ["release_id"]; isOneToOne: false; referencedRelation: "releases"; referencedColumns: ["id"] }
        ];
      };
      la_apparel_catalog: {
        Row: {
          id: string;
          category: string;
          style_code: string;
          color_type: string;
          description: string;
          case_pack: number | null;
          sizes: string;
          case_price: number;
          colors: string[] | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          category: string;
          style_code: string;
          color_type?: string;
          description: string;
          case_pack?: number | null;
          sizes: string;
          case_price: number;
          colors?: string[] | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          category?: string;
          style_code?: string;
          color_type?: string;
          description?: string;
          case_pack?: number | null;
          sizes?: string;
          case_price?: number;
          colors?: string[] | null;
          created_at?: string | null;
        };
        Relationships: [

        ];
      };
      lab_clients: {
        Row: {
          id: string;
          name: string;
          token: string;
          created_at: string;
          client_id: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          token: string;
          created_at?: string;
          client_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          token?: string;
          created_at?: string;
          client_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "lab_clients_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }
        ];
      };
      lab_messages: {
        Row: {
          id: string;
          thread_id: string;
          sender_role: string;
          sender_name: string | null;
          body: string | null;
          visibility: string;
          file_url: string | null;
          file_name: string | null;
          kind: string;
          created_at: string;
          reaction: string | null;
        };
        Insert: {
          id?: string;
          thread_id: string;
          sender_role: string;
          sender_name?: string | null;
          body?: string | null;
          visibility?: string;
          file_url?: string | null;
          file_name?: string | null;
          kind?: string;
          created_at?: string;
          reaction?: string | null;
        };
        Update: {
          id?: string;
          thread_id?: string;
          sender_role?: string;
          sender_name?: string | null;
          body?: string | null;
          visibility?: string;
          file_url?: string | null;
          file_name?: string | null;
          kind?: string;
          created_at?: string;
          reaction?: string | null;
        };
        Relationships: [
          { foreignKeyName: "lab_messages_thread_id_fkey"; columns: ["thread_id"]; isOneToOne: false; referencedRelation: "lab_threads"; referencedColumns: ["id"] }
        ];
      };
      lab_order_requests: {
        Row: {
          id: string;
          thread_id: string | null;
          client_id: string | null;
          design_msg_id: string | null;
          design_file_url: string | null;
          blank: string | null;
          qty: number | null;
          note: string | null;
          handled_at: string | null;
          created_at: string;
          job_id: string | null;
          brief_id: string | null;
        };
        Insert: {
          id?: string;
          thread_id?: string | null;
          client_id?: string | null;
          design_msg_id?: string | null;
          design_file_url?: string | null;
          blank?: string | null;
          qty?: number | null;
          note?: string | null;
          handled_at?: string | null;
          created_at?: string;
          job_id?: string | null;
          brief_id?: string | null;
        };
        Update: {
          id?: string;
          thread_id?: string | null;
          client_id?: string | null;
          design_msg_id?: string | null;
          design_file_url?: string | null;
          blank?: string | null;
          qty?: number | null;
          note?: string | null;
          handled_at?: string | null;
          created_at?: string;
          job_id?: string | null;
          brief_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "lab_order_requests_thread_id_fkey"; columns: ["thread_id"]; isOneToOne: false; referencedRelation: "lab_threads"; referencedColumns: ["id"] },
          { foreignKeyName: "lab_order_requests_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "lab_clients"; referencedColumns: ["id"] },
          { foreignKeyName: "lab_order_requests_design_msg_id_fkey"; columns: ["design_msg_id"]; isOneToOne: false; referencedRelation: "lab_messages"; referencedColumns: ["id"] },
          { foreignKeyName: "lab_order_requests_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "lab_order_requests_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] }
        ];
      };
      lab_threads: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          state: string;
          initiated_by: string;
          approved_at: string | null;
          approved_by: string | null;
          approved_file_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          title: string;
          state?: string;
          initiated_by?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_file_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          title?: string;
          state?: string;
          initiated_by?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_file_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "lab_threads_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "lab_clients"; referencedColumns: ["id"] }
        ];
      };
      lab_wo_messages: {
        Row: {
          id: string;
          work_order_id: string;
          sender_role: string;
          sender_name: string | null;
          body: string | null;
          file_url: string | null;
          file_name: string | null;
          kind: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          work_order_id: string;
          sender_role: string;
          sender_name?: string | null;
          body?: string | null;
          file_url?: string | null;
          file_name?: string | null;
          kind?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          work_order_id?: string;
          sender_role?: string;
          sender_name?: string | null;
          body?: string | null;
          file_url?: string | null;
          file_name?: string | null;
          kind?: string;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "lab_wo_messages_work_order_id_fkey"; columns: ["work_order_id"]; isOneToOne: false; referencedRelation: "lab_work_orders"; referencedColumns: ["id"] }
        ];
      };
      lab_work_orders: {
        Row: {
          id: string;
          thread_id: string;
          type: string;
          title: string | null;
          instructions: string | null;
          due_by: string | null;
          designer_name: string | null;
          token: string;
          source_file_url: string | null;
          accepted_file_url: string | null;
          state: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          type: string;
          title?: string | null;
          instructions?: string | null;
          due_by?: string | null;
          designer_name?: string | null;
          token: string;
          source_file_url?: string | null;
          accepted_file_url?: string | null;
          state?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          thread_id?: string;
          type?: string;
          title?: string | null;
          instructions?: string | null;
          due_by?: string | null;
          designer_name?: string | null;
          token?: string;
          source_file_url?: string | null;
          accepted_file_url?: string | null;
          state?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "lab_work_orders_thread_id_fkey"; columns: ["thread_id"]; isOneToOne: false; referencedRelation: "lab_threads"; referencedColumns: ["id"] }
        ];
      };
      legacy_art_files: {
        Row: {
          id: string;
          company_id: string | null;
          client_id: string | null;
          root_folder_id: string;
          drive_file_id: string;
          file_name: string | null;
          mime_type: string | null;
          folder_path: string | null;
          size_bytes: number | null;
          modified_at: string | null;
          indexed_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          client_id?: string | null;
          root_folder_id: string;
          drive_file_id: string;
          file_name?: string | null;
          mime_type?: string | null;
          folder_path?: string | null;
          size_bytes?: number | null;
          modified_at?: string | null;
          indexed_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          client_id?: string | null;
          root_folder_id?: string;
          drive_file_id?: string;
          file_name?: string | null;
          mime_type?: string | null;
          folder_path?: string | null;
          size_bytes?: number | null;
          modified_at?: string | null;
          indexed_at?: string;
        };
        Relationships: [
          { foreignKeyName: "legacy_art_files_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "legacy_art_files_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }
        ];
      };
      lineup_options: {
        Row: {
          id: string;
          lineup_id: string;
          position: number;
          label: string | null;
          drive_file_id: string | null;
          preview_drive_file_id: string | null;
          drive_link: string | null;
          mime_type: string | null;
          file_size: number | null;
          picked: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          lineup_id: string;
          position: number;
          label?: string | null;
          drive_file_id?: string | null;
          preview_drive_file_id?: string | null;
          drive_link?: string | null;
          mime_type?: string | null;
          file_size?: number | null;
          picked?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          lineup_id?: string;
          position?: number;
          label?: string | null;
          drive_file_id?: string | null;
          preview_drive_file_id?: string | null;
          drive_link?: string | null;
          mime_type?: string | null;
          file_size?: number | null;
          picked?: boolean;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "lineup_options_lineup_id_fkey"; columns: ["lineup_id"]; isOneToOne: false; referencedRelation: "lineups"; referencedColumns: ["id"] }
        ];
      };
      lineups: {
        Row: {
          id: string;
          brief_id: string;
          sent_at: string | null;
          picks_at: string | null;
          closed_at: string | null;
          client_note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          brief_id: string;
          sent_at?: string | null;
          picks_at?: string | null;
          closed_at?: string | null;
          client_note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          brief_id?: string;
          sent_at?: string | null;
          picks_at?: string | null;
          closed_at?: string | null;
          client_note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "lineups_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] }
        ];
      };
      mail_log: {
        Row: {
          id: string;
          company_id: string | null;
          kind: string;
          to_addrs: string[];
          subject: string | null;
          job_id: string | null;
          meta: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          kind: string;
          to_addrs: string[];
          subject?: string | null;
          job_id?: string | null;
          meta: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          kind?: string;
          to_addrs?: string[];
          subject?: string | null;
          job_id?: string | null;
          meta?: Json;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "mail_log_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      messages: {
        Row: {
          id: string;
          user_id: string | null;
          message: string;
          created_at: string | null;
          company_id: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          message: string;
          created_at?: string | null;
          company_id: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          message?: string;
          created_at?: string | null;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "messages_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      movements: {
        Row: {
          id: string;
          company_id: string | null;
          item_id: string | null;
          job_id: string | null;
          description: string | null;
          type: string;
          qtys: Json;
          shipment_id: string | null;
          packing_slip_id: string | null;
          tracking: string | null;
          reason: string | null;
          source: string;
          reverses_id: string | null;
          created_by: string | null;
          created_by_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          item_id?: string | null;
          job_id?: string | null;
          description?: string | null;
          type: string;
          qtys: Json;
          shipment_id?: string | null;
          packing_slip_id?: string | null;
          tracking?: string | null;
          reason?: string | null;
          source?: string;
          reverses_id?: string | null;
          created_by?: string | null;
          created_by_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          item_id?: string | null;
          job_id?: string | null;
          description?: string | null;
          type?: string;
          qtys?: Json;
          shipment_id?: string | null;
          packing_slip_id?: string | null;
          tracking?: string | null;
          reason?: string | null;
          source?: string;
          reverses_id?: string | null;
          created_by?: string | null;
          created_by_name?: string | null;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "movements_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "movements_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "movements_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "movements_shipment_id_fkey"; columns: ["shipment_id"]; isOneToOne: false; referencedRelation: "shipments"; referencedColumns: ["id"] },
          { foreignKeyName: "movements_reverses_id_fkey"; columns: ["reverses_id"]; isOneToOne: false; referencedRelation: "movements"; referencedColumns: ["id"] }
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string | null;
          type: string;
          message: string;
          reference_id: string | null;
          reference_type: string | null;
          read: boolean | null;
          created_at: string | null;
          company_id: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          type: string;
          message: string;
          reference_id?: string | null;
          reference_type?: string | null;
          read?: boolean | null;
          created_at?: string | null;
          company_id: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          type?: string;
          message?: string;
          reference_id?: string | null;
          reference_type?: string | null;
          read?: boolean | null;
          created_at?: string | null;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "notifications_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      outside_shipments: {
        Row: {
          id: string;
          carrier: string | null;
          tracking: string | null;
          sender: string | null;
          description: string | null;
          condition: string | null;
          notes: string | null;
          job_id: string | null;
          received_by: string | null;
          received_at: string | null;
          resolved: boolean | null;
          files: Json | null;
          drive_folder_link: string | null;
          created_at: string | null;
          route: string | null;
          company_id: string;
          line_items: Json;
          status: string;
          ship_tracking: string | null;
          client_id: string | null;
        };
        Insert: {
          id?: string;
          carrier?: string | null;
          tracking?: string | null;
          sender?: string | null;
          description?: string | null;
          condition?: string | null;
          notes?: string | null;
          job_id?: string | null;
          received_by?: string | null;
          received_at?: string | null;
          resolved?: boolean | null;
          files?: Json | null;
          drive_folder_link?: string | null;
          created_at?: string | null;
          route?: string | null;
          company_id: string;
          line_items: Json;
          status?: string;
          ship_tracking?: string | null;
          client_id?: string | null;
        };
        Update: {
          id?: string;
          carrier?: string | null;
          tracking?: string | null;
          sender?: string | null;
          description?: string | null;
          condition?: string | null;
          notes?: string | null;
          job_id?: string | null;
          received_by?: string | null;
          received_at?: string | null;
          resolved?: boolean | null;
          files?: Json | null;
          drive_folder_link?: string | null;
          created_at?: string | null;
          route?: string | null;
          company_id?: string;
          line_items?: Json;
          status?: string;
          ship_tracking?: string | null;
          client_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "outside_shipments_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "outside_shipments_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "outside_shipments_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }
        ];
      };
      packing_slips: {
        Row: {
          id: string;
          company_id: string | null;
          shipment_id: string | null;
          job_id: string | null;
          client_id: string | null;
          slip_number: string | null;
          frozen_lines: Json;
          tracking: string | null;
          carrier: string | null;
          pdf_url: string | null;
          drive_file_id: string | null;
          generated_by: string | null;
          generated_by_name: string | null;
          generated_at: string;
          sent_at: string | null;
          sent_to: string | null;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          shipment_id?: string | null;
          job_id?: string | null;
          client_id?: string | null;
          slip_number?: string | null;
          frozen_lines: Json;
          tracking?: string | null;
          carrier?: string | null;
          pdf_url?: string | null;
          drive_file_id?: string | null;
          generated_by?: string | null;
          generated_by_name?: string | null;
          generated_at?: string;
          sent_at?: string | null;
          sent_to?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          shipment_id?: string | null;
          job_id?: string | null;
          client_id?: string | null;
          slip_number?: string | null;
          frozen_lines?: Json;
          tracking?: string | null;
          carrier?: string | null;
          pdf_url?: string | null;
          drive_file_id?: string | null;
          generated_by?: string | null;
          generated_by_name?: string | null;
          generated_at?: string;
          sent_at?: string | null;
          sent_to?: string | null;
        };
        Relationships: [
          { foreignKeyName: "packing_slips_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "packing_slips_shipment_id_fkey"; columns: ["shipment_id"]; isOneToOne: false; referencedRelation: "shipments"; referencedColumns: ["id"] },
          { foreignKeyName: "packing_slips_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "packing_slips_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }
        ];
      };
      payment_records: {
        Row: {
          id: string;
          job_id: string | null;
          qb_invoice_id: string | null;
          invoice_number: string | null;
          type: string | null;
          amount: number | null;
          status: string | null;
          due_date: string | null;
          paid_date: string | null;
          synced_at: string | null;
          created_at: string | null;
          company_id: string;
          qb_payment_id: string | null;
        };
        Insert: {
          id?: string;
          job_id?: string | null;
          qb_invoice_id?: string | null;
          invoice_number?: string | null;
          type?: string | null;
          amount?: number | null;
          status?: string | null;
          due_date?: string | null;
          paid_date?: string | null;
          synced_at?: string | null;
          created_at?: string | null;
          company_id: string;
          qb_payment_id?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string | null;
          qb_invoice_id?: string | null;
          invoice_number?: string | null;
          type?: string | null;
          amount?: number | null;
          status?: string | null;
          due_date?: string | null;
          paid_date?: string | null;
          synced_at?: string | null;
          created_at?: string | null;
          company_id?: string;
          qb_payment_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: "payment_records_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "payment_records_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      preorder_products: {
        Row: {
          id: string;
          preorder_id: string;
          name: string;
          blank_vendor: string | null;
          blank_sku: string | null;
          sizes: string[] | null;
          retail_price: number | null;
          mockup_drive_file_id: string | null;
          shopify_product_url: string | null;
          sort_order: number | null;
          is_built_in_shopify: boolean | null;
          built_in_shopify_at: string | null;
          built_in_shopify_by: string | null;
          notes: string | null;
          created_at: string | null;
          image_url: string | null;
        };
        Insert: {
          id?: string;
          preorder_id: string;
          name: string;
          blank_vendor?: string | null;
          blank_sku?: string | null;
          sizes?: string[] | null;
          retail_price?: number | null;
          mockup_drive_file_id?: string | null;
          shopify_product_url?: string | null;
          sort_order?: number | null;
          is_built_in_shopify?: boolean | null;
          built_in_shopify_at?: string | null;
          built_in_shopify_by?: string | null;
          notes?: string | null;
          created_at?: string | null;
          image_url?: string | null;
        };
        Update: {
          id?: string;
          preorder_id?: string;
          name?: string;
          blank_vendor?: string | null;
          blank_sku?: string | null;
          sizes?: string[] | null;
          retail_price?: number | null;
          mockup_drive_file_id?: string | null;
          shopify_product_url?: string | null;
          sort_order?: number | null;
          is_built_in_shopify?: boolean | null;
          built_in_shopify_at?: string | null;
          built_in_shopify_by?: string | null;
          notes?: string | null;
          created_at?: string | null;
          image_url?: string | null;
        };
        Relationships: [
          { foreignKeyName: "preorder_products_preorder_id_fkey"; columns: ["preorder_id"]; isOneToOne: false; referencedRelation: "fulfillment_projects"; referencedColumns: ["id"] }
        ];
      };
      products: {
        Row: {
          id: string;
          company_id: string | null;
          client_id: string;
          brief_id: string | null;
          line_id: string | null;
          parent_product_id: string | null;
          title: string;
          format: string | null;
          retail: number | null;
          model: string | null;
          notes: string | null;
          spec: Json;
          state: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          client_id: string;
          brief_id?: string | null;
          line_id?: string | null;
          parent_product_id?: string | null;
          title: string;
          format?: string | null;
          retail?: number | null;
          model?: string | null;
          notes?: string | null;
          spec: Json;
          state?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          client_id?: string;
          brief_id?: string | null;
          line_id?: string | null;
          parent_product_id?: string | null;
          title?: string;
          format?: string | null;
          retail?: number | null;
          model?: string | null;
          notes?: string | null;
          spec?: Json;
          state?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "products_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "products_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "products_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] },
          { foreignKeyName: "products_parent_product_id_fkey"; columns: ["parent_product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["id"] }
        ];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: string | null;
          assigned_client_ids: string[] | null;
          created_at: string | null;
          departments: string[] | null;
          extra_access: string[] | null;
          is_god: boolean;
          page_access: string[] | null;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: string | null;
          assigned_client_ids?: string[] | null;
          created_at?: string | null;
          departments?: string[] | null;
          extra_access?: string[] | null;
          is_god?: boolean;
          page_access?: string[] | null;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: string | null;
          assigned_client_ids?: string[] | null;
          created_at?: string | null;
          departments?: string[] | null;
          extra_access?: string[] | null;
          is_god?: boolean;
          page_access?: string[] | null;
        };
        Relationships: [

        ];
      };
      pull_requests: {
        Row: {
          id: string;
          company_id: string | null;
          job_id: string | null;
          item_id: string;
          shipment_id: string | null;
          kind: string;
          qtys: Json;
          fulfilled_qtys: Json | null;
          reason: string | null;
          status: string;
          requested_by: string | null;
          requested_by_name: string | null;
          created_at: string;
          fulfilled_at: string | null;
          fulfilled_by: string | null;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          job_id?: string | null;
          item_id: string;
          shipment_id?: string | null;
          kind?: string;
          qtys: Json;
          fulfilled_qtys?: Json | null;
          reason?: string | null;
          status?: string;
          requested_by?: string | null;
          requested_by_name?: string | null;
          created_at?: string;
          fulfilled_at?: string | null;
          fulfilled_by?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          job_id?: string | null;
          item_id?: string;
          shipment_id?: string | null;
          kind?: string;
          qtys?: Json;
          fulfilled_qtys?: Json | null;
          reason?: string | null;
          status?: string;
          requested_by?: string | null;
          requested_by_name?: string | null;
          created_at?: string;
          fulfilled_at?: string | null;
          fulfilled_by?: string | null;
        };
        Relationships: [
          { foreignKeyName: "pull_requests_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "pull_requests_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "pull_requests_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "pull_requests_shipment_id_fkey"; columns: ["shipment_id"]; isOneToOne: false; referencedRelation: "shipments"; referencedColumns: ["id"] }
        ];
      };
      pulled_inventory: {
        Row: {
          id: string;
          company_id: string | null;
          pull_request_id: string | null;
          job_id: string | null;
          item_id: string | null;
          item_name: string | null;
          qtys: Json;
          location: string | null;
          status: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          pull_request_id?: string | null;
          job_id?: string | null;
          item_id?: string | null;
          item_name?: string | null;
          qtys: Json;
          location?: string | null;
          status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          pull_request_id?: string | null;
          job_id?: string | null;
          item_id?: string | null;
          item_name?: string | null;
          qtys?: Json;
          location?: string | null;
          status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "pulled_inventory_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "pulled_inventory_pull_request_id_fkey"; columns: ["pull_request_id"]; isOneToOne: false; referencedRelation: "pull_requests"; referencedColumns: ["id"] },
          { foreignKeyName: "pulled_inventory_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] },
          { foreignKeyName: "pulled_inventory_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] }
        ];
      };
      qb_tokens: {
        Row: {
          id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          realm_id: string | null;
          created_at: string | null;
          updated_at: string | null;
          company_id: string;
        };
        Insert: {
          id?: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          realm_id?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          company_id: string;
        };
        Update: {
          id?: string;
          access_token?: string;
          refresh_token?: string;
          expires_at?: string;
          realm_id?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "qb_tokens_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      release_items: {
        Row: {
          id: string;
          release_id: string;
          item_id: string | null;
          sort_order: number;
          created_at: string;
          proposal_id: string | null;
          row_index: number;
        };
        Insert: {
          id?: string;
          release_id: string;
          item_id?: string | null;
          sort_order?: number;
          created_at?: string;
          proposal_id?: string | null;
          row_index?: number;
        };
        Update: {
          id?: string;
          release_id?: string;
          item_id?: string | null;
          sort_order?: number;
          created_at?: string;
          proposal_id?: string | null;
          row_index?: number;
        };
        Relationships: [
          { foreignKeyName: "release_items_release_id_fkey"; columns: ["release_id"]; isOneToOne: false; referencedRelation: "client_releases"; referencedColumns: ["id"] },
          { foreignKeyName: "release_items_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "release_items_proposal_id_fkey"; columns: ["proposal_id"]; isOneToOne: false; referencedRelation: "client_proposal_items"; referencedColumns: ["id"] }
        ];
      };
      release_slots: {
        Row: {
          id: string;
          company_id: string | null;
          release_id: string;
          brief_id: string | null;
          line_id: string;
          format: string | null;
          retail: number | null;
          model: string | null;
          line_notes: string | null;
          sold_units: number | null;
          qtys: Json;
          qtys_confirmed_at: string | null;
          item_id: string | null;
          sort_order: number;
          created_at: string;
          sold_qtys: Json;
          sold_updated_at: string | null;
          overage_pct: number;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          release_id: string;
          brief_id?: string | null;
          line_id: string;
          format?: string | null;
          retail?: number | null;
          model?: string | null;
          line_notes?: string | null;
          sold_units?: number | null;
          qtys: Json;
          qtys_confirmed_at?: string | null;
          item_id?: string | null;
          sort_order?: number;
          created_at?: string;
          sold_qtys: Json;
          sold_updated_at?: string | null;
          overage_pct?: number;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          release_id?: string;
          brief_id?: string | null;
          line_id?: string;
          format?: string | null;
          retail?: number | null;
          model?: string | null;
          line_notes?: string | null;
          sold_units?: number | null;
          qtys?: Json;
          qtys_confirmed_at?: string | null;
          item_id?: string | null;
          sort_order?: number;
          created_at?: string;
          sold_qtys?: Json;
          sold_updated_at?: string | null;
          overage_pct?: number;
        };
        Relationships: [
          { foreignKeyName: "release_slots_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "release_slots_release_id_fkey"; columns: ["release_id"]; isOneToOne: false; referencedRelation: "releases"; referencedColumns: ["id"] },
          { foreignKeyName: "release_slots_brief_id_fkey"; columns: ["brief_id"]; isOneToOne: false; referencedRelation: "art_briefs"; referencedColumns: ["id"] },
          { foreignKeyName: "release_slots_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] }
        ];
      };
      releases: {
        Row: {
          id: string;
          company_id: string | null;
          client_id: string;
          title: string;
          status: string;
          model: string | null;
          target_live_date: string | null;
          window_close_date: string | null;
          notes: string | null;
          meta: Json;
          job_id: string | null;
          status_timestamps: Json;
          cut_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          client_id: string;
          title: string;
          status?: string;
          model?: string | null;
          target_live_date?: string | null;
          window_close_date?: string | null;
          notes?: string | null;
          meta: Json;
          job_id?: string | null;
          status_timestamps: Json;
          cut_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          client_id?: string;
          title?: string;
          status?: string;
          model?: string | null;
          target_live_date?: string | null;
          window_close_date?: string | null;
          notes?: string | null;
          meta?: Json;
          job_id?: string | null;
          status_timestamps?: Json;
          cut_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "releases_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "releases_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "releases_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] }
        ];
      };
      ship_methods: {
        Row: {
          id: string;
          name: string;
          carrier: string | null;
          account_number: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          carrier?: string | null;
          account_number?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          carrier?: string | null;
          account_number?: string | null;
        };
        Relationships: [

        ];
      };
      shipment_items: {
        Row: {
          id: string;
          shipment_id: string | null;
          item_id: string | null;
          size: string | null;
          qty: number | null;
        };
        Insert: {
          id?: string;
          shipment_id?: string | null;
          item_id?: string | null;
          size?: string | null;
          qty?: number | null;
        };
        Update: {
          id?: string;
          shipment_id?: string | null;
          item_id?: string | null;
          size?: string | null;
          qty?: number | null;
        };
        Relationships: [
          { foreignKeyName: "shipment_items_shipment_id_fkey"; columns: ["shipment_id"]; isOneToOne: false; referencedRelation: "shipments_legacy_pre117"; referencedColumns: ["id"] },
          { foreignKeyName: "shipment_items_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] }
        ];
      };
      shipment_lines: {
        Row: {
          id: string;
          shipment_id: string;
          item_id: string | null;
          job_id: string | null;
          description: string | null;
          ship_qtys: Json | null;
          received_qtys: Json | null;
          condition: string | null;
          notes: string | null;
          received: boolean;
          received_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          shipment_id: string;
          item_id?: string | null;
          job_id?: string | null;
          description?: string | null;
          ship_qtys?: Json | null;
          received_qtys?: Json | null;
          condition?: string | null;
          notes?: string | null;
          received?: boolean;
          received_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          shipment_id?: string;
          item_id?: string | null;
          job_id?: string | null;
          description?: string | null;
          ship_qtys?: Json | null;
          received_qtys?: Json | null;
          condition?: string | null;
          notes?: string | null;
          received?: boolean;
          received_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "shipment_lines_shipment_id_fkey"; columns: ["shipment_id"]; isOneToOne: false; referencedRelation: "shipments"; referencedColumns: ["id"] },
          { foreignKeyName: "shipment_lines_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "items"; referencedColumns: ["id"] },
          { foreignKeyName: "shipment_lines_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] }
        ];
      };
      shipments: {
        Row: {
          id: string;
          company_id: string | null;
          direction: string;
          source: string;
          decorator_id: string | null;
          group_key: string;
          carrier: string | null;
          tracking: string | null;
          pickup: boolean;
          expected_arrival: string | null;
          status: string;
          warehouse_notes: string | null;
          packing_slip_file_id: string | null;
          created_by: string | null;
          created_at: string;
          received_at: string | null;
          received_by: string | null;
          easypost_tracker_id: string | null;
          carrier_status: string | null;
          carrier_detected: string | null;
          est_delivery_date: string | null;
          est_delivery_updated_at: string | null;
          expected_arrival_edited_at: string | null;
          delivered_at: string | null;
          last_scan: Json | null;
          tracking_error: string | null;
          tracker_attempted_at: string | null;
          delivered_not_found_at: string | null;
          warehouse_notified_at: string | null;
          warehouse_notified_to: string | null;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          direction?: string;
          source?: string;
          decorator_id?: string | null;
          group_key: string;
          carrier?: string | null;
          tracking?: string | null;
          pickup?: boolean;
          expected_arrival?: string | null;
          status?: string;
          warehouse_notes?: string | null;
          packing_slip_file_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          received_at?: string | null;
          received_by?: string | null;
          easypost_tracker_id?: string | null;
          carrier_status?: string | null;
          carrier_detected?: string | null;
          est_delivery_date?: string | null;
          est_delivery_updated_at?: string | null;
          expected_arrival_edited_at?: string | null;
          delivered_at?: string | null;
          last_scan?: Json | null;
          tracking_error?: string | null;
          tracker_attempted_at?: string | null;
          delivered_not_found_at?: string | null;
          warehouse_notified_at?: string | null;
          warehouse_notified_to?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          direction?: string;
          source?: string;
          decorator_id?: string | null;
          group_key?: string;
          carrier?: string | null;
          tracking?: string | null;
          pickup?: boolean;
          expected_arrival?: string | null;
          status?: string;
          warehouse_notes?: string | null;
          packing_slip_file_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          received_at?: string | null;
          received_by?: string | null;
          easypost_tracker_id?: string | null;
          carrier_status?: string | null;
          carrier_detected?: string | null;
          est_delivery_date?: string | null;
          est_delivery_updated_at?: string | null;
          expected_arrival_edited_at?: string | null;
          delivered_at?: string | null;
          last_scan?: Json | null;
          tracking_error?: string | null;
          tracker_attempted_at?: string | null;
          delivered_not_found_at?: string | null;
          warehouse_notified_at?: string | null;
          warehouse_notified_to?: string | null;
        };
        Relationships: [
          { foreignKeyName: "shipments_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "shipments_decorator_id_fkey"; columns: ["decorator_id"]; isOneToOne: false; referencedRelation: "decorators"; referencedColumns: ["id"] }
        ];
      };
      shipments_legacy_pre117: {
        Row: {
          id: string;
          job_id: string | null;
          shipment_type: string | null;
          origin: string | null;
          destination: string | null;
          carrier: string | null;
          tracking_number: string | null;
          ship_date: string | null;
          est_delivery: string | null;
          actual_delivery: string | null;
          status: string | null;
          shipstation_order_id: string | null;
          notes: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          job_id?: string | null;
          shipment_type?: string | null;
          origin?: string | null;
          destination?: string | null;
          carrier?: string | null;
          tracking_number?: string | null;
          ship_date?: string | null;
          est_delivery?: string | null;
          actual_delivery?: string | null;
          status?: string | null;
          shipstation_order_id?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string | null;
          shipment_type?: string | null;
          origin?: string | null;
          destination?: string | null;
          carrier?: string | null;
          tracking_number?: string | null;
          ship_date?: string | null;
          est_delivery?: string | null;
          actual_delivery?: string | null;
          status?: string | null;
          shipstation_order_id?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "shipments_legacy_pre117_job_id_fkey"; columns: ["job_id"]; isOneToOne: false; referencedRelation: "jobs"; referencedColumns: ["id"] }
        ];
      };
      shipstation_reports: {
        Row: {
          id: string;
          client_id: string;
          period_label: string;
          hpd_fee_pct: number;
          line_items: Json;
          source_rows: Json;
          totals: Json;
          created_at: string;
          created_by: string | null;
          qb_invoice_id: string | null;
          qb_invoice_number: string | null;
          qb_payment_link: string | null;
          qb_tax_amount: number | null;
          qb_total_with_tax: number | null;
          qb_invoice_created_at: string | null;
          qb_invoice_updated_at: string | null;
          sent_at: string | null;
          sent_to: string[] | null;
          paid_at: string | null;
          paid_amount: number | null;
          report_type: string;
          per_package_fee: number | null;
          postage_line_items: Json | null;
          postage_totals: Json | null;
          postage_markup_pct: number | null;
          company_id: string;
          postage_mode: string;
          sales_period_label: string | null;
          postage_period_label: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          period_label: string;
          hpd_fee_pct: number;
          line_items: Json;
          source_rows: Json;
          totals: Json;
          created_at?: string;
          created_by?: string | null;
          qb_invoice_id?: string | null;
          qb_invoice_number?: string | null;
          qb_payment_link?: string | null;
          qb_tax_amount?: number | null;
          qb_total_with_tax?: number | null;
          qb_invoice_created_at?: string | null;
          qb_invoice_updated_at?: string | null;
          sent_at?: string | null;
          sent_to?: string[] | null;
          paid_at?: string | null;
          paid_amount?: number | null;
          report_type?: string;
          per_package_fee?: number | null;
          postage_line_items?: Json | null;
          postage_totals?: Json | null;
          postage_markup_pct?: number | null;
          company_id: string;
          postage_mode?: string;
          sales_period_label?: string | null;
          postage_period_label?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          period_label?: string;
          hpd_fee_pct?: number;
          line_items?: Json;
          source_rows?: Json;
          totals?: Json;
          created_at?: string;
          created_by?: string | null;
          qb_invoice_id?: string | null;
          qb_invoice_number?: string | null;
          qb_payment_link?: string | null;
          qb_tax_amount?: number | null;
          qb_total_with_tax?: number | null;
          qb_invoice_created_at?: string | null;
          qb_invoice_updated_at?: string | null;
          sent_at?: string | null;
          sent_to?: string[] | null;
          paid_at?: string | null;
          paid_amount?: number | null;
          report_type?: string;
          per_package_fee?: number | null;
          postage_line_items?: Json | null;
          postage_totals?: Json | null;
          postage_markup_pct?: number | null;
          company_id?: string;
          postage_mode?: string;
          sales_period_label?: string | null;
          postage_period_label?: string | null;
        };
        Relationships: [
          { foreignKeyName: "shipstation_reports_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "shipstation_reports_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      shipstation_sku_costs: {
        Row: {
          client_id: string;
          sku: string;
          description: string | null;
          unit_cost: number;
          updated_at: string;
          company_id: string;
        };
        Insert: {
          client_id: string;
          sku: string;
          description?: string | null;
          unit_cost?: number;
          updated_at?: string;
          company_id: string;
        };
        Update: {
          client_id?: string;
          sku?: string;
          description?: string | null;
          unit_cost?: number;
          updated_at?: string;
          company_id?: string;
        };
        Relationships: [
          { foreignKeyName: "shipstation_sku_costs_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "shipstation_sku_costs_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
      shipstation_store_map: {
        Row: {
          store_name: string;
          client_id: string | null;
          skip: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          store_name: string;
          client_id?: string | null;
          skip?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          store_name?: string;
          client_id?: string | null;
          skip?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "shipstation_store_map_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }
        ];
      };
      staging_boards: {
        Row: {
          id: string;
          name: string;
          client_name: string;
          share_token: string;
          share_password_hash: string | null;
          summary_label: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          client_name: string;
          share_token?: string;
          share_password_hash?: string | null;
          summary_label?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          client_name?: string;
          share_token?: string;
          share_password_hash?: string | null;
          summary_label?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [

        ];
      };
      staging_item_images: {
        Row: {
          id: string;
          item_id: string | null;
          storage_path: string;
          filename: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          storage_path: string;
          filename?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          storage_path?: string;
          filename?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "staging_item_images_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "staging_items"; referencedColumns: ["id"] }
        ];
      };
      staging_item_messages: {
        Row: {
          id: string;
          item_id: string | null;
          sender_type: string;
          sender_name: string | null;
          message: string;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          sender_type?: string;
          sender_name?: string | null;
          message: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          sender_type?: string;
          sender_name?: string | null;
          message?: string;
          created_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: "staging_item_messages_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "staging_items"; referencedColumns: ["id"] }
        ];
      };
      staging_items: {
        Row: {
          id: string;
          board_id: string | null;
          item_name: string;
          qty: number | null;
          unit_cost: number | null;
          retail: number | null;
          status: string | null;
          notes: string | null;
          sort_order: number | null;
          created_at: string | null;
          updated_at: string | null;
          eta: string | null;
          payment_received: boolean | null;
        };
        Insert: {
          id?: string;
          board_id?: string | null;
          item_name?: string;
          qty?: number | null;
          unit_cost?: number | null;
          retail?: number | null;
          status?: string | null;
          notes?: string | null;
          sort_order?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
          eta?: string | null;
          payment_received?: boolean | null;
        };
        Update: {
          id?: string;
          board_id?: string | null;
          item_name?: string;
          qty?: number | null;
          unit_cost?: number | null;
          retail?: number | null;
          status?: string | null;
          notes?: string | null;
          sort_order?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
          eta?: string | null;
          payment_received?: boolean | null;
        };
        Relationships: [
          { foreignKeyName: "staging_items_board_id_fkey"; columns: ["board_id"]; isOneToOne: false; referencedRelation: "staging_boards"; referencedColumns: ["id"] }
        ];
      };
      tracking_events: {
        Row: {
          id: string;
          shipment_id: string;
          easypost_tracker_id: string | null;
          scan_key: string;
          status: string | null;
          description: string | null;
          location: string | null;
          occurred_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          shipment_id: string;
          easypost_tracker_id?: string | null;
          scan_key: string;
          status?: string | null;
          description?: string | null;
          location?: string | null;
          occurred_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          shipment_id?: string;
          easypost_tracker_id?: string | null;
          scan_key?: string;
          status?: string | null;
          description?: string | null;
          location?: string | null;
          occurred_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "tracking_events_shipment_id_fkey"; columns: ["shipment_id"]; isOneToOne: false; referencedRelation: "shipments"; referencedColumns: ["id"] }
        ];
      };
      user_company_memberships: {
        Row: {
          id: string;
          user_id: string;
          company_id: string;
          role: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          company_id: string;
          role?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          company_id?: string;
          role?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          { foreignKeyName: "user_company_memberships_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
