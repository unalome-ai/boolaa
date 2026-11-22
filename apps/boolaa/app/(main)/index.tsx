import { Redirect } from 'expo-router';
export default function MainIndex() {
  // Redirect to home by default
  return <Redirect href="/(main)/home" />;
} 