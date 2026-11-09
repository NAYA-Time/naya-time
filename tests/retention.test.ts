import { describe, expect, it } from "vitest";
import { isDeletable, retentionFor } from "../lib/calc/retention";

describe("Aufbewahrung", () => {
  it("2 Jahre ab Jahresende des Austritts", () => {
    const r = retentionFor({ exitDate: "2026-03-15", lastActivity: "2026-03-14", createdAt: "2024-01-01", hasPayroll: false });
    expect(r.deletableFrom).toBe("2029-01-01");
    expect(isDeletable(r, "2028-12-31")).toBe(false);
    expect(isDeletable(r, "2029-01-01")).toBe(true);
  });
  it("6 Jahre bei Lohnabrechnung über das System", () => {
    expect(retentionFor({ exitDate: "2026-03-15", lastActivity: null, createdAt: "2025-01-01", hasPayroll: true }).deletableFrom).toBe("2033-01-01");
  });
  it("späteste Buchung zählt, auch nach dem Austrittsdatum", () => {
    expect(retentionFor({ exitDate: "2026-12-31", lastActivity: "2027-01-02", createdAt: "2025-01-01", hasPayroll: false }).deletableFrom).toBe("2030-01-01");
  });
  it("ohne Austrittsdatum: letzte Buchung", () => {
    expect(retentionFor({ exitDate: null, lastActivity: "2025-06-01", createdAt: "2024-01-01", hasPayroll: false }).reference).toBe("2025-06-01");
  });
});
describe("Aufbewahrung Bezugsdatum", () => {
  it("Anlagedatum zählt nur ohne Austritt und Buchungen", () => {
    expect(retentionFor({ exitDate: "2023-05-31", lastActivity: null, createdAt: "2026-11-09", hasPayroll: false }).deletableFrom).toBe("2026-01-01");
    expect(retentionFor({ exitDate: null, lastActivity: null, createdAt: "2026-11-09", hasPayroll: false }).deletableFrom).toBe("2029-01-01");
  });
});
