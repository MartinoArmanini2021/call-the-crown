import { describe, expect, test } from "bun:test";
import { authErrorKey } from "../src/lib/authError";

// The sign-in screen's sentence for each GoTrue error message (messages as GoTrue sends them).
describe("sign-in error sentences", () => {
  test("the resend throttle says 'too many attempts', not 'something went wrong'", () => {
    // over_email_send_rate_limit (429), sent when a code is asked for again inside max_frequency
    expect(authErrorKey("For security purposes, you can only request this after 42 seconds.")).toBe(
      "too_many_requests",
    );
  });
  test("the other limits keep their sentences", () => {
    expect(authErrorKey("Email rate limit exceeded")).toBe("too_many_requests");
    expect(authErrorKey("Request rate limit reached")).toBe("too_many_requests");
    expect(authErrorKey("Too many requests")).toBe("too_many_requests");
  });
  test("each known answer maps to its sentence", () => {
    expect(authErrorKey("Signups not allowed for otp")).toBe("no_account");
    expect(authErrorKey("Invalid login credentials")).toBe("wrong_password");
    expect(authErrorKey("Email not confirmed")).toBe("wrong_password");
    expect(authErrorKey("Password is known to be weak and easy to guess")).toBe("password_weak");
    expect(authErrorKey("Token has expired or is invalid")).toBe("code_wrong");
    expect(authErrorKey("Database error saving new user")).toBe("err_generic");
  });
});
