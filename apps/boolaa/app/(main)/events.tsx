import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Image, useColorScheme, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../AuthContext';
import { useBubble } from '../../BubbleContext';
import EventSheet from '../../components/EventSheet';
import { Swipeable } from 'react-native-gesture-handler';

export default function EventsScreen() {
  const colorScheme = useColorScheme();
  const { user } = useAuth();
  const { currentBubble } = useBubble();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myEvents, setMyEvents] = useState<any[]>([]);
  const [bubbleEvents, setBubbleEvents] = useState<any[]>([]);
  const [showEventSheet, setShowEventSheet] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any | null>(null);

  const styles = themedStyles(colorScheme);

  const fetchEvents = useCallback(() => {
    if (!currentBubble || !user) return;
    setLoading(true);
    supabase
      .from('events')
      .select('id, title, description, datetime, location, creator_id, creator:users(name, avatar), created_at')
      .eq('bubble_id', currentBubble.id)
      .order('datetime', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) {
          setMyEvents(data.filter((e: any) => e.creator_id === user.id));
          setBubbleEvents(data.filter((e: any) => e.creator_id !== user.id));
        } else {
          setMyEvents([]);
          setBubbleEvents([]);
        }
        setLoading(false);
        setRefreshing(false);
      });
  }, [currentBubble, user]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleEventSave = async (event: { id?: string; title: string; description: string; datetime: Date; location: string }) => {
    if (!user || !currentBubble) return;
    if (event.id) {
      // Edit
      const { error } = await supabase.from('events').update({
        title: event.title,
        description: event.description,
        datetime: event.datetime.toISOString(),
        location: event.location,
      }).eq('id', event.id);
      if (error) alert('Error updating event: ' + error.message);
    } else {
      // Create
      const { error } = await supabase.from('events').insert({
        title: event.title,
        description: event.description,
        datetime: event.datetime.toISOString(),
        location: event.location,
        creator_id: user.id,
        bubble_id: currentBubble.id,
        created_at: new Date().toISOString(),
      });
      if (error) alert('Error saving event: ' + error.message);
    }
    setEditingEvent(null);
    setShowEventSheet(false);
    fetchEvents();
  };

  const handleDeleteEvent = (eventId: string) => {
    Alert.alert('Delete Event', 'Are you sure you want to delete this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('events').delete().eq('id', eventId);
          fetchEvents();
        }
      }
    ]);
  };

  if (!currentBubble) {
    return <View style={styles.centered}><Text style={styles.emptyText}>No bubble selected.</Text></View>;
  }
  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#9D78BD" /></View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchEvents();
          }}
          tintColor="#9D78BD"
        />
      }
    >
      {/* My Events header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Text style={styles.sectionTitle}>My Events</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => { setEditingEvent(null); setShowEventSheet(true); }}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 }}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#9D78BD" style={{ marginRight: 4 }} />
          <Text style={{ color: '#9D78BD', fontWeight: '500', fontSize: 15 }}>Add</Text>
        </TouchableOpacity>
      </View>
      {myEvents.length === 0 ? (
        <Text style={styles.emptyText}>You haven't created any events yet.</Text>
      ) : (
        myEvents.map(event => (
          <Swipeable
            key={event.id}
            renderRightActions={() => (
              <View style={{
                flexDirection: "row",
                alignItems: 'center',
                alignContent: 'center',
                justifyContent: 'center',
                borderTopRightRadius: 16,
                borderBottomRightRadius: 16,
                left: 16,
                right: 0,
                overflow: 'hidden',
                marginBottom: 18, // match card margin
              }}>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#7B61FF',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: 80,
                    height: 128,
                    marginBottom: 18,
                  }}
                  onPress={() => { setEditingEvent(event); setShowEventSheet(true); }}
                >
                  <Ionicons name="create-outline" size={24} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 12 }}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#FF4D4F',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: 64,
                    height: 128,
                    borderBottomRightRadius: 16,
                    marginBottom: 18,
                  }}
                  onPress={() => handleDeleteEvent(event.id)}
                >
                  <Ionicons name="trash-outline" size={24} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 12 }}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          >
              <EventCard event={event} colorScheme={colorScheme} /> 
          </Swipeable>
        ))
      )}

      {/* Bubble Events */}
      <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Bubble Events</Text>
      {bubbleEvents.length === 0 ? (
        <Text style={styles.emptyText}>No upcoming events in this bubble.</Text>
      ) : (
        bubbleEvents.map(event => (
          <EventCard key={event.id} event={event} colorScheme={colorScheme} />
        ))
      )}
      <EventSheet
        visible={showEventSheet}
        onClose={() => { setShowEventSheet(false); setEditingEvent(null); }}
        onSave={handleEventSave}
        initialEvent={editingEvent}
      />
    </ScrollView>
  );
}

function EventCard({ event, colorScheme }: { event: any, colorScheme: string | null }) {
  const isDark = colorScheme === 'dark';
  return (
    <View style={{
      backgroundColor: isDark ? '#23232b' : '#fff',
      borderRadius: 16,
      padding: 16,
      marginBottom: 18,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    }}>
      <Text style={{ fontSize: 17, fontWeight: 'bold', color: isDark ? '#fff' : '#222', marginBottom: 6 }}>{event.title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Ionicons name="calendar-outline" size={16} color="#9D78BD" style={{ marginRight: 6 }} />
        <Text style={{ color: isDark ? '#aaa' : '#666', fontSize: 14 }}>{formatDate(event.datetime)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Ionicons name="location-outline" size={16} color="#9D78BD" style={{ marginRight: 6 }} />
        <Text style={{ color: isDark ? '#aaa' : '#666', fontSize: 14 }}>{event.location || 'TBA'}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Image source={event.creator?.avatar ? { uri: event.creator.avatar } : require('../../assets/avatar-placeholder.png')} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8, backgroundColor: '#eee' }} />
        <Text style={{ color: isDark ? '#fff' : '#222', fontSize: 15 }}>{event.creator?.name || 'Unknown'}</Text>
      </View>
    </View>
  );
}

function formatDate(dateString: string) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
      color: isDark ? '#aaa' : '#888',
      fontStyle: 'italic',
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#9D78BD',
      marginBottom: 12,
    },
  });
} 