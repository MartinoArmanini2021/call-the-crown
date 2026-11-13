import { describe, expect, test } from "bun:test";
import { mainScript, newVersionLive } from "../src/lib/updateCheck";

// The page as Vite builds it: the entry script first, then the preloaded chunks and the styles.
const page = (hash: string) => `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-${hash}.js"></script>
<link rel="modulepreload" crossorigin href="/assets/useAuth-C4CYUJWI.js">
<link rel="stylesheet" crossorigin href="/assets/index-Dt-Ycghk.css">
</head><body><div id="root"></div></body></html>`;
const serve = (body: string, status = 200) =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

describe("update check", () => {
  test("reads the entry script's name, not a preload or the styles", () => {
    expect(mainScript(page("CISh4k9P"))).toBe("/assets/index-CISh4k9P.js");
    expect(mainScript("<html><body>no build here</body></html>")).toBeNull();
  });

  test("a new build is live only when the entry script's name changed", async () => {
    const running = "/assets/index-CISh4k9P.js";
    expect(await newVersionLive(running, serve(page("CISh4k9P")))).toBe(false);
    expect(await newVersionLive(running, serve(page("Zz9-new0")))).toBe(true);
  });

  test("an error, an odd page or no network never offers a refresh", async () => {
    const running = "/assets/index-CISh4k9P.js";
    expect(await newVersionLive(running, serve(page("Zz9-new0"), 503))).toBe(false);
    expect(await newVersionLive(running, serve("<html>maintenance</html>"))).toBe(false);
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await newVersionLive(running, offline)).toBe(false);
  });
});
