import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { createEmployee } from "@/lib/admin-actions-employees";
import { ActionForm, Field } from "@/components/ActionForm";
import { Check, Section, Select, WeekdayPicker } from "@/components/Select";
import { EMPLOYMENT_LABEL } from "@/lib/labels";
import { berlinDate } from "@/lib/time";

export default async function NewEmployee() {
  await requireAdmin("employees.manage");
  const depts = await prisma.department.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const main = depts.filter((d) => d.kind === "MAIN").map((d) => [d.id, d.name] as [string, string]);
  const sub = [["", "–"] as [string, string], ...depts.filter((d) => d.kind === "SUB").map((d) => [d.id, d.name] as [string, string])];
  return (
    <div className="grid max-w-3xl gap-5">
      <h1 className="text-3xl font-semibold">Mitarbeiter anlegen</h1>
      <ActionForm action={createEmployee} submit="Mitarbeiter anlegen" className="grid gap-5">
        <Section title="Person">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vorname" name="firstName" required />
            <Field label="Nachname" name="lastName" required />
            <Field label="Personalnummer" name="personnelNumber" required />
            <Field label="E-Mail (für den persönlichen Bereich)" name="email" type="email" />
            <Field label="Position" name="position" />
            <Field label="Eintrittsdatum" name="entryDate" type="date" defaultValue={berlinDate(new Date())} required />
          </div>
        </Section>
        <Section title="Abteilung und Beschäftigung">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Hauptabteilung" name="primaryDeptId" options={main} required />
            <Select label="Unterabteilung" name="subDeptId" options={sub} />
            <Select label="Beschäftigungsart" name="employmentType" options={Object.entries(EMPLOYMENT_LABEL)} defaultValue="FESTANGESTELLT" />
            <Field label="Wochenstunden (z. B. 42:30)" name="weeklyHours" defaultValue="42:30" hint="Bei Aushilfen ohne feste Stunden leer lassen." />
            <WeekdayPicker hint="Die üblichen Tage ankreuzen. Danach richten sich Urlaub und Krankheit an Tagen ohne Dienstplan. Ein eingeplanter Dienst zählt immer." />
            <Field label="Urlaubstage pro Jahr" name="vacationDays" type="number" defaultValue={26} min={0} />
          </div>
        </Section>
        <Section title="Festangestellte" hint="Nur ausfüllen, wenn Festangestellt gewählt ist.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Mit dem Gehalt abgegoltene Überstunden pro Monat" name="includedHours" options={[["0", "0 Std."], ["5", "5 Std."], ["10", "10 Std."], ["15", "15 Std."]]} defaultValue="0" />
            <Field label="Anfangsbestand Stundenkonto (z. B. -38:30)" name="openingBalance" />
          </div>
          <Check label="Abgeltung ist vertraglich vereinbart" name="agreed" />
        </Section>
        <Section title="Aushilfen" hint="Nur ausfüllen, wenn eine Aushilfen-Beschäftigungsart gewählt ist. Nur im Backoffice sichtbar.">
          <Field label="Bruttostundenlohn in € (z. B. 15,00)" name="wage" inputMode="decimal" />
        </Section>
      </ActionForm>
    </div>
  );
}
