// A gentle update check for fans who keep the home-screen app open for days (UX review, 13 Nov 2026).
// No service worker: when the page becomes visible again, at most every 10 minutes, the app fetches
// "/" past every cache and compares the name of its main script (Vite puts a content hash in it,
// /assets/index-AbC123.js) with the one this page is running. A different name means a new build is
// live; the app then offers a refresh and never reloads by itself (a fan may be halfway through a pick).

const SCRIPT = /\/assets\/index-[\w-]+\.js/;

/** The main script a page loads (its <script src>, e.g. "/assets/index-AbC123.js"); null if none. */
export function mainScript(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\ssrc=["']?([^"'\s>]+)/i)?.[1];
    const name = src?.match(SCRIPT)?.[0];
    if (name) return name;
  }
  return null;
}

/** The main script of the running page (null in development, where there is no built script). */
export function runningScript(doc: Document): string | null {
  for (const s of doc.querySelectorAll<HTMLScriptElement>("script[src]")) {
    const name = (s.getAttribute("src") ?? "").match(SCRIPT)?.[0];
    if (name) return name;
  }
  return null;
}

export const CHECK_EVERY_MS = 10 * 60_000;

/** Whether "/" now names another main script than the running one. Errors count as "no". */
export async function newVersionLive(running: string, fetcher: typeof fetch = fetch) {
  try {
    const res = await fetcher("/", { cache: "no-store", headers: { Accept: "text/html" } });
    if (!res.ok) return false;
    const live = mainScript(await res.text());
    return live !== null && live !== running;
  } catch {
    return false;
  }
}
