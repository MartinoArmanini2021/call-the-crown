// send-reminders, the logic (brief "bragging rights", Phase 5). Plain TypeScript with the database and
// the mail provider passed in, so the Bun tests run it with fakes and index.ts runs it in Deno.
//   - candidates come from public.reminder_candidates() (who opted in, which night, how many open);
//   - each fan is CLAIMED (claim_reminder: insert … on conflict do nothing) before anything is sent, so
//     two runs at once send once; a failed send is marked failed with an ops alert and never retried;
//   - without RESEND_API_KEY it is a dry run: rows marked dry_run, an ops_health line, nothing sent.
// The email is plain and text-first, in the fan's language; Arabic is dir="rtl".
import { unsubToken } from "../_shared/unsubToken.ts";

export type Candidate = {
  user_id: string;
  email: string;
  locale: string;
  night_no: number;
  first_start: string;
  open_count: number;
  total_count: number;
  league_name: string | null;
  league_rank: number | null;
  league_size: number | null;
};

export type RemindersDb = {
  candidates: () => Promise<Candidate[]>;
  timezone: () => Promise<string>;
  claim: (userId: string, night: number, dryRun: boolean) => Promise<boolean>;
  failed: (userId: string, night: number, detail: string) => Promise<void>;
  heartbeat: (ok: boolean, detail: string) => Promise<void>;
};

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};
export type Send = (email: Email) => Promise<void>;

export type Config = {
  apiKey: string | undefined;
  /** the same sender as the sign-in emails */
  from: string;
  /** the app, for the Make my picks button and the unsubscribe page */
  appUrl: string;
  /** the functions base URL, for the one-click List-Unsubscribe header */
  functionsUrl: string;
  secret: string;
};

const COPY = {
  en: {
    subject: "Picks close in 2 hours",
    line1: "Night {night} starts at {time} Riyadh time.",
    line2: "You haven't called {open} of tonight's {total} matches yet.",
    button: "Make my picks",
    league: "You're #{rank} of {n} in {league}.",
    footer: "You're getting this because you asked for reminders. Turn them off: {unsub}",
  },
  ar: {
    subject: "تُغلق التوقعات بعد ساعتين",
    line1: "تبدأ الليلة {night} الساعة {time} بتوقيت الرياض.",
    line2: "لم تتوقع بعد {open} من مباريات الليلة الـ{total}.",
    button: "سجّل توقعاتي",
    league: "أنت في المركز {rank} من {n} في {league}.",
    footer: "تصلك هذه الرسالة لأنك طلبت التذكير. لإيقافه: {unsub}",
  },
} as const;

const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The email for one fan and one night. */
export async function renderEmail(c: Candidate, cfg: Config, timezone: string): Promise<Email> {
  const ar = c.locale === "ar";
  const copy = COPY[ar ? "ar" : "en"];
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(c.first_start));
  const token = await unsubToken(cfg.secret, c.user_id);
  const q = `u=${encodeURIComponent(c.user_id)}&t=${encodeURIComponent(token)}`;
  const app = cfg.appUrl.replace(/\/+$/, "");
  const unsubPage = `${app}/unsubscribe?${q}`;
  const oneClick = `${cfg.functionsUrl.replace(/\/+$/, "")}/reminder-unsubscribe?${q}`;
  const picks = `${app}/picks`;
  const line1 = fill(copy.line1, { night: c.night_no, time });
  const line2 = fill(copy.line2, { open: c.open_count, total: c.total_count });
  const league =
    c.league_name && c.league_rank && c.league_size
      ? fill(copy.league, { rank: c.league_rank, n: c.league_size, league: c.league_name })
      : null;
  const text = [
    line1,
    line2,
    league,
    "",
    `${copy.button}: ${picks}`,
    "",
    fill(copy.footer, { unsub: unsubPage }),
  ]
    .filter((l) => l !== null)
    .join("\n");
  const dir = ar ? "rtl" : "ltr";
  const lang = ar ? "ar" : "en";
  const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(copy.subject)}</title></head>
<body dir="${dir}" style="margin:0;padding:24px;max-width:560px;overflow-wrap:anywhere;word-break:break-word;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.5;color:#111;background:#fff">
${p(esc(line1))}
${p(esc(line2))}
${league ? p(esc(league)) : ""}
<p style="margin:20px 0"><a href="${esc(picks)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#f2c14e;color:#111;font-weight:700;text-decoration:none">${esc(copy.button)}</a></p>
<p style="margin:24px 0 0;font-size:13px;color:#555;overflow-wrap:anywhere;word-break:break-all">${esc(fill(copy.footer, { unsub: "" }))}<a href="${esc(unsubPage)}" style="color:#555">${esc(unsubPage)}</a></p>
</body>
</html>
`;
  return {
    to: c.email,
    subject: copy.subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export type Summary = { due: number; sent: number; failed: number; dry_run: number; skipped: number };

/** One run: every due fan claimed once, then sent (or, with no key, marked as a dry run). */
export async function runReminders(db: RemindersDb, cfg: Config, send: Send): Promise<Summary> {
  const due = await db.candidates();
  const out: Summary = { due: due.length, sent: 0, failed: 0, dry_run: 0, skipped: 0 };
  if (!cfg.apiKey) {
    for (const c of due) {
      if (await db.claim(c.user_id, c.night_no, true)) out.dry_run++;
      else out.skipped++;
    }
    await db.heartbeat(true, `dry run (RESEND_API_KEY not set): ${out.dry_run} marked, nothing sent`);
    return out;
  }
  if (!cfg.from || !cfg.appUrl || !cfg.secret)
    throw new Error("REMINDER_FROM, PUBLIC_APP_URL and REMINDER_UNSUB_SECRET must all be set");
  const timezone = await db.timezone();
  for (const c of due) {
    if (!(await db.claim(c.user_id, c.night_no, false))) {
      out.skipped++; // another run has it
      continue;
    }
    try {
      await send(await renderEmail(c, cfg, timezone));
      out.sent++;
    } catch (e) {
      out.failed++;
      await db.failed(c.user_id, c.night_no, e instanceof Error ? e.message : String(e));
    }
  }
  await db.heartbeat(out.failed === 0, `sent ${out.sent}, failed ${out.failed}, skipped ${out.skipped}`);
  return out;
}

/** Resend's REST API. */
export function resendSender(apiKey: string, from: string): Send {
  return async (email) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}
