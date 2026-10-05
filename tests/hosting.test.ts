import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Cloudflare Pages serves public/_headers as the response headers (audit 5 Oct 2026, P8): without it
// the site can be framed (clickjacking on picks and Account) and runs with no content policy.
const ROOT = join(import.meta.dir, "..");
const file = join(ROOT, "public", "_headers");
const text = existsSync(file) ? readFileSync(file, "utf8") : "";

/** The header lines under one path rule ("/*", "/index.html", …). */
function rule(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inside = false;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inside = line.trim() === path;
      continue;
    }
    if (inside) {
      const i = line.indexOf(":");
      out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  return out;
}
const csp = () =>
  Object.fromEntries(
    (rule("/*")["content-security-policy"] ?? "")
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name, values]),
  ) as Record<string, string[]>;

describe("hosting headers", () => {
  test("every page refuses framing, sniffing and leaky referrers", () => {
    const h = rule("/*");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(csp()["frame-ancestors"]).toEqual(["'none'"]);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toMatch(/^max-age=\d{7,}/);
    expect(h["permissions-policy"]).toBeTruthy();
  });

  test("the content policy loads scripts only from the site and the captcha", () => {
    const c = csp();
    expect(c["default-src"]).toEqual(["'self'"]);
    expect(c["object-src"]).toEqual(["'none'"]);
    expect(c["base-uri"]).toEqual(["'self'"]);
    expect(c["script-src"]).not.toContain("'unsafe-inline'");
    expect(c["script-src"]).not.toContain("'unsafe-eval'");
    expect(c["script-src"]).toContain("https://challenges.cloudflare.com");
    expect(c["frame-src"]).toContain("https://challenges.cloudflare.com");
  });

  test("the content policy allows every host the app talks to", () => {
    const c = csp();
    // Supabase (any project: staging and production differ), PostHog's default cloud, ATP headshots
    expect(c["connect-src"]).toEqual(
      expect.arrayContaining(["https://*.supabase.co", "wss://*.supabase.co"]),
    );
    expect(c["connect-src"]).toContain("https://*.posthog.com");
    expect(c["script-src"]).toContain("https://*.posthog.com");
    const imageHosts = new Set(
      readFileSync(join(ROOT, "supabase", "events", "sixkings_2026_draw.sql"), "utf8").match(
        /https:\/\/[a-z0-9.-]+/gi,
      ) ?? [],
    );
    for (const host of imageHosts) expect(c["img-src"]).toContain(host);
    expect(c["img-src"]).toContain("https://*.supabase.co");
  });

  test("index.html is revalidated on every visit, so a deploy is seen at once", () => {
    expect(rule("/index.html")["cache-control"]).toBe("no-cache");
    expect(rule("/")["cache-control"]).toBe("no-cache");
  });

  test("the build ships no source maps", () => {
    const config = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(config).not.toMatch(/sourcemap:\s*true/);
  });
});
