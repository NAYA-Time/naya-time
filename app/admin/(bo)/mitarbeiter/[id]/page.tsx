import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { addContract, addOvertimeRule, setWorkdays, addWage, resetPin, savePortalVisibility, setActive, updateEmployee } from "@/lib/admin-actions-employees";
import { ActionForm, Field } from "@/components/ActionForm";
import { PortalInvite } from "@/components/PortalInvite";
import { Check, Section, Select, WeekdayPicker } from "@/components/Select";
import { maskCount, maskLabel } from "@/lib/workdays";
import { EMPLOYMENT_LABEL, METHOD_LABEL, dateDe, euro } from "@/lib/labels";
import { berlinDate, fmtMinutes } from "@/lib/time";
import { vacationInclude, vacationOverview, vacationTakenTotal } from "@/lib/vacation";
import { sickCounts } from "@/lib/sick";
import { wageIssues } from "@/lib/calc/minwage";
import { toRows } from "@/lib/minwage";
import { REMINDER_KINDS, reminderStatus } from "@/lib/calc/reminders";
import { addReminder, reminderAction } from "@/lib/admin-actions-reminders";

export default async function EmployeeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string }> }) {
  const admin = await requireAdmin("employees.view");
  const { id } = await params;
  await searchParams;
  const flash = (await cookies()).get("naya_setup_code")?.value.split(":");
  const code = flash?.[0] === id ? flash[1] : undefined; // nur ca. 2 Minuten nach dem Anlegen sichtbar
  const e = await prisma.employee.findUnique({
    where: { id },
    include: {
      primaryDept: true, subDept: true, credential: true, portalSettings: true,
      contracts: { orderBy: { validFrom: "desc" } }, overtimeRules: { orderBy: { validFrom: "desc" } }, wages: { orderBy: { validFrom: "desc" } },
      account: { include: { transactions: true } },
      reminders: { orderBy: [{ doneAt: "asc" }, { dueDate: "asc" }] },
    },
  });
  if (!e) notFound();
  const can = (p: string) => admin.permissions.has(p);
  const depts = await prisma.department.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const main = depts.filter((d) => d.kind === "MAIN").map((d) => [d.id, d.name] as [string, string]);
  const sub = [["", "–"] as [string, string], ...depts.filter((d) => d.kind === "SUB").map((d) => [d.id, d.name] as [string, string])];
  const balance = e.account?.transactions.reduce((a, t) => a + t.minutes, 0) ?? 0;
  const hourly = e.employmentType !== "FESTANGESTELLT";
  const today = berlinDate(new Date());
  const v = e.portalSettings;
  const year = Number(today.slice(0, 4));
  const [vac] = await vacationOverview([await prisma.employee.findUniqueOrThrow({ where: { id }, include: vacationInclude(year) })], year);
  const sick = (await sickCounts([id], today)).get(id)!;
  const vacTotal = await vacationTakenTotal(id);
  const days = (n: number) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Tag" : "Tage"}`;
  return (
    <div className="grid max-w-4xl gap-5">
      <Link href="/admin/mitarbeiter" className="text-mute hover:text-paper">‹ Alle Mitarbeiter</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{e.firstName} {e.lastName}{!e.active && <span className="ml-3 text-base text-warn">inaktiv</span>}</h1>
          <p className="text-mute">Nr. {e.personnelNumber} · {e.primaryDept.name}{e.subDept ? ` · ${e.subDept.name}` : ""} · {EMPLOYMENT_LABEL[e.employmentType]}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {(vac.entitlement > 0 || vac.taken > 0 || vac.planned > 0 || vacTotal > 0) && (
            <div className="rounded-2xl border border-line bg-coal px-5 py-3">
              <p className="text-xs tracking-wider text-mute">URLAUB {year}</p>
              <p className={`text-2xl font-bold tabular ${vac.rest < 0 ? "text-bad" : ""}`}>noch {days(vac.rest)}</p>
              <p className="text-xs text-mute tabular">Anspruch {days(vac.entitlement)}{vac.carry ? ` + ${days(vac.carry)} Übertrag` : ""} · genommen {days(vac.taken)}{vac.planned ? ` · geplant ${days(vac.planned)}` : ""}</p>
              <p className="text-xs text-mute tabular">genommen seit Eintritt: {days(vacTotal)}</p>
            </div>
          )}
          <div className="rounded-2xl border border-line bg-coal px-5 py-3">
            <p className="text-xs tracking-wider text-mute">KRANKHEITSTAGE</p>
            <p className="text-sm tabular"><span className="text-2xl font-bold">{sick.sickYear}</span> in {year}{sick.childYear ? <span className="text-mute"> · Kind krank {sick.childYear}</span> : null}</p>
            <p className="text-sm text-mute tabular">{sick.sickTotal} seit Eintritt am {dateDe(e.entryDate)}{sick.childTotal ? ` · Kind krank ${sick.childTotal}` : ""}</p>
          </div>
          {!hourly && <div className="rounded-2xl border border-line bg-coal px-5 py-3 text-right"><p className="text-xs tracking-wider text-mute">STUNDENKONTO</p><p className={`text-2xl font-bold tabular ${balance < 0 ? "text-bad" : balance > 0 ? "text-good" : ""}`}>{balance > 0 ? "+" : ""}{fmtMinutes(balance)}</p></div>}
        </div>
      </div>

      {code && (
        <p className="rounded-2xl border border-gold/50 bg-gold/10 px-5 py-4 text-paper">
          Einrichtungscode für das Terminal: <b className="font-mono text-2xl tracking-[0.3em] text-gold">{code}</b><br />
          <span className="text-sm text-mute">Gib den Code dem Mitarbeiter persönlich. Er wählt damit beim ersten Stempeln seinen eigenen PIN. 7 Tage gültig, wird nur jetzt (ca. 2 Minuten) angezeigt.</span>
        </p>
      )}

      {can("employees.manage") && (
        <Section title="Stammdaten">
          <ActionForm action={updateEmployee} submit="Speichern">
            <input type="hidden" name="id" value={e.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vorname" name="firstName" defaultValue={e.firstName} required />
              <Field label="Nachname" name="lastName" defaultValue={e.lastName} required />
              <Field label="Name am Terminal" name="displayName" defaultValue={e.displayName} />
              <Field label="E-Mail" name="email" type="email" defaultValue={e.email} />
              <Field label="Position" name="position" defaultValue={e.position} />
              <Field label="Austrittsdatum" name="exitDate" type="date" defaultValue={e.exitDate ? berlinDate(e.exitDate) : ""} />
              {e.employmentType !== "FESTANGESTELLT" && <Select label="Beschäftigungsart" name="employmentType" options={Object.entries(EMPLOYMENT_LABEL).filter(([k]) => k !== "FESTANGESTELLT")} defaultValue={e.employmentType} />}
              <Select label="Hauptabteilung" name="primaryDeptId" options={main} defaultValue={e.primaryDeptId} />
              <Field label="Abteilungswechsel gültig ab" name="deptValidFrom" type="date" hint="Nur bei Wechsel der Hauptabteilung nötig. Frühere Berichte bleiben bei der alten Abteilung." />
              <Select label="Unterabteilung" name="subDeptId" options={sub} defaultValue={e.subDeptId ?? ""} />
            </div>
            <Check label="Am Terminal anzeigen" name="showOnTerminal" defaultChecked={e.showOnTerminal} />
          </ActionForm>
        </Section>
      )}

      <Section title="Vertrag" hint="Änderungen gelten ab einem Datum. Frühere Zeiträume werden weiter mit den alten Werten berechnet.">
        <table className="mb-4 w-full text-left text-sm tabular">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">GÜLTIG</th><th>WOCHENSOLL</th><th>MONATSSOLL</th><th>ARBEITSTAGE</th><th>URLAUB</th></tr></thead>
          <tbody>{e.contracts.map((c) => (
            <tr key={c.id} className="border-t border-line"><td className="py-2">{dateDe(c.validFrom)} – {c.validTo ? dateDe(c.validTo) : "heute"}</td><td>{c.weeklyMinutes != null ? fmtMinutes(c.weeklyMinutes) : "variabel"}</td><td>{METHOD_LABEL[c.monthlyTargetMethod]}{c.weeklyMinutes ? ` (Ø ${fmtMinutes(Math.round((c.weeklyMinutes * 13) / 3))})` : ""}</td><td>{maskLabel(c.workdaysMask)}{c.workdaysPerWeek !== maskCount(c.workdaysMask) && <span className="text-warn"> (Tage/Woche: {c.workdaysPerWeek} – passt nicht)</span>}</td><td>{c.vacationDaysPerYear} Tage</td></tr>
          ))}</tbody>
        </table>
        {can("contracts.manage") && (<>
          <details><summary className="cursor-pointer text-gold">Neuen Vertragsstand anlegen</summary>
            <div className="mt-4"><ActionForm action={addContract} submit="Vertragsstand speichern">
              <input type="hidden" name="id" value={e.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Gültig ab" name="validFrom" type="date" defaultValue={today} required />
                <Field label="Wochenstunden" name="weeklyHours" defaultValue={e.contracts[0]?.weeklyMinutes != null ? fmtMinutes(e.contracts[0].weeklyMinutes) : ""} />
                <Select label="Monatssoll" name="method" options={Object.entries(METHOD_LABEL)} defaultValue={e.contracts[0]?.monthlyTargetMethod} />
                <WeekdayPicker mask={e.contracts[0]?.workdaysMask ?? 31} />
                <Field label="Urlaubstage pro Jahr" name="vacationDays" type="number" defaultValue={e.contracts[0]?.vacationDaysPerYear ?? 0} />
                <Field label="Notiz" name="note" />
              </div>
            </ActionForm></div>
          </details>
          {e.contracts[0] && (
            <details className="mt-3"><summary className="cursor-pointer text-gold">Arbeitstage des aktuellen Vertrags berichtigen</summary>
              <div className="mt-4"><ActionForm action={setWorkdays} submit="Arbeitstage speichern">
                <input type="hidden" name="id" value={e.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <WeekdayPicker mask={e.contracts[0].workdaysMask} hint="Gilt rückwirkend für den ganzen aktuellen Vertragsstand. Für eine Änderung ab einem Datum bitte „Neuen Vertragsstand anlegen“ nutzen." />
                </div>
              </ActionForm></div>
            </details>
          )}
        </>)}
      </Section>

      {!hourly && (
        <Section title="Mit dem Gehalt abgegoltene Überstunden" hint="Gilt pro Kalendermonat. Nicht genutzte Stunden verfallen, die tatsächlich geleisteten Stunden bleiben immer dokumentiert.">
          <table className="mb-4 w-full text-left text-sm tabular">
            <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">GÜLTIG</th><th>PRO MONAT</th><th>VERTRAGLICH</th><th>RECHTLICH GEPRÜFT</th></tr></thead>
            <tbody>{e.overtimeRules.map((r) => (
              <tr key={r.id} className="border-t border-line"><td className="py-2">{dateDe(r.validFrom)} – {r.validTo ? dateDe(r.validTo) : "heute"}</td><td>{fmtMinutes(r.includedMinutesPerMonth)}</td><td>{r.contractuallyAgreed ? "Ja" : <span className="text-warn">Nein – wird nicht angewendet</span>}</td><td>{r.legallyReviewed ? "Ja" : "Nein"}</td></tr>
            ))}</tbody>
          </table>
          {can("contracts.manage") && (
            <details><summary className="cursor-pointer text-gold">Regel ändern</summary>
              <div className="mt-4"><ActionForm action={addOvertimeRule} submit="Regel speichern">
                <input type="hidden" name="id" value={e.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Gültig ab" name="validFrom" type="date" defaultValue={today} required />
                  <Field label="Abgegoltene Stunden pro Monat" name="includedHours" defaultValue={(e.overtimeRules[0]?.includedMinutesPerMonth ?? 0) / 60} inputMode="decimal" />
                </div>
                <Check label="Vertraglich vereinbart" name="agreed" defaultChecked={e.overtimeRules[0]?.contractuallyAgreed} />
                <Check label="Rechtlich geprüft" name="reviewed" defaultChecked={e.overtimeRules[0]?.legallyReviewed} />
              </ActionForm></div>
            </details>
          )}
        </Section>
      )}

      <Section title="Fristen und Erinnerungen" hint="Probezeit, Befristung, Belehrungen, Arbeitserlaubnis … Du siehst fällige Fristen im Dashboard. Mit Häkchen „Beim Einstempeln zeigen“ sieht der Mitarbeiter den Hinweis am Terminal, sobald die Vorlaufzeit erreicht ist.">
        {e.reminders.length > 0 ? (
          <ul className="grid gap-2">
            {e.reminders.map((r) => {
              const st = reminderStatus({ dueDate: r.dueDate.toISOString().slice(0, 10), remindDaysBefore: r.remindDaysBefore, done: !!r.doneAt }, today);
              const cls = { DONE: "text-mute line-through", OVERDUE: "text-bad", DUE_SOON: "text-warn", LATER: "" }[st];
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-2">
                  <span className={cls}><span className="font-semibold">{r.title}</span> · {dateDe(r.dueDate)}{st === "OVERDUE" ? " · überfällig" : st === "DUE_SOON" ? " · bald fällig" : ""}{r.doneAt ? ` · erledigt ${dateDe(r.doneAt)}` : ""}
                    {!r.doneAt && <span className="block text-xs text-mute">{r.showOnTerminal ? `Mitarbeiter sieht es beim Einstempeln (ab ${r.remindDaysBefore} Tage vorher)` : "nur im Backoffice"}{r.repeatMonths ? ` · wiederholt sich alle ${r.repeatMonths} Monate` : ""}</span>}
                  </span>
                  {can("employees.manage") && !r.doneAt && (
                    <span className="flex gap-2">
                      {(["done", "terminal", "delete"] as const).map((op) => (
                        <form key={op} action={reminderAction}><input type="hidden" name="rid" value={r.id} /><input type="hidden" name="op" value={op} />
                          <button className="min-h-10 rounded-lg border border-line px-3 text-xs hover:bg-slate">{op === "done" ? "Erledigt ✓" : op === "terminal" ? (r.showOnTerminal ? "Am Terminal aus" : "Am Terminal zeigen") : "Löschen"}</button></form>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-mute">Noch keine Fristen eingetragen.</p>}
        {can("employees.manage") && (
          <details className="mt-3"><summary className="cursor-pointer text-gold">Frist hinzufügen</summary>
            <div className="mt-4"><ActionForm action={addReminder} submit="Frist speichern">
              <input type="hidden" name="id" value={e.id} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Select label="Art" name="kind" options={Object.entries(REMINDER_KINDS).map(([k, v]): [string, string] => [k, v.label])} />
                <Field label="Fällig am" name="dueDate" type="date" required />
                <Field label="Erinnern ab (Tage vorher)" name="days" type="number" inputMode="numeric" min={0} hint="leer = Vorschlag je Art" />
                <div className="sm:col-span-3"><Field label="Bezeichnung (optional)" name="title" hint="leer = Name der Art" /></div>
                <div className="sm:col-span-3"><Field label="Text für den Mitarbeiter (optional)" name="text" hint="leer = Standardtext, z. B. „Deine Belehrung nach Infektionsschutzgesetz ist am … fällig.“" /></div>
                <div className="sm:col-span-3"><Check label="Beim Einstempeln zeigen (Mitarbeiter sieht den Hinweis am Terminal)" name="terminal" /></div>
              </div>
            </ActionForm></div>
          </details>
        )}
      </Section>

      {hourly && can("wages.view") && (
        <Section title="Stundenlohn" hint="Nur im Backoffice sichtbar.">
          {wageIssues(toRows(e.wages), today).map((w) => (
            <p key={w.date} role="alert" className="mb-3 rounded-xl border border-bad/50 bg-bad/10 px-4 py-3 text-bad">
              {w.future ? `Ab ${dateDe(new Date(w.date))}` : "Aktuell"}: {euro(w.cents)} liegt unter dem Mindestlohn von {euro(w.minimum)}.{w.future ? " Bitte rechtzeitig einen neuen Stundenlohn ab diesem Datum eintragen." : ""}
            </p>
          ))}
          <table className="mb-4 w-full text-left text-sm tabular">
            <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">GÜLTIG</th><th>BRUTTO PRO STUNDE</th></tr></thead>
            <tbody>{e.wages.map((w) => <tr key={w.id} className="border-t border-line"><td className="py-2">{dateDe(w.validFrom)} – {w.validTo ? dateDe(w.validTo) : "heute"}</td><td>{euro(w.centsPerHour)}</td></tr>)}</tbody>
          </table>
          {can("wages.manage") && (
            <details><summary className="cursor-pointer text-gold">Stundenlohn ändern</summary>
              <div className="mt-4"><ActionForm action={addWage} submit="Stundenlohn speichern">
                <input type="hidden" name="id" value={e.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Gültig ab" name="validFrom" type="date" defaultValue={today} required />
                  <Field label="Bruttostundenlohn in €" name="wage" inputMode="decimal" />
                </div>
              </ActionForm></div>
            </details>
          )}
        </Section>
      )}

      <Section title="PIN am Terminal" hint="PINs sind nur verschlüsselt (nicht rückrechenbar) gespeichert und können nicht angezeigt werden. Bei Bedarf zurücksetzen: Der Mitarbeiter wählt dann mit einem Einmalcode einen neuen PIN.">
        <p className="mb-3">{!e.credential?.pinHash ? <span className="text-warn">Noch kein PIN festgelegt (Ersteinrichtung offen).</span> : <>PIN festgelegt am {e.credential.pinSetAt?.toLocaleDateString("de-DE")}.{e.credential.lockedUntil && e.credential.lockedUntil > new Date() && <span className="text-bad"> Wegen Fehlversuchen gesperrt bis {e.credential.lockedUntil.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin" })}.</span>}</>}</p>
        {can("pins.reset") && <ActionForm action={resetPin} submit="PIN zurücksetzen und neuen Einrichtungscode erzeugen"><input type="hidden" name="id" value={e.id} /></ActionForm>}
      </Section>

      {can("employees.manage") && (
        <Section title="Handy-Zugang „Mein NAYA“" hint="Am Handy kann nicht gestempelt werden. Der Mitarbeiter sieht nur, was du hier anhakst – Stunden immer nur für die laufende Woche und den laufenden Monat. Stundenlöhne sind nie sichtbar. Haken raus und speichern = sofort gesperrt.">
          <p className="mb-3 text-sm">{!e.credential?.portalEnabled ? <span className="text-mute">Gesperrt.</span> : e.credential.portalPasswordHash ? <span className="text-good">Freigeschaltet, Passwort ist eingerichtet.</span> : <span className="text-warn">Freigeschaltet, aber noch nicht eingerichtet – Einladungslink erzeugen.</span>}</p>
          <ActionForm action={savePortalVisibility} submit="Freigaben speichern">
            <input type="hidden" name="id" value={e.id} />
            <Check label="Handy-Zugang freischalten" name="portalEnabled" defaultChecked={e.credential?.portalEnabled} />
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Check label="Dienstplan (diese und nächste Woche)" name="schedule" defaultChecked={v?.schedule} />
              <Check label="Gearbeitete Stunden diese Woche" name="weeklyHours" defaultChecked={v?.weeklyHours} />
              <Check label="Wochensoll" name="weeklyTarget" defaultChecked={v?.weeklyTarget} />
              <Check label="Gearbeitete Stunden dieser Monat" name="monthlyHours" defaultChecked={v?.monthlyHours} />
              <Check label="Monatssoll" name="monthlyTarget" defaultChecked={v?.monthlyTarget} />
              <Check label="Nur Minusstunden (rot)" name="minusHours" defaultChecked={v?.minusHours} />
              <Check label="Stundenkonto Plus und Minus" name="accountBalance" defaultChecked={v?.accountBalance} />
              <Check label="Resturlaub und genehmigter Urlaub" name="vacationRemaining" defaultChecked={v?.vacationRemaining} />
              <Check label="Urlaubsanträge stellen" name="vacationRequests" defaultChecked={v?.vacationRequests} />
            </div>
          </ActionForm>
          {e.credential?.portalEnabled && <div className="mt-4"><PortalInvite id={e.id} hasPassword={!!e.credential.portalPasswordHash} /></div>}
        </Section>
      )}

      {can("employees.manage") && (
        <Section title={e.active ? "Mitarbeiter deaktivieren" : "Mitarbeiter aktivieren"} hint="Deaktivierte Mitarbeiter erscheinen nicht mehr am Terminal. Es wird nichts gelöscht. Nach Ablauf der Aufbewahrungsfrist erinnert dich das System, dann kannst du unter „Aufbewahrung / Löschung“ löschen.">
          <ActionForm action={setActive} submit={e.active ? "Deaktivieren" : "Aktivieren"}>
            <input type="hidden" name="id" value={e.id} /><input type="hidden" name="active" value={e.active ? "false" : "true"} />
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
