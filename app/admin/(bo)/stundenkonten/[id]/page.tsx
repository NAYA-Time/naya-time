import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { addAccountBooking } from "@/lib/admin-actions-closing";
import { berlinDate, fmtMinutes } from "@/lib/time";
import { dateDe } from "@/lib/labels";
import { ActionForm, Field } from "@/components/ActionForm";
import { Section, Select } from "@/components/Select";

const signed = (m: number) => `${m > 0 ? "+" : ""}${fmtMinutes(m)}`;
const label = (d: Date) => d.toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
const TX_LABEL: Record<string, string> = { OPENING_BALANCE: "Anfangsbestand", MONTH_CLOSING: "Monatsabschluss", CLOSING_CORRECTION: "Korrektur Abschluss", PAYOUT: "Auszahlung", TIME_OFF: "Freizeitausgleich", MANUAL_CORRECTION: "Korrektur" };

export default async function KontoPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("employees.view");
  const { id } = await params;
  const e = await prisma.employee.findUniqueOrThrow({
    where: { id },
    include: { account: { include: { transactions: { orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }] } } }, monthlyClosings: { where: { status: "CLOSED" }, orderBy: { month: "desc" } } },
  });
  const tx = e.account?.transactions ?? [];
  const balance = tx.reduce((a, t) => a + t.minutes, 0);
  return (
    <div className="grid max-w-5xl gap-5">
      <Link href="/admin/stundenkonten" className="text-sm text-mute hover:text-paper">← Stundenkonten</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">{e.firstName} {e.lastName}</h1>
        <div className="rounded-2xl border border-line bg-coal px-5 py-3 text-right"><p className="text-xs tracking-wider text-mute">KONTOSTAND</p><p className={`text-2xl font-bold tabular ${balance < 0 ? "text-bad" : balance > 0 ? "text-good" : ""}`}>{signed(balance)}</p></div>
      </div>

      <Section title="Monate">
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm tabular">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">MONAT</th><th>SOLL</th><th>IST</th><th>DIFFERENZ</th><th>ABGEGOLTEN</th><th>AUS VORMONATEN</th><th>AUFS KONTO</th><th>STAND</th></tr></thead>
          <tbody>{e.monthlyClosings.map((c) => {
            const ist = c.workedMinutes + c.sickCreditMinutes + c.vacationCreditMinutes + c.holidayCreditMinutes + c.otherCreditMinutes;
            return (
              <tr key={c.id} className="border-t border-line">
                <td className="py-2">{label(c.month)}{c.version > 1 && <span className="ml-1 text-xs text-mute">V{c.version}</span>}</td>
                <td>{fmtMinutes(c.targetMinutes)}</td><td>{fmtMinutes(ist)}</td><td className={ist < c.targetMinutes ? "text-bad" : ""}>{signed(ist - c.targetMinutes)}</td>
                <td>{fmtMinutes(c.includedOvertimeMinutes)}</td><td>{signed(c.balanceBeforeMinutes)}</td><td>{signed(c.accountChangeMinutes)}</td><td className="font-bold">{signed(c.balanceAfterMinutes)}</td>
              </tr>
            );
          })}
          {!e.monthlyClosings.length && <tr><td colSpan={8} className="py-3 text-mute">Noch kein Monat abgeschlossen.</td></tr>}</tbody>
        </table></div>
      </Section>

      <Section title="Buchungen" hint="Buchungen sind unveränderlich. Fehler werden mit einer Gegenbuchung ausgeglichen.">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm tabular">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">DATUM</th><th>ART</th><th>STUNDEN</th><th>GRUND</th></tr></thead>
          <tbody>{tx.map((t) => (
            <tr key={t.id} className="border-t border-line"><td className="py-2">{dateDe(t.bookingDate)}</td><td>{TX_LABEL[t.type]}</td><td className={t.minutes < 0 ? "text-bad" : "text-good"}>{signed(t.minutes)}</td><td className="text-mute">{t.reason}</td></tr>
          ))}
          {!tx.length && <tr><td colSpan={4} className="py-3 text-mute">Keine Buchungen.</td></tr>}</tbody>
        </table></div>
      </Section>

      {admin.permissions.has("accounts.manage") && (
        <Section title="Buchung hinzufügen" hint="Zum Beispiel ausgezahlte Überstunden. Freizeitausgleich am besten als Abwesenheit unter Urlaub eintragen, dann wird er beim Abschluss automatisch abgebucht.">
          <ActionForm action={addAccountBooking} submit="Buchen">
            <input type="hidden" name="employeeId" value={e.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Art" name="kind" options={[["PAYOUT", "Auszahlung (−)"], ["TIME_OFF", "Freizeitausgleich (−)"], ["PLUS", "Korrektur (+)"], ["MINUS", "Korrektur (−)"]]} />
              <Field label="Stunden" name="hours" required hint="z. B. 5:30 oder 5,5" />
              <Field label="Datum" name="date" type="date" defaultValue={berlinDate(new Date())} required />
              <div className="sm:col-span-3"><Field label="Grund" name="reason" required /></div>
            </div>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
