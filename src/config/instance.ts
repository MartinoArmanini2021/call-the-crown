// Per-instance settings, from the build environment (.env, see .env.example). Everything else about
// the event (brand, rules, texts) comes from the database at boot (src/config/eventConfig.tsx).
// Grand Slam GM hard-codes these; a template cannot.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

const env = import.meta.env;

export const instance = {
  supabaseUrl: required("VITE_SUPABASE_URL", env.VITE_SUPABASE_URL),
  supabaseAnonKey: required("VITE_SUPABASE_ANON_KEY", env.VITE_SUPABASE_ANON_KEY),
  // Optional: analytics and the sign-up challenge are simply off when these are empty.
  posthogKey: env.VITE_POSTHOG_KEY ?? "",
  posthogHost: env.VITE_POSTHOG_HOST ?? "",
  turnstileSiteKey: env.VITE_TURNSTILE_SITE_KEY ?? "",
};
