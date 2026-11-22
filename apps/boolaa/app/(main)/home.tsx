import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image, TouchableOpacity, ActivityIndicator, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { useBubble } from '../../BubbleContext';

export default function BubbleHomeScreen() {
  const colorScheme = useColorScheme();
  const { currentBubble } = useBubble();
  const [loading, setLoading] = useState(true);
  const [chatPreview, setChatPreview] = useState<any>(null);
  const [foodPost, setFoodPost] = useState<any>(null);
  const [marketItem, setMarketItem] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);

  useEffect(() => {
    if (!currentBubble) return;
    setLoading(true);
    Promise.all([
      supabase
        .from('chat_messages')
        .select('id, content, created_at, sender:profiles(name, avatar)')
        .eq('bubble_id', currentBubble.id)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('food_posts')
        .select('id, image, desc, created_at, user:users(name, avatar)')
        .eq('bubble_id', currentBubble.id)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('market_items')
        .select('id, image, title, status, created_at, owner:users(name, avatar)')
        .eq('bubble_id', currentBubble.id)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('events')
        .select('id, title, datetime, location, creator:users(name, avatar), created_at')
        .eq('bubble_id', currentBubble.id)
        .order('created_at', { ascending: false })
        .limit(1),
    ]).then(([chatRes, foodRes, marketRes, eventRes]) => {
      setChatPreview(chatRes.data?.[0] || null);
      setFoodPost(foodRes.data?.[0] || null);
      setMarketItem(marketRes.data?.[0] || null);
      setEvent(eventRes.data?.[0] || null);
      setLoading(false);
    });
  }, [currentBubble]);

  const styles = themedStyles(colorScheme);

  if (!currentBubble) {
    return <View style={styles.centered}><Text style={styles.emptyText}>No bubble selected.</Text></View>;
  }
  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#9D78BD" /></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24 }}>
      {/* Group Chat Preview */}
      <TouchableOpacity style={styles.card} activeOpacity={0.9}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Ionicons name="chatbubbles-outline" size={20} color="#9D78BD" style={{ marginRight: 6 }} />
          <Text style={styles.sectionTitle}>Group Chat</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Avatars (placeholder) */}
          <Image source={require('../../assets/avatar-placeholder.png')} style={styles.avatarSmall} />
          <Image source={require('../../assets/avatar-placeholder.png')} style={[styles.avatarSmall, { marginLeft: -10 }]} />
          <Image source={require('../../assets/avatar-placeholder.png')} style={[styles.avatarSmall, { marginLeft: -10 }]} />
          <Text style={styles.chatPreviewText} numberOfLines={1}>
            <Text style={{ fontWeight: 'bold' }}>{chatPreview?.sender?.name || 'Ana'}: </Text>
            {chatPreview?.content || 'Hey, anyone up for...'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Food Circle */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Food Circle</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={foodPost?.image ? { uri: foodPost.image } : require('../../assets/avatar-placeholder.png')} style={styles.foodImage} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.foodTitle} numberOfLines={1}>{foodPost?.desc ? foodPost.desc.split(' ')[0] : 'Pasta'} <Text style={styles.foodDesc}>with {foodPost?.desc?.split(' ').slice(1).join(' ') || 'cherry tomatoes'}</Text></Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Image source={foodPost?.user?.avatar ? { uri: foodPost.user.avatar } : require('../../assets/avatar-placeholder.png')} style={styles.avatarTiny} />
              <Text style={styles.foodUser}>{foodPost?.user?.name || 'Paul'}</Text>
              <Text style={styles.foodTime}>{foodPost ? timeAgo(foodPost.created_at) : '15m'}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Marketplace */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Marketplace</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={marketItem?.image ? { uri: marketItem.image } : require('../../assets/avatar-placeholder.png')} style={styles.foodImage} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.marketTitle}><Text style={{ fontWeight: 'bold' }}>{marketItem?.owner?.name || 'Elena'}</Text> listed <Text style={{ fontWeight: 'bold' }}>{marketItem?.title || 'Blue shirt'}</Text></Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <View style={styles.marketBadge}><Text style={styles.marketBadgeText}>{marketItem?.status === 'free' ? 'Free' : 'FrC'}</Text></View>
              <Text style={styles.foodTime}>{marketItem ? timeAgo(marketItem.created_at) : '1h'}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Events */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Events</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={require('../../assets/avatar-placeholder.png')} style={styles.foodImage} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.eventTitle}><Text style={{ fontWeight: 'bold' }}>{event?.creator?.name || 'Mihai'}</Text> created <Text style={{ fontWeight: 'bold' }}>{event?.title || 'Board Game Night'}</Text></Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Image source={event?.creator?.avatar ? { uri: event.creator.avatar } : require('../../assets/avatar-placeholder.png')} style={styles.avatarTiny} />
              <Text style={styles.foodTime}>{event ? timeAgo(event.created_at) : '3h'}</Text>
              <TouchableOpacity style={styles.rsvpBtn}><Text style={styles.rsvpText}>RSVP</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function timeAgo(dateString: string) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 60000); // minutes
  if (diff < 60) return `${diff}m`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h`;
  return `${Math.floor(diff / 1440)}d`;
}

function themedStyles(colorScheme: string | null) {
  const isDark = colorScheme === 'dark';
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#18181b' : '#fafafa',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? '#18181b' : '#fafafa',
    },
    emptyText: {
      color: isDark ? '#fff' : '#222',
      fontSize: 18,
      fontWeight: '600',
    },
    bubbleTitle: {
      fontSize: 32,
      fontWeight: 'bold',
      color: isDark ? '#fff' : '#222',
      marginBottom: 18,
    },
    card: {
      backgroundColor: isDark ? '#23232b' : '#fff',
      borderRadius: 18,
      padding: 18,
      marginBottom: 18,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: isDark ? '#fff' : '#222',
      marginBottom: 8,
    },
    chatPreviewText: {
      marginLeft: 12,
      color: isDark ? '#fff' : '#222',
      fontSize: 15,
      flex: 1,
    },
    avatarSmall: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: '#fff',
      backgroundColor: '#eee',
    },
    avatarTiny: {
      width: 24,
      height: 24,
      borderRadius: 12,
      marginRight: 6,
      backgroundColor: '#eee',
    },
    foodImage: {
      width: 64,
      height: 64,
      borderRadius: 12,
      backgroundColor: '#eee',
    },
    foodTitle: {
      fontSize: 17,
      fontWeight: 'bold',
      color: isDark ? '#fff' : '#222',
    },
    foodDesc: {
      fontWeight: 'normal',
      color: isDark ? '#aaa' : '#666',
    },
    foodUser: {
      fontSize: 14,
      color: isDark ? '#fff' : '#222',
      marginLeft: 6,
      marginRight: 8,
    },
    foodTime: {
      fontSize: 13,
      color: isDark ? '#aaa' : '#888',
      marginLeft: 8,
    },
    marketTitle: {
      fontSize: 16,
      color: isDark ? '#fff' : '#222',
    },
    marketBadge: {
      backgroundColor: isDark ? '#23232b' : '#eee',
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginRight: 8,
    },
    marketBadgeText: {
      color: isDark ? '#fff' : '#666',
      fontSize: 13,
    },
    eventTitle: {
      fontSize: 16,
      color: isDark ? '#fff' : '#222',
    },
    rsvpBtn: {
      backgroundColor: '#7B61FF',
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 4,
      marginLeft: 12,
    },
    rsvpText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 14,
    },
  });
} 