import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { cancelAbsence, createAbsence, markVacationReminder } from "@/lib/admin-actions-absences";
import { currentDeptFilter, matchesFilter } from "@/lib/dept";
import { dateDe } from "@/lib/labels";
import { berlinDate, fmtMinutes } from "@/lib/time";
import { vacationOverview } from "@/lib/vacation";
import { sendSickList } from "@/lib/admin-actions-reports";
import { mailConfigured } from "@/lib/mail";
import { decideVacationRequest } from "@/lib/admin-actions-portal";
import { ActionForm, Field } from "./ActionForm";
import { Section, Select } from "./Select";

const TYPE_LABEL: Record<string, string> = { VACATION: "Urlaub", SICK: "Krank", SICK_CHILD: "Kind krank", SPECIAL_LEAVE: "Sonderurlaub", UNPAID: "Unbezahlt", TIME_OFF_IN_LIEU: "Freizeitausgleich" };

export async function AbsencePage({ mode }: { mode: "sick" | "vacation" }) {
  const admin = await requireAdmin("employees.view");
  const filter = await currentDeptFilter();
  const types = mode === "sick" ? ["SICK", "SICK_CHILD"] : ["VACATION", "SPECIAL_LEAVE", "UNPAID", "TIME_OFF_IN_LIEU"];
  const year = Number(berlinDate(new Date()).slice(0, 4));
  const [emps, absences] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, include: { primaryDept: { include: { parent: true } }, contracts: { orderBy: { validFrom: "desc" }, take: 1 }, vacationBalances: { where: { year } } }, orderBy: { lastName: "asc" } }),
    prisma.absence.findMany({
      where: { type: { in: types as never }, endDate: { gte: dbYearStart(year - 1) } },
      include: { employee: { include: { primaryDept: { include: { parent: true } } } }, days: true, sickLeave: true }, orderBy: { startDate: "desc" },
    }),
  ]);
  const visible = emps.filter((e) => matchesFilter(filter, e.primaryDept));
  const rows = absences.filter((a) => matchesFilter(filter, a.employee.primaryDept));
  const canManage = admin.permissions.has("absences.manage");
  const recipients = mode === "sick" ? await prisma.emailRecipient.findMany({ where: { active: true }, orderBy: { email: "asc" } }) : [];

  // Urlaubskonto je Mitarbeiter für das laufende Jahr
  const vacation = mode === "vacation" ? await vacationOverview(visible, year) : [];
  const requests = mode === "vacation" ? (await prisma.vacationRequest.findMany({ where: { status: "OPEN" }, include: { employee: { include: { primaryDept: { include: { parent: true } } } } }, orderBy: { startDate: "asc" } })).filter((r) => matchesFilter(filter, r.employee.primaryDept)) : [];
  const decided = mode === "vacation" ? (await prisma.vacationRequest.findMany({ where: { status: { in: ["APPROVED", "REJECTED", "WITHDRAWN"] }, decidedAt: { gte: new Date(Date.now() - 14 * 86400000) } }, include: { employee: { include: { primaryDept: { include: { parent: true } } } } }, orderBy: { decidedAt: "desc" }, take: 20 })).filter((r) => matchesFilter(filter, r.employee.primaryDept)) : [];
  const restBy = new Map(vacation.map((v) => [v.id, v.rest]));

  return (
    <div className="grid max-w-5xl gap-5">
      <h1 className="text-3xl font-semibold">{mode === "sick" ? "Krankheit" : "Urlaub"}</h1>
      {mode === "sick" && <p className="text-mute">Es werden keine Diagnosen gespeichert. Angerechnet wird der zum Zeitpunkt der Eintragung geplante Dienst; spätere Dienstplanänderungen ändern die Anrechnung nicht.</p>}
      {canManage && (
        <Section title={mode === "sick" ? "Krankmeldung eintragen" : "Abwesenheit eintragen"}>
          <ActionForm action={createAbsence} submit="Eintragen">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Mitarbeiter" name="employeeId" options={visible.map((e) => [e.id, `${e.lastName}, ${e.firstName}`])} required />
              <Select label="Art" name="type" options={types.map((t) => [t, TYPE_LABEL[t]])} />
              <Field label={mode === "sick" ? "Erster Krankheitstag" : "Von"} name="from" type="date" defaultValue={berlinDate(new Date())} required />
              <Field label={mode === "sick" ? "Letzter Krankheitstag" : "Bis"} name="to" type="date" defaultValue={berlinDate(new Date())} />
              {mode === "sick" && <Select label="Arbeitsunfähigkeitsbescheinigung" name="certificate" options={[["UNKNOWN", "Noch offen"], ["EAU_RETRIEVED", "eAU abgerufen"], ["SUBMITTED", "Vorgelegt"], ["NOT_REQUIRED", "Nicht erforderlich"]]} />}
              <Field label="Bemerkung (keine Diagnose)" name="note" />
            </div>
          </ActionForm>
        </Section>
      )}

      {mode === "vacation" && (
        <Section title={`Urlaubsanträge vom Handy (${requests.length} offen)`} hint="Genehmigen trägt den Urlaub sofort ein (angerechnet wie beim Eintragen von Hand). Der Mitarbeiter sieht die Entscheidung am Handy.">
          {requests.length === 0 ? <p className="text-mute">Keine offenen Anträge.</p> : (
            <ul className="grid gap-3">{requests.map((r) => (
              <li key={r.id} className="rounded-xl border border-warn/40 bg-warn/5 p-4">
                <p className="font-semibold">{r.employee.firstName} {r.employee.lastName}: {dateDe(r.startDate)}{+r.endDate !== +r.startDate ? ` – ${dateDe(r.endDate)}` : ""}</p>
                <p className="text-sm text-mute">Gestellt am {berlinDate(r.createdAt).split("-").reverse().join(".")}{restBy.has(r.employeeId) ? ` · Resturlaub ${restBy.get(r.employeeId)} Tage` : ""}{r.note ? ` · „${r.note}“` : ""}</p>
                {canManage && (
                  <ActionForm action={decideVacationRequest} submit="Entscheidung speichern" className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                    <input type="hidden" name="id" value={r.id} />
                    <Select label="Entscheidung" name="decision" options={[["approve", "Genehmigen"], ["reject", "Ablehnen"]]} />
                    <Field label="Nachricht an Mitarbeiter (freiwillig)" name="note" />
                  </ActionForm>
                )}
              </li>
            ))}</ul>
          )}
          {decided.length > 0 && (
            <div className="mt-4"><p className="text-sm text-mute">Zuletzt entschieden (14 Tage)</p>
              <ul className="mt-1 grid gap-1 text-sm">{decided.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-1.5">
                  <span>{r.employee.firstName} {r.employee.lastName}: {dateDe(r.startDate)}{+r.endDate !== +r.startDate ? ` – ${dateDe(r.endDate)}` : ""}</span>
                  <span className={r.status === "APPROVED" ? "text-good" : r.status === "REJECTED" ? "text-bad" : "text-mute"}>{r.status === "APPROVED" ? "genehmigt" : r.status === "REJECTED" ? "abgelehnt" : "vom Mitarbeiter zurückgezogen"}{r.decisionNote ? ` · „${r.decisionNote}“` : ""}</span>
                </li>
              ))}</ul>
            </div>
          )}
        </Section>
      )}

      {mode === "vacation" && (
        <Section title={`Urlaubskonten ${year}`} hint="Anspruch aus dem aktuellen Vertrag, bei Eintritt anteilig. Resturlaub wird automatisch ins nächste Jahr übertragen und muss bis 31.03. genommen werden. Danach verfällt er nur, wenn der Hinweis an den Mitarbeiter hier dokumentiert ist.">
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm tabular">
            <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">MITARBEITER</th><th>ANSPRUCH</th><th>ÜBERTRAG</th><th>GENOMMEN</th><th>GEPLANT</th><th>RESTURLAUB</th><th>HINWEIS ZUM RESTURLAUB {year}</th></tr></thead>
            <tbody>{vacation.map((v) => (
              <tr key={v.id} className="border-t border-line align-top">
                <td className="py-2">{v.name}</td><td>{v.entitlement}</td>
                <td>{v.carry}{v.carryOpen > 0 && <span className="block text-xs text-warn">{v.carryOpen} verfallen nach 31.03.</span>}{v.expired > 0 && <span className="block text-xs text-mute">{v.expired} verfallen</span>}{v.reminderMissing && <span className="block text-xs text-bad">Hinweis fehlte – verfällt nicht</span>}</td>
                <td>{v.taken}</td><td>{v.planned}</td><td className={`font-bold ${v.rest < 0 ? "text-bad" : ""}`}>{v.rest}</td>
                <td className="py-2">{v.reminderThisYear ? <span className="text-good">gegeben am {dateDe(v.reminderThisYear)}</span> : v.rest > 0 && canManage ? (
                  <form action={markVacationReminder}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="year" value={year} />
                    <button className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-slate">Hinweis gegeben ✓</button></form>
                ) : <span className="text-mute">–</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-gold">Text für den Hinweis an Mitarbeiter</summary>
            <p className="mt-2 whitespace-pre-line rounded-xl border border-line bg-ink p-4 text-paper">{`Liebe/r …,\n\ndu hast für ${year} noch … Urlaubstage. Bitte plane und nimm diesen Urlaub möglichst noch in diesem Jahr. Resturlaub wird ins Jahr ${year + 1} übertragen und muss bis zum 31.03.${year + 1} genommen werden – danach verfällt er.\n\nNAYA Restaurant & Bar`}</p>
            <p className="mt-1 text-xs text-mute">Hinweis schriftlich (z. B. per E-Mail oder ausgedruckt mit Unterschrift) geben und danach hier „Hinweis gegeben“ anklicken. Am Terminal sieht der Mitarbeiter seinen Resturlaub und die Frist zusätzlich unter „Mein Dienstplan“.</p>
          </details>
        </Section>
      )}

      {mode === "sick" && admin.permissions.has("reports.create") && (
        <Section title="Krankheitsliste als Excel" hint="Nach Mitarbeitern sortiert: Krankheitstage im Zeitraum, im laufenden Jahr und seit Eintritt, angerechnete Stunden, Stand der AU-Bescheinigung. Keine Diagnosen.">
          <form action="/admin/krankheit/export" className="grid gap-4 sm:grid-cols-4 sm:items-end">
            <Field label="Von" name="von" type="date" defaultValue={`${year}-01-01`} required />
            <Field label="Bis" name="bis" type="date" defaultValue={berlinDate(new Date())} required />
            <Select label="Abteilung" name="abteilung" defaultValue={filter} options={[["ALL", "Alle"], ["KUECHE", "Küche"], ["SERVICE", "Service"]]} />
            <button className="min-h-12 rounded-xl bg-gold px-6 font-semibold text-ink">Herunterladen</button>
          </form>
          {admin.permissions.has("reports.email") && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gold">Per E-Mail verschicken (erst nach deinem Klick auf „Freigeben und senden“)</summary>
              {!mailConfigured() ? <p className="mt-2 text-sm text-warn">E-Mail-Versand ist noch nicht eingerichtet (SMTP-Daten fehlen).</p> : !recipients.length ? <p className="mt-2 text-sm text-mute">Noch keine Empfänger angelegt – unter „E-Mail-Automatisierung“ hinzufügen.</p> : (
                <ActionForm action={sendSickList} submit="Freigeben und senden" className="mt-3 grid gap-3">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Von" name="von" type="date" defaultValue={`${year}-01-01`} required />
                    <Field label="Bis" name="bis" type="date" defaultValue={berlinDate(new Date())} required />
                    <Select label="Abteilung" name="abteilung" defaultValue={filter} options={[["ALL", "Alle"], ["KUECHE", "Küche"], ["SERVICE", "Service"]]} />
                  </div>
                  <fieldset className="grid gap-1.5 text-sm"><legend className="mb-1 text-mute">Empfänger</legend>
                    {recipients.map((r) => <label key={r.id} className="flex items-center gap-2"><input type="checkbox" name="recipient" value={r.id} className="size-5 accent-gold" />{r.name ? `${r.name} – ` : ""}{r.email}</label>)}
                  </fieldset>
                </ActionForm>
              )}
            </details>
          )}
        </Section>
      )}

      <Section title="Einträge">
        {rows.length === 0 ? <p className="text-mute">Keine Einträge.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm tabular">
            <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">MITARBEITER</th><th>ART</th><th>ZEITRAUM</th><th>ANGERECHNET</th>{mode === "vacation" && <th>TAGE</th>}<th>STATUS</th><th /></tr></thead>
            <tbody>{rows.map((a) => {
              const credited = a.days.reduce((x, d) => x + d.creditedMinutes, 0);
              return (
                <tr key={a.id} className={`border-t border-line ${a.status === "CANCELLED" ? "opacity-40 line-through" : ""}`}>
                  <td className="py-2">{a.employee.firstName} {a.employee.lastName}</td><td>{TYPE_LABEL[a.type]}</td>
                  <td>{dateDe(a.startDate)}{+a.endDate !== +a.startDate ? ` – ${dateDe(a.endDate)}` : ""}</td><td>{fmtMinutes(credited)} Std.</td>
                  {mode === "vacation" && <td>{a.days.reduce((x, d) => x + d.vacationDayValue, 0) / 2}</td>}
                  <td>{a.status === "CANCELLED" ? "storniert" : a.status === "PLANNED" ? "geplant" : "bestätigt"}</td>
                  <td className="text-right">{canManage && a.status !== "CANCELLED" && <ActionForm action={cancelAbsence} submit="Stornieren" className="inline-flex"><input type="hidden" name="id" value={a.id} /></ActionForm>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}

function dbYearStart(y: number) { return new Date(`${y}-01-01T00:00:00.000Z`); }

