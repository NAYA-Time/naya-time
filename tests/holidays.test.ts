import { describe, expect, it } from "vitest";
import { hamburgHolidays, holidayName } from "../lib/holidays";

describe("Feiertage Hamburg", () => {
  it("2026: Ostern 5. April → Karfreitag 3.4., Pfingstmontag 25.5.", () => {
    expect(holidayName("2026-04-03")).toBe("Karfreitag");
    expect(holidayName("2026-05-25")).toBe("Pfingstmontag");
    expect(holidayName("2026-05-14")).toBe("Christi Himmelfahrt");
    expect(holidayName("2026-10-31")).toBe("Reformationstag");
    expect(hamburgHolidays(2026).size).toBe(10);
  });
  it("2027: Ostern 28. März", () => expect(holidayName("2027-03-29")).toBe("Ostermontag"));
});
