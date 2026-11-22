import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// Define the shape of the AuthContext
interface UserProfile {
  id: string;
  name: string;
  avatar: string | null;
}
interface Bubble {
  id: string;
  name: string;
  max_size: number;
}
interface AuthContextType {
  user: any;
  loading: boolean;
  userProfile: UserProfile | null;
  joinedBubbles: Bubble[];
  signIn: (email: string, password: string) => Promise<any>;
  signUp: (email: string, password: string, name: string) => Promise<any>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  userProfile: null,
  joinedBubbles: [],
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [joinedBubbles, setJoinedBubbles] = useState<Bubble[]>([]);

  // Helper to fetch user profile from users table
  const fetchUserProfile = async (userId: string) => {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!error && data) {
      setUserProfile(data as UserProfile);
    } else {
      setUserProfile(null);
    }
  };

  // Helper to fetch joined bubbles
  const fetchJoinedBubbles = async (userId: string) => {
    const { data, error } = await supabase
      .from('bubble_members')
      .select('bubble_id, bubbles:bubbles(id, name, max_size)')
      .eq('user_id', userId)
      .eq('approved', true);
    if (!error && data) {
      const bubbles = data.map((bm: any) => bm.bubbles).filter(Boolean);
      setJoinedBubbles(bubbles);
    } else {
      setJoinedBubbles([]);
    }
  };

  // On mount, check for existing session and fetch profile/bubbles
  useEffect(() => {
    const getSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setUser(data.session?.user ?? null);
        if (data.session?.user) {
          await fetchUserProfile(data.session.user.id);
          await fetchJoinedBubbles(data.session.user.id);
        } else {
          setUserProfile(null);
          setJoinedBubbles([]);
        }
      } catch (e) {
        setUserProfile(null);
        setJoinedBubbles([]);
      } finally {
        setLoading(false);
      }
    };
    getSession();
    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchUserProfile(session.user.id);
        await fetchJoinedBubbles(session.user.id);
      } else {
        setUserProfile(null);
        setJoinedBubbles([]);
      }
      setLoading(false);
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // Sign in with email and password
  const signIn = async (email: string, password: string) => {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setUser(data.user ?? null);
    if (data.user) {
      await fetchUserProfile(data.user.id);
      await fetchJoinedBubbles(data.user.id);
    } else {
      setUserProfile(null);
      setJoinedBubbles([]);
    }
    setLoading(false);
    return { data, error };
  };

  // Sign up with email, password, and name
  const signUp = async (email: string, password: string, name: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
      setUser(data.user ?? null);
      if (data.user) {
        await fetchUserProfile(data.user.id);
        await fetchJoinedBubbles(data.user.id);
      } else {
        setUserProfile(null);
        setJoinedBubbles([]);
      }
      return { data, error };
    } finally {
      setLoading(false);
    }
  };

  // Sign out
  const signOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setUserProfile(null);
    setJoinedBubbles([]);
    setLoading(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, userProfile, joinedBubbles, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext); 