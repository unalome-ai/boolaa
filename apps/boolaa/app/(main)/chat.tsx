import React, { useLayoutEffect, useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet, Image, useColorScheme } from 'react-native';
import { useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../AuthContext';
import { useBubble } from '../../BubbleContext';

interface ChatMessage {
  id: string;
  bubble_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: { name?: string; avatar?: string };
}

export default function ChatScreen() {
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const { user } = useAuth();
  const { currentBubble } = useBubble();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const styles = themedStyles(colorScheme);

  // Header setup
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: 'Chat',
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ marginLeft: 16 }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color="#9D78BD" />
        </TouchableOpacity>
      ),
      tabBarStyle: { display: 'none' },
    });
  }, [navigation]);

  // Fetch messages
  useEffect(() => {
    if (!currentBubble) return;
    let isMounted = true;
    setLoading(true);
    supabase
      .from('chat_messages')
      .select('id, bubble_id, sender_id, content, created_at, sender:profiles(name, avatar)')
      .eq('bubble_id', currentBubble.id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (isMounted) {
          if (!error && data) setMessages(data as ChatMessage[]);
          setLoading(false);
        }
      });
    // Subscribe to new messages
    const subscription = supabase
      .channel('public:chat_messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `bubble_id=eq.${currentBubble.id}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as ChatMessage]);
        }
      )
      .subscribe();
    return () => {
      isMounted = false;
      supabase.removeChannel(subscription);
    };
  }, [currentBubble]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // Send message
  const sendMessage = async () => {
    if (!input.trim() || !user || !currentBubble) return;
    setSending(true);
    const { error } = await supabase.from('chat_messages').insert({
      bubble_id: currentBubble.id,
      sender_id: user.id,
      content: input.trim(),
    });
    setSending(false);
    if (!error) setInput('');
  };

  const renderItem = ({ item }: { item: ChatMessage }) => (
    <View style={styles.messageRow}>
      <Image
        source={item.sender?.avatar ? { uri: item.sender.avatar } : require('../../assets/avatar-placeholder.png')}
        style={styles.avatar}
      />
      <View style={styles.messageBubble}>
        <Text style={styles.senderName}>{item.sender?.name || item.sender_id}</Text>
        <Text style={styles.messageText}>{item.content}</Text>
        <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>
    </View>
  );

  if (!currentBubble) {
    return (
      <View style={styles.centered}><Text style={styles.noBubbleText}>No bubble selected.</Text></View>
    );
  }
  if (loading) {
    return (
      <View style={styles.centered}><ActivityIndicator size="large" color="#9D78BD" /></View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#888'}
          editable={!sending}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage} disabled={sending || !input.trim()}>
          <Ionicons name="send" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function themedStyles(colorScheme: string | null) {
  const isDark = colorScheme === 'dark';
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#18181b' : '#fff',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? '#18181b' : '#fff',
    },
    noBubbleText: {
      color: isDark ? '#fff' : '#222',
      fontSize: 18,
      fontWeight: '600',
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      marginBottom: 16,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      marginRight: 10,
      backgroundColor: '#eee',
    },
    messageBubble: {
      backgroundColor: isDark ? '#23232b' : '#F5F5F5',
      borderRadius: 12,
      padding: 10,
      maxWidth: '80%',
    },
    senderName: {
      fontWeight: 'bold',
      color: '#9D78BD',
      marginBottom: 2,
    },
    messageText: {
      fontSize: 16,
      color: isDark ? '#fff' : '#222',
    },
    timestamp: {
      fontSize: 12,
      color: isDark ? '#aaa' : '#888',
      alignSelf: 'flex-end',
      marginTop: 4,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderTopWidth: 1,
      borderColor: isDark ? '#23232b' : '#eee',
      backgroundColor: isDark ? '#18181b' : '#fff',
      position: 'absolute',
      bottom: 20,
      left: 0,
      height: 60,
      right: 0,
    },
    input: {
      flex: 1,
      backgroundColor: isDark ? '#23232b' : '#F5F5F5',
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontSize: 16,
      marginRight: 8,
      color: isDark ? '#fff' : '#222',
    },
    sendButton: {
      backgroundColor: '#9D78BD',
      borderRadius: 12,
      padding: 8,
    },
  });
} 