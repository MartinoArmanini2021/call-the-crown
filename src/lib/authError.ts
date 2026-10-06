import type { StringKey } from "@/i18n/strings";

// The sentence the sign-in screen shows for a GoTrue error message.
export function authErrorKey(msg: string): StringKey {
  const m = msg.toLowerCase();
  // A missing, expired or reused Turnstile token, refused by the server (server-side captcha)
  if (m.includes("captcha")) return "captcha_needed";
  if (m.includes("signups not allowed") || m.includes("user not found")) return "no_account";
  // "For security purposes, you can only request this after N seconds." is the resend throttle.
  if (m.includes("rate") || m.includes("too many") || m.includes("security purposes"))
    return "too_many_requests";
  // An address that never entered its code has no password yet (0013): the code path proves it.
  if (m.includes("invalid login credentials") || m.includes("not confirmed"))
    return "wrong_password";
  if (m.includes("weak") || m.includes("pwned") || m.includes("known")) return "password_weak";
  if (m.includes("expired") || m.includes("invalid")) return "code_wrong";
  return "err_generic";
}
