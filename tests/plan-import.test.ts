// Dienstplan-Foto: Zuordnung und Prüfung, mit Gunnars zwei echten Plänen (von Hand abgeschrieben, so wie die Bilderkennung sie liefern soll).
import { describe, expect, it } from "vitest";
import kueche from "./fixtures/plan-photo/kueche-2026-11-02.json";
import service from "./fixtures/plan-photo/service-2026-11-09.json";
import { buildProposal, matchEmployee, normTime, shiftsToSave, type ExtractedPlan, type PlanEmployee } from "../lib/calc/plan-import";

const e = (id: string, firstName: string, lastName: string, displayName = `${firstName} ${lastName[0]}.`): PlanEmployee => ({ id, firstName, lastName, displayName });
const team = [e("1", "Azis", "Rahimi"), e("2", "Alban", "Krasniqi"), e("3", "Schahram", "Nouri"), e("4", "Danylo", "Koval"), e("5", "Ali", "Demir"), e("6", "Hiroyuki", "Sato"), e("7", "Daniel", "Bober"), e("8", "Ayşe", "Yılmaz"), e("9", "Tom", "Becker"), e("10", "Tom", "Fischer")];

describe("Dienstplan-Foto", () => {
  it("Uhrzeiten in verschiedenen Schreibweisen", () => {
    expect(["13:30", "13.30", "1330", "9", "9 Uhr", "18h00"].map(normTime)).toEqual(["13:30", "13:30", "13:30", "09:00", "09:00", "18:00"]);
    expect(normTime("FREI")).toBeNull();
    expect(normTime("25:00")).toBeNull();
  });
  it("Namen: Akzente egal, mehrdeutig wird nicht geraten", () => {
    expect(matchEmployee("ayse", team).id).toBe("8");
    expect(matchEmployee("Tom", team).id).toBeNull();
    expect(matchEmployee("Tom", team).note).toContain("Mehrdeutig");
    expect(matchEmployee("Tom F", team).id).toBe("10");
    expect(matchEmployee("Nouri", team).id).toBe("3");
    expect(matchEmployee("Unbekannt", team).id).toBeNull();
  });
  it("Küchenplan 02.–08.11.: 30 Dienste, Urlaub nicht als Dienst", () => {
    const p = buildProposal(kueche as ExtractedPlan, team, "2026-11-09", new Map());
    expect(p.monday).toBe("2026-11-02");
    expect(p.notes[0]).toContain("02.11.2026");
    expect(p.rows.every((r) => r.employeeId)).toBe(true);
    const save = shiftsToSave(p.rows);
    expect(save).toHaveLength(30);
    expect(save.filter((s) => s.employeeId === "7")).toHaveLength(0); // Daniel: Urlaub
    expect(p.rows.find((r) => r.name === "Daniel")!.cells.slice(0, 5).every((c) => c.kind === "VACATION")).toBe(true);
    expect(save.find((s) => s.employeeId === "1" && s.date === "2026-11-07")).toMatchObject({ start: "11:30", end: null });
  });
  it("Servicplan 09.–15.11.: unbekannte Namen werden markiert, nicht übernommen", () => {
    const p = buildProposal(service as ExtractedPlan, team, "2026-11-09", new Map());
    expect(p.notes).toHaveLength(0);
    expect(p.rows.filter((r) => !r.employeeId)).toHaveLength(9); // niemand aus dem Service im Testteam
    expect(shiftsToSave(p.rows)).toHaveLength(0);
    // nach Zuordnung im Backoffice: 30 Dienste
    const rows = p.rows.map((r, i) => ({ ...r, employeeId: `s${i}` }));
    expect(shiftsToSave(rows)).toHaveLength(30);
  });
  it("Vorhandene Dienste werden angezeigt; Dienst ohne lesbare Zeit wird „unklar“", () => {
    const plan: ExtractedPlan = { weekStart: null, department: null, rows: [{ name: "Azis", days: [{ weekday: 1, date: null, kind: "WORK", start: "1?:30", end: null, raw: "1?:30" }] }] };
    const p = buildProposal(plan, team, "2026-11-09", new Map([["1|2026-11-09", "15:00–23:30"]]));
    expect(p.notes[0]).toContain("kein Datum");
    expect(p.rows[0].cells[0]).toMatchObject({ kind: "UNCLEAR", existing: "15:00–23:30" });
    expect(shiftsToSave(p.rows)).toHaveLength(0);
  });
});
