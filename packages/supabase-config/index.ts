import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// These would typically come from environment variables
// For a real app, use a .env file and React Native config
const SUPABASE_URL = 'SUPABASE_URL';
const SUPABASE_ANON_KEY = 'SUPABASE_ANON_KEY';

export const createSupabaseClient = () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  return supabase;
};

export const supabase = createSupabaseClient();

// Database types for Unalome
export type UnalomeProfile = {
  id: string;
  archetype: string;
  current_day: number;
  journey_completed: boolean;
  created_at: string;
};

export type UnalomeEntry = {
  id: string;
  user_id: string;
  day: number;
  prompt_text: string;
  user_response: string;
  ai_response: string | null;
  created_at: string;
};

// Database types for Boolaa
export type BoolaaUser = {
  id: string;
  name: string;
  avatar: string | null;
  created_at: string;
};

export type BoolaaBubble = {
  id: string;
  name: string;
  max_size: number;
  created_at: string;
};

export type BoolaaBubbleMember = {
  user_id: string;
  bubble_id: string;
  approved: boolean;
  created_at: string;
};

export type BoolaaJoinRequest = {
  id: string;
  user_id: string;
  bubble_id: string;
  approver_ids: string[];
  created_at: string;
};

export type BoolaaChatMessage = {
  id: string;
  bubble_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

export type BoolaaFoodPost = {
  id: string;
  bubble_id: string;
  user_id: string;
  image: string;
  description: string | null;
  created_at: string;
};

export type BoolaaMarketItem = {
  id: string;
  bubble_id: string;
  owner_id: string;
  image: string;
  title: string;
  status: 'free' | 'trade';
  created_at: string;
};

export type BoolaaEvent = {
  id: string;
  bubble_id: string;
  creator_id: string;
  title: string;
  datetime: string;
  location: string | null;
  rsvp_list: string[];
  created_at: string;
};

export type BoolaaSharedLink = {
  id: string;
  bubble_id: string;
  user_id: string;
  url: string;
  tags: string[];
  created_at: string;
}; 