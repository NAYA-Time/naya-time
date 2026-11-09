import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, totpCode, verifyTotp } from "../lib/totp";

describe("TOTP (RFC 6238 Testvektor)", () => {
  // RFC-6238-Schlüssel "12345678901234567890" (SHA-1), T=59 s → 94287082 (8 Ziffern) → 6 Ziffern: 287082
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("Base32 hin und zurück", () => expect(base32Decode(secret).toString()).toBe("12345678901234567890"));
  it("Code bei T=59 s", () => expect(totpCode(secret, 59_000)).toBe("287082"));
  it("Code bei T=1111111109 s", () => expect(totpCode(secret, 1111111109_000)).toBe("081804"));
  it("Toleranz ±30 s, aber nicht 90 s", () => {
    expect(verifyTotp(secret, "287082", 59_000 + 30_000)).toBe(true);
    expect(verifyTotp(secret, "287082", 59_000 + 90_000)).toBe(false);
  });
});
