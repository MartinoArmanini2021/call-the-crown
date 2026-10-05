// Section P (audit, 5 Oct 2026): a tiny static server that serves a built dist/ the way Cloudflare
// Pages does, so deep links can be tested after a refresh (P3) and the headers inspected (P8).
//   bun tests/verify/p/serve-pages.ts <distDir> [port=5182]
// Emulated Pages behaviour:
//   - a real file is served as-is;
//   - /index.html → 308 to / (Pages strips .html);
//   - otherwise the rules in <dist>/_redirects apply in order (here only "/* /index.html 200": a rewrite);
//   - <dist>/_headers is applied if present (there is none on build/phase-1);
//   - Pages' own default headers on every response (from the Pages docs, not observed live: no network):
//     Access-Control-Allow-Origin: *, Referrer-Policy: strict-origin-when-cross-origin,
//     X-Content-Type-Options: nosniff, Cache-Control: public, max-age=0, must-revalidate (+ ETag).
//     No CSP, no HSTS (zone setting, off by default), no X-Frame-Options.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dist = path.resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 5182);

type Rule = { from: string; to: string; status: number };
const rules: Rule[] = existsSync(path.join(dist, "_redirects"))
  ? readFileSync(path.join(dist, "_redirects"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const [from = "", to = "", status = "302"] = l.split(/\s+/);
        return { from, to, status: Number(status) };
      })
  : [];
const hasHeadersFile = existsSync(path.join(dist, "_headers"));

const DEFAULT_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "cache-control": "public, max-age=0, must-revalidate",
};

const match = (pattern: string, p: string) => {
  if (pattern.endsWith("/*"))
    return p.startsWith(pattern.slice(0, -1)) || p === pattern.slice(0, -2);
  return pattern === p;
};

function fileFor(p: string): string | null {
  const f = path.join(dist, decodeURIComponent(p));
  if (!f.startsWith(dist)) return null;
  if (existsSync(f) && statSync(f).isFile()) return f;
  return null;
}

const served = (file: string, status = 200) =>
  new Response(Bun.file(file), {
    status,
    headers: {
      ...DEFAULT_HEADERS,
      "x-emulated": hasHeadersFile ? "pages+_headers" : "pages-defaults",
    },
  });

Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/index.html") return Response.redirect(`${url.origin}/${url.search}`, 308);
    const direct = p !== "/" ? fileFor(p) : null;
    if (direct && !p.startsWith("/_")) return served(direct);
    if (p === "/") return served(path.join(dist, "index.html"));
    for (const r of rules) {
      if (!match(r.from, p)) continue;
      if (r.status === 200) {
        const target = fileFor(r.to);
        if (target) return served(target);
      } else return Response.redirect(`${url.origin}${r.to}`, r.status);
    }
    return new Response("Not found", { status: 404, headers: DEFAULT_HEADERS });
  },
});
console.log(
  `serving ${dist} on http://127.0.0.1:${port} (rules: ${rules.length}, _headers: ${hasHeadersFile})`,
);
