import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { cancelPayrollAction, paymentAction, settlePayrollAction } from "@/lib/admin-actions-payroll";
import { dateDe, euro } from "@/lib/labels";
import { berlinDate, fmtMinutes } from "@/lib/time";
import { ActionForm, Field } from "@/components/ActionForm";
import { Section } from "@/components/Select";

const PERIOD_LABEL: Record<string, string> = { PREPARED: "vorbereitet", SETTLED: "festgeschrieben", CANCELLED: "storniert" };
const STATUS_LABEL: Record<string, string> = { NOT_SETTLED: "Noch nicht abgerechnet", PREPARED: "Abrechnung vorbereitet", SETTLED: "Abgerechnet", PAYMENT_SCHEDULED: "Auszahlung vorgemerkt", PARTIALLY_PAID: "Teilweise bezahlt", PAID: "Bezahlt", NEEDS_CORRECTION: "Korrektur erforderlich" };
const KIND_LABEL: Record<string, string> = { WORK: "Arbeit", PAID_ABSENCE: "Bezahlte Abwesenheit", ADJUSTMENT: "Korrektur" };

export default async function LaufPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("wages.view");
  const { id } = await params;
  const p = await prisma.payrollPeriod.findUniqueOrThrow({
    where: { id },
    include: { settlements: { include: { employee: true, items: { orderBy: { workDate: "asc" } }, payments: { orderBy: { createdAt: "asc" } } }, orderBy: { employee: { lastName: "asc" } } } },
  });
  const canManage = admin.permissions.has("payroll.manage");
  const total = p.settlements.reduce((a, s) => a + s.grossCents, 0);
  return (
    <div className="grid max-w-5xl gap-5">
      <Link href="/admin/aushilfen" className="text-sm text-mute hover:text-paper">← Aushilfenabrechnung</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{p.label}</h1>
          <p className="mt-1 text-mute">Stichtag {dateDe(p.cutoffDate)} · {PERIOD_LABEL[p.status]}{p.settledAt && ` am ${p.settledAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`}</p>
        </div>
        <div className="rounded-2xl border border-line bg-coal px-5 py-3 text-right"><p className="text-xs tracking-wider text-mute">BRUTTO GESAMT</p><p className="text-2xl font-bold tabular">{euro(total)}</p></div>
      </div>

      {canManage && p.status === "PREPARED" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Section title="Festschreiben" hint="Danach gelten die Stunden als abgerechnet und Zahlungen können gebucht werden.">
            <ActionForm action={settlePayrollAction} submit="Abrechnung festschreiben"><input type="hidden" name="id" value={p.id} /></ActionForm>
          </Section>
          <Section title="Stornieren" hint="Verwirft den Lauf. Die Stunden sind danach wieder offen.">
            <ActionForm action={cancelPayrollAction} submit="Lauf stornieren"><input type="hidden" name="id" value={p.id} /></ActionForm>
          </Section>
        </div>
      )}

      {p.settlements.map((s) => {
        const paid = s.payments.filter((x) => !x.reversedById).reduce((a, x) => a + x.amountCents, 0);
        const carry = s.items.filter((i) => i.isCarryOver);
        return (
          <Section key={s.id} title={`${s.employee.firstName} ${s.employee.lastName}`}>
            <dl className="grid grid-cols-2 gap-3 text-sm tabular sm:grid-cols-5">
              <div><dt className="text-xs text-mute">Stunden</dt><dd className="font-bold">{fmtMinutes(s.minutes)}</dd></div>
              <div><dt className="text-xs text-mute">Davon Übertrag</dt><dd>{carry.length ? fmtMinutes(carry.reduce((a, i) => a + i.minutes, 0)) : "–"}</dd></div>
              <div><dt className="text-xs text-mute">Brutto</dt><dd className="font-bold">{euro(s.grossCents)}</dd></div>
              <div><dt className="text-xs text-mute">Ausgezahlt</dt><dd>{euro(paid)}</dd></div>
              <div><dt className="text-xs text-mute">Status</dt><dd className={s.status === "PAID" ? "text-good" : ""}>{p.status === "CANCELLED" ? "storniert" : STATUS_LABEL[s.status]}</dd></div>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-gold">{s.items.length} Positionen</summary>
              <table className="mt-2 w-full text-left text-sm tabular">
                <thead className="text-xs text-mute"><tr><th className="py-1">TAG</th><th>ART</th><th>STUNDEN</th><th>LOHN/STD.</th><th>BETRAG</th></tr></thead>
                <tbody>{s.items.map((i) => (
                  <tr key={i.id} className="border-t border-line"><td className="py-1">{dateDe(i.workDate)}{i.isCarryOver && <span className="ml-1 text-xs text-warn">Übertrag</span>}</td><td>{KIND_LABEL[i.kind]}</td><td>{fmtMinutes(i.minutes)}</td><td>{euro(i.centsPerHour)}</td><td>{euro(i.amountCents)}</td></tr>
                ))}</tbody>
              </table>
            </details>
            {s.payments.length > 0 && (
              <ul className="mt-3 grid gap-1 text-sm">
                {s.payments.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-3">
                    <span className={`tabular ${x.reversedById ? "text-mute line-through" : ""}`}>{dateDe(x.paidOn)} · {euro(x.amountCents)}{x.reference && ` · ${x.reference}`}</span>{x.reversedById && <span className="text-xs text-bad">storniert</span>}
                    {canManage && !x.reversedById && (
                      <ActionForm action={paymentAction} submit="Stornieren" className="flex items-center gap-2 [&_button]:min-h-9 [&_button]:px-3 [&_button]:text-sm">
                        <input type="hidden" name="settlementId" value={s.id} /><input type="hidden" name="reverseId" value={x.id} /><input type="hidden" name="paidOn" value={berlinDate(new Date())} />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && p.status === "SETTLED" && paid < s.grossCents && (
              <div className="mt-4"><ActionForm action={paymentAction} submit="Zahlung buchen">
                <input type="hidden" name="settlementId" value={s.id} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Betrag (€)" name="amount" defaultValue={((s.grossCents - paid) / 100).toFixed(2).replace(".", ",")} required inputMode="decimal" />
                  <Field label="Gezahlt am" name="paidOn" type="date" defaultValue={berlinDate(new Date())} required />
                  <Field label="Verwendungszweck (optional)" name="reference" />
                </div>
              </ActionForm></div>
            )}
          </Section>
        );
      })}
    </div>
  );
}
