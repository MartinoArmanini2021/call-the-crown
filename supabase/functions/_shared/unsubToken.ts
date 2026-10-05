// The reminder unsubscribe token (brief "bragging rights", Phase 5): HMAC-SHA256 over the user id with
// REMINDER_UNSUB_SECRET, base64url. Shared by send-reminders (puts it in each email) and
// reminder-unsubscribe (checks it). WebCrypto only, so the same file runs in Deno and in the Bun tests.

const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function unsubToken(secret: string, userId: string): Promise<string> {
  if (!secret) throw new Error("REMINDER_UNSUB_SECRET is not set");
  return b64url(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(userId)));
}

/** True only for the token this secret makes for this user id (compared in constant time). */
export async function checkUnsubToken(secret: string, userId: string, token: string): Promise<boolean> {
  if (!secret || !userId || !token) return false;
  const want = await unsubToken(secret, userId);
  if (want.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
