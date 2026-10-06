// Section P helpers (audit, 5 Oct 2026). Playwright from a scratch install (not a repo dependency):
//   PW=<dir with node_modules/playwright-core> bun tests/verify/p/<script>.ts
// Every request that is not the app (127.0.0.1:5182) or the local stack (127.0.0.1:55321) is aborted
// and recorded; the PostHog host is fulfilled locally with {} so its calls can be read (P5).
import { createRequire } from "node:module";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const PW = process.env.PW ?? "";
const req = createRequire(path.join(PW || process.cwd(), "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pw: any = PW ? req("playwright-core") : null;

export const APP = "http://127.0.0.1:5182";
export const API = "http://127.0.0.1:55321";
export const SCREENS = path.resolve(import.meta.dirname, "../screens");
export const ANON = process.env.ANON_KEY!;
export const SERVICE = process.env.SERVICE_KEY!;
export const STORAGE_KEY = "sb-127-auth-token";

export type Log = {
  console: { type: string; text: string; url: string }[];
  blocked: string[];
  posthog: { event: string; props: Record<string, unknown>; url: string }[];
  rest: { method: string; url: string; status: number; body?: string }[];
};
export const newLog = (): Log => ({ console: [], blocked: [], posthog: [], rest: [] });

function decodePosthog(body: Buffer | null, url: string): unknown[] {
  if (!body || body.length === 0) return [];
  const tries: (() => string)[] = [
    () => body.toString("utf8"),
    () => gunzipSync(body).toString("utf8"),
    () => {
      const s = body.toString("utf8");
      const m = /data=([^&]+)/.exec(s);
      return Buffer.from(decodeURIComponent(m![1]!), "base64").toString("utf8");
    },
    () => Buffer.from(body.toString("utf8"), "base64").toString("utf8"),
  ];
  for (const t of tries) {
    try {
      const j = JSON.parse(t());
      return Array.isArray(j) ? j : j.batch ? j.batch : [j];
    } catch {
      /* next */
    }
  }
  return [{ event: "<undecoded>", properties: { url, bytes: body.length } }];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function wire(context: any, log: Log, opts: { recordRest?: boolean } = {}) {
  // posthog-js drops events from headless/webdriver browsers as bots: look like a normal phone browser
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined }); // brands say HeadlessChrome
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await context.route("**/*", async (route: any) => {
    const r = route.request();
    const u = new URL(r.url());
    if (u.host === "ph.audit.invalid") {
      for (const e of decodePosthog(r.postDataBuffer(), r.url()) as {
        event?: string;
        properties?: Record<string, unknown>;
      }[])
        if (e && e.event)
          log.posthog.push({ event: e.event, props: e.properties ?? {}, url: u.pathname });
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (u.origin === APP || u.origin === API || u.protocol === "data:" || u.protocol === "blob:")
      return route.fallback();
    log.blocked.push(r.url());
    return route.abort("blockedbyclient");
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context.on("page", (page: any) => attachPage(page, log, opts));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attachPage(page: any, log: Log, opts: { recordRest?: boolean } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.on("console", (m: any) => {
    if (m.type() === "error" || m.type() === "warning")
      log.console.push({ type: m.type(), text: m.text(), url: page.url() });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.on("pageerror", (e: any) =>
    log.console.push({ type: "pageerror", text: String(e), url: page.url() }),
  );
  if (opts.recordRest)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.on("response", async (res: any) => {
      const u = res.url();
      if (!u.startsWith(API)) return;
      let body: string | undefined;
      try {
        body = (await res.text()).slice(0, 4000);
      } catch {
        /* ignore */
      }
      log.rest.push({
        method: res.request().method(),
        url: u.replace(API, ""),
        status: res.status(),
        body,
      });
    });
}

// ---- users (admin API; emails p-<x>@example.test; deleted at the end) ----
export async function admin(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${API}/auth/v1/admin${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

export async function createUser(email: string, password: string, name: string) {
  const r = await admin("/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    }),
  });
  if (r.status >= 300) throw new Error(`create ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.id as string;
}

export async function listTestUsers(): Promise<{ id: string; email: string }[]> {
  const out: { id: string; email: string }[] = [];
  for (let page = 1; page < 50; page++) {
    const r = await admin(`/users?page=${page}&per_page=200`);
    const users = (r.json?.users ?? []) as { id: string; email: string }[];
    out.push(...users.filter((u) => /^p-[^@]+@example\.test$/.test(u.email)));
    if (users.length < 200) break;
  }
  return out;
}

export async function deleteTestUsers() {
  const users = await listTestUsers();
  for (const u of users) await admin(`/users/${u.id}`, { method: "DELETE" });
  return users.length;
}

export async function passwordSession(email: string, password: string) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`sign in ${email}: ${JSON.stringify(j)}`);
  return j;
}

export async function rpcAs(token: string, fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.text() };
}

/** A context already signed in: the session goes into localStorage before the app boots. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signedInInit(context: any, session: unknown, locale?: "en" | "ar") {
  await context.addInitScript(
    ([key, value, loc]: [string, string, string | null]) => {
      if (!sessionStorage.getItem("__seeded")) {
        localStorage.setItem(key, value);
        if (loc) localStorage.setItem("locale", loc);
        sessionStorage.setItem("__seeded", "1");
      }
    },
    [STORAGE_KEY, JSON.stringify(session), locale ?? null],
  );
}

/** Arabic on: event_config.flags.arabic is false in the local seed, so the AR screens need it forced. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function forceArabicFlag(context: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await context.route(`${API}/rest/v1/event_config*`, async (route: any) => {
    const res = await route.fetch();
    const rows = await res.json();
    for (const r of rows) r.flags = { ...(r.flags ?? {}), arabic: true };
    await route.fulfill({ response: res, json: rows });
  });
}

/** Layout problems at this width: page-level horizontal scroll and elements poking out of the viewport. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function layoutIssues(page: any) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1)
      out.push(
        `page scrolls sideways: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`,
      );
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden")
          return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (
        (r.right > vw + 1 || r.left < -1) &&
        !inScroller(el) &&
        getComputedStyle(el).position !== "fixed"
      ) {
        const cls = (el.getAttribute("class") ?? "").slice(0, 60);
        out.push(
          `overflow ${el.tagName.toLowerCase()}.${cls} [${Math.round(r.left)},${Math.round(r.right)}] "${(el.textContent ?? "").trim().slice(0, 40)}"`,
        );
      }
    }
    // text cut by an ellipsis (truncate) or clipped by overflow hidden
    const clipped: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.children.length > 0 && el.textContent === "") continue;
      const s = getComputedStyle(el);
      if (
        el.scrollWidth > el.clientWidth + 1 &&
        (s.textOverflow === "ellipsis" || s.overflow === "hidden") &&
        el.clientWidth > 0 &&
        (el.textContent ?? "").trim()
      )
        clipped.push(
          `"${(el.textContent ?? "").trim().slice(0, 50)}" (${el.clientWidth}/${el.scrollWidth}px)`,
        );
    }
    return { issues: [...new Set(out)].slice(0, 20), clipped: [...new Set(clipped)].slice(0, 20) };
  });
}

export const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
