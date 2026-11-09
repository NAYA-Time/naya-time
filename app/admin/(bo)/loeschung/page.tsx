// Aufbewahrung und Löschung ehemaliger Mitarbeiter – nur Inhaber, nichts wird automatisch gelöscht (Gunnar 09.11.2026).
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { formerEmployees } from "@/lib/erasure";
import { eraseEmployeeAction } from "@/lib/admin-actions-erasure";
import { ActionForm, Field } from "@/components/ActionForm";
import { Section } from "@/components/Select";

export const dynamic = "force-dynamic";
const de = (ymd: string) => ymd.split("-").reverse().join(".");

export default async function LoeschungPage() {
  const admin = await requireAdmin();
  if (admin.roleKey !== "OWNER") redirect("/admin?kein-recht=inhaber");
  const rows = await formerEmployees();
  const due = rows.filter((r) => r.deletable), waiting = rows.filter((r) => !r.deletable);
  return (
    <div className="grid max-w-4xl gap-5">
      <div>
        <h1 className="text-3xl font-semibold">Aufbewahrung und Löschung</h1>
        <p className="mt-1 text-mute">Daten ausgeschiedener Mitarbeiter müssen eine Zeit lang aufbewahrt werden und sollen danach gelöscht werden. Das System löscht nie von selbst. Ist die Frist abgelaufen, erscheint ein Hinweis im Dashboard und du löschst hier per Knopf. Nur für dich als Inhaber sichtbar.</p>
        <p className="mt-2 text-sm text-mute">Fristen ab Ende des Austrittsjahres: 2 Jahre für Arbeitszeitnachweise (ArbZG, Mindestlohngesetz). Wurden Löhne über NAYA TIME abgerechnet oder ausgezahlt (Aushilfen), zur Sicherheit 6 Jahre. Bitte im Zweifel mit dem Steuerbüro abstimmen. Das fälschungssichere Änderungsprotokoll bleibt erhalten.</p>
      </div>
      <Section title={`Jetzt löschbar (${due.length})`}>
        {due.length === 0 ? <p className="text-mute">Zurzeit ist bei niemandem die Frist abgelaufen.</p> : (
          <ul className="grid gap-4">{due.map((r) => (
            <li key={r.id} className="rounded-xl border border-warn/50 bg-warn/5 p-4">
              <p className="font-semibold">{r.name} <span className="font-normal text-mute">· Nr. {r.personnelNumber}{r.exitDate ? ` · ausgeschieden ${de(r.exitDate)}` : ""}</span></p>
              <p className="text-sm text-mute">Aufbewahrung {r.retention.reason}, abgelaufen seit {de(r.retention.deletableFrom)}.</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-gold">Endgültig löschen …</summary>
                <ActionForm action={eraseEmployeeAction} submit="Endgültig löschen" className="mt-3 grid gap-3 sm:max-w-md">
                  <input type="hidden" name="id" value={r.id} />
                  <p className="text-sm text-bad">Gelöscht werden alle Stempelungen, Fotos, Dienste, Abwesenheiten, Löhne, Monatsabschlüsse und die PIN. Das lässt sich nicht rückgängig machen. Exportiere vorher, was du noch brauchst.</p>
                  <Field label={`Zur Bestätigung Personalnummer eintippen (${r.personnelNumber})`} name="confirm" required autoComplete="off" />
                </ActionForm>
              </details>
            </li>
          ))}</ul>
        )}
      </Section>
      <Section title={`Noch aufbewahren (${waiting.length})`}>
        {waiting.length === 0 ? <p className="text-mute">Keine ausgeschiedenen Mitarbeiter.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm tabular">
            <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">MITARBEITER</th><th>AUSGESCHIEDEN</th><th>FRIST</th><th>LÖSCHBAR AB</th></tr></thead>
            <tbody>{waiting.map((r) => (
              <tr key={r.id} className="border-t border-line"><td className="py-2">{r.name}</td><td>{r.exitDate ? de(r.exitDate) : "–"}</td><td>{r.retention.years} Jahre</td><td>{de(r.retention.deletableFrom)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}
