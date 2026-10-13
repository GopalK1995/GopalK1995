// Generated from the live Supabase project "Lawsome" (evybdanqxgkjoybrvzru) via generate_typescript_types.
// Do not edit by hand; regenerate after each migration.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          address_line: string | null
          city: string | null
          clerks_count: number | null
          court_focus: string[]
          created_at: string
          current_tools: string | null
          customer_status: Database["public"]["Enums"]["customer_status"]
          deleted_at: string | null
          district: string | null
          external_data: Json
          external_ids: Json
          id: string
          is_synthetic: boolean
          lawyers_count: number | null
          name: string
          owner_id: string | null
          practice_areas: string[]
          sites: Json
          sites_count: number | null
          size_band: string | null
          state: string
          tenant_id: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          clerks_count?: number | null
          court_focus?: string[]
          created_at?: string
          current_tools?: string | null
          customer_status?: Database["public"]["Enums"]["customer_status"]
          deleted_at?: string | null
          district?: string | null
          external_data?: Json
          external_ids?: Json
          id?: string
          is_synthetic?: boolean
          lawyers_count?: number | null
          name: string
          owner_id?: string | null
          practice_areas?: string[]
          sites?: Json
          sites_count?: number | null
          size_band?: string | null
          state?: string
          tenant_id: string
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          address_line?: string | null
          city?: string | null
          clerks_count?: number | null
          court_focus?: string[]
          created_at?: string
          current_tools?: string | null
          customer_status?: Database["public"]["Enums"]["customer_status"]
          deleted_at?: string | null
          district?: string | null
          external_data?: Json
          external_ids?: Json
          id?: string
          is_synthetic?: boolean
          lawyers_count?: number | null
          name?: string
          owner_id?: string | null
          practice_areas?: string[]
          sites?: Json
          sites_count?: number | null
          size_band?: string | null
          state?: string
          tenant_id?: string
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          account_id: string | null
          body: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          direction: Database["public"]["Enums"]["msg_direction"] | null
          done_at: string | null
          duration_mins: number | null
          id: string
          kind: Database["public"]["Enums"]["activity_kind"]
          lead_id: string | null
          meeting_type: string | null
          outcome: string | null
          owner_id: string | null
          scheduled_at: string | null
          source: string
          subject: string | null
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          body?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"] | null
          done_at?: string | null
          duration_mins?: number | null
          id?: string
          kind: Database["public"]["Enums"]["activity_kind"]
          lead_id?: string | null
          meeting_type?: string | null
          outcome?: string | null
          owner_id?: string | null
          scheduled_at?: string | null
          source?: string
          subject?: string | null
          tenant_id: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          body?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"] | null
          done_at?: string | null
          duration_mins?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["activity_kind"]
          lead_id?: string | null
          meeting_type?: string | null
          outcome?: string | null
          owner_id?: string | null
          scheduled_at?: string | null
          source?: string
          subject?: string | null
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_crm_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights: {
        Row: {
          campaign_id: string | null
          conversation_id: string | null
          created_at: string
          deal_id: string | null
          decided_at: string | null
          feature: Database["public"]["Enums"]["ai_feature"]
          feedback: string | null
          id: string
          input_summary: string | null
          lead_id: string | null
          model: string | null
          output: string
          output_json: Json | null
          source_refs: Json
          status: Database["public"]["Enums"]["ai_status"]
          tenant_id: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          conversation_id?: string | null
          created_at?: string
          deal_id?: string | null
          decided_at?: string | null
          feature: Database["public"]["Enums"]["ai_feature"]
          feedback?: string | null
          id?: string
          input_summary?: string | null
          lead_id?: string | null
          model?: string | null
          output: string
          output_json?: Json | null
          source_refs?: Json
          status?: Database["public"]["Enums"]["ai_status"]
          tenant_id: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          conversation_id?: string | null
          created_at?: string
          deal_id?: string | null
          decided_at?: string | null
          feature?: Database["public"]["Enums"]["ai_feature"]
          feedback?: string | null
          id?: string
          input_summary?: string | null
          lead_id?: string | null
          model?: string | null
          output?: string
          output_json?: Json | null
          source_refs?: Json
          status?: Database["public"]["Enums"]["ai_status"]
          tenant_id?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_perf"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "ai_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_reach_profile"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "ai_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "ai_insights_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audience_segments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_icp: boolean
          name: string
          rules: Json
          tenant_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_icp?: boolean
          name: string
          rules?: Json
          tenant_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_icp?: boolean
          name?: string
          rules?: Json
          tenant_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audience_segments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audience_segments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audience_segments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_label: string | null
          changes: Json | null
          id: number
          occurred_at: string
          row_id: string | null
          support_session_id: string | null
          table_name: string
          tenant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_label?: string | null
          changes?: Json | null
          id?: never
          occurred_at?: string
          row_id?: string | null
          support_session_id?: string | null
          table_name: string
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_label?: string | null
          changes?: Json | null
          id?: never
          occurred_at?: string
          row_id?: string | null
          support_session_id?: string | null
          table_name?: string
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_support_session_id_fkey"
            columns: ["support_session_id"]
            isOneToOne: false
            referencedRelation: "support_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_alert_rules: {
        Row: {
          check_kind: string
          condition: string
          enabled: boolean
          id: string
          max_age_hours: number | null
          max_size_drop_pct: number | null
          name: string
          notify_to: string
          tenant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          check_kind: string
          condition: string
          enabled?: boolean
          id?: string
          max_age_hours?: number | null
          max_size_drop_pct?: number | null
          name: string
          notify_to: string
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          check_kind?: string
          condition?: string
          enabled?: boolean
          id?: string
          max_age_hours?: number | null
          max_size_drop_pct?: number | null
          name?: string
          notify_to?: string
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backup_alert_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backup_alert_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_checks: {
        Row: {
          backup_taken_at: string | null
          check_kind: string
          checked_at: string
          detail: string | null
          id: number
          location: string | null
          pitr_enabled: boolean | null
          retention_days: number | null
          row_counts: Json | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["backup_status"]
          tenant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          backup_taken_at?: string | null
          check_kind: string
          checked_at?: string
          detail?: string | null
          id?: never
          location?: string | null
          pitr_enabled?: boolean | null
          retention_days?: number | null
          row_counts?: Json | null
          size_bytes?: number | null
          status: Database["public"]["Enums"]["backup_status"]
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          backup_taken_at?: string | null
          check_kind?: string
          checked_at?: string
          detail?: string | null
          id?: never
          location?: string | null
          pitr_enabled?: boolean | null
          retention_days?: number | null
          row_counts?: Json | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["backup_status"]
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backup_checks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backup_checks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_daily_metrics: {
        Row: {
          bounces: number
          campaign_id: string
          clicks: number
          comments: number
          day: string
          imported_at: string
          impressions: number
          opens: number
          platform_leads: number
          reach: number
          reactions: number
          shares: number
          source: string
          spend_inr: number
          tenant_id: string
          unsubscribes: number
          workspace_id: string
        }
        Insert: {
          bounces?: number
          campaign_id: string
          clicks?: number
          comments?: number
          day: string
          imported_at?: string
          impressions?: number
          opens?: number
          platform_leads?: number
          reach?: number
          reactions?: number
          shares?: number
          source?: string
          spend_inr?: number
          tenant_id: string
          unsubscribes?: number
          workspace_id: string
        }
        Update: {
          bounces?: number
          campaign_id?: string
          clicks?: number
          comments?: number
          day?: string
          imported_at?: string
          impressions?: number
          opens?: number
          platform_leads?: number
          reach?: number
          reactions?: number
          shares?: number
          source?: string
          spend_inr?: number
          tenant_id?: string
          unsubscribes?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_daily_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_perf"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_reach_profile"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          budget_inr: number | null
          channel: Database["public"]["Enums"]["channel_kind"]
          created_at: string
          ends_on: string | null
          external_ids: Json
          id: string
          is_synthetic: boolean
          name: string
          notes: string | null
          objective: string | null
          owner_id: string | null
          segment_id: string | null
          starts_on: string | null
          status: string
          tenant_id: string
          updated_at: string
          utm_campaign: string
          utm_medium: string
          utm_source: string
          workspace_id: string
        }
        Insert: {
          budget_inr?: number | null
          channel: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          ends_on?: string | null
          external_ids?: Json
          id?: string
          is_synthetic?: boolean
          name: string
          notes?: string | null
          objective?: string | null
          owner_id?: string | null
          segment_id?: string | null
          starts_on?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          utm_campaign: string
          utm_medium: string
          utm_source: string
          workspace_id: string
        }
        Update: {
          budget_inr?: number | null
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          ends_on?: string | null
          external_ids?: Json
          id?: string
          is_synthetic?: boolean
          name?: string
          notes?: string | null
          objective?: string | null
          owner_id?: string | null
          segment_id?: string | null
          starts_on?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          utm_campaign?: string
          utm_medium?: string
          utm_source?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_segment_fk"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "audience_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_log: {
        Row: {
          action: Database["public"]["Enums"]["consent_action"]
          captured_via: string
          id: number
          lead_id: string | null
          note: string | null
          notice_version: string
          occurred_at: string
          purpose: Database["public"]["Enums"]["consent_purpose"]
          recorded_by: string | null
          subject_ref: string
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["consent_action"]
          captured_via: string
          id?: never
          lead_id?: string | null
          note?: string | null
          notice_version: string
          occurred_at?: string
          purpose: Database["public"]["Enums"]["consent_purpose"]
          recorded_by?: string | null
          subject_ref: string
          tenant_id: string
          workspace_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["consent_action"]
          captured_via?: string
          id?: never
          lead_id?: string | null
          note?: string | null
          notice_version?: string
          occurred_at?: string
          purpose?: Database["public"]["Enums"]["consent_purpose"]
          recorded_by?: string | null
          subject_ref?: string
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_log_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          external_ids: Json
          full_name: string
          id: string
          is_decision_maker: boolean
          is_synthetic: boolean
          owner_id: string | null
          phone: string | null
          preferred_language: string
          role_title: string | null
          tenant_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          external_ids?: Json
          full_name: string
          id?: string
          is_decision_maker?: boolean
          is_synthetic?: boolean
          owner_id?: string | null
          phone?: string | null
          preferred_language?: string
          role_title?: string | null
          tenant_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          external_ids?: Json
          full_name?: string
          id?: string
          is_decision_maker?: boolean
          is_synthetic?: boolean
          owner_id?: string | null
          phone?: string | null
          preferred_language?: string
          role_title?: string | null
          tenant_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_crm_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assignee_id: string | null
          channel: Database["public"]["Enums"]["conv_channel"]
          contact_id: string | null
          created_at: string
          external_thread_id: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_read_at: string | null
          lead_id: string | null
          status: string
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          assignee_id?: string | null
          channel: Database["public"]["Enums"]["conv_channel"]
          contact_id?: string | null
          created_at?: string
          external_thread_id?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_read_at?: string | null
          lead_id?: string | null
          status?: string
          tenant_id: string
          workspace_id: string
        }
        Update: {
          assignee_id?: string | null
          channel?: Database["public"]["Enums"]["conv_channel"]
          contact_id?: string | null
          created_at?: string
          external_thread_id?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_read_at?: string | null
          lead_id?: string | null
          status?: string
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          deal_id: string
          from_stage_id: string | null
          id: number
          tenant_id: string
          to_stage_id: string
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          deal_id: string
          from_stage_id?: string | null
          id?: never
          tenant_id: string
          to_stage_id: string
          workspace_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          deal_id?: string
          from_stage_id?: string | null
          id?: never
          tenant_id?: string
          to_stage_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_stage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_stage_history_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "v_pipeline_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "deal_stage_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "v_pipeline_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "deal_stage_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          account_id: string | null
          competitor: string | null
          created_at: string
          deleted_at: string | null
          expected_close_on: string | null
          external_data: Json
          external_ids: Json
          id: string
          is_synthetic: boolean
          lead_id: string | null
          lost_at: string | null
          lost_reason: string | null
          name: string
          next_step: string | null
          next_step_at: string | null
          objections: string[]
          owner_id: string | null
          plan: string | null
          primary_contact_id: string | null
          seats: number | null
          stage_entered_at: string
          stage_id: string
          tenant_id: string
          updated_at: string
          value_inr: number
          won_at: string | null
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          competitor?: string | null
          created_at?: string
          deleted_at?: string | null
          expected_close_on?: string | null
          external_data?: Json
          external_ids?: Json
          id?: string
          is_synthetic?: boolean
          lead_id?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          name: string
          next_step?: string | null
          next_step_at?: string | null
          objections?: string[]
          owner_id?: string | null
          plan?: string | null
          primary_contact_id?: string | null
          seats?: number | null
          stage_entered_at?: string
          stage_id: string
          tenant_id: string
          updated_at?: string
          value_inr?: number
          won_at?: string | null
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          competitor?: string | null
          created_at?: string
          deleted_at?: string | null
          expected_close_on?: string | null
          external_data?: Json
          external_ids?: Json
          id?: string
          is_synthetic?: boolean
          lead_id?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          name?: string
          next_step?: string | null
          next_step_at?: string | null
          objections?: string[]
          owner_id?: string | null
          plan?: string | null
          primary_contact_id?: string | null
          seats?: number | null
          stage_entered_at?: string
          stage_id?: string
          tenant_id?: string
          updated_at?: string
          value_inr?: number
          won_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_crm_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "v_pipeline_summary"
            referencedColumns: ["stage_id"]
          },
          {
            foreignKeyName: "deals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ga4_daily: {
        Row: {
          avg_engagement_secs: number | null
          channel_group: string
          city: string
          day: string
          device_category: string
          engaged_sessions: number
          key_events: number
          landing_page: string
          new_users: number
          sessions: number
          source: string
          source_medium: string
          tenant_id: string
          total_users: number
          workspace_id: string
        }
        Insert: {
          avg_engagement_secs?: number | null
          channel_group: string
          city?: string
          day: string
          device_category?: string
          engaged_sessions?: number
          key_events?: number
          landing_page?: string
          new_users?: number
          sessions?: number
          source?: string
          source_medium?: string
          tenant_id: string
          total_users?: number
          workspace_id: string
        }
        Update: {
          avg_engagement_secs?: number | null
          channel_group?: string
          city?: string
          day?: string
          device_category?: string
          engaged_sessions?: number
          key_events?: number
          landing_page?: string
          new_users?: number
          sessions?: number
          source?: string
          source_medium?: string
          tenant_id?: string
          total_users?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ga4_daily_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ga4_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_field_maps: {
        Row: {
          conflict_owner: string
          direction: string
          external_field: string
          external_object: string
          id: string
          integration_id: string
          local_column: string
          local_table: string
          sample_value: string | null
          tenant_id: string
          transform: string | null
          workspace_id: string
        }
        Insert: {
          conflict_owner?: string
          direction: string
          external_field: string
          external_object: string
          id?: string
          integration_id: string
          local_column: string
          local_table: string
          sample_value?: string | null
          tenant_id: string
          transform?: string | null
          workspace_id: string
        }
        Update: {
          conflict_owner?: string
          direction?: string
          external_field?: string
          external_object?: string
          id?: string
          integration_id?: string
          local_column?: string
          local_table?: string
          sample_value?: string | null
          tenant_id?: string
          transform?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_field_maps_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_field_maps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_field_maps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          auth_method: string | null
          category: string
          config_ref: string | null
          created_at: string
          direction: string
          id: string
          label: string
          last_error: string | null
          last_sync_at: string | null
          provider: string
          settings: Json
          status: Database["public"]["Enums"]["integration_status"]
          tenant_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auth_method?: string | null
          category: string
          config_ref?: string | null
          created_at?: string
          direction: string
          id?: string
          label: string
          last_error?: string | null
          last_sync_at?: string | null
          provider: string
          settings?: Json
          status?: Database["public"]["Enums"]["integration_status"]
          tenant_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auth_method?: string | null
          category?: string
          config_ref?: string | null
          created_at?: string
          direction?: string
          id?: string
          label?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          settings?: Json
          status?: Database["public"]["Enums"]["integration_status"]
          tenant_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          full_name: string | null
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          territory_districts: string[]
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          territory_districts?: string[]
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          territory_districts?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          anon_id: string | null
          event_name: string
          id: number
          lead_id: string | null
          occurred_at: string
          path: string | null
          props: Json
          tenant_id: string
          utm: Json
          workspace_id: string
        }
        Insert: {
          anon_id?: string | null
          event_name: string
          id?: never
          lead_id?: string | null
          occurred_at?: string
          path?: string | null
          props?: Json
          tenant_id: string
          utm?: Json
          workspace_id: string
        }
        Update: {
          anon_id?: string | null
          event_name?: string
          id?: never
          lead_id?: string | null
          occurred_at?: string
          path?: string | null
          props?: Json
          tenant_id?: string
          utm?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          account_id: string | null
          assigned_at: string | null
          campaign_id: string | null
          city: string | null
          click_ids: Json
          consent_demo_followup: boolean
          consent_marketing: boolean
          consent_whatsapp: boolean
          contact_id: string | null
          created_at: string
          deleted_at: string | null
          disqualify_reason: string | null
          district: string | null
          email: string | null
          external_ids: Json
          firm_name: string | null
          first_response_at: string | null
          first_touch_campaign: string | null
          first_touch_channel:
            | Database["public"]["Enums"]["channel_kind"]
            | null
          full_name: string
          id: string
          is_synthetic: boolean
          landing_path: string | null
          last_touch_at: string | null
          last_touch_campaign: string | null
          last_touch_channel: Database["public"]["Enums"]["channel_kind"] | null
          next_step_at: string | null
          owner_id: string | null
          personal_email: boolean
          phone: string | null
          practice_area: string | null
          role_title: string | null
          score: number | null
          score_factors: Json
          source: string
          status: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          updated_at: string
          utm: Json
          workspace_id: string
        }
        Insert: {
          account_id?: string | null
          assigned_at?: string | null
          campaign_id?: string | null
          city?: string | null
          click_ids?: Json
          consent_demo_followup?: boolean
          consent_marketing?: boolean
          consent_whatsapp?: boolean
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          disqualify_reason?: string | null
          district?: string | null
          email?: string | null
          external_ids?: Json
          firm_name?: string | null
          first_response_at?: string | null
          first_touch_campaign?: string | null
          first_touch_channel?:
            | Database["public"]["Enums"]["channel_kind"]
            | null
          full_name: string
          id?: string
          is_synthetic?: boolean
          landing_path?: string | null
          last_touch_at?: string | null
          last_touch_campaign?: string | null
          last_touch_channel?:
            | Database["public"]["Enums"]["channel_kind"]
            | null
          next_step_at?: string | null
          owner_id?: string | null
          personal_email?: boolean
          phone?: string | null
          practice_area?: string | null
          role_title?: string | null
          score?: number | null
          score_factors?: Json
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          updated_at?: string
          utm?: Json
          workspace_id: string
        }
        Update: {
          account_id?: string | null
          assigned_at?: string | null
          campaign_id?: string | null
          city?: string | null
          click_ids?: Json
          consent_demo_followup?: boolean
          consent_marketing?: boolean
          consent_whatsapp?: boolean
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          disqualify_reason?: string | null
          district?: string | null
          email?: string | null
          external_ids?: Json
          firm_name?: string | null
          first_response_at?: string | null
          first_touch_campaign?: string | null
          first_touch_channel?:
            | Database["public"]["Enums"]["channel_kind"]
            | null
          full_name?: string
          id?: string
          is_synthetic?: boolean
          landing_path?: string | null
          last_touch_at?: string | null
          last_touch_campaign?: string | null
          last_touch_channel?:
            | Database["public"]["Enums"]["channel_kind"]
            | null
          next_step_at?: string | null
          owner_id?: string | null
          personal_email?: boolean
          phone?: string | null
          practice_area?: string | null
          role_title?: string | null
          score?: number | null
          score_factors?: Json
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id?: string
          updated_at?: string
          utm?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_crm_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_perf"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_reach_profile"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          approval_status: string
          body: string
          category: string
          channel: Database["public"]["Enums"]["conv_channel"]
          id: string
          language: string
          name: string
          tenant_id: string
          variables: string[]
          workspace_id: string
        }
        Insert: {
          approval_status?: string
          body: string
          category?: string
          channel?: Database["public"]["Enums"]["conv_channel"]
          id?: string
          language?: string
          name: string
          tenant_id: string
          variables?: string[]
          workspace_id: string
        }
        Update: {
          approval_status?: string
          body?: string
          category?: string
          channel?: Database["public"]["Enums"]["conv_channel"]
          id?: string
          language?: string
          name?: string
          tenant_id?: string
          variables?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_insight_id: string | null
          body: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["msg_direction"]
          external_id: string | null
          id: string
          is_internal_note: boolean
          sent_by: string | null
          status: Database["public"]["Enums"]["msg_status"]
          status_at: string | null
          template_id: string | null
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          ai_insight_id?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["msg_direction"]
          external_id?: string | null
          id?: string
          is_internal_note?: boolean
          sent_by?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
          status_at?: string | null
          template_id?: string | null
          tenant_id: string
          workspace_id: string
        }
        Update: {
          ai_insight_id?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["msg_direction"]
          external_id?: string | null
          id?: string
          is_internal_note?: boolean
          sent_by?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
          status_at?: string | null
          template_id?: string | null
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_ai_fk"
            columns: ["ai_insight_id"]
            isOneToOne: false
            referencedRelation: "ai_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          id: string
          is_lost: boolean
          is_won: boolean
          key: string
          label: string
          max_days: number
          position: number
          probability: number
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          is_lost?: boolean
          is_won?: boolean
          key: string
          label: string
          max_days?: number
          position: number
          probability: number
          tenant_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          is_lost?: boolean
          is_won?: boolean
          key?: string
          label?: string
          max_days?: number
          position?: number
          probability?: number
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          granted_by: string | null
          is_active: boolean
          mfa_required: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          is_active?: boolean
          mfa_required?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          is_active?: boolean
          mfa_required?: boolean
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          language: string
          last_seen_at: string | null
          last_workspace_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          language?: string
          last_seen_at?: string | null
          last_workspace_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          language?: string
          last_seen_at?: string | null
          last_workspace_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_workspace_id_fkey"
            columns: ["last_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          id: string
          month: string
          rep_id: string
          target_demos: number
          tenant_id: string
          won_value_inr: number
          workspace_id: string
        }
        Insert: {
          id?: string
          month: string
          rep_id: string
          target_demos?: number
          tenant_id: string
          won_value_inr?: number
          workspace_id: string
        }
        Update: {
          id?: string
          month?: string
          rep_id?: string
          target_demos?: number
          tenant_id?: string
          won_value_inr?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_targets_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_targets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      support_sessions: {
        Row: {
          admin_id: string
          ended_at: string | null
          expires_at: string
          id: string
          mode: string
          reason: string
          started_at: string
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          admin_id: string
          ended_at?: string | null
          expires_at: string
          id?: string
          mode?: string
          reason: string
          started_at?: string
          tenant_id: string
          workspace_id: string
        }
        Update: {
          admin_id?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          mode?: string
          reason?: string
          started_at?: string
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: number
          integration_id: string | null
          kind: string
          payload_sample: Json | null
          rows_in: number
          rows_out: number
          rows_rejected: number
          started_at: string
          started_by: string | null
          status: Database["public"]["Enums"]["sync_status"]
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: never
          integration_id?: string | null
          kind?: string
          payload_sample?: Json | null
          rows_in?: number
          rows_out?: number
          rows_rejected?: number
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["sync_status"]
          tenant_id: string
          workspace_id: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: never
          integration_id?: string | null
          kind?: string
          payload_sample?: Json | null
          rows_in?: number
          rows_out?: number
          rows_rejected?: number
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["sync_status"]
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          due_at: string
          id: string
          kind: string
          lead_id: string | null
          priority: number
          status: Database["public"]["Enums"]["task_status"]
          tenant_id: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_at: string
          id?: string
          kind?: string
          lead_id?: string | null
          priority?: number
          status?: Database["public"]["Enums"]["task_status"]
          tenant_id: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_at?: string
          id?: string
          kind?: string
          lead_id?: string | null
          priority?: number
          status?: Database["public"]["Enums"]["task_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ai_enabled: Json
          ai_monthly_call_cap: number
          brand_accent: string
          brand_favicon_url: string | null
          brand_logo_dark_url: string | null
          brand_logo_url: string | null
          brand_name: string
          brand_primary: string
          created_at: string
          currency: string
          custom_domain: string | null
          email_sender_name: string | null
          id: string
          is_demo: boolean
          name: string
          plan: string
          primary_owner_id: string | null
          slug: string
          status: string
          support_email: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          ai_enabled?: Json
          ai_monthly_call_cap?: number
          brand_accent?: string
          brand_favicon_url?: string | null
          brand_logo_dark_url?: string | null
          brand_logo_url?: string | null
          brand_name: string
          brand_primary?: string
          created_at?: string
          currency?: string
          custom_domain?: string | null
          email_sender_name?: string | null
          id?: string
          is_demo?: boolean
          name: string
          plan?: string
          primary_owner_id?: string | null
          slug: string
          status?: string
          support_email?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          ai_enabled?: Json
          ai_monthly_call_cap?: number
          brand_accent?: string
          brand_favicon_url?: string | null
          brand_logo_dark_url?: string | null
          brand_logo_url?: string | null
          brand_name?: string
          brand_primary?: string
          created_at?: string
          currency?: string
          custom_domain?: string | null
          email_sender_name?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          plan?: string
          primary_owner_id?: string | null
          slug?: string
          status?: string
          support_email?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      territories: {
        Row: {
          district: string
          rep_id: string
          tenant_id: string
          workspace_id: string
        }
        Insert: {
          district: string
          rep_id: string
          tenant_id: string
          workspace_id: string
        }
        Update: {
          district?: string
          rep_id?: string
          tenant_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "territories_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          archived_at: string | null
          business_hours: Json
          created_at: string
          holidays: string[]
          id: string
          is_demo: boolean
          lead_intake_enabled: boolean
          name: string
          region_label: string | null
          sla_first_response_mins: number
          slug: string
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          business_hours?: Json
          created_at?: string
          holidays?: string[]
          id?: string
          is_demo?: boolean
          lead_intake_enabled?: boolean
          name: string
          region_label?: string | null
          sla_first_response_mins?: number
          slug: string
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          business_hours?: Json
          created_at?: string
          holidays?: string[]
          id?: string
          is_demo?: boolean
          lead_intake_enabled?: boolean
          name?: string
          region_label?: string | null
          sla_first_response_mins?: number
          slug?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_backup_latest: {
        Row: {
          age_hours: number | null
          backup_taken_at: string | null
          check_kind: string | null
          checked_at: string | null
          location: string | null
          pitr_enabled: boolean | null
          retention_days: number | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["backup_status"] | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backup_checks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_campaign_perf: {
        Row: {
          campaign_id: string | null
          channel: Database["public"]["Enums"]["channel_kind"] | null
          click_to_lead: number | null
          clicks: number | null
          cost_per_demo_inr: number | null
          cpl_inr: number | null
          ctr: number | null
          demos: number | null
          engagement_rate: number | null
          impressions: number | null
          interactions: number | null
          leads: number | null
          name: string | null
          platform_crm_gap: number | null
          platform_leads: number | null
          reach: number | null
          revenue_inr: number | null
          roas: number | null
          spend_inr: number | null
          status: string | null
          utm_campaign: string | null
          won_deals: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_campaign_reach_profile: {
        Row: {
          axis_cost_efficiency: number | null
          axis_ctr: number | null
          axis_engagement: number | null
          axis_lead_rate: number | null
          axis_reach: number | null
          campaign_id: string | null
          channel: Database["public"]["Enums"]["channel_kind"] | null
          name: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_crm_accounts: {
        Row: {
          city: string | null
          courts: string[] | null
          created_at: string | null
          current_tools: string | null
          district: string | null
          id: string | null
          is_synthetic: boolean | null
          last_activity_at: string | null
          lawyers: number | null
          locality: string | null
          name: string | null
          owner_id: string | null
          practice_areas: string[] | null
          sites_count: number | null
          size: string | null
          status: Database["public"]["Enums"]["customer_status"] | null
          tenant_id: string | null
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          city?: string | null
          courts?: string[] | null
          created_at?: string | null
          current_tools?: string | null
          district?: string | null
          id?: string | null
          is_synthetic?: boolean | null
          last_activity_at?: never
          lawyers?: number | null
          locality?: string | null
          name?: string | null
          owner_id?: string | null
          practice_areas?: string[] | null
          sites_count?: number | null
          size?: string | null
          status?: Database["public"]["Enums"]["customer_status"] | null
          tenant_id?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          city?: string | null
          courts?: string[] | null
          created_at?: string | null
          current_tools?: string | null
          district?: string | null
          id?: string | null
          is_synthetic?: boolean | null
          last_activity_at?: never
          lawyers?: number | null
          locality?: string | null
          name?: string | null
          owner_id?: string | null
          practice_areas?: string[] | null
          sites_count?: number | null
          size?: string | null
          status?: Database["public"]["Enums"]["customer_status"] | null
          tenant_id?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_crm_campaign_days: {
        Row: {
          bounces: number | null
          campaign_id: string | null
          clicks: number | null
          date: string | null
          engagements: number | null
          impressions: number | null
          opens: number | null
          platform_leads: number | null
          reach: number | null
          source: string | null
          spend: number | null
          tenant_id: string | null
          unsubscribes: number | null
          workspace_id: string | null
        }
        Insert: {
          bounces?: number | null
          campaign_id?: string | null
          clicks?: number | null
          date?: string | null
          engagements?: never
          impressions?: number | null
          opens?: number | null
          platform_leads?: number | null
          reach?: number | null
          source?: string | null
          spend?: number | null
          tenant_id?: string | null
          unsubscribes?: number | null
          workspace_id?: string | null
        }
        Update: {
          bounces?: number | null
          campaign_id?: string | null
          clicks?: number | null
          date?: string | null
          engagements?: never
          impressions?: number | null
          opens?: number | null
          platform_leads?: number | null
          reach?: number | null
          source?: string | null
          spend?: number | null
          tenant_id?: string | null
          unsubscribes?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_daily_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_perf"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_reach_profile"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_daily_metrics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_crm_campaigns: {
        Row: {
          budget: number | null
          channel: Database["public"]["Enums"]["channel_kind"] | null
          created_at: string | null
          end_date: string | null
          id: string | null
          is_synthetic: boolean | null
          name: string | null
          notes: string | null
          objective: string | null
          owner_id: string | null
          start_date: string | null
          status: string | null
          tenant_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          workspace_id: string | null
        }
        Insert: {
          budget?: number | null
          channel?: Database["public"]["Enums"]["channel_kind"] | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          is_synthetic?: boolean | null
          name?: string | null
          notes?: string | null
          objective?: string | null
          owner_id?: string | null
          start_date?: string | null
          status?: never
          tenant_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          workspace_id?: string | null
        }
        Update: {
          budget?: number | null
          channel?: Database["public"]["Enums"]["channel_kind"] | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          is_synthetic?: boolean | null
          name?: string | null
          notes?: string | null
          objective?: string | null
          owner_id?: string | null
          start_date?: string | null
          status?: never
          tenant_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_crm_deals: {
        Row: {
          account_id: string | null
          competitor: string | null
          created_at: string | null
          expected_close: string | null
          id: string | null
          is_synthetic: boolean | null
          lead_id: string | null
          lost_at: string | null
          lost_reason: string | null
          name: string | null
          next_step: string | null
          next_step_at: string | null
          objections: string[] | null
          owner_id: string | null
          plan: string | null
          probability: number | null
          seats: number | null
          stage: string | null
          stage_entered_at: string | null
          stage_label: string | null
          tenant_id: string | null
          value: number | null
          won_at: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_crm_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_crm_leads: {
        Row: {
          account_id: string | null
          campaign_id: string | null
          channel: Database["public"]["Enums"]["channel_kind"] | null
          city: string | null
          consent_demo_followup: boolean | null
          consent_marketing: boolean | null
          consent_whatsapp: boolean | null
          created_at: string | null
          deal_id: string | null
          district: string | null
          email: string | null
          firm_name: string | null
          first_response_mins: number | null
          first_touch: string | null
          first_touch_campaign: string | null
          id: string | null
          is_synthetic: boolean | null
          last_touch: string | null
          last_touch_at: string | null
          last_touch_campaign: string | null
          name: string | null
          next_action: string | null
          next_action_at: string | null
          owner_id: string | null
          personal_email: boolean | null
          phone: string | null
          potential_value: number | null
          score: number | null
          score_factors: Json | null
          stage: string | null
          status: Database["public"]["Enums"]["lead_status"] | null
          tags: string[] | null
          tenant_id: string | null
          title: string | null
          utm: Json | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_crm_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_perf"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_reach_profile"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_crm_tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          deal_id: string | null
          due_at: string | null
          id: string | null
          kind: string | null
          lead_id: string | null
          owner_id: string | null
          priority: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          tenant_id: string | null
          title: string | null
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          due_at?: string | null
          id?: string | null
          kind?: string | null
          lead_id?: string | null
          owner_id?: string | null
          priority?: never
          status?: Database["public"]["Enums"]["task_status"] | null
          tenant_id?: string | null
          title?: string | null
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          due_at?: string | null
          id?: string | null
          kind?: string | null
          lead_id?: string | null
          owner_id?: string | null
          priority?: never
          status?: Database["public"]["Enums"]["task_status"] | null
          tenant_id?: string | null
          title?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_leads_masked"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_funnel_daily: {
        Row: {
          day: string | null
          event_name: string | null
          events: number | null
          people: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_leads_masked: {
        Row: {
          city: string | null
          created_at: string | null
          display_name: string | null
          district: string | null
          email_masked: string | null
          firm_name: string | null
          first_touch_campaign: string | null
          first_touch_channel:
            | Database["public"]["Enums"]["channel_kind"]
            | null
          id: string | null
          owner_id: string | null
          phone_masked: string | null
          role_title: string | null
          score: number | null
          status: Database["public"]["Enums"]["lead_status"] | null
          workspace_id: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          display_name?: never
          district?: string | null
          email_masked?: never
          firm_name?: string | null
          first_touch_campaign?: string | null
          first_touch_channel?:
            | Database["public"]["Enums"]["channel_kind"]
            | null
          id?: string | null
          owner_id?: string | null
          phone_masked?: never
          role_title?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          workspace_id?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          display_name?: never
          district?: string | null
          email_masked?: never
          firm_name?: string | null
          first_touch_campaign?: string | null
          first_touch_channel?:
            | Database["public"]["Enums"]["channel_kind"]
            | null
          id?: string | null
          owner_id?: string | null
          phone_masked?: never
          role_title?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_pipeline_summary: {
        Row: {
          deals: number | null
          key: string | null
          label: string | null
          position: number | null
          probability: number | null
          stage_id: string | null
          stuck_deals: number | null
          value_inr: number | null
          weighted_value_inr: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_rep_scorecard: {
        Row: {
          attainment_pct: number | null
          demos_done: number | null
          full_name: string | null
          leads_this_month: number | null
          open_leads: number | null
          rep_id: string | null
          sla_pct_30d: number | null
          target_demos: number | null
          target_won_inr: number | null
          won_value_inr: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sync_freshness: {
        Row: {
          category: string | null
          error_rate_7d: number | null
          hours_since_sync: number | null
          label: string | null
          last_sync_at: string | null
          provider: string | null
          status: Database["public"]["Enums"]["integration_status"] | null
          workspace_id: string | null
        }
        Insert: {
          category?: string | null
          error_rate_7d?: never
          hours_since_sync?: never
          label?: string | null
          last_sync_at?: string | null
          provider?: string | null
          status?: Database["public"]["Enums"]["integration_status"] | null
          workspace_id?: string | null
        }
        Update: {
          category?: string | null
          error_rate_7d?: never
          hours_since_sync?: never
          label?: string | null
          last_sync_at?: string | null
          provider?: string | null
          status?: Database["public"]["Enums"]["integration_status"] | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _add_member_or_invite: {
        Args: {
          p_districts: string[]
          p_email: string
          p_full_name: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_ws: string
        }
        Returns: Json
      }
      admin_create_tenant: {
        Args: {
          p_branding: Json
          p_name: string
          p_owner_email: string
          p_slug: string
          p_workspace_name?: string
        }
        Returns: Json
      }
      admin_set_tenant_status: {
        Args: { p_status: string; p_tenant: string }
        Returns: undefined
      }
      admin_workspace_stats: {
        Args: never
        Returns: {
          failed_syncs_24h: number
          integrations_attention: number
          last_activity_at: string
          leads_30d: number
          leads_total: number
          members: number
          tenant_id: string
          tenant_name: string
          tenant_status: string
          workspace_id: string
          workspace_name: string
          workspace_slug: string
        }[]
      }
      co_member_ids: { Args: never; Returns: string[] }
      create_workspace: {
        Args: {
          p_name: string
          p_region_label?: string
          p_slug?: string
          p_tenant: string
        }
        Returns: string
      }
      end_support_session: {
        Args: { p_id?: string; p_workspace_id?: string }
        Returns: number
      }
      erase_lead: {
        Args: { p_lead: string; p_note?: string }
        Returns: undefined
      }
      has_active_support_session: { Args: { ws: string }; Returns: boolean }
      has_member_role: {
        Args: { roles: Database["public"]["Enums"]["app_role"][]; ws: string }
        Returns: boolean
      }
      has_ws_role: {
        Args: { roles: Database["public"]["Enums"]["app_role"][]; ws: string }
        Returns: boolean
      }
      invite_member: {
        Args: {
          p_districts?: string[]
          p_email: string
          p_full_name?: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_ws: string
        }
        Returns: Json
      }
      is_member: { Args: { ws: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      member_role_ws_ids: {
        Args: { roles: Database["public"]["Enums"]["app_role"][] }
        Returns: string[]
      }
      member_tenant_ids: { Args: never; Returns: string[] }
      member_ws_ids: { Args: never; Returns: string[] }
      my_workspaces: {
        Args: never
        Returns: {
          branding: Json
          is_demo: boolean
          region_label: string
          role: Database["public"]["Enums"]["app_role"]
          support_session_expires_at: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
          via_support_session: boolean
          workspace_id: string
          workspace_name: string
          workspace_slug: string
        }[]
      }
      owner_tenant_ids: { Args: never; Returns: string[] }
      role_ws_ids: {
        Args: { roles: Database["public"]["Enums"]["app_role"][] }
        Returns: string[]
      }
      seed_workspace_defaults: { Args: { p_ws: string }; Returns: undefined }
      start_support_session: {
        Args: {
          p_minutes?: number
          p_mode?: string
          p_reason: string
          p_workspace_id: string
        }
        Returns: string
      }
      submit_lead: {
        Args: {
          p_anon_id?: string
          p_city?: string
          p_click_ids?: Json
          p_consent_followup?: boolean
          p_consent_marketing?: boolean
          p_consent_whatsapp?: boolean
          p_district?: string
          p_email: string
          p_firm_name?: string
          p_full_name: string
          p_landing_path?: string
          p_notice_version?: string
          p_phone?: string
          p_practice_area?: string
          p_role_title?: string
          p_utm?: Json
          p_workspace: string
        }
        Returns: string
      }
      tenant_branding: {
        Args: { p_domain?: string; p_slug?: string }
        Returns: {
          brand_accent: string
          brand_favicon_url: string
          brand_logo_dark_url: string
          brand_logo_url: string
          brand_name: string
          brand_primary: string
          is_demo: boolean
          slug: string
          support_email: string
          tenant_id: string
        }[]
      }
      track_event: {
        Args: {
          p_anon_id: string
          p_event_name: string
          p_path?: string
          p_props?: Json
          p_utm?: Json
          p_workspace: string
        }
        Returns: undefined
      }
      ws_role: {
        Args: { ws: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
    }
    Enums: {
      activity_kind: "call" | "whatsapp" | "email" | "meeting" | "note"
      ai_feature:
        | "lead_score"
        | "summary"
        | "next_best_action"
        | "reply_draft"
        | "campaign_digest"
        | "ask_crm"
      ai_status: "draft" | "accepted" | "edited" | "dismissed"
      app_role:
        | "owner"
        | "sales_manager"
        | "sales_rep"
        | "marketing"
        | "data"
        | "viewer"
      backup_status: "success" | "failed" | "missing" | "unknown"
      channel_kind:
        | "email"
        | "linkedin"
        | "meta"
        | "google_ads"
        | "whatsapp"
        | "organic"
        | "direct"
        | "referral"
        | "event"
        | "other"
      consent_action:
        | "granted"
        | "withdrawn"
        | "erasure_requested"
        | "erasure_completed"
      consent_purpose:
        | "demo_followup"
        | "marketing_email"
        | "whatsapp"
        | "analytics_cookies"
        | "ai_processing"
      conv_channel: "whatsapp" | "email" | "linkedin"
      customer_status: "prospect" | "trial" | "customer" | "churned"
      integration_status:
        | "connected"
        | "showcase"
        | "needs_attention"
        | "error"
        | "not_configured"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "nurturing"
        | "disqualified"
        | "converted"
      msg_direction: "inbound" | "outbound"
      msg_status:
        | "queued"
        | "simulated"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "received"
      sync_status: "running" | "success" | "partial" | "failed"
      task_status: "open" | "done" | "snoozed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_kind: ["call", "whatsapp", "email", "meeting", "note"],
      ai_feature: [
        "lead_score",
        "summary",
        "next_best_action",
        "reply_draft",
        "campaign_digest",
        "ask_crm",
      ],
      ai_status: ["draft", "accepted", "edited", "dismissed"],
      app_role: [
        "owner",
        "sales_manager",
        "sales_rep",
        "marketing",
        "data",
        "viewer",
      ],
      backup_status: ["success", "failed", "missing", "unknown"],
      channel_kind: [
        "email",
        "linkedin",
        "meta",
        "google_ads",
        "whatsapp",
        "organic",
        "direct",
        "referral",
        "event",
        "other",
      ],
      consent_action: [
        "granted",
        "withdrawn",
        "erasure_requested",
        "erasure_completed",
      ],
      consent_purpose: [
        "demo_followup",
        "marketing_email",
        "whatsapp",
        "analytics_cookies",
        "ai_processing",
      ],
      conv_channel: ["whatsapp", "email", "linkedin"],
      customer_status: ["prospect", "trial", "customer", "churned"],
      integration_status: [
        "connected",
        "showcase",
        "needs_attention",
        "error",
        "not_configured",
      ],
      lead_status: [
        "new",
        "contacted",
        "qualified",
        "nurturing",
        "disqualified",
        "converted",
      ],
      msg_direction: ["inbound", "outbound"],
      msg_status: [
        "queued",
        "simulated",
        "sent",
        "delivered",
        "read",
        "failed",
        "received",
      ],
      sync_status: ["running", "success", "partial", "failed"],
      task_status: ["open", "done", "snoozed", "cancelled"],
    },
  },
} as const
