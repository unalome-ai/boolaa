import { AppShell } from "@/components/app-shell";
import { BoolaaProvider } from "@/components/boolaa-provider";
import { ChatUnreadProvider } from "@/components/chat-unread";
import { PageLoader } from "@/components/ui";

// Data is loaded client-side with the browser Supabase client (RLS-scoped, realtime-capable);
// the proxy has already gated the request (signed in + at least one approved bubble).
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <BoolaaProvider
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <PageLoader />
        </div>
      }
    >
      <ChatUnreadProvider>
        <AppShell>{children}</AppShell>
      </ChatUnreadProvider>
    </BoolaaProvider>
  );
}
