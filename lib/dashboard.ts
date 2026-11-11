import { prisma } from "./db";
import { DeptFilter, mainKey, matchesEmp } from "./dept";
import { berlinDate, berlinTime, dbDate, minutesBetween } from "./time";

export type LiveStatus = "PRESENT" | "BREAK" | "DONE" | "LATE" | "EXPECTED" | "SICK" | "VACATION" | "ABSENT_OTHER" | "UNPLANNED";

export interface LiveRow {
  employeeId: string; name: string; dept: string; planned: string | null; clockIn: string | null; clockOut: string | null;
  status: LiveStatus; lateMinutes: number; photoMissing: boolean; photos: { id: string; label: string; time: string }[];
}

const deptInclude = { include: { parent: { select: { key: true } } } } as const;

export async function todayOverview(filter: DeptFilter, lateTolerance = 5) {
  const now = new Date();
  const today = dbDate(berlinDate(now));
  const [shifts, sessions, absences, findings] = await Promise.all([
    prisma.scheduledShift.findMany({
      where: { workDate: today, deletedAt: null, kind: "WORK", employee: { active: true } },
      include: { employee: { include: { primaryDept: deptInclude } }, department: deptInclude },
      orderBy: { startAt: "asc" },
    }),
    prisma.workSession.findMany({
      where: { OR: [{ workDate: today }, { status: "OPEN" }] },
      include: { employee: { include: { primaryDept: deptInclude } }, department: deptInclude, clockInEvent: { include: { photo: { select: { deletedAt: true } } } }, clockOutEvent: { include: { photo: { select: { deletedAt: true } } } }, breaks: true },
    }),
    prisma.absence.findMany({ where: { status: { not: "CANCELLED" }, startDate: { lte: today }, endDate: { gte: today } }, include: { employee: { include: { primaryDept: deptInclude } } } }),
    prisma.complianceFinding.findMany({
      where: { status: "OPEN", workDate: { gte: dbDate(berlinDate(new Date(now.getTime() - 7 * 86400000))) } },
      include: { employee: { include: { primaryDept: deptInclude } } }, orderBy: { createdAt: "desc" }, take: 50,
    }),
  ]);

  const rows = new Map<string, LiveRow>();
  const absentBy = new Map(absences.map((a) => [a.employeeId, a]));

  for (const s of shifts) {
    if (!matchesEmp(filter, s.employee, s.department)) continue;
    const ab = absentBy.get(s.employeeId);
    const status: LiveStatus = ab ? (ab.type === "SICK" || ab.type === "SICK_CHILD" ? "SICK" : ab.type === "VACATION" ? "VACATION" : "ABSENT_OTHER")
      : now > new Date(s.startAt!.getTime() + lateTolerance * 60000) ? "LATE" : "EXPECTED";
    rows.set(s.employeeId, {
      employeeId: s.employeeId, name: `${s.employee.firstName} ${s.employee.lastName}`, dept: s.department.name,
      planned: `${berlinTime(s.startAt!)}–${s.endAt ? berlinTime(s.endAt) : ""}`, clockIn: null, clockOut: null, status,
      lateMinutes: status === "LATE" ? minutesBetween(s.startAt!, now) : 0, photoMissing: false, photos: [],
    });
  }
  for (const w of sessions) {
    if (!matchesEmp(filter, w.employee, w.department)) continue;
    const openBreak = w.breaks.some((b) => b.startAt && !b.endAt);
    const r: LiveRow = rows.get(w.employeeId) ?? {
      employeeId: w.employeeId, name: `${w.employee.firstName} ${w.employee.lastName}`, dept: w.department.name,
      planned: null, clockIn: null, clockOut: null, status: "UNPLANNED", lateMinutes: 0, photoMissing: false, photos: [],
    };
    r.clockIn = w.clockInEvent ? berlinTime(w.clockInEvent.effectiveAt) : w.effectiveStartAt ? berlinTime(w.effectiveStartAt) : null;
    r.clockOut = w.clockOutEvent ? berlinTime(w.clockOutEvent.effectiveAt) : null;
    r.status = w.status === "OPEN" ? (openBreak ? "BREAK" : "PRESENT") : "DONE";
    r.lateMinutes = w.lateMinutes;
    r.photoMissing = w.clockInEvent?.photoStatus === "MISSING_TECHNICAL" || w.clockOutEvent?.photoStatus === "MISSING_TECHNICAL";
    r.photos = ([["Kommen", w.clockInEvent], ["Gehen", w.clockOutEvent]] as const).flatMap(([label, e]) => (e?.photo && !e.photo.deletedAt ? [{ id: e.id, label, time: berlinTime(e.effectiveAt) }] : []));
    rows.set(w.employeeId, r);
  }
  for (const a of absences) {
    if (rows.has(a.employeeId) || !matchesEmp(filter, a.employee)) continue;
    rows.set(a.employeeId, {
      employeeId: a.employeeId, name: `${a.employee.firstName} ${a.employee.lastName}`, dept: a.employee.primaryDept.name, planned: null, clockIn: null, clockOut: null,
      status: a.type === "SICK" || a.type === "SICK_CHILD" ? "SICK" : a.type === "VACATION" ? "VACATION" : "ABSENT_OTHER", lateMinutes: 0, photoMissing: false, photos: [],
    });
  }

  const list = [...rows.values()];
  const count = (...s: LiveStatus[]) => list.filter((r) => s.includes(r.status)).length;
  return {
    stats: {
      planned: shifts.filter((s) => matchesEmp(filter, s.employee, s.department)).length,
      present: count("PRESENT", "BREAK", "UNPLANNED") - list.filter((r) => r.status === "UNPLANNED" && r.clockOut).length,
      done: count("DONE"), late: list.filter((r) => r.lateMinutes > lateTolerance).length, notYet: count("LATE"),
      sick: count("SICK"), vacation: count("VACATION"),
    },
    rows: list,
    findings: findings.filter((f) => matchesEmp(filter, f.employee)).map((f) => ({
      id: f.id, code: f.code, severity: f.severity, isLegal: f.isLegal, message: f.message, name: `${f.employee.firstName} ${f.employee.lastName}`,
      date: f.workDate, dept: mainKey(f.employee.primaryDept),
    })),
  };
}
