import { Redirect } from 'expo-router';
export default function OnboardingIndex() {
  // Redirect to create-or-join-bubble by default
  return <Redirect href="/(onboarding)/create-or-join-bubble" />;
} 