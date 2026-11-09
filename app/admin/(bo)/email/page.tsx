import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { addRecipient, saveSchedule, sendScheduleNow, setScheduleRecipients, toggleRecipient, toggleSchedule } from "@/lib/admin-actions-reports";
import { mailConfigured } from "@/lib/mail";
import { ActionForm, Field } from "@/components/ActionForm";
import { Section, Select } from "@/components/Select";

const TYPE: Record<string, string> = { WEEKLY: "Wochenbericht", MONTHLY: "Monatsbericht", PAYROLL_HOURLY: "Aushilfenabrechnung (letzter Lauf)" };
const DEPT: Record<string, string> = { ALL: "Alle", KUECHE: "Küche", SERVICE: "Service" };
const WD = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const when = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "–");

export default async function EmailPage() {
  await requireAdmin("reports.email");
  const [recipients, schedules, logs] = await Promise.all([
    prisma.emailRecipient.findMany({ orderBy: { email: "asc" } }),
    prisma.reportSchedule.findMany({ orderBy: { name: "asc" }, include: { recipients: { include: { recipient: true } } } }),
    prisma.emailDeliveryLog.findMany({ orderBy: { sentAt: "desc" }, take: 30, include: { report: true } }),
  ]);
  const configured = mailConfigured();
  return (
    <div className="grid max-w-5xl gap-5">
      <h1 className="text-3xl font-semibold">E-Mail-Automatisierung</h1>
      {!configured && <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">Der E-Mail-Versand ist noch nicht eingerichtet. Dafür werden die Zugangsdaten eines Postfachs (SMTP) in der Server-Konfiguration hinterlegt. Bis dahin werden Berichte erstellt, der Versand aber als fehlgeschlagen protokolliert.</p>}

      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Empfänger">
          <ul className="mb-4 grid gap-2">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <span className={r.active ? "" : "text-mute line-through"}>{r.name ? `${r.name} · ` : ""}{r.email}</span>
                <form action={toggleRecipient}><input type="hidden" name="id" value={r.id} /><button className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-slate">{r.active ? "Deaktivieren" : "Aktivieren"}</button></form>
              </li>
            ))}
            {!recipients.length && <li className="text-mute">Noch keine Empfänger.</li>}
          </ul>
          <ActionForm action={addRecipient} submit="Empfänger hinzufügen">
            <div className="grid gap-4 sm:grid-cols-2"><Field label="E-Mail" name="email" type="email" required /><Field label="Name (optional)" name="name" /></div>
          </ActionForm>
        </Section>

        <Section title="Neuer automatischer Versand" hint="Wochenbericht = Vorwoche, Monatsbericht = Vormonat. Uhrzeit nach deutscher Zeit.">
          {recipients.some((r) => r.active) ? (
            <ActionForm action={saveSchedule} submit="Anlegen">
              <Field label="Name" name="name" defaultValue="Wochenbericht Küche" required />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Bericht" name="reportType" options={Object.entries(TYPE)} />
                <Select label="Abteilung" name="deptFilter" options={Object.entries(DEPT)} />
                <Select label="Wochentag (Wochenbericht)" name="dayOfWeek" options={WD.slice(1).map((w, i) => [String(i + 1), w])} />
                <Field label="Tag im Monat (Monatsbericht)" name="dayOfMonth" type="number" min={1} defaultValue={3} />
                <Field label="Uhrzeit" name="timeOfDay" type="time" defaultValue="08:00" required />
              </div>
              <fieldset className="grid gap-2"><legend className="mb-1 text-sm text-mute">Empfänger</legend>
                {recipients.filter((r) => r.active).map((r) => <label key={r.id} className="flex items-center gap-3"><input type="checkbox" name="recipients" value={r.id} className="size-5 accent-[#c8a15c]" />{r.email}</label>)}
              </fieldset>
            </ActionForm>
          ) : <p className="text-mute">Bitte zuerst einen Empfänger anlegen.</p>}
        </Section>
      </div>

      <Section title="Geplante Versände">
        <div className="grid gap-3">
          {schedules.map((s) => (
            <div key={s.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-4">
              <div className="text-sm">
                <p className="text-base font-semibold">{s.name} {!s.enabled && <span className="text-xs text-mute">(pausiert)</span>}</p>
                <p className="text-mute">{TYPE[s.reportType]} · {DEPT[s.deptFilter]} · {s.reportType === "WEEKLY" ? `jeden ${WD[s.dayOfWeek ?? 1]}` : `am ${s.dayOfMonth}. des Monats`} um {s.timeOfDay}</p>
                <p className="text-mute">An: {s.recipients.map((r) => r.recipient.email).join(", ")}</p>
                <p className="text-mute">Zuletzt: {when(s.lastRunAt)} · Nächster: {s.enabled ? when(s.nextRunAt) : "–"}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-gold">Empfänger ändern</summary>
                  <ActionForm action={setScheduleRecipients} submit="Empfänger speichern" className="mt-2 grid gap-2">
                    <input type="hidden" name="id" value={s.id} />
                    {recipients.filter((r) => r.active).map((r) => (
                      <label key={r.id} className="flex items-center gap-3"><input type="checkbox" name="recipients" value={r.id} defaultChecked={s.recipients.some((x) => x.recipientId === r.id)} className="size-5 accent-[#c8a15c]" />{r.name ? `${r.name} – ` : ""}{r.email}</label>
                    ))}
                  </ActionForm>
                </details>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <form action={toggleSchedule}><input type="hidden" name="id" value={s.id} /><button className="min-h-12 rounded-xl border border-line px-4 hover:bg-slate">{s.enabled ? "Pausieren" : "Fortsetzen"}</button></form>
                <ActionForm action={sendScheduleNow} submit="Jetzt senden" className="grid gap-2"><input type="hidden" name="id" value={s.id} /></ActionForm>
              </div>
            </div>
          ))}
          {!schedules.length && <p className="text-mute">Noch kein automatischer Versand.</p>}
        </div>
      </Section>

      <Section title="Versandprotokoll">
        <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">ZEIT</th><th>EMPFÄNGER</th><th>DATEI</th><th>STATUS</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-line"><td className="py-2">{when(l.sentAt)}</td><td>{l.recipient}</td><td>{l.report.fileName}</td><td className={l.status === "SENT" ? "text-good" : "text-bad"}>{l.status === "SENT" ? "gesendet" : `fehlgeschlagen: ${l.error ?? ""}`}</td></tr>
            ))}
            {!logs.length && <tr><td colSpan={4} className="py-3 text-mute">Noch nichts versendet.</td></tr>}
          </tbody>
        </table></div>
      </Section>
    </div>
  );
}
