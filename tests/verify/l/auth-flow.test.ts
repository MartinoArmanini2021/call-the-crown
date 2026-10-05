// Section L1–L3 on the REAL local stack: GoTrue's email-code flow, captcha, enumeration.
//   L_LIVE=1 bun test tests/verify/l/auth-flow.test.ts
// Skipped unless L_LIVE=1 (it needs `supabase start`, sends ~10 mails to Mailpit and uses ~10 of the
// shared per-IP verify budget). Users are l-<tag>-<run>@example.test and are deleted in afterAll.
// Tests marked [BUG]/[SECURITY] FAIL today on purpose; [OK] and [SMELL] pass and document behaviour.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(30_000);
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE, addr, appAuthError, cleanup, client, codes, nextCode, sleep, sql } from "./_live";

const config = readFileSync(
  join(import.meta.dir, "..", "..", "..", "supabase", "config.toml"),
  "utf8",
);
const ATTACKER_PW = "attacker-pass-123";

describe.if(LIVE)("L1–L3 email-code flow on the local GoTrue", () => {
  afterAll(cleanup);

  // A stranger signs up somebody else's address through the public API, with a password and a name,
  // and with NO captcha token.
  const victim = addr("victim");
  let signUp: Awaited<ReturnType<ReturnType<typeof client>["auth"]["signUp"]>>;

  test("setup: raw signUp(email, password, data) with no captcha token", async () => {
    signUp = await client().auth.signUp({
      email: victim,
      password: ATTACKER_PW,
      options: { data: { display_name: "Admin", locale: "en" } },
    });
    // recorded for the report
    console.log(
      "signUp without captcha →",
      signUp.error?.message ?? "accepted",
      "| session:",
      !!signUp.data.session,
    );
  });

  test("[SECURITY L2] the server refuses a sign-up that carries no captcha token", () => {
    // FAILS today: GOTRUE_SECURITY_CAPTCHA_ENABLED=false locally and config.toml has no [auth.captcha]
    // in the base block or in [remotes.staging.auth]; the Turnstile widget is UI-only.
    expect(signUp.error?.message ?? "").toMatch(/captcha/i);
  });

  test("[SECURITY L2] config.toml enables server-side captcha (base or remotes.staging)", () => {
    // FAILS today: no [auth.captcha] / [remotes.staging.auth.captcha] block anywhere.
    expect(config).toMatch(/\[(remotes\.staging\.)?auth\.captcha\][^[]*enabled\s*=\s*true/);
  });

  test("[OK F-01] signUp returns no session, and the password cannot sign in before proof", async () => {
    expect(signUp.data.session).toBeNull();
    const r = await client().auth.signInWithPassword({ email: victim, password: ATTACKER_PW });
    expect(r.data.session).toBeNull();
    expect(r.error?.message).toMatch(/not confirmed/i);
  });

  test("[OK F-02 consents] the unproven account starts with both consents NOT granted", async () => {
    const rows =
      await sql`select c.party, c.granted from public.consents c join auth.users u on u.id = c.user_id
                            where u.email = ${victim}`;
    expect(rows.length).toBe(2);
    expect(rows.every((r: { granted: boolean }) => !r.granted)).toBe(true);
  });

  test("[BUG F-02 name] an unproven sign-up cannot plant a display name", async () => {
    // FAILS today: handle_new_user (0013:27) still copies raw_user_meta_data.display_name, so the
    // stranger's "Admin" is the account's name before (and, via Sign in → Forgot password, after)
    // the owner proves the address. Unconfirmed accounts are also ranked and listed on the board.
    const [p] =
      await sql`select p.display_name from public.profiles p join auth.users u on u.id = p.user_id
                           where u.email = ${victim}`;
    expect(p.display_name).toBeNull();
  });

  // The real owner arrives later and uses Sign in → "Forgot your password?" (signInWithOtp with
  // shouldCreateUser false), the path that never calls update_profile.
  let ownerCode = "";
  test("[OK no_password_before_proof] proof by code wipes the stranger's password", async () => {
    const before = (await codes(victim)).length;
    const otp = await client().auth.signInWithOtp({
      email: victim,
      options: { shouldCreateUser: false },
    });
    expect(otp.error).toBeNull();
    ownerCode = await nextCode(victim, before);
    const c = client();
    const v = await c.auth.verifyOtp({ email: victim, token: ownerCode, type: "email" });
    expect(v.error).toBeNull();
    expect(v.data.session).not.toBeNull();
    const [u] =
      await sql`select encrypted_password, email_confirmed_at from auth.users where email = ${victim}`;
    expect(u.email_confirmed_at).not.toBeNull();
    expect(u.encrypted_password).toBe("");
    const r = await client().auth.signInWithPassword({ email: victim, password: ATTACKER_PW });
    expect(r.data.session).toBeNull();
    expect(r.error?.message).toMatch(/invalid login credentials/i);
  });

  test("[BUG F-02 name] after the owner's proof via Sign in → Forgot password, the planted name is gone", async () => {
    // FAILS today: the sign-in path does not call update_profile, so "Admin" stays on the owner's account.
    const [p] =
      await sql`select p.display_name from public.profiles p join auth.users u on u.id = p.user_id
                           where u.email = ${victim}`;
    expect(p.display_name).not.toBe("Admin");
  });

  test("[OK] a used code cannot be used again", async () => {
    const v = await client().auth.verifyOtp({ email: victim, token: ownerCode, type: "email" });
    expect(v.data.session).toBeNull();
    expect(v.error?.message).toMatch(/expired or is invalid/i);
  });

  test("[OK] anonymous sign-in is off (no session without an email)", async () => {
    const r = await client().auth.signInAnonymously();
    expect(r.data.session).toBeNull();
  });

  // The app's Join (signInWithOtp, shouldCreateUser true) for a new address.
  const joiner = addr("joiner");
  test("[OK] an older code stops working once a newer one is sent", async () => {
    let n = (await codes(joiner)).length;
    expect(
      (await client().auth.signInWithOtp({ email: joiner, options: { shouldCreateUser: true } }))
        .error,
    ).toBeNull();
    const first = await nextCode(joiner, n);
    await sleep(1500); // local max_frequency is the CLI default 1s
    n = (await codes(joiner)).length;
    expect(
      (await client().auth.signInWithOtp({ email: joiner, options: { shouldCreateUser: true } }))
        .error,
    ).toBeNull();
    const second = await nextCode(joiner, n);
    if (first === second) return; // 1 in a million: nothing to prove
    const old = await client().auth.verifyOtp({ email: joiner, token: first, type: "email" });
    expect(old.data.session).toBeNull();
    const fresh = await client().auth.verifyOtp({ email: joiner, token: second, type: "email" });
    expect(fresh.error).toBeNull();
  });

  test("[OK] expiry: a code older than otp_expiry (600 s) is refused; at 9 minutes it still works", async () => {
    // We cannot wait 10 minutes: the test backdates its OWN user's confirmation_sent_at, which is the
    // timestamp GoTrue checks a sign-up/confirmation code against.
    const who = addr("expiry");
    const before = (await codes(who)).length;
    await client().auth.signInWithOtp({ email: who, options: { shouldCreateUser: true } });
    const code = await nextCode(who, before);
    await sql`update auth.users set confirmation_sent_at = now() - interval '11 minutes' where email = ${who}`;
    const late = await client().auth.verifyOtp({ email: who, token: code, type: "email" });
    expect(late.data.session).toBeNull();
    expect(late.error?.message).toMatch(/expired/i);
    await sql`update auth.users set confirmation_sent_at = now() - interval '9 minutes' where email = ${who}`;
    const inTime = await client().auth.verifyOtp({ email: who, token: code, type: "email" });
    expect(inTime.error).toBeNull();
  });

  let resendMsg = "";
  let resendCode = "";
  test("resend throttling: a second code request inside max_frequency is refused", async () => {
    const who = addr("resend");
    await client().auth.signInWithOtp({ email: who, options: { shouldCreateUser: true } });
    const again = await client().auth.signInWithOtp({
      email: who,
      options: { shouldCreateUser: true },
    });
    resendMsg = again.error?.message ?? "";
    resendCode = (again.error as { code?: string } | null)?.code ?? "";
    console.log(
      "resend inside max_frequency →",
      again.error?.status,
      resendCode,
      JSON.stringify(resendMsg),
    );
    expect(again.error?.status).toBe(429);
  });

  test("[BUG] the sign-in screen shows 'too many requests' for the resend throttle", () => {
    // FAILS today: GoTrue says "For security purposes, you can only request this after N seconds."
    // (code over_email_send_rate_limit); authError (sign-in.tsx:54-64) matches only "rate"/"too many"
    // in the message, so the fan sees err_generic "Something went wrong".
    expect(appAuthError()(resendMsg)).toBe("too_many_requests");
  });

  test("[SMELL] max_frequency (resend interval) is not pinned in config.toml", () => {
    // Documents: local runs on the CLI default (GOTRUE_SMTP_MAX_FREQUENCY=1s); hosted default is 60s.
    expect(/max_frequency/.test(config)).toBe(false);
  });

  test("[SMELL] five wrong codes do not lock the code: the right one still works", async () => {
    const who = addr("guess");
    const before = (await codes(who)).length;
    await client().auth.signInWithOtp({ email: who, options: { shouldCreateUser: true } });
    const right = await nextCode(who, before);
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const wrong = String((Number(right) + 1 + i) % 1_000_000).padStart(6, "0");
      const v = await client().auth.verifyOtp({ email: who, token: wrong, type: "email" });
      msgs.push(`${v.error?.status} ${v.error?.message}`);
    }
    console.log("5 wrong codes →", [...new Set(msgs)]);
    const ok = await client().auth.verifyOtp({ email: who, token: right, type: "email" });
    expect(ok.error).toBeNull(); // no per-code / per-account lockout; only the per-IP verify limiter
  });

  test("[SMELL L3] 'no_account' tells a stranger whether an address is registered", async () => {
    const unknown = await client().auth.signInWithOtp({
      email: addr("nobody"),
      options: { shouldCreateUser: false },
    });
    await sleep(1100);
    const known = await client().auth.signInWithOtp({
      email: joiner,
      options: { shouldCreateUser: false },
    });
    const map = appAuthError();
    console.log(
      "unknown →",
      unknown.error?.status,
      unknown.error?.message,
      "→",
      map(unknown.error?.message ?? ""),
    );
    console.log("known   →", known.error?.status ?? 200, known.error?.message ?? "(code sent)");
    expect(map(unknown.error?.message ?? "")).toBe("no_account");
    expect(known.error).toBeNull();
  });

  test("[info S-15] other enumeration surfaces: /recover, raw signUp on a known address, wrong password", async () => {
    const rUnknown = await client().auth.resetPasswordForEmail(addr("nobody2"));
    await sleep(1100);
    const rKnown = await client().auth.resetPasswordForEmail(joiner);
    const suKnown = await client().auth.signUp({ email: joiner, password: "whatever-123" });
    const pwUnknown = await client().auth.signInWithPassword({
      email: addr("nobody3"),
      password: "x-123456",
    });
    const pwKnown = await client().auth.signInWithPassword({ email: joiner, password: "x-123456" });
    const out = {
      recover_unknown: rUnknown.error
        ? `${rUnknown.error.status} ${rUnknown.error.message}`
        : "200",
      recover_known: rKnown.error ? `${rKnown.error.status} ${rKnown.error.message}` : "200",
      signup_known_confirmed: suKnown.error
        ? `${suKnown.error.status} ${suKnown.error.message}`
        : `200 fake user? identities=${suKnown.data.user?.identities?.length}`,
      password_unknown: pwUnknown.error?.message,
      password_known_wrong: pwKnown.error?.message,
    };
    console.log(out);
    expect(out.password_unknown).toBe(out.password_known_wrong);
  });
});
