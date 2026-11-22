import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { A } from "./strings";
import AdminView from "./view";

// Internal tool: never indexed, not in the sitemap, not linked from the app.
export const metadata: Metadata = {
  title: A.pageTitle,
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

/**
 * Admins only (public.admins via is_admin()). Everyone else, signed out included, gets a plain 404
 * so the route doesn't reveal that it exists. The RPCs check is_admin() again on every call.
 */
export default async function Page() {
  const supabase = await getServerSupabase();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) notFound();
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error || isAdmin !== true) notFound();
  return <AdminView />;
}
