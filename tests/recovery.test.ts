import { describe, expect, it } from "vitest";
import { RECOVERY_RE, consumeRecoveryCode, newRecoveryCodes } from "../lib/recovery";

describe("Wiederherstellungscodes", () => {
  it("10 Codes, nur Hashes, jeder Code genau einmal", async () => {
    const { plain, hashes } = await newRecoveryCodes();
    expect(plain).toHaveLength(10);
    expect(new Set(plain).size).toBe(10);
    expect(plain.every((c) => RECOVERY_RE.test(c))).toBe(true);
    expect(hashes.join()).not.toContain(plain[0].replace("-", ""));
    const rest = await consumeRecoveryCode(hashes, plain[3].toLowerCase().replace("-", " "));
    expect(rest).toHaveLength(9);
    expect(await consumeRecoveryCode(rest!, plain[3])).toBeNull();
    expect(await consumeRecoveryCode(hashes, "AAAA-AAAA")).toBeNull();
  });
});
