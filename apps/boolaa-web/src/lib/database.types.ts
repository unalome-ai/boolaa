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
      reports: {
        Row: {
          bubble_id: string | null
          created_at: string
          details: string | null
          id: string
          reason: string
          reported_user_id: string | null
          reporter_id: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          bubble_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reported_user_id?: string | null
          reporter_id?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          bubble_id?: string | null
          created_at?: string
          details?: string | null
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
      users: {
        Row: {
          avatar: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          avatar?: string | null
          created_at?: string
          id: string
          name?: string
        }
        Update: {
          avatar?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_join_request: { Args: { p_request_id: string }; Returns: boolean }
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
      delete_my_account: { Args: never; Returns: undefined }
      is_blocked_with: { Args: { p_user_id: string }; Returns: boolean }
      is_bubble_member: { Args: { p_bubble_id: string }; Returns: boolean }
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
      shares_bubble_with: { Args: { p_user_id: string }; Returns: boolean }
      toggle_rsvp: { Args: { p_event_id: string }; Returns: string[] }
      try_admit_join_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
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

