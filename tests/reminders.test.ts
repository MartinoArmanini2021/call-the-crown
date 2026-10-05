import { describe, expect, test } from "bun:test";
import { checkUnsubToken, unsubToken } from "../supabase/functions/_shared/unsubToken";
import { handleUnsubscribe } from "../supabase/functions/reminder-unsubscribe/handler";
import {
  renderEmail,
  runReminders,
  type Candidate,
  type Config,
  type Email,
  type RemindersDb,
} from "../supabase/functions/send-reminders/reminders";

// Invented fans (AGENTS.md).
const SECRET = "test-secret-not-real";
const U1 = "00000000-0000-0000-0000-00000000f001";
const U2 = "00000000-0000-0000-0000-00000000f002";
const cand = (user_id: string, over: Partial<Candidate> = {}): Candidate => ({
  user_id,
  email: `${user_id.slice(-4)}@example.test`,
  locale: "en",
  night_no: 2,
  first_start: "2026-10-22T16:30:00Z",
  open_count: 1,
  total_count: 2,
  league_name: null,
  league_rank: null,
  league_size: null,
  ...over,
});
const cfg = (over: Partial<Config> = {}): Config => ({
  apiKey: "re_test",
  from: "Call the Crown <reminders@example.test>",
  appUrl: "https://app.example.test",
  functionsUrl: "https://fn.example.test/functions/v1",
  secret: SECRET,
  ...over,
});

/** A fake database whose claim behaves like the primary key: the first insert wins. */
function fakeDb(due: Candidate[]) {
  const rows = new Map<string, string>();
  const beats: string[] = [];
  const failures: string[] = [];
  const db: RemindersDb = {
    candidates: async () => due,
    timezone: async () => "Asia/Riyadh",
    claim: async (u, n, dry) => {
      await Promise.resolve(); // let the other run interleave
      const k = `${u}:${n}`;
      if (rows.has(k)) return false;
      rows.set(k, dry ? "dry_run" : "sent");
      return true;
    },
    failed: async (u, n, detail) => {
      rows.set(`${u}:${n}`, "failed");
      failures.push(detail);
    },
    heartbeat: async (_ok, detail) => {
      beats.push(detail);
    },
  };
  return { db, rows, beats, failures };
}

describe("unsubscribe token", () => {
  test("the token checks for its user and no other", async () => {
    const t = await unsubToken(SECRET, U1);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await checkUnsubToken(SECRET, U1, t)).toBe(true);
    expect(await checkUnsubToken(SECRET, U2, t)).toBe(false);
    expect(await checkUnsubToken("another-secret", U1, t)).toBe(false);
    expect(await checkUnsubToken(SECRET, U1, t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBe(
      false,
    );
    expect(await checkUnsubToken("", U1, t)).toBe(false);
  });
});

describe("reminder-unsubscribe", () => {
  const run = async (method: string, u: string, t: string) => {
    const calls: string[] = [];
    const res = await handleUnsubscribe(
      new Request(`https://fn.example.test/functions/v1/reminder-unsubscribe?u=${u}&t=${t}`, {
        method,
      }),
      { secret: SECRET, unsubscribe: async (id) => (calls.push(id), true) },
    );
    return { status: res.status, calls };
  };
  test("a GET never unsubscribes, even with a good token", async () => {
    const r = await run("GET", U1, await unsubToken(SECRET, U1));
    expect(r.status).toBe(405);
    expect(r.calls).toEqual([]);
  });
  test("a bad token gets 403 and changes nothing", async () => {
    const r = await run("POST", U1, await unsubToken(SECRET, U2));
    expect(r.status).toBe(403);
    expect(r.calls).toEqual([]);
    expect((await run("POST", "not-a-uuid", "x")).status).toBe(403);
    expect((await run("POST", U1, "")).status).toBe(403);
  });
  test("a POST with the right token turns reminders off", async () => {
    const r = await run("POST", U1, await unsubToken(SECRET, U1));
    expect(r.status).toBe(200);
    expect(r.calls).toEqual([U1]);
  });
});

describe("send-reminders", () => {
  test("dry run when the key is missing: rows marked, nothing sent, an ops_health line", async () => {
    const f = fakeDb([cand(U1), cand(U2)]);
    const sent: Email[] = [];
    const s = await runReminders(f.db, cfg({ apiKey: undefined }), async (e) => void sent.push(e));
    expect(sent).toEqual([]);
    expect(s).toMatchObject({ due: 2, dry_run: 2, sent: 0 });
    expect([...f.rows.values()]).toEqual(["dry_run", "dry_run"]);
    expect(f.beats[0]).toContain("dry run");
  });
  test("two runs at the same time send exactly once per fan", async () => {
    const f = fakeDb([cand(U1), cand(U2)]);
    const sent: string[] = [];
    const send = async (e: Email) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(e.to);
    };
    const [a, b] = await Promise.all([
      runReminders(f.db, cfg(), send),
      runReminders(f.db, cfg(), send),
    ]);
    expect(sent.sort()).toEqual([cand(U1).email, cand(U2).email].sort());
    expect(a.sent + b.sent).toBe(2);
    expect(a.skipped + b.skipped).toBe(2);
  });
  test("a failed send is marked failed and not retried", async () => {
    const f = fakeDb([cand(U1)]);
    let tries = 0;
    const s = await runReminders(f.db, cfg(), async () => {
      tries++;
      throw new Error("resend 500");
    });
    expect(s.failed).toBe(1);
    expect(f.rows.get(`${U1}:2`)).toBe("failed");
    expect(f.failures).toEqual(["resend 500"]);
    await runReminders(f.db, cfg(), async () => void tries++);
    expect(tries).toBe(1); // the second run finds the claim and leaves it
  });
  test("with a key but no unsubscribe secret it refuses to send", async () => {
    const f = fakeDb([cand(U1)]);
    await expect(runReminders(f.db, cfg({ secret: "" }), async () => {})).rejects.toThrow(
      "REMINDER_UNSUB_SECRET",
    );
  });
});

describe("the email", () => {
  test("English: the lines, the button, the one-click unsubscribe headers", async () => {
    const e = await renderEmail(
      cand(U1, { league_name: "Office <Crew>", league_rank: 3, league_size: 8 }),
      cfg(),
      "Asia/Riyadh",
    );
    expect(e.subject).toBe("Picks close in 2 hours");
    expect(e.text).toContain("Night 2 starts at 19:30 Riyadh time.");
    expect(e.text).toContain("You haven't called 1 of tonight's 2 matches yet.");
    expect(e.text).toContain("You're #3 of 8 in Office <Crew>.");
    expect(e.html).toContain("Office &lt;Crew&gt;");
    expect(e.html).toContain('dir="ltr"');
    expect(e.html).toContain("https://app.example.test/picks");
    const t = await unsubToken(SECRET, U1);
    expect(e.headers["List-Unsubscribe"]).toBe(
      `<https://fn.example.test/functions/v1/reminder-unsubscribe?u=${U1}&t=${t}>`,
    );
    expect(e.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(e.text).toContain(`https://app.example.test/unsubscribe?u=${U1}&t=${t}`);
  });
  test("no league line before a rank", async () => {
    const e = await renderEmail(cand(U1), cfg(), "Asia/Riyadh");
    expect(e.text).not.toContain("You're #");
  });
  test("Arabic: right to left, Arabic words", async () => {
    const e = await renderEmail(cand(U1, { locale: "ar" }), cfg(), "Asia/Riyadh");
    expect(e.subject).toBe("تُغلق التوقعات بعد ساعتين");
    expect(e.html).toContain('dir="rtl"');
    expect(e.html).toContain('lang="ar"');
    expect(e.text).toContain("تبدأ الليلة 2 الساعة 19:30 بتوقيت الرياض.");
  });
});
