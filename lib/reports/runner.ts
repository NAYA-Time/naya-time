// Automatischer Berichtsversand. Wird vom Cron-Aufruf (/api/cron/reports) regelmäßig angestoßen.
import type { PrismaClient, ReportSchedule } from "@prisma/client";
import { berlinDate, berlinToInstant } from "../time";
import { prevMonth } from "../calc/month";
import { monthlyReport, payrollReport, weeklyReport } from "./excel";
import { saveReport } from "./store";
import { mailConfigured, sendMail } from "../mail";
import { audit } from "../audit";

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekday = (ymd: string) => ((new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7) + 1; // 1 = Montag

/** Nächster Ausführungszeitpunkt (Europe/Berlin) nach `after` */
export function nextRunAt(s: Pick<ReportSchedule, "reportType" | "dayOfWeek" | "dayOfMonth" | "timeOfDay">, after: Date): Date {
  let day = berlinDate(after);
  for (let i = 0; i < 400; i++, day = addDays(day, 1)) {
    const fits = s.reportType === "WEEKLY" ? weekday(day) === (s.dayOfWeek ?? 1) : Number(day.slice(8)) === (s.dayOfMonth ?? 1);
    if (!fits) continue;
    const at = berlinToInstant(day, s.timeOfDay);
    if (at > after) return at;
  }
  throw new Error("Kein Termin gefunden");
}

/** Welcher Zeitraum wird an einem Tag verschickt: Wochenbericht = Vorwoche, Monatsbericht = Vormonat */
export function periodFor(type: "WEEKLY" | "MONTHLY", day: string): string {
  if (type === "WEEKLY") return addDays(day, -(weekday(day) - 1) - 7);
  return prevMonth(day.slice(0, 7));
}

export async function runSchedule(db: PrismaClient, s: ReportSchedule & { recipients: { recipient: { email: string; active: boolean } }[] }, now: Date, actorId: string | null) {
  const day = berlinDate(now);
  let built;
  if (s.reportType === "WEEKLY") built = await weeklyReport(db, periodFor("WEEKLY", day), s.deptFilter);
  else if (s.reportType === "MONTHLY") built = await monthlyReport(db, periodFor("MONTHLY", day), s.deptFilter);
  else {
    const p = await db.payrollPeriod.findFirst({ where: { status: "SETTLED" }, orderBy: { settledAt: "desc" } });
    if (!p) return { sent: 0, failed: 0, note: "Noch keine festgeschriebene Aushilfenabrechnung." };
    built = await payrollReport(db, p.id);
  }
  const { report, buffer } = await saveReport(db, built, s.reportType, s.deptFilter, actorId, s.id);
  const to = s.recipients.filter((r) => r.recipient.active).map((r) => r.recipient.email);
  let sent = 0, failed = 0;
  for (const email of to) {
    try {
      if (!mailConfigured()) throw new Error("E-Mail-Versand ist nicht eingerichtet (SMTP fehlt).");
      const r = await sendMail(email, `NAYA TIME – ${s.name}`, `Guten Tag,\n\nim Anhang der Bericht „${s.name}“ (${built.fileName}).\n\nAutomatisch erstellt von NAYA TIME.`, { filename: built.fileName, content: buffer });
      await db.emailDeliveryLog.create({ data: { reportId: report.id, recipient: email, status: "SENT", providerId: r.providerId } });
      sent++;
    } catch (e) {
      await db.emailDeliveryLog.create({ data: { reportId: report.id, recipient: email, status: "FAILED", error: (e as Error).message.slice(0, 300) } });
      failed++;
    }
  }
  await db.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: now, nextRunAt: nextRunAt(s, now) } });
  await db.$transaction((tx) => audit(tx, { actorKind: actorId ? "ADMIN" : "SYSTEM", actorId, action: "REPORT_SENT", entityType: "GeneratedReport", entityId: report.id, after: { schedule: s.name, sent, failed } }));
  return { sent, failed, note: to.length ? "" : "Keine aktiven Empfänger." };
}

export async function runDueSchedules(db: PrismaClient, now = new Date()) {
  const due = await db.reportSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, include: { recipients: { include: { recipient: true } } } });
  const results = [];
  for (const s of due) results.push({ id: s.id, ...(await runSchedule(db, s, now, null)) });
  return results;
}
