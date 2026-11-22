import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../AuthContext';
import { supabase } from '../../supabaseClient';

export default function LoginScreen() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { signIn, loading, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);

  // Email/password login
  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password.');
      return;
    }
    const { error } = await signIn(email, password);
    if (error) {
      Alert.alert('Login failed', error.message);
    } else {
      // Redirect to main home after successful login
      router.replace('/(main)/home');
    }
  };

  // Google login
  const handleGoogleLogin = async () => {
    setOauthLoading(true);
    const redirectTo =
      Platform.select({
        web: window.location.origin,
        default: 'exp://127.0.0.1:19000/--/auth/callback', // or your LAN IP
      });

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    setOauthLoading(false);
    if (error) {
      Alert.alert('Google Login failed', error.message);
    }
  };

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      router.replace('/(main)/home');
    }
  }, [user, router]);

  // Themed styles
  const styles = themedStyles(colorScheme);

  if (loading && !user) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colorScheme === 'dark' ? '#18181b' : '#fff' }}>
        <Text style={{ color: '#9D78BD', fontSize: 18, marginBottom: 16, fontWeight: '600' }}>
          Warming up...
        </Text>
        <ActivityIndicator size="large" color="#9D78BD" />
      </View>
    );
  }

  // If user exists, don't show the login form (redirect will happen)
  if (user) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Boolaa</Text>
      <Text style={styles.subtitle}>Sign in to your bubble</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#888'}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#888'}
        autoCapitalize="none"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.googleButton} onPress={handleGoogleLogin} disabled={oauthLoading}>
        {oauthLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in with Google</Text>}
      </TouchableOpacity>
      <View style={styles.footer}>
        <Text style={styles.footerText}>Don't have an account?</Text>
        <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
          <Text style={styles.footerLink}>Sign Up</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function themedStyles(colorScheme: string | null) {
  const isDark = colorScheme === 'dark';
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      backgroundColor: isDark ? '#18181b' : '#fff',
    },
    title: {
      fontSize: 32,
      fontWeight: 'bold',
      color: '#9D78BD',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: isDark ? '#aaa' : '#666',
      marginBottom: 24,
    },
    input: {
      width: '100%',
      backgroundColor: isDark ? '#23232b' : '#F5F5F5',
      borderRadius: 8,
      padding: 15,
      marginBottom: 16,
      fontSize: 16,
      color: isDark ? '#fff' : '#222',
    },
    button: {
      backgroundColor: '#9D78BD',
      borderRadius: 8,
      padding: 15,
      alignItems: 'center',
      width: '100%',
      marginBottom: 12,
    },
    googleButton: {
      backgroundColor: '#4285F4',
      borderRadius: 8,
      padding: 15,
      alignItems: 'center',
      width: '100%',
      marginBottom: 24,
    },
    buttonText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 16,
    },
    footer: {
      flexDirection: 'row',
      marginTop: 16,
    },
    footerText: {
      color: isDark ? '#aaa' : '#666',
      marginRight: 5,
    },
    footerLink: {
      color: '#9D78BD',
      fontWeight: 'bold',
    },
  });
} 