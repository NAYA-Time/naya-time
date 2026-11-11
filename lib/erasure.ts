// Endgültiges Löschen ehemaliger Mitarbeiter nach Ablauf der Aufbewahrungsfrist – nur von Hand durch den Inhaber.
import { prisma } from "./db";
import { audit } from "./audit";
import { blobStore } from "./storage";
import { berlinDate } from "./time";
import { isDeletable, retentionFor, type Retention } from "./calc/retention";

export interface FormerEmployee { id: string; name: string; personnelNumber: string; exitDate: string | null; retention: Retention; deletable: boolean }

/** Ausgeschiedene Mitarbeiter: deaktiviert oder Austrittsdatum in der Vergangenheit */
export async function formerEmployees(today = berlinDate(new Date())): Promise<FormerEmployee[]> {
  const emps = await prisma.employee.findMany({
    where: { OR: [{ active: false }, { exitDate: { lt: new Date(today + "T00:00:00Z") } }] },
    select: { id: true, firstName: true, lastName: true, personnelNumber: true, exitDate: true, createdAt: true, _count: { select: { payrollItems: true, payments: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  if (!emps.length) return [];
  const last = await prisma.workSession.groupBy({ by: ["employeeId"], where: { employeeId: { in: emps.map((e) => e.id) } }, _max: { workDate: true } });
  const lastBy = new Map(last.map((l) => [l.employeeId, l._max.workDate ? berlinDate(l._max.workDate) : null]));
  return emps.map((e) => {
    const retention = retentionFor({ exitDate: e.exitDate ? berlinDate(e.exitDate) : null, lastActivity: lastBy.get(e.id) ?? null, createdAt: berlinDate(e.createdAt), hasPayroll: e._count.payrollItems + e._count.payments > 0 });
    return { id: e.id, name: `${e.lastName}, ${e.firstName}`, personnelNumber: e.personnelNumber, exitDate: e.exitDate ? berlinDate(e.exitDate) : null, retention, deletable: isDeletable(retention, today) };
  });
}

/**
 * Löscht alle Daten eines Mitarbeiters endgültig (Zeiten, Fotos, Dienste, Abwesenheiten, Löhne, Abschlüsse, PIN …).
 * Erlaubt nur nach Ablauf der Frist. Das fälschungssichere Änderungsprotokoll bleibt unverändert;
 * dort wird nur vermerkt, dass gelöscht wurde (ohne Namen).
 */
export async function eraseEmployee(employeeId: string, adminId: string, today = berlinDate(new Date())): Promise<{ ok?: string; error?: string }> {
  const f = (await formerEmployees(today)).find((x) => x.id === employeeId);
  if (!f) return { error: "Nur ausgeschiedene Mitarbeiter können gelöscht werden." };
  if (!f.deletable) return { error: `Die Aufbewahrungsfrist läuft noch. Löschen ist ab ${f.retention.deletableFrom.split("-").reverse().join(".")} möglich.` };

  const photos = await prisma.clockEventPhoto.findMany({ where: { clockEvent: { employeeId } }, select: { storageKey: true, deletedAt: true } });
  const counts = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('naya.erasure', 'on', true)`;
    const where = { employeeId };
    const sessions = (await tx.workSession.findMany({ where, select: { id: true } })).map((s) => s.id);
    const absences = (await tx.absence.findMany({ where, select: { id: true } })).map((a) => a.id);
    const account = await tx.workingTimeAccount.findUnique({ where, select: { id: true } });
    const settlements = (await tx.payrollSettlement.findMany({ where, select: { id: true } })).map((s) => s.id);

    await tx.paymentRecord.updateMany({ where, data: { reversedById: null } });
    const payments = await tx.paymentRecord.deleteMany({ where });
    await tx.payrollItem.deleteMany({ where: { OR: [{ employeeId }, { settlementId: { in: settlements } }] } });
    await tx.payrollSettlement.deleteMany({ where });
    if (account) await tx.workingTimeTransaction.deleteMany({ where: { accountId: account.id } });
    await tx.workingTimeTransaction.deleteMany({ where: { closing: { employeeId } } });
    await tx.workingTimeAccount.deleteMany({ where });
    await tx.monthlyTimeClosing.updateMany({ where, data: { supersedesId: null } });
    const closings = await tx.monthlyTimeClosing.deleteMany({ where });
    await tx.complianceFinding.deleteMany({ where });
    await tx.correctionRequest.deleteMany({ where });
    await tx.timeCorrection.updateMany({ where: { workSessionId: { in: sessions } }, data: { supersedesId: null } }).catch(() => undefined);
    await tx.timeCorrection.deleteMany({ where: { workSessionId: { in: sessions } } });
    await tx.breakRecord.deleteMany({ where: { workSessionId: { in: sessions } } });
    const ws = await tx.workSession.deleteMany({ where });
    await tx.clockEventPhoto.deleteMany({ where: { clockEvent: { employeeId } } });
    const events = await tx.timeClockEvent.deleteMany({ where });
    await tx.absence.deleteMany({ where: { id: { in: absences } } });
    const shifts = await tx.scheduledShift.deleteMany({ where });
    await tx.vacationBalance.deleteMany({ where });
    await tx.adminUser.updateMany({ where, data: { employeeId: null } });
    await tx.employee.delete({ where: { id: employeeId } });
    const c = { events: events.count, sessions: ws.count, shifts: shifts.count, absences: absences.length, closings: closings.count, payments: payments.count, photos: photos.length };
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "EMPLOYEE_ERASED", entityType: "Employee", entityId: employeeId, after: { ...c, deletableFrom: f.retention.deletableFrom } });
    return c;
  });
  // Fotodateien erst nach erfolgreichem Löschen der Datensätze entfernen
  for (const p of photos) await blobStore.delete(p.storageKey).catch(() => undefined);
  return { ok: `${f.name} wurde endgültig gelöscht (${counts.events} Stempelungen, ${counts.sessions} Schichten, ${counts.shifts} Dienste, ${counts.absences} Abwesenheiten).` };
}
