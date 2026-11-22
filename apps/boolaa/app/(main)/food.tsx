import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Image, useColorScheme, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../AuthContext';
import { useBubble } from '../../BubbleContext';
import FoodSheet from '../../components/FoodSheet';

export default function FoodShareScreen() {
  const colorScheme = useColorScheme();
  const { user } = useAuth();
  const { currentBubble } = useBubble();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myFood, setMyFood] = useState<any[]>([]);
  const [bubbleFood, setBubbleFood] = useState<any[]>([]);
  const [showFoodSheet, setShowFoodSheet] = useState(false);
  const [editingFood, setEditingFood] = useState<any | null>(null);

  const styles = themedStyles(colorScheme);

  const fetchFood = useCallback(() => {
    if (!currentBubble || !user) return;
    setLoading(true);
    supabase
      .from('food_posts')
      .select('id, image, description, created_at, user_id, user:users(name, avatar)')
      .eq('bubble_id', currentBubble.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          setMyFood(data.filter((f: any) => f.user_id === user.id));
          setBubbleFood(data.filter((f: any) => f.user_id !== user.id));
        } else {
          setMyFood([]);
          setBubbleFood([]);
        }
        setLoading(false);
        setRefreshing(false);
      });
  }, [currentBubble, user]);

  useEffect(() => {
    fetchFood();
  }, [fetchFood]);

  const handleFoodSave = async (food: { id?: string; desc: string; image: string}) => {
    if (!user || !currentBubble) return;
    if (food.id) {
      // Edit
      const { error } = await supabase.from('food_posts').update({
        description: food.desc,
        image: food.image,
      }).eq('id', food.id);
      if (error) alert('Error updating food: ' + error.message);
    } else {
      // Create
      const { error } = await supabase.from('food_posts').insert({
        description: food.desc,
        image: food.image,
        user_id: user.id,
        bubble_id: currentBubble.id,
        created_at: new Date().toISOString(),
      });
      if (error) alert('Error sharing food: ' + error.message);
    }
    setEditingFood(null);
    setShowFoodSheet(false);
    fetchFood();
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
            fetchFood();
          }}
          tintColor="#9D78BD"
        />
      }
    >
      {/* My Shared Food header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Text style={styles.sectionTitle}>My Food Goodies</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => { setEditingFood(null); setShowFoodSheet(true); }}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 }}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#9D78BD" style={{ marginRight: 4 }} />
          <Text style={{ color: '#9D78BD', fontWeight: '500', fontSize: 15 }}>Add</Text>
        </TouchableOpacity>
      </View>
      {myFood.length === 0 ? (
        <Text style={styles.emptyText}>You haven't shared any food yet.</Text>
      ) : (
        myFood.map(food => (
          <FoodCard key={food.id} food={food} colorScheme={colorScheme} />
        ))
      )}

      {/* Bubble Free Food */}
      <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Bubble Food Goodies</Text>
      {bubbleFood.length === 0 ? (
        <Text style={styles.emptyText}>No food goodies in this bubble.</Text>
      ) : (
        bubbleFood.map(food => (
          <FoodCard key={food.id} food={food} colorScheme={colorScheme} />
        ))
      )}
      <FoodSheet
        visible={showFoodSheet}
        onClose={() => { setShowFoodSheet(false); setEditingFood(null); }}
        onSave={handleFoodSave}
        initialFood={editingFood}
      />
    </ScrollView>
  );
}

function FoodCard({ food, colorScheme }: { food: any, colorScheme: string | null }) {
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
      flexDirection: 'row',
      alignItems: 'center',
    }}>
      <Image source={food.image ? { uri: food.image } : require('../../assets/avatar-placeholder.png')} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: '#eee', marginRight: 16 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, fontWeight: 'bold', color: isDark ? '#fff' : '#222', marginBottom: 6 }} numberOfLines={1}>{food.description || 'Shared Food'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <Ionicons name="time-outline" size={16} color="#9D78BD" style={{ marginRight: 6 }} />
          <Text style={{ color: isDark ? '#aaa' : '#666', fontSize: 14 }}>{formatDate(food.created_at)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={food.user?.avatar ? { uri: food.user.avatar } : require('../../assets/avatar-placeholder.png')} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8, backgroundColor: '#eee' }} />
          <Text style={{ color: isDark ? '#fff' : '#222', fontSize: 15 }}>{food.user?.name || 'Unknown'}</Text>
        </View>
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