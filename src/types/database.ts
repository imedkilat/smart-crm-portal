export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      leads: {
        Row: {
          id: number
          public_id: string
          workspace_id: string | null
          pipeline_stage_id: string | null
          converted_contact_id: string | null
          converted_company_id: string | null
          converted_deal_id: string | null
          converted_at: string | null
          created_at: string
          name: string | null
          email: string | null
          budget: string | null
          currency_code: string
          message: string | null
          category: string | null
          intent: string | null
          summary: string | null
          source: string | null
          routing_status: string | null
          status_changed_at: string | null
          archived_at: string | null
        }
        Insert: {
          id?: number
          public_id?: string
          workspace_id?: string | null
          pipeline_stage_id?: string | null
          converted_contact_id?: string | null
          converted_company_id?: string | null
          converted_deal_id?: string | null
          converted_at?: string | null
          created_at?: string
          name?: string | null
          email?: string | null
          budget?: string | null
          currency_code?: string
          message?: string | null
          category?: string | null
          intent?: string | null
          summary?: string | null
          source?: string | null
          routing_status?: string | null
          status_changed_at?: string | null
          archived_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['leads']['Insert']>
        Relationships: []
      }
      workspaces: {
        Row: {
          id: string
          public_id: string
          name: string
          slug: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          public_id?: string
          name: string
          slug: string
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['workspaces']['Insert']>
        Relationships: []
      }
      workspace_members: {
        Row: {
          workspace_id: string
          user_id: string
          role: 'owner' | 'admin' | 'member'
          created_at: string
        }
        Insert: {
          workspace_id: string
          user_id: string
          role?: 'owner' | 'admin' | 'member'
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['workspace_members']['Insert']>
        Relationships: []
      }
      pipelines: {
        Row: {
          id: string
          public_id: string
          workspace_id: string
          name: string
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          public_id?: string
          workspace_id: string
          name: string
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['pipelines']['Insert']>
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          id: string
          public_id: string
          pipeline_id: string
          workspace_id: string
          name: string
          position: number
          stage_type: 'open' | 'won' | 'lost'
          created_at: string
        }
        Insert: {
          id?: string
          public_id?: string
          pipeline_id: string
          workspace_id: string
          name: string
          position: number
          stage_type?: 'open' | 'won' | 'lost'
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['pipeline_stages']['Insert']>
        Relationships: []
      }
      companies: {
        Row: {
          id: string
          public_id: string
          workspace_id: string
          name: string
          domain: string | null
          website: string | null
          industry: string | null
          employee_band: string | null
          annual_revenue: number | null
          notes: string | null
          owner_user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          public_id?: string
          workspace_id: string
          name: string
          domain?: string | null
          website?: string | null
          industry?: string | null
          employee_band?: string | null
          annual_revenue?: number | null
          notes?: string | null
          owner_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['companies']['Insert']>
        Relationships: []
      }
      contacts: {
        Row: {
          id: string
          public_id: string
          workspace_id: string
          company_id: string | null
          first_name: string | null
          last_name: string | null
          display_name: string
          email: string | null
          phone: string | null
          title: string | null
          lifecycle_stage: 'lead' | 'prospect' | 'customer' | 'partner' | 'other'
          owner_user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          public_id?: string
          workspace_id: string
          company_id?: string | null
          first_name?: string | null
          last_name?: string | null
          display_name: string
          email?: string | null
          phone?: string | null
          title?: string | null
          lifecycle_stage?: 'lead' | 'prospect' | 'customer' | 'partner' | 'other'
          owner_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['contacts']['Insert']>
        Relationships: []
      }
      deals: {
        Row: {
          id: string
          public_id: string
          workspace_id: string
          pipeline_id: string
          pipeline_stage_id: string
          primary_contact_id: string | null
          company_id: string | null
          origin_lead_id: number | null
          name: string
          amount: number
          currency_code: string
          probability: number
          expected_close_date: string | null
          status: 'open' | 'won' | 'lost'
          owner_user_id: string | null
          won_at: string | null
          lost_at: string | null
          lost_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          public_id?: string
          workspace_id: string
          pipeline_id: string
          pipeline_stage_id: string
          primary_contact_id?: string | null
          company_id?: string | null
          origin_lead_id?: number | null
          name: string
          amount?: number
          currency_code?: string
          probability?: number
          expected_close_date?: string | null
          status?: 'open' | 'won' | 'lost'
          owner_user_id?: string | null
          won_at?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['deals']['Insert']>
        Relationships: []
      }
      deal_contacts: {
        Row: {
          deal_id: string
          contact_id: string
          workspace_id: string
          role: string | null
          created_at: string
        }
        Insert: {
          deal_id: string
          contact_id: string
          workspace_id: string
          role?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['deal_contacts']['Insert']>
        Relationships: []
      }
      tags: {
        Row: { id: string; public_id: string; workspace_id: string; name: string; created_at: string }
        Insert: { id?: string; public_id?: string; workspace_id: string; name: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['tags']['Insert']>
        Relationships: []
      }
      record_tags: {
        Row: { workspace_id: string; tag_id: string; record_type: 'lead' | 'contact' | 'company' | 'deal'; record_id: string; created_at: string }
        Insert: { workspace_id: string; tag_id: string; record_type: 'lead' | 'contact' | 'company' | 'deal'; record_id: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['record_tags']['Insert']>
        Relationships: []
      }
      custom_fields: {
        Row: {
          id: string
          public_id: string
          workspace_id: string
          object_type: 'lead' | 'contact' | 'company' | 'deal'
          name: string
          field_key: string
          field_type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multi_select' | 'url' | 'email' | 'phone'
          options: Json
          is_required: boolean
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          public_id?: string
          workspace_id: string
          object_type: 'lead' | 'contact' | 'company' | 'deal'
          name: string
          field_key: string
          field_type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multi_select' | 'url' | 'email' | 'phone'
          options?: Json
          is_required?: boolean
          position?: number
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['custom_fields']['Insert']>
        Relationships: []
      }
      custom_field_values: {
        Row: { id: string; workspace_id: string; field_id: string; record_type: 'lead' | 'contact' | 'company' | 'deal'; record_id: string; value: Json; updated_by: string | null; updated_at: string }
        Insert: { id?: string; workspace_id: string; field_id: string; record_type: 'lead' | 'contact' | 'company' | 'deal'; record_id: string; value: Json; updated_by?: string | null; updated_at?: string }
        Update: Partial<Database['public']['Tables']['custom_field_values']['Insert']>
        Relationships: []
      }
      saved_views: {
        Row: { id: string; public_id: string; workspace_id: string; object_type: 'lead' | 'contact' | 'company' | 'deal' | 'task'; name: string; filters: Json; sort: Json; columns: Json; is_shared: boolean; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; public_id?: string; workspace_id: string; object_type: 'lead' | 'contact' | 'company' | 'deal' | 'task'; name: string; filters?: Json; sort?: Json; columns?: Json; is_shared?: boolean; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: Partial<Database['public']['Tables']['saved_views']['Insert']>
        Relationships: []
      }
      crm_activities: {
        Row: { id: string; public_id: string; workspace_id: string; record_type: string; record_id: string; activity_type: string; title: string; metadata: Json; actor_user_id: string | null; occurred_at: string }
        Insert: { id?: string; public_id?: string; workspace_id: string; record_type: string; record_id: string; activity_type: string; title: string; metadata?: Json; actor_user_id?: string | null; occurred_at?: string }
        Update: Partial<Database['public']['Tables']['crm_activities']['Insert']>
        Relationships: []
      }
      lead_activities: {
        Row: { id: string; public_id: string; workspace_id: string; lead_id: number; activity_type: string; title: string; metadata: Record<string, unknown>; actor_user_id: string | null; occurred_at: string }
        Insert: { id?: string; public_id?: string; workspace_id: string; lead_id: number; activity_type: string; title: string; metadata?: Record<string, unknown>; actor_user_id?: string | null; occurred_at?: string }
        Update: Partial<Database['public']['Tables']['lead_activities']['Insert']>
        Relationships: []
      }
      lead_notes: {
        Row: { id: string; public_id: string; workspace_id: string; lead_id: number; body: string; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; public_id?: string; workspace_id: string; lead_id: number; body: string; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: Partial<Database['public']['Tables']['lead_notes']['Insert']>
        Relationships: []
      }
      lead_tasks: {
        Row: {
          id: string; public_id: string; workspace_id: string; lead_id: number; title: string; description: string | null
          status: 'open' | 'done' | 'canceled'; priority: 'low' | 'medium' | 'high'; due_at: string | null
          assigned_to: string | null; created_by: string | null; completed_at: string | null; created_at: string; updated_at: string
        }
        Insert: {
          id?: string; public_id?: string; workspace_id: string; lead_id: number; title: string; description?: string | null
          status?: 'open' | 'done' | 'canceled'; priority?: 'low' | 'medium' | 'high'; due_at?: string | null
          assigned_to?: string | null; created_by?: string | null; completed_at?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['lead_tasks']['Insert']>
        Relationships: []
      }
      lead_routing_history: {
        Row: { id: string; workspace_id: string; lead_id: number; from_status: string | null; to_status: string; changed_at: string; automation_triggered: boolean; automation_result: string; event_key: string }
        Insert: { id?: string; workspace_id?: string; lead_id: number; from_status?: string | null; to_status: string; changed_at?: string; automation_triggered?: boolean; automation_result?: string; event_key: string }
        Update: Partial<Database['public']['Tables']['lead_routing_history']['Insert']>
        Relationships: []
      }
      ai_interactions: {
        Row: { id: string; public_id: string; workspace_id: string; user_id: string | null; conversation_id: string; question: string; answer: string | null; model: string | null; status: 'pending' | 'completed' | 'failed'; n8n_execution_id: string | null; context_snapshot: Json; error_message: string | null; created_at: string; completed_at: string | null }
        Insert: { id?: string; public_id?: string; workspace_id: string; user_id?: string | null; conversation_id: string; question: string; answer?: string | null; model?: string | null; status?: 'pending' | 'completed' | 'failed'; n8n_execution_id?: string | null; context_snapshot?: Json; error_message?: string | null; created_at?: string; completed_at?: string | null }
        Update: Partial<Database['public']['Tables']['ai_interactions']['Insert']>
        Relationships: []
      }
      ai_memories: {
        Row: { id: string; public_id: string; workspace_id: string; scope_type: 'workspace' | 'lead' | 'contact' | 'company' | 'deal'; scope_key: string | null; memory_type: 'fact' | 'preference' | 'correction' | 'outcome' | 'pattern'; content: string; confidence: number; status: 'candidate' | 'active' | 'superseded' | 'rejected'; source_interaction_id: string | null; created_by: string | null; evidence_count: number; embedding: string | null; metadata: Json; times_used: number; last_used_at: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; public_id?: string; workspace_id: string; scope_type?: 'workspace' | 'lead' | 'contact' | 'company' | 'deal'; scope_key?: string | null; memory_type: 'fact' | 'preference' | 'correction' | 'outcome' | 'pattern'; content: string; confidence?: number; status?: 'candidate' | 'active' | 'superseded' | 'rejected'; source_interaction_id?: string | null; created_by?: string | null; evidence_count?: number; embedding?: string | null; metadata?: Json; times_used?: number; last_used_at?: string | null; created_at?: string; updated_at?: string }
        Update: Partial<Database['public']['Tables']['ai_memories']['Insert']>
        Relationships: []
      }
      ai_feedback: {
        Row: { id: string; workspace_id: string; interaction_id: string; rating: -1 | 1 | null; correction: string | null; scope_type: 'workspace' | 'lead' | 'contact' | 'company' | 'deal'; scope_key: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; workspace_id: string; interaction_id: string; rating?: -1 | 1 | null; correction?: string | null; scope_type?: 'workspace' | 'lead' | 'contact' | 'company' | 'deal'; scope_key?: string | null; created_by?: string | null; created_at?: string }
        Update: Partial<Database['public']['Tables']['ai_feedback']['Insert']>
        Relationships: []
      }
      ai_memory_usage: {
        Row: { id: string; workspace_id: string; interaction_id: string; memory_id: string; similarity: number | null; created_at: string }
        Insert: { id?: string; workspace_id: string; interaction_id: string; memory_id: string; similarity?: number | null; created_at?: string }
        Update: Partial<Database['public']['Tables']['ai_memory_usage']['Insert']>
        Relationships: []
      }
      ai_memory_documents: {
        Row: { id: number; workspace_id: string; memory_id: string | null; content: string; metadata: Json; embedding: string | null; created_at: string; updated_at: string }
        Insert: { id?: number; workspace_id: string; memory_id?: string | null; content: string; metadata?: Json; embedding?: string | null; created_at?: string; updated_at?: string }
        Update: Partial<Database['public']['Tables']['ai_memory_documents']['Insert']>
        Relationships: []
      }
      insights: {
        Row: { id: string; workspace_id: string; created_at: string; airtable_id: string | null; ai_commentary: string | null; hot_percent: number | null; total_change: string | null; hot_change: string | null; warm_change: string | null; cold_change: string | null; insight_1: string | null; insight_2: string | null; insight_3: string | null; recommendation_1: string | null; recommendation_2: string | null; recommendation_3: string | null }
        Insert: Partial<Database['public']['Tables']['insights']['Row']> & { id?: string; workspace_id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['insights']['Row']>
        Relationships: []
      }
      weekly_summary: {
        Row: {
          id: string; workspace_id: string; created_at: string; period: string; total_leads: number | null; hot_leads: number | null; warm_leads: number | null; cold_leads: number | null; ai_summary: string | null; report_version: number
          period_start: string | null; period_end: string | null; previous_period_start: string | null; previous_period_end: string | null; new_leads: number | null; new_hot_leads: number | null; new_warm_leads: number | null; new_cold_leads: number | null
          previous_new_leads: number | null; previous_hot_leads: number | null; previous_warm_leads: number | null; previous_cold_leads: number | null; new_leads_change: number | null; hot_change: number | null; warm_change: number | null; cold_change: number | null
          hot_percent: number | null; warm_percent: number | null; cold_percent: number | null; summary_model: string | null; generation_source: string; data_timezone: string
        }
        Insert: Partial<Database['public']['Tables']['weekly_summary']['Row']> & { period: string; id?: string; workspace_id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['weekly_summary']['Row']>
        Relationships: []
      }
    }
    Views: {
      workspace_ai_snapshot: {
        Row: { workspace_id: string; workspace_public_id: string; workspace_name: string; active_leads: number; hot_leads: number; warm_leads: number; cold_leads: number; lead_budget_value_usd: number; open_deals: number; open_pipeline_value_usd: number; won_deals: number; won_value_usd: number; lost_deals: number; stale_open_deals: number; open_tasks: number; overdue_tasks: number; due_today_tasks: number; contacts_count: number; companies_count: number; latest_activity_at: string | null }
        Relationships: []
      }
      lead_ai_context: {
        Row: { workspace_id: string; lead_id: number; lead_public_id: string; name: string | null; email: string | null; message: string | null; budget: string | null; currency_code: string; ai_category: string | null; ai_intent: string | null; ai_summary: string | null; routing_status: string | null; source: string | null; created_at: string; pipeline_stage: string | null; pipeline_stage_type: string | null; open_tasks: number; overdue_tasks: number; next_due_at: string | null; recent_notes: Json | null; converted_at: string | null; converted_contact_public_id: string | null; converted_company_public_id: string | null; converted_deal_public_id: string | null }
        Relationships: []
      }
    }
    Functions: {
      convert_lead_to_deal: {
        Args: { p_lead_id: number; p_deal_name?: string | null; p_amount?: number | null; p_company_name?: string | null; p_company_domain?: string | null }
        Returns: { contact_id: string; contact_public_id: string; company_id: string | null; company_public_id: string | null; deal_id: string; deal_public_id: string; already_converted: boolean }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
