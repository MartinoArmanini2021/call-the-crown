import { createClient } from "@supabase/supabase-js";
import { instance } from "@/config/instance";

// Sessions persist in localStorage and refresh themselves, so a fan enters a sign-in code once per
// device, not once per visit. Pattern from grand-slam-gm/src/integrations/live/client.ts.
export const supabase = createClient(instance.supabaseUrl, instance.supabaseAnonKey, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // codes, never links: links break inside in-app browsers
  },
});
