import { describe, expect, it } from "vitest";
import { asFilter, mainKey, matchesEmp, matchesFilter } from "@/lib/dept";

const kueche = { key: "KUECHE", kind: "MAIN" };
const sushi = { key: "SUSHI", kind: "SUB", parent: { key: "KUECHE" } };
const spuele = { key: "SPUELE", kind: "MAIN" };
const leitung = { key: "LEITUNG", kind: "SUB", parent: { key: "BUERO" } };

describe("Bereiche und Reiter", () => {
  it("ordnet Unterabteilungen ihrem Bereich zu", () => {
    expect(mainKey(sushi)).toBe("KUECHE");
    expect(mainKey(leitung)).toBe("BUERO");
    expect(mainKey(null)).toBeNull();
  });
  it("filtert nach Bereich", () => {
    expect(matchesFilter("KUECHE", sushi)).toBe(true);
    expect(matchesFilter("SPUELE", kueche)).toBe(false);
    expect(matchesFilter("AUSHILFEN", kueche)).toBe(false);
    expect(matchesFilter("ALL", null)).toBe(true);
  });
  it("Reiter Aushilfen nimmt Aushilfen aus allen Bereichen, Externe und Feste nicht", () => {
    expect(matchesEmp("AUSHILFEN", { employmentType: "MINIJOB", primaryDept: kueche })).toBe(true);
    expect(matchesEmp("AUSHILFEN", { employmentType: "KURZFRISTIG", primaryDept: leitung })).toBe(true);
    expect(matchesEmp("AUSHILFEN", { employmentType: "EXTERN", primaryDept: spuele })).toBe(false);
    expect(matchesEmp("AUSHILFEN", { employmentType: "FESTANGESTELLT", primaryDept: kueche })).toBe(false);
    expect(matchesEmp("SPUELE", { employmentType: "EXTERN", primaryDept: spuele })).toBe(true);
    expect(matchesEmp("KUECHE", { employmentType: "MINIJOB", primaryDept: sushi })).toBe(true);
    expect(matchesEmp("BUERO", { employmentType: "FESTANGESTELLT", primaryDept: leitung })).toBe(true);
  });
  it("unbekannte Reiter fallen auf Alle zurück", () => {
    expect(asFilter("SPUELE")).toBe("SPUELE");
    expect(asFilter("xyz")).toBe("ALL");
  });
});
