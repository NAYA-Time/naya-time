import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { preparePayrollAction } from "@/lib/admin-actions-payroll";
import { loadOpenPayroll } from "@/lib/payroll";
import { currentDeptFilter, matchesEmp } from "@/lib/dept";
import { dateDe, euro } from "@/lib/labels";
import { berlinDate, fmtMinutes } from "@/lib/time";
import { ActionForm, Field } from "@/components/ActionForm";
import { Section } from "@/components/Select";

const PERIOD_LABEL: Record<string, string> = { PREPARED: "vorbereitet", SETTLED: "festgeschrieben", CANCELLED: "storniert" };

export default async function AushilfenPage({ searchParams }: { searchParams: Promise<{ stichtag?: string }> }) {
  const admin = await requireAdmin("wages.view");
  const sp = await searchParams;
  const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(sp.stichtag ?? "") ? sp.stichtag! : berlinDate(new Date());
  const filter = await currentDeptFilter();
  const [open, periods, emps] = await Promise.all([
    loadOpenPayroll(prisma, cutoff),
    prisma.payrollPeriod.findMany({ orderBy: { createdAt: "desc" }, take: 24, include: { settlements: { include: { payments: true } } } }),
    prisma.employee.findMany({ include: { primaryDept: { include: { parent: true } } } }),
  ]);
  const emp = new Map(emps.map((e) => [e.id, e]));
  const rows = open.filter((o) => matchesEmp(filter, emp.get(o.employeeId)));
  const ready = rows.filter((r) => !r.blockers.length && r.items.length);
  const canManage = admin.permissions.has("payroll.manage");
  const pending = periods.find((p) => p.status === "PREPARED");

  return (
    <div className="grid max-w-5xl gap-5">
      <h1 className="text-3xl font-semibold">Aushilfenabrechnung</h1>
      <p className="text-mute">Abgerechnet werden alle noch offenen Stunden bis einschließlich Stichtag. Bereits abgerechnete Stunden werden nie doppelt gezählt; Stunden aus Vormonaten erscheinen als Übertrag.</p>

      <Section title="Offene Stunden bis Stichtag">
        <form className="mb-4 flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-sm text-mute">Stichtag (einschließlich)
            <input type="date" name="stichtag" defaultValue={cutoff} className="min-h-12 rounded-xl border border-line bg-ink px-4 text-base text-paper" />
          </label>
          <button className="min-h-12 rounded-xl border border-line px-5 hover:bg-slate">Anzeigen</button>
        </form>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm tabular">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">AUSHILFE</th><th>STUNDEN</th><th>DAVON ÜBERTRAG</th><th>BRUTTO</th><th>HINWEISE</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const e = emp.get(r.employeeId);
              return (
                <tr key={r.employeeId} className="border-t border-line align-top">
                  <td className="py-2 font-semibold">{e?.firstName} {e?.lastName}</td>
                  <td>{fmtMinutes(r.minutes)}</td>
                  <td>{r.carryMinutes ? `${fmtMinutes(r.carryMinutes)} (${euro(r.carryCents)})` : "–"}</td>
                  <td className="font-bold">{euro(r.grossCents)}</td>
                  <td className="text-xs">{r.blockers.map((b) => <p key={b} className="text-bad">{b}</p>)}{r.hints.map((h) => <p key={h} className="text-warn">{h}</p>)}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="py-3 text-mute">Keine offenen Aushilfenstunden bis {dateDe(new Date(cutoff + "T00:00:00Z"))}.</td></tr>}
          </tbody>
        </table></div>
        {canManage && ready.length > 0 && (pending
          ? <p className="mt-4 text-warn">Es gibt schon einen vorbereiteten Lauf: <Link className="underline" href={`/admin/aushilfen/${pending.id}`}>{pending.label}</Link>. Bitte zuerst festschreiben oder stornieren.</p>
          : <div className="mt-4"><ActionForm action={preparePayrollAction} submit={`Abrechnung für ${ready.length} Aushilfen vorbereiten`}>
              <input type="hidden" name="cutoff" value={cutoff} />
              <Field label="Bezeichnung (optional)" name="label" />
            </ActionForm></div>)}
      </Section>

      <Section title="Abrechnungsläufe">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm tabular">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">LAUF</th><th>STICHTAG</th><th>STATUS</th><th>AUSHILFEN</th><th>BRUTTO</th><th>AUSGEZAHLT</th></tr></thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-2"><Link href={`/admin/aushilfen/${p.id}`} className="text-gold underline">{p.label}</Link></td>
                <td>{dateDe(p.cutoffDate)}</td><td>{PERIOD_LABEL[p.status]}</td><td>{p.settlements.length}</td>
                <td>{euro(p.settlements.reduce((a, s) => a + s.grossCents, 0))}</td>
                <td>{euro(p.settlements.reduce((a, s) => a + s.payments.filter((y) => !y.reversedById).reduce((x, y) => x + y.amountCents, 0), 0))}</td>
              </tr>
            ))}
            {!periods.length && <tr><td colSpan={6} className="py-3 text-mute">Noch keine Abrechnung.</td></tr>}
          </tbody>
        </table></div>
      </Section>
    </div>
  );
}
