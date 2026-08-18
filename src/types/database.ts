export type Database = {
  public: {
    Tables: {
      leads: {
        Row: {
          id: number
          public_id: string
          workspace_id: string | null
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
      lead_routing_history: {
        Row: {
          id: string
          lead_id: number
          from_status: string | null
          to_status: string
          changed_at: string
          automation_triggered: boolean
          automation_result: string
          event_key: string
        }
        Insert: {
          id?: string
          lead_id: number
          from_status?: string | null
          to_status: string
          changed_at?: string
          automation_triggered?: boolean
          automation_result?: string
          event_key: string
        }
        Update: Partial<Database['public']['Tables']['lead_routing_history']['Insert']>
        Relationships: []
      }
      insights: {
        Row: {
          id: string
          created_at: string
          airtable_id: string | null
          ai_commentary: string | null
          hot_percent: number | null
          total_change: string | null
          hot_change: string | null
          warm_change: string | null
          cold_change: string | null
          insight_1: string | null
          insight_2: string | null
          insight_3: string | null
          recommendation_1: string | null
          recommendation_2: string | null
          recommendation_3: string | null
        }
        Insert: Partial<Database['public']['Tables']['insights']['Row']> & { id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['insights']['Row']>
        Relationships: []
      }
      weekly_summary: {
        Row: {
          id: string
          created_at: string
          period: string
          total_leads: number | null
          hot_leads: number | null
          warm_leads: number | null
          cold_leads: number | null
          ai_summary: string | null
          report_version: number
          period_start: string | null
          period_end: string | null
          previous_period_start: string | null
          previous_period_end: string | null
          new_leads: number | null
          new_hot_leads: number | null
          new_warm_leads: number | null
          new_cold_leads: number | null
          previous_new_leads: number | null
          previous_hot_leads: number | null
          previous_warm_leads: number | null
          previous_cold_leads: number | null
          new_leads_change: number | null
          hot_change: number | null
          warm_change: number | null
          cold_change: number | null
          hot_percent: number | null
          warm_percent: number | null
          cold_percent: number | null
          summary_model: string | null
          generation_source: string
          data_timezone: string
        }
        Insert: Partial<Database['public']['Tables']['weekly_summary']['Row']> & { period: string; id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['weekly_summary']['Row']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
