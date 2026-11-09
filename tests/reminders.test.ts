import { describe, expect, it } from "vitest";
import { addMonths, reminderStatus, terminalNotice } from "../lib/calc/reminders";

describe("Fristen", () => {
  it("Status nach Vorlauf", () => {
    const r = { dueDate: "2026-12-01", remindDaysBefore: 30, done: false };
    expect(reminderStatus(r, "2026-10-31")).toBe("LATER");
    expect(reminderStatus(r, "2026-11-01")).toBe("DUE_SOON");
    expect(reminderStatus(r, "2026-12-02")).toBe("OVERDUE");
    expect(reminderStatus({ ...r, done: true }, "2026-12-02")).toBe("DONE");
  });
  it("Text für das Terminal", () => {
    expect(terminalNotice({ kind: "IFSG", title: "x", dueDate: "2026-12-01", terminalText: null })).toBe("Deine Belehrung nach Infektionsschutzgesetz ist am 01.12.2026 fällig. Bitte Termin mit der Leitung machen.");
    expect(terminalNotice({ kind: "OTHER", title: "Schlüssel abgeben", dueDate: "2026-12-01", terminalText: "" })).toContain("Schlüssel abgeben (bis 01.12.2026)");
    expect(terminalNotice({ kind: "IFSG", title: "x", dueDate: "2026-12-01", terminalText: "Eigener Text {date}" })).toBe("Eigener Text 01.12.2026");
  });
  it("Wiederholung in Monaten", () => expect(addMonths("2026-11-09", 24)).toBe("2028-11-09"));
});
