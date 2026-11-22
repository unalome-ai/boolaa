import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthContext';

// Types for bubble and join request (customize as needed)
interface Bubble {
  id: string;
  name: string;
  max_size: number;
  description: string;
  logo: string;
}
interface JoinRequest {
  id: string;
  user_id: string;
  bubble_id: string;
  approver_ids: string[];
}

interface BubbleContextType {
  currentBubble: Bubble | null;
  setCurrentBubble: React.Dispatch<React.SetStateAction<Bubble | null>>;
  joinRequests: JoinRequest[];
  fetchBubble: (bubbleId: string) => Promise<void>;
  fetchJoinRequests: () => Promise<void>;
  isLoading: boolean;
}

const BubbleContext = createContext<BubbleContextType>({
  currentBubble: null,
  setCurrentBubble: () => {},
  joinRequests: [],
  fetchBubble: async () => {},
  fetchJoinRequests: async () => {},
  isLoading: false,
});

export const BubbleProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, joinedBubbles } = useAuth();
  const [currentBubble, setCurrentBubble] = useState<Bubble | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Set currentBubble to the first joined bubble if not set
  useEffect(() => {
    if (user && joinedBubbles && joinedBubbles.length > 0) {
      // If currentBubble is null or not in joinedBubbles, set to first
      const found = currentBubble && joinedBubbles.some(b => String(b.id) === String(currentBubble.id));
      if (!found) {
        setCurrentBubble(joinedBubbles[0]);
      }
    }
    if (!user || joinedBubbles.length === 0) {
      setCurrentBubble(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, joinedBubbles]);

  // Fetch join requests for the current bubble
  const fetchJoinRequests = async () => {
    if (!currentBubble) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from('join_requests')
      .select('*')
      .eq('bubble_id', currentBubble.id);
    if (!error && data) setJoinRequests(data);
    setIsLoading(false);
  };

  // Fetch a specific bubble by ID
  const fetchBubble = async (bubbleId: string) => {
    setIsLoading(true);
    const { data, error } = await supabase.from('bubbles').select('*').eq('id', bubbleId).single();
    if (!error && data) setCurrentBubble(data);
    setIsLoading(false);
  };

  return (
    <BubbleContext.Provider value={{ currentBubble, setCurrentBubble, joinRequests, fetchBubble, fetchJoinRequests, isLoading }}>
      {children}
    </BubbleContext.Provider>
  );
};

export const useBubble = () => useContext(BubbleContext); 