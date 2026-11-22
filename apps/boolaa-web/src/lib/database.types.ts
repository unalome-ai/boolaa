export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          age_confirmation_required: boolean
          device_verification_enforced: boolean
          id: boolean
          updated_at: string
        }
        Insert: {
          age_confirmation_required?: boolean
          device_verification_enforced?: boolean
          id?: boolean
          updated_at?: string
        }
        Update: {
          age_confirmation_required?: boolean
          device_verification_enforced?: boolean
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bubble_members: {
        Row: {
          approved: boolean
          bubble_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          bubble_id: string
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          bubble_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bubble_members_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bubble_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bubbles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          invite_code: string
          logo: string | null
          max_size: number
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          invite_code?: string
          logo?: string | null
          max_size?: number
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          invite_code?: string
          logo?: string | null
          max_size?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "bubbles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          bubble_id: string
          content: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          bubble_id: string
          content: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          bubble_id?: string
          content?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_challenges: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          device_hash: string | null
          expires_at: string
          id: string
          purpose: string
          session_id: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          device_hash?: string | null
          expires_at: string
          id?: string
          purpose: string
          session_id?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          device_hash?: string | null
          expires_at?: string
          id?: string
          purpose?: string
          session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          bubble_id: string
          created_at: string
          creator_id: string
          datetime: string
          description: string | null
          id: string
          location: string | null
          rsvp_list: string[]
          title: string
        }
        Insert: {
          bubble_id: string
          created_at?: string
          creator_id: string
          datetime: string
          description?: string | null
          id?: string
          location?: string | null
          rsvp_list?: string[]
          title: string
        }
        Update: {
          bubble_id?: string
          created_at?: string
          creator_id?: string
          datetime?: string
          description?: string | null
          id?: string
          location?: string | null
          rsvp_list?: string[]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      food_posts: {
        Row: {
          bubble_id: string
          created_at: string
          description: string | null
          id: string
          image: string
          user_id: string
        }
        Insert: {
          bubble_id: string
          created_at?: string
          description?: string | null
          id?: string
          image: string
          user_id: string
        }
        Update: {
          bubble_id?: string
          created_at?: string
          description?: string | null
          id?: string
          image?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_posts_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      join_requests: {
        Row: {
          approver_ids: string[]
          bubble_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          approver_ids?: string[]
          bubble_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          approver_ids?: string[]
          bubble_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "join_requests_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      market_items: {
        Row: {
          bubble_id: string
          created_at: string
          description: string | null
          id: string
          image: string
          owner_id: string
          status: string
          title: string
        }
        Insert: {
          bubble_id: string
          created_at?: string
          description?: string | null
          id?: string
          image: string
          owner_id: string
          status?: string
          title: string
        }
        Update: {
          bubble_id?: string
          created_at?: string
          description?: string | null
          id?: string
          image?: string
          owner_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_items_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          action: string
          admin_id: string
          bubble_id: string | null
          created_at: string
          details: Json
          id: string
          note: string | null
          report_id: string | null
          target_id: string | null
          target_type: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_id: string
          bubble_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          note?: string | null
          report_id?: string | null
          target_id?: string | null
          target_type?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          bubble_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          note?: string | null
          report_id?: string | null
          target_id?: string | null
          target_type?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          alert_sent_at: string | null
          bubble_id: string | null
          created_at: string
          details: string | null
          handled_at: string | null
          handled_note: string | null
          id: string
          reason: string
          reported_user_id: string | null
          reporter_id: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          alert_sent_at?: string | null
          bubble_id?: string | null
          created_at?: string
          details?: string | null
          handled_at?: string | null
          handled_note?: string | null
          id?: string
          reason: string
          reported_user_id?: string | null
          reporter_id?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          alert_sent_at?: string | null
          bubble_id?: string | null
          created_at?: string
          details?: string | null
          handled_at?: string | null
          handled_note?: string | null
          id?: string
          reason?: string
          reported_user_id?: string | null
          reporter_id?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_links: {
        Row: {
          bubble_id: string
          created_at: string
          id: string
          tags: string[]
          title: string | null
          url: string
          user_id: string
        }
        Insert: {
          bubble_id: string
          created_at?: string
          id?: string
          tags?: string[]
          title?: string | null
          url: string
          user_id: string
        }
        Update: {
          bubble_id?: string
          created_at?: string
          id?: string
          tags?: string[]
          title?: string | null
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_links_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trusted_devices: {
        Row: {
          created_at: string
          device_hash: string
          label: string | null
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_hash: string
          label?: string | null
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_hash?: string
          label?: string | null
          last_seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          age_confirmed_at: string | null
          avatar: string | null
          created_at: string
          id: string
          name: string
          status: string
          status_changed_at: string | null
          status_reason: string | null
          status_until: string | null
          terms_version: string | null
        }
        Insert: {
          age_confirmed_at?: string | null
          avatar?: string | null
          created_at?: string
          id: string
          name?: string
          status?: string
          status_changed_at?: string | null
          status_reason?: string | null
          status_until?: string | null
          terms_version?: string | null
        }
        Update: {
          age_confirmed_at?: string | null
          avatar?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          status_changed_at?: string | null
          status_reason?: string | null
          status_until?: string | null
          terms_version?: string | null
        }
        Relationships: []
      }
      verified_sessions: {
        Row: {
          created_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_find_users: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      admin_get_report: { Args: { p_report_id: string }; Returns: Json }
      admin_list_reports: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      admin_report_json: {
        Args: { r: Database["public"]["Tables"]["reports"]["Row"] }
        Returns: Json
      }
      admin_resolve_report: {
        Args: {
          p_action: string
          p_days?: number
          p_note?: string
          p_report_id: string
        }
        Returns: Json
      }
      admin_unsuspend: {
        Args: { p_note?: string; p_user_id: string }
        Returns: Json
      }
      approve_join_request: { Args: { p_request_id: string }; Returns: boolean }
      attempt_email_challenge: {
        Args: {
          p_device_hash: string
          p_purpose: string
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      claim_report_alert: { Args: { p_report_id: string }; Returns: Json }
      complete_email_challenge: {
        Args: { p_challenge_id: string; p_label: string; p_session_id: string }
        Returns: Json
      }
      confirm_age: { Args: { p_terms_version: string }; Returns: string }
      create_bubble: {
        Args: { p_description?: string; p_max_size?: number; p_name: string }
        Returns: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          invite_code: string
          logo: string | null
          max_size: number
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "bubbles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_session_id: { Args: never; Returns: string }
      delete_my_account: { Args: never; Returns: undefined }
      device_hash_of: { Args: { p_device_id: string }; Returns: string }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      is_account_active: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_age_confirmed: { Args: never; Returns: boolean }
      is_amr_proven_session: { Args: never; Returns: boolean }
      is_blocked_with: { Args: { p_user_id: string }; Returns: boolean }
      is_bubble_member: { Args: { p_bubble_id: string }; Returns: boolean }
      is_device_verified: { Args: never; Returns: boolean }
      is_session_verified: { Args: never; Returns: boolean }
      issue_email_challenge: {
        Args: {
          p_code_hash: string
          p_device_hash: string
          p_purpose: string
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      list_my_devices: {
        Args: never
        Returns: {
          created_at: string
          device_hash: string
          label: string
          last_seen_at: string
        }[]
      }
      mark_session_verified: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: undefined
      }
      reject_join_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      remove_member: {
        Args: { p_bubble_id: string; p_user_id: string }
        Returns: undefined
      }
      report_content: {
        Args: {
          p_details?: string
          p_reason: string
          p_target_id: string
          p_target_type: string
        }
        Returns: string
      }
      report_target_snapshot: {
        Args: { p_target_id: string; p_target_type: string }
        Returns: Json
      }
      request_to_join: {
        Args: { p_invite_code: string }
        Returns: {
          approver_ids: string[]
          bubble_id: string
          created_at: string
          id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "join_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_admin: { Args: never; Returns: undefined }
      require_verified_session: { Args: never; Returns: undefined }
      revoke_device: { Args: { p_device_hash: string }; Returns: boolean }
      set_account_status: {
        Args: {
          p_reason: string
          p_status: string
          p_until: string
          p_user_id: string
        }
        Returns: undefined
      }
      shares_bubble_with: { Args: { p_user_id: string }; Returns: boolean }
      start_device_check: {
        Args: { p_device_id: string; p_label?: string }
        Returns: Json
      }
      toggle_rsvp: { Args: { p_event_id: string }; Returns: string[] }
      trust_device: {
        Args: { p_device_hash: string; p_label: string; p_user_id: string }
        Returns: undefined
      }
      try_admit_join_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      verified_amr_methods: { Args: never; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

