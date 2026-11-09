// Prüfungen für den Dienstplan (reine Funktion). Ergebnis sind Hinweise, keine Sperren.
import { requiredBreakForWork } from "./session";

export interface PlanShift { id: string; employeeId: string; startAt: Date; endAt: Date; plannedBreakMinutes: number }
export interface PlanWarning { shiftId?: string; employeeId: string; code: "OVERLAP" | "REST" | "DAILY_MAX" | "BREAK" | "WEEK_OVER" | "WEEK_UNDER"; message: string }

const mins = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);
const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`;

export function checkPlan(shifts: PlanShift[], weeklyTarget: Map<string, number | null>, minRestMinutes = 660): PlanWarning[] {
  const out: PlanWarning[] = [];
  const byEmp = new Map<string, PlanShift[]>();
  for (const s of shifts) byEmp.set(s.employeeId, [...(byEmp.get(s.employeeId) ?? []), s]);
  for (const [emp, list] of byEmp) {
    list.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    let total = 0;
    list.forEach((s, i) => {
      const net = mins(s.startAt, s.endAt) - s.plannedBreakMinutes;
      total += net;
      if (net > 600) out.push({ shiftId: s.id, employeeId: emp, code: "DAILY_MAX", message: `Geplante Arbeitszeit ${hm(net)} Std. – mehr als 10 Stunden` });
      const req = requiredBreakForWork(net);
      if (s.plannedBreakMinutes < req) out.push({ shiftId: s.id, employeeId: emp, code: "BREAK", message: `Geplante Pause ${s.plannedBreakMinutes} Min., erforderlich ${req} Min.` });
      const next = list[i + 1];
      if (next) {
        if (next.startAt < s.endAt) out.push({ shiftId: next.id, employeeId: emp, code: "OVERLAP", message: "Doppelbelegung: überschneidet sich mit einem anderen Dienst" });
        else if (mins(s.endAt, next.startAt) < minRestMinutes) out.push({ shiftId: next.id, employeeId: emp, code: "REST", message: `Ruhezeit nur ${hm(mins(s.endAt, next.startAt))} Std. (vorgesehen ${hm(minRestMinutes)})` });
      }
    });
    const target = weeklyTarget.get(emp);
    if (target) {
      if (total > target + 60) out.push({ employeeId: emp, code: "WEEK_OVER", message: `Woche: ${hm(total)} geplant, Soll ${hm(target)}` });
      if (total < target - 60) out.push({ employeeId: emp, code: "WEEK_UNDER", message: `Woche: nur ${hm(total)} geplant, Soll ${hm(target)} – Unterplanung` });
    }
  }
  return out;
}
