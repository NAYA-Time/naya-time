import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { addContract, addOvertimeRule, addWage, resetPin, savePortalVisibility, setActive, updateEmployee } from "@/lib/admin-actions-employees";
import { ActionForm, Field } from "@/components/ActionForm";
import { Check, Section, Select } from "@/components/Select";
import { EMPLOYMENT_LABEL, METHOD_LABEL, dateDe, euro } from "@/lib/labels";
import { berlinDate, fmtMinutes } from "@/lib/time";

export default async function EmployeeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ code?: string }> }) {
  const admin = await requireAdmin("employees.view");
  const { id } = await params;
  const { code } = await searchParams;
  const e = await prisma.employee.findUnique({
    where: { id },
    include: {
      primaryDept: true, subDept: true, credential: true, portalSettings: true,
      contracts: { orderBy: { validFrom: "desc" } }, overtimeRules: { orderBy: { validFrom: "desc" } }, wages: { orderBy: { validFrom: "desc" } },
      account: { include: { transactions: true } },
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
  return (
    <div className="grid max-w-4xl gap-5">
      <Link href="/admin/mitarbeiter" className="text-mute hover:text-paper">‹ Alle Mitarbeiter</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{e.firstName} {e.lastName}{!e.active && <span className="ml-3 text-base text-warn">inaktiv</span>}</h1>
          <p className="text-mute">Nr. {e.personnelNumber} · {e.primaryDept.name}{e.subDept ? ` · ${e.subDept.name}` : ""} · {EMPLOYMENT_LABEL[e.employmentType]}</p>
        </div>
        {!hourly && <div className="rounded-2xl border border-line bg-coal px-5 py-3 text-right"><p className="text-xs tracking-wider text-mute">STUNDENKONTO</p><p className={`text-2xl font-bold tabular ${balance < 0 ? "text-bad" : balance > 0 ? "text-good" : ""}`}>{balance > 0 ? "+" : ""}{fmtMinutes(balance)}</p></div>}
      </div>

      {code && (
        <p className="rounded-2xl border border-gold/50 bg-gold/10 px-5 py-4 text-paper">
          Einrichtungscode für das Terminal: <b className="font-mono text-2xl tracking-[0.3em] text-gold">{code}</b><br />
          <span className="text-sm text-mute">Gib den Code dem Mitarbeiter persönlich. Er wählt damit beim ersten Stempeln seinen eigenen PIN. 7 Tage gültig, wird nur jetzt angezeigt.</span>
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
          <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">GÜLTIG</th><th>WOCHENSOLL</th><th>MONATSSOLL</th><th>TAGE/WOCHE</th><th>URLAUB</th></tr></thead>
          <tbody>{e.contracts.map((c) => (
            <tr key={c.id} className="border-t border-line"><td className="py-2">{dateDe(c.validFrom)} – {c.validTo ? dateDe(c.validTo) : "heute"}</td><td>{c.weeklyMinutes != null ? fmtMinutes(c.weeklyMinutes) : "variabel"}</td><td>{METHOD_LABEL[c.monthlyTargetMethod]}{c.weeklyMinutes ? ` (Ø ${fmtMinutes(Math.round((c.weeklyMinutes * 13) / 3))})` : ""}</td><td>{c.workdaysPerWeek}</td><td>{c.vacationDaysPerYear} Tage</td></tr>
          ))}</tbody>
        </table>
        {can("contracts.manage") && (
          <details><summary className="cursor-pointer text-gold">Neuen Vertragsstand anlegen</summary>
            <div className="mt-4"><ActionForm action={addContract} submit="Vertragsstand speichern">
              <input type="hidden" name="id" value={e.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Gültig ab" name="validFrom" type="date" defaultValue={today} required />
                <Field label="Wochenstunden" name="weeklyHours" defaultValue={e.contracts[0]?.weeklyMinutes != null ? fmtMinutes(e.contracts[0].weeklyMinutes) : ""} />
                <Select label="Monatssoll" name="method" options={Object.entries(METHOD_LABEL)} defaultValue={e.contracts[0]?.monthlyTargetMethod} />
                <Field label="Arbeitstage pro Woche" name="workdaysPerWeek" type="number" defaultValue={e.contracts[0]?.workdaysPerWeek ?? 5} />
                <Field label="Urlaubstage pro Jahr" name="vacationDays" type="number" defaultValue={e.contracts[0]?.vacationDaysPerYear ?? 0} />
                <Field label="Notiz" name="note" />
              </div>
            </ActionForm></div>
          </details>
        )}
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

      {hourly && can("wages.view") && (
        <Section title="Stundenlohn" hint="Nur im Backoffice sichtbar.">
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
        <Section title="Persönlicher Mitarbeiterbereich" hint="Standardmäßig aus. Der Mitarbeiter sieht nur, was du hier freischaltest. Stundenlöhne sind nie sichtbar.">
          <ActionForm action={savePortalVisibility} submit="Freigaben speichern">
            <input type="hidden" name="id" value={e.id} />
            <Check label="Mitarbeiterbereich freischalten" name="portalEnabled" defaultChecked={e.credential?.portalEnabled} />
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Check label="Dienstplan" name="schedule" defaultChecked={v?.schedule} />
              <Check label="Wochensoll" name="weeklyTarget" defaultChecked={v?.weeklyTarget} />
              <Check label="Geleistete Wochenstunden" name="weeklyHours" defaultChecked={v?.weeklyHours} />
              <Check label="Monatsstunden" name="monthlyHours" defaultChecked={v?.monthlyHours} />
              <Check label="Monatssoll" name="monthlyTarget" defaultChecked={v?.monthlyTarget} />
              <Check label="Stundenkonto" name="accountBalance" defaultChecked={v?.accountBalance} />
              <Check label="Überstunden" name="overtime" defaultChecked={v?.overtime} />
              <Check label="Minusstunden" name="minusHours" defaultChecked={v?.minusHours} />
              <Check label="Abgegoltene Überstunden" name="includedOvertime" defaultChecked={v?.includedOvertime} />
              <Check label="Resturlaub" name="vacationRemaining" defaultChecked={v?.vacationRemaining} />
              <Check label="Eigene Arbeitszeitberichte" name="ownReports" defaultChecked={v?.ownReports} />
            </div>
          </ActionForm>
        </Section>
      )}

      {can("employees.manage") && (
        <Section title={e.active ? "Mitarbeiter deaktivieren" : "Mitarbeiter aktivieren"} hint="Deaktivierte Mitarbeiter erscheinen nicht mehr am Terminal. Es wird nichts gelöscht.">
          <ActionForm action={setActive} submit={e.active ? "Deaktivieren" : "Aktivieren"}>
            <input type="hidden" name="id" value={e.id} /><input type="hidden" name="active" value={e.active ? "false" : "true"} />
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
