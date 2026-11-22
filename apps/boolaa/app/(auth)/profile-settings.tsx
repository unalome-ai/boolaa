import React, { useRef } from 'react';
import { View, Text, StyleSheet, useColorScheme, TouchableOpacity, Image, FlatList, Alert, Modal, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../AuthContext';

export default function ProfileSettingsScreen() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { user, userProfile, joinedBubbles, signOut } = useAuth();
  const [visible, setVisible] = React.useState(true);

  const styles = themedStyles(colorScheme);

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => router.back(), 300); // Give time for animation
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheetContainer}>
          {/* Drag handle */}
          <View style={styles.dragHandle} />
          {/* Close button */}
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeBtn}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={28} color={colorScheme === 'dark' ? '#fff' : '#9D78BD'} />
          </TouchableOpacity>
          {/* User Info */}
          <View style={styles.profileCard}>
            <Image
              source={userProfile?.avatar ? { uri: userProfile.avatar } : require('../../assets/avatar-placeholder.png')}
              style={styles.avatar}
            />
            <Text style={styles.name}>{userProfile?.name || 'Your Name'}</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>

          {/* Joined Bubbles */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Joined Bubbles</Text>
            {joinedBubbles.length === 0 ? (
              <Text style={styles.emptyText}>You haven't joined any bubbles yet.</Text>
            ) : (
              <FlatList
                data={joinedBubbles}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <View style={styles.bubbleItem}>
                    <Ionicons name="chatbubbles-outline" size={22} color="#9D78BD" style={{ marginRight: 8 }} />
                    <Text style={styles.bubbleName}>{item.name}</Text>
                    <Text style={styles.bubbleMembers}>{item.max_size} members</Text>
                  </View>
                )}
              />
            )}
          </View>

          {/* Logout Button */}
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => {
              Alert.alert('Logout', 'Are you sure you want to logout?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Logout', style: 'destructive', onPress: signOut },
              ]);
            }}
          >
            <Text style={styles.logoutText}>Logout from Bubble</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function themedStyles(colorScheme: string | null) {
  const isDark = colorScheme === 'dark';
  return StyleSheet.create({
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.3)',
      justifyContent: 'flex-end',
    },
    sheetContainer: {
      backgroundColor: isDark ? '#23232b' : '#fff',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: Platform.OS === 'ios' ? 32 : 16,
      paddingTop: 8,
      minHeight: '70%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 10,
    },
    dragHandle: {
      width: 40,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: isDark ? '#444' : '#ccc',
      alignSelf: 'center',
      marginBottom: 12,
    },
    closeBtn: {
      position: 'absolute',
      top: 16,
      right: 16,
      zIndex: 10,
    },
    profileCard: {
      alignItems: 'center',
      paddingVertical: 32,
      backgroundColor: isDark ? '#23232b' : '#f5f5f5',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 2,
      borderColor: '#9D78BD',
      marginBottom: 12,
      backgroundColor: '#eee',
    },
    name: {
      fontSize: 20,
      fontWeight: 'bold',
      color: isDark ? '#fff' : '#222',
    },
    email: {
      fontSize: 14,
      color: isDark ? '#aaa' : '#666',
      marginTop: 2,
    },
    section: {
      marginTop: 24,
      paddingHorizontal: 24,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: '#9D78BD',
      marginBottom: 12,
    },
    emptyText: {
      color: isDark ? '#aaa' : '#888',
      fontStyle: 'italic',
    },
    bubbleItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#222' : '#eee',
    },
    bubbleName: {
      fontSize: 16,
      color: isDark ? '#fff' : '#222',
      flex: 1,
    },
    bubbleMembers: {
      fontSize: 13,
      color: '#9D78BD',
      marginLeft: 8,
    },
    logoutButton: {
      marginTop: 32,
      marginBottom: 32,
      marginHorizontal: 24,
      backgroundColor: '#9D78BD',
      borderRadius: 8,
      paddingVertical: 16,
      alignItems: 'center',
    },
    logoutText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 16,
    },
  });
}
