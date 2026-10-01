/**
 * Thin PostHog wrapper, copied from grand-slam-gm/src/lib/analytics.ts. Product events only:
 * PostHog is never a billing source (the billing count is public.activity_days).
 *  - The key comes from the instance's env; empty = analytics off.
 *  - posthog-js is imported dynamically, and calls made before it loads are queued.
 *  - Never throws: analytics must not break a render or block a pick.
 */
import { instance } from "@/config/instance";

type Props = Record<string, unknown>;
type PostHogLike = {
  init: (key: string, opts: Record<string, unknown>) => void;
  capture: (event: string, props?: Props) => void;
  identify: (id: string, props?: Props) => void;
  reset: () => void;
};

let client: PostHogLike | null = null;
let loading: Promise<PostHogLike | null> | null = null;
const queue: Array<(ph: PostHogLike) => void> = [];

function load(): Promise<PostHogLike | null> {
  if (typeof window === "undefined" || !instance.posthogKey) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (loading) return loading;
  loading = import("posthog-js")
    .then((mod) => {
      const ph = (mod.default ?? (mod as unknown as PostHogLike)) as PostHogLike;
      ph.init(instance.posthogKey, {
        api_host: instance.posthogHost || undefined,
        capture_pageview: false, // client routing: we send our own screen_view on every route change
        person_profiles: "identified_only",
      });
      client = ph;
      for (const fn of queue.splice(0)) {
        try {
          fn(ph);
        } catch {
          /* ignore */
        }
      }
      return ph;
    })
    .catch(() => null);
  return loading;
}

function run(fn: (ph: PostHogLike) => void) {
  try {
    if (typeof window === "undefined" || !instance.posthogKey) return;
    if (client) {
      fn(client);
      return;
    }
    queue.push(fn);
    void load();
  } catch {
    /* analytics is never allowed to surface */
  }
}

export function track(event: string, props?: Props) {
  run((ph) => ph.capture(event, props));
}
export function identify(userId: string) {
  if (userId) run((ph) => ph.identify(userId));
}
export function resetIdentity() {
  run((ph) => ph.reset());
}
