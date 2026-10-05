// reminder-unsubscribe — turns night reminders off from the link in a reminder email (brief "bragging
// rights", Phase 5). Public: verify_jwt is off for this function only (supabase/config.toml), because a
// mail app's one-click unsubscribe carries no Supabase key. What protects it is the HMAC token over the
// user id (REMINDER_UNSUB_SECRET); the logic, POST only, is handler.ts.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleUnsubscribe } from "./handler.ts";

Deno.serve((req) => {
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  return handleUnsubscribe(req, {
    secret: Deno.env.get("REMINDER_UNSUB_SECRET") ?? "",
    unsubscribe: async (userId) => {
      const r = await client.rpc("unsubscribe_reminders", { p_user: userId });
      if (r.error) throw r.error;
      return r.data as boolean;
    },
  });
});
