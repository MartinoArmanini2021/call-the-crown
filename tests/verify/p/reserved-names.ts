// Names that imitate the game's own team (Tino, 6 Oct 2026; 0051) on the two screens where a name is typed:
//   Join: the message shows at once and "Send my code" stays off; an ordinary name is let through;
//   Profile: saving such a name is refused by the server with the reason, not "Something went wrong".
//   PW=… ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/reserved-names.ts   (app on :5182, local stack with 0051)
import {
  APP,
  UA,
  createUser,
  deleteTestUsers,
  passwordSession,
  pw,
  signedInInit,
  sleep,
} from "./lib";

let failed = false;
const check = (ok: boolean, text: string, got?: unknown) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${text}${ok ? "" : `  got: ${JSON.stringify(got)}`}`);
  if (!ok) failed = true;
};
const RESERVED = /could be taken for the game's own team/;

const PASS = "audit-reserved-names-3301";
const email = `p-names${Date.now() % 100000}@example.test`;
await createUser(email, PASS, "Names Audit");
const session = await passwordSession(email, PASS);
const browser = await pw.chromium.launch();
try {
  console.log("\nJoin");
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
    const p = await c.newPage();
    await p.goto(`${APP}/sign-in`);
    const name = p.getByLabel("Display name");
    const send = p.getByRole("button", { name: "Send my code" });
    await p.getByRole("textbox", { name: "Email" }).fill("someone@example.test");
    for (const n of ["Admin", "Call the Crown", "4dm1n"]) {
      await name.fill(n);
      await sleep(150);
      const msg = (await p.locator('[role="alert"]').allInnerTexts()).join(" ");
      check(
        RESERVED.test(msg) && (await send.isDisabled()),
        `"${n}": the message shows and the code cannot be sent`,
        msg,
      );
    }
    await name.fill("Badminton Bob");
    await sleep(150);
    const msg = (await p.locator('[role="alert"]').allInnerTexts()).join(" ");
    check(
      !RESERVED.test(msg) && (await send.isEnabled()),
      `"Badminton Bob": no message, the code can be sent`,
      msg,
    );
    await c.close();
  }
  console.log("\nProfile");
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
    await signedInInit(c, session, "en");
    const p = await c.newPage();
    await p.goto(`${APP}/profile`);
    await p.waitForLoadState("networkidle").catch(() => {});
    const name = p.getByLabel("Display name");
    await name.fill("Call the Crown");
    await p.getByRole("button", { name: /^Save/ }).first().click();
    await sleep(1500);
    const body = await p.locator("body").innerText();
    check(
      RESERVED.test(body),
      "saving a staff-like name shows why it was refused",
      body.slice(0, 300),
    );
    await c.close();
  }
} finally {
  await browser.close();
  console.log("deleted:", await deleteTestUsers());
}
if (failed) process.exit(1);
console.log("\nall checks true");
