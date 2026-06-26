import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl() && supabasePublishableKey());
}

export async function getSupabaseServerClient() {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  if (!url || !key) return null;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; Proxy and Route Handlers refresh them.
        }
      }
    }
  });
}

function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function supabasePublishableKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}
