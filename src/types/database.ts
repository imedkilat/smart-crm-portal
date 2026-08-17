export type Database = {
  public: {
    Tables: {
      leads: {
        Row: {
          id: number
          created_at: string
          name: string | null
          email: string | null
          budget: string | null
          message: string | null
          category: string | null
          intent: string | null
          summary: string | null
          source: string | null
          routing_status: string | null
          status_changed_at: string | null
        }
        Insert: {
          id?: number
          created_at?: string
          name?: string | null
          email?: string | null
          budget?: string | null
          message?: string | null
          category?: string | null
          intent?: string | null
          summary?: string | null
          source?: string | null
          routing_status?: string | null
          status_changed_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['leads']['Insert']>
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
