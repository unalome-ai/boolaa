import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity, Image, View, StyleSheet, useColorScheme, Text, Platform, StatusBar, ScrollView } from 'react-native';
import { useAuth } from '../../AuthContext';
import { useBubble } from '../../BubbleContext';
import React, { useRef, useEffect, useState } from 'react';
import ProfileSettingsSheet from '../../components/ProfileSettingsSheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const MAIN_TABS = [
  { name: 'home', icon: 'home-outline', label: 'Home' },
  { name: 'events', icon: 'calendar-outline', label: 'Events' },
  { name: 'food', icon: 'fast-food-outline', label: 'Food Circle' },
  { name: 'marketplace', icon: 'pricetags-outline', label: 'Marketplace' },
  { name: 'settings', icon: 'settings-outline', label: 'Settings' },
];

function ChatFAB() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  return (
    <TouchableOpacity
      style={fabStyles.fab}
      onPress={() => router.push('/(main)/chat')}
      accessibilityLabel="Open chat"
      activeOpacity={0.85}
    >
      <Ionicons name="chatbubble-ellipses-outline" size={24} color="#fff" />
    </TouchableOpacity>
  );
}

const fabStyles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 100, // above the tab bar
    backgroundColor: '#9D78BD',
    borderRadius: 32,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 8,
    zIndex: 200,
  },
});

function CustomTabBar({ state, descriptors, navigation }) {
  const colorScheme = useColorScheme();
  // Only show main tabs
  const visibleRoutes = state.routes.filter((route) =>
    MAIN_TABS.some((tab) => tab.name === route.name)
  );
  const pillBg = colorScheme === 'dark' ? '#23232b' : '#fff';
  // Show FAB and tab bar only on main tabs (not on chat/hidden screens)
  const currentRoute = state.routes[state.index];
  const showFab = MAIN_TABS.some(tab => tab.name === currentRoute.name);
  const showTabBar = MAIN_TABS.some(tab => tab.name === currentRoute.name);
  if (!showTabBar) return null;
  return (
    <>
      <View style={[styles.tabBarContainer, colorScheme === 'dark' && { backgroundColor: 'transparent' }]}> 
        <View style={[styles.tabBarPill, { backgroundColor: pillBg }]}> 
          {visibleRoutes.map((route, index) => {
            const { options } = descriptors[route.key];
            const tab = MAIN_TABS.find((t) => t.name === route.name);
            if (!tab) return null;
            const isFocused = state.index === state.routes.findIndex(r => r.name === route.name);
            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarTestID}
                onPress={() => {
                  if (!isFocused) navigation.navigate(route.name);
                }}
                style={styles.tabButton}
                activeOpacity={0.8}
              >
                <View style={[styles.iconCircle, isFocused && styles.iconCircleActive]}>
                  <Ionicons
                    name={tab.icon as any}
                    size={24}
                    color={isFocused ? '#fff' : '#9D78BD'}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {showFab && <ChatFAB />}
    </>
  );
}

const styles = StyleSheet.create({
  tabBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
    backgroundColor: 'transparent',
    zIndex: 100,
  },
  tabBarPill: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
    alignItems: 'center',
  },
  tabButton: {
    marginHorizontal: 8,
    alignItems: 'center',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleActive: {
    backgroundColor: '#9D78BD',
  },
});

function CustomHeader({ title }: { title: string }) {
  const colorScheme = useColorScheme();
  const { userProfile, joinedBubbles } = useAuth();
  const { currentBubble, setCurrentBubble } = useBubble();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  // Add extra top padding for status bar/safe area
  const topPadding = Platform.OS === 'android' ? (StatusBar.currentHeight || 32) : 56;

  // Scroll to current bubble when it changes
  useEffect(() => {
    if (!currentBubble || !joinedBubbles.length) return;
    const idx = joinedBubbles.findIndex(b => b.id === currentBubble.id);
    if (idx >= 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: idx * 80, animated: true });
    }
  }, [currentBubble, joinedBubbles]);

  return (
    <View style={{ backgroundColor: colorScheme === 'dark' ? '#18181b' : '#fafafa', minHeight: 120, paddingTop: topPadding, paddingBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 32, fontWeight: 'bold', color: colorScheme === 'dark' ? '#fff' : '#222', flex: 1, textAlign: 'left' }}>{title}</Text>
        <TouchableOpacity onPress={() => setShowProfileSheet(true)} activeOpacity={0.8}>
          {userProfile?.avatar ? (
            <Image
              source={{ uri: userProfile.avatar }}
              style={{ width: 40, height: 40, borderRadius: 20, marginLeft: 12, borderWidth: 2, borderColor: '#9D78BD', backgroundColor: '#eee' }}
            />
          ) : (
            <Image
              source={require('../../assets/avatar-placeholder.png')}
              style={{ width: 40, height: 40, borderRadius: 20, marginLeft: 12, borderWidth: 2, borderColor: '#9D78BD', backgroundColor: '#eee' }}
            />
          )}
        </TouchableOpacity>
      </View>
      {/* Horizontal bubble switcher */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0, flexDirection: 'row', marginTop: 8, paddingLeft: 16 }}
        contentContainerStyle={{ alignItems: 'center' }}
      >
        {joinedBubbles.map((bubble) => {
          const isActive = currentBubble && String(bubble.id) === String(currentBubble.id);
          return (
            <TouchableOpacity
              key={bubble.id}
              onPress={() => setCurrentBubble(bubble)}
              style={{
                marginRight: 12,
                minWidth: 44,
                height: 32,
                borderRadius: 22,
                backgroundColor: isActive ? '#9D78BD' : (colorScheme === 'dark' ? '#23232b' : '#eee'),
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 12,
                flexDirection: 'row',
                borderWidth: isActive ? 2 : 0,
                borderColor: isActive ? '#7B61FF' : 'transparent',
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: isActive ? '#fff' : '#9D78BD', fontWeight: '500', fontSize: 14 }}>
                {bubble.name || '?'}
              </Text>
            </TouchableOpacity>
          );
        })}
        {/* Create New Bubble Button */}
        <TouchableOpacity
          onPress={() => {/* TODO: navigate to create bubble screen or open modal */}}
          style={{
            minWidth: 44,
            height: 32,
            borderRadius: 22,
            borderWidth: 2,
            borderColor: '#9D78BD',
            backgroundColor: 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 12,
            flexDirection: 'row',
            marginRight: 4,
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#9D78BD" style={{ marginRight: 4 }} />
          <Text style={{ color: '#9D78BD', fontWeight: '500', fontSize: 14 }}>New</Text>
        </TouchableOpacity>
      </ScrollView>
      <ProfileSettingsSheet visible={showProfileSheet} onClose={() => setShowProfileSheet(false)} />
    </View>
  );
}

export default function MainTabLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Tabs
        tabBar={props => <CustomTabBar {...props} />}
        screenOptions={({ route }) => {
          // Only set custom header for main tabs
          const tab = MAIN_TABS.find((t) => t.name === route.name);
          return tab
            ? {
                header: () => <CustomHeader title={tab.label} />,
                headerStyle: { backgroundColor: 'transparent', elevation: 0, shadowColor: 'transparent' },
                headerTitle: '',
                headerShadowVisible: false,
              }
            : { headerShown: false };
        }}
      >
        <Tabs.Screen name="home" options={{ title: 'Home' }} />
        <Tabs.Screen name="events" options={{ title: 'Events' }} />
        <Tabs.Screen name="food" options={{ title: 'Food Circle' }} />
        <Tabs.Screen name="marketplace" options={{ title: 'Marketplace' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
        {/* Hide these from the tab bar */}
        <Tabs.Screen name="chat" options={{ href: null }} />
        <Tabs.Screen name="links" options={{ href: null }} />
        <Tabs.Screen name="index" options={{ href: null }} />
      </Tabs>
    </GestureHandlerRootView>
  );
}