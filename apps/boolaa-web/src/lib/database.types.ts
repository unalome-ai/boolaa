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
      auth_recovery_grants: {
        Row: {
          granted_at: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          user_id: string
        }
        Update: {
          granted_at?: string
          user_id?: string
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
      bubble_mutes: {
        Row: {
          bubble_id: string
          created_at: string
          until: string | null
          user_id: string
        }
        Insert: {
          bubble_id: string
          created_at?: string
          until?: string | null
          user_id: string
        }
        Update: {
          bubble_id?: string
          created_at?: string
          until?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bubble_mutes_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bubble_mutes_user_id_fkey"
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
      chat_message_evidence: {
        Row: {
          content: string
          deleted_at: string
          image_path: string | null
          message_id: string
        }
        Insert: {
          content: string
          deleted_at?: string
          image_path?: string | null
          message_id: string
        }
        Update: {
          content?: string
          deleted_at?: string
          image_path?: string | null
          message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_evidence_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          bubble_id: string
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          image_path: string | null
          sender_id: string
        }
        Insert: {
          bubble_id: string
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_path?: string | null
          sender_id: string
        }
        Update: {
          bubble_id?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_path?: string | null
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
      chat_reads: {
        Row: {
          bubble_id: string
          last_read_at: string
          last_read_message_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bubble_id: string
          last_read_at: string
          last_read_message_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bubble_id?: string
          last_read_at?: string
          last_read_message_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_reads_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      data_export_requests: {
        Row: {
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
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
      invite_lookup_failures: {
        Row: {
          at: string
          user_id: string
        }
        Insert: {
          at?: string
          user_id: string
        }
        Update: {
          at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_lookup_failures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_preview_grants: {
        Row: {
          at: string
          bubble_id: string
          user_id: string
        }
        Insert: {
          at?: string
          bubble_id: string
          user_id: string
        }
        Update: {
          at?: string
          bubble_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_preview_grants_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
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
          availability: string
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
          availability?: string
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
          availability?: string
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
      notification_outbox: {
        Row: {
          actor_id: string | null
          attempts: number
          bubble_id: string | null
          claimed_at: string | null
          claimed_until: string | null
          collapse_key: string | null
          created_at: string
          dedupe_key: string | null
          id: number
          last_error: string | null
          next_attempt_at: string
          payload: Json
          recipient_id: string
          sent_at: string | null
          status: string
          target_id: string | null
          token_ids: string[] | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          attempts?: number
          bubble_id?: string | null
          claimed_at?: string | null
          claimed_until?: string | null
          collapse_key?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: never
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          recipient_id: string
          sent_at?: string | null
          status?: string
          target_id?: string | null
          token_ids?: string[] | null
          type: string
        }
        Update: {
          actor_id?: string | null
          attempts?: number
          bubble_id?: string | null
          claimed_at?: string | null
          claimed_until?: string | null
          collapse_key?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: never
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          recipient_id?: string
          sent_at?: string | null
          status?: string
          target_id?: string | null
          token_ids?: string[] | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          approvals: boolean
          chat: boolean
          enabled: boolean
          event_reminders: boolean
          food: boolean
          join_requests: boolean
          market: boolean
          new_events: boolean
          preview_content: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          approvals?: boolean
          chat?: boolean
          enabled?: boolean
          event_reminders?: boolean
          food?: boolean
          join_requests?: boolean
          market?: boolean
          new_events?: boolean
          preview_content?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          approvals?: boolean
          chat?: boolean
          enabled?: boolean
          event_reminders?: boolean
          food?: boolean
          join_requests?: boolean
          market?: boolean
          new_events?: boolean
          preview_content?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_debug_log: {
        Row: {
          body: string | null
          collapse_key: string | null
          created_at: string
          id: number
          outbox_id: number | null
          provider: string
          request: Json | null
          simulated: string | null
          title: string | null
          token: string
        }
        Insert: {
          body?: string | null
          collapse_key?: string | null
          created_at?: string
          id?: never
          outbox_id?: number | null
          provider: string
          request?: Json | null
          simulated?: string | null
          title?: string | null
          token: string
        }
        Update: {
          body?: string | null
          collapse_key?: string | null
          created_at?: string
          id?: never
          outbox_id?: number | null
          provider?: string
          request?: Json | null
          simulated?: string | null
          title?: string | null
          token?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          apns_env: string | null
          app_version: string | null
          auth: string | null
          created_at: string
          device_hash: string | null
          endpoint: string | null
          id: string
          last_seen_at: string
          locale: string | null
          p256dh: string | null
          platform: string
          session_id: string | null
          token: string
          user_id: string
        }
        Insert: {
          apns_env?: string | null
          app_version?: string | null
          auth?: string | null
          created_at?: string
          device_hash?: string | null
          endpoint?: string | null
          id?: string
          last_seen_at?: string
          locale?: string | null
          p256dh?: string | null
          platform: string
          session_id?: string | null
          token: string
          user_id: string
        }
        Update: {
          apns_env?: string | null
          app_version?: string | null
          auth?: string | null
          created_at?: string
          device_hash?: string | null
          endpoint?: string | null
          id?: string
          last_seen_at?: string
          locale?: string | null
          p256dh?: string | null
          platform?: string
          session_id?: string | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_device_hash_fkey"
            columns: ["user_id", "device_hash"]
            isOneToOne: false
            referencedRelation: "trusted_devices"
            referencedColumns: ["user_id", "device_hash"]
          },
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reactions: {
        Row: {
          bubble_id: string
          created_at: string
          event_id: string | null
          food_post_id: string | null
          id: string
          link_id: string | null
          market_item_id: string | null
          message_id: string | null
          reaction: string
          target_id: string | null
          target_owner_id: string
          target_type: string | null
          user_id: string
        }
        Insert: {
          bubble_id: string
          created_at?: string
          event_id?: string | null
          food_post_id?: string | null
          id?: string
          link_id?: string | null
          market_item_id?: string | null
          message_id?: string | null
          reaction: string
          target_id?: string | null
          target_owner_id: string
          target_type?: string | null
          user_id: string
        }
        Update: {
          bubble_id?: string
          created_at?: string
          event_id?: string | null
          food_post_id?: string | null
          id?: string
          link_id?: string | null
          market_item_id?: string | null
          message_id?: string | null
          reaction?: string
          target_id?: string | null
          target_owner_id?: string
          target_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_bubble_id_fkey"
            columns: ["bubble_id"]
            isOneToOne: false
            referencedRelation: "bubbles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_food_post_id_fkey"
            columns: ["food_post_id"]
            isOneToOne: false
            referencedRelation: "food_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "shared_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_market_item_id_fkey"
            columns: ["market_item_id"]
            isOneToOne: false
            referencedRelation: "market_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
          preview_claimed_at: string | null
          preview_description: string | null
          preview_fetched_at: string | null
          preview_image_path: string | null
          preview_requested_at: string | null
          preview_site_name: string | null
          preview_status: string
          preview_title: string | null
          tags: string[]
          title: string | null
          url: string
          user_id: string
        }
        Insert: {
          bubble_id: string
          created_at?: string
          id?: string
          preview_claimed_at?: string | null
          preview_description?: string | null
          preview_fetched_at?: string | null
          preview_image_path?: string | null
          preview_requested_at?: string | null
          preview_site_name?: string | null
          preview_status?: string
          preview_title?: string | null
          tags?: string[]
          title?: string | null
          url: string
          user_id: string
        }
        Update: {
          bubble_id?: string
          created_at?: string
          id?: string
          preview_claimed_at?: string | null
          preview_description?: string | null
          preview_fetched_at?: string | null
          preview_image_path?: string | null
          preview_requested_at?: string | null
          preview_site_name?: string | null
          preview_status?: string
          preview_title?: string | null
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
      admin_resolve_report_core: {
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
      bubble_image_orphans: {
        Args: { p_grace?: string; p_limit?: number }
        Returns: string[]
      }
      bubble_member_ids: { Args: { p_bubble_id: string }; Returns: string[] }
      bubble_role: {
        Args: { p_bubble_id: string; p_user_id: string }
        Returns: string
      }
      can_manage_bubble: { Args: { p_bubble_id: string }; Returns: boolean }
      can_manage_bubble_object: { Args: { p_name: string }; Returns: boolean }
      can_read_chat_image: { Args: { p_path: string }; Returns: boolean }
      can_read_image: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      chat_image_uploaded: { Args: { p_path: string }; Returns: boolean }
      chat_messages_around: {
        Args: {
          p_before?: number
          p_bubble_id: string
          p_limit?: number
          p_message_id: string
        }
        Returns: {
          bubble_id: string
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          image_path: string | null
          sender_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chat_messages_page: {
        Args: { p_before_id?: string; p_bubble_id: string; p_limit?: number }
        Returns: {
          bubble_id: string
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          image_path: string | null
          sender_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chat_unread_counts: {
        Args: never
        Returns: {
          bubble_id: string
          last_read_at: string
          unread_count: number
        }[]
      }
      claim_link_preview: {
        Args: { p_link_id: string }
        Returns: {
          bubble_id: string
          url: string
        }[]
      }
      claim_push_batch: { Args: { p_limit?: number }; Returns: Json }
      claim_report_alert: { Args: { p_report_id: string }; Returns: Json }
      complete_email_challenge: {
        Args: { p_challenge_id: string; p_label: string; p_session_id: string }
        Returns: Json
      }
      complete_push_batch: {
        Args: { p_invalid_token_ids?: string[]; p_results: Json }
        Returns: undefined
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
      data_export_available_at: { Args: never; Returns: string }
      delete_chat_message: { Args: { p_message_id: string }; Returns: Json }
      delete_my_account: { Args: never; Returns: undefined }
      device_hash_of: { Args: { p_device_id: string }; Returns: string }
      enqueue_event_reminders: { Args: never; Returns: number }
      event_has_ended: { Args: { p_datetime: string }; Returns: boolean }
      export_my_data: { Args: never; Returns: Json }
      generate_invite_code: { Args: never; Returns: string }
      get_invite_preview: {
        Args: { p_code: string }
        Returns: {
          bubble_id: string
          logo: string
          max_size: number
          member_count: number
          name: string
          status: string
        }[]
      }
      has_fresh_sensitive_proof: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      invite_lookup_limit: { Args: never; Returns: number }
      is_account_active: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_age_confirmed: { Args: never; Returns: boolean }
      is_amr_proven_session: { Args: never; Returns: boolean }
      is_blocked_with: { Args: { p_user_id: string }; Returns: boolean }
      is_bubble_member: { Args: { p_bubble_id: string }; Returns: boolean }
      is_device_verified: { Args: never; Returns: boolean }
      is_moderated_photo: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      is_reported_chat_photo: { Args: { p_name: string }; Returns: boolean }
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
      link_preview_orphans: {
        Args: { p_grace?: string; p_limit?: number }
        Returns: string[]
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
      mark_chat_read: {
        Args: { p_bubble_id: string; p_message_id: string }
        Returns: string
      }
      mark_session_verified: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: undefined
      }
      normalize_invite_code: { Args: { p_code: string }; Returns: string }
      prune_push_outbox: { Args: never; Returns: undefined }
      push_enqueue: {
        Args: {
          p_actor: string
          p_bubble_id: string
          p_collapse_key?: string
          p_dedupe_key?: string
          p_payload?: Json
          p_recipients: string[]
          p_target_id: string
          p_type: string
        }
        Returns: number
      }
      push_kick: { Args: never; Returns: undefined }
      push_kick_if_due: { Args: never; Returns: boolean }
      push_should_notify: {
        Args: {
          p_actor: string
          p_bubble_id: string
          p_recipient: string
          p_type: string
        }
        Returns: boolean
      }
      push_type_enabled: {
        Args: { p_type: string; p_user_id: string }
        Returns: boolean
      }
      register_push_token: {
        Args: {
          p_apns_env?: string
          p_app_version?: string
          p_auth?: string
          p_device_id?: string
          p_endpoint?: string
          p_locale?: string
          p_p256dh?: string
          p_platform: string
          p_token?: string
        }
        Returns: string
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
      require_invite_lookup_allowed: { Args: never; Returns: undefined }
      require_verified_session: { Args: never; Returns: undefined }
      retry_link_previews: { Args: never; Returns: number }
      revoke_device: { Args: { p_device_hash: string }; Returns: boolean }
      rotate_invite_code: { Args: { p_bubble_id: string }; Returns: string }
      search_bubble: {
        Args: {
          p_bubble_id: string
          p_kinds?: string[]
          p_limit?: number
          p_query: string
        }
        Returns: {
          author_id: string
          author_name: string
          created_at: string
          event_at: string
          id: string
          kind: string
          matched_words: string[]
          rank: number
          snippet: string
          title: string
        }[]
      }
      search_doc: { Args: { p_parts: string[] }; Returns: string }
      search_fold: { Args: { p_text: string }; Returns: string }
      search_link_doc: {
        Args: {
          p_preview_description: string
          p_preview_title: string
          p_tags: string[]
          p_title: string
          p_url: string
        }
        Returns: string
      }
      search_snippet: {
        Args: { p_texts: string[]; p_width?: number; p_words: string[] }
        Returns: string
      }
      set_account_status: {
        Args: {
          p_reason: string
          p_status: string
          p_until: string
          p_user_id: string
        }
        Returns: undefined
      }
      set_member_role: {
        Args: { p_bubble_id: string; p_role: string; p_user_id: string }
        Returns: undefined
      }
      shares_bubble_with: { Args: { p_user_id: string }; Returns: boolean }
      start_device_check: {
        Args: { p_device_id: string; p_label?: string }
        Returns: Json
      }
      storage_folder_uuid: { Args: { p_name: string }; Returns: string }
      storage_path_from_url: {
        Args: { p_bucket: string; p_url: string }
        Returns: string
      }
      store_link_preview: {
        Args: {
          p_description?: string
          p_image_path?: string
          p_link_id: string
          p_site_name?: string
          p_status: string
          p_title?: string
          p_url: string
        }
        Returns: boolean
      }
      sweep_bubble_images: {
        Args: { p_grace?: string; p_key?: string; p_url?: string }
        Returns: number
      }
      sweep_link_preview_images: {
        Args: { p_grace?: string; p_key?: string; p_url?: string }
        Returns: number
      }
      toggle_reaction: {
        Args: { p_reaction: string; p_target_id: string; p_target_type: string }
        Returns: Json
      }
      toggle_rsvp: { Args: { p_event_id: string }; Returns: string[] }
      transfer_ownership: {
        Args: { p_bubble_id: string; p_new_owner: string }
        Returns: undefined
      }
      trust_device: {
        Args: { p_device_hash: string; p_label: string; p_user_id: string }
        Returns: undefined
      }
      try_admit_join_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      unregister_push_token: { Args: { p_token: string }; Returns: boolean }
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

