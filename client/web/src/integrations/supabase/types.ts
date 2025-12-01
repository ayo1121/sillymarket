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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      bets: {
        Row: {
          amount_lamports: number
          amount_sol: number
          bettor_pubkey: string
          block_time: string
          created_at: string
          id: string
          market_pubkey: string
          outcome_index: number | null
          outcome_label: string | null
          pools_after: Json | null
          probs_after: Json | null
          tx_sig: string
          username: string | null
        }
        Insert: {
          amount_lamports: number
          amount_sol: number
          bettor_pubkey: string
          block_time: string
          created_at?: string
          id?: string
          market_pubkey: string
          outcome_index?: number | null
          outcome_label?: string | null
          pools_after?: Json | null
          probs_after?: Json | null
          tx_sig: string
          username?: string | null
        }
        Update: {
          amount_lamports?: number
          amount_sol?: number
          bettor_pubkey?: string
          block_time?: string
          created_at?: string
          id?: string
          market_pubkey?: string
          outcome_index?: number | null
          outcome_label?: string | null
          pools_after?: Json | null
          probs_after?: Json | null
          tx_sig?: string
          username?: string | null
        }
        Relationships: []
      }
      claims: {
        Row: {
          amount_lamports: number | null
          block_time: string | null
          created_at: string | null
          id: string
          market_pubkey: string
          tx_sig: string
          user_pubkey: string
        }
        Insert: {
          amount_lamports?: number | null
          block_time?: string | null
          created_at?: string | null
          id?: string
          market_pubkey: string
          tx_sig: string
          user_pubkey: string
        }
        Update: {
          amount_lamports?: number | null
          block_time?: string | null
          created_at?: string | null
          id?: string
          market_pubkey?: string
          tx_sig?: string
          user_pubkey?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          comment_text: string
          created_at: string
          id: string
          market_id: string
          user_id: string
        }
        Insert: {
          comment_text: string
          created_at?: string
          id?: string
          market_id: string
          user_id: string
        }
        Update: {
          comment_text?: string
          created_at?: string
          id?: string
          market_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      frontend_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          market_pubkey: string | null
          metadata: Json | null
          page: string | null
          session_id: string | null
          user_agent: string | null
          user_pubkey: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          market_pubkey?: string | null
          metadata?: Json | null
          page?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_pubkey?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          market_pubkey?: string | null
          metadata?: Json | null
          page?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_pubkey?: string | null
        }
        Relationships: []
      }
      market_events: {
        Row: {
          block_time: string | null
          created_at: string | null
          creator_pubkey: string
          cutoff_ts: number
          id: string
          market_pubkey: string
          outcomes_count: number
          question_hash: string
          tx_sig: string
        }
        Insert: {
          block_time?: string | null
          created_at?: string | null
          creator_pubkey: string
          cutoff_ts: number
          id?: string
          market_pubkey: string
          outcomes_count: number
          question_hash: string
          tx_sig: string
        }
        Update: {
          block_time?: string | null
          created_at?: string | null
          creator_pubkey?: string
          cutoff_ts?: number
          id?: string
          market_pubkey?: string
          outcomes_count?: number
          question_hash?: string
          tx_sig?: string
        }
        Relationships: []
      }
      market_resolutions: {
        Row: {
          auto_void: boolean | null
          block_time: string | null
          created_at: string | null
          fees_transferred: number | null
          id: string
          market_pubkey: string
          resolved_total_pool: number | null
          resolved_win_pool: number | null
          tx_sig: string
          winner_index: number
        }
        Insert: {
          auto_void?: boolean | null
          block_time?: string | null
          created_at?: string | null
          fees_transferred?: number | null
          id?: string
          market_pubkey: string
          resolved_total_pool?: number | null
          resolved_win_pool?: number | null
          tx_sig: string
          winner_index: number
        }
        Update: {
          auto_void?: boolean | null
          block_time?: string | null
          created_at?: string | null
          fees_transferred?: number | null
          id?: string
          market_pubkey?: string
          resolved_total_pool?: number | null
          resolved_win_pool?: number | null
          tx_sig?: string
          winner_index?: number
        }
        Relationships: []
      }
      markets: {
        Row: {
          answers: string
          creator_name: string | null
          creator_wallet: string
          description: string
          image_url: string | null
          market_pubkey: string
          outcome_labels: Json | null
          question: string
        }
        Insert: {
          answers: string
          creator_name?: string | null
          creator_wallet: string
          description: string
          image_url?: string | null
          market_pubkey: string
          outcome_labels?: Json | null
          question: string
        }
        Update: {
          answers?: string
          creator_name?: string | null
          creator_wallet?: string
          description?: string
          image_url?: string | null
          market_pubkey?: string
          outcome_labels?: Json | null
          question?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          metadata: Json
          title: string
          type: string
          user_pubkey: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          metadata?: Json
          title: string
          type: string
          user_pubkey: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          metadata?: Json
          title?: string
          type?: string
          user_pubkey?: string
        }
        Relationships: []
      }
      siws_nonces: {
        Row: {
          expires_at: string
          issued_at: string
          message: string
          nonce: string
          pubkey: string
        }
        Insert: {
          expires_at: string
          issued_at?: string
          message: string
          nonce: string
          pubkey: string
        }
        Update: {
          expires_at?: string
          issued_at?: string
          message?: string
          nonce?: string
          pubkey?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          id: string
          pubkey: string
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          pubkey: string
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          pubkey?: string
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
  | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    // @ts-expect-error - Schema indexing edge case
    Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    // @ts-expect-error - Schema indexing edge case
    Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
  | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
  | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
  | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
  | keyof DefaultSchema["CompositeTypes"]
  | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
  // @ts-expect-error - Schema indexing edge case
  ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  // @ts-expect-error - Schema indexing edge case
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
