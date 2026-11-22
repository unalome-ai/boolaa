import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { supabase } from '../../supabaseClient';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // Supabase will handle the session automatically via deep link
    // Optionally, you can check the session and redirect
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        router.replace('/(main)/home');
      } else {
        router.replace('/(auth)/login');
      }
    };
    checkSession();
  }, [router]);

  return null;
}
