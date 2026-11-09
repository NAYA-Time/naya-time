import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { addShift, copyPreviousWeek, deleteShiftQuick, mondayOf, publishWeek, saveDefaultShift } from "@/lib/admin-actions-schedule";
import { defaultShift } from "@/lib/schedule-defaults";
import { checkPlan } from "@/lib/calc/schedule-checks";
import { currentDeptFilter, matchesFilter } from "@/lib/dept";
import { holidayName } from "@/lib/holidays";
import { berlinDate, berlinTime, dbDate, fmtMinutes, minutesBetween } from "@/lib/time";
import { ActionForm, Field } from "@/components/ActionForm";
import { Section, Select } from "@/components/Select";

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const ABS_LABEL: Record<string, string> = { VACATION: "Urlaub", SICK: "Krank", SICK_CHILD: "Kind krank", SPECIAL_LEAVE: "Sonderurlaub", UNPAID: "Unbezahlt", TIME_OFF_IN_LIEU: "Freizeitausgl." };

export default async function DienstplanPage({ searchParams }: { searchParams: Promise<{ woche?: string }> }) {
  const admin = await requireAdmin("employees.view");
  const sp = await searchParams;
  const today = berlinDate(new Date());
  const monday = await mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.woche ?? "") ? sp.woche! : today);
  const sunday = addDays(monday, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const filter = await currentDeptFilter();
  const canManage = admin.permissions.has("schedule.manage");

  const def = await defaultShift();
  const defLabel = `${fmtMinutes(def.minutes)} Std. inkl. ${def.breakMinutes} Min. Pause`;
  const [emps, shifts, absences, sched, depts] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true },
      include: { primaryDept: { include: { parent: true } }, contracts: { where: { validFrom: { lte: dbDate(sunday) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(monday) } }] }, orderBy: { validFrom: "desc" }, take: 1 } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.scheduledShift.findMany({ where: { deletedAt: null, workDate: { gte: dbDate(monday), lte: dbDate(sunday) } }, include: { department: { include: { parent: true } } }, orderBy: { startAt: "asc" } }),
    prisma.absence.findMany({ where: { status: { not: "CANCELLED" }, startDate: { lte: dbDate(sunday) }, endDate: { gte: dbDate(monday) } } }),
    prisma.workSchedule.findFirst({ where: { periodStart: dbDate(monday), departmentId: null }, include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } } }),
    prisma.department.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  // Abteilungsfilter: Mitarbeiter mit Hauptabteilung im Filter oder mit einem Dienst in einer passenden Abteilung
  const visible = emps.filter((e) => matchesFilter(filter, e.primaryDept) || shifts.some((s) => s.employeeId === e.id && matchesFilter(filter, s.department)));
  const visibleIds = new Set(visible.map((e) => e.id));

  const timed = shifts.filter((s) => s.startAt && s.endAt && s.kind === "WORK");
  const warnings = checkPlan(
    timed.map((s) => ({ id: s.id, employeeId: s.employeeId, startAt: s.startAt!, endAt: s.endAt!, plannedBreakMinutes: s.plannedBreakMinutes })),
    new Map(emps.map((e) => [e.id, e.contracts[0]?.weeklyMinutes ?? null])),
  ).filter((w) => visibleIds.has(w.employeeId));
  const warnByShift = new Map<string, string[]>();
  for (const w of warnings) if (w.shiftId) warnByShift.set(w.shiftId, [...(warnByShift.get(w.shiftId) ?? []), w.message]);

  const net = (s: (typeof shifts)[number]) => (s.startAt && s.endAt ? minutesBetween(s.startAt, s.endAt) - s.plannedBreakMinutes : 0);
  const changedSincePublish = sched?.versions[0] ? shifts.some((s) => s.updatedAt > sched.versions[0].publishedAt) || (sched.versions[0].snapshot as unknown[]).length !== shifts.length : false;
  const empName = (id: string) => { const e = emps.find((x) => x.id === id); return e ? `${e.firstName} ${e.lastName}` : "?"; };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Dienstplan</h1>
          <p className="mt-1 text-mute tabular">
            KW {isoWeek(monday)} · {de(monday)} – {de(sunday)} ·{" "}
            {sched?.status === "PUBLISHED" ? <span className="text-good">veröffentlicht (Version {sched.currentVersionNo}){changedSincePublish && <span className="text-warn"> · seitdem geändert</span>}</span> : <span className="text-warn">Entwurf, noch nicht veröffentlicht</span>}
          </p>
        </div>
        <nav className="flex gap-2">
          <Link href={`/admin/dienstplan?woche=${addDays(monday, -7)}`} className="rounded-xl border border-line px-4 py-3 hover:bg-slate">← Vorwoche</Link>
          <Link href="/admin/dienstplan" className="rounded-xl border border-line px-4 py-3 hover:bg-slate">Diese Woche</Link>
          <Link href={`/admin/dienstplan?woche=${addDays(monday, 7)}`} className="rounded-xl border border-line px-4 py-3 hover:bg-slate">Nächste →</Link>
        </nav>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-coal">
        <table className="w-full min-w-[980px] table-fixed text-sm">
          <thead>
            <tr className="text-xs tracking-wider text-mute">
              <th className="w-48 px-3 py-3 text-left">MITARBEITER</th>
              {days.map((d, i) => {
                const hol = holidayName(d);
                return (
                  <th key={d} className={`px-2 py-3 text-left ${d === today ? "text-gold" : ""}`}>
                    {WD[i]} {d.slice(8)}.{d.slice(5, 7)}.
                    {hol && <span className="block text-[10px] font-normal normal-case text-warn">{hol}</span>}
                  </th>
                );
              })}
              <th className="w-20 px-2 py-3 text-right">SUMME</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const mine = shifts.filter((s) => s.employeeId === e.id);
              const total = mine.reduce((x, s) => x + net(s), 0);
              const target = e.contracts[0]?.weeklyMinutes ?? null;
              return (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <span className="font-semibold">{e.firstName} {e.lastName}</span>
                    <span className="block text-xs text-mute">{e.primaryDept?.name ?? "–"}</span>
                  </td>
                  {days.map((d) => {
                    const cell = mine.filter((s) => berlinDate(s.workDate) === d);
                    const abs = absences.find((a) => a.employeeId === e.id && berlinDate(a.startDate) <= d && berlinDate(a.endDate) >= d);
                    return (
                      <td key={d} className={`px-1.5 py-2 ${d === today ? "bg-gold/5" : ""}`}>
                        {abs && <span className="mb-1 block rounded-md bg-slate px-2 py-1 text-xs text-mute">{ABS_LABEL[abs.type]}</span>}
                        {cell.map((s) => {
                          const w = warnByShift.get(s.id);
                          return (
                            <div key={s.id} title={w?.join("\n")} className={`mb-1 rounded-md border px-2 py-1 ${w ? "border-warn/60 bg-warn/10" : "border-line bg-ink"}`}>
                              <div className="flex items-start justify-between gap-1">
                                <span className="tabular font-semibold">{s.startAt ? berlinTime(s.startAt) : "–"}–{s.endAt ? berlinTime(s.endAt) : "–"}</span>
                                {canManage && (
                                  <form action={deleteShiftQuick}>
                                    <input type="hidden" name="id" value={s.id} />
                                    <button aria-label={`Dienst ${empName(s.employeeId)} ${d} entfernen`} className="-mr-1 px-1 text-mute hover:text-bad">×</button>
                                  </form>
                                )}
                              </div>
                              <span className="block text-[11px] text-mute">
                                {s.plannedBreakMinutes ? `${s.plannedBreakMinutes} Min. Pause` : "ohne Pause"}
                                {s.departmentId !== e.primaryDeptId && ` · ${s.department.name}`}
                              </span>
                              {s.note && <span className="block text-[11px] text-mute">{s.note}</span>}
                              {w && <span className="block text-[11px] text-warn">⚠ {w[0]}</span>}
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                  <td className={`px-2 py-2 text-right tabular ${target && Math.abs(total - target) > 60 ? "text-warn" : ""}`}>
                    {fmtMinutes(total)}
                    {target ? <span className="block text-[11px] text-mute">Soll {fmtMinutes(target)}</span> : null}
                  </td>
                </tr>
              );
            })}
            {!visible.length && <tr><td colSpan={9} className="px-3 py-6 text-mute">Keine aktiven Mitarbeiter in dieser Abteilung.</td></tr>}
          </tbody>
        </table>
      </div>

      {warnings.length > 0 && (
        <Section title={`Hinweise zum Plan (${warnings.length})`} hint="Hinweise, keine Sperren. Bitte prüfen, ob es so gewollt ist.">
          <ul className="grid gap-1.5 text-sm">
            {warnings.map((w, i) => <li key={i}><span className="font-semibold">{empName(w.employeeId)}:</span> <span className="text-warn">{w.message}</span></li>)}
          </ul>
        </Section>
      )}

      {canManage && (
        <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
          <Section title="Dienst eintragen" hint={`Nur Beginn eintragen = Standarddienst ${defLabel}. Ende vor Beginn bedeutet: Dienst geht über Mitternacht.`}>
            <ActionForm action={addShift} submit="Dienst eintragen">
              <div className="grid gap-4 sm:grid-cols-3">
                <Select label="Mitarbeiter" name="employeeId" options={visible.map((e) => [e.id, `${e.lastName}, ${e.firstName}`])} required />
                <Select label="Tag" name="date" defaultValue={days.includes(today) ? today : monday} options={days.map((d, i) => [d, `${WD[i]} ${de(d)}`])} />
                <Select label="Abteilung (abweichend)" name="departmentId" options={[["", "Wie Hauptabteilung"], ...depts.map((d): [string, string] => [d.id, d.name])]} />
                <Field label="Beginn" name="start" type="time" defaultValue="16:00" required />
                <Field label="Ende (optional)" name="end" type="time" />
                <Field label="Geplante Pause (Min.)" name="break" type="number" inputMode="numeric" min={0} hint={`leer = ${def.breakMinutes} Min. beim Standarddienst`} />
                <div className="sm:col-span-3"><Field label="Notiz (optional)" name="note" /></div>
              </div>
            </ActionForm>
          </Section>
          <div className="grid content-start gap-5">
            <Section title="Veröffentlichen" hint="Friert den aktuellen Stand als Version ein. Spätere Änderungen bleiben nachvollziehbar.">
              <ActionForm action={publishWeek} submit={sched?.status === "PUBLISHED" ? "Neue Version veröffentlichen" : "Woche veröffentlichen"}>
                <input type="hidden" name="monday" value={monday} />
                <Field label="Änderungsnotiz (optional)" name="note" />
              </ActionForm>
            </Section>
            <Section title="Standarddienst" hint="Gilt, wenn im Plan nur eine Anfangszeit steht – beim Eintragen und später beim Foto-Import.">
              <ActionForm action={saveDefaultShift} submit="Speichern">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Dauer inkl. Pause" name="duration" defaultValue={fmtMinutes(def.minutes)} required hint="z. B. 8:30" />
                  <Field label="Pause (Min.)" name="breakMinutes" type="number" inputMode="numeric" min={0} defaultValue={def.breakMinutes} required />
                </div>
              </ActionForm>
            </Section>
            {shifts.length === 0 && (
              <Section title="Vorwoche übernehmen" hint="Kopiert alle Dienste aktiver Mitarbeiter mit gleicher Uhrzeit.">
                <ActionForm action={copyPreviousWeek} submit="Vorwoche kopieren">
                  <input type="hidden" name="monday" value={monday} />
                </ActionForm>
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function de(ymd: string) {
  return `${ymd.slice(8)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
}
function isoWeek(monday: string) {
  // ISO-Woche = Woche, in der der Donnerstag liegt
  const thu = Date.parse(monday + "T00:00:00Z") + 3 * 86400000;
  const jan1 = Date.UTC(new Date(thu).getUTCFullYear(), 0, 1);
  return Math.floor((thu - jan1) / 86400000 / 7) + 1;
}
